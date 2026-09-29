import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
for (const name of ['spell-ocr.js', 'image-analysis-core.js', 'attribute-scoring.js', 'power-calculation.js', 'ocr-error-policy.js', 'magia-image-pipeline.js']) {
  const source = await readFile(new URL(`../assets/js/${name}`, import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: name });
}

const { MagiaImagePipeline } = context;
const corrected = context.SpellOcrCore.applyVocabularyCorrection({
  path: { text: 'fier', words: ['fier'], points: [] },
}, {
  correctWords: words => ({ words: words.map(word => word === 'fier' ? 'fire' : word), corrections: [{ from: 'fier', to: 'fire', similarity: 0.8 }] }),
});
assert.equal(corrected.rawPathText, 'fier', 'vocabulary correction must preserve the raw OCR text');
assert.equal(corrected.path.text, 'Fire.', 'vocabulary correction must preserve the recognized-word correction');
assert.deepEqual(corrected.corrections, [{ from: 'fier', to: 'fire', similarity: 0.8 }], 'vocabulary correction metadata must be retained');

let embeddedText = null;
const correctedRun = await MagiaImagePipeline.run({
  ...pipelineOptions(async () => ({ path: { text: 'fier', words: ['fier'], points: [] } })),
  correctSpell: recognition => context.SpellOcrCore.applyVocabularyCorrection(recognition, {
    correctWords: words => ({ words: words.map(word => word === 'fier' ? 'fire' : word), corrections: [] }),
  }),
  embedAttributes: async text => { embeddedText = text; throw new Error('Skip model loading in this pipeline test.'); },
});
assert.equal(correctedRun.spell.path.text, 'Fire.', 'delayed vocabulary correction must update the OCR result');
assert.equal(embeddedText, 'Fire.', 'Embedding must receive the corrected spell text');
assert.equal(correctedRun.wordCount, 1, 'power must count corrected OCR words');

function pipelineOptions(recognizeSpell) {
  return {
    recognizeSpell,
    getStructureInput: async () => ({ analysis: { scale: 1 } }),
    analyzeStructure: async () => ({ paths: null, sigilScores: null, lineStraightness: 0 }),
    getMasterImage: async () => ({ data: new Uint8Array(4), width: 1, height: 1 }),
    embedAttributes: async () => { throw new Error('Skip model loading in this pipeline test.'); },
    releaseAttributeModel: async () => {},
  };
}

let attempts = 0;
const empty = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  return { path: { text: '', words: [], points: [] } };
}));
assert.equal(attempts, 1, 'an empty OCR result must not rerun the same image and models');
assert.equal(empty.spell.path.text, '', 'an empty OCR result must remain empty');
assert.equal(empty.wordCount, 0, 'an empty OCR result must contribute no words');
assert.match(empty.spell.error, /no spell text/, 'an empty OCR result must explain that recognition found no text');

const perspectiveError = vm.runInContext("new TypeError('getPerspectiveTransform hasOwnProperty')", context);
attempts = 0;
const failed = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  throw perspectiveError;
}));
assert.equal(attempts, 1, 'a programming TypeError must not retry the same OCR run');
assert.match(failed.spell.error, /getPerspectiveTransform/, 'the OCR exception must be preserved');
assert.equal(failed.wordCount, 0, 'an OCR exception must not invent words');

const disposeError = vm.runInContext("new ReferenceError(\"Can't find variable: dispose\")", context);
assert.equal(MagiaImagePipeline.isRetryableOcrError(disposeError), false, 'ReferenceError must never be retryable');
attempts = 0;
const disposeFailure = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  throw disposeError;
}));
assert.equal(attempts, 1, 'a dispose ReferenceError must not trigger another OCR worker');
assert.match(disposeFailure.spell.error, /dispose/);

const allocationError = vm.runInContext("new RangeError('Invalid typed array length: allocation failed')", context);
assert.equal(MagiaImagePipeline.isRetryableOcrError(allocationError), false, 'RangeError allocation failures must not retry');
const wasmAllocationError = vm.runInContext("new WebAssembly.RuntimeError('WebAssembly.Memory could not allocate memory')", context);
assert.equal(MagiaImagePipeline.isRetryableOcrError(wasmAllocationError), false, 'WebAssembly memory allocation failures must not retry');
for (const message of ['out of memory', 'memory access out of bounds', 'OpenCV allocation failure', 'ORT memory allocation failure']) {
  const allocationLikeError = vm.runInContext(`new Error(${JSON.stringify(message)})`, context);
  assert.equal(context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(allocationLikeError, 'model'), allocationLikeError, `${message} must not be tagged as retryable.`);
  assert.equal(MagiaImagePipeline.isRetryableOcrError(allocationLikeError), false, `${message} must not retry.`);
}
attempts = 0;
const memoryFailure = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  throw allocationError;
}));
assert.equal(attempts, 1, 'a memory-related OCR exception must not be retried');
assert.match(memoryFailure.spell.error, /allocation failed/, 'a memory-related OCR exception must be preserved');

const typeError = vm.runInContext("new TypeError('Failed to fetch')", context);
const abortError = vm.runInContext("Object.assign(new Error('cancelled'), { name: 'AbortError' })", context);
const unknownError = vm.runInContext("new Error('unclassified OCR failure')", context);
const retryableError = context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(typeError, 'detection model');
assert.equal(MagiaImagePipeline.isRetryableOcrError(typeError), false, 'an untagged TypeError must not retry');
assert.equal(MagiaImagePipeline.isRetryableOcrError(vm.runInContext("new TypeError('bad argument')", context)), false);
assert.equal(MagiaImagePipeline.isRetryableOcrError(vm.runInContext("new SyntaxError('bad script')", context)), false);
assert.equal(MagiaImagePipeline.isRetryableOcrError(vm.runInContext("new RangeError('array length out of range')", context)), false);
assert.equal(MagiaImagePipeline.isRetryableOcrError(abortError), false, 'AbortError must not retry');
assert.equal(MagiaImagePipeline.isRetryableOcrError(unknownError), false, 'unknown errors must default to no retry');
assert.equal(MagiaImagePipeline.isRetryableOcrError(retryableError), true, 'explicit transient network model-load errors may retry');
assert.equal(MagiaImagePipeline.isRetryableOcrError(context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(vm.runInContext("new TypeError('fetch failed')", context), 'recognition model')), true);
assert.equal(MagiaImagePipeline.isRetryableOcrError(context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(vm.runInContext("Object.assign(new Error('network request timed out'), { name: 'TimeoutError' })", context), 'recognition dictionary')), true);
assert.equal(MagiaImagePipeline.isRetryableOcrError(context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(new Error('HTTP 503'), 'detection model')), true);
assert.equal(MagiaImagePipeline.isRetryableOcrError(context.MagiaOcrErrorPolicy.wrapRetryableLoadFailure(new Error('HTTP 404'), 'detection model')), false);

attempts = 0;
let retryCallbacks = 0;
const retried = await MagiaImagePipeline.run({
  ...pipelineOptions(async attempt => {
    attempts += 1;
    if (attempt === 0) throw retryableError;
    return { path: { text: 'fire', words: ['fire'], points: [] } };
  }),
  onRecognitionRetry: async ({ attempt, resource }) => {
    retryCallbacks += 1;
    assert.equal(attempt, 1);
    assert.equal(resource, 'detection model');
  },
});
assert.equal(attempts, 2, 'an explicit temporary load failure may start at most one retry');
assert.equal(retryCallbacks, 1, 'one retry should be reported once');
assert.equal(retried.spell.path.text, 'fire');

attempts = 0;
const retriedFailure = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  throw retryableError;
}));
assert.equal(attempts, 2, 'a retryable failure on the second attempt must not trigger a third OCR run');
assert.match(retriedFailure.spell.error, /detection model/);

console.log('PASS_IMAGE_PIPELINE_EMPTY_RESULT_AND_ERROR_RETRY');
