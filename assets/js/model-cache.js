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
        try {
          const store = await open();
          if (!store) return false;
          await store.put(url, response);
          return true;
        } catch (error) { onCacheError(error); return false; }
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
            let loaded = 0;
            let streamError = null;
            let complete;
            if (response.body) {
              const reader = response.body.getReader();
              const body = new global.ReadableStream({
                async pull(controller) {
                  try {
                    const { done, value } = await reader.read();
                    if (done) {
                      reader.releaseLock();
                      onProgress({ status: 'done', url });
                      controller.close();
                      return;
                    }
                    loaded += value.byteLength;
                    onProgress({ status: 'progress', url, loaded, total });
                    controller.enqueue(value);
                  } catch (error) {
                    streamError ||= error;
                    try { reader.releaseLock(); } catch {}
                    controller.error(error);
                  }
                },
                cancel(reason) { return reader.cancel(reason); },
              });
              complete = new global.Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            } else {
              const body = await response.blob();
              loaded = body.size;
              if (loaded) onProgress({ status: 'progress', url, loaded, total });
              complete = new global.Response(body, { headers: response.headers });
            }
            if (!await isValid(complete)) throw new Error('外典の内容を検証できませんでした。');
            if (await cache.put(url, complete) && complete.bodyUsed) {
              const stored = await cache.match(url);
              if (stored) return stored;
            }
            if (streamError) throw streamError;
            if (complete.bodyUsed) {
              // CacheStorage may consume a body before rejecting a write (for example, on quota errors).
              // Re-fetch only in that failure path so the caller still receives a readable response.
              onProgress({ status: 'download', url });
              const retry = await global.fetch(url);
              if (!retry.ok || retry.status !== 200 || !await isValid(retry)) {
                throw new Error(`外典を再読込できません: ${retry.status}`);
              }
              return retry;
            }
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
