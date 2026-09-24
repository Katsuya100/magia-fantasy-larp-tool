(function exposeModelCache(global) {
  'use strict';

  // Cache complete responses only. Failed/partial transfers remain retryable.
  function create({ name, onProgress = () => {}, onCacheError = () => {} }) {
    let cachePromise;
    const pending = new Map();
    async function open() {
      if (!cachePromise) cachePromise = Promise.resolve().then(() => {
        if (!global.caches) throw new Error('この書架は控えを刻めない。');
        return global.caches.open(name);
      }).catch(error => { onCacheError(error); return null; });
      return cachePromise;
    }
    const cache = {
      async match(url) {
        try { return await (await open())?.match(url); }
        catch (error) { onCacheError(error); return undefined; }
      },
      async put(url, response) {
        try { await (await open())?.put(url, response); }
        catch (error) { onCacheError(error); }
      },
      async load(url) {
        if (!pending.has(url)) {
          const operation = (async () => {
            const stored = await cache.match(url);
            if (stored) {
              onProgress({ status: 'cache', url });
              return stored;
            }
            onProgress({ status: 'download', url });
            const response = await global.fetch(url);
            if (!response.ok) throw new Error(`外典を読み込めません: ${response.status}`);
            const total = Number(response.headers.get('content-length')) || 0;
            let body;
            if (response.body) {
              const reader = response.body.getReader();
              const chunks = [];
              let loaded = 0;
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                  loaded += value.byteLength;
                  onProgress({ status: 'progress', url, loaded, total });
                }
              } finally { reader.releaseLock(); }
              body = new Blob(chunks);
            } else {
              body = await response.blob();
            }
            const complete = new Response(body, { headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' } });
            await cache.put(url, complete.clone());
            onProgress({ status: 'done', url });
            return complete;
          })();
          pending.set(url, operation);
          operation.then(() => pending.delete(url), () => pending.delete(url));
        }
        return (await pending.get(url)).clone();
      },
    };
    return cache;
  }

  global.ModelCache = Object.freeze({ create });
}(globalThis));
