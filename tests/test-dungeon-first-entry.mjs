import assert from 'node:assert/strict';
import {runJourney} from '../scripts/simulate-dungeon-journeys.mjs';
import {validateFirstEntryOwner} from '../scripts/check-dungeon-journey-strength.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';

// CI executes this through test-dungeon-journeys.mjs; all mutations are
// cloned evidence, never changes to combat / inventory / RNG or calculator.
const options={style:'A',route:'long',maxSorties:45,maxFights:6500,
 observeStrength:true,observeFirstEntry:true};
const run=runJourney(17011,options);
const before=new Map(),floors=new Map();
let accumulated=0;
for(const floor of run.floorAudit){
 const id=floor.sortie+'/'+floor.layer;
 before.set(id,accumulated);floors.set(id,floor);
 accumulated+=floor.attemptedFights;
}
const entries=Object.values(run.firstEntries);
const record={seed:run.seed,entries,
 receipts:entries.map(entry=>({layer:entry.layer,sortie:entry.sortie,
  fightsBefore:before.get(entry.sortie+'/'+entry.layer),
  floor:floors.get(entry.sortie+'/'+entry.layer),
  previousFloor:floors.get(entry.sortie+'/'+(entry.layer-1))??null})),
 reachedEvents:Array.from({length:10},(_,index)=>({
  from:index*10+1,firstReached:run.journeyStrength[index*10+1].firstReached})),
 sorties:run.trace.map(t=>({sortie:t.sortie,start:t.start,goal:t.goal,
  fights:t.fights,returned:t.returned,defeat:t.defeat,cleared:t.cleared,
  rank:t.rank,stone:t.stone,ink:t.ink,levelAfter:t.levelAfter}))
};
const account={seed:run.seed,style:run.style,route:run.route,
 firstDecadeEntries:run.entrySnapshots};
const bands=Array.from({length:10},(_,i)=>run.journeyStrength[i*10+1]);
const check=proof=>validateFirstEntryOwner(account,proof,bands,{requireComplete:false});
const clone=()=>structuredClone(record);
assert.ok(check(record)>=20,'the real physical journey has multiple first entries');
function mustReject(label,alter){
 const bad=clone();alter(bad);
 assert.throws(()=>check(bad),undefined,label);
}
mustReject('missing floor',p=>{p.entries.splice(1,1);p.receipts.splice(1,1);});
mustReject('duplicate floor',p=>{p.entries.splice(1,0,structuredClone(p.entries[1]));
 p.receipts.splice(1,0,structuredClone(p.receipts[1]));});
mustReject('future magic upgrade',p=>{
 const spell=p.entries[1].circles[0];
 spell.upgradeLevel+=500;spell.power=strengthenedPower(spell.basePower,spell.upgradeLevel);
});
mustReject('future chapter for illegal start',p=>{
 const e=p.entries.find(e=>e.layer>=11);
 assert.ok(e);e.rank=100;e.legalStarts=[1,11,21,31,41,51,61,71,81,91,101];
 e.sortieStart=91;
});
mustReject('spend unbanked stones',p=>{p.entries[1].bankedStones+=100;});
mustReject('revive a consumed or never owned item',p=>{
 const e=p.entries.find(x=>x.sortieInitialCarry.some(i=>
  !x.carry.some(j=>j.instanceId===i.instanceId)))??p.entries[1];
 const consumed=e.sortieInitialCarry.find(i=>
  !e.carry.some(j=>j.instanceId===i.instanceId));
 e.carry.push(consumed??{id:'mana_fake',instanceId:'item-not-owned',value:1,bonus:0});
});
mustReject('entry HP/MP drift',p=>{p.entries[1].playerHp-=1;});
mustReject('backdated official strength',p=>{
 const row=p.reachedEvents.find(x=>x.firstReached);
 assert.ok(row);
 row.firstReached.actualFights=0;
});
mustReject('unevaluated entry marked reached',p=>{p.entries[1].assessment='REACHED';});
const defeat=run.trace.find(step=>step.defeat);
const lateReach=defeat&&record.reachedEvents.find(row=>
 row.firstReached&&row.firstReached.actualSorties>defeat.sortie);
assert.ok(defeat&&lateReach&&run.trace.some(t=>t.sortie>defeat.sortie&&t.returned),
 'real loss, banked return, and later formula strength are legal');
assert.ok(check(record)>0,'later legally reached does not promote earlier first entry');
const observed=runJourney(17011,{style:'A',route:'short',maxSorties:12,
 maxFights:120,observeFirstEntry:true});
const baseline=runJourney(17011,{style:'A',route:'short',maxSorties:12,
 maxFights:120,observeFirstEntry:false});
for(const key of ['best','profile','sorties','returns','losses','fights',
 'earned','spent','lost','balances','resourceLedger','floorAudit','trace',
 'rankAudit','circles','entrySnapshots','journeyStrength'])
 assert.deepEqual(observed[key],baseline[key],'read-only first entry changes '+key);
console.log('PASS FIRST_ENTRY 9 mutated evidence failures, legal post-loss strength, unchanged run metrics');
