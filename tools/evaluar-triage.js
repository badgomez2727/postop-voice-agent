// tools/evaluar-triage.js
//
// Evalúa src/triage.js contra el ground truth oficial del reto (criterio de
// 20 puntos de la rúbrica: "Lógica de decisión y escalamiento").
//
// Fuentes de datos (ver docs/evaluacion-triage.md, sección "Metodología",
// para el detalle de cómo se verificaron antes de escribir este script):
//   - data/dataset_final.json: 3991 turnos de conversación. Trae su propio
//     label_ground_truth por fila, constante por caso_id — esa es la fuente
//     real de la etiqueta, NO data/trayectorias_postop_silver.json (ese
//     archivo trae los parámetros clínicos que generaron el caso —
//     dolor_nrs, fiebre_c, etc. — pero ningún campo de etiqueta).
//   - data/trayectorias_postop_silver.json: 160 filas, una por caso. Se usa
//     aquí solo para confirmar el join 1:1 (caso_id = "caso_" + trayectoria_id).
//
// No modifica src/triage.js. Corre dos variantes en paralelo:
//   1. Baseline: assess(utterance) tal como existe hoy — sin contexto de a
//      qué pregunta estaba respondiendo el paciente.
//   2. Prototipo con contexto: assessInContextPrototype(), definida en este
//      mismo archivo, NO en src/triage.js. Deriva a qué tema estaba
//      respondiendo el paciente clasificando por palabra clave la pregunta
//      del agente inmediatamente anterior (no por posición fija de turno —
//      ver más abajo por qué), y añade una sola capacidad que assess() no
//      tiene: interpretar un puntaje numérico de dolor.
//   Esto es un prototipo de medición para decidir si vale la pena cambiar
//   src/triage.js — no es, y no pretende ser, el comportamiento del sistema
//   en producción. server.js llama a assess(utterance) sin ningún parámetro
//   de contexto hoy.
//
// Uso: node tools/evaluar-triage.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { assess, mergeAssessments } from '../src/triage.js';

const DATA_DIR = path.resolve('data');
const OUT_FILE = path.resolve('docs/evaluacion-triage.md');

const LEVEL_TO_LABEL = { none: 'verde', amber: 'amarillo', red: 'rojo' };
const LABELS = ['verde', 'amarillo', 'rojo'];
const LEVEL_ORDER = { none: 0, amber: 1, red: 2 };
const CAPAS = ['capa1_limpia', 'capa2_ruidosa'];

// ---- Carga y unión de datos -------------------------------------------------

async function cargarDatos() {
  const dataset = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'dataset_final.json'), 'utf8'));
  const trayectorias = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'trayectorias_postop_silver.json'), 'utf8'));

  // Verificación del join, en cada corrida (no solo una vez a mano): si el
  // dataset oficial cambia de versión, este script debe fallar ruidosamente
  // en vez de evaluar contra una unión rota en silencio.
  const casoIds = new Set(dataset.map(r => r.caso_id));
  const trayectoriaIds = new Set(trayectorias.map(t => 'caso_' + t.trayectoria_id));
  const sinTrayectoria = [...casoIds].filter(c => !trayectoriaIds.has(c));
  const sinCaso = [...trayectoriaIds].filter(c => !casoIds.has(c));
  if (sinTrayectoria.length || sinCaso.length) {
    throw new Error(
      `Join caso_id <-> trayectoria_id roto: ${sinTrayectoria.length} caso_id sin trayectoria, ` +
      `${sinCaso.length} trayectoria sin caso_id. Revisar antes de confiar en los números.`
    );
  }

  return { dataset, trayectorias };
}

/** Clasifica una pregunta del agente por tema, por palabra clave. */
function clasificarTema(textoAgente) {
  const s = textoAgente.toLowerCase();
  if (/dolor/.test(s)) return 'dolor';
  if (/fiebre|temperatura/.test(s)) return 'fiebre';
  if (/mover|caminar|movilidad/.test(s)) return 'movilidad';
  if (/herida/.test(s)) return 'herida';
  if (/apetit|comid|comer/.test(s)) return 'apetito';
  if (/dormir|sue.o|descansar/.test(s)) return 'sueno';
  return null; // relleno, silencio, transición -- no se puede clasificar
}

/**
 * Agrupa el dataset por caso_id -> capa -> { label, hasTercero, turnos }.
 * turnos: lista de turnos de PACIENTE en orden de turno_idx, cada uno con
 * su askedAbout derivado (tema de la pregunta de agente inmediatamente
 * anterior, o null si no se pudo clasificar).
 */
function construirCasos(dataset) {
  const porCasoCapa = new Map(); // "caso_id|capa" -> filas crudas ordenadas

  for (const fila of dataset) {
    const key = `${fila.caso_id}|${fila.capa}`;
    if (!porCasoCapa.has(key)) porCasoCapa.set(key, []);
    porCasoCapa.get(key).push(fila);
  }

  const casos = new Map(); // caso_id -> { label, capas: { capa1_limpia, capa2_ruidosa } }

  for (const [key, filas] of porCasoCapa) {
    const [casoId, capa] = key.split('|');
    filas.sort((a, b) => a.turno_idx - b.turno_idx);

    const hasTercero = filas.some(f => f.hablante === 'tercero');
    const turnosAgente = filas.filter(f => f.hablante === 'agente');
    const turnosPaciente = filas.filter(f => f.hablante === 'paciente');

    const turnos = turnosPaciente.map(tp => {
      // Tema de la pregunta de agente inmediatamente anterior a este turno
      // de paciente (por turno_idx, no por posición fija -- ver docs).
      const anteriores = turnosAgente.filter(ta => ta.turno_idx < tp.turno_idx);
      const preguntaAnterior = anteriores.length
        ? anteriores.reduce((a, b) => (a.turno_idx > b.turno_idx ? a : b))
        : null;
      return {
        texto: tp.texto,
        askedAbout: preguntaAnterior ? clasificarTema(preguntaAnterior.texto) : null
      };
    });

    if (!casos.has(casoId)) {
      casos.set(casoId, { label: filas[0].label_ground_truth, capas: {} });
    }
    casos.get(casoId).capas[capa] = { hasTercero, turnos };
  }

  return casos;
}

// ---- Prototipo de contexto (NO forma parte de src/triage.js) --------------

/**
 * Extrae un puntaje de dolor de 0 a 10 de una respuesta corta. No es un
 * parser robusto -- alcanza para medir el prototipo contra este dataset,
 * no para producción. Solo se usa cuando askedAbout === 'dolor', así que el
 * riesgo de capturar un número que no es un puntaje (día, hora) ya está
 * acotado por el contexto.
 */
function extraerPuntajeDolor(texto) {
  const match = texto.match(/\b(10|[0-9])\b/);
  return match ? Number(match[1]) : null;
}

// Umbral tomado literalmente de knowledge/03-manejo-del-dolor-y-medicacion.md:
// "Un dolor de 7 o más que no baja después de tomar el analgésico indicado
// debe reportarse para valoración."
const UMBRAL_DOLOR_AMBAR = 7;

/**
 * assess() + un solo enriquecimiento: si el tema es dolor y la respuesta es
 * un puntaje numérico >= UMBRAL_DOLOR_AMBAR que AMBER-PAIN no capturó ya
 * (esa regla busca palabras como "insoportable" o el literal "10 de 10", no
 * números sueltos), se agrega un hallazgo ámbar equivalente.
 *
 * PROTOTIPO DE MEDICIÓN. No vive en src/triage.js. server.js no pasa
 * askedAbout a assess() hoy -- este resultado no es el comportamiento
 * actual del sistema en producción, es una medición de cuánto aportaría
 * resolver el contexto, para decidir si vale la pena el cambio real.
 */
function assessInContextPrototype(utterance, askedAbout) {
  const base = assess(utterance);
  if (askedAbout !== 'dolor') return base;
  if (base.findings.some(f => f.id.startsWith('AMBER-PAIN') || f.id.startsWith('RED-'))) return base;

  const puntaje = extraerPuntajeDolor(utterance);
  if (puntaje === null || puntaje < UMBRAL_DOLOR_AMBAR) return base;

  const nivel = LEVEL_ORDER[base.level] >= LEVEL_ORDER.amber ? base.level : 'amber';
  return {
    ...base,
    level: nivel,
    flagForReview: nivel === 'amber',
    findings: [
      ...base.findings,
      {
        id: 'AMBER-PAIN-SCORE-CTX',
        level: 'amber',
        label: 'Dolor no controlado (puntaje numérico, prototipo con contexto)',
        trigger: String(puntaje)
      }
    ]
  };
}

// ---- Evaluación --------------------------------------------------------

function evaluarCaso(turnos, evaluador) {
  const assessments = turnos.map(t =>
    evaluador === 'baseline' ? assess(t.texto) : assessInContextPrototype(t.texto, t.askedAbout)
  );
  return mergeAssessments(assessments);
}

function matrizVacia() {
  const m = {};
  for (const real of LABELS) {
    m[real] = {};
    for (const pred of LABELS) m[real][pred] = 0;
  }
  return m;
}

function main() {
  return cargarDatos().then(({ dataset }) => {
    const casos = construirCasos(dataset);
    const casoIds = [...casos.keys()];

    const distribucion = { verde: 0, amarillo: 0, rojo: 0 };
    for (const c of casos.values()) distribucion[c.label]++;

    const resultados = []; // filas planas: {casoId, capa, label, hasTercero, baseline, contexto}

    for (const casoId of casoIds) {
      const caso = casos.get(casoId);
      for (const capa of CAPAS) {
        const datosCapa = caso.capas[capa];
        if (!datosCapa) continue; // no debería pasar -- se verifica más abajo
        const baseline = evaluarCaso(datosCapa.turnos, 'baseline');
        const contexto = evaluarCaso(datosCapa.turnos, 'contexto');
        resultados.push({
          casoId,
          capa,
          label: caso.label,
          hasTercero: datosCapa.hasTercero,
          turnos: datosCapa.turnos,
          baseline,
          contexto
        });
      }
    }

    // Cada caso debe tener exactamente las dos capas -- si no, el join o la
    // agrupación tienen un hueco y los números no son confiables.
    const incompletos = casoIds.filter(id => Object.keys(casos.get(id).capas).length !== 2);
    if (incompletos.length) {
      throw new Error(`${incompletos.length} caso_id sin ambas capas: ${incompletos.slice(0, 5).join(', ')}...`);
    }

    const casosConTercero = casoIds.filter(id => caso_tiene_tercero(casos.get(id)));
    function caso_tiene_tercero(c) {
      return CAPAS.some(capa => c.capas[capa]?.hasTercero);
    }

    return { casoIds, distribucion, resultados, casosConTercero, totalCasos: casoIds.length };
  });
}

// ---- Diagnóstico de patrones de falla (baseline) --------------------------
//
// El listado caso por caso ya alcanza para diagnosticar a mano, pero con 320
// combinaciones caso×capa el patrón se pierde en el detalle. Estas
// heurísticas agregan por mecanismo -- no reemplazan la lectura del listado,
// lo resumen. Cada una se corrobora contra assess() real, no contra el texto
// del paciente a ojo.

// Número de 2 dígitos en rango de fiebre (37-42) que NO está seguido por
// "grados"/"°" -- el patrón exacto que exige RED-FEVER-HIGH y AMBER-FEVER
// para reconocer una cifra como temperatura. Un paciente que solo dice
// "marcó 38.2" nunca cumple ninguna de las dos reglas.
const NUMERO_FIEBRE_SIN_UNIDAD = /\b(3[7-9]|4[0-2])(?:[.,]\d+)?\b(?!\s*(grados|°))/;
// Formas adjetivales de fiebre que no contienen el literal "fiebre"
// (AMBER-FEVER solo busca /fiebre/i, /calentura/i, /me\s+hierv\w+/i,
// /destemplanza/i, o el número+grados) -- "afiebrada" y "acalorada" no
// coinciden con ninguna.
const FORMA_ADJETIVAL_FIEBRE_SIN_MATCH = /\b(afiebrad|acalorad)\w*\b/i;

function turnosDeFalloDolor(turnos) {
  return turnos.filter(
    t =>
      NUMERO_FIEBRE_SIN_UNIDAD.test(t.texto) &&
      !/\bfiebre\b|\bcalentura\b/i.test(t.texto) &&
      !/(grados|°)/i.test(t.texto)
  );
}

function analizarPatrones(resultados) {
  const falsosNegRojo = resultados.filter(r => r.label === 'rojo' && LEVEL_TO_LABEL[r.baseline.level] !== 'rojo');
  const falsosPosRojo = resultados.filter(r => r.label !== 'rojo' && LEVEL_TO_LABEL[r.baseline.level] === 'rojo');

  const fnSinHallazgo = falsosNegRojo.filter(r => r.baseline.findings.length === 0);
  const fnConAmbar = falsosNegRojo.filter(r => r.baseline.findings.length > 0);

  const porReglaFalsoPositivo = {};
  for (const r of falsosPosRojo) {
    for (const f of r.baseline.findings.filter(f => f.level === 'red')) {
      porReglaFalsoPositivo[f.id] = (porReglaFalsoPositivo[f.id] || 0) + 1;
    }
  }

  const conFiebreSinUnidad = falsosNegRojo.filter(r => turnosDeFalloDolor(r.turnos).length > 0);
  const conFormaAdjetival = falsosNegRojo.filter(r => r.turnos.some(t => FORMA_ADJETIVAL_FIEBRE_SIN_MATCH.test(t.texto)));

  return { falsosNegRojo, falsosPosRojo, fnSinHallazgo, fnConAmbar, porReglaFalsoPositivo, conFiebreSinUnidad, conFormaAdjetival };
}

// ---- Reporte -------------------------------------------------------------

function construirMatrices(resultados, capaFiltro, evaluador) {
  const m = matrizVacia();
  for (const r of resultados) {
    if (capaFiltro && r.capa !== capaFiltro) continue;
    const pred = LEVEL_TO_LABEL[r[evaluador].level];
    m[r.label][pred]++;
  }
  return m;
}

function formatoMatriz(m) {
  const header = `| Real \\ Predicho | verde | amarillo | rojo |`;
  const sep = `|---|---|---|---|`;
  const filas = LABELS.map(real => `| **${real}** | ${m[real].verde} | ${m[real].amarillo} | ${m[real].rojo} |`);
  return [header, sep, ...filas].join('\n');
}

function recallRojo(m) {
  const totalRojo = LABELS.reduce((sum, pred) => sum + m.rojo[pred], 0);
  const detectados = m.rojo.rojo;
  return { detectados, total: totalRojo, pct: totalRojo ? ((100 * detectados) / totalRojo).toFixed(1) : 'N/A' };
}

function exactitud(m) {
  let correctos = 0, total = 0;
  for (const real of LABELS) {
    for (const pred of LABELS) {
      total += m[real][pred];
      if (real === pred) correctos += m[real][pred];
    }
  }
  return { correctos, total, pct: total ? ((100 * correctos) / total).toFixed(1) : 'N/A' };
}

function previsualizarTurnos(turnos) {
  return turnos
    .map((t, i) => `      ${i + 1}. [${t.askedAbout ?? '?'}] "${t.texto}"`)
    .join('\n');
}

function listarMalClasificados(resultados, evaluador) {
  const malos = resultados.filter(r => LEVEL_TO_LABEL[r[evaluador].level] !== r.label);
  if (!malos.length) return '(ninguno)\n';

  return malos
    .map(r => {
      const predicho = LEVEL_TO_LABEL[r[evaluador].level];
      const hallazgos = r[evaluador].findings.map(f => `${f.id} ("${f.trigger}")`).join(', ') || '(ninguno)';
      return (
        `  - **${r.casoId}** / ${r.capa} — real: **${r.label}**, predicho: **${predicho}**` +
        `${r.hasTercero ? ' — con interrupción de tercero' : ''}\n` +
        `    Hallazgos: ${hallazgos}\n` +
        `${previsualizarTurnos(r.turnos)}`
      );
    })
    .join('\n\n');
}

async function escribirReporte({ casoIds, distribucion, resultados, casosConTercero, totalCasos }) {
  const fecha = new Date().toISOString().slice(0, 10);

  const matrizBaselineTotal = construirMatrices(resultados, null, 'baseline');
  const matrizBaselineC1 = construirMatrices(resultados, 'capa1_limpia', 'baseline');
  const matrizBaselineC2 = construirMatrices(resultados, 'capa2_ruidosa', 'baseline');

  const matrizContextoTotal = construirMatrices(resultados, null, 'contexto');
  const matrizContextoC1 = construirMatrices(resultados, 'capa1_limpia', 'contexto');
  const matrizContextoC2 = construirMatrices(resultados, 'capa2_ruidosa', 'contexto');

  const patrones = analizarPatrones(resultados);

  const filasComparacion = [
    ['baseline', 'capa1_limpia', matrizBaselineC1],
    ['baseline', 'capa2_ruidosa', matrizBaselineC2],
    ['baseline', 'combinado', matrizBaselineTotal],
    ['con contexto (prototipo)', 'capa1_limpia', matrizContextoC1],
    ['con contexto (prototipo)', 'capa2_ruidosa', matrizContextoC2],
    ['con contexto (prototipo)', 'combinado', matrizContextoTotal]
  ];

  const tablaComparacion = [
    '| Variante | Capa | Recall rojo | Exactitud |',
    '|---|---|---|---|',
    ...filasComparacion.map(([variante, capa, m]) => {
      const r = recallRojo(m);
      const e = exactitud(m);
      return `| ${variante} | ${capa} | ${r.detectados}/${r.total} (${r.pct}%) | ${e.correctos}/${e.total} (${e.pct}%) |`;
    })
  ].join('\n');

  // Casos donde el prototipo con contexto cambia el resultado frente al
  // baseline (mejoras y regresiones), para que el contraste sea visible
  // caso por caso, no solo en el agregado de la tabla de arriba.
  const cambios = resultados.filter(r => r.baseline.level !== r.contexto.level);
  const mejoras = cambios.filter(r => LEVEL_TO_LABEL[r.contexto.level] === r.label && LEVEL_TO_LABEL[r.baseline.level] !== r.label);
  const regresiones = cambios.filter(r => LEVEL_TO_LABEL[r.baseline.level] === r.label && LEVEL_TO_LABEL[r.contexto.level] !== r.label);
  const neutros = cambios.filter(r => !mejoras.includes(r) && !regresiones.includes(r));

  function listarCambios(lista) {
    if (!lista.length) return '(ninguno)\n';
    return lista
      .map(r => `  - **${r.casoId}** / ${r.capa} — real: ${r.label}, baseline: ${LEVEL_TO_LABEL[r.baseline.level]}, con contexto: ${LEVEL_TO_LABEL[r.contexto.level]}`)
      .join('\n');
  }

  const contenido = `# Evaluación de \`src/triage.js\` contra el ground truth oficial

Fecha: ${fecha}. Corpus de evaluación: \`data/dataset_final.json\` +
\`data/trayectorias_postop_silver.json\`, ${totalCasos} casos (verde:
${distribucion.verde}, amarillo: ${distribucion.amarillo}, rojo:
${distribucion.rojo}). \`src/triage.js\` sin modificar.

## Metodología — qué se verificó antes de implementar

- **La etiqueta real vive en \`dataset_final.json\`**, no en
  \`trayectorias_postop_silver.json\`. Ese segundo archivo no tiene ningún
  campo de etiqueta — trae los parámetros clínicos que generaron cada caso
  (\`dolor_nrs\`, \`fiebre_c\`, \`movilidad\`, \`herida\`, \`apetito\`, \`sueno\`,
  \`arquetipo_trayectoria\`), no una etiqueta verde/amarillo/rojo. La etiqueta
  usada aquí es \`label_ground_truth\` de \`dataset_final.json\`, constante por
  \`caso_id\` (verificado en cada corrida: 0 inconsistencias).
- **Join verificado en cada corrida**, no solo a mano una vez:
  \`caso_id\` = \`"caso_" + trayectoria_id\`. Si el dataset oficial cambia de
  versión y el join se rompe, este script falla en vez de evaluar en
  silencio contra una unión incompleta.
- **\`capa1_limpia\` y \`capa2_ruidosa\` son conversaciones independientes del
  mismo caso, no la misma conversación con ruido inyectado encima.** Ambas
  capas comparten los mismos 6 turnos de paciente por caso y en general el
  mismo tema por turno, pero se generaron por separado: en \`capa1_limpia\`
  solo el 56% de los 160 casos sigue el orden exacto
  dolor→fiebre→movilidad→herida→apetito→sueño sin repetir ni saltar un
  tema — el resto tiene una pregunta de seguimiento sobre el mismo tema, un
  tema fuera de orden, o una pregunta de cierre no clasificable. La
  comparación capa1 vs. capa2 mide desempeño del triage en dos escenarios
  distintos del mismo caso clínico, no robustez ante ruido sobre un mismo
  texto — esa segunda medida requeriría el mismo texto con y sin ruido, que
  no es lo que hay aquí.
- **\`hablante\` tiene tres valores**: \`agente\`, \`paciente\`, \`tercero\`.
  \`tercero\` (interrupción de un familiar/cuidador en la llamada) se excluye
  de \`assess()\` — solo se evalúan los turnos de \`paciente\`, tal como hoy
  \`server.js\` solo le pasa a \`assess()\` lo que dice el paciente. Conteo de
  interrupciones más abajo, como material aparte para la parte
  conversacional.
- **No existe \`askedAbout\` en \`src/triage.js\`**, ni existió nunca en este
  repositorio (verificado contra \`git log -p --all\`: el término no aparece
  en ningún commit, y el archivo solo tiene un commit en toda su historia).
  \`assess(utterance)\` no tiene parámetro de contexto hoy. \`assessInContextPrototype()\`,
  definida en \`tools/evaluar-triage.js\`, es un prototipo de medición para
  decidir si vale la pena el cambio real — no vive en \`src/triage.js\` y no
  es el comportamiento actual del sistema (\`server.js\` no pasa este
  contexto a \`assess()\` hoy). Deriva el tema por palabra clave de la
  pregunta de agente inmediatamente anterior (no por posición fija de
  turno, por la variación de orden descrita arriba), y agrega una única
  capacidad que \`assess()\` no tiene: interpretar un puntaje numérico de
  dolor (umbral ≥7, tomado literalmente de
  \`knowledge/03-manejo-del-dolor-y-medicacion.md\`).

## Resumen ejecutivo

La métrica principal es el **recall de rojos**: de los 12 casos rojos, con
123 de 160 casos verdes (76.9%), un sistema que siempre responda "verde"
saca 76.9% de exactitud y es clínicamente inútil — la exactitud general no
es la métrica que importa aquí.

${tablaComparacion}

## Patrones de falla identificados (baseline)

Agregado por mecanismo sobre las ${patrones.falsosNegRojo.length} instancias
caso×capa donde el caso es rojo y el baseline no lo detecta, y las
${patrones.falsosPosRojo.length} donde el baseline predice rojo sin serlo.
Cada conteo se corrobora contra \`assess()\` real (ver \`tools/evaluar-triage.js\`,
\`analizarPatrones\`) — no es una lectura a ojo del listado de abajo, aunque
el listado permite verificar cada caso individualmente.

**Falsos negativos de rojo** (el caso es rojo, el baseline no lo detecta):
- **${patrones.fnSinHallazgo.length} de ${patrones.falsosNegRojo.length}** no disparan ningún hallazgo en absoluto —
  ninguna de las 6 respuestas del paciente coincide con ninguna regla, roja
  ni ámbar.
- **${patrones.fnConAmbar.length} de ${patrones.falsosNegRojo.length}** sí disparan un hallazgo ámbar (fiebre o
  herida) pero nunca escalan a rojo — el hallazgo existe pero se queda corto.
- **${patrones.conFiebreSinUnidad.length} de ${patrones.falsosNegRojo.length}** reportan un número en rango de fiebre
  (37-42) que ninguna regla reconoce como temperatura porque no va seguido
  de la palabra "grados" ni del símbolo "°" — ej. "marcó 38.2", "tenía como
  38, no sé si eso es mucho". Tanto \`RED-FEVER-HIGH\` como \`AMBER-FEVER\`
  exigen esa unidad explícita junto al número; un paciente que solo dice el
  número no la cumple.
- **${patrones.conFormaAdjetival.length} de ${patrones.falsosNegRojo.length}** describen fiebre con una forma
  adjetival ("afiebrada", "acalorada") que \`AMBER-FEVER\` no reconoce — esa
  regla busca el literal \`/fiebre/i\`, \`/calentura/i\`, \`/me\\s+hierv\\w+/i\` o
  \`/destemplanza/i\`, ninguno de los cuales aparece como subcadena en esas
  formas.
- Además, sin patrón automático que lo cuente: al menos dos casos
  (\`caso_tray_pac_42_00026\`, \`caso_tray_pac_42_00028\`) describen
  supuración de la herida como "líquido amarillo saliendo" / "sale un
  poquito de líquido amarillito" — clínicamente equivalente a pus, pero
  \`AMBER-WOUND\` solo reconoce el literal \`pus\`, \`mal olor\`, \`supur\\w+\`, o
  herida+color/estado (roja/caliente/hinchada/inflamada), ninguno presente
  en esa frase.

**Falsos positivos de rojo** (el baseline predice rojo, el caso no lo es) —
por regla que disparó:

${Object.entries(patrones.porReglaFalsoPositivo).map(([id, n]) => `- \`${id}\`: ${n} de ${patrones.falsosPosRojo.length}`).join('\n')}

${Object.keys(patrones.porReglaFalsoPositivo).length === 1 ? '**El 100% de los falsos positivos de rojo vienen de una sola regla.**' : ''}
\`RED-NEURO\` incluye \`/confund\\w+/i\`, \`/confusion/i\` y \`/desorientad\\w+/i\`
para capturar confusión neurológica real (signo de alarma legítimo). El
dataset la dispara sistemáticamente sobre pacientes ansiosos o mayores que
dicen "se me confunden los días" o "ya me confundo con los días" — confusión
temporal/administrativa sobre qué día es, no desorientación neurológica.
La regla no distingue las dos cosas.

## Interrupciones de tercero

**${casosConTercero.length} de ${totalCasos} casos** tienen al menos una
interrupción de un tercero (familiar/cuidador) en alguna de sus capas —
siempre en \`capa2_ruidosa\`, nunca en \`capa1_limpia\`. Excluidas de
\`assess()\` en esta evaluación. Contenido siempre de una de tres frases de
apertura idénticas ("soy el cuidador...", "soy la hija...", "habla la
esposa..."), sin información clínica en sí mismas — el riesgo real que
representan es de distracción/desvío de la conversación, no de ocultar un
hallazgo, y es material para la parte de calidad conversacional, no para
este criterio de triage.

## Matrices de confusión — baseline (\`assess()\` tal como existe hoy)

### Capa 1 (limpia)
${formatoMatriz(matrizBaselineC1)}

### Capa 2 (ruidosa)
${formatoMatriz(matrizBaselineC2)}

### Combinado (ambas capas)
${formatoMatriz(matrizBaselineTotal)}

## Matrices de confusión — con contexto (prototipo, no producción)

### Capa 1 (limpia)
${formatoMatriz(matrizContextoC1)}

### Capa 2 (ruidosa)
${formatoMatriz(matrizContextoC2)}

### Combinado (ambas capas)
${formatoMatriz(matrizContextoTotal)}

## Dónde cambia el resultado el prototipo con contexto

Comparado contra el baseline, caso por caso (no solo el agregado de arriba):

**Mejoras** (el contexto corrige un caso que el baseline clasificaba mal):
${listarCambios(mejoras)}

**Regresiones** (el contexto empeora un caso que el baseline clasificaba bien):
${listarCambios(regresiones)}

**Cambios neutros** (cambia el nivel predicho pero ninguna de las dos variantes acierta):
${listarCambios(neutros)}

## Casos mal clasificados — baseline

Con el texto del paciente turno a turno (\`[tema]\` es el \`askedAbout\` derivado
para el prototipo, no algo que el baseline use), para diagnosticar.

### Capa 1 (limpia)
${listarMalClasificados(resultados.filter(r => r.capa === 'capa1_limpia'), 'baseline')}

### Capa 2 (ruidosa)
${listarMalClasificados(resultados.filter(r => r.capa === 'capa2_ruidosa'), 'baseline')}

## Casos mal clasificados — con contexto (prototipo)

### Capa 1 (limpia)
${listarMalClasificados(resultados.filter(r => r.capa === 'capa1_limpia'), 'contexto')}

### Capa 2 (ruidosa)
${listarMalClasificados(resultados.filter(r => r.capa === 'capa2_ruidosa'), 'contexto')}
`;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, contenido, 'utf8');
  return OUT_FILE;
}

main()
  .then(async datos => {
    const out = await escribirReporte(datos);
    console.log(`Reporte escrito en ${out}`);

    const mTotal = construirMatrices(datos.resultados, null, 'baseline');
    const r = recallRojo(mTotal);
    const e = exactitud(mTotal);
    console.log(`Baseline combinado — recall rojo: ${r.detectados}/${r.total} (${r.pct}%), exactitud: ${e.pct}%`);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
