# Decisiones técnicas

Notas de trabajo. Sirven de insumo para el informe final y para la segunda
pregunta del video ("la decisión técnica más relevante, alternativas evaluadas,
riesgos y qué cambiarías con dos semanas más").

## 1. El escalamiento lo deciden reglas, no el modelo

**Decisión.** La clasificación de riesgo vive en `src/triage.js` como reglas
deterministas sobre el texto del paciente. El modelo conversa, pregunta y
parafrasea; no decide si se alerta a un humano.

**Alternativas evaluadas.**
- Pedirle al modelo que devuelva el nivel de riesgo en el JSON de cada turno.
  Descartada: la decisión de despertar a un clínico tiene que ser reproducible
  y auditable, y un modelo puede cambiar de criterio entre dos llamadas
  idénticas.
- Clasificador entrenado. Descartada por tiempo y por falta de datos
  etiquetados en tres días.

**Riesgos.** Las reglas por expresiones regulares no cubren todas las formas de
describir un síntoma. Mitigación parcial: el glosario regional en la base de
conocimiento y una categoría explícita de "requiere aclaración" que fuerza al
agente a pedir concreciones en vez de clasificar a ciegas.

**Con dos semanas más.** Modelo como segundo evaluador en paralelo: las reglas
mantienen la decisión, y una discrepancia entre reglas y modelo se marca para
revisión humana. Nunca al revés.

## 2. Recuperación local, sin embeddings

**Decisión.** TF-IDF en memoria sobre fragmentos de los documentos, con
reindexado completo en cada cambio de la base.

**Por qué.** Cumple el requisito de conocimiento en caliente de forma trivial
—subir un documento reindexa y el agente ya lo usa; borrarlo lo olvida— y el
proyecto corre sin costo de API mientras se construye el resto.

**Riesgos.** Sin coincidencia semántica: si el paciente dice "me hierve el
cuerpo" y el documento dice "fiebre", TF-IDF no los relaciona. Mitigación
actual: el glosario coloquial es parte del corpus, así que la expresión
coloquial y el término clínico coexisten en el mismo fragmento.

**Con dos semanas más.** Recuperación híbrida: embeddings para similitud
semántica más TF-IDF para términos exactos, combinando ambos rankings. El
reindexado completo tampoco escala más allá de unos cientos de documentos.

## 3. Trazabilidad como parte de la interfaz, no del log

**Decisión.** Cada respuesta del agente se muestra en el registro de evidencia
con el fragmento que la sustenta y su relevancia. Un turno sin documento de
respaldo se marca en ámbar, en vivo.

**Por qué.** El requisito de trazabilidad se puede cumplir escribiendo en un
archivo de log, pero entonces nadie lo mira. Hacerlo visible durante la llamada
convierte la ausencia de fundamento en algo evidente y no en algo que se
descubre auditando después.

## 4. El modelo detrás de un adaptador

**Decisión.** Todo lo específico del proveedor está en `src/llm.js`, y con
`LLM_PROVIDER=none` el sistema conversa con un planificador guionado.

**Por qué.** El modelo obligatorio se anuncia el 7 de agosto. Toda la
arquitectura se puede construir y probar antes sin depender de esa definición, y
además la degradación a guion evita que una falla de red corte una llamada.

## 5. El modelo, por eliminación: solo quedan los dos locales

**Decisión.** De los cuatro modelos permitidos por el reto (regla 4 de
CLAUDE.md), dos ya no son opciones reales al 7 de agosto de 2026:

- **Google Gemini 1.5 Flash** — la API responde 404. El modelo fue retirado.
- **Llama 3.1 70B vía Groq** — Groq descontinuó el modelo; ya no está
  disponible en su consola ni en su API.

Verificado contra la API en vivo, no contra documentación desactualizada —
ambos fallan hoy, no es una suposición.

Eso deja únicamente los dos modelos locales de la lista cerrada:

- **Llama 3.2 1B o 3B** (local, CPU)
- **Phi-3.5 Mini 3.8B** (local, CPU)

**Medición real — prompt corto.** En esta máquina (6 núcleos, 12 GB tras
ajustar el `.wslconfig` de WSL2), con un prompt corto (sin el system prompt
completo, historial de turnos ni pasajes del RAG en el contexto):

| Modelo | Mediciones (s) | Mediana | Desviación |
|---|---|---|---|
| Llama 3.2 3B | 9.0 / 8.1 / 8.75 | 8.6s | <1s |
| Phi-3.5 Mini | 4.9 / 9.7 | ~7s | ~5s de rango |

**Decisión: Llama 3.2 3B**, por consistencia. La rúbrica exige reportar P95,
no solo mediana — un modelo con el doble de dispersión que el otro da un P95
mucho peor de lo que su mediana sugiere, así su mediana sea menor. Phi-3.5
queda documentada como alternativa (`LLM_MODEL=phi3.5`, sin tocar código —
ver `.env.example`), no descartada: si el balance latencia/calidad cambia
con más medición, sigue siendo una opción de la lista cerrada.

**Implementado en `src/llm.js`:** proveedor `ollama`, apuntando a
`http://localhost:11434/v1/chat/completions` (API compatible con OpenAI, sin
llave). Si Ollama no responde, degrada a diálogo guionado como el resto de
los proveedores — con una advertencia visible en la consola del servidor,
no solo en el registro de la llamada, para que un fallo del modelo no pase
desapercibido durante una demo o una prueba.

**Medición real — turno completo con contexto realista.** La medición de
prompt corto de arriba **no representa la latencia de una llamada real**.
Con el prompt del sistema completo, un turno de conversación y 3 pasajes del
RAG recuperados (~1100–1500 tokens de entrada, contra los ~100-200 del
prompt corto), medido contra el servidor corriendo:

| Prueba | Tokens de entrada | Tokens de salida | Latencia total |
|---|---|---|---|
| Turno vía `/api/calls/:id/turns` | 1488 | 43 | **104 s** |
| Llamada directa a Ollama (`/api/chat`, con desglose nativo) | 1159 | 191 | **215 s** (145s de prompt eval + 69s de generación) |

Esto es **10 a 25 veces más lento** que los 8.6s medidos con prompt corto, no
un margen menor. El desglose nativo de Ollama muestra que el cuello de
botella es el *procesamiento* del prompt (prompt eval), no la generación de
la respuesta: ~8 tokens/s de prefill en esta CPU. Cuantos más tokens entren
al modelo — system prompt, historial acumulado, pasajes del RAG — más lento
el turno, independientemente de qué tan corta sea la respuesta.

**Esto ponía en riesgo la compuerta G4** (conversación de voz en tiempo real)
tal como estaba entonces. Tres mitigaciones, implementadas y medidas:

### 6a. Enrutamiento selectivo — no invocar el modelo en la mayoría de los turnos

Las preguntas del guion clínico (`SCRIPT` en `src/llm.js`) son fijas y
correctas; `scriptedReply()` ya las resuelve en milisegundos. El modelo
ahora se reserva para lo que el guion no puede resolver: respuesta ambigua
(`assessment.needsClarification`), o pregunta del paciente fuera de guion
que el RAG sí puede fundamentar (hay evidencia recuperada). Un caso rojo
**nunca** invoca el modelo — el mensaje de escalamiento es fijo, ya está
probado, y en una emergencia la velocidad de la respuesta importa tanto
como su contenido. Ver `necesitaModelo()` en `src/llm.js` para el detalle
completo de la regla.

Medido contra el servidor real, `LLM_PROVIDER=ollama`:

| Turno | Antes (siempre invocaba) | Después (enrutado) |
|---|---|---|
| Caso rojo | 104-215s | **7 ms** |
| Respuesta de guion normal | 104-215s | **9 ms** |

`session.js` ahora agrega `metrics.engineCounts` en el resumen de la llamada
(`scripted` / `scripted-routed` / `llm` / `scripted-fallback`) — la prueba
de que el enrutamiento está funcionando, no solo una afirmación.

**Corrección posterior — `PATRON_PREGUNTA_PACIENTE` sobre-disparaba.** La
versión inicial de `esPreguntaDelPaciente()` marcaba como pregunta cualquier
frase que EMPEZARA con qué/cómo/cuándo/dónde/por qué/puedo/debo/será/es
normal/está bien, con o sin "?". Contra el servidor real, "Puedo caminar
despacio, sin ayuda" (una afirmación) invocó al modelo y gastó 70+ segundos
en un turno que el guion resolvía solo. No fue aislado: contra las 1.920
respuestas de paciente de `data/dataset_final.json`, 27 arrancan con "como"
(verbo comer, "Como bien, doctor, sin problema") que la clase de caracteres
de "cómo" hacía indistinguible de una pregunta — cero de esas 27 son
preguntas reales. Corregido exigiendo señal explícita de interrogación
(`¿` o `?`, en cualquier posición) y nada más — un heurístico de palabra
inicial no distingue confiablemente pregunta de afirmación en español.
800 de 1.920 turnos de paciente reales (41.7%) traen el signo, densidad
suficiente para no dejar sin invocar la mayoría de las preguntas genuinas.
Riesgo aceptado: una transcripción de voz que no puntúe una pregunta real
no se enruta al modelo — costo de naturalidad conversacional, no de
seguridad (`triage.js` evalúa cada turno igual, invoque o no al modelo).
Cubierto en `tests/run-llm-routing-tests.mjs`.

**Riesgo confirmado en vivo (2026-08-09), no solo teórico.** Darío
preguntó tres veces por voz real "¿qué es la enzima Rubisco-Kest7?" contra
el servidor con Groq activo (prueba de G5, `docs/DECISIONS.md` no tenía
esto registrado con evidencia real todavía). El reconocimiento de voz del
navegador transcribió las tres sin ningún "?" ("Qué es la enzima rubisco
que 7", "Qué es la enzima rubisco", "Qué es la enzima rubisco Qué es 7")
y las tres cayeron al guion (`scripted-routed`), sin invocar al modelo ni
citar el documento nuevo. El riesgo documentado arriba no es hipotético:
es el comportamiento real observado la primera vez que alguien probó una
pregunta genuina por voz, no escrita. No se corrige hoy -- reabrir el
heurístico de palabra inicial bajo presión del último día es exactamente
el riesgo que la corrección de arriba ya midió y evitó. Mitigación para
demo/video: usar el campo de texto (`public/index.html`, "O escriba lo
que dice el paciente") para mostrar el camino `llm`/RAG en cámara, y voz
real para el resto de la llamada -- el campo de texto es una función real
de la consola, no un atajo inventado para la grabación.

### 6b. Contexto recortado en las invocaciones que sí ocurren

- `k: 1` en vez de `k: 3` (`src/server.js`) — un pasaje del RAG, no tres.
- Cada pasaje truncado a 400 caracteres antes de entrar al prompt
  (`EVIDENCIA_MAX_CARACTERES`, `src/llm.js`) — sin tocar cómo `rag.js`
  fragmenta o puntúa, solo cuánto de un pasaje ya elegido ve el modelo.
- Historial limitado a los últimos 3 intercambios (`HISTORIAL_MAX_INTERCAMBIOS`),
  no toda la llamada acumulada.
- System prompt comprimido en redacción, sin quitar ninguna de las 6 reglas
  (356 → 282 tokens en la misma prueba, medido).

### 6c. Medición de Llama 3.2 1B con carga real

Con el pipeline recortado completo (system prompt comprimido + 1 pasaje
truncado + historial corto), vía `/api/chat` de Ollama (desglose nativo):

| Modelo | Escenario | Tokens entrada | Latencia total |
|---|---|---|---|
| Llama 3.2 3B | Contexto realista (antes de 6a/6b) | 1159-1488 | 104-215s |
| Llama 3.2 1B | Contexto recortado (6b), pregunta fuera de guion con evidencia | 501 | 34.9s |
| Llama 3.2 1B | Contexto recortado, sin evidencia, modelo ya caliente | 282 | **4.7-6.4s** |

1B es real y sustancialmente más rápido — pero **con un problema de
confiabilidad de formato que 3B no mostró con la misma severidad**: de 3
invocaciones idénticas con el mismo prompt, 1B produjo (1) el JSON pedido
correctamente, (2) una cadena de texto entre comillas en vez de un objeto
— `JSON.parse()` la acepta porque una cadena entre comillas ES JSON válido,
pero no tiene forma, así que el código que espera `.reply` fallaría en
silencio, sin pasar por la degradación a guion porque el parseo "tuvo
éxito" — y (3) texto plano sin comillas, que si rompe el `JSON.parse()` y
sí degrada correctamente. El caso (2) es un hallazgo nuevo, no cubierto por
`degradeToScripted()` tal como está: **valida que el JSON parsea, no que
tiene la forma esperada.** Adoptar 1B como modelo activo requeriría cerrar
ese hueco primero (validar `typeof parsed.reply === 'string'` antes de
usarlo), no es un cambio de una sola línea en `LLM_MODEL`.

Aparte del riesgo de forma, en una prueba aislada 1B también generó una
respuesta que sonaba a recomendar ibuprofeno para el dolor sin que el
contexto recuperado lo respaldara — exactamente el tipo de alucinación que
la regla 6 de CLAUDE.md señala como la falla que más pesa. No se decidió
cambiar de modelo hoy; se decidió que hace falta medir esto con más
volumen antes de decidirlo.

**No se cambió el modelo activo.** Llama 3.2 3B sigue siendo `LLM_MODEL`
por defecto — la ganancia de velocidad de 6a y 6b ya reduce drásticamente
cuántos turnos pagan el costo de invocar al modelo, que era el riesgo
principal. Cambiar a 1B es una decisión aparte, con su propio costo (cerrar
el hueco de validación de forma) y su propio riesgo (más alucinación
observada, no solo teórica) — pendiente de decidir explícitamente, no
adoptada por default.

### 6d. Validación de forma cerrada, y un hallazgo que explica por qué hacía falta

`callChatCompletions()` solo verificaba que `JSON.parse()` no lanzara —
no que el resultado tuviera la forma que el resto del pipeline necesita.
Una cadena entre comillas (`"Lo siento, no entendí."`) ES JSON válido;
`result.reply` quedaba `undefined`, y como el `try/catch` de
`generateTurn()` nunca se disparaba (el parseo "funcionó"), nada lo
detectaba. `formaValida()` ahora exige `reply` como string no vacío y
`groundedInContext` como booleano estricto — un tipo equivocado ahí no es
cosmético: `Boolean("no lo tengo")` da `true` en JavaScript, así que un
string pensado como negación se leería como la afirmación clínica más
sensible del contrato. Si la forma no es válida, se lanza y cae en el mismo
camino de degradación ya probado (`degradeToScripted()`, advertencia
visible en consola). `tests/run-llm-shape-tests.mjs` (nuevo, parte de
`npm test`) mockea `fetch` y prueba 8 formas de respuesta malformada —
ninguna llega hasta `result.reply` sin ser texto no vacío.

Al construir esos casos de prueba contra el servidor real (no solo
mockeado) para verificar la latencia del camino que sí invoca al modelo
(decisión 6c), Llama 3.2 3B falló la validación de forma en **10 de 10**
intentos — no un caso aislado. El patrón: con contexto vacío el modelo
respeta el JSON; en cuanto el CONTEXTO trae un pasaje real del RAG (aunque
esté truncado a 400 caracteres), responde en lenguaje natural y ni
intenta el formato. La causa no era la compresión del system prompt
(probado por separado: el prompt comprimido con contexto vacío da JSON
válido 3/3).

**El arreglo:** `response_format: { type: 'json_object' }` en el cuerpo de
la petición — el parámetro estándar compatible con OpenAI para forzar modo
JSON, que tanto Ollama como (según su documentación) Groq soportan. Con
esto: **10/10 → 0/10 fallas de forma** en el mismo escenario que las
producía consistentemente. No se pudo verificar contra Groq en vivo (Llama
3.1 70B está descontinuado — decisión 5), así que ese soporte se documenta
como esperado por especificación, no confirmado en este repositorio.

**Corrección (decisión 6e): "0/10" no generaliza a 0%.** Con N=20 real,
1 intento sí volvió a fallar la validación de forma — el modelo devolvió
JSON con `reply`, `askedAbout` y `usedSources`, pero sin `groundedInContext`
en absoluto (no un tipo equivocado, el campo faltaba). `response_format:
json_object` fuerza JSON sintácticamente válido; no fuerza que el modelo
rellene todas las claves del contrato. `formaValida()` lo rechazó
correctamente y degradó al guion — el mecanismo funcionó exactamente como
se diseñó — pero **el 10/10 → 0/10 de arriba era sobre una muestra
demasiado chica para ser una tasa de fallo, no una garantía de 0%.** Tasa
observada con la muestra más grande: 1/20 (5%). Ver decisión 6e para el
resto de la remedición.

**Medición final — turno que invoca al modelo, contexto recortado (6b),
`response_format` forzado, N=7:**

| | Valor |
|---|---|
| Éxitos (`engine: 'llm'`) | 7/7 |
| Mediana (P50) | 15.3 s |
| P95 | 37.6 s |
| Mínimo / máximo | 4.0 s / 37.6 s |
| Tokens de entrada (fijo, mismo prompt de prueba) | 447 |
| Tokens de salida | 50-73 |

Este número va al README como la métrica de latencia obligatoria del
camino `llm` — junto con la de 7-9ms del camino guionado/enrutado, no
combinadas en un solo P50/P95 (ver README, sección "Métricas", para por
qué).

**Con dos semanas más.** N=7 alcanza para reportar algo, no para confiar en
ello — ampliar la muestra antes de la entrega. Verificar `response_format`
contra Groq en vivo si el modelo vuelve a estar disponible. Medir si 1B con
`response_format` forzado cierra también la brecha de confiabilidad
observada en la decisión 6c, ahora que el mecanismo que probablemente la
causaba (no forzar modo JSON) tiene una explicación concreta y no es
exclusivo de 1B.

Si Groq o Gemini reaparecen o el reto actualiza la lista permitida antes
del 10 de agosto, seguirían siendo preferibles por latencia — pero no es
algo que se pueda dar por sentado a esta altura.

### 6e. Remedición de latencia, N=20 — el número sube, no baja

N=7 (decisión 6d) era "indicativo, no definitivo" por diseño propio. Se
remidió con `tools/medir-latencia.js`: 10 llamadas completas simuladas de 8
turnos cada una (6 respuestas que el guion resuelve solo + 2 preguntas
reales fuera de guion por llamada, con "?", sobre temas que `knowledge/`
cubre), contra el servidor real con `LLM_PROVIDER=ollama`. Corrida completa
en `docs/latencia-llm-n20.md`.

| | Valor |
|---|---|
| Arranque en frío (1ra invocación de la corrida, aparte) | 155.2 s |
| Invocaciones exitosas tras el arranque en frío | 18 |
| P50 | **60.8 s** |
| P95 | **95.3 s** |
| Mínimo / máximo | 40.8 s / 95.3 s |
| Fallo de validación de forma (decisión 6d) | 1/20 intentos (5%), 155.6 s antes de degradar |

**El número no bajó respecto a N=7 (P50 15.3s / P95 37.6s) — subió,
sustancialmente.** No hay una causa única identificada: candidatas sin
descartar son que N=7 se corrió con un solo prompt de prueba fijo (menos
variación real de contenido/longitud) mientras N=20 usa 10 preguntas reales
distintas, contención por corridas secuenciales sobre la misma instancia de
Ollama, o que N=7 simplemente no era representativo. No se investigó más a
fondo en este cambio — queda como pendiente.

**Turnos por llamada que invocan el modelo: 25% en esta medición** (2 de 8
turnos por llamada, por diseño del script — cada llamada simulada trae
exactamente 2 preguntas reales a propósito, para juntar N≥20 en una corrida
manejable). No es una tasa derivada del dataset oficial: `data/dataset_final.json`
no trae suficientes preguntas espontáneas reales del paciente hacia el
agente como para medir esto contra datos reales — es el límite superior de
lo que esta prueba ejercitó, no una predicción de cuánto se invocaría el
modelo en una llamada real.

**Decisión de producto, no técnica, que queda pendiente para antes de la
entrega:** P50 60.8s está muy por encima de los ~30s que se habían fijado
como el límite de lo tolerable en una conversación de voz en vivo. El
enrutamiento selectivo (6a) ya redujo cuántos turnos pagan este costo —
no lo eliminó, y no puede eliminarlo mientras el camino `llm` siga
existiendo. Opciones sin decidir aquí: aceptar la limitación y declararla
en el informe final, medir Groq si reaparece en el nivel gratuito, o
acotar aún más qué turnos llegan al modelo a costa de menos naturalidad.
Ver README, sección "Pendiente para la entrega del reto".

## 6. Escalamiento por acumulación de hallazgos ámbar

**El problema.** `mergeAssessments()` toma el máximo de los hallazgos de toda
la llamada — nunca los combina. Contra el ground truth oficial
(`docs/evaluacion-triage.md`), varios de los 12 casos rojo tienen fiebre por
debajo de 38.5° (el umbral individual de `RED-FEVER-HIGH`), pero junto con
dolor alto, herida con drenaje o declive de movilidad simultáneos. Su
etiqueta "rojo" parece venir de la combinación, no de un signo aislado —
igual que un sistema de alerta temprana clínico real, que puntúa y escala
por acumulación, no solo por el peor signo individual.

**Decisión: N=2 — dos hallazgos ámbar en dominios clínicos distintos
(fiebre, herida, dolor, vía oral, movilidad) escalan a rojo.**

**La evidencia, no un umbral afinado a ojo.** Se midió cuántos dominios
ámbar simultáneos alcanza cada uno de los 320 casos×capa del dataset
oficial, por etiqueta real:

| Dominios ámbar simultáneos | verde | amarillo | rojo |
|---|---|---|---|
| 0 | 224 | 41 | 4 |
| 1 | 22 | 9 | 12 |
| **2** | **0** | **0** | **8** |

**Ningún caso verde ni amarillo alcanza nunca 2 dominios ámbar a la vez, en
los 320 casos evaluados. Solo los rojos lo hacen.** La separación es limpia
en los datos: N=2 no es una elección entre varias razonables, es el único
punto de corte que existe entre "nunca pasa en un caso sano" y "pasa en 8
de 12 casos rojo". Los 8 casos que la cruzan:

```
caso_tray_pac_42_00017_14 (ambas capas) -> fiebre+herida
caso_tray_pac_42_00019_7  (capa1)       -> fiebre+movilidad
caso_tray_pac_42_00026_7  (ambas capas) -> fiebre+herida
caso_tray_pac_42_00028_7  (capa1)       -> fiebre+herida
caso_tray_pac_42_00028_14 (ambas capas) -> fiebre+movilidad
```

**Por qué no N=3 o N=4.** Ningún caso del dataset —ni siquiera los rojo—
alcanza nunca 3 dominios ámbar simultáneos. N=3 y N=4 miden exactamente
igual que no tener acumulación: recall de rojos se queda en 2/24 (8.3%),
igual que el baseline sin este mecanismo.

**Efecto medido — recall de rojos, antes/después de acumulación con N=2:**

| | Recall rojo | Falsos positivos nuevos |
|---|---|---|
| Sin acumulación (decisión 5, commit `f7bd354`) | 2/24 (8.3%) | — |
| Con acumulación N=2 | 10/24 (41.7%) | 0 sobre 320 casos×capa |

**`AMBER-MOBILITY`, la regla que faltaba.** "Movilidad" no tenía ninguna
regla ámbar — dominio vacío, no podía contribuir. Los patrones se
derivaron leyendo las 70 respuestas reales de pacientes a la pregunta de
movilidad en los casos rojo/ámbar del dataset (no inventados): de esas 70,
solo 2 describen una limitación genuinamente severa —el resto enmarca la
lentitud o la necesidad de apoyo como esperada tras la cirugía ("despacito,
como es normal", "con ayuda, como esperaban que fuera")— y los patrones
están acotados a esas 2 frases reales:

- `caso_tray_pac_42_00019_7`: *"Antes me movía sola sin problema y ahora casi
  no puedo levantarme, necesito que alguien me ayude para todo."*
- `caso_tray_pac_42_00028_14`: *"casi no puedo ni levantarme sola, siento la
  pierna como que no responde, muy incapacitada me siento."*

Verificado: la regla dispara exactamente 4 veces (esos 2 casos × 2 capas) de
las 70 respuestas revisadas — cero falsos positivos sobre las otras 68.

**Riesgo — 0 falsos positivos es una medición, no una garantía.** Es sobre
320 casos sintéticos de este dataset, no una prueba matemática. Es una señal
fuerte (la separación es total, no marginal), pero con dos semanas más esto
se re-mide contra un lote más grande — sintético o real— antes de confiar en
él sin reservas para producción.

**Con dos semanas más.** Medir la curva N=2/3/4 contra un lote más grande
(el dataset real solo tiene 12 casos rojo — cualquier curva medida sobre
eso tiene poco margen estadístico). Considerar si el umbral N debería variar
por combinación de dominios (fiebre+movilidad puede no pesar igual que
dolor+vía_oral) en vez de ser un número único.

## 7. Guion derivado de datos reales, y no-adherencia como hallazgo espontáneo

**El problema.** El `SCRIPT` de `src/llm.js` (apertura, dolor, herida, fiebre,
vía_oral, medicación, cierre) se había inventado a mano al construir el
adaptador de modelo — nunca se contrastó contra el dataset oficial. Revisando
7 llamadas reales se detectó que ni el orden ni el tema `medicación` tenían
respaldo.

**La medición.** `data/dataset_final.json` trae 3.991 turnos de 160 llamadas
reales (`caso_id`, no `dialogo_id` — ese último es único por turno, no
agrupa la llamada). Filtrando `hablante === 'agente'` y clasificando por
tema:

- **Orden dominante real: dolor → fiebre → movilidad → herida → apetito →
  sueño**, exacto en 89 de 160 llamadas; el resto varía el orden o se salta
  un tema, ninguna lo invierte.
- **`medicación` no aparece nunca** como pregunta del agente — 0 de 3.991
  turnos.
- **`vía_oral` (náuseas/vómito) nunca es una pregunta propia** — siempre
  aparece fusionada dentro de la pregunta de apetito ("¿ha logrado comer con
  normalidad o ha sentido náuseas?").
- **No hay un turno de cierre/despedida distinguible** en ninguna de las 160
  llamadas — el último turno registrado es simplemente la pregunta del
  último tema (casi siempre sueño).

**La decisión — `SCRIPT` reordenado, con dos excepciones deliberadas a la
fidelidad al dataset:**

1. `apertura` se mantiene como paso propio aunque no exista como turno
   independiente en las transcripciones (el saludo real siempre va pegado a
   la primera pregunta de dolor). El dataset es texto; una llamada de voz
   real necesita que el paciente sepa quién llama antes de que le pregunten
   por el dolor. Fidelidad al dataset en la estructura clínica, adaptación
   al medio en la apertura.
2. `cierre` queda con un texto inventado por necesidad — no hay frase real
   que parafrasear. Documentado en el comentario de `src/llm.js`, no
   presentado como derivado del dataset.

`medicación` sale del guion (0 respaldo) y `vía_oral` se fusiona dentro de
`apetito` (así aparece siempre en los datos reales). El texto de cada paso es
una paráfrasis del fraseo real más frecuente para ese tema, no una copia
literal — cada tema tiene entre 130 y 270 formulaciones distintas en el
dataset.

**No-adherencia a medicación no desaparece — se mueve de "pregunta guionada"
a "hallazgo espontáneo".** Quitar la pregunta de `SCRIPT` no significa dejar
de detectar el riesgo: la no-adherencia postoperatoria es un factor de
riesgo clínico real, y en pruebas manuales contra el servidor apareció sin
que se le preguntara al paciente. `src/triage.js` gana `AMBER-NONADHERENCE`
(ámbar, dominio `medicacion`) para esa mención espontánea — no depende de
que el guion la pregunte.

Diseño de la regla:
- Casi todos los patrones exigen una ancla de medicación
  (`medicamento|pastilla|medicación|antibiótico|tratamiento`) en la misma
  cláusula, para no colisionar con `AMBER-VOMIT` (vía oral: "no he podido
  tomar líquidos") ni con nada fuera de dominio. Verificado con pruebas
  dirigidas — ver `tests/triage.cases.mjs`, categoría `amber/medicacion`.
- Un primer borrador del patrón de "no los compré" dejaba el pronombre
  opcional; "No compré pan para el desayuno" disparaba la regla en pruebas
  propias antes de aplicarla. Corregido exigiendo el pronombre `los`/`las`
  inmediatamente después de "no" cuando no hay ancla de medicación
  explícita — caso de regresión guardado en la suite.
- **"no voy a tomar" (rechazo declarado) se queda en ámbar, no rojo.**
  Aislado es ambiguo — puede ser un solo medicamento con efecto secundario,
  no abandono del tratamiento. El mecanismo de acumulación (decisión 6, N=2
  dominios ámbar) ya escala esto a rojo si viene combinado con cualquier
  otro hallazgo — ese es el lugar correcto para capturar la combinación
  peligrosa, no un rojo duro sobre cualquier mención aislada.
- Gap conocido, no cerrado: verbos de abandono ("dejé de tomar") y
  pretérito simple con pronombre antes del verbo ("no me la tomé") no están
  cubiertos — la regla se acotó a las formulaciones pedidas al diseñarla, no
  a toda construcción posible. Documentado en `tests/triage.cases.mjs`,
  categoría `no-adherencia`, como línea base para no regresionar por
  accidente.

**Medido contra los 320 casos×capa del dataset oficial (`tools/evaluar-triage.js`):
0 diferencia en recall rojo (10/24, 41.7%) y 0 diferencia en exactitud
(75.9%) antes/después de agregar la regla** — esperado, porque el dataset
oficial no menciona adherencia a medicación en ningún turno. Sin regresión
en ningún caso.

**Nota aparte, encontrada al hacer esta medición.** La versión de
`docs/evaluacion-triage.md` que estaba comprometida en el repositorio medía
un `src/triage.js` anterior a `RED-PSYCH`, `AMBER-MOBILITY` y el
escalamiento por acumulación (decisión 6) — reportaba recall rojo 2/24
(8.3%) cuando el número real, con esas tres mejoras ya aplicadas, es 10/24
(41.7%). Regenerado en este mismo cambio; es el número que va a la entrega.

## 8. Silencio del paciente durante la llamada

**El problema.** Encontrado probando la consola en vivo (2026-08-08): si el
reconocimiento de voz del navegador no detecta nada (`onerror: 'no-speech'`),
`public/index.html` solo mostraba un toast técnico ("Micrófono: no-speech")
que ni el paciente ni el jurado verían como parte de la conversación — el
agente se quedaba esperando sin decir nada. `docs/rubrica-evaluacion.md`
(criterio "Calidad de la conversación (voz)") pregunta explícitamente **qué
hace la solución durante los silencios** — no es un detalle cosmético.

**Decisión.** `handleSilence()` en `public/index.html`: al primer silencio,
el agente dice en voz alta *"¿Sigue ahí? No alcancé a escucharlo, ¿me repite
eso?"*; si se repite, ofrece el cuadro de texto como alternativa en vez de
repetir la misma frase indefinidamente. Se resuelve enteramente en el
cliente — no abre un turno con el servidor, porque no hay utterance del
paciente que `triage.js` o el RAG puedan evaluar; es cortesía de
conversación, no una afirmación clínica.

**Con dos semanas más.** Reintentar automáticamente el reconocimiento tras
hablar (hoy requiere que el paciente presione "Hablar" de nuevo) — no se
implementó por no poder probarlo contra un navegador real en este entorno;
la lógica de reinicio automático del `SpeechRecognition` tiene comportamiento
inconsistente entre navegadores y preferí no arriesgar una regresión sin
poder verificarla en vivo.

## 9. Puntaje numérico de dolor, con contexto (aprobado explícitamente)

**El problema.** Encontrado probando la consola en vivo (2026-08-08):
`assess()` nunca interpreta un número suelto como puntaje de dolor.
`AMBER-PAIN` solo reconoce palabras ("insoportable", "10 de 10") — si el
paciente responde a "en una escala de 0 a 10, ¿qué tan fuerte es?" con un
número puro ("8", "le doy un 9"), ningún hallazgo dispara, sin importar qué
tan alto sea el número. Y un número sin sentido para esa escala ("20000",
"11") tampoco produce ninguna reacción — el guion sigue adelante como si la
respuesta fuera válida.

**Por qué no es trivial.** `assess(utterance)` no sabía qué preguntó el
agente. Interpretar cualquier número suelto en cualquier frase como
"puntaje de dolor" sin ese contexto es peligroso: "llevo 3 días bien" no
debe leerse como "3 de dolor". Un prototipo con contexto ya existía
(`assessInContextPrototype()`, `tools/evaluar-triage.js`) pero nunca se
adoptó en producción porque `server.js` no le pasaba ese contexto a
`assess()`.

**Decisión.** `assess(utterance, context)` — nuevo segundo parámetro
opcional, `context.lastAskedTopic`. `server.js` lo llena con
`session.coveredTopics.at(-1)` (el último tema que el agente preguntó,
disponible antes de que `recordTurn()` agregue el de este turno).
`evaluarPuntajeDolor()` solo actúa cuando `lastAskedTopic === 'dolor'` **y**
la respuesta ES el número, casi a solas ("un 8", "8 de 10", "le doy un 9") —
anclado con `^...$`, no una búsqueda libre dentro de la frase.

- **≥7** (umbral literal de `knowledge/03-manejo-del-dolor-y-medicacion.md`:
  "un dolor de 7 o más... debe reportarse para valoración") → `AMBER-PAIN-SCORE`,
  mismo dominio `dolor` que `AMBER-PAIN` — participa igual en la
  acumulación (decisión 6).
- **0-6** → sin hallazgo, igual que un dolor leve descrito en palabras.
- **>10** (fuera de la escala pedida) → `needsClarification: true`, no un
  nivel inventado — el agente pide que lo confirme, no lo ignora ni lo
  interpreta como si tuviera sentido.

**Sin `context.lastAskedTopic === 'dolor'`, el comportamiento es idéntico al
de antes** — verificado con un caso de prueba dedicado
(`pain-score-context-06-sin-contexto`) para que esto no se active por
accidente si algún día se llama `assess()` sin contexto.

**Bug encontrado y corregido durante la implementación.** La primera versión
de `PATRON_PUNTAJE_DOLOR_A_SOLAS` limitaba el número a `\d{1,4}` — "20000"
(5 dígitos) no hacía match en absoluto, así que ni se leía como puntaje
válido ni como fuera de rango: el caso que el patrón existía para atrapar
se le escapaba por el propio patrón. Corregido a `\d+` sin tope; el rango
0-10 se valida comparando el número después del match, no limitando cuántos
dígitos puede escribir.

Verificado: `npm test` (86/86 en triage, con 7 casos nuevos) y manualmente
contra el servidor real, dentro de una llamada completa (apertura → "he
estado bien" → "un 8" da `AMBER-PAIN-SCORE`; en otra llamada, "20000" da
`needsClarification: true`), más los tres casos de siempre (rojo, ámbar,
negación) sin cambios.

**Limitación encontrada y NO corregida a propósito (2026-08-09), anotada
para el informe, no arreglada bajo presión del último día.**
`scriptedReply()` marca un tema como cubierto (`session.coveredTopics`) en
el momento en que lo PREGUNTA, no cuando el paciente lo responde de forma
utilizable -- así que una respuesta vaga a la pregunta de escala ("no sé,
más o menos") no genera ningún hallazgo, `needsClarification` quede en
`false`, y el guion avanza a la siguiente pregunta (fiebre) como si el
dolor ya estuviera resuelto. Verificado contra el servidor real:

```
Turno 1 -- agente pregunta: "...en una escala de 0 a 10?"
Turno 2 -- paciente: "no sé, más o menos"
  → triage: {"level":"none", "needsClarification":false, "findings":[]}
  → agente sigue con: "¿Ha sentido fiebre o escalofríos...?"
```

`evaluarPuntajeDolor()` (más arriba) solo actúa cuando la respuesta ES un
número reconocible -- por diseño, para no interpretar cualquier frase como
un puntaje. El hueco es el paso siguiente: no hay una regla que detecte
"se le preguntó una escala numérica y la respuesta no trae ningún número
interpretable" y lo trate como `needsClarification`. Es distinto del caso
ya cubierto por `AMBIGUOUS`/`CLARIFY-VAGUE` (que reacciona a frases como
"me siento raro" sin importar qué se preguntó) -- este hueco es específico
del contexto "se pidió un número y no llegó ninguno". No se corrige en
esta sesión: cambiar cómo avanza el guion es un cambio de flujo
conversacional, no una regla de triage aislada, y merece su propio diff y
su propia aprobación explícita en una sesión con más margen que el último
día antes del plazo. Candidato natural para "qué cambiarías con dos
semanas más" (`INFORME.md` §14, pregunta 2 del video).

## 10. Groq vuelve al bucle en vivo — sucesor vigente, no corrección (2026-08-09)

**Origen: comunicación oficial de Source Meridian, recibida por correo el
2026-08-09, aprobada explícitamente por Darío para actualizar `CLAUDE.md`
regla 4.** Cita textual del correo:

> "Y sobre los modelos: si un modelo sugerido ya no existe en el proveedor,
> usa el sucesor vigente de ese mismo proveedor. Por ejemplo, la versión
> más reciente de Llama disponible en Groq, o la generación actual de
> Gemini Flash en Google."

La decisión 5 (2026-08-07) había descartado Groq porque Meta descontinuó
Llama 3.1 70B en su consola. Eso seguía siendo cierto -- lo que cambió es
la restricción: la lista cerrada ya no exige el modelo exacto nombrado,
admite su sucesor vigente del mismo proveedor. Esto no reabre la decisión
5 como si hubiera estado mal tomada -- la restricción de entonces era
real, y la decisión de sacar Groq del bucle en vivo fue correcta con la
información de ese momento.

**Modelo vigente, verificado en vivo contra la API de Groq (no supuesto
por documentación), 2026-08-09:**

```
GET https://api.groq.com/openai/v1/models
Llama disponibles hoy: llama-3.1-8b-instant, llama-3.3-70b-versatile,
                        meta-llama/llama-prompt-guard-2-{22m,86m}
```

`llama-3.3-70b-versatile` es el sucesor directo de `llama-3.1-70b-versatile`
(descontinuado) -- mismo proveedor, misma familia "versatile" de 70B,
generación siguiente. Los dos `prompt-guard-2` son clasificadores de
seguridad de entrada, no modelos de conversación; `llama-3.1-8b-instant`
es una clase de tamaño distinta (8B, no 70B), no un sucesor del modelo
descontinuado. `GROQ_MODEL=llama-3.3-70b-versatile` en `.env.example`.

**Latencia medida contra el servidor real** (`tools/medir-latencia.js`,
10 llamadas simuladas, mismo protocolo que la decisión 6e con Ollama):

| | Ollama (Llama 3.2 3B, local) | Groq (Llama 3.3 70B, nube) |
|---|---|---|
| P50 | 60.8 s | **0.685 s** |
| P95 | 95.3 s | **0.756 s** |
| N | 18 (de 20, 1 arranque en frío descartado) | 12 (de 20, ver abajo) |

El umbral que la tarea fijó era P50 < 2s -- 0.685s lo cumple con margen
amplio, no por poco. La diferencia de dos órdenes de magnitud es
consistente con lo esperado: Groq corre sobre LPU dedicada en la nube,
Ollama sobre CPU local compartida con el resto de esta máquina.

**Hallazgo que hay que contar junto con el número bueno, no aparte: el
nivel gratuito de Groq tiene un límite de 12.000 tokens por minuto (TPM)
para `llama-3.3-70b-versatile`.** De los 20 intentos de la corrida, 12
completaron como `engine: 'llm'` (los de la tabla de arriba) y 8
recibieron `429 Rate limit reached` de la API de Groq y degradaron a
`scripted-fallback` -- el mismo mecanismo de seguridad que ya existía para
cualquier fallo del proveedor (`degradeToScripted()`, `src/llm.js`), sin
código nuevo. La corrida de medición es un caso de estrés a propósito (10
llamadas seguidas, sin pausa, cada una con 2 turnos que invocan el
modelo) -- una llamada real de evaluación, con pausas naturales de
conversación entre turnos y probablemente una sola llamada a la vez, es
mucho menos probable que choque contra este límite, pero no es
imposible, y no está medido específicamente. Queda como riesgo conocido
y declarado, no oculto: si el jurado hace varias llamadas de prueba
seguidas y rápidas, algunos turnos con pregunta real pueden degradar a
guion en vez de responder con el modelo -- el sistema no se cae, pero
la respuesta generativa a esa pregunta específica no llega.

**Decisión: Groq (`llama-3.3-70b-versatile`) vuelve a ser el proveedor
activo por defecto** (`LLM_PROVIDER=groq` en `.env.example`). Ollama
(Llama 3.2 3B local) queda documentado como alternativa sin costo ni
llave, para desarrollo o si `GROQ_API_KEY` no está disponible --
`LLM_PROVIDER=ollama` en `.env`, sin tocar código, igual que ya funcionaba
antes de este cambio.

**Consecuencia sobre G2 (instalación ≤15 min), declarada, no resuelta
del todo:** correr con Groq como proveedor por defecto significa que
`GROQ_API_KEY` es ahora parte de "credenciales, URLs y accesos incluidos"
que la compuerta G2 exige que el README resuelva. El README debe traer
una key de evaluación funcional o instrucciones de obtener una gratis en
minutos -- pendiente de decidir cuál, ver README y `Pendientes antes de
entregar` más abajo.

**Consecuencia sobre §9-11 del informe y las métricas del README:** los
números de latencia P50/P95 del camino `llm` cambian de "rompe tiempo
real" (60.8s) a "compatible con conversación en vivo" (0.685s) -- esto
NO invalida el enrutamiento selectivo (`necesitaModelo()`, decisión 6a):
sigue siendo la decisión correcta que el nivel rojo nunca invoque al
modelo, con cualquier proveedor, porque la velocidad de una emergencia no
debe depender de la disponibilidad de una API externa. Lo que cambia es
que el camino `llm`, cuando sí se invoca, ya no es la parte lenta de la
conversación.

## 11. Fiebre alta sin "grados": el mismo dato, dicho de otra forma, no escalaba (2026-08-09)

**Encontrado en prueba manual en vivo** (Darío, contra el servidor con
Groq activo, transcripción completa pegada en el chat): el paciente dijo
"tengo mi temperatura en 45" y la llamada nunca escaló -- ese mismo turno,
un poco después, "tengo 45 grados de temperatura" sí escaló a rojo de
inmediato. Verificado y reproducido: el patrón "sin grados" de
`RED-FEVER-HIGH`/`AMBER-FEVER` anclaba el número a la alternativa literal
`38|39|40` -- cualquier lectura de 41 en adelante, dicha sin la palabra
"grados", no disparaba nada. Una fiebre de 41°C reportada sin ese detalle
lingüístico no es un caso de borde raro, es exactamente el tipo de falso
negativo que la regla 6 de `CLAUDE.md` pide tratar como falla catastrófica.

**Arreglo (aprobado explícitamente antes de aplicar):** `38|39|40` →
`38|39|4\d` (cubre 40-49) en ambas reglas. El piso en 38 se queda igual a
propósito -- 36/37 es temperatura normal.

**Riesgo nuevo que ese mismo arreglo habría introducido, atrapado
escribiendo el caso de prueba antes de que llegara a producción:** ampliar
el rango a 40-49 sin más habría convertido cualquier mención de la edad de
un paciente de 40 a 49 años en una fiebre roja, cada vez que compartiera
cláusula con la palabra "temperatura" -- "tengo 45 años y hoy me tomé la
temperatura, todo normal" comparte cláusula sin relación real, porque
`splitClauses()` no corta en comas y una cláusula puede ser una frase
larga entera. Corregido con `contextoTemperaturaCercano()`: la palabra de
contexto tiene que estar a máximo 20 caracteres del número, no solo
compartir cláusula -- 15 y 6 caracteres para los dos casos reales, 25 para
el caso de la edad (queda excluido). Ver el diff completo y el
razonamiento en el commit `a36d557`.

Verificado: `npm test` (92/92 en triage) y manualmente contra el servidor
real -- los tres casos de siempre (rojo, ámbar, negación), los dos casos
de fiebre sin "grados" (41 y 45), y el falso positivo de la edad,
confirmado que NO dispara.

## Pendientes antes de entregar

- [x] **Decisión de producto sobre el riesgo a G4 — resuelta: opción (a),
      aceptar la limitación y declararla explícitamente.** Enrutamiento
      selectivo (la mayoría de los turnos ya no invocan el modelo, 2-48ms) +
      contexto recortado en los que sí lo invocan — ver decisión 6a/6b.
      Camino `llm` remedido con N=20 (decisión 6e): **P50 60.8s / P95
      95.3s** — el doble del N=7 original, y muy por encima del umbral de
      ~30s fijado como tolerable. No se intentó (b) Groq — ver decisión 5,
      descontinuado, y remedirlo bajo presión de plazo es un riesgo mayor
      que el que resuelve — ni (c) acotar aún más el enrutamiento, a costa
      de naturalidad conversacional sin evidencia de que hiciera falta:
      G4 en sí (saludo + pregunta trivial) cae en el camino
      guionado/enrutado, que sí es tiempo real. La limitación queda
      declarada en README ("Pendiente para la entrega del reto") e
      `INFORME.md` §11, no oculta. Checkbox sincronizado el 2026-08-09 con
      lo que esos dos documentos ya afirmaban — no es una decisión nueva de
      esta sesión, es cerrar el registro para que coincida con el resto de
      la entrega.
- [x] Elegir entre Llama 3.2 1B/3B y Phi-3.5 Mini para la entrega (ver
      decisión 5): Llama 3.2 3B, por consistencia (desviación <1s vs. ~5s de
      rango en Phi-3.5 — la rúbrica pide P95). Confirmado de nuevo en
      decisión 6c/6d: 1B es más rápido pero con más riesgo de alucinación y
      de forma inválida — no se adoptó.
- [x] Actualizar `src/llm.js`, `README.md` y `.env.example`: proveedor
      `ollama` implementado, con Groq como código funcional pero no activo.
- [x] Cerrar el hueco de validación de forma en `callChatCompletions()`
      (decisión 6d) — `formaValida()` + `response_format: json_object`,
      con `tests/run-llm-shape-tests.mjs` cubriendo 8 formas de respuesta
      malformada.
- [x] Métricas que el README debe reportar: latencia P50/P95 (por camino,
      guionado vs. `llm` — ver README "Métricas" y decisión 6e), tokens y
      costo por llamada. Muestra ampliada a N=20 (decisión 6e) — el número
      subió respecto a N=7, no bajó; queda documentado tal cual, sin
      suavizarlo.
- [x] Sustituir el corpus de ejemplo por el dataset oficial del reto — ver
      `tools/ingestar-corpus.js`: 104 documentos ingeridos en `knowledge/` desde
      los 107 PDFs de `../reto-oficial/dataset/textos/` (1 sin texto
      extraíble, 2 duplicados por contenido omitidos).
- [x] ~~Conexión al dataset clínico vía Delta Share (Databricks).~~ Revisado
      el 2026-08-09 contra el repositorio oficial del reto completo
      (README, `docs/rubrica-evaluacion.md`, `docs/stack-tecnico.md`): no
      aparece en ningún documento oficial. El dataset se entrega como
      `.xlsx`/PDF locales en `dataset/`, sin mención de Delta Share ni
      Databricks en ningún lugar del reto. Pendiente huérfano de una idea
      descartada; no bloquea ningún entregable ni compuerta.
- [x] **Verificar la compuerta de arranque, 2026-08-09 — dos rondas.**
      Primera ronda (sin key real, antes de tener la de evaluación): clone
      limpio → `npm install` (2s, caché tibia) → `cp .env.example .env` →
      `npm start` → llamada completa con caso rojo → resumen estructurado,
      **63s totales**. Segunda ronda, con la key de evaluación real puesta
      en el README (ver el punto de abajo): mismo flujo, más una pregunta
      real fuera de guion — `engine: 'llm'`, evidencia citada, **0.94s**.
      Los dos, muy por debajo de los 15 minutos. Salvedad honesta: esta
      máquina no es una máquina limpia de fábrica (Node.js ya instalado,
      caché de npm tibia) -- no reemplaza que alguien lo corra en una
      máquina realmente nueva, pero confirma que la secuencia documentada
      en el README funciona tal como está escrita, sin pasos faltantes ni
      ambiguos.
- [x] **`GROQ_API_KEY` dentro de los 15 minutos de G2 — resuelto: opciones
      (b) + (c), no (a).** Se intentó (a) primero -- una key de evaluación
      dedicada (no la personal de Darío), puesta directamente en el
      README. **GitHub push protection bloqueó el push**: detecta
      cualquier API key real en un commit y lo rechaza por diseño, no por
      configuración de este repo. Hay una vía de bypass (autorizar el
      secreto vía la URL que da GitHub), pero incluso revocando la key
      después, el valor queda visible en el historial de git para
      siempre -- un repositorio público no es el lugar para una
      credencial, ni marcada "temporal". Se abandonó (a) en vez de forzar
      el bypass. Resuelto con lo que ya estaba documentado: (b)
      instrucciones de crear una key gratis en console.groq.com (menos de
      2 minutos, dentro de los 15 de G2) como camino principal, y (c)
      `LLM_PROVIDER=ollama` sin cuenta externa como respaldo, para quien
      prefiera no crear ninguna key durante la evaluación. La key de
      evaluación que sí se generó y se verificó funcionando (ver el punto
      de G2 arriba) no quedó en ningún archivo del repo -- solo se usó
      para probar el flujo antes de decidir no commitearla.
- [x] Diagrama exportado a imagen — `docs/architecture.svg`, 2026-08-09.
      `mermaid-cli` (necesita Chromium headless) no funcionó en este
      entorno de desarrollo tras tres intentos distintos; en vez de seguir
      insistiendo, se redibujó a mano como SVG inline con los mismos nodos
      y aristas que `docs/architecture.mmd`, reutilizando la paleta real
      de `public/index.html` (mismo sistema visual que corre en vivo) y
      anotando el hecho que más importa del diseño: el nivel rojo nunca
      pasa por el modelo, y el enrutamiento (`necesitaModelo()`) es lo que
      decide entre 2-48 ms y P50 60.8s. Verificado renderizando a PNG con
      `@resvg/resvg-js` antes de darlo por bueno -- dos rondas, la primera
      tenía una etiqueta desbordada sobre un nodo y otra tapada por su
      propio nodo, corregidas.
- [ ] Video con demo en pantalla (entregable 04) — requiere grabación en
      vivo, no se puede generar desde esta sesión.
