#!/usr/bin/env node
/**
 * Verifica que src/llm.js degrada a diálogo guionado -- nunca deja llegar
 * al paciente una respuesta mal formada -- cuando el proveedor responde
 * JSON que parsea pero no tiene la forma esperada, no solo cuando
 * JSON.parse() lanza directamente. Ver docs/DECISIONS.md, decisión 6c: el
 * hallazgo que motivó esto fue Llama 3.2 1B devolviendo una cadena entre
 * comillas -- JSON válido, forma inválida.
 *
 * Mockea `fetch` global; no necesita Ollama ni Groq corriendo.
 *
 * Uso: node tests/run-llm-shape-tests.mjs
 */

import assert from 'node:assert/strict';
import { generateTurn } from '../src/llm.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_PROVIDER = process.env.LLM_PROVIDER;

function mockFetch(content) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    })
  });
}

const session = { history: [], coveredTopics: [] };
// needsClarification: true -- así el guion de respaldo (scriptedReply) tiene
// una frase fija que devolver en cualquier caso, sea cual sea el motivo de
// la degradación, y el caso de prueba puede verificar tanto el motor como
// que la frase al paciente nunca queda vacía.
const assessment = { level: 'none', escalate: false, flagForReview: false, needsClarification: true, findings: [] };
const evidence = [];

const casos = [
  {
    id: 'respuesta-valida',
    content: '{"reply": "Cuénteme más.", "askedAbout": "aclaracion", "usedSources": [], "groundedInContext": false}',
    engineEsperado: 'llm'
  },
  {
    id: 'string-entre-comillas',
    // El hallazgo real contra Llama 3.2 1B: JSON.parse() de esto no lanza.
    content: '"Lo siento, no entendí."',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'objeto-sin-reply',
    content: '{"askedAbout": "x", "groundedInContext": false}',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'reply-vacio',
    content: '{"reply": "   ", "groundedInContext": false}',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'reply-no-string',
    content: '{"reply": 42, "groundedInContext": false}',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'groundedInContext-no-booleano',
    // Boolean("no lo tengo") da true en JS -- el riesgo concreto que motiva
    // validar el tipo, no solo la presencia del campo.
    content: '{"reply": "Cuénteme más.", "groundedInContext": "no lo tengo"}',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'array-en-vez-de-objeto',
    content: '["reply", "Cuénteme más."]',
    engineEsperado: 'scripted-fallback'
  },
  {
    id: 'texto-plano',
    // JSON.parse() ya fallaba con esto antes de este cambio -- caso de
    // control, no el hallazgo nuevo.
    content: 'Lo que dices en voz alta.',
    engineEsperado: 'scripted-fallback'
  }
];

process.env.LLM_PROVIDER = 'ollama';

let passed = 0;
const failures = [];

for (const caso of casos) {
  mockFetch(caso.content);
  const result = await generateTurn({ session, utterance: 'estoy medio maluco', assessment, evidence });
  const problems = [];

  if (result.engine !== caso.engineEsperado) {
    problems.push(`engine: esperado "${caso.engineEsperado}", obtenido "${result.engine}"`);
  }
  // La aserción central: sea cual sea el motor, nunca una respuesta vacía
  // o no-texto llega hasta lo que se le dice al paciente.
  if (typeof result.reply !== 'string' || !result.reply.trim()) {
    problems.push(`result.reply debe ser texto no vacío, fue ${JSON.stringify(result.reply)}`);
  }

  if (problems.length) {
    failures.push({ caso, problems });
  } else {
    passed++;
  }
}

globalThis.fetch = ORIGINAL_FETCH;
process.env.LLM_PROVIDER = ORIGINAL_PROVIDER;

console.log(`Forma de respuesta del modelo: ${passed}/${casos.length} casos en verde.\n`);

if (failures.length) {
  for (const { caso, problems } of failures) {
    console.log(`✗ ${caso.id}`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  console.log(`\n${failures.length} caso(s) fallaron.`);
  process.exit(1);
}

console.log('Todos los casos pasaron.');
