import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRS } from '../assets/js/kotodama-attributes.js';
import { buildVectors, DIMENSION, hash, parseVectorLine } from '../scripts/build-kotodama-vectors.mjs';

const dataDir = fileURLToPath(new URL('../assets/data/',import.meta.url));
const metadata = JSON.parse(await readFile(resolve(dataDir,'kotodama-vectors.meta.json'),'utf8'));
const wordBytes = await readFile(resolve(dataDir,metadata.files.words.file));
const vectorBytes = await readFile(resolve(dataDir,metadata.files.vectors.file));
const words = JSON.parse(wordBytes);
assert.equal(metadata.formatVersion,1);
assert.equal(metadata.dimension,DIMENSION);
assert.equal(metadata.encoding,'float32-le');
assert.equal(metadata.wordCount,words.length);
assert.equal(new Set(words).size,words.length,'packaged vocabulary must have no duplicate words');
assert.ok(words.every(word => typeof word === 'string' && word && word === word.toLowerCase()));
assert.equal(vectorBytes.length,words.length * DIMENSION * 4);
for(const [name,bytes] of [['words',wordBytes],['vectors',vectorBytes]]) {
  assert.equal(metadata.files[name].bytes,bytes.length);
  assert.equal(metadata.files[name].sha256,hash(bytes),`${name} checksum must match the manifest`);
}
assert.ok(wordBytes.length + vectorBytes.length < 10 * 1024 * 1024,'runtime dictionary must remain under 10 MiB');
for(let offset=0;offset<vectorBytes.length;offset+=4) assert.ok(Number.isFinite(vectorBytes.readFloatLE(offset)));
for(const [name,attribute] of Object.entries(ATTRS)) {
  for(const word of [name,...attribute.words]) assert.ok(words.includes(word),`missing required attribute word ${word}`);
}
assert.deepEqual(metadata.selection.missingFrequencyWords,[],'all legacy frequency-gated candidates must remain available');

const temporaryRoot = resolve(tmpdir());
const directory = await mkdtemp(resolve(temporaryRoot,'kotodama-vectors-test-'));
const values = Array.from({length:DIMENSION},(_,i) => (i-24) / 7);
const row = word => `${word} ${values.join(' ')}\n`;
const sourceText = ['common','excluded','frequent','flame','fire','rare'].map(row).join('');
const sourcePath = resolve(directory,'fixture.txt');
await writeFile(sourcePath,sourceText);
const options = {
  sourcePath, canonicalText:'common\nexcluded\nrare\n',
  frequencyText:'Rank,Word\n1,frequent\n2,frequent\n3,absent\n',
  attributes:{flame:{words:['fire']}}, inputRankLimit:1, expectedSourceHash:hash(Buffer.from(sourceText)),
};
try {
  const first = await buildVectors({...options,outputDir:resolve(directory,'first')});
  const second = await buildVectors({...options,outputDir:resolve(directory,'second')});
  assert.deepEqual(first,second,'same inputs must produce identical manifests');
  for(const name of ['kotodama-vectors.words.json','kotodama-vectors.f32','kotodama-vectors.meta.json']) {
    assert.deepEqual(await readFile(resolve(directory,'first',name)),await readFile(resolve(directory,'second',name)),`${name} must be byte-for-byte reproducible`);
  }
  const selected = JSON.parse(await readFile(resolve(directory,'first','kotodama-vectors.words.json'),'utf8'));
  assert.deepEqual(selected,['common','frequent','flame','fire'],'source order, frequency words and attributes must survive pruning');
  assert.deepEqual(first.selection.missingFrequencyWords,['absent']);
  const selectedBytes = await readFile(resolve(directory,'first','kotodama-vectors.f32'));
  const legacyVector = Float32Array.from(values);
  for(let rowIndex=0;rowIndex<selected.length;rowIndex++) {
    for(let column=0;column<DIMENSION;column++) {
      assert.equal(selectedBytes.readFloatLE((rowIndex*DIMENSION+column)*4),legacyVector[column],'packed values must equal the former VectorStore Float32 assignment');
    }
  }
  await assert.rejects(buildVectors({...options,outputDir:resolve(directory,'bad-hash'),expectedSourceHash:'0'.repeat(64)}),/SHA-256 mismatch/);
  await assert.rejects(buildVectors({...options,outputDir:resolve(directory,'missing'),attributes:{missing:{words:['absent']}}}),/Missing attribute words/);
  await assert.rejects(buildVectors({...options,outputDir:resolve(directory,'bad-rank'),inputRankLimit:0}),/positive integer/);
  const duplicate = resolve(directory,'duplicate.txt');
  await writeFile(duplicate,sourceText + row('COMMON'));
  await assert.rejects(buildVectors({...options,sourcePath:duplicate,expectedSourceHash:undefined,outputDir:resolve(directory,'duplicates')}),/Duplicate GloVe word/);
  assert.throws(() => parseVectorLine('bad 1 2',1),/50 dimensions/);
  assert.throws(() => parseVectorLine(`bad ${['NaN',...values.slice(1)].join(' ')}`,1),/non-finite/);
  assert.throws(() => parseVectorLine(`bad ${['Infinity',...values.slice(1)].join(' ')}`,1),/non-finite/);
  assert.throws(() => parseVectorLine(`bad ${['1e99',...values.slice(1)].join(' ')}`,1),/non-finite/);
  const invalidSource = resolve(directory,'invalid.txt');
  await writeFile(invalidSource,sourceText+'malformed 1 2\n');
  await assert.rejects(buildVectors({...options,sourcePath:invalidSource,expectedSourceHash:undefined,outputDir:resolve(directory,'invalid')}),/50 dimensions/);
} finally {
  // Resolve and constrain the recursively removed fixture folder to the temporary root.
  const child = relative(temporaryRoot,resolve(directory));
  if(!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Fixture cleanup escaped temporary root');
  await rm(directory,{recursive:true,force:true});
}
console.log(`ASSERT kotodama_vectors=PASS (${words.length} words, ${vectorBytes.length} vector bytes, dimension ${DIMENSION})`);
