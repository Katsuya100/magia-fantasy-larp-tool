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
const rarityRanks={common:0,uncommon:1,rare:2,epic:3,legendary:4};
const names=collections.map(x=>x.name);
assert.equal(new Set(names).size,300,'all relic names must be distinct');
assert.ok(names.every(name=>!/\\d/.test(name)&&name.length<=20),'relic display names have no serial numbers');
for(let i=1;i<collections.length;i++)
 assert.ok(rarityRanks[collections[i].rarity]>=rarityRanks[collections[i-1].rarity],'CSV is ordered by rarity');
for(const id of ['fang','slime_core','bone','copper_sigil','obsidian','moon_scale','ancient_scroll',
 'lightning_crystal','aqua_pearl','labyrinth_key','sealed_eye','forgotten_crown'])
 assert.ok(collections.some(item=>item.id===id),'preserve original collectible ID '+id);
assert.deepEqual(enemies.slice(0,4).map(x=>x.name),['スライム','コウモリ','ネズミ','ゴブリン']);
assert.ok(enemies.slice(0,95).every(x=>x.name.length<=13),'early monster names stay approachable');
const earlySpecies=new Set(enemies.slice(0,95).filter(x=>x.boss_only==='0').map(x=>x.name));
const variantPrefixes=['赤','青','黒','白','金','銀','岩','霧','砂','氷','炎','雷',
 '毒','影','森','闇','鉄','翡翠','灼熱','吹雪','雷光','幽霊','深淵','星屑'];
let midNew=0,midVariants=0;
for(let layer=20;layer<=79;layer++){
 for(let slot=0;slot<4;slot++){
  const row=enemies[(layer-1)*5+slot];
  const match=variantPrefixes.some(prefix=>row.name.startsWith(prefix)&&
   earlySpecies.has(row.name.slice(prefix.length)));
  if(slot%2===0){
   assert.ok(!match&&!earlySpecies.has(row.name),'new species at layer '+layer);
   midNew++;
  }else{
   assert.ok(match,'existing monster variation at layer '+layer);
   midVariants++;
  }
 }
}
assert.equal(midNew,120,'half of mid-layer normal foes are new types');
assert.equal(midVariants,120,'half of mid-layer normal foes are variations');
for(let layer=1;layer<=100;layer++){
 const boss=enemies[layer*5-1],trophy=collections.find(x=>x.boss_enemy_id===boss.id);
 assert.equal(boss.boss_only,'1');
 assert.ok(!/(先遣|守衛|潜伏|術師|スライム)/.test(boss.name),'boss has a distinct formidable name');
 assert.ok(trophy?.description.includes(boss.name),'named boss and trophy lore stay consistent');
}

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
