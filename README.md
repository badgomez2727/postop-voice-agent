# Agente de voz para seguimiento post-operatorio

Un paciente sale de un procedimiento y necesita que alguien esté pendiente de él
en las primeras horas. Este agente hace esa llamada: conversa por voz, interpreta
lo que el paciente reporta contra una base de conocimiento clínico, registra qué
documento sustenta cada cosa que afirma, y decide cuándo alertar a personal
capacitado.

> **Estado: en construcción (Tech Sphere Challenge 2026, Source Meridian).**
> El modelo conectado es **Llama 3.2 3B local vía Ollama** — de los cuatro
> permitidos por la rúbrica (ver `CLAUDE.md`), Gemini 1.5 Flash y Groq/Llama
> 3.1 70B quedaron descartados por no estar disponibles hoy, verificado
> contra la API en vivo (razonamiento y mediciones en `docs/DECISIONS.md`,
> decisión 5). `knowledge/` ya tiene el corpus real del reto (104 documentos
> extraídos de `../reto-oficial/dataset/textos/`, ver `tools/ingestar-corpus.js`)
> más los 4 documentos sintéticos originales de práctica.

## Cómo correrlo

Requiere Node.js 20 o superior y [Ollama](https://ollama.com) corriendo con
el modelo ya descargado.

**Antes de cronometrar los 15 minutos de la compuerta G2** (estos pasos no
cuentan dentro de ese tiempo — instalar Ollama y bajar el modelo es un paso
de máquina, no de este repositorio):

```bash
# Ubuntu/Debian: Ollama necesita zstd instalado, si no ya está.
sudo apt-get install -y zstd
curl -fsSL https://ollama.com/install.sh | sh

# Descarga el modelo (~2GB). Puede tardar varios minutos según la red.
ollama pull llama3.2:3b
```

**Si corres esto dentro de WSL2**, edita `%UserProfile%\.wslconfig` en
Windows (créalo si no existe) con al menos 8GB de memoria para la VM:

```ini
[wsl2]
memory=8GB
```

y reinicia WSL (`wsl --shutdown` desde PowerShell). Medido en esta máquina:
con la memoria por defecto de WSL2 (3GB) la latencia de una respuesta se
dispara de ~8s a ~56s — no es un margen que se pueda ignorar.

**Ahora sí, los 15 minutos:**

```bash
npm install
cp .env.example .env
npm start
```

Abre `http://localhost:3000` en Chrome o Edge (el reconocimiento de voz del
navegador no está disponible en todos). El `.env.example` ya trae
`LLM_PROVIDER=ollama` y `LLM_MODEL=llama3.2:3b` por defecto — si Ollama no
está corriendo o el modelo no se descargó, el sistema no se cae: degrada
automáticamente a diálogo guionado y avisa con una advertencia visible en la
consola del servidor (no solo en el registro de la llamada).

Para desarrollo sin ni siquiera Ollama corriendo, y sin costo, usa
`LLM_PROVIDER=none` en `.env`: corre completo con recuperación local y
diálogo guionado. Para usar Phi-3.5 Mini en vez de Llama 3.2 3B (alternativa
medida en `docs/DECISIONS.md`, decisión 5): `ollama pull phi3.5` y
`LLM_MODEL=phi3.5` en `.env`, sin tocar código.

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

Diagrama en `docs/architecture.mmd` (Mermaid).

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

Medidas contra el servidor real (`LLM_PROVIDER=ollama`, Llama 3.2 3B),
no extrapoladas. Metodología y muestras completas en `docs/DECISIONS.md`,
decisión 6.

**Latencia — desde que el paciente termina de hablar hasta que el agente
tiene la respuesta lista** (no incluye reconocimiento de voz, que ocurre
antes de llegar al servidor, ni síntesis, que ocurre después):

| Motor del turno | Cuándo ocurre | Latencia |
|---|---|---|
| `scripted` / `scripted-routed` | Guion clínico fijo, caso rojo, o respuesta que no necesita al modelo (la mayoría de los turnos — ver decisión 6a) | **7-9 ms** |
| `llm` | Respuesta ambigua o pregunta fuera de guion que el RAG puede fundamentar | **P50 15.3s / P95 37.6s** (N=7, `format: json_object` forzado — ver decisión 6d) |

No se reporta un P50/P95 único combinando ambos motores: eso exigiría saber
qué proporción real de turnos de una llamada cae en cada uno, y eso depende
de cómo hablan los pacientes de verdad, no de algo medible hoy con datos
sintéticos. Reportar un número combinado inventando esa proporción sería
peor que reportar los dos por separado.

**Consumo, por turno que sí invoca el modelo** (N=7, mismo lote de arriba):
tokens de entrada 447 (fijo — mismo prompt de prueba en cada intento),
tokens de salida 50-73, 1 invocación al modelo, 1 consulta al RAG (`k=1`
desde decisión 6b).

**Costo estimado por llamada.** Local, sin costo de API mientras corre en
esta máquina. Extrapolado a precio de nube de un modelo comparable (Llama
3.2 3B no está publicado en las calculadoras de precio usuales; usando como
referencia un modelo pequeño típico a ~$0.05-0.10 por millón de tokens de
entrada/salida): una llamada de ~7 turnos, con 1-2 invocaciones reales al
modelo (el resto guionado, ver 6a), ronda los **~1000-1500 tokens totales
por llamada — bien por debajo de un centavo de dólar** al precio de
referencia. La cifra que sí importa para la compuerta de costo no es el
precio por token, es que el enrutamiento selectivo ya redujo cuántos turnos
pagan ese precio en absoluto.

## Pendiente para la entrega del reto

- Reemplazar el diálogo guionado por reconocimiento y síntesis de voz reales
  (compuerta G4: la conversación debe funcionar con voz en tiempo real). La
  latencia del camino guionado (7-9ms) es compatible con voz en tiempo real;
  la del camino que invoca al modelo (P95 37.6s) no lo es todavía — el
  enrutamiento selectivo (decisión 6a) reduce cuántos turnos la pagan, no la
  elimina. Con solo N=7 muestras, este P50/P95 es indicativo, no definitivo.
- Ampliar la muestra de latencia del camino `llm` (N=7 es el mínimo para
  calcular algo, no un número en el que confiar para la entrega).
- Recuperación híbrida (embeddings + TF-IDF): con el corpus real ya cargado,
  hay evidencia medida (no solo intuida) de que TF-IDF puro no siempre trae
  el documento correcto — ver `docs/recuperacion-despues.md`.
- Verificar que la instalación y ejecución completa toma 15 minutos o menos en
  una máquina limpia, siguiendo solo este README (compuerta G2) — sin contar
  la instalación de Ollama ni la descarga del modelo, que son prerrequisito.
- Endurecer el prompt del sistema contra inyección de instrucciones (el agente
  nunca debe obedecer un intento de redefinir su rol o saltarse el triage).

## Datos y alcance

No hay datos de pacientes reales en este repositorio y no debe haberlos. Los
documentos de `knowledge/` son sintéticos, escritos para ejercitar la
recuperación. La llamada ocurre por navegador; no hay telefonía real.

Este agente no diagnostica, no ajusta tratamientos y no reemplaza criterio
clínico. Su única decisión es cuándo dejar de responder y llamar a una persona.

## Licencia

MIT. Ver `LICENSE`.
