import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/model-cache.js', import.meta.url), 'utf8');
const modelUrl = 'https://models.example.test/recognition.onnx';
const encoder = new TextEncoder();

function createStorage() {
  const entries = new Map();
  let writes = 0;
  return {
    get writes() { return writes; },
    async open(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      const stored = entries.get(name);
      return {
        async match(url) { return stored.get(url)?.clone(); },
        async delete(url) { return stored.delete(url); },
        async put(url, response) {
          stored.set(url, new Response(await response.arrayBuffer(), { headers: response.headers }));
          writes += 1;
        },
      };
    },
    seed(name, url, response) {
      if (!entries.has(name)) entries.set(name, new Map());
      entries.get(name).set(url, response.clone());
    },
  };
}

function createCache({ storage = createStorage(), fetch, progress = [], errors = [], validate, BlobType = Blob }) {
  const context = vm.createContext({ caches: storage, fetch, Response, Blob: BlobType, ReadableStream });
  vm.runInContext(source, context, { filename: 'model-cache.js' });
  return context.ModelCache.create({
    name: 'test-models-v1',
    onProgress: event => progress.push(event),
    onCacheError: error => errors.push(error),
    validate,
  });
}

function streamedResponse(parts, { withLength = true, failAfterChunks = false } = {}) {
  const chunks = parts.map(part => encoder.encode(part));
  let nextChunk = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (nextChunk < chunks.length) controller.enqueue(chunks[nextChunk++]);
      else if (failAfterChunks) controller.error(new Error('connection lost'));
      else controller.close();
    },
  });
  const headers = { 'content-type': 'application/octet-stream' };
  if (withLength) headers['content-length'] = String(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  return new Response(body, { headers });
}

// A complete transfer reports real byte progress and persists a reusable copy.
const storage = createStorage();
const progress = [];
let blobCreates = 0;
class ObservedBlob extends Blob {
  constructor(...parts) { super(...parts); blobCreates += 1; }
}
let downloads = 0;
const cache = createCache({ storage, progress, fetch: async () => {
  downloads += 1;
  return streamedResponse(['model', '-bytes']);
}, BlobType: ObservedBlob });
assert.equal(await (await cache.load(modelUrl)).text(), 'model-bytes');
assert.equal(downloads, 1);
assert.equal(storage.writes, 1);
assert.equal(blobCreates, 0, 'streamed model downloads must not be reassembled into a Blob');
assert.deepEqual(progress.map(event => event.status), ['download', 'progress', 'progress', 'done']);
assert.deepEqual(progress.filter(event => event.status === 'progress').map(event => [event.loaded, event.total]), [[5, 11], [11, 11]]);
assert.ok(progress.every(event => event.url === modelUrl));

// A new runtime instance can consume the persisted entry without network access.
const cachedProgress = [];
const restored = createCache({ storage, progress: cachedProgress, fetch: async () => {
  assert.fail('persisted model must not use the network');
} });
assert.equal(await (await restored.load(modelUrl)).text(), 'model-bytes');
assert.deepEqual(cachedProgress.map(event => event.status), ['cache']);
assert.equal(storage.writes, 1);
assert.equal(await (await restored.load(modelUrl)).text(), 'model-bytes', 'reading a cached response must not consume its stored copy');

// Simultaneous callers share the transfer, but each receives a readable response.
let releaseDownload;
const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
let sharedDownloads = 0;
const sharedStorage = createStorage();
const shared = createCache({ storage: sharedStorage, fetch: async () => {
  sharedDownloads += 1;
  await downloadGate;
  return streamedResponse(['shared']);
} });
const first = shared.load(modelUrl);
const second = shared.load(modelUrl);
releaseDownload();
const sharedResponses = await Promise.all([first, second]);
assert.notEqual(sharedResponses[0], sharedResponses[1]);
assert.deepEqual(await Promise.all(sharedResponses.map(response => response.text())), ['shared', 'shared']);
assert.equal(sharedDownloads, 1);
assert.equal(sharedStorage.writes, 1);

// HTTP errors and interrupted bodies never become persisted partial models.
for (const failure of ['http', 'stream']) {
  const failedStorage = createStorage();
  const failedProgress = [];
  let attempts = 0;
  const retryable = createCache({ storage: failedStorage, progress: failedProgress, fetch: async () => {
    attempts += 1;
    if (attempts > 1) return streamedResponse(['complete']);
    return failure === 'http'
      ? new Response('unavailable', { status: 503 })
      : streamedResponse(['partial'], { failAfterChunks: true });
  } });
  await assert.rejects(retryable.load(modelUrl), failure === 'http' ? /503/ : /connection lost/);
  assert.equal(failedStorage.writes, 0, `${failure} failure must not save a response`);
  assert.equal(await (await failedStorage.open('test-models-v1')).match(modelUrl), undefined);
  assert.ok(!failedProgress.some(event => event.status === 'done'), 'failed transfers must not report completion');
  assert.equal(await (await retryable.load(modelUrl)).text(), 'complete');
  assert.equal(attempts, 2, 'failed pending requests must allow a fresh retry');
  assert.equal(failedStorage.writes, 1);
}

// Browser storage restrictions must not prevent models from becoming usable.
for (const failure of ['unavailable', 'open', 'match', 'quota']) {
  const errors = [];
  const error = new Error(`${failure} storage failure`);
  const restrictedStorage = failure === 'unavailable' ? null : {
    async open() {
      if (failure === 'open') throw error;
      return {
        async match() { if (failure === 'match') throw error; },
        async put() { if (failure === 'quota') throw error; },
      };
    },
  };
  const restricted = createCache({ storage: restrictedStorage, errors, fetch: async () => streamedResponse(['usable']) });
  assert.equal(await (await restricted.load(modelUrl)).text(), 'usable', `${failure} must preserve the downloaded model`);
  assert.equal(errors.length, 1, `${failure} must report its storage problem`);
  if (failure !== 'unavailable') assert.equal(errors[0], error);
}

// Missing Content-Length remains an unknown total while byte counts advance.
const unknownProgress = [];
const unknown = createCache({ progress: unknownProgress, fetch: async () => streamedResponse(['no', '-length'], { withLength: false }) });
assert.equal(await (await unknown.load(modelUrl)).text(), 'no-length');
assert.deepEqual(unknownProgress.filter(event => event.status === 'progress').map(event => [event.loaded, event.total]), [[2, 0], [9, 0]]);
assert.equal(unknownProgress.at(-1).status, 'done');

// A previously stored HTTP 200 error page is evicted instead of reused.
const poisonedStorage = createStorage();
poisonedStorage.seed('test-models-v1', modelUrl, new Response('error page', {
  headers: { 'content-type': 'text/plain' },
}));
const poisonedProgress = [];
const repaired = createCache({
  storage: poisonedStorage,
  progress: poisonedProgress,
  validate: async (_url, response) => (await response.text()) === 'valid-dictionary',
  fetch: async () => new Response('valid-dictionary', { headers: { 'content-type': 'text/plain' } }),
});
assert.equal(await (await repaired.load(modelUrl)).text(), 'valid-dictionary');
assert.deepEqual(poisonedProgress.map(event => event.status), ['invalid-cache', 'download', 'progress', 'done']);
assert.equal(poisonedStorage.writes, 1);

// A malformed successful response remains retryable and is never cached.
const malformedStorage = createStorage();
let malformedAttempts = 0;
const malformed = createCache({
  storage: malformedStorage,
  validate: async (_url, response) => (await response.text()) === 'valid-dictionary',
  fetch: async () => {
    malformedAttempts += 1;
    return malformedAttempts === 1
      ? new Response('<html>temporary CDN error</html>', { headers: { 'content-type': 'text/html' } })
      : new Response('valid-dictionary', { headers: { 'content-type': 'text/plain' } });
  },
});
await assert.rejects(malformed.load(modelUrl), /検証/);
assert.equal(malformedStorage.writes, 0);
assert.equal(await (await malformed.load(modelUrl)).text(), 'valid-dictionary');
assert.equal(malformedAttempts, 2);
assert.equal(malformedStorage.writes, 1);

console.log('PASS_MODEL_CACHE');
