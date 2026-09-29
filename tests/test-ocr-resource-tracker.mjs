import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../assets/js/ocr-resource-tracker.js';
import '../assets/js/ocr-line-split.js';
import '../assets/js/image-analysis-core.js';
import '../assets/js/analysis-diagnostics.js';

const trackerApi = globalThis.MagiaOcrResourceTracker;
assert.ok(trackerApi, 'The OCR OpenCV resource tracker should be available.');

const deletionOrder = [];
const cleanupErrors = [];
const tracker = trackerApi.create((error, details) => cleanupErrors.push({ error, details }));
let resourceDeleteCount = 0;
const resource = {
  delete() {
    assert.equal(this, resource, 'The original embind delete method should keep its receiver.');
    resourceDeleteCount += 1;
    deletionOrder.push('resource');
  },
};
const originalDelete = resource.delete;
assert.equal(tracker.track(resource), resource);
assert.equal(resource.delete, originalDelete, 'Tracking must not replace an Emscripten object method.');
assert.equal(tracker.delete(resource), true);
assert.equal(resource.delete, originalDelete, 'External cleanup must leave the native method untouched.');
assert.equal(tracker.delete(resource), false, 'An explicitly released resource must not be deleted twice.');
assert.equal(tracker.releaseAll(), true, 'releaseAll after explicit release must be idempotent.');
assert.equal(tracker.releaseAll(), true, 'Repeated releaseAll must remain harmless.');
assert.equal(resourceDeleteCount, 1, 'Explicit release followed by releaseAll must delete exactly once.');
assert.equal(tracker.size, 0);
assert.equal(cleanupErrors.length, 0, 'A release of an already released object must not create a cleanup error.');

const failingResource = { delete() { deletionOrder.push('failure'); throw new ReferenceError("Can't find variable: dispose"); } };
const finalResource = { delete() { deletionOrder.push('final'); } };
tracker.track(failingResource);
tracker.track(finalResource);
assert.equal(tracker.releaseAll({ phase: 'test' }), false, 'Cleanup failures must be reported without escaping the helper.');
assert.equal(tracker.releaseAll({ phase: 'test-repeat' }), true, 'A failed deletion is removed from ownership and is not attempted again.');
assert.deepEqual(deletionOrder, ['resource', 'final', 'failure'], 'Tracked resources should be released in reverse order.');
assert.equal(cleanupErrors.length, 1);
assert.equal(cleanupErrors[0].error.name, 'ReferenceError');
assert.match(cleanupErrors[0].error.message, /dispose/);
assert.equal(cleanupErrors[0].details.phase, 'test');

const missingMethodResource = { delete() {} };
tracker.track(missingMethodResource);
missingMethodResource.delete = null;
assert.equal(tracker.delete(missingMethodResource), false, 'A tracked embind object without its delete method should report and return false.');
assert.equal(cleanupErrors.at(-1).error.name, 'TypeError');
assert.match(cleanupErrors.at(-1).error.message, /no delete method/);
const untrackableResource = {};
const errorsBeforeUntrackable = cleanupErrors.length;
assert.equal(tracker.track(untrackableResource), untrackableResource);
assert.equal(cleanupErrors.length, errorsBeforeUntrackable, 'Plain JavaScript value objects must not be treated as failed OpenCV resources.');
assert.equal(tracker.delete(untrackableResource), false, 'An unowned value object must be a harmless no-op on release.');

const firstCleanupErrors = [];
const cleanupSummaries = [];
const cleanupAggregator = trackerApi.createCleanupErrorAggregator(
  (error, details) => firstCleanupErrors.push({ error, details }),
  summary => cleanupSummaries.push(summary),
);
for (let index = 0; index < 25; index += 1) {
  cleanupAggregator.record('opencv-resource-delete', new TypeError('OpenCV resource has no delete method.'), { contourIndex: index });
}
assert.equal(firstCleanupErrors.length, 1, 'The first cleanup error should be recorded immediately.');
assert.equal(cleanupSummaries.length, 0, 'Repeated errors should remain aggregated in memory until phase end.');
assert.equal(cleanupAggregator.flush(), 1, 'One summary should be emitted for one repeated error kind.');
assert.equal(cleanupSummaries[0].stage, 'ocr-cleanup-error-summary');
assert.equal(cleanupSummaries[0].errorType, 'opencv-resource-delete');
assert.equal(cleanupSummaries[0].count, 25);
assert.deepEqual(cleanupSummaries[0].firstError, {
  name: 'TypeError', message: 'OpenCV resource has no delete method.',
});

const lineResources = [];
const deletedLineResources = [];
class FakeMat {
  constructor(rows = 0, cols = 0, type = 0) {
    this.rows = rows;
    this.cols = cols;
    const channels = type === fakeCv.CV_8UC4 ? 4 : type === fakeCv.CV_8UC1 ? 1 : 1;
    this.data = new Uint8Array(rows * cols * channels);
    this.data32F = new Float32Array(rows * cols * 2);
    lineResources.push(this);
  }
  delete() { deletedLineResources.push(this); }
}
class FakeMatVector {
  constructor() { this.items = []; lineResources.push(this); }
  size() { return this.items.length; }
  get(index) { return this.items[index]; }
  delete() { deletedLineResources.push(this); }
}
class FakeSize {
  constructor(width, height) { this.width = width; this.height = height; lineResources.push(this); }
  delete() { deletedLineResources.push(this); }
}
class FakePoint {
  constructor(x, y) { this.x = x; this.y = y; lineResources.push(this); }
  delete() { deletedLineResources.push(this); }
}
class FakeScalar {
  constructor() { lineResources.push(this); }
  delete() { deletedLineResources.push(this); }
}
const fakeCv = {
  Mat: FakeMat,
  MatVector: FakeMatVector,
  Size: FakeSize,
  Point: FakePoint,
  Scalar: FakeScalar,
  CV_8UC1: 1,
  CV_8UC4: 4,
  CV_32FC2: 32,
  CV_32SC2: 16,
  RETR_LIST: 0,
  CHAIN_APPROX_SIMPLE: 0,
  INTER_CUBIC: 0,
  BORDER_REPLICATE: 0,
  minAreaRect() {
    return {
      center: { x: 16, y: 16 },
      size: { width: 8, height: 8 },
      angle: 0,
    };
  },
  findContours(_mask, contours) { contours.items = Array.from({ length: 25 }, () => new FakeMat()); },
  matFromArray(rows, cols, type, values) {
    const mat = new FakeMat(rows, cols, type);
    if (type === this.CV_32FC2) mat.data32F.set(values);
    return mat;
  },
  getPerspectiveTransform() { return new FakeMat(3, 3, 0); },
  warpPerspective(_source, destination, _transform, size) {
    destination.rows = size.height;
    destination.cols = size.width;
    destination.data = new Uint8Array(size.width * size.height * 4).fill(11);
  },
};
const fakeClipper = {
  JoinType: { jtRound: 0 },
  EndType: { etClosedPolygon: 0 },
  ClipperOffset: class {
    AddPath() {}
    Execute(paths) { paths.push([{ X: 12, Y: 12 }, { X: 20, Y: 12 }, { X: 20, Y: 20 }, { X: 12, Y: 20 }]); }
    Clear() {}
  },
};
const lineStages = [];
const lineStageEvents = [];
const lineDiagnostics = {
  stage(name, details) { lineStages.push(name); lineStageEvents.push({ name, details }); },
  allocationStart(name) { lineStages.push(name); },
  allocationDone(name) { lineStages.push(name); },
  releaseStart(name) { lineStages.push(name); },
  releaseDone(name) { lineStages.push(name); },
};
const lineResult = globalThis.MagiaOcrLineSplitter.create(
  fakeCv,
  fakeClipper,
  new Uint8Array(32 * 32).fill(255),
  32,
  32,
  { data: new Uint8ClampedArray(32 * 32 * 4), width: 32, height: 32 },
  32,
  32,
  null,
  lineDiagnostics,
  tracked => tracker.track(tracked),
  (tracked, details) => tracker.delete(tracked, details),
);
assert.equal(lineResult.lines.length, 25, 'The fixture should produce and process 25 contours.');
assert.equal(lineStageEvents.find(event => event.name === 'ocr-find-contours-done').details.contourCount, 25);
const crop = lineResult.lines[0].image.data;
assert.equal(crop.length, 8 * 8 * 4, 'The perspective output should materialize RGBA pixels.');
assert.ok(lineStages.includes('ocr-line-perspective-done'));
assert.ok(lineStages.includes('ocr-line-perspective-release-done'));
assert.ok(lineStages.includes('ocr-line-source-mat-release-done'));
assert.ok(lineStages.includes('ocr-line-materialize-done'));
lineResult.release();
lineResult.release();
assert.equal(tracker.size, 0, 'Line materialization and release should relinquish every owned OpenCV resource.');
assert.equal(new Set(deletedLineResources).size, deletedLineResources.length, 'No OpenCV object should be deleted twice.');
assert.equal(deletedLineResources.length, lineResources.length, `Every OpenCV fixture resource should be released exactly once: ${lineResources.flatMap((item, index) => deletedLineResources.includes(item) ? [] : [`${index}:${item.constructor.name}:${item.rows}x${item.cols}`]).join(', ')}`);
assert.ok(lineResources.every(item => item.delete === Object.getPrototypeOf(item).delete), 'Line splitter must leave the original OpenCV methods untouched.');
assert.equal(cleanupErrors.length, errorsBeforeUntrackable, '25 contour processing must not produce OpenCV resource cleanup errors.');

const sourceWidth = 1254;
const sourceHeight = 1254;
const targetWidth = 1280;
const targetHeight = 1280;
const source = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
for (let y = 0; y < sourceHeight; y += 1) {
  for (let x = 0; x < sourceWidth; x += 1) {
    const offset = (y * sourceWidth + x) * 4;
    source[offset] = (x * 31 + y * 17) & 255;
    source[offset + 1] = (x * 13 + y * 29) & 255;
    source[offset + 2] = (x * 3 + y * 7) & 255;
    source[offset + 3] = (x + y * 11) & 255;
  }
}
const expectedAligned = new Uint8ClampedArray(targetWidth * targetHeight * 4);
globalThis.ImageAnalysisCore.resizeRgbaSharpContainInto(
  source, sourceWidth, sourceHeight, targetWidth, targetHeight, expectedAligned,
);
const alignmentEvents = [];
const alignmentReporter = globalThis.MagiaAnalysisDiagnostics.createReporter('ocr', event => alignmentEvents.push(event));
alignmentReporter.begin('source-alignment-regression');
const aligned = globalThis.MagiaOcrLineSplitter.alignSource(
  { data: source, width: sourceWidth, height: sourceHeight },
  targetWidth,
  targetHeight,
  alignmentReporter,
);
assert.equal(aligned.width, targetWidth);
assert.equal(aligned.height, targetHeight);
const expectedBytes = Buffer.from(expectedAligned.buffer, expectedAligned.byteOffset, expectedAligned.byteLength);
const alignedBytes = Buffer.from(aligned.data.buffer, aligned.data.byteOffset, aligned.data.byteLength);
assert.equal(alignedBytes.compare(expectedBytes), 0, 'The moved alignment helper must preserve every output RGBA byte.');
const alignmentStages = alignmentEvents.map(event => event.stage);
const requiredAlignmentStages = [
  'ocr-source-align-check',
  'ocr-source-align-buffer-alloc-start', 'ocr-source-align-buffer-alloc-done',
  'ocr-source-align-render-start',
  'ocr-source-align-kernel-prepare-start', 'ocr-source-align-kernel-prepare-done',
  'ocr-source-align-horizontal-start', 'ocr-source-align-row-cache-start',
  'ocr-source-align-vertical-start', 'ocr-source-align-output-finalize-start',
  'ocr-source-align-render-progress',
  'ocr-source-align-horizontal-done', 'ocr-source-align-row-cache-done',
  'ocr-source-align-vertical-done', 'ocr-source-align-output-finalize-done',
  'ocr-source-align-render-done',
];
let previousStageIndex = -1;
for (const stage of requiredAlignmentStages) {
  const stageIndex = alignmentStages.indexOf(stage);
  assert.ok(stageIndex > previousStageIndex, `Alignment diagnostics should retain ordered stage ${stage}.`);
  previousStageIndex = stageIndex;
}
assert.ok(alignmentEvents.every(event => Number.isFinite(event.elapsedMs)), 'Every alignment sub-stage should keep the reporter elapsedMs.');
assert.equal(aligned.release(), true);
assert.equal(aligned.release(), false, 'Aligned source release should be idempotent.');
assert.equal(alignmentReporter.knownLiveBytes, 0, 'Aligned output accounting should be released after line recognition ownership ends.');

const workerSource = await readFile(new URL('../assets/js/magia-circle-ocr-worker.js', import.meta.url), 'utf8');
const lineSplitterSource = await readFile(new URL('../assets/js/ocr-line-split.js', import.meta.url), 'utf8');
assert.doesNotMatch(workerSource, /resource\.delete\s*=/, 'OCR worker must not monkey-patch embind delete methods.');
assert.doesNotMatch(workerSource, /MatVector\?\.prototype\?\.get\s*=/, 'OCR worker must not patch generated MatVector methods for tracking.');
assert.doesNotMatch(workerSource, /cv\.getPerspectiveTransform\s*=/, 'OCR worker should keep the OpenCV API object unchanged.');
assert.doesNotMatch(workerSource, /trackConstructor|new Proxy\(Constructor/, 'OCR resources should be registered explicitly when created.');
assert.doesNotMatch(workerSource, /\btrackCvResource\b/, 'Resource tracking callbacks must not leak into the OCR worker scope.');
assert.match(workerSource, /MagiaOcrResourceTracker\.create/, 'OCR worker should use the external resource tracker.');
assert.match(lineSplitterSource, /trackCvResource\s*=\s*null/, 'The line splitter should accept an external resource tracking helper.');
assert.match(lineSplitterSource, /trackCvResource\(resource\)/, 'OpenCV values should be registered explicitly after creation.');
assert.match(lineSplitterSource, /deleteCvResource\s*=\s*null/, 'The line splitter should accept the external delete helper.');
assert.match(lineSplitterSource, /deleteCvResource\(resource/, 'OpenCV line cleanup should go through the external helper.');
assert.match(lineSplitterSource, /const boundingBox = cv\.minAreaRect\(contour\)/, 'minAreaRect RotatedRect values should remain local JavaScript values, outside native resource tracking.');
assert.match(lineSplitterSource, /contour = track\(contours\.get\(index\)\)/, 'MatVector.get(i) contour Mat must have tracker ownership.');
assert.match(lineSplitterSource, /releaseCvResource\(contour\)/, 'Each tracked MatVector contour must release through its tracker.');
assert.doesNotMatch(lineSplitterSource, /\bdispose\s*\(/, 'Line crop cleanup must not call a free dispose identifier.');
assert.match(workerSource, /MagiaOcrLineSplitter\.alignSource\(image, width, height, diagnosticReporter\);\s*reportStage\('ocr-opencv-phase-start'/,
  'Source alignment must finish before the OpenCV loading phase starts.');

console.log('PASS_OCR_RESOURCE_TRACKER_25_CONTOURS_ALIGNMENT_BYTES_AND_PERSPECTIVE_CLEANUP');
