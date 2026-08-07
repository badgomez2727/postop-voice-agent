/**
 * Escalation decision engine.
 *
 * Deliberately rule-first, not model-first: the decision to wake a clinician
 * has to be inspectable and reproducible. The model paraphrases and asks
 * follow-up questions; the rules decide whether a human gets called.
 *
 * Every rule carries the phrase that fired it, so the call summary can show
 * why the agent escalated instead of asserting that it did.
 */

// ---- Negation -----------------------------------------------------------
//
// A patient denying a symptom ("no tengo fiebre") must not fire the same
// rule as reporting it. Some phrasings bake the denial INTO the alarm
// itself -- "no puedo respirar" and "el dolor no se me quita" are the danger
// signal, not a negation of one. Those patterns are marked `selfNegating`
// below and always matched as-is, full stop.
//
// Every other pattern only fires when the clause it matched in is not under
// a denial. "Under a denial" means: a negation cue (no / nunca / jamás /
// tampoco / ni) appears earlier in the same clause than the match. Position
// matters -- "estoy sangrando mucho y no sé por qué" must still escalate;
// the "no" there governs "por qué", not "sangrando".
//
// A clause ends at a full stop, a semicolon, or a contrastive conjunction
// ("pero", "aunque", "sin embargo", "sino") -- deliberately NOT at a bare
// comma. Spanish keeps listing what's being denied across commas ("no tengo
// fiebre, ni escalofríos, ni nada"); splitting on the comma strands "ni
// escalofríos" in its own clause with no visible cue, and a symptom named
// right after a stray comma reads as reported instead of denied.
//
// This is a heuristic, not a parser. A cue that shows up later in a long
// clause for an unrelated reason can still over-suppress a real finding
// that comes after it. Good enough for how patients actually phrase a
// denial out loud; not a substitute for real NLU. If this stops being
// good enough, the fix belongs here, with a case added to
// tests/triage.cases.mjs first.

const NEGATION_CUE = /\b(no|nunca|jamás|jamas|tampoco|ni)\b/i;
// A period only ends a clause when it's not a decimal point ("38.7 grados"
// must stay one clause, or the temperature pattern never sees the whole
// number).
const CLAUSE_BOUNDARY = /(?<!\d)\.+(?!\d)|;|\b(?:pero|aunque|sin\s+embargo|sino)\b/gi;

function splitClauses(utterance) {
  return utterance
    .split(CLAUSE_BOUNDARY)
    .map(clause => (clause || '').trim())
    .filter(Boolean);
}

/** True if a negation cue appears before `matchIndex` inside this clause. */
function isNegatedAt(clauseText, matchIndex) {
  return NEGATION_CUE.test(clauseText.slice(0, matchIndex));
}

// ---- Accent-insensitive matching -----------------------------------------
//
// Real transcripts break literal patterns like /vomit\w+/i on the plain verb
// stem "vómito" -- the tilde on "ó" means "vomit" never actually appears as a
// substring, so a very common way to say it silently matches nothing. Same
// family of bug as "empapó" or "desmayé" not matching a stem that assumes an
// unaccented ending.
//
// Fix: strip diacritics before matching, the same way rag.js already
// tokenizes documents for retrieval, so the two subsystems agree on what
// counts as the same word. Diacritics are stripped for MATCHING ONLY --
// `trigger` in a finding is sliced back out of the original clause text
// (same index, same length: stripping combining marks never changes string
// length for the accented Latin letters Spanish uses), so the audit trail
// still reads as the patient actually said it.
function stripAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const RULES = [
  {
    id: 'RED-BLEEDING',
    level: 'red',
    label: 'Sangrado activo o abundante',
    patterns: [
      { regex: /sangr\w*\s+(mucho|abundante|much[íi]simo)/i },
      { regex: /no\s+(para|deja)\s+de\s+sangrar/i, selfNegating: true },
      { regex: /empap\w+\s+\w*\s*(vend\w+|gasa|apósito|aposito)/i },
      { regex: /chorro\s+de\s+sangre/i }
    ]
  },
  {
    id: 'RED-BREATHING',
    level: 'red',
    label: 'Dificultad respiratoria o dolor torácico',
    patterns: [
      { regex: /no\s+puedo\s+respirar/i, selfNegating: true },
      { regex: /me\s+(falta|cuesta)\s+(el\s+)?air\w+/i },
      { regex: /ahog\w+/i },
      { regex: /dolor\s+en\s+el\s+pecho/i },
      { regex: /apret\w+\s+(en\s+)?el\s+pecho/i }
    ]
  },
  {
    id: 'RED-NEURO',
    level: 'red',
    label: 'Signos neurológicos',
    patterns: [
      { regex: /me\s+desmay\w+/i },
      { regex: /perd[íi]\s+el\s+conocimiento/i },
      { regex: /no\s+siento\s+(la|el)\s+\w+/i, selfNegating: true },
      { regex: /convulsion\w*/i },
      { regex: /no\s+puedo\s+(mover|hablar)/i, selfNegating: true },
      // knowledge/01-signos-de-alarma-generales.md lists confusion right
      // alongside fainting and loss of consciousness as an immediate flag --
      // it had no pattern here at all before this.
      { regex: /confund\w+/i },
      { regex: /confusion/i },
      { regex: /desorientad\w+/i }
    ]
  },
  {
    id: 'RED-FEVER-HIGH',
    level: 'red',
    label: 'Fiebre alta confirmada (38.5° o más)',
    patterns: [
      // knowledge/01 puts "fiebre igual o superior a 38.5 grados" in the
      // immediate-contact list, not the review-later one. AMBER-FEVER below
      // only ever fires amber, no matter the number -- this is the number.
      {
        regex: /(\d{2}(?:[.,]\d+)?)\s*(grados|°)/i,
        validate: match => {
          const value = parseFloat(match[1].replace(',', '.'));
          return Number.isFinite(value) && value >= 38.5;
        }
      }
    ]
  },
  {
    id: 'AMBER-FEVER',
    level: 'amber',
    label: 'Fiebre reportada',
    patterns: [
      { regex: /fiebre/i },
      { regex: /calentura/i },
      { regex: /(38|39|40)[.,]?\d*\s*(grados|°)/i },
      { regex: /me\s+hierv\w+/i },
      { regex: /destemplanza/i }
    ]
  },
  {
    id: 'AMBER-WOUND',
    level: 'amber',
    label: 'Signos locales de infección',
    patterns: [
      { regex: /pus/i },
      { regex: /mal\s+olor/i },
      { regex: /(herida|cicatriz)\s+\w*\s*(roja|caliente|hinchada|inflamada)/i },
      { regex: /supur\w+/i },
      { regex: /se\s+(abri[óo]|abrio)\s+(la\s+)?(herida|puntos)/i }
    ]
  },
  {
    id: 'AMBER-PAIN',
    level: 'amber',
    label: 'Dolor no controlado',
    patterns: [
      { regex: /dolor\s+\w*\s*(insoportable|muy\s+fuerte|terrible|10\s*de\s*10)/i },
      { regex: /(el\s+)?dolor\s+no\s+(se\s+)?(quita|calma|baja)/i, selfNegating: true },
      { regex: /ni\s+con\s+(las\s+)?pastillas/i, selfNegating: true }
    ]
  },
  {
    id: 'AMBER-VOMIT',
    level: 'amber',
    label: 'Vómito persistente o intolerancia oral',
    patterns: [
      { regex: /vomit\w+/i },
      // "no he podido" (pretérito perfecto) belongs here as much as "no
      // puedo": a real patient describing days of not eating said it that
      // way, and the rule missed it.
      { regex: /no\s+(puedo|logro|he\s+podido|he\s+logrado)\s+(comer|tomar|retener)/i, selfNegating: true },
      { regex: /devuelv\w+\s+todo/i }
    ]
  }
];

const AMBIGUOUS = [
  { id: 'CLARIFY-VAGUE', patterns: [/me\s+siento\s+(mal|raro|extra[ñn]o)/i, /no\s+estoy\s+bien/i, /algo\s+no\s+(anda|est[áa])\s+bien/i] },
  { id: 'CLARIFY-COLLOQUIAL', patterns: [/maluc\w+/i, /achac\w+/i, /jodid\w+/i, /flojera/i, /descompuest\w+/i] }
];

const LEVEL_ORDER = { none: 0, amber: 1, red: 2 };

export function assess(utterance) {
  const clauses = splitClauses(utterance).map(text => ({ text, normalized: stripAccents(text) }));
  const fired = [];

  for (const rule of RULES) {
    ruleLoop:
    for (const pattern of rule.patterns) {
      for (const clause of clauses) {
        const match = clause.normalized.match(pattern.regex);
        if (!match) continue;
        if (pattern.validate && !pattern.validate(match)) continue;
        if (!pattern.selfNegating && isNegatedAt(clause.normalized, match.index)) continue;
        const trigger = clause.text.slice(match.index, match.index + match[0].length).trim();
        fired.push({ id: rule.id, level: rule.level, label: rule.label, trigger });
        break ruleLoop;
      }
    }
  }

  const needsClarification = AMBIGUOUS.some(group =>
    group.patterns.some(pattern => pattern.test(utterance))
  );

  const level = fired.reduce(
    (worst, rule) => (LEVEL_ORDER[rule.level] > LEVEL_ORDER[worst] ? rule.level : worst),
    'none'
  );

  return {
    level,
    escalate: level === 'red',
    flagForReview: level === 'amber',
    needsClarification: needsClarification && !fired.length,
    findings: fired
  };
}

/** Merge per-utterance assessments into the state of the whole call. */
export function mergeAssessments(assessments) {
  const findings = [];
  const seen = new Set();
  let level = 'none';

  for (const assessment of assessments) {
    if (LEVEL_ORDER[assessment.level] > LEVEL_ORDER[level]) level = assessment.level;
    for (const finding of assessment.findings) {
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
  }

  return {
    level,
    escalate: level === 'red',
    flagForReview: level === 'amber',
    findings,
    disposition:
      level === 'red'
        ? 'Alertar de inmediato a personal capacitado'
        : level === 'amber'
          ? 'Revisión por enfermería dentro de las próximas horas'
          : 'Sin signos de alarma; continuar seguimiento programado'
  };
}
