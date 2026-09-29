import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../assets/js/analysis-diagnostics.js';

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

for (const stage of [
  'ocr-worker-create-start',
  'ocr-detection-model-fetch-start',
  'ocr-detection-model-arraybuffer-start',
  'ocr-detection-session-create-start',
  'ocr-detection-run-start',
  'recognition-session-run-start',
  'master-image-get-image-data-start',
  'ocr-image-data-read-start',
  'vocabulary-json-parse-start',
  'embedding-model-load-start',
  'ocr-worker-retry-start',
]) {
  const details = stage === 'ocr-detection-model-arraybuffer-start' || stage === 'recognition-session-run-start'
    ? { estimatedBytes: 2 * 1024 * 1024 }
    : {};
  assert.equal(diagnostics.isCriticalStage(stage, details), true, `${stage} should synchronously persist before risky work.`);
}
assert.equal(diagnostics.isCriticalStage('ocr-recognition-run-start'), false, 'Small recognition line runs should batch instead of producing one synchronous write each.');
assert.equal(diagnostics.isCriticalStage('ocr-line-release-start'), false, 'Small release milestones may be batched.');

const batchedFlushes = [];
const batcher = diagnostics.createStageBatcher(() => batchedFlushes.push('flush'), { batchSize: 16, delayMs: -1 });
for (let index = 0; index < 15; index += 1) batcher.add(false);
assert.equal(batchedFlushes.length, 0, 'Lightweight events should wait for a batch.');
batcher.add(false);
assert.equal(batchedFlushes.length, 1, 'A full batch should flush once.');
batcher.add(true);
assert.equal(batchedFlushes.length, 2, 'A critical event should flush immediately.');

const sampleFlushes = [];
const sampleBatcher = diagnostics.createStageBatcher(() => sampleFlushes.push('write'), { batchSize: 16, delayMs: -1 });
const importantStages = new Map([
  [0, 'image-file-received'], [15, 'analysis-start'], [30, 'ocr-worker-create-start'],
  [45, 'ocr-detection-model-fetch-start'], [60, 'ocr-detection-model-arraybuffer-start'],
  [75, 'ocr-detection-session-create-start'], [90, 'ocr-detection-run-start'],
  [105, 'ocr-detection-mask-buffer-alloc-start'], [120, 'ocr-image-data-read-start'],
  [135, 'vocabulary-json-parse-start'], [150, 'opencv-import-start'],
  [165, 'recognition-session-run-start'], [180, 'embedding-model-load-start'],
  [195, 'ocr-source-mat-alloc-start'], [210, 'ocr-recognition-input-buffer-alloc-start'],
  [225, 'ocr-worker-retry-start'], [240, 'structure-worker-run-start'], [273, 'analysis-complete'],
]);
for (let index = 0; index < 274; index += 1) {
  const stage = importantStages.get(index) || (index % 2 === 0 ? 'ocr-recognition-run-start' : 'ocr-line-release-done');
  const details = /(?:arraybuffer|alloc)-start$/.test(stage) ? { estimatedBytes: 2 * 1024 * 1024 } :
    stage === 'recognition-session-run-start' ? { inputEstimatedBytes: 2 * 1024 * 1024 } : {};
  sampleBatcher.add(diagnostics.isCriticalStage(stage, details));
}
sampleBatcher.flush();
const estimatedStorageWrites = sampleFlushes.length + 3; // RunId once and analysis stage start/complete.
assert.ok(estimatedStorageWrites < 100, `A representative 274-stage trace should use fewer than 100 storage writes, observed ${estimatedStorageWrites}.`);

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
assert.ok(detectorSetup.includes('async function ensureOcrImageRuntimes()'));
assert.equal(detectorSetup.includes('await ensureOcrImageRuntimes()'), false, 'Detection setup must not execute OpenCV initialization eagerly.');
assert.ok(detectorSetup.includes("import('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm')"));
const orderedStages = [
  "reportStage('ocr-detection-run-start'",
  'await sessionForRun.run(',
  "reportStage('ocr-detection-run-done'",
  'await releaseDetectionSession();',
  "reportStage('ocr-detection-cleanup-done'",
  'await ensureOcrImageRuntimes();',
];
let previousIndex = -1;
for (const token of orderedStages) {
  const nextIndex = detectBody.indexOf(token);
  assert.ok(nextIndex > previousIndex, `Expected lazy Detection/OpenCV order at ${token}.`);
  previousIndex = nextIndex;
}
assert.match(appSource, /createReporter\('main'/, 'Each Main Thread diagnostic run should own a Reporter.');
assert.match(appSource, /message\.type === 'diagnostic-stage'.*?recordAnalysisStage\(/s, 'Worker diagnostic messages should enter the Main Thread Reporter.');
assert.match(appSource, /setItem\('magiaAnalysisTrace'/, 'Main Thread events should persist their bounded trace to localStorage.');
assert.match(appSource, /createStageBatcher/, 'Main Thread trace snapshots should use the storage batcher.');
assert.match(appSource, /run\.trace = run\.reporter\.trace/, 'Every diagnostic event should remain in the bounded in-memory trace.');
assert.match(appSource, /if \(!diagnosticsEnabled\) return;/, 'Diagnostic UI must remain hidden outside diagnostic mode.');

console.log(`Analysis diagnostic Reporter and lazy OpenCV checks passed (${estimatedStorageWrites} modeled writes for a representative 274-stage batch).`);
