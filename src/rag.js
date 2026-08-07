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

export async function rebuildIndex() {
  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const files = (await fs.readdir(KNOWLEDGE_DIR)).filter(f => /\.(md|txt)$/i.test(f));

  const chunks = [];
  const docs = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const pieces = chunkDocument(raw);
    docs.push({ file, chunks: pieces.length, bytes: Buffer.byteLength(raw) });

    pieces.forEach((text, i) => {
      const tokens = tokenize(text);
      const tf = new Map();
      for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
      chunks.push({
        id: `${file}#${i + 1}`,
        file,
        position: i + 1,
        text,
        tf,
        length: tokens.length || 1
      });
    });
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

/**
 * Retrieve the passages that ground an answer.
 * Returns the evidence the agent is allowed to speak from — nothing else.
 */
export function retrieve(question, { k = 3, minScore = 0.02 } = {}) {
  if (!index.chunks.length) return [];

  const queryTokens = tokenize(question);
  if (!queryTokens.length) return [];

  const N = index.chunks.length;
  const scored = index.chunks.map(chunk => {
    let score = 0;
    for (const token of queryTokens) {
      const termFreq = chunk.tf.get(token);
      if (!termFreq) continue;
      const docFreq = index.df.get(token) || 1;
      const idf = Math.log(1 + N / docFreq);
      score += (termFreq / chunk.length) * idf;
    }
    return { chunk, score };
  });

  const max = Math.max(...scored.map(s => s.score));
  if (!max) return [];

  return scored
    .map(s => ({ ...s, score: s.score / max }))
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ chunk, score }) => ({
      sourceId: chunk.id,
      file: chunk.file,
      position: chunk.position,
      relevance: Number(score.toFixed(3)),
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
