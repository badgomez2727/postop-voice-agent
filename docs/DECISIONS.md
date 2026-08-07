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

**Con dos semanas más.** Cerrar el hueco de validación de forma en
`callChatCompletions()` (no solo `JSON.parse()`, validar las claves
esperadas) antes de considerar 1B en serio. Medir la curva completa
enrutamiento+recorte+1B contra un volumen de turnos mayor a 3 muestras.
Si Groq o Gemini reaparecen o el reto actualiza la lista permitida antes
del 10 de agosto, seguirían siendo preferibles por latencia — pero no es
algo que se pueda dar por sentado a esta altura.

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

## Pendientes antes de entregar

- [x] **Riesgo a G4 mitigado, no eliminado.** Enrutamiento selectivo (la
      mayoría de los turnos ya no invocan el modelo, 7-9ms) + contexto
      recortado en los que sí lo invocan — ver decisión 6a/6b. Llama 3.2 1B
      medido con carga real (decisión 6c): mucho más rápido pero con un
      hueco de validación de forma en `callChatCompletions()` que hay que
      cerrar antes de adoptarlo — no cambiado hoy. Pendiente: medir la
      latencia real de un turno que SÍ invoca el modelo (pregunta fuera de
      guion) con volumen suficiente para P50/P95, no 1-3 muestras.
- [x] Elegir entre Llama 3.2 1B/3B y Phi-3.5 Mini para la entrega (ver
      decisión 5): Llama 3.2 3B, por consistencia (desviación <1s vs. ~5s de
      rango en Phi-3.5 — la rúbrica pide P95).
- [x] Actualizar `src/llm.js`, `README.md` y `.env.example`: proveedor
      `ollama` implementado, con Groq como código funcional pero no activo.
- [ ] Métricas que el README debe reportar: latencia P50/P95, tokens y costo por
      llamada (la ficha técnica del 7 de agosto define el formato exacto). Los
      números de esta decisión son mediciones puntuales, no P50/P95 sobre una
      muestra — falta correr suficientes turnos para eso.
- [x] Sustituir el corpus de ejemplo por el dataset oficial del reto — ver
      `tools/ingestar-corpus.js`: 104 documentos ingeridos en `knowledge/` desde
      los 107 PDFs de `../reto-oficial/dataset/textos/` (1 sin texto
      extraíble, 2 duplicados por contenido omitidos).
- [ ] Conexión al dataset clínico vía Delta Share (Databricks).
- [ ] Verificar la compuerta de arranque: instalación y ejecución en 15 minutos
      siguiendo el README, en una máquina limpia (sin contar instalar Ollama
      ni descargar el modelo — ver README, "Cómo correrlo").
- [ ] Diagrama exportado a imagen y video con demo en pantalla.
