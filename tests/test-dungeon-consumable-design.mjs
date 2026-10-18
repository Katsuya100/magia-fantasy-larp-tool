import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {CONSUMABLE_TIERS,rollConsumableTier,eligibleConsumables,enemyForFight,targetClearLevel} from '../assets/js/dungeon-design.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/'+name+'.csv',import.meta.url),'utf8'));
const [items,enemies,collections,buffs,balance,levels,floors,playerBase]=await Promise.all([
 'dungeon-consumables','dungeon-enemies','dungeon-collections','dungeon-buffs',
 'dungeon-balance','dungeon-levels','dungeon-floors','dungeon-player-base'].map(csv));
configure({balance,levels,floors,playerBase});
assert.ok(G.validateMasters(enemies,items,collections,buffs));
assert.deepEqual(CONSUMABLE_TIERS,['small','medium','large','extreme']);
assert.equal(items.length,20);
for(const kind of ['heal','mana']){
 const rows=items.filter(item=>item.kind===kind);
 assert.equal(rows.length,4);
 assert.deepEqual(rows.map(item=>item.tier),CONSUMABLE_TIERS);
 for(let i=1;i<rows.length;i++){
  assert.ok(+rows[i].min_value>+rows[i-1].max_value,'distinct effect values '+kind);
 }
}
assert.deepEqual(items.filter(item=>item.kind==='clear').map(x=>x.attribute).sort(),[...G.ATTRS].sort());
assert.ok(items.filter(x=>x.kind==='clear').every(x=>+x.min_layer===20));
assert.equal(items.find(x=>x.id==='escape_scroll')?.kind,'escape');
assert.equal(items.find(x=>x.id==='escape_scroll')?.min_layer,'20');
const initial=eligibleConsumables(items,1,'small');
assert.deepEqual(initial.map(x=>x.id),['heal_s','mana_s']);
assert.deepEqual(eligibleConsumables(items,19,'small').map(x=>x.id),initial.map(x=>x.id));
assert.equal(eligibleConsumables(items,19,'extreme').length,2);
assert.equal(eligibleConsumables(items,20,'small').length,10);
assert.equal(eligibleConsumables(items,100,'extreme').length,12);
assert.deepEqual(eligibleConsumables(items,101,'extreme').map(x=>x.id),eligibleConsumables(items,100,'extreme').map(x=>x.id));
for(const layer of [1,2,10,19,20,50,75,99,100,101,300]){
 const allowed=eligibleConsumables(items,layer,layer>=100?'extreme':'small');
 assert.ok(allowed.length>0);
 assert.ok(allowed.every(item=>!['clear','escape'].includes(item.kind)||layer>=20));
 assert.equal(allowed.some(item=>item.id==='escape_scroll'),layer>=20);
}
for(const n of [0,.01,.5,.999999]){
 assert.equal(rollConsumableTier(1,()=>n),'small');
 assert.equal(rollConsumableTier(100,()=>n),'extreme');
 assert.equal(rollConsumableTier(101,()=>n),'extreme');
}
const seeded=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let previousExtreme=-1;
for(const layer of [1,25,50,75,100]){
 const rand=seeded(12001),samples=12000;
 const observed=Object.fromEntries(CONSUMABLE_TIERS.map(x=>[x,0]));
 for(let i=0;i<samples;i++)observed[rollConsumableTier(layer,rand)]++;
 const fraction=observed.extreme/samples;
 const p=(layer-1)/99;
 assert.ok(Math.abs(fraction-p*p*p)<.018,'tier trend '+layer+': '+fraction);
 assert.ok(fraction>previousExtreme||layer===1,'extreme chance grows with depth');
 previousExtreme=fraction;
}
function scriptedRoll(sequence){
 let index=0;
 return ()=>{if(index>=sequence.length)throw Error('Not enough random values');return sequence[index++];};
}
const early=G.drops(items,collections,1,()=>0,{layer:1});
assert.equal(early.length,7);
assert.ok(early.every(x=>x.type==='use'&&['heal_s','mana_s'].includes(x.id)));
const firstCleanser=G.drops(items,collections,35,scriptedRoll([1,1,1,1,1,1,0,1,1,1,.965,.5,.965]),{layer:20});
assert.equal(firstCleanser.length,1);
assert.equal(firstCleanser[0].id,'clear_chaos','cleansers become eligible at floor 20');
const notYet=G.drops(items,collections,35,scriptedRoll([1,1,1,1,1,1,0,1,1,1,.965,.5,.965]),{layer:19});
assert.equal(notYet.length,1);
assert.equal(notYet[0].id,'mana_s','cleansers unavailable at floor 19');
for(const layer of [100,101,150]){
 const loot=G.drops(items,collections,150,()=>0,{layer});
 assert.equal(loot.length,7);
 assert.ok(loot.every(x=>x.type==='use'&&x.id==='heal_xl'&&x.value>=G.rollPotionValue(items.find(i=>i.id==='heal_xl'),layer,()=>0)),'numeric rewards scale to the target level at depth '+layer);
}
const lateCleanser=G.drops(items,collections,150,scriptedRoll([1,1,1,1,1,1,0,.86,.5,.965]),{layer:101});
assert.equal(lateCleanser[0].id,'clear_chaos','cleansing remains available in the endless dungeon');
// Every early-layer fight uses the actual spawn table, not merely a CSV naming rule.
for(let fight=1;fight<=95;fight++){
 const enemy=enemyForFight(enemies,fight);
 const roles=G.fromEnemy(enemy,+enemy.min_level).spells.map(x=>x.role);
 assert.ok(!roles.includes('debuff'),'no early debuff enemy at fight '+fight);
}
for(let fight=96;fight<=500;fight++){
 const enemy=enemyForFight(enemies,fight);
 assert.ok(G.fromEnemy(enemy,+enemy.min_level).spells.some(x=>x.role==='debuff'),
  'debuff enemy available from layer 20: '+fight);
}
// At every recommended level, even the weakest legal tier restores at least
// 75% of the largest possible hero's HP/MP, with no dependence on a lucky roll.
const maxBase={hp:110,mag:12,def:10,res:10};
for(const layer of [1,2,5,10,19,20,25,40,50,60,75,80,90,99,100,101]){
 const level=targetClearLevel(layer),hero=G.makeUnit(maxBase,level);
 for(const item of items.filter(x=>x.kind==='heal'||x.kind==='mana')){
  const full=item.kind==='heal'?hero.stats.hp:hero.maxMp;
  for(const r of [0,.33,.66,.999999]){
   const value=G.rollPotionValue(item,layer,()=>r);
   assert.ok(Number.isSafeInteger(value)&&value>=Math.ceil(full*.75),
    'recovery must cover at least 75% of the maximum recommended '+item.id+' layer '+layer);
   const player=G.makeUnit(maxBase,level);
   if(item.kind==='heal')player.hp=0;else player.mp=0;
   const recovered=G.potion(player,{id:item.id,value,bonus:null},items,buffs);
   assert.ok(recovered/full>=.75,
    'actual recovery reaches three quarters for '+item.id+' at layer '+layer);
  }
 }
}
// Potions already stored on a profile keep their original fixed amounts.
assert.equal(G.rollPotionValue(items.find(x=>x.id==='clear_flame'),100,()=>0),0);
assert.equal(G.rollPotionValue(items.find(x=>x.id==='escape_scroll'),100,()=>0),0);
assert.equal(G.rollPotionValue(items.find(x=>x.id==='life_ruby'),100,()=>0),0);
for(const [id,tier,start,value] of [['elixir_s','small',30,35],['elixir_m','medium',55,65],['elixir_l','large',80,100]]){
 const row=items.find(x=>x.id===id);
 assert.equal(row?.kind,'elixir');assert.equal(row?.tier,tier);assert.equal(+row.min_layer,start);
 assert.equal(G.rollPotionValue(row,start,()=>0),value);
 assert.ok(!eligibleConsumables(items,start-1,tier).some(x=>x.id===id));
 assert.ok(eligibleConsumables(items,start,tier).some(x=>x.id===id));
}
assert.equal(eligibleConsumables(items,100,'extreme').filter(x=>x.kind==='elixir').map(x=>x.id).join(','),'elixir_l','maximum elixir remains large at extreme depth');
assert.equal(eligibleConsumables(items,49,'small').some(x=>x.id==='life_ruby'),false);
for(const tier of CONSUMABLE_TIERS)assert.equal(eligibleConsumables(items,50,tier).some(x=>x.id==='life_ruby'),true,'ruby is available at every tier from layer 50');
assert.ok(G.drops(items,collections,35,()=>0,{layer:19}).every(x=>x.id!=='escape_scroll'));
// Existing inventory instances use the fixed saved value regardless of revised catalog ranges.
const user=G.makeUnit({hp:100,mag:10,def:7,res:7},100);
user.hp-=40;
assert.equal(G.potion(user,{id:'heal_s',value:40,bonus:null},items,buffs),40);
const availability=G.makeUnit(user.base||{hp:110,mag:10,def:10,res:10},1,{},[],'availability');
const candidate=(id,value=0,bonus=null)=>({type:'use',id,value,bonus});
availability.hp=availability.stats.hp;availability.mp=availability.maxMp;
assert.equal(G.canUseBattleItem(availability,candidate('heal_s',24),items),false,'HP recovery is unavailable at full HP');
assert.equal(G.canUseBattleItem(availability,candidate('mana_s',12),items),false,'MP recovery is unavailable at full MP');
assert.equal(G.canUseBattleItem(availability,candidate('elixir_s',35),items),false,'elixir is unavailable at full HP and MP');
assert.equal(G.canUseBattleItem(availability,candidate('clear_flame'),items),false,'cleanser is unavailable without matching debuff');
assert.equal(G.canUseBattleItem(availability,candidate('life_ruby'),items),true,'life ruby can be armed at full HP');
assert.equal(G.canUseBattleItem(availability,candidate('escape_scroll'),items),true,'escape scroll always works');
availability.hp-=10;
assert.equal(G.canUseBattleItem(availability,candidate('heal_s',24),items),true);
assert.equal(G.canUseBattleItem(availability,candidate('elixir_s',35),items),true,'elixir works if only HP needs recovery');
availability.hp=availability.stats.hp;availability.mp-=10;
assert.equal(G.canUseBattleItem(availability,candidate('mana_s',12),items),true);
assert.equal(G.canUseBattleItem(availability,candidate('elixir_s',35),items),true,'elixir works if only MP needs recovery');
availability.mp=availability.maxMp;
availability.statuses=[{id:'debuff_flame',kind:'debuff',attribute:'flame',effect:'burn',turns:2}];
assert.equal(G.canUseBattleItem(availability,candidate('clear_flame'),items),true);
assert.equal(G.canUseBattleItem(availability,candidate('clear_bolt'),items),false);
availability.statuses=[];
const extra=buffs[0]?.id;
if(extra)assert.equal(G.canUseBattleItem(availability,candidate('heal_s',24,extra),items,buffs),true,'valid bonus effects keep a potion usable even at full HP');
availability.reviveArmed=true;
assert.equal(G.canUseBattleItem(availability,candidate('life_ruby'),items),false,'revival cannot be armed twice');
availability.reviveArmed=false;availability.reviveUsed=true;
assert.equal(G.canUseBattleItem(availability,candidate('life_ruby'),items),false,'revival cannot be rearmed after activation');
assert.equal(G.canUseBattleItem(availability,candidate('not-an-item'),items),false,'unknown items are not usable');
assert.equal(user.hp,user.stats.hp);
console.log('PASS consumable tiers, distribution gradient, debuff unlock, cleanser loot and saved item compatibility');
