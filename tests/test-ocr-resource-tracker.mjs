import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../assets/js/ocr-resource-tracker.js';
import '../assets/js/ocr-line-split.js';

const trackerApi = globalThis.MagiaOcrResourceTracker;
assert.ok(trackerApi, 'The OCR OpenCV resource tracker should be available.');

const deletionOrder = [];
const cleanupErrors = [];
const tracker = trackerApi.create((error, details) => cleanupErrors.push({ error, details }));
const resource = {
  delete() {
    assert.equal(this, resource, 'The original embind delete method should keep its receiver.');
    deletionOrder.push('resource');
  },
};
const originalDelete = resource.delete;
assert.equal(tracker.track(resource), resource);
assert.equal(resource.delete, originalDelete, 'Tracking must not replace an Emscripten object method.');
assert.equal(tracker.delete(resource), true);
assert.equal(resource.delete, originalDelete, 'External cleanup must leave the native method untouched.');
assert.deepEqual(deletionOrder, ['resource']);
assert.equal(tracker.size, 0);

const failingResource = { delete() { deletionOrder.push('failure'); throw new ReferenceError("Can't find variable: dispose"); } };
const finalResource = { delete() { deletionOrder.push('final'); } };
tracker.track(failingResource);
tracker.track(finalResource);
assert.equal(tracker.releaseAll({ phase: 'test' }), false, 'Cleanup failures must be reported without escaping the helper.');
assert.deepEqual(deletionOrder, ['resource', 'final', 'failure'], 'Tracked resources should be released in reverse order.');
assert.equal(cleanupErrors.length, 1);
assert.equal(cleanupErrors[0].error.name, 'ReferenceError');
assert.match(cleanupErrors[0].error.message, /dispose/);
assert.equal(cleanupErrors[0].details.phase, 'test');

const lineResources = [];
const deletedLineResources = [];
class FakeMat {
  constructor(height = 0, width = 0) {
    this.data = new Uint8Array(height * width);
    lineResources.push(this);
  }
  delete() { deletedLineResources.push(this); }
}
class FakeMatVector {
  size() { return 1; }
  get() { return new FakeMat(); }
  delete() { deletedLineResources.push(this); }
  constructor() { lineResources.push(this); }
}
const fakeCv = {
  Mat: FakeMat,
  MatVector: FakeMatVector,
  CV_8UC1: 0,
  RETR_LIST: 0,
  CHAIN_APPROX_SIMPLE: 0,
  minAreaRect() {
    const box = new FakeMat();
    box.center = { x: 0, y: 0 };
    box.size = { width: 2, height: 2 };
    box.angle = 0;
    return box;
  },
  findContours() {},
};
const lineResult = globalThis.MagiaOcrLineSplitter.create(
  fakeCv,
  null,
  new Uint8Array([255]),
  1,
  1,
  { data: new Uint8ClampedArray(4), width: 1, height: 1 },
  1,
  1,
  null,
  null,
  tracked => tracker.track(tracked),
  (tracked, details) => tracker.delete(tracked, details),
);
lineResult.release();
assert.equal(tracker.size, 0, 'The line-splitter cleanup path should remove every tracked OpenCV resource.');
assert.equal(lineResult.lines.length, 0, 'The fixture exercises contour bounding-box cleanup before line materialization.');
assert.equal(deletedLineResources.length, 5, 'Mask, contour vector, hierarchy, contour, and minAreaRect resources should all be released.');
assert.ok(lineResources.every(resource => resource.delete === Object.getPrototypeOf(resource).delete), 'Line splitter must leave the original OpenCV methods untouched.');

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
assert.match(lineSplitterSource, /function getMiniBoxes\([^)]*disposeCvResource = null\)/, 'minAreaRect cleanup must receive a local cleanup callback.');

console.log('PASS_OCR_RESOURCE_TRACKER_NO_EMBIND_MONKEY_PATCH');
