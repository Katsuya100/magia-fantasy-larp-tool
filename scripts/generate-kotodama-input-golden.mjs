import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { createKotodamaDom, renderedSnapshot } from '../tests/kotodama-harness.mjs';
import { VectorStore } from '../assets/js/kotodama-vector-store.js';
import { GLOVE_SOURCE, parseVectorLine, hash } from './build-kotodama-vectors.mjs';
import { parseNameWordsText, parsePlaceWordsText, parseGeoNamesPlacesJson, mergeWordSets,
  parseCanonicalWordsText, parseFrequencyWordsText, looksLikePlainEnglishWord } from './kotodama-lexicon.mjs';

const sourceCommit='89e80a197281c7a08f79ae1a03dcf5dd209c52e6';
// Export with git show 89e80a197281c7a08f79ae1a03dcf5dd209c52e6:kotodama.html first.
const htmlBytes=await readFile(process.argv[2]||'.tmp/kotodama-original-review.html');
const blobHash=createHash('sha1').update(`blob ${htmlBytes.length}\0`).update(htmlBytes).digest('hex');
if(blobHash!=='42dc78b604aede8ae3e7471740fdee7ce5b97b17') throw new Error('Original HTML git blob mismatch (export without newline/encoding changes)');
const html=htmlBytes.toString('utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const script=scripts.find(value=>value.includes('function parseSpell'));
if(!script) throw new Error('Original inline implementation not found');
const lexicon=JSON.parse(await readFile('assets/data/kotodama-lexicon.json','utf8'));
const wordsBytes=await readFile('assets/data/kotodama-vectors.words.json');
const vectorsBytes=await readFile('assets/data/kotodama-vectors.f32');
const words=JSON.parse(wordsBytes);
const originalWords=new Set(words);
const vectors=VectorStore.fromPacked(words,vectorsBytes.buffer.slice(vectorsBytes.byteOffset,vectorsBytes.byteOffset+vectorsBytes.byteLength),50);
const inputs=['anemometer','quasar','astrolabe','chiaroscuro','syzygy','quasar + star - light','anemometer + wind + pressure','astrolabe + navigation + star'];
const checkedWords=[...new Set(inputs.join(' ').match(/[a-z0-9_]+/g)), 'john','usain','london','fuck','river','storm','king','queen','empire','state','turkey','orange','reading','mobile','nice'];
const rawVectors=new Map(); let row=0;
for await(const line of createInterface({input:createReadStream('.tmp/kotodama-build/glove.6B.50d.txt'),crlfDelay:Infinity})) {
  if(!line.trim()) continue;
  const parsed=parseVectorLine(line,++row);
  if(row<=400000 && checkedWords.includes(parsed.word)) rawVectors.set(parsed.word,Float32Array.from(parsed.vector));
}
if(hash(await readFile('.tmp/kotodama-build/glove.6B.50d.txt'))!==GLOVE_SOURCE.sha256) throw new Error('Golden GloVe source changed');
for(const [word,vector] of rawVectors) vectors.set(word,vector);
const dom=createKotodamaDom();
const context=vm.createContext({document:dom.document,window:{addEventListener(){}},requestAnimationFrame:callback=>callback(),
  setTimeout:()=>0,console,TextDecoder,TextEncoder,URL,Blob,Response,Map,Set,Uint8Array,Float32Array,Date,Math,globalVectors:vectors,globalLexicon:lexicon});
vm.runInContext(script,context);
vm.runInContext('vectors=globalVectors;dim=50;forbiddenWords=new Set(globalLexicon.forbidden);frequencyRanks=new Map(globalLexicon.frequencyRanks);candidateWords=globalLexicon.candidates;unifiedCatalog=new Map(candidateWords.map(word=>[word,0]));',context);
const cases=[];
for(const input of inputs) {
  dom.get('spell').value=input;
  const scoring=vm.runInContext(`(()=>{const {vec,used,raw}=parseSpell(${JSON.stringify(input)});const scores=attrScores(vec,used);return {raw,used,vec:Array.from(vec),scores,manifest:chooseManifest(scores)}})()`,context);
  await vm.runInContext('cast()',context);
  cases.push({input,scoring:JSON.parse(JSON.stringify(scoring)),rendered:renderedSnapshot(dom)});
}
const names=parseNameWordsText(await readFile('.tmp/kotodama-build/names.txt','utf8'));
const places=mergeWordSets(parsePlaceWordsText(await readFile('.tmp/kotodama-build/places.geojson','utf8')),parseGeoNamesPlacesJson(await readFile('.tmp/kotodama-build/cities.json','utf8')));
const canonical=parseCanonicalWordsText(await readFile('.tmp/kotodama-build/canonical.txt','utf8'));
const frequency=parseFrequencyWordsText(await readFile('.tmp/kotodama-build/frequency.csv','utf8'));
const NAME_WORD_ALLOWLIST=vm.runInContext('NAME_WORD_ALLOWLIST',context);
const PLACE_WORD_ALLOWLIST=vm.runInContext('PLACE_WORD_ALLOWLIST',context);
const classification=checkedWords.map(word=>({word,glove:rawVectors.has(word),pruned:originalWords.has(word),candidate:lexicon.candidates.includes(word),
  forbidden:lexicon.forbidden.includes(word),nameExcluded:names.has(word),placeExcluded:places.has(word),
  nameAllowlisted:NAME_WORD_ALLOWLIST.has(word),placeAllowlisted:PLACE_WORD_ALLOWLIST.has(word),
  plainEnglish:looksLikePlainEnglishWord(word),canonical:canonical.has(word),frequencyRank:frequency.get(word)??null}));
await writeFile('fixtures/kotodama/input-baseline.json',JSON.stringify({sourceCommit,gloveSourceSha256:GLOVE_SOURCE.sha256,
  method:'Unmodified original HTML in VM; selected vectors parsed directly from pinned full GloVe text and stored as original Float32 values; original cast, cosine, attrScores and chooseManifest',
  classification,cases},null,2)+'\n');
console.log('Original free-input golden generated');
