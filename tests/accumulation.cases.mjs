/**
 * Casos de prueba para el escalamiento por acumulación en
 * mergeAssessments() (src/triage.js) -- decisión 6 de docs/DECISIONS.md.
 *
 * A diferencia de tests/triage.cases.mjs (una frase, un turno), cada caso
 * aquí es una llamada completa: una lista de `utterances` en orden, cada
 * una pasada por assess() y el resultado combinado con mergeAssessments().
 * Lo que se prueba es la ACUMULACIÓN -- N=2 hallazgos ámbar en dominios
 * clínicos DISTINTOS escala a rojo -- no las reglas individuales, que ya
 * tienen su propia cobertura en triage.cases.mjs.
 *
 * Formato de `expect`: igual que triage.cases.mjs, evaluado sobre el
 * resultado de mergeAssessments(), no de assess().
 */

export const cases = [
  // ---- Acumulación real: escala ---------------------------------------------
  {
    id: 'accum-fiebre-herida-01',
    category: 'acumulacion/dos-dominios',
    // Dos turnos, dos dominios distintos (fiebre, herida), ninguno rojo por
    // sí solo -- el caso que motivó todo el mecanismo (docs/evaluacion-triage.md).
    utterances: [
      'Me sentí como afiebrada, creo que como 38.',
      'Me dijeron que le está saliendo un líquido amarillo a la herida.'
    ],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-WOUND', 'RED-ACCUMULATION'] }
  },
  {
    id: 'accum-fiebre-movilidad-01',
    category: 'acumulacion/dos-dominios',
    // Reproduce, casi textual, caso_tray_pac_42_00019_7 del dataset oficial
    // (docs/DECISIONS.md, decisión 6): fiebre + movilidad, ninguno rojo por
    // sí solo, etiqueta real "rojo".
    utterances: [
      'Me he sentido como afiebrada, me tomé la temperatura y marcó 38.2.',
      'Antes me movía sola sin problema y ahora casi no puedo levantarme, necesito que alguien me ayude para todo.'
    ],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-MOBILITY', 'RED-ACCUMULATION'] }
  },
  {
    id: 'accum-tres-dominios-01',
    category: 'acumulacion/tres-dominios',
    // Tres dominios en vez de dos -- el umbral es "al menos N", no "exactamente N".
    utterances: [
      'Tengo calentura, no sé cuánto pero se siente.',
      'La herida tiene mal olor.',
      'Tengo un dolor insoportable.'
    ],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-WOUND', 'AMBER-PAIN', 'RED-ACCUMULATION'] }
  },
  {
    id: 'accum-un-turno-dos-dominios-01',
    category: 'acumulacion/mismo-turno',
    // Los dos dominios pueden venir del MISMO turno -- la cuenta es por
    // hallazgo, no por turno. Una sola frase que ya toca fiebre y herida.
    utterances: ['Tengo calentura y la herida tiene mal olor.'],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-WOUND', 'RED-ACCUMULATION'] }
  },

  // ---- No acumula: mismo dominio repetido -----------------------------------
  {
    id: 'accum-mismo-dominio-no-escala-01',
    category: 'acumulacion/mismo-dominio',
    // Dos turnos, dos MENCIONES de fiebre -- un solo dominio. No debe
    // escalar aunque haya dos hallazgos en el registro (mergeAssessments ya
    // los deduplica por id de regla, así que en la práctica queda un solo
    // AMBER-FEVER, pero el punto central es que el CONTEO DE DOMINIOS
    // distintos es 1, no 2).
    utterances: [
      'Anoche me dio fiebre.',
      'Hoy sigo con calentura, no se me quita.'
    ],
    expect: { level: 'amber', findingIds: ['AMBER-FEVER'] }
  },

  // ---- No acumula: un solo dominio ámbar ------------------------------------
  {
    id: 'accum-un-dominio-no-escala-01',
    category: 'acumulacion/un-dominio',
    utterances: [
      'La herida tiene un poco de mal olor.',
      'Por lo demás me siento bien, no tengo fiebre ni dolor fuerte.'
    ],
    expect: { level: 'amber', findingIds: ['AMBER-WOUND'] }
  },

  // ---- Ya rojo por una regla individual: no depende de acumulación ----------
  {
    id: 'accum-ya-rojo-no-duplica-01',
    category: 'acumulacion/ya-rojo',
    // Un hallazgo rojo individual (sangrado) más un ámbar de otro dominio
    // (herida): ya es rojo antes de contar dominios -- RED-ACCUMULATION no
    // debe aparecer, el rojo no necesita "ayuda" de la acumulación.
    utterances: [
      'Estoy sangrando mucho y no para.',
      'La herida también tiene mal olor.'
    ],
    expect: { level: 'red', findingIds: ['RED-BLEEDING', 'AMBER-WOUND'] }
  },

  // ---- Caso sano: nunca acumula -----------------------------------------
  {
    id: 'accum-sano-no-escala-01',
    category: 'acumulacion/sano',
    // Seis turnos, cero hallazgos -- el llamado de control negativo. Ningún
    // caso verde del dataset oficial alcanza siquiera 1 dominio ámbar, y
    // ninguno alcanza 2 (docs/DECISIONS.md, decisión 6).
    utterances: [
      'El dolor ha sido más bien un 1, apenas se nota.',
      'La temperatura ha estado cerca de 37, apenas un poquito tibia.',
      'Me muevo sin ninguna dificultad.',
      'La herida está bien, sin enrojecimiento ni nada raro.',
      'He comido normal, sin novedades.',
      'He dormido bien, tranquilo.'
    ],
    expect: { level: 'none' }
  },

  // ---- Regresión directa contra el dataset oficial --------------------------
  {
    id: 'accum-dataset-00019-7',
    category: 'acumulacion/regresion-dataset',
    // caso_tray_pac_42_00019_7, capa1_limpia, los 6 turnos de paciente
    // completos, tal como aparecen en data/dataset_final.json. Etiqueta
    // real: rojo. Antes de la acumulación (commit f7bd354), este caso
    // quedaba en verde/amarillo -- ver docs/evaluacion-triage.md.
    utterances: [
      'Buenas, mijo. El dolor lo siento en el pecho, donde la cirugía, y hoy lo sentiría como un 5, más incómodo que otros días.',
      'Sí señor, me he sentido como afiebrada, me tomé la temperatura y marcó 38.2. También he sentido un poco de escalofrío.',
      'Ay, muy mal, la verdad. Antes me movía sola sin problema y ahora casi no puedo levantarme, necesito que alguien me ayude para todo.',
      'Pues la he visto un poco enrojecida alrededor, un eritema leve como le dicen, pero no le he visto secreción ni mal olor, gracias a Dios.',
      'Ay no, casi no me provoca comer nada, se me ha ido mucho el apetito estos días, como poquito y a las fuerzas.',
      'No, mijo, he dormido muy mal, me despierto varias veces por el dolor y el malestar, casi no descanso.'
    ],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-MOBILITY', 'RED-ACCUMULATION'] }
  },
  {
    id: 'accum-dataset-00028-14',
    category: 'acumulacion/regresion-dataset',
    // caso_tray_pac_42_00028_14, capa1_limpia, texto real verificado
    // directamente contra data/dataset_final.json antes de escribir este
    // caso -- una primera versión mezclaba por error turnos de
    // caso_tray_pac_42_00028_7 (un caso distinto) y daba un dominio de más.
    // Etiqueta real: rojo.
    utterances: [
      '¡Ay, doctor, qué bueno que llama! Mire, el dolor está como en un 5, pero es que hoy amanecí con calentura también, ¿eso es normal? Estoy muy asustada, no sé qué hacer.',
      'Sí señor, me tomé la temperatura y marcó 38.1°C, y sí he sentido como escalofríos también. ¿Eso es grave, doctor? Es que también la herida se ve un poquito rojita y me tiene con los nervios de punta.',
      'Ay, doctor, eso es lo peor, casi no puedo ni levantarme sola, siento la pierna como que no responde, muy incapacitada me siento. Me da miedo caerme, ¿usted cree que eso es normal o me está pasando algo malo?',
      'Sí doctor, la veo con un enrojecimiento leve alrededor, no sale nada de líquido gracias a Dios, pero igual me preocupa muchísimo, ¿será que se me está infectando? Dígame la verdad, por favor.',
      'Ay, casi no me provoca comer nada, doctor, se me ha ido el apetito por completo, como poquito y a las fuerzas. Con tanta preocupación ni hambre me da.',
      'No, doctor, para nada, duermo muy mal, me despierto varias veces por el dolor y por los nervios, casi no descanso nada. Dígame, ¿todo esto es normal o debo preocuparme más?'
    ],
    expect: { level: 'red', findingIds: ['AMBER-FEVER', 'AMBER-MOBILITY', 'RED-ACCUMULATION'] }
  }
];
