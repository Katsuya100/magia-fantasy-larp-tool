import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import '../assets/js/analysis-diagnostics.js';

const appSource = await readFile(new URL('../assets/js/magia-circle-app.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Production section must exist: ${start}`);
  return appSource.slice(from, to);
};

// Evaluate the production client and persistence functions, replacing browser
// primitives only. Extra snippets let the full-pipeline test reuse this closure.
export function createClientHarness(options = {}) {
  const pixels = options.pixels || { data: new Uint8ClampedArray(1254 * 1254 * 4), width: 1254, height: 1254 };
  const lifecycle = [];
  const transfers = [];
  const workers = [];
  const storageWrites = [];
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  let activeWorkers = 0;
  let maximumActiveWorkers = 0;
  const phases = ['detection', 'geometry', 'recognition'];
  const stageGroups = Object.fromEntries(phases.map(phase => [phase, []]));
  let currentPhase = 'detection';
  for (const event of options.stages || []) {
    if (event.stage === 'ocr-worker-processing-start') currentPhase = event.details.workerPhase || currentPhase;
    stageGroups[currentPhase].push(event);
  }
  class FakeWorker {
    constructor() {
      this.phase = phases[workers.length];
      this.listeners = new Map();
      this.terminated = false;
      if (options.failPhase === this.phase && options.failure === 'create') throw new Error('injected create failure');
      assert.equal(activeWorkers, 0, 'A runtime Worker must terminate before the next Worker is constructed.');
      activeWorkers += 1;
      maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
      workers.push(this);
      lifecycle.push({ phase: this.phase, event: 'created' });
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
    emit(type, event) { this.listeners.get(type)?.(event); }
    postMessage(message, transfer = []) {
      if (message.type === 'abort') return; // Exercise the existing bounded abort cleanup.
      assert.equal(message.phase, this.phase);
      if (options.failPhase === this.phase && options.failure === 'transfer') throw new Error('injected transfer failure');
      const sizes = transfer.map(buffer => buffer.byteLength);
      const input = structuredClone(message, { transfer });
      assert.ok(transfer.every(buffer => buffer.byteLength === 0), 'Every input buffer must detach after postMessage.');
      transfers.push({ phase: this.phase, sizes, detached: true });
      queueMicrotask(() => {
        if (this.terminated) return;
        for (const stage of stageGroups[this.phase]) this.emit('message', { data: { ...stage, jobId: message.jobId } });
        if (options.failPhase === this.phase) {
          if (options.failure === 'abort') { options.onPhase?.(this.phase); return; }
          if (options.failure === 'messageerror') { this.emit('messageerror', {}); return; }
          if (options.failure === 'error-event') { this.emit('error', { error: new Error('injected runtime failure') }); return; }
          this.emit('message', { data: { type: 'error', jobId: message.jobId, message: 'injected runtime failure' } });
          return;
        }
        let result;
        let outputTransfer;
        if (this.phase === 'detection') {
          result = { buffer: input.buffer, width: input.width, height: input.height, mask: new Uint8Array(64), maskWidth: 8, maskHeight: 8, detectionWidth: 8, detectionHeight: 8 };
          outputTransfer = [result.buffer, result.mask.buffer];
        } else if (this.phase === 'geometry') {
          result = { lineImages: [{ image: { data: new Uint8ClampedArray(64), width: 8, height: 2 } }], additionalLineImages: [], resizedImageWidth: 8, resizedImageHeight: 8 };
          outputTransfer = [result.lineImages[0].image.data.buffer];
        } else {
          result = options.result || { text: 'test spell', lines: [] };
          outputTransfer = [];
        }
        const output = structuredClone(result, { transfer: outputTransfer });
        assert.ok(outputTransfer.every(buffer => buffer.byteLength === 0), 'Worker output buffers must transfer to the main thread.');
        this.emit('message', { data: { type: 'success', jobId: message.jobId, result: output } });
      });
    }
    terminate() {
      assert.equal(this.terminated, false, 'A Worker must terminate exactly once.');
      this.terminated = true;
      activeWorkers -= 1;
      lifecycle.push({ phase: this.phase, event: 'terminated' });
    }
  }
  const context = vm.createContext({
    console, URL, URLSearchParams, Error, Uint8ClampedArray, Uint8Array, ArrayBuffer,
    document: { baseURI: 'https://example.test/' }, location: { search: '?diagnostics' },
    SpellOcrCore: options.core || { config: { onnxRuntimeDefaults: {}, onnxRuntimeWebVersion: '1.30.0' } },
    ImageAnalysisCore: options.imageAnalysis || {}, PowerCalculationCore: options.powerCalculation || {},
    MagiaImagePipeline: options.imagePipeline || { wrapRetryableOcrLoadFailure: error => error },
    AttributeScoringCore: { attributes: [] }, MagiaAnalysisDiagnostics: globalThis.MagiaAnalysisDiagnostics,
    Worker: options.Worker || FakeWorker,
    pixels,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) { storage.set(key, value); storageWrites.push(key); },
      removeItem(key) { storage.delete(key); storageWrites.push(key); },
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    ...options.globals,
  });
  vm.runInContext(`${appSource.slice(0, appSource.indexOf('  function recordCanvasEstimate('))}
    let activeAnalysisJob = null;
    let activeOcrRun = null;
    const captureContext = { getImageData: () => ({ data: new Uint8ClampedArray(global.pixels.data), width: global.pixels.width, height: global.pixels.height }) };
    const modelStatus = {};
    function setStatus() {}
    function publishRuntimeDiagnostics() {}
    ${section('  function createDiagnosticExport()', '  function downloadDiagnosticJson()')}
    ${section('  function recordDiagnosticError(', '  function requireElement(')}
    ${section('  function makeAnalysisAbortError(', '  function appendProcessingRecord(')}
    ${section('  function terminateOcrWorker(', '  function embedAttributesInWorker(')}
    ${options.extraSource || ''}
    global.clientApi = { beginDiagnosticRun, recordAnalysisStage, recordAllocation, clearDiagnosticAllocationsByScope,
      createDiagnosticExport, recognizeSpell, requestSpellRecognition, terminateOcrWorker,
      setActiveJob(job) { activeAnalysisJob = job; },
      get activeOcrRun() { return activeOcrRun; },
      get allocations() { return [...diagnosticAllocations.values()]; },
      ${options.extraExports || ''}
    };
  })(globalThis);`, context);
  const api = context.clientApi;
  const controller = new AbortController();
  const diagnosticRun = api.beginDiagnosticRun('client-lifecycle-test');
  const job = { id: 1, runId: diagnosticRun.runId, diagnosticRun, signal: controller.signal, ocrWorker: null };
  api.setActiveJob(job);
  api.recordAnalysisStage(job, 'image-file-received');
  api.recordAnalysisStage(job, 'analysis-start');
  return { context, api, job, controller, diagnosticRun, lifecycle, transfers, workers, storageWrites, storage,
    canvas: { width: pixels.width, height: pixels.height },
    get activeWorkers() { return activeWorkers; },
    get maximumActiveWorkers() { return maximumActiveWorkers; },
    flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
  };
}

async function runTests() {
  const successful = createClientHarness();
  assert.equal((await successful.api.recognizeSpell(successful.canvas, successful.job)).text, 'test spell');
  assert.deepEqual(successful.lifecycle, ['detection', 'geometry', 'recognition'].flatMap(phase => [{ phase, event: 'created' }, { phase, event: 'terminated' }]));
  assert.equal(successful.maximumActiveWorkers, 1);
  assert.equal(successful.activeWorkers, 0);
  assert.equal(successful.job.ocrWorker, null);
  assert.equal(successful.api.allocations.length, 0);
  assert.ok(successful.transfers.every(transfer => transfer.detached));
  assert.ok(successful.workers.every(worker => worker.listeners.size === 0));

  for (const phase of ['detection', 'geometry', 'recognition']) {
    for (const failure of ['create', 'transfer', 'error', 'error-event', 'messageerror', 'abort']) {
      let harness;
      harness = createClientHarness({ failPhase: phase, failure, onPhase() { harness.controller.abort(new Error('injected abort')); } });
      const recognition = harness.api.recognizeSpell(harness.canvas, harness.job);
      await assert.rejects(recognition);
      harness.flushTimers();
      await harness.api.activeOcrRun;
      assert.equal(harness.activeWorkers, 0, `${phase}/${failure} must terminate the active Worker.`);
      assert.equal(harness.job.ocrWorker, null);
      assert.equal(harness.api.allocations.length, 0, `${phase}/${failure} must release tracked main-thread inputs.`);
      assert.ok(harness.workers.every(worker => worker.listeners.size === 0));
    }
  }
  console.log('OCR client passed: sequential runtime termination, transferable detachment, 18 error/abort cleanup cases.');

  for (const path of process.argv.slice(2)) {
    const measured = JSON.parse(await readFile(path, 'utf8'));
    for (const run of measured.runs) {
      const replay = createClientHarness({ stages: run.stages, result: run.result });
      await replay.api.recognizeSpell(replay.canvas, replay.job);
      const exported = replay.api.createDiagnosticExport();
      assert.equal(exported.localStorageWrites, replay.storageWrites.length);
      assert.ok(replay.storageWrites.length < 100);
      assert.equal(replay.activeWorkers, 0);
      assert.equal(replay.api.allocations.length, 0);
      console.log(`${path} run ${run.iteration}: ${replay.storageWrites.length} actual storage writes (image/start + measured OCR Worker events + production OCR client lifecycle; Structure/Embedding excluded).`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runTests();
