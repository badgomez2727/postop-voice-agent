# CLAUDE.md

Léeme al inicio de cada sesión de trabajo en este repositorio.

## Contexto

Agente de voz para seguimiento post-operatorio de pacientes. Proyecto para el
reto **Tech Sphere** de **Source Meridian**. Entrega: **7–10 de agosto de 2026**.

## Reglas que no se rompen

1. **El escalamiento a un humano lo deciden reglas deterministas en
   `src/triage.js`.** El modelo conversacional puede preguntar y conversar,
   pero **nunca** decide si se alerta a personal capacitado. Esa decisión es
   siempre del código de triage, no del LLM.

2. **Ninguna afirmación clínica sin pasaje de respaldo (RAG).** Si no hay
   evidencia en `knowledge/` que sustente una respuesta, el agente debe decir
   explícitamente que no tiene esa información — nunca inventar ni extrapolar.

3. **Cero datos reales de pacientes, en ningún archivo del repo.** Todo el
   corpus en `knowledge/` es sintético y debe seguir siéndolo. No pegar casos,
   historiales ni transcripciones reales en ningún commit, log o archivo de
   prueba.

4. **Todo lo específico del proveedor del modelo vive en `src/llm.js`.**
   Con `LLM_PROVIDER=none` el sistema debe seguir corriendo completo (diálogo
   guionado, recuperación local, triage), sin llaves de API ni costo. No
   filtrar detalles de proveedor a otros módulos.

5. **Antes de cambiar `src/triage.js`, muéstrame el diff y espera mi
   aprobación explícita antes de aplicarlo.** Un cambio silencioso ahí puede
   producir un falso negativo clínico (no escalar un caso que debía
   escalarse). Esto aplica incluso a cambios que parezcan triviales.

## Al terminar cualquier cambio

Corre el servidor (`npm start` o `npm run dev`) y prueba manualmente al menos:

- **Un caso rojo** (signo de alarma claro, ej. "estoy sangrando mucho y no para").
- **Un caso ámbar** (algo intermedio, sin respaldo suficiente o dudoso).
- **Un caso con negación** (ej. "no tengo fiebre", "no me duele") para
  confirmar que el triage no lo confunde con un síntoma positivo.

No dar el cambio por terminado sin haber corrido estos tres casos.
