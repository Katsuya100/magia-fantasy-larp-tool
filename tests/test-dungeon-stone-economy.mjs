import assert from 'node:assert/strict';
import {num} from '../assets/js/dungeon-tuning.mjs';
import {magicStoneDropChance,magicStoneCountPerHit,dropCounts} from '../assets/js/dungeon-core.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {
 seededRandom,simulateProgression,simulateAllUltimate,summarizeStoneEconomy,
 MAGIC_STONES_PER_ULTIMATE,EQUIPPED_CIRCLES,ALL_ULTIMATE_COST
} from '../scripts/simulate-dungeon-stones.mjs';

assert.equal(MAGIC_STONES_PER_ULTIMATE,2915);
assert.equal(EQUIPPED_CIRCLES,5);
assert.equal(ALL_ULTIMATE_COST,14575);
const randomA=seededRandom(1234),randomB=seededRandom(1234);
assert.deepEqual(Array.from({length:4},()=>randomA()),
 Array.from({length:4},()=>randomB()),'seeded random sequence reproduces exactly');
assert.equal(simulateProgression(7213).stones,simulateProgression(7213).stones,'identical seed, identical stone result');
assert.equal(targetClearLevel(100),150);
// Read the live CSV-derived configuration. Shape is independently checked
// in test-dungeon-core; this suite validates stochastic payout and variance.
const chance=num('magic_stone_drop_chance');
const rolls=num('magic_stone_drop_rolls');
const maximum=num('magic_stone_drop_count_layer_150');
const endLayer=num('magic_stone_drop_curve_end_layer');
assert.equal(chance,.30,'the approved per-fight hit probability is 30%');
assert.equal(rolls,1,'exactly one independent stone attempt per fight');
assert.equal(magicStoneDropChance(150,1),chance);
assert.equal(magicStoneDropChance(150,endLayer+50),chance);
assert.equal(magicStoneCountPerHit(1),1);
assert.equal(magicStoneCountPerHit(endLayer),maximum);
assert.equal(magicStoneCountPerHit(endLayer+50),maximum);
const percentile=(sorted,p)=>sorted[Math.floor((sorted.length-1)*p)];
const sampleLayers=[1,2,Math.floor(endLayer/2),Math.floor(endLayer*.75),endLayer-1,
 endLayer,endLayer+1,endLayer+50];
for(const layer of [...new Set(sampleLayers)]){
 const rng=seededRandom(91000+layer),actual=[],samples=20000;
 const hitSize=magicStoneCountPerHit(layer);
 const expected=chance*hitSize;
 for(let i=0;i<samples;i++)actual.push(dropCounts(1,rng,{layer}).stone);
 actual.sort((a,b)=>a-b);
 const mean=actual.reduce((sum,n)=>sum+n,0)/samples;
 const f=hitSize-Math.floor(hitSize);
 const possible=new Set([0,Math.floor(hitSize),Math.ceil(hitSize)]);
 assert.ok(actual.every(n=>Number.isSafeInteger(n)&&possible.has(n)),
  'misses pay zero, hits pay either adjacent integer at F'+layer);
 const variance=chance*(1-chance)*hitSize**2+chance*f*(1-f);
 const tolerance=4*Math.sqrt(variance/samples)+.005;
 assert.ok(Math.abs(mean-expected)<tolerance,
  'measured mean agrees with the actual configured chance and hit size at F'+layer);
 const observedVariance=actual.reduce((sum,n)=>sum+(n-mean)**2,0)/samples;
 assert.ok(Math.abs(observedVariance-variance)<Math.max(.03,variance*.09),
  'measured variance agrees with independent Bernoulli and rounding law at F'+layer);
 const missRate=actual.filter(n=>n===0).length/samples;
 assert.ok(Math.abs(missRate-(1-chance))<.02,'observed hit frequency at F'+layer);
 if(layer===1)assert.equal(actual.at(-1),1);
 if(layer>=endLayer)assert.equal(actual.at(-1),maximum);
 if(layer===Math.floor(endLayer/2)&&f>.02&&f<.98){
  assert.ok(actual.includes(Math.floor(hitSize))&&actual.includes(Math.ceil(hitSize)),
   'fractional successful hit sizes use genuine stochastic rounding');
 }
 console.log('STONE_DISTRIBUTION',JSON.stringify({layer,expected,actual:{
  mean,variance:observedVariance,median:percentile(actual,.5),p90:percentile(actual,.9),max:actual.at(-1)}}));
}
for(const level of [1,30,80,149,150])for(const layer of [1,10,50,91,100,101,150]){
 assert.equal(magicStoneDropChance(level,layer,true),magicStoneDropChance(level,layer,false),
  'farming is not penalized by its first-clear status');
}

for(const seed of [1,11,1234,20261019]){
 const p=simulateProgression(seed);
 assert.ok(p.level>150,'repeated legitimate clears advance the player past level 150');
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
 assert.ok(p.milestones[9].level>=150,'the F91 milestone is not forced back to level 150');
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
assert.ok(summary.progression.earnedStones.mean>850&&
 summary.progression.earnedStones.mean<ALL_ULTIMATE_COST,
 'the authored 100F economy must support upgrades but not auto-fund all five ultimate circles');
assert.ok(summary.allFiveUltimate.farm101.sorties.mean>0,
 'all-five ultimate upgrades still need real additional farming');
assert.ok(summary.allFiveUltimate.farm91to100.sorties.mean>0);
console.log('PASS depth-growing magic stone drops and replay-compatible tiered upgrade economy');
