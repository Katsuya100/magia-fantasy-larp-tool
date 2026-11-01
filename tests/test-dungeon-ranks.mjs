import assert from 'node:assert/strict';
import {ADVENTURER_RANKS,rankAt,rankTitle,rankBadgeName,highestRankLayer,
 unlockedStartLayers,allowedStartLayer,RANK_FAST_WINS_REQUIRED,RANK_LATE_BOSSES_REQUIRED,RANK_MEASURED_FIGHTS,recordRankCombat,rankBadgeDrop,acquireAdventurerRank} from '../assets/js/dungeon-ranks.mjs';

const names=['鉛','鉄','鋼','銅','銀','金','白金','ミスリル','アダマンタイト','オリハルコン'];
assert.deepEqual(ADVENTURER_RANKS.map(r=>r.name),names);
assert.deepEqual(ADVENTURER_RANKS.map(r=>r.layer),[10,20,30,40,50,60,70,80,90,100]);
for(const {layer,name} of ADVENTURER_RANKS){
 assert.equal(rankAt(layer)?.name,name);
 assert.equal(rankTitle(layer),name+'級');
 assert.equal(rankBadgeName(layer),name+'級冒険者章');
}
assert.equal(rankAt(110),null);
assert.equal(rankTitle(0),'未取得');
const p={adventurerRank:0,collection:{}};
assert.equal(highestRankLayer({}),0,'legacy saves start unranked');
assert.deepEqual(unlockedStartLayers(p),[1]);
assert.equal(allowedStartLayer(p,11),1,'cannot jump to an unearned layer');
assert.equal(allowedStartLayer(p,'bogus'),1);
assert.equal(allowedStartLayer(p,0),1);
assert.equal(RANK_MEASURED_FIGHTS,45);
assert.equal(RANK_FAST_WINS_REQUIRED,42);
assert.equal(RANK_LATE_BOSSES_REQUIRED,4);
const run={};
for(let fight=1;fight<=50;fight++){
 const rounds=fight<=25&&fight%5===0?3:fight===50?2:1;
 recordRankCombat(run,fight,rounds);
}
assert.deepEqual(run.rankCombat,{end:10,nextFight:51,measured:45,fastWins:44,lateBossFastWins:4});
const h={hp:1,stats:{hp:100},mp:0,maxMp:50};
const mastery=run.rankCombat;
assert.deepEqual(rankBadgeDrop(50,h,p,[],mastery),{type:'rank',layer:10},
 'near-one-shot mastery earns the first chapter without HP/MP reserve');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,fastWins:41}),null,'41 fast wins fail');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,lateBossFastWins:3}),null,'three late boss fast wins fail');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,measured:44}),null,'partial expedition fails');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,nextFight:50}),null,'stale mastery fails');
assert.equal(rankBadgeDrop(50,{...h,hp:0},p,[],mastery),null,'losing hero cannot earn rank');
assert.equal(rankBadgeDrop(49,h,p,[],mastery),null,'only decade bosses award rank');
assert.equal(rankBadgeDrop(5,h,p,[],mastery),null,'ordinary floor bosses cannot award rank');
assert.equal(rankBadgeDrop(505,h,p,[],mastery),null,'endless bosses cannot award rank');
assert.equal(rankBadgeDrop(50,h,p,[{type:'rank',layer:10}],mastery),null,'duplicate pending badge');
assert.equal(rankBadgeDrop(50,h,p,[{type:'rank',layer:20}],mastery),null,'higher pending suppresses lower');
const jumped={};
recordRankCombat(jumped,49,1);
assert.equal(jumped.rankCombat,null,'starting mid-band does not manufacture history');
const second={};
for(let fight=51;fight<=100;fight++)recordRankCombat(second,fight,1);
assert.deepEqual(rankBadgeDrop(100,h,p,[],second.rankCombat),{type:'rank',layer:20},
 'every decade shares the same rule');
assert.equal(acquireAdventurerRank(p,5),false,'invalid grade cannot be granted');
assert.equal(acquireAdventurerRank(p,10),true);
assert.equal(highestRankLayer(p),10);
assert.equal(acquireAdventurerRank(p,10),false,'same grade is unique');
assert.equal(rankBadgeDrop(50,h,p,[],mastery),null,'owned badge does not re-drop');
assert.deepEqual(unlockedStartLayers(p),[1,11]);
assert.equal(allowedStartLayer(p,'11'),11);
assert.equal(allowedStartLayer(p,21),1);
assert.equal(acquireAdventurerRank(p,60),true,'higher grade can be gained without all lower badges');
assert.equal(highestRankLayer(p),60);
assert.deepEqual(unlockedStartLayers(p),[1,11,21,31,41,51,61],'a higher grade automatically unlocks every lower grade');
assert.equal(allowedStartLayer(p,31),31);
assert.equal(allowedStartLayer(p,71),1);
assert.equal(rankBadgeDrop(100,h,p,[],second.rankCombat),null,'higher grade blocks lower drops');
assert.deepEqual(p.collection,{},'badges are never added to the collection');
assert.equal(acquireAdventurerRank(p,100),true);
assert.deepEqual(unlockedStartLayers(p),[1,11,21,31,41,51,61,71,81,91,101]);
assert.equal(allowedStartLayer(p,101),101,'orichalcum permits endless dungeon from floor 101');
assert.equal(acquireAdventurerRank(p,20),false,'lower grade cannot downgrade an earned rank');
assert.equal(highestRankLayer(p),100);
console.log('PASS 42/45 fast wins and four late bosses, unique chapter badges, progression and shortcuts');
