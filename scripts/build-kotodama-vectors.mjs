import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ATTRS } from '../assets/js/kotodama-attributes.js';
import { parseCanonicalWordsText, parseFrequencyWordsText } from './kotodama-lexicon.mjs';

export const DIMENSION = 50;
export const INPUT_RANK_LIMIT = 50000;
export const GLOVE_SOURCE = Object.freeze({
  url: 'https://huggingface.co/stanfordnlp/glove/resolve/1db2080b2d94def6e5b0386a523102f9d8849e9d/glove.6B.zip',
  revision: '1db2080b2d94def6e5b0386a523102f9d8849e9d',
  archiveSha256: '6471382cdd837544bf3ac72497a38715e845897d265b2b424b4761832009c837',
  archiveBytes: 862182753,
  file: 'glove.6B.50d.txt',
  bytes: 171350515,
  sha256: 'c99ba128d1efdaa3496b7542ba599ecdd1dd6679114d3b5ce19f0ec208b4aa5b',
  // ZIP offsets refer only to the immutable archive above; other dimensions are never fetched.
  compressedOffset: 792999879,
  compressedBytes: 69182505,
  license: 'PDDL-1.0',
  attribution: 'Jeffrey Pennington, Richard Socher, Christopher D. Manning. GloVe: Global Vectors for Word Representation (2014).',
});
export const VOCABULARY_SOURCES = Object.freeze({
  canonical: {
    file: 'canonical.txt',
    url: 'https://raw.githubusercontent.com/nlile/dictionary-word-list/842089dfe25f96fc872f3dc260419b02abc9c5a2/word_list_very_common_en_us_spelling_no_diacritic.txt',
    sha256: '25e627fbdfc293fea2104ca3739ab56d3e9ede7f0d6901fb7756abdd341fc44e',
  },
  frequency: {
    file: 'frequency.csv',
    url: 'https://raw.githubusercontent.com/filiph/english_words/4191ae1341c5e3dc640731c20f118746a51e7143/data/word-freq-top5000.csv',
    sha256: '87a73f5bca66862983dd430ba5d37129706f761291b433d33fcac8de117f66fc',
  },
});
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseVectorLine(line, lineNumber) {
  const parts = line.trim().split(/\s+/);
  if(parts.length !== DIMENSION + 1) throw new Error(`GloVe line ${lineNumber}: expected ${DIMENSION} dimensions`);
  const word = parts[0].toLowerCase();
  const vector = parts.slice(1).map(Number);
  if(vector.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
    throw new Error(`GloVe line ${lineNumber}: non-finite Float32 value`);
  }
  return {word,vector};
}

export async function buildVectors({
  sourcePath, outputDir, canonicalText, frequencyText, attributes = ATTRS,
  inputRankLimit = INPUT_RANK_LIMIT, expectedSourceHash, source = {}, vocabularySources = {},
}) {
  if(!Number.isSafeInteger(inputRankLimit) || inputRankLimit < 1) throw new Error('Input rank limit must be a positive integer');
  const canonicalWords = parseCanonicalWordsText(canonicalText);
  const frequencyRanks = parseFrequencyWordsText(frequencyText);
  if(!canonicalWords.size || !frequencyRanks.size) throw new Error('Selection vocabularies must not be empty');
  const requiredWords = new Set(Object.entries(attributes).flatMap(([name,attribute]) => [name,...attribute.words]));
  const input = createReadStream(sourcePath);
  const sourceHash = createHash('sha256');
  let sourceBytes = 0;
  input.on('data',chunk => {sourceHash.update(chunk);sourceBytes += chunk.length;});
  const seen = new Set();
  const words = [];
  const values = [];
  let lineNumber = 0;
  for await(const line of createInterface({input,crlfDelay:Infinity})) {
    if(!line.trim()) continue;
    lineNumber++;
    const {word,vector} = parseVectorLine(line,lineNumber);
    if(seen.has(word)) throw new Error(`Duplicate GloVe word at line ${lineNumber}: ${word}`);
    seen.add(word);
    // Retain every possible old frequency-gated candidate, including ones outside the input rank cutoff.
    if(!requiredWords.has(word) && !frequencyRanks.has(word) &&
      !(lineNumber <= inputRankLimit && canonicalWords.has(word))) continue;
    words.push(word);
    values.push(vector);
  }
  const actualSourceHash = sourceHash.digest('hex');
  if(expectedSourceHash && actualSourceHash !== expectedSourceHash) throw new Error('GloVe source SHA-256 mismatch');
  const retainedWords = new Set(words);
  const missingAttributes = [...requiredWords].filter(word => !retainedWords.has(word));
  if(missingAttributes.length) throw new Error(`Missing attribute words: ${missingAttributes.join(', ')}`);
  if(!words.length) throw new Error('No vectors selected');
  const vectorBytes = Buffer.alloc(words.length * DIMENSION * Float32Array.BYTES_PER_ELEMENT);
  for(let row=0;row<values.length;row++) {
    for(let column=0;column<DIMENSION;column++) vectorBytes.writeFloatLE(values[row][column],(row*DIMENSION+column)*4);
  }
  const wordBytes = Buffer.from(JSON.stringify(words)+'\n');
  const metadata = {
    formatVersion: 1, dimension: DIMENSION, wordCount: words.length, encoding: 'float32-le',
    files: {
      words: {file:'kotodama-vectors.words.json',bytes:wordBytes.length,sha256:hash(wordBytes)},
      vectors: {file:'kotodama-vectors.f32',bytes:vectorBytes.length,sha256:hash(vectorBytes)},
    },
    source: {...source,sha256:actualSourceHash,bytes:sourceBytes,wordCount:lineNumber},
    selection: {
      method: 'all attribute and frequency words plus canonical words within the source rank limit; source order; unchanged Float32 values',
      inputRankLimit, canonicalWordCount:canonicalWords.size, frequencyWordCount:frequencyRanks.size,
      requiredAttributeWords:[...requiredWords].sort(),
      missingFrequencyWords:[...frequencyRanks.keys()].filter(word => !seen.has(word)).sort(),
      vocabularySources,
    },
  };
  await mkdir(outputDir,{recursive:true});
  await writeFile(resolve(outputDir,metadata.files.words.file),wordBytes);
  await writeFile(resolve(outputDir,metadata.files.vectors.file),vectorBytes);
  await writeFile(resolve(outputDir,'kotodama-vectors.meta.json'),JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}

async function checkedDownload(url, destination, expectedHash) {
  const response = await fetch(url);
  if(!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if(hash(bytes) !== expectedHash) throw new Error(`Downloaded vocabulary SHA-256 mismatch: ${url}`);
  await writeFile(destination,bytes);
}

export async function downloadGlove(destination) {
  const {compressedOffset,compressedBytes} = GLOVE_SOURCE;
  const range = `${compressedOffset}-${compressedOffset+compressedBytes-1}`;
  const response = await fetch(GLOVE_SOURCE.url,{headers:{Range:`bytes=${range}`}});
  if(response.status !== 206 || response.headers.get('content-range') !== `bytes ${range}/${GLOVE_SOURCE.archiveBytes}`) {
    throw new Error('GloVe server did not return the requested immutable ZIP entry range');
  }
  const temporaryPath = `${destination}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body),createInflateRaw(),createWriteStream(temporaryPath));
    const bytes = await readFile(temporaryPath);
    if(bytes.length !== GLOVE_SOURCE.bytes || hash(bytes) !== GLOVE_SOURCE.sha256) throw new Error('Downloaded GloVe SHA-256 mismatch');
    await rename(temporaryPath,destination);
  } catch(error) {
    await rm(temporaryPath,{force:true});
    throw error;
  }
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name,fallback) => {
    const index = args.indexOf(name);
    if(index < 0) return fallback;
    if(!args[index+1] || args[index+1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[index+1];
  };
  const sourceDir = resolve(option('--source-dir','.tmp/kotodama-build'));
  const sourcePath = resolve(option('--source',resolve(sourceDir,GLOVE_SOURCE.file)));
  const outputDir = resolve(option('--output-dir','assets/data'));
  if(args.includes('--download')) {
    await mkdir(sourceDir,{recursive:true});
    await downloadGlove(sourcePath);
    for(const vocabulary of Object.values(VOCABULARY_SOURCES)) {
      await checkedDownload(vocabulary.url,resolve(sourceDir,vocabulary.file),vocabulary.sha256);
    }
  }
  const vocabularySources = {};
  const texts = {};
  for(const [name,vocabulary] of Object.entries(VOCABULARY_SOURCES)) {
    const bytes = await readFile(resolve(sourceDir,vocabulary.file));
    if(hash(bytes) !== vocabulary.sha256) throw new Error(`Local ${name} vocabulary SHA-256 mismatch`);
    texts[name] = bytes.toString('utf8');
    vocabularySources[name] = {...vocabulary,bytes:bytes.length};
  }
  const metadata = await buildVectors({sourcePath,outputDir,canonicalText:texts.canonical,frequencyText:texts.frequency,
    inputRankLimit:Number(option('--input-rank-limit',INPUT_RANK_LIMIT)),expectedSourceHash:GLOVE_SOURCE.sha256,
    source:GLOVE_SOURCE,vocabularySources});
  console.log(JSON.stringify(metadata,null,2));
}
