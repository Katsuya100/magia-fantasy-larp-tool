import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,floor,level,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel,enemyForFight,rarityWeights,rollRarity,rollCollection,bossUniqueCollection} from '../assets/js/dungeon-design.mjs';

const get=async file=>G.parseCsv(await readFile(new URL('../assets/data/'+file,import.meta.url),'utf8'));
const [enemies,items,collections,buffs,balance,levels,floors,playerBase]=await Promise.all(
 ['dungeon-enemies.csv','dungeon-consumables.csv','dungeon-collections.csv','dungeon-buffs.csv','dungeon-balance.csv','dungeon-levels.csv','dungeon-floors.csv','dungeon-player-base.csv'].map(get));
configure({balance,levels,floors,playerBase});
assert.equal(enemies.length,500);
assert.equal(collections.length,300);
assert.equal(levels.length,150);
assert.equal(floors.length,500);
assert.equal(num('level_max'),150);
assert.ok(G.validateMasters(enemies,items,collections,buffs));
for(const [rows,name] of [[enemies,'enemy'],[collections,'collection']]){
 assert.equal(new Set(rows.map(x=>x.id)).size,rows.length,name+' IDs unique');
 assert.equal(new Set(rows.map(x=>x.name)).size,rows.length,name+' names unique');
}
assert.deepEqual(Object.fromEntries(['common','uncommon','rare','epic','legendary'].map(r=>[r,collections.filter(x=>x.rarity===r).length])),
 {common:104,uncommon:52,rare:26,epic:13,legendary:105});
assert.deepEqual(rarityWeights(1),[40,20,10,5,2]);
const histogram=Object.fromEntries(['common','uncommon','rare','epic','legendary'].map(r=>[r,0]));
for(let i=0;i<7700;i++)histogram[rollRarity(1,()=>(i+.5)/7700)]++;
assert.deepEqual(histogram,{common:4000,uncommon:2000,rare:1000,epic:500,legendary:200});
const first=rarityWeights(1),last=rarityWeights(100),sum=a=>a.reduce((x,y)=>x+y,0);
assert.ok((last[2]+last[3]+last[4])/sum(last)>(first[2]+first[3]+first[4])/sum(first));
assert.ok(last[4]/sum(last)>.025&&last[4]/sum(last)<.06,'legendary remains a rare random drop');
assert.deepEqual(rarityWeights(100),rarityWeights(500),'deep bonuses cap at 100');
assert.equal(rollCollection(collections,100,()=>.999).rarity,'legendary');
assert.ok(!rollCollection(collections,100,()=>.999).boss_enemy_id,'boss unique items cannot roll at random');

assert.equal(targetClearLevel(1),1);
assert.equal(targetClearLevel(2),3);
assert.equal(targetClearLevel(3),5);
assert.equal(targetClearLevel(100),150);
assert.equal(targetClearLevel(101),150);
const profile={level:1,xp:0},base={hp:100,mag:10,def:7,res:7};
const attack={role:'attack',attribute:'flame',power:1200};
for(let layer=1;layer<=100;layer++){
 const expected=targetClearLevel(layer);
 assert.ok(layer===1||expected>=targetClearLevel(layer-1));
 const ids=[];
 for(let slot=1;slot<=5;slot++){
  const fight=(layer-1)*5+slot,foe=enemyForFight(enemies,fight,()=>.999),spec=floor(fight);
  assert.equal(+spec.enemy_level,expected);
  assert.equal(+spec.boss,slot===5?1:0);
  assert.equal(foe.boss_only,slot===5?'1':'0');
  assert.equal(+foe.min_level,expected);
  assert.equal(spec.boss_enemy_id,slot===5?foe.id:'');
  ids.push(foe.id);
 }
 assert.equal(new Set(ids).size,5,'distinct enemy kinds at layer '+layer);
 const bossId=ids[4],trophy=bossUniqueCollection(collections,bossId);
 const rewards=G.drops(items,collections,expected,()=>0,{layer,bossEnemyId:bossId});
 assert.ok(rewards.length>=1&&rewards.length<=7);
 assert.equal(rewards.filter(x=>x.id===trophy.id).length,1,'boss trophy guaranteed at layer '+layer);
 const hero=G.makeUnit(base,expected,{},[attack]);
 const boss=G.fromEnemy(enemies.find(x=>x.id===bossId),expected);
 const outgoing=G.damage(hero,boss,attack,()=>.99),incoming=G.damage(boss,hero,boss.spells[0],()=>.99);
 const turnsToKill=Math.ceil(boss.hp/Math.max(1,outgoing));
 const turnsToFall=Math.ceil(hero.hp/Math.max(1,incoming));
 assert.ok(outgoing>0&&turnsToKill<=turnsToFall*2,'approximate combat budget layer '+layer+' '+turnsToKill+'/'+turnsToFall);
 assert.equal(profile.level,expected,'level after five fights fits layer '+layer);
 if(layer<100)G.experience(profile,5*(num('xp_base')+num('xp_per_level')*expected));
}
assert.equal(level(150).carry_limit,'15');
for(let i=0;i<500;i++)assert.equal(enemyForFight(enemies,501,()=>(i+.5)/500).id,enemies[i].id);
for(let i=0;i<100;i++){
 const boss=enemyForFight(enemies,505,()=>(i+.5)/100);
 assert.equal(boss.boss_only,'1');
 assert.equal(bossUniqueCollection(collections,boss.id).rarity,'legendary');
}
assert.equal(floor(505).enemy_level,'150');
assert.equal(floor(505).boss,'1');
console.log('PASS 300 relics, 500 monsters, boss drops, 100-layer curve, XP and combat budget');
