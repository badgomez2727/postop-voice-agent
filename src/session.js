import { randomUUID } from 'node:crypto';
import { mergeAssessments } from './triage.js';

const sessions = new Map();

export function createSession({ patientAlias = 'Paciente de prueba', procedure = 'No especificado' } = {}) {
  const id = randomUUID();
  const session = {
    id,
    startedAt: new Date().toISOString(),
    endedAt: null,
    patientAlias,
    procedure,
    turns: [],
    history: [],
    assessments: [],
    coveredTopics: [],
    // Métricas crudas, una entrada por turno conversacional (no incluye el
    // saludo de apertura, que no pasa por el modelo ni por el RAG). Todavía
    // no se agregan a P50/P95 aquí -- eso es trabajo aparte sobre estos
    // datos, no algo que instrumentar en el camino caliente de la llamada.
    metrics: []
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found. Start a new call.');
  return session;
}

// Solo engine:'llm' hace una afirmación clínica que de verdad usa la
// evidencia recuperada -- el guion fijo (scripted/scripted-routed/
// scripted-fallback), el mensaje de escalamiento y el de RED-PSYCH nunca
// citan nada, aunque retrieve() haya encontrado algo para lo que dijo el
// paciente ese turno (server.js llama retrieve() en cada turno, sin
// importar el motor). Antes de este cambio, `evidence` se guardaba tal
// cual sin importar el motor, así que el resumen estructurado -- el JSON
// que de verdad se entrega, no solo la consola -- podía citar un
// documento irrelevante como fuente de un turno guionado. Encontrado en
// una llamada real: "estoy sangrando mucho y no para" (turno de
// escalamiento, sin RAG de por medio) hizo que "breast-cancer--documento.md#64"
// apareciera en traceability.citedSources -- nunca se usó para nada, solo
// coincidió por casualidad con retrieve(utterance). Mismo principio que
// ya se aplicó en public/index.html (addLedgerEntry), ahora en la fuente
// de datos real, no solo en cómo se pinta.
export function recordTurn(session, { utterance, reply, assessment, evidence, engine, metrics }) {
  const esAfirmacionClinica = engine === 'llm';
  session.turns.push({
    at: new Date().toISOString(),
    patient: utterance,
    agent: reply.reply,
    engine,
    triage: assessment,
    evidence: esAfirmacionClinica
      ? evidence.map(({ sourceId, file, position, relevance }) => ({
          sourceId,
          file,
          position,
          relevance
        }))
      : [],
    grounded: Boolean(reply.groundedInContext),
    metrics
  });

  session.history.push({ role: 'user', content: utterance });
  session.history.push({ role: 'assistant', content: reply.reply });
  session.assessments.push(assessment);
  session.metrics.push(metrics);

  if (reply.askedAbout && !session.coveredTopics.includes(reply.askedAbout)) {
    session.coveredTopics.push(reply.askedAbout);
  }
}

/**
 * Structured summary of the call.
 * Shaped for a clinician reading it cold: what was reported, what the agent
 * decided, and which document backs every clinical statement it made.
 */
export function summarize(session) {
  const overall = mergeAssessments(session.assessments);

  const citedSources = [...new Set(
    session.turns.flatMap(turn => turn.evidence.map(e => e.sourceId))
  )];

  // Solo cuenta como "sin respaldo" un turno que SÍ intentó una afirmación
  // clínica (engine: 'llm') y no logró fundamentarla -- no cualquier turno
  // guionado, que nunca intenta fundamentar nada porque no afirma nada
  // clínico (ver el comentario en recordTurn(), src/session.js).
  const ungroundedTurns = session.turns
    .filter(turn => turn.engine === 'llm' && !turn.grounded)
    .map(turn => turn.at);

  return {
    callId: session.id,
    patientAlias: session.patientAlias,
    procedure: session.procedure,
    startedAt: session.startedAt,
    endedAt: session.endedAt || new Date().toISOString(),
    turnCount: session.turns.length,
    topicsCovered: session.coveredTopics,
    triage: {
      level: overall.level,
      disposition: overall.disposition,
      escalated: overall.escalate,
      findings: overall.findings
    },
    traceability: {
      citedSources,
      turnsWithoutSupportingSource: ungroundedTurns.length,
      ungroundedTurnTimestamps: ungroundedTurns
    },
    // Datos crudos, sin agregar a P50/P95 todavía -- eso se calcula aparte,
    // sobre estos mismos números, cuando haya volumen suficiente de llamadas.
    metrics: {
      perTurn: session.metrics,
      // Por motor: cuántos turnos resolvió el guion sin tocar al modelo
      // (scripted / scripted-routed), cuántos sí lo invocaron (llm), y
      // cuántos cayeron a guion porque el modelo falló (scripted-fallback).
      // 'scripted-routed' es la señal directa de cuánto está ahorrando el
      // enrutamiento selectivo (src/llm.js, necesitaModelo()) -- sin esto,
      // "el modelo no se invoca casi nunca" es una afirmación sin cómo
      // verificarla desde el resumen de la llamada.
      engineCounts: session.turns.reduce((acc, turn) => {
        acc[turn.engine] = (acc[turn.engine] || 0) + 1;
        return acc;
      }, {}),
      totals: session.metrics.reduce(
        (acc, m) => ({
          modelInvocations: acc.modelInvocations + (m.modelInvocations || 0),
          ragQueries: acc.ragQueries + (m.ragQueries || 0),
          tokensIn: m.tokensIn == null ? acc.tokensIn : acc.tokensIn + m.tokensIn,
          tokensOut: m.tokensOut == null ? acc.tokensOut : acc.tokensOut + m.tokensOut
        }),
        { modelInvocations: 0, ragQueries: 0, tokensIn: 0, tokensOut: 0 }
      )
    },
    transcript: session.turns.map(turn => ({
      at: turn.at,
      patient: turn.patient,
      agent: turn.agent,
      triageLevel: turn.triage.level,
      sources: turn.evidence.map(e => e.sourceId)
    }))
  };
}

export function endSession(session) {
  session.endedAt = new Date().toISOString();
  return summarize(session);
}
