import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIMENSION, GLOVE_SOURCE, hash, parseVectorLine } from './build-kotodama-vectors.mjs';
import { inputBucket } from '../assets/js/kotodama-input-vectors.js';

export const INPUT_WORD_LIMIT = 400000;
export const INPUT_BUCKET_COUNT = 64;

// Input membership deliberately has no candidate dictionary, frequency, name or place gates.
export async function buildInputVectors({sourcePath, candidateWordsBytes, outputDir,
  expectedSourceHash, source = {}, wordLimit = INPUT_WORD_LIMIT, bucketCount = INPUT_BUCKET_COUNT}) {
  if(!Number.isSafeInteger(wordLimit) || wordLimit < 1 || !Number.isSafeInteger(bucketCount) || bucketCount < 1) throw new Error('Invalid input dictionary limits');
  const candidateWords = JSON.parse(candidateWordsBytes.toString('utf8'));
  const candidateSet = new Set(candidateWords);
  if(candidateSet.size !== candidateWords.length) throw new Error('Duplicate candidate vector words');
  const words = Array.from({length:bucketCount},()=>[]);
  const rows = Array.from({length:bucketCount},()=>[]);
  const seen = new Set();
  const input = createReadStream(sourcePath);
  const checksum = createHash('sha256');
  let sourceBytes=0, lineNumber=0, readableWordCount=0;
  input.on('data',chunk=>{checksum.update(chunk);sourceBytes+=chunk.length;});
  for await(const line of createInterface({input,crlfDelay:Infinity})) {
    if(!line.trim()) continue;
    const {word,vector}=parseVectorLine(line,++lineNumber);
    if(seen.has(word)) throw new Error(`Duplicate GloVe word: ${word}`);
    seen.add(word);
    if(lineNumber > wordLimit) continue;
    if(/^[a-z0-9_]+$/.test(word)) readableWordCount++;
    if(candidateSet.has(word)) continue;
    const bucket=inputBucket(word,bucketCount);
    words[bucket].push(word); rows[bucket].push(vector);
  }
  const actualHash=checksum.digest('hex');
  if(expectedSourceHash && actualHash!==expectedSourceHash) throw new Error('GloVe source SHA-256 mismatch');
  if(lineNumber<wordLimit) throw new Error('GloVe input word count below required limit');
  if(candidateWords.some(word=>!seen.has(word))) throw new Error('Candidate vector word absent from GloVe');
  const supplementalWordCount=words.reduce((sum,bucket)=>sum+bucket.length,0);
  if(supplementalWordCount+candidateWords.length!==wordLimit) throw new Error('Candidate vector words outside legacy input limit');
  await mkdir(outputDir,{recursive:true});
  const buckets=[];
  for(let bucket=0;bucket<bucketCount;bucket++) {
    const bytes=Buffer.alloc(rows[bucket].length*DIMENSION*4);
    rows[bucket].forEach((row,i)=>row.forEach((value,j)=>bytes.writeFloatLE(value,(i*DIMENSION+j)*4)));
    const file=`kotodama-input-${String(bucket).padStart(2,'0')}.f32`;
    await writeFile(resolve(outputDir,file),bytes);
    buckets.push({file,bytes:bytes.length,sha256:hash(bytes),wordCount:words[bucket].length});
  }
  const indexBytes=Buffer.from(JSON.stringify(words)+'\n');
  const metadata={formatVersion:1,encoding:'float32-le',dimension:DIMENSION,
    totalWordCount:wordLimit,supplementalWordCount,readableWordCount,bucketCount,
    candidateWordsSha256:hash(candidateWordsBytes),
    files:{index:{file:'kotodama-input.index.json',bytes:indexBytes.length,sha256:hash(indexBytes)}},buckets,
    source:{...source,sha256:actualHash,bytes:sourceBytes,wordCount:lineNumber},
    method:'First 400000 original GloVe rows; no candidate gates; retain original Float32 values; reuse candidate vector rows; FNV-1a UTF-16 hash buckets in original source order',
  };
  await writeFile(resolve(outputDir,metadata.files.index.file),indexBytes);
  await writeFile(resolve(outputDir,'kotodama-input.meta.json'),JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const outputDir=resolve(option('--output-dir','assets/data'));
  const metadata=await buildInputVectors({sourcePath:resolve(option('--source','.tmp/kotodama-build/glove.6B.50d.txt')),
    candidateWordsBytes:await readFile('assets/data/kotodama-vectors.words.json'),outputDir,
    expectedSourceHash:GLOVE_SOURCE.sha256,source:GLOVE_SOURCE});
  console.log(JSON.stringify(metadata,null,2));
}
