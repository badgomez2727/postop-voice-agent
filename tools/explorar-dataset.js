// tools/explorar-dataset.js
//
// Herramienta de un solo uso ("una sola vez") que:
//   1. Explora en solo-lectura el dataset oficial del reto en
//      ../reto-oficial/dataset/ (columnas, muestra de filas, conteo por
//      label_ground_truth, ejemplo capa1 vs. capa2).
//   2. Convierte los 4 .xlsx a JSON y los guarda en data/ DENTRO de este
//      repo, para que src/ y las pruebas dejen de necesitar ../reto-oficial/
//      o la dependencia "xlsx" en absoluto.
//
// Ya se corrió una vez y data/*.json está commiteado en este repo. La
// dependencia "xlsx" se desinstaló después (ver package.json) porque ya
// cumplió su propósito. Si el dataset oficial cambia de versión y hace falta
// regenerar data/*.json:
//   npm install --no-save xlsx
//   node tools/explorar-dataset.js
//   npm uninstall xlsx
//
// No modifica nada de ../reto-oficial/: solo lee de ahí y escribe en data/.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = path.resolve(__dirname, '../../reto-oficial/dataset');
const DATA_DIR = path.resolve(__dirname, '../data');
const SHEET_NAME = 'result';
const PREVIEW_ROWS = 5;

const ARCHIVOS = [
  'dataset_final.xlsx',
  'trayectorias_postop_silver.xlsx',
  'perfiles_clinicos_pacientes_silver_contest.xlsx',
  'perfiles_pacientes_co.xlsx',
];

function leerHoja(nombreArchivo) {
  const ruta = path.join(DATASET_DIR, nombreArchivo);
  if (!existsSync(ruta)) {
    throw new Error(`No se encontró ${ruta}. ¿Está clonado ../reto-oficial junto a este repo?`);
  }
  // cellDates: true convierte los seriales de fecha de Excel (p. ej. 46187)
  // en objetos Date reales, que JSON.stringify serializa como ISO-8601 en
  // vez de dejar un número opaco en data/*.json.
  const libro = XLSX.readFile(ruta, { cellDates: true });
  if (!libro.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`${nombreArchivo} no tiene una hoja "${SHEET_NAME}" (tiene: ${libro.SheetNames.join(', ')})`);
  }
  return XLSX.utils.sheet_to_json(libro.Sheets[SHEET_NAME], { defval: null });
}

function exportarJSON(nombreArchivo, filas) {
  mkdirSync(DATA_DIR, { recursive: true });
  const nombreJSON = nombreArchivo.replace(/\.xlsx$/i, '.json');
  const destino = path.join(DATA_DIR, nombreJSON);
  writeFileSync(destino, JSON.stringify(filas, null, 2) + '\n', 'utf8');
  console.log(`Escrito: data/${nombreJSON} (${filas.length} filas)`);
}

function linea(char = '-', n = 70) {
  console.log(char.repeat(n));
}

function mostrarColumnasYFilas(nombreArchivo, filas) {
  console.log(`\n=== ${nombreArchivo} ===`);
  linea();
  console.log(`Filas totales: ${filas.length}`);
  if (filas.length === 0) return;
  console.log(`Columnas (${Object.keys(filas[0]).length}): ${Object.keys(filas[0]).join(', ')}`);
  console.log(`\nPrimeras ${Math.min(PREVIEW_ROWS, filas.length)} filas:`);
  console.table(filas.slice(0, PREVIEW_ROWS));
}

function mostrarConteoPorLabel(filasConversaciones) {
  console.log('\n=== Conteo de casos por label_ground_truth ===');
  linea();
  // label_ground_truth es constante dentro de cada caso_id (por diseño del dataset),
  // así que contamos casos únicos, no turnos.
  const labelPorCaso = new Map();
  for (const fila of filasConversaciones) {
    labelPorCaso.set(fila.caso_id, fila.label_ground_truth);
  }
  const conteo = {};
  for (const label of labelPorCaso.values()) {
    conteo[label] = (conteo[label] ?? 0) + 1;
  }
  console.table(conteo);
  console.log(`Total de casos únicos: ${labelPorCaso.size}`);
}

function mostrarEjemploCapa1VsCapa2(filasConversaciones) {
  console.log('\n=== Ejemplo de conversación: capa1_limpia vs capa2_ruidosa ===');
  linea();

  const porCaso = new Map();
  for (const fila of filasConversaciones) {
    if (!porCaso.has(fila.caso_id)) porCaso.set(fila.caso_id, []);
    porCaso.get(fila.caso_id).push(fila);
  }

  // Buscamos el primer caso_id que tenga turnos en ambas capas.
  let casoElegido = null;
  for (const [casoId, turnos] of porCaso) {
    const capas = new Set(turnos.map((t) => t.capa));
    if (capas.has('capa1_limpia') && capas.has('capa2_ruidosa')) {
      casoElegido = casoId;
      break;
    }
  }

  if (!casoElegido) {
    console.log('No se encontró ningún caso_id con ambas capas presentes.');
    return;
  }

  const turnos = porCaso.get(casoElegido);
  const label = turnos[0].label_ground_truth;
  console.log(`caso_id: ${casoElegido}  |  label_ground_truth: ${label}\n`);

  for (const capa of ['capa1_limpia', 'capa2_ruidosa']) {
    const turnosCapa = turnos
      .filter((t) => t.capa === capa)
      .sort((a, b) => a.turno_idx - b.turno_idx);

    console.log(`--- ${capa} (${turnosCapa.length} turnos) ---`);
    for (const t of turnosCapa) {
      console.log(`  [${t.turno_idx}] (${t.dialogo_id}) ${t.hablante}: ${t.texto}`);
    }
    console.log('');
  }
}

function main() {
  console.log('Explorando dataset oficial en:', DATASET_DIR);

  const hojas = {};
  for (const archivo of ARCHIVOS) {
    hojas[archivo] = leerHoja(archivo);
    mostrarColumnasYFilas(archivo, hojas[archivo]);
  }

  mostrarConteoPorLabel(hojas['dataset_final.xlsx']);
  mostrarEjemploCapa1VsCapa2(hojas['dataset_final.xlsx']);

  console.log(`\n=== Exportando a JSON en ${DATA_DIR} ===`);
  linea();
  for (const archivo of ARCHIVOS) {
    exportarJSON(archivo, hojas[archivo]);
  }
}

main();
