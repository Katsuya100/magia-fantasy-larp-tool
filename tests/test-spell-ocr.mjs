import { readFile } from 'node:fs/promises';
import * as nodeOrt from 'onnxruntime-node';
import models from '@gutenye/ocr-models/node';
import '@gutenye/ocr-node';
import { Detection } from '../node_modules/@gutenye/ocr-common/build/models/Detection.js';
import sharp from 'sharp';

await import('../assets/js/spell-ocr.js');
await import('../assets/js/image-analysis-core.js');
const core = globalThis.SpellOcrCore;
const imageCore = globalThis.ImageAnalysisCore;
const jsonMode = process.argv.includes('--json');
const webWasm = process.argv.includes('--web-wasm');
const baseline = process.argv.includes('--baseline');
const input = process.argv.slice(2).find(argument => !['--json', '--web-wasm', '--native-ocr', '--baseline'].includes(argument));
if (!input) {
  console.error('Usage: npm run test:spell-ocr -- [--web-wasm|--native-ocr] [--baseline] <image-path>');
  process.exit(2);
}

let runtime = nodeOrt;
let activeModels = models;
if (webWasm) {
  runtime = await import('onnxruntime-web');
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = true;
  runtime.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
  activeModels = {
    ...models,
    detectionPath: new Uint8Array(await readFile(models.detectionPath)),
    recognitionPath: new Uint8Array(await readFile(models.recognitionPath)),
  };
}
const { registerBackend } = await import('@gutenye/ocr-common');
const { FileUtils } = await import('../node_modules/@gutenye/ocr-node/build/FileUtils.js');
const { ImageRaw } = await import('../node_modules/@gutenye/ocr-node/build/ImageRaw.js');
const { splitIntoLineImages } = await import('@gutenye/ocr-common/splitIntoLineImages');
class SharedImageRaw extends ImageRaw {
  static async open(path) {
    const result = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return new SharedImageRaw({ data: result.data, width: result.info.width, height: result.info.height });
  }
  async resize({ width, height }) {
    this.data = imageCore.resizeRgbaSharpContain(this.data, this.width, this.height, width, height);
    this.width = width;
    this.height = height;
    return this;
  }
}
registerBackend({ FileUtils, ImageRaw: SharedImageRaw, InferenceSession: runtime.InferenceSession, splitIntoLineImages, defaultModels: activeModels });
const detection = await Detection.create({ models: activeModels });
const recognitionSession = await runtime.InferenceSession.create(activeModels.recognitionPath);
const sourceImage = baseline ? null : await SharedImageRaw.open(input);
const dictionary = [...(await readFile(models.dictionaryPath, 'utf8')).split(/\r?\n/), ' '];
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
    const detected = await detection.run(input);
    const lineImages = detected.lineImages || [];
    const ringLines = baseline || lineImages.length > 8 ? [] : core.unwrapRingSectors(sourceImage);
    return { ...detected, lineImages: [...lineImages, ...ringLines] };
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
});
const { rawCandidates, candidates, path, ringRescues } = pipeline;
const rawWords = new Set(candidates.map(candidate => candidate.text));
const outputWords = core.words(path.text);
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
const assertion = path.text && !inventedLetters.length && literalPreservation ? 'PASS_NO_INVENTION' : 'FAIL';

if (jsonMode) {
  console.log(JSON.stringify({
    text: path.text,
    words: path.words,
    points: path.points,
    lines: (pipeline.lineImages || []).map((line, index) => ({ index, box: line.box, width: line.image?.width, height: line.image?.height })),
    rawCandidates,
    candidates,
    assertion,
    ringRescues,
    resegmentedWords,
    inventedLetters,
    literalPreservation,
  }, null, 2));
} else if (assertion === 'PASS_NO_INVENTION') {
    console.log(path.text);
    console.log(assertion);
} else {
  console.error(JSON.stringify({ rawCandidates, candidates, sequence: path.words, text: path.text, inventedWords, literalPreservation, assertion }, null, 2));
  console.log(assertion);
  process.exit(1);
}
