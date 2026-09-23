import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run test:image-outputs -- <image-path>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const imagePath = resolve(input);
const originalProcessRelease = Object.getOwnPropertyDescriptor(process, 'release');
let transformers;
Object.defineProperty(process, 'release', { ...originalProcessRelease, value: { ...originalProcessRelease.value, name: 'browser' } });
try {
  transformers = await import(pathToFileURL(resolve(here, '../node_modules/@huggingface/transformers/dist/transformers.web.js')));
} finally {
  Object.defineProperty(process, 'release', originalProcessRelease);
}
const { env, pipeline } = transformers;
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.wasm.wasmPaths = pathToFileURL(`${resolve(here, '../node_modules/onnxruntime-web/dist')}/`).href;
const image = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let rgba = image.data;
let width = image.info.width;
let height = image.info.height;
const maxSide = 1400;
const analysisScale = Math.min(1, maxSide / Math.max(width, height));
if (analysisScale < 1) {
  const resized = await sharp(image.data, { raw: { width, height, channels: 4 } })
    .resize(Math.max(1, Math.round(width * analysisScale)), Math.max(1, Math.round(height * analysisScale)), { kernel: 'linear' })
    .raw().toBuffer({ resolveWithObject: true });
  rgba = resized.data;
  width = resized.info.width;
  height = resized.info.height;
}

const imageCoreSource = await readFile(resolve(here, '../image-analysis-core.js'), 'utf8');
const imageContext = vm.createContext({});
vm.runInContext(imageCoreSource, imageContext, { filename: 'image-analysis-core.js' });
const imageCore = imageContext.ImageAnalysisCore;
const geometry = imageCore.detectClosedPathsJs(rgba, width, height);
const metrics = imageCore.analyzeSigilMetricsJs(rgba, width, height, geometry);
const scalePath = path => path && ({
  ...path,
  x: path.x / analysisScale,
  y: path.y / analysisScale,
  r: path.r / analysisScale,
  radii: path.radii?.map(radius => radius / analysisScale),
});
const paths = {
  outer: scalePath(geometry.outer),
  inner: scalePath(geometry.inner),
  circleAccuracy: geometry.circleAccuracy,
};

const ocr = spawnSync(process.execPath, [resolve(here, 'test-spell-ocr.mjs'), '--json', imagePath], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (ocr.status !== 0) throw new Error(ocr.stderr || `OCR batch failed with exit code ${ocr.status}`);
const spell = JSON.parse(ocr.stdout);

const scoringSource = await readFile(resolve(here, '../attribute-scoring.js'), 'utf8');
const scoringContext = vm.createContext({});
vm.runInContext(scoringSource, scoringContext, { filename: 'attribute-scoring.js' });
const { attributes, normalizeSimilarities } = scoringContext.AttributeScoringCore;
const keys = Object.keys(attributes);
const descriptions = keys.flatMap(key => attributes[key].descriptions);
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
const embedded = await extractor(
  [`query: ${spell.text}`, ...descriptions.map(description => `passage: ${description}`)],
  { pooling: 'mean', normalize: true },
);
const [query, ...vectors] = embedded.tolist();
const cosine = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
const similarities = keys.map((key, keyIndex) => {
  const candidates = vectors.slice(keyIndex * 3, keyIndex * 3 + 3).map(vector => cosine(query, vector)).sort((a, b) => b - a);
  return [key, candidates.slice(0, 2).reduce((sum, value) => sum + value, 0) / Math.min(2, candidates.length)];
});
const attributeRates = normalizeSimilarities(similarities).sort((a, b) => b[1] - a[1]);

const shapeNames = { attack: '攻撃', defense: '防御', support: '回復', debuff: '弱体' };
const shapeIcons = { attack: '⚔️', defense: '🛡️', support: '✚', debuff: '🕸️' };
const shapeWeights = Object.entries(metrics.scores).map(([key, score]) => [key, Math.max(0, score)]);
const shapeTotal = shapeWeights.reduce((sum, [, score]) => sum + score, 0);
const shapeRates = shapeWeights.map(([key, score]) => [key, score / (shapeTotal || 1)])
  .sort((a, b) => b[1] - a[1]);
const topShape = shapeRates[0];
const inkCoverage = imageCore.scoreInkCoverage(image.data, image.info.width, image.info.height, paths);
const textCoverage = imageCore.scorePointsOnRing(paths, spell.points, image.info.width, image.info.height);
const ringCoverage = spell.points.length ? (inkCoverage + textCoverage) / 2 : inkCoverage;

const powerSource = await readFile(resolve(here, '../power-calculation.js'), 'utf8');
const powerContext = vm.createContext({});
vm.runInContext(powerSource, powerContext, { filename: 'power-calculation.js' });
const power = powerContext.PowerCalculationCore.calculatePower({
  circleAccuracy: paths.circleAccuracy,
  lineStraightness: metrics.lineStraightness,
  ringCoverage,
  attributeCertainty: attributeRates[0]?.[1] || 0,
  sigilCertainty: topShape?.[1] || 0,
  words: spell.words,
});
const powerLabels = {
  circleAccuracy: '円の共鳴率',
  lineStraightness: '線の共鳴率',
  ringCoverage: '環と呪文の共鳴率',
  attributeCertainty: '相の共鳴率',
  sigilCertainty: '紋の共鳴率',
};

const output = {
  input: imagePath,
  image: { width: image.info.width, height: image.info.height },
  spell: { text: spell.text, words: spell.words, points: spell.points },
  process: {
    structure: '写し絵の読み取りが完了しました。',
    spell: '読み取り結果から相を選び、結果を表示しました。',
  },
  circle: {
    outer: { x: paths.outer?.x, y: paths.outer?.y, radius: paths.outer?.r, coverage: paths.outer?.coverage },
    inner: { x: paths.inner?.x, y: paths.inner?.y, radius: paths.inner?.r, coverage: paths.inner?.coverage },
    circleAccuracy: paths.circleAccuracy,
    lineStraightness: metrics.lineStraightness,
  },
  attribute: {
    top: attributeRates[0]?.[0] || null,
    summary: attributeRates[0] ? {
      icon: attributes[attributeRates[0][0]].icon,
      label: attributes[attributeRates[0][0]].label,
    } : null,
    detailTitle: attributeRates[0] ? attributes[attributeRates[0][0]].label : null,
    rows: attributeRates.map(([key, , percentage]) => ({
      key,
      icon: attributes[key].icon,
      label: attributes[key].label,
      percentage,
    })),
    percentages: Object.fromEntries(attributeRates.map(([key, , percentage]) => [key, percentage])),
    similarities: Object.fromEntries(similarities),
  },
  sigil: {
    top: topShape?.[0] || null,
    label: shapeNames[topShape?.[0]] || null,
    summary: topShape ? {
      icon: shapeIcons[topShape[0]],
      label: shapeNames[topShape[0]],
      altarLabel: shapeNames[topShape[0]].replace('の紋', ''),
    } : null,
    rows: shapeRates.map(([key, rate]) => ({
      key,
      icon: shapeIcons[key],
      label: shapeNames[key],
      percentage: Math.round(rate * 100),
    })),
    percentages: Object.fromEntries(shapeRates.map(([key, rate]) => [key, Math.round(rate * 100)])),
    scores: metrics.scores,
  },
  power: {
    total: power.power,
    qualityAverage: power.qualityAverage,
    wordCount: power.normalized.wordCount,
    components: Object.fromEntries(Object.entries(power.scores).map(([key, value]) => [key, {
      label: powerLabels[key],
      score: value,
      barPercent: Math.round(value * 100),
      resonancePercent: Math.round(power.normalized[key] * 100),
    }])),
  },
};

const totals = [
  Object.values(output.attribute.percentages).reduce((sum, value) => sum + value, 0),
  Object.values(output.sigil.percentages).reduce((sum, value) => sum + value, 0),
];
if (Math.abs(totals[0] - 100) > 1e-9 || Math.abs(totals[1] - 100) > 1e-9 || !Number.isFinite(output.power.total)) {
  throw new Error(`Output validation failed: ${JSON.stringify({ totals, power: output.power.total })}`);
}
console.log(JSON.stringify(output, null, 2));
