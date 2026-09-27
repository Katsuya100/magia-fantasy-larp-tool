import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
for (const name of ['spell-ocr.js', 'image-analysis-core.js', 'attribute-scoring.js', 'power-calculation.js', 'magia-image-pipeline.js']) {
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
  if (attempts === 1) throw perspectiveError;
  return { path: { text: '', words: [], points: [] } };
}));
assert.equal(attempts, 2, 'an OCR exception must be retried once');
assert.match(failed.spell.error, /getPerspectiveTransform/, 'the OCR exception must be preserved');
assert.equal(failed.wordCount, 0, 'an OCR exception must not invent words');

const allocationError = vm.runInContext("new RangeError('Invalid typed array length: allocation failed')", context);
assert.equal(MagiaImagePipeline.isMemoryRelatedError(allocationError), true, 'large typed-array allocation failures must be recognized as memory-related');
const wasmAllocationError = vm.runInContext("new WebAssembly.RuntimeError('WebAssembly.Memory could not allocate memory')", context);
assert.equal(MagiaImagePipeline.isMemoryRelatedError(wasmAllocationError), true, 'WebAssembly memory allocation failures must be recognized as memory-related');
attempts = 0;
const memoryFailure = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  throw allocationError;
}));
assert.equal(attempts, 1, 'a memory-related OCR exception must not be retried');
assert.match(memoryFailure.spell.error, /allocation failed/, 'a memory-related OCR exception must be preserved');

console.log('PASS_IMAGE_PIPELINE_EMPTY_RESULT_AND_ERROR_RETRY');
