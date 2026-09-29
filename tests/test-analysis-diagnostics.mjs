import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../assets/js/analysis-diagnostics.js';
import '../assets/js/ocr-resource-tracker.js';

const diagnostics = globalThis.MagiaAnalysisDiagnostics;
assert.ok(diagnostics, 'The diagnostics helper should expose its API on globalThis.');

const persisted = [];
const reporter = diagnostics.createReporter('main', event => persisted.push(event));
reporter.begin('run-one', { sourceWidth: 1600, sourceHeight: 1200 });
reporter.stage('analysis-start');
reporter.allocationStart('ocr-source-rgba-alloc-start', 'ocr-source-rgba', diagnostics.rgbaBytes(1600, 1200), {
  width: 1600, height: 1200, type: 'Uint8ClampedArray',
});
reporter.allocationDone('ocr-source-rgba-alloc-done', 'ocr-source-rgba', diagnostics.rgbaBytes(1600, 1200), {
  width: 1600, height: 1200, type: 'Uint8ClampedArray',
});
const allocationEvent = persisted.at(-1);
assert.equal(allocationEvent.type, 'diagnostic-stage');
assert.equal(allocationEvent.seq, 3);
assert.equal(allocationEvent.runId, 'run-one');
assert.equal(allocationEvent.details.currentKnownLiveBytes, 1600 * 1200 * 4);
assert.equal(reporter.knownLiveBytes, 1600 * 1200 * 4);
reporter.releaseStart('ocr-source-rgba-release-start', 'ocr-source-rgba');
reporter.releaseDone('ocr-source-rgba-release-done', 'ocr-source-rgba');
assert.equal(reporter.knownLiveBytes, 0);
assert.equal(reporter.peakKnownLiveBytes, 1600 * 1200 * 4);
assert.equal(reporter.activeAllocations.length, 0);

for (let index = 0; index < 70; index += 1) reporter.stage(`bounded-${index}`);
assert.equal(reporter.trace.length, 64);
assert.equal(reporter.trace[0].seq, 12);
assert.equal(reporter.trace.at(-1).seq, 75);
reporter.begin('run-two');
assert.equal(reporter.runId, 'run-two');
assert.equal(reporter.trace.length, 0);
reporter.stage('new-run');
assert.equal(reporter.trace[0].seq, 1);

reporter.begin('scope-run');
reporter.allocationDone('ocr-source-mat-alloc-done', 'opencv-source-mat-0', 6_553_600, { scope: 'ocr', type: 'cv.Mat/CV_8UC4' });
reporter.allocationDone('ocr-line-perspective-done', 'opencv-line-perspective-0', 6_800, { scope: 'ocr', type: 'cv.Mat/CV_8UC4' });
const scopePeak = reporter.peakKnownLiveBytes;
assert.equal(reporter.knownLiveBytes, 6_560_400);
const clearedScope = reporter.clearAllocationsByScope('ocr');
assert.deepEqual(clearedScope, { releasedTrackedBytes: 6_560_400, allocationCount: 2, remainingKnownLiveBytes: 0 });
assert.equal(reporter.knownLiveBytes, 0, 'Clearing a terminated worker scope should remove its logical live allocations.');
assert.equal(reporter.peakKnownLiveBytes, scopePeak, 'Scope clearing must preserve the run peak.');
assert.equal(reporter.activeAllocations.length, 0);

for (const stage of [
  'ocr-worker-create-start',
  'ocr-detection-model-fetch-start',
  'ocr-detection-model-arraybuffer-start',
  'ocr-source-align-buffer-alloc-start',
  'ocr-source-align-render-start',
  'ocr-detection-session-create-start',
  'ocr-detection-run-start',
  'recognition-session-run-start',
  'master-image-get-image-data-start',
  'ocr-image-data-read-start',
  'vocabulary-json-parse-start',
  'embedding-model-load-start',
  'ocr-worker-retry-start',
  'structure-worker-ready',
  'structure-input-transfer-start',
  'structure-input-transfer-done',
  'structure-worker-message-received',
  'structure-worker-run-start',
  'structure-worker-run-done',
]) {
  const details = stage === 'ocr-detection-model-arraybuffer-start' || stage === 'recognition-session-run-start'
    ? { estimatedBytes: 2 * 1024 * 1024 }
    : {};
  if (/source-align|image-data/.test(stage)) details.estimatedBytes = 6_553_600;
  assert.equal(diagnostics.isCriticalStage(stage, details), true, `${stage} should synchronously persist before risky work.`);
}
assert.equal(diagnostics.isCriticalStage('ocr-cleanup-error'), true, 'The first cleanup error should remain immediately persisted.');
assert.equal(diagnostics.isCriticalStage('ocr-cleanup-error-summary'), false, 'Cleanup summaries should join a batch rather than forcing storage writes.');
assert.equal(diagnostics.isCriticalStage('ocr-recognition-run-start'), false, 'Small recognition line runs should batch instead of producing one synchronous write each.');
assert.equal(diagnostics.isCriticalStage('ocr-line-release-start'), false, 'Small release milestones may be batched.');
for (const stage of ['structure-worker-script-start', 'structure-runtime-import-start', 'structure-runtime-import-done', 'structure-result-received']) {
  assert.equal(diagnostics.isCriticalStage(stage), false, `${stage} should remain in memory and join the next synchronous snapshot.`);
}

const batchedFlushes = [];
const batcher = diagnostics.createStageBatcher(() => batchedFlushes.push('flush'), { batchSize: 16, delayMs: -1 });
for (let index = 0; index < 15; index += 1) batcher.add(false);
assert.equal(batchedFlushes.length, 0, 'Lightweight events should wait for a batch.');
batcher.add(false);
assert.equal(batchedFlushes.length, 1, 'A full batch should flush once.');
batcher.add(true);
assert.equal(batchedFlushes.length, 2, 'A critical event should flush immediately.');

const sampleFlushes = [];
const sampleBatcher = diagnostics.createStageBatcher(() => sampleFlushes.push('write'));
const importantStages = new Map([
  [0, 'image-file-received'], [15, 'analysis-start'], [30, 'ocr-worker-create-start'],
  [45, 'ocr-detection-model-fetch-start'], [60, 'ocr-detection-model-arraybuffer-start'],
  [75, 'ocr-detection-session-create-start'], [90, 'ocr-detection-run-start'],
  [105, 'ocr-detection-mask-buffer-alloc-start'], [120, 'ocr-image-data-read-start'],
  [135, 'vocabulary-json-parse-start'], [150, 'opencv-import-start'],
  [165, 'recognition-session-run-start'], [180, 'embedding-model-load-start'],
  [195, 'ocr-source-mat-alloc-start'], [210, 'ocr-recognition-input-buffer-alloc-start'],
  [225, 'ocr-worker-retry-start'], [240, 'structure-worker-ready'], [241, 'structure-input-transfer-start'],
  [242, 'structure-input-transfer-done'], [243, 'structure-worker-message-received'],
  [244, 'structure-worker-run-start'], [245, 'structure-worker-run-done'],
  [246, 'structure-result-received'], [273, 'analysis-complete'],
]);
for (let index = 0; index < 274; index += 1) {
  const stage = importantStages.get(index) || (index % 2 === 0 ? 'ocr-recognition-run-start' : 'ocr-line-release-done');
  const details = /(?:arraybuffer|alloc)-start$/.test(stage) ? { estimatedBytes: 2 * 1024 * 1024 } :
    stage === 'recognition-session-run-start' ? { inputEstimatedBytes: 2 * 1024 * 1024 } : {};
  sampleBatcher.add(diagnostics.isCriticalStage(stage, details));
}
for (const stage of [
  'ocr-source-align-check', 'ocr-source-align-buffer-alloc-start', 'ocr-source-align-buffer-alloc-done',
  'ocr-source-align-render-start', 'ocr-source-align-kernel-prepare-start', 'ocr-source-align-kernel-prepare-done',
  'ocr-source-align-horizontal-start', 'ocr-source-align-row-cache-start', 'ocr-source-align-vertical-start',
  'ocr-source-align-output-finalize-start', 'ocr-source-align-render-progress',
  'ocr-source-align-horizontal-done', 'ocr-source-align-row-cache-done',
  'ocr-source-align-vertical-done', 'ocr-source-align-output-finalize-done', 'ocr-source-align-render-done',
]) {
  const details = stage.endsWith('-alloc-start') || stage.endsWith('-render-start') ? { estimatedBytes: 6_553_600 } : {};
  sampleBatcher.add(diagnostics.isCriticalStage(stage, details));
}
sampleBatcher.flush();
const estimatedStorageWrites = sampleFlushes.length + 3; // RunId once and analysis stage start/complete.
assert.ok(estimatedStorageWrites < 100, `A representative 274-stage trace should use fewer than 100 storage writes, observed ${estimatedStorageWrites}.`);

const cleanupStageNames = [];
const cleanupAggregator = globalThis.MagiaOcrResourceTracker.createCleanupErrorAggregator(
  (_error, details) => cleanupStageNames.push({ stage: 'ocr-cleanup-error', details }),
  summary => cleanupStageNames.push({ stage: summary.stage, details: summary }),
);
for (let index = 0; index < 25; index += 1) {
  cleanupAggregator.record('opencv-resource-delete', new TypeError('OpenCV resource has no delete method.'), { contourIndex: index });
}
cleanupAggregator.flush();
const cleanupFlushes = [];
const cleanupBatcher = diagnostics.createStageBatcher(() => cleanupFlushes.push('write'));
for (const event of cleanupStageNames) cleanupBatcher.add(diagnostics.isCriticalStage(event.stage, event.details));
cleanupBatcher.flush();
const cleanupStorageWrites = cleanupFlushes.length + 3;
assert.equal(cleanupStageNames.length, 2, 'Twenty-five same-kind errors should persist once immediately and once as one summary.');
assert.ok(cleanupStorageWrites < 100, `Aggregated cleanup diagnostics should remain below 100 writes, observed ${cleanupStorageWrites}.`);

const mainEvents = [];
const mainThreadReporter = diagnostics.createReporter('main', event => mainEvents.push(event));
mainThreadReporter.begin('shared-run');
const workerReporter = diagnostics.createReporter('ocr', message => {
  assert.equal(message.type, 'diagnostic-stage');
  mainThreadReporter.stage(message.stage, message.details);
});
workerReporter.begin('shared-run');
workerReporter.allocationDone('ocr-detection-input-buffer-alloc-done', 'detection-input', 1024 * 1024, {
  name: 'Detection Float32 input', width: 256, height: 256, type: 'Float32Array',
});
workerReporter.stage('ocr-detection-run-start', { tensorShape: [1, 3, 256, 256] });
workerReporter.stage('ocr-worker-create-done', { workerType: 'ocr', workerAction: 'start' });
assert.equal(mainEvents[1].stage, 'ocr-detection-run-start');
assert.equal(mainEvents[1].seq, 2);
assert.equal(mainEvents.at(-1).details.currentKnownLiveBytes, 1024 * 1024);
assert.equal(mainEvents.at(-1).details.activeWorkers.ocr, 1);
assert.equal(mainEvents.at(-1).details.runtimeStates.ocrWorkerActive, true);
workerReporter.stage('ocr-worker-terminate-done', { workerType: 'ocr', workerAction: 'stop' });
assert.equal(mainEvents.at(-1).details.activeWorkers.ocr, 0);
assert.equal(mainEvents.at(-1).details.runtimeStates.ocrWorkerActive, false);

const workerSource = await readFile(new URL('../assets/js/magia-circle-ocr-worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../assets/js/magia-circle-app.js', import.meta.url), 'utf8');
assert.doesNotMatch(appSource, /imageAnalysis\.rgbaBytes/, 'Canvas byte estimates must use the diagnostics helper API, not ImageAnalysisCore.');
assert.match(appSource, /MagiaAnalysisDiagnostics\.rgbaBytes\(captureCanvas\.width, captureCanvas\.height\)/, 'Image selection should complete using the exported byte estimator.');
const detectorStart = workerSource.indexOf('async function ensureTextDetector()');
const detectionStart = workerSource.indexOf('async detect(source, signal)', detectorStart);
const browserImageRawStart = workerSource.indexOf('class BrowserImageRaw', detectionStart);
const detectorSetup = workerSource.slice(detectorStart, detectionStart);
const detectBody = workerSource.slice(detectionStart, browserImageRawStart);
assert.equal(detectorSetup.includes('await ensureOcrImageRuntimes()'), false, 'Detection setup must not initialize OpenCV.');
assert.ok(workerSource.includes("import('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm')"));
const orderedStages = [
  "reportStage('ocr-detection-run-start'",
  'await sessionForRun.run(',
  "reportStage('ocr-detection-run-done'",
  'await releaseDetectionSession();',
  "reportStage('ocr-detection-cleanup-done'",
  'return detected;',
];
let previousIndex = -1;
for (const token of orderedStages) {
  const nextIndex = detectBody.indexOf(token);
  assert.ok(nextIndex > previousIndex, `Expected Detection release before handing off at ${token}.`);
  previousIndex = nextIndex;
}
assert.doesNotMatch(detectBody, /await ensureOcrImageRuntimes|MagiaOcrLineSplitter/, 'Detection must return before Geometry initializes or aligns the source.');
const geometryBody = workerSource.slice(workerSource.indexOf('async function prepareLines('), workerSource.indexOf('async function runPhase('));
assert.ok(geometryBody.indexOf('MagiaOcrLineSplitter.alignSource(') < geometryBody.indexOf('await ensureOcrImageRuntimes();'), 'Geometry should align the source before importing OpenCV.');
assert.doesNotMatch(geometryBody, /ensureTextDetector|ensureTextRecognizer/, 'Geometry must not initialize an ONNX session.');
assert.match(appSource, /createReporter\('main'/, 'Each Main Thread diagnostic run should own a Reporter.');
assert.match(appSource, /message\.type === 'diagnostic-stage'.*?recordAnalysisStage\(/s, 'Worker diagnostic messages should enter the Main Thread Reporter.');
assert.match(appSource, /setItem\('magiaAnalysisTrace'/, 'Main Thread events should persist their bounded trace to localStorage.');
assert.match(appSource, /createStageBatcher/, 'Main Thread trace snapshots should use the storage batcher.');
assert.match(appSource, /run\.trace = run\.reporter\.trace/, 'Every diagnostic event should remain in the bounded in-memory trace.');
assert.match(appSource, /clearDiagnosticAllocationsByScope\(job, 'ocr'\)/, 'OCR worker termination should clear logical allocations owned by that Worker.');
assert.match(appSource, /clearDiagnosticAllocationsByScope\(job, 'structure'\)/, 'Structure Worker termination should clear its logical allocations.');
assert.match(appSource, /clearDiagnosticAllocationsByScope\(job, 'embedding'\)/, 'Embedding Worker termination should clear its logical allocations.');
assert.match(appSource, /if \(!diagnosticsEnabled\) return;/, 'Diagnostic UI must remain hidden outside diagnostic mode.');

console.log(`Analysis diagnostics passed (${estimatedStorageWrites} modeled writes for a representative 274-stage batch plus source alignment).`);
// Exercise the production persistence/reload/download functions with browser
// primitives stubbed, so a real storage write is counted (not just stage count).
const diagnosticPrefix = appSource.slice(0, appSource.indexOf('  function recordAllocation('));
const diagnosticUi = appSource.slice(appSource.indexOf('  function createDiagnosticExport()'), appSource.indexOf('  function recordDiagnosticError('));
const stored = new Map();
const storageWrites = [];
const localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem(key, value) { stored.set(key, value); storageWrites.push(key); },
  removeItem(key) { stored.delete(key); storageWrites.push(key); },
};
function loadDiagnosticPage() {
  const elements = [];
  const downloads = [];
  const scheduled = [];
  const blobs = [];
  const revoked = [];
  const createElement = tag => {
    const element = { tag, children: [], listeners: {}, style: {},
      setAttribute() {},
      append(...children) { this.children.push(...children); },
      remove() {},
      addEventListener(name, listener) { this.listeners[name] = listener; },
      click() { if (tag === 'a') downloads.push({ href: this.href, name: this.download }); else this.listeners.click?.(); },
    };
    elements.push(element);
    return element;
  };
  const context = vm.createContext({
    SpellOcrCore: { config: { onnxRuntimeDefaults: {}, onnxRuntimeWebVersion: '1.30.0' } },
    ImageAnalysisCore: {}, PowerCalculationCore: {}, MagiaImagePipeline: {}, AttributeScoringCore: { attributes: [] },
    MagiaAnalysisDiagnostics: diagnostics,
    location: { search: '?diagnostics' }, URLSearchParams, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:diagnostics'; }, revokeObjectURL(url) { revoked.push(url); } },
    document: { createElement, body: createElement('body'), getElementById: id => elements.find(element => element.id === id) },
    localStorage, console,
    setTimeout(callback) { scheduled.push(callback); },
  });
  vm.runInContext(`${diagnosticPrefix}\n${diagnosticUi}\nconst render = publishRuntimeDiagnostics; publishRuntimeDiagnostics = () => {}; global.testDiagnostics = { beginDiagnosticRun, recordAnalysisStage, createDiagnosticExport, render }; })(globalThis);`, context);
  return { api: context.testDiagnostics, elements, downloads, scheduled, blobs, revoked };
}
const page = loadDiagnosticPage();
const run = page.api.beginDiagnosticRun('12345678-1234-5678-1234-567812345678');
page.api.recordAnalysisStage(run, 'image-file-received');
page.api.recordAnalysisStage(run, 'analysis-start');
const writesBeforeRecognition = storageWrites.length;
for (let index = 0; index < 1000; index += 1) {
  page.api.recordAnalysisStage(run, 'ocr-recognition-image-data-read-start', { lineIndex: index, estimatedBytes: 4096 });
  page.api.recordAnalysisStage(run, 'ocr-recognition-run-done', { lineIndex: index });
}
assert.equal(storageWrites.length, writesBeforeRecognition, 'Fine Recognition stages must remain in memory, independent of their count.');
page.api.recordAnalysisStage(run, 'ocr-recognition-done');
page.api.recordAnalysisStage(run, 'ocr-worker-terminate-done', { workerAction: 'stop', workerType: 'ocr' });
page.api.recordAnalysisStage(run, 'structure-worker-create-done', { workerAction: 'start', workerType: 'structure' });
const beforeReload = page.api.createDiagnosticExport();
assert.equal(beforeReload.localStorageWrites, storageWrites.length, 'The exported counter must count actual storage mutations.');
assert.ok(beforeReload.localStorageWrites < 100);
assert.equal(page.scheduled.length, 0, 'Diagnostic stage recording must not schedule timer-based storage writes.');
const reloaded = loadDiagnosticPage();
reloaded.api.render();
const saveButton = reloaded.elements.find(element => element.id === 'analysisDiagnosticsDownload');
assert.equal(saveButton.textContent, '診断JSONを保存');
saveButton.click();
assert.equal(reloaded.downloads.length, 1, 'One click should download one JSON file without copying text.');
assert.match(reloaded.downloads[0].name, /^magia-diagnostics-\d{4}-\d\d-\d\dT.+-12345678\.json$/);
const savedReport = JSON.parse(await reloaded.blobs[0].text());
assert.equal(savedReport.interrupted, true);
assert.equal(savedReport.runId, beforeReload.runId);
assert.equal(savedReport.startedTimestamp, beforeReload.startedTimestamp);
assert.equal(savedReport.localStorageWrites, beforeReload.localStorageWrites);
assert.equal(savedReport.lastStage, 'structure-worker-create-done');
assert.deepEqual(savedReport.trace, JSON.parse(JSON.stringify(beforeReload.trace)), 'Reloaded downloads must preserve the interrupted trace.');
assert.match(reloaded.elements.find(element => element.id === 'analysisRuntimeDiagnosticsText').textContent,
  new RegExp(`LocalStorage diagnostic writes: ${beforeReload.localStorageWrites}`));
reloaded.scheduled.forEach(callback => callback());
assert.deepEqual(reloaded.revoked, ['blob:diagnostics'], 'Downloading must release the temporary object URL.');
console.log(`Persistence and interrupted-run download passed (${beforeReload.localStorageWrites} actual writes across 2005 stages).`);
const recognitionPeaks = new Map();
assert.equal(diagnostics.isCriticalStage('ocr-recognition-preprocess-buffer-alloc-start', { estimatedBytes: 2 * 1024 * 1024 }, recognitionPeaks), true);
assert.equal(diagnostics.isCriticalStage('ocr-recognition-preprocess-buffer-alloc-start', { estimatedBytes: 2 * 1024 * 1024 }, recognitionPeaks), false, 'Repeated same-size Recognition variants should not write storage.');
assert.equal(diagnostics.isCriticalStage('ocr-recognition-preprocess-buffer-alloc-start', { estimatedBytes: 4 * 1024 * 1024 }, recognitionPeaks), true, 'A larger Recognition allocation must persist before it occurs.');

// Optional: replay measured web-wasm Worker stages through production persistence.
for (const tracePath of process.argv.slice(2)) {
  const fixtureTrace = JSON.parse(await readFile(tracePath, 'utf8'));
  for (const measuredRun of fixtureTrace.runs) {
    const replay = loadDiagnosticPage();
    const replayRun = replay.api.beginDiagnosticRun(`trace-replay-${measuredRun.iteration}`);
    replay.api.recordAnalysisStage(replayRun, 'image-file-received');
    replay.api.recordAnalysisStage(replayRun, 'analysis-start');
    const previousWrites = storageWrites.length;
    for (const event of measuredRun.stages) replay.api.recordAnalysisStage(replayRun, event.stage, event.details);
    const workerStageWrites = storageWrites.length - previousWrites;
    assert.ok(workerStageWrites < 80, `Worker stage persistence must leave room for Main Thread phase boundaries, got ${workerStageWrites}.`);
    console.log(`${tracePath} run ${measuredRun.iteration}: ${workerStageWrites} actual storage writes replaying ${measuredRun.stages.length} measured Worker stages (Main Thread lifecycle excluded).`);
  }
}
