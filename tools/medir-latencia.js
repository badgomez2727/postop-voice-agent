// tools/medir-latencia.js
//
// Mide la latencia real del camino que invoca al modelo (`engine: 'llm'`)
// contra el servidor real, con Ollama corriendo -- métrica obligatoria del
// README (P50/P95, CLAUDE.md). Sustituye la medición anterior (N=7,
// docs/DECISIONS.md decisión 6d) por una muestra de N>=20.
//
// Simula varias llamadas completas (no una sola turno-suelto): cada llamada
// mezcla respuestas que el guion resuelve solo (avanzan SCRIPT sin tocar el
// modelo) con preguntas reales fuera de guion, con "?" y sobre temas que
// knowledge/ sí cubre -- así el enrutamiento selectivo (src/llm.js,
// necesitaModelo()) decide invocar al modelo exactamente como lo haría en
// producción, no de forma forzada.
//
// La primera invocación de la corrida se descarta del P50/P95 y se reporta
// aparte -- es arranque en frío de Ollama (carga del modelo en memoria),
// no representativo de los turnos siguientes dentro de la misma sesión de
// evaluación.
//
// También mide, por llamada, qué fracción de los turnos terminó invocando
// al modelo (modelInvocations > 0) -- el dato que dice si la naturalidad
// conversacional (preguntas del paciente respondidas con el modelo, no
// redirigidas al guion) es viable dado el enrutamiento actual.
//
// Requiere el servidor corriendo con LLM_PROVIDER=ollama y Ollama real
// respondiendo (ollama serve + modelo descargado). Con LLM_PROVIDER=none
// esto no mide nada -- todos los turnos saldrían `scripted`.
//
// Uso: node tools/medir-latencia.js [URL_BASE]
//   (por defecto http://localhost:3000)

const BASE = process.argv[2] || 'http://localhost:3000';

// Respuestas que el guion resuelve solo -- varias formulaciones por tema,
// para que las 10 llamadas no repitan literalmente la misma frase.
const RESPUESTAS_GUION = {
  dolor: [
    'El dolor está en un 3 de 10, en la zona de la incisión.',
    'El dolor ha bajado, ahora es un 2 de 10.',
    'Sigo con dolor, como un 4, pero se soporta.'
  ],
  fiebre: [
    'No he tenido fiebre ni escalofríos.',
    'No he tenido fiebre.',
    'No he sentido calentura ni escalofríos estos días.'
  ],
  movilidad: [
    'Puedo caminar despacio, con ayuda del andador.',
    'No he tenido problemas para moverme.',
    'Me cuesta un poco moverme, pero puedo levantarme solo.'
  ],
  herida: [
    'La herida está seca, sin enrojecimiento.',
    'La herida se ve bien, sin secreción.',
    'La herida sigue igual, sin cambios raros.'
  ],
  apetito: [
    'El apetito ha estado bien, casi normal.',
    'El apetito ha estado bajo estos días.',
    'He comido bien, sin náuseas.'
  ],
  sueno: [
    'He dormido más o menos, con algunas interrupciones.',
    'He dormido bastante mal por el dolor.',
    'He dormido bien, sin interrupciones.'
  ]
};

// Preguntas reales fuera de guion -- con "?" (necesario tras el arreglo de
// PATRON_PREGUNTA_PACIENTE) y sobre temas que knowledge/ sí cubre, para que
// necesitaModelo() las enrute de verdad, no de forma forzada.
const PREGUNTAS_REALES = [
  '¿Es normal que la herida me duela más en la noche que en el día?',
  '¿Puedo bañarme normalmente con la herida así?',
  '¿Cuánto tiempo es normal sentir hinchazón en la pierna operada?',
  '¿Es peligroso si se me olvida una dosis del anticoagulante?',
  '¿Qué señales de infección debo vigilar en la herida?',
  '¿Es normal no tener nada de apetito todavía?',
  '¿Puedo tomar ibuprofeno además de lo que me recetaron?',
  '¿Es normal despertarme varias veces en la noche por molestias?',
  '¿Cuándo puedo volver a manejar después de esta cirugía?',
  '¿Es normal sentir hormigueo cerca de la herida?'
];

// 10 llamadas simuladas, 8 turnos cada una: 6 respuestas de guion (una por
// tema) + 2 preguntas reales intercaladas en posiciones distintas, para
// acercarse a cómo se distribuiría una pregunta real del paciente dentro de
// una llamada -- no todas al principio ni todas al final.
const TEMAS = ['dolor', 'fiebre', 'movilidad', 'herida', 'apetito', 'sueno'];
const LLAMADAS = [];
for (let i = 0; i < 10; i++) {
  const respuestas = TEMAS.map((tema, j) => RESPUESTAS_GUION[tema][(i + j) % 3]);
  const p1 = PREGUNTAS_REALES[(2 * i) % PREGUNTAS_REALES.length];
  const p2 = PREGUNTAS_REALES[(2 * i + 1) % PREGUNTAS_REALES.length];
  const turnos = [...respuestas];
  turnos.splice(2, 0, p1); // una pregunta real a la mitad
  turnos.push(p2); // otra al final
  LLAMADAS.push(turnos);
}

async function jsonPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function percentil(valores, p) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.ceil((p / 100) * ordenados.length) - 1;
  return ordenados[Math.max(0, Math.min(indice, ordenados.length - 1))];
}

async function correrLlamada(utterances, indiceLlamada) {
  const { callId } = await jsonPost('/api/calls');
  const turnos = [];
  for (const utterance of utterances) {
    const t0 = Date.now();
    const turno = await jsonPost(`/api/calls/${callId}/turns`, { utterance });
    const wallMs = Date.now() - t0;
    turnos.push({
      utterance,
      engine: turno.engine,
      modelInvocations: turno.metrics?.modelInvocations ?? 0,
      latencyMs: turno.metrics?.latencyMs ?? wallMs
    });
    console.log(
      `  [llamada ${indiceLlamada}] ${turno.engine.padEnd(18)} ` +
      `${String(turno.metrics?.latencyMs ?? wallMs).padStart(7)} ms  "${utterance.slice(0, 50)}"`
    );
  }
  return { callId, turnos };
}

async function main() {
  console.log(`Midiendo contra ${BASE} -- ${LLAMADAS.length} llamadas simuladas.\n`);

  const llamadas = [];
  for (let i = 0; i < LLAMADAS.length; i++) {
    llamadas.push(await correrLlamada(LLAMADAS[i], i + 1));
  }

  const todosLosTurnos = llamadas.flatMap(l => l.turnos);
  const invocacionesModelo = todosLosTurnos.filter(t => t.engine === 'llm');

  if (invocacionesModelo.length < 2) {
    console.error(
      `\nSolo ${invocacionesModelo.length} turno(s) con engine 'llm' -- no alcanza para P50/P95. ` +
      `¿Está Ollama corriendo y LLM_PROVIDER=ollama en el servidor?`
    );
    process.exit(1);
  }

  const [arranqueFrio, ...resto] = invocacionesModelo;
  const latenciasResto = resto.map(t => t.latencyMs);

  const porLlamada = llamadas.map((l, i) => {
    const conModelo = l.turnos.filter(t => t.engine === 'llm').length;
    return { llamada: i + 1, turnos: l.turnos.length, conModelo, fraccion: conModelo / l.turnos.length };
  });
  const fraccionPromedio =
    porLlamada.reduce((sum, l) => sum + l.fraccion, 0) / porLlamada.length;

  console.log('\n=== Resultado ===\n');
  console.log(`Arranque en frío (1er turno con engine 'llm' de la corrida, reportado aparte):`);
  console.log(`  ${arranqueFrio.latencyMs} ms -- "${arranqueFrio.utterance}"\n`);

  console.log(`Invocaciones al modelo excluyendo el arranque en frío: N=${latenciasResto.length}`);
  console.log(`  P50: ${percentil(latenciasResto, 50)} ms`);
  console.log(`  P95: ${percentil(latenciasResto, 95)} ms`);
  console.log(`  min: ${Math.min(...latenciasResto)} ms  max: ${Math.max(...latenciasResto)} ms\n`);

  console.log('Turnos por llamada que invocaron al modelo (naturalidad conversacional):');
  for (const l of porLlamada) {
    console.log(`  llamada ${l.llamada}: ${l.conModelo}/${l.turnos} turnos (${(100 * l.fraccion).toFixed(0)}%)`);
  }
  console.log(`  promedio: ${(100 * fraccionPromedio).toFixed(1)}% de los turnos por llamada\n`);

  console.log(JSON.stringify(
    {
      arranqueFrioMs: arranqueFrio.latencyMs,
      n: latenciasResto.length,
      p50: percentil(latenciasResto, 50),
      p95: percentil(latenciasResto, 95),
      min: Math.min(...latenciasResto),
      max: Math.max(...latenciasResto),
      latencias: latenciasResto,
      porLlamada,
      fraccionPromedio
    },
    null,
    2
  ));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
