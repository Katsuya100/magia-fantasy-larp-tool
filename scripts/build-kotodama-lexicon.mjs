import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseCanonicalWordsText, parseFrequencyWordsText, parseForbiddenListText,
  parseNameWordsText, parsePlaceWordsText, parseGeoNamesPlacesJson, mergeWordSets,
  selectCandidates,
} from './kotodama-lexicon.mjs';

export const LEXICON_SOURCES = Object.freeze({
  "canonical": {
    "file": "canonical.txt",
    "url": "https://raw.githubusercontent.com/nlile/dictionary-word-list/842089dfe25f96fc872f3dc260419b02abc9c5a2/word_list_very_common_en_us_spelling_no_diacritic.txt",
    "sha256": "25e627fbdfc293fea2104ca3739ab56d3e9ede7f0d6901fb7756abdd341fc44e"
  },
  "frequency": {
    "file": "frequency.csv",
    "url": "https://raw.githubusercontent.com/filiph/english_words/4191ae1341c5e3dc640731c20f118746a51e7143/data/word-freq-top5000.csv",
    "sha256": "87a73f5bca66862983dd430ba5d37129706f761291b433d33fcac8de117f66fc"
  },
  "forbidden": {
    "file": "profanity.txt",
    "url": "https://raw.githubusercontent.com/dsojevic/profanity-list/c27924319aa9bd6f917e3782b4f4b6604a50b652/en.txt",
    "sha256": "2eebcd97d34e45972b86f5631bc6d970aaed580cd9def3ce1ae4ee58e031a2c6"
  },
  "names": {
    "file": "names.txt",
    "url": "https://raw.githubusercontent.com/FinNLP/humannames/515e406650b9f8b2b9b5b3f833e8e4b3b1fb07ed/list.txt",
    "sha256": "e3dcba235a5d53dd60fdf1055438d999684ba9b991f5e2897f359c9bfe44083c"
  },
  "places": {
    "file": "places.geojson",
    "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_populated_places_simple.geojson",
    "sha256": "fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f"
  },
  "cities": {
    "file": "cities.json",
    "url": "https://raw.githubusercontent.com/lmfmaier/cities-json/aed0822519df832873f6cca8e05d5224c418e657/cities500.json",
    "sha256": "d9d3cd0b013dda20351fbe32fade487ffbaf846be5a2034a3b9e37fb551e2c88"
  }
});
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function buildLexicon(words, texts, vectorWordsSha256){
  if(!Array.isArray(words) || words.some(word => typeof word !== 'string') || new Set(words).size !== words.length){
    throw new Error('Vector words must be unique strings');
  }
  const canonicalWords = parseCanonicalWordsText(texts.canonical);
  const frequencyRanks = parseFrequencyWordsText(texts.frequency);
  const forbiddenWords = parseForbiddenListText(texts.forbidden);
  const nameWords = parseNameWordsText(texts.names);
  const placeWords = mergeWordSets(parsePlaceWordsText(texts.places),parseGeoNamesPlacesJson(texts.cities));
  if(!canonicalWords.size || !frequencyRanks.size) throw new Error('Required candidate dictionaries are empty');
  const candidates = selectCandidates(words, {canonicalWords,frequencyRanks,forbiddenWords,nameWords,placeWords});
  return {
    formatVersion:1, vectorWordsSha256,
    candidates, forbidden:[...forbiddenWords].sort(),
    frequencyRanks:words.filter(word => frequencyRanks.has(word)).map(word => [word,frequencyRanks.get(word)]),
  };
}

export async function buildLexiconFiles({sourceDir, wordsPath, outputDir}){
  const wordBytes = await readFile(wordsPath);
  const words = JSON.parse(wordBytes);
  const texts = {};
  const sources = {};
  for(const [name,source] of Object.entries(LEXICON_SOURCES)){
    const bytes = await readFile(resolve(sourceDir,source.file));
    if(hash(bytes) !== source.sha256) throw new Error(`Local ${name} vocabulary SHA-256 mismatch`);
    texts[name] = bytes.toString('utf8');
    sources[name] = {...source,bytes:bytes.byteLength,sha256:hash(bytes)};
  }
  const lexicon = buildLexicon(words,texts,hash(wordBytes));
  const bytes = Buffer.from(JSON.stringify(lexicon)+'\n');
  const metadata = {
    formatVersion:1, method:'scripts/build-kotodama-lexicon.mjs; preserved candidate gates, fixed Natural Earth + GeoNames JSON snapshot',
    candidateFrequencyLimit:5000, randomInkFrequencyLimit:3000, candidateCount:lexicon.candidates.length,
    file:{file:'kotodama-lexicon.json',bytes:bytes.length,sha256:hash(bytes)}, sources,
  };
  await mkdir(outputDir,{recursive:true});
  await writeFile(resolve(outputDir,metadata.file.file),bytes);
  await writeFile(resolve(outputDir,'kotodama-lexicon.meta.json'),JSON.stringify(metadata,null,2)+'\n');
  return metadata;
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  const option=(name,fallback) => {
    const index=args.indexOf(name);
    if(index < 0) return fallback;
    if(!args[index+1] || args[index+1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[index+1];
  };
  const sourceDir=resolve(option('--source-dir','.tmp/kotodama-build'));
  const wordsPath=resolve(option('--words','assets/data/kotodama-vectors.words.json'));
  const outputDir=resolve(option('--output-dir','assets/data'));
  if(args.includes('--download')){
    await mkdir(sourceDir,{recursive:true});
    for(const source of Object.values(LEXICON_SOURCES)){
      const response=await fetch(source.url);
      if(!response.ok) throw new Error(`Vocabulary download failed: ${response.status} ${source.url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if(hash(bytes) !== source.sha256) throw new Error('Downloaded vocabulary SHA-256 mismatch: ' + source.url);
      await writeFile(resolve(sourceDir,source.file),bytes);
    }
  }
  console.log(JSON.stringify(await buildLexiconFiles({sourceDir,wordsPath,outputDir}),null,2));
}
