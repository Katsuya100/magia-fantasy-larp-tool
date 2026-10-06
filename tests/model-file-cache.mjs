// Node-only Web Cache API adapter for the browser/WASM E2E harness.
// Namespace and request keys are hashes, never paths supplied by models.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const digest = text => createHash('sha256').update(text).digest('hex');
const requestKey = request => typeof request === 'string' ? request : request.url;

export function createModelFileCache(directory) {
  const root = resolve(directory);
  return {
    async open(namespace) {
      const folder = resolve(root, digest(String(namespace)));
      await mkdir(folder, { recursive: true });
      const paths = request => {
        const url = requestKey(request);
        if (typeof url !== 'string') throw new TypeError('A cache request URL is required.');
        const key = digest(url);
        return { url, key, metadata: resolve(folder, `${key}.json`) };
      };
      const validMetadata = (metadata, key, url) => metadata.formatVersion === 1 && metadata.url === url
        && Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0
        && /^[a-f0-9]{64}$/.test(metadata.sha256)
        && typeof metadata.body === 'string' && metadata.body.startsWith(`${key}.`)
        && /^[a-f0-9]{64}\.[a-f0-9-]{36}\.body$/.test(metadata.body)
        && metadata.status === 200 && Array.isArray(metadata.headers);
      const store = {
        async match(request) {
          const { url, key, metadata: metadataPath } = paths(request);
          let metadata;
          try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); }
          catch (error) {
            if (error.code === 'ENOENT') return undefined;
            if (!(error instanceof SyntaxError)) throw error;
            await rm(metadataPath, { force: true });
            return undefined;
          }
          if (!validMetadata(metadata, key, url)) { await rm(metadataPath, { force: true }); return undefined; }
          const bodyPath = resolve(folder, metadata.body);
          let valid = false;
          try {
            if ((await stat(bodyPath)).size === metadata.bytes) {
              const hash = createHash('sha256');
              for await (const chunk of createReadStream(bodyPath)) hash.update(chunk);
              valid = hash.digest('hex') === metadata.sha256;
            }
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (!valid) { await store.delete(request); return undefined; }
          return new Response(Readable.toWeb(createReadStream(bodyPath)), {
            status: metadata.status, headers: metadata.headers,
          });
        },
        async put(request, response) {
          if (response.status !== 200 || !response.body) throw new Error('Only complete HTTP 200 model responses can be cached.');
          const { url, key, metadata: metadataPath } = paths(request);
          const bodyName = `${key}.${randomUUID()}.body`;
          const bodyPath = resolve(folder, bodyName), temporaryBody = `${bodyPath}.tmp`;
          const temporaryMetadata = `${metadataPath}.${randomUUID()}.tmp`;
          let bytes = 0;
          const hash = createHash('sha256');
          const observe = new Transform({ transform(chunk, _encoding, callback) {
            bytes += chunk.byteLength; hash.update(chunk); callback(null, chunk);
          } });
          let previous;
          try { previous = JSON.parse(await readFile(metadataPath, 'utf8')); }
          catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
          try {
            await pipeline(Readable.fromWeb(response.body), observe, createWriteStream(temporaryBody, { flags: 'wx' }));
            if (!bytes) throw new Error('Empty model response cannot be cached.');
            await rename(temporaryBody, bodyPath);
            await writeFile(temporaryMetadata, JSON.stringify({
              formatVersion: 1, url, body: bodyName, bytes, sha256: hash.digest('hex'),
              status: response.status, headers: Array.from(response.headers),
            }), { flag: 'wx' });
            // A single atomic pointer update exposes only a complete, hashed body.
            await rename(temporaryMetadata, metadataPath);
          } catch (error) {
            await Promise.all([temporaryBody, temporaryMetadata, bodyPath].map(path => rm(path, { force: true })));
            throw error;
          }
          if (previous && validMetadata(previous, key, url) && previous.body !== bodyName) {
            await rm(resolve(folder, previous.body), { force: true });
          }
        },
        async delete(request) {
          const { key, url, metadata: metadataPath } = paths(request);
          let metadata;
          try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); }
          catch (error) { if (error.code === 'ENOENT') return false; if (!(error instanceof SyntaxError)) throw error; }
          await rm(metadataPath, { force: true });
          if (metadata && validMetadata(metadata, key, url)) await rm(resolve(folder, metadata.body), { force: true });
          return true;
        },
      };
      return store;
    },
  };
}
