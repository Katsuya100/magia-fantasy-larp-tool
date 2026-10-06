import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
for (const name of ['runtime-dependencies.js', 'spell-ocr.js', 'image-analysis-core.js', 'attribute-scoring.js', 'power-calculation.js', 'ocr-error-policy.js', 'magia-image-pipeline.js']) {
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
let structureInputCalls = 0;
await MagiaImagePipeline.run({
  ...pipelineOptions(async () => ({ path: { text: '', words: [], points: [] } })),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
});
assert.equal(structureInputCalls, 1, 'A successful empty OCR result should preserve the existing Structure flow.');

const perspectiveError = vm.runInContext("new TypeError('getPerspectiveTransform hasOwnProperty')", context);
attempts = 0;
structureInputCalls = 0;
const ocrErrorStages = [];
await assert.rejects(MagiaImagePipeline.run({
  ...pipelineOptions(async () => {
    attempts += 1;
    throw perspectiveError;
  }),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
  reportStage: stage => ocrErrorStages.push(stage),
}), error => error === perspectiveError);
assert.equal(attempts, 1, 'a programming TypeError must not retry the same OCR run');
assert.equal(structureInputCalls, 1, 'An OCR execution error must reject after the independent raw Structure phase.');
assert.ok(ocrErrorStages.includes('ocr-execution-error'), 'A thrown OCR exception should be explicitly diagnosed before the app ends the run.');

const disposeError = vm.runInContext("new ReferenceError(\"Can't find variable: dispose\")", context);
assert.equal(MagiaImagePipeline.isRetryableOcrError(disposeError), false, 'ReferenceError must never be retryable');
attempts = 0;
structureInputCalls = 0;
await assert.rejects(MagiaImagePipeline.run({
  ...pipelineOptions(async () => {
    attempts += 1;
    throw disposeError;
  }),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
}), error => error === disposeError);
assert.equal(attempts, 1, 'a dispose ReferenceError must not trigger another OCR worker');
assert.equal(structureInputCalls, 1, 'A dispose ReferenceError must reject after the independent raw Structure phase.');

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
structureInputCalls = 0;
await assert.rejects(MagiaImagePipeline.run({
  ...pipelineOptions(async () => {
    attempts += 1;
    throw allocationError;
  }),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
}), error => error === allocationError);
assert.equal(attempts, 1, 'a memory-related OCR exception must not be retried');
assert.equal(structureInputCalls, 1, 'A memory allocation failure must reject after the independent raw Structure phase.');

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
structureInputCalls = 0;
await assert.rejects(MagiaImagePipeline.run({
  ...pipelineOptions(async () => {
    attempts += 1;
    throw retryableError;
  }),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
}), error => error === retryableError);
assert.equal(attempts, 2, 'a retryable failure on the second attempt must not trigger a third OCR run');
assert.equal(structureInputCalls, 1, 'A second OCR exception must reject after the independent raw Structure phase.');

attempts = 0;
structureInputCalls = 0;
await assert.rejects(MagiaImagePipeline.run({
  ...pipelineOptions(async () => { attempts += 1; throw unknownError; }),
  getStructureInput: async () => { structureInputCalls += 1; return { analysis: { scale: 1 } }; },
}), error => error === unknownError);
assert.equal(attempts, 1, 'Unknown OCR errors must not retry.');
assert.equal(structureInputCalls, 1, 'Unknown OCR errors must reject after the independent raw Structure phase.');

console.log('PASS_IMAGE_PIPELINE_EMPTY_RESULT_AND_ERROR_RETRY');

const phases = [];
let analysisInput = { analysis: { scale: 1 } };
await MagiaImagePipeline.run({
  ...pipelineOptions(async () => {
    assert.equal(analysisInput.analysis, null, 'Structure input must be released before OCR starts.');
    phases.push('ocr');
    return { path: { text: 'fire', words: ['fire'], points: [] } };
  }),
  getStructureInput: async () => { phases.push('structure-input'); return analysisInput; },
  analyzeStructure: async () => { phases.push('structure'); return { paths: null }; },
  getMasterImage: async () => { phases.push('score-image'); return { data: new Uint8Array(4), width: 1, height: 1 }; },
  releaseMasterImage: async () => { phases.push('score-image-released'); },
  embedAttributes: async () => { phases.push('embedding'); throw new Error('Skip model loading'); },
});
assert.deepEqual(phases, ['structure-input', 'structure', 'ocr', 'score-image', 'score-image-released', 'embedding']);
console.log('PASS_STRUCTURE_BEFORE_OCR_AND_IMAGE_RELEASE_BEFORE_EMBEDDING');
