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

**Medición real.** Phi-3.5 vía Ollama en esta máquina (6 núcleos, 11 GB de RAM
tras ajustar el `.wslconfig` de WSL2) tarda entre **5 y 10 segundos por
respuesta**. Es el único dato de latencia medido hasta ahora entre los
candidatos que quedan; Llama 3.2 1B/3B todavía no se ha medido en esta
máquina, pero por tamaño de parámetros debería ser más rápido que Phi-3.5 —
a costa de más alucinación y peor seguimiento de instrucciones, que es
precisamente lo que la regla 6 (el falso negativo es la falla catastrófica)
penaliza más.

**Qué implica para el resto del sistema.**
- `src/llm.js` sigue detrás del adaptador (decisión 4): cambiar de Groq a un
  proveedor local (Ollama u otro runtime OpenAI-compatible) es un cambio
  contenido a ese archivo, no al resto del sistema. **Pendiente**: hoy
  `src/llm.js` todavía apunta a Groq/Llama-3.1-70b-versatile — hay que
  actualizarlo (junto con `README.md` y `.env.example`, que documentan la
  misma decisión desactualizada) antes de la entrega.
- La latencia de 5–10 s por respuesta de Phi-3.5 es alta frente a una
  conversación de voz en tiempo real (G4) y va a dominar el P95 que el README
  debe reportar. Con LLM local sin GPU, ese número probablemente no baja mucho
  más — hay que decidir si se reporta tal cual (con la explicación de por qué)
  o si se compensa con streaming/feedback sonoro mientras el modelo responde.
- Sin GPU disponible en la máquina de construcción, la comparación de
  latencia entre Llama 3.2 1B/3B y Phi-3.5 Mini en CPU sigue pendiente de
  medir antes de decidir cuál de los dos se usa en la entrega.

**Con dos semanas más.** Medir Llama 3.2 1B y 3B en la misma máquina bajo las
mismas condiciones (mismo prompt del sistema, mismo largo de contexto) antes
de decidir. Si Groq o Gemini reaparecen o el reto actualiza la lista permitida
antes del 10 de agosto, seguirían siendo preferibles por latencia — pero no es
algo que se pueda dar por sentado a esta altura.

## Pendientes antes de entregar

- [ ] Elegir entre Llama 3.2 1B/3B y Phi-3.5 Mini para la entrega (ver
      decisión 5) y medir el que falte.
- [ ] Actualizar `src/llm.js`, `README.md` y `.env.example`: hoy documentan
      Groq/Llama 3.1 70B como decisión tomada, y ya no es viable (decisión 5).
- [ ] Métricas que el README debe reportar: latencia P50/P95, tokens y costo por
      llamada (la ficha técnica del 7 de agosto define el formato exacto).
- [x] Sustituir el corpus de ejemplo por el dataset oficial del reto — ver
      `tools/ingestar-corpus.js`: 104 documentos ingeridos en `knowledge/` desde
      los 107 PDFs de `../reto-oficial/dataset/textos/` (1 sin texto
      extraíble, 2 duplicados por contenido omitidos).
- [ ] Conexión al dataset clínico vía Delta Share (Databricks).
- [ ] Verificar la compuerta de arranque: instalación y ejecución en 15 minutos
      siguiendo el README, en una máquina limpia.
- [ ] Diagrama exportado a imagen y video con demo en pantalla.
