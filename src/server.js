import express from 'express';
import path from 'node:path';
import { rebuildIndex, retrieve, listDocuments, saveDocument, deleteDocument } from './rag.js';
import { assess } from './triage.js';
import { generateTurn } from './llm.js';
import { createSession, getSession, recordTurn, endSession, summarize } from './session.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.resolve('public')));

const PORT = process.env.PORT || 3000;

function fail(res, error, status = 400) {
  res.status(status).json({ error: error.message || String(error) });
}

// ---- Knowledge console -----------------------------------------------------

app.get('/api/knowledge', (_req, res) => res.json(listDocuments()));

app.post('/api/knowledge', async (req, res) => {
  try {
    const { filename, content } = req.body;
    if (!filename || !content) throw new Error('Send a filename and the document content.');
    const saved = await saveDocument(filename, content);
    res.json({ saved, ...listDocuments() });
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/api/knowledge/:filename', async (req, res) => {
  try {
    const removed = await deleteDocument(req.params.filename);
    res.json({ removed, ...listDocuments() });
  } catch (error) {
    fail(res, error);
  }
});

// Lets you prove retrieval works without holding a whole conversation.
app.post('/api/retrieve', (req, res) => {
  try {
    const { question, k } = req.body;
    if (!question) throw new Error('Send a question to retrieve against.');
    res.json({ question, evidence: retrieve(question, { k: k || 3 }) });
  } catch (error) {
    fail(res, error);
  }
});

// ---- Call flow -------------------------------------------------------------

app.post('/api/calls', (req, res) => {
  const session = createSession(req.body || {});
  const opening = 'Hola, buenas. Le llamo del seguimiento después de su procedimiento. ¿Cómo se ha sentido en estas horas?';

  session.turns.push({
    at: new Date().toISOString(),
    patient: null,
    agent: opening,
    engine: 'scripted',
    triage: { level: 'none', escalate: false, flagForReview: false, needsClarification: false, findings: [] },
    evidence: [],
    grounded: true
  });
  session.history.push({ role: 'assistant', content: opening });
  session.coveredTopics.push('apertura');

  res.json({ callId: session.id, agent: opening });
});

app.post('/api/calls/:id/turns', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const utterance = (req.body.utterance || '').trim();
    if (!utterance) throw new Error('Send what the patient said.');

    // La latencia que importa para voz es esta: desde que la transcripción
    // del paciente está lista hasta que la respuesta del agente lo está.
    // No incluye el tiempo de reconocimiento de voz (fuera de este
    // servidor) ni el de síntesis (ocurre después de esta respuesta).
    const turnStartedAt = Date.now();
    let ragQueries = 0;

    // Contexto mínimo para interpretar un puntaje de dolor aislado ("8",
    // "le doy un 9"): coveredTopics.at(-1) en este punto todavía es el
    // último tema que el agente preguntó -- el tema de ESTE turno se
    // agrega recién en recordTurn(), más abajo. Ver src/triage.js,
    // evaluarPuntajeDolor().
    const lastAskedTopic = session.coveredTopics[session.coveredTopics.length - 1];
    const assessment = assess(utterance, { lastAskedTopic });
    // k: 1, no 3 -- ver src/llm.js: procesar el contexto de entrada, no
    // generar la salida, es el cuello de botella medido con el modelo
    // local (docs/DECISIONS.md, decisión 5). Un pasaje menos es contexto
    // que nunca entra al prompt en las invocaciones que sí llaman al
    // modelo. El registro de evidencia sigue mostrando lo que rag.js
    // considera más relevante, solo que ahora es uno, no tres.
    const evidence = retrieve(utterance, { k: 1 });
    ragQueries += 1;
    const reply = await generateTurn({ session, utterance, assessment, evidence });

    const metrics = {
      latencyMs: Date.now() - turnStartedAt,
      tokensIn: reply.tokensIn ?? null,
      tokensOut: reply.tokensOut ?? null,
      modelInvocations: reply.modelInvocations ?? 0,
      ragQueries
    };

    recordTurn(session, { utterance, reply, assessment, evidence, engine: reply.engine, metrics });

    res.json({
      agent: reply.reply,
      engine: reply.engine,
      triage: assessment,
      evidence,
      grounded: Boolean(reply.groundedInContext),
      metrics
    });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/calls/:id/summary', (req, res) => {
  try {
    res.json(summarize(getSession(req.params.id)));
  } catch (error) {
    fail(res, error, 404);
  }
});

app.post('/api/calls/:id/end', (req, res) => {
  try {
    res.json(endSession(getSession(req.params.id)));
  } catch (error) {
    fail(res, error, 404);
  }
});

// ---- Boot ------------------------------------------------------------------

const startup = await rebuildIndex();
app.listen(PORT, () => {
  console.log(`Post-op follow-up agent listening on http://localhost:${PORT}`);
  console.log(`Knowledge base: ${startup.documents.length} document(s), ${startup.totalChunks} chunk(s)`);
  console.log(`LLM provider: ${process.env.LLM_PROVIDER || 'none (scripted dialogue)'}`);
});
