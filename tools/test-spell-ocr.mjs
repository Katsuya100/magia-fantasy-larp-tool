import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-node';
import models from '@gutenye/ocr-models/node';
import '@gutenye/ocr-node';
import { Detection } from '../node_modules/@gutenye/ocr-common/build/models/Detection.js';
import sharp from 'sharp';

await import('../spell-ocr.js');
const core = globalThis.SpellOcrCore;
const jsonMode = process.argv.includes('--json');
const input = process.argv.slice(2).find(argument => argument !== '--json');
if (!input) {
  console.error('Usage: npm run test:spell-ocr -- <image-path>');
  process.exit(2);
}

const detection = await Detection.create({ models });
const recognitionSession = await ort.InferenceSession.create(models.recognitionPath);
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

async function paddleRecognize(raw) {
  const width = Math.max(48, Math.min(960, Math.round(raw.info.width / Math.max(1, raw.info.height) * 48)));
  const resized = await sharp(rgbaData(raw), { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } })
    .resize(width, 48, { kernel: 'linear' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = width * 48;
  const values = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    values[index] = resized.data[offset + 2] / 255;
    values[pixels + index] = resized.data[offset + 1] / 255;
    values[pixels * 2 + index] = resized.data[offset] / 255;
  }
  const outputs = await recognitionSession.run({
    [recognitionSession.inputNames[0]]: new ort.Tensor('float32', values, [1, 3, 48, width]),
  });
  const output = outputs[recognitionSession.outputNames[0]];
  return core.decodeGreedyCtc(output, dictionary);
}

const pipeline = await core.run({
  detect: () => detection.run(input),
  recognizeVariants: async line => {
    const source = { data: line.image.data, width: line.image.width, height: line.image.height };
    return core.runRecognizeVariants({
      source,
      preprocess: (image, mode) => {
        const base = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
        if (mode === 'contrast') return base.grayscale().linear(1.35, -44.8).ensureAlpha();
        if (mode === 'binary') return base.grayscale().threshold(160).ensureAlpha();
        return base.ensureAlpha();
      },
      rotate: (image, angle) => image.rotate(angle).ensureAlpha(),
      recognize: async image => paddleRecognize(await image.raw().toBuffer({ resolveWithObject: true })),
    });
  },
});
const { rawCandidates, candidates, path } = pipeline;
const rawWords = new Set(candidates.map(candidate => candidate.text));
const outputWords = core.words(path.text);
const inventedWords = outputWords.filter(word => !rawWords.has(word));
const literalPreservation = core.normalize('breath') === 'Breath.' && core.normalize('be') === 'Be.';
const assertion = path.text && !inventedWords.length && literalPreservation ? 'PASS_NO_INVENTION' : 'FAIL';

if (assertion === 'PASS_NO_INVENTION') {
  if (jsonMode) console.log(JSON.stringify({ text: path.text, words: path.words, points: path.points, rawCandidates, candidates }, null, 2));
  else {
    console.log(path.text);
    console.log(assertion);
  }
} else {
  console.error(JSON.stringify({ rawCandidates, sequence: path.words, text: path.text, inventedWords, literalPreservation, assertion }, null, 2));
  console.log(assertion);
  process.exit(1);
}
