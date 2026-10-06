import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadKotodamaData, clearKotodamaCaches, clearLegacyKotodamaCaches, KOTODAMA_CACHE_NAME } from '../assets/js/kotodama-data.js';
import { VectorStore } from '../assets/js/kotodama-vector-store.js';

const baseUrl='https://example.test/data/';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const checksum=value=>createHash('sha256').update(value).digest('hex');
const words=bytes(['fire','water']);
const packed=new Float32Array(100);
packed[0]=1; packed[51]=1;
const vectors=new Uint8Array(packed.buffer);
const lexicon=bytes({formatVersion:1,vectorWordsSha256:checksum(words),candidates:['fire','water'],forbidden:['banned'],frequencyRanks:[['fire',1],['water',2]]});
const entry=(file,data)=>({file,bytes:data.byteLength,sha256:checksum(data)});
const manifest={formatVersion:1,encoding:'float32-le',dimension:50,wordCount:2,files:{words:entry('words.json',words),vectors:entry('vectors.f32',vectors)}};
const lexiconManifest={formatVersion:1,file:entry('lexicon.json',lexicon)};
const files=new Map([
  ['kotodama-vectors.meta.json',bytes(manifest)],['kotodama-lexicon.meta.json',bytes(lexiconManifest)],
  ['words.json',words],['vectors.f32',vectors],['lexicon.json',lexicon],
]);
function createStorage(){
  const stored=new Map();
  const deleted=[];
  return {stored,deleted, async open(){return {
    async match(url){return stored.get(url)?.clone();},
    async put(url,response){stored.set(url,response.clone());},
    async delete(url){return stored.delete(url);},
  };},async delete(name){deleted.push(name);}};
}
function createFetch(overrides=new Map()){
  const requests=[];
  return Object.assign(async url=>{
    const name=new URL(url).pathname.split('/').at(-1);
    requests.push(name);
    if(overrides.has(name)) return overrides.get(name)();
    assert.ok(files.has(name),`Unexpected fetch: ${url}`);
    return new Response(files.get(name));
  },{requests});
}
const storage=createStorage();
const fetchFn=createFetch();
const loaded=await loadKotodamaData({baseUrl,fetchFn,storage});
assert.equal(loaded.vectors.size,2);
assert.equal(loaded.vectors.dim,50);
assert.equal(loaded.vectors.get('water')[1],1);
assert.deepEqual(loaded.candidateWords,['fire','water']);
assert.equal(loaded.frequencyRanks.get('fire'),1);
assert.ok(loaded.forbiddenWords.has('banned'));
assert.equal(storage.stored.size,5);
const warmFetch=createFetch();
await loadKotodamaData({baseUrl,fetchFn:warmFetch,storage});
assert.deepEqual(warmFetch.requests.sort(),['kotodama-lexicon.meta.json','kotodama-vectors.meta.json']);
const refreshFetch=createFetch();
await loadKotodamaData({baseUrl,fetchFn:refreshFetch,storage,refresh:true});
assert.equal(refreshFetch.requests.length,5,'manual refresh must transfer fresh data even if deleting the cache was blocked');
const offline=await loadKotodamaData({baseUrl,storage,fetchFn:async()=>{throw new TypeError('Failed to fetch (offline)');}});
assert.equal(offline.vectors.size,2,'a previously completed dictionary must remain usable offline');
await assert.rejects(loadKotodamaData({baseUrl,storage,fetchFn:async()=>{throw new RangeError('out of memory');}}),/memory/);
const corruptedManifests=createStorage();
for(const [url,response] of storage.stored) corruptedManifests.stored.set(url,response.clone());
corruptedManifests.stored.set(new URL('kotodama-vectors.meta.json',baseUrl).href,new Response('{"text":"{}","checksum":"invalid"}'));
await assert.rejects(loadKotodamaData({baseUrl,storage:corruptedManifests,onCacheError(){},fetchFn:async()=>{throw new TypeError('Failed to fetch');}}),/fetch/);

// One fresh transfer replaces a partial/poisoned cache, without unlimited retries.
storage.stored.set(new URL('vectors.f32',baseUrl).href,new Response('partial'));
const errors=[];
const repairedFetch=createFetch();
await loadKotodamaData({baseUrl,fetchFn:repairedFetch,storage,onCacheError:error=>errors.push(error)});
assert.equal(repairedFetch.requests.filter(name=>name==='vectors.f32').length,1);
assert.equal(errors.length,1);
assert.equal((await storage.stored.get(new URL('vectors.f32',baseUrl).href).clone().arrayBuffer()).byteLength,400);

// Storage failures preserve the downloaded data; network and integrity failures reject.
for(const restricted of [undefined,{async open(){throw new Error('private mode');}},
  {async open(){return {async match(){},async put(){throw new Error('quota');}};}}]){
  const usable=await loadKotodamaData({baseUrl,fetchFn:createFetch(),storage:restricted,onCacheError(){}});
  assert.equal(usable.vectors.size,2);
}
for(const override of [()=>new Response('bad', {status:503}),()=>new Response('partial'),
  ()=>{throw new RangeError('memory');},()=>{throw new WebAssembly.RuntimeError('wasm');}]){
  const failedFetch=createFetch(new Map([['vectors.f32',override]]));
  await assert.rejects(loadKotodamaData({baseUrl,fetchFn:failedFetch,storage:null}));
  assert.equal(failedFetch.requests.filter(name=>name==='vectors.f32').length,1);
}
const badMetadata=createFetch(new Map([['kotodama-vectors.meta.json',()=>new Response(JSON.stringify({...manifest,dimension:49}))]]));
await assert.rejects(loadKotodamaData({baseUrl,fetchFn:badMetadata,storage:null}),/目録/);
assert.equal(badMetadata.requests.length,2,'metadata errors must reject before loading vector data');
const changedLexicon=bytes({...JSON.parse(new TextDecoder().decode(lexicon)),vectorWordsSha256:'0'.repeat(64)});
const mismatched=createFetch(new Map([
  ['kotodama-lexicon.meta.json',()=>new Response(JSON.stringify({formatVersion:1,file:entry('lexicon.json',changedLexicon)}))],
  ['lexicon.json',()=>new Response(changedLexicon)],
]));
await assert.rejects(loadKotodamaData({baseUrl,fetchFn:mismatched,storage:null}),/噛み合わない/);

await clearKotodamaCaches({storage,database:null});
assert.ok(storage.deleted.includes(KOTODAMA_CACHE_NAME));
const databaseDeletes=[];
const database={deleteDatabase(name){
  databaseDeletes.push(name);
  const request={}; queueMicrotask(()=>request.onsuccess()); return request;
}};
await clearLegacyKotodamaCaches({storage,database});
assert.deepEqual(databaseDeletes,['kotodamagia-glove-cache-v1','kotodamagia-glove-chunk-cache-v1']);
assert.ok(!storage.deleted.includes('kotodamagia-canonical-words-cache-v1'),'shared circle vocabulary cache must remain intact');

const adopted=VectorStore.fromPacked(['fire','water'],packed.buffer,50);
assert.equal(adopted.data.buffer,packed.buffer,'the dictionary must adopt the buffer instead of duplicating it');
assert.throws(()=>VectorStore.fromPacked(['fire','fire'],packed.buffer,50),/目録/);
assert.throws(()=>VectorStore.fromPacked(['fire'],packed.buffer,50),/次元/);
const invalid=new Float32Array(50); invalid[0]=NaN;
assert.throws(()=>VectorStore.fromPacked(['fire'],invalid.buffer,50),/読めない数/);
console.log('PASS_KOTODAMA_DATA_HASH_CACHE_MIGRATION_MEMORY_AND_FAILURES');
