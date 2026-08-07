import fs from 'node:fs/promises';
import path from 'node:path';

const KNOWLEDGE_DIR = path.resolve('knowledge');

/**
 * In-memory index over the knowledge directory.
 *
 * Design note: the index is rebuilt from disk on every mutation, so uploading
 * or deleting a document takes effect on the very next question — no restart.
 * That is the "hot knowledge" gate: the agent learns and forgets while the
 * call is still running.
 */
let index = { chunks: [], df: new Map(), docs: [] };

const STOPWORDS = new Set(
  ('de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual sea poco ella estar haber estas estaba estamos algunas algo nosotros mi mis tu te ti tus ellas nosotras vosotros vosotras os mio mia').split(/\s+/)
);

/**
 * Very light Spanish stemmer.
 *
 * Not linguistically rigorous — it exists so that what a patient says and what a
 * clinical document says land on the same token. "sangrando" and "sangrado" have
 * to match, or the retrieval misses the passage that matters most.
 */
const SUFFIXES = [
  'aciones', 'amiento', 'imiento', 'adores', 'aciones',
  'ando', 'endo', 'ados', 'idos', 'adas', 'idas', 'ando',
  'aria', 'arias', 'able', 'ible', 'mente',
  'ado', 'ido', 'ada', 'ida', 'oso', 'osa', 'ion',
  'es', 'as', 'os', 'ar', 'er', 'ir', 'an', 'en'
];

function stem(token) {
  if (token.length <= 4) return token;
  for (const suffix of SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

/** Split a document into overlapping chunks on paragraph boundaries. */
function chunkDocument(text, { target = 700, overlap = 120 } = {}) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    if (buffer.length + paragraph.length > target && buffer) {
      chunks.push(buffer.trim());
      buffer = buffer.slice(-overlap) + '\n\n' + paragraph;
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

// ---- Calidad de fragmento --------------------------------------------------
//
// El corpus real (a diferencia de los 4 documentos sintéticos originales) es
// PDF académico extraído a texto: portadas, tablas de contenido con líderes
// de puntos, encabezados de página repetidos, DOI/ISSN/afiliaciones. Nada de
// eso es contenido clínico, pero el TF-IDF puro no lo distingue de una
// oración real — un fragmento de tres palabras en mayúsculas puede tener más
// densidad de términos de la pregunta que un párrafo entero de indicaciones.
//
// Dos mecanismos, deliberadamente separados:
//   - Umbral duro (MIN_CHUNK_TOKENS): un fragmento por debajo ni siquiera se
//     indexa. Para lo que es indiscutiblemente basura (un título suelto).
//   - Penalización continua (fragmentQuality): para lo que tiene texto de
//     sobra pero es estructuralmente ruido (tabla de contenido, encabezado de
//     revista, portada institucional) en vez de prosa clínica.

const MIN_CHUNK_TOKENS = 25;
const SHORT_LINE_MAX_CHARS = 45;

const METADATA_LINE_PATTERNS = [
  /^>/, // nuestra propia nota de "> Fuente: ..." (tools/ingestar-corpus.js) es metadato, no contenido
  /\bdoi\s*[:.]?\s*10\.\d{4,9}\//i,
  /\bissn\b/i,
  /orcid\.org/i,
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email
  /\b\d{4};\s*\d+[:\-]\d+/, // "2024;39:218-30" (año;volumen:páginas)
  /\b(received|accepted|published online|recibido|aceptado|publicado en línea)\b/i,
  /©|all rights reserved|todos los derechos reservados/i,
  /^vol\.?\s*:?\s*\(?\d/i,
  /(?:\.\s*){4,}/ // líder de puntos de tabla de contenido: ". . . . . . . 79"
];

function lineStats(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { shortLineRatio: 0, uppercaseRatio: 0, metadataLineRatio: 0, alphaDensity: 1 };

  const shortLines = lines.filter(l => l.length < SHORT_LINE_MAX_CHARS).length;
  const metadataLines = lines.filter(l => METADATA_LINE_PATTERNS.some(p => p.test(l))).length;

  let letters = 0;
  let uppercaseLetters = 0;
  let nonSpaceChars = 0;
  for (const ch of text) {
    if (/\S/.test(ch)) nonSpaceChars++;
    if (/[a-zA-ZÀ-ÿ]/.test(ch)) {
      letters++;
      if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) uppercaseLetters++;
    }
  }

  return {
    shortLineRatio: shortLines / lines.length,
    uppercaseRatio: letters ? uppercaseLetters / letters : 0,
    metadataLineRatio: metadataLines / lines.length,
    // Una tabla de contenido o de datos es casi puro punto, dígito y
    // espacio: muy pocas letras por carácter no-blanco. La prosa clínica
    // normal, incluso con cifras intercaladas, queda muy por encima de 0.6.
    alphaDensity: nonSpaceChars ? letters / nonSpaceChars : 1
  };
}

/**
 * Multiplicador de calidad en (0, 1]. 1 = prosa limpia, sin señales de
 * portada/metadato/tabla. Baja hacia 0.1 (nunca a 0 — eso es trabajo del
 * umbral absoluto en retrieve(), no de esta función) cuanto más se parezca el
 * fragmento a ruido estructural.
 */
function fragmentQuality(text) {
  const { shortLineRatio, uppercaseRatio, metadataLineRatio, alphaDensity } = lineStats(text);
  const lowDensityPenalty = Math.max(0, 0.6 - alphaDensity);
  const penalty =
    0.5 * shortLineRatio +
    0.35 * uppercaseRatio +
    0.6 * metadataLineRatio +
    1.2 * lowDensityPenalty;
  return Math.max(0.1, 1 - penalty);
}

// ---- Normalización por longitud --------------------------------------------
//
// El score TF-IDF crudo es termFreq/longitud * idf: un fragmento de 5 tokens
// con 1 coincidencia da 1/5 = 0.2; uno de 300 tokens con la misma
// coincidencia da 1/300 ≈ 0.003. Sin corrección, un fragmento diminuto con
// una sola palabra de la pregunta gana casi siempre, así sea un título.
//
// TARGET_CHUNK_TOKENS es el tamaño "esperado" de un fragmento bien formado
// (equivalente al target=700 caracteres de chunkDocument, medido en tokens
// post-stopwords sobre el corpus real). Por debajo de eso, se aplica una
// penalización — pero con piso en 0.5, no hacia 0: muchos fragmentos
// legítimamente buenos (los documentos sintéticos originales, una sección
// corta cerca de un límite de párrafo) son más cortos que el objetivo sin
// ser basura. Lo que sí es basura ya lo penaliza fragmentQuality() por su
// estructura, no por su longitud.
const TARGET_CHUNK_TOKENS = 150;

function lengthPenalty(tokenCount) {
  if (tokenCount >= TARGET_CHUNK_TOKENS) return 1;
  return 0.5 + 0.5 * (tokenCount / TARGET_CHUNK_TOKENS);
}

export async function rebuildIndex() {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const files = (await fs.readdir(KNOWLEDGE_DIR)).filter(f => /\.(md|txt)$/i.test(f));

  const chunks = [];
  const docs = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const pieces = chunkDocument(raw);
    let indexedCount = 0;

    pieces.forEach((text, i) => {
      const tokens = tokenize(text);
      // Fragmento por debajo del mínimo indexable (portada, título suelto):
      // no entra al índice en absoluto, no solo se penaliza.
      if (tokens.length < MIN_CHUNK_TOKENS) return;

      const tf = new Map();
      for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);

      chunks.push({
        id: `${file}#${i + 1}`,
        file,
        position: i + 1,
        text,
        tf,
        length: tokens.length,
        // Peso estático del fragmento (no depende de la pregunta): calidad
        // estructural × penalización por longitud. Se calcula una vez aquí,
        // no en cada retrieve().
        weight: fragmentQuality(text) * lengthPenalty(tokens.length)
      });
      indexedCount++;
    });

    docs.push({ file, chunks: indexedCount, bytes: Buffer.byteLength(raw) });
  }

  const df = new Map();
  for (const chunk of chunks) {
    for (const token of chunk.tf.keys()) df.set(token, (df.get(token) || 0) + 1);
  }

  index = { chunks, df, docs };
  return listDocuments();
}

export function listDocuments() {
  return {
    documents: index.docs,
    totalChunks: index.chunks.length
  };
}

// Umbral absoluto por defecto sobre el score crudo (post-peso), no sobre el
// normalizado. Calibrado contra el corpus real, no elegido a ojo:
//   - Preguntas sin ningún vocabulario en común con el corpus ("¿cuál es la
//     capital de Mongolia?") dan 0 exacto — siempre quedan fuera.
//   - Una coincidencia de una sola palabra por accidente semántico (misma
//     palabra, sentido distinto — "capital" en el sentido de una ciudad vs.
//     "a nivel administrativo... recursos de capital" en un artículo médico)
//     puede dar ~0.03-0.04. TF-IDF no distingue sentidos; esto no lo arregla
//     ningún umbral.
//   - Una mención corta pero real de un síntoma cubierto por el corpus
//     ("tengo fiebre") da ~0.05.
// 0.04 separa los dos primeros casos del tercero con el margen que da el
// corpus actual, sesgado a favor de NO silenciar una mención real: el falso
// negativo (evidencia que sí existe pero no se devuelve) es peor que dejar
// pasar alguna coincidencia débil, igual que en triage.js (ver CLAUDE.md,
// regla 6). No es una separación perfecta — con un lote de preguntas más
// grande puede hacer falta recalibrar, por eso es una variable de entorno y
// no una constante enterrada en la lógica.
const DEFAULT_MIN_ABSOLUTE_SCORE = Number.isFinite(Number(process.env.RAG_MIN_ABSOLUTE_SCORE))
  ? Number(process.env.RAG_MIN_ABSOLUTE_SCORE)
  : 0.04;

/**
 * Retrieve the passages that ground an answer.
 * Returns the evidence the agent is allowed to speak from — nothing else.
 *
 * Si nada supera `minAbsoluteScore`, devuelve [] — el agente debe poder decir
 * "no tengo información sobre eso" en vez de citar el mejor fragmento
 * disponible aunque no venga a cuento. Antes de este cambio no existía esa
 * salida: `relevance` se normalizaba por el máximo del lote, así que el
 * primer resultado siempre marcaba 1.0 sin importar qué tan irrelevante
 * fuera en términos absolutos.
 */
export function retrieve(question, { k = 3, minAbsoluteScore = DEFAULT_MIN_ABSOLUTE_SCORE } = {}) {
  if (!index.chunks.length) return [];

  const queryTokens = tokenize(question);
  if (!queryTokens.length) return [];

  const N = index.chunks.length;
  const scored = index.chunks.map(chunk => {
    let termScore = 0;
    for (const token of queryTokens) {
      const termFreq = chunk.tf.get(token);
      if (!termFreq) continue;
      const docFreq = index.df.get(token) || 1;
      const idf = Math.log(1 + N / docFreq);
      termScore += (termFreq / chunk.length) * idf;
    }
    return { chunk, rawScore: termScore * chunk.weight };
  });

  const maxRaw = Math.max(...scored.map(s => s.rawScore));
  // Nada llega ni al umbral absoluto: no hay evidencia que devolver, así el
  // mejor candidato del lote sea comparativamente el "menos malo".
  if (!maxRaw || maxRaw < minAbsoluteScore) return [];

  return scored
    .filter(s => s.rawScore >= minAbsoluteScore)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, k)
    .map(({ chunk, rawScore }) => ({
      sourceId: chunk.id,
      file: chunk.file,
      position: chunk.position,
      rawScore: Number(rawScore.toFixed(4)),
      // relevance sigue siendo relativa al mejor resultado DE ESTE lote (para
      // la barra de la consola en public/index.html) — rawScore es la que
      // dice si ese "mejor resultado" era en sí mismo bueno.
      relevance: Number((rawScore / maxRaw).toFixed(3)),
      text: chunk.text
    }));
}

export async function saveDocument(filename, content) {
  const safe = path.basename(filename).replace(/[^\w.\-ñáéíóúü ]/gi, '_');
  if (!/\.(md|txt)$/i.test(safe)) {
    throw new Error('Only .md and .txt files can be added to the knowledge base.');
  }
  await fs.writeFile(path.join(KNOWLEDGE_DIR, safe), content, 'utf8');
  await rebuildIndex();
  return safe;
}

export async function deleteDocument(filename) {
  const safe = path.basename(filename);
  await fs.unlink(path.join(KNOWLEDGE_DIR, safe));
  await rebuildIndex();
  return safe;
}
