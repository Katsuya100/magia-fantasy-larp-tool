import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import models from '@gutenye/ocr-models/node';
import sharp from 'sharp';
import * as runtime from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1];
};
const positionalImage = args.find(argument => !argument.startsWith('--') && argument !== valueAfter('--iterations') &&
  argument !== valueAfter('--mode') && argument !== valueAfter('--graph-optimization-level'));
const imagePath = resolve(valueAfter('--image', positionalImage || ''));
const iterations = Number(valueAfter('--iterations', '10'));
const requestedMode = valueAfter('--mode', 'both');
const graphOptimizationLevel = valueAfter('--graph-optimization-level', 'all');
const supportedGraphOptimizationLevels = new Set(['disabled', 'basic', 'extended', 'all']);
if (!imagePath || !Number.isInteger(iterations) || iterations < 1 || !['recreate', 'reuse', 'both'].includes(requestedMode) ||
  !supportedGraphOptimizationLevels.has(graphOptimizationLevel) || !valueAfter('--image', positionalImage)) {
  console.error('Usage: npm run test:detection-stress -- --image <path> [--iterations 10] [--mode recreate|reuse|both] [--graph-optimization-level disabled|basic|extended|all]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
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
const imageStarted = performance.now();
const decoded = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const dimensions = imagePipeline.fitInputDimensions(decoded.info.width, decoded.info.height);
const imageData = dimensions.scale < 1
  ? Buffer.from(imageCore.resizeRgbaLinear(decoded.data, decoded.info.width, decoded.info.height, dimensions.width, dimensions.height))
  : decoded.data;
const imageLoadMs = performance.now() - imageStarted;
const detectionWidth = Math.max(32, Math.ceil(dimensions.width / 32) * 32);
const detectionHeight = Math.max(32, Math.ceil(dimensions.height / 32) * 32);
const detectionTensorShape = [1, 3, detectionHeight, detectionWidth];
const detectionTensorBytes = detectionWidth * detectionHeight * 3 * Float32Array.BYTES_PER_ELEMENT;
const modelBytes = new Uint8Array(await readFile(models.detectionPath));

runtime.env.wasm.numThreads = 1;
runtime.env.wasm.proxy = false;
runtime.env.wasm.wasmPaths = pathToFileURL(`${resolve(here, '../node_modules/onnxruntime-web/dist')}/`).href;
const sessionOptions = {
  executionMode: 'sequential',
  enableCpuMemArena: false,
  enableMemPattern: false,
  graphOptimizationLevel: graphOptimizationLevel,
};

function createInputTensor() {
  const values = imageCore.resizeRgbaSharpContainToPlanarFloat32(
    imageData, dimensions.width, dimensions.height, detectionWidth, detectionHeight,
  );
  return new runtime.Tensor('float32', values, detectionTensorShape);
}

async function runMode(mode) {
  const records = [];
  let sharedSession = null;
  let sharedSessionCreateMs = 0;
  let releaseError = null;
  let sessionReleaseMs = 0;

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    let session = mode === 'reuse' ? sharedSession : null;
    let sessionCreateMs = 0;
    let inputPreparationMs = 0;
    let runMs = null;
    let cleanupMs = 0;
    let outputShape = null;
    let outputs = null;
    let inputTensor = null;
    let success = false;
    let error = null;

    try {
      if (!session) {
        const started = performance.now();
        session = await runtime.InferenceSession.create(modelBytes.slice(), sessionOptions);
        sessionCreateMs = performance.now() - started;
        if (mode === 'reuse') {
          sharedSession = session;
          sharedSessionCreateMs = sessionCreateMs;
        }
      }
      const inputStarted = performance.now();
      inputTensor = createInputTensor();
      inputPreparationMs = performance.now() - inputStarted;
      const runStarted = performance.now();
      outputs = await session.run({ [session.inputNames[0]]: inputTensor });
      runMs = performance.now() - runStarted;
      outputShape = outputs[session.outputNames[0]]?.dims ? [...outputs[session.outputNames[0]].dims] : null;
      success = true;
    } catch (caught) {
      error = { name: caught?.name || 'Error', message: String(caught?.message || caught) };
    } finally {
      const cleanupStarted = performance.now();
      for (const output of new Set(Object.values(outputs || {}))) {
        try { output?.dispose?.(); }
        catch (caught) { error ||= { name: caught?.name || 'Error', message: String(caught?.message || caught) }; success = false; }
      }
      try { inputTensor?.dispose?.(); }
      catch (caught) { error ||= { name: caught?.name || 'Error', message: String(caught?.message || caught) }; success = false; }
      outputs = null;
      inputTensor = null;
      if (mode === 'recreate' && session) {
        try { await session.release(); }
        catch (caught) { error ||= { name: caught?.name || 'Error', message: String(caught?.message || caught) }; success = false; }
        session = null;
      }
      cleanupMs = performance.now() - cleanupStarted;
    }

    records.push({ iteration, sessionCreateMs, inputPreparationMs, runMs, cleanupMs, success, outputShape, ...(error ? { error } : {}) });
  }

  if (mode === 'reuse' && sharedSession) {
    const started = performance.now();
    try { await sharedSession.release(); }
    catch (caught) { releaseError = { name: caught?.name || 'Error', message: String(caught?.message || caught) }; }
    sessionReleaseMs = performance.now() - started;
    sharedSession = null;
  }

  const successful = records.filter(record => record.success);
  const average = field => {
    const values = records.map(record => record[field]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return {
    mode,
    iterationCount: records.length,
    successCount: successful.length,
    failureCount: records.length - successful.length,
    averageSessionCreateMs: average('sessionCreateMs'),
    averageInputPreparationMs: average('inputPreparationMs'),
    averageRunMs: average('runMs'),
    minRunMs: records.map(record => record.runMs).filter(Number.isFinite).length ? Math.min(...records.map(record => record.runMs).filter(Number.isFinite)) : null,
    maxRunMs: records.map(record => record.runMs).filter(Number.isFinite).length ? Math.max(...records.map(record => record.runMs).filter(Number.isFinite)) : null,
    averageCleanupMs: average('cleanupMs'),
    sessionReleaseMs,
    ...(releaseError ? { releaseError } : {}),
    records,
  };
}

const modes = requestedMode === 'both' ? ['recreate', 'reuse'] : [requestedMode];
const results = [];
for (const mode of modes) results.push(await runMode(mode));
const summary = {
  image: imagePath,
  imageLoadMs,
  inputImageShape: [dimensions.height, dimensions.width, 4],
  detectionTensorShape,
  detectionTensorBytes,
  detectionTensorMiB: detectionTensorBytes / 1024 / 1024,
  model: models.detectionPath,
  onnxRuntime: {
    version: core.config.onnxRuntimeWebVersion,
    executionProvider: 'wasm',
    graphOptimizationLevel,
    executionMode: sessionOptions.executionMode,
    numThreads: runtime.env.wasm.numThreads,
    enableCpuMemArena: sessionOptions.enableCpuMemArena,
    enableMemPattern: sessionOptions.enableMemPattern,
  },
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (results.some(result => result.failureCount > 0 || result.releaseError)) process.exitCode = 1;
