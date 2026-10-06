import { readFile } from 'node:fs/promises';
import * as nodeOrt from 'onnxruntime-node';
import models from '@gutenye/ocr-models/node';
import '@gutenye/ocr-node';
import { Detection } from '../node_modules/@gutenye/ocr-common/build/models/Detection.js';
import sharp from 'sharp';
import { loadOcrVocabularyIndex } from '../scripts/load-ocr-vocabulary-index.mjs';

await import('../assets/js/runtime-dependencies.js');
await import('../assets/js/spell-ocr.js');
await import('../assets/js/image-analysis-core.js');
await import('../assets/js/power-calculation.js');
await import('../assets/js/attribute-scoring.js');
await import('../assets/js/ocr-error-policy.js');
await import('../assets/js/magia-image-pipeline.js');
const core = globalThis.SpellOcrCore;
const imageCore = globalThis.ImageAnalysisCore;
const imagePipeline = globalThis.MagiaImagePipeline;
const jsonMode = process.argv.includes('--json');
const webWasm = process.argv.includes('--web-wasm');
const baseline = process.argv.includes('--baseline');
const graphOptimizationLevelIndex = process.argv.indexOf('--graph-optimization-level');
const graphOptimizationLevel = graphOptimizationLevelIndex >= 0 ? process.argv[graphOptimizationLevelIndex + 1] : null;
const webOrtModuleIndex = process.argv.indexOf('--web-ort-module');
const webOrtModuleSpecifier = webOrtModuleIndex >= 0 ? process.argv[webOrtModuleIndex + 1] : null;
const supportedGraphOptimizationLevels = new Set(['disabled', 'basic', 'extended', 'all']);
if (graphOptimizationLevel && !supportedGraphOptimizationLevels.has(graphOptimizationLevel)) {
  throw new Error(`Unsupported graph optimization level: ${graphOptimizationLevel}`);
}
const input = process.argv.slice(2).find(argument => ![
  '--json', '--web-wasm', '--native-ocr', '--baseline', '--graph-optimization-level', graphOptimizationLevel,
  '--web-ort-module', webOrtModuleSpecifier,
].includes(argument));
if (!input) {
  console.error('Usage: npm run test:spell-ocr -- [--web-wasm|--native-ocr] [--web-ort-module <module-specifier>] [--graph-optimization-level disabled|basic|extended|all] [--baseline] <image-path>');
  process.exit(2);
}

let runtime = nodeOrt;
let activeModels = models;
if (webWasm) {
  const runtimeModule = webOrtModuleSpecifier || '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
  runtime = await import(runtimeModule);
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = true;
  runtime.env.wasm.wasmPaths = new URL('./', import.meta.resolve(runtimeModule)).href;
  activeModels = {
    ...models,
    detectionPath: new Uint8Array(await readFile(models.detectionPath)),
    recognitionPath: new Uint8Array(await readFile(models.recognitionPath)),
  };
}
const ocrSessionOptions = webWasm ? {
  executionMode: 'sequential',
  enableCpuMemArena: false,
  enableMemPattern: false,
  ...(graphOptimizationLevel ? { graphOptimizationLevel } : {}),
} : {};
const { registerBackend } = await import('@gutenye/ocr-common');
const { FileUtils } = await import('../node_modules/@gutenye/ocr-node/build/FileUtils.js');
const { ImageRaw } = await import('../node_modules/@gutenye/ocr-node/build/ImageRaw.js');
const { splitIntoLineImages } = await import('@gutenye/ocr-common/splitIntoLineImages');
class SharedImageRaw extends ImageRaw {
  static async open(path) {
    const result = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const dimensions = imagePipeline.fitInputDimensions(result.info.width, result.info.height);
    if (dimensions.scale === 1) return new SharedImageRaw({ data: result.data, width: dimensions.width, height: dimensions.height });
    const data = imageCore.resizeRgbaLinear(result.data, result.info.width, result.info.height, dimensions.width, dimensions.height);
    return new SharedImageRaw({ data: Buffer.from(data), width: dimensions.width, height: dimensions.height });
  }
  async resize({ width, height }) {
    this.data = imageCore.resizeRgbaSharpContain(this.data, this.width, this.height, width, height);
    this.width = width;
    this.height = height;
    return this;
  }
}
registerBackend({ FileUtils, ImageRaw: SharedImageRaw, InferenceSession: runtime.InferenceSession, splitIntoLineImages, defaultModels: activeModels });
const detectionSessionStarted = performance.now();
const detectionSession = await runtime.InferenceSession.create(activeModels.detectionPath, ocrSessionOptions);
const detectionSessionCreateMs = performance.now() - detectionSessionStarted;
let detectionSessionRunMs = null;
const measuredDetectionSession = new Proxy(detectionSession, {
  get(target, property) {
    if (property === 'run') {
      return async (...runArgs) => {
        const started = performance.now();
        try { return await target.run(...runArgs); }
        finally { detectionSessionRunMs = performance.now() - started; }
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const detection = new Detection({ model: measuredDetectionSession, options: {} });
const recognitionSession = await runtime.InferenceSession.create(activeModels.recognitionPath, ocrSessionOptions);
const sourceImage = baseline ? null : await SharedImageRaw.open(input);
const sourceMetadata = sourceImage ? null : await sharp(input).metadata();
const sourceDimensions = imagePipeline.fitInputDimensions(sourceImage?.width ?? sourceMetadata.width, sourceImage?.height ?? sourceMetadata.height);
const detectionTensorShape = [
  1,
  3,
  Math.max(32, Math.ceil(sourceDimensions.height / 32) * 32),
  Math.max(32, Math.ceil(sourceDimensions.width / 32) * 32),
];
let detectionMs = null;
const dictionary = [...(await readFile(models.dictionaryPath, 'utf8')).split(/\r?\n/), ' '];
const vocabularyIndex = await loadOcrVocabularyIndex();
const vocabularyCorrector = core.createVocabularyCorrector(vocabularyIndex);
if (!vocabularyCorrector.size) throw new Error('Common vocabulary dictionary is empty.');
const fixtureIndex = core.createVocabularyNgramIndex('\uFEFFhello\nworld\ncat\nbat\na\ni\niv\nbar\nthunder\nthumber\nblast\nflashest', 'bat\nfoo bar');
const fixtureCorrector = core.createVocabularyCorrector(fixtureIndex);
const fixtureWords = fixtureCorrector.correctWords(['hellp', 'world', 'bat', 'bar', 'thumder', 'flast']).words;
if (fixtureWords[0] !== 'hello' || fixtureWords[1] !== 'world' || !fixtureCorrector.hasWord(fixtureWords[2]) ||
  fixtureWords[2] === 'bat' || fixtureWords[3] !== 'bar' || fixtureWords[4] !== 'thunder' || fixtureWords[5] !== 'blast' ||
  fixtureCorrector.hasWord('bat') || fixtureCorrector.hasWord('iv')) {
  throw new Error(`Vocabulary matcher smoke check failed: ${fixtureWords.join(', ')}`);
}
function rgbaData(raw) {
  if (raw.info.channels === 4) return raw.data;
  const channels = raw.info.channels;
  const pixels = raw.info.width * raw.info.height;
  const data = Buffer.alloc(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    const source = index * channels;
    const value = raw.data[source] ?? 255;
    const target = index * 4;
    data[target] = value;
    data[target + 1] = value;
    data[target + 2] = value;
    data[target + 3] = channels === 2 ? (raw.data[source + 1] ?? 255) : 255;
  }
  return data;
}

async function paddleRecognize(raw, inferPixelSpaces = false) {
  const width = Math.max(48, Math.min(960, Math.round(raw.info.width / Math.max(1, raw.info.height) * 48)));
  const resized = imageCore.resizeRgbaSharpLinear(rgbaData(raw), raw.info.width, raw.info.height, width, 48);
  const pixels = width * 48;
  const values = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    values[index] = resized[offset + 2] / 255;
    values[pixels + index] = resized[offset + 1] / 255;
    values[pixels * 2 + index] = resized[offset] / 255;
  }
  const outputs = await recognitionSession.run({
    [recognitionSession.inputNames[0]]: new runtime.Tensor('float32', values, [1, 3, 48, width]),
  });
  const output = outputs[recognitionSession.outputNames[0]];
  const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
  return inferPixelSpaces
    ? {
      text: decoded.text,
      spacingText: core.insertSpacesAtPixelGaps({ data: raw.data, width: raw.info.width, height: raw.info.height }, decoded),
    }
    : decoded.text;
}

async function combineLineImages(first, second, firstAngle, secondAngle) {
  return core.combineRgbaLines(first.image, second.image, firstAngle, secondAngle, imageCore.resizeRgbaSharpLinear);
}

const pipeline = await core.run({
  detect: async () => {
    const started = performance.now();
    let detected;
    try { detected = await detection.run(input); }
    finally { detectionMs = performance.now() - started; }
    const lineImages = detected.lineImages || [];
    const additionalLineImages = baseline || lineImages.length > 8
      ? null
      : () => core.iterateRingSectors(sourceImage);
    return { ...detected, lineImages, additionalLineImages };
  },
  recognizeVariants: async line => {
    const source = { data: line.image.data, width: line.image.width, height: line.image.height };
    return core.runRecognizeVariants({
      source,
      preprocess: (image, mode) => {
        return core.preprocessRgba(image, mode);
      },
      rotate: (image, angle) => core.rotateRgba(image, angle),
      recognize: async image => paddleRecognize({ data: image.data, info: { width: image.width, height: image.height, channels: 4 } }, String(line.groupId || '').startsWith('ring:')),
    });
  },
  combineLines: combineLineImages,
  vocabularyCorrector,
  releaseLinePixelsAfterRecognition: true,
});
const { rawCandidates, candidates, path, ringRescues } = pipeline;
const rawWords = new Set(candidates.map(candidate => candidate.text));
const rawText = pipeline.rawPathText || path.text;
const outputWords = core.words(rawText);
const resegmentedWords = outputWords.filter(word => !rawWords.has(word));
const recognizedLetterCounts = new Map();
for (const letter of rawCandidates.map(candidate => core.words(candidate.text).join('')).join('')) {
  recognizedLetterCounts.set(letter, (recognizedLetterCounts.get(letter) || 0) + 1);
}
const inventedLetters = [];
for (const letter of outputWords.join('')) {
  const remaining = recognizedLetterCounts.get(letter) || 0;
  if (!remaining) inventedLetters.push(letter);
  else recognizedLetterCounts.set(letter, remaining - 1);
}
const literalPreservation = core.normalize('breath') === 'Breath.' && core.normalize('be') === 'Be.';
const rawAssertion = rawText && !inventedLetters.length && literalPreservation ? 'PASS_NO_INVENTION' : 'FAIL';
const missingVocabularyWords = path.words.filter(word => !vocabularyCorrector.hasWord(word));
const assertion = path.text && !missingVocabularyWords.length && literalPreservation ? 'PASS_VOCABULARY_MATCH' : 'FAIL';

if (jsonMode) {
  console.log(JSON.stringify({
    rawText,
    text: path.text,
    words: path.words,
    corrections: pipeline.corrections,
    vocabularySize: vocabularyCorrector.size,
    forbiddenWordCount: vocabularyCorrector.forbiddenSize,
    missingVocabularyWords,
    points: path.points,
    lines: (pipeline.lineImages || []).map((line, index) => ({ index, box: line.box, width: line.image?.width, height: line.image?.height })),
    rawCandidates,
    candidates,
    assertion,
    rawAssertion,
    ringRescues,
    resegmentedWords,
    inventedLetters,
    literalPreservation,
    ...(webWasm ? {
      onnxRuntime: {
        version: runtime.env.versions?.web || core.config.onnxRuntimeWebVersion,
        executionProvider: 'wasm',
        graphOptimizationLevel: graphOptimizationLevel || 'all',
        executionMode: ocrSessionOptions.executionMode,
        numThreads: runtime.env.wasm.numThreads,
        enableCpuMemArena: ocrSessionOptions.enableCpuMemArena,
        enableMemPattern: ocrSessionOptions.enableMemPattern,
        detectionTensorShape,
        detectionSessionCreateMs,
        detectionSessionRunMs,
        detectionMs,
      },
    } : {}),
  }, null, 2));
} else if (assertion === 'PASS_VOCABULARY_MATCH') {
    console.log(`OCR: ${rawText}`);
    console.log(`語彙補正: ${path.text}`);
    console.log(`補正: ${pipeline.corrections.length}語 / ${vocabularyCorrector.size.toLocaleString('en-US')}語から照合`);
    console.log(rawAssertion);
    console.log(assertion);
} else {
  console.error(JSON.stringify({ rawCandidates, candidates, sequence: path.words, rawText, text: path.text, corrections: pipeline.corrections, missingVocabularyWords, inventedLetters, literalPreservation, rawAssertion, assertion }, null, 2));
  console.log(assertion);
  process.exit(1);
}

await Promise.all([detectionSession.release(), recognitionSession.release()]);
