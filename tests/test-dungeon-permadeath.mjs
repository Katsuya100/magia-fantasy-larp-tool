import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createLostLegacy,createSuccessorProfile,legacyContents,reclaimLegacies,markCircleCreator,circleRelicHistory,circleLegacyLevelSources,totalLegacyLevel} from '../assets/js/dungeon-permadeath.mjs';
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
assert.equal(snapshot.circles[0].legacyOriginName,'ミラ','original owner is recorded even for old unstamped circles');
assert.deepEqual(snapshot.circles[0].legacyHeirNames,[],'original creator is not recorded as an heir');
const creatorStamped=markCircleCreator(lost,'  ミラ ');
assert.equal(creatorStamped.legacyOriginName,'ミラ','a new photo remembers its creator on capture');
assert.equal(creatorStamped.image,lost.image,'stamping never changes the source photo');
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
assert.equal(reclaimed.circles[0].legacyOriginName,'ミラ','old legacy gains original owner from the loss record');
const nextRun={...run,slotIds:['lost-circle',null,null,null,null]};
const secondLoss=createLostLegacy({...pack,name:'アオイ'},nextRun,[reclaimed.circles[0]]);
assert.equal(secondLoss.circles[0].legacyOriginName,'ミラ','original owner survives the second character death');
assert.deepEqual(secondLoss.circles[0].legacyHeirNames,['アオイ']);
const thirdLoss=createLostLegacy({...pack,name:'キリ'},nextRun,[secondLoss.circles[0]]);
assert.deepEqual(circleRelicHistory(thirdLoss.circles[0]),{originName:'ミラ',heirNames:['アオイ','キリ']});
const thirdReclaimed=legacyContents(thirdLoss);
assert.deepEqual(thirdReclaimed.circles[0].legacyHeirNames,['アオイ','キリ'],'multiple heirs survive a further recovery');
const unnamedOld=createLostLegacy({...pack,name:'アオイ'},nextRun,[{...lost,legacyHp:24}]);
assert.equal(unnamedOld.circles[0].legacyOriginName,'','an old relic without provenance must not call a later owner its creator');
assert.deepEqual(unnamedOld.circles[0].legacyHeirNames,['アオイ']);
const inherited={...reclaimed.circles[0]};
await saveProfileWithCircles(db,remembered,[inherited]);
assert.equal((await allCircles(db)).find(c=>c.id==='lost-circle').legacyHp,12);
assert.match(circleEffectBadges(inherited),/inherited-flame/);
assert.equal(combatSpell(inherited).legacyHp,12);
const later={...snapshot,name:'別の冒険者',level:3,
 circles:[{...snapshot.circles[0],id:'later-circle',legacyOriginName:'別の冒険者'}],
 loot:[{type:'legacy',legacy:snapshot}]};
const nested=legacyContents(later);
assert.equal(nested.circles[0].legacyOriginName,'別の冒険者','outer legacy keeps its own creator');
assert.equal(nested.circles[1].legacyOriginName,'ミラ','nested legacy keeps the earlier creator');
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
// A, B, C contribute their levels once: 10+20+30=60 (not 120).
let family=markCircleCreator(lost,'A');
for(const [name,level] of [['A',10],['B',20],['C',30]]){
 const legacy=createLostLegacy({...pack,name,level},nextRun,[family]);
 family=legacyContents(legacy).circles[0];
}
assert.deepEqual(circleRelicHistory(family),{originName:'A',heirNames:['B','C']});
assert.deepEqual(circleLegacyLevelSources(family),[{name:'A',level:10},{name:'B',level:20},{name:'C',level:30}]);
assert.equal(totalLegacyLevel(family),60);
assert.equal(family.legacyHp,60,'the legacy HP effect equals the level sum');
const duplicate=legacyContents(createLostLegacy({...pack,name:'B',level:99},nextRun,[family])).circles[0];
assert.equal(duplicate.legacyHp,60,'B cannot contribute again');
assert.deepEqual(circleRelicHistory(duplicate).heirNames,['B','C']);
assert.equal(combatSpell(family).legacyHp,60);
assert.deepEqual(combatSpell(family).legacyHpSources,[{name:'A',hp:10},{name:'B',hp:20},{name:'C',hp:30}]);

// Recover previous-release data: per-owner HP was level*2, now converted to level.
const previousCircle={...lost,id:'previous-circle',legacyOriginName:'A',legacyHp:60,
 legacyHpSources:[{name:'A',hp:20},{name:'B',hp:40}],legacyHeirNames:['B']};
assert.deepEqual(circleLegacyLevelSources(previousCircle),[{name:'A',level:10},{name:'B',level:20}]);
assert.equal(combatSpell(previousCircle).legacyHp,30,'old per-owner HP is converted without re-doubling');
const previousRecovered=legacyContents({name:'C',level:30,circles:[previousCircle],items:[],loot:[]}).circles[0];
assert.equal(previousRecovered.legacyHp,60);
assert.equal(previousRecovered.legacyHpSources,undefined,'new saves use level sources only');
assert.deepEqual(previousRecovered.legacyLevelSources,circleLegacyLevelSources(family));

// Older saves have just a numeric legacyHp, so keep their recorded level total.
// Individual historical levels cannot be reconstructed from names alone.
const oldCircle={...lost,id:'old-circle',legacyOriginName:'old',legacyHp:24};
assert.equal(totalLegacyLevel(oldCircle),12);
const migrated=legacyContents({name:'new',level:5,circles:[oldCircle],items:[],loot:[]}).circles[0];
assert.equal(migrated.legacyHp,17,'old 24 HP means Lv.12, plus new Lv.5');
assert.deepEqual(circleLegacyLevelSources(migrated),[{name:'old',level:12},{name:'new',level:5}]);

// AA and ABBC do not stack, but ABC does, even across different spells.
const single=(name,hp,role='support')=>({attribute:'flame',role,power:0,legacyHp:hp,legacyHpSources:[{name,hp}]});
const sharedHero=G.makeUnit(base,1,{},[],'player'),sharedEnemy=G.makeUnit(base,1);
G.cast(sharedHero,sharedEnemy,single('A',10),[]);
G.cast(sharedHero,sharedEnemy,single('A',10),[]);
assert.equal(sharedHero.stats.hp,110,'AA only grants A once');
G.cast(sharedHero,sharedEnemy,{attribute:'flame',role:'defense',power:0,legacyHp:30,
 legacyHpSources:[{name:'A',hp:10},{name:'B',hp:20},{name:'B',hp:20}]},[]);
assert.equal(sharedHero.stats.hp,130,'A + B applies each name once');
G.cast(sharedHero,sharedEnemy,{attribute:'flame',role:'support',power:0,legacyHp:50,
 legacyHpSources:[{name:'B',hp:20},{name:'C',hp:30}]},[]);
assert.equal(sharedHero.stats.hp,160,'ABC totals Lv.60, not ABBC');
G.cast(sharedHero,sharedEnemy,{...combatSpell(family),role:'support'},[]);
assert.equal(sharedHero.stats.hp,160,'repeat casting cannot stack the same ancestors');
assert.deepEqual(sharedHero.legacyHpApplied,['A','B','C']);

// Attack and debuff reduce only enemy HP by the unique level total.
const weakeningHero=G.makeUnit(base,1,{},[],'player'),weakeningEnemy=G.makeUnit(base,1);
G.cast(weakeningHero,weakeningEnemy,single('A',10,'attack'),[]);
G.cast(weakeningHero,weakeningEnemy,single('A',10,'debuff'),[]);
G.cast(weakeningHero,weakeningEnemy,{...combatSpell(family),role:'debuff',power:0},[]);
assert.equal(weakeningEnemy.stats.hp,40,'A then ABC lowers max HP by 60');
assert.equal(weakeningHero.stats.hp,100);
assert.match(circleEffectBadges(family),/継承：最大HP-60/,'attack tooltip shows only reduction');
assert.match(circleEffectBadges({...family,analysis:{...family.analysis,role:'defense'}}),/継承：最大HP\\+60/,'defense tooltip shows only increase');
const newEnemy=G.makeUnit(base,1);
G.cast(weakeningHero,newEnemy,single('A',10,'attack'),[]);
assert.equal(newEnemy.stats.hp,90,'a new opponent can be affected separately');
const legacyOnly=G.makeUnit(base,1,{},[],'player');
G.cast(legacyOnly,G.makeUnit(base,1),{attribute:'flame',role:'support',power:0,legacyHp:20},[]);
G.cast(legacyOnly,G.makeUnit(base,1),{attribute:'flame',role:'support',power:0,legacyHp:20},[]);
assert.equal(legacyOnly.stats.hp,120,'numeric-only spells do not stack indefinitely');

console.log('PASS dungeon permadeath, heir inheritance, enemy-bound relics and blue-flame max HP effects');
