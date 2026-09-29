(function registerMagiaOcrErrorPolicy(global) {
  'use strict';

  const RETRYABLE_LOAD_CODE = 'OCR_RETRYABLE_RESOURCE_LOAD';
  const TRANSIENT_NETWORK_MESSAGE = /failed to fetch|fetch failed|failed to load|network request failed|networkerror|load failed|connection (?:reset|refused|closed)|timed? ?out|timeout|temporarily unavailable|temporary failure/i;
  const MEMORY_FAILURE_MESSAGE = /out of memory|out-of-memory|allocation failed|failed to allocate|cannot allocate|can't allocate|could not allocate|memory allocation|memory access out of bounds|webassembly[. ]memory|wasm memory|cannot enlarge memory|failed to grow memory|memory growth|memory limit|not enough memory|enomem|bad alloc|invalid typed array length|maximum array buffer|opencv.{0,20}alloc|onnx.{0,20}alloc/i;

  function statusFromError(error) {
    const directStatus = Number(error?.status);
    if (Number.isInteger(directStatus)) return directStatus;
    const match = String(error?.message || error || '').match(/(?:http\s*|:\s*)(\d{3})\b/i);
    return match ? Number(match[1]) : null;
  }

  function isMemoryFailure(error) {
    const text = [error?.message, error?.cause?.message, error].filter(Boolean).join(' ').toLowerCase();
    return error?.name === 'RangeError' || error?.name === 'WebAssembly.RuntimeError' || MEMORY_FAILURE_MESSAGE.test(text);
  }

  function wrapRetryableLoadFailure(error, resource) {
    if (!error || error.name === 'AbortError' || isMemoryFailure(error)) return error;

    const message = String(error?.message || error);
    const status = statusFromError(error);
    const temporaryHttpFailure = status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
    const temporaryNetworkFailure = ['TypeError', 'NetworkError', 'TimeoutError'].includes(error?.name) && TRANSIENT_NETWORK_MESSAGE.test(message);
    if (!temporaryHttpFailure && !temporaryNetworkFailure) return error;

    const wrapped = new Error(`Temporary OCR resource load failure (${resource}): ${message}`);
    wrapped.name = 'RetryableOcrLoadError';
    wrapped.code = RETRYABLE_LOAD_CODE;
    wrapped.resource = String(resource || 'unknown');
    wrapped.retryable = true;
    wrapped.cause = error;
    return wrapped;
  }

  function isRetryableOcrError(error) {
    if (!error || error.name === 'AbortError' || isMemoryFailure(error)) return false;
    return error.name === 'RetryableOcrLoadError' && error.code === RETRYABLE_LOAD_CODE && error.retryable === true;
  }

  global.MagiaOcrErrorPolicy = Object.freeze({
    RETRYABLE_LOAD_CODE,
    wrapRetryableLoadFailure,
    isRetryableOcrError,
  });
})(globalThis);
