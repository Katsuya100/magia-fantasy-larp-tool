import { VectorStore } from './kotodama-vector-store.js';

export const KOTODAMA_CACHE_NAME = 'kotodamagia-pruned-data-v1';
const DATA_URL = new URL('../data/', import.meta.url);
const LEGACY_KOTODAMA_CACHES = [
  'kotodamagia-glove-zip-cache-v1', 'kotodamagia-glove-zip-cache-v2',
  'kotodamagia-glove-50d-cache-v1',
  'kotodamagia-frequency-words-cache-v2', 'kotodamagia-human-names-cache-v1',
  'kotodamagia-place-names-cache-v4',
];

async function sha256(buffer){
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}

function validateFile(entry){
  if(!entry || !/^[a-z0-9.-]+$/.test(entry.file) || !Number.isSafeInteger(entry.bytes) ||
    entry.bytes <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)){
    throw new Error('外典の由来を確かめられなかった。');
  }
}

// Storage may be unavailable (private browsing/quota); that must not prevent play.
async function openCache(storage, onCacheError){
  try { return storage ? await storage.open(KOTODAMA_CACHE_NAME) : null; }
  catch(error){ onCacheError(error); return null; }
}

async function verifiedBytes(entry, { baseUrl, fetchFn, cache, onCacheError, refresh }){
  validateFile(entry);
  const url = new URL(entry.file, baseUrl).href;
  const verify = async response => {
    if(!response.ok) throw new Error(`外典の頁が届かなかった (${response.status})。`);
    const buffer = await response.arrayBuffer();
    if(buffer.byteLength !== entry.bytes || await sha256(buffer) !== entry.sha256){
      throw new Error('外典の頁が途中でほどけた。控えを開き直してほしい。');
    }
    return buffer;
  };
  if(cache && !refresh){
    let response;
    try { response = await cache.match(url); } catch(error){ onCacheError(error); }
    if(response){
      try { return await verify(response); }
      catch(error){
        onCacheError(error);
        try { await cache.delete(url); } catch(storageError){ onCacheError(storageError); }
      }
    }
  }
  // A corrupt cache gets one fresh transfer. Network/model failures are never looped.
  const response = await fetchFn(url, {cache:'no-store'});
  const buffer = await verify(response);
  if(cache){
    try { await cache.put(url, new Response(buffer)); } catch(error){ onCacheError(error); }
  }
  return buffer;
}

async function fetchJson(file, {baseUrl,fetchFn,cache,onCacheError}){
  const url=new URL(file,baseUrl).href;
  let response;
  let networkError;
  try { response=await fetchFn(url,{cache:'no-store'}); }
  catch(error){
    if(error.name !== 'TypeError' || !/fetch|network|connection|offline|load failed/i.test(error.message)) throw error;
    networkError=error;
  }
  if(response?.ok) return response.json();
  if(response && response.status < 500 && response.status !== 429){
    throw new Error(`外典の目録が届かなかった (${response.status})。`);
  }
  // Only a complete, validated bundle saves its manifests. Cached data may start offline.
  if(cache){
    try {
      const stored=await cache.match(url);
      if(stored){
        const {text,checksum}=await stored.json();
        if(typeof text !== 'string' || await sha256(new TextEncoder().encode(text)) !== checksum){
          throw new Error('外典の目録の控えがほどけている。');
        }
        return JSON.parse(text);
      }
    } catch(error){ onCacheError(error); }
  }
  throw networkError || new Error(`外典の目録が届かなかった (${response?.status})。`);
}

async function saveManifest(file,metadata,{baseUrl,cache,onCacheError}){
  if(!cache) return;
  const text=JSON.stringify(metadata);
  const checksum=await sha256(new TextEncoder().encode(text));
  try { await cache.put(new URL(file,baseUrl).href,new Response(JSON.stringify({text,checksum}))); }
  catch(error){ onCacheError(error); }
}

export async function loadKotodamaData({
  baseUrl = DATA_URL, fetchFn = globalThis.fetch.bind(globalThis), storage = globalThis.caches,
  refresh = false,
  onCacheError = error => console.warn('Kotodama cache unavailable:', error),
} = {}){
  const cache = await openCache(storage, onCacheError);
  const options = {baseUrl, fetchFn, cache, onCacheError, refresh};
  const [meta, lexiconMeta] = await Promise.all([
    fetchJson('kotodama-vectors.meta.json', options),
    fetchJson('kotodama-lexicon.meta.json', options),
  ]);
  if(meta.formatVersion !== 1 || meta.encoding !== 'float32-le' || meta.dimension !== 50 || !Number.isSafeInteger(meta.wordCount) || meta.wordCount < 1 ||
    lexiconMeta.formatVersion !== 1){
    throw new Error('この書では外典の目録を読めない。');
  }
  const [wordBytes, vectorBytes, lexiconBytes] = await Promise.all([
    verifiedBytes(meta.files.words, options), verifiedBytes(meta.files.vectors, options),
    verifiedBytes(lexiconMeta.file, options),
  ]);
  const decoder = new TextDecoder();
  const words = JSON.parse(decoder.decode(wordBytes));
  if(words.length !== meta.wordCount) throw new Error('外典の語数が目録と異なる。');
  const lexicon = JSON.parse(decoder.decode(lexiconBytes));
  const vectors = VectorStore.fromPacked(words, vectorBytes, meta.dimension);
  if(lexicon.formatVersion !== 1 || !Array.isArray(lexicon.candidates) ||
    !Array.isArray(lexicon.forbidden) || !Array.isArray(lexicon.frequencyRanks) ||
    lexicon.vectorWordsSha256 !== meta.files.words.sha256 ||
    lexicon.candidates.some(word => !vectors.has(word)) ||
    new Set(lexicon.candidates).size !== lexicon.candidates.length){
    throw new Error('言霊目録と外典の写本が噛み合わない。');
  }
  await Promise.all([
    saveManifest('kotodama-vectors.meta.json',meta,options),
    saveManifest('kotodama-lexicon.meta.json',lexiconMeta,options),
  ]);
  return { vectors, candidateWords:lexicon.candidates, forbiddenWords:new Set(lexicon.forbidden),
    frequencyRanks:new Map(lexicon.frequencyRanks), metadata:meta };
}

export async function clearLegacyKotodamaCaches({storage=globalThis.caches, database=globalThis.indexedDB} = {}){
  if(storage){
    for(const name of LEGACY_KOTODAMA_CACHES) await storage.delete(name);
  }
  if(database){
    for(const name of ['kotodamagia-glove-cache-v1', 'kotodamagia-glove-chunk-cache-v1']){
      await new Promise((resolve,reject) => {
        const request=database.deleteDatabase(name);
        request.onsuccess=()=>resolve();
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new Error('旧い外典を開いた別の頁を閉じてほしい。'));
      });
    }
  }
}

export async function clearKotodamaCaches(options={}){
  const storage = options.storage ?? globalThis.caches;
  if(storage) await storage.delete(KOTODAMA_CACHE_NAME);
  await clearLegacyKotodamaCaches({...options,storage});
}
