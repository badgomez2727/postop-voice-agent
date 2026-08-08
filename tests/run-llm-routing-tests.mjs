#!/usr/bin/env node
/**
 * Verifica esPreguntaDelPaciente() / PATRON_PREGUNTA_PACIENTE (src/llm.js)
 * a través de generateTurn() -- la función no se exporta por separado, así
 * que la aserción es sobre el efecto observable: si el turno intenta
 * invocar al modelo o no.
 *
 * Usa un OLLAMA_API_URL muerto (puerto sin nada escuchando) como forma de
 * distinguir "nunca se intentó" de "se intentó y falló": si necesitaModelo()
 * decide que SÍ hace falta el modelo, generateTurn() llama a fetch(), que
 * falla rápido (ECONNREFUSED) y degrada a `engine: 'scripted-fallback'`,
 * `modelInvocations: 1`. Si decide que NO hace falta, nunca toca la red:
 * `engine: 'scripted-routed'`, `modelInvocations: 0`. Esa diferencia es la
 * señal que estos casos verifican, no el contenido de la respuesta.
 *
 * Encontrado contra el servidor real: "Puedo caminar despacio, sin ayuda"
 * (una afirmación) invocaba al modelo y gastaba 70+ segundos en un turno
 * que el guion resolvía solo -- el patrón viejo marcaba como pregunta
 * cualquier frase que EMPEZARA con puedo/debo/será/es normal/está bien,
 * con o sin "?". Contra las 1.920 respuestas de paciente del dataset
 * oficial, 27 arrancan con "como" (verbo comer) que la clase de caracteres
 * de "cómo" hacía indistinguible de una pregunta -- cero de esas 27 son
 * preguntas. Ver docs/DECISIONS.md.
 *
 * Uso: node tests/run-llm-routing-tests.mjs
 */

import assert from 'node:assert/strict';
import { assess } from '../src/triage.js';

// OLLAMA_API_URL se lee UNA VEZ, como const de módulo, al importar
// src/llm.js -- si se fija después de un `import` estático, ese `import` ya
// se habría evaluado con el valor real (localhost:11434), por hoisting de
// ES modules, sin importar el orden de las líneas en este archivo. Import
// dinámico, después de fijar el env var, es la única forma de que el
// puerto muerto realmente se use.
process.env.LLM_PROVIDER = 'ollama';
process.env.OLLAMA_API_URL = 'http://localhost:1/no-deberia-tardar';
const { generateTurn } = await import('../src/llm.js');

const evidenciaFicticia = [{ sourceId: 'doc-prueba.md#1', text: 'Evidencia de prueba.' }];

let passed = 0;
const failures = [];

function verificar(id, condicion, mensaje) {
  if (condicion) {
    passed++;
  } else {
    failures.push({ id, mensaje });
  }
}

async function turno(utterance, evidence = evidenciaFicticia) {
  const assessment = assess(utterance);
  const session = { history: [], coveredTopics: ['apertura'] };
  return generateTurn({ session, utterance, assessment, evidence });
}

// ---- Afirmaciones que empiezan con las palabras problemáticas -- NO deben
// invocar al modelo sin "?" explícito -----------------------------------
{
  const casos = [
    'Puedo caminar despacio, sin ayuda.',
    'Debo quedarme en cama todo el día, según me dijeron.',
    'Está bien, no tengo más síntomas.',
    'Es normal que me duela un poco todavía, ya me lo habían dicho.',
    // El caso real del dataset oficial: "como" (verbo comer) colisiona con
    // "cómo" (interrogativo) en el patrón viejo.
    'Como bien, doctor, sin problema, con ganas normales.'
  ];
  for (const utterance of casos) {
    const result = await turno(utterance);
    verificar(`no-invoca-${utterance.slice(0, 20)}`, result.engine === 'scripted-routed' && result.modelInvocations === 0,
      `"${utterance}" no debía invocar al modelo -- engine: ${result.engine}, modelInvocations: ${result.modelInvocations}`);
  }
}

// ---- Las mismas frases, ahora con "?" -- SÍ deben intentar invocar -----
{
  const casos = [
    '¿Puedo bañarme normalmente con la herida así?',
    '¿Es normal que me duela un poco todavía?',
    '¿Cómo ha estado su sueño?'
  ];
  for (const utterance of casos) {
    const result = await turno(utterance);
    verificar(`si-intenta-${utterance.slice(0, 20)}`, result.engine === 'scripted-fallback' && result.modelInvocations === 1,
      `"${utterance}" debía intentar invocar al modelo (y degradar al fallar la red) -- engine: ${result.engine}, modelInvocations: ${result.modelInvocations}`);
  }
}

// ---- Signo de apertura solo ("¿") sin cierre también cuenta como señal -
{
  const result = await turno('¿Puedo bañarme normalmente con la herida');
  verificar('signo-apertura-solo', result.engine === 'scripted-fallback' && result.modelInvocations === 1,
    `"¿" de apertura sin cierre debía bastar como señal -- engine: ${result.engine}`);
}

// ---- Pregunta real, pero sin evidencia -- no hay nada que fundamentar,
// no vale la pena invocar al modelo (comportamiento sin cambios) --------
{
  const result = await turno('¿Puedo bañarme normalmente con la herida así?', []);
  verificar('pregunta-sin-evidencia-no-invoca', result.engine === 'scripted-routed' && result.modelInvocations === 0,
    `pregunta real sin evidencia no debía invocar al modelo -- engine: ${result.engine}, modelInvocations: ${result.modelInvocations}`);
}

// ---- needsClarification sigue enrutando al modelo sin cambios, con o sin
// "?" -- ese camino no depende de PATRON_PREGUNTA_PACIENTE --------------
{
  const result = await turno('Me siento raro.');
  verificar('needsClarification-sigue-invocando', result.engine === 'scripted-fallback' && result.modelInvocations === 1,
    `una respuesta ambigua (needsClarification) debía seguir intentando invocar al modelo -- engine: ${result.engine}`);
}

console.log(`Enrutamiento (esPreguntaDelPaciente): ${passed}/${passed + failures.length} casos en verde.\n`);

if (failures.length) {
  for (const { id, mensaje } of failures) {
    console.log(`✗ ${id}`);
    console.log(`  - ${mensaje}`);
  }
  console.log(`\n${failures.length} caso(s) fallaron.`);
  process.exit(1);
}

console.log('Todos los casos pasaron.');
