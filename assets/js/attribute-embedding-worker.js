import './model-cache.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const cache = globalThis.ModelCache.create({
  name: 'transformers-cache',
  onCacheError: error => send({ type: 'cache-error', message: error?.message || String(error) }),
});
let activeJobId = null;
let activeAbortController = null;

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

  let extractor = null;
  let embedding = null;
  let result = null;
  let error = null;
  void (async () => {
    const signal = activeAbortController.signal;
    try {
      send({ type: 'stage', stage: 'embedding-runtime-loading' });
      send({ type: 'progress', stage: '呪文の相を測る準備をしています…' });
      const { env, pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
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
      if (signal.aborted) throw signal.reason || makeAbortError();
      send({ type: 'stage', stage: 'embedding-runtime-ready' });
      send({ type: 'stage', stage: 'embedding-run-start' });
      embedding = await extractor(message.texts, { pooling: 'mean', normalize: true });
      if (signal.aborted) throw signal.reason || makeAbortError();
      result = {
        dims: Array.from(embedding.dims),
        data: new Float32Array(embedding.data),
      };
      send({ type: 'stage', stage: 'embedding-run-done' });
    } catch (caught) {
      error = caught;
    } finally {
      try { embedding?.dispose?.(); }
      catch (disposeError) { error ||= disposeError; }
      finally { embedding = null; }
      const activeExtractor = extractor;
      extractor = null;
      try { await activeExtractor?.dispose?.(); }
      catch (disposeError) { error ||= disposeError; }
      send({ type: 'stage', stage: 'embedding-cleanup' });
    }

    if (error) {
      send({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error) });
    } else {
      send({ type: 'success', embedding: result }, [result.data.buffer]);
    }
    activeAbortController = null;
    activeJobId = null;
  })();
});
