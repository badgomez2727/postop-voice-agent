#!/usr/bin/env node
/**
 * Verifica el guion de respaldo (scriptedReply, src/llm.js) para el caso
 * RED-PSYCH -- riesgo psicosocial (src/triage.js). No mockea `fetch`
 * porque no debería hacer falta: la aserción central es que un hallazgo
 * RED-PSYCH nunca llega al modelo, ni siquiera con un proveedor real
 * configurado -- si `fetch` se llamara, la prueba fallaría por timeout o
 * por tocar una red que no debería tocar.
 *
 * Encontrado revisando 7 llamadas reales: "estoy muy deprimido" y "sí no
 * tengo ganas de vivir" dieron level: none y el sistema respondió con el
 * guion de cierre. Ver docs/DECISIONS.md.
 *
 * Uso: node tests/run-llm-scripted-tests.mjs
 */

import assert from 'node:assert/strict';
import { generateTurn } from '../src/llm.js';
import { assess } from '../src/triage.js';

const ORIGINAL_PROVIDER = process.env.LLM_PROVIDER;
// A propósito: si el código llamara a fetch() aquí, apuntaría a un puerto
// sin nada escuchando y la prueba fallaría rápido y ruidosamente, en vez de
// dejar pasar en silencio una llamada real al modelo para un caso rojo.
process.env.LLM_PROVIDER = 'ollama';
process.env.OLLAMA_API_URL = 'http://localhost:1/no-deberia-llamarse';

const session = { history: [], coveredTopics: [] };

let passed = 0;
const failures = [];

function verificar(id, condicion, mensaje) {
  if (condicion) {
    passed++;
  } else {
    failures.push({ id, mensaje });
  }
}

// ---- RED-PSYCH: nunca llega al modelo, respuesta específica --------------
{
  const assessment = assess('Sí, no tengo ganas de vivir.');
  assert.equal(assessment.level, 'red', 'precondición: assess() debe dar rojo para este caso de prueba');
  assert.ok(
    assessment.findings.some(f => f.id === 'RED-PSYCH'),
    'precondición: debe traer el hallazgo RED-PSYCH'
  );

  const result = await generateTurn({ session, utterance: 'Sí, no tengo ganas de vivir.', assessment, evidence: [] });

  verificar('red-psych-engine-scripted', result.engine === 'scripted-routed',
    `engine debía ser "scripted-routed" (nunca llega al modelo), fue "${result.engine}"`);
  verificar('red-psych-modelInvocations-cero', result.modelInvocations === 0,
    `modelInvocations debía ser 0, fue ${result.modelInvocations}`);
  verificar('red-psych-menciona-linea-106', result.reply.includes('106'),
    `la respuesta debe nombrar la Línea 106, no la menciona: "${result.reply}"`);
  verificar('red-psych-menciona-eps', /EPS/i.test(result.reply),
    `la respuesta debe nombrar la línea de salud mental de la EPS, no la menciona: "${result.reply}"`);
  verificar('red-psych-no-generica', !result.reply.includes('vaya a urgencias'),
    'la respuesta no debe ser la genérica de escalamiento (esa es para sangrado/respiración, no para riesgo psicosocial)');
  verificar('red-psych-no-cierra-la-llamada', result.askedAbout !== 'cierre',
    `askedAbout no debe ser "cierre" -- este turno no debe empujar hacia terminar la llamada, fue "${result.askedAbout}"`);
}

// ---- Control: un rojo distinto sigue usando la respuesta genérica --------
{
  const assessment = assess('Estoy sangrando mucho y no para.');
  assert.equal(assessment.level, 'red');
  assert.ok(!assessment.findings.some(f => f.id === 'RED-PSYCH'));

  const result = await generateTurn({ session, utterance: 'Estoy sangrando mucho y no para.', assessment, evidence: [] });

  verificar('red-generico-sigue-generico', result.reply.includes('vaya a urgencias'),
    `un rojo que no es RED-PSYCH debe seguir usando la respuesta genérica de escalamiento, la respuesta fue: "${result.reply}"`);
  verificar('red-generico-engine-scripted', result.engine === 'scripted-routed',
    `engine debía ser "scripted-routed", fue "${result.engine}"`);
}

process.env.LLM_PROVIDER = ORIGINAL_PROVIDER;

console.log(`Guion de respaldo (RED-PSYCH): ${passed}/${passed + failures.length} casos en verde.\n`);

if (failures.length) {
  for (const { id, mensaje } of failures) {
    console.log(`✗ ${id}`);
    console.log(`  - ${mensaje}`);
  }
  console.log(`\n${failures.length} caso(s) fallaron.`);
  process.exit(1);
}

console.log('Todos los casos pasaron.');
