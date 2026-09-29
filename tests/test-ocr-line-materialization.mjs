import assert from 'node:assert/strict';
import cv from '@techstark/opencv-js';
import clipper from 'js-clipper';
import '../assets/js/image-analysis-core.js';
import '../assets/js/ocr-resource-tracker.js';
import '../assets/js/ocr-line-split.js';

if (!cv.Mat) await new Promise(resolve => { cv.onRuntimeInitialized = resolve; });
const width = 160;
const height = 128;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37 + Math.floor(index / width) * 17) & 255;
const mask = new Uint8Array(width * height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if ((x >= 12 && x < 62 && y >= 12 && y < 22)
      || (x >= 105 && x < 115 && y >= 15 && y < 65)
      || (x >= 20 && x < 70 && y >= 80 + Math.floor(x / 5) && y < 91 + Math.floor(x / 5))) mask[y * width + x] = 255;
  }
}
function prepare(failAtCrop = 0) {
  const errors = [];
  const tracker = globalThis.MagiaOcrResourceTracker.create((error, details) => errors.push({ error, details }));
  let sourceMatAllocations = 0;
  let alignmentReleased = 0;
  let cropCount = 0;
  const alignment = { data: pixels, release() { this.data = null; alignmentReleased += 1; } };
  const diagnostics = {
    allocationStart(stage) {
      if (stage === 'ocr-source-mat-alloc-start') sourceMatAllocations += 1;
      if (stage === 'ocr-line-perspective-start' && ++cropCount === failAtCrop) throw new Error('injected crop failure');
    },
  };
  const result = globalThis.MagiaOcrLineSplitter.create(
    cv, clipper, mask.slice(), width, height, { data: pixels, width, height }, width, height,
    null, diagnostics, resource => tracker.track(resource), (resource, details) => tracker.delete(resource, details),
    null, alignment,
  );
  return { result, tracker, errors, get sourceMatAllocations() { return sourceMatAllocations; }, get alignmentReleased() { return alignmentReleased; } };
}
const lazy = prepare();
const expected = lazy.result.lines.map(({ box, image }) => ({ box, image: { data: image.data, width: image.width, height: image.height } }));
assert.equal(expected.length, 3, 'The source should detect horizontal, vertical and slanted lines.');
assert.equal(lazy.sourceMatAllocations, 3, 'The old lazy path copies the source once per crop.');
lazy.result.release();
assert.equal(lazy.tracker.size, 0);
assert.deepEqual(lazy.errors, []);

for (let run = 0; run < 3; run += 1) {
  const batch = prepare();
  const actual = batch.result.materialize();
  assert.deepEqual(actual, expected, 'Shared source Mat must preserve every crop byte, box and line order, including rotation.');
  assert.equal(batch.sourceMatAllocations, 1, 'All crops must share one full-size source Mat.');
  assert.equal(batch.alignmentReleased, 1, 'Source pixels should be released before recognition can start.');
  assert.equal(batch.tracker.size, 0, 'No OpenCV resources should survive materialization.');
  assert.deepEqual(batch.errors, []);
  const transferred = structuredClone(actual, { transfer: actual.map(line => line.image.data.buffer) });
  assert.ok(actual.every(line => line.image.data.byteLength === 0), 'Every crop should be transferable without retaining source ownership.');
  assert.deepEqual(transferred, expected);
  batch.result.release();
  assert.equal(batch.alignmentReleased, 1, 'A final cleanup should not release alignment twice.');
}
const failed = prepare(2);
assert.throws(() => failed.result.materialize(), /injected crop failure/);
assert.equal(failed.alignmentReleased, 1, 'Failure should release the aligned source.');
assert.equal(failed.tracker.size, 0, 'Failure partway through crops should release all OpenCV resources.');
assert.deepEqual(failed.errors, []);
console.log('PASS_OCR_MATERIALIZATION_PIXELS_TRANSFER_LIFECYCLE_AND_FAILURE_CLEANUP');
