import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alchemyRecipe,alchemyAutoSelect,craftAlchemy} from '../assets/js/dungeon-alchemy.mjs';

const csv=readFileSync(new URL('../assets/data/dungeon-consumables.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
const keys=csv.shift().split(',');
const rows=csv.map(line=>Object.fromEntries(line.split(',').map((cell,i)=>[keys[i],cell])));
const buffs=[{id:'buff_aqua',kind:'buff'},{id:'buff_bolt',kind:'buff'}];
const make=(id,value=0,n=0)=>({id,value,instanceId:'item-'+n});
const recipe=(rarity,items)=>alchemyRecipe({id:'relic',rarity},items,rows);
const five=(id,value=10)=>Array.from({length:5},(_,i)=>make(id,value,i));

// Summed value, strongest grade, and both HP / MP variants.
assert.deepEqual(recipe('common',five('heal_s',20)),{id:'heal_s',value:100});
assert.deepEqual(recipe('common',[...five('heal_s',20).slice(0,4),make('heal_l',100)]),{id:'heal_l',value:180});
assert.deepEqual(recipe('common',five('mana_m',33)),{id:'mana_m',value:165});
assert.deepEqual(recipe('common',[make('heal_s',30),make('heal_s',20),make('mana_m',40),make('mana_s',10),make('clear_flame')]),{id:'heal_s',value:110});
assert.deepEqual(recipe('common',[make('heal_s',30),make('mana_s',10),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'mana_s',value:70});
assert.deepEqual(recipe('common',[make('heal_s',10),make('heal_m',20),make('clear_flame'),make('clear_aqua'),make('clear_bolt')]),{id:'heal_m',value:60});
assert.deepEqual(recipe('common',[make('elixir_s',35),make('heal_s',20),make('mana_s',20),make('clear_flame'),make('clear_bolt')]),{id:'elixir_s',value:35});
assert.deepEqual(recipe('common',five('clear_flame')),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('common',[make('heal_s',40),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('epic',[make('elixir_s',35),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:0});
assert.deepEqual(recipe('common',[make('escape_scroll'),make('escape_scroll'),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'escape_scroll',value:2});
assert.deepEqual(recipe('common',[make('life_ruby',2),make('life_ruby',4),make('clear_flame'),make('clear_bolt'),make('clear_aqua')]),{id:'life_ruby',value:14});

// Only epic or legendary can unlock combination recipes.
const mixed=[make('heal_l',100),make('mana_xl',120),make('clear_flame'),make('clear_bolt'),make('clear_aqua')];
assert.deepEqual(recipe('epic',mixed),{id:'elixir_l',value:100});
assert.equal(recipe('rare',mixed).id,'mana_xl');
const statuses=['flame','bolt','aqua','storm','gravity'].map(name=>make('clear_'+name));
assert.deepEqual(recipe('legendary',statuses),{id:'luna_stone',value:0});
assert.deepEqual(recipe('common',statuses),{id:'escape_scroll',value:0});
const life=[make('elixir_s',35),make('luna_stone'),make('escape_scroll'),make('heal_s',40),make('clear_flame')];
assert.deepEqual(recipe('epic',life),{id:'life_ruby',value:0});
assert.equal(recipe('rare',life).id,'escape_scroll');

// Auto-select keeps distinct original indexes and honors type and priority.
const inventory=[make('clear_flame',0,0),make('heal_s',2,1),make('heal_l',500,2),make('mana_m',60,3),make('heal_m',90,4),make('mana_s',10,5)];
assert.deepEqual(alchemyAutoSelect(inventory,rows,'hp','value'),[2,4,1]);
assert.deepEqual(alchemyAutoSelect(inventory,rows,'mp','value-asc'),[5,3]);
assert.deepEqual(alchemyAutoSelect(inventory,rows,'status'),[0]);

// Crafting is immutable, consumes exactly one relic and five instances,
// removes equipped ingredients by instance ID, and keeps other slots intact.
const profile={collection:{relic:2},inventory:[...five('heal_s',20),make('mana_l',65,5)],
 carrySlots:['item-0','item-5','item-3',null,null],obtainedItemIds:['heal_s']};
const common={id:'relic',rarity:'common'};
const crafted=craftAlchemy(profile,common,[0,1,2,3,4],rows,buffs,()=>.9,()=>'new-item');
assert.equal(crafted.collection.relic,1);
assert.equal(crafted.inventory.length,2);
assert.equal(crafted.inventory[0].instanceId,'item-5');
assert.deepEqual(crafted.inventory[1],{id:'heal_s',value:100,instanceId:'new-item'});
assert.deepEqual(crafted.carrySlots,[null,'item-5',null,null,null]);
assert.equal(profile.collection.relic,2);
assert.equal(profile.inventory.length,6);
assert.deepEqual(profile.carrySlots,['item-0','item-5','item-3',null,null]);
assert.throws(()=>craftAlchemy(profile,common,[0,0,1,2,3],rows),/5個/);
assert.throws(()=>craftAlchemy({...profile,collection:{relic:1}},common,[0,1,2,3,4],rows),/不足/);
assert.throws(()=>craftAlchemy({...profile,run:{}},common,[0,1,2,3,4],rows),/探索中/);
assert.throws(()=>recipe('common',five('heal_s').slice(0,4)),/5個/);

// Rarity bonuses: common none; uncommon/rare chance; epic/legendary guaranteed.
const bonusProfile={...profile,inventory:five('heal_s',20)};
const outcome=(rarity,values)=>{
 const sequence=values[Symbol.iterator]();
 return craftAlchemy(bonusProfile,{id:'relic',rarity},[0,1,2,3,4],rows,buffs,()=>sequence.next().value??.99,()=>'crafted').inventory[0];
};
assert.equal(outcome('common',[0]).alchemyBoost,undefined);
assert.deepEqual([outcome('uncommon',[.25]).value,outcome('uncommon',[.6]).value],[125,100]);
assert.equal(outcome('epic',[.99]).value,125);
assert.equal(outcome('rare',[.4,.9]).bonus,'buff_bolt');
assert.equal(outcome('rare',[.8]).bonus,undefined);
assert.equal(outcome('legendary',[.99,.01]).bonus,'buff_aqua');

console.log('PASS dungeon alchemy: recipes, tiers, rarity, slots and validations');
