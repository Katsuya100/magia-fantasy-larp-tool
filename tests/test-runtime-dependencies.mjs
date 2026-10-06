import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../assets/js/runtime-dependencies.js';
import '../assets/js/spell-ocr.js';

const dependencies = globalThis.MagiaRuntimeDependencies;
const manifest = JSON.parse(await readFile(new URL('../assets/data/external-assets.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(dependencies.transformersVersion, lock.packages['node_modules/@huggingface/transformers'].version);
assert.equal(dependencies.onnxRuntimeWebVersion, lock.packages['node_modules/onnxruntime-web'].version);
assert.equal(dependencies.embeddingOnnxRuntimeVersion, lock.packages['node_modules/@huggingface/transformers/node_modules/onnxruntime-web'].version);
assert.equal(dependencies.opencvVersion, lock.packages['node_modules/@techstark/opencv-js'].version);
assert.equal(dependencies.clipperVersion, lock.packages['node_modules/js-clipper'].version);
assert.match(dependencies.attributeModelRevision, /^[a-f0-9]{40}$/);
assert.equal(dependencies.attributeModelOptions.revision, dependencies.attributeModelRevision);
const isPinned = value => {
  assert.doesNotMatch(value, /\/(?:main|master|latest)\//);
  if (value.includes('raw.githubusercontent.com')) assert.match(value, /\/[a-f0-9]{40}\//);
  if (value.includes('cdn.jsdelivr.net')) assert.match(value, /@[0-9]+\.[0-9]+\.[0-9]+/);
};
for (const [key, value] of Object.entries(dependencies)) if (typeof value === 'string' && value.startsWith('https:')) isPinned(value);
for (const asset of manifest.assets) {
  isPinned(asset.url);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.ok(asset.bytes > 0);
  if (asset.configUrl) {
    assert.equal(asset.url, dependencies[asset.configUrl]);
    assert.equal(asset.url, globalThis.SpellOcrCore.config[asset.configUrl]);
  }
}
assert.equal(new Set(manifest.assets.map(asset => asset.id)).size, manifest.assets.length);
const licenses = JSON.parse(await readFile(new URL('../assets/licenses/sources.json', import.meta.url), 'utf8'));
for (const license of licenses.licenses) {
  const text = (await readFile(new URL(`../assets/licenses/${license.file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(text).digest('hex'), license.sha256, `${license.file}: preserve the upstream license text`);
}

// Exercise the production module Worker with a small fake extractor, avoiding a model download.
// Observe model options, runtime configuration, output and cleanup rather than private implementation.
let messageHandler;
let resolveResult;
const finished = new Promise(resolve => { resolveResult = resolve; });
const calls = [];
const env = { backends: { onnx: { wasm: {} } } };
const extractor = async texts => {
  assert.deepEqual(Array.from(texts), ['spell', 'attribute']);
  return { dims: [2, 2], data: new Float32Array([1, 0, 0, 1]), dispose() { calls.push('tensor-dispose'); } };
};
extractor.dispose = async () => { calls.push('pipeline-dispose'); };
const context = vm.createContext({
  AbortController, Float32Array, console,
  ModelCache: { create: () => ({}) },
  MagiaAnalysisDiagnostics: { createReporter: () => new Proxy({}, { get: () => () => {} }) },
  __importRuntime: async url => {
    assert.equal(url, dependencies.transformersUrl);
    return { env, pipeline: async (task, id, options) => {
      assert.equal(task, 'feature-extraction');
      assert.equal(id, dependencies.attributeModelId);
      for (const [key, value] of Object.entries(dependencies.attributeModelOptions)) assert.equal(options[key], value);
      calls.push('pipeline-create');
      return extractor;
    } };
  },
});
context.self = context;
context.addEventListener = (type, handler) => { if (type === 'message') messageHandler = handler; };
context.postMessage = message => { if (message.type === 'success' || message.type === 'error') resolveResult(message); };
vm.runInContext(await readFile(new URL('../assets/js/runtime-dependencies.js', import.meta.url), 'utf8'), context);
const worker = (await readFile(new URL('../assets/js/attribute-embedding-worker.js', import.meta.url), 'utf8'))
  .replace(/^import '[^']+';\r?\n/gm, '').replace(/\bimport\(/g, '__importRuntime(');
vm.runInContext(worker, context);
messageHandler({ data: { type: 'embed', jobId: 1, runId: 'test', texts: ['spell', 'attribute'] } });
const result = await finished;
assert.equal(result.type, 'success', result.message);
assert.deepEqual(Array.from(result.embedding.data), [1, 0, 0, 1]);
assert.deepEqual(calls, ['pipeline-create', 'tensor-dispose', 'pipeline-dispose']);
assert.equal(env.backends.onnx.wasm.wasmPaths, dependencies.transformersWasmPath);
assert.equal(env.backends.onnx.wasm.numThreads, 1);
assert.equal(env.backends.onnx.wasm.proxy, false);
console.log('PASS_RUNTIME_DEPENDENCIES_PINNED_ASSETS_SHARED_EMBEDDING_AND_LICENSES');
