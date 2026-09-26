import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
for (const name of ['spell-ocr.js', 'image-analysis-core.js', 'attribute-scoring.js', 'power-calculation.js', 'magia-image-pipeline.js']) {
  const source = await readFile(new URL(`../assets/js/${name}`, import.meta.url), 'utf8');
  vm.runInContext(source, context, { filename: name });
}

const { MagiaImagePipeline } = context;

function pipelineOptions(recognizeSpell, retries = []) {
  return {
    recognizeSpell,
    getStructureInput: async () => ({ analysis: { scale: 1 } }),
    analyzeStructure: async () => ({ paths: null, sigilScores: null, lineStraightness: 0 }),
    getMasterImage: async () => ({ data: new Uint8Array(4), width: 1, height: 1 }),
    embedAttributes: async () => { throw new Error('Skip model loading in this pipeline test.'); },
    releaseAttributeModel: async () => {},
    onRecognitionRetry: details => retries.push(details),
  };
}

let attempts = 0;
const recovered = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  return attempts === 1
    ? { path: { text: '', words: [], points: [] } }
    : { path: { text: 'fire', words: ['fire'], points: [] } };
}));
assert.equal(attempts, 2, 'an empty OCR result must be retried once');
assert.equal(recovered.spell.path.text, 'fire', 'the retry result must be used');
assert.equal(recovered.wordCount, 1, 'the recovered word must contribute to the final count');
assert.equal(recovered.spell.error, undefined, 'a successful retry must not keep the first empty-result error');

const perspectiveError = vm.runInContext("new TypeError('getPerspectiveTransform hasOwnProperty')", context);
attempts = 0;
const failed = await MagiaImagePipeline.run(pipelineOptions(async () => {
  attempts += 1;
  if (attempts === 1) throw perspectiveError;
  return { path: { text: '', words: [], points: [] } };
}));
assert.equal(attempts, 2, 'an OCR exception must be retried once');
assert.match(failed.spell.error, /getPerspectiveTransform/, 'a second empty result must preserve the first OCR error');
assert.equal(failed.wordCount, 0, 'a failed OCR retry must not invent words');

const emptyTwice = await MagiaImagePipeline.run(pipelineOptions(async () => ({ path: { text: '', words: [], points: [] } })));
assert.match(emptyTwice.spell.error, /no spell text after retry/, 'two empty results must be reported as a failed recognition');

console.log('PASS_IMAGE_PIPELINE_RETRY');
