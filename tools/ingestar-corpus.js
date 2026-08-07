// tools/ingestar-corpus.js
//
// Herramienta de un solo uso ("una sola vez") que:
//   1. Lee en solo-lectura los PDFs del corpus oficial en
//      ../reto-oficial/dataset/textos/ (5 carpetas por patología, 107 PDFs).
//   2. Extrae el texto de cada PDF y lo guarda como markdown en knowledge/,
//      con el nombre de archivo prefijado por la carpeta de origen, para que
//      cada documento del índice quede rastreable hasta su fuente (Regla 2
//      de CLAUDE.md: toda afirmación clínica debe poder rastrearse hasta el
//      documento que la sustenta).
//   3. Reporta al final, sin ingerir nada en silencio:
//      - PDFs sin texto extraíble (p. ej. escaneados sin capa OCR).
//      - Duplicados por contenido (mismo texto, distinto nombre o carpeta) —
//        solo se ingiere el primero de cada grupo. La detección es por
//        similitud de Jaccard sobre el vocabulario del documento, no por hash
//        exacto: dos PDFs del mismo artículo (p. ej. una versión "advance
//        online" y la versión final maquetada) tienen encabezados de página,
//        numeración y saltos de línea distintos aunque el contenido sea el
//        mismo, así que un hash exacto los deja pasar como si fueran
//        distintos.
//
// No modifica nada de ../reto-oficial/: solo lee de ahí y escribe en
// knowledge/ dentro de este repo. Nada en src/ depende de ../reto-oficial/;
// una vez ingerido el corpus, esta herramienta ya cumplió su propósito.
//
// Depende de "pdf-parse", instalada solo para esta corrida:
//   npm install --no-save pdf-parse
//   node tools/ingestar-corpus.js
//   npm uninstall pdf-parse
//
// Si el dataset oficial cambia de versión y hace falta re-ingerir, repetir
// esos tres pasos (borrando antes los knowledge/*.md generados por esta
// herramienta, reconocibles por su prefijo de carpeta de origen).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEXTOS_DIR = path.resolve(__dirname, '../../reto-oficial/dataset/textos');
const KNOWLEDGE_DIR = path.resolve(__dirname, '../knowledge');

// Por debajo de esto se considera que el PDF no tiene capa de texto
// aprovechable (típicamente un escaneo sin OCR). 200 caracteres es
// deliberadamente laxo: incluso una página de portada mal extraída suele
// superarlo, así que lo que cae debajo casi siempre es ruido, no contenido.
const MIN_TEXT_LENGTH = 200;

const MAX_SLUG_LENGTH = 90;

// Umbral de similitud de Jaccard sobre vocabulario normalizado para
// considerar dos documentos "el mismo contenido". Medido contra el corpus
// real: el par de duplicados verdaderos (mismo artículo, dos renderizados de
// PDF distintos) da 0.998; el par de documentos distintos más parecido del
// corpus (dos guías de seguimiento post-quirúrgico distintas, mismo tema) da
// 0.25. 0.85 deja un margen amplio a ambos lados.
const DUPLICATE_JACCARD_THRESHOLD = 0.85;

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Vocabulario normalizado para comparar documentos por contenido.
 *
 * Se descartan las líneas cortas (<25 caracteres): en el texto extraído de un
 * PDF, esas líneas son casi siempre encabezados o pies de página repetidos
 * (nombre de revista, número de página), que varían entre dos renderizados
 * del mismo artículo y ensucian la comparación. Los dígitos se colapsan a
 * "#" por la misma razón (números de página, de volumen).
 */
function vocabularioNormalizado(texto) {
  const normalizado = texto
    .split(/\n/)
    .map(linea => linea.trim())
    .filter(linea => linea.length >= 25)
    .join(' ')
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set(normalizado.split(' ').filter(Boolean));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let interseccion = 0;
  const [menor, mayor] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of menor) {
    if (mayor.has(token)) interseccion += 1;
  }
  const union = a.size + b.size - interseccion;
  return interseccion / union;
}

/** Union-find simple para agrupar documentos casi-duplicados por transitividad. */
function crearUnionFind(n) {
  const padre = Array.from({ length: n }, (_, i) => i);
  function encontrar(i) {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]];
      i = padre[i];
    }
    return i;
  }
  function unir(i, j) {
    const ri = encontrar(i);
    const rj = encontrar(j);
    if (ri !== rj) padre[ri] = rj;
  }
  return { encontrar, unir };
}

async function listarPDFs() {
  const carpetas = (await fs.readdir(TEXTOS_DIR, { withFileTypes: true }))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  const archivos = [];
  for (const carpeta of carpetas) {
    const dir = path.join(TEXTOS_DIR, carpeta);
    const nombres = (await fs.readdir(dir)).filter(f => /\.pdf$/i.test(f)).sort();
    for (const nombre of nombres) {
      archivos.push({ carpeta, nombre, ruta: path.join(dir, nombre) });
    }
  }
  return archivos;
}

async function extraerTexto(ruta) {
  const buffer = await fs.readFile(ruta);
  const parser = new PDFParse({ data: buffer });
  try {
    // pageJoiner: '' — por defecto pdf-parse inserta "-- N of M --" entre
    // cada página. No es contenido del documento: es ruido que infla la
    // relevancia de fragmentos diminutos en el TF-IDF de src/rag.js (un
    // fragmento de dos palabras con un solo término coincidente puntúa más
    // alto que uno largo y realmente relevante). Cadena vacía es "falsy" en
    // el código de pdf-parse, así que las páginas quedan unidas solo por
    // salto de línea, sin marcador.
    const resultado = await parser.getText({ pageJoiner: '' });
    return resultado.text || '';
  } finally {
    await parser.destroy();
  }
}

function nombreDestino(carpeta, nombreArchivo, usados) {
  const base = `${slugify(carpeta)}--${slugify(path.parse(nombreArchivo).name)}`
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');

  let candidato = `${base}.md`;
  let sufijo = 2;
  while (usados.has(candidato)) {
    candidato = `${base}-${sufijo}.md`;
    sufijo += 1;
  }
  usados.add(candidato);
  return candidato;
}

function contenidoMarkdown({ carpeta, nombre, ruta, texto }) {
  const fuenteRelativa = path.relative(path.resolve(__dirname, '..'), ruta);
  return `# ${nombre.replace(/\.pdf$/i, '')}

> Fuente: \`${fuenteRelativa}\` (carpeta original: ${carpeta}). Texto extraído
> automáticamente de un PDF del corpus oficial del reto por
> \`tools/ingestar-corpus.js\`. Puede incluir ruido de extracción (encabezados,
> pies de página, columnas mezcladas).

${texto.trim()}
`;
}

async function main() {
  console.log('Leyendo PDFs desde:', TEXTOS_DIR);
  const archivos = await listarPDFs();
  console.log(`Encontrados ${archivos.length} PDFs en ${new Set(archivos.map(a => a.carpeta)).size} carpetas.\n`);

  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });

  const sinTexto = [];
  const extraidos = []; // {carpeta, nombre, ruta, texto, vocab}

  for (const archivo of archivos) {
    let texto;
    try {
      texto = await extraerTexto(archivo.ruta);
    } catch (error) {
      console.error(`  ! Error extrayendo ${archivo.carpeta}/${archivo.nombre}: ${error.message}`);
      sinTexto.push({ ...archivo, motivo: `error: ${error.message}` });
      continue;
    }

    const limpio = texto.trim();
    if (limpio.length < MIN_TEXT_LENGTH) {
      sinTexto.push({ ...archivo, motivo: `solo ${limpio.length} caracteres extraídos` });
      continue;
    }

    extraidos.push({ ...archivo, texto: limpio, vocab: vocabularioNormalizado(limpio) });
  }

  // Duplicados por contenido: comparación por pares con similitud de Jaccard
  // sobre vocabulario normalizado (no hash exacto — ver comentario arriba de
  // vocabularioNormalizado). Unión-find agrupa por transitividad, en caso de
  // que el mismo artículo aparezca más de dos veces.
  const uf = crearUnionFind(extraidos.length);
  for (let i = 0; i < extraidos.length; i++) {
    for (let j = i + 1; j < extraidos.length; j++) {
      if (jaccard(extraidos[i].vocab, extraidos[j].vocab) >= DUPLICATE_JACCARD_THRESHOLD) {
        uf.unir(i, j);
      }
    }
  }

  const gruposPorRaiz = new Map(); // raíz union-find -> [índices en extraidos]
  extraidos.forEach((_, i) => {
    const raiz = uf.encontrar(i);
    if (!gruposPorRaiz.has(raiz)) gruposPorRaiz.set(raiz, []);
    gruposPorRaiz.get(raiz).push(i);
  });

  const gruposDuplicados = [...gruposPorRaiz.values()]
    .filter(indices => indices.length > 1)
    .map(indices =>
      indices
        .map(i => extraidos[i])
        .sort((a, b) => `${a.carpeta}/${a.nombre}`.localeCompare(`${b.carpeta}/${b.nombre}`))
    );

  const indiceOmitido = new Set();
  for (const grupo of gruposDuplicados) {
    for (const item of grupo.slice(1)) indiceOmitido.add(item);
  }

  const usados = new Set();
  const ingeridos = [];
  const duplicadosOmitidos = [];

  for (const item of extraidos) {
    if (indiceOmitido.has(item)) {
      duplicadosOmitidos.push(item);
      continue;
    }

    const destino = nombreDestino(item.carpeta, item.nombre, usados);
    const md = contenidoMarkdown(item);
    await fs.writeFile(path.join(KNOWLEDGE_DIR, destino), md, 'utf8');
    ingeridos.push({ ...item, destino });
  }

  console.log(`Ingeridos: ${ingeridos.length} documentos en knowledge/\n`);

  console.log('='.repeat(70));
  console.log(`PDFs sin texto extraíble (${sinTexto.length}) — NO ingeridos`);
  console.log('='.repeat(70));
  if (sinTexto.length === 0) {
    console.log('(ninguno)');
  } else {
    for (const item of sinTexto) {
      console.log(`  - ${item.carpeta}/${item.nombre}  [${item.motivo}]`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Duplicados por contenido (${gruposDuplicados.length} grupos, ${duplicadosOmitidos.length} archivos omitidos)`);
  console.log('='.repeat(70));
  if (gruposDuplicados.length === 0) {
    console.log('(ninguno)');
  } else {
    for (const grupo of gruposDuplicados) {
      console.log(`  Grupo (${grupo.length} archivos, mismo contenido):`);
      grupo.forEach((item, i) => {
        const marca = i === 0 ? 'ingerido' : 'omitido';
        console.log(`    [${marca}] ${item.carpeta}/${item.nombre}`);
      });
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('Resumen');
  console.log('='.repeat(70));
  console.log(`  Total PDFs encontrados:     ${archivos.length}`);
  console.log(`  Ingeridos a knowledge/:     ${ingeridos.length}`);
  console.log(`  Sin texto extraíble:        ${sinTexto.length}`);
  console.log(`  Duplicados omitidos:        ${duplicadosOmitidos.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
