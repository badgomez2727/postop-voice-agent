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

> **Entrega final — Tech Sphere Challenge 2026.** Modelo: **Llama 3.3 70B
> vía Groq** (nube, nivel gratuito), sucesor vigente de Llama 3.1 70B tras
> su descontinuación — excepción admitida por comunicación oficial de
> Source Meridian, citada en `docs/DECISIONS.md`, decisión 10. P50 0.685s
> / P95 0.756s: compatible con conversación de voz en vivo. Llama 3.2 3B
> vía Ollama queda como alternativa local sin costo (`docs/DECISIONS.md`,
> decisión 5). `knowledge/` trae el corpus real del reto — 104 documentos
> extraídos de `../reto-oficial/dataset/textos/` más 4 sintéticos.

## Cómo correrlo

Necesitas Node.js 20 o más reciente, y una `GROQ_API_KEY` — se saca
gratis, sin tarjeta, en [console.groq.com/keys](https://console.groq.com/keys)
con el botón "Create API Key". Toma menos de dos minutos, dentro de los
15 de la compuerta G2. (No hay una key ya puesta en este repositorio a
propósito: un repositorio público no es el lugar para guardar una
credencial — detalle en `docs/DECISIONS.md`, decisión 10.)

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

Medidas contra el servidor real, no extrapoladas. Metodología completa y
muestras crudas en `docs/DECISIONS.md`, decisiones 6 (Ollama) y 10 (Groq).

**Latencia** — desde que el paciente termina de hablar hasta que el
agente tiene la respuesta lista (no incluye reconocimiento de voz ni
síntesis, que ocurren fuera del servidor):

| Motor | Cuándo | Latencia |
|---|---|---|
| `scripted` / `scripted-routed` | Guion clínico, caso rojo, o cualquier turno que no necesita al modelo (la mayoría) | **2-48 ms** |
| `llm` — Groq, Llama 3.3 70B (activo) | Pregunta real fuera de guion, con evidencia del RAG | **P50 0.685s / P95 0.756s** (N=12/20) |
| `llm` — Ollama, Llama 3.2 3B (alternativa local) | Igual, con `LLM_PROVIDER=ollama` | **P50 60.8s / P95 95.3s** (N=18/20) |

Con Groq, el camino `llm` es compatible con conversación de voz en vivo —
con Ollama local no lo era. El enrutamiento selectivo (qué turnos
invocan al modelo) no cambió al cambiar de proveedor: el nivel rojo
sigue sin tocar el modelo nunca, sin importar qué tan rápido responda.

**Consumo, por turno que invoca al modelo**: 447-548 tokens de entrada,
43-73 de salida, 1 invocación al modelo, 1 consulta al RAG (`k=1`). En la
medición, 25% de los turnos por llamada invocaron el modelo — cota de la
prueba, no una tasa de producción.

**Costo por llamada, con Groq**: nivel gratuito, sin costo real hoy.
Extrapolado a precio de producción de `llama-3.3-70b-versatile` ($0.59 /
millón de tokens de entrada, $0.79 / millón de salida — tomado del propio
endpoint de Groq): **~$0.001-0.0015 por llamada**, bien por debajo de un
centavo.

**Riesgo declarado:** el nivel gratuito de Groq limita a 12.000
tokens/minuto — varias llamadas de prueba seguidas y rápidas pueden
degradar algún turno a guion por `429`. El sistema no se cae por esto;
ver "Limitaciones" abajo y `docs/DECISIONS.md`, decisión 10, para el
detalle completo.

## Limitaciones conocidas

Declaradas a propósito — un límite que no se cuenta es peor que uno que
sí, así que van todas, sin suavizarlas:

- **El nivel gratuito de Groq limita a 12.000 tokens/minuto.** Varias
  llamadas de prueba seguidas pueden degradar algún turno a guion. El
  sistema no se cae por esto (`docs/DECISIONS.md`, decisión 10).
- **Una pregunta dicha por voz, sin "?" en la transcripción, no llega al
  modelo** — decisión deliberada, no un error: el reconocimiento de voz
  del navegador no siempre puntúa (decisión 6a).
- **Recuperación híbrida (embeddings + TF-IDF) queda para una próxima
  iteración.** TF-IDF puro no siempre trae el documento correcto — medido
  en `docs/recuperacion-despues.md`.
- **El guion avanza aunque la respuesta del paciente no traiga nada
  interpretable** (ej. una respuesta vaga a la escala de dolor).

Detalle técnico completo de estas cuatro y del resto de decisiones,
alternativas descartadas y hallazgos de todo el proceso: `docs/DECISIONS.md`.

**El informe final** está en `INFORME.md` — declaración del modelo y por
qué, evidencia del proceso, métricas y limitaciones.

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
