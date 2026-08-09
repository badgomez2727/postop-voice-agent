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
// tampoco / ni / nada / sin) appears earlier in the same clause than the
// match. Position matters -- "estoy sangrando mucho y no sé por qué" must
// still escalate; the "no" there governs "por qué", not "sangrando".
//
// "nada" joined the list after evaluating against the official ground-truth
// dataset (docs/evaluacion-triage.md): "nada de esas cosas de pus" was read
// as a positive mention of pus, because the patient denies it with "nada"
// instead of "no" -- the single most common denial word in that corpus that
// this list was missing.
//
// "sin" joined after manually testing the live server: "me siento bien, sin
// fiebre ni dolor fuerte" fired AMBER-FEVER on "fiebre" -- the patient is
// denying the symptom, not reporting it. "sin embargo" doesn't collide with
// this: it's already its own clause boundary (below), consumed by
// splitClauses() before NEGATION_CUE is ever tested against what's left.
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

const NEGATION_CUE = /\b(no|nunca|jamás|jamas|tampoco|ni|nada|sin)\b/i;
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

// ---- Ajustes contra el ground truth oficial (docs/evaluacion-triage.md) --
//
// Cuatro señales que el dataset real usa constantemente y que ninguna regla
// reconocía. Cada una está acotada a lo que el caso mal clasificado
// realmente decía -- no es una generalización especulativa.

// "Marcó 38.7" / "la temperatura... 39 algo" es tan claramente una lectura
// de termómetro como "38.7 grados", pero sin "grados" ni "°" ninguna regla
// de fiebre lo reconocía. Acotado a compartir cláusula con una palabra que
// deja claro que se está hablando de temperatura -- un número de dos cifras
// solo, en cualquier otro contexto, es demasiado ambiguo (edad, día, dosis).
// No cruza cláusulas: "me la tomé... pero... 39 algo" en cláusulas
// separadas por "pero" no lo dispara -- limitación conocida, documentada en
// docs/evaluacion-triage.md, no una regresión de esta corrección.
const CONTEXTO_TEMPERATURA = /\b(temperatura|marc\w*|termometro)\b/i;

// No basta con que la palabra de contexto comparta CLÁUSULA con el número
// -- splitClauses() no corta en comas, así que una cláusula puede ser una
// frase larga entera. "Tengo 45 años y hoy me tomé la temperatura, todo
// normal" comparte cláusula sin que el 45 tenga nada que ver con la
// temperatura -- encontrado escribiendo el caso de prueba para el propio
// arreglo de "fiebre sin 'grados'" de abajo (2026-08-09), antes de que
// llegara a producción: ampliar el rango de 38-40 a 38-49 sin esto habría
// convertido "tengo 45 años" en una fiebre roja cada vez que compartiera
// cláusula con la palabra "temperatura". Exige que la palabra de contexto
// esté a un máximo de VENTANA_CONTEXTO_TEMPERATURA caracteres del número,
// en cualquier dirección (antes o después) -- suficiente para "tengo mi
// temperatura en 41" (15) y "la temperatura marcó 45" (6), no para el
// caso de la edad (25).
const VENTANA_CONTEXTO_TEMPERATURA = 20;

function contextoTemperaturaCercano(clauseText, matchIndex) {
  // Misma lista de palabras que CONTEXTO_TEMPERATURA -- reconstruida como
  // global (flag "g") porque exec() con estado propio es lo que permite
  // recorrer TODAS las coincidencias en la cláusula, no solo la primera.
  const patron = new RegExp(CONTEXTO_TEMPERATURA.source, 'gi');
  let coincidencia;
  while ((coincidencia = patron.exec(clauseText))) {
    if (Math.abs(coincidencia.index - matchIndex) <= VENTANA_CONTEXTO_TEMPERATURA) return true;
  }
  return false;
}

// Formas adjetivales de fiebre que no comparten el literal "fiebre":
// "afiebrada" cambia la última vocal por concordancia de género, así que
// /fiebre/i nunca la alcanza. "acalorada" es la forma coloquial más común
// en el dataset real para lo mismo.
const FORMA_ADJETIVAL_FIEBRE = /\b(afiebrad|acalorad)\w*\b/i;

// "confundirse"/"desorientado" aparecen en el dataset real constantemente
// como muletilla coloquial para "no recuerdo bien" -- confundirse CON los
// días, las fechas, las llamadas, o cuál cirugía fue. Ninguno de esos es el
// signo neurológico que RED-NEURO busca (alteración real del estado
// mental). Se excluye SOLO cuando el objeto trivial de la confusión está
// pegado a la palabra (mismo verbo, sin nada en medio salvo "con"/"de" y un
// artículo) -- así "está como desorientada, no sabe bien ni qué día es
// hoy" (tests/triage.cases.mjs, red-neuro-confusion-02) sigue disparando:
// "día" no está pegado a "desorientada", hay una cláusula completa en
// medio.
const OBJETO_TRIVIAL_CONFUSION = /^\s*(con\s+|de\s+)?(los?\s+|las?\s+)?(dias?|fechas?|llamadas?|cual\b|cuant[oa]s?|horas?)\b/i;

function confusionEsTrivial(match) {
  const resto = match.input.slice(match.index + match[0].length);
  return OBJETO_TRIVIAL_CONFUSION.test(resto);
}

// Mismos intensificadores que ya usa RED-BLEEDING más abajo -- comparten
// literal a propósito, no por casualidad: si el sangrado ya califica como
// rojo, el patrón amber de AMBER-WOUND no debe disparar también y duplicar
// el hallazgo en el registro (misma lógica que ya explica el comentario de
// RED-ACCUMULATION: "dos motivos para lo mismo" confunde el registro).
const SANGRADO_INTENSIFICADO =
  /sangr\w*\s+(mucho|abundante|much[íi]simo)|no\s+(para|deja)\s+de\s+sangrar|empap\w+\s+\w*\s*(vend\w+|gasa|apósito|aposito)|chorro\s+de\s+sangre/i;

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
      { regex: /me\s+(falta|cuesta)\s+(mucho\s+|un\s+poco\s+|bastante\s+)?(el\s+)?(air\w+|respirar)/i },
      { regex: /dificultad\s+(para\s+respirar|respiratoria)/i },
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
      //
      // validate: confusionEsTrivial() -- ver comentario junto a
      // OBJETO_TRIVIAL_CONFUSION arriba. Contra el ground truth oficial,
      // el 100% de los falsos positivos de RED-NEURO (15 de 15) venían de
      // estos tres patrones disparando sobre "se me confunden los días".
      { regex: /confund\w+/i, validate: match => !confusionEsTrivial(match) },
      { regex: /confusion/i, validate: match => !confusionEsTrivial(match) },
      { regex: /desorientad\w+/i, validate: match => !confusionEsTrivial(match) }
    ]
  },
  {
    // Encontrada revisando 7 llamadas reales: un paciente dijo "estoy muy
    // deprimido" y, un turno después, "sí no tengo ganas de vivir" -- el
    // sistema devolvió level: none a ambos y siguió con el guion de cierre.
    // No existía ninguna regla de dominio psicosocial. "Prioridad sobre
    // cualquier otro hallazgo" no necesita un mecanismo especial: al ser
    // nivel rojo, ya gana sobre cualquier ámbar por el orden de niveles que
    // usan assess()/mergeAssessments() -- lo que hacía falta es que la
    // regla exista.
    //
    // Tres de los siete patrones (no tengo ganas de vivir / no quiero
    // seguir / ya no aguanto más) llevan "no" como parte integral de la
    // frase de alarma, igual que "no puedo respirar" -- selfNegating: true,
    // para que un "no" suelto antes en la misma cláusula (una muletilla,
    // "no, no tengo ganas de vivir") no la suprima por accidente. Los otros
    // cuatro sí admiten negación real ("no me quiero morir" es una
    // afirmación de que NO hay riesgo, y debe respetarse como tal).
    //
    // "ya no aguanto más" también puede describir dolor físico puro ("ya no
    // aguanto más el dolor") sin ninguna intención suicida detrás -- riesgo
    // de falso positivo real, aceptado a propósito: la regla 6 de
    // CLAUDE.md pesa mucho más un riesgo psicosocial no detectado que una
    // escalada de más sobre dolor severo. Ver tests/triage.cases.mjs,
    // red-psych-dolor-severo-no-suicida-01, para el caso documentado.
    id: 'RED-PSYCH',
    level: 'red',
    domain: 'psicosocial',
    label: 'Riesgo psicosocial: ideación suicida o desesperanza',
    patterns: [
      { regex: /no\s+tengo\s+ganas\s+de\s+vivir/i, selfNegating: true },
      { regex: /no\s+quiero\s+segu\w+/i, selfNegating: true },
      { regex: /para\s+qu[eé]\s+sigo/i },
      { regex: /me\s+quiero\s+morir/i },
      { regex: /acabar\s+con\s+todo/i },
      { regex: /ya\s+no\s+aguanto\s+m[aá]s/i, selfNegating: true },
      { regex: /prefiero\s+morir\w*/i }
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
      },
      // "Me tomé la temperatura y marcó 38.7" -- mismo número, mismo umbral,
      // sin "grados". Ver CONTEXTO_TEMPERATURA arriba. Acotado al mismo
      // rango de prefijo (38/39/4x) que ya usa AMBER-FEVER más abajo, para
      // no romper el caso ya probado de que "37.8" sin la palabra "fiebre"
      // no dispara nada (tests/triage.cases.mjs, amber-fever-below-threshold-01).
      // "4x" (no solo "40"), corregido 2026-08-09: encontrado en prueba
      // manual en vivo -- "tengo mi temperatura en 41" (sin "grados") no
      // disparaba nada, level:none, mientras que la misma lectura CON
      // "grados" sí escalaba a rojo por el patrón de arriba. La misma
      // fiebre no puede depender de si el paciente dijo la palabra
      // "grados" o no. El piso en 38 se queda igual a propósito: 36/37 es
      // temperatura normal, no cuenta como fiebre.
      {
        regex: /\b((?:38|39|4\d)(?:[.,]\d+)?)\b/,
        validate: match => {
          if (!contextoTemperaturaCercano(match.input, match.index)) return false;
          const value = parseFloat(match[1].replace(',', '.'));
          return Number.isFinite(value) && value >= 38.5;
        }
      }
    ]
  },
  {
    id: 'AMBER-FEVER',
    level: 'amber',
    domain: 'fiebre',
    label: 'Fiebre reportada',
    patterns: [
      { regex: /fiebre/i },
      { regex: /calentura/i },
      { regex: /(38|39|40)[.,]?\d*\s*(grados|°)/i },
      { regex: /me\s+hierv\w+/i },
      { regex: /destemplanza/i },
      // Mismo número que RED-FEVER-HIGH, sin "grados" -- ver comentario
      // arriba. Sin el umbral de 38.5: cualquier lectura en 38/39/4x con
      // contexto de temperatura ya es "fiebre reportada", igual que ya pasa
      // hoy con el patrón de arriba cuando sí trae "grados".
      {
        regex: /\b(?:38|39|4\d)(?:[.,]\d+)?\b/,
        validate: match => contextoTemperaturaCercano(match.input, match.index)
      },
      { regex: FORMA_ADJETIVAL_FIEBRE }
    ]
  },
  {
    id: 'AMBER-WOUND',
    level: 'amber',
    domain: 'herida',
    label: 'Signos locales de infección',
    patterns: [
      { regex: /pus/i },
      { regex: /mal\s+olor/i },
      { regex: /(herida|cicatriz)\s+\w*\s*(roja|caliente|hinchada|inflamada)/i },
      { regex: /supur\w+/i },
      { regex: /se\s+(abri[óo]|abrio)\s+(la\s+)?(herida|puntos)/i },
      // "Un líquido amarillo saliendo de la herida" es clínicamente
      // equivalente a "pus" pero no comparte esa palabra -- la forma más
      // común en el dataset real de describir supuración sin el término
      // médico. validate exige "sal-" (sale/salir/saliendo) en la misma
      // cláusula para no capturar una mención de líquidos sin relación
      // (hidratación, orina) que solo coincida en color por casualidad.
      {
        regex: /liquido\w*[^.;]{0,25}?(amarill\w*|verdos\w*|purulent\w*)/i,
        validate: match => /\bsal\w*\b/i.test(match.input)
      },
      // "Estoy sangrando", a secas, sin "mucho"/"no para"/"chorro"/"empapado"
      // -- no disparaba NINGÚN hallazgo (level: 'none'), verificado contra
      // el server real el 2026-08-09. knowledge/01-signos-de-alarma-generales.md
      // solo pone en la lista de alerta inmediata el sangrado que "empapa el
      // apósito" o "no se detiene con presión" -- un sangrado reportado sin
      // esos detalles no llega literalmente a ese umbral, pero silenciarlo
      // del todo (level: none, igual que si no hubiera dicho nada) es el
      // riesgo que la regla 6 de CLAUDE.md pide evitar. Amber, no rojo: deja
      // que RED-BLEEDING (arriba) siga siendo la única puerta a rojo cuando
      // el paciente sí da un dato que lo amerita.
      // validate excluye los casos ya intensificados para no duplicar el
      // hallazgo junto con RED-BLEEDING en el mismo turno.
      {
        regex: /sangr\w*/i,
        validate: match => !SANGRADO_INTENSIFICADO.test(match.input)
      }
    ]
  },
  {
    id: 'AMBER-PAIN',
    level: 'amber',
    domain: 'dolor',
    label: 'Dolor no controlado',
    patterns: [
      { regex: /dolor\s+\w*\s*(insoportable|muy\s+fuerte|terrible|10\s*de\s*10)/i },
      // "no se ME quita" es como la mayoría de la gente lo dice en
      // realidad -- el pronombre reflexivo "se" casi nunca va solo, trae el
      // clítico de objeto indirecto (me/le/nos) pegado. El patrón original
      // solo cubría "no se quita", sin ese pronombre en medio, así que
      // nunca hizo match con la frase que su propio comentario de arriba
      // usa como ejemplo. Confirmado contra el servidor real: "el dolor no
      // se me quita con nada" no disparaba nada antes de este cambio.
      { regex: /(el\s+)?dolor\s+no\s+(se\s+)?(me|le|nos)?\s*(quita|calma|baja)/i, selfNegating: true },
      { regex: /ni\s+con\s+(las\s+)?pastillas/i, selfNegating: true }
    ]
  },
  {
    id: 'AMBER-VOMIT',
    level: 'amber',
    domain: 'via_oral',
    label: 'Vómito persistente o intolerancia oral',
    patterns: [
      { regex: /vomit\w+/i },
      // "no he podido" (pretérito perfecto) belongs here as much as "no
      // puedo": a real patient describing days of not eating said it that
      // way, and the rule missed it.
      { regex: /no\s+(puedo|logro|he\s+podido|he\s+logrado)\s+(comer|tomar|retener)/i, selfNegating: true },
      { regex: /devuelv\w+\s+todo/i }
    ]
  },
  {
    // No existía ninguna regla de movilidad antes de esto. Patrones
    // derivados de las 70 respuestas de pacientes a la pregunta de
    // movilidad en casos rojo/ámbar del dataset oficial -- no inventados.
    // De esas 70, solo 2 describen una limitación genuinamente severa; las
    // otras 68 enmarcan la lentitud o la necesidad de apoyo como esperada
    // tras la cirugía ("despacito, como es normal", "con ayuda, como
    // esperaban que fuera") y no deben disparar nada. Los patrones están
    // acotados a las frases reales de esas 2:
    //   caso_tray_pac_42_00019_7: "Antes me movía sola sin problema y ahora
    //     casi no puedo levantarme, necesito que alguien me ayude para todo."
    //   caso_tray_pac_42_00028_14: "casi no puedo ni levantarme sola, siento
    //     la pierna como que no responde, muy incapacitada me siento."
    id: 'AMBER-MOBILITY',
    level: 'amber',
    domain: 'movilidad',
    label: 'Declive funcional o de movilidad',
    patterns: [
      { regex: /no\s+puedo\s+(ni\s+)?levant\w+/i, selfNegating: true },
      { regex: /necesito\s+(que\s+)?(alguien\s+)?me\s+ayude\s+(para|con)\s+todo/i },
      { regex: /incapacitad\w*/i },
      { regex: /(pierna|brazo|mano)[^.;]{0,20}no\s+responde/i, selfNegating: true }
    ]
  },
  {
    // No hay ningun hallazgo de adherencia a medicacion en el dataset
    // oficial (assess() solo ve sintomas por turno, sin distinguir tema).
    // La pregunta guionada de medicacion sale de SCRIPT en src/llm.js
    // (docs/DECISIONS.md): 0 apariciones en 3.991 turnos reales del
    // dataset, asi que preguntar por ella sin evidencia en knowledge/
    // choca con la regla 2 de CLAUDE.md. Esta regla existe para la
    // mencion ESPONTANEA -- un paciente puede decir que no esta tomando
    // lo indicado sin que se le pregunte, y eso siguio siendo un hallazgo
    // valido aunque el guion ya no lo pida. Encontrado en pruebas
    // manuales contra el servidor real, no en el dataset oficial (que no
    // registra adherencia).
    id: 'AMBER-NONADHERENCE',
    level: 'amber',
    domain: 'medicacion',
    label: 'No adherencia a medicacion',
    patterns: [
      // "no he tomado los medicamentos" / "no estoy tomando la
      // medicacion" -- exige ancla de medicacion en la misma clausula
      // para no confundirse con hidratacion ("no estoy tomando
      // liquidos", que ya cubre AMBER-VOMIT/via_oral) ni con cualquier
      // otro "no he tomado/estoy tomando X" sin relacion.
      {
        regex: /no\s+(he\s+tomado|estoy\s+tomando)\b[^.;]{0,25}(medicament\w*|pastill\w*|medicaci[oó]n|antibi[oó]tic\w*|tratamiento)/i,
        selfNegating: true
      },
      // mismo caso, ancla antes de la negacion: "los medicamentos, no
      // los he tomado"
      {
        regex: /(medicament\w*|pastill\w*|medicaci[oó]n|antibi[oó]tic\w*|tratamiento)[^.;]{0,25}no\s+(los\s+|las\s+)?(he\s+tomado|estoy\s+tomando)/i,
        selfNegating: true
      },
      // "se me olvido la pastilla / tomarme el medicamento"
      { regex: /se\s+me\s+olvid\w+[^.;]{0,20}(pastillas?|medicamentos?|medicaci[oó]n|tomar\w*)/i },
      // "no conseguí las pastillas" -- verbo + ancla de medicacion
      // explicita en la misma clausula.
      {
        regex: /no\s+(los\s+|las\s+)?(compr[eé]\w*|consegu[ií]\w*)[^.;]{0,20}(pastillas?|medicamentos?|medicaci[oó]n|antibi[oó]tic\w*|tratamiento)/i,
        selfNegating: true
      },
      // "no los compré" -- pronombre obligatorio (no opcional): sin el,
      // "no compré" es demasiado generico y colisiona con cualquier cosa
      // que el paciente no haya comprado ("no compré pan para el
      // desayuno" disparaba esto en pruebas antes de este ajuste). El
      // pronombre inmediatamente despues de "no" es lo que ancla la
      // frase a algo ya mencionado, en vez de una compra cualquiera.
      // Riesgo residual aceptado y documentado, no eliminado: "no las
      // compré" sin más contexto puede referirse a otra cosa plural
      // femenina distinta de las pastillas -- construccion específica,
      // no una regla general de "no compré nada".
      {
        regex: /no\s+(los|las)\s+(compr[eé]\w*|consegu[ií]\w*)/i,
        selfNegating: true
      },
      // "los boté" -- ancla obligatoria via validate: "botar" solo es
      // senal de no-adherencia si el objeto botado son los medicamentos.
      {
        regex: /(los|las)\s+bot[eé]\b/i,
        validate: match => /pastill\w*|medicament\w*|medicaci[oó]n/i.test(match.input)
      },
      // "no voy a tomar" -- rechazo declarado. Se queda en ambar, no
      // rojo: acumulacion ya cubre el caso combinado con otro sintoma
      // (docs/DECISIONS.md). Un rechazo aislado sin ningun otro hallazgo
      // sigue siendo ambar -- ver DECISIONS.md para el porque.
      {
        regex: /no\s+voy\s+a\s+tom\w*[^.;]{0,20}(pastillas?|medicamentos?|medicaci[oó]n|antibi[oó]tic\w*|tratamiento)/i,
        selfNegating: true
      }
    ]
  }
];

const AMBIGUOUS = [
  { id: 'CLARIFY-VAGUE', patterns: [/me\s+siento\s+(mal|raro|extra[ñn]o)/i, /no\s+estoy\s+bien/i, /algo\s+no\s+(anda|est[áa])\s+bien/i] },
  { id: 'CLARIFY-COLLOQUIAL', patterns: [/maluc\w+/i, /achac\w+/i, /jodid\w+/i, /flojera/i, /descompuest\w+/i] }
];

// ---- Puntaje numérico de dolor (requiere contexto) ------------------------
//
// assess() no sabe qué preguntó el agente -- server.js pasa opcionalmente
// context.lastAskedTopic (el último tema cubierto en el guion, en el
// momento de este turno). Sin esto, un paciente que responde con un número
// puro a "en una escala de 0 a 10, ¿qué tan fuerte es?" no dispara ningún
// hallazgo -- AMBER-PAIN (arriba) solo reconoce palabras ("insoportable",
// el literal "10 de 10"), nunca un número suelto. Encontrado probando la
// consola en vivo (2026-08-08).
//
// Acotado a propósito: solo se lee como puntaje de dolor si la respuesta
// ES el número (con adornos mínimos -- "un 8", "8 de 10", "le doy un 9") y
// nada más. Una frase más larga que solo MENCIONA un número ("me duele
// desde hace 3 días") no debe leerse como "3 de dolor" -- el ancla ^...$
// lo impide estructuralmente, no por una lista de excepciones.
// \d+ sin tope -- el rango válido (0-10) se valida después comparando el
// número, no acotando cuántos dígitos puede escribir. Un tope aquí (ej.
// \d{1,4}) dejaría "20000" sin hacer match en absoluto -- ni como puntaje
// válido ni como fuera de rango -- exactamente el caso que esto existe
// para atrapar.
const PATRON_PUNTAJE_DOLOR_A_SOLAS =
  /^\s*(?:yo\s+)?(?:le\s+doy\s+)?(?:(?:un|el|es)\s+)*(\d+)(?:\s*(?:de\s*(?:10|dolor)|\s*\/\s*10))?\s*[.!]?\s*$/i;

// Umbral tomado literalmente de knowledge/03-manejo-del-dolor-y-medicacion.md:
// "Un dolor de 7 o más que no baja... debe reportarse para valoración."
const UMBRAL_DOLOR_AMBAR = 7;

function evaluarPuntajeDolor(utterance, context) {
  if (context?.lastAskedTopic !== 'dolor') return null;
  const match = utterance.match(PATRON_PUNTAJE_DOLOR_A_SOLAS);
  if (!match) return null;
  const score = Number(match[1]);
  // Fuera de 0-10: la escala pedida no admite ese número -- no es un
  // hallazgo clínico interpretable, es una respuesta que no encaja con lo
  // que se preguntó. needsClarification, no un nivel amber/red inventado.
  if (score > 10) return { outOfRange: true };
  if (score >= UMBRAL_DOLOR_AMBAR) {
    return {
      finding: {
        id: 'AMBER-PAIN-SCORE',
        level: 'amber',
        label: 'Dolor autorreportado en escala alta',
        domain: 'dolor',
        trigger: match[0].trim()
      }
    };
  }
  return null; // 0-6: dentro de lo esperado, sin hallazgo -- igual que AMBER-PAIN con dolor leve
}

const LEVEL_ORDER = { none: 0, amber: 1, red: 2 };

export function assess(utterance, context = {}) {
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
        fired.push({ id: rule.id, level: rule.level, label: rule.label, domain: rule.domain, trigger });
        break ruleLoop;
      }
    }
  }

  const puntajeDolor = evaluarPuntajeDolor(utterance, context);
  if (puntajeDolor?.finding) fired.push(puntajeDolor.finding);

  const needsClarification = Boolean(puntajeDolor?.outOfRange) || AMBIGUOUS.some(group =>
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

// ---- Escalamiento por acumulación (docs/DECISIONS.md, decisión 6) --------
//
// mergeAssessments() combinaba hallazgos pero nunca los sumaba -- tomaba el
// máximo y ya. Contra el ground truth oficial, varios de los 12 casos rojo
// tienen fiebre por debajo del umbral individual (38.5°) pero junto con
// dolor alto, herida con drenaje o declive de movilidad simultáneos. Su
// "rojo" viene de la combinación, no de un signo aislado -- como un sistema
// de alerta temprana clínico real, que puntúa y escala por acumulación.
//
// N=2 -- dos hallazgos ámbar en dominios clínicos DISTINTOS (no el mismo
// dominio dos veces) escalan a rojo -- no es un umbral afinado a ojo: sobre
// los 320 casos×capa del dataset oficial, NINGÚN caso verde ni amarillo
// alcanza nunca 2 dominios ámbar simultáneos; solo los rojos lo hacen (8 de
// 12). N=3 no se probó "por si acaso": se midió, y ningún caso del dataset
// -- ni siquiera los rojo -- llega nunca a 3 dominios, así que N=3 mide
// exactamente igual que no tener acumulación. Ver docs/DECISIONS.md,
// decisión 6, para la tabla completa y el riesgo de generalizar desde 320
// casos sintéticos.
const UMBRAL_ACUMULACION = 2;

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

  // El conteo de dominios es por HALLAZGO, no por turno: dos dominios
  // distintos mencionados en el mismo turno cuentan igual que en dos
  // turnos separados. Ya rojo por una regla individual no necesita
  // "ayuda" de la acumulación -- RED-ACCUMULATION nunca aparece junto a
  // un hallazgo rojo individual, sería redundante y confundiría el
  // registro (dos motivos para lo mismo).
  if (level !== 'red') {
    const dominiosAmbar = new Set(
      findings.filter(f => f.level === 'amber' && f.domain).map(f => f.domain)
    );
    if (dominiosAmbar.size >= UMBRAL_ACUMULACION) {
      level = 'red';
      findings.push({
        id: 'RED-ACCUMULATION',
        level: 'red',
        label: 'Escalamiento por acumulación de hallazgos ámbar',
        domain: null,
        trigger: `${dominiosAmbar.size} dominios: ${[...dominiosAmbar].sort().join(', ')}`
      });
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
