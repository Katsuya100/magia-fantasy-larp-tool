import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadKotodamaData } from '../assets/js/kotodama-data.js';
import { createKotodamaScoring, cosine, norm, pctFromCos } from '../assets/js/kotodama-scoring.js';
import { repositoryFetch } from './kotodama-harness.mjs';

const baseline=JSON.parse(await readFile(new URL('../fixtures/kotodama/scoring-baseline.json',import.meta.url),'utf8'));
const data=await loadKotodamaData({fetchFn:repositoryFetch,storage:null});
const scoring=createKotodamaScoring(data);
scoring.ensureAttributeFallbacks();
for(const {input,scoring:expected} of baseline.cases){
  if(expected.error){assert.throws(()=>scoring.parseSpell(input),error=>error.message===expected.error);continue;}
  const {vec,used,raw}=scoring.parseSpell(input);
  const exclude=new Set(used.map(item=>item.word));
  assert.deepEqual({raw,used,vec:Array.from(vec),scores:scoring.attrScores(vec,used),
    nearest:scoring.nearestWords(vec,exclude,8),inverse:scoring.nearestWords(vec.map(x=>-x),exclude,8)},expected,input);
}
assert.equal(cosine([0,0],[0,0]),0);
assert.deepEqual(norm([0,0]),[0,0]);
assert.equal(pctFromCos(-2),0);
assert.equal(pctFromCos(2),1);
const forbidden=[...data.forbiddenWords].find(word=>data.vectors.has(word));
assert.ok(forbidden);
assert.throws(()=>scoring.parseSpell(forbidden),/封じられた/);
console.log('PASS_KOTODAMA_SCORING_ORIGINAL_BASELINE_14_SPELLS_AND_NEIGHBOURS');
