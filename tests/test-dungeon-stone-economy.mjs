import assert from 'node:assert/strict';
import {magicStoneDropChance} from '../assets/js/dungeon-core.mjs';
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
assert.equal(magicStoneDropChance(150,100),.3,'at-level floor 100 is 30% per fight');
assert.equal(magicStoneDropChance(150,101),.3,'level-151 enemies keep the capped hero eligible for full stone drops');
assert.equal(magicStoneDropChance(150,91),.3,'replayed floor 91 gives normal drops');
assert.equal(magicStoneDropChance(150,91,true),.3,'first and repeated clears pay equally');
for(const level of [1,30,80,149,150])for(const layer of [1,10,50,91,100,101]){
 assert.equal(magicStoneDropChance(level,layer,true),magicStoneDropChance(level,layer,false));
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
assert.ok(summary.progression.earnedStones.mean>600&&summary.progression.earnedStones.mean<1200);
assert.ok(summary.allFiveUltimate.farm101.sorties.mean>300);
assert.ok(summary.allFiveUltimate.farm91to100.sorties.mean>0);
console.log('PASS non-decaying magic stone farming and tiered 100-layer upgrade economy');
