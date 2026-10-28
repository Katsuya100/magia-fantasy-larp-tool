import assert from 'node:assert/strict';
import {magicStoneDropChance,magicStoneCountPerHit,dropCounts} from '../assets/js/dungeon-core.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {
 seededRandom,simulateProgression,simulateAllUltimate,summarizeStoneEconomy,
 MAGIC_STONES_PER_ULTIMATE,EQUIPPED_CIRCLES,ALL_ULTIMATE_COST
} from '../scripts/simulate-dungeon-stones.mjs';

assert.equal(MAGIC_STONES_PER_ULTIMATE,1030);
assert.equal(EQUIPPED_CIRCLES,5);
assert.equal(ALL_ULTIMATE_COST,5150);
const randomA=seededRandom(1234),randomB=seededRandom(1234);
assert.deepEqual(Array.from({length:4},()=>randomA()),
 Array.from({length:4},()=>randomB()),'seeded random sequence reproduces exactly');
assert.equal(simulateProgression(7213).stones,simulateProgression(7213).stones,'identical seed, identical stone result');
assert.equal(targetClearLevel(100),150);
assert.equal(magicStoneDropChance(150,1),.3);
assert.equal(magicStoneDropChance(150,150),.3);
assert.equal(magicStoneDropChance(150,151),.3);
assert.equal(magicStoneCountPerHit(1),1);
assert.equal(magicStoneCountPerHit(150),3);
assert.equal(magicStoneCountPerHit(151),3);
assert.ok(magicStoneCountPerHit(100)>2);
for(let layer=1;layer<150;layer++)
 assert.ok(magicStoneCountPerHit(layer+1)>magicStoneCountPerHit(layer));
// Publish the actual before/after distribution at representative depths.
const percentile=(sorted,p)=>sorted[Math.floor((sorted.length-1)*p)];
for(const layer of [1,50,100,150]){
 const rng=seededRandom(91000+layer),oldRng=seededRandom(92000+layer);
 const actual=[],previous=[],samples=20000,expected=.3*magicStoneCountPerHit(layer);
 for(let i=0;i<samples;i++){
  actual.push(dropCounts(1,rng,{layer}).stone);
  previous.push(oldRng()<expected?1:0);
 }
 actual.sort((a,b)=>a-b);previous.sort((a,b)=>a-b);
 const mean=v=>v.reduce((sum,n)=>sum+n,0)/v.length;
 assert.ok(Math.abs(mean(actual)-expected)<.025,'actual stone expectation '+layer);
 assert.ok(Math.abs(mean(actual)-mean(previous))<.03,'unchanged expected stone economy '+layer);
 assert.ok(actual.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=3));
 if(layer===150)assert.equal(actual.at(-1),3);
 console.log('STONE_DISTRIBUTION',JSON.stringify({layer,previous:{
  mean:mean(previous),median:percentile(previous,.5),p90:percentile(previous,.9),max:previous.at(-1)},
  actual:{mean:mean(actual),median:percentile(actual,.5),p90:percentile(actual,.9),max:actual.at(-1)}}));
}
for(const level of [1,30,80,149,150])for(const layer of [1,10,50,91,100,101,150]){
 assert.equal(magicStoneDropChance(level,layer,true),magicStoneDropChance(level,layer,false),
  'farming is not penalized by its first-clear status');
}

for(const seed of [1,11,1234,20261019]){
 const p=simulateProgression(seed);
 assert.equal(p.level,150);
 assert.equal(p.rank,100);
 assert.equal(p.returns,100,'one banked return per newly conquered layer');
 assert.equal(p.layerClears,550,'rank-gated repeats are accounted for');
 assert.equal(p.repeatedLayerClears,450);
 assert.equal(p.fights,2750);
 assert.equal(p.underleveledStarts,0,'each new layer begins at its recommended level');
 assert.equal(p.milestones.length,10,'one milestone per rank');
 assert.equal(p.milestones[0].start,1);
 assert.equal(p.milestones[1].start,11);
 assert.equal(p.milestones[9].start,91);
 assert.equal(p.milestones[9].level,150);
 assert.ok(p.evenFiveLevels.reduce((sum,levels)=>sum+totalUpgradeStoneCost(levels),0)<=p.stones);
 assert.equal(p.evenFiveLevels.length,5);
 assert.equal(p.possibleUltimateCircles,Math.min(5,Math.floor(p.stones/MAGIC_STONES_PER_ULTIMATE)));
 for(const strategy of ['endless','revisit']){
  const result=simulateAllUltimate(seed,{farming:strategy});
  assert.deepEqual(result.progression,p);
  assert.ok(result.totalStones>=ALL_ULTIMATE_COST);
  assert.equal(result.spent,ALL_ULTIMATE_COST);
  assert.equal(result.remaining,result.totalStones-ALL_ULTIMATE_COST);
  assert.equal(result.farmStones,result.totalStones-p.stones);
  assert.equal(result.totalSorties,100+result.farmSorties);
  assert.equal(result.totalFights,2750+result.farmFights);
  assert.ok(result.farmSorties>0);
  assert.equal(result.farmFights/result.farmSorties,strategy==='endless'?5:50);
 }
}
assert.throws(()=>simulateAllUltimate(1,{farming:'unknown'}),/Unknown farm route/);
assert.throws(()=>summarizeStoneEconomy(0),/Samples/);
const summary=summarizeStoneEconomy(16,300);
assert.equal(summary.progression.returns,100);
assert.equal(summary.progression.layerClears,550);
assert.equal(summary.progression.fights,2750);
assert.equal(summary.allFiveUltimate.cost,ALL_ULTIMATE_COST);
assert.ok(summary.progression.earnedStones.mean>850&&summary.progression.earnedStones.mean<2200,
 'the new positive drop curve must not starve the 100F campaign or overrun the stone economy');
assert.ok(summary.allFiveUltimate.farm101.sorties.mean>300);
assert.ok(summary.allFiveUltimate.farm91to100.sorties.mean>0);
console.log('PASS depth-growing magic stone drops and replay-compatible tiered upgrade economy');
