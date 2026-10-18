import assert from 'node:assert/strict';
import {circleListIndexes,itemListIndexes,collectionListIndexes,collectionRarityMarks,itemKind} from '../assets/js/dungeon-list-view.mjs';
import {circleChoices,itemChoices,itemGrid} from '../assets/js/dungeon-preparation-ui.mjs';
const photo=(id,registeredAt,attribute,role,power,revealed=true)=>({id,registeredAt,image:new Blob([id]),
 analysis:{attribute,role,power},revealed});
const circles=[photo('a',40,'flame','attack',33,true),photo('b',30,'aqua','support',100,false),
 photo('c',20,'bolt','defense',22,true),photo('d',10,'flame','debuff',99,true)];
assert.deepEqual(circleListIndexes(circles),[0,1,2,3],'default newest');
assert.deepEqual(circleListIndexes(circles,{sort:'oldest'}),[3,2,1,0],'oldest sort');
assert.deepEqual(circleListIndexes(circles,{attribute:'flame'}),[0,3],'attribute filter');
assert.deepEqual(circleListIndexes(circles,{role:'support'}),[1],'role filter');
assert.deepEqual(circleListIndexes(circles,{role:'attack',attribute:'bolt'}),[],'combined filters');
assert.deepEqual(circleListIndexes(circles,{sort:'power'}),[3,0,2,1],'unrevealed circle power never participates in ranked values');
const esc=x=>String(x);
const chosen=circleChoices(circles,['a'],()=> 'blob:test',esc,null,[],()=>2,[3,0]);
assert.deepEqual([...chosen.matchAll(/data-choose-circle="(\d+)"/g)].map(x=>Number(x[1])),[3,0],'sort only changes visual order, not selection index');
const master=[{id:'heal_s',kind:'heal',name:'ヒール'}, {id:'mana_s',kind:'mana',name:'マナ'}, {id:'clear_bolt',kind:'clear',name:'浄化'}];
const inventory=[{id:'mana_s',value:25},{id:'heal_s',value:45},{id:'clear_bolt',value:0},{id:'heal_s',value:80}];
assert.equal(itemKind(inventory[2],master),'clear');
assert.deepEqual(itemListIndexes(inventory,master,{kind:'heal'}),[1,3]);
assert.deepEqual(itemListIndexes(inventory,master,{sort:'value'}),[3,1,0,2]);
assert.deepEqual(itemListIndexes(inventory,master,{sort:'value-asc'}),[2,0,1,3],'ascending item value preserves inventory indices');
const kinds=[{id:'elixir_s',value:35},{id:'life_ruby',value:0},{id:'heal_s',value:24}];
assert.equal(itemKind(kinds[0]),'elixir');
assert.equal(itemKind(kinds[1]),'revive');
assert.deepEqual(itemListIndexes(kinds,[],{kind:'elixir'}),[0]);
assert.deepEqual(itemListIndexes(kinds,[],{kind:'revive'}),[1]);
assert.deepEqual(itemListIndexes(kinds,[],{sort:'value-asc'}),[1,2,0]);
assert.deepEqual(itemListIndexes(inventory,master,{sort:'kind'}),[2,1,3,0]);
assert.deepEqual([...itemChoices(inventory,[1],x=>x.id,esc,[3,1]).matchAll(/data-choose-item="(\d+)"/g)].map(x=>Number(x[1])),[3,1],'filtered item indices match untouched inventory');
const short=itemGrid([0,1,null,null,null],inventory,3,true,x=>x.id,esc);
assert.equal((short.match(/data-open-item=/g)||[]).length,3,'three visual slots for level 1');
assert.equal((itemGrid([0,1,null,null,null],inventory,3,false,x=>x.id,esc).match(/data-open-item=/g)||[]).length,0,'none are visible before the first return');
assert.equal((itemGrid(Array(15).fill(null),inventory,15,true,x=>x.id,esc).match(/data-open-item=/g)||[]).length,15,'level gains add more visible slots');
for(const [rarity,count] of [['common',1],['uncommon',2],['rare',3],['epic',4],['legendary',5]]){
 assert.equal(collectionRarityMarks(rarity),'✴︎'.repeat(count),rarity+' mark count');
}
assert.equal(collectionRarityMarks('unknown'),'','unknown rarity has no marks');
const relics=[{id:'common',name:'短剣',rarity:'common'},{id:'rare',name:'宝珠',rarity:'rare'},
 {id:'legend',name:'秘密の王冠',rarity:'legendary'},{id:'epic',name:'魔杖',rarity:'epic'}];
const owned={common:5,rare:1};
assert.deepEqual(collectionListIndexes(relics,owned),[0,1,2,3],'default low-rarity view shows discovered items first and keeps undiscovered rarity hidden');
assert.deepEqual(collectionListIndexes(relics,owned,{sort:'common'}),collectionListIndexes(relics,owned),'explicit low-rarity sort is the default');
assert.deepEqual(collectionListIndexes(relics,owned,{discovery:'found'}),[0,1]);
assert.deepEqual(collectionListIndexes(relics,owned,{discovery:'missing'}),[2,3],'unknown entries retain stable source order, not secret rarity order');
assert.deepEqual(collectionListIndexes(relics,owned,{rarity:'rare'}),[1],'undiscovered rarity cannot leak through filters');
assert.deepEqual(collectionListIndexes(relics,owned,{rarity:'legendary'}),[],'hidden legendary relic remains secret');
assert.deepEqual(collectionListIndexes(relics,owned,{sort:'rare'}),[1,0,2,3],'discovered rarity first, unknown last');
assert.deepEqual(collectionListIndexes(relics,owned,{sort:'count'}),[0,1,2,3]);
console.log('PASS filter/sort of 7 elements, item kinds, collectible discovery and selection index preservation');
