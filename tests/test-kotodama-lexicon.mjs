import assert from 'node:assert/strict';
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
