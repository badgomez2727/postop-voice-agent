/**
 * Casos de prueba para src/triage.js.
 *
 * Cada caso fija lo que el motor de reglas DEBE decidir para una frase dada.
 * No es un test del modelo conversacional (eso vive en src/llm.js) ni de RAG:
 * es la red de seguridad para el módulo que decide si se llama a un humano.
 *
 * Formato de `expect`:
 *   level             'none' | 'amber' | 'red'
 *   needsClarification (opcional, default false)
 *   findingIds        (opcional) lista exacta de ids de regla que deben
 *                      quedar en `findings`, sin importar el orden. Si se
 *                      omite y level es 'none', el runner exige findings
 *                      vacío.
 *
 * `escalate` y `flagForReview` no se listan aparte: se derivan de `level`
 * (red -> escalate, amber -> flagForReview) y el runner los verifica solo.
 */

export const cases = [
  // ---- RED: sangrado -----------------------------------------------------
  {
    id: 'red-bleeding-01',
    category: 'red/sangrado',
    utterance: 'Estoy sangrando muchísimo desde hace media hora.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },
  {
    id: 'red-bleeding-02',
    category: 'red/sangrado',
    utterance: 'No para de sangrar la herida por más presión que le hago.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },
  {
    id: 'red-bleeding-03',
    category: 'red/sangrado',
    utterance: 'Tengo empapada la venda de sangre, ya se me pasó a la ropa.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },
  {
    id: 'red-bleeding-04',
    category: 'red/sangrado',
    utterance: 'Me está saliendo un chorro de sangre de la herida.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },

  // ---- RED: respiración ---------------------------------------------------
  {
    id: 'red-breathing-01',
    category: 'red/respiracion',
    utterance: 'No puedo respirar bien desde hace un rato.',
    expect: { level: 'red', findingIds: ['RED-BREATHING'] }
  },
  {
    id: 'red-breathing-02',
    category: 'red/respiracion',
    utterance: 'Siento que me ahogo cuando trato de acostarme.',
    expect: { level: 'red', findingIds: ['RED-BREATHING'] }
  },
  {
    id: 'red-breathing-03',
    category: 'red/respiracion',
    utterance: 'Tengo un dolor en el pecho que no había sentido antes.',
    expect: { level: 'red', findingIds: ['RED-BREATHING'] }
  },

  // ---- RED: neurológico ----------------------------------------------------
  {
    id: 'red-neuro-01',
    category: 'red/neuro',
    utterance: 'Siento que me desmayo cada vez que me paro de la cama.',
    expect: { level: 'red', findingIds: ['RED-NEURO'] }
  },
  {
    id: 'red-neuro-02',
    category: 'red/neuro',
    utterance: 'No siento la pierna derecha desde que desperté.',
    expect: { level: 'red', findingIds: ['RED-NEURO'] }
  },
  {
    id: 'red-neuro-03',
    category: 'red/neuro',
    utterance: 'No puedo hablar bien, se me traba la lengua.',
    expect: { level: 'red', findingIds: ['RED-NEURO'] }
  },

  // ---- AMBER: fiebre --------------------------------------------------------
  {
    id: 'amber-fever-01',
    category: 'amber/fiebre',
    utterance: 'Anoche me dio fiebre y hoy sigo con calentura.',
    expect: { level: 'amber', findingIds: ['AMBER-FEVER'] }
  },
  {
    id: 'amber-fever-02',
    category: 'amber/fiebre',
    // 38.7 >= 38.5: con RED-FEVER-HIGH este caso pasa a rojo (ver
    // categoría "red/fiebre-alta" más abajo). AMBER-FEVER sigue disparando
    // también -- ambos hallazgos quedan en el registro, el nivel general lo
    // decide el más alto.
    utterance: 'Me tomé la temperatura y marcó 38.7 grados.',
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'RED-FEVER-HIGH'] }
  },

  // ---- AMBER: herida --------------------------------------------------------
  {
    id: 'amber-wound-01',
    category: 'amber/herida',
    utterance: 'La herida está roja y le está saliendo pus.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },
  {
    id: 'amber-wound-02',
    category: 'amber/herida',
    utterance: 'Creo que se abrió la herida cuando me levanté de la cama.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },

  // ---- AMBER: dolor -----------------------------------------------------
  {
    id: 'amber-pain-01',
    category: 'amber/dolor',
    utterance: 'Tengo un dolor muy fuerte que no se me quita con nada.',
    expect: { level: 'amber', findingIds: ['AMBER-PAIN'] }
  },
  {
    id: 'amber-pain-02',
    category: 'amber/dolor',
    utterance: 'El dolor no se me calma ni con las pastillas que me mandaron.',
    expect: { level: 'amber', findingIds: ['AMBER-PAIN'] }
  },

  // ---- AMBER: vómito ------------------------------------------------------
  {
    id: 'amber-vomit-01',
    category: 'amber/vomito',
    utterance: 'Llevo dos veces que vomito después de comer.',
    expect: { level: 'amber', findingIds: ['AMBER-VOMIT'] }
  },
  {
    id: 'amber-vomit-02',
    category: 'amber/vomito',
    utterance: 'No logro retener ni el agua, la devuelvo todo.',
    expect: { level: 'amber', findingIds: ['AMBER-VOMIT'] }
  },

  // ---- NONE: recuperación esperada ------------------------------------------
  {
    id: 'none-baseline-01',
    category: 'none/esperado',
    utterance: 'Me siento bien, solo un poco cansada como es normal.',
    expect: { level: 'none' }
  },
  {
    id: 'none-baseline-02',
    category: 'none/esperado',
    utterance: 'La herida tiene un poco de hinchazón leve pero nada raro.',
    expect: { level: 'none' }
  },
  {
    id: 'none-baseline-03',
    category: 'none/esperado',
    utterance: 'Ya me tomé el analgésico y el dolor bajó bastante.',
    expect: { level: 'none' }
  },

  // ---- CLARIFY: vago / ambiguo ----------------------------------------------
  {
    id: 'clarify-vague-01',
    category: 'clarify/vago',
    utterance: 'No sé qué me pasa, no estoy bien.',
    expect: { level: 'none', needsClarification: true }
  },
  {
    id: 'clarify-vague-gender-gap-01',
    category: 'clarify/vago',
    // Hallazgo aparte, no relacionado con negación: CLARIFY-VAGUE solo
    // reconoce "me siento raro/extraño" en masculino. "rara" (femenino) no
    // dispara la cláusula de aclaración hoy. Se documenta el comportamiento
    // ACTUAL a propósito -- no es el ideal clínico -- para no perder de
    // vista el gap y no regresionarlo por accidente. Ver reporte de la
    // sesión para la recomendación de arreglo (requiere aprobación aparte).
    utterance: 'Me siento rara, no sé explicarlo bien.',
    expect: { level: 'none', needsClarification: false }
  },
  {
    id: 'clarify-vague-02',
    category: 'clarify/vago',
    utterance: 'Ando maluca desde ayer en la noche.',
    expect: { level: 'none', needsClarification: true }
  },

  // ---- NEGACIÓN: casos simples (el patrón conocido a proteger) --------------
  {
    id: 'negation-simple-01',
    category: 'negacion/simple',
    utterance: 'No tengo fiebre.',
    expect: { level: 'none' }
  },
  {
    id: 'negation-simple-02',
    category: 'negacion/simple',
    utterance: 'No he vomitado en todo el día.',
    expect: { level: 'none' }
  },
  {
    id: 'negation-simple-03',
    category: 'negacion/simple',
    utterance: 'La herida no tiene mal olor ni pus.',
    expect: { level: 'none' }
  },
  {
    id: 'negation-simple-04',
    category: 'negacion/simple',
    utterance: 'No se me ha abierto la herida.',
    expect: { level: 'none' }
  },
  {
    id: 'negation-with-report-01',
    category: 'negacion/mixta',
    // Niega un síntoma pero reporta otro real en la misma frase: el hallazgo
    // real no se debe perder por estar cerca de una negación de otra cosa.
    utterance: 'No tengo fiebre, pero la herida está roja y con pus.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },
  {
    id: 'negation-before-report-01',
    category: 'negacion/mixta',
    // La negación queda ANTES del síntoma real dentro de la misma cláusula;
    // no debe "contaminar" hacia adelante lo que viene después de un punto.
    utterance: 'No he tenido fiebre. Sí me está saliendo pus de la herida.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },
  {
    id: 'negation-does-not-retroact-01',
    category: 'negacion/no-retroactiva',
    // La negación aparece DESPUÉS del síntoma real, sobre otra cosa: no debe
    // suprimir retroactivamente algo ya reportado antes en la misma cláusula.
    utterance: 'Estoy sangrando mucho y no sé por qué será.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },

  // ---- NEGACIÓN a distancia: el caso que rompe un enfoque por cláusulas ----
  {
    id: 'negation-long-distance-01',
    category: 'negacion/distancia',
    // Frase larga, con relleno y una lista negada con "ni ... ni" separada
    // por comas del "no" que la gobierna. Un split ingenuo por coma deja
    // "ni fiebre ni nada" en su propia cláusula sin negación visible, y
    // "fiebre" dispara AMBER-FEVER por error. El cierre con "aunque sí me
    // arde un poco" tampoco debe convertirse en un hallazgo: "arder" no es
    // hoy una palabra clave de ninguna regla.
    utterance:
      'pues no, la verdad desde ayer que salí no he sentido nada de eso ' +
      'que usted me dice, ni fiebre ni nada, aunque sí me arde un poco',
    expect: { level: 'none' }
  },
  {
    id: 'negation-long-distance-02',
    category: 'negacion/distancia',
    utterance:
      'no, mire, desde que llegué a la casa no he notado nada extraño, ' +
      'ni sangrado ni dolor fuerte ni nada de eso',
    expect: { level: 'none' }
  },
  {
    id: 'negation-long-distance-03',
    category: 'negacion/distancia',
    // Variante con el síntoma real después de la lista negada, separado por
    // "aunque": el hallazgo real sí debe sobrevivir.
    utterance:
      'no he tenido fiebre ni escalofríos ni nada raro, aunque la herida ' +
      'sí está roja y me está saliendo pus',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },

  // ---- Dolor por contexto (no depende de una sola palabra clave) -----------
  {
    id: 'context-pain-01',
    category: 'contexto/dolor',
    utterance: 'El dolor está en un 10 de 10, ni con las pastillas se calma.',
    expect: { level: 'amber', findingIds: ['AMBER-PAIN'] }
  },
  {
    id: 'context-pain-02',
    category: 'contexto/dolor',
    utterance: 'El dolor ya bajó a un 2, con la pastilla se me quita casi todo.',
    expect: { level: 'none' }
  },
  {
    id: 'context-pain-03',
    category: 'contexto/dolor',
    utterance: 'Aunque me duele un poco, ya lo tengo controlado con el medicamento.',
    expect: { level: 'none' }
  },

  // ---- No adherencia a la medicación ----------------------------------------
  // Gap conocido: hoy no existe ninguna regla para no-adherencia, así que
  // estos casos documentan el comportamiento ACTUAL (none) a propósito. No es
  // el resultado clínicamente ideal; es la línea base para no regresionar
  // por accidente y para decidir, con aprobación, si se agrega una regla.
  {
    id: 'non-adherence-01',
    category: 'no-adherencia',
    utterance: 'Dejé de tomarme las pastillas porque me caían mal del estómago.',
    expect: { level: 'none' }
  },
  {
    id: 'non-adherence-02',
    category: 'no-adherencia',
    utterance: 'Se me pasó la hora de la pastilla de esta mañana y no me la tomé.',
    expect: { level: 'none' }
  },

  // ---- Regionalismos colombianos --------------------------------------------
  {
    id: 'regional-01',
    category: 'regional',
    utterance: 'Me está botando un líquido con mal olor la herida.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },
  {
    id: 'regional-02',
    category: 'regional',
    utterance: 'Amanecí destemplanza, con escalofríos.',
    expect: { level: 'amber', findingIds: ['AMBER-FEVER'] }
  },
  {
    id: 'regional-03',
    category: 'regional',
    utterance: 'Estoy muy jodido del dolor, no aguanto ni echado en la cama.',
    expect: { level: 'none', needsClarification: true }
  },

  // ---- Hallazgos de la prueba en vivo del 6 de agosto ------------------
  // Salieron de una llamada real (probada por Dario en el navegador), no
  // inventados: confusión/desorientación sin regla, "vómito" con tilde sin
  // coincidencia, "no he podido comer" en pretérito perfecto sin cubrir, y
  // fiebre alta reportada que nunca escalaba a rojo.
  {
    id: 'red-neuro-confusion-01',
    category: 'red/neuro',
    // knowledge/01-signos-de-alarma-generales.md lista "confusión" junto a
    // desmayo y pérdida del conocimiento como alarma inmediata.
    utterance: 'Me siento un poco confundido y desorientado, me duele la cabeza.',
    expect: { level: 'red', findingIds: ['RED-NEURO'] }
  },
  {
    id: 'red-neuro-confusion-02',
    category: 'red/neuro',
    utterance: 'Está como desorientada, no sabe bien ni qué día es hoy.',
    expect: { level: 'red', findingIds: ['RED-NEURO'] }
  },
  {
    id: 'accent-vomit-01',
    category: 'acentos',
    // "vómito" con tilde no comparte substring literal con /vomit\w+/i.
    utterance: 'Todo lo que como lo vómito, no logro retener nada.',
    expect: { level: 'amber', findingIds: ['AMBER-VOMIT'] }
  },
  {
    id: 'accent-bleeding-01',
    category: 'acentos',
    // "empapó" (con tilde) es la conjugación más natural en primera persona
    // de lo que pasó; antes de la normalización, \w+ nunca la alcanzaba.
    utterance: 'Se me empapó la venda de sangre hace un momento.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },
  {
    id: 'vomit-perfect-tense-01',
    category: 'amber/vomito',
    utterance: 'Llevo seis días sin comer nada, no he podido comer desde la cirugía.',
    expect: { level: 'amber', findingIds: ['AMBER-VOMIT'] }
  },
  {
    id: 'red-fever-high-01',
    category: 'red/fiebre-alta',
    // El número, no solo la palabra "fiebre", es lo que dispara rojo aquí.
    utterance: 'Sí, mucha fiebre, creo que tengo 39.4 grados de temperatura.',
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'RED-FEVER-HIGH'] }
  },
  {
    id: 'red-fever-high-02',
    category: 'red/fiebre-alta',
    utterance: 'Me tomé la temperatura y marcó 50 grados.',
    expect: { level: 'red', findingIds: ['RED-FEVER-HIGH'] }
  },
  {
    id: 'amber-fever-still-amber-01',
    category: 'red/fiebre-alta',
    // Fiebre reportada sin número, o con un número por debajo del umbral:
    // sigue siendo ámbar, no rojo. El umbral es lo que cambia el nivel, no
    // la sola mención de fiebre.
    utterance: 'Creo que tengo un poco de fiebre, no me he tomado la temperatura.',
    expect: { level: 'amber', findingIds: ['AMBER-FEVER'] }
  },
  {
    id: 'amber-fever-below-threshold-01',
    category: 'red/fiebre-alta',
    // El patrón numérico de AMBER-FEVER solo reconoce números que empiezan
    // en 38/39/40 -- un 37.8 sin la palabra "fiebre" nunca ha disparado
    // nada, con o sin RED-FEVER-HIGH. Se documenta a propósito.
    utterance: 'Me tomé la temperatura y marcó 37.8 grados.',
    expect: { level: 'none' }
  },

  // ---- "sin" como negador ----------------------------------------------
  {
    id: 'negation-sin-01',
    category: 'negacion/sin',
    // Probado contra el servidor real antes de escribir el fix: "sin
    // fiebre" disparaba AMBER-FEVER sobre "fiebre" como si el paciente la
    // reportara -- NEGATION_CUE no incluía "sin", solo no/nunca/jamás/
    // tampoco/ni/nada.
    utterance: 'Me siento bien, sin fiebre ni dolor fuerte.',
    expect: { level: 'none' }
  },
  {
    id: 'negation-sin-02',
    category: 'negacion/sin',
    // "sin embargo" no debe interferir: ya es su propio límite de cláusula
    // (CLAUSE_BOUNDARY), consumido por splitClauses() antes de que
    // NEGATION_CUE se pruebe contra lo que queda.
    utterance: 'Me revisé la herida, sin embargo tiene mal olor.',
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },
  {
    id: 'negation-sin-03',
    category: 'negacion/sin',
    // "sin" en un sentido que NO niega el síntoma sino que lo intensifica
    // ("sin parar" = sin detenerse) no debe suprimir un hallazgo que
    // aparece antes en la cláusula -- isNegatedAt solo mira cués que
    // aparecen ANTES del match, y aquí "mucho" (el disparador) va antes
    // que "sin".
    utterance: 'Estoy sangrando mucho sin parar.',
    expect: { level: 'red', findingIds: ['RED-BLEEDING'] }
  },

  // ---- AMBER-PAIN: pronombre reflexivo con clítico ---------------------
  {
    id: 'amber-pain-clitic-01',
    category: 'amber/dolor',
    // El comentario junto a NEGATION_CUE usa literalmente "el dolor no se
    // me quita" como ejemplo de frase que debe disparar -- pero el patrón
    // no contemplaba el "me" entre "se" y "quita", así que esa frase
    // exacta nunca disparó nada. Confirmado contra el servidor real antes
    // del fix.
    utterance: 'El dolor no se me quita con nada.',
    expect: { level: 'amber', findingIds: ['AMBER-PAIN'] }
  },
  {
    id: 'amber-pain-clitic-02',
    category: 'amber/dolor',
    utterance: 'El dolor no se me calma ni descansando.',
    expect: { level: 'amber', findingIds: ['AMBER-PAIN'] }
  }
];
