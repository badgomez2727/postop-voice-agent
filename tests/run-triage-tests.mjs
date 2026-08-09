#!/usr/bin/env node
/**
 * Runner de la suite de triage. Sin dependencias de test framework: el
 * proyecto no trae ninguna y esto tiene que poder correr con solo `node`.
 *
 * Uso:
 *   node tests/run-triage-tests.mjs           # toda la suite
 *   node tests/run-triage-tests.mjs negacion  # solo casos cuyo id o
 *                                              # categoría contenga el filtro
 *
 * Sale con código 1 si algo falla, para poder usarse en CI o como gate
 * antes de aceptar un cambio en src/triage.js.
 */

import { assess } from '../src/triage.js';
import { cases } from './triage.cases.mjs';

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
  const actual = assess(testCase.utterance, testCase.context ?? {});
  const expect = testCase.expect;
  const problems = [];

  if (actual.level !== expect.level) {
    problems.push(`level: esperado "${expect.level}", obtenido "${actual.level}"`);
  }

  const expectedEscalate = expect.level === 'red';
  if (actual.escalate !== expectedEscalate) {
    problems.push(`escalate: esperado ${expectedEscalate}, obtenido ${actual.escalate}`);
  }

  const expectedFlag = expect.level === 'amber';
  if (actual.flagForReview !== expectedFlag) {
    problems.push(`flagForReview: esperado ${expectedFlag}, obtenido ${actual.flagForReview}`);
  }

  const expectedClarify = expect.needsClarification ?? false;
  if (actual.needsClarification !== expectedClarify) {
    problems.push(`needsClarification: esperado ${expectedClarify}, obtenido ${actual.needsClarification}`);
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

console.log(`Triage: ${passed}/${suite.length} casos en verde.\n`);

if (failures.length) {
  for (const { testCase, actual, problems } of failures) {
    console.log(`✗ ${testCase.id}  [${testCase.category}]`);
    console.log(`  frase: "${testCase.utterance}"`);
    for (const p of problems) console.log(`  - ${p}`);
    if (actual.findings.length) {
      console.log(`  triggers: ${actual.findings.map(f => `${f.id}:"${f.trigger}"`).join(', ')}`);
    }
    console.log('');
  }
  console.log(`${failures.length} caso(s) fallaron.`);
  process.exit(1);
}

console.log('Todos los casos pasaron.');
