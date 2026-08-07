# Recuperación — línea base antes de arreglos en `src/rag.js`

Captura de `node tools/probar-recuperacion.js` contra el `src/rag.js` original
(commit `bb06b86`, antes de normalización absoluta, filtro de portada y
penalización por longitud). Índice: 108 documentos, 2165 fragmentos.

Este documento es la referencia para comparar antes/después. No se edita
después de escrito — la comparación va en el resumen de la conversación o en
un documento aparte, para que esta captura quede intacta como línea base.

## Qué se observa

Con `relevance` normalizada por el máximo del lote (siempre hay un 1.0), tres
problemas se repiten en las 6 preguntas de prueba:

1. **El fragmento mejor puntuado suele ser una portada o un título, no
   contenido clínico.** En 4 de 6 preguntas, el resultado #1 o #2 es el primer
   fragmento del documento (`#1`), dominado por el título repetido y la nota
   de fuente (`> Fuente: ...`) que añade `tools/ingestar-corpus.js` — texto
   con alta densidad de las palabras de la pregunta pero sin una sola oración
   clínica. Ejemplo: la pregunta sobre dolor en reemplazo de rodilla trae como
   top-1 y top-2 dos portadas (`recom-endaciones-programa...#1` en 1.0,
   `plan-casero...#1` en 0.977) antes que cualquier fragmento con contenido
   real sobre dolor esperado.

2. **Sin umbral absoluto, un resultado sin contenido útil nunca se descarta.**
   El único filtro es `minScore = 0.02` sobre el score ya normalizado — como
   el mejor fragmento del lote siempre se normaliza a 1.0, ese umbral nunca
   excluye nada. No hay forma hoy de que el sistema diga "no tengo información
   sobre eso": siempre devuelve los k mejores, sean relevantes o no.

3. **Falla real, no solo cosmética: la última pregunta pierde el documento
   correcto por completo.** "¿Cuándo debo llamar de inmediato si tengo fiebre
   después de la cirugía?" debería traer `01-signos-de-alarma-generales.md`
   (que dice explícitamente "fiebre igual o superior a 38.5 grados" como
   signo de alarma inmediato). En vez de eso, el top-3 completo son fragmentos
   de portada de ERAS colorrectal y de una guía de cadera — el documento
   correcto no aparece ni en el top-3. Un agente que solo cita lo que
   recupera, respondería sobre protocolos ERAS a una pregunta sobre fiebre.

## Captura completa

```
Índice: 108 documentos, 2165 fragmentos.

==============================================================================
[cholecystitis]
Pregunta: ¿Cuáles son los signos de infección de la herida después de una colecistectomía?
------------------------------------------------------------------------------
  1. sourceId=02-cuidado-de-la-herida.md#1  file=02-cuidado-de-la-herida.md  position=1  relevance=1
     "# Cuidado de la herida quirúrgica > Documento de ejemplo con fines de desarrollo. Contenido sintético. ## Indicaciones de cuidado El apósito debe mantenerse lim…"
  2. sourceId=cholecystitis--plan-de-cuidado-colecistectomia.md#1  file=cholecystitis--plan-de-cuidado-colecistectomia.md  position=1  relevance=0.656
     "# PLAN DE CUIDADO COLECISTECTOMIA > Fuente: `../reto-oficial/dataset/textos/cholecystitis/PLAN DE CUIDADO COLECISTECTOMIA.pdf` (carpeta original: cholecystitis)…"
  3. sourceId=02-cuidado-de-la-herida.md#2  file=02-cuidado-de-la-herida.md  position=2  relevance=0.603
     "erida. - Aumento del calor local acompañado de dolor creciente. - Separación de los bordes de la herida o de los puntos. ## Baño e higiene El paciente puede bañ…"

==============================================================================
[total joint replacement]
Pregunta: ¿Cuánto dolor es normal sentir después de un reemplazo total de rodilla y cuándo debo preocuparme?
------------------------------------------------------------------------------
  1. sourceId=total-joint-replacement--recom-endaciones-programa-reemplazo-articular-de-rodilla.md#1  file=total-joint-replacement--recom-endaciones-programa-reemplazo-articular-de-rodilla.md  position=1  relevance=1
     "# Recom endaciones Programa Reemplazo Articular de Rodilla > Fuente: `../reto-oficial/dataset/textos/total joint replacement/Recom endaciones Programa Reemplazo…"
  2. sourceId=total-joint-replacement--plan-casero-reemplazo-total-de-rodilla.md#1  file=total-joint-replacement--plan-casero-reemplazo-total-de-rodilla.md  position=1  relevance=0.977
     "# PLAN CASERO REEMPLAZO TOTAL DE RODILLA > Fuente: `../reto-oficial/dataset/textos/total joint replacement/PLAN CASERO REEMPLAZO TOTAL DE RODILLA.pdf` (carpeta …"
  3. sourceId=total-joint-replacement--niveles-de-dolor-rigidez-y-funcionalidad-en-reemplazo-primario-de.md#23  file=total-joint-replacement--niveles-de-dolor-rigidez-y-funcionalidad-en-reemplazo-primario-de.md  position=23  relevance=0.972
     "e revisión de reemplazo de rodilla o cadera (R.R.R o R.R.C), por lo que la muestra final fue de 61 pacientes (Figura 1). 22 Nota. Población de estudio. Registro…"

==============================================================================
[colorectal cancer]
Pregunta: ¿Con qué frecuencia debo hacerme controles después de una cirugía por cáncer colorrectal?
------------------------------------------------------------------------------
  1. sourceId=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md#1  file=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md  position=1  relevance=1
     "# Protocolo de recuperación mejorada después de cirugía (ERAS) atenúa el estrés y acelera la recuperación en pacientes después de resección radical por cáncer c…"
  2. sourceId=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md#8  file=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md  position=8  relevance=0.635
     "a previa 108 23,7 % Radioterapia previa 73 16 % *DE: Desviación estándar. Fuente: Elaboración propia de los autores. 223 Recuperación mejorada después de cirugí…"
  3. sourceId=colorectal-cancer--efecto-de-la-implementacion-de-las-recomendaciones-del-protocolo-de-rec.md#1  file=colorectal-cancer--efecto-de-la-implementacion-de-las-recomendaciones-del-protocolo-de-rec.md  position=1  relevance=0.623
     "# Efecto de la implementación de las recomendaciones del protocolo de recuperación mejorada después de cirugía (ERAS) en cirugía colorrectal en un hospital de r…"

==============================================================================
[appendicitis]
Pregunta: ¿Qué cuidados debo tener en casa después de una apendicectomía?
------------------------------------------------------------------------------
  1. sourceId=appendicitis--plan-de-cuidado-en-casa-de-paciente-en-postoperatorio-de-apendicectomia.md#1  file=appendicitis--plan-de-cuidado-en-casa-de-paciente-en-postoperatorio-de-apendicectomia.md  position=1  relevance=1
     "# PLAN DE CUIDADO EN CASA DE PACIENTE EN POSTOPERATORIO DE APENDICECTOMÍA > Fuente: `../reto-oficial/dataset/textos/Appendicitis/PLAN DE CUIDADO EN CASA DE PACI…"
  2. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-pacientes-y-cuidadores-el-cam.md#13  file=total-joint-replacement--reemplazo-total-de-cadera-guia-para-pacientes-y-cuidadores-el-cam.md  position=13  relevance=0.538
     "esponja con mango largo, para así alcanzar sus extremidades inferiores con facilidad. 13 ANTES Reemplazo Total de Cadera Preparación para su recuperación La rec…"
  3. sourceId=breast-cancer--cervical-es-patient.md#66  file=breast-cancer--cervical-es-patient.md  position=66  relevance=0.525
     "porte, el cuidado de los niños y la atención domiciliaria?  ¿Hay otros servicios disponibles para mí y mis cuidadores? 66 NCCN Guidelines for Patients ® Cáncer…"

==============================================================================
[breast_cancer (corpus real: cáncer de cuello uterino, no de mama)]
Pregunta: ¿Qué signos de alarma debo vigilar después de una cirugía por cáncer de cuello uterino?
------------------------------------------------------------------------------
  1. sourceId=breast-cancer--cervical-es-patient.md#22  file=breast-cancer--cervical-es-patient.md  position=22  relevance=1
     "de útero, 2026 3 Estadificación Cáncer de cuello de útero en estadio 1B1 El cáncer mide más de 5 mm pero menos de 2 cm. 21 NCCN Guidelines for Patients ® Cáncer…"
  2. sourceId=breast-cancer--cervix16nov-full.md#2  file=breast-cancer--cervix16nov-full.md  position=2  relevance=0.92
     "ON DIAGNÓSTICO DE CÁNCER DE CUELLO UTERINO INVASIVO GUÍA PARA LA ATENCIÓN, EL MANEJO Y EL CUIDADO CA L I - CO LO M B I A GUÍA PARA LA ATENCIÓN, EL MANEJO Y EL C…"
  3. sourceId=breast-cancer--cervix16nov-full.md#64  file=breast-cancer--cervix16nov-full.md  position=64  relevance=0.92
     "VO66 67 GUÍA PARA LA ATENCIÓN, EL MANEJO Y EL CUIDADO DE PACIENTES CON DIAGNÓSTICO DE CÁNCER DE CUELLO UTERINO INVASIVO GUÍA PARA LA ATENCIÓN, EL MANEJO Y EL CU…"

==============================================================================
[corpus sintético original]
Pregunta: ¿Cuándo debo llamar de inmediato si tengo fiebre después de la cirugía?
------------------------------------------------------------------------------
  1. sourceId=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md#1  file=colorectal-cancer--protocolo-de-recuperacion-mejorada-despues-de-cirugia-eras-atenua-el-es.md  position=1  relevance=1
     "# Protocolo de recuperación mejorada después de cirugía (ERAS) atenúa el estrés y acelera la recuperación en pacientes después de resección radical por cáncer c…"
  2. sourceId=colorectal-cancer--efecto-de-la-implementacion-de-las-recomendaciones-del-protocolo-de-rec.md#1  file=colorectal-cancer--efecto-de-la-implementacion-de-las-recomendaciones-del-protocolo-de-rec.md  position=1  relevance=0.604
     "# Efecto de la implementación de las recomendaciones del protocolo de recuperación mejorada después de cirugía (ERAS) en cirugía colorrectal en un hospital de r…"
  3. sourceId=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md#24  file=total-joint-replacement--reemplazo-total-de-cadera-guia-para-el-paciente.md  position=24  relevance=0.558
     "cirugía, según su plan de fisioterapia. Debe pensar que usará un andador o bastón durante las primeras 2 a 4 semanas. 24 ¿Cuándo podré conducir y viajar? La may…"
```
