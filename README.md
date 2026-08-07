# Agente de voz para seguimiento post-operatorio

Un paciente sale de un procedimiento y necesita que alguien esté pendiente de él
en las primeras horas. Este agente hace esa llamada: conversa por voz, interpreta
lo que el paciente reporta contra una base de conocimiento clínico, registra qué
documento sustenta cada cosa que afirma, y decide cuándo alertar a personal
capacitado.

> **Estado: andamiaje de práctica.** El repositorio base oficial (Tech Sphere
> Challenge 2026, Source Meridian) y su dataset clínico ya están disponibles en
> `../reto-oficial/` — ver `tools/explorar-dataset.js` para inspeccionarlo. El
> modelo de lenguaje debe ser uno de los cuatro permitidos por la rúbrica
> (ver `CLAUDE.md`); aún no está conectado en este andamiaje. El corpus incluido
> en `knowledge/` es sintético y solo sirve para probar el sistema mientras se
> integra el dataset real.

## Cómo correrlo

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env
npm start
```

Abre `http://localhost:3000` en Chrome o Edge (el reconocimiento de voz del
navegador no está disponible en todos). Sin ninguna llave de API configurada, el
sistema corre completo con recuperación local y diálogo guionado: no hay costo
mientras construyes.

Para conectar un modelo, edita `.env`:

```
LLM_PROVIDER=api
LLM_API_URL=...
LLM_API_KEY=...
LLM_MODEL=...
```

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
| `knowledge/*.md` | Base de conocimiento. Cambiarla se refleja en la siguiente pregunta |
| `tools/explorar-dataset.js` | Explora en solo lectura el dataset oficial (`../reto-oficial/dataset/`): columnas y muestra de cada `.xlsx`, conteo de casos por `label_ground_truth`, y un ejemplo de conversación capa1 vs. capa2 para el mismo `caso_id` |

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

## Pendiente para la entrega del reto

- Conectar uno de los cuatro modelos permitidos (Gemini 1.5 Flash, Llama 3.1 70B
  vía Groq, Llama 3.2 1B/3B local, o Phi-3.5 Mini) en `src/llm.js`; declarar en
  el informe final cuál y por qué.
- Cargar el corpus clínico real (`../reto-oficial/dataset/textos/`, 107 PDFs) en
  `knowledge/` en lugar del corpus sintético de práctica.
- Reemplazar el diálogo guionado por reconocimiento y síntesis de voz reales
  (compuerta G4: la conversación debe funcionar con voz en tiempo real).
- Métricas obligatorias en el README: latencia P50/P95, tokens de entrada/salida
  por turno y por llamada, invocaciones al modelo por turno, consultas al RAG
  por llamada, y costo estimado por llamada.
- Recuperación híbrida (embeddings + TF-IDF) para cerrar la brecha semántica.
- Verificar que la instalación y ejecución completa toma 15 minutos o menos en
  una máquina limpia, siguiendo solo este README (compuerta G2).
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
