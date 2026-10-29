import assert from 'node:assert/strict';
import * as G from '../assets/js/dungeon-core.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {assessRecommendedStrength,strengthBands} from '../scripts/dungeon-recommended-strength.mjs';
import {referenceSpells} from '../scripts/dungeon-fixed-deck-reference.mjs';
import {summarizeJourneyStrength} from '../scripts/dungeon-test-contract.mjs';

const base=G.startingBase(()=>.5);
const owner=(bandIndex,overrides={})=>{
 const band=strengthBands[bandIndex],fixed=referenceSpells[bandIndex][0];
 return {style:'A',route:'short',level:band.recommendedLevel,
  bankedBestLayer:band.to,playerBase:{...base},
  circles:fixed.map(circle=>({...circle})),carry:[],...overrides};
};

// Compare the exact same baseline input to itself in every band. Some fixed
// references cannot complete this deliberately conservative formula path;
// those rows must stay unpassed rather than serving as an invalid denominator.
const selfComparisons=strengthBands.map((band,index)=>
 assessRecommendedStrength(owner(index),index,0));
const equal=selfComparisons[0];
assert.equal(equal.passed,true,equal.reasons.join(','));
assert.equal(equal.actual.excessDamage,0);
assert.equal(equal.actual.damageTaken,equal.reference.damageAllowed);
assert.equal(equal.actual.totalMpBurden,equal.reference.mpBurden);
assert.equal(equal.actual.completedEnemies,50);
assert.match(equal.methodology.scopeLimit,/not game AI.*or a new battle proof/);
assert.equal(equal.reference.opponents.length,50);
assert.ok(equal.reference.floors.every(row=>row.enemies.length===5));
for(const [index,result] of selfComparisons.entries()){
 assert.equal(result.actual.attackFeasible,result.reference.attackFeasible,
  'identical fixed-deck inputs must have identical formula feasibility in '+strengthBands[index].from+'-'+strengthBands[index].to);
 assert.equal(result.actual.completedEnemies,result.reference.completedEnemies);
 assert.equal(result.actual.damageTaken,result.reference.damageTaken);
 assert.equal(result.actual.totalMpBurden,result.reference.mpBurden);
 if(!result.reference.attackFeasible){
  assert.ok(result.reasons.includes('REFERENCE_FORMULA_PATH_INCOMPLETE'));
  assert.equal(result.passed,false,'an incomplete reference cannot certify itself');
 }
}

// The input can represent a low-level owner with genuinely stronger paid
// circles and a high-level owner with weak circles; level alone is not a gate.
const fixed=referenceSpells[0][0];
const strong=fixed.map((circle,index)=>{
 const upgrades=index<3?8:0;
 return {...circle,basePower:circle.basePower??circle.power,
  upgradeLevel:upgrades,
  power:index<3?strengthenedPower(circle.basePower??circle.power,upgrades):
   circle.power};
});
const low=assessRecommendedStrength(owner(0,{level:1,circles:strong}),0,0);
const weak=fixed.map(circle=>({...circle,basePower:10,power:10,upgradeLevel:0}));
const high=assessRecommendedStrength(owner(0,{level:150,circles:weak}),0,0);
assert.equal(low.actual.level,1);
assert.equal(high.actual.level,150);
assert.ok(!low.reasons.some(reason=>reason.includes('LEVEL')));
assert.ok(!high.reasons.some(reason=>reason.includes('LEVEL')));

// A deck without attacks must expose the real basic-attack/action-limit
// constraint instead of being passed from its level or nominal power.
const noAttacks=fixed.map(circle=>({...circle,role:'support',basePower:10,
 power:10,upgradeLevel:0}));
const insufficient=assessRecommendedStrength(owner(0,{circles:noAttacks}),0,0);
assert.equal(insufficient.actual.completedEnemies<50,true);
assert.ok(insufficient.reasons.includes('INSUFFICIENT_ATTACKS_WITHIN_80_TURNS')||
 insufficient.reasons.includes('PLAYER_HP_DEPLETED'));

// Actual carried stock is consumed only in a local copy. It keeps its exact
// instance identity and reports shipped HP/MP effects separately.
const itemOwner=owner(0,{level:strengthBands[0].recommendedLevel,
 carry:[{id:'heal_xl',value:1000,bonus:null,instanceId:'owned-heal-1'}]});
const saved=structuredClone(itemOwner);
const withItem=assessRecommendedStrength(itemOwner,0,0);
assert.deepEqual(itemOwner,saved,'calculator must not consume or mutate real-owner stock');
assert.ok(withItem.actual.itemRecovery.uses.every(use=>use.instanceId===undefined));
assert.ok(Number.isFinite(withItem.actual.itemRecovery.healing));
assert.ok(Number.isFinite(withItem.actual.itemRecovery.mpRestored));
assert.equal(withItem.actual.itemRecovery.uses.length<=1,true);

// A formal cutoff or missing legal owner remains unproven and cannot inherit
// a legacy 255/256 rank or a previous per-floor battle result.
const seeds=Array.from({length:256},(_,i)=>17011+13*i);
const policy={style:'C',route:'long',samples:256,journeyStrength:Array.from({length:10},(_,i)=>({
 band:(i*10+1)+'-'+(i*10+10),completion:256,
 owners:seeds.map(seed=>({seed,status:'REACHED',lastAssessment:{reasons:[]}}))}))};
policy.journeyStrength[7].owners[255]={seed:seeds[255],
 status:'UNREACHED_NO_LEGAL_BANKED_SNAPSHOT',lastAssessment:null};
const rows=summarizeJourneyStrength(policy,seeds);
assert.equal(rows[7].reached,255);
assert.equal(rows[7].unreached,1);
assert.equal(rows[7].legacyResults,'NOT_CARRIED_FORWARD_OR_RELABELLED');
assert.equal(rows[7].status,'RECOMMENDED_STRENGTH_NOT_REACHED_OR_UNPROVEN');

console.log('PASS formula-only fixed-deck comparison, legal action limits, level-independent loadouts and real carried-item accounting');
