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

**Esto pone en riesgo la compuerta G4** (conversación de voz en tiempo real)
tal como está hoy. No es un ajuste fino pendiente: a esta velocidad, una
llamada real con varios turnos y contexto acumulado no es utilizable en
vivo. Sigue sin resolverse — ver "Pendientes antes de entregar" — y las
alternativas a evaluar, en orden de esfuerzo, son: recortar el contexto que
se le pasa al modelo (menos pasajes de evidencia, pasajes más cortos —
converge con el trabajo ya hecho en `src/rag.js` para no traer fragmentos
irrelevantes ni voluminosos), medir Llama 3.2 **1B** en vez de 3B (menos
parámetros, prefill más barato, a costa de más alucinación — tensión directa
con la regla 6), o aceptar la latencia y compensarla con feedback sonoro
mientras el modelo procesa, si el tiempo no alcanza para más.

**Con dos semanas más.** Medir Llama 3.2 1B en la misma máquina, bajo las
mismas condiciones de contexto realista (no prompt corto) que expusieron el
problema real. Si Groq o Gemini reaparecen o el reto actualiza la lista
permitida antes del 10 de agosto, seguirían siendo preferibles por latencia
— pero no es algo que se pueda dar por sentado a esta altura.

## Pendientes antes de entregar

- [ ] **Urgente — riesgo directo a G4.** Latencia de turno completo (contexto
      realista, no prompt corto) medida en 104-215s con Llama 3.2 3B — ver
      decisión 5. Investigar: recortar contexto (system prompt + evidencia
      del RAG), medir Llama 3.2 1B, o aceptar y compensar con feedback
      sonoro. No dar la conexión del modelo por "resuelta" solo porque
      responde — tiene que responder a tiempo para una llamada de voz.
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
