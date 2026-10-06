import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LEXICON_SOURCES } from './build-kotodama-lexicon.mjs';
import '../assets/js/runtime-dependencies.js';
import '../assets/js/spell-ocr.js';
export const hash = data => createHash('sha256').update(data).digest('hex');

export function encode(index) {
  const header = Buffer.from(JSON.stringify({ version: index.version, signature: index.signature, words: index.words,
    bigrams: index.bigrams.map(([gram, ids]) => [gram, ids.length]), trigrams: index.trigrams.map(([gram, ids]) => [gram, ids.length]), forbiddenSize: index.forbiddenSize }));
  let length = 12 + header.length + index.words.length * 2;
  for (const [, ids] of [...index.bigrams, ...index.trigrams]) {
    let previous = 0;
    for (const id of ids) {
      let delta = id - previous;
      previous = id;
      do { length += 1; delta = Math.floor(delta / 128); } while (delta);
    }
  }
  const bytes = Buffer.alloc(length);
  bytes.write('OCRI'); bytes.writeUInt32LE(1, 4); bytes.writeUInt32LE(header.length, 8); header.copy(bytes, 12);
  let offset = 12 + header.length;
  for (const counts of [index.bigramCounts, index.trigramCounts]) for (const count of counts) bytes[offset++] = count;
  for (const [, ids] of [...index.bigrams, ...index.trigrams]) {
    let previous = 0;
    for (const id of ids) {
      let delta = id - previous;
      previous = id;
      while (delta >= 128) { bytes[offset++] = (delta % 128) | 128; delta = Math.floor(delta / 128); }
      bytes[offset++] = delta;
    }
  }
  return bytes;
}

export async function buildFiles({ sourceDir, outputDir }) {
  const texts = {};
  const sources = {};
  for (const name of ['canonical', 'forbidden']) {
    const source = LEXICON_SOURCES[name];
    const bytes = await readFile(resolve(sourceDir, source.file));
    if (hash(bytes) !== source.sha256) throw new Error(`Local ${name} vocabulary SHA-256 mismatch`);
    texts[name] = bytes.toString('utf8');
    sources[name] = { ...source, commit: new URL(source.url).pathname.split('/')[3], bytes: bytes.length };
  }
  const index = globalThis.SpellOcrCore.createVocabularyNgramIndex(texts.canonical, texts.forbidden);
  const binary = encode(index);
  const compressed = gzipSync(binary, { level: 9 });
  const digest = hash(compressed);
  const file = `ocr-vocabulary-index.${digest.slice(0, 16)}.bin`;
  const metadata = { formatVersion: 1, compression: 'gzip', method: 'scripts/build-ocr-vocabulary-index.mjs; unchanged ngram-index-v2; delta-varint postings; deterministic gzip level 9',
    vocabularySignature: index.signature, wordCount: index.words.length, forbiddenWordCount: index.forbiddenSize,
    bigramCount: index.bigrams.length, trigramCount: index.trigrams.length,
    decodedBytes: binary.length, decodedSha256: hash(binary), legacyJsonBytes: Buffer.byteLength(JSON.stringify(index)),
    file: { file, bytes: compressed.length, sha256: digest }, sources };
  await mkdir(outputDir, { recursive: true });
  for (const entry of await readdir(outputDir)) if (/^ocr-vocabulary-index\.[a-f0-9]{16}\.bin(?:\.gz)?$/.test(entry) && entry !== file) await rm(resolve(outputDir, entry));
  await writeFile(resolve(outputDir, file), compressed);
  await writeFile(resolve(outputDir, 'ocr-vocabulary-index.meta.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); if (at < 0) return fallback; if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`Missing value for ${name}`); return args[at + 1]; };
  const sourceDir = resolve(option('--source-dir', '.tmp/kotodama-build'));
  if (args.includes('--download')) {
    await mkdir(sourceDir, { recursive: true });
    for (const name of ['canonical', 'forbidden']) {
      const source = LEXICON_SOURCES[name];
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`Vocabulary download failed: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (hash(bytes) !== source.sha256) throw new Error(`Downloaded ${name} SHA-256 mismatch`);
      await writeFile(resolve(sourceDir, source.file), bytes);
    }
  }
  console.log(JSON.stringify(await buildFiles({ sourceDir, outputDir: resolve(option('--output-dir', 'assets/data')) }), null, 2));
}
