import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure, num, floor} from '../assets/js/dungeon-tuning.mjs';
const root=new URL('../assets/data/',import.meta.url);
const get=async path=>G.parseCsv(await readFile(new URL(path,root),'utf8'));
const [enemies,items,collections,buffs,balance,levels,floors,playerBase]=await Promise.all([
 'dungeon-enemies.csv','dungeon-consumables.csv','dungeon-collections.csv','dungeon-buffs.csv',
 'dungeon-balance.csv','dungeon-levels.csv','dungeon-floors.csv','dungeon-player-base.csv'].map(get));
configure({balance,levels,floors,playerBase});
assert.ok(G.validateMasters(enemies,items,collections,buffs));
for(const [lvl,slots] of [[1,3],[9,3],[10,4],[19,4],[20,5],[49,7],[50,8],[150,18]])
 assert.equal(G.capacity(lvl),slots,'carry slot increases each 10 levels');
assert.equal(G.nextXp(1),108);assert.equal(floor(5).boss,'1');
assert.deepEqual(G.startingBase(()=>0),{hp:90,mag:8,def:5,res:5});
assert.deepEqual(G.startingBase(()=>.99999),{hp:110,mag:12,def:10,res:10});
const base={hp:100,mag:10,def:7,res:7};
assert.deepEqual(G.stats(base,1),base);assert.ok(G.stats(base,20).hp>G.stats(base,10).hp);
for(const lvl of [1,20,50]){
 for(const row of enemies.filter(row=>row.min_level==='1'&&row.boss_only==='0').slice(0,4)){
  const hero=G.makeUnit(base,lvl),foe=G.fromEnemy(row,lvl),before=foe.hp;
  G.round(hero,foe,-1,-1,buffs,()=>.999);
  const ratio=(before-foe.hp)/before;
  assert.ok(ratio>=.13&&ratio<=.27,'normal attack near 1/5 recommended normal foe HP at level '+lvl+' '+row.id+' '+ratio);
 }
}
assert.equal(G.magicStoneDropChance(1,1),.30,'at recommended level, keep full stone drop rate');
assert.equal(G.magicStoneDropChance(2,1),.30,'overlevel no longer reduces stone drops');
assert.equal(G.magicStoneDropChance(3,1),.30,'overlevel never reduces stone drops');
assert.equal(G.magicStoneDropChance(2,2),.30,'below recommended level, keep full stone drop rate');
assert.equal(G.magicStoneDropChance(3,2),.30,'at another layer recommended level, keep full rate');
assert.equal(G.magicStoneDropChance(150,100),.30,'final designed layer remains eligible');
assert.equal(G.magicStoneDropChance(150,101),.30,'endless layers remain eligible');
assert.equal(G.magicStoneDropChance(150,200),.30,'underleveled heroes retain full stone chance in deep layers');
assert.equal(G.magicStoneDropChance(150,1),.30,'max-level heroes can replay the first layer');
assert.equal(G.magicStoneDropChance(11,1,true),.30,'unreturned first-clear layers keep normal stone chance');
assert.equal(G.magicStoneDropChance(11,1,false),.30,'repeat clears retain normal stone chance');
assert.deepEqual(G.dropCounts(1,()=>.2,{layer:1,playerLevel:1}),{collection:5,stone:1,use:3});
assert.deepEqual(G.dropCounts(1,()=>.2,{layer:1,playerLevel:2}),{collection:5,stone:1,use:3},'overlevel never reduces stones');
assert.deepEqual(G.dropCounts(1,()=>.2,{layer:1,playerLevel:2,firstClear:true}),{collection:5,stone:1,use:3},'first-clear stone reward bypasses level penalty');
assert.deepEqual(G.dropCounts(1,()=>.1,{layer:1,playerLevel:2}),{collection:5,stone:1,use:3},'reduced rate is nonzero');
assert.equal(G.drops(items,collections,1,()=>.2,{layer:1,playerLevel:2}).filter(x=>x.type==='stone').length,1,'actual rewards retain normal stone chance');
assert.equal(G.drops(items,collections,3,()=>.2,{layer:2,playerLevel:2}).filter(x=>x.type==='stone').length,1,'non-overlevelled rewards retain original chance');
assert.deepEqual(G.dropCounts(1,()=>0),{collection:5,stone:1,use:3});
assert.deepEqual(G.dropCounts(100,()=>.9999),{collection:0,stone:0,use:0});
assert.equal(G.dropCount(1,()=>0),9);
assert.equal(G.dropCount(99,()=>.9999),0);
assert.equal(G.drops(items,collections,1,()=>.9999).length,0,'ordinary foes can leave no treasure');
const rewards=G.drops(items,collections,1,()=>0);
assert.equal(rewards.length,9,'all three category rolls can succeed together');
assert.deepEqual({use:rewards.filter(x=>x.type==='use').length,stone:rewards.filter(x=>x.type==='stone').length,
 collection:rewards.filter(x=>x.type==='collection').length},{use:3,stone:1,collection:5});
assert.equal(rewards[0].type,'use');assert.equal(rewards[0].value,G.rollPotionValue(items[0],1,()=>0));
let rolls=0;
const stoneRewards=G.drops(items,collections,1,()=>++rolls===6?0:1);
assert.deepEqual(stoneRewards,[{type:'stone',id:'magic_stone'}],'stone drops independently of collections and consumables');
assert.deepEqual(G.drops(items,collections,19,()=>.999,{layer:10,bossEnemyId:'boss_l010'}),[],
 'boss trophies are no longer guaranteed when no item is rolled');
const withBoss=G.drops(items,collections,19,()=>0,{layer:10,bossEnemyId:'boss_l010',favoredCollectionIds:['relic_boss_010']});
assert.equal(withBoss.filter(x=>x.type==='use').length,3);
assert.equal(withBoss.filter(x=>x.type==='stone').length,1);
assert.equal(withBoss.filter(x=>x.type==='collection').length,5);
assert.equal(withBoss.filter(x=>x.id==='relic_boss_010').length,0,
 'common rarity draws cannot produce a legendary trophy');
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
// Fixed-seed probability check: five independent encounters make one layer.
const trials=40000,random=rng(20261018);
const sums={collection:0,stone:0,use:0},normal={collection:0,stone:0,use:0};
const lucky={collection:0,stone:0,use:0};
let zeroFights=0;
for(let simulation=0;simulation<trials;simulation++){
 const layer={collection:0,stone:0,use:0};
 for(let fight=0;fight<5;fight++){
  const counts=G.dropCounts(1,random);
  if(Object.values(counts).every(x=>x===0))zeroFights++;
  for(const type of Object.keys(layer))layer[type]+=counts[type];
 }
 // Bosses use the same collection-count rolls as ordinary encounters.
 for(const type of Object.keys(layer))sums[type]+=layer[type];
 if(layer.collection>=8&&layer.collection<=10)normal.collection++;
 if(layer.stone>=1&&layer.stone<=2)normal.stone++;
 if(layer.use>=3&&layer.use<=5)normal.use++;
 if(layer.collection>=15)lucky.collection++;
 if(layer.stone>=3)lucky.stone++;
 if(layer.use>=8)lucky.use++;
}
const means=Object.fromEntries(Object.entries(sums).map(([type,total])=>[type,total/trials]));
assert.ok(means.collection>=8.8&&means.collection<=9.2,'collections average about nine per layer');
assert.ok(means.stone>=1.4&&means.stone<=1.6,'stones average one to two per layer');
assert.ok(means.use>=3.9&&means.use<=4.2,'consumables average three to five per layer');
assert.ok(normal.collection/trials>.45&&normal.stone/trials>.64&&normal.use/trials>.59,
 'the most common category yields match the intended layer ranges');
assert.ok(lucky.collection>0&&lucky.stone>0&&lucky.use>0,
 'lucky layers can yield 15 collections, 3 stones, or 8 consumables');
assert.ok(zeroFights>0,'individual enemies can still have no rewards at all');
assert.equal(G.basePower(300),35);assert.ok(G.mpCost(300)>0);
const sp={role:'attack',attribute:'flame',power:300};
const enhancedSpell={...sp,power:200,basePower:100};
const originalMpCost=G.mpCost(100);
assert.ok(G.mpCost(200)>originalMpCost,'upgraded power would otherwise increase MP cost');
assert.equal(G.spellMpCost(enhancedSpell),originalMpCost,'enhanced spell costs its original MP');
assert.equal(G.spellMpCost(sp),G.mpCost(300),'ordinary and enemy spells retain normal costs');
const enhancedCaster=G.makeUnit(base,1,{},[enhancedSpell]);
enhancedCaster.mp=originalMpCost;
assert.equal(G.canCast(enhancedCaster,0),true,'exact original MP suffices for upgraded spells');
assert.equal(G.prepare(enhancedCaster,0).power,200,'upgraded effect power is preserved');
assert.equal(enhancedCaster.mp,0,'casting deducts only the original MP cost');
const a=G.makeUnit(base,1,{},[sp], 'a'),b=G.makeUnit(base,1,{},[sp], 'b');
assert.equal(G.damage(a,b,sp),G.damage(b,a,sp));
const originalHp=b.hp;G.cast(a,b,sp,buffs);assert.ok(b.hp<originalHp);assert.equal(b.statuses.length,0);
const fire={role:'debuff',attribute:'flame',power:300};
const hp=b.hp;G.cast(a,b,fire,buffs);assert.equal(b.hp,hp);assert.ok(b.statuses.some(s=>s.id==='debuff_flame'));
G.cast(b,a,{role:'defense',attribute:'flame',power:300},buffs);
assert.ok(G.resist(b,'flame')<1);
const armored=G.makeUnit(base,1);G.addStatus(armored,{id:'buff_gravity',kind:'buff',effect:'def',value:9.799999999999997,turns:2});
assert.equal(G.armor(armored),17,'fractional DEF always rounds up');
const oldHp=b.hp;G.cast(b,a,{role:'support',attribute:'flame',power:300},buffs);
assert.ok(b.hp>=oldHp);assert.equal(b.statuses.find(s=>s.id==='debuff_flame'),undefined);
const item={id:'heal_s',value:27,bonus:'buff_aqua'};b.hp=10;assert.equal(G.potion(b,item,items,buffs),27);assert.ok(G.status(b,'buff_aqua'));
const heroMp=G.makeUnit(base,12);
heroMp.mp=0;
assert.ok(G.recoverVictoryMp(heroMp)>0,'winning a fight restores some MP');
assert.ok(heroMp.mp<heroMp.maxMp,'regular wins never become full restorative checkpoints');
const mpAfter=heroMp.mp;
assert.ok(G.recoverVictoryMp(heroMp)>0&&heroMp.mp>mpAfter,'MP recovery persists across sequential wins');
heroMp.mp=heroMp.maxMp;
assert.equal(G.recoverVictoryMp(heroMp),0,'recovery never overflows max MP');
const victoryMpRate=level=>{
 const unit=G.makeUnit(base,level);
 unit.mp=0;
 return G.recoverVictoryMp(unit)/unit.maxMp;
};
assert.ok(victoryMpRate(1)>=.18&&victoryMpRate(1)<=.20,'early layers grant generous beginner MP recovery');
assert.ok(victoryMpRate(30)>.12&&victoryMpRate(30)<.14,'early-layer victory MP recovery also helps established adventurers');
assert.ok(victoryMpRate(75)>.09&&victoryMpRate(75)<.115,'the early-layer bonus does not erase level scaling');
assert.ok(victoryMpRate(150)>.069&&victoryMpRate(150)<.085,'high-level heroes only receive the early-layer bonus at low depth');
// Added recovery applies only to layers 1-19. The baseline is mathematically
// identical at layer 20 and beyond, regardless of the adventurer's level.
for(let layer=1;layer<=10;layer++)assert.equal(G.earlyVictoryMpBonusRate(layer),num('victory_mp_early_layer_bonus'));
for(let layer=11;layer<20;layer++){
 assert.ok(G.earlyVictoryMpBonusRate(layer)<G.earlyVictoryMpBonusRate(layer-1));
 assert.ok(G.earlyVictoryMpBonusRate(layer)>0);
}
for(const layer of [20,21,30,50,100,110])assert.equal(G.earlyVictoryMpBonusRate(layer),0);
for(const playerLevel of [1,5,19,37,55,150]){
 const actor=G.makeUnit(base,playerLevel);
 const t=G.clamp((playerLevel-1)/Math.max(1,num('level_max')-1),0,1);
 const middle=G.clamp((playerLevel-40)/Math.max(1,num('level_max')-40),0,1);
 const originalRate=num('victory_mp_restore_rate_early')+
  (num('victory_mp_restore_rate_late')-num('victory_mp_restore_rate_early'))*t+
  num('victory_mp_beginner_bonus')*Math.max(0,(13-playerLevel)/12)-
  num('victory_mp_middle_taper')*middle*(1-middle);
 for(const layer of [20,21,30,50,100,110]){
  actor.mp=0;
  assert.equal(G.recoverVictoryMp(actor,layer),
   Math.round(actor.maxMp*originalRate*G.victoryMpLayerFactor(layer)),
   'layer 20+ must retain the exact historical recovery at layer '+layer+' and Lv'+playerLevel);
 }
}
assert.ok(victoryMpRate(1)>victoryMpRate(30)&&victoryMpRate(30)>victoryMpRate(75)&&victoryMpRate(75)>victoryMpRate(150),
 'victory MP recovery decreases with level');

assert.deepEqual(G.VICTORY_MP_LAYER_CURVE.map(([floor,rate])=>[floor,rate]),
 [[1,1],[10,1],[15,.83],[20,.5976],[21,.5799],[22,.547],[25,.541],[29,.53955],[30,.5395],[35,.462],[40,.406],
  [41,.387],[45,.343],[49,.3339],[50,.3332],[51,.305],[52,.302],[55,.298],[59,.29282],[60,.2924],
  [65,.236],[70,.2244],[71,.187],[75,.184],[79,.1824],[80,.182],[85,.174],[89,.145],
  [90,.1288],[95,.079],[100,0]]);
for(const [layer,expected] of [[1,1],[10,1],[15,.83],[20,.5976],
 [21,.5799],[22,.547],[25,.541],[29,.53955],[35,.462],[41,.387],[45,.343],[49,.3339],[51,.305],[52,.302],[55,.298],[59,.29282],
 [65,.236],[71,.187],[75,.184],[79,.1824],[80,.182],[85,.174],[89,.145],
 [90,.1288],[95,.079],[100,0],[105,0]]){
 assert.ok(Math.abs(G.victoryMpLayerFactor(layer)-expected)<1e-10,
  'victory MP recovery multiplier for floor '+layer);
}
for(let layer=2;layer<=110;layer++){
 assert.ok(G.victoryMpLayerFactor(layer)<=G.victoryMpLayerFactor(layer-1),
  'victory MP multiplier never increases with dungeon depth at '+layer+'F');
}
const checkMpLayer=layer=>{
 const hero=G.makeUnit(base,150);
 hero.mp=0;
 return G.recoverVictoryMp(hero,layer);
};
assert.ok(checkMpLayer(1)>checkMpLayer(50)&&checkMpLayer(50)>checkMpLayer(90),
 'victory MP restored decreases with dungeon depth at the same level');
assert.equal(checkMpLayer(100),0,'100F victory grants zero automatic MP');
assert.equal(checkMpLayer(110),0,'post-100 victory remains at zero automatic MP');

assert.equal(typeof G.enemyScaling,'undefined','enemy-specific scaling must not exist');
const commonStats={hp:+enemies[0].hp,mag:+enemies[0].mag,def:+enemies[0].def,res:+enemies[0].res};
assert.deepEqual(G.fromEnemy(enemies[0],150).stats,G.stats(commonStats,150),
 'enemy and player use identical level growth at 150');
// Early enemy AI is action-limited without changing the 500 authored spells.
for(let layer=1;layer<=11;layer++){
 for(let slot=1;slot<=5;slot++){
  const fight=(layer-1)*5+slot,row=enemies[fight-1];
  const enemy=G.fromEnemy(row,Number(floors[fight-1].enemy_level));
  enemy.hp=1; // Legacy AI would prioritize healing here.
  if(layer<=10){
   for(const random of [()=>0,()=>.5,()=>.999]){
    const choice=G.chooseEnemySpell(enemy,random),picked=choice<0?null:enemy.spells[choice];
    assert.ok(picked&&['attack','defense'].includes(picked.role),'early enemy action: '+row.id);
    if(picked.role==='defense'){
     const powers=G.available(enemy).filter(i=>enemy.spells[i].role==='defense').map(i=>enemy.spells[i].power);
     assert.equal(picked.power,row.id==='boss_l010'?Math.max(...powers):Math.min(...powers),
      'weak guards except for the tenth-layer boss: '+row.id);
    }
   }
  }else if(enemy.spells.some(s=>s.role==='support')){
   assert.equal(enemy.spells[G.chooseEnemySpell(enemy,()=>.5)].role,'support',
    '11+ enemy healing behavior is unchanged: '+row.id);
  }
 }
}
const en=G.fromEnemy(enemies[0],2);assert.equal(en.spells.length,5);assert.ok(en.stats.hp>50,'scaled enemies stay viable at low levels');
const u=G.makeUnit(base,1,{},[sp]),v=G.makeUnit(base,1,{},[sp]);
const logs=G.round(u,v,0,0,buffs,()=>.7);assert.ok(logs.length===2);assert.ok(u.hp<100&&v.hp<100);
const profile={level:1,xp:0};G.experience(profile,G.nextXp(1));assert.equal(profile.level,2);
const page=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.match(page,/id="openCircleCamera"/);assert.match(page,/id="circleCameraDialog"/);assert.match(page,/id="imageRepairVideo"/,"Recovery uses a direct camera");assert.doesNotMatch(page,/id="imageRepairFile"/,"No gallery upload in the retake flow");
const cured=G.makeUnit(base,1);
G.addStatus(cured,{id:'debuff_flame',kind:'debuff',attribute:'flame',effect:'burn',value:.6,turns:2});
G.potion(cured,{id:'clear_flame',value:0,bonus:'resist_flame'},items,buffs);
assert.equal(G.status(cured,'debuff_flame'),undefined);
assert.ok(G.resist(cured,'flame')<1);
G.addStatus(cured,{id:'debuff_chaos',kind:'debuff',attribute:'chaos',effect:'shock',value:1,turns:2});
G.addStatus(cured,{id:'debuff_chaos',kind:'debuff',attribute:'chaos',effect:'seal',value:1,turns:2});
assert.equal(G.status(cured,'debuff_chaos').effect,'seal');
const sealedHero=G.makeUnit(base,1,{},[
 {role:'attack',attribute:'flame',power:10},
 {role:'support',attribute:'aqua',power:10},
 {role:'defense',attribute:'law',power:10}
]);
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[0]),false,'normal circle has no seal mark');
sealedHero.mp=0;sealedHero.cooldowns[0]=2;
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[0]),false,'MP shortage and cooldown are not seals');
sealedHero.mp=sealedHero.maxMp;sealedHero.cooldowns[0]=0;
sealedHero.statuses.push({effect:'seal',sealedRoles:['attack','defense'],turns:2});
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[0]),true,'sealed attack is marked');
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[1]),false,'unsealed role is not marked');
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[2]),true,'second sealed role is marked');
assert.equal(G.canCast(sealedHero,0),false,'sealed attack stays uncastable');
sealedHero.statuses=[{effect:'seal',sealedRole:'support',turns:1}];
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[1]),true,'legacy single-role seals are marked');
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[0]),false,'legacy seal does not affect other roles');
sealedHero.statuses=[];
assert.equal(G.isSpellSealed(sealedHero,sealedHero.spells[1]),false,'expired seal mark disappears');
// Elixirs heal both resources by the same percentage without ever overflowing.
const elixirUser=G.makeUnit(base,60);
elixirUser.hp=1;elixirUser.mp=1;
const restored=G.potion(elixirUser,{id:'elixir_s',value:35,bonus:null},items,buffs);
assert.ok(restored>0);
assert.equal(elixirUser.hp,1+Math.ceil(elixirUser.stats.hp*.35));
assert.equal(elixirUser.mp,1+Math.ceil(elixirUser.maxMp*.35));
G.potion(elixirUser,{id:'elixir_l',value:100,bonus:null},items,buffs);
assert.equal(elixirUser.hp,elixirUser.stats.hp);
assert.equal(elixirUser.mp,elixirUser.maxMp);
assert.equal(G.potion(elixirUser,{id:'elixir_l',value:100,bonus:null},items,buffs),0);
const rubyHero=G.makeUnit(base,50);
assert.equal(G.potion(rubyHero,{id:'life_ruby',value:0,bonus:null},items,buffs),0);
assert.equal(rubyHero.reviveArmed,true);
assert.throws(()=>G.potion(rubyHero,{id:'life_ruby',value:0,bonus:null},items,buffs),/使用済み/);
rubyHero.hp=0;
assert.equal(G.reviveOnFatal(rubyHero),Math.ceil(rubyHero.stats.hp*.5));
assert.equal(rubyHero.reviveArmed,false);
assert.equal(rubyHero.reviveUsed,true);
rubyHero.hp=0;
assert.equal(G.reviveOnFatal(rubyHero),0,'second fatal event cannot revive in same encounter');
assert.throws(()=>G.potion(rubyHero,{id:'life_ruby',value:0,bonus:null},items,buffs),/使用済み/);
// Enemy damage and burn ticks both trigger the same single-use protection.
const fatalHero=G.makeUnit(base,1,{},[],'player'),fatalEnemy=G.makeUnit(base,1,{},[],'enemy');
fatalHero.hp=1;fatalHero.reviveArmed=true;fatalEnemy.stats.mag=500;
const timeline=[],combatLog=G.round(fatalHero,fatalEnemy,-1,-1,buffs,()=>.9,step=>timeline.push(step));
assert.ok(combatLog.some(x=>x.includes('生命の紅石：復活')));
assert.ok(timeline.some(x=>x.role==='revive'&&x.hero.hp>0),'revival snapshot is visible to the animation');
assert.equal(fatalHero.reviveUsed,true);
const burnHero=G.makeUnit(base,1,{},[],'player'),burnEnemy=G.makeUnit(base,1,{},[],'enemy');
burnHero.hp=2;burnHero.reviveArmed=true;burnEnemy.stats.mag=0;
G.addStatus(burnHero,{id:'test-burning',kind:'debuff',effect:'burn',attribute:'flame',value:1,turns:2});
const burnLog=G.round(burnHero,burnEnemy,-1,-1,buffs,()=>.5);
assert.ok(burnLog.some(x=>x.includes('生命の紅石：復活')),'burn death also activates ruby');
assert.equal(burnHero.reviveUsed,true);
console.log('PASS dungeon master, progression, symmetry, magic and potion tests');
