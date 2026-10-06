import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { createClientHarness } from './test-ocr-worker-client.mjs';
import { loadOcrVocabularyIndex } from '../scripts/load-ocr-vocabulary-index.mjs';
for (const name of ['runtime-dependencies', 'spell-ocr', 'image-analysis-core', 'power-calculation', 'attribute-scoring', 'ocr-error-policy', 'magia-image-pipeline']) await import(`../assets/js/${name}.js`);
const app = await readFile(new URL('../assets/js/magia-circle-app.js', import.meta.url), 'utf8');
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const imagePath = process.argv[2] || 'assets/images/sample.png';
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '1'));
assert.ok(Number.isInteger(iterations) && iterations > 0);
const baselinePath = option('--baseline', null);
const outputPath = option('--output', 'test-results/review/full-worker-pipeline.json');
const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, 'utf8')) : null;
const runs = [];
const decoded = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const size = MagiaImagePipeline.fitInputDimensions(decoded.info.width, decoded.info.height);
const pixels = { ...size, data: size.scale < 1 ? ImageAnalysisCore.resizeRgbaLinear(decoded.data, decoded.info.width, decoded.info.height, size.width, size.height) : decoded.data };
let active = 0;
let maximumActive = 0;
let previousStop = Promise.resolve();
const lifecycle = [];
const events = [];
// Browser terminate is synchronous at the API boundary. Await the Node thread
// exit before constructing the next physical test isolate.
class BrowserWorker {
  constructor(url) {
    this.listeners = new Map();
    this.name = url.pathname.split('/').at(-1);
    const previous = previousStop;
    this.ready = previous.then(() => {
      assert.equal(active, 0);
      const worker = this.worker = new Worker(new URL('./test-ocr-worker-lifecycle.mjs', import.meta.url), { workerData: { script: resolve('assets/js', this.name) } });
      maximumActive = Math.max(maximumActive, ++active);
      lifecycle.push({ event: 'create', worker: this.name });
      worker.on('message', data => {
        if (data.type === 'diagnostic-stage' || data.type === 'stage') events.push({ ...data, worker: this.name });
        this.emit('message', { data });
      });
      worker.on('error', error => this.emit('error', { error, message: error.message }));
      return worker;
    });
  }
  emit(type, event) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  postMessage(message, transfers = []) {
    const input = structuredClone(message, { transfer: transfers });
    const moved = [];
    const collect = value => {
      if (value instanceof ArrayBuffer) moved.push(value);
      else if (ArrayBuffer.isView(value)) moved.push(value.buffer);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(input);
    void this.ready.then(worker => worker.postMessage(input, [...new Set(moved)]));
  }
  terminate() {
    this.listeners.clear();
    previousStop = this.ready.then(async worker => {
      await worker.terminate();
      active -= 1;
      lifecycle.push({ event: 'terminate', worker: this.name });
    });
  }
}
const vocabularyIndexLoader = { async load({ onStage = () => {} } = {}) {
  onStage('vocabulary-index-decode-start');
  const index = await loadOcrVocabularyIndex();
  onStage('vocabulary-index-decode-done', { wordCount: index.words.length });
  return index;
} };
const pipelineCall = section('      const pipelineTask = imagePipeline.run({', '      activeAttributeRun = pipelineTask.then(');
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const lifecycleStart = lifecycle.length;
  const eventStart = events.length;
  const harness = createClientHarness({
    Worker: BrowserWorker, pixels, core: SpellOcrCore, imageAnalysis: ImageAnalysisCore,
    imagePipeline: MagiaImagePipeline, powerCalculation: PowerCalculationCore,
    globals: { Float32Array, Response, vocabularyIndexLoader, setTimeout, clearTimeout,
      document: { baseURI: 'https://example.test/', createElement(type) {
        assert.equal(type, 'canvas');
        const canvas = { width: 1, height: 1 };
        canvas.getContext = () => ({ drawImage() {}, getImageData: () => ({ width: canvas.width, height: canvas.height, data: ImageAnalysisCore.resizeRgbaLinear(pixels.data, pixels.width, pixels.height, canvas.width, canvas.height) }) });
        return canvas;
      } },
    },
    extraSource: `
      let analysisWorker = null;
      let analysisPending = null;
      const captureCanvas = { width: global.pixels.width, height: global.pixels.height };
      const cameraStatus = {};
      const vocabularyIndexLoader = global.vocabularyIndexLoader;
      function yieldToBrowser() { return Promise.resolve(); }
      function cacheError() {}
      function showBusyMask() {}
      function appendProcessingRecord() {}
      function showCaptureCanvas() {}
      captureContext.clearRect = () => {};
      captureContext.drawImage = () => {};
      ${section('  async function loadVocabularyIndex(', '  function recordDiagnosticError(')}
      ${section('  function terminateAnalysisWorker(', '  function showCaptureCanvas(')}
      ${section('  function canvasFromImage(', '  function stopCamera(')}
      ${section('  function embedAttributesInWorker(', '  function resetResults(')}
      async function runPipeline(job) {
        let masterImageAllocationBytes = 0;
        canvasFromImage(captureCanvas, job);
        ${pipelineCall}
        return pipelineTask;
      }
    `,
    extraExports: 'runPipeline, validateVocabularyIndex,',
  });
  // The UI prepares the vocabulary index on startup; exercise the same warm-cache path.
  await harness.api.validateVocabularyIndex();
  const result = await harness.api.runPipeline(harness.job);
  await previousStop;
  assert.equal(result.structure.error, null, 'Structure Worker must initialize with all dependencies and complete.');
  assert.equal(result.attribute.error, undefined, 'Embedding must transfer its live Float32 buffer successfully.');
  assert.ok(result.spell.path.words.length > 0);
  assert.equal(active, 0);
  assert.equal(maximumActive, 1);
  assert.deepEqual(lifecycle.slice(lifecycleStart).filter(item => item.event === 'create').map(item => item.worker), [
    'image-analysis-worker.js', 'magia-circle-ocr-worker.js', 'magia-circle-ocr-worker.js', 'magia-circle-ocr-worker.js', 'attribute-embedding-worker.js',
  ]);
  if (baseline) {
    assert.equal(result.spell.path.text, baseline.spell.text);
    assert.deepEqual(result.spell.path.words, baseline.spell.words);
    assert.equal(result.attribute.top, baseline.attribute.top);
    assert.deepEqual(result.attribute.similarities, baseline.attribute.similarities);
    assert.equal(result.sigil.top, baseline.sigil.top);
    assert.deepEqual(result.sigil.scores, baseline.sigil.scores);
    assert.equal(result.power.power, baseline.power.total);
    assert.deepEqual(result.power.normalized, baseline.power.normalized);
  }
  if (runs.length) assert.deepEqual(result, runs[0].result, 'Complete worker pipeline results must be stable across runs.');
  harness.api.recordAnalysisStage(harness.job, 'analysis-complete');
  const report = harness.api.createDiagnosticExport();
  assert.equal(report.localStorageWrites, harness.storageWrites.length);
  assert.ok(report.localStorageWrites < 100, `Full analysis must use <100 writes, got ${report.localStorageWrites}.`);
  assert.equal(report.currentKnownLiveBytes, 0);
  assert.ok(Object.values(report.activeWorkers).every(count => count === 0));
  runs.push({ iteration, localStorageWrites: report.localStorageWrites, lifecycle: lifecycle.slice(lifecycleStart), result, report, workerEvents: events.slice(eventStart) });
  console.log(JSON.stringify({ status: 'PASS_FULL_WORKER_PIPELINE', iteration, localStorageWrites: report.localStorageWrites, maximumActive, activeWorkers: active, spell: result.spell.path.text, attribute: result.attribute.top, sigil: result.sigil.top, power: result.power.power }));
}
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, JSON.stringify({ imagePath, iterations, maximumActive, activeWorkers: active, runs }, null, 2));
