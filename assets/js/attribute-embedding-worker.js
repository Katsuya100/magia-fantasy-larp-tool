import './model-cache.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const cache = globalThis.ModelCache.create({
  name: 'transformers-cache',
  onCacheError: error => send({ type: 'cache-error', message: error?.message || String(error) }),
});
let activeJobId = null;

function send(message, transfer = []) {
  if (activeJobId === null) return;
  self.postMessage({ jobId: activeJobId, ...message }, transfer);
}

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.type !== 'embed' || !Number.isInteger(message.jobId)) return;
  activeJobId = message.jobId;

  let extractor = null;
  let embedding = null;
  let result = null;
  let error = null;
  try {
    send({ type: 'progress', stage: '呪文の相を測る準備をしています…' });
    const { env, pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
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
    embedding = await extractor(message.texts, { pooling: 'mean', normalize: true });
    result = {
      dims: Array.from(embedding.dims),
      data: new Float32Array(embedding.data),
    };
  } catch (caught) {
    error = caught;
  } finally {
    try { embedding?.dispose?.(); }
    catch (disposeError) { error ||= disposeError; }
    try { await extractor?.dispose?.(); }
    catch (disposeError) { error ||= disposeError; }
  }

  if (error) {
    send({ type: 'error', message: error?.message || String(error) });
  } else {
    send({ type: 'success', embedding: result }, [result.data.buffer]);
  }
  activeJobId = null;
});
