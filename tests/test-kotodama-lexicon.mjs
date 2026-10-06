import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NAME_WORD_ALLOWLIST, PLACE_WORD_ALLOWLIST } from '../scripts/kotodama-lexicon.mjs';
import { buildLexicon } from '../scripts/build-kotodama-lexicon.mjs';

const texts = {
  canonical:'fire\nking\nriver\nalex\nlondon\nbanned\nunknown\n',
  frequency:'rank,word\n1,king\n2,alex\n3,river\n4,fire\n5,london\n6,banned\n7,unknown\n',
  forbidden:'banned\na phrase\n', names:'Alex\nKing\n',
  places:JSON.stringify({features:[{properties:{name:'London',nameascii:'River'}}]}),
  cities:JSON.stringify([{name:'Alex',asciiname:'River'}]),
};
const words=['fire','river','alex','king','london','banned','unknown','unlisted'];
const result=buildLexicon(words,texts,'abc');
assert.deepEqual(result.candidates,['king','river','fire','unknown'], 'retain ordinary name/place allowlist words, reject names/places/profanity');
assert.deepEqual(result.forbidden,['banned']);
assert.deepEqual(result.frequencyRanks,[['fire',4],['river',3],['alex',2],['king',1],['london',5],['banned',6],['unknown',7]]);
assert.deepEqual(buildLexicon(words,texts,'abc'),result,'same sources must produce identical catalog');
assert.throws(()=>buildLexicon([...words,'fire'],texts,'abc'),/unique/);
assert.throws(()=>buildLexicon(words,{...texts,places:'invalid'},'abc'),/Malformed/);
assert.throws(()=>buildLexicon(words,{...texts,cities:'invalid'},'abc'),/Malformed/);
assert.throws(()=>buildLexicon(words,{...texts,frequency:''},'abc'),/empty/);
console.log('PASS_KOTODAMA_LEXICON_CANDIDATE_GATES_AND_REPRODUCIBILITY');

const original=JSON.parse(await readFile(new URL('../fixtures/kotodama/candidate-allowlists.json',import.meta.url),'utf8'));
assert.deepEqual([...NAME_WORD_ALLOWLIST],original.names,'all original name exceptions and their order remain intact');
assert.deepEqual([...PLACE_WORD_ALLOWLIST],original.places,'all original place/political/fantasy exceptions remain intact');
const exceptions=[...new Set([...original.names,...original.places])];
const exceptionInputs={canonical:exceptions.join('\n'),frequency:'rank,word\n'+exceptions.map((word,i)=>(i+1)+','+word).join('\n'),
 forbidden:'',names:original.names.join('\n'),places:JSON.stringify({features:original.places.map(name=>({properties:{name}}))}),cities:'[]'};
const allowed=buildLexicon(exceptions,exceptionInputs,'fixture');
assert.deepEqual(allowed.candidates,exceptions,'name/place exceptions pass when the other old gates pass');
for(const word of ['turkey','orange','reading','mobile','nice','river','storm','king','queen','empire','state']) assert.ok(allowed.candidates.includes(word),word);
console.log('PASS_ORIGINAL_ALLOWLISTS_AND_CONDITIONAL_EXCEPTIONS');
