import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const args = process.argv.slice(2);
const renderPaths = args.includes('--render-paths');
const pathsOnly = args.includes('--paths-only');
const webWasm = args.includes('--web-wasm');
const input = args.find(argument => !['--render-paths', '--paths-only', '--web-wasm', '--native-ocr'].includes(argument));
if (!input) {
  console.error('Usage: npm run test:image-outputs -- [--render-paths|--paths-only|--web-wasm|--native-ocr] <image-path>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const imagePath = resolve(input);
await import('../assets/js/spell-ocr.js');
await import('../assets/js/image-analysis-core.js');
await import('../assets/js/power-calculation.js');
await import('../assets/js/attribute-scoring.js');
await import('../assets/js/magia-image-pipeline.js');
const imageCore = globalThis.ImageAnalysisCore;
const imagePipeline = globalThis.MagiaImagePipeline;

let sourceImage = null;
let naturalWidth = 0;
let naturalHeight = 0;
async function loadMasterImage() {
  if (sourceImage) return sourceImage;
  const decoded = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  naturalWidth = decoded.info.width;
  naturalHeight = decoded.info.height;
  const dimensions = imagePipeline.fitInputDimensions(naturalWidth, naturalHeight);
  const data = dimensions.scale < 1
    ? Buffer.from(imageCore.resizeRgbaLinear(decoded.data, naturalWidth, naturalHeight, dimensions.width, dimensions.height))
    : decoded.data;
  sourceImage = { data, width: dimensions.width, height: dimensions.height };
  return sourceImage;
}

function createStructureInput() {
  return loadMasterImage().then(master => imagePipeline.createAnalysisInput({
    width: master.width,
    height: master.height,
    read: () => master.data,
    resize: (width, height) => imageCore.resizeRgbaLinear(master.data, master.width, master.height, width, height),
  }));
}

let pathOverlay = null;
if (pathsOnly) {
  const master = await loadMasterImage();
  const analysis = await createStructureInput();
  const structure = imagePipeline.restoreStructureScale(
    imagePipeline.analyzeStructure(analysis.image, analysis.width, analysis.height),
    analysis.scale,
  );
  const paths = structure.paths;
  if (renderPaths) pathOverlay = await writePathOverlay(master, paths);
  console.log(JSON.stringify({
    input: imagePath,
    image: { width: master.width, height: master.height, naturalWidth, naturalHeight },
    pathOverlay,
    circle: {
      outer: { x: paths.outer?.x, y: paths.outer?.y, radius: paths.outer?.r, coverage: paths.outer?.coverage, circleAccuracy: paths.outer?.circleAccuracy },
      inner: { x: paths.inner?.x, y: paths.inner?.y, radius: paths.inner?.r, coverage: paths.inner?.coverage, circleAccuracy: paths.inner?.circleAccuracy },
      circleAccuracy: paths.circleAccuracy,
    },
  }, null, 2));
  process.exit(0);
}

// Keep OCR and structure analysis sequential so detector, recognizer, and structure buffers do not overlap.
let spell = null;
let master = null;
let analysis = null;

let transformerPipelinePromise;
let attributeModel = null;
async function loadAttributeModel() {
  if (attributeModel) return attributeModel;
  if (!transformerPipelinePromise) {
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
    transformerPipelinePromise = pipeline('feature-extraction', imagePipeline.ATTRIBUTE_MODEL_ID, { dtype: 'q8' });
  }
  attributeModel = await transformerPipelinePromise;
  return attributeModel;
}

const result = await imagePipeline.run({
  recognizeSpell: async () => {
    const ocr = spawnSync(process.execPath, [...process.execArgv, resolve(here, 'test-spell-ocr.mjs'), '--json', ...(webWasm ? ['--web-wasm'] : []), imagePath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    if (ocr.status !== 0) throw new Error(ocr.stderr || `OCR batch failed with exit code ${ocr.status}`);
    spell = JSON.parse(ocr.stdout);
    return { path: { text: spell.text, words: spell.words, points: spell.points }, ...spell };
  },
  getStructureInput: async () => {
    master = await loadMasterImage();
    analysis = await createStructureInput();
    return { analysis };
  },
  analyzeStructure: input => imagePipeline.analyzeStructure(input.image, input.width, input.height),
  getMasterImage: async () => master,
  embedAttributes: async text => {
    const model = await loadAttributeModel();
    return model(imagePipeline.attributeInputTexts(text), { pooling: 'mean', normalize: true });
  },
  releaseAttributeModel: async () => {
    const model = attributeModel;
    attributeModel = null;
    transformerPipelinePromise = null;
    if (model?.dispose) await model.dispose();
  },
  onRecognitionRetry: ({ error }) => {
    if (error) console.warn('OCR first pass failed; retrying with the same image dimensions.', error);
  },
});
const paths = result.structure.paths;
if (renderPaths) pathOverlay = await writePathOverlay(master, paths);
const imageWidth = master.width;
const imageHeight = master.height;
sourceImage = null;
master = null;
analysis = null;
const structureError = result.structure.error;
const metrics = { scores: result.sigil.scores, lineStraightness: result.structure.lineStraightness };
const ocrOutput = spell || {};
const shapeNames = { attack: '攻撃', defense: '防御', support: '回復', debuff: '弱体' };
const shapeIcons = { attack: '⚔️', defense: '🛡️', support: '✚', debuff: '🕸️' };
const powerLabels = {
  circleAccuracy: '円の共鳴率',
  lineStraightness: '線の共鳴率',
  ringCoverage: '環と呪文の共鳴率',
  attributeCertainty: '相の共鳴率',
  sigilCertainty: '紋の共鳴率',
};
const attributeRates = result.attribute.rates;
const shapeRates = result.sigil.rates;
const shapePercentages = new Map(Object.entries(result.sigil.percentages));
const power = result.power;
const output = {
  input: imagePath,
  image: { width: imageWidth, height: imageHeight, naturalWidth, naturalHeight },
  ...(pathOverlay ? { pathOverlay } : {}),
  spell: {
    rawText: ocrOutput.rawText || result.spell.path.text,
    text: result.spell.path.text,
    words: result.spell.path.words,
    corrections: ocrOutput.corrections || [],
    vocabularySize: ocrOutput.vocabularySize ?? null,
    forbiddenWordCount: ocrOutput.forbiddenWordCount ?? null,
    points: result.spell.path.points,
    lines: ocrOutput.lines || [],
    rawCandidates: ocrOutput.rawCandidates || [],
    candidates: ocrOutput.candidates || [],
    ...(result.spell.error ? { error: result.spell.error } : {}),
  },
  process: {
    structure: structureError ? '陣の一部を読み取れず、威力に反映しました。呪文の読み取りを続けます。' : '写し絵の読み取りが完了しました。',
    spell: result.spell.error ? 'OCRに2回失敗しました。解像度を変えず、読めた情報から結果を計算しました。' : '読み取り結果から相を選び、結果を表示しました。',
  },
  circle: {
    ...(structureError ? { error: structureError } : {}),
    outer: { x: paths.outer?.x, y: paths.outer?.y, radius: paths.outer?.r, radii: paths.outer?.radii, coverage: paths.outer?.coverage, circleAccuracy: paths.outer?.circleAccuracy },
    inner: { x: paths.inner?.x, y: paths.inner?.y, radius: paths.inner?.r, radii: paths.inner?.radii, coverage: paths.inner?.coverage, circleAccuracy: paths.inner?.circleAccuracy },
    circleAccuracy: paths.circleAccuracy,
    lineStraightness: metrics.lineStraightness,
  },
  attribute: {
    top: result.attribute.top,
    summary: result.attribute.top ? {
      icon: globalThis.AttributeScoringCore.attributes[result.attribute.top].icon,
      label: globalThis.AttributeScoringCore.attributes[result.attribute.top].label,
    } : null,
    detailTitle: result.attribute.top ? globalThis.AttributeScoringCore.attributes[result.attribute.top].label : null,
    rows: attributeRates.map(([key, , percentage]) => ({
      key,
      icon: globalThis.AttributeScoringCore.attributes[key].icon,
      label: globalThis.AttributeScoringCore.attributes[key].label,
      percentage,
    })),
    percentages: Object.fromEntries(attributeRates.map(([key, , percentage]) => [key, percentage])),
    similarities: result.attribute.similarities,
    ...(result.attribute.error ? { error: result.attribute.error } : {}),
  },
  sigil: {
    top: result.sigil.top,
    label: shapeNames[result.sigil.top] || null,
    summary: result.sigil.top ? {
      icon: shapeIcons[result.sigil.top],
      label: shapeNames[result.sigil.top],
      altarLabel: shapeNames[result.sigil.top].replace('の紋', ''),
    } : null,
    rows: shapeRates.map(([key]) => ({
      key,
      icon: shapeIcons[key],
      label: shapeNames[key],
      percentage: shapePercentages.get(key),
    })),
    percentages: Object.fromEntries(shapeRates.map(([key]) => [key, shapePercentages.get(key)])),
    scores: metrics.scores,
  },
  power: {
    total: power.power,
    qualityAverage: power.qualityAverage,
    wordCount: power.normalized.wordCount,
    normalized: power.normalized,
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

async function writePathOverlay(image, paths) {
  const outputDirectory = resolve(tmpdir(), 'magia-path-overlays');
  await mkdir(outputDirectory, { recursive: true });
  const polyline = (path, color) => {
    if (!path) return '';
    const points = path.radii.map((radius, index) => {
      const theta = index / path.radii.length * Math.PI * 2;
      return `${(path.x + Math.cos(theta) * radius).toFixed(2)},${(path.y + Math.sin(theta) * radius).toFixed(2)}`;
    });
    return `<polyline points="${points.concat(points[0]).join(' ')}" fill="none" stroke="${color}" stroke-width="${Math.max(2, image.width / 420)}" stroke-dasharray="10 7" stroke-linejoin="miter" stroke-linecap="butt"/>`;
  };
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}">${polyline(paths.outer, '#1677ff')}${polyline(paths.inner, '#ff2e87')}</svg>`);
  const overlay = resolve(outputDirectory, `${basename(imagePath).replace(/\.[^.]+$/, '')}-paths.png`);
  await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .composite([{ input: svg }])
    .png()
    .toFile(overlay);
  return overlay;
}
