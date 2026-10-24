import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,floor,level,num} from '../assets/js/dungeon-tuning.mjs';
import {nameAffinities} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {targetClearLevel,enemyForFight,shuffledLayerEnemyIds,legendaryDropRate,rarityWeights,rollRarity,rollCollection,bossUniqueCollection} from '../assets/js/dungeon-design.mjs';

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
// Common drops remain grouped by rarity; named boss trophies stay grouped
// by layer number so their artwork and stable catalogue indices do not change.
const randomCollections=collections.filter(x=>!x.boss_enemy_id);
const bossTrophies=collections.filter(x=>x.boss_enemy_id);
for(let i=1;i<randomCollections.length;i++)
 assert.ok(rarityRanks[randomCollections[i].rarity]>=rarityRanks[randomCollections[i-1].rarity],'random collection CSV is ordered by rarity');
assert.equal(randomCollections.length,200);
assert.equal(bossTrophies.length,100);
assert.deepEqual(bossTrophies.map(x=>x.boss_enemy_id),Array.from({length:100},(_,i)=>'boss_l'+String(i+1).padStart(3,'0')),
 'boss trophy catalogue order and artwork indexes remain stable');
for(const id of ['fang','slime_core','bone','copper_sigil','obsidian','moon_scale','ancient_scroll',
 'lightning_crystal','aqua_pearl','labyrinth_key','sealed_eye','forgotten_crown'])
 assert.ok(collections.some(item=>item.id===id),'preserve original collectible ID '+id);
assert.deepEqual(enemies.slice(0,4).map(x=>x.name),['スライム','コウモリ','ネズミ','ゴブリン']);
assert.ok(enemies.slice(0,95).every(x=>x.name.length<=13),'early monster names stay approachable');
// Snake-themed names are intentionally rethemed to eels and catfish.
assert.ok(enemies.every(enemy=>!/(ヘビ|蛇|コブラ|バジリスク|サーペント|ヒドラ)/.test(enemy.name)),
 'no old snake-themed enemy names remain');
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

// A layer should feel like the named boss's domain without changing
// the existing five-encounter format, power budget, or 100 boss identities.
// All five monsters share a dominant element; the second element adds variety.
const layerNames=layer=>enemies.slice((layer-1)*5,layer*5).map(x=>x.name);
for(const [layer,expected] of [
 [8,['鰻','毒ナマズ','イール','キャットフィッシュ','毒鰭の鰻王']],
 [13,['火ネズミ','鬼火','火スライム','赤トロール','炎角の牛魔王']],
 [24,['海賊乗組員','幽霊スケルトン','海賊狙撃手','霧ゴブリン兵','幽霊船長']],
 [38,['ライトニングバード','雷ウルフ','サンダーウルフ','雷カラス','落雷の王獣']],
 [48,['アイスゴーレム','氷石ゴーレム','フロストビースト','吹雪ドライアド','氷河の巨神']],
 [63,['アビスイール','青鰻','黒潮の長龍','深淵毒ナマズ','絶海の鰻龍']],
 [99,['世界樹の根竜','終末の木霊','腐朽の神獣','黒葉の守護兵','世界樹の終末竜']]
])assert.deepEqual(layerNames(layer),expected,'coherent faction in layer '+layer);
assert.ok([...layerNames(8),...layerNames(63)].every(name=>!name.includes('竜')),
 'eel-and-dragon-themed layer names must use 龍, never 竜');
assert.ok(layerNames(63).some(name=>name.includes('長龍')),
 'deep sea layer includes an original long-dragon variant');
for(let layer=1;layer<=100;layer++){
 const party=enemies.slice((layer-1)*5,layer*5);
 const spells=party.map(row=>row.spells.split('|').map(value=>{
  const [role,attribute,power]=value.split(':');
  return {role,attribute,power:Number(power)};
 }));
 for(let slot=0;slot<5;slot++){
  const main=spells[slot][0].attribute,secondary=spells[slot][2].attribute;
  assert.equal(spells[slot].length,5,'five spells for layer '+layer);
  assert.notEqual(main,secondary,'each monster retains its main and alternate attack identity '+party[slot].id);
  assert.equal(spells[slot].filter(spell=>spell.attribute===main).length,3,
   'three primary spell slots under reviewed worldview '+party[slot].id);
  assert.equal(spells[slot].filter(spell=>spell.attribute===secondary).length,2,
   'two secondary spell slots under reviewed worldview '+party[slot].id);
  if(slot===4){
   assert.ok(Number(party[slot]['resist_'+main])<=1||layer===80,
    'only 80F boss may be vulnerable to its main attribute '+layer);
   if(layer===80){
    assert.equal(Number(party[slot].resist_gravity),1.25);
    assert.equal(Number(party[slot].resist_law),1.2);
   }
  }else{
   const tags=nameAffinities(party[slot].name);
   assert.ok(Number(party[slot]['resist_'+main])<=1,'no unreviewed normal primary weakness '+party[slot].id);
   if(tags.length){
    assert.ok(tags.every(attr=>Number(party[slot]['resist_'+attr])<=1),
     'normal foe name must not advertise an elemental weakness '+party[slot].name);
    assert.ok(tags.some(attr=>Number(party[slot]['resist_'+attr])<1),
     'normal foe name must predict actual elemental resistance '+party[slot].name);
   }
  }
 }
}

// Preserve a mix of counters throughout the 100-layer level curve.
// The old first-monster-of-each-layer quota predated the 500-enemy
// worldview rewrite. Audit all 500 actual primary identities instead of
// imposing an obsolete equal-distribution fixture on ordinary wildlife.
const affinityCounts=Object.fromEntries(G.ATTRS.map(attribute=>[attribute,0]));
for(const row of enemies){
 const primary=row.spells.split('|')[0].split(':')[1];
 assert.ok(G.ATTRS.includes(primary),'seven-attribute primary '+row.id);
 affinityCounts[primary]++;
}
assert.equal(Object.values(affinityCounts).reduce((sum,n)=>sum+n,0),500);
assert.ok(Object.values(affinityCounts).every(count=>count>=10&&count<=200),
 'all seven elements remain meaningfully represented in the 500 enemy catalog');

assert.equal(levels.length,150);
assert.equal(floors.length,500);
assert.equal(num('level_max'),150);
assert.ok(G.validateMasters(enemies,items,collections,buffs));
for(const [rows,name] of [[enemies,'enemy'],[collections,'collection']]){
 assert.equal(new Set(rows.map(x=>x.id)).size,rows.length,name+' IDs unique');
 assert.equal(new Set(rows.map(x=>x.name)).size,rows.length,name+' names unique');
}
assert.deepEqual(Object.fromEntries(['common','uncommon','rare','epic','legendary'].map(r=>[r,collections.filter(x=>x.rarity===r).length])),
 {common:104,uncommon:52,rare:26,epic:103,legendary:15});
assert.equal(bossTrophies.filter(x=>x.rarity==='epic').length,90,'non-decade boss trophies are epic');
assert.equal(bossTrophies.filter(x=>x.rarity==='legendary').length,10,'every tenth-layer trophy stays legendary');
const first=rarityWeights(1),last=rarityWeights(100),sum=a=>a.reduce((x,y)=>x+y,0);
assert.deepEqual(first.slice(0,4),[40,20,10,5]);
assert.equal(legendaryDropRate(1),.0002,'layer 1 legendary starts at 0.02%');
assert.equal(legendaryDropRate(100),.1,'layer 100 legendary reaches 10%');
assert.equal(legendaryDropRate(500),.1,'endless layers remain at 10%');
let previous=-1;
for(const layer of [1,2,10,20,50,75,99,100,101,500]){
 const weights=rarityWeights(layer),rate=legendaryDropRate(layer);
 assert.ok(rate>=previous,'legendary chance never drops as depth increases');
 assert.ok(Math.abs(weights[4]/sum(weights)-rate)<1e-12,'legendary rarity roll matches the authored rate at layer '+layer);
 const samples=100000;let found=0;
 for(let i=0;i<samples;i++)if(rollRarity(layer,()=>(i+.5)/samples)==='legendary')found++;
 assert.ok(Math.abs(found-samples*rate)<=1,'legendary outcomes track the expected rate at layer '+layer);
 previous=rate;
}
assert.ok((last[2]+last[3]+last[4])/sum(last)>(first[2]+first[3]+first[4])/sum(first));
assert.deepEqual(rarityWeights(100),rarityWeights(500),'deep bonuses cap at 100');
assert.equal(rollCollection(collections,100,()=>.999).rarity,'legendary');
assert.ok(!rollCollection(collections,100,()=>.999).boss_enemy_id,'boss unique items cannot roll at random');

// The four regular monsters of each designed layer form a true shuffled
// permutation; the separate fifth battle is the fixed boss.
for(const layer of [1,2,10,50,100]){
 const prefix='foe_l'+String(layer).padStart(3,'0')+'_';
 const canonical=Array.from({length:4},(_,i)=>prefix+(i+1));
 const low=shuffledLayerEnemyIds(enemies,layer,()=>0);
 const high=shuffledLayerEnemyIds(enemies,layer,()=>.999999);
 assert.deepEqual([...low].sort(),canonical,'all four regular foes appear exactly once in layer '+layer);
 assert.notDeepEqual(low,high,'enemy order varies between expeditions in layer '+layer);
 assert.deepEqual(high,canonical,'high RNG draw retains original order');
 assert.deepEqual(shuffledLayerEnemyIds(enemies,layer,()=>0,2).slice(0,2),canonical.slice(0,2),
  'legacy in-progress run keeps enemies it already fought');
}
assert.throws(()=>shuffledLayerEnemyIds(enemies,0),/Invalid designed layer/);
assert.throws(()=>shuffledLayerEnemyIds(enemies,1,()=>0,5),/Invalid completed encounters/);
assert.equal(targetClearLevel(1),1);
assert.equal(targetClearLevel(2),3);
assert.equal(targetClearLevel(3),5);
assert.equal(targetClearLevel(100),150);
assert.equal(targetClearLevel(101),151);
assert.equal(targetClearLevel(102),152);
assert.equal(targetClearLevel(110),160);
assert.equal(targetClearLevel(200),250);
assert.equal(targetClearLevel(500),550);
assert.equal(+level(151).hp_multiplier,29.5);
assert.equal(+level(151).mag_multiplier,19);
assert.equal(+level(151).def_multiplier,15.25);
assert.equal(+level(151).res_multiplier,15.25);
for(const stat of ['hp','mag','def','res']){
 const key=stat+'_multiplier';
 assert.ok(+level(151)[key]>+level(150)[key],stat+' continues growing beyond Lv150');
 assert.ok(+level(250)[key]>+level(151)[key],stat+' continues growing to Lv250');
}
assert.deepEqual(G.stats({hp:100,mag:10,def:7,res:7},151),
 {hp:2950,mag:190,def:107,res:107},
 'above-cap enemies use extended stat multipliers');
const profile={level:1,xp:0},base={hp:100,mag:10,def:7,res:7};
const attack={role:'attack',attribute:'flame',power:1200};
for(let layer=1;layer<=100;layer++){
 const expected=targetClearLevel(layer);
 // Keep the player progression curve; the approved F1-F9 enemy-only
 // level-1 exception cannot bleed into F10 or 101F+ scaling.
 const encounterLevel=layer<=9?1:expected;
 assert.ok(layer===1||expected>=targetClearLevel(layer-1));
 const ids=[];
 for(let slot=1;slot<=5;slot++){
  const fight=(layer-1)*5+slot,foe=enemyForFight(enemies,fight,()=>.999),spec=floor(fight);
  assert.equal(+spec.enemy_level,encounterLevel);
  assert.equal(+spec.boss,slot===5?1:0);
  assert.equal(foe.boss_only,slot===5?'1':'0');
  assert.equal(+foe.min_level,expected,'original enemy identity and intended minimum level remain unchanged');
  assert.equal(spec.boss_enemy_id,slot===5?foe.id:'');
  ids.push(foe.id);
 }
 assert.equal(new Set(ids).size,5,'distinct enemy kinds at layer '+layer);
 const bossId=ids[4],trophy=bossUniqueCollection(collections,bossId);
 assert.equal(trophy.rarity,layer%10===0?'legendary':'epic','boss trophy rarity for layer '+layer);
 const favored=enemies.find(x=>x.id===bossId).favored_collection_ids.split('|');
 assert.ok(favored.includes(trophy.id),'boss favors its own unique trophy at layer '+layer);
 const rewards=G.drops(items,collections,expected,()=>0,{layer,bossEnemyId:bossId,favoredCollectionIds:favored});
 assert.ok(rewards.filter(x=>x.type!=='ink').length<=9,'existing rewards retain their 9-item ceiling');
 assert.equal(rewards.filter(x=>x.type==='ink').length,1,'bosses have one independent ink roll');
 assert.equal(rewards.filter(x=>x.id===trophy.id).length,0,'common rolls never give epic or legendary trophies');
 const weights=rarityWeights(layer),totalWeight=weights.reduce((sum,n)=>sum+n,0);
 const epicTicket=(weights[0]+weights[1]+weights[2]+weights[3]/2)/totalWeight;
 const picks=[trophy.rarity==='legendary'?.999:epicTicket,0,0];
 assert.equal(rollCollection(collections,layer,()=>picks.shift()??0,bossId,[trophy.id]).id,trophy.id,
  'named boss trophy can be favored inside its own rarity');
 assert.equal(rollCollection(collections,layer,()=>.999).boss_enemy_id,'',
  'ordinary enemies cannot find boss-exclusive trophies');
 const hero=G.makeUnit(base,expected,{},[attack]);
 const boss=G.fromEnemy(enemies.find(x=>x.id===bossId),expected);
 const outgoing=G.damage(hero,boss,attack,()=>.99),incoming=G.damage(boss,hero,boss.spells[0],()=>.99);
 const turnsToKill=Math.ceil(boss.hp/Math.max(1,outgoing));
 const turnsToFall=Math.ceil(hero.hp/Math.max(1,incoming));
 assert.ok(outgoing>0&&turnsToKill<=turnsToFall*2,'approximate combat budget layer '+layer+' '+turnsToKill+'/'+turnsToFall);
 assert.equal(profile.level,expected,'level after five fights fits layer '+layer);
 if(layer<100)G.experience(profile,5*G.fightExperience(expected,profile.level,layer));
}
assert.equal(level(150).carry_limit,'18');
const endlessNormals=enemies.filter(e=>e.boss_only==='0');
assert.equal(endlessNormals.length,400);
for(let i=0;i<endlessNormals.length;i++)
 assert.equal(enemyForFight(enemies,501,()=>(i+.5)/endlessNormals.length).id,endlessNormals[i].id);
for(const fight of [501,502,503,504,506,507,508,509,2501,2502,2503,2504])
 assert.equal(enemyForFight(enemies,fight,()=>.99999).boss_only,'0','normal slot never draws a boss at fight '+fight);
for(const fight of [505,510,2505])
 assert.equal(enemyForFight(enemies,fight,()=>.99999).boss_only,'1','fifth fight always draws a boss');
for(let i=0;i<100;i++){
 const boss=enemyForFight(enemies,505,()=>(i+.5)/100);
 assert.equal(boss.boss_only,'1');
 const number=Number(boss.id.slice(6));
 assert.equal(bossUniqueCollection(collections,boss.id).rarity,number%10===0?'legendary':'epic');
}
for(const [fight,expectedLevel,boss] of [[501,151,'0'],[505,151,'1'],[506,152,'0'],[550,160,'1'],[1000,250,'1'],[2500,550,'1']]){
 const generated=floor(fight);
 assert.equal(generated.enemy_level,String(expectedLevel),'generated enemy level at fight '+fight);
 assert.equal(generated.minimum_enemy_level,String(expectedLevel),'generated level floor at fight '+fight);
 assert.equal(generated.boss,boss,'generated boss at fight '+fight);
}
assert.equal(G.fromEnemy(enemyForFight(enemies,505,()=>0),151).level,151,
 'endless boss receives calculated enemy level');
console.log('PASS 300 relics, 500 monsters, boss drops, 100-layer curve, XP and combat budget');
