import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { encode } from '../scripts/build-ocr-vocabulary-index.mjs';
import '../assets/js/streaming-sha256.js';
import '../assets/js/model-cache.js';
import '../assets/js/ocr-vocabulary-index.js';
const core = globalThis.SpellOcrCore;
const codec = globalThis.OcrVocabularyIndex;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const fixture = core.createVocabularyNgramIndex('\uFEFFhello\nworld\ncat\nbat\na\ni\niv\nbar\nthunder\nthumber\nblast\nflashest', 'bat\nfoo bar');
assert.deepEqual(core.findForbiddenWords(['cat', 'BAT', 'bat', 'bar!'], new Set(['bat', 'foo'])), ['bat']);
assert.throws(
  () => core.assertNoForbiddenWords(['cat', 'BAT', 'bat'], new Set(['bat']), 'Cat BAT bat'),
  error => error.code === 'FORBIDDEN_WORDS' &&
    error.name === 'ForbiddenWordsError' &&
    error.message === '封じられた言霊が混じっている: bat' &&
    error.spellText === 'Cat BAT bat' &&
    JSON.stringify(error.forbiddenWords) === JSON.stringify(['bat']),
);
const binary = encode(fixture);
const decoded = codec.decode(arrayBuffer(binary));
const normalize = index => ({ ...index, bigramCounts: Array.from(index.bigramCounts), trigramCounts: Array.from(index.trigramCounts),
  bigrams: index.bigrams.map(([g, ids]) => [g, Array.from(ids)]), trigrams: index.trigrams.map(([g, ids]) => [g, Array.from(ids)]) });
assert.deepEqual(normalize(decoded), fixture, 'Decoded words, grams, counts and every ordered posting must match the existing generator.');
assert.equal(decoded.bigramCounts.buffer.byteLength, fixture.words.length, 'Small counts must not retain the decompressed binary buffer.');
assert.equal(decoded.trigramCounts.buffer.byteLength, fixture.words.length);
assert.equal(decoded.bigrams[0][1].buffer, decoded.trigrams[0][1].buffer, 'All posting views must share a single Uint32 buffer.');
assert.deepEqual(encode(fixture), binary, 'Codec output must be deterministic.');
const mistakes = ['hellp', 'world', 'bat', 'bar', 'thumder', 'flast'];
assert.deepEqual(core.createVocabularyCorrector(decoded).correctWords(mistakes), core.createVocabularyCorrector(fixture).correctWords(mistakes),
  'Typed posting/count representations must preserve complete correction results and ranking.');
const zip = gzipSync(binary, { level: 9 });
const meta = { formatVersion: 1, compression: 'gzip', vocabularySignature: fixture.signature, wordCount: fixture.words.length, decodedBytes: binary.length,
  file: { file: `ocr-vocabulary-index.${sha(zip).slice(0, 16)}.bin`, bytes: zip.length, sha256: sha(zip) } };
const baseUrl = 'https://example.test/tools/';
const metaUrl = new URL('assets/data/ocr-vocabulary-index.meta.json', baseUrl).href;
const dataUrl = new URL(`assets/data/${meta.file.file}`, baseUrl).href;
let offline = false;
let downloads = 0;
let dataResponse = zip;
const stores = new Map();
const deletedNames = [];
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
globalThis.caches = { async delete(name) { deletedNames.push(name); return true; }, async open() { return {
  async match(url) { return stores.get(url)?.clone(); },
  async put(url, response) { stores.set(url, new Response(await response.arrayBuffer(), { headers: response.headers })); },
  async delete(url) { return stores.delete(url); },
}; } };
globalThis.fetch = async url => {
  if (offline) throw new TypeError('injected offline');
  if (url === metaUrl) return new Response(JSON.stringify(meta));
  assert.equal(url, dataUrl, 'Runtime must not download raw SCOWL/profanity dictionaries.');
  downloads += 1;
  return new Response(dataResponse);
};
try {
  let loader;
  const cache = ModelCache.create({ name: 'ocr-vocabulary-test', validate: (url, response) => loader.validate(url, response) });
  const stages = [];
  loader = codec.create({ cache, baseUrl, onStage: name => stages.push(name) });
  assert.deepEqual(normalize(await loader.load()), fixture);
  assert.equal(downloads, 1);
  assert.deepEqual(deletedNames, ['magia-circle-kotodama-dictionaries-v1'], 'Only the known superseded dictionary namespace may be removed.');
  assert.ok(stages.includes('vocabulary-index-decode-start'));
  assert.ok(!stages.includes('vocabulary-index-create-start'));
  offline = true;
  loader = codec.create({ cache, baseUrl });
  assert.deepEqual(normalize(await loader.load()), fixture, 'A new loader must work offline with cached metadata and compressed index.');
  assert.equal(downloads, 1);
  offline = false;
  stores.set(dataUrl, new Response(new Uint8Array(zip.length)));
  assert.deepEqual(normalize(await loader.load()), fixture, 'Corrupt cached bytes must be evicted and downloaded again.');
  assert.equal(downloads, 2);
  stores.delete(dataUrl);
  dataResponse = new Uint8Array(zip.length);
  await assert.rejects(loader.load(), /検証/);
  assert.equal(stores.has(dataUrl), false, 'Bad download must never enter Cache Storage.');
  offline = true;
  await assert.rejects(loader.load(), /offline/);
  const readOnly = { async match() {}, async put() { return false; }, async load() { return new Response(zip); } };
  globalThis.caches.delete = async () => { throw new Error('injected storage denied'); };
  offline = false;
  assert.deepEqual(normalize(await codec.create({ cache: readOnly, baseUrl }).load()), fixture, 'Read-only Cache Storage must still allow loading.');
} finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }

for (const length of [0, 4, 11, binary.length - 1]) assert.throws(() => codec.decode(arrayBuffer(binary.subarray(0, length))), /format|Truncated|Invalid/);
const mutate = change => { const bytes = Buffer.from(binary); change(bytes); return arrayBuffer(bytes); };
assert.throws(() => codec.decode(mutate(b => b.writeUInt32LE(2, 4))), /format/);
assert.throws(() => codec.decode(mutate(b => b.writeUInt32LE(0xffffffff, 8))), /Truncated/);
const postingsStart = 12 + binary.readUInt32LE(8) + fixture.words.length * 2;
assert.throws(() => codec.decode(mutate(b => b.fill(255, postingsStart, postingsStart + 4))), /overflow|Invalid/);
assert.throws(() => codec.decode(arrayBuffer(Buffer.concat([binary, Buffer.from([0])]))), /trailing/);
await assert.rejects(codec.readResponse(new Response(zip), { ...meta, decodedBytes: binary.length + 1 }), /byte count/);
await assert.rejects(codec.readResponse(new Response(zip), { ...meta, vocabularySignature: 'bad' }), /metadata/);
await assert.rejects(codec.readResponse(new Response(zip), { ...meta, compression: 'br' }), /compression/);

const kotodamaLexicon = JSON.parse(await readFile(new URL('../assets/data/kotodama-lexicon.json', import.meta.url)));
const sharedForbiddenWords = new Set(kotodamaLexicon.forbidden);
for (const word of ['fuck', 'shit', 'damn']) assert.ok(sharedForbiddenWords.has(word));
assert.throws(
  () => core.assertNoForbiddenWords(['hello', 'fuck', 'shit', 'fuck'], sharedForbiddenWords, 'hello fuck shit fuck'),
  error => error.message === '封じられた言霊が混じっている: fuck, shit',
);

const publishedMeta = JSON.parse(await readFile(new URL('../assets/data/ocr-vocabulary-index.meta.json', import.meta.url)));
const publishedZip = await readFile(new URL(`../assets/data/${publishedMeta.file.file}`, import.meta.url));
assert.equal(publishedZip.length, publishedMeta.file.bytes);
assert.equal(sha(publishedZip), publishedMeta.file.sha256);
const publishedBinary = gunzipSync(publishedZip);
assert.equal(publishedBinary.length, publishedMeta.decodedBytes);
assert.equal(sha(publishedBinary), publishedMeta.decodedSha256);
const published = codec.decode(arrayBuffer(publishedBinary));
assert.equal(published.words.length, 486609);
assert.equal(published.signature, publishedMeta.vocabularySignature);
assert.equal(published.forbiddenSize, 463);
for (const word of ['fuck', 'shit', 'damn']) assert.equal(published.words.includes(word), false);
console.log('PASS_OCR_VOCABULARY_INDEX (deterministic codec, published provenance, cold/warm/offline cache, corruption, read-only cache, truncated/overflow input)');
