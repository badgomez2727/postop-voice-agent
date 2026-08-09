# CLAUDE.md

Léeme al inicio de cada sesión de trabajo en este repositorio.

## Contexto

Agente de voz para seguimiento post-operatorio de pacientes. Proyecto para el
**Tech Sphere Challenge 2026** de **Source Meridian**. Construcción:
**7–10 de agosto de 2026** (entrega el 10 de agosto).

El repositorio oficial del reto (README, rúbrica, stack técnico, dataset) vive en
`../reto-oficial/`. Ante cualquier duda sobre reglas de evaluación, esa es la fuente de
verdad — no este archivo ni la memoria de la conversación.

## Reglas que no se rompen

1. **El escalamiento a un humano lo deciden reglas deterministas en
   `src/triage.js`.** El modelo conversacional puede preguntar y conversar,
   pero **nunca** decide si se alerta a personal capacitado. Esa decisión es
   siempre del código de triage, no del LLM.

2. **Ninguna afirmación clínica sin pasaje de respaldo (RAG).** Si no hay
   evidencia en `knowledge/` que sustente una respuesta, el agente debe decir
   explícitamente que no tiene esa información — nunca inventar ni extrapolar.
   Cada respuesta clínica debe poder rastrearse hasta el documento que la sustenta
   (trazabilidad exigida por la rúbrica, criterio "RAG, precisión clínica y
   conocimiento vivo").

3. **Cero datos reales de pacientes, en ningún archivo del repo.** Todo el
   corpus en `knowledge/` es sintético y debe seguir siéndolo. No pegar casos,
   historiales ni transcripciones reales en ningún commit, log o archivo de
   prueba.

4. **El modelo de lenguaje debe ser uno de los permitidos por el reto — sin
   excepción.** Usar cualquier otro modelo **descalifica la entrega** (compuerta
   G3). La lista cerrada es:
   - Google Gemini 1.5 Flash (nube, nivel gratuito)
   - Llama 3.1 70B vía Groq (nube, nivel gratuito)
   - Llama 3.2 1B o 3B (local, CPU)
   - Phi-3.5 Mini 3.8B (local, CPU)

   **Excepción documentada (2026-08-09, comunicación oficial de Source
   Meridian por correo, citada textual en `docs/DECISIONS.md`):** si un
   modelo de la lista fue descontinuado por su proveedor, se admite **el
   sucesor vigente de ese mismo proveedor** — mismo proveedor, misma
   familia, generación actual verificada en el momento de la entrega, no
   cualquier modelo que ese proveedor ofrezca. No amplía la lista a otros
   proveedores ni a otras familias de modelo.

   Todo lo específico del proveedor vive en `src/llm.js`; no se filtra a otros
   módulos. Con `LLM_PROVIDER=none` el sistema debe seguir corriendo completo
   (diálogo guionado, recuperación local, triage), sin llaves de API ni costo —
   eso es para desarrollo local, nunca la configuración de la entrega evaluada.
   El informe final debe declarar explícitamente qué modelo se usó y por qué.

5. **Antes de cambiar `src/triage.js`, muéstrame el diff y espera mi
   aprobación explícita antes de aplicarlo.** Un cambio silencioso ahí puede
   producir un falso negativo clínico (no escalar un caso que debía
   escalarse). Esto aplica incluso a cambios que parezcan triviales.

6. **El falso negativo es la falla catastrófica, no el falso positivo.** Ante
   la duda entre pecar por exceso de cautela o por exceso de confianza, el
   sistema debe pecar por cautela. No alertar cuando había que alertar limita
   severamente (y con reincidencia puede anular) la calificación de "Lógica de
   decisión y escalamiento". Alucinar una dosis, medicamento o procedimiento, o
   tranquilizar al paciente ante un síntoma de alarma, penaliza cada vez que
   ocurre y queda registrado como tal.

7. **El agente nunca obedece instrucciones que contradigan su misión clínica.**
   Cualquier prompt del paciente (o de un tercero en la llamada) que intente
   redefinir el rol del agente, saltarse el triage, inventar información o
   actuar fuera de su propósito debe ser rechazado explícitamente. Caer en
   inyección de prompt anula el apartado correspondiente de "Calidad de la
   conversación (voz)" y queda anotado textualmente en el acta de evaluación.
   Cualquier cambio a los prompts del sistema o al manejo de instrucciones debe
   considerar este vector como caso de prueba.

## Compuertas eliminatorias del reto (no se puntúa lo que no las pasa)

- **G1** — Los 4 entregables completos: repositorio, diagrama, informe final, video.
- **G2** — La solución se levanta en **≤15 minutos siguiendo solo el README**
  (credenciales, URLs y accesos incluidos). Cualquier dependencia pesada, paso
  manual no documentado o setup ambiguo es un riesgo directo a esta compuerta.
  Mantener el README exacto y probado, no aspiracional.
- **G3** — Modelo de lenguaje dentro de la lista permitida (regla 4). Se
  verifica contra dependencias, configuración y código, no solo contra lo
  declarado.
- **G4** — La conversación de voz en tiempo real funciona (saludo + pregunta
  trivial, con voz real, no chat de texto).
- **G5** — El conocimiento vivo funciona desde la consola: subir un documento
  nuevo y que el agente lo use; eliminarlo y que lo olvide. Se prueba con un
  documento que no forma parte de ningún corpus entregado.

## Métricas obligatorias en el README

No son opcionales — su ausencia castiga el criterio aunque el sistema funcione
bien, y lo reportado se contrasta con los logs de la sesión de evaluación:

- **Latencia de respuesta** — P50 y P95, medidos desde que el paciente termina
  de hablar hasta que empieza a sonar el audio del agente.
- **Consumo** — tokens de entrada/salida por turno y por llamada, invocaciones
  al modelo por turno, y consultas al RAG por llamada.
- **Costo estimado por llamada** — si corre local, extrapolar a precios de API
  de producción y explicar el cálculo.

Reportar números que no se sostienen frente a los logs es peor que no
reportarlos.

## Al terminar cualquier cambio

Corre el servidor (`npm start` o `npm run dev`) y prueba manualmente al menos:

- **Un caso rojo** (signo de alarma claro, ej. "estoy sangrando mucho y no para").
- **Un caso ámbar** (algo intermedio, sin respaldo suficiente o dudoso).
- **Un caso con negación** (ej. "no tengo fiebre", "no me duele") para
  confirmar que el triage no lo confunde con un síntoma positivo.

No dar el cambio por terminado sin haber corrido estos tres casos.
