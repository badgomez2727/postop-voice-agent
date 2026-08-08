# Evaluación de `src/triage.js` contra el ground truth oficial

Fecha: 2026-08-08. Corpus de evaluación: `data/dataset_final.json` +
`data/trayectorias_postop_silver.json`, 160 casos (verde:
123, amarillo: 25, rojo:
12). `src/triage.js` sin modificar.

## Metodología — qué se verificó antes de implementar

- **La etiqueta real vive en `dataset_final.json`**, no en
  `trayectorias_postop_silver.json`. Ese segundo archivo no tiene ningún
  campo de etiqueta — trae los parámetros clínicos que generaron cada caso
  (`dolor_nrs`, `fiebre_c`, `movilidad`, `herida`, `apetito`, `sueno`,
  `arquetipo_trayectoria`), no una etiqueta verde/amarillo/rojo. La etiqueta
  usada aquí es `label_ground_truth` de `dataset_final.json`, constante por
  `caso_id` (verificado en cada corrida: 0 inconsistencias).
- **Join verificado en cada corrida**, no solo a mano una vez:
  `caso_id` = `"caso_" + trayectoria_id`. Si el dataset oficial cambia de
  versión y el join se rompe, este script falla en vez de evaluar en
  silencio contra una unión incompleta.
- **`capa1_limpia` y `capa2_ruidosa` son conversaciones independientes del
  mismo caso, no la misma conversación con ruido inyectado encima.** Ambas
  capas comparten los mismos 6 turnos de paciente por caso y en general el
  mismo tema por turno, pero se generaron por separado: en `capa1_limpia`
  solo el 56% de los 160 casos sigue el orden exacto
  dolor→fiebre→movilidad→herida→apetito→sueño sin repetir ni saltar un
  tema — el resto tiene una pregunta de seguimiento sobre el mismo tema, un
  tema fuera de orden, o una pregunta de cierre no clasificable. La
  comparación capa1 vs. capa2 mide desempeño del triage en dos escenarios
  distintos del mismo caso clínico, no robustez ante ruido sobre un mismo
  texto — esa segunda medida requeriría el mismo texto con y sin ruido, que
  no es lo que hay aquí.
- **`hablante` tiene tres valores**: `agente`, `paciente`, `tercero`.
  `tercero` (interrupción de un familiar/cuidador en la llamada) se excluye
  de `assess()` — solo se evalúan los turnos de `paciente`, tal como hoy
  `server.js` solo le pasa a `assess()` lo que dice el paciente. Conteo de
  interrupciones más abajo, como material aparte para la parte
  conversacional.
- **No existe `askedAbout` en `src/triage.js`**, ni existió nunca en este
  repositorio (verificado contra `git log -p --all`: el término no aparece
  en ningún commit, y el archivo solo tiene un commit en toda su historia).
  `assess(utterance)` no tiene parámetro de contexto hoy. `assessInContextPrototype()`,
  definida en `tools/evaluar-triage.js`, es un prototipo de medición para
  decidir si vale la pena el cambio real — no vive en `src/triage.js` y no
  es el comportamiento actual del sistema (`server.js` no pasa este
  contexto a `assess()` hoy). Deriva el tema por palabra clave de la
  pregunta de agente inmediatamente anterior (no por posición fija de
  turno, por la variación de orden descrita arriba), y agrega una única
  capacidad que `assess()` no tiene: interpretar un puntaje numérico de
  dolor (umbral ≥7, tomado literalmente de
  `knowledge/03-manejo-del-dolor-y-medicacion.md`).

## Resumen ejecutivo

La métrica principal es el **recall de rojos**: de los 12 casos rojos, con
123 de 160 casos verdes (76.9%), un sistema que siempre responda "verde"
saca 76.9% de exactitud y es clínicamente inútil — la exactitud general no
es la métrica que importa aquí.

| Variante | Capa | Recall rojo | Exactitud |
|---|---|---|---|
| baseline | capa1_limpia | 6/12 (50.0%) | 123/160 (76.9%) |
| baseline | capa2_ruidosa | 4/12 (33.3%) | 120/160 (75.0%) |
| baseline | combinado | 10/24 (41.7%) | 243/320 (75.9%) |
| con contexto (prototipo) | capa1_limpia | 6/12 (50.0%) | 119/160 (74.4%) |
| con contexto (prototipo) | capa2_ruidosa | 4/12 (33.3%) | 117/160 (73.1%) |
| con contexto (prototipo) | combinado | 10/24 (41.7%) | 236/320 (73.8%) |

## Patrones de falla identificados (baseline)

Agregado por mecanismo sobre las 14 instancias
caso×capa donde el caso es rojo y el baseline no lo detecta, y las
4 donde el baseline predice rojo sin serlo.
Cada conteo se corrobora contra `assess()` real (ver `tools/evaluar-triage.js`,
`analizarPatrones`) — no es una lectura a ojo del listado de abajo, aunque
el listado permite verificar cada caso individualmente.

**Falsos negativos de rojo** (el caso es rojo, el baseline no lo detecta):
- **4 de 14** no disparan ningún hallazgo en absoluto —
  ninguna de las 6 respuestas del paciente coincide con ninguna regla, roja
  ni ámbar.
- **10 de 14** sí disparan un hallazgo ámbar (fiebre o
  herida) pero nunca escalan a rojo — el hallazgo existe pero se queda corto.
- **8 de 14** reportan un número en rango de fiebre
  (37-42) que ninguna regla reconoce como temperatura porque no va seguido
  de la palabra "grados" ni del símbolo "°" — ej. "marcó 38.2", "tenía como
  38, no sé si eso es mucho". Tanto `RED-FEVER-HIGH` como `AMBER-FEVER`
  exigen esa unidad explícita junto al número; un paciente que solo dice el
  número no la cumple.
- **4 de 14** describen fiebre con una forma
  adjetival ("afiebrada", "acalorada") que `AMBER-FEVER` no reconoce — esa
  regla busca el literal `/fiebre/i`, `/calentura/i`, `/me\s+hierv\w+/i` o
  `/destemplanza/i`, ninguno de los cuales aparece como subcadena en esas
  formas.
- Además, sin patrón automático que lo cuente: al menos dos casos
  (`caso_tray_pac_42_00026`, `caso_tray_pac_42_00028`) describen
  supuración de la herida como "líquido amarillo saliendo" / "sale un
  poquito de líquido amarillito" — clínicamente equivalente a pus, pero
  `AMBER-WOUND` solo reconoce el literal `pus`, `mal olor`, `supur\w+`, o
  herida+color/estado (roja/caliente/hinchada/inflamada), ninguno presente
  en esa frase.

**Falsos positivos de rojo** (el baseline predice rojo, el caso no lo es) —
por regla que disparó:

- `RED-NEURO`: 4 de 4

**El 100% de los falsos positivos de rojo vienen de una sola regla.**
`RED-NEURO` incluye `/confund\w+/i`, `/confusion/i` y `/desorientad\w+/i`
para capturar confusión neurológica real (signo de alarma legítimo). El
dataset la dispara sistemáticamente sobre pacientes ansiosos o mayores que
dicen "se me confunden los días" o "ya me confundo con los días" — confusión
temporal/administrativa sobre qué día es, no desorientación neurológica.
La regla no distingue las dos cosas.

## Interrupciones de tercero

**105 de 160 casos** tienen al menos una
interrupción de un tercero (familiar/cuidador) en alguna de sus capas —
siempre en `capa2_ruidosa`, nunca en `capa1_limpia`. Excluidas de
`assess()` en esta evaluación. Contenido siempre de una de tres frases de
apertura idénticas ("soy el cuidador...", "soy la hija...", "habla la
esposa..."), sin información clínica en sí mismas — el riesgo real que
representan es de distracción/desvío de la conversación, no de ocultar un
hallazgo, y es material para la parte de calidad conversacional, no para
este criterio de triage.

## Matrices de confusión — baseline (`assess()` tal como existe hoy)

### Capa 1 (limpia)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 112 | 10 | 1 |
| **amarillo** | 19 | 5 | 1 |
| **rojo** | 2 | 4 | 6 |

### Capa 2 (ruidosa)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 112 | 10 | 1 |
| **amarillo** | 20 | 4 | 1 |
| **rojo** | 2 | 6 | 4 |

### Combinado (ambas capas)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 224 | 20 | 2 |
| **amarillo** | 39 | 9 | 2 |
| **rojo** | 4 | 10 | 10 |

## Matrices de confusión — con contexto (prototipo, no producción)

### Capa 1 (limpia)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 108 | 14 | 1 |
| **amarillo** | 19 | 5 | 1 |
| **rojo** | 2 | 4 | 6 |

### Capa 2 (ruidosa)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 109 | 13 | 1 |
| **amarillo** | 20 | 4 | 1 |
| **rojo** | 2 | 6 | 4 |

### Combinado (ambas capas)
| Real \ Predicho | verde | amarillo | rojo |
|---|---|---|---|
| **verde** | 217 | 27 | 2 |
| **amarillo** | 39 | 9 | 2 |
| **rojo** | 4 | 10 | 10 |

## Dónde cambia el resultado el prototipo con contexto

Comparado contra el baseline, caso por caso (no solo el agregado de arriba):

**Mejoras** (el contexto corrige un caso que el baseline clasificaba mal):
(ninguno)


**Regresiones** (el contexto empeora un caso que el baseline clasificaba bien):
  - **caso_tray_pac_42_00010_14** / capa1_limpia — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00010_14** / capa2_ruidosa — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00011_1** / capa1_limpia — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00011_1** / capa2_ruidosa — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00023_14** / capa1_limpia — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00033_7** / capa1_limpia — real: verde, baseline: verde, con contexto: amarillo
  - **caso_tray_pac_42_00033_7** / capa2_ruidosa — real: verde, baseline: verde, con contexto: amarillo

**Cambios neutros** (cambia el nivel predicho pero ninguna de las dos variantes acierta):
(ninguno)


## Casos mal clasificados — baseline

Con el texto del paciente turno a turno (`[tema]` es el `askedAbout` derivado
para el prototipo, no algo que el baseline use), para diagnosticar.

### Capa 1 (limpia)
  - **caso_tray_pac_42_00000_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues... la verdad, diría que un 2, aunque a veces se me hace más, pero mejor hablemos de cómo ha sido su sueño, ¿no?"
      2. [fiebre] "Pues, la temperatura ha estado rondando los 37.6 grados, no sé si eso cuente como fiebre, pero la herida sigue con un leve enrojecimiento y el dolor sigue en un 2, aunque a veces parece más. ¿Y cómo ha estado su sueño últimamente?"
      3. [movilidad] "La verdad, me muevo sin mayores dificultades, aunque a veces siento un cosquilleo leve en la zona, pero mejor hablemos de cómo ha estado su apetito últimamente."
      4. [dolor] "La herida está bien, con un leve enrojecimiento, sin secreción y el dolor sigue en 2, aunque a veces parece más. Pero cuénteme, ¿cómo ha estado su apetito últimamente?"
      5. [apetito] "Pues, la verdad, he notado que el apetito está un poquito bajo, pero mejor hablemos de cómo ha estado su sueño últimamente, ¿no?"
      6. [sueno] "El sueño ha estado bastante normal, aunque a veces me cuesta un poco conciliarlo, pero cuénteme, ¿cómo ha estado su apetito últimamente?"

  - **caso_tray_pac_42_00001_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, pues... más o menos, ahí normal digamos. Oiga, ¿usted sabe si es normal no poder dormir bien después de estas cirugías?"
      2. [fiebre] "Pues no sé, no me he tomado la temperatura muy seguido... a veces siento como un calorcito, pero no sé si es de la casa o qué. ¿Usted cree que eso es raro?"
      3. [movilidad] "No, para caminar sí me muevo bien, ahí voy normal. Lo que más me tiene aporriado es que no logro dormir bien, doctor."
      4. [herida] "La herida la veo normal, ahí tranquila. Pero de verdad lo que más me preocupa es el sueño, casi no pego el ojo en toda la noche."
      5. [apetito] "Ah el apetito bien, como normal, sin problema. Pero oiga, ¿usted no me puede recomendar algo para el dolor y para poder dormir? Eso sí me tiene mal."
      6. [dolor] "Pues casi nada, doctor, me la paso dando vueltas toda la noche, el dolor como que se siente más cuando estoy acostado y no me deja pegar el ojo."

  - **caso_tray_pac_42_00002_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolor de un 3, ahí en la zona de la operación. Pero dígame, ¿eso es normal? Me preocupa que se me vaya a complicar algo."
      2. [fiebre] "Sí señor, me la tomé y marcó 37.3°C... ¿eso ya es fiebre, doctor? Es que yo he escuchado que después de una cirugía cualquier cosita puede ser peligrosa, ¿usted cree que está bien eso?"
      3. [movilidad] "Pues me muevo despacito, como es de esperarse por la operación, pero sí me cuesta un poco más de lo normal... ¿eso está bien, doctor, o debería poder moverme más rápido? Me da miedo hacer algo mal y lastimarme por dentro."
      4. [herida] "La he visto normal, doctor, sin enrojecimiento ni nada raro, ni sale nada de ahí... pero igual la miro con mucho cuidado varias veces al día porque me da pánico que se me vaya a infectar. ¿Usted cree que así como la describo está bien?"
      5. [apetito] "Sí doctor, gracias a Dios el apetito lo tengo normal, como bien... pero ¿no será que debería comer menos por la operación? Ay, uno con tantas dudas, discúlpeme que le pregunte tanto."
      6. [sueno] "He dormido bien, normal, doctor... pero ¿será que eso es buena señal? Ay, perdone que le pregunte tanto, es que estoy muy nerviosa con toda esta recuperación."

  - **caso_tray_pac_42_00003_3** / capa1_limpia — real: **amarillo**, predicho: **rojo**
    Hallazgos: RED-NEURO ("confundida")
      1. [dolor] "¿Ah? Perdón, ¿desde la cirugía de qué día, mija? Ay, espere... yo diría que un cinco, más o menos, pero ya no me acuerdo si fue ayer o antier que estuvo peor."
      2. [fiebre] "Ay sí... espere, ¿me pregunta de hoy o de anoche? Creo que anoche me sentí como calientica, tenía por ahí 37 y pico, pero no sé si eso es mucho o no."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, normal, como siempre... bueno, no como siempre, sino como debe ser después de la operación, ¿sí me entiende? No he tenido problema pa' moverme, gracias a Dios."
      4. [herida] "Ay, sí, la vi como un poquito rojita ahí alrededor, pero no le he visto que le salga nada raro ni huele mal, no señor... digo, no señorita. Eso sí me tiene un poco confundida si es normal o no."
      5. [apetito] "Pues... no sé, un poquito menos que antes, como que no me provoca mucho la comida, pero de vez en cuando sí como algo. No sé si es por las pastillas o qué será."
      6. [sueno] "Ay no, eso sí ha sido muy difícil, casi no duermo, me despierto a cada rato y no sé ni qué hora es cuando abro los ojos. Muy alterado el sueño, sí señora."

  - **caso_tray_pac_42_00003_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, muy amable. Pues hoy lo he sentido como en un 6, algo fuerte, especialmente cuando me muevo un poquito más de la cuenta."
      2. [dolor] "Sí señor, me la tomé y estaba en 37.6, así como calientica pero sin llegar a escalofríos ni nada de eso."
      3. [movilidad] "Para eso sí me he sentido bien, la movilidad la he notado normal, me levanto y camino sin mayor problema."
      4. [herida] "No, la herida la he visto normal, sin enrojecimiento ni hinchazón ni nada saliendo, gracias a Dios."
      5. [apetito] "Pues el apetito lo he notado un poquito bajo, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Ay, el sueño sí lo he tenido bien alterado, me despierto varias veces por el dolor y luego no logro volver a dormir fácil."

  - **caso_tray_pac_42_00006_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues ahí normal, nada del otro mundo. Un dolorcito en la zona de la herida, será como un 5, pero eso es de esperarse, ¿no?"
      2. [dolor] "Me la tomé ahora y marcó como 37.4, casi nada. Escalofríos no, eso sí no."
      3. [movilidad] "Eso sí bien, camino normal, me levanto solo sin problema, ahí no tengo queja."
      4. [herida] "La herida se ve bien, normal, sin enrojecimiento ni nada raro saliendo. Ahí tranquilo con eso."
      5. [apetito] "Pues la verdad es que no me ha dado mucha hambre, casi no como, pero eso debe ser normal después de la operación, no le pare muchas bolas a eso."
      6. [sueno] "He dormido bien, sin problema, ahí descansando normal."

  - **caso_tray_pac_42_00006_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, disculpe, ¿qué día es hoy? Es que me hago bolas con las fechas... el dolor, mmm, no sé, como un 2 tal vez, ahí manejable, no es mucho."
      2. [fiebre] "Eh... creo que me la tomé ayer, o antes de ayer, no sé bien, y marcó como 37 y algo, no tan alta. No he sentido escalofríos, solo un calorcito raro a veces."
      3. [movilidad] "Sí, camino normal, no batallo pa' moverme... espere, ¿usted me preguntó por lo mismo la semana pasada? Es que ya perdí la cuenta de cuántos días llevo así."
      4. [herida] "Ah sí, la miré hace un rato... está como rojita alrededor, un poquito no más, no sé si es normal o qué. No he visto que salga nada raro, solo eso rojito."
      5. [apetito] "Pues como menos que antes, se me quita el hambre rapidito... no sé si es por los nervios o qué, se me olvida hasta si almorcé."
      6. [sueno] "Ay no, duermo muy mal, me despierto varias veces y no sé ni qué hora es cuando abro los ojos... eso sí me tiene como aturdido."

  - **caso_tray_pac_42_00007_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, doctor, pues así como leve, un 2 de 10 más o menos... pero ¿eso es normal? ¿No debería estar sintiendo más dolor a estas alturas? Me preocupa que no sea suficiente el que siento."
      2. [dolor] "Sí señor, me la tomé hace un rato y marcó como 36.8°C... ¿eso está bien? Ay es que yo leí por ahí que después de una cirugía puede dar fiebre de un momentico a otro y eso me tiene asustada, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues doctor, la verdad me cuesta un poquito moverme, como es apenas el primer día pues siento que todo el cuerpo está más pesado... pero ¿eso es lo esperado? ¿No será que me estoy quedando muy quieta y me puede hacer daño?"
      4. [herida] "La he visto normalita doctor, sin enrojecimiento ni nada raro, ni mal olor... pero es que no sé bien cómo revisarla, ¿usted cree que la estoy viendo bien? Me da miedo no darme cuenta si algo anda mal."
      5. [apetito] "Pues doctor, la verdad he comido un poquito menos de lo normal, como que no me da mucha hambre... ¿eso es preocupante? ¿No será que necesito comer más para recuperarme bien?"
      6. [sueno] "He dormido bien normalito doctor, sin problema para dormir... pero dígame, ¿todo lo que le he contado está bien? ¡Es que me tiene con los nervios de punta pensar que algo pueda estar mal!"

  - **caso_tray_pac_42_00010_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí voy tirando. ¿Usted cómo me nota la voz?"
      2. [fiebre] "Pues no le he puesto mucho cuidado a eso, la verdad... a veces siento como calorcito pero no sé si es del clima o qué. ¿Usted cree que eso es normal?"
      3. [movilidad] "Ah, eso sí, para caminar no me quejo, me muevo normal. Oiga, ¿y usted sabe si esto de la operación deja secuelas a largo plazo?"
      4. [herida] "Uy pues no le he mirado mucho, la verdad me da como cositas verla... pero creo que la he visto un poco rojita ahí alrededor, no sé si es normal eso."
      5. [apetito] "Pues casi no me da hambre, la verdad, como poquito... pero eso es normal después de la operación, ¿no? ¿Usted qué opina?"
      6. [sueno] "Ah, dormir sí duermo bien, eso no es problema. Oiga, ¿ya casi terminamos? Es que me tengo que ir a hacer una vuelta."

  - **caso_tray_pac_42_00012_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Cómo así, hoy es el día... tres? Ay perdón, es que se me revuelven los días. El dolor está por acá en la barriga, como un 6, pero no sé si era peor ayer o antier, no me acuerdo bien."
      2. [fiebre] "No, calentura no, creo que me tomé la temperatura hoy y estaba normalita, como 36 y algo... pero no me acuerdo si fue hoy o ayer que me la tomé."
      3. [movilidad] "Pues me muevo despacito, con ayuda, como esperaban que fuera... aunque a veces se me olvida si ya me levanté hoy o si eso fue ayer, discúlpeme."
      4. [herida] "Sí, la he visto un poquito rojita alrededor, pero no le sale nada raro ni huele feo, creo... ay no sé si eso lo vi hoy o ayer, perdóneme."
      5. [apetito] "He comido normal, gracias a Dios, aunque no sé si eso fue en el almuerzo de hoy o el de ayer, ya ni sé qué día es."
      6. [sueno] "Ay, dormir casi nada, me despierto mucho por el dolor y no sé ni cuántas veces, todo revuelto en la cabeza, discúlpeme."

  - **caso_tray_pac_42_00012_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento en la zona de la herida, ahí en el abdomen. Ahorita estaría como en un 4, se siente más que todo cuando me muevo o me río."
      2. [fiebre] "Sí, señor, ayer me la tomé y estaba en 37,9°C, así como febrecita leve, nada muy alto pero sí lo he notado."
      3. [movilidad] "Pues me cuesta un poco, doctor, como es normal a estos días de la cirugía. Camino despacito, con apoyo, pero no me quedo quieta, trato de moverme aunque sea poquito."
      4. [herida] "Sí, le he visto un poco de enrojecimiento alrededor, así como un rojito leve, pero no le ha salido ningún líquido raro ni nada que huela mal. No la veo hinchada tampoco."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer mucho, pero sí como aunque sea poquitas cantidades varias veces al día."
      6. [sueno] "Pues duermo, pero no tan seguido como antes, me despierto varias veces en la noche, será por la molestia o por estar pendiente de la posición. Pero algo de sueño sí logro conciliar."

  - **caso_tray_pac_42_00013_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Pues mire, el dolor lo siento en la cadera, algo así como un 3 de 10. Es soportable, no es nada muy fuerte."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcaba 37.6, como una calentura leve, pero escalofríos no he sentido."
      3. [movilidad] "Pues me muevo despacito, con el andador, como es de esperarse después de la operación. No ha sido fácil pero voy avanzando poquito a poco."
      4. [herida] "La he visto normal, sin enrojecimiento ni nada raro saliendo, solo con su vendaje como debe estar."
      5. [apetito] "Sí, gracias a Dios el apetito lo tengo normal, como bien mis comiditas sin problema."
      6. [sueno] "He dormido bien, gracias a Dios, sin despertarme mucho durante la noche."

  - **caso_tray_pac_42_00013_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Hola, buenas, gracias por llamar. Pues el dolor lo siento como en un 5, algo molesto pero soportable."
      2. [fiebre] "Sí me la he tomado, hoy marcó 37.1, así que no ha sido fiebre alta, solo un poquito tibia me sentí."
      3. [movilidad] "Ay sí, gracias a Dios me he podido mover bien, camino normal con el andador que me dieron, sin mayor problema."
      4. [herida] "Pues la he visto con un poquito de rojito alrededor, leve nada más, sin hinchazón fuerte ni nada que le salga a la herida."
      5. [apetito] "Sí señora, el apetito lo tengo normal, como bien mis tres comidas sin problema."
      6. [sueno] "Pues no he dormido tan bien como antes, me despierto un poquito por el dolor, pero logro descansar algo."

  - **caso_tray_pac_42_00013_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, pues... ahí vamos, más o menos bien, gracias a Dios. Oiga, ¿usted sabe si hoy está haciendo mucho sol allá afuera?"
      2. [dolor] "Pues, calentura calentura no sé, uno a veces siente calorcito pero eso es normal a esta edad, ¿no le parece? Oiga, ¿y usted de dónde me llama, de la clínica misma o de otra parte?"
      3. [movilidad] "Ay, pues ahí voy caminando poquito a poquito, nada grave. ¿Usted ha probado esas cremas que dan ahora para las rodillas, serán buenas?"
      4. [herida] "Uy, la herida... pues normal, no le he mirado mucho la verdad. ¿Usted cree que ya casi es hora de almorzar? Es que se me está pasando el hambre."
      5. [apetito] "Ay pues sí, como normal, gracias a Dios no me falta el hambre. Oiga, ¿y usted no sabe si va a llover hoy? Es que quiero salir al patio un rato."
      6. [sueno] "Ah, duermo bien, gracias a Dios, como un bebé casi. Bueno mijo, ¿ya casi terminamos? Es que se me está enfriando el caldo."

  - **caso_tray_pac_42_00015_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, ha sido nada del otro mundo, un dolorcito ahí en la herida, como un 4 tal vez, pero es soportable."
      2. [fiebre] "Sí, me la tomé y estaba normalita, como en 37, nada de fiebre ni escalofríos, todo bien por ese lado."
      3. [movilidad] "Pues me muevo despacito, obvio, uno recién operado no va a andar corriendo, pero nada grave, ahí voy caminando poquito a poquito."
      4. [herida] "Se ve un poquito rojita ahí alrededor, pero nada de hinchazón ni de esas cosas raras que salgan, yo creo que es normal de la cicatrización."
      5. [apetito] "Como un poquito menos que antes, pero como, no crea, no es que no me provoque nada, solo un poco más despacio con la comida."
      6. [sueno] "Pues no he dormido muy bien, la verdad, me despierto varias veces, pero eso es normal después de una operación, no le pare muchas bolas a eso."

  - **caso_tray_pac_42_00016_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, es que no sé bien! Yo creo que un 5, pero es que me preocupa muchísimo, ¿eso es normal o me tengo que asustar? Dígame que no es grave, por favor."
      2. [fiebre] "No, no he sentido escalofríos ni nada así, me tomé la temperatura hace un rato y marcó 36.5, ¿eso está bien, verdad? Ay pero es que igual me preocupa, uno nunca sabe con estas cosas."
      3. [movilidad] "Ay pues me cuesta un poquito, doctor, como es apenas el primer día uno se siente todo entumido, pero camino despacito. ¿Eso es lo esperado o debería ya moverme más rápido? Es que me da miedo hacerme daño."
      4. [herida] "Ay doctor, sí noté como un poquito de rojito alrededor, pero no sale nada raro ni huele mal. ¿Eso es normal o me tengo que preocupar? Es que verla así me pone los nervios de punta."
      5. [apetito] "Pues fíjese que he comido normal, gracias a Dios, no he perdido el apetito. Pero bueno, ¿eso está bien también? Es que con todo lo demás uno ya no sabe qué esperar."
      6. [sueno] "He dormido bien, la verdad, casi normal. Pero doctor, dígame ya, ¿todo esto que le conté está bien o me tengo que preocupar por algo? Es que la ansiedad no me deja tranquila."

  - **caso_tray_pac_42_00017_7** / capa1_limpia — real: **rojo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila doctora, un poquito molesto no más, nada del otro mundo, uno aguanta."
      2. [fiebre] "Sí, me tomé la temperatura ayer, marcó como 37 y algo, nada de escalofríos ni cosas raras, tranquila."
      3. [movilidad] "Pues despacito, como es normal después de esto, pero me muevo, no crea que estoy tan mal."
      4. [herida] "Se ve un poquito rojita ahí en el borde, pero nada de esas cosas de pus ni nada raro, yo creo que es normal de la cicatrización, doctora."
      5. [apetito] "Pues como poquito, se me ha quitado un poco las ganas, pero algo paso, no se preocupe, eso ya va a mejorar."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces, pero uno ya sabe que después de una operación así es normal, no es nada grave."

  - **caso_tray_pac_42_00019_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí vamos. No sé, un poquito, no me gusta poner números a eso, ¿usted sabe?"
      2. [dolor] "Ay no sé, doctor... he sentido como un calorcito raro pero no le he puesto el termómetro bien, tal vez es del clima aquí de Bogotá."
      3. [movilidad] "Pues ahí voy despacito, hija, uno a esta edad ya no es tan ligero... ¿y usted cómo ha estado con el trabajo, mucho ajetreo?"
      4. [herida] "Ay pues no la he mirado mucho, me da como cosita verla... la enfermera me la curó ayer y dijo algo pero no le puse mucho cuidado."
      5. [apetito] "Ay, la comida... no sé, no me provoca mucho, todo me sabe raro. Pero bueno, ¿usted no me iba a preguntar sobre el sueño también?"
      6. [sueno] "Ay, hija, esas noches larguísimas, uno da vueltas y vueltas... pero no quiero quitarle más tiempo, ¿ya casi terminamos?"

  - **caso_tray_pac_42_00019_14** / capa1_limpia — real: **rojo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, ¿cómo así, mija? Espere... ¿la cirugía fue el jueves o fue la otra semana? Es que el dolor lo siento como un 6, ahí en el pecho, pero se me confunden los días."
      2. [fiebre] "Ay sí, creo que sí... me sentí como con mucho calor anoche, toda sudada, y frío al mismo tiempo, qué raro. No sé si me la tomé o fue mi hija, pero me acuerdo un número como... ¿39 algo? No estoy segura, mija."
      3. [movilidad] "Pues... uy, me cuesta un poco, mija, me siento como pesada, despacito me muevo, no sé si es normal o no a estos días... ¿usted sabe cuántos días llevo ya? Se me pierden las cuentas."
      4. [herida] "Ay, la miré ayer o antier, no sé bien... la vi como rojita, un poquito, alrededor mija, pero no le vi que saliera nada raro ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, mija, casi no me provoca comer, todo me da como asco o pereza, apenas unas cucharaditas de sopa y ya. Mi hija se preocupa porque no como casi nada."
      6. [sueno] "Ay no, casi no duermo, mija, me despierto sudada y con dolor, y no sé si es de noche o de día a veces, todo se me revuelve."

  - **caso_tray_pac_42_00021_3** / capa1_limpia — real: **verde**, predicho: **rojo**
    Hallazgos: RED-NEURO ("confusión")
      1. [dolor] "Ay, disculpe, ¿me repite la pregunta? Es que no recuerdo bien si fue ayer o hace tres días la operación... el dolor está como en un 2, algo así, ahí por la barriga."
      2. [dolor] "Eh... creo que me la tomé, sí, marcó como 37, algo normal creo... pero no sé si fue hoy o ayer, se me pierden los días, disculpe."
      3. [movilidad] "Pues me muevo despacito, como esperaba después de la operación, un poco limitado pero nada raro... ¿usted me preguntó si eso era ayer o hoy? Ya no sé bien."
      4. [herida] "La herida la he visto normal, sin nada raro, ni rojo ni con esas cosas que dice... aunque ya no me acuerdo si me la revisé hoy o ayer, perdone."
      5. [apetito] "El apetito lo he sentido normal, como siempre, no le he hallado problema... aunque no recuerdo si ayer comí bien o fue antier, se me revuelven los días."
      6. [dolor] "He dormido normal, bien, sin problema... creo que fueron dos noches así, o tres, ya perdí la cuenta, disculpe la confusión."

  - **caso_tray_pac_42_00021_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento ahí en la zona donde me operaron, en el abdomen. Ahorita como en un 5, va y viene, sobre todo cuando me muevo o me río."
      2. [fiebre] "Sí señora, me tomé la temperatura hace ratico y estaba en 37.5, como febrícula. Escalofríos fuertes no, pero sí me he sentido un poco más caliente de lo normal."
      3. [movilidad] "Pues me muevo, pero despacio, como es de esperarse a estos días de la cirugía. Levantarme de la cama o del sofá sí me cuesta un poco más de lo normal."
      4. [herida] "Sí, la he estado revisando, y tiene un enrojecimiento leve alrededor de la incisión. No hay secreción ni mal olor, gracias a Dios, pero ese rojito me tiene un poco pendiente."
      5. [apetito] "Pues el apetito lo tengo un poco bajo, como que no me provoca comer igual que antes, pero de todas maneras algo como. No es que no coma nada, pero sí menos cantidad."
      6. [sueno] "Ay, el sueño sí lo tengo bastante alterado, me despierto varias veces en la noche por el dolor y me cuesta volver a dormirme, así que descanso poquito."

  - **caso_tray_pac_42_00025_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, gracias a Dios por llamar! El dolor está como en un 3, ahí en la herida... pero ¿eso es normal? ¿o debería preocuparme?"
      2. [fiebre] "Sí me tomé la temperatura hace un rato y marcó 37, ¿eso está bien verdad? Ay es que no he sentido escalofríos pero igual me da nervios, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues me muevo despacito, todavía me cuesta un poco, como es de esperarse después de la operación... pero ¿eso es normal doctor? ¿o ya debería estar caminando mejor a estos días?"
      4. [herida] "Ay doctor, sí noté como un poquito rojito alrededor, no sale nada raro ni huele mal, pero ese rojito me tiene asustado... ¿eso es grave? ¿debo ir a urgencias ya?"
      5. [apetito] "La verdad casi no me ha dado hambre, doctor, como muy poquito... ¿eso también es normal o me tengo que preocupar? Es que ni ganas de comer me dan."
      6. [dolor] "Pues casi no duermo bien, doctor, me despierto varias veces en la noche, no sé si es el dolor o los nervios... ¿usted cree que eso está afectando mi recuperación?"

  - **caso_tray_pac_42_00026_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay doctor, gracias a Dios que llama! Es que el dolor ha estado como en un 4, no sé si es normal, a veces siento que aumenta un poquito y me asusto mucho... ¿usted cree que está bien así o debería preocuparme?"
      2. [fiebre] "Sí señora, me tomé la temperatura y marcó 37.6°C, ¡y eso me tiene con los nervios de punta! ¿Eso ya es fiebre? Dígame la verdad, por favor, porque yo leí por ahí que eso puede ser peligroso."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, me muevo normal, sin problema... pero es que me preocupa que igual con este dolorcito algo ande mal por dentro, ¿usted no cree?"
      4. [herida] "No doctor, la herida se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo tocarla mucho, ¿será que puede empeorar si la reviso a cada rato?"
      5. [apetito] "Pues la verdad he comido menos de lo normal, como que no me provoca mucho... ¿eso es malo doctor? Es que con tanta preocupación se me quita hasta el hambre."
      6. [dolor] "Ay doctor, el sueño ha sido lo peor, casi no duermo, me despierto asustada pensando en el dolor y en si todo va bien... ¡dígame que esto es normal, por favor!"

  - **caso_tray_pac_42_00026_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay, pues... más o menos, ahí voy sobreviviendo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Uy, no sé, no le he puesto mucho cuidado a eso... aunque sí me he sentido como acalorada a ratos. ¿Usted cree que eso es normal después de la cirugía?"
      3. [movilidad] "Ah, eso sí, camino normal, no hay problema con eso... oiga, ¿usted sabe si esta llamada dura mucho? Es que tengo algo pendiente ahorita."
      4. [herida] "Pues... la he mirado poquito, no me gusta verla mucho. Se ve como un poquito rojita, pero nada más, creo... ¿eso es grave o qué?"
      5. [apetito] "Ay pues, no como casi nada, se me quita el hambre rapidito... pero bueno, eso a veces pasa, ¿no? ¿Usted cree que es por los nervios o algo así?"
      6. [sueno] "Ush, dormir casi nada, doctor... me la paso dando vueltas toda la noche. Pero bueno, ya se me pasará, ¿verdad? ¿Usted cree que esto es normal?"

  - **caso_tray_pac_42_00027_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Ah? Perdón... ¿cirugía dice? Ay, espere... el dolor por ahí lo siento leve, como un 3, aquí en la barriga... o eso creo, ya ni me acuerdo qué día es hoy."
      2. [fiebre] "Mmm, temperatura... creo que sí me la tomaron, marcó como 37, algo así normalito... pero no sé si fue hoy o ayer, todo se me revuelve."
      3. [movilidad] "Uy, moverme... sí, camino normal, sin problema, no me duele para eso... creo. ¿Ya le dije eso o me está preguntando otra vez?"
      4. [herida] "Ay, la herida... la vi como un poquito rojita, así levecito nada más, no le vi que botara nada raro... o eso me pareció, ya no sé si fue hoy que la miré."
      5. [apetito] "Ay no, casi no me da hambre, doctor... como poquitico, todo se me revuelve, ni ganas de comer tengo."
      6. [sueno] "Uy, dormir no, casi nada... me despierto a cada rato, no sé si por el dolor o por los ruidos, todo revuelto ahí en la noche, doctor."

  - **caso_tray_pac_42_00027_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, no, más o menos no más, un dolorcito ahí normal de la operación, nada del otro mundo. Si acaso un 6, pero eso ya se me pasa solo, no se preocupe."
      2. [dolor] "Pues sí me he sentido como con un poco de calorcito, pero nada de escalofríos ni nada raro. Me tomé la temperatura y salió como en 38, pero eso debe ser del calor de acá no más, doctor."
      3. [movilidad] "Ay, pues ahí vamos despacito, un poco más difícil de lo normal para levantarme, pero eso es normal después de la operación, no es nada grave. Ya me acostumbro poco a poco, no se preocupe."
      4. [herida] "La veo bien, doctor, tal vez un poquito rojita ahí en un lado, pero nada de esas cosas raras, ni pus ni nada de eso. Yo creo que eso es normal de la cicatrización, no más."
      5. [apetito] "Pues no como mucho, se me ha quitado un poco las ganas, pero eso es normal, doctor, con la operación uno no tiene mucha hambre. Náuseas no, gracias a Dios, nada de eso."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces en la noche, pero eso es normal por la incomodidad no más, nada grave doctor, ya me acostumbro."

  - **caso_tray_pac_42_00028_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, un dolorcito no más ahí en la cadera, como un 4 tal vez, pero eso es normal, uno aguanta."
      2. [dolor] "Sí señora, me la tomé y marcó como 37.3, casi nada, ni se siente uno mal ni nada de eso."
      3. [movilidad] "Pues ahí voy despacito, con la ayuda del andador, apenas es el primer día pues es normal que uno esté un poco tieso, nada grave."
      4. [herida] "Se ve un poquito rojita ahí alrededor, nada de esas cosas raras que salen, ni pus ni nada, capaz es normal de la cirugía no más."
      5. [apetito] "Ay pues casi no me provoca comer, pero eso es normal con tanto medicamento, no me preocupo por eso, algo como paso."
      6. [sueno] "Pues me despierto un poquito por la molestia, pero duermo mis horitas, no es nada de qué alarmarse, tranquila."

  - **caso_tray_pac_42_00028_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, ¿cómo así, perdone? ¿Me pregunta de hoy o de cuando me operaron... eso fue el lunes o el martes? Ahorita siento como un tres, por ahí en la cadera... o la rodilla, ya se me confunde cuál fue."
      2. [fiebre] "Mmm, fiebre no sé... me tomaron la temperatura hace un rato y creo que estaba normal, como en 37, pero no me acuerdo si fue hoy o ayer. Escalofríos no he sentido, eso sí se lo puedo asegurar."
      3. [movilidad] "Sí, más o menos bien, doctor... digo, señorita. Me levanto de la cama sin mucho problema, camino con el andador o lo que me dieron ahí, no me acuerdo cómo se llama, pero sí me muevo normal."
      4. [herida] "La herida... la vi esta mañana cuando me la revisó la enfermera, o fue ayer, no sé, pero se veía normal, sin nada raro, ni rojo ni con esos líquidos feos. No huele mal tampoco, eso sí me acuerdo."
      5. [apetito] "Ay, es que no tengo casi ganas de comer, señorita... me traen la bandeja y como poquito, no sé si es por los medicamentos o qué. Náuseas no, pero la comida no me provoca casi nada."
      6. [dolor] "Duermo por ratos, señorita, me despierto y no sé si es por el dolor o porque ya me acostumbré a otro horario en el hospital... pero no es que sea muy grave, así como que me despierto y ya."

  - **caso_tray_pac_42_00029_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, el dolor ha estado bastante manejable, como en un 2 de 10. Lo siento en la zona de la herida, pero es más una molestia que un dolor fuerte."
      2. [fiebre] "Sí, me la tomé hoy y marcó 37.4°C, como una febrícula leve, pero no me he sentido con escalofríos ni nada raro."
      3. [movilidad] "Sí, la movilidad la tengo normal, me levanto y camino sin problema, eso sí lo he podido hacer bien."
      4. [herida] "Le noto un poco de enrojecimiento leve alrededor de la herida, pero no he visto hinchazón fuerte ni secreción, nada de pus ni nada así."
      5. [apetito] "Pues la verdad el apetito lo tengo bastante disminuido, casi no me provoca comer, como poquito y a veces me toca obligarme."
      6. [sueno] "El sueño lo he tenido muy alterado, me despierto varias veces en la noche y me cuesta volver a conciliar el sueño."

  - **caso_tray_pac_42_00030_7** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay pues... más o menos, ahí normal, como uno se siente después de esas cosas. ¿Usted qué comió hoy?"
      2. [dolor] "Uy, no sé, no le he puesto mucha atención a eso... he estado como acalorada un poco pero no sé si eso cuenta. ¿Usted cree que eso es normal por el clima de aquí?"
      3. [movilidad] "Ah sí, ahí camino normal, sin problema... oiga, ¿y usted hace mucho este trabajo de las llamadas?"
      4. [herida] "Pues no sé, la he visto como un poquito rosadita ahí en un lado, pero nada grave, creo... ¿eso es lo que preguntaba o quería otra cosa?"
      5. [apetito] "Ay, no sé, como que no me provoca mucho comer últimamente... pero bueno, uno con el estrés a veces no come bien, ¿no? ¿Usted cree que eso influye?"
      6. [sueno] "Pues... no muy bien la verdad, me despierto varias veces, pero no sé, será que estoy nerviosa no más. ¿Ya casi terminamos? Es que me da como pereza hablar de esto."

  - **caso_tray_pac_42_00030_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, pues normal, un poquito de molestia nomás, nada que no se aguante... como un 6 tal vez, pero no es tan grave, ahí voy."
      2. [fiebre] "Pues sí, me he sentido como tibia, calientica, pero no creo que sea nada, capaz es el clima... me tomé la temperatura y marcó como 38, pero eso no es mucho, ¿cierto?"
      3. [movilidad] "Pues... ha sido un poquito más difícil de lo normal, como que no me quiero ni levantar de la cama, pero eso es porque estoy vaga nomás, no es que no pueda."
      4. [herida] "Se ve un poquito rojita alrededor, pero nada de otro mundo, no le sale nada raro ni nada, seguro es normal por la cicatrización."
      5. [apetito] "Pues como poquito, casi no me provoca nada, pero eso también es normal después de una operación, ¿no? No es que esté enferma ni nada."
      6. [dolor] "Pues duermo poquito, me despierto varias veces, pero es que uno no está acostumbrado a la cama del hospital... no es nada grave, ya se me pasará."

  - **caso_tray_pac_42_00033_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¿Cómo así? Ah, perdón... ¿el dolor de qué, de la cirugía? Es que ahorita no sé si fue ayer o antier que me operaron... pero dolor casi no siento, creo."
      2. [dolor] "Mmm, ¿fiebre? Creo que no, no me he sentido con escalofríos... me tomé la temperatura hace un rato, o fue ayer, y estaba normalita, como 36 y algo."
      3. [movilidad] "Pues... para moverme he estado bien, camino normal, no me cuesta mucho... aunque a veces se me olvida si ya me paré o no, ¿me entiende? Pero de dolor o dificultad no, casi nada."
      4. [herida] "Ah sí, la herida... la vi como un poquito rojita, ahí alrededor, pero no le he visto que salga nada raro. No sé si eso es normal o no, doctor."
      5. [apetito] "Ah, el apetito... pues como que un poquito bajito, no como mucho, pero tampoco es que no quiera comer nada. No sé, normal creo."
      6. [sueno] "Duermo bien, sí... o eso creo, no me acuerdo de despertarme mucho. Normal, como siempre."

  - **caso_tray_pac_42_00034_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolorcito, un 2 más o menos, pero no sé si es normal, ¿usted cree que está bien eso? Me preocupa que vaya a empeorar."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcó 36.3°C... eso está bien, ¿cierto? Ay es que me da miedo que me vaya a dar fiebre sin darme cuenta."
      3. [movilidad] "Pues la verdad me he podido mover normal, camino y me levanto sin problema... pero ¿usted cree que no me vaya a hacer daño moverme así? Me da nervios de pronto lastimarme algo por dentro."
      4. [herida] "No señora, la he estado revisando y se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo, ¿usted cree que igual puede aparecer algo después? Eso me tiene con los nervios de punta."
      5. [apetito] "Sí, gracias a Dios he comido bien, normal... pero ¿usted cree que eso está bien? Es que a veces pienso que debería comer algo especial y no sé si lo estoy haciendo bien."
      6. [sueno] "Sí señora, he dormido bien, normal... pero ¿usted cree que es bueno dormir tanto? Ay, disculpe que pregunte tanto, es que todo esto me tiene con los nervios de punta."

  - **caso_tray_pac_42_00035_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay, no sé, como un 3! Pero dígame, ¿eso es normal o me tengo que preocupar? Es que me da mucho miedo que algo esté mal, ¿sí?"
      2. [fiebre] "Sí señor, me tomé la temperatura y marcó 37.5°C... ¿eso ya es fiebre? ¡Ay, me preocupa mucho, dígame la verdad porfa!"
      3. [movilidad] "Pues la verdad me he podido mover normal, camino sin problema... pero igual ¿eso está bien? ¿No debería sentir más dolor al moverme? ¡Ay, dígame que todo está bien, por favor!"
      4. [herida] "Ay sí, la he estado mirando y veo como un poquito rojita alrededor, nada de pus ni nada raro... ¿pero eso del rojito es grave? ¡Dígame que no es infección, por favor!"
      5. [apetito] "He estado comiendo bien, normal, sin problema... pero oiga, ¿eso del enrojecimiento no le parece que debería revisarlo un médico ya mismo? ¡Es que no me quedo tranquila!"
      6. [dolor] "He dormido bien, normal, sin interrupciones... pero por favor dígame qué hago con lo del enrojecimiento, ¡me tiene con los nervios de punta!"

  - **caso_tray_pac_42_00037_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, disculpe, ¿me repite la pregunta? Es que... no sé si fue ayer o hoy la operación, se me revuelven los días. El dolor... uy, como un 6, algo fuerte, sí."
      2. [fiebre] "Eh... sí, ha sido como calentura, no sé si fue ayer o anoche... me tomé la temperatura y creo que marcó como 37 y pico, algo así."
      3. [movilidad] "Ah sí, para eso sí me he sentido bien, camino normal, sin problema... aunque a veces se me olvida si ya me levanté hoy o fue ayer, jajaja."
      4. [herida] "La herida la he visto normal, no le he visto nada raro, ni rojo ni que le salga nada... eso creo, la enfermera me la revisó hace... ¿ayer o hoy? No me acuerdo bien."
      5. [apetito] "El apetito lo tengo normal, como bien, sin problema... aunque a veces se me olvida si ya almorcé o no, jaja, ¿me repite si ya es hora del almuerzo?"
      6. [sueno] "Uy, el sueño sí lo he sentido como raro, medio alterado, me despierto y no sé si es de noche o de día... pero duermo algo, sí."

  - **caso_tray_pac_42_00038_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, hoy lo siento más fuertecito, como un 6 de 10, no se me quita fácil con las pastillas que me mandaron."
      2. [fiebre] "Sí señora, me tomé la temperatura hace un rato y tenía 37.4, no es muy alta pero sí me he sentido como con un poquito de calorcito. Escalofríos fuertes no, pero sí un malestarcito."
      3. [movilidad] "Pa' eso sí no me quejo, la movilidad la tengo bien, camino normal con mi andador, sin mucho problema."
      4. [herida] "Sí, le noto un poquito de enrojecimiento alrededor, como rojito leve, pero no le he visto que salga nada raro ni hinchazón grande."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "No señora, el sueño lo he tenido normal, duermo bien casi todas las noches, gracias a Dios."

  - **caso_tray_pac_42_00038_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ah, pues... más o menos, ahí vamos llevándolo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Eh, no sé, no le he puesto mucho cuidado a eso... uno con tanta cosa se le olvida. ¿Eso es muy importante saberlo ya mismo?"
      3. [movilidad] "Ay, pues ahí voy caminando despacito, no me quejo de eso... oiga, ¿y usted de dónde me llama, de qué hospital es?"
      4. [herida] "Pues no la miro mucho, la verdad, mi hija me ayuda con eso... se ve normalita, no le he notado nada raro. ¿Falta mucho para terminar la llamada, es que tengo que hacer algo?"
      5. [apetito] "Ay, pues como que menos ganas he tenido, no sé, la comida no me provoca tanto... pero bueno, algo como. ¿Ya casi terminamos, doctor?"
      6. [sueno] "Ay, pues las noches han sido bien duras, casi no pego el ojo, me despierto mucho... pero bueno, eso pasa a la edad de uno, ¿no? ¿Ya terminamos ya?"

### Capa 2 (ruidosa)
  - **caso_tray_pac_42_00000_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues... la verdad, diría que un 2, aunque a veces se me hace más, pero mejor hablemos de cómo ha sido su sueño, ¿no? ... Digamos que sí, pero no tanto."
      2. [fiebre] "Pues, la temperatura ha estado rondando los 37.6 grados, no le sé decir si eso cuente como fiebre, pero la herida sigue con un leve enrojecimiento y el dolor sigue en un 2, aunque a veces parece más. ¿Y cómo ha estado su sueño últimamente?"
      3. [movilidad] "La verdad, me muevo sin mayores dificultades, aunque a veces siento un cosquilleo leve en la zona, pero mejor hablemos de cómo ha estado su apetito últimamente."
      4. [dolor] "La herida está bien, con un leve enrojecimiento, sin secreción y el dolor sigue en 2, aunque a veces parece más. Pero cuénteme, ¿cómo ha estado su apetito últimamente?"
      5. [apetito] "..."
      6. [sueno] "El sueño ha estado bastante normal, aunque a veces me cuesta un poco conciliarlo, pero cuénteme, ¿cómo ha estado su apetito últimamente? Espere, en realidad no, creo que sí me duele bastante."

  - **caso_tray_pac_42_00001_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, pues... más o menos, ahí normal digamos. Oiga, ¿usted sabe si es normal no poder dormir bien después de estas cirugías? parcero"
      2. [fiebre] "Pues no sé, no me he tomado la temperatura muy seguido... a veces siento como un calorcito, pero no sé si es de la casa o qué. ¿Usted cree que eso es raro?"
      3. [movilidad] "No, para caminar sí me muevo bien, ahí voy normal. Lo que más me tiene aporriado es que no logro dormir bien, doctor. Espere, en realidad no, creo que sí me duele bastante."
      4. [herida] "La herida la veo normal, ahí tranquila. Pero de verdad lo que más me preocupa es el sueño, casi no pego el ojo en toda la noche."
      5. [apetito] "Ah el apetito bien, como normal, sin problema. Pero oiga, ¿usted no me puede recomendar algo para el dolor y para poder dormir? Eso sí me tiene mal. Espere, en realidad no, creo que sí me duele bastante."
      6. [dolor] "Pues casi nada, doctor, me la paso dando vueltas toda la noche, el dolor como que se siente más cuando estoy acostado y no me deja pegar el ojo."

  - **caso_tray_pac_42_00001_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, qué bueno que llama! Mire, el dolor lo siento ahí en la herida, y hoy como que está en un 5, no sé si es normal o si me debo preocupar... ¿usted cree que está bien así?"
      2. [dolor] "[silencio]"
      3. [?] "Pues doctor, camino pero despacito y con cuidado, todavía me cuesta un poquito enderezarme bien... ¿eso es normal a estos días o ya debería estar caminando mejor? Es que yo lo veo lento y me preocupa."
      4. [herida] "Ay doctor, sí le noto como un rojito alrededor de la herida, no mucho pero ahí está, y eso me tiene asustado... no ha salido nada de líquido raro ni mal olor, pero ¿ese rojito es normal o ya me tengo que preocupar?"
      5. [herida] "Ay, no sé, se me olvidó lo que iba a decir."
      6. [sueno] "Ay pues no he dormido muy bien que digamos, me despierto por el dolorcito de la herida y me cuesta volver a coger el sueño... ¿eso es normal también o me debería preocupar más, doctor?"

  - **caso_tray_pac_42_00002_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolor de un 3, ahí en la zona de la operación. Pero dígame, ¿eso es normal? Me preocupa que se me vaya a complicar algo."
      2. [?] "Sí señor, me la tomé y marcó 37.3°C... ¿eso ya es fiebre, doctor? Es que yo he escuchado que después de una cirugía cualquier cosita puede ser peligrosa, ¿usted cree que está bien eso? No, olvide lo que dije, es al revés."
      3. [movilidad] "Pues me muevo despacito, como es de esperarse por la operación, pero sí me cuesta un poco más de lo normal... ¿eso está bien, doctor, o debería poder moverme más rápido? Me da miedo hacer algo mal y lastimarme por dentro."
      4. [herida] "La he visto normal, doctor, sin enrojecimiento ni nada raro, ni sale nada de ahí... pero igual la miro con mucho cuidado varias veces al día porque me da pánico que se me vaya a infectar. ¿Usted cree que así como la describo está bien?"
      5. [apetito] "Sí doctor, gracias a Dios el apetito lo tengo normal, como bien... pero ¿no será que debería comer menos por la operación? Ay, uno con tantas dudas, discúlpeme que le pregunte tanto. parcero"
      6. [sueno] "He dormido bien, normal, doctor... pero ¿será que eso es buena señal? Ay, perdone que le pregunte tanto, es que estoy muy nerviosa con toda esta recuperación. ome"

  - **caso_tray_pac_42_00003_3** / capa2_ruidosa — real: **amarillo**, predicho: **rojo** — con interrupción de tercero
    Hallazgos: RED-NEURO ("confundida")
      1. [dolor] "¿Ah? Perdón, ¿desde la ciru- [inaudible] qué día, mija? Ay, espere... yo diría que un cinco, más [inaudible] menos, pero ya [inaudible] me acuerdo si [inaudible] ayer o antier que estuvo peor."
      2. [fiebre] "Ay sí... espere, ¿me pregunta de hoy o de anoche? Creo que anoche me sentí como calientica, tenía por ahí 37 y pico, pero no sé si eso es mucho o no. ... Digamos que sí, pero no tanto."
      3. [?] "Ah, eso sí, para caminar me he sentido bien, normal, como siempre... bueno, no como siempre, sino como debe ser después de la operación, ¿sí me entiende? No he tenido problema pa' moverme, gracias a Dios."
      4. [herida] "Ay, sí, la vi como un poquito rojita ahí alrededor, pero no le he visto que le salga nada raro ni huele mal, no señor... digo, no señorita. Eso sí me tiene un poco confundida si es normal o no."
      5. [apetito] "Pues... no sé, un poquito menos que antes, como que no me provoca mucho la comida, pero de vez en cuando sí como algo. No sé si es por las pastillas o qué será."
      6. [sueno] "Ay no, eso sí ha sido muy difícil, casi no duermo, me despierto a cada rato y no sé ni qué hora es cuando abro los ojos. Muy alterado el sueño, sí señora. ... Ahí vamos, no le podría decir con seguridad."

  - **caso_tray_pac_42_00003_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, muy amable. Pues hoy lo he sentido como en un 6, algo fuerte, especialmente cuando me muevo un poquito más de la cuenta."
      2. [dolor] "Sí señor, me la tomé y estaba en 37.6, así como calientica pero sin llegar a escalofríos ni nada de eso."
      3. [movilidad] "Par- eso sí [inaudible] he sentido bien, la movi- la [inaudible] notado normal, me levanto y camino sin mayor problema."
      4. [herida] "No, la herida la he visto normal, sin enrojecimiento ni hinchazón ni nada saliendo, gracias a Dios. ome"
      5. [?] "Pues el apetito lo he notado un poquito bajo, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Ay, el sueño sí lo he tenido bien alterado, me despierto varias veces por el dolor y luego no logro volver a dormir fácil. ... Puede ser, no estoy seguro."

  - **caso_tray_pac_42_00006_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [?] "Ay, pues ahí normal, nada del otro mundo. Un dolorcito en la zona de la herida, será como un 5, pero eso es de esperarse, ¿no?"
      2. [dolor] "Me la [inaudible] ahora y marcó como 37.4, casi nada. Escalofríos no, eso sí no."
      3. [movilidad] "Eso sí bien, camino normal, me levanto solo sin problema, ahí no tengo queja."
      4. [herida] "La herida se ve bien, normal, sin enrojecimiento ni nada raro saliendo. Ahí tranquilo con eso."
      5. [apetito] "Pues la verdad es que no me ha dado mucha hambre, casi no como, pero eso debe ser normal después de la operación, no le pare muchas bolas a eso."
      6. [sueno] "He dormido bien, sin problema, ahí descansando normal."

  - **caso_tray_pac_42_00006_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, disculpe, ¿qué día es hoy? Es que me hago bolas con las fechas... el dolor, mmm, no sé, como un 2 tal vez, ahí manejable, no es mucho."
      2. [?] "Eh... creo que me la tomé ayer, o antes de ayer, no le sé decir bien, y marcó como 37 y algo, no tan alta. No he sentido escalofríos, solo un calorcito raro a veces."
      3. [movilidad] "Sí, camino normal, no batallo pa' moverme... espere, ¿usted me preguntó por lo mismo la semana pasada? Es que ya perdí la cuenta de cuántos días llevo así."
      4. [herida] "Ah sí, la miré hace un rato... está como rojita alrededor, un poquito no más, no sé si es normal o qué. No he visto que salga nada raro, solo eso rojito."
      5. [apetito] "Pues como menos que antes, se me quita el hambre rapidito... no sé si es por los nervios o qué, se me olvida hasta si almorcé. Espere, en realidad no, creo que sí me duele bastante."
      6. [sueno] "Ay no, duermo muy mal, me despierto varias veces y no sé ni qué hora es cuando abro los ojos... eso sí me tiene como aturdido."

  - **caso_tray_pac_42_00007_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, doctor, pues así como leve, un 2 de 10 más o menos... pero ¿eso es normal? ¿No debería estar sintiendo más dolor a estas alturas? Me preocupa que no sea suficiente el que siento."
      2. [?] "Sí señor, me la tomé hace un rato y marcó como 36.8°C... ¿eso está bien? Ay es que yo leí por ahí que después de una cirugía puede dar fiebre de un momentico a otro y eso me tiene asustada, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues doctor, la verdad me cuesta un poquito moverme, como es apenas el primer día pues siento que todo el cuerpo está más pesado... pero ¿eso es lo esperado? ¿No será que me estoy quedando muy quieta y me puede hacer daño?"
      4. [herida] "La he visto normalita doctor, sin enrojecimiento ni nada raro, ni mal olor... pero es que no sé bien cómo revisarla, ¿usted cree que la estoy viendo bien? Me da miedo no darme cuenta si algo anda mal."
      5. [apetito] "Pues doctor, la verdad he comido un poquito menos de lo normal, como que no me da mucha hambre... ¿eso es preocupante? ¿No será que necesito comer más para recuperarme bien? No, olvide lo que dije, es al revés."
      6. [sueno] "He dormido bien normalito doctor, sin problema para dormir... pero dígame, ¿todo lo que le he contado está bien? ¡Es que me tiene con los nervios de punta pensar que algo pueda estar mal!"

  - **caso_tray_pac_42_00010_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más [inaudible] menos, ahí voy tirando. ¿Usted [inaudible] me nota la voz?"
      2. [fiebre] "Pues no le he puesto mucho cuidado a eso, la verdad... a veces siento como calorcito pero no sé si es del clima o qué. ¿Usted cree que eso es normal?"
      3. [movilidad] "Ah, eso sí, para caminar no me quejo, me muevo normal. Oiga, ¿y usted sabe si esto de la operación deja secuelas a largo plazo?"
      4. [herida] "Uy pues no le he mirado mucho, la verdad me da como cositas verla... pero creo que la he visto un poco rojita ahí alrededor, no sé si es normal eso."
      5. [apetito] "Pues casi no me da hambre, la verdad, como poquito... pero eso es normal después de la operación, ¿no? ¿Usted qué opina?"
      6. [sueno] "Ah, dormir sí duermo bien, eso no es problema. Oiga, ¿ya casi terminamos? Es que me tengo que ir a hacer una vuelta."

  - **caso_tray_pac_42_00012_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Cómo así, hoy es el día... tres? Ay perdón, es que se me revuelven los días. El dolor está por acá en la barriga, como un 6, pero no sé si era peor ayer o antier, no me acuerdo bien."
      2. [?] "No, calentura no, creo que me tomé la temperatura hoy y estaba normalita, como 36 y algo... pero no me acuerdo si fue hoy o ayer que me la tomé. ... Puede ser, no estoy seguro."
      3. [movilidad] "Pues me muevo despacito, con ayuda, como esperaban que fuera... aunque a veces se me olvida si ya me levanté hoy o si eso fue ayer, discúlpeme."
      4. [herida] "Sí, la he visto un poquito rojita alrededor, pero no le sale nada raro ni huele feo, creo... ay no sé si eso lo vi hoy o ayer, perdóneme. ... Digamos que sí, pero no tanto."
      5. [apetito] "He comido normal, gracias a Dios, aunque no sé si eso fue en el almuerzo de hoy o el de ayer, ya ni sé qué día es."
      6. [sueno] "Ay, dormir casi nada, me despierto mucho por el dolor y no le sé decir ni cuántas veces, todo revuelto en la cabeza, discúlpeme."

  - **caso_tray_pac_42_00012_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no sé, se me olvidó lo que iba a decir."
      2. [fiebre] "Sí, señor, ayer me la tomé y estaba en 37,9°C, así como febrecita leve, nada muy alto pero sí lo he notado."
      3. [movilidad] "Pues me cuesta un poco, doctor, como es normal a estos días de la cirugía. Camino despacito, con apoyo, pero no me quedo quieta, trato de moverme aunque sea poquito."
      4. [herida] "Sí, le he visto un poco de enrojecimiento alrededor, así como un rojito leve, pero no le ha salido ningún líquido raro ni nada que huela mal. No la veo hinchada tampoco. ... Pues no sé, más o menos."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer mucho, pero sí como aunque sea poquitas cantidades varias veces al día."
      6. [sueno] "Pues duermo, pero no tan seguido como antes, me despierto varias veces en la noche, será por la molestia o por estar pendiente de la posición. Pero algo de sueño sí logro conciliar."

  - **caso_tray_pac_42_00013_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Pues mire, el dolor lo siento en la cadera, algo así como un 3 de 10. Es soportable, no es nada muy fuerte."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcaba 37.6, como una calentura leve, pero escalofríos no he sentido."
      3. [movilidad] "Pues me muevo despacito, con el andador, como es de esperarse después de la operación. No ha sido fácil pero voy avanzando poquito a poco. Bueno, eso dije, pero ayer le dije lo contrario."
      4. [?] "La he visto normal, sin enrojecimiento ni nada raro saliendo, solo con su vendaje como debe estar. ... No me acuerdo bien, la verdad."
      5. [apetito] "Sí, gracias a Dios el apetito lo tengo normal, como bien mis comiditas sin problema. parcero"
      6. [sueno] "He dormido bien, gracias a Dios, sin despertarme mucho durante la noche."

  - **caso_tray_pac_42_00013_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Hola, buenas, gracias por llamar. Pues el dolor lo siento como en un 5, algo molesto pero soportable."
      2. [fiebre] "Sí me la he tomado, hoy marcó 37.1, así que no ha sido fiebre alta, solo un poquito tibia me sentí. No, olvide lo que dije, es al revés."
      3. [movilidad] "Ay, no sé, se me olvidó lo que iba a decir."
      4. [herida] "Pues la he visto con un poquito de rojito alrededor, leve nada más, sin hinchazón fuerte ni nada que le salga a la herida."
      5. [apetito] "[silencio]"
      6. [sueno] "Pues no he dormido tan bien como antes, me despierto un poquito por el dolor, pero logro descansar algo."

  - **caso_tray_pac_42_00013_14** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, pues... ahí vamos, más o menos bien, gracias a Dios. Oiga, ¿usted sabe si hoy está haciendo mucho sol allá afuera?"
      2. [dolor] "[inaudible] calentura [inaudible] [inaudible] sé, [inaudible] a veces [inaudible] calorcito pero eso es normal [inaudible] est- edad, [inaudible] [inaudible] parece? Oiga, ¿y [inaudible] de [inaudible] me llama, de la clínica misma o [inaudible] ot- parte?"
      3. [movilidad] "Ay, pues ahí voy caminando poquito a poquito, nada grave. ¿Usted ha probado esas cremas que dan ahora para las rodillas, serán buenas?"
      4. [herida] "Uy, la herida... pues normal, no le he mirado mucho la verdad. ¿Usted cree que ya casi es hora de almorzar? Es que se me está pasando el hambre."
      5. [apetito] "[inaudible] pues sí, como nor- gracias a Dios no me falta el hambre. Oiga, ¿y usted no sab- si va a llover hoy? Es que qui- salir al patio [inaudible] rato."
      6. [?] "Ah, duermo bien, gracias a Dios, como un bebé casi. Bueno mijo, ¿ya casi terminamos? Es que se me está enfriando el caldo."

  - **caso_tray_pac_42_00015_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, ha sido nada del otro mundo, un dolorcito ahí en la herida, como un 4 tal vez, pero es soportable."
      2. [fiebre] "Sí, me la tomé y estaba normalita, como en 37, nada de fiebre ni escalofríos, todo bien por ese lado."
      3. [movilidad] "Pues me muevo despacito, obvio, uno recién operado no va a andar corriendo, pero nada grave, ahí voy caminando poquito a poquito."
      4. [herida] "Se ve un poquito rojita ahí alrededor, pero nada de hinchazón ni de esas cosas raras que salgan, yo creo que es normal de la cicatrización."
      5. [apetito] "..."
      6. [sueno] "Pues no he dormido muy bien, la verdad, me despierto varias veces, pero eso es normal después de una operación, no le pare muchas bolas a eso."

  - **caso_tray_pac_42_00016_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, es que no sé bien! Yo creo que un 5, pero es que me preocupa muchísimo, ¿eso es normal o me tengo que asustar? Dígame que no es grave, por favor."
      2. [?] "[silencio]"
      3. [movilidad] "Ay pues me cuesta un poquito, doctor, como es apenas el primer día uno se siente todo entumido, pero camino despacito. ¿Eso es lo esperado o debería ya moverme más rápido? Es que me da miedo hacerme daño."
      4. [herida] "Ay doctor, sí noté como un poquito de rojito alrededor, pero no sale nada raro ni huele mal. ¿Eso es normal o me tengo que preocupar? Es que verla así me pone los nervios de punta."
      5. [apetito] "Pues fíjese que he comido normal, gracias a Dios, no he perdido el apetito. Pero bueno, ¿eso está bien también? Es que con todo lo demás uno ya no sabe qué esperar."
      6. [sueno] "Este... no, nada, siga con la otra pregunta."

  - **caso_tray_pac_42_00017_7** / capa2_ruidosa — real: **rojo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila doctora, un poquito molesto no más- nada del otro [inaudible] uno aguanta."
      2. [fiebre] "Sí, me tomé la temperatura ayer, marcó como 37 y algo, nada de escalofríos ni cosas raras, tranquila."
      3. [movilidad] "Este... no, nada, siga con la otra pregunta."
      4. [herida] "Se ve un poquito rojita ahí en el borde, pero nada de esas cosas de pus ni nada raro, yo creo que es normal de la cicatrización, doctora."
      5. [apetito] "..."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces, pero uno ya sabe que después de una operación así es normal, no es nada grave. ... Pues no sé, más o menos."

  - **caso_tray_pac_42_00019_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí vamos. No sé, un poquito, no me gusta poner números a eso, ¿usted sabe? ... Pues no sé, más o menos."
      2. [dolor] "..."
      3. [movilidad] "Pues ahí voy despacito, hija, uno a esta edad ya no es tan ligero... ¿y usted cómo ha estado con el trabajo, mucho ajetreo?"
      4. [herida] "Ay pues no la he mirado mucho, me da como cosita verla... la enfermera me la curó ayer y dijo algo pero no le puse mucho cuidado."
      5. [apetito] "Ay, la comida... no sé, no me provoca mucho, todo me sabe raro. Pero bueno, ¿usted no me iba a preguntar sobre el sueño también?"
      6. [sueno] "Ay, hija, esas noches larguísimas, uno da vueltas y vueltas... pero no quiero quitarle más tiempo, ¿ya casi terminamos?"

  - **caso_tray_pac_42_00019_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-MOBILITY ("no puedo levantarme")
      1. [dolor] "Buenas, mijo. El dolor lo siento en el pecho, donde la cirugía, y hoy lo sentiría como un 5, más incómodo que otros días. Espere, en realidad no, creo que sí me duele bastante."
      2. [dolor] "[inaudible] señor, me he sentido como afiebr- me tomé la temperatura y marcó [inaudible] [inaudible] he sentido un poco de escalofrío."
      3. [movilidad] "Ay, muy mal, la verdad. Antes me movía sola sin problema y ahora casi no puedo levantarme, necesito que alguien me ayude para todo. ... Ahí vamos, no le podría decir con seguridad."
      4. [herida] "Pues la he visto un poco enrojecida alrededor, un eritema leve como le dicen, pero no le he visto secreción ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, casi no me provoca comer nada, se me ha ido mucho el apetito estos días, como poquito y a las fuerzas."
      6. [sueno] "No, mijo, he dormido muy mal, me despierto varias veces por el dolor y el malestar, casi no descanso."

  - **caso_tray_pac_42_00019_14** / capa2_ruidosa — real: **rojo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, ¿cómo así, mija? Espere... ¿la cirugía fue el jueves o fue la otra semana? Es que el dolor lo siento como un 6, ahí en el pecho, pero se me confunden los días."
      2. [fiebre] "Ay sí, creo que sí... me sentí como con mucho calor anoche, toda sudada, y frío al mismo tiempo, qué raro. No sé si me la tomé o fue mi hija, pero me acuerdo un número como... ¿39 algo? No estoy segura, mija."
      3. [movilidad] "Pues... uy, me cuesta un poco, mija, me siento como pesada, despacito me muevo, no sé si es normal o no a estos días... ¿usted sabe cuántos días llevo ya? Se me pierden las cuentas."
      4. [herida] "Ay, la miré ayer o antier, no sé bien... la vi como rojita, un poquito, alrededor mija, pero no le vi que saliera nada raro ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, mija, casi no me provoca comer, todo me da como asco o pereza, apenas unas cucharaditas de sopa y ya. Mi hija se preocupa porque no como casi nada. No, olvide lo que dije, es al revés."
      6. [sueno] "Ay no, casi no duermo, mija, me despierto sudada y con dolor, y no sé si es de noche o de día a veces, todo se me revuelve."

  - **caso_tray_pac_42_00021_3** / capa2_ruidosa — real: **verde**, predicho: **rojo** — con interrupción de tercero
    Hallazgos: RED-NEURO ("confusión")
      1. [?] "Este... no, nada, siga con la otra pregunta."
      2. [dolor] "Eh... creo que me la tomé, sí, marcó como 37, algo normal creo... pero no sé si fue hoy o ayer, se me pierden los días, disculpe."
      3. [movilidad] "Pues me muevo despacito, como esperaba después de la operación, un poco limitado pero nada raro... ¿usted me preguntó si eso era ayer o hoy? Ya no le sé decir bien."
      4. [herida] "La herida la he visto normal, sin nada raro, ni rojo ni con esas cosas que dice... aunque ya no me acuerdo si me la revisé hoy o ayer, perdone. Bueno, eso dije, pero ayer le dije lo contrario."
      5. [apetito] "El apetito lo he sentido normal, como siempre, no le he hallado problema... aunque no recuerdo si ayer comí bien o fue antier, se me revuelven los días."
      6. [?] "He dormido normal, bien, sin problema... creo que fueron dos noches así, o tres, ya perdí la cuenta, disculpe la confusión."

  - **caso_tray_pac_42_00021_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento ahí en la zona donde me operaron, en el abdomen. Ahorita como en un 5, va y viene, sobre todo cuando me muevo o me río."
      2. [fiebre] "Sí señora, [inaudible] tomé la temperatura ha- ratico y [inaudible] en 37.5, como febrícula. Escalofríos [inaudible] no, pero [inaudible] me he sentido [inaudible] poco más caliente de [inaudible] normal."
      3. [movilidad] "Pues me muevo, pero despacio, como es de esperarse a estos días de la cirugía. Levantarme de la cama o del sofá sí me cuesta un poco más de lo normal."
      4. [herida] "Sí, la he estado revisando, y tiene un enrojecimiento leve alrededor de la incisión. No hay secreción ni mal olor, gracias a Dios, pero ese rojito me tiene un poco pendiente."
      5. [apetito] "Pues el apetito lo tengo un poco bajo, como que no me provoca comer igual que antes, pero de todas maneras algo como. No es que no coma nada, pero sí menos cantidad."
      6. [sueno] "Ay, el sueño sí lo tengo bastante alterado, me despierto varias veces en la noche por el dolor y me cuesta volver a dormirme, así que descanso poquito."

  - **caso_tray_pac_42_00025_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, gracias a Dios por llamar! El dolor está como en un 3, ahí en la herida... pero ¿eso es normal? ¿o debería preocuparme? pues"
      2. [?] "Sí me tomé la temperatura hace un rato y marcó 37, ¿eso está bien verdad? Ay es que no he sentido escalofríos pero igual me da nervios, ¿usted cree que puede subir de un momento a otro? ome"
      3. [movilidad] "Pues me muevo despacito, todavía me cuesta un poco, como es de esperarse después de la operación... pero ¿eso es normal doctor? ¿o ya debería estar caminando mejor a estos días? pues"
      4. [herida] "Ay doctor, sí noté como un poquito rojito alrededor, no sale nada raro ni huele mal, pero ese rojito me tiene asustado... ¿eso es grave? ¿debo ir a urgencias ya?"
      5. [apetito] "[silencio]"
      6. [dolor] "Pues casi no duermo bien, doctor, me despierto varias veces en la noche, no sé si es el dolor o los nervios... ¿usted cree que eso está afectando mi recuperación?"

  - **caso_tray_pac_42_00026_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay doctor, gracias a Dios que llama! Es que el dolor ha estado como en un 4, no sé si es normal, a veces siento que aumenta un poquito y me asusto mucho... ¿usted cree que está bien así o debería preocuparme? ... Pues no sé, más o menos."
      2. [fiebre] "Sí señora, me tomé la temperatura y marcó 37.6°C, ¡y eso me tiene con los nervios de punta! ¿Eso ya es fiebre? Dígame la verdad, por favor, porque yo leí por ahí que eso puede ser peligroso. Espere, en realidad no, creo que sí me duele bastante."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, me muevo normal, sin problema... pero es que me preocupa que igual con este dolorcito algo ande mal por dentro, ¿usted no cree?"
      4. [?] "No doctor, la herida se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo tocarla mucho, ¿será que puede empeorar si la reviso a cada rato?"
      5. [apetito] "Pues la verdad he comido menos de lo normal, como que no me provoca mucho... ¿eso es malo doctor? Es que con tanta preocupación se me quita hasta el hambre. ... Digamos que sí, pero no tanto."
      6. [dolor] "Ay doctor, el sueño ha sido lo peor, casi no duermo, me despierto asustada pensando en el dolor y en si todo va bien... ¡dígame que esto es normal, por favor!"

  - **caso_tray_pac_42_00026_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay, pues... más o menos, ahí voy sobreviviendo. ¿Usted cómo ha estado, todo bien por allá? Espere, en realidad no, creo que sí me duele bastante."
      2. [fiebre] "Uy, no sé, no le he puesto mucho cuidado a eso... aunque sí me he sentido como acalorada a ratos. ¿Usted cree que eso es normal después de la cirugía?"
      3. [movilidad] "Ah, eso sí, camino normal, no hay problema con eso... oiga, ¿usted sabe si esta llamada dura mucho? Es que tengo algo pendiente ahorita."
      4. [herida] "Pues... la he mirado poquito, no me gusta verla mucho. Se ve como un poquito rojita, pero nada más, creo... ¿eso es grave o qué?"
      5. [apetito] "Ay pues, no como casi nada, se me quita el hambre rapidito... pero bueno, eso a veces pasa, ¿no? ¿Usted cree que es por los nervios o algo así? parcero"
      6. [sueno] "Ush, dormir casi nada, doctor... me la paso dando vueltas toda la noche. Pero bueno, ya se me pasará, ¿verdad? ¿Usted cree que esto es normal?"

  - **caso_tray_pac_42_00027_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Ah? Perdón... ¿cirugía dice? Ay, espere... el dolor por ahí lo siento leve, como un 3, aquí en la barriga... o eso creo, ya ni me acuerdo qué día es hoy."
      2. [fiebre] "Mmm, temperatura... creo que sí me la tomaron, marcó como 37, algo así normalito... pero no le sé decir si fue hoy o ayer, todo se me revuelve."
      3. [movilidad] "Uy, moverme... sí, camino normal, sin problema, no me duele para eso... creo. ¿Ya le dije eso o me está preguntando otra vez?"
      4. [herida] "Ay, la herida... la vi como un poquito rojita, así levecito nada más, no le vi que botara nada raro... o eso me pareció, ya no sé si fue hoy que la miré."
      5. [apetito] "..."
      6. [sueno] "Uy, dormir no, casi nada... me despierto a cada rato, no sé si por el dolor o por los ruidos, todo revuelto ahí en la noche, doctor."

  - **caso_tray_pac_42_00027_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, no, más o menos no más, un dolorcito ahí normal de la operación, nada del otro mundo. Si acaso un 6, pero eso ya se me pasa solo, no se preocupe."
      2. [dolor] "Pues sí me he sentido como con un poco de calorcito, pero nada de escalofríos ni nada raro. Me tomé la temperatura y salió como en 38, pero eso debe ser del calor de acá no más, doctor. ... Ahí vamos, no le podría decir con seguridad."
      3. [movilidad] "Ay, pues ahí vamos despacito, un poco más difícil de lo normal [inaudible] levantarme, pero eso es normal después de [inaudible] operación, no es nada [inaudible] Ya me [inaudible] poco a [inaudible] no se preocupe."
      4. [herida] "La veo bien, doctor, tal vez un poquito rojita ahí en un lado, pero nada de esas cosas raras, ni pus ni nada de eso. Yo creo que eso es normal de la cicatrización, no más."
      5. [apetito] "Pues no como mucho, se me ha quitado un poco las ganas, pero eso es normal, doctor, con la operación uno no tiene mucha hambre. Náuseas no, gracias a Dios, nada de eso."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces en la noche, pero eso es normal por la incomodidad no más, nada grave doctor, ya me acostumbro. ome"

  - **caso_tray_pac_42_00028_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, un dolorcito no más ahí en la cadera, com- un 4 [inaudible] vez, pero eso es [inaudible] uno aguanta."
      2. [dolor] "Sí señora, me la tomé y marcó como 37.3, casi nada, ni se siente uno mal ni nada de eso."
      3. [movilidad] "Pues ahí voy despacito, con la ayuda del andador, apenas es el primer día pues es normal que uno esté un poco tieso, nada grave."
      4. [herida] "Se ve un poquito rojita ahí alrededor, nada de esas cosas raras que salen, ni pus ni nada, capaz es normal de la cirugía no más. ... Ahí vamos, no le podría decir con seguridad."
      5. [apetito] "Ay pues casi no me provoca comer, pero eso es normal con tanto medicamento, no me preocupo por eso, algo como paso."
      6. [sueno] "Pues me despierto un poquito por la molestia, pero duermo mis horitas, no es nada de qué alarmarse, tranquila."

  - **caso_tray_pac_42_00028_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, ¿cómo así, perdone? ¿Me pregunta de hoy o de cuando me operaron... eso fue el lunes o el martes? Ahorita siento como un tres, por ahí en la cadera... o la rodilla, ya se me confunde cuál fue."
      2. [fiebre] "[inaudible] fiebre no sé... me tomaron la temperatura hace [inaudible] rato y creo que estaba normal, como en 37, pero no me acuerdo si fue hoy o ayer. Escalofríos no he sentido, eso [inaudible] se [inaudible] puedo asegurar."
      3. [movilidad] "Sí, más o menos bien, doctor... digo, señorita. Me levanto de la cama sin mucho problema, camino con el andador o lo que me dieron ahí, no me acuerdo cómo se llama, pero sí me muevo normal."
      4. [?] "La herida... la vi esta mañana cuando me la revisó la enfermera, o fue ayer, no sé, pero se veía normal, sin nada raro, ni rojo ni con esos líquidos feos. No huele mal tampoco, eso sí me acuerdo."
      5. [apetito] "Ay, es que no tengo casi ganas de comer, señorita... me traen la bandeja y como poquito, no sé si es por los medicamentos o qué. Náuseas no, pero la comida no me provoca casi nada."
      6. [dolor] "Duermo por ratos, señorita, me despierto y no sé si es por el dolor o porque ya me acostumbré a otro horario en el hospital... pero no es que sea muy grave, así como que me despierto y ya."

  - **caso_tray_pac_42_00028_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-WOUND ("líquido ahí, como amarillito")
      1. [?] "Ay, pues no ha sido tan grave, algo de dolor ahí en la cadera, será un 5 más o menos, pero uno aguanta, no se preocupe. parcero"
      2. [fiebre] "Pues [inaudible] me [inaudible] sen- un poco calientica, la tomé y marcaba como [inaudible] y algo, pero yo creo que [inaudible] [inaudible] calor de [inaudible] casa, no le he puesto mucho cuidado."
      3. [?] "Ay no, en eso sí estoy bien, camino normal, sin problema, ahí me muevo tranquila por la casa."
      4. [herida] "Pues sí le sale un poquito de líquido ahí, como amarillito, pero no es mucho, yo creo que es normal de la sanada, no me preocupa mucho."
      5. [apetito] "Este... no, nada, siga con la otra pregunta."
      6. [?] "Pues duermo poquito, me despierto varias veces en la noche, pero eso es normal a esta edad, no es nada grave, ya cogeré el sueño."

  - **caso_tray_pac_42_00029_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, el dolor ha estado bastante manejable, como en un 2 de 10. Lo siento en la zona de la herida, pero es más una molestia que un dolor fuerte."
      2. [fiebre] "Sí, me la tomé hoy y marcó 37.4°C, como una febrícula leve, pero no me he sentido con escalofríos ni nada raro. Espere, en realidad no, creo que sí me duele bastante."
      3. [?] "Sí, la movilidad la tengo normal, me levanto y camino sin problema, eso sí lo he podido hacer bien. parcero"
      4. [herida] "Le noto un poco de enrojecimiento leve alrededor de la herida, pero no he visto hinchazón fuerte ni secreción, nada de pus ni nada así."
      5. [apetito] "Pues la verdad el apetito lo tengo bastante disminuido, casi no me provoca comer, como poquito y a veces me toca obligarme."
      6. [sueno] "El sueño lo he tenido muy alterado, me despierto varias veces en la noche y me cuesta volver a conciliar el sueño."

  - **caso_tray_pac_42_00030_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay pues... más o menos, ahí normal, como uno se siente después de esas cosas. ¿Usted qué comió hoy? No, olvide lo que dije, es al revés."
      2. [dolor] "Uy, no sé, no le he puesto mucha atención a eso... he estado como acalorada un poco pero no sé si eso cuenta. ¿Usted cree que eso es normal por el clima de aquí?"
      3. [movilidad] "[inaudible] sí, ahí camino normal, [inaudible] problema... oiga, ¿y usted hace mucho este trabajo de las llamadas?"
      4. [herida] "Pues no sé, la he visto como un poquito rosadita ahí en un lado, pero nada grave, creo... ¿eso es lo que preguntaba o quería otra cosa?"
      5. [apetito] "Ay, no sé, como que no me provoca mucho comer últimamente... pero bueno, uno con el estrés a veces no come bien, ¿no? ¿Usted cree que eso influye?"
      6. [sueno] "Pues... no muy bien la verdad, me despierto varias veces, pero no sé, será que estoy nerviosa no más. ¿Ya casi terminamos? Es que me da como pereza hablar de esto."

  - **caso_tray_pac_42_00030_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, pues normal, un poquito de molestia nomás, nada que no se aguante... como un 6 tal vez, pero no es tan grave, ahí voy."
      2. [fiebre] "Pues sí, me he sentido como tibia, calientica, pero no creo que sea nada, capaz es el clima... me tomé la temperatura y marcó como 38, pero eso no es mucho, ¿cierto?"
      3. [movilidad] "Pues... ha sido un poquito más difícil de lo normal, como que no me quiero ni levantar de la cama, pero eso es porque estoy vaga nomás, no es que no pueda."
      4. [herida] "Se ve un poquito rojita alrededor, pero nada de otro mundo, no le sale nada raro ni nada, seguro es normal por la cicatrización."
      5. [apetito] "Pues como poquito, casi no me provoca nada, pero eso también es normal después de una operación, ¿no? No es que esté enferma ni nada."
      6. [dolor] "Pues duermo poquito, me despierto varias veces, pero es que uno no está acostumbrado a la cama del hospital... no es nada grave, ya se me pasará."

  - **caso_tray_pac_42_00033_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¿Cómo así? Ah, perdón... ¿el dol- de qué, de [inaudible] [inaudible] Es que ahorita no sé si [inaudible] ayer [inaudible] antie- que me [inaudible] pero [inaudible] casi no sien- creo."
      2. [dolor] "Mmm, ¿fiebre? Creo que no, no me he sentido con escalofríos... me tomé la temperatura hace un rato, o fue ayer, y estaba normalita, como 36 y algo."
      3. [movilidad] "Pues... para moverme he estado bien, camino normal, no me cuesta mucho... aunque a veces se me olvida si ya me paré o no, ¿me entiende? Pero de dolor o dificultad no, casi nada."
      4. [herida] "Ah sí, la herida... la vi como un poquito rojita, ahí alrededor, pero no le he visto que salga nada raro. No sé si eso es normal o no, doctor. ... Digamos que sí, pero no tanto."
      5. [apetito] "Ah, el apetito... pues como que un poquito bajito, no como mucho, pero tampoco es que no quiera comer nada. No sé, normal creo."
      6. [sueno] "Duermo bie- sí... o [inaudible] [inaudible] no me acuerdo [inaudible] despertarme mucho. Normal, como siempre."

  - **caso_tray_pac_42_00034_14** / capa2_ruidosa — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolorcito, un 2 más o menos, pero no sé si es normal, ¿usted cree que está bien eso? Me preocupa que vaya a empeorar."
      2. [?] "Sí señora, me la tomé hace un rato y marcó 36.3°C... eso está bien, ¿cierto? Ay es que me da miedo que me vaya a dar fiebre sin darme cuenta."
      3. [movilidad] "Pues la verdad me he podido mover normal, camino y me levanto sin problema... pero ¿usted cree que no me vaya a hacer daño moverme así? Me da nervios de pronto lastimarme algo por dentro."
      4. [herida] "No señora, la he estado revisando y se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo, ¿usted cree que igual puede aparecer algo después? Eso me tiene con los nervios de punta. No, olvide lo que dije, es al revés."
      5. [apetito] "Sí, gracias a Dios he comido bien, normal... pero ¿usted cree que eso está bien? Es que a veces pienso que debería comer algo especial y no sé si lo estoy haciendo bien. ... Pues no sé, más o menos."
      6. [sueno] "Sí señora, he dormido bien, normal... pero ¿usted cree que es bueno dormir tanto? Ay, disculpe que pregunte tanto, es que todo esto me tiene con los nervios de punta."

  - **caso_tray_pac_42_00035_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay, no sé, como un 3! Pero dígam- ¿eso es normal o me tengo que preocupar? Es que me da mucho miedo que algo esté mal, ¿sí?"
      2. [fiebre] "Sí señor, me tomé la temperatura y marcó 37.5°C... ¿eso ya es fiebre? ¡Ay, me preocupa mucho, dígame la verdad porfa!"
      3. [movilidad] "Pues la verdad me he podido mover normal, camino sin problema... pero igual ¿eso está bien? ¿No debería sentir más dolor al moverme? ¡Ay, dígame que todo está bien, por favor!"
      4. [herida] "Ay sí, la he estado mirando y veo como un poquito rojita alrededor, nada de pus ni nada raro... ¿pero eso del rojito es grave? ¡Dígame que no es infección, por favor! No, olvide lo que dije, es al revés."
      5. [apetito] "He estado comiendo bien, normal, sin problema... pero oiga, ¿eso del enrojecimiento no le parece que debería revisarlo un médico ya mismo? ¡Es que no me quedo tranquila! parcero"
      6. [dolor] "He dormido bien, normal, sin interrupciones... pero por favor dígame qué hago con lo del enrojecimiento, ¡me tiene con los nervios de punta!"

  - **caso_tray_pac_42_00037_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "[silencio]"
      2. [fiebre] "Eh... sí, ha sido como calentura, no sé si fue ayer o anoche... me tomé la temperatura y creo que marcó como 37 y pico, algo así. ... Digamos que sí, pero no tanto."
      3. [movilidad] "..."
      4. [herida] "La [inaudible] la [inaudible] visto normal, no le [inaudible] visto nada raro, ni rojo ni que le salga nada... eso creo, [inaudible] enfermera me la revisó hace... ¿ayer o hoy? [inaudible] [inaudible] acuerdo bien."
      5. [apetito] "El apetito lo tengo normal, como bien, sin problema... aunque a veces se me olvida si ya almorcé o no, jaja, ¿me repite si ya es hora del almuerzo?"
      6. [sueno] "Uy, el sueño sí lo he sentido como raro, medio alterado, me despierto y no sé si es de noche o de día... pero duermo algo, sí."

  - **caso_tray_pac_42_00038_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [?] "Pues mire, hoy lo siento más fuertecito, como un 6 de 10, no se me quita fácil con las pastillas que me mandaron. parcero"
      2. [fiebre] "Sí señora, me tomé la temperatura hace un rato y tenía 37.4, no es muy alta pero sí me he sentido como con un poquito de calorcito. Escalofríos fuertes no, pero sí un malestarcito."
      3. [movilidad] "Pa' eso sí no me quejo, la movilidad la tengo bien, camino normal con mi andador, sin mucho problema. parcero"
      4. [herida] "Este... no, nada, siga con la otra pregunta."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Este... no, nada, siga con la otra pregunta."

  - **caso_tray_pac_42_00038_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ah, pues... más o menos, ahí vamos llevándolo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Eh, no sé, no le he puesto mucho cuidado a eso... uno con tanta cosa se le olvida. ¿Eso es muy importante saberlo ya mismo?"
      3. [movilidad] "Ay, pues ahí voy caminando despacito, no me quejo de eso... oiga, ¿y usted de dónde me llama, de qué hospital es?"
      4. [herida] "Pues no la miro mucho, la verdad, mi hija me ayuda con eso... se ve normalita, no le he notado nada raro. ¿Falta mucho para terminar la llamada, es que tengo que hacer algo?"
      5. [apetito] "Ay, pues como que menos ganas he tenido, no le sé decir, la comida no me provoca tanto... pero bueno, algo como. ¿Ya casi terminamos, doctor?"
      6. [sueno] "Ay, pues las noches han sido bien duras, casi no pego el ojo, me despierto mucho... pero bueno, eso pasa a la edad de uno, ¿no? ¿Ya terminamos ya?"

## Casos mal clasificados — con contexto (prototipo)

### Capa 1 (limpia)
  - **caso_tray_pac_42_00000_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues... la verdad, diría que un 2, aunque a veces se me hace más, pero mejor hablemos de cómo ha sido su sueño, ¿no?"
      2. [fiebre] "Pues, la temperatura ha estado rondando los 37.6 grados, no sé si eso cuente como fiebre, pero la herida sigue con un leve enrojecimiento y el dolor sigue en un 2, aunque a veces parece más. ¿Y cómo ha estado su sueño últimamente?"
      3. [movilidad] "La verdad, me muevo sin mayores dificultades, aunque a veces siento un cosquilleo leve en la zona, pero mejor hablemos de cómo ha estado su apetito últimamente."
      4. [dolor] "La herida está bien, con un leve enrojecimiento, sin secreción y el dolor sigue en 2, aunque a veces parece más. Pero cuénteme, ¿cómo ha estado su apetito últimamente?"
      5. [apetito] "Pues, la verdad, he notado que el apetito está un poquito bajo, pero mejor hablemos de cómo ha estado su sueño últimamente, ¿no?"
      6. [sueno] "El sueño ha estado bastante normal, aunque a veces me cuesta un poco conciliarlo, pero cuénteme, ¿cómo ha estado su apetito últimamente?"

  - **caso_tray_pac_42_00001_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, pues... más o menos, ahí normal digamos. Oiga, ¿usted sabe si es normal no poder dormir bien después de estas cirugías?"
      2. [fiebre] "Pues no sé, no me he tomado la temperatura muy seguido... a veces siento como un calorcito, pero no sé si es de la casa o qué. ¿Usted cree que eso es raro?"
      3. [movilidad] "No, para caminar sí me muevo bien, ahí voy normal. Lo que más me tiene aporriado es que no logro dormir bien, doctor."
      4. [herida] "La herida la veo normal, ahí tranquila. Pero de verdad lo que más me preocupa es el sueño, casi no pego el ojo en toda la noche."
      5. [apetito] "Ah el apetito bien, como normal, sin problema. Pero oiga, ¿usted no me puede recomendar algo para el dolor y para poder dormir? Eso sí me tiene mal."
      6. [dolor] "Pues casi nada, doctor, me la paso dando vueltas toda la noche, el dolor como que se siente más cuando estoy acostado y no me deja pegar el ojo."

  - **caso_tray_pac_42_00002_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolor de un 3, ahí en la zona de la operación. Pero dígame, ¿eso es normal? Me preocupa que se me vaya a complicar algo."
      2. [fiebre] "Sí señor, me la tomé y marcó 37.3°C... ¿eso ya es fiebre, doctor? Es que yo he escuchado que después de una cirugía cualquier cosita puede ser peligrosa, ¿usted cree que está bien eso?"
      3. [movilidad] "Pues me muevo despacito, como es de esperarse por la operación, pero sí me cuesta un poco más de lo normal... ¿eso está bien, doctor, o debería poder moverme más rápido? Me da miedo hacer algo mal y lastimarme por dentro."
      4. [herida] "La he visto normal, doctor, sin enrojecimiento ni nada raro, ni sale nada de ahí... pero igual la miro con mucho cuidado varias veces al día porque me da pánico que se me vaya a infectar. ¿Usted cree que así como la describo está bien?"
      5. [apetito] "Sí doctor, gracias a Dios el apetito lo tengo normal, como bien... pero ¿no será que debería comer menos por la operación? Ay, uno con tantas dudas, discúlpeme que le pregunte tanto."
      6. [sueno] "He dormido bien, normal, doctor... pero ¿será que eso es buena señal? Ay, perdone que le pregunte tanto, es que estoy muy nerviosa con toda esta recuperación."

  - **caso_tray_pac_42_00003_3** / capa1_limpia — real: **amarillo**, predicho: **rojo**
    Hallazgos: RED-NEURO ("confundida")
      1. [dolor] "¿Ah? Perdón, ¿desde la cirugía de qué día, mija? Ay, espere... yo diría que un cinco, más o menos, pero ya no me acuerdo si fue ayer o antier que estuvo peor."
      2. [fiebre] "Ay sí... espere, ¿me pregunta de hoy o de anoche? Creo que anoche me sentí como calientica, tenía por ahí 37 y pico, pero no sé si eso es mucho o no."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, normal, como siempre... bueno, no como siempre, sino como debe ser después de la operación, ¿sí me entiende? No he tenido problema pa' moverme, gracias a Dios."
      4. [herida] "Ay, sí, la vi como un poquito rojita ahí alrededor, pero no le he visto que le salga nada raro ni huele mal, no señor... digo, no señorita. Eso sí me tiene un poco confundida si es normal o no."
      5. [apetito] "Pues... no sé, un poquito menos que antes, como que no me provoca mucho la comida, pero de vez en cuando sí como algo. No sé si es por las pastillas o qué será."
      6. [sueno] "Ay no, eso sí ha sido muy difícil, casi no duermo, me despierto a cada rato y no sé ni qué hora es cuando abro los ojos. Muy alterado el sueño, sí señora."

  - **caso_tray_pac_42_00003_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, muy amable. Pues hoy lo he sentido como en un 6, algo fuerte, especialmente cuando me muevo un poquito más de la cuenta."
      2. [dolor] "Sí señor, me la tomé y estaba en 37.6, así como calientica pero sin llegar a escalofríos ni nada de eso."
      3. [movilidad] "Para eso sí me he sentido bien, la movilidad la he notado normal, me levanto y camino sin mayor problema."
      4. [herida] "No, la herida la he visto normal, sin enrojecimiento ni hinchazón ni nada saliendo, gracias a Dios."
      5. [apetito] "Pues el apetito lo he notado un poquito bajo, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Ay, el sueño sí lo he tenido bien alterado, me despierto varias veces por el dolor y luego no logro volver a dormir fácil."

  - **caso_tray_pac_42_00006_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues ahí normal, nada del otro mundo. Un dolorcito en la zona de la herida, será como un 5, pero eso es de esperarse, ¿no?"
      2. [dolor] "Me la tomé ahora y marcó como 37.4, casi nada. Escalofríos no, eso sí no."
      3. [movilidad] "Eso sí bien, camino normal, me levanto solo sin problema, ahí no tengo queja."
      4. [herida] "La herida se ve bien, normal, sin enrojecimiento ni nada raro saliendo. Ahí tranquilo con eso."
      5. [apetito] "Pues la verdad es que no me ha dado mucha hambre, casi no como, pero eso debe ser normal después de la operación, no le pare muchas bolas a eso."
      6. [sueno] "He dormido bien, sin problema, ahí descansando normal."

  - **caso_tray_pac_42_00006_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, disculpe, ¿qué día es hoy? Es que me hago bolas con las fechas... el dolor, mmm, no sé, como un 2 tal vez, ahí manejable, no es mucho."
      2. [fiebre] "Eh... creo que me la tomé ayer, o antes de ayer, no sé bien, y marcó como 37 y algo, no tan alta. No he sentido escalofríos, solo un calorcito raro a veces."
      3. [movilidad] "Sí, camino normal, no batallo pa' moverme... espere, ¿usted me preguntó por lo mismo la semana pasada? Es que ya perdí la cuenta de cuántos días llevo así."
      4. [herida] "Ah sí, la miré hace un rato... está como rojita alrededor, un poquito no más, no sé si es normal o qué. No he visto que salga nada raro, solo eso rojito."
      5. [apetito] "Pues como menos que antes, se me quita el hambre rapidito... no sé si es por los nervios o qué, se me olvida hasta si almorcé."
      6. [sueno] "Ay no, duermo muy mal, me despierto varias veces y no sé ni qué hora es cuando abro los ojos... eso sí me tiene como aturdido."

  - **caso_tray_pac_42_00007_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre"), AMBER-PAIN-SCORE-CTX ("8")
      1. [dolor] "Ay, doctor, pues así como leve, un 2 de 10 más o menos... pero ¿eso es normal? ¿No debería estar sintiendo más dolor a estas alturas? Me preocupa que no sea suficiente el que siento."
      2. [dolor] "Sí señor, me la tomé hace un rato y marcó como 36.8°C... ¿eso está bien? Ay es que yo leí por ahí que después de una cirugía puede dar fiebre de un momentico a otro y eso me tiene asustada, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues doctor, la verdad me cuesta un poquito moverme, como es apenas el primer día pues siento que todo el cuerpo está más pesado... pero ¿eso es lo esperado? ¿No será que me estoy quedando muy quieta y me puede hacer daño?"
      4. [herida] "La he visto normalita doctor, sin enrojecimiento ni nada raro, ni mal olor... pero es que no sé bien cómo revisarla, ¿usted cree que la estoy viendo bien? Me da miedo no darme cuenta si algo anda mal."
      5. [apetito] "Pues doctor, la verdad he comido un poquito menos de lo normal, como que no me da mucha hambre... ¿eso es preocupante? ¿No será que necesito comer más para recuperarme bien?"
      6. [sueno] "He dormido bien normalito doctor, sin problema para dormir... pero dígame, ¿todo lo que le he contado está bien? ¡Es que me tiene con los nervios de punta pensar que algo pueda estar mal!"

  - **caso_tray_pac_42_00010_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí voy tirando. ¿Usted cómo me nota la voz?"
      2. [fiebre] "Pues no le he puesto mucho cuidado a eso, la verdad... a veces siento como calorcito pero no sé si es del clima o qué. ¿Usted cree que eso es normal?"
      3. [movilidad] "Ah, eso sí, para caminar no me quejo, me muevo normal. Oiga, ¿y usted sabe si esto de la operación deja secuelas a largo plazo?"
      4. [herida] "Uy pues no le he mirado mucho, la verdad me da como cositas verla... pero creo que la he visto un poco rojita ahí alrededor, no sé si es normal eso."
      5. [apetito] "Pues casi no me da hambre, la verdad, como poquito... pero eso es normal después de la operación, ¿no? ¿Usted qué opina?"
      6. [sueno] "Ah, dormir sí duermo bien, eso no es problema. Oiga, ¿ya casi terminamos? Es que me tengo que ir a hacer una vuelta."

  - **caso_tray_pac_42_00010_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-PAIN-SCORE-CTX ("9")
      1. [dolor] "Ay, pues... como un 3, pero doctor, ¿eso es normal? Me preocupa que no esté sanando bien, ¿usted qué cree?"
      2. [dolor] "Sí señor, me la tomé hace un rato y marcó 36.9, pero ¿eso está bien? Es que yo leí por ahí que cualquier cambio puede ser peligroso, dígame que no es nada grave, por favor."
      3. [movilidad] "Ay, me muevo normal, camino solito sin ayuda, pero cada vez que me paro rápido me da miedo que se me abra algo por dentro, ¿usted cree que puede pasar eso?"
      4. [herida] "No, doctor, la he visto normalita, sin nada raro, pero igual la reviso como diez veces al día porque me da pánico que le vaya a salir algo feo de un momento a otro."
      5. [herida] "Como normal, doctor, sin náuseas ni nada, pero ¿será que puedo comer de todo ya o todavía hay algo que me pueda hacer daño?"
      6. [sueno] "He dormido bien, normal, sin despertarme por dolor ni nada, pero doctor, ¿todo esto que le conté suena bien? Dígame que voy por buen camino, por favor."

  - **caso_tray_pac_42_00011_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-PAIN-SCORE-CTX ("7")
      1. [dolor] "¡Ay doctor, qué bueno que llama! Mire, el dolor lo siento bastante fuerte, como un 6 de 10, y eso me tiene preocupado. ¿Usted cree que eso es normal o debería estar alarmado?"
      2. [dolor] "No doctor, fiebre no he sentido, me tomé la temperatura y estaba en 36.7, pero igual me da miedo que de un momento a otro me suba, ¿usted cree que puede pasar eso?"
      3. [movilidad] "Pues doctor, me cuesta bastante moverme, camino despacito y con cuidado porque siento que algo se me puede abrir por dentro, ¿usted cree que es normal sentirse tan limitado todavía?"
      4. [herida] "La herida la veo normal doctor, sin enrojecimiento ni nada raro, pero de todas formas me da nervios mirarla, ¿usted cree que aunque se vea bien puede complicarse después?"
      5. [apetito] "El apetito lo he sentido un poco bajo, como que no me provoca comer mucho, ¿eso es normal doctor o me debería preocupar también por eso?"
      6. [sueno] "El sueño también lo he sentido un poco alterado, me despierto varias veces en la noche por el dolor, ¿eso es preocupante doctor?"

  - **caso_tray_pac_42_00012_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Cómo así, hoy es el día... tres? Ay perdón, es que se me revuelven los días. El dolor está por acá en la barriga, como un 6, pero no sé si era peor ayer o antier, no me acuerdo bien."
      2. [fiebre] "No, calentura no, creo que me tomé la temperatura hoy y estaba normalita, como 36 y algo... pero no me acuerdo si fue hoy o ayer que me la tomé."
      3. [movilidad] "Pues me muevo despacito, con ayuda, como esperaban que fuera... aunque a veces se me olvida si ya me levanté hoy o si eso fue ayer, discúlpeme."
      4. [herida] "Sí, la he visto un poquito rojita alrededor, pero no le sale nada raro ni huele feo, creo... ay no sé si eso lo vi hoy o ayer, perdóneme."
      5. [apetito] "He comido normal, gracias a Dios, aunque no sé si eso fue en el almuerzo de hoy o el de ayer, ya ni sé qué día es."
      6. [sueno] "Ay, dormir casi nada, me despierto mucho por el dolor y no sé ni cuántas veces, todo revuelto en la cabeza, discúlpeme."

  - **caso_tray_pac_42_00012_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento en la zona de la herida, ahí en el abdomen. Ahorita estaría como en un 4, se siente más que todo cuando me muevo o me río."
      2. [fiebre] "Sí, señor, ayer me la tomé y estaba en 37,9°C, así como febrecita leve, nada muy alto pero sí lo he notado."
      3. [movilidad] "Pues me cuesta un poco, doctor, como es normal a estos días de la cirugía. Camino despacito, con apoyo, pero no me quedo quieta, trato de moverme aunque sea poquito."
      4. [herida] "Sí, le he visto un poco de enrojecimiento alrededor, así como un rojito leve, pero no le ha salido ningún líquido raro ni nada que huela mal. No la veo hinchada tampoco."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer mucho, pero sí como aunque sea poquitas cantidades varias veces al día."
      6. [sueno] "Pues duermo, pero no tan seguido como antes, me despierto varias veces en la noche, será por la molestia o por estar pendiente de la posición. Pero algo de sueño sí logro conciliar."

  - **caso_tray_pac_42_00013_1** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Pues mire, el dolor lo siento en la cadera, algo así como un 3 de 10. Es soportable, no es nada muy fuerte."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcaba 37.6, como una calentura leve, pero escalofríos no he sentido."
      3. [movilidad] "Pues me muevo despacito, con el andador, como es de esperarse después de la operación. No ha sido fácil pero voy avanzando poquito a poco."
      4. [herida] "La he visto normal, sin enrojecimiento ni nada raro saliendo, solo con su vendaje como debe estar."
      5. [apetito] "Sí, gracias a Dios el apetito lo tengo normal, como bien mis comiditas sin problema."
      6. [sueno] "He dormido bien, gracias a Dios, sin despertarme mucho durante la noche."

  - **caso_tray_pac_42_00013_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Hola, buenas, gracias por llamar. Pues el dolor lo siento como en un 5, algo molesto pero soportable."
      2. [fiebre] "Sí me la he tomado, hoy marcó 37.1, así que no ha sido fiebre alta, solo un poquito tibia me sentí."
      3. [movilidad] "Ay sí, gracias a Dios me he podido mover bien, camino normal con el andador que me dieron, sin mayor problema."
      4. [herida] "Pues la he visto con un poquito de rojito alrededor, leve nada más, sin hinchazón fuerte ni nada que le salga a la herida."
      5. [apetito] "Sí señora, el apetito lo tengo normal, como bien mis tres comidas sin problema."
      6. [sueno] "Pues no he dormido tan bien como antes, me despierto un poquito por el dolor, pero logro descansar algo."

  - **caso_tray_pac_42_00013_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, pues... ahí vamos, más o menos bien, gracias a Dios. Oiga, ¿usted sabe si hoy está haciendo mucho sol allá afuera?"
      2. [dolor] "Pues, calentura calentura no sé, uno a veces siente calorcito pero eso es normal a esta edad, ¿no le parece? Oiga, ¿y usted de dónde me llama, de la clínica misma o de otra parte?"
      3. [movilidad] "Ay, pues ahí voy caminando poquito a poquito, nada grave. ¿Usted ha probado esas cremas que dan ahora para las rodillas, serán buenas?"
      4. [herida] "Uy, la herida... pues normal, no le he mirado mucho la verdad. ¿Usted cree que ya casi es hora de almorzar? Es que se me está pasando el hambre."
      5. [apetito] "Ay pues sí, como normal, gracias a Dios no me falta el hambre. Oiga, ¿y usted no sabe si va a llover hoy? Es que quiero salir al patio un rato."
      6. [sueno] "Ah, duermo bien, gracias a Dios, como un bebé casi. Bueno mijo, ¿ya casi terminamos? Es que se me está enfriando el caldo."

  - **caso_tray_pac_42_00015_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, ha sido nada del otro mundo, un dolorcito ahí en la herida, como un 4 tal vez, pero es soportable."
      2. [fiebre] "Sí, me la tomé y estaba normalita, como en 37, nada de fiebre ni escalofríos, todo bien por ese lado."
      3. [movilidad] "Pues me muevo despacito, obvio, uno recién operado no va a andar corriendo, pero nada grave, ahí voy caminando poquito a poquito."
      4. [herida] "Se ve un poquito rojita ahí alrededor, pero nada de hinchazón ni de esas cosas raras que salgan, yo creo que es normal de la cicatrización."
      5. [apetito] "Como un poquito menos que antes, pero como, no crea, no es que no me provoque nada, solo un poco más despacio con la comida."
      6. [sueno] "Pues no he dormido muy bien, la verdad, me despierto varias veces, pero eso es normal después de una operación, no le pare muchas bolas a eso."

  - **caso_tray_pac_42_00016_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, es que no sé bien! Yo creo que un 5, pero es que me preocupa muchísimo, ¿eso es normal o me tengo que asustar? Dígame que no es grave, por favor."
      2. [fiebre] "No, no he sentido escalofríos ni nada así, me tomé la temperatura hace un rato y marcó 36.5, ¿eso está bien, verdad? Ay pero es que igual me preocupa, uno nunca sabe con estas cosas."
      3. [movilidad] "Ay pues me cuesta un poquito, doctor, como es apenas el primer día uno se siente todo entumido, pero camino despacito. ¿Eso es lo esperado o debería ya moverme más rápido? Es que me da miedo hacerme daño."
      4. [herida] "Ay doctor, sí noté como un poquito de rojito alrededor, pero no sale nada raro ni huele mal. ¿Eso es normal o me tengo que preocupar? Es que verla así me pone los nervios de punta."
      5. [apetito] "Pues fíjese que he comido normal, gracias a Dios, no he perdido el apetito. Pero bueno, ¿eso está bien también? Es que con todo lo demás uno ya no sabe qué esperar."
      6. [sueno] "He dormido bien, la verdad, casi normal. Pero doctor, dígame ya, ¿todo esto que le conté está bien o me tengo que preocupar por algo? Es que la ansiedad no me deja tranquila."

  - **caso_tray_pac_42_00017_7** / capa1_limpia — real: **rojo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila doctora, un poquito molesto no más, nada del otro mundo, uno aguanta."
      2. [fiebre] "Sí, me tomé la temperatura ayer, marcó como 37 y algo, nada de escalofríos ni cosas raras, tranquila."
      3. [movilidad] "Pues despacito, como es normal después de esto, pero me muevo, no crea que estoy tan mal."
      4. [herida] "Se ve un poquito rojita ahí en el borde, pero nada de esas cosas de pus ni nada raro, yo creo que es normal de la cicatrización, doctora."
      5. [apetito] "Pues como poquito, se me ha quitado un poco las ganas, pero algo paso, no se preocupe, eso ya va a mejorar."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces, pero uno ya sabe que después de una operación así es normal, no es nada grave."

  - **caso_tray_pac_42_00019_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí vamos. No sé, un poquito, no me gusta poner números a eso, ¿usted sabe?"
      2. [dolor] "Ay no sé, doctor... he sentido como un calorcito raro pero no le he puesto el termómetro bien, tal vez es del clima aquí de Bogotá."
      3. [movilidad] "Pues ahí voy despacito, hija, uno a esta edad ya no es tan ligero... ¿y usted cómo ha estado con el trabajo, mucho ajetreo?"
      4. [herida] "Ay pues no la he mirado mucho, me da como cosita verla... la enfermera me la curó ayer y dijo algo pero no le puse mucho cuidado."
      5. [apetito] "Ay, la comida... no sé, no me provoca mucho, todo me sabe raro. Pero bueno, ¿usted no me iba a preguntar sobre el sueño también?"
      6. [sueno] "Ay, hija, esas noches larguísimas, uno da vueltas y vueltas... pero no quiero quitarle más tiempo, ¿ya casi terminamos?"

  - **caso_tray_pac_42_00019_14** / capa1_limpia — real: **rojo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, ¿cómo así, mija? Espere... ¿la cirugía fue el jueves o fue la otra semana? Es que el dolor lo siento como un 6, ahí en el pecho, pero se me confunden los días."
      2. [fiebre] "Ay sí, creo que sí... me sentí como con mucho calor anoche, toda sudada, y frío al mismo tiempo, qué raro. No sé si me la tomé o fue mi hija, pero me acuerdo un número como... ¿39 algo? No estoy segura, mija."
      3. [movilidad] "Pues... uy, me cuesta un poco, mija, me siento como pesada, despacito me muevo, no sé si es normal o no a estos días... ¿usted sabe cuántos días llevo ya? Se me pierden las cuentas."
      4. [herida] "Ay, la miré ayer o antier, no sé bien... la vi como rojita, un poquito, alrededor mija, pero no le vi que saliera nada raro ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, mija, casi no me provoca comer, todo me da como asco o pereza, apenas unas cucharaditas de sopa y ya. Mi hija se preocupa porque no como casi nada."
      6. [sueno] "Ay no, casi no duermo, mija, me despierto sudada y con dolor, y no sé si es de noche o de día a veces, todo se me revuelve."

  - **caso_tray_pac_42_00021_3** / capa1_limpia — real: **verde**, predicho: **rojo**
    Hallazgos: RED-NEURO ("confusión")
      1. [dolor] "Ay, disculpe, ¿me repite la pregunta? Es que no recuerdo bien si fue ayer o hace tres días la operación... el dolor está como en un 2, algo así, ahí por la barriga."
      2. [dolor] "Eh... creo que me la tomé, sí, marcó como 37, algo normal creo... pero no sé si fue hoy o ayer, se me pierden los días, disculpe."
      3. [movilidad] "Pues me muevo despacito, como esperaba después de la operación, un poco limitado pero nada raro... ¿usted me preguntó si eso era ayer o hoy? Ya no sé bien."
      4. [herida] "La herida la he visto normal, sin nada raro, ni rojo ni con esas cosas que dice... aunque ya no me acuerdo si me la revisé hoy o ayer, perdone."
      5. [apetito] "El apetito lo he sentido normal, como siempre, no le he hallado problema... aunque no recuerdo si ayer comí bien o fue antier, se me revuelven los días."
      6. [dolor] "He dormido normal, bien, sin problema... creo que fueron dos noches así, o tres, ya perdí la cuenta, disculpe la confusión."

  - **caso_tray_pac_42_00021_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento ahí en la zona donde me operaron, en el abdomen. Ahorita como en un 5, va y viene, sobre todo cuando me muevo o me río."
      2. [fiebre] "Sí señora, me tomé la temperatura hace ratico y estaba en 37.5, como febrícula. Escalofríos fuertes no, pero sí me he sentido un poco más caliente de lo normal."
      3. [movilidad] "Pues me muevo, pero despacio, como es de esperarse a estos días de la cirugía. Levantarme de la cama o del sofá sí me cuesta un poco más de lo normal."
      4. [herida] "Sí, la he estado revisando, y tiene un enrojecimiento leve alrededor de la incisión. No hay secreción ni mal olor, gracias a Dios, pero ese rojito me tiene un poco pendiente."
      5. [apetito] "Pues el apetito lo tengo un poco bajo, como que no me provoca comer igual que antes, pero de todas maneras algo como. No es que no coma nada, pero sí menos cantidad."
      6. [sueno] "Ay, el sueño sí lo tengo bastante alterado, me despierto varias veces en la noche por el dolor y me cuesta volver a dormirme, así que descanso poquito."

  - **caso_tray_pac_42_00023_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-PAIN-SCORE-CTX ("7")
      1. [dolor] "Ay, no, tranquilo, casi ni se siente, un dolorcito por ahí de un 2, nada del otro mundo, mijo."
      2. [dolor] "No señor, nada de eso, me he sentido fresquita, normal. Me tomé la temperatura y estaba en 36.7, todo bien por ahí."
      3. [movilidad] "Ay no, muy bien, camino tranquila, sin problema, ya casi ni me acuerdo que me operaron."
      4. [herida] "No, nada de eso, la veo limpiecita y normal, ni siquiera me duele al mirarla."
      5. [apetito] "Sí señor, como bien, con ganas, no ha habido ningún problema con eso."
      6. [sueno] "Sí, duermo bien, tranquila, sin vueltas ni nada, como una bebé, mijo."

  - **caso_tray_pac_42_00025_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, gracias a Dios por llamar! El dolor está como en un 3, ahí en la herida... pero ¿eso es normal? ¿o debería preocuparme?"
      2. [fiebre] "Sí me tomé la temperatura hace un rato y marcó 37, ¿eso está bien verdad? Ay es que no he sentido escalofríos pero igual me da nervios, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues me muevo despacito, todavía me cuesta un poco, como es de esperarse después de la operación... pero ¿eso es normal doctor? ¿o ya debería estar caminando mejor a estos días?"
      4. [herida] "Ay doctor, sí noté como un poquito rojito alrededor, no sale nada raro ni huele mal, pero ese rojito me tiene asustado... ¿eso es grave? ¿debo ir a urgencias ya?"
      5. [apetito] "La verdad casi no me ha dado hambre, doctor, como muy poquito... ¿eso también es normal o me tengo que preocupar? Es que ni ganas de comer me dan."
      6. [dolor] "Pues casi no duermo bien, doctor, me despierto varias veces en la noche, no sé si es el dolor o los nervios... ¿usted cree que eso está afectando mi recuperación?"

  - **caso_tray_pac_42_00026_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay doctor, gracias a Dios que llama! Es que el dolor ha estado como en un 4, no sé si es normal, a veces siento que aumenta un poquito y me asusto mucho... ¿usted cree que está bien así o debería preocuparme?"
      2. [fiebre] "Sí señora, me tomé la temperatura y marcó 37.6°C, ¡y eso me tiene con los nervios de punta! ¿Eso ya es fiebre? Dígame la verdad, por favor, porque yo leí por ahí que eso puede ser peligroso."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, me muevo normal, sin problema... pero es que me preocupa que igual con este dolorcito algo ande mal por dentro, ¿usted no cree?"
      4. [herida] "No doctor, la herida se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo tocarla mucho, ¿será que puede empeorar si la reviso a cada rato?"
      5. [apetito] "Pues la verdad he comido menos de lo normal, como que no me provoca mucho... ¿eso es malo doctor? Es que con tanta preocupación se me quita hasta el hambre."
      6. [dolor] "Ay doctor, el sueño ha sido lo peor, casi no duermo, me despierto asustada pensando en el dolor y en si todo va bien... ¡dígame que esto es normal, por favor!"

  - **caso_tray_pac_42_00026_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay, pues... más o menos, ahí voy sobreviviendo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Uy, no sé, no le he puesto mucho cuidado a eso... aunque sí me he sentido como acalorada a ratos. ¿Usted cree que eso es normal después de la cirugía?"
      3. [movilidad] "Ah, eso sí, camino normal, no hay problema con eso... oiga, ¿usted sabe si esta llamada dura mucho? Es que tengo algo pendiente ahorita."
      4. [herida] "Pues... la he mirado poquito, no me gusta verla mucho. Se ve como un poquito rojita, pero nada más, creo... ¿eso es grave o qué?"
      5. [apetito] "Ay pues, no como casi nada, se me quita el hambre rapidito... pero bueno, eso a veces pasa, ¿no? ¿Usted cree que es por los nervios o algo así?"
      6. [sueno] "Ush, dormir casi nada, doctor... me la paso dando vueltas toda la noche. Pero bueno, ya se me pasará, ¿verdad? ¿Usted cree que esto es normal?"

  - **caso_tray_pac_42_00027_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Ah? Perdón... ¿cirugía dice? Ay, espere... el dolor por ahí lo siento leve, como un 3, aquí en la barriga... o eso creo, ya ni me acuerdo qué día es hoy."
      2. [fiebre] "Mmm, temperatura... creo que sí me la tomaron, marcó como 37, algo así normalito... pero no sé si fue hoy o ayer, todo se me revuelve."
      3. [movilidad] "Uy, moverme... sí, camino normal, sin problema, no me duele para eso... creo. ¿Ya le dije eso o me está preguntando otra vez?"
      4. [herida] "Ay, la herida... la vi como un poquito rojita, así levecito nada más, no le vi que botara nada raro... o eso me pareció, ya no sé si fue hoy que la miré."
      5. [apetito] "Ay no, casi no me da hambre, doctor... como poquitico, todo se me revuelve, ni ganas de comer tengo."
      6. [sueno] "Uy, dormir no, casi nada... me despierto a cada rato, no sé si por el dolor o por los ruidos, todo revuelto ahí en la noche, doctor."

  - **caso_tray_pac_42_00027_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, no, más o menos no más, un dolorcito ahí normal de la operación, nada del otro mundo. Si acaso un 6, pero eso ya se me pasa solo, no se preocupe."
      2. [dolor] "Pues sí me he sentido como con un poco de calorcito, pero nada de escalofríos ni nada raro. Me tomé la temperatura y salió como en 38, pero eso debe ser del calor de acá no más, doctor."
      3. [movilidad] "Ay, pues ahí vamos despacito, un poco más difícil de lo normal para levantarme, pero eso es normal después de la operación, no es nada grave. Ya me acostumbro poco a poco, no se preocupe."
      4. [herida] "La veo bien, doctor, tal vez un poquito rojita ahí en un lado, pero nada de esas cosas raras, ni pus ni nada de eso. Yo creo que eso es normal de la cicatrización, no más."
      5. [apetito] "Pues no como mucho, se me ha quitado un poco las ganas, pero eso es normal, doctor, con la operación uno no tiene mucha hambre. Náuseas no, gracias a Dios, nada de eso."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces en la noche, pero eso es normal por la incomodidad no más, nada grave doctor, ya me acostumbro."

  - **caso_tray_pac_42_00028_1** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, un dolorcito no más ahí en la cadera, como un 4 tal vez, pero eso es normal, uno aguanta."
      2. [dolor] "Sí señora, me la tomé y marcó como 37.3, casi nada, ni se siente uno mal ni nada de eso."
      3. [movilidad] "Pues ahí voy despacito, con la ayuda del andador, apenas es el primer día pues es normal que uno esté un poco tieso, nada grave."
      4. [herida] "Se ve un poquito rojita ahí alrededor, nada de esas cosas raras que salen, ni pus ni nada, capaz es normal de la cirugía no más."
      5. [apetito] "Ay pues casi no me provoca comer, pero eso es normal con tanto medicamento, no me preocupo por eso, algo como paso."
      6. [sueno] "Pues me despierto un poquito por la molestia, pero duermo mis horitas, no es nada de qué alarmarse, tranquila."

  - **caso_tray_pac_42_00028_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, ¿cómo así, perdone? ¿Me pregunta de hoy o de cuando me operaron... eso fue el lunes o el martes? Ahorita siento como un tres, por ahí en la cadera... o la rodilla, ya se me confunde cuál fue."
      2. [fiebre] "Mmm, fiebre no sé... me tomaron la temperatura hace un rato y creo que estaba normal, como en 37, pero no me acuerdo si fue hoy o ayer. Escalofríos no he sentido, eso sí se lo puedo asegurar."
      3. [movilidad] "Sí, más o menos bien, doctor... digo, señorita. Me levanto de la cama sin mucho problema, camino con el andador o lo que me dieron ahí, no me acuerdo cómo se llama, pero sí me muevo normal."
      4. [herida] "La herida... la vi esta mañana cuando me la revisó la enfermera, o fue ayer, no sé, pero se veía normal, sin nada raro, ni rojo ni con esos líquidos feos. No huele mal tampoco, eso sí me acuerdo."
      5. [apetito] "Ay, es que no tengo casi ganas de comer, señorita... me traen la bandeja y como poquito, no sé si es por los medicamentos o qué. Náuseas no, pero la comida no me provoca casi nada."
      6. [dolor] "Duermo por ratos, señorita, me despierto y no sé si es por el dolor o porque ya me acostumbré a otro horario en el hospital... pero no es que sea muy grave, así como que me despierto y ya."

  - **caso_tray_pac_42_00029_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, el dolor ha estado bastante manejable, como en un 2 de 10. Lo siento en la zona de la herida, pero es más una molestia que un dolor fuerte."
      2. [fiebre] "Sí, me la tomé hoy y marcó 37.4°C, como una febrícula leve, pero no me he sentido con escalofríos ni nada raro."
      3. [movilidad] "Sí, la movilidad la tengo normal, me levanto y camino sin problema, eso sí lo he podido hacer bien."
      4. [herida] "Le noto un poco de enrojecimiento leve alrededor de la herida, pero no he visto hinchazón fuerte ni secreción, nada de pus ni nada así."
      5. [apetito] "Pues la verdad el apetito lo tengo bastante disminuido, casi no me provoca comer, como poquito y a veces me toca obligarme."
      6. [sueno] "El sueño lo he tenido muy alterado, me despierto varias veces en la noche y me cuesta volver a conciliar el sueño."

  - **caso_tray_pac_42_00030_7** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay pues... más o menos, ahí normal, como uno se siente después de esas cosas. ¿Usted qué comió hoy?"
      2. [dolor] "Uy, no sé, no le he puesto mucha atención a eso... he estado como acalorada un poco pero no sé si eso cuenta. ¿Usted cree que eso es normal por el clima de aquí?"
      3. [movilidad] "Ah sí, ahí camino normal, sin problema... oiga, ¿y usted hace mucho este trabajo de las llamadas?"
      4. [herida] "Pues no sé, la he visto como un poquito rosadita ahí en un lado, pero nada grave, creo... ¿eso es lo que preguntaba o quería otra cosa?"
      5. [apetito] "Ay, no sé, como que no me provoca mucho comer últimamente... pero bueno, uno con el estrés a veces no come bien, ¿no? ¿Usted cree que eso influye?"
      6. [sueno] "Pues... no muy bien la verdad, me despierto varias veces, pero no sé, será que estoy nerviosa no más. ¿Ya casi terminamos? Es que me da como pereza hablar de esto."

  - **caso_tray_pac_42_00030_14** / capa1_limpia — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, pues normal, un poquito de molestia nomás, nada que no se aguante... como un 6 tal vez, pero no es tan grave, ahí voy."
      2. [fiebre] "Pues sí, me he sentido como tibia, calientica, pero no creo que sea nada, capaz es el clima... me tomé la temperatura y marcó como 38, pero eso no es mucho, ¿cierto?"
      3. [movilidad] "Pues... ha sido un poquito más difícil de lo normal, como que no me quiero ni levantar de la cama, pero eso es porque estoy vaga nomás, no es que no pueda."
      4. [herida] "Se ve un poquito rojita alrededor, pero nada de otro mundo, no le sale nada raro ni nada, seguro es normal por la cicatrización."
      5. [apetito] "Pues como poquito, casi no me provoca nada, pero eso también es normal después de una operación, ¿no? No es que esté enferma ni nada."
      6. [dolor] "Pues duermo poquito, me despierto varias veces, pero es que uno no está acostumbrado a la cama del hospital... no es nada grave, ya se me pasará."

  - **caso_tray_pac_42_00033_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¿Cómo así? Ah, perdón... ¿el dolor de qué, de la cirugía? Es que ahorita no sé si fue ayer o antier que me operaron... pero dolor casi no siento, creo."
      2. [dolor] "Mmm, ¿fiebre? Creo que no, no me he sentido con escalofríos... me tomé la temperatura hace un rato, o fue ayer, y estaba normalita, como 36 y algo."
      3. [movilidad] "Pues... para moverme he estado bien, camino normal, no me cuesta mucho... aunque a veces se me olvida si ya me paré o no, ¿me entiende? Pero de dolor o dificultad no, casi nada."
      4. [herida] "Ah sí, la herida... la vi como un poquito rojita, ahí alrededor, pero no le he visto que salga nada raro. No sé si eso es normal o no, doctor."
      5. [apetito] "Ah, el apetito... pues como que un poquito bajito, no como mucho, pero tampoco es que no quiera comer nada. No sé, normal creo."
      6. [sueno] "Duermo bien, sí... o eso creo, no me acuerdo de despertarme mucho. Normal, como siempre."

  - **caso_tray_pac_42_00033_7** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-PAIN-SCORE-CTX ("9")
      1. [dolor] "¡Hola, buenos días! Muy bien, gracias a Dios. El dolor casi no lo siento, estará como en un 1 de 10, apenas una molestia leve en la rodilla."
      2. [dolor] "Sí señora, me la he tomado y hoy marcó 36.9°C, o sea normalita. No he sentido escalofríos ni nada raro."
      3. [movilidad] "Sí, la verdad me he movido bastante bien, camino con el andador sin problema y me levanto solo sin mayor dificultad."
      4. [herida] "No señora, la herida se ve bien tranquila, sin enrojecimiento ni secreción ni mal olor, todo normal."
      5. [apetito] "El apetito lo he tenido normal, como bien, no se me ha quitado el hambre para nada."
      6. [sueno] "He dormido bien, sin problema, descanso toda la noche sin despertarme por molestias."

  - **caso_tray_pac_42_00034_14** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolorcito, un 2 más o menos, pero no sé si es normal, ¿usted cree que está bien eso? Me preocupa que vaya a empeorar."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcó 36.3°C... eso está bien, ¿cierto? Ay es que me da miedo que me vaya a dar fiebre sin darme cuenta."
      3. [movilidad] "Pues la verdad me he podido mover normal, camino y me levanto sin problema... pero ¿usted cree que no me vaya a hacer daño moverme así? Me da nervios de pronto lastimarme algo por dentro."
      4. [herida] "No señora, la he estado revisando y se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo, ¿usted cree que igual puede aparecer algo después? Eso me tiene con los nervios de punta."
      5. [apetito] "Sí, gracias a Dios he comido bien, normal... pero ¿usted cree que eso está bien? Es que a veces pienso que debería comer algo especial y no sé si lo estoy haciendo bien."
      6. [sueno] "Sí señora, he dormido bien, normal... pero ¿usted cree que es bueno dormir tanto? Ay, disculpe que pregunte tanto, es que todo esto me tiene con los nervios de punta."

  - **caso_tray_pac_42_00035_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay, no sé, como un 3! Pero dígame, ¿eso es normal o me tengo que preocupar? Es que me da mucho miedo que algo esté mal, ¿sí?"
      2. [fiebre] "Sí señor, me tomé la temperatura y marcó 37.5°C... ¿eso ya es fiebre? ¡Ay, me preocupa mucho, dígame la verdad porfa!"
      3. [movilidad] "Pues la verdad me he podido mover normal, camino sin problema... pero igual ¿eso está bien? ¿No debería sentir más dolor al moverme? ¡Ay, dígame que todo está bien, por favor!"
      4. [herida] "Ay sí, la he estado mirando y veo como un poquito rojita alrededor, nada de pus ni nada raro... ¿pero eso del rojito es grave? ¡Dígame que no es infección, por favor!"
      5. [apetito] "He estado comiendo bien, normal, sin problema... pero oiga, ¿eso del enrojecimiento no le parece que debería revisarlo un médico ya mismo? ¡Es que no me quedo tranquila!"
      6. [dolor] "He dormido bien, normal, sin interrupciones... pero por favor dígame qué hago con lo del enrojecimiento, ¡me tiene con los nervios de punta!"

  - **caso_tray_pac_42_00037_3** / capa1_limpia — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, disculpe, ¿me repite la pregunta? Es que... no sé si fue ayer o hoy la operación, se me revuelven los días. El dolor... uy, como un 6, algo fuerte, sí."
      2. [fiebre] "Eh... sí, ha sido como calentura, no sé si fue ayer o anoche... me tomé la temperatura y creo que marcó como 37 y pico, algo así."
      3. [movilidad] "Ah sí, para eso sí me he sentido bien, camino normal, sin problema... aunque a veces se me olvida si ya me levanté hoy o fue ayer, jajaja."
      4. [herida] "La herida la he visto normal, no le he visto nada raro, ni rojo ni que le salga nada... eso creo, la enfermera me la revisó hace... ¿ayer o hoy? No me acuerdo bien."
      5. [apetito] "El apetito lo tengo normal, como bien, sin problema... aunque a veces se me olvida si ya almorcé o no, jaja, ¿me repite si ya es hora del almuerzo?"
      6. [sueno] "Uy, el sueño sí lo he sentido como raro, medio alterado, me despierto y no sé si es de noche o de día... pero duermo algo, sí."

  - **caso_tray_pac_42_00038_3** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, hoy lo siento más fuertecito, como un 6 de 10, no se me quita fácil con las pastillas que me mandaron."
      2. [fiebre] "Sí señora, me tomé la temperatura hace un rato y tenía 37.4, no es muy alta pero sí me he sentido como con un poquito de calorcito. Escalofríos fuertes no, pero sí un malestarcito."
      3. [movilidad] "Pa' eso sí no me quejo, la movilidad la tengo bien, camino normal con mi andador, sin mucho problema."
      4. [herida] "Sí, le noto un poquito de enrojecimiento alrededor, como rojito leve, pero no le he visto que salga nada raro ni hinchazón grande."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "No señora, el sueño lo he tenido normal, duermo bien casi todas las noches, gracias a Dios."

  - **caso_tray_pac_42_00038_7** / capa1_limpia — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ah, pues... más o menos, ahí vamos llevándolo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Eh, no sé, no le he puesto mucho cuidado a eso... uno con tanta cosa se le olvida. ¿Eso es muy importante saberlo ya mismo?"
      3. [movilidad] "Ay, pues ahí voy caminando despacito, no me quejo de eso... oiga, ¿y usted de dónde me llama, de qué hospital es?"
      4. [herida] "Pues no la miro mucho, la verdad, mi hija me ayuda con eso... se ve normalita, no le he notado nada raro. ¿Falta mucho para terminar la llamada, es que tengo que hacer algo?"
      5. [apetito] "Ay, pues como que menos ganas he tenido, no sé, la comida no me provoca tanto... pero bueno, algo como. ¿Ya casi terminamos, doctor?"
      6. [sueno] "Ay, pues las noches han sido bien duras, casi no pego el ojo, me despierto mucho... pero bueno, eso pasa a la edad de uno, ¿no? ¿Ya terminamos ya?"

### Capa 2 (ruidosa)
  - **caso_tray_pac_42_00000_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues... la verdad, diría que un 2, aunque a veces se me hace más, pero mejor hablemos de cómo ha sido su sueño, ¿no? ... Digamos que sí, pero no tanto."
      2. [fiebre] "Pues, la temperatura ha estado rondando los 37.6 grados, no le sé decir si eso cuente como fiebre, pero la herida sigue con un leve enrojecimiento y el dolor sigue en un 2, aunque a veces parece más. ¿Y cómo ha estado su sueño últimamente?"
      3. [movilidad] "La verdad, me muevo sin mayores dificultades, aunque a veces siento un cosquilleo leve en la zona, pero mejor hablemos de cómo ha estado su apetito últimamente."
      4. [dolor] "La herida está bien, con un leve enrojecimiento, sin secreción y el dolor sigue en 2, aunque a veces parece más. Pero cuénteme, ¿cómo ha estado su apetito últimamente?"
      5. [apetito] "..."
      6. [sueno] "El sueño ha estado bastante normal, aunque a veces me cuesta un poco conciliarlo, pero cuénteme, ¿cómo ha estado su apetito últimamente? Espere, en realidad no, creo que sí me duele bastante."

  - **caso_tray_pac_42_00001_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, pues... más o menos, ahí normal digamos. Oiga, ¿usted sabe si es normal no poder dormir bien después de estas cirugías? parcero"
      2. [fiebre] "Pues no sé, no me he tomado la temperatura muy seguido... a veces siento como un calorcito, pero no sé si es de la casa o qué. ¿Usted cree que eso es raro?"
      3. [movilidad] "No, para caminar sí me muevo bien, ahí voy normal. Lo que más me tiene aporriado es que no logro dormir bien, doctor. Espere, en realidad no, creo que sí me duele bastante."
      4. [herida] "La herida la veo normal, ahí tranquila. Pero de verdad lo que más me preocupa es el sueño, casi no pego el ojo en toda la noche."
      5. [apetito] "Ah el apetito bien, como normal, sin problema. Pero oiga, ¿usted no me puede recomendar algo para el dolor y para poder dormir? Eso sí me tiene mal. Espere, en realidad no, creo que sí me duele bastante."
      6. [dolor] "Pues casi nada, doctor, me la paso dando vueltas toda la noche, el dolor como que se siente más cuando estoy acostado y no me deja pegar el ojo."

  - **caso_tray_pac_42_00001_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, qué bueno que llama! Mire, el dolor lo siento ahí en la herida, y hoy como que está en un 5, no sé si es normal o si me debo preocupar... ¿usted cree que está bien así?"
      2. [dolor] "[silencio]"
      3. [?] "Pues doctor, camino pero despacito y con cuidado, todavía me cuesta un poquito enderezarme bien... ¿eso es normal a estos días o ya debería estar caminando mejor? Es que yo lo veo lento y me preocupa."
      4. [herida] "Ay doctor, sí le noto como un rojito alrededor de la herida, no mucho pero ahí está, y eso me tiene asustado... no ha salido nada de líquido raro ni mal olor, pero ¿ese rojito es normal o ya me tengo que preocupar?"
      5. [herida] "Ay, no sé, se me olvidó lo que iba a decir."
      6. [sueno] "Ay pues no he dormido muy bien que digamos, me despierto por el dolorcito de la herida y me cuesta volver a coger el sueño... ¿eso es normal también o me debería preocupar más, doctor?"

  - **caso_tray_pac_42_00002_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolor de un 3, ahí en la zona de la operación. Pero dígame, ¿eso es normal? Me preocupa que se me vaya a complicar algo."
      2. [?] "Sí señor, me la tomé y marcó 37.3°C... ¿eso ya es fiebre, doctor? Es que yo he escuchado que después de una cirugía cualquier cosita puede ser peligrosa, ¿usted cree que está bien eso? No, olvide lo que dije, es al revés."
      3. [movilidad] "Pues me muevo despacito, como es de esperarse por la operación, pero sí me cuesta un poco más de lo normal... ¿eso está bien, doctor, o debería poder moverme más rápido? Me da miedo hacer algo mal y lastimarme por dentro."
      4. [herida] "La he visto normal, doctor, sin enrojecimiento ni nada raro, ni sale nada de ahí... pero igual la miro con mucho cuidado varias veces al día porque me da pánico que se me vaya a infectar. ¿Usted cree que así como la describo está bien?"
      5. [apetito] "Sí doctor, gracias a Dios el apetito lo tengo normal, como bien... pero ¿no será que debería comer menos por la operación? Ay, uno con tantas dudas, discúlpeme que le pregunte tanto. parcero"
      6. [sueno] "He dormido bien, normal, doctor... pero ¿será que eso es buena señal? Ay, perdone que le pregunte tanto, es que estoy muy nerviosa con toda esta recuperación. ome"

  - **caso_tray_pac_42_00003_3** / capa2_ruidosa — real: **amarillo**, predicho: **rojo** — con interrupción de tercero
    Hallazgos: RED-NEURO ("confundida")
      1. [dolor] "¿Ah? Perdón, ¿desde la ciru- [inaudible] qué día, mija? Ay, espere... yo diría que un cinco, más [inaudible] menos, pero ya [inaudible] me acuerdo si [inaudible] ayer o antier que estuvo peor."
      2. [fiebre] "Ay sí... espere, ¿me pregunta de hoy o de anoche? Creo que anoche me sentí como calientica, tenía por ahí 37 y pico, pero no sé si eso es mucho o no. ... Digamos que sí, pero no tanto."
      3. [?] "Ah, eso sí, para caminar me he sentido bien, normal, como siempre... bueno, no como siempre, sino como debe ser después de la operación, ¿sí me entiende? No he tenido problema pa' moverme, gracias a Dios."
      4. [herida] "Ay, sí, la vi como un poquito rojita ahí alrededor, pero no le he visto que le salga nada raro ni huele mal, no señor... digo, no señorita. Eso sí me tiene un poco confundida si es normal o no."
      5. [apetito] "Pues... no sé, un poquito menos que antes, como que no me provoca mucho la comida, pero de vez en cuando sí como algo. No sé si es por las pastillas o qué será."
      6. [sueno] "Ay no, eso sí ha sido muy difícil, casi no duermo, me despierto a cada rato y no sé ni qué hora es cuando abro los ojos. Muy alterado el sueño, sí señora. ... Ahí vamos, no le podría decir con seguridad."

  - **caso_tray_pac_42_00003_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, muy amable. Pues hoy lo he sentido como en un 6, algo fuerte, especialmente cuando me muevo un poquito más de la cuenta."
      2. [dolor] "Sí señor, me la tomé y estaba en 37.6, así como calientica pero sin llegar a escalofríos ni nada de eso."
      3. [movilidad] "Par- eso sí [inaudible] he sentido bien, la movi- la [inaudible] notado normal, me levanto y camino sin mayor problema."
      4. [herida] "No, la herida la he visto normal, sin enrojecimiento ni hinchazón ni nada saliendo, gracias a Dios. ome"
      5. [?] "Pues el apetito lo he notado un poquito bajo, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Ay, el sueño sí lo he tenido bien alterado, me despierto varias veces por el dolor y luego no logro volver a dormir fácil. ... Puede ser, no estoy seguro."

  - **caso_tray_pac_42_00006_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [?] "Ay, pues ahí normal, nada del otro mundo. Un dolorcito en la zona de la herida, será como un 5, pero eso es de esperarse, ¿no?"
      2. [dolor] "Me la [inaudible] ahora y marcó como 37.4, casi nada. Escalofríos no, eso sí no."
      3. [movilidad] "Eso sí bien, camino normal, me levanto solo sin problema, ahí no tengo queja."
      4. [herida] "La herida se ve bien, normal, sin enrojecimiento ni nada raro saliendo. Ahí tranquilo con eso."
      5. [apetito] "Pues la verdad es que no me ha dado mucha hambre, casi no como, pero eso debe ser normal después de la operación, no le pare muchas bolas a eso."
      6. [sueno] "He dormido bien, sin problema, ahí descansando normal."

  - **caso_tray_pac_42_00006_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Uy, disculpe, ¿qué día es hoy? Es que me hago bolas con las fechas... el dolor, mmm, no sé, como un 2 tal vez, ahí manejable, no es mucho."
      2. [?] "Eh... creo que me la tomé ayer, o antes de ayer, no le sé decir bien, y marcó como 37 y algo, no tan alta. No he sentido escalofríos, solo un calorcito raro a veces."
      3. [movilidad] "Sí, camino normal, no batallo pa' moverme... espere, ¿usted me preguntó por lo mismo la semana pasada? Es que ya perdí la cuenta de cuántos días llevo así."
      4. [herida] "Ah sí, la miré hace un rato... está como rojita alrededor, un poquito no más, no sé si es normal o qué. No he visto que salga nada raro, solo eso rojito."
      5. [apetito] "Pues como menos que antes, se me quita el hambre rapidito... no sé si es por los nervios o qué, se me olvida hasta si almorcé. Espere, en realidad no, creo que sí me duele bastante."
      6. [sueno] "Ay no, duermo muy mal, me despierto varias veces y no sé ni qué hora es cuando abro los ojos... eso sí me tiene como aturdido."

  - **caso_tray_pac_42_00007_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, doctor, pues así como leve, un 2 de 10 más o menos... pero ¿eso es normal? ¿No debería estar sintiendo más dolor a estas alturas? Me preocupa que no sea suficiente el que siento."
      2. [?] "Sí señor, me la tomé hace un rato y marcó como 36.8°C... ¿eso está bien? Ay es que yo leí por ahí que después de una cirugía puede dar fiebre de un momentico a otro y eso me tiene asustada, ¿usted cree que puede subir de un momento a otro?"
      3. [movilidad] "Pues doctor, la verdad me cuesta un poquito moverme, como es apenas el primer día pues siento que todo el cuerpo está más pesado... pero ¿eso es lo esperado? ¿No será que me estoy quedando muy quieta y me puede hacer daño?"
      4. [herida] "La he visto normalita doctor, sin enrojecimiento ni nada raro, ni mal olor... pero es que no sé bien cómo revisarla, ¿usted cree que la estoy viendo bien? Me da miedo no darme cuenta si algo anda mal."
      5. [apetito] "Pues doctor, la verdad he comido un poquito menos de lo normal, como que no me da mucha hambre... ¿eso es preocupante? ¿No será que necesito comer más para recuperarme bien? No, olvide lo que dije, es al revés."
      6. [sueno] "He dormido bien normalito doctor, sin problema para dormir... pero dígame, ¿todo lo que le he contado está bien? ¡Es que me tiene con los nervios de punta pensar que algo pueda estar mal!"

  - **caso_tray_pac_42_00010_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más [inaudible] menos, ahí voy tirando. ¿Usted [inaudible] me nota la voz?"
      2. [fiebre] "Pues no le he puesto mucho cuidado a eso, la verdad... a veces siento como calorcito pero no sé si es del clima o qué. ¿Usted cree que eso es normal?"
      3. [movilidad] "Ah, eso sí, para caminar no me quejo, me muevo normal. Oiga, ¿y usted sabe si esto de la operación deja secuelas a largo plazo?"
      4. [herida] "Uy pues no le he mirado mucho, la verdad me da como cositas verla... pero creo que la he visto un poco rojita ahí alrededor, no sé si es normal eso."
      5. [apetito] "Pues casi no me da hambre, la verdad, como poquito... pero eso es normal después de la operación, ¿no? ¿Usted qué opina?"
      6. [sueno] "Ah, dormir sí duermo bien, eso no es problema. Oiga, ¿ya casi terminamos? Es que me tengo que ir a hacer una vuelta."

  - **caso_tray_pac_42_00010_14** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-PAIN-SCORE-CTX ("9")
      1. [dolor] "Ay, pues... como un 3, pero doctor, ¿eso es normal? Me preocupa que no esté sanando bien, ¿usted qué cree? Bueno, eso dije, pero ayer le dije lo contrario."
      2. [dolor] "Sí señor, me la tomé hace un rato y marcó 36.9, pero ¿eso está bien? Es que yo leí por ahí que cualquier cambio puede ser peligroso, dígame que no es nada grave, por favor."
      3. [movilidad] "Ay, me muevo normal, camino solito sin ayuda, pero cada vez que me paro rápido me da miedo que se me abra algo por dentro, ¿usted cree que puede pasar eso?"
      4. [?] "No, doctor, la he visto normalita, sin nada raro, pero igual la reviso como diez veces al día porque me da pánico que le vaya a salir algo feo de un momento a otro."
      5. [herida] "Como normal, doctor, sin náuseas ni nada, pero ¿será que puedo comer de todo ya o todavía hay algo que me pueda hacer daño? ... Ahí vamos, no le podría decir con seguridad."
      6. [sueno] "He dormido bien, normal, sin despertarme por dolor ni nada, pero doctor, ¿todo esto que le conté suena bien? Dígame que voy por buen camino, por favor."

  - **caso_tray_pac_42_00011_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-PAIN-SCORE-CTX ("7")
      1. [dolor] "¡Ay doctor, qué bueno que llama! Mire, [inaudible] dolor lo siento bastante fue- como un 6 de 10, [inaudible] [inaudible] me tiene preocupado. ¿Ust- cree que eso es normal o debería estar alarmado?"
      2. [dolor] "No doctor, fiebre no he sentido, me tomé la temperatura y estaba en 36.7, pero igual me da miedo que de un momento a otro me suba, ¿usted cree que puede pasar eso?"
      3. [movilidad] "Pues doctor, me cuesta bastante moverme, camino despacito y con cuidado porque siento que algo se me puede abrir por dentro, ¿usted cree que es normal sentirse tan limitado todavía?"
      4. [?] "La herida la veo normal doctor, sin enrojecimiento ni nada raro, pero de todas formas me da nervios mirarla, ¿usted cree que aunque se vea bien puede complicarse después?"
      5. [?] "El apetito lo he sentido un poco bajo, como que no me provoca comer mucho, ¿eso es normal doctor o me debería preocupar también por eso?"
      6. [sueno] "El sueño también lo he sentido un poco alterado, me despierto varias veces en la noche por el dolor, ¿eso es preocupante doctor?"

  - **caso_tray_pac_42_00012_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Cómo así, hoy es el día... tres? Ay perdón, es que se me revuelven los días. El dolor está por acá en la barriga, como un 6, pero no sé si era peor ayer o antier, no me acuerdo bien."
      2. [?] "No, calentura no, creo que me tomé la temperatura hoy y estaba normalita, como 36 y algo... pero no me acuerdo si fue hoy o ayer que me la tomé. ... Puede ser, no estoy seguro."
      3. [movilidad] "Pues me muevo despacito, con ayuda, como esperaban que fuera... aunque a veces se me olvida si ya me levanté hoy o si eso fue ayer, discúlpeme."
      4. [herida] "Sí, la he visto un poquito rojita alrededor, pero no le sale nada raro ni huele feo, creo... ay no sé si eso lo vi hoy o ayer, perdóneme. ... Digamos que sí, pero no tanto."
      5. [apetito] "He comido normal, gracias a Dios, aunque no sé si eso fue en el almuerzo de hoy o el de ayer, ya ni sé qué día es."
      6. [sueno] "Ay, dormir casi nada, me despierto mucho por el dolor y no le sé decir ni cuántas veces, todo revuelto en la cabeza, discúlpeme."

  - **caso_tray_pac_42_00012_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no sé, se me olvidó lo que iba a decir."
      2. [fiebre] "Sí, señor, ayer me la tomé y estaba en 37,9°C, así como febrecita leve, nada muy alto pero sí lo he notado."
      3. [movilidad] "Pues me cuesta un poco, doctor, como es normal a estos días de la cirugía. Camino despacito, con apoyo, pero no me quedo quieta, trato de moverme aunque sea poquito."
      4. [herida] "Sí, le he visto un poco de enrojecimiento alrededor, así como un rojito leve, pero no le ha salido ningún líquido raro ni nada que huela mal. No la veo hinchada tampoco. ... Pues no sé, más o menos."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer mucho, pero sí como aunque sea poquitas cantidades varias veces al día."
      6. [sueno] "Pues duermo, pero no tan seguido como antes, me despierto varias veces en la noche, será por la molestia o por estar pendiente de la posición. Pero algo de sueño sí logro conciliar."

  - **caso_tray_pac_42_00013_1** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Pues mire, el dolor lo siento en la cadera, algo así como un 3 de 10. Es soportable, no es nada muy fuerte."
      2. [dolor] "Sí señora, me la tomé hace un rato y marcaba 37.6, como una calentura leve, pero escalofríos no he sentido."
      3. [movilidad] "Pues me muevo despacito, con el andador, como es de esperarse después de la operación. No ha sido fácil pero voy avanzando poquito a poco. Bueno, eso dije, pero ayer le dije lo contrario."
      4. [?] "La he visto normal, sin enrojecimiento ni nada raro saliendo, solo con su vendaje como debe estar. ... No me acuerdo bien, la verdad."
      5. [apetito] "Sí, gracias a Dios el apetito lo tengo normal, como bien mis comiditas sin problema. parcero"
      6. [sueno] "He dormido bien, gracias a Dios, sin despertarme mucho durante la noche."

  - **caso_tray_pac_42_00013_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Hola, buenas, gracias por llamar. Pues el dolor lo siento como en un 5, algo molesto pero soportable."
      2. [fiebre] "Sí me la he tomado, hoy marcó 37.1, así que no ha sido fiebre alta, solo un poquito tibia me sentí. No, olvide lo que dije, es al revés."
      3. [movilidad] "Ay, no sé, se me olvidó lo que iba a decir."
      4. [herida] "Pues la he visto con un poquito de rojito alrededor, leve nada más, sin hinchazón fuerte ni nada que le salga a la herida."
      5. [apetito] "[silencio]"
      6. [sueno] "Pues no he dormido tan bien como antes, me despierto un poquito por el dolor, pero logro descansar algo."

  - **caso_tray_pac_42_00013_14** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "Ay, pues... ahí vamos, más o menos bien, gracias a Dios. Oiga, ¿usted sabe si hoy está haciendo mucho sol allá afuera?"
      2. [dolor] "[inaudible] calentura [inaudible] [inaudible] sé, [inaudible] a veces [inaudible] calorcito pero eso es normal [inaudible] est- edad, [inaudible] [inaudible] parece? Oiga, ¿y [inaudible] de [inaudible] me llama, de la clínica misma o [inaudible] ot- parte?"
      3. [movilidad] "Ay, pues ahí voy caminando poquito a poquito, nada grave. ¿Usted ha probado esas cremas que dan ahora para las rodillas, serán buenas?"
      4. [herida] "Uy, la herida... pues normal, no le he mirado mucho la verdad. ¿Usted cree que ya casi es hora de almorzar? Es que se me está pasando el hambre."
      5. [apetito] "[inaudible] pues sí, como nor- gracias a Dios no me falta el hambre. Oiga, ¿y usted no sab- si va a llover hoy? Es que qui- salir al patio [inaudible] rato."
      6. [?] "Ah, duermo bien, gracias a Dios, como un bebé casi. Bueno mijo, ¿ya casi terminamos? Es que se me está enfriando el caldo."

  - **caso_tray_pac_42_00015_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, ha sido nada del otro mundo, un dolorcito ahí en la herida, como un 4 tal vez, pero es soportable."
      2. [fiebre] "Sí, me la tomé y estaba normalita, como en 37, nada de fiebre ni escalofríos, todo bien por ese lado."
      3. [movilidad] "Pues me muevo despacito, obvio, uno recién operado no va a andar corriendo, pero nada grave, ahí voy caminando poquito a poquito."
      4. [herida] "Se ve un poquito rojita ahí alrededor, pero nada de hinchazón ni de esas cosas raras que salgan, yo creo que es normal de la cicatrización."
      5. [apetito] "..."
      6. [sueno] "Pues no he dormido muy bien, la verdad, me despierto varias veces, pero eso es normal después de una operación, no le pare muchas bolas a eso."

  - **caso_tray_pac_42_00016_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, es que no sé bien! Yo creo que un 5, pero es que me preocupa muchísimo, ¿eso es normal o me tengo que asustar? Dígame que no es grave, por favor."
      2. [?] "[silencio]"
      3. [movilidad] "Ay pues me cuesta un poquito, doctor, como es apenas el primer día uno se siente todo entumido, pero camino despacito. ¿Eso es lo esperado o debería ya moverme más rápido? Es que me da miedo hacerme daño."
      4. [herida] "Ay doctor, sí noté como un poquito de rojito alrededor, pero no sale nada raro ni huele mal. ¿Eso es normal o me tengo que preocupar? Es que verla así me pone los nervios de punta."
      5. [apetito] "Pues fíjese que he comido normal, gracias a Dios, no he perdido el apetito. Pero bueno, ¿eso está bien también? Es que con todo lo demás uno ya no sabe qué esperar."
      6. [sueno] "Este... no, nada, siga con la otra pregunta."

  - **caso_tray_pac_42_00017_7** / capa2_ruidosa — real: **rojo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila doctora, un poquito molesto no más- nada del otro [inaudible] uno aguanta."
      2. [fiebre] "Sí, me tomé la temperatura ayer, marcó como 37 y algo, nada de escalofríos ni cosas raras, tranquila."
      3. [movilidad] "Este... no, nada, siga con la otra pregunta."
      4. [herida] "Se ve un poquito rojita ahí en el borde, pero nada de esas cosas de pus ni nada raro, yo creo que es normal de la cicatrización, doctora."
      5. [apetito] "..."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces, pero uno ya sabe que después de una operación así es normal, no es nada grave. ... Pues no sé, más o menos."

  - **caso_tray_pac_42_00019_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, pues... más o menos, ahí vamos. No sé, un poquito, no me gusta poner números a eso, ¿usted sabe? ... Pues no sé, más o menos."
      2. [dolor] "..."
      3. [movilidad] "Pues ahí voy despacito, hija, uno a esta edad ya no es tan ligero... ¿y usted cómo ha estado con el trabajo, mucho ajetreo?"
      4. [herida] "Ay pues no la he mirado mucho, me da como cosita verla... la enfermera me la curó ayer y dijo algo pero no le puse mucho cuidado."
      5. [apetito] "Ay, la comida... no sé, no me provoca mucho, todo me sabe raro. Pero bueno, ¿usted no me iba a preguntar sobre el sueño también?"
      6. [sueno] "Ay, hija, esas noches larguísimas, uno da vueltas y vueltas... pero no quiero quitarle más tiempo, ¿ya casi terminamos?"

  - **caso_tray_pac_42_00019_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-MOBILITY ("no puedo levantarme")
      1. [dolor] "Buenas, mijo. El dolor lo siento en el pecho, donde la cirugía, y hoy lo sentiría como un 5, más incómodo que otros días. Espere, en realidad no, creo que sí me duele bastante."
      2. [dolor] "[inaudible] señor, me he sentido como afiebr- me tomé la temperatura y marcó [inaudible] [inaudible] he sentido un poco de escalofrío."
      3. [movilidad] "Ay, muy mal, la verdad. Antes me movía sola sin problema y ahora casi no puedo levantarme, necesito que alguien me ayude para todo. ... Ahí vamos, no le podría decir con seguridad."
      4. [herida] "Pues la he visto un poco enrojecida alrededor, un eritema leve como le dicen, pero no le he visto secreción ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, casi no me provoca comer nada, se me ha ido mucho el apetito estos días, como poquito y a las fuerzas."
      6. [sueno] "No, mijo, he dormido muy mal, me despierto varias veces por el dolor y el malestar, casi no descanso."

  - **caso_tray_pac_42_00019_14** / capa2_ruidosa — real: **rojo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, ¿cómo así, mija? Espere... ¿la cirugía fue el jueves o fue la otra semana? Es que el dolor lo siento como un 6, ahí en el pecho, pero se me confunden los días."
      2. [fiebre] "Ay sí, creo que sí... me sentí como con mucho calor anoche, toda sudada, y frío al mismo tiempo, qué raro. No sé si me la tomé o fue mi hija, pero me acuerdo un número como... ¿39 algo? No estoy segura, mija."
      3. [movilidad] "Pues... uy, me cuesta un poco, mija, me siento como pesada, despacito me muevo, no sé si es normal o no a estos días... ¿usted sabe cuántos días llevo ya? Se me pierden las cuentas."
      4. [herida] "Ay, la miré ayer o antier, no sé bien... la vi como rojita, un poquito, alrededor mija, pero no le vi que saliera nada raro ni mal olor, gracias a Dios."
      5. [apetito] "Ay no, mija, casi no me provoca comer, todo me da como asco o pereza, apenas unas cucharaditas de sopa y ya. Mi hija se preocupa porque no como casi nada. No, olvide lo que dije, es al revés."
      6. [sueno] "Ay no, casi no duermo, mija, me despierto sudada y con dolor, y no sé si es de noche o de día a veces, todo se me revuelve."

  - **caso_tray_pac_42_00021_3** / capa2_ruidosa — real: **verde**, predicho: **rojo** — con interrupción de tercero
    Hallazgos: RED-NEURO ("confusión")
      1. [?] "Este... no, nada, siga con la otra pregunta."
      2. [dolor] "Eh... creo que me la tomé, sí, marcó como 37, algo normal creo... pero no sé si fue hoy o ayer, se me pierden los días, disculpe."
      3. [movilidad] "Pues me muevo despacito, como esperaba después de la operación, un poco limitado pero nada raro... ¿usted me preguntó si eso era ayer o hoy? Ya no le sé decir bien."
      4. [herida] "La herida la he visto normal, sin nada raro, ni rojo ni con esas cosas que dice... aunque ya no me acuerdo si me la revisé hoy o ayer, perdone. Bueno, eso dije, pero ayer le dije lo contrario."
      5. [apetito] "El apetito lo he sentido normal, como siempre, no le he hallado problema... aunque no recuerdo si ayer comí bien o fue antier, se me revuelven los días."
      6. [?] "He dormido normal, bien, sin problema... creo que fueron dos noches así, o tres, ya perdí la cuenta, disculpe la confusión."

  - **caso_tray_pac_42_00021_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Buenas, pues el dolor lo siento ahí en la zona donde me operaron, en el abdomen. Ahorita como en un 5, va y viene, sobre todo cuando me muevo o me río."
      2. [fiebre] "Sí señora, [inaudible] tomé la temperatura ha- ratico y [inaudible] en 37.5, como febrícula. Escalofríos [inaudible] no, pero [inaudible] me he sentido [inaudible] poco más caliente de [inaudible] normal."
      3. [movilidad] "Pues me muevo, pero despacio, como es de esperarse a estos días de la cirugía. Levantarme de la cama o del sofá sí me cuesta un poco más de lo normal."
      4. [herida] "Sí, la he estado revisando, y tiene un enrojecimiento leve alrededor de la incisión. No hay secreción ni mal olor, gracias a Dios, pero ese rojito me tiene un poco pendiente."
      5. [apetito] "Pues el apetito lo tengo un poco bajo, como que no me provoca comer igual que antes, pero de todas maneras algo como. No es que no coma nada, pero sí menos cantidad."
      6. [sueno] "Ay, el sueño sí lo tengo bastante alterado, me despierto varias veces en la noche por el dolor y me cuesta volver a dormirme, así que descanso poquito."

  - **caso_tray_pac_42_00025_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¡Ay doctor, gracias a Dios por llamar! El dolor está como en un 3, ahí en la herida... pero ¿eso es normal? ¿o debería preocuparme? pues"
      2. [?] "Sí me tomé la temperatura hace un rato y marcó 37, ¿eso está bien verdad? Ay es que no he sentido escalofríos pero igual me da nervios, ¿usted cree que puede subir de un momento a otro? ome"
      3. [movilidad] "Pues me muevo despacito, todavía me cuesta un poco, como es de esperarse después de la operación... pero ¿eso es normal doctor? ¿o ya debería estar caminando mejor a estos días? pues"
      4. [herida] "Ay doctor, sí noté como un poquito rojito alrededor, no sale nada raro ni huele mal, pero ese rojito me tiene asustado... ¿eso es grave? ¿debo ir a urgencias ya?"
      5. [apetito] "[silencio]"
      6. [dolor] "Pues casi no duermo bien, doctor, me despierto varias veces en la noche, no sé si es el dolor o los nervios... ¿usted cree que eso está afectando mi recuperación?"

  - **caso_tray_pac_42_00026_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay doctor, gracias a Dios que llama! Es que el dolor ha estado como en un 4, no sé si es normal, a veces siento que aumenta un poquito y me asusto mucho... ¿usted cree que está bien así o debería preocuparme? ... Pues no sé, más o menos."
      2. [fiebre] "Sí señora, me tomé la temperatura y marcó 37.6°C, ¡y eso me tiene con los nervios de punta! ¿Eso ya es fiebre? Dígame la verdad, por favor, porque yo leí por ahí que eso puede ser peligroso. Espere, en realidad no, creo que sí me duele bastante."
      3. [movilidad] "Ah, eso sí, para caminar me he sentido bien, me muevo normal, sin problema... pero es que me preocupa que igual con este dolorcito algo ande mal por dentro, ¿usted no cree?"
      4. [?] "No doctor, la herida se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo tocarla mucho, ¿será que puede empeorar si la reviso a cada rato?"
      5. [apetito] "Pues la verdad he comido menos de lo normal, como que no me provoca mucho... ¿eso es malo doctor? Es que con tanta preocupación se me quita hasta el hambre. ... Digamos que sí, pero no tanto."
      6. [dolor] "Ay doctor, el sueño ha sido lo peor, casi no duermo, me despierto asustada pensando en el dolor y en si todo va bien... ¡dígame que esto es normal, por favor!"

  - **caso_tray_pac_42_00026_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay, pues... más o menos, ahí voy sobreviviendo. ¿Usted cómo ha estado, todo bien por allá? Espere, en realidad no, creo que sí me duele bastante."
      2. [fiebre] "Uy, no sé, no le he puesto mucho cuidado a eso... aunque sí me he sentido como acalorada a ratos. ¿Usted cree que eso es normal después de la cirugía?"
      3. [movilidad] "Ah, eso sí, camino normal, no hay problema con eso... oiga, ¿usted sabe si esta llamada dura mucho? Es que tengo algo pendiente ahorita."
      4. [herida] "Pues... la he mirado poquito, no me gusta verla mucho. Se ve como un poquito rojita, pero nada más, creo... ¿eso es grave o qué?"
      5. [apetito] "Ay pues, no como casi nada, se me quita el hambre rapidito... pero bueno, eso a veces pasa, ¿no? ¿Usted cree que es por los nervios o algo así? parcero"
      6. [sueno] "Ush, dormir casi nada, doctor... me la paso dando vueltas toda la noche. Pero bueno, ya se me pasará, ¿verdad? ¿Usted cree que esto es normal?"

  - **caso_tray_pac_42_00027_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "¿Ah? Perdón... ¿cirugía dice? Ay, espere... el dolor por ahí lo siento leve, como un 3, aquí en la barriga... o eso creo, ya ni me acuerdo qué día es hoy."
      2. [fiebre] "Mmm, temperatura... creo que sí me la tomaron, marcó como 37, algo así normalito... pero no le sé decir si fue hoy o ayer, todo se me revuelve."
      3. [movilidad] "Uy, moverme... sí, camino normal, sin problema, no me duele para eso... creo. ¿Ya le dije eso o me está preguntando otra vez?"
      4. [herida] "Ay, la herida... la vi como un poquito rojita, así levecito nada más, no le vi que botara nada raro... o eso me pareció, ya no sé si fue hoy que la miré."
      5. [apetito] "..."
      6. [sueno] "Uy, dormir no, casi nada... me despierto a cada rato, no sé si por el dolor o por los ruidos, todo revuelto ahí en la noche, doctor."

  - **caso_tray_pac_42_00027_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, no, más o menos no más, un dolorcito ahí normal de la operación, nada del otro mundo. Si acaso un 6, pero eso ya se me pasa solo, no se preocupe."
      2. [dolor] "Pues sí me he sentido como con un poco de calorcito, pero nada de escalofríos ni nada raro. Me tomé la temperatura y salió como en 38, pero eso debe ser del calor de acá no más, doctor. ... Ahí vamos, no le podría decir con seguridad."
      3. [movilidad] "Ay, pues ahí vamos despacito, un poco más difícil de lo normal [inaudible] levantarme, pero eso es normal después de [inaudible] operación, no es nada [inaudible] Ya me [inaudible] poco a [inaudible] no se preocupe."
      4. [herida] "La veo bien, doctor, tal vez un poquito rojita ahí en un lado, pero nada de esas cosas raras, ni pus ni nada de eso. Yo creo que eso es normal de la cicatrización, no más."
      5. [apetito] "Pues no como mucho, se me ha quitado un poco las ganas, pero eso es normal, doctor, con la operación uno no tiene mucha hambre. Náuseas no, gracias a Dios, nada de eso."
      6. [sueno] "Pues no muy bien que digamos, me despierto varias veces en la noche, pero eso es normal por la incomodidad no más, nada grave doctor, ya me acostumbro. ome"

  - **caso_tray_pac_42_00028_1** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ay, no, tranquila, un dolorcito no más ahí en la cadera, com- un 4 [inaudible] vez, pero eso es [inaudible] uno aguanta."
      2. [dolor] "Sí señora, me la tomé y marcó como 37.3, casi nada, ni se siente uno mal ni nada de eso."
      3. [movilidad] "Pues ahí voy despacito, con la ayuda del andador, apenas es el primer día pues es normal que uno esté un poco tieso, nada grave."
      4. [herida] "Se ve un poquito rojita ahí alrededor, nada de esas cosas raras que salen, ni pus ni nada, capaz es normal de la cirugía no más. ... Ahí vamos, no le podría decir con seguridad."
      5. [apetito] "Ay pues casi no me provoca comer, pero eso es normal con tanto medicamento, no me preocupo por eso, algo como paso."
      6. [sueno] "Pues me despierto un poquito por la molestia, pero duermo mis horitas, no es nada de qué alarmarse, tranquila."

  - **caso_tray_pac_42_00028_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay, ¿cómo así, perdone? ¿Me pregunta de hoy o de cuando me operaron... eso fue el lunes o el martes? Ahorita siento como un tres, por ahí en la cadera... o la rodilla, ya se me confunde cuál fue."
      2. [fiebre] "[inaudible] fiebre no sé... me tomaron la temperatura hace [inaudible] rato y creo que estaba normal, como en 37, pero no me acuerdo si fue hoy o ayer. Escalofríos no he sentido, eso [inaudible] se [inaudible] puedo asegurar."
      3. [movilidad] "Sí, más o menos bien, doctor... digo, señorita. Me levanto de la cama sin mucho problema, camino con el andador o lo que me dieron ahí, no me acuerdo cómo se llama, pero sí me muevo normal."
      4. [?] "La herida... la vi esta mañana cuando me la revisó la enfermera, o fue ayer, no sé, pero se veía normal, sin nada raro, ni rojo ni con esos líquidos feos. No huele mal tampoco, eso sí me acuerdo."
      5. [apetito] "Ay, es que no tengo casi ganas de comer, señorita... me traen la bandeja y como poquito, no sé si es por los medicamentos o qué. Náuseas no, pero la comida no me provoca casi nada."
      6. [dolor] "Duermo por ratos, señorita, me despierto y no sé si es por el dolor o porque ya me acostumbré a otro horario en el hospital... pero no es que sea muy grave, así como que me despierto y ya."

  - **caso_tray_pac_42_00028_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo**
    Hallazgos: AMBER-WOUND ("líquido ahí, como amarillito")
      1. [?] "Ay, pues no ha sido tan grave, algo de dolor ahí en la cadera, será un 5 más o menos, pero uno aguanta, no se preocupe. parcero"
      2. [fiebre] "Pues [inaudible] me [inaudible] sen- un poco calientica, la tomé y marcaba como [inaudible] y algo, pero yo creo que [inaudible] [inaudible] calor de [inaudible] casa, no le he puesto mucho cuidado."
      3. [?] "Ay no, en eso sí estoy bien, camino normal, sin problema, ahí me muevo tranquila por la casa."
      4. [herida] "Pues sí le sale un poquito de líquido ahí, como amarillito, pero no es mucho, yo creo que es normal de la sanada, no me preocupa mucho."
      5. [apetito] "Este... no, nada, siga con la otra pregunta."
      6. [?] "Pues duermo poquito, me despierto varias veces en la noche, pero eso es normal a esta edad, no es nada grave, ya cogeré el sueño."

  - **caso_tray_pac_42_00029_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [dolor] "Pues mire, el dolor ha estado bastante manejable, como en un 2 de 10. Lo siento en la zona de la herida, pero es más una molestia que un dolor fuerte."
      2. [fiebre] "Sí, me la tomé hoy y marcó 37.4°C, como una febrícula leve, pero no me he sentido con escalofríos ni nada raro. Espere, en realidad no, creo que sí me duele bastante."
      3. [?] "Sí, la movilidad la tengo normal, me levanto y camino sin problema, eso sí lo he podido hacer bien. parcero"
      4. [herida] "Le noto un poco de enrojecimiento leve alrededor de la herida, pero no he visto hinchazón fuerte ni secreción, nada de pus ni nada así."
      5. [apetito] "Pues la verdad el apetito lo tengo bastante disminuido, casi no me provoca comer, como poquito y a veces me toca obligarme."
      6. [sueno] "El sueño lo he tenido muy alterado, me despierto varias veces en la noche y me cuesta volver a conciliar el sueño."

  - **caso_tray_pac_42_00030_7** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("acalorada")
      1. [dolor] "Ay pues... más o menos, ahí normal, como uno se siente después de esas cosas. ¿Usted qué comió hoy? No, olvide lo que dije, es al revés."
      2. [dolor] "Uy, no sé, no le he puesto mucha atención a eso... he estado como acalorada un poco pero no sé si eso cuenta. ¿Usted cree que eso es normal por el clima de aquí?"
      3. [movilidad] "[inaudible] sí, ahí camino normal, [inaudible] problema... oiga, ¿y usted hace mucho este trabajo de las llamadas?"
      4. [herida] "Pues no sé, la he visto como un poquito rosadita ahí en un lado, pero nada grave, creo... ¿eso es lo que preguntaba o quería otra cosa?"
      5. [apetito] "Ay, no sé, como que no me provoca mucho comer últimamente... pero bueno, uno con el estrés a veces no come bien, ¿no? ¿Usted cree que eso influye?"
      6. [sueno] "Pues... no muy bien la verdad, me despierto varias veces, pero no sé, será que estoy nerviosa no más. ¿Ya casi terminamos? Es que me da como pereza hablar de esto."

  - **caso_tray_pac_42_00030_14** / capa2_ruidosa — real: **rojo**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("38")
      1. [dolor] "Ay, pues normal, un poquito de molestia nomás, nada que no se aguante... como un 6 tal vez, pero no es tan grave, ahí voy."
      2. [fiebre] "Pues sí, me he sentido como tibia, calientica, pero no creo que sea nada, capaz es el clima... me tomé la temperatura y marcó como 38, pero eso no es mucho, ¿cierto?"
      3. [movilidad] "Pues... ha sido un poquito más difícil de lo normal, como que no me quiero ni levantar de la cama, pero eso es porque estoy vaga nomás, no es que no pueda."
      4. [herida] "Se ve un poquito rojita alrededor, pero nada de otro mundo, no le sale nada raro ni nada, seguro es normal por la cicatrización."
      5. [apetito] "Pues como poquito, casi no me provoca nada, pero eso también es normal después de una operación, ¿no? No es que esté enferma ni nada."
      6. [dolor] "Pues duermo poquito, me despierto varias veces, pero es que uno no está acostumbrado a la cama del hospital... no es nada grave, ya se me pasará."

  - **caso_tray_pac_42_00033_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¿Cómo así? Ah, perdón... ¿el dol- de qué, de [inaudible] [inaudible] Es que ahorita no sé si [inaudible] ayer [inaudible] antie- que me [inaudible] pero [inaudible] casi no sien- creo."
      2. [dolor] "Mmm, ¿fiebre? Creo que no, no me he sentido con escalofríos... me tomé la temperatura hace un rato, o fue ayer, y estaba normalita, como 36 y algo."
      3. [movilidad] "Pues... para moverme he estado bien, camino normal, no me cuesta mucho... aunque a veces se me olvida si ya me paré o no, ¿me entiende? Pero de dolor o dificultad no, casi nada."
      4. [herida] "Ah sí, la herida... la vi como un poquito rojita, ahí alrededor, pero no le he visto que salga nada raro. No sé si eso es normal o no, doctor. ... Digamos que sí, pero no tanto."
      5. [apetito] "Ah, el apetito... pues como que un poquito bajito, no como mucho, pero tampoco es que no quiera comer nada. No sé, normal creo."
      6. [sueno] "Duermo bie- sí... o [inaudible] [inaudible] no me acuerdo [inaudible] despertarme mucho. Normal, como siempre."

  - **caso_tray_pac_42_00033_7** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-PAIN-SCORE-CTX ("9")
      1. [dolor] "¡Hola, buenos días! Muy bien, gracias a Dios. El dolor casi no lo siento, estará como en un 1 de 10, apenas una molestia leve en la rodilla. ... Digamos que sí, pero no tanto."
      2. [dolor] "Sí señora, me la he tomado y hoy marcó 36.9°C, o sea normalita. No he sentido escalofríos ni nada raro."
      3. [movilidad] "[inaudible] [inaudible] verdad me he movido bastante bien, camino con el andador sin problema y me levanto [inaudible] sin mayor dificu-"
      4. [herida] "No señora, la herida se ve bien tranquila, sin enrojecimiento ni secreción ni mal olor, todo normal."
      5. [apetito] "El apetito lo he tenido normal, como bien, no se me ha quitado el hambre para nada."
      6. [sueno] "He dormido bien, sin problema, descanso toda la noche sin despertarme por molestias. No, olvide lo que dije, es al revés."

  - **caso_tray_pac_42_00034_14** / capa2_ruidosa — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "Ay doctor, pues... siento como un dolorcito, un 2 más o menos, pero no sé si es normal, ¿usted cree que está bien eso? Me preocupa que vaya a empeorar."
      2. [?] "Sí señora, me la tomé hace un rato y marcó 36.3°C... eso está bien, ¿cierto? Ay es que me da miedo que me vaya a dar fiebre sin darme cuenta."
      3. [movilidad] "Pues la verdad me he podido mover normal, camino y me levanto sin problema... pero ¿usted cree que no me vaya a hacer daño moverme así? Me da nervios de pronto lastimarme algo por dentro."
      4. [herida] "No señora, la he estado revisando y se ve normal, sin enrojecimiento ni nada raro saliendo... pero igual me da miedo, ¿usted cree que igual puede aparecer algo después? Eso me tiene con los nervios de punta. No, olvide lo que dije, es al revés."
      5. [apetito] "Sí, gracias a Dios he comido bien, normal... pero ¿usted cree que eso está bien? Es que a veces pienso que debería comer algo especial y no sé si lo estoy haciendo bien. ... Pues no sé, más o menos."
      6. [sueno] "Sí señora, he dormido bien, normal... pero ¿usted cree que es bueno dormir tanto? Ay, disculpe que pregunte tanto, es que todo esto me tiene con los nervios de punta."

  - **caso_tray_pac_42_00035_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo**
    Hallazgos: AMBER-FEVER ("fiebre")
      1. [dolor] "¡Ay, no sé, como un 3! Pero dígam- ¿eso es normal o me tengo que preocupar? Es que me da mucho miedo que algo esté mal, ¿sí?"
      2. [fiebre] "Sí señor, me tomé la temperatura y marcó 37.5°C... ¿eso ya es fiebre? ¡Ay, me preocupa mucho, dígame la verdad porfa!"
      3. [movilidad] "Pues la verdad me he podido mover normal, camino sin problema... pero igual ¿eso está bien? ¿No debería sentir más dolor al moverme? ¡Ay, dígame que todo está bien, por favor!"
      4. [herida] "Ay sí, la he estado mirando y veo como un poquito rojita alrededor, nada de pus ni nada raro... ¿pero eso del rojito es grave? ¡Dígame que no es infección, por favor! No, olvide lo que dije, es al revés."
      5. [apetito] "He estado comiendo bien, normal, sin problema... pero oiga, ¿eso del enrojecimiento no le parece que debería revisarlo un médico ya mismo? ¡Es que no me quedo tranquila! parcero"
      6. [dolor] "He dormido bien, normal, sin interrupciones... pero por favor dígame qué hago con lo del enrojecimiento, ¡me tiene con los nervios de punta!"

  - **caso_tray_pac_42_00037_3** / capa2_ruidosa — real: **verde**, predicho: **amarillo** — con interrupción de tercero
    Hallazgos: AMBER-FEVER ("calentura")
      1. [dolor] "[silencio]"
      2. [fiebre] "Eh... sí, ha sido como calentura, no sé si fue ayer o anoche... me tomé la temperatura y creo que marcó como 37 y pico, algo así. ... Digamos que sí, pero no tanto."
      3. [movilidad] "..."
      4. [herida] "La [inaudible] la [inaudible] visto normal, no le [inaudible] visto nada raro, ni rojo ni que le salga nada... eso creo, [inaudible] enfermera me la revisó hace... ¿ayer o hoy? [inaudible] [inaudible] acuerdo bien."
      5. [apetito] "El apetito lo tengo normal, como bien, sin problema... aunque a veces se me olvida si ya almorcé o no, jaja, ¿me repite si ya es hora del almuerzo?"
      6. [sueno] "Uy, el sueño sí lo he sentido como raro, medio alterado, me despierto y no sé si es de noche o de día... pero duermo algo, sí."

  - **caso_tray_pac_42_00038_3** / capa2_ruidosa — real: **amarillo**, predicho: **verde**
    Hallazgos: (ninguno)
      1. [?] "Pues mire, hoy lo siento más fuertecito, como un 6 de 10, no se me quita fácil con las pastillas que me mandaron. parcero"
      2. [fiebre] "Sí señora, me tomé la temperatura hace un rato y tenía 37.4, no es muy alta pero sí me he sentido como con un poquito de calorcito. Escalofríos fuertes no, pero sí un malestarcito."
      3. [movilidad] "Pa' eso sí no me quejo, la movilidad la tengo bien, camino normal con mi andador, sin mucho problema. parcero"
      4. [herida] "Este... no, nada, siga con la otra pregunta."
      5. [apetito] "Pues el apetito lo tengo un poquito bajito, como que no me provoca comer tanto como antes, pero algo como."
      6. [sueno] "Este... no, nada, siga con la otra pregunta."

  - **caso_tray_pac_42_00038_7** / capa2_ruidosa — real: **amarillo**, predicho: **verde** — con interrupción de tercero
    Hallazgos: (ninguno)
      1. [dolor] "Ah, pues... más o menos, ahí vamos llevándolo. ¿Usted cómo ha estado, todo bien por allá?"
      2. [fiebre] "Eh, no sé, no le he puesto mucho cuidado a eso... uno con tanta cosa se le olvida. ¿Eso es muy importante saberlo ya mismo?"
      3. [movilidad] "Ay, pues ahí voy caminando despacito, no me quejo de eso... oiga, ¿y usted de dónde me llama, de qué hospital es?"
      4. [herida] "Pues no la miro mucho, la verdad, mi hija me ayuda con eso... se ve normalita, no le he notado nada raro. ¿Falta mucho para terminar la llamada, es que tengo que hacer algo?"
      5. [apetito] "Ay, pues como que menos ganas he tenido, no le sé decir, la comida no me provoca tanto... pero bueno, algo como. ¿Ya casi terminamos, doctor?"
      6. [sueno] "Ay, pues las noches han sido bien duras, casi no pego el ojo, me despierto mucho... pero bueno, eso pasa a la edad de uno, ¿no? ¿Ya terminamos ya?"
