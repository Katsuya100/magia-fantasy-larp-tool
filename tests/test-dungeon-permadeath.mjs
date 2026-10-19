import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createLostLegacy,createSuccessorProfile,legacyContents,reclaimLegacies} from '../assets/js/dungeon-permadeath.mjs';
import {openStore,getProfile,putCircle,allCircles,saveProfileWithCircles} from '../assets/js/dungeon-store.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {combatSpell} from '../assets/js/dungeon-upgrades.mjs';
import {circleEffectBadges} from '../assets/js/dungeon-preparation-ui.mjs';
const root=new URL('../assets/data/',import.meta.url);
const csv=async name=>G.parseCsv(await readFile(new URL(name,root),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(
 ['dungeon-balance.csv','dungeon-levels.csv','dungeon-floors.csv','dungeon-player-base.csv'].map(csv));
configure({balance,levels,floors,playerBase});
const photo=new Blob(['photo'],{type:'image/jpeg'});
const lost={id:'lost-circle',image:photo,analysis:{attribute:'flame',role:'attack',power:120},revealed:true,basePower:120,upgradeLevel:1};
const safe={id:'safe-circle',image:photo,analysis:{attribute:'aqua',role:'support',power:120},revealed:true};
const pack={name:'ミラ',level:12,xp:88,base:{hp:100,mag:10,def:7,res:7},
 returns:3,attempts:7,inventory:[{type:'use',id:'heal_s',instanceId:'stored'}],
 obtainedItemIds:['heal_s'],slots:['lost-circle','safe-circle',null,null,null],
 carrySlots:['stored'],magicStones:7,adventurerRank:20,deepestReturnedLayer:22,
 defeatedBosses:{boss:true},collection:{relic:2},circleUpgrades:{'lost-circle':{basePower:120,upgradeLevel:1}},
 tutorialDone:true,permadeath:true,run:null};
const run={enemy:{id:'enemy_x'},slotIds:['lost-circle',null,null,null,null],
 carry:[{type:'use',id:'mana_s',instanceId:'carried'}],
 loot:[{type:'use',id:'heal_l'},{type:'rank',layer:30},{type:'stone'}]};
const snapshot=createLostLegacy(pack,run,[lost,safe]);
assert.deepEqual(snapshot.circles.map(c=>c.id),['lost-circle']);
assert.equal(snapshot.items[0].id,'mana_s');
assert.equal(snapshot.loot.length,3);
const heir=createSuccessorProfile(pack,run,[lost,safe],{hp:90,mag:8,def:5,res:5});
assert.equal(heir.name,'');
assert.equal(heir.level,1);assert.equal(heir.xp,0);
assert.equal(heir.magicStones,7);
assert.equal(heir.inventory.length,1,'unused banked goods persist');
assert.equal(heir.adventurerRank,0);
assert.equal(heir.returns,0);
assert.equal(heir.awaitingHeir,true);
assert.equal(heir.permadeath,true);
assert.deepEqual(heir.slots,[null,'safe-circle',null,null,null]);
assert.equal(heir.legacies[0].name,'ミラ');
assert.equal(heir.legacies[0].level,12);
const db=await openStore(fakeIndexedDB());
await putCircle(db,lost);await putCircle(db,safe);
await saveProfileWithCircles(db,heir,[],['lost-circle']);
assert.deepEqual((await allCircles(db)).map(c=>c.id),['safe-circle']);
assert.equal((await getProfile(db)).legacies[0].circles[0].image.size,photo.size);
const hunt={loot:[]};const remembered=await getProfile(db);
assert.deepEqual(reclaimLegacies(remembered,'another_enemy',hunt),[]);
assert.deepEqual(hunt.loot,[]);
assert.equal(reclaimLegacies(remembered,'enemy_x',hunt).length,1);
assert.equal(remembered.legacies.length,0);
const reclaimed=legacyContents(hunt.loot[0].legacy);
assert.deepEqual(reclaimed.items.map(i=>i.id),['mana_s']);
assert.deepEqual(reclaimed.loot.map(i=>i.type),['use','rank','stone']);
assert.equal(reclaimed.rank,20);
const inherited={...reclaimed.circles[0],legacyHp:12*2};
await saveProfileWithCircles(db,remembered,[inherited]);
assert.equal((await allCircles(db)).find(c=>c.id==='lost-circle').legacyHp,24);
assert.match(circleEffectBadges(inherited),/inherited-flame/);
assert.equal(combatSpell(inherited).legacyHp,24);
const later={...snapshot,name:'別の冒険者',level:3,loot:[{type:'legacy',legacy:snapshot}]};
const nested=legacyContents(later);
assert.equal(nested.circles.length,2);
assert.equal(nested.items.length,2);
assert.equal(nested.loot.length,3);
const base={hp:100,mag:10,def:7,res:7};
for(const role of ['support','defense']){
 const hero=G.makeUnit(base,1,{},[],'player'),foe=G.makeUnit(base,1);
 G.cast(hero,foe,{attribute:'flame',role,power:0,legacyHp:24},[]);
 assert.equal(hero.stats.hp,124,role+' raises self max HP');
 assert.equal(foe.stats.hp,100);
}
for(const role of ['attack','debuff']){
 const hero=G.makeUnit(base,1,{},[],'player'),foe=G.makeUnit(base,1);
 G.cast(hero,foe,{attribute:'flame',role,power:0,legacyHp:24},[]);
 assert.equal(foe.stats.hp,76,role+' lowers enemy max HP');
 assert.equal(hero.stats.hp,100);
}
const hero=G.makeUnit(base,1,{},[],'player'),foe=G.makeUnit(base,1);
G.cast(hero,foe,{attribute:'flame',role:'attack',power:0,legacyHp:200},[]);
assert.equal(foe.stats.hp,1,'enemy max HP cannot fall below 1');
assert.equal(foe.hp,1,'current HP is capped after reducing max');
const hostile=G.makeUnit(base,1);
G.cast(hostile,hero,{attribute:'flame',role:'attack',power:0,legacyHp:50},[]);
assert.equal(hero.stats.hp,100,'enemies never get the heir-only bonus');
console.log('PASS dungeon permadeath, heir inheritance, enemy-bound relics and blue-flame max HP effects');
