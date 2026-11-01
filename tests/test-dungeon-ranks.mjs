import assert from 'node:assert/strict';
import {ADVENTURER_RANKS,rankAt,rankTitle,rankBadgeName,highestRankLayer,
 unlockedStartLayers,allowedStartLayer,RANK_LEGACY_RESERVE_PERCENT,RANK_EARLY_NORMAL_FIGHTS,RANK_EARLY_FAST_WINS_REQUIRED,RANK_FINAL_BOSS_MAX_ROUNDS,recordRankCombat,rankBadgeDrop,acquireAdventurerRank} from '../assets/js/dungeon-ranks.mjs';

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
assert.equal(RANK_LEGACY_RESERVE_PERCENT,80);
assert.equal(RANK_EARLY_NORMAL_FIGHTS,20);
assert.equal(RANK_EARLY_FAST_WINS_REQUIRED,18);
assert.equal(RANK_FINAL_BOSS_MAX_ROUNDS,3);
const run={};
for(let fight=1;fight<=50;fight++){
 const isEarlyNormal=fight<=25&&fight%5!==0;
 const rounds=isEarlyNormal?([1,2].includes(fight)?2:1):fight===50?3:2;
 recordRankCombat(run,fight,rounds);
}
assert.deepEqual(run.rankCombat,{end:10,nextFight:51,earlyMobs:20,earlyFastWins:18,bossRounds:3});
const h={hp:1,stats:{hp:100},mp:0,maxMp:50};
const mastery=run.rankCombat;
const legacy={hp:80,stats:{hp:100},mp:40,maxMp:50};
assert.deepEqual(rankBadgeDrop(50,legacy,p),{type:'rank',layer:10},
 'old HP/MP 80/80 remains a standalone way to earn the chapter');
assert.deepEqual(rankBadgeDrop(50,legacy,p,[],{...mastery,earlyFastWins:0,bossRounds:10}),{type:'rank',layer:10},
 'failed turn mastery must not cancel a legal old reserve award');
assert.equal(rankBadgeDrop(50,{...legacy,hp:79.999},p),null,'below old HP limit alone does not qualify');
assert.equal(rankBadgeDrop(50,{...legacy,mp:39.999},p),null,'below old MP limit alone does not qualify');
assert.equal(rankBadgeDrop(50,{...legacy,hp:79.999,mp:39.999},p),null,'neither route qualifies');
assert.deepEqual(rankBadgeDrop(50,h,p,[],mastery),{type:'rank',layer:10},
 '18 early normal one-turn wins and three-turn final boss earn chapter at low MP');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,earlyFastWins:17}),null,'too few fast early normal wins');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,earlyMobs:19}),null,'incomplete early normal fights fail');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,bossRounds:4}),null,'four-turn final boss fails');
assert.deepEqual(rankBadgeDrop(50,h,p,[],{...mastery,bossRounds:1}),{type:'rank',layer:10},
 'a late overpowered replay is not punished for a one-turn boss');
assert.equal(rankBadgeDrop(50,h,p,[],{...mastery,nextFight:50}),null,'stale mastery fails');
assert.equal(rankBadgeDrop(50,{...h,hp:0},p,[],mastery),null,'defeated hero cannot earn chapter');
assert.equal(rankBadgeDrop(49,h,p,[],mastery),null,'non-decade encounter fails');
assert.equal(rankBadgeDrop(5,h,p,[],mastery),null,'ordinary floor boss fails');
assert.equal(rankBadgeDrop(505,h,p,[],mastery),null,'endless floor fails');
assert.equal(rankBadgeDrop(50,h,p,[{type:'rank',layer:10}],mastery),null,'duplicate pending chapter');
assert.equal(rankBadgeDrop(50,h,p,[{type:'rank',layer:20}],mastery),null,'pending higher chapter suppresses lower');
const jumped={};
recordRankCombat(jumped,49,1);
assert.equal(jumped.rankCombat,null,'starting mid-band cannot invent earlier fights');
const second={};
for(let fight=51;fight<=100;fight++)recordRankCombat(second,fight,1);
assert.deepEqual(rankBadgeDrop(100,h,p,[],second.rankCombat),{type:'rank',layer:20},
 'other decades follow the identical rule');
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
console.log('PASS 18/20 early fast wins and three-turn decade boss, unique chapter badges, progression and shortcuts');
