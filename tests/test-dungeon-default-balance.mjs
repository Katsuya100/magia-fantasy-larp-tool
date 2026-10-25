// The default, measurable 1-100F combat balance benchmark.
// Targets are advisory on ordinary CI (log failures without hiding them);
// set DUNGEON_BALANCE_STRICT=1 to make balance target misses fail the job.
// Structural/gameplay contract violations always fail CI.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {simulate,upgradeSpells} from './test-dungeon-progression-simulation.mjs';
import {deepRun} from './test-dungeon-deep-cleanse-simulation.mjs';
import {simulateProgression} from '../scripts/simulate-dungeon-stones.mjs';
import {withNeutralAttackAttributes} from './helpers/dungeon-neutral-loadout.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
 playerBase:csv('player-base')};
configure(data);
const NORMAL=[
 ['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]
];
// Deliberately lower-powered first-decade loadout, all powers 100-300.
const INTRO=[
 ['attack','flame',220],['attack','bolt',260],['attack','gravity',300],
 ['support','aqua',200],['defense','law',160]
];
assert.ok(INTRO.every(([role,attr,power])=>power>=100&&power<=300));
assert.ok(NORMAL.every(([role,attr,power])=>Number.isInteger(power)));
assert.equal(G.capacity(102),13);
const goals=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
const SAMPLES=Number(process.env.DUNGEON_BALANCE_SAMPLES||goals.strictSamples);
assert.ok(Number.isSafeInteger(SAMPLES)&&SAMPLES>=32&&SAMPLES<=512,
 'DUNGEON_BALANCE_SAMPLES must be between 32 and 512');
const STRICT=process.env.DUNGEON_BALANCE_STRICT==='1';
if(STRICT)assert.equal(SAMPLES,goals.strictSamples,'strict fixed-deck CI needs all approved seeds');
const seed=i=>17011+i*13;
const percentile=(v,decimals=1)=>v===null?null:Number(v.toFixed(decimals));
function median(values){
 if(!values.length)return null;
 const a=[...values].sort((x,y)=>x-y),n=a.length;
 return (a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2;
}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
// Retain Wilson intervals as a diagnostic only: a CI overlap is not a pass.
// The observed win rate must meet the approved 90-97% target AND a 2-point
// interior margin (92-95%) for 21-100F, preventing edge-of-band releases.
function winRateWilson95(wins,trials){
 const z=1.96,p=wins/trials,z2=z*z,denom=1+z2/trials;
 const center=(p+z2/(2*trials))/denom;
 const margin=z*Math.sqrt(p*(1-p)/trials+z2/(4*trials*trials))/denom;
 return {lower:100*(center-margin),upper:100*(center+margin)};
}
const milestones=Array.from({length:SAMPLES},(_,i)=>simulateProgression(seed(i)+81).milestones);
// This is an actual *legal sortie* model, not an upgrade in the middle of a
// 50-fight expedition. At 11F, a sortie can invest at the 30% point of the
// agreed 10F=25% -> 20F=75% ramp. The rest of the ramp is reached on later
// returns. No mid-sortie shopping or restoration is invented.
function targetStoneRate(floor){
 if(floor<=10)return .25;
 if(floor<=20)return .25+(floor-10)*.05;
 return .75;
}
assert.equal(targetStoneRate(1),.25);
assert.equal(targetStoneRate(10),.25);
assert.ok(Math.abs(targetStoneRate(11)-.30)<1e-9);
assert.equal(targetStoneRate(20),.75);
assert.equal(targetStoneRate(21),.75);
for(let floor=11;floor<=19;floor++)
 assert.ok(targetStoneRate(floor)<targetStoneRate(floor+1));
const LEVELS=goals.targetLevelCheckpoints;
assert.equal(goals.bands.length,10);
const report=[];
for(let to=10;to<=100;to+=10){
 const from=to-9,level=LEVELS[to],withItems=from>=51;
 assert.equal(level,targetClearLevel(to));
 const rate=targetStoneRate(from),earned=[];
 const runs=[],controlRuns=[];
 const baseSpells=from===1?INTRO:NORMAL;
 const chosen=withNeutralAttackAttributes(baseSpells.map(([role,attribute,power])=>({role,attribute,power})),
  data.enemies,from,to);
 for(let i=0;i<SAMPLES;i++){
  const history=milestones[i],prior=from-1;
  const alreadyEarned=prior===0?0:history.find(row=>row.layer===prior)?.stones;
  assert.ok(Number.isFinite(alreadyEarned),'known banked stones before F'+from);
  const spending=Math.floor(alreadyEarned*rate+1e-8);
  assert.ok(spending>=0&&spending<=alreadyEarned);
  const upgradedPower=upgradeSpells(chosen.spells,spending).spells.map(spell=>spell.power);
  earned.push(alreadyEarned);
  const randomSeed=seed(i);
  if(withItems){
   // deepRun independently checks the same 75%-of-banked-stones policy,
   // legal carry capacity, no HP/MP potions and stocked cleansers.
   assert.equal(rate,.75);
   const yes=deepRun(randomSeed,{from,to,level},true);
   assert.ok(yes.spent<=spending&&spending-yes.spent<16,'cost tiers never overspend');
   assert.deepEqual(yes.attackAttributes,chosen.attackAttributes);
   assert.equal(yes.stones,alreadyEarned);
   assert.ok(yes.cleanseUsed<=yes.carryCount);
   assert.equal(yes.carryCount,G.capacity(level));
   runs.push({win:yes.win,hp:yes.hp/yes.maxHp*100,mp:yes.mp/yes.maxMp*100,
    cleanses:yes.cleanseUsed,remaining:yes.remaining,cleared:yes.cleared,spent:yes.spent,
    maxHp:yes.maxHp,maxMp:yes.maxMp,layerStats:yes.layerStats,
    initialLoadout:yes.initialLoadout,upgradedPower});
   const no=deepRun(randomSeed,{from,to,level},false);
   assert.deepEqual(no.attackAttributes,chosen.attackAttributes);
   controlRuns.push(no);
  }else{
   const result=simulate(randomSeed,{level,fromLayer:from,toLayer:to,
    spells:from===1?'intro':'five',stones:spending});
   assert.ok(result.spentStones<=spending&&spending-result.spentStones<16,'cost tiers never overspend');
   assert.deepEqual(result.attackAttributes,chosen.attackAttributes);
   if(from===1)assert.equal(result.earlyHeroRecoveryCasts,0,'1-10F is tested without HP healing');
   runs.push({win:result.win,hp:result.hp/result.initialHp*100,
    mp:result.mp/result.initialMp*100,cleared:result.clear,spent:result.spentStones,
    maxHp:result.initialHp,maxMp:result.initialMp,layerStats:result.layerStats,
    initialLoadout:[],upgradedPower,fightStats:result.fightStats});
  }
 }
 const winners=runs.filter(x=>x.win);
 const winRate=winners.length/SAMPLES*100,
  medianMp=median(winners.map(x=>x.mp)),
  medianHp=median(winners.map(x=>x.hp)),
  medianUsed=median(runs.map(x=>x.spent));
 const goal=goals.bands.find(x=>x.from===from&&x.to===to);
 const [winLower,winUpper]=goal.winRate;
 const [marginLower,marginUpper]=goal.winSafety;
 const [mpLower,mpUpper]=goal.winnerMedianMp;
 const winInterval=winRateWilson95(winners.length,SAMPLES);
 const pointWinRateInTarget=winRate>=winLower&&winRate<=winUpper;
 const pointWinRateInsideMargin=winRate>=marginLower&&winRate<=marginUpper;
 const statisticallyCompatible=winInterval.lower<=winUpper&&winInterval.upper>=winLower;
 const introFights=from===1?runs.flatMap(x=>x.fightStats||[]):[];
 const floorMetrics=from===1?Array.from({length:10},(_,i)=>{
  const layer=i+1,fights=introFights.filter(x=>x.layer===layer);
  const rounds=average(fights.map(x=>x.turns));
  const damage=average(fights.map(x=>Math.max(0,x.hpBefore-x.hpAfter)));
  return {layer,fights:fights.length,roundsMedian:median(fights.map(x=>x.turns)),
   roundsMean:percentile(rounds,3),
   damageMedian:median(fights.map(x=>Math.max(0,x.hpBefore-x.hpAfter))),
   damageMean:percentile(damage,3),
   enemyAttacks:percentile(average(fights.map(x=>x.enemyAttacks)),3),
   enemyDefenses:percentile(average(fights.map(x=>x.enemyDefenses)),3),
   heroAttackCasts:percentile(average(fights.map(x=>x.heroAttackCasts)),3),
   spellMpSpent:percentile(average(fights.map(x=>x.spellMpSpent)),3),
   clearedFights:fights.filter(x=>x.win).length,
   // Threat combines engagement length with real damage scaled by HP.
   // No damage/combat rule is changed by this reporting-only index.
   threat:rounds+damage*5/runs[0].maxHp};
 }):[];
 const finalBoss=introFights.filter(x=>x.fight===50&&x.win);
 const bossRounds=finalBoss.map(x=>x.turns).sort((a,b)=>a-b);
 const bossPercentile=q=>bossRounds.length?bossRounds[Math.floor((bossRounds.length-1)*q)]:null;
 const bossStats=from===1?{
  wins:finalBoss.length,medianRounds:median(bossRounds),
  p10:bossPercentile(.1),p90:bossPercentile(.9),
  damageTakenMedian:median(finalBoss.map(x=>Math.max(0,x.hpBefore-x.hpAfter))),
  hpBeforeMedian:median(finalBoss.map(x=>x.hpBefore)),
  hpAfterMedian:median(finalBoss.map(x=>x.hpAfter)),
  mpBeforeMedian:median(finalBoss.map(x=>x.mpBefore)),
  mpAfterBeforeRecoveryMedian:median(finalBoss.map(x=>x.mpAfter)),
  mpAfterVictoryRecoveryMedian:median(finalBoss.map(x=>x.mpAfterVictoryRecovery)),
  enemyAttacksMedian:median(finalBoss.map(x=>x.enemyAttacks)),
  enemyDefensesMedian:median(finalBoss.map(x=>x.enemyDefenses)),
  enemyHealsMedian:median(finalBoss.map(x=>x.enemyHeals))
 }:null;
 const issues=[];
 if(from===1){
  if(bossStats.medianRounds!==4)issues.push('10F boss median must be four real rounds');
  if(medianMp<50||medianMp>60)issues.push('10F post-victory/pre-checkpoint median MP must be 50-60%');
  if(bossStats.mpAfterVictoryRecoveryMedian!==median(winners.map(x=>x.mp/100*x.maxMp)))
   issues.push('10F recorded MP must be after ordinary victory recovery');
  for(let i=6;i<10;i++){
   if(floorMetrics[i].threat+1e-6<floorMetrics[i-1].threat)
    issues.push('threat did not rise from '+i+'F to '+(i+1)+'F');
  }
 }
 if(!pointWinRateInTarget)issues.push('observed winRate outside '+winLower+'-'+winUpper+'%');
 else if(!pointWinRateInsideMargin)issues.push('observed winRate outside '+marginLower+'-'+marginUpper+'% safety margin');
 if(medianMp===null||medianMp<mpLower||medianMp>mpUpper)
  issues.push('winner median MP outside '+mpLower+'-'+mpUpper+'%');
 const row={band:from+'-'+to,level,samples:SAMPLES,
  stoneRateAtSortieStart:percentile(rate*100),stoneRateRampEnd:percentile(targetStoneRate(to)*100),
  bankedStones:percentile(average(earned)),spentStonesMedian:medianUsed,
  baseSpellPower:from<=10?INTRO.map(x=>x[2]):NORMAL.map(x=>x[2]),
  attackAttributes:chosen.attackAttributes,
  items:from<=50?'none':from<=70?'cleansers':'cleansers+2 Luna Stones',
  wins:winners.length,winRate:percentile(winRate),medianMp:percentile(medianMp),
  medianHp:percentile(medianHp),meanMp:percentile(average(winners.map(x=>x.mp))),
  meanHp:percentile(average(winners.map(x=>x.hp))),
  winTarget:winLower+'-'+winUpper+'%',winSafetyMargin:marginLower+'-'+marginUpper+'%',mpTarget:mpLower+'-'+mpUpper+'%',
  winRatePointInTarget:pointWinRateInTarget,winRatePointInsideMargin:pointWinRateInsideMargin,
  winRate95Interval:[percentile(winInterval.lower),percentile(winInterval.upper)],
  winRateCompatibleWithTarget:statisticallyCompatible,
  floorMetrics:from===1?floorMetrics:undefined,boss10:bossStats,
  medianCleanses:withItems?median(runs.map(x=>x.cleanses)):0,
  controlNoItemWinRate:withItems?percentile(100*controlRuns.filter(x=>x.win).length/SAMPLES):null,
  lossesByLayer:Object.entries(runs.filter(x=>!x.win).reduce((acc,x)=>{
   const layer=Math.ceil((x.cleared+1)/5);acc[layer]=(acc[layer]||0)+1;return acc;
  },{})),passed:issues.length===0,issues};
 // Sanity check: every completed floor carries the actual post-boss MP and
 // remaining inventory into the next floor; only the sortie start is full.
 for(const run of runs){
  assert.equal(run.layerStats[0].layer,from);
  assert.equal(run.layerStats[0].startMp,run.maxMp);
  assert.equal(run.layerStats[0].startHp,run.maxHp);
  for(let j=1;j<run.layerStats.length;j++){
   const prev=run.layerStats[j-1],next=run.layerStats[j];
   assert.equal(next.layer,prev.layer+1);
   assert.equal(prev.cleared,true,'cannot enter next floor without clearing previous floor');
   assert.equal(next.startMp,prev.endMp,'MP must carry over between floors');
   assert.equal(next.startHp,prev.endHp,'HP must carry over between floors');
   if(withItems)assert.equal(next.itemsAtStart,prev.itemsAtEnd,
    'items must carry over without free replenishment');
  }
 }
 report.push(row);
 console.log('DUNGEON_DEFAULT_BALANCE '+JSON.stringify(row));
 // One trace row per actual floor, rather than the 10-floor summary alone.
 // The entrance medians use all trials reaching that floor; exit medians use
 // trials that defeated that floor boss. Denominators are always shown.
 for(let layer=from;layer<=to;layer++){
  const reached=runs.flatMap(run=>run.layerStats.filter(state=>state.layer===layer)
   .map(state=>({run,state})));
  const cleared=reached.filter(x=>x.state.cleared);
  const controls=withItems?controlRuns.flatMap(run=>run.layerStats.filter(state=>state.layer===layer)
   .map(state=>({run,state}))):[];
  const fights=from===1?runs.flatMap(run=>(run.fightStats||[]).filter(x=>x.layer===layer)):[];
  const bossFights=fights.filter(x=>x.fight===layer*5),bossWins=bossFights.filter(x=>x.win);
  const rounds=bossWins.map(x=>x.turns).sort((a,b)=>a-b);
  const at=q=>rounds.length?rounds[Math.floor((rounds.length-1)*q)]:null;
  const layerRow={
   layer,band:from+'-'+to,
   combatDetail:from===1?{
    fights:fights.length,bossWins:bossWins.length,
    fightRoundsMedian:percentile(median(fights.map(x=>x.turns))),
    playerDamagePerFightMedian:percentile(median(fights.map(x=>Math.max(0,x.hpBefore-x.hpAfter)))),
    enemyAttacksPerFightMedian:median(fights.map(x=>x.enemyAttacks)),
    enemyDefensesPerFightMedian:median(fights.map(x=>x.enemyDefenses)),
    heroAttackCastsPerFightMedian:median(fights.map(x=>x.heroAttackCasts)),
    magicMpSpentPerFightMedian:median(fights.map(x=>x.spellMpSpent)),
    bossRounds:{p10:at(.1),median:median(rounds),p90:at(.9)}
   }:null,
   conditions:{
    sortieStartLayer:from,heroLevel:level,enemyLevel:Number(data.floors[(layer-1)*5].enemy_level),
    stoneRatePercent:percentile(rate*100),attackAttributes:chosen.attackAttributes,
    bankedStonesMedian:median(earned),
    spentStonesMedian:medianUsed,baseSpellPower:from===1?INTRO.map(x=>x[2]):NORMAL.map(x=>x[2]),
    upgradedSpellPowerMedian:[0,1,2,3,4].map(k=>percentile(median(runs.map(x=>x.upgradedPower[k])))),
    itemPolicy:row.items,initialLoadout:runs[0].initialLoadout,
    maxHp:runs[0].maxHp,maxMp:runs[0].maxMp
   },
   trials:SAMPLES,reached:reached.length,cleared:cleared.length,
   clearRateOfReached:reached.length?percentile(100*cleared.length/reached.length):null,
   startHpMedian:percentile(median(reached.map(x=>x.state.startHp))),
   startMpMedian:percentile(median(reached.map(x=>x.state.startMp))),
   startHpPercentMedian:percentile(median(reached.map(x=>100*x.state.startHp/x.run.maxHp))),
   startMpPercentMedian:percentile(median(reached.map(x=>100*x.state.startMp/x.run.maxMp))),
   endHpPercentMedianOfClears:percentile(median(cleared.map(x=>100*x.state.endHp/x.run.maxHp))),
   endMpMedianOfClears:percentile(median(cleared.map(x=>x.state.endMp))),
   endMpPercentMedianOfClears:percentile(median(cleared.map(x=>100*x.state.endMp/x.run.maxMp))),
   itemsAtStartMedian:withItems?median(reached.map(x=>x.state.itemsAtStart)):0,
   lunaAtStartMedian:withItems?median(reached.map(x=>x.state.lunaAtStart)):0,
   cleansersUsedWithinFloorMedian:withItems?median(reached.map(x=>x.state.usedAfter-x.state.usedBefore)):0,
   controlNoItemStartMpPercentMedian:withItems?percentile(median(controls.map(x=>100*x.state.startMp/x.run.maxMp))):null
  };
  assert.equal(layerRow.reached>0,layerRow.startMpMedian!==null);
  if(layer===from){
   assert.equal(layerRow.reached,SAMPLES);
   assert.equal(layerRow.startMpPercentMedian,100);
   assert.equal(layerRow.startHpPercentMedian,100);
  }
  console.log('DUNGEON_DEFAULT_BALANCE_LAYER '+JSON.stringify(layerRow));
 }
}
// The historical 128-seed benchmark used fixed elemental counters and a
// damage-maximizing hero AI. Its numbers are not a regression baseline for
// neutral-first circles. Keep the reference visible without false parity.
if(SAMPLES===128){
 const baseline={
  '1-10':[100,56.9,73.2], '11-20':[100,11.8,71.7],
  '21-30':[96.1,5.7,73.9], '31-40':[97.7,13.6,72.8],
  '41-50':[96.1,8.3,73.5], '51-60':[100,7.2,79.1],
  '61-70':[100,9.5,80.2], '71-80':[100,8.9,79.4],
  '81-90':[100,9.2,77.4], '91-100':[94.5,2.8,80.5]
 };
 console.log('DUNGEON_BALANCE_LEGACY_REFERENCE '+JSON.stringify(baseline));
}

// Keep the original approved bands. Strict CI requires observed wins inside
// the interior safety margin; Wilson intervals are visible but not an escape
// hatch for an out-of-range observed rate.
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-fixed-deck-combat-v1.json',import.meta.url),
 JSON.stringify({schemaVersion:'dungeon-fixed-deck-combat-v1',approvedGoals:goals.schemaVersion,
  samples:SAMPLES,source:'tests/test-dungeon-default-balance.mjs',
  status:'AUTHORITATIVE_FIXED_DECK_COMBAT',bands:report},null,2)+'\n');
const unmet=report.filter(x=>!x.passed);
console.log('DUNGEON_DEFAULT_BALANCE_SUMMARY '+JSON.stringify({
 samples:SAMPLES,median:'successful sorties only',bands:report.length,
 met:report.length-unmet.length,unmet:unmet.map(x=>({band:x.band,issues:x.issues})),
 pointEstimateOutsideTarget:report.filter(x=>!x.winRatePointInTarget).map(x=>({band:x.band,winRate:x.winRate,target:x.winTarget,interval95:x.winRate95Interval})),
 pointEstimateOutsideMargin:report.filter(x=>!x.winRatePointInsideMargin).map(x=>({band:x.band,winRate:x.winRate,margin:x.winSafetyMargin})),
 winRateAssessment:'observed win rate inside target with 92-95% interior margin for 21-100F; Wilson 95% interval diagnostic only',
 goalStatus:unmet.length?'NEEDS_TUNING':'ALL_TARGETS_MET',
 ciMode:STRICT?'strict':'reporting'}));
assert.equal(report.length,10);
assert.ok(report.some(x=>x.medianCleanses>0),'51+ must exercise item consumption');
assert.ok(report.every(x=>x.wins>=0&&x.wins<=SAMPLES));
if(STRICT)assert.equal(unmet.length,0,'some user-approved balance targets are unmet');
console.log('PASS default 1-100F median balance audit (targets '+(unmet.length?'reported':'met')+')');
