# Agente de voz para seguimiento post-operatorio

Un paciente sale de un procedimiento y necesita que alguien esté pendiente de él
en las primeras horas. Este agente hace esa llamada: conversa por voz, interpreta
lo que el paciente reporta contra una base de conocimiento clínico, registra qué
documento sustenta cada cosa que afirma, y decide cuándo alertar a personal
capacitado.

> **Estado: en construcción (Tech Sphere Challenge 2026, Source Meridian).**
> El modelo conectado es **Llama 3.3 70B vía Groq** (nube, nivel gratuito) —
> sucesor vigente de Llama 3.1 70B, que Meta/Groq descontinuaron. La lista
> cerrada de modelos permitidos (`CLAUDE.md`, regla 4) admite esa
> sustitución por comunicación oficial de Source Meridian (2026-08-09,
> citada en `docs/DECISIONS.md`, decisión 10). P50 0.685s / P95 0.756s
> medido contra el servidor real — compatible con conversación de voz en
> vivo. Llama 3.2 3B local vía Ollama sigue disponible como alternativa sin
> llave ni costo (P50 60.8s, no apto para tiempo real; `docs/DECISIONS.md`,
> decisión 5). `knowledge/` ya tiene el corpus real del reto (104 documentos
> extraídos de `../reto-oficial/dataset/textos/`, ver `tools/ingestar-corpus.js`)
> más los 4 documentos sintéticos originales de práctica.

## Cómo correrlo

Requiere Node.js 20 o superior y una `GROQ_API_KEY` (gratis, sin tarjeta,
en [console.groq.com](https://console.groq.com/keys) — crear la cuenta y la
key toma un par de minutos, dentro de los 15 de la compuerta G2).

```bash
npm install
cp .env.example .env
# Edita .env: pega tu GROQ_API_KEY. El resto ya viene configurado
# (LLM_PROVIDER=groq, GROQ_MODEL=llama-3.3-70b-versatile).
npm start
```

Abre `http://localhost:3000` en Chrome o Edge (el reconocimiento de voz del
navegador no está disponible en todos). Si `GROQ_API_KEY` no está
configurada o Groq no responde, el sistema no se cae: degrada
automáticamente a diálogo guionado y avisa con una advertencia visible en la
consola del servidor (no solo en el registro de la llamada). El nivel
gratuito de Groq limita a 12.000 tokens/minuto — varias llamadas de prueba
seguidas y rápidas pueden chocar contra ese límite; degrada igual, sin
romper la llamada (`docs/DECISIONS.md`, decisión 10).

**Sin cuenta de Groq, o para desarrollo 100% local:** `LLM_PROVIDER=ollama`
y `LLM_MODEL=llama3.2:3b` en `.env` (comentado, listo para descomentar) —
requiere [Ollama](https://ollama.com) instalado y el modelo descargado
(`ollama pull llama3.2:3b`, ~2GB, fuera de los 15 minutos de G2). En WSL2,
editar `%UserProfile%\.wslconfig` con al menos 8GB de memoria para la VM
(`wsl --shutdown` para aplicar) — con la memoria por defecto de WSL2 (3GB)
la latencia de Ollama se dispara de ~8s a ~56s. Para Phi-3.5 Mini en vez de
Llama 3.2 3B: `ollama pull phi3.5` y `LLM_MODEL=phi3.5`. Para correr sin
ni siquiera Ollama, `LLM_PROVIDER=none`: recuperación local y diálogo
guionado, sin costo. Todas estas alternativas están documentadas y
comentadas directamente en `.env.example`.

## Cómo se prueba en dos minutos

1. **Iniciar llamada.** El agente saluda y pregunta cómo se ha sentido.
2. **Reportar algo esperado** — escribe o di *"me duele un poco la herida pero
   con la pastilla se calma"*. Fíjate en el registro de evidencia a la derecha:
   la respuesta queda con el documento que la sustenta y su relevancia.
3. **Reportar un signo de alarma** — *"estoy sangrando mucho y no para"*. El
   indicador de estado pasa a rojo, el agente escala y el hallazgo queda
   marcado con la frase exacta que lo disparó.
4. **Probar el conocimiento en caliente** — quita `01-signos-de-alarma-generales.md`
   desde la consola de abajo y vuelve a preguntar lo mismo. El agente deja de
   fundamentar esa respuesta y el registro lo marca en ámbar. Agrégalo de nuevo
   y lo vuelve a usar. Sin reiniciar.
5. **Terminar y resumir.** Descarga el resumen estructurado en JSON: triage,
   disposición, fuentes citadas, turnos sin respaldo y transcripción.

## Arquitectura

Diagrama completo (entregable 02): `docs/architecture.svg`. Fuente editable
en Mermaid: `docs/architecture.mmd`. Resumen:

```
Paciente ──voz──▶ Consola ──▶ Servidor ──┬──▶ Triage (reglas deterministas)
                     ▲                    ├──▶ Recuperación (TF-IDF sobre knowledge/)
                     │                    └──▶ Adaptador de modelo
                     └────respuesta + evidencia────┘
```

| Archivo | Responsabilidad |
|---|---|
| `src/server.js` | API HTTP y orquestación de cada turno |
| `src/rag.js` | Fragmentación, índice en memoria, recuperación con `sourceId` y relevancia |
| `src/triage.js` | Reglas de escalamiento; devuelve la frase que disparó cada hallazgo |
| `src/llm.js` | Adaptador del modelo, prompt del sistema y diálogo guionado de respaldo |
| `src/session.js` | Estado de la llamada y resumen estructurado |
| `public/index.html` | Consola: llamada, registro de evidencia, gestión del conocimiento |
| `knowledge/*.md` | Base de conocimiento: 104 documentos del corpus real del reto + 4 sintéticos de práctica. Cambiarla se refleja en la siguiente pregunta |
| `tools/explorar-dataset.js` | Explora en solo lectura el dataset oficial (`../reto-oficial/dataset/`): columnas y muestra de cada `.xlsx`, conteo de casos por `label_ground_truth`, y un ejemplo de conversación capa1 vs. capa2 para el mismo `caso_id` |
| `tools/ingestar-corpus.js` | Herramienta de un solo uso: extrajo los 107 PDFs de `../reto-oficial/dataset/textos/` a `knowledge/*.md`. Ya se corrió; no hace falta repetirla salvo que cambie el dataset oficial |

### Dos decisiones que definen el diseño

**El escalamiento no lo decide el modelo.** Vive en reglas deterministas. Un
modelo puede cambiar de criterio entre dos llamadas idénticas, y la decisión de
alertar a un clínico tiene que ser reproducible y explicable. El modelo conversa;
las reglas deciden.

**La trazabilidad es interfaz, no bitácora.** Cada afirmación aparece en vivo con
su fragmento de respaldo. Un turno sin fundamento se marca en ámbar mientras la
llamada sigue, en lugar de descubrirse auditando después.

El razonamiento completo, con alternativas descartadas y riesgos, está en
`docs/DECISIONS.md`.

## API

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/api/calls` | Inicia una llamada |
| `POST` | `/api/calls/:id/turns` | Envía lo que dijo el paciente; devuelve respuesta, triage y evidencia |
| `POST` | `/api/calls/:id/end` | Cierra y devuelve el resumen estructurado |
| `GET` | `/api/calls/:id/summary` | Resumen sin cerrar la llamada |
| `GET` | `/api/knowledge` | Documentos indexados |
| `POST` | `/api/knowledge` | Agrega un documento (reindexa) |
| `DELETE` | `/api/knowledge/:filename` | Elimina un documento (reindexa) |
| `POST` | `/api/retrieve` | Prueba la recuperación sin conversar |

## Métricas

Medidas contra el servidor real, no extrapoladas. Metodología y muestras
completas en `docs/DECISIONS.md`, decisiones 6 (Ollama) y 10 (Groq).

**Latencia — desde que el paciente termina de hablar hasta que el agente
tiene la respuesta lista** (no incluye reconocimiento de voz, que ocurre
antes de llegar al servidor, ni síntesis, que ocurre después):

| Motor del turno | Cuándo ocurre | Latencia |
|---|---|---|
| `scripted` / `scripted-routed` | Guion clínico fijo, caso rojo, o respuesta que no necesita al modelo (la mayoría de los turnos — ver decisión 6a) | **2-48 ms** |
| `llm` — Groq, Llama 3.3 70B (proveedor activo) | Respuesta ambigua o pregunta fuera de guion que el RAG puede fundamentar | **P50 0.685s / P95 0.756s** (N=12 de 20, ver nota de límite de tasa abajo — decisión 10) |
| `llm` — Ollama, Llama 3.2 3B (alternativa local) | Igual que arriba, con `LLM_PROVIDER=ollama` | **P50 60.8s / P95 95.3s** (N=18 de 20 — decisión 6e) |

**El proveedor cambió de Ollama a Groq el 2026-08-09** (decisión 10, tras
una comunicación oficial de Source Meridian que admite el sucesor vigente
de un modelo descontinuado): el camino `llm` pasó de romper la sensación de
conversación en vivo a ser compatible con ella, sin cambiar el enrutamiento
selectivo que decide cuándo se invoca.

**Riesgo declarado, no oculto: el nivel gratuito de Groq limita a 12.000
tokens/minuto.** En la corrida de medición (10 llamadas seguidas, sin
pausa, `tools/medir-latencia.js`), 12 de 20 intentos completaron como
`engine: 'llm'` (esos son los que arman la tabla de arriba) y 8 recibieron
`429 Rate limit reached` de la API y degradaron a `scripted-fallback` — el
mismo mecanismo de seguridad que ya existía para cualquier fallo del
proveedor, sin código nuevo. Una llamada real de evaluación, con pausas de
conversación entre turnos, es menos probable que choque contra ese límite,
pero no está garantizado. El sistema nunca se cae por esto: la respuesta a
ese turno específico degrada a guion en vez de generarse.

No se reporta un P50/P95 único combinando los motores `scripted` y `llm`:
exigiría saber qué proporción real de turnos de una llamada cae en cada
uno, y eso depende de cómo hablan los pacientes de verdad, no de algo
medible hoy con datos sintéticos.

**Turnos por llamada que invocan el modelo (naturalidad conversacional).**
En las 10 llamadas simuladas de esta medición, 2 de cada 8 turnos (**25%**)
intentaron invocar al modelo — por diseño del script de medición, no porque
así hable un paciente real: cada llamada simulada trae exactamente 2
preguntas reales fuera de guion a propósito. El dataset oficial
(`data/dataset_final.json`) no tiene suficientes preguntas espontáneas del
paciente hacia el agente como para derivar de ahí una tasa realista — el
25% de esta prueba es una cota práctica de la medición, no una predicción
de producción.

**Consumo, por turno que sí invoca el modelo** (N=7, medición contra
Ollama — no reproducida token a token contra Groq en esta sesión, que no
capturó tokens en la corrida de latencia): tokens de entrada 447-548,
tokens de salida 43-73, 1 invocación al modelo, 1 consulta al RAG (`k=1`
desde decisión 6b) por turno que llega al modelo. El conteo de tokens no
depende del proveedor — mismo prompt, mismo contexto recortado — así que
el rango se mantiene como referencia para Groq también, sujeto a
confirmarlo con una medición dedicada.

**Costo estimado por llamada, con Groq activo.** Nivel gratuito de Groq:
sin costo mientras la entrega corra dentro de ese nivel — el número que
sigue es la extrapolación a producción que pide la rúbrica, no un cobro
real de esta entrega. Precio de producción para `llama-3.3-70b-versatile`
tomado del propio campo `pricing` que devuelve
`GET https://api.groq.com/openai/v1/models` (no de una página de
marketing): **$0.59/millón de tokens de entrada, $0.79/millón de
salida**, verificado en vivo el 2026-08-09. Una llamada de ~7 turnos con
1-2 invocaciones reales al modelo (~1000-1500 tokens totales por llamada,
el resto guionado — ver decisión 6a) ronda **~$0.001-0.0015 por llamada** — sigue
bien por debajo de un centavo de dólar. La cifra que importa para la
compuerta de costo no es el precio por token, es que el enrutamiento
selectivo ya redujo cuántos turnos pagan ese precio en absoluto.

## Pendiente para la entrega del reto

- **Resuelto (2026-08-09, decisión 10): el camino `llm` ya no rompe "tiempo
  real".** Con Groq (Llama 3.3 70B, sucesor vigente de Llama 3.1 70B tras
  comunicación oficial de Source Meridian) el camino `llm` mide P50
  0.685s / P95 0.756s — dos órdenes de magnitud por debajo de los 60.8s/
  95.3s que medía Ollama local, y muy por debajo del umbral de 30s que se
  había fijado como aceptable. Queda un riesgo declarado, no una decisión
  pendiente: el nivel gratuito de Groq limita a 12.000 tokens/minuto, así
  que varias llamadas de prueba seguidas y rápidas pueden degradar algunos
  turnos a guion por `429`. El sistema nunca se cae por esto — ver
  "Métricas" arriba y `docs/DECISIONS.md`, decisión 10.
- **Nuevo pendiente que reemplaza al anterior: decidir cómo el README
  resuelve `GROQ_API_KEY` dentro de los 15 minutos de la compuerta G2** —
  una key de evaluación para la sesión del jurado, instrucciones de crear
  una gratis en el momento, o recomendar `LLM_PROVIDER=ollama` como
  respaldo garantizado sin cuenta externa. Ver `docs/DECISIONS.md`,
  "Pendientes antes de entregar".
- Recuperación híbrida (embeddings + TF-IDF): con el corpus real ya cargado,
  hay evidencia medida (no solo intuida) de que TF-IDF puro no siempre trae
  el documento correcto — ver `docs/recuperacion-despues.md`.
- Verificar que la instalación y ejecución completa toma 15 minutos o menos en
  una máquina limpia, siguiendo solo este README (compuerta G2) — sin contar
  la instalación de Ollama ni la descarga del modelo, que son prerrequisito.
- Capturas del demo y video (entregables 03/04) — ver `INFORME.md`, §13-14.

Resuelto en esta sesión (2026-08-08), ver `docs/inyeccion-prompt.md`:
endurecimiento del prompt del sistema + filtro de contenido post-generación
contra revelación de instrucciones, diagnóstico presuntivo y dosis
alucinadas; y `RED-BREATHING` en `triage.js` ahora reconoce "me cuesta
respirar" / "dificultad para respirar", no solo "me falta el aire".

**Informe final:** `INFORME.md` — declaración del modelo usado y por qué,
evidencia de proceso, métricas y limitaciones conocidas.

## Datos y alcance

No hay datos de pacientes reales en este repositorio y no debe haberlos. Los
documentos de `knowledge/` son sintéticos, escritos para ejercitar la
recuperación. La llamada ocurre por navegador; no hay telefonía real.

Este agente no diagnostica, no ajusta tratamientos y no reemplaza criterio
clínico. Su única decisión es cuándo dejar de responder y llamar a una persona.

## Licencia

MIT. Ver `LICENSE`.
