# Agente de voz para seguimiento post-operatorio

Imagina que acabas de salir de una cirugía. Estás en tu casa, un poco
adolorido, tal vez asustado, y nadie te ha llamado todavía a preguntar
cómo vas. Ese es el problema que quise resolver: un agente que hace esa
llamada por ti — conversa por voz, escucha de verdad lo que el paciente
cuenta, lo compara contra guías clínicas reales (no contra lo que el
modelo "cree" saber), deja rastro de qué documento respalda cada cosa que
dice, y — esto es lo que más me importaba — sabe reconocer cuándo lo
correcto es dejar de hablar y avisar a una persona.

Lo construí para el Tech Sphere Challenge 2026 de Source Meridian, entre
el 7 y el 10 de agosto.

> **Estado: en construcción.** El modelo conectado es **Llama 3.3 70B vía
> Groq** (nube, nivel gratuito) — el sucesor vigente de Llama 3.1 70B,
> que Meta/Groq descontinuaron. La lista cerrada de modelos permitidos
> (`CLAUDE.md`, regla 4) admite esa sustitución por comunicación oficial
> de Source Meridian del 2026-08-09, citada completa en
> `docs/DECISIONS.md`, decisión 10. Medí P50 0.685s / P95 0.756s contra
> el servidor real — sí alcanza para sostener una conversación de voz en
> vivo. Llama 3.2 3B local vía Ollama sigue ahí como alternativa sin
> llave ni costo (P50 60.8s, ya no apta para tiempo real, pero honesta:
> `docs/DECISIONS.md`, decisión 5). `knowledge/` ya trae el corpus real
> del reto — 104 documentos extraídos de
> `../reto-oficial/dataset/textos/` (ver `tools/ingestar-corpus.js`) más
> los 4 sintéticos con los que empecé a probar.

## Cómo correrlo

Necesitas Node.js 20 o más reciente, y una `GROQ_API_KEY` — se saca
gratis, sin tarjeta, en [console.groq.com/keys](https://console.groq.com/keys)
con el botón "Create API Key". Toma menos de dos minutos, así que cabe
sin problema dentro de los 15 de la compuerta G2.

(Una aclaración por si te preguntas por qué no dejé una key ya puesta
aquí para ahorrarte el paso: lo intenté, y GitHub bloqueó el push —
detecta por diseño cualquier API key real en un commit. Y tiene razón:
aunque se autorice el bypass, la key queda visible en el historial de
git para siempre. Un repositorio público no es el lugar para guardar una
credencial, ni "por un rato".)

```bash
npm install
cp .env.example .env
# Abre .env y pega tu GROQ_API_KEY. Lo demás ya viene listo
# (LLM_PROVIDER=groq, GROQ_MODEL=llama-3.3-70b-versatile).
npm start
```

Abre `http://localhost:3000` en Chrome o Edge — el reconocimiento de voz
del navegador no funciona en todos. Si se te olvida la key, o Groq no
responde por lo que sea, no pasa nada grave: el sistema no se cae, sigue
la conversación con el guion clínico fijo y te avisa con una advertencia
bien visible en la consola del servidor (no solo escondida en el
registro de la llamada). Vale la pena que sepas de antemano: el nivel
gratuito de Groq limita a 12.000 tokens por minuto, así que si haces
varias llamadas de prueba seguidas y rápido, puedes chocar contra ese
techo — degrada igual de bien, sin romper nada (`docs/DECISIONS.md`,
decisión 10).

**¿Sin ganas de crear una cuenta de Groq, o prefieres todo local?**
Pon `LLM_PROVIDER=ollama` y `LLM_MODEL=llama3.2:3b` en tu `.env` (ya
están ahí, comentados, solo hay que descomentarlos) — necesitas
[Ollama](https://ollama.com) instalado y el modelo descargado
(`ollama pull llama3.2:3b`, unos 2GB, esto sí queda fuera de los 15
minutos de G2, es prerrequisito de máquina). Si corres esto en WSL2, edita
`%UserProfile%\.wslconfig` con al menos 8GB de memoria para la VM y
reinicia con `wsl --shutdown` — lo medí en carne propia: con la memoria
por defecto de WSL2 (3GB) la latencia se dispara de ~8s a ~56s, no es
un detalle menor. Si prefieres Phi-3.5 Mini en vez de Llama 3.2 3B:
`ollama pull phi3.5` y `LLM_MODEL=phi3.5`. Y si quieres correr esto sin
ni siquiera Ollama, para probar otras partes del sistema sin gastar
nada: `LLM_PROVIDER=none` — recuperación local y diálogo guionado, cero
costo.

## Cómo se prueba en dos minutos

1. **Inicia una llamada.** El agente saluda y pregunta cómo te has sentido.
2. **Cuéntale algo esperado** — di o escribe *"me duele un poco la herida
   pero con la pastilla se calma"*. Mira el registro de evidencia a la
   derecha: la respuesta queda con el documento que la respalda y qué
   tan relevante fue.
3. **Repórtale un signo de alarma** — *"estoy sangrando mucho y no
   para"*. El indicador pasa a rojo, el agente escala de inmediato, y el
   hallazgo queda marcado con la frase exacta que lo disparó.
4. **Prueba el conocimiento en caliente** — quita
   `01-signos-de-alarma-generales.md` desde la consola de abajo y
   pregúntale lo mismo otra vez. Ya no va a poder fundamentar esa
   respuesta, y el registro te lo marca en ámbar. Agrégalo de nuevo y lo
   vuelve a usar — todo sin reiniciar nada.
5. **Termina la llamada y pide el resumen.** Descárgalo en JSON: triage,
   disposición, qué fuentes citó, qué turnos quedaron sin respaldo, y la
   transcripción completa.

## Arquitectura

El diagrama completo (entregable 02) está en `docs/architecture.svg` —
la fuente editable, en Mermaid, en `docs/architecture.mmd`. Resumido:

```
Paciente ──voz──▶ Consola ──▶ Servidor ──┬──▶ Triage (reglas deterministas)
                     ▲                    ├──▶ Recuperación (TF-IDF sobre knowledge/)
                     │                    └──▶ Adaptador de modelo
                     └────respuesta + evidencia────┘
```

| Archivo | Qué hace |
|---|---|
| `src/server.js` | API HTTP y la orquestación de cada turno |
| `src/rag.js` | Fragmenta los documentos, arma el índice en memoria, recupera con `sourceId` y relevancia |
| `src/triage.js` | Las reglas de escalamiento — devuelve la frase exacta que disparó cada hallazgo |
| `src/llm.js` | El adaptador del modelo, el prompt del sistema, y el diálogo guionado de respaldo |
| `src/session.js` | El estado de cada llamada y su resumen estructurado |
| `public/index.html` | La consola: la llamada, el registro de evidencia, la gestión del conocimiento |
| `knowledge/*.md` | La base de conocimiento — 104 documentos del corpus real del reto más 4 sintéticos de práctica. Tocarla se nota en la siguiente pregunta |
| `tools/explorar-dataset.js` | Explora en solo lectura el dataset oficial (`../reto-oficial/dataset/`): columnas y muestra de cada `.xlsx`, cuántos casos hay por `label_ground_truth`, y un ejemplo de conversación capa1 vs. capa2 para el mismo `caso_id` |
| `tools/ingestar-corpus.js` | La herramienta que usé una sola vez para extraer los 107 PDFs de `../reto-oficial/dataset/textos/` a `knowledge/*.md`. Ya cumplió su función; no hace falta volver a correrla salvo que cambie el dataset oficial |

### Dos decisiones que le dan forma a todo lo demás

**El escalamiento no lo decide el modelo.** Lo deciden reglas
deterministas. Un modelo puede cambiar de criterio entre dos llamadas
idénticas — y decidir si se despierta a un clínico tiene que ser algo
reproducible, algo que uno pueda explicar después con la misma frase que
lo disparó. El modelo conversa; las reglas deciden.

**La trazabilidad vive en la interfaz, no en un log que nadie revisa.**
Cada cosa que el agente afirma aparece en vivo con su fragmento de
respaldo. Un turno sin fundamento se marca en ámbar mientras la llamada
sigue — no algo que se descubre auditando después, cuando ya es tarde.

Todo el razonamiento detrás de estas y otras decisiones —incluyendo las
alternativas que descarté y por qué— está en `docs/DECISIONS.md`.

## API

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/api/calls` | Inicia una llamada |
| `POST` | `/api/calls/:id/turns` | Envía lo que dijo el paciente; devuelve la respuesta, el triage y la evidencia |
| `POST` | `/api/calls/:id/end` | Cierra la llamada y devuelve el resumen estructurado |
| `GET` | `/api/calls/:id/summary` | El resumen, sin cerrar la llamada |
| `GET` | `/api/knowledge` | Los documentos indexados en este momento |
| `POST` | `/api/knowledge` | Agrega un documento (reindexa) |
| `DELETE` | `/api/knowledge/:filename` | Elimina un documento (reindexa) |
| `POST` | `/api/retrieve` | Prueba la recuperación sola, sin conversar |

## Métricas

Todo lo que sigue lo medí contra el servidor real, no lo extrapolé de
oídas. La metodología completa y las muestras crudas están en
`docs/DECISIONS.md`, decisiones 6 (Ollama) y 10 (Groq).

**Latencia — desde que el paciente termina de hablar hasta que el agente
tiene la respuesta lista** (no incluye el reconocimiento de voz, que pasa
antes de llegar al servidor, ni la síntesis, que pasa después):

| Motor del turno | Cuándo pasa | Latencia |
|---|---|---|
| `scripted` / `scripted-routed` | Guion clínico fijo, caso rojo, o cualquier respuesta que no necesita al modelo (la mayoría de los turnos — ver decisión 6a) | **2-48 ms** |
| `llm` — Groq, Llama 3.3 70B (el que está activo) | Respuesta ambigua, o pregunta fuera de guion que el RAG puede fundamentar | **P50 0.685s / P95 0.756s** (N=12 de 20 — ver la nota del límite de tasa, abajo) |
| `llm` — Ollama, Llama 3.2 3B (la alternativa local) | Lo mismo, con `LLM_PROVIDER=ollama` | **P50 60.8s / P95 95.3s** (N=18 de 20 — decisión 6e) |

**El proveedor cambió de Ollama a Groq el 2026-08-09** (decisión 10, tras
la comunicación oficial de Source Meridian que admite el sucesor vigente
de un modelo descontinuado): el camino `llm` pasó de romper por completo
la sensación de conversación en vivo, a ser perfectamente compatible con
ella — sin tocar el enrutamiento selectivo que decide cuándo hace falta
invocarlo.

**Un riesgo que prefiero contarte antes de que lo descubras tú: el nivel
gratuito de Groq limita a 12.000 tokens por minuto.** En la corrida de
medición (10 llamadas seguidas, sin pausa, `tools/medir-latencia.js`), 12
de 20 intentos terminaron como `engine: 'llm'` (esos son los que arman la
tabla de arriba) y 8 recibieron `429 Rate limit reached` de la API y
degradaron a `scripted-fallback` — el mismo mecanismo de seguridad que ya
existía para cualquier fallo del proveedor, sin una línea de código
nueva. Una llamada real de evaluación, con las pausas naturales de una
conversación entre turnos, tiene menos probabilidad de chocar contra ese
techo, pero no te lo puedo garantizar. Lo que sí te garantizo: el sistema
nunca se cae por esto, ese turno puntual simplemente degrada al guion en
vez de generarse.

No junto un P50/P95 combinando los motores `scripted` y `llm`: para
hacerlo bien necesitaría saber qué proporción real de turnos de una
llamada cae en cada uno, y eso depende de cómo habla un paciente real, no
de algo que pueda medir hoy con datos sintéticos.

**Turnos por llamada que invocan el modelo (la naturalidad
conversacional).** En las 10 llamadas simuladas de esta medición, 2 de
cada 8 turnos (**25%**) intentaron invocar al modelo — así diseñé el
script de medición, no porque así hable un paciente real: cada llamada
simulada trae exactamente 2 preguntas reales fuera de guion, a propósito.
El dataset oficial (`data/dataset_final.json`) no tiene suficientes
preguntas espontáneas del paciente como para sacar de ahí una tasa
realista — el 25% de esta prueba es el techo práctico de la medición, no
una predicción de cómo será en producción.

**Consumo, por cada turno que sí invoca al modelo** (N=7, medido contra
Ollama — no lo volví a medir token por token contra Groq en esta sesión,
la corrida de latencia no capturó eso): 447-548 tokens de entrada, 43-73
de salida, 1 invocación al modelo, 1 consulta al RAG (`k=1`, desde la
decisión 6b) por turno que llega al modelo. El conteo de tokens no
depende del proveedor — es el mismo prompt, el mismo contexto recortado —
así que el rango se mantiene como referencia razonable para Groq también,
aunque valdría la pena confirmarlo con una medición dedicada.

**Costo estimado por llamada, con Groq activo.** El nivel gratuito de
Groq no cuesta nada mientras la entrega se mantenga dentro de ese nivel —
lo que sigue es la extrapolación a precio de producción que pide la
rúbrica, no un cobro real de esta entrega. El precio de producción para
`llama-3.3-70b-versatile` lo saqué del propio campo `pricing` que
devuelve `GET https://api.groq.com/openai/v1/models` (no de una página
de marketing): **$0.59 por millón de tokens de entrada, $0.79 por millón
de salida**, verificado en vivo el 2026-08-09. Una llamada de unos 7
turnos, con 1-2 invocaciones reales al modelo (~1000-1500 tokens totales
por llamada, el resto lo resuelve el guion — ver decisión 6a) ronda
**~$0.001-0.0015 por llamada** — sigue bien por debajo de un centavo de
dólar. Pero la cifra que de verdad importa aquí no es el precio por
token: es que el enrutamiento selectivo ya redujo cuántos turnos pagan
ese precio, para empezar.

## Lo que todavía me falta para la entrega

- **Resuelto (2026-08-09, decisión 10): el camino `llm` ya no rompe la
  sensación de "tiempo real".** Con Groq (Llama 3.3 70B, el sucesor
  vigente de Llama 3.1 70B tras la comunicación oficial de Source
  Meridian) el camino `llm` mide P50 0.685s / P95 0.756s — dos órdenes de
  magnitud por debajo de los 60.8s/95.3s que medía con Ollama local, y
  muy por debajo del umbral de 30s que me había fijado como tolerable.
  Queda un riesgo declarado, no una decisión sin tomar: el nivel gratuito
  de Groq limita a 12.000 tokens por minuto, así que varias llamadas de
  prueba seguidas y rápidas pueden degradar algún turno a guion por
  `429`. El sistema nunca se cae por esto — ver "Métricas" arriba y
  `docs/DECISIONS.md`, decisión 10.
- Recuperación híbrida (embeddings + TF-IDF): con el corpus real ya
  cargado, tengo evidencia medida —no solo la intuición— de que TF-IDF
  puro no siempre trae el documento correcto. Ver
  `docs/recuperacion-despues.md`.
- Capturas del demo y video (entregables 03/04) — ver `INFORME.md`,
  §13-14.

Ya resuelto en sesiones anteriores, por si te lo preguntas: el
endurecimiento contra inyección de prompt (`docs/inyeccion-prompt.md`),
y que `RED-BREATHING` en `triage.js` reconozca "me cuesta respirar" y
"dificultad para respirar", no solo "me falta el aire".

**El informe final** está en `INFORME.md` — ahí declaro qué modelo usé y
por qué, dejo la evidencia de todo el proceso, las métricas, y las
limitaciones que conozco y no escondo.

## Datos y alcance

No hay datos de pacientes reales en este repositorio, y no debe haberlos
nunca. Los documentos de `knowledge/` son sintéticos, escritos para poner
a prueba la recuperación. La llamada ocurre por navegador — no hay
telefonía real detrás de esto.

Este agente no diagnostica, no ajusta tratamientos, y no reemplaza el
criterio de nadie con formación clínica. Lo único que decide es cuándo
dejar de responder y llamar a una persona — y esa es, a propósito, la
decisión más importante que toma.

## Licencia

MIT. Está en `LICENSE`.
