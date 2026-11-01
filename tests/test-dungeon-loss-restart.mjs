// Independent, deterministic integration test of real G.round encounters,
// legitimate seeded drops, defeat settlement, surviving banked stock and
// a following legal sortie. The approved 256-owner AI is never altered.
import assert from 'node:assert/strict';
import {runJourney} from '../scripts/simulate-dungeon-journeys.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {allowedStartLayer} from '../assets/js/dungeon-ranks.mjs';

// Fixed, reproducible owner-and-drawing input. The scenario first genuinely
// banks F1-F10, then the player makes legal, deliberately defensive choices
// on their first 11F-20F sortie; their next sortie uses the unchanged AI.
const seed=17011,powers=[120,140,180,140,140];
let selectedTurns=0;
const playerAction=({hero,fight,sortie,defaultAction})=>{
 if(sortie!==14||fight<58)return defaultAction();
 selectedTurns++;
 const ready=G.available(hero).map(i=>({spell:hero.spells[i],i}));
 const ward=ready.find(x=>x.spell.role==='defense');
 if(ward)return ward.i;
 const weak=ready.filter(x=>x.spell.role==='attack').sort((a,b)=>
  a.spell.power-b.spell.power)[0];
 return weak?.i??-1;
};
const run=runJourney(seed,{style:'A',route:'long',referencePowers:powers,
 maxSorties:60,maxFights:2500,observeLossEvidence:true,playerAction,
 collectCandidateDiagnostic:false});
assert.ok(selectedTurns>0,'the real test-player action path must execute');
const loss=run.lossEvidence.find(event=>event.sortie===14);
assert.ok(loss,'the real scripted owner must be defeated on their first long sortie');

const {before,after}=loss;
const {pendingLoot,pendingXp}=before;
const count=type=>pendingLoot.filter(x=>x.type===type).length;
assert.ok(before.defeatedHeroHp<=0,'real combat must reduce hero HP to zero, not just time out');
assert.ok(pendingXp>0&&pendingLoot.length>0,'no empty or invented lost reward proof');
assert.ok(run.trace.some(t=>t.sortie===loss.sortie&&t.defeat),'actual fight must end in defeat');
assert.equal(run.losses,run.trace.filter(t=>t.defeat).length);
assert.deepEqual(after.earned,before.earned,'defeat cannot bank newly found stones or ink');
assert.equal(after.bankedXp,before.bankedXp,'unbanked XP cannot be credited after loss');
assert.deepEqual(after.profile,before.profile,'defeat must not create levels, XP or rank');
assert.equal(after.stone,before.stone,'saved stones cannot be lost or credited on defeat');
assert.equal(after.ink,before.ink,'saved ink cannot be lost or credited on defeat');
assert.equal(after.itemLedger.bankedDrops,before.itemLedger.bankedDrops);
assert.equal(after.itemLedger.lostUnbanked-before.itemLedger.lostUnbanked,count('use'));
assert.equal(after.collectionLedger.lostUnbanked-before.collectionLedger.lostUnbanked,count('collection'));
const ids=items=>items.map(x=>x.instanceId).sort();
assert.deepEqual(ids(after.warehouse),
 ids([...before.warehouse,...before.unspentCarry]),
 'all unspent physically owned carry and existing warehouse items must survive; pending loot must not be banked');
assert.ok(before.unspentCarry.length>0,'unused carry restoration must be actually exercised');
assert.ok(before.carried.length>=before.unspentCarry.length);
assert.equal(new Set(ids(after.warehouse)).size,after.warehouse.length,
 'no duplicated or fabricated physical inventory instance');
const lostFloors=run.floorAudit.filter(f=>f.sortie===loss.sortie);
assert.ok(lostFloors.length>0&&lostFloors.every(f=>!f.banked),
 'a defeated sortie must not mark any floor loot banked');
assert.equal(lostFloors.reduce((n,f)=>n+f.pendingItems,0),count('use'));
assert.equal(lostFloors.reduce((n,f)=>n+f.pendingCollections,0),count('collection'));
assert.equal(lostFloors.reduce((n,f)=>n+f.pendingStone,0),count('stone'));
assert.equal(lostFloors.reduce((n,f)=>n+f.pendingInk,0),count('ink'));
assert.equal(run.floorAudit.filter(f=>!f.banked).reduce((n,f)=>n+f.pendingStone,0),run.lost.stone);
assert.equal(run.floorAudit.filter(f=>!f.banked).reduce((n,f)=>n+f.pendingInk,0),run.lost.ink);
assert.equal(run.floorAudit.filter(f=>!f.banked).reduce((n,f)=>n+f.pendingItems,0),
 run.resourceLedger.items.lostUnbanked);
assert.equal(run.floorAudit.filter(f=>!f.banked).reduce((n,f)=>n+f.pendingCollections,0),
 run.resourceLedger.collections.lostUnbanked);
assert.ok(Math.abs(run.floorAudit.filter(f=>!f.banked).reduce((n,f)=>n+f.gainedXp,0)-run.lost.xp)<.001,
 'earned but unbanked EXP must be wholly lost');
const defeatIndex=run.trace.findIndex(t=>t.sortie===loss.sortie&&t.defeat);
const later=run.trace.slice(defeatIndex+1).find(t=>t.returned&&t.cleared>=t.start&&
 t.gainedPending.stone+t.gainedPending.ink>0);
assert.ok(later,'a real legal follow-up sortie must survive and bank later drops');
assert.equal(allowedStartLayer({adventurerRank:after.profile.adventurerRank},later.start),later.start,
 'restart floor must be actually unlocked before the next banked return');
assert.equal(run.earned.stone,run.spent.stone+run.balances.stone,'no free stones');
assert.equal(run.earned.ink,run.spent.ink+run.balances.ink,'no free ink');
const items=run.resourceLedger.items,collections=run.resourceLedger.collections;
assert.equal(items.bankedDrops+items.alchemyCreated-items.battleConsumed-items.alchemyConsumed,items.held);
assert.equal(collections.bankedDrops-collections.alchemyConsumed,collections.held);
console.log('PASS DUNGEON_REAL_LOSS_RESTART '+JSON.stringify({
 seed,powers,sortie:loss.sortie,lostXp:pendingXp,lostLoot:pendingLoot.length,
 unusedCarry:before.unspentCarry.length,restartSortie:later.sortie,
 bankedAfterRestart:later.gainedPending,
 reconciledItems:items.held
}));
