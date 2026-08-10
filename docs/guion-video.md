# Guion del video (entregable 04)

Preparado el 2026-08-10. No es para leer en cámara — es para no improvisar
en la parte de demo, y para tener las respuestas de cierre pensadas de
antemano (la rúbrica exige responderlas "sin guion leído", así que en esa
parte el guion es solo notas, no texto).

Duración objetivo total: **6-8 minutos.**

---

## 0. Antes de grabar (2 minutos, esto no es parte del video)

- [ ] Servidor corriendo (`npm start`), `.env` con `GROQ_API_KEY` real,
      `LLM_PROVIDER=groq`.
- [ ] Navegador en `http://localhost:3000`, en Chrome o Edge.
- [ ] `knowledge/` limpio de cualquier documento de prueba suelto
      (revisa que no esté `prueba-g5-biologia.md` u otro — si el jurado
      lo ve ahí, la prueba de G5 en vivo pierde sentido).
- [ ] Un documento de prueba nuevo listo para copiar y pegar (el de
      Rubisco-Kest7 que ya usaste, o cualquier otro que NO esté en tu
      corpus real).
- [ ] Silencia notificaciones — nada peor que un Slack sonando a mitad
      de una demo de voz.
- [ ] Haz un ensayo completo primero, sin grabar. El segundo intento
      siempre sale mejor que el primero.

---

## 1. Apertura — repo y arquitectura (≈20s)

Pantalla: el repositorio en GitHub, 3-4 segundos. Cambia a
`docs/architecture.svg` abierto (o el README con el diagrama visible).

Di, en tus palabras, algo como:

> "Este es el agente de voz para seguimiento post-operatorio que
> construí para el Tech Sphere Challenge. La arquitectura es simple a
> propósito: cada turno pasa por triage y por RAG en paralelo, y el
> modelo de lenguaje es la única pieza que se puede quitar sin que el
> sistema deje de funcionar."

---

## 2. Demo en vivo (≈4 minutos)

Abre la consola. Sigue este orden — es el mismo que ya probaste ayer,
así que no hay sorpresas.

**a) Saludo + síntoma normal (≈40s)**
- Inicia la llamada. Deja que el agente salude por voz.
- Di: *"me duele un poco la herida pero con la pastilla se calma"*.
- Señala en pantalla el registro de evidencia: el documento que respalda
  la respuesta, con su relevancia.

**b) Caso rojo (≈30s)**
- Di: *"estoy sangrando mucho y no para"*.
- Señala el indicador pasando a rojo y el hallazgo (`RED-BLEEDING`) con
  la frase exacta que lo disparó.

**c) Conocimiento en caliente — G5 (≈90s)**
- Ve a la consola de abajo. Pega el documento de prueba (nombre y
  contenido — cualquiera que no esté en tu corpus real).
- Por el campo de texto (no por voz — ya sabes que el reconocimiento no
  pone "?", y sin "?" no se enruta al modelo), pregunta algo que
  **solo** ese documento pueda responder.
- Señala la respuesta citando la fuente nueva, en verde.
- Bórralo desde la consola. Repite la misma pregunta.
- Señala que ya no lo cita — dice que no tiene esa información, no
  inventa nada.

**d) Cerrar y resumir (≈30s)**
- "Terminar y resumir". Muestra el JSON descargado: triage, fuentes,
  transcripción completa.

**e) Mención rápida del motor/latencia (≈20s)**
- Señala en el registro que los turnos guionados responden en
  milisegundos y el que invocó el modelo tardó bien menos de un segundo
  — y menciona en una frase que esa decisión (guion vs. modelo) la toma
  código, no el modelo mismo.

---

## 3. Corte a cámara (resto del video, sin leer)

Aquí el guion se vuelve notas, no texto. Mira a la cámara, habla como
le explicarías esto a alguien, no como si lo estuvieras recitando.

### Pregunta 1 — presentar el problema y el valor diferencial

**La idea central, en una frase:** el seguimiento post-operatorio hoy
depende de que una persona llame; eso es costoso, no escala, y es
propenso a error humano. Este agente no reemplaza el criterio clínico —
lo que aporta es que **nunca es el modelo de lenguaje quien decide
alertar a un humano**, siempre son reglas deterministas, así que la
misma llamada, dicha dos veces, se clasifica igual las dos veces.

**Tres cosas que puedes mencionar, sin necesidad de decirlas todas:**
- Consistencia: las mismas reglas evalúan cada llamada, no varían de un
  turno a otro como podría variar un modelo.
- Trazabilidad: cada cosa que el agente afirma se puede rastrear hasta
  el documento real que la respalda — lo viste hace un momento en la
  demo.
- Honestidad ante lo que no sabe: cuando borraste el documento, el
  agente no improvisó una respuesta — dijo que no tenía esa
  información. Eso es a propósito, no un accidente.

**El valor diferencial frente a un chatbot genérico:** un chatbot
conversa bien; este agente además sabe cuándo dejar de conversar y
llamar a alguien. Esa es la parte difícil, y es la que more importa en
salud.

### Pregunta 2 — la decisión técnica más relevante

**Candidata principal — separar la decisión de escalamiento del
modelo de lenguaje:**
- Qué evaluaste y descartaste: pedirle al modelo el nivel de riesgo en
  cada respuesta (descartado — no es reproducible, un modelo puede
  cambiar de criterio entre dos llamadas idénticas); un clasificador
  entrenado (descartado — no había datos etiquetados suficientes en
  tres días).
- Riesgo que identificaste: las reglas por expresiones regulares no
  cubren toda formulación posible del lenguaje natural. Mitigación
  parcial: un glosario regional, una categoría de "requiere
  aclaración", y — si te preguntan por un ejemplo concreto — puedes
  contar que en pruebas manuales encontraste que "estoy sangrando" sin
  más detalle no disparaba nada, y lo corregiste el mismo día que lo
  encontraste, con un caso de prueba nuevo para que no vuelva a pasar.
- Con dos semanas más: un modelo como segundo evaluador en paralelo —
  si el modelo y las reglas no coinciden, esa discrepancia se marca para
  revisión humana, nunca al revés (las reglas nunca ceden ante el
  modelo).

**Candidata alternativa, si prefieres esta:** el enrutamiento selectivo
del modelo — medí que invocar el modelo en cada turno costaba 100+
segundos con el modelo local, así que diseñé el sistema para que la
mayoría de los turnos (el guion clínico) nunca toquen el modelo, y
reservé la generación libre para lo que el guion no puede resolver
solo. Cuando cambié de modelo local a Groq en la nube, esa decisión de
arquitectura se mantuvo intacta — el enrutamiento no depende de qué
tan rápido sea el proveedor de turno.

---

## 4. Cierre (≈10s)

Algo simple: agradece, menciona que el repositorio y el informe tienen
todo el detalle (decisiones descartadas, métricas, límites conocidos) por
si quieren profundizar en algo puntual.
