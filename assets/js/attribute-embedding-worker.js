import './model-cache.js';
import './analysis-diagnostics.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const cache = globalThis.ModelCache.create({
  name: 'transformers-cache',
  onCacheError: error => send({ type: 'cache-error', message: error?.message || String(error) }),
});
let activeJobId = null;
let activeAbortController = null;
const diagnosticReporter = globalThis.MagiaAnalysisDiagnostics.createReporter('embedding', message => send(message));

function makeAbortError() {
  const error = new Error('Embedding was cancelled.');
  error.name = 'AbortError';
  return error;
}

function send(message, transfer = []) {
  if (activeJobId === null) return;
  self.postMessage({ jobId: activeJobId, ...message }, transfer);
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'abort' && message.jobId === activeJobId) {
    activeAbortController?.abort(makeAbortError());
    return;
  }
  if (message.type !== 'embed' || !Number.isInteger(message.jobId) || activeJobId !== null) return;
  activeJobId = message.jobId;
  activeAbortController = new AbortController();
  diagnosticReporter.begin(message.runId, {});

  let extractor = null;
  let embedding = null;
  let result = null;
  let error = null;
  void (async () => {
    const signal = activeAbortController.signal;
    try {
      diagnosticReporter.stage('embedding-runtime-import-start');
      send({ type: 'stage', stage: 'embedding-runtime-loading' });
      send({ type: 'progress', stage: '呪文の相を測る準備をしています…' });
      const { env, pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      diagnosticReporter.stage('embedding-runtime-import-done');
      if (signal.aborted) throw signal.reason || makeAbortError();
      env.allowLocalModels = false;
      env.useCustomCache = true;
      env.customCache = cache;
      const wasm = env.backends?.onnx?.wasm;
      if (wasm) {
        wasm.numThreads = 1;
        // This worker is already disposable, so keep the WASM runtime in it directly.
        wasm.proxy = false;
      }

      diagnosticReporter.stage('embedding-model-load-start', { modelId: MODEL_ID });
      diagnosticReporter.stage('embedding-pipeline-create-start', { modelId: MODEL_ID, device: 'wasm', dtype: 'q8' });
      extractor = await pipeline('feature-extraction', MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: info => {
          if (!info.file?.endsWith('.onnx')) return;
          if (info.status === 'progress') {
            send({ type: 'progress', stage: 'download', progress: info.progress });
          } else if (info.status === 'done') {
            send({ type: 'progress', stage: 'ready' });
          }
        },
      });
      diagnosticReporter.stage('embedding-pipeline-create-done', { modelId: MODEL_ID, runtimeState: { embeddingPipelineLoaded: true } });
      diagnosticReporter.stage('embedding-model-load-done', { modelId: MODEL_ID, runtimeState: { embeddingPipelineLoaded: true } });
      if (signal.aborted) throw signal.reason || makeAbortError();
      send({ type: 'stage', stage: 'embedding-runtime-ready' });
      diagnosticReporter.stage('embedding-input-tensor-start', { inputCount: message.texts?.length || 0, api: 'Transformers.js pipeline input; tensor construction is internal' });
      diagnosticReporter.stage('embedding-input-tensor-done', { inputCount: message.texts?.length || 0, api: 'Transformers.js pipeline input; tensor construction is internal' });
      diagnosticReporter.stage('embedding-run-start', { inputCount: message.texts?.length || 0 });
      embedding = await extractor(message.texts, { pooling: 'mean', normalize: true });
      diagnosticReporter.stage('embedding-run-done', { outputShape: Array.from(embedding.dims), outputElements: embedding.data?.length || 0 });
      if (signal.aborted) throw signal.reason || makeAbortError();
      result = {
        dims: Array.from(embedding.dims),
        data: new Float32Array(embedding.data),
      };
      diagnosticReporter.allocationDone('embedding-output-buffer-ready', 'embedding-output-float32', result.data.byteLength, {
        name: 'Embedding output Float32', type: 'Float32Array', width: result.data.length,
      });
    } catch (caught) {
      error = caught;
    } finally {
      diagnosticReporter.stage('embedding-dispose-start');
      try { embedding?.dispose?.(); }
      catch (disposeError) { error ||= disposeError; }
      finally { embedding = null; }
      const activeExtractor = extractor;
      extractor = null;
      try { await activeExtractor?.dispose?.(); }
      catch (disposeError) { error ||= disposeError; }
      diagnosticReporter.stage('embedding-dispose-done', { runtimeState: { embeddingPipelineLoaded: false } });
      send({ type: 'stage', stage: 'embedding-cleanup' });
    }

    if (error) {
      send({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error) });
    } else {
      const outputBytes = result?.data?.byteLength || 0;
      diagnosticReporter.stage('embedding-result-transfer-start', { outputBytes });
      send({ type: 'success', embedding: result }, [result.data.buffer]);
      diagnosticReporter.releaseStart('embedding-output-buffer-release-start', 'embedding-output-float32');
      result.data = null;
      diagnosticReporter.releaseDone('embedding-output-buffer-release-done', 'embedding-output-float32');
      diagnosticReporter.stage('embedding-result-transfer-done', { outputBytes });
    }
    activeAbortController = null;
    activeJobId = null;
  })();
});
