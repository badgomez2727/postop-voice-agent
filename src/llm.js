/**
 * LLM adapter.
 *
 * The challenge announces a single mandatory model on August 7. Everything
 * model-specific is confined to this file, so switching providers is an
 * environment change, not a refactor.
 *
 * With LLM_PROVIDER=none the agent still holds a usable conversation using the
 * scripted planner below. That keeps the whole pipeline runnable — and free —
 * while the rest of the system is being built.
 */

const SYSTEM_PROMPT = `Eres un asistente de seguimiento post-operatorio que habla por teléfono con un paciente en Colombia, en las primeras horas después de un procedimiento.

Reglas que no puedes romper:
1. Solo puedes afirmar información clínica que aparezca en el CONTEXTO entregado. Si el contexto no la cubre, dices que no tienes esa información y que vas a pasar el caso a personal capacitado.
2. No diagnosticas, no cambias tratamientos y no ajustas dosis.
3. Hablas en español coloquial colombiano, con frases cortas: te van a escuchar, no leer.
4. Una sola pregunta por turno.
5. Si el paciente describe algo vago o ambiguo, preguntas por concreciones: desde cuándo, qué tan intenso, si empeora.

Devuelves únicamente JSON válido con esta forma:
{"reply": "lo que dices en voz alta", "askedAbout": "sintoma_o_tema", "usedSources": ["id"], "groundedInContext": true}`;

const SCRIPT = [
  { topic: 'apertura', text: 'Hola, buenas. Le llamo del seguimiento después de su procedimiento. ¿Cómo se ha sentido en estas horas?' },
  { topic: 'dolor', text: 'Cuénteme del dolor. En una escala de 1 a 10, ¿en cuánto lo pondría ahora mismo?' },
  { topic: 'herida', text: 'Y la herida, ¿cómo la ve? ¿Ha notado sangrado, hinchazón o mal olor?' },
  { topic: 'fiebre', text: '¿Ha tenido fiebre o escalofríos desde que salió?' },
  { topic: 'via_oral', text: '¿Ha podido tomar líquidos y comer algo sin devolverlo?' },
  { topic: 'medicacion', text: '¿Está tomando los medicamentos como se los indicaron?' },
  { topic: 'cierre', text: 'Le agradezco. Voy a dejar registrado todo esto para el equipo. ¿Hay algo más que quiera reportar antes de colgar?' }
];

function scriptedReply(session, assessment, evidence) {
  if (assessment.escalate) {
    return {
      reply: 'Lo que me está contando necesita que lo valore alguien del equipo ya mismo. No cuelgue, voy a reportarlo de inmediato. Si empeora antes de que lo contacten, vaya a urgencias.',
      askedAbout: 'escalamiento',
      usedSources: evidence.map(e => e.sourceId),
      groundedInContext: evidence.length > 0
    };
  }

  if (assessment.needsClarification) {
    return {
      reply: 'Cuénteme un poquito más para entenderle bien: ¿desde cuándo se siente así, y diría que va mejorando o empeorando?',
      askedAbout: 'aclaracion',
      usedSources: [],
      groundedInContext: false
    };
  }

  const pending = SCRIPT.find(step => !session.coveredTopics.includes(step.topic));
  const step = pending || SCRIPT[SCRIPT.length - 1];

  let prefix = '';
  if (assessment.flagForReview) {
    prefix = 'Entiendo, eso lo voy a dejar marcado para que enfermería lo revise. ';
  } else {
    // Retrieving a related passage from the knowledge base does not mean
    // that passage confirms this patient's situation is fine -- it only
    // means something topically relevant was found. Asserting "eso está
    // dentro de lo esperado" here was a clinical claim the retrieval never
    // actually backed. A neutral acknowledgment doesn't make that claim.
    prefix = 'Gracias por contarme. ';
  }

  return {
    reply: prefix + step.text,
    askedAbout: step.topic,
    usedSources: evidence.map(e => e.sourceId),
    groundedInContext: evidence.length > 0
  };
}

async function callProvider({ history, evidence, utterance }) {
  const context = evidence.length
    ? evidence.map(e => `[${e.sourceId}]\n${e.text}`).join('\n\n---\n\n')
    : '(sin contexto recuperado)';

  const response = await fetch(process.env.LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        ...history,
        { role: 'user', content: `CONTEXTO:\n${context}\n\nPACIENTE DICE: ${utterance}` }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();

  return JSON.parse(text);
}

export async function generateTurn({ session, utterance, assessment, evidence }) {
  const provider = process.env.LLM_PROVIDER || 'none';

  if (provider === 'none' || !process.env.LLM_API_URL) {
    return { ...scriptedReply(session, assessment, evidence), engine: 'scripted' };
  }

  try {
    const result = await callProvider({
      history: session.history,
      evidence,
      utterance
    });
    return { ...result, engine: 'llm' };
  } catch (error) {
    // A failed model call must not drop the call. Degrade to the script and
    // record that it happened, so the transcript stays auditable.
    return {
      ...scriptedReply(session, assessment, evidence),
      engine: 'scripted-fallback',
      error: error.message
    };
  }
}
