// The default, measurable 1-100F combat balance benchmark.
// Targets are advisory on ordinary CI (log failures without hiding them);
// set DUNGEON_BALANCE_STRICT=1 to make balance target misses fail the job.
// Structural/gameplay contract violations always fail CI.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {simulate,upgradeSpells} from './test-dungeon-progression-simulation.mjs';
import {deepRun} from './test-dungeon-deep-cleanse-simulation.mjs';
import {simulateProgression} from '../scripts/simulate-dungeon-stones.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),
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
const SAMPLES=Number(process.env.DUNGEON_BALANCE_SAMPLES||128);
assert.ok(Number.isSafeInteger(SAMPLES)&&SAMPLES>=32&&SAMPLES<=512,
 'DUNGEON_BALANCE_SAMPLES must be between 32 and 512');
const STRICT=process.env.DUNGEON_BALANCE_STRICT==='1';
const seed=i=>17011+i*13;
const percentile=(v,decimals=1)=>v===null?null:Number(v.toFixed(decimals));
function median(values){
 if(!values.length)return null;
 const a=[...values].sort((x,y)=>x-y),n=a.length;
 return (a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2;
}
function average(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
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
const LEVELS={10:19,20:37,30:55,40:72,50:87,60:102,70:115,80:128,90:139,100:150};
const report=[];
for(let to=10;to<=100;to+=10){
 const from=to-9,level=LEVELS[to],withItems=from>=51;
 assert.equal(level,targetClearLevel(to));
 const rate=targetStoneRate(from),earned=[];
 const runs=[],controlRuns=[];
 for(let i=0;i<SAMPLES;i++){
  const history=milestones[i],prior=from-1;
  const alreadyEarned=prior===0?0:history.find(row=>row.layer===prior)?.stones;
  assert.ok(Number.isFinite(alreadyEarned),'known banked stones before F'+from);
  const spending=Math.floor(alreadyEarned*rate+1e-8);
  assert.ok(spending>=0&&spending<=alreadyEarned);
  const baseSpells=from===1?INTRO:NORMAL;
  const upgradedPower=upgradeSpells(baseSpells.map(([role,attribute,power])=>({role,attribute,power})),
   spending).spells.map(spell=>spell.power);
  earned.push(alreadyEarned);
  const randomSeed=seed(i);
  if(withItems){
   // deepRun independently checks the same 75%-of-banked-stones policy,
   // legal carry capacity, no HP/MP potions and stocked cleansers.
   assert.equal(rate,.75);
   const yes=deepRun(randomSeed,{from,to,level},true);
   assert.equal(yes.spent,spending);
   assert.equal(yes.stones,alreadyEarned);
   assert.ok(yes.cleanseUsed<=yes.carryCount);
   assert.equal(yes.carryCount,G.capacity(level));
   runs.push({win:yes.win,hp:yes.hp/yes.maxHp*100,mp:yes.mp/yes.maxMp*100,
    cleanses:yes.cleanseUsed,remaining:yes.remaining,cleared:yes.cleared,spent:yes.spent,
    maxHp:yes.maxHp,maxMp:yes.maxMp,layerStats:yes.layerStats,
    initialLoadout:yes.initialLoadout,upgradedPower});
   const no=deepRun(randomSeed,{from,to,level},false);
   controlRuns.push(no);
  }else{
   const result=simulate(randomSeed,{level,fromLayer:from,toLayer:to,
    spells:from===1?'intro':'five',stones:spending});
   assert.equal(result.spentStones,spending);
   runs.push({win:result.win,hp:result.hp/result.initialHp*100,
    mp:result.mp/result.initialMp*100,cleared:result.clear,spent:spending,
    maxHp:result.initialHp,maxMp:result.initialMp,layerStats:result.layerStats,
    initialLoadout:[],upgradedPower});
  }
 }
 const winners=runs.filter(x=>x.win);
 const winRate=winners.length/SAMPLES*100,
  medianMp=median(winners.map(x=>x.mp)),
  medianHp=median(winners.map(x=>x.hp)),
  medianUsed=median(runs.map(x=>x.spent));
 const winLower=from<=20?99:90,winUpper=from<=20?100:97;
 const mpLower=from<=10?50:0,mpUpper=from<=10?100:15;
 const issues=[];
 if(winRate<winLower||winRate>winUpper)issues.push('winRate outside '+winLower+'-'+winUpper+'%');
 if(medianMp===null||medianMp<mpLower||medianMp>mpUpper)
  issues.push('winner median MP outside '+mpLower+'-'+mpUpper+'%');
 const row={band:from+'-'+to,level,samples:SAMPLES,
  stoneRateAtSortieStart:percentile(rate*100),stoneRateRampEnd:percentile(targetStoneRate(to)*100),
  bankedStones:percentile(average(earned)),spentStonesMedian:medianUsed,
  baseSpellPower:from<=10?INTRO.map(x=>x[2]):NORMAL.map(x=>x[2]),
  items:from<=50?'none':from<=70?'cleansers':'cleansers+2 Luna Stones',
  wins:winners.length,winRate:percentile(winRate),medianMp:percentile(medianMp),
  medianHp:percentile(medianHp),meanMp:percentile(average(winners.map(x=>x.mp))),
  meanHp:percentile(average(winners.map(x=>x.hp))),
  winTarget:winLower+'-'+winUpper+'%',mpTarget:mpLower+'-'+mpUpper+'%',
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
  const layerRow={
   layer,band:from+'-'+to,
   conditions:{
    sortieStartLayer:from,heroLevel:level,enemyLevel:Number(data.floors[(layer-1)*5].enemy_level),
    stoneRatePercent:percentile(rate*100),bankedStonesMedian:median(earned),
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
// Mandatory regression benchmark: immediate pre-boss main (ca2f46b22d8b0defb45de7f00c9d0de9d363a609).
// A previously failing band is allowed to become PASS, even if that exceeds
// the historical win-rate difference budget. A PASS must never become FAIL.
// HP/MP median parity remains mandatory in all cases.
if(SAMPLES===128){
 const baseline={
  '1-10':[100,54.4,69.7], '11-20':[99.2,11.8,72],
  '21-30':[94.5,5.4,73.9], '31-40':[97.7,13.1,73.8],
  '41-50':[96.9,7.7,73.5], '51-60':[99.2,6.7,80.6],
  '61-70':[100,9.3,80.2], '71-80':[100,8.7,78.1],
  '81-90':[100,9.9,77.3], '91-100':[95.3,2.2,76.1]
 };
 const acceptedImprovements=[];
 for(const row of report){
  const old=baseline[row.band];
  assert.ok(old,'historical 128-seed band '+row.band);
  const start=Number(row.band.split('-')[0]),winLower=start<=20?99:90,winUpper=start<=20?100:97;
  const mpLower=start<=10?50:0,mpUpper=start<=10?100:15;
  const oldPassed=old[0]>=winLower&&old[0]<=winUpper&&old[1]>=mpLower&&old[1]<=mpUpper;
  assert.ok(!oldPassed||row.passed,'previously passing sortie must not fail: '+row.band);
  const becamePass=!oldPassed&&row.passed;
  if(becamePass)acceptedImprovements.push({band:row.band,winBefore:old[0],winAfter:row.winRate});
  else assert.ok(Math.abs(row.winRate-old[0])<=2,
    'sortie win-rate regression exceeds 2pp without turning a fail into pass in '+row.band+': '+old[0]+' -> '+row.winRate);
  assert.ok(Math.abs(row.medianMp-old[1])<=5,
   'sortie median MP regression exceeds 5pp in '+row.band+': '+old[1]+' -> '+row.medianMp);
  assert.ok(Math.abs(row.medianHp-old[2])<=5,
   'sortie median HP regression exceeds 5pp in '+row.band+': '+old[2]+' -> '+row.medianHp);
 }
 console.log('DUNGEON_BALANCE_ACCEPTED_IMPROVEMENTS '+JSON.stringify(acceptedImprovements));
 console.log('PASS immediate-pre-boss 128-seed sortie parity, permitting FAIL->PASS without relaxing HP/MP');
}

// Do not silently redefine balance targets to force a green build.
// CI must always expose a clear list of missing goals and a strict-mode path.
const unmet=report.filter(x=>!x.passed);
console.log('DUNGEON_DEFAULT_BALANCE_SUMMARY '+JSON.stringify({
 samples:SAMPLES,median:'successful sorties only',bands:report.length,
 met:report.length-unmet.length,unmet:unmet.map(x=>({band:x.band,issues:x.issues})),
 goalStatus:unmet.length?'NEEDS_TUNING':'ALL_TARGETS_MET',
 ciMode:STRICT?'strict':'reporting'}));
assert.equal(report.length,10);
assert.ok(report.some(x=>x.medianCleanses>0),'51+ must exercise item consumption');
assert.ok(report.every(x=>x.wins>=0&&x.wins<=SAMPLES));
if(STRICT)assert.equal(unmet.length,0,'some user-approved balance targets are unmet');
console.log('PASS default 1-100F median balance audit (targets '+(unmet.length?'reported':'met')+')');
