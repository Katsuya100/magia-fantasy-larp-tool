import assert from 'node:assert/strict';
import * as G from '../assets/js/dungeon-core.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {assessRecommendedStrength,recommendedReferenceCarry,strengthBands} from '../scripts/dungeon-recommended-strength.mjs';
import {referenceSpells} from '../scripts/dungeon-fixed-deck-reference.mjs';
import {summarizeJourneyStrength} from '../scripts/dungeon-test-contract.mjs';
import {runJourney} from '../scripts/simulate-dungeon-journeys.mjs';

const base=G.startingBase(()=>.5);
const owner=(bandIndex,overrides={})=>{
 const band=strengthBands[bandIndex],fixed=referenceSpells[bandIndex][0];
 return {style:'A',route:'short',level:band.recommendedLevel,
  bankedBestLayer:band.to,playerBase:{...base},
  circles:fixed.map(circle=>({...circle})),carry:recommendedReferenceCarry(bandIndex),...overrides};
};

// Equal fixed-deck inputs must reach the numeric reference threshold, even
// when the shadow HP ledger crosses zero during the 50 authored targets.
const selfComparisons=strengthBands.map((band,index)=>
 assessRecommendedStrength(owner(index),index,0));
const equal=selfComparisons[0];
assert.equal(equal.passed,true,equal.reasons.join(','));
assert.equal(equal.actual.excessDamage,0);
assert.equal(equal.actual.damageTaken,equal.reference.rawDamageAllowed);
assert.equal(equal.actual.netDamage,equal.reference.damageAllowed);
assert.equal(equal.actual.totalMpBurden,equal.reference.mpBurden);
assert.equal(equal.actual.targetsProcessed,50);
assert.match(equal.methodology.scopeLimit,/not a completed battle.*new battle proof/);
assert.equal(equal.reference.opponents.length,50);
assert.ok(equal.reference.floors.every(row=>row.enemies.length===5));
assert.ok(selfComparisons[1].reference.supportActions>0,
 'fixed player policy uses its available support circle after layer 10');
assert.ok((selfComparisons[1].reference.enemyActionsByRole.defense||0)+
 (selfComparisons[1].reference.enemyActionsByRole.support||0)+
 (selfComparisons[1].reference.enemyActionsByRole.debuff||0)>0,
 'enemy role selection follows G.chooseEnemySpell, not a forced direct attack');
for(const [index,result] of selfComparisons.entries()){
 assert.equal(result.actual.numericTargetsCovered,true,
  'the numeric ledger must cover all 50 authored targets in '+strengthBands[index].from+'-'+strengthBands[index].to);
 assert.equal(result.reference.numericTargetsCovered,true);
 assert.equal(result.actual.targetsProcessed,50);
 assert.equal(result.reference.targetsProcessed,50);
 assert.equal(result.actual.damageTaken,result.reference.damageTaken);
 assert.equal(result.actual.netDamage,result.reference.damageAllowed);
 assert.equal(result.actual.totalMpBurden,result.reference.mpBurden);
 assert.equal(result.actual.shadowHpDepleted,result.reference.shadowHpDepleted);
 assert.equal(result.passed,true,'equal fixed reference reaches at the equality boundary');
}
// Historical boundary: seed 17011, 11–20F was 50/50 in the fixed simulator
// but stopped at 33/50 in v1. The current G.round ledger still resolves the
// same 50 targets; this diagnostic is not a journey pass gate.
const fixed50Boundary=selfComparisons[1];
assert.equal(fixed50Boundary.seed,17011);
assert.equal(fixed50Boundary.reference.targetsProcessed,50);
assert.equal(fixed50Boundary.reference.completedEnemies,50);
assert.ok(fixed50Boundary.reference.attackMp>0);
assert.equal(fixed50Boundary.actual.completedEnemies,50);
const nonKillReference=assessRecommendedStrength(owner(1,{playerBase:{...base,hp:1}}),1,0);
assert.ok(nonKillReference.reference.completedEnemies<50);
assert.equal(nonKillReference.reference.numericTargetsCovered,true);
assert.equal(nonKillReference.passed,true,
 'formula-kill count does not act as a battle-clear gate at the equality boundary');
const lowHpReference=assessRecommendedStrength(owner(0,{playerBase:{...base,hp:1}}),0,0);
assert.equal(lowHpReference.reference.shadowHpDepleted,true);
assert.equal(lowHpReference.reference.numericTargetsCovered,true,
 'shadow HP depletion remains diagnostic and does not block numeric coverage');
assert.ok(lowHpReference.reference.damageTaken>lowHpReference.reference.damageTakenToHp,
 'numeric incoming damage records uncapped exposure after shadow HP reaches zero');
assert.equal(lowHpReference.passed,true,'equal low-HP baseline reaches its numeric boundary');

// The input can represent low-level strong circles and high-level weak circles;
// level alone is not a gate. Full audits use only legal banked owner snapshots.
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

// Even when current MP cannot pay for every excess-damage recovery cast, the
// calculator reports the exact legal cast budget and leaves the shortage unmet.
const weakBandDeck=referenceSpells[1][0].map(circle=>({...circle,basePower:10,
 power:10,upgradeLevel:0}));
const recoveryBudget=assessRecommendedStrength(owner(1,{circles:weakBandDeck}),1,0);
assert.equal(recoveryBudget.actual.numericTargetsCovered,true);
assert.ok(recoveryBudget.actual.rawExcessDamage>0);
assert.ok(recoveryBudget.actual.magicRecovery.mp>0);
assert.equal(recoveryBudget.actual.magicRecovery.healingPossible,true);
assert.equal(recoveryBudget.actual.magicRecovery.funded,false);
assert.ok(recoveryBudget.actual.magicRecovery.unfundedMp>0);
assert.ok(recoveryBudget.reasons.includes('MP_RESOURCE_SHORTAGE'));
assert.equal(recoveryBudget.actual.totalMpBurden,
 recoveryBudget.actual.attackMp+recoveryBudget.actual.survivalSupportMp+
 recoveryBudget.actual.magicRecovery.mp,
 'the burden includes paid attacks, survival support, and recovery casts');
assert.ok(recoveryBudget.actual.mpShortfall>0,
 'a virtual healing clone cannot count unfunded recovery MP as supplied');

// A deck without attacks still reports 50 target metrics. Its formula kills
// and per-target action-limit failures remain diagnostics, not battle gates.
const noAttacks=fixed.map(circle=>({...circle,role:'support',basePower:10,
 power:10,upgradeLevel:0}));
const insufficient=assessRecommendedStrength(owner(0,{playerBase:{...base,hp:1},
 circles:noAttacks}),0,0);
assert.equal(insufficient.actual.completedEnemies<50,true);
assert.equal(insufficient.actual.numericTargetsCovered,true);
assert.equal(insufficient.actual.targetsProcessed,50);
assert.equal(insufficient.actual.attackMp,0,
 'basic fallback costs no MP under the existing combat rules');
assert.ok(insufficient.actual.basicAttackActions>0,
 'basic fallbacks remain visible next to the paid attack-MP total');
assert.equal(insufficient.passed,false,
 'unresolved targets and missing recovery resources cannot be hidden by removing a kill gate');
assert.ok(insufficient.reasons.includes('MP_RESOURCE_SHORTAGE'));
assert.equal(insufficient.actual.magicRecovery.healingPossible,false,
 'recovery can be unavailable separately from an MP shortage');
assert.ok(!insufficient.reasons.includes('INSUFFICIENT_ATTACKS_WITHIN_80_TURNS'));
assert.ok(insufficient.actual.floors.some(floor=>floor.infeasibleEnemies.length>0));

// One legal item from the banked snapshot reduces excess damage once, keeps
// its real instance identity, and never mutates the input.
const itemOwner=owner(1,{circles:weakBandDeck,
 carry:[{id:'heal_xl',value:1000,bonus:null,instanceId:'owned-heal-1'}]});
const saved=structuredClone(itemOwner);
const withItem=assessRecommendedStrength(itemOwner,1,0);
assert.deepEqual(itemOwner,saved,'calculator must not consume or mutate real-owner stock');
assert.ok(Number.isFinite(withItem.actual.itemRecovery.healing));
assert.ok(Number.isFinite(withItem.actual.itemRecovery.mpRestored));
assert.equal(withItem.actual.itemRecovery.uses.length,1);
assert.equal(withItem.actual.itemRecovery.uses[0].instanceId,'owned-heal-1');
assert.equal(withItem.actual.itemRecovery.uses[0].itemId,'heal_xl');
assert.equal(withItem.actual.itemRecovery.uses[0].kind,'heal');
assert.equal(withItem.actual.itemRecovery.uses[0].healing,withItem.actual.itemRecovery.healing);
assert.equal(new Set(withItem.actual.itemRecovery.uses.map(use=>use.instanceId)).size,1);
assert.ok(withItem.actual.magicRecovery.unfundedMp>0,
 'the item funds its shipped HP effect, not virtual recovery MP');

// Select a deterministic real-loss owner: no injected defeat, free restitution,
// synthetic snapshot or relaxed reaching condition is permitted.
const candidateSeeds=[17011,17154,20261024,17024,17037,17167,17200,17300];
let witnessed=null;
for(const seed of candidateSeeds){
 const run=runJourney(seed,{style:'A',route:'long',maxSorties:600,
  maxFights:6500,observeStrength:true});
 const defeat=run.trace.find(step=>step.defeat===true);
 const recovery=defeat&&run.trace.find(step=>step.sortie>defeat.sortie&&step.returned);
 const reached=defeat&&Object.values(run.journeyStrength).find(row=>
  row.status==='REACHED'&&row.firstReached?.actualSorties>defeat.sortie);
 if(defeat&&recovery&&reached&&run.losses>0&&
    run.lost.xp+run.lost.stone+run.lost.ink>0){
  witnessed={run,defeat,recovery,reached,seed};
  break;
 }
}
assert.ok(witnessed,'a genuine seeded defeat with lost rewards followed by legal return/investment and strength reach is required');
const {run:lossAndReach,defeat,recovery,reached,seed:lossSeed}=witnessed;
assert.ok(lossAndReach.lost.xp+lossAndReach.lost.stone+lossAndReach.lost.ink>0);
assert.ok(reached.firstReached.actualReturns>0,'only banked returns can establish later strength');
assert.equal(lossAndReach.earned.stone,lossAndReach.spent.stone+lossAndReach.balances.stone);
assert.equal(lossAndReach.earned.ink,lossAndReach.spent.ink+lossAndReach.balances.ink);
const lossProof={seed:lossSeed,style:'A',route:'long',defeat,losses:lossAndReach.losses,
 lost:lossAndReach.lost,recovery,reach:reached.firstReached,
 reachedBand:reached.band,earned:lossAndReach.earned,spent:lossAndReach.spent,
 balances:lossAndReach.balances};
console.log('DUNGEON_REAL_LOSS_RECOVERY '+JSON.stringify(lossProof));

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
