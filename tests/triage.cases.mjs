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
  {
    id: 'red-breathing-04',
    category: 'red/respiracion',
    utterance: 'Me cuesta mucho respirar desde anoche.',
    expect: { level: 'red', findingIds: ['RED-BREATHING'] }
  },
  {
    id: 'red-breathing-05',
    category: 'red/respiracion',
    utterance: 'Tengo dificultad para respirar.',
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
    id: 'negation-simple-05',
    category: 'negacion/simple',
    utterance: 'No me cuesta nada respirar y no tengo ninguna dificultad para respirar.',
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
  // AMBER-NONADHERENCE existe desde aquí -- ámbar, dominio 'medicacion'.
  // No viene del dataset oficial (0 apariciones en 3.991 turnos reales):
  // salió de mencionar espontánea contra el servidor real. La pregunta
  // guionada de medicación salió de SCRIPT (src/llm.js) por la misma razón
  // que esta regla existe -- ver docs/DECISIONS.md.
  {
    id: 'amber-nonadherence-01-no-he-tomado',
    category: 'amber/medicacion',
    utterance: 'No he tomado los medicamentos.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-02-no-estoy-tomando',
    category: 'amber/medicacion',
    utterance: 'No estoy tomando la medicación.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-03-se-me-olvido',
    category: 'amber/medicacion',
    utterance: 'Se me olvidó la pastilla ayer.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-04-no-conseguí',
    category: 'amber/medicacion',
    utterance: 'No conseguí las pastillas.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-05-pronombre-suelto',
    category: 'amber/medicacion',
    // Pronombre obligatorio ("los"/"las" pegado a "no") es lo que ancla
    // esta frase a algo ya mencionado en la llamada -- sin él, "no compré"
    // es demasiado genérico (ver caso de ruido más abajo).
    utterance: 'No los compré.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-06-los-bote',
    category: 'amber/medicacion',
    utterance: 'Las pastillas las boté a la basura ayer.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-07-rechazo-declarado',
    category: 'amber/medicacion',
    // Rechazo declarado -- se queda en ámbar, no rojo. Aislado es
    // ambiguo (puede ser un solo medicamento con efecto secundario, no
    // abandono del tratamiento); combinado con cualquier otro hallazgo
    // ámbar, RED-ACCUMULATION ya escala esto a rojo. Ver docs/DECISIONS.md.
    utterance: 'No voy a tomar los antibióticos.',
    expect: { level: 'amber', findingIds: ['AMBER-NONADHERENCE'] }
  },
  {
    id: 'amber-nonadherence-negacion-real-01',
    category: 'amber/medicacion',
    utterance: 'Sí, estoy tomando los medicamentos como me dijeron.',
    expect: { level: 'none' }
  },
  {
    id: 'amber-nonadherence-ruido-01-no-colisiona-vomito',
    category: 'amber/medicacion',
    // Debe seguir siendo AMBER-VOMIT (vía oral), no AMBER-NONADHERENCE --
    // "no he podido tomar" es intolerancia oral, no rechazo de medicación.
    utterance: 'No he podido tomar nada de líquido, todo lo devuelvo.',
    expect: { level: 'amber', findingIds: ['AMBER-VOMIT'] }
  },
  {
    id: 'amber-nonadherence-ruido-02-no-generaliza-comprar',
    category: 'amber/medicacion',
    // Encontrado en pruebas propias antes de aplicar la regla: un primer
    // borrador dejaba el pronombre opcional y esta frase disparaba
    // AMBER-NONADHERENCE por error. Caso de regresión.
    utterance: 'No compré pan para el desayuno.',
    expect: { level: 'none' }
  },

  // Gap conocido, todavía sin cerrar después de AMBER-NONADHERENCE: verbos
  // de abandono ("dejé de tomar") y pretérito simple con pronombre antes
  // del verbo ("no me la tomé") no están en ningún patrón -- la regla se
  // acotó a las 7 formulaciones específicas pedidas al diseñarla, no a
  // toda construcción posible de no-adherencia. Documentado a propósito
  // para no regresionar por accidente; candidato a una futura ampliación
  // con aprobación explícita (regla 5 de CLAUDE.md).
  {
    id: 'non-adherence-gap-01-dejo-de-tomar',
    category: 'no-adherencia',
    utterance: 'Dejé de tomarme las pastillas porque me caían mal del estómago.',
    expect: { level: 'none' }
  },
  {
    id: 'non-adherence-gap-02-preterito-pronombre',
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
  },

  // ---- RED-PSYCH: riesgo psicosocial (ideación suicida, desesperanza) ------
  // Encontrada revisando 7 llamadas reales: "estoy muy deprimido" y luego
  // "sí no tengo ganas de vivir" dieron level: none a ambos turnos. Los 7
  // patrones son los que se identificaron en esa revisión, no inventados.
  {
    id: 'red-psych-01',
    category: 'red/psicosocial',
    utterance: 'No tengo ganas de vivir.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-02-transcripcion-real',
    category: 'red/psicosocial',
    // La frase exacta del turno que el sistema dejó pasar en la revisión.
    utterance: 'Sí, no tengo ganas de vivir.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-03',
    category: 'red/psicosocial',
    utterance: 'Me quiero morir.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-04',
    category: 'red/psicosocial',
    utterance: 'Ya no aguanto más, de verdad.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-05',
    category: 'red/psicosocial',
    utterance: 'Solo quiero acabar con todo.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-06',
    category: 'red/psicosocial',
    utterance: 'Ya para qué sigo, si nada mejora.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-07',
    category: 'red/psicosocial',
    utterance: 'La verdad prefiero morirme antes que seguir así.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-negacion-real-01',
    category: 'red/psicosocial',
    // "me quiero morir" no es selfNegating a propósito -- si el paciente lo
    // niega explícitamente, la negación es información real, no ruido, y
    // debe respetarse.
    utterance: 'No me quiero morir, gracias a Dios estoy tranquila.',
    expect: { level: 'none' }
  },
  {
    id: 'red-psych-muletilla-no-previo-01',
    category: 'red/psicosocial',
    // "no tengo ganas de vivir" SÍ es selfNegating: un "no" de muletilla
    // antes en la misma cláusula no debe suprimir el hallazgo real.
    utterance: 'No, no tengo ganas de vivir.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  },
  {
    id: 'red-psych-dolor-severo-no-suicida-01',
    category: 'red/psicosocial',
    // Riesgo de falso positivo aceptado a propósito (ver comentario junto a
    // RED-PSYCH en src/triage.js): "ya no aguanto más" puede describir
    // dolor físico puro, sin intención suicida. Se documenta el
    // comportamiento actual -- escala igual -- no se intenta distinguir los
    // dos casos con un patrón más estrecho, porque la regla 6 de CLAUDE.md
    // pesa más un riesgo psicosocial no detectado que una escalada de más
    // sobre dolor severo.
    utterance: 'El dolor está horrible, ya no aguanto más.',
    expect: { level: 'red', findingIds: ['RED-PSYCH'] }
  }
];
