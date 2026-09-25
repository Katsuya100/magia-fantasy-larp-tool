(function exposeModelCache(global) {
  'use strict';

  // Cache complete responses only. Failed/partial transfers remain retryable.
  function create({ name, onProgress = () => {}, onCacheError = () => {}, validate = null }) {
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
      async delete(url) {
        try { return await (await open())?.delete(url) ?? false; }
        catch (error) { onCacheError(error); return false; }
      },
      async load(url) {
        if (!pending.has(url)) {
          const operation = (async () => {
            const isValid = async response => {
              if (!response || !response.ok || response.status !== 200) return false;
              if (/text\/html/i.test(response.headers.get('content-type') || '')) return false;
              const body = response.clone().body;
              if (!body) return false;
              const reader = body.getReader();
              try {
                const first = await reader.read();
                if (first.done || !first.value?.byteLength) return false;
              } finally {
                reader.cancel().catch(() => {});
                reader.releaseLock();
              }
              return validate ? Boolean(await validate(url, response.clone())) : true;
            };
            let stored = await cache.match(url);
            if (stored && await isValid(stored)) {
              onProgress({ status: 'cache', url });
              return stored;
            }
            if (stored) {
              await cache.delete(url);
              onProgress({ status: 'invalid-cache', url });
            }
            onProgress({ status: 'download', url });
            const response = await global.fetch(url);
            if (!response.ok || response.status !== 200) throw new Error(`外典を読み込めません: ${response.status}`);
            const total = Number(response.headers.get('content-length')) || 0;
            let body;
            let loaded = 0;
            if (response.body) {
              const reader = response.body.getReader();
              const chunks = [];
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
              loaded = body.size;
            }
            const complete = new Response(body, { headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' } });
            if (!loaded) throw new Error('外典の内容が空でした。');
            if (!await isValid(complete)) throw new Error('外典の内容を検証できませんでした。');
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
