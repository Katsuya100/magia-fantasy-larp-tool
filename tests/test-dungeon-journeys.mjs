import assert from 'node:assert/strict';
import {buildManifest} from '../scripts/dungeon-balance-manifest.mjs';
import {runJourney,spread,investmentRate,ECONOMY_VERSION} from '../scripts/simulate-dungeon-journeys.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {rankBadgeDrop} from '../assets/js/dungeon-ranks.mjs';
import {createSortieEncounterSelector} from '../scripts/dungeon-balance-encounters.mjs';
import {readFileSync} from 'node:fs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
const foes=csv('enemies');
let shuffleRolls=0;
const selector=createSortieEncounterSelector(foes,()=>{shuffleRolls++;return .3;});
const shuffled=Array.from({length:4},(_,i)=>selector(i+1).id);
assert.equal(new Set(shuffled).size,4,'all ordinary encounters must appear once');
assert.deepEqual(new Set(shuffled),new Set(
 Array.from({length:4},(_,i)=>'foe_l001_'+(i+1))),
 'the browser shuffles only within an authored floor');
assert.equal(shuffleRolls,3,'floor order is rolled only once');
assert.equal(selector(1).id,shuffled[0],'returning to same slot does not reroll');
assert.equal(shuffleRolls,3);
assert.equal(selector(5).id,'boss_l001','boss remains fifth, never shuffled');
assert.equal(shuffleRolls,3);
assert.equal(new Set(Array.from({length:4},(_,i)=>selector(6+i).id)).size,4);
assert.equal(shuffleRolls,6,'different floor shuffles independently');

const intro=G.makeUnit({hp:100,mag:10,def:7,res:7},1,{},[],'hero');
intro.mp=0;
const earnedAt10=G.recoverVictoryMp(intro,10);
intro.mp=0;
const earnedAt11=G.recoverVictoryMp(intro,11);
assert.ok(earnedAt10>earnedAt11,'intro victory reward is greater, not a battle recovery spell');
assert.ok(earnedAt10<=intro.maxMp&&earnedAt11<=intro.maxMp);

assert.equal(G.chooseEnemySpell(
 G.fromEnemy(foes.find(x=>x.id==='foe_l001_1'),1),()=>.001)>=0,true);
const introFoe=G.fromEnemy(foes.find(x=>x.id==='foe_l001_1'),1);
assert.ok(num('enemy_attack_preference')>.5,'intro foes must attack frequently, not be passive dummies');
const pickedAttack=G.chooseEnemySpell(introFoe,()=>.5);
const pickedGuard=G.chooseEnemySpell(introFoe,()=>.9);
assert.equal(introFoe.spells[pickedAttack].role,'attack','intro attacks share the standard enemy attack chance');
assert.equal(introFoe.spells[pickedGuard].role,'defense','intro guards remain possible');
assert.ok(introFoe.base.mag<7,'intro damage is tuned using authored enemy base stats');

const manifest=buildManifest();
assert.equal(manifest.schemaVersion,'dungeon-levers-v1');
assert.ok(manifest.entries.length>500,'must inventory more than balance CSV');
assert.equal(new Set(manifest.entries.map(x=>x.id)).size,manifest.entries.length);
for(const entry of manifest.entries){
 assert.ok(entry.id&&entry.implementationRef&&entry.description&&entry.unit);
 assert.ok(entry.defaultValue!==undefined&&entry.allowedRange===null);
 assert.ok(entry.journeys.length&&entry.relatedTests.length);
 assert.ok(['hard-contract','diagnostic'].includes(entry.obligation));
}
const find=id=>manifest.entries.find(entry=>entry.id===id);
assert.equal(find('csv.balance.magic_stone_drop_chance.value').defaultValue,.30);
assert.equal(find('csv.balance.magic_stone_drop_chance_layer_150.value').defaultValue,.90);
assert.equal(find('csv.balance.level_max.value').defaultValue,150);
assert.equal(find('ink.bossDropChance').defaultValue,.20);
assert.equal(find('upgrade.initialCostSteps').defaultValue,20);
assert.equal(find('alchemy.guaranteedInkEvery').defaultValue,20);
assert.equal(investmentRate(10),.25);
assert.equal(investmentRate(20),.75);
assert.equal(investmentRate(50),.75);
assert.deepEqual(spread([1,2,3,4,5]),{p10:1.4,median:3,p90:4.6});

// Independent rank *rule* contract, not a claim that a normal combatant can
// finish the ten-layer sortie at 80%. Never grant a badge after MP restoration.
for(let layer=10;layer<=100;layer+=10){
 const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},Math.min(150,layer+10));
 const profile={adventurerRank:0};
 const fight=layer*5;
 hero.hp=Math.ceil(hero.stats.hp*.8);
 hero.mp=Math.ceil(hero.maxMp*.8);
 assert.equal(rankBadgeDrop(fight,hero,profile)?.layer,layer);
 hero.hp=Math.max(0,Math.ceil(hero.stats.hp*.8)-1);
 assert.equal(rankBadgeDrop(fight,hero,profile),null,'HP below threshold');
 hero.hp=hero.stats.hp;
 hero.mp=Math.max(0,Math.ceil(hero.maxMp*.8)-1);
 assert.equal(rankBadgeDrop(fight,hero,profile),null,'MP below threshold');
 assert.equal(rankBadgeDrop(fight-1,hero,profile),null,'rank only after boss');
}
for(const style of ['A','B','C'])for(const route of ['short','long']){
 // Limited-action test: strictly validates mechanics, no invented success.
 const run=runJourney(20261024,{style,route,maxSorties:2,maxFights:120});
 assert.equal(run.style,style);assert.equal(run.route,route);
 assert.ok(run.trace.length>0);
 assert.ok(run.entrySnapshots[1],'actual first dungeon entry must be captured');
 const entry=run.entrySnapshots[1];
 assert.equal(entry.playerHp,entry.maxHp,'initial dungeon entry begins at full HP');
 assert.equal(entry.playerMp,entry.maxMp,'initial dungeon entry begins at full MP');
 assert.equal(entry.unbankedXp,0,'no unbanked experience before first fight');
 assert.equal(entry.unbankedStone,0,'no unbanked stone before first fight');
 assert.equal(entry.unbankedInk,0,'no unbanked ink before first fight');
 assert.equal(entry.circles.length,5,'snapshot carries actual equipped five circles');
 assert.equal(entry.cooldowns.length,5);
 assert.ok(Array.isArray(entry.statuses));
 assert.ok(entry.carry.length<=G.capacity(entry.level),'carry never exceeds real capacity');
 assert.ok(entry.playerHp>=0&&entry.playerMp>=0);
 assert.ok(Number.isFinite(entry.targetLevel));
 assert.equal(run.earned.stone,run.spent.stone+run.balances.stone);
 assert.equal(run.earned.ink,run.spent.ink+run.balances.ink);
 assert.ok(run.lost.stone>=0&&run.lost.ink>=0&&run.lost.xp>=0);
 assert.ok(run.fights<=120);
 assert.equal(run.circles.filter(c=>c.active).length,5);
 const {items,collections}=run.resourceLedger;
 assert.equal(items.held,run.inventory,'owned item balances must match warehouse');
 assert.equal(items.bankedDrops+items.alchemyCreated,
  items.held+items.battleConsumed+items.alchemyConsumed,
  'consumable drops, battle usage and alchemy inputs conserve physical items');
 assert.equal(collections.bankedDrops,
  collections.held+collections.alchemyConsumed,
  'collection drops and alchemy inputs conserve collections');
 assert.equal(run.floorAudit.reduce((sum,row)=>sum+row.attemptedFights,0),run.fights,
  'every actual fight belongs to exactly one audited floor');
 assert.ok(run.floorAudit.every(row=>row.layer>=1&&row.layer<=100&&
  row.attemptedFights>=1&&row.attemptedFights<=5&&
  row.entryHpPercent>=0&&row.entryMpPercent>=0));
 assert.ok(run.floorAudit.every(row=>row.usedOwnedCleansers===0||row.layer>=51),
  'specialist cleansing must never happen before 51F');
 assert.ok(run.rankAudit.every(row=>row.eligible===
  (row.hpPercent>=80&&row.mpPercent>=80&&row.failure===null)),
  'boss-only 80/80 checks are independent of victory restoration');
 assert.ok(run.rankAudit.every(row=>!row.banked||row.eligible),
  'only earned, banked badges can be marked safely acquired');
 const initialIds=[...entry.carry,...entry.bankedInventory].map(item=>item.instanceId);
 assert.equal(new Set(initialIds).size,initialIds.length,
  'real owner snapshots cannot duplicate owned consumable instances');
 assert.ok(Array.isArray(entry.bankedInventory)&&entry.bankedCollections);

 // Per-battle intro prohibition is asserted inside the simulator itself.
 if(style==='B')assert.equal(run.circles.length,8);
 if(style==='C')assert.ok(run.spent.ink<=run.earned.ink);
}
// An actual banked five-ink C redraw must take place in a mature seeded
// journey. Old stones remain sunk, original drawing quality is not rerolled,
// and no material can appear merely to make the test pass.
const rebuild=runJourney(20261024,{style:'C',route:'short'});
assert.ok(rebuild.replacements>0&&rebuild.replacements<=3,
 'marginal-efficiency C route must actually exercise paid ink redraws');
assert.equal(rebuild.redrawEvents.length,rebuild.replacements);
assert.equal(rebuild.spent.ink,rebuild.replacements*5);
assert.equal(rebuild.earned.ink,rebuild.spent.ink+rebuild.balances.ink);
assert.ok(rebuild.redrawEvents.every(event=>event.sameDrawingQuality===true&&
 event.stoneInvestmentTransferred===0&&event.newMarginalPowerPerStone>event.oldMarginalPowerPerStone),
 'same-quality ink rebuild cannot transfer sunk upgrades');
assert.ok(rebuild.redrawEvents.every(event=>event.sunkStones>=0));
assert.equal(rebuild.floorAudit.reduce((n,x)=>n+x.attemptedFights,0),rebuild.fights);
assert.equal(rebuild.resourceLedger.items.held,rebuild.inventory);
assert.ok(rebuild.floorAudit.every(f=>f.bossRank===null||f.layer%10===0),
 'only an actual tenth-floor boss can trigger a rank event');
const repeat=runJourney(20261024,{style:'A',route:'short',maxSorties:2,maxFights:120});
const repeatAgain=runJourney(20261024,{style:'A',route:'short',maxSorties:2,maxFights:120});
assert.deepEqual(repeatAgain,repeat,'identical seed and policy must reproduce every battle and earned resource');
const alchemy=runJourney(20261024,{style:'A',route:'short',alchemy:true,maxSorties:4,maxFights:180});
assert.equal(alchemy.resourceLedger.items.alchemyConsumed,5*alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.items.alchemyCreated,alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.collections.alchemyConsumed,alchemy.alchemyCrafts);
assert.equal(alchemy.resourceLedger.items.held,alchemy.inventory);
assert.equal(alchemy.resourceLedger.collections.held,
 Object.values(alchemy.collection).reduce((a,b)=>a+b,0));

console.log('PASS manifest coverage, reproducible seeded combat, 80/80 rank, item/collection/stone/ink conservation and 6 routes '+ECONOMY_VERSION);
