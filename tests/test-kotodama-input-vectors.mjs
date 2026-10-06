import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { InputVectorStore, inputBucket } from '../assets/js/kotodama-input-vectors.js';
import { buildInputVectors } from '../scripts/build-kotodama-input-vectors.mjs';
import { hash } from '../scripts/build-kotodama-vectors.mjs';
import { loadKotodamaData } from '../assets/js/kotodama-data.js';
import { createKotodamaScoring } from '../assets/js/kotodama-scoring.js';
import { repositoryFetch } from './kotodama-harness.mjs';

const directory=new URL('../assets/data/',import.meta.url);
const metadata=JSON.parse(await readFile(new URL('kotodama-input.meta.json',directory),'utf8'));
const indexBytes=await readFile(new URL(metadata.files.index.file,directory));
const index=JSON.parse(indexBytes);
assert.equal(indexBytes.length,metadata.files.index.bytes);
assert.equal(hash(indexBytes),metadata.files.index.sha256);
assert.equal(metadata.totalWordCount,400000);
assert.equal(metadata.supplementalWordCount,359854);
const candidatesBytes=await readFile(new URL('kotodama-vectors.words.json',directory));
assert.equal(hash(candidatesBytes),metadata.candidateWordsSha256);
const data=await loadKotodamaData({fetchFn:repositoryFetch,storage:null});
const candidateVectors=data.candidateVectors;
const chunks=new Map();
for(const entry of metadata.buckets) {
  const bytes=await readFile(new URL(entry.file,directory));
  assert.equal(bytes.length,entry.bytes);
  assert.equal(hash(bytes),entry.sha256);
  for(let offset=0;offset<bytes.length;offset+=4) assert.ok(Number.isFinite(bytes.readFloatLE(offset)));
  chunks.set(entry.file,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
const loaded=[];
const inputVectors=new InputVectorStore({candidateVectors,index,metadata,loadChunk:async entry=>{loaded.push(entry.file);return chunks.get(entry.file);}});
assert.equal(inputVectors.size,400000);
assert.equal(inputVectors.has('<unk>'),false,'the old default limit excluded the trailing unknown row');
const fixture=JSON.parse(await readFile(new URL('../fixtures/kotodama/input-baseline.json',import.meta.url),'utf8'));
const scoring=createKotodamaScoring({...data,inputVectors,candidateVectors});
const candidateWords=new Set(data.candidateWords);
const isInputWord=scoring.isInputWord;
const isCandidateWord=scoring.isCandidateWord;
for(const item of fixture.classification) {
  assert.equal(isInputWord(item.word),item.glove,item.word);
  assert.equal(isCandidateWord(item.word),item.candidate,item.word);
  assert.equal(data.forbiddenWords.has(item.word),item.forbidden,item.word);
  assert.equal(scoring.isForbiddenWord(item.word),item.forbidden,item.word);
  await inputVectors.prepareWords([item.word]);
  if(item.forbidden) assert.throws(()=>scoring.parseSpell(item.word),/封じられた/);
  else assert.equal(scoring.parseSpell(item.word).used[0].word,item.word);
}
for(const item of fixture.cases) {
  await inputVectors.prepareWords(scoring.wordsFromMagicFormula(item.input));
  const {vec,used,raw}=scoring.parseSpell(item.input);
  assert.deepEqual({raw,used,vec:Array.from(vec),scores:scoring.attrScores(vec,used)},
    {raw:item.scoring.raw,used:item.scoring.used,vec:item.scoring.vec,scores:item.scoring.scores},item.input);
  assert.ok(scoring.nearestWords(vec,new Set(),100).every(([word])=>candidateWords.has(word)));
}
const rare=fixture.classification.filter(item=>item.glove&&!item.pruned&&!item.candidate&&!item.forbidden);
assert.ok(rare.length>=5,'rare inputs must be outside both pruned vectors and output candidates');
assert.ok(fixture.classification.some(item=>item.nameExcluded&&item.glove&&!item.candidate));
assert.ok(fixture.classification.some(item=>item.placeExcluded&&item.glove&&!item.candidate));
assert.ok(fixture.classification.some(item=>item.forbidden&&item.glove&&!item.candidate));
assert.ok(fixture.classification.some(item=>item.candidate&&item.nameAllowlisted));
assert.ok(fixture.classification.some(item=>item.candidate&&item.placeAllowlisted));

loaded.length=0;
await inputVectors.prepareWords([]);
await inputVectors.prepareWords(['quasar']);
assert.equal(loaded.length,1);
assert.equal(inputVectors.get('quasar').byteLength,200);
assert.equal(inputVectors.get('quasar').buffer.byteLength,200,'retain no bucket buffer through a subarray');
await inputVectors.prepareWords(['quasar','quasar']);
assert.equal(loaded.length,1,'repeat current words without loading another chunk');
await assert.rejects(inputVectors.prepareWords(['not_a_real_glove_word_12345']),/外典に名のない/);
assert.ok(inputVectors.get('quasar'),'a failed preparation preserves the previous spell');
await inputVectors.prepareWords(['fire']);
assert.equal(inputVectors.prepared.size,0,'old spell vectors must be released');
assert.equal(inputVectors.get('quasar'),undefined);
const invalid=new InputVectorStore({candidateVectors,index,metadata,loadChunk:async()=>new ArrayBuffer(1)});
await assert.rejects(invalid.prepareWords(['quasar']),/途中でほどけた/);
const broken=new InputVectorStore({candidateVectors,index,metadata,loadChunk:async entry=>{
  const buffer=chunks.get(entry.file).slice(0);new DataView(buffer).setFloat32(Math.floor(inputVectors.index.get('quasar')/metadata.bucketCount)*50*4,NaN,true);return buffer;
}});
await assert.rejects(broken.prepareWords(['quasar']),/読めない数/);
assert.throws(()=>new InputVectorStore({candidateVectors,index,metadata:{...metadata,dimension:49},loadChunk:async()=>{}}),/目録/);

const temporaryRoot=resolve(tmpdir());
const temporary=await mkdtemp(resolve(temporaryRoot,'kotodama-input-test-'));
try {
  const values=Array.from({length:50},(_,i)=>(i-20)/3);
  const row=word=>`${word} ${values.join(' ')}\n`;
  const sourcePath=resolve(temporary,'source.txt');
  const source=['fire','john','quasar','ab12','with-hyphen','<unk>'].map(row).join('');
  await writeFile(sourcePath,source);
  const options={sourcePath,candidateWordsBytes:Buffer.from('["fire"]\n'),wordLimit:5,bucketCount:4,expectedSourceHash:hash(Buffer.from(source))};
  const first=await buildInputVectors({...options,outputDir:resolve(temporary,'first')});
  const second=await buildInputVectors({...options,outputDir:resolve(temporary,'second')});
  assert.deepEqual(first,second);
  for(const file of ['kotodama-input.meta.json',first.files.index.file,...first.buckets.map(entry=>entry.file)]) {
    assert.deepEqual(await readFile(resolve(temporary,'first',file)),await readFile(resolve(temporary,'second',file)),`${file} is byte reproducible`);
  }
  const groups=JSON.parse(await readFile(resolve(temporary,'first',first.files.index.file),'utf8'));
  assert.deepEqual(new Set(groups.flat()),new Set(['john','quasar','ab12','with-hyphen']));
  for(let bucket=0;bucket<4;bucket++) {
    const bytes=await readFile(resolve(temporary,'first',first.buckets[bucket].file));
    for(let i=0;i<groups[bucket].length;i++) {
      assert.equal(inputBucket(groups[bucket][i],4),bucket);
      for(let column=0;column<50;column++) assert.equal(bytes.readFloatLE((i*50+column)*4),Math.fround(values[column]));
    }
  }
  await assert.rejects(buildInputVectors({...options,outputDir:resolve(temporary,'bad-hash'),expectedSourceHash:'0'.repeat(64)}),/SHA-256/);
  await assert.rejects(buildInputVectors({...options,outputDir:resolve(temporary,'bad-count'),wordLimit:7}),/word count/);
  await writeFile(sourcePath,source+row('JOHN'));
  await assert.rejects(buildInputVectors({...options,outputDir:resolve(temporary,'duplicate')}),/Duplicate/);
  await writeFile(sourcePath,source+'bad 1 2\n');
  await assert.rejects(buildInputVectors({...options,outputDir:resolve(temporary,'bad-dimension')}),/50 dimensions/);
} finally {
  const child=relative(temporaryRoot,resolve(temporary));
  if(!child||child.startsWith('..')||isAbsolute(child)) throw new Error('Fixture cleanup escaped temporary root');
  await rm(temporary,{recursive:true,force:true});
}
console.log('PASS_KOTODAMA_INPUT_400000_WORDS_RARE_GOLDEN_AND_CANDIDATE_BOUNDARY');
