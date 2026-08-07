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
    coveredTopics: []
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Session not found. Start a new call.');
  return session;
}

export function recordTurn(session, { utterance, reply, assessment, evidence, engine }) {
  session.turns.push({
    at: new Date().toISOString(),
    patient: utterance,
    agent: reply.reply,
    engine,
    triage: assessment,
    evidence: evidence.map(({ sourceId, file, position, relevance }) => ({
      sourceId,
      file,
      position,
      relevance
    })),
    grounded: Boolean(reply.groundedInContext)
  });

  session.history.push({ role: 'user', content: utterance });
  session.history.push({ role: 'assistant', content: reply.reply });
  session.assessments.push(assessment);

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

  const ungroundedTurns = session.turns
    .filter(turn => !turn.grounded)
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
