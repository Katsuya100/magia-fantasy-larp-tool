import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createModelFileCache } from './model-file-cache.mjs';

const directory = await mkdtemp(resolve(tmpdir(), 'magia-model-cache-'));
const url = 'https://huggingface.co/model/resolve/pinned/onnx/model.onnx';
const namespace = 'transformers-cache';
const key = createHash('sha256').update(url).digest('hex');
const folder = resolve(directory, createHash('sha256').update(namespace).digest('hex'));
try {
  const storage = createModelFileCache(directory), cache = await storage.open(namespace);
  assert.equal(await cache.match(url), undefined);
  const bytes = new Uint8Array(2 * 1024 * 1024 + 7);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i & 255;
  await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  const offline = await createModelFileCache(directory).open(namespace);
  const response = await offline.match(new Request(url));
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(await (await storage.open('different-namespace')).match(url), undefined);
  const metadataPath = resolve(folder, `${key}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.bytes, bytes.length);
  assert.equal(metadata.sha256, createHash('sha256').update(bytes).digest('hex'));
  // Equal-length corruption is detected before any response is returned.
  bytes[0] ^= 255;
  await writeFile(resolve(folder, metadata.body), bytes);
  assert.equal(await offline.match(url), undefined);
  assert.equal(await offline.delete(url), false);

  await cache.put(url, new Response('previous-complete'));
  const interrupted = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([1,2,3])); controller.error(new Error('connection lost'));
  } }));
  await assert.rejects(cache.put(url, interrupted), /connection lost/);
  assert.equal(await (await offline.match(url)).text(), 'previous-complete');
  assert.ok((await readdir(folder)).every(name => !name.endsWith('.tmp')), 'failed transfers leave no temporary files');
  await cache.put(url, new Response('replacement'));
  assert.equal(await (await offline.match(url)).text(), 'replacement');
  assert.equal((await readdir(folder)).filter(name => name.endsWith('.body')).length, 1);
  await assert.rejects(cache.put(url, new Response('unavailable', { status: 503 })), /200/);

  // Forged body paths never escape the cache namespace.
  const malicious = JSON.parse(await readFile(metadataPath, 'utf8'));
  malicious.body = '../outside.body';
  await writeFile(metadataPath, JSON.stringify(malicious));
  assert.equal(await offline.match(url), undefined);
  assert.equal(await cache.delete(url), false);
  console.log('PASS_MODEL_FILE_CACHE_ATOMIC_STREAM_HASH_OFFLINE_NAMESPACE_AND_PATH_GUARD');
} finally { await rm(directory, { recursive: true, force: true }); }
