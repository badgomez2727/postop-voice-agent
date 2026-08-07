# Recuperación — después de los 4 arreglos en `src/rag.js`

Contraparte de `docs/recuperacion-baseline.md`. Captura de
`node tools/probar-recuperacion.js` con los 4 arreglos aplicados:

1. Score crudo + umbral absoluto configurable (`rawScore`, `minAbsoluteScore`,
   default 0.04) — commit `4da0b26`.
2. Filtro duro de fragmentos por debajo de `MIN_CHUNK_TOKENS` + penalización
   continua por estructura de portada/metadato/tabla de contenido
   (`fragmentQuality`) — commit `4da0b26`.
3. Penalización por longitud con piso en 0.5 (`lengthPenalty`) — commit
   `4da0b26`.
4. Título y nota de fuente extraídos como metadato antes de fragmentar
   (`extractFrontMatter`), fuera del texto indexado — este commit.

Índice: 108 documentos, **2026 fragmentos** (línea base: 2165; después de 1-3:
2130; después de 4: 2026 — cada extracción de encabezado reduce en algo el
fragmento #1 de cada documento, así que algunos que apenas pasaban
`MIN_CHUNK_TOKENS` por el empuje del título ya no lo pasan).

## El veredicto: NO se cumplió

**Pregunta:** "¿Cuándo debo llamar de inmediato si tengo fiebre después de la
cirugía?" — debía recuperar `01-signos-de-alarma-generales.md` en el top-3.

**Resultado:** no aparece. Queda en el puesto **#6** de 2000, con
`rawScore=0.11` contra `0.1394` del primer lugar — un margen del 21%, cerrado
pero real. El top-3 completo son tres fragmentos de
`total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md`,
una guía de cadera con un FAQ larguísimo y muy repetitivo ("¿Cuándo podré
conducir?", "¿Cuándo podré nadar?", "¿Cuándo podré volver a tener relaciones
sexuales?", etc.) que en un momento sí dice, literalmente: *"tiene una
debilidad o inestabilidad nueva, fiebre, escalofríos, sudoración o
debilidad/malestar general, contáctenos de inmediato."*

Eso no es basura ni metadato — es un fragmento genuinamente relevante, de un
documento real, sobre fiebre como señal de alarma. El problema no es que el
sistema alucine o cite ruido: es que **un documento largo con muchas preguntas
repetidas domina el ranking sobre un documento corto y preciso**, porque
TF-IDF sobre fragmentos no sabe que `01-signos-de-alarma-generales.md` es
justo el documento que responde la pregunta — solo cuenta palabras. De los 8
primeros resultados, 5 vienen del mismo documento de cadera (posiciones 1, 2,
3, 4, 5 y 8 son todas `reemplazo-total-de-cadera-guia-para-el-paciente.md`,
solo la 6 y la 7 son de otros documentos). Ninguno de los 4 arreglos de hoy
ataca eso — apuntan a calidad de fragmento y honestidad del umbral, no a
diversidad de documentos en el ranking ni a similitud semántica real.

## Lo que sí se ganó con el arreglo 4 (encabezado fuera del índice)

Comparando el mismo `docs/recuperacion-despues.md` contra la corrida
intermedia (después de 1-3, antes de 4): la pregunta sobre cáncer de cuello
uterino mejoró de forma medible. Antes de 4, el resultado #3 traía la nota de
fuente colada en el texto:

```
"por > `tools/ingestar-corpus.js`. Puede incluir ruido de extracción
(encabezados, > pies de página, columnas mezcladas). EN COLOMBIA, MÁS DE"
```

Después de 4, ese mismo documento (`cancer-de-cuello-uterino-mar-2022.md`)
sube al puesto **#1**, limpio, con contenido real desde la primera palabra:

```
"EN COLOMBIA, MÁS DE LA MITAD DE LAS MUJERES DIAGNOSTICADAS CON CÁNCER DE
CUELLO UTERINO FALLECEN POR ESTA CAUSA. ● De los 4.742 casos nuevos..."
```

Es una mejora real y medible, solo que no es la que decidía el veredicto.

## Las tres piezas de evidencia para el informe

1. **Portadas dominando** — resuelto por los arreglos 2 y 3 (confirmado:
   ninguna de las 6 preguntas de prueba trae ya un fragmento de portada en el
   top-3, contra 4 de 6 en la línea base).
2. **Ruido puntuando sobre señal** — documentado en el commit `4da0b26`:
   "estoy bien, gracias" (0.067, sin relación clínica) puntúa más alto que
   "tengo fiebre" (0.055, síntoma real). Ningún umbral separa los dos sin
   sacrificar uno.
3. **El documento correcto ausente** — este documento. Ni portada ni
   metadato: contenido real de un documento real, de un tema adyacente,
   ganándole al documento que sí responde la pregunta, por volumen de
   fragmentos repetitivos.

Las tres apuntan a la misma conclusión: TF-IDF sobre fragmentos no tiene
manera de saber que un documento es *el* documento correcto para una
pregunta — solo cuenta palabras que coinciden, y un documento largo y
repetitivo puede ganarle a uno corto y preciso por volumen. Recuperación
híbrida (embeddings para similitud semántica de documento completo, TF-IDF
para términos exactos) es la vía documentada en `docs/DECISIONS.md`
(decisión 2, "Con dos semanas más") — con esta corrida como evidencia medida,
no como intuición.

## Captura completa (después de los 4 arreglos)

```
Índice: 108 documentos, 2026 fragmentos.

==============================================================================
[cholecystitis]
Pregunta: ¿Cuáles son los signos de infección de la herida después de una colecistectomía?
------------------------------------------------------------------------------
  1. sourceId=02-cuidado-de-la-herida.md#1  rawScore=0.2337  relevance=1  title=Cuidado de la herida quirúrgica
     "## Indicaciones de cuidado El apósito debe mantenerse limpio y seco. Si se humedece o se mancha, se cambia siguiendo la indicación entregada al egreso. No se de…"
  2. sourceId=cholecystitis--estandar-clinico-basado-en-la-evidencia-diagnostico-y-tratamiento-del-pacie.md#41  rawScore=0.1507  relevance=0.645  title=Estándar Clínico Basado en la Evidencia- Diagnóstico y tratamiento del paciente con colecistitis aguda calculosa en el Hospital Universitario Nacional
     "elevado (ICC ≥ 6 y ASA - PS ≥ 3) se indica tratamiento médico y drenaje vesicular temprano o urgente. (NE D; GRADE) (7). Conclusiones 25 • Tokio III: La colecis…"
  3. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md#19  rawScore=0.1452  relevance=0.621  title=Reemplazo total de cadera Guía para el paciente
     ". • Andador (en general se lo proporciona el hospital). • Silla/banco para ducha. • Asiento elevador para inodoro. 19 Visitas de seguimiento Dentro de los 10 a …"

==============================================================================
[total joint replacement]
Pregunta: ¿Cuánto dolor es normal sentir después de un reemplazo total de rodilla y cuándo debo preocuparme?
------------------------------------------------------------------------------
  1. sourceId=total-joint-replacement--factores-asociados-con-la-insatisfaccion-de-los-pacientes-en-los.md#32  rawScore=0.2996  relevance=1
  2. sourceId=total-joint-replacement--factores-asociados-con-la-insatisfaccion-de-los-pacientes-en-los.md#7  rawScore=0.2843  relevance=0.949
  3. sourceId=total-joint-replacement--niveles-de-dolor-rigidez-y-funcionalidad-en-reemplazo-primario-de.md#22  rawScore=0.235  relevance=0.784

==============================================================================
[colorectal cancer]
Pregunta: ¿Con qué frecuencia debo hacerme controles después de una cirugía por cáncer colorrectal?
------------------------------------------------------------------------------
  1. sourceId=colorectal-cancer--guia-de-manejo-para-el-diagnostico-tratamiento-seguimiento-y-paliacion.md#44  rawScore=0.1466  relevance=1
  2. sourceId=colorectal-cancer--guia-de-manejo-para-el-diagnostico-tratamiento-seguimiento-y-paliacion.md#13  rawScore=0.1426  relevance=0.973  (líder de puntos de TOC — sobrevive con score bajo, no se cuela por delante de contenido real)
  3. sourceId=colorectal-cancer--guia-de-manejo-para-el-diagnostico-tratamiento-seguimiento-y-paliacion.md#132  rawScore=0.1381  relevance=0.942

==============================================================================
[appendicitis]
Pregunta: ¿Qué cuidados debo tener en casa después de una apendicectomía?
------------------------------------------------------------------------------
  1. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-pacientes-y-cuidadores-el-cam.md#13  rawScore=0.1734  relevance=1
  2. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md#24  rawScore=0.1355  relevance=0.781
  3. sourceId=appendicitis--apendicitis.md#9  rawScore=0.116  relevance=0.669  title=Apendicitis

==============================================================================
[breast_cancer (corpus real: cáncer de cuello uterino, no de mama)]
Pregunta: ¿Qué signos de alarma debo vigilar después de una cirugía por cáncer de cuello uterino?
------------------------------------------------------------------------------
  1. sourceId=breast-cancer--cancer-de-cuello-uterino-mar-2022.md#1  rawScore=0.2841  relevance=1  (antes de este arreglo, la nota de fuente contaminaba este mismo fragmento y lo dejaba en el puesto #3)
  2. sourceId=breast-cancer--cervical-es-patient.md#22  rawScore=0.2587  relevance=0.911
  3. sourceId=breast-cancer--cervical-es-patient.md#21  rawScore=0.2473  relevance=0.87

==============================================================================
[corpus sintético original]
Pregunta: ¿Cuándo debo llamar de inmediato si tengo fiebre después de la cirugía?
------------------------------------------------------------------------------
  1. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md#24  rawScore=0.1394  relevance=1
  2. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-pacientes-y-cuidadores-el-cam.md#13  rawScore=0.1128  relevance=0.809
  3. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md#9  rawScore=0.1125  relevance=0.807

  01-signos-de-alarma-generales.md#1 (el documento correcto) está en el puesto #6, rawScore=0.11 — 21% por debajo del primer lugar.
```
