// Regression: official strength is an actual fixed-deck battle comparison,
// aggregated for all one hundred floors, independent of candidate thresholds.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {referenceSpells,evaluateRecommendedFloor} from '../scripts/dungeon-fixed-deck-pair.mjs';
import {summarizeOfficialJourneyReadiness} from '../scripts/dungeon-test-contract.mjs';

const base=G.startingBase(()=>.5);
const circles=referenceSpells[0][0];
const hero=G.makeUnit(base,19,{},circles,'hero');
const original={layer:1,level:19,rank:0,playerBase:base,
 playerHp:hero.stats.hp,playerMp:hero.maxMp,
 maxHp:hero.stats.hp,maxMp:hero.maxMp,circles,
 carry:[],statuses:[],cooldowns:[0,0,0,0,0]};
const same=evaluateRecommendedFloor(original,1,0);
assert.equal(same.reference,'ORIGINAL_FIXED_DECK_SAME_CHARACTER');
assert.deepEqual(same.actual,same.fixed,
 'identical original spells must produce identical real five-fight outcomes');
assert.equal(same.actual.attempted,5);
assert.equal(same.ready,true,'a victorious identical loadout must meet its own benchmark');
const weakened={...original,circles:circles.map(c=>({...c,power:10,basePower:10,upgradeLevel:0}))};
const weaker=evaluateRecommendedFloor(weakened,1,0);
assert.equal(weaker.ready,false,'five spells without competitive combat strength cannot pass');
assert.ok(!weaker.actual.won||weaker.actual.casts>=same.actual.casts);

const seeds=Array.from({length:256},(_,i)=>17011+13*i);
const policy={style:'A',route:'short',accounts:seeds.map(seed=>({seed,blockers:[]})),
 floors:Array.from({length:100},(_,i)=>({layer:i+1,readiness:{
   firstEntryReady:256,firstEntryReadySeeds:[...seeds],
   additionalFarmingReady:0,prepared:256,missingSeeds:[]}}))};
const all=summarizeOfficialJourneyReadiness(policy,seeds);
assert.equal(all.length,10);
assert.ok(all.every(x=>x.prepared===256&&x.preparedBeforeFirstBandClear===256));
policy.floors[36].readiness.missingSeeds=[seeds[0]];
policy.floors[36].readiness.prepared=255;
policy.floors[36].readiness.firstEntryReady=255;
policy.floors[36].readiness.firstEntryReadySeeds=seeds.slice(1);
policy.accounts[0].blockers=['UNRESOLVED budget cutoff'];
const limited=summarizeOfficialJourneyReadiness(policy,seeds);
assert.equal(limited[3].prepared,255,'every floor, not just final boss, must be ready');
assert.equal(limited[3].unprepared,1);
assert.deepEqual(limited[3].missingAccounts[0].missingFloors,[37]);
assert.ok(limited[3].missingAccounts[0].reasons.includes('BUDGET_CUTOFF_NOT_PASS'));
assert.equal(limited[2].prepared,256,'unrelated floors retain their own proof');
// The old candidate can be arbitrarily changed without influencing formal
// eligibility: the formal evaluator accepts ONLY witnessed owner floor data.
const candidate=JSON.parse(readFileSync(new URL(
 '../config/dungeon-recommended-reference-candidate.v1.json',import.meta.url),'utf8'));
candidate.spells=['changed'];candidate.bands=['changed'];
assert.deepEqual(summarizeOfficialJourneyReadiness(policy,seeds),limited);
console.log('PASS real paired floor strength, complete 100-floor coverage, candidate independence and cutoff regression');
