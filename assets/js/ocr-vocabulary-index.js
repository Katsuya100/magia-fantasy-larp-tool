/* Precomputed OCR vocabulary: no source dictionaries or n-gram construction at runtime. */
(function exposeOcrVocabularyIndex(global) {
  'use strict';
  const META_PATH = 'assets/data/ocr-vocabulary-index.meta.json';
  const FORMAT_VERSION = 1;
  const MAX_WORDS = 1000000;
  const MAX_POSTINGS = 30000000;

  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'OCRI' || view.getUint32(4, true) !== FORMAT_VERSION) {
      throw new Error('Unsupported OCR vocabulary format');
    }
    const headerLength = view.getUint32(8, true);
    if (headerLength < 2 || headerLength > bytes.length - 12) throw new Error('Truncated OCR vocabulary header');
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + headerLength)));
    if (header.version !== 2 || typeof header.signature !== 'string' || !Array.isArray(header.words) ||
        !header.words.length || header.words.length > MAX_WORDS || !Number.isSafeInteger(header.forbiddenSize) || header.forbiddenSize < 0) {
      throw new Error('Invalid OCR vocabulary header');
    }
    for (let i = 0; i < header.words.length; i += 1) {
      const word = header.words[i];
      if (typeof word !== 'string' || !/^[a-z]{1,22}$/.test(word) || (i && header.words[i - 1] >= word)) throw new Error('Invalid OCR vocabulary words');
    }
    let postingCount = 0;
    for (const [entries, size] of [[header.bigrams, 2], [header.trigrams, 3]]) {
      if (!Array.isArray(entries) || entries.length > 30000) throw new Error('Invalid OCR vocabulary grams');
      const seen = new Set();
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || entry[0].length !== size ||
            !/^[a-z^$]+$/.test(entry[0]) || seen.has(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[1] < 1 || entry[1] > header.words.length) {
          throw new Error('Invalid OCR vocabulary postings');
        }
        seen.add(entry[0]);
        postingCount += entry[1];
      }
    }
    if (postingCount > MAX_POSTINGS) throw new Error('OCR vocabulary postings exceed limit');
    let offset = 12 + headerLength;
    const countBytes = header.words.length * 2;
    if (countBytes > bytes.length - offset || postingCount > bytes.length - offset - countBytes) throw new Error('Truncated OCR vocabulary counts/postings');
    // Copy only the compact counts so the much larger decompressed header and
    // delta postings buffer can be collected after this function returns.
    const bigramCounts = bytes.slice(offset, offset + header.words.length);
    offset += header.words.length;
    const trigramCounts = bytes.slice(offset, offset + header.words.length);
    offset += header.words.length;
    if (bigramCounts.some(n => n < 1 || n > 23) || trigramCounts.some(n => n > 22)) throw new Error('Invalid OCR vocabulary counts');
    const postings = new Uint32Array(postingCount);
    let postingOffset = 0;
    const readEntries = entries => entries.map(([gram, length]) => {
      const ids = postings.subarray(postingOffset, postingOffset + length);
      postingOffset += length;
      let previous = 0;
      for (let i = 0; i < length; i += 1) {
        let delta = 0;
        let multiplier = 1;
        let part;
        let groups = 0;
        do {
          if (offset >= bytes.length || ++groups > 3) throw new Error('Truncated/overflowing OCR vocabulary varint');
          part = bytes[offset++];
          delta += (part & 127) * multiplier;
          multiplier *= 128;
        } while (part & 128);
        if ((groups > 1 && part === 0) || (i > 0 && delta === 0) || previous + delta >= header.words.length) throw new Error('Invalid OCR vocabulary word ID');
        ids[i] = previous += delta;
      }
      return [gram, ids];
    });
    const bigrams = readEntries(header.bigrams);
    const trigrams = readEntries(header.trigrams);
    if (offset !== bytes.length) throw new Error('Unexpected trailing OCR vocabulary bytes');
    return { version: 2, signature: header.signature, words: header.words, bigrams, trigrams, bigramCounts, trigramCounts, forbiddenSize: header.forbiddenSize };
  }

  async function readResponse(response, metadata) {
    if (!response?.ok || !response.body) throw new Error('OCR vocabulary response is unavailable');
    if (metadata.compression !== 'gzip') throw new Error('Unsupported OCR vocabulary compression');
    if (typeof global.DecompressionStream !== 'function') throw new Error('このブラウザーは辞書の展開に対応していません。');
    const buffer = await new Response(response.body.pipeThrough(new global.DecompressionStream(metadata.compression))).arrayBuffer();
    if (buffer.byteLength !== metadata.decodedBytes) throw new Error('OCR vocabulary decoded byte count mismatch');
    const index = decode(buffer);
    if (index.words.length !== metadata.wordCount || index.signature !== metadata.vocabularySignature) throw new Error('OCR vocabulary metadata mismatch');
    return index;
  }

  function create({ cache, baseUrl, fetch = global.fetch, onStage = () => {} }) {
    let metadataPromise;
    let legacyCacheRetirement;
    const metadata = () => metadataPromise ||= (async () => {
      const url = new URL(META_PATH, baseUrl).href;
      let response;
      try {
        response = await fetch(url);
        if (!response.ok) throw new Error(`OCR vocabulary metadata: HTTP ${response.status}`);
      } catch (error) {
        response = await cache.match(url);
        if (!response) throw error;
      }
      const saved = response.clone();
      const value = await response.json();
      if (value.formatVersion !== FORMAT_VERSION || value.compression !== 'gzip' || !/^ocr-vocabulary-index\.[a-f0-9]{16}\.bin$/.test(value.file?.file || '') ||
          !Number.isSafeInteger(value.file.bytes) || value.file.bytes < 1 || !/^[a-f0-9]{64}$/.test(value.file.sha256 || '') ||
          !Number.isSafeInteger(value.decodedBytes) || value.decodedBytes < 1 || value.decodedBytes > 100000000 ||
          !Number.isSafeInteger(value.wordCount) || value.wordCount < 1 || value.wordCount > MAX_WORDS) throw new Error('Invalid OCR vocabulary metadata');
      await cache.put(url, saved);
      return value;
    })().catch(error => { metadataPromise = null; throw error; });
    return Object.freeze({
      async validate(url, response) {
        const info = await metadata();
        const dataUrl = new URL(`assets/data/${info.file.file}`, baseUrl).href;
        return global.ModelCache.createIntegrityValidator({ [dataUrl]: info.file })(url, response);
      },
      async load({ onStage: stage = onStage } = {}) {
        stage('vocabulary-start');
        const info = await metadata();
        const url = new URL(`assets/data/${info.file.file}`, baseUrl).href;
        stage('vocabulary-cache-open-start');
        const response = await cache.load(url);
        stage('vocabulary-cache-open-done');
        stage('vocabulary-index-decode-start', { compressedBytes: info.file.bytes, decodedBytes: info.decodedBytes });
        const index = await readResponse(response, info);
        stage('vocabulary-index-decode-done', { wordCount: index.words.length });
        // This namespace contains only the superseded Circle raw dictionaries
        // and huge generated JSON, never OCR or embedding model caches.
        legacyCacheRetirement ||= Promise.resolve().then(() => global.caches?.delete?.('magia-circle-kotodama-dictionaries-v1')).catch(() => false);
        await legacyCacheRetirement;
        stage('vocabulary-done', { wordCount: index.words.length });
        return index;
      },
    });
  }
  global.OcrVocabularyIndex = Object.freeze({ decode, readResponse, create });
}(globalThis));
