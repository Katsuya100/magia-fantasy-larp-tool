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
assert.equal(magicStoneCountPerHit(100),8);
assert.equal(magicStoneCountPerHit(150),8);
assert.equal(magicStoneCountPerHit(151),8);
// Independently derive the approved exponential hit size: 1 at F1, 8 at F100,
// then a plateau. The game may probabilistically round a fractional hit.
const expectedHit=layer=>8**((Math.max(1,Math.min(100,layer))-1)/99);
for(let layer=1;layer<=200;layer++){
 const actual=magicStoneCountPerHit(layer);
 assert.ok(Math.abs(actual-expectedHit(layer))<1e-10,'independent stone depth curve at F'+layer);
 if(layer>1)assert.ok(actual>=magicStoneCountPerHit(layer-1),'stone hit size never decreases');
 if(layer>=100)assert.equal(actual,8,'F100+ drops plateau');
}
// Test the current integer payout against the specification-derived expectation.
// A Bernoulli 0/1 legacy comparison cannot model a multi-stone successful hit.
const percentile=(sorted,p)=>sorted[Math.floor((sorted.length-1)*p)];
for(const layer of [1,2,50,75,99,100,101,150]){
 const rng=seededRandom(91000+layer),actual=[],samples=20000;
 const expected=.30*expectedHit(layer);
 for(let i=0;i<samples;i++)actual.push(dropCounts(1,rng,{layer}).stone);
 actual.sort((a,b)=>a-b);
 const mean=actual.reduce((sum,n)=>sum+n,0)/samples;
 const possible=new Set([0,Math.floor(expectedHit(layer)),Math.ceil(expectedHit(layer))]);
 assert.ok(actual.every(n=>Number.isSafeInteger(n)&&possible.has(n)),
  'stone hits must be integer-sized, or zero on a missed roll at F'+layer);
 // Four standard errors plus a small numeric margin for deterministic Monte Carlo.
 const variance=.3*expectedHit(layer)**2-.09*expectedHit(layer)**2+
  .3*(expectedHit(layer)%1)*(1-expectedHit(layer)%1);
 const tolerance=4*Math.sqrt(variance/samples)+.005;
 assert.ok(Math.abs(mean-expected)<tolerance,
  'independent expected stone payout F'+layer+': '+mean+' vs '+expected);
 if(layer===1)assert.equal(actual.at(-1),1);
 if(layer>=100)assert.equal(actual.at(-1),8);
 if(layer===50){
  assert.ok(actual.includes(Math.floor(expectedHit(layer)))&&
   actual.includes(Math.ceil(expectedHit(layer))),
   'fractional hit sizes use genuine stochastic rounding');
 }
 console.log('STONE_DISTRIBUTION',JSON.stringify({layer,expected,actual:{
  mean,median:percentile(actual,.5),p90:percentile(actual,.9),max:actual.at(-1)}}));
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
assert.ok(summary.progression.earnedStones.mean>850&&
 summary.progression.earnedStones.mean<ALL_ULTIMATE_COST,
 'the authored 100F economy must support upgrades but not auto-fund all five ultimate circles');
assert.ok(summary.allFiveUltimate.farm101.sorties.mean>0,
 'all-five ultimate upgrades still need real additional farming');
assert.ok(summary.allFiveUltimate.farm91to100.sorties.mean>0);
console.log('PASS depth-growing magic stone drops and replay-compatible tiered upgrade economy');
