#!/usr/bin/env node
/**
 * Runner de la suite de acumulación. Mismo espíritu que run-triage-tests.mjs
 * pero para escalamiento por acumulación (mergeAssessments) -- cada caso es
 * una llamada completa (varios turnos), no una sola frase.
 *
 * Uso:
 *   node tests/run-accumulation-tests.mjs
 *   node tests/run-accumulation-tests.mjs dataset   # solo casos cuyo id o
 *                                                    # categoría contenga el filtro
 */

import { assess, mergeAssessments } from '../src/triage.js';
import { cases } from './accumulation.cases.mjs';

const filter = process.argv[2];
const suite = filter
  ? cases.filter(c => c.id.includes(filter) || c.category.includes(filter))
  : cases;

if (!suite.length) {
  console.error(`Ningún caso coincide con el filtro "${filter}".`);
  process.exit(1);
}

let passed = 0;
const failures = [];

for (const testCase of suite) {
  const assessments = testCase.utterances.map(u => assess(u));
  const actual = mergeAssessments(assessments);
  const expect = testCase.expect;
  const problems = [];

  if (actual.level !== expect.level) {
    problems.push(`level: esperado "${expect.level}", obtenido "${actual.level}"`);
  }

  const expectedEscalate = expect.level === 'red';
  if (actual.escalate !== expectedEscalate) {
    problems.push(`escalate: esperado ${expectedEscalate}, obtenido ${actual.escalate}`);
  }

  if (expect.findingIds) {
    const actualIds = [...actual.findings.map(f => f.id)].sort();
    const expectedIds = [...expect.findingIds].sort();
    const same = actualIds.length === expectedIds.length && actualIds.every((id, i) => id === expectedIds[i]);
    if (!same) {
      problems.push(`findingIds: esperado [${expectedIds.join(', ')}], obtenido [${actualIds.join(', ')}]`);
    }
  } else if (expect.level === 'none' && actual.findings.length) {
    problems.push(`findings: esperado vacío, obtenido [${actual.findings.map(f => f.id).join(', ')}]`);
  }

  if (problems.length) {
    failures.push({ testCase, actual, problems });
  } else {
    passed++;
  }
}

console.log(`Acumulación: ${passed}/${suite.length} casos en verde.\n`);

if (failures.length) {
  for (const { testCase, actual, problems } of failures) {
    console.log(`✗ ${testCase.id}  [${testCase.category}]`);
    for (const p of problems) console.log(`  - ${p}`);
    if (actual.findings.length) {
      console.log(`  hallazgos: ${actual.findings.map(f => `${f.id}:"${f.trigger}"`).join(', ')}`);
    }
    console.log('');
  }
  console.log(`${failures.length} caso(s) fallaron.`);
  process.exit(1);
}

console.log('Todos los casos pasaron.');
