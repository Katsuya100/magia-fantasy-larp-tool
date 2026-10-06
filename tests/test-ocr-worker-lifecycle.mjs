import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Execute the production classic Worker scripts, adapting browser I/O only.
// Each phase runs in a real, terminated isolate with the installed WASM models.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!isMainThread) {
  const models = (await import('@gutenye/ocr-models/node')).default;
  const nativeFetch = globalThis.fetch;
  globalThis.self = globalThis;
  globalThis.location = { href: pathToFileURL(workerData.script).href };
  globalThis.fetch = async (url, options) => {
    const value = String(url);
    const model = value.endsWith('ch_PP-OCRv4_det_infer.onnx') ? models.detectionPath
      : value.endsWith('ch_PP-OCRv4_rec_infer.onnx') ? models.recognitionPath
        : value.endsWith('ppocr_keys_v1.txt') ? models.dictionaryPath : null;
    if (!model) return nativeFetch(url, options);
    const bytes = await readFile(model);
    return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
  };
  globalThis.__importRuntime = async url => {
    if (url.includes('onnxruntime-web@')) {
      parentPort.postMessage({ type: 'harness-runtime', runtime: 'onnxruntime-web' });
      const packageInfo = JSON.parse(await readFile(resolve(root, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
      const runtimePath = new URL(url).pathname;
      const runtimePrefix = `/npm/onnxruntime-web@${packageInfo.version}/`;
      assert.ok(runtimePath.startsWith(runtimePrefix), 'Production and harness ONNX Runtime versions must match.');
      const entry = runtimePath.slice(runtimePrefix.length);
      // jsDelivr +esm uses the browser bundle (JSEP), whereas a bare Node import
      // resolves ort.node.min.mjs and silently exercises a different WASM build.
      const localEntry = entry === '+esm' ? 'ort.bundle.min.mjs'
        : entry === 'dist/ort.wasm.min.mjs' ? 'ort.wasm.min.mjs' : null;
      assert.ok(localEntry, `Unsupported production ONNX Runtime entry: ${entry}`);
      const runtime = await import(pathToFileURL(resolve(root, 'node_modules/onnxruntime-web/dist', localEntry)));
      const localWasm = pathToFileURL(`${resolve(root, 'node_modules/onnxruntime-web/dist')}/`).href;
      Object.defineProperty(runtime.env.wasm, 'wasmPaths', { configurable: true, get: () => localWasm, set() {} });
      return runtime;
    }
    if (url.includes('@techstark/opencv-js@')) {
      parentPort.postMessage({ type: 'harness-runtime', runtime: 'opencv' });
      return import('@techstark/opencv-js');
    }
    if (url.includes('js-clipper@')) return import('js-clipper');
    if (url.includes('@huggingface/transformers@')) {
      parentPort.postMessage({ type: 'harness-runtime', runtime: 'transformers-wasm' });
      const originalRelease = Object.getOwnPropertyDescriptor(process, 'release');
      let transformers;
      Object.defineProperty(process, 'release', { ...originalRelease, value: { ...originalRelease.value, name: 'browser' } });
      try { transformers = await import(pathToFileURL(resolve(root, 'node_modules/@huggingface/transformers/dist/transformers.web.js'))); }
      finally { Object.defineProperty(process, 'release', originalRelease); }
      const require = createRequire(resolve(root, 'node_modules/@huggingface/transformers/package.json'));
      const localWasm = pathToFileURL(dirname(require.resolve('onnxruntime-web')) + '/').href;
      // Adapt browser HTTPS asset loading to Node's file-only ESM loader.
      // Check the production path rather than silently accepting an arbitrary override.
      Object.defineProperty(transformers.env.backends.onnx.wasm, 'wasmPaths', {
        configurable: true,
        get: () => localWasm,
        set: value => assert.equal(value, globalThis.MagiaRuntimeDependencies.transformersWasmPath),
      });
      return transformers;
    }
    throw new Error(`Unexpected runtime import: ${url}`);
  };
  const execute = path => {
    const source = readFileSync(path, 'utf8').replace(/^import '([^']+)';/gm, (_, dependency) => {
      execute(resolve(dirname(path), dependency));
      return '';
    }).replace(/\bimport\(/g, '__importRuntime(');
    vm.runInThisContext(source, { filename: path });
  };
  globalThis.importScripts = (...urls) => urls.forEach(url => execute(url.startsWith('file:') ? fileURLToPath(url) : resolve(dirname(workerData.script), url)));
  parentPort.on('message', data => globalThis.onmessage?.({ data }));
  globalThis.addEventListener = (type, callback) => {
    if (type === 'message') parentPort.on('message', data => callback({ data }));
  };
  globalThis.postMessage = (message, transfer = []) => {
    parentPort.postMessage(message, transfer);
    assert.ok(transfer.every(buffer => buffer.byteLength === 0), 'Worker output transfer must detach its source buffers.');
  };
  execute(workerData.script);
  parentPort.postMessage({ type: 'harness-ready' });
} else {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const script = resolve(option('--worker', 'assets/js/magia-circle-ocr-worker.js'));
  const imagePath = resolve(option('--image', 'assets/images/sample.png'));
  const outputPath = resolve(option('--output', 'test-results/review/worker-results.json'));
  const iterations = Number(option('--iterations', '1'));
  assert.ok(Number.isInteger(iterations) && iterations > 0, 'iterations must be a positive integer.');
  const baselinePath = option('--baseline', null);
  const baseline = baselinePath ? JSON.parse(await readFile(resolve(baselinePath), 'utf8')).runs[0].result : null;
  const phases = args.includes('--legacy') ? [null] : ['detection', 'geometry', 'recognition'];
  const sharp = (await import('sharp')).default;
  await import('../assets/js/image-analysis-core.js');
  await import('../assets/js/runtime-dependencies.js');
  await import('../assets/js/spell-ocr.js');
  const metadata = await sharp(imagePath).metadata();
  const scale = Math.min(1, globalThis.SpellOcrCore.config.maxInputSide / Math.max(metadata.width, metadata.height));
  const width = Math.round(metadata.width * scale);
  const height = Math.round(metadata.height * scale);
  let activeWorkers = 0;
  let maximumActiveWorkers = 0;
  const runs = [];
  const executePhase = async (phase, payload, stages, lifecycle) => {
    const runtimes = [];
    const worker = new Worker(new URL(import.meta.url), { workerData: { script } });
    activeWorkers += 1;
    maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
    lifecycle.push({ phase, event: 'created', activeWorkers });
    const transfer = new Set();
    const collect = value => {
      if (value instanceof ArrayBuffer) transfer.add(value);
      else if (ArrayBuffer.isView(value)) transfer.add(value.buffer);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(payload);
    try {
      return await new Promise((resolveResult, reject) => {
        worker.on('error', reject);
        worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited with ${code}`)); });
        worker.on('message', message => {
          if (message.type === 'harness-ready') {
            worker.postMessage({ type: 'analyze', jobId: 1, runId: 'worker-regression', diagnostics: true, ...(phase ? { phase } : {}), ...payload }, [...transfer]);
            assert.ok([...transfer].every(buffer => buffer.byteLength === 0), 'All phase inputs must be transferred and detached.');
          } else if (message.type === 'diagnostic-stage') stages.push(message);
          else if (message.type === 'harness-runtime') runtimes.push(message.runtime);
          else if (message.type === 'success') {
            try {
              if (phase) assert.deepEqual([...new Set(runtimes)], phase === 'geometry' ? ['opencv'] : ['onnxruntime-web'], 'Each phase must load only its own heavy runtime.');
              resolveResult(message.result);
            } catch (error) { reject(error); }
          }
          else if (message.type === 'error') reject(new Error(message.message));
        });
      });
    } finally {
      await worker.terminate();
      activeWorkers -= 1;
      lifecycle.push({ phase, event: 'terminated', activeWorkers, runtimes });
    }
  };
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const decoded = await sharp(imagePath).ensureAlpha().raw().toBuffer();
    const pixels = scale < 1 ? globalThis.ImageAnalysisCore.resizeRgbaLinear(decoded, metadata.width, metadata.height, width, height) : new Uint8Array(decoded);
    let payload = { buffer: pixels.buffer, width, height };
    const stages = [];
    const lifecycle = [];
    const started = performance.now();
    for (const phase of phases) {
      const result = await executePhase(phase, payload, stages, lifecycle);
      payload = result;
    }
    const result = payload;
    if (baseline) assert.deepEqual(result, baseline, 'Production Worker output must match the supplied baseline, including boxes and line order.');
    if (runs.length) assert.deepEqual(result, runs[0].result, 'Repeated Worker runs must produce identical results.');
    runs.push({ iteration, elapsedMs: performance.now() - started, memory: process.memoryUsage(), lifecycle, result, stages });
    console.error(`[worker-lifecycle] ${iteration}/${iterations} PASS activeWorkers=${activeWorkers}`);
  }
  assert.equal(activeWorkers, 0);
  assert.equal(maximumActiveWorkers, 1);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ imagePath, script, maximumActiveWorkers, activeWorkers, runs }, null, 2));
  console.log(JSON.stringify({ outputPath, iterations, maximumActiveWorkers, activeWorkers }));
}
