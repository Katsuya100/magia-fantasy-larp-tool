import assert from 'node:assert/strict';
import {circleListIndexes,itemListIndexes,collectionListIndexes,collectionRarityMarks,itemKind} from '../assets/js/dungeon-list-view.mjs';
import {circleChoices,itemChoices,itemGrid} from '../assets/js/dungeon-preparation-ui.mjs';
const photo=(id,registeredAt,attribute,role,power,revealed=true)=>({id,registeredAt,image:new Blob([id]),
 analysis:{attribute,role,power},revealed});
const circles=[photo('a',40,'flame','attack',33,true),photo('b',30,'aqua','support',100,false),
 photo('c',20,'bolt','defense',22,true),photo('d',10,'flame','debuff',99,true)];
assert.deepEqual(circleListIndexes(circles),[0,1,2,3],'default newest');
assert.deepEqual(circleListIndexes(circles,{sort:'oldest'}),[3,2,1,0],'oldest sort');
assert.deepEqual(circleListIndexes(circles,{sort:'equipped',slots:['d',null,'b']}),[3,1,0,2],
 'equipped circles follow the slot order, with unequipped circles still in newest order');
assert.deepEqual(circleListIndexes(circles,{sort:'equipped',slots:['missing','d','d']}),[3,0,1,2],
 'missing IDs and duplicated slots cannot remove or duplicate cards');
assert.deepEqual(circleListIndexes(circles,{sort:'equipped',slots:['d','b'],attribute:'flame'}),[3,0],
 'equipped order works together with the attribute filter');
assert.deepEqual(circles.map(c=>c.id),['a','b','c','d'],'sorting cannot modify saved circle order');
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
assert.deepEqual(itemListIndexes(inventory,master,{sort:'count'}),[1,3,0,2],
 'count sort groups identical item IDs by number held, with ties in inventory order');
assert.deepEqual(itemListIndexes(inventory,master,{kind:'heal',sort:'count'}),[1,3],
 'count sort honors item kind filters without changing saved indices');
assert.deepEqual(inventory.map(item=>item.id),['mana_s','heal_s','clear_bolt','heal_s'],
 'count sorting must not mutate saved inventory order');
const kinds=[{id:'elixir_s',value:35},{id:'life_ruby',value:0},{id:'heal_s',value:24}];
assert.equal(itemKind(kinds[0]),'elixir');
assert.equal(itemKind(kinds[1]),'revive');
assert.deepEqual(itemListIndexes(kinds,[],{kind:'elixir'}),[0]);
assert.deepEqual(itemListIndexes(kinds,[],{kind:'revive'}),[1]);
assert.deepEqual(itemListIndexes(kinds,[],{sort:'value-asc'}),[1,2,0]);
assert.deepEqual(itemListIndexes(inventory,master,{sort:'kind'}),[1,3,0,2],'types use HP → MP → status, not alphabetic order');
assert.deepEqual(itemListIndexes(inventory,master,{sort:'kind',withinKindSort:'value'}),[3,1,0,2],'kind sort preserves previously chosen descending effects within HP group');
assert.deepEqual(itemListIndexes(inventory,master,{sort:'kind',withinKindSort:'value-asc'}),[1,3,0,2],'kind sort preserves previously chosen ascending effects');
const everyKind=[
 {id:'escape_scroll',value:0},{id:'life_ruby',value:0},{id:'clear_bolt',value:0},
 {id:'elixir_s',value:35},{id:'mana_s',value:12},{id:'heal_s',value:30},
 {id:'luna_stone',value:0},{id:'clear_flame',value:0}
];
const everyMaster=[...master,{id:'escape_scroll',kind:'escape',name:'脱出の巻物'},
 {id:'life_ruby',kind:'revive',name:'生命の紅石'},{id:'elixir_s',kind:'elixir',name:'エリクシール小'},
 {id:'luna_stone',kind:'clear_all',name:'ルナストーン'},{id:'clear_flame',kind:'clear',name:'浄化'}];
assert.deepEqual(itemListIndexes(everyKind,everyMaster,{sort:'kind'}),[5,4,3,2,6,7,1,0],
 'all six kinds appear in the requested order; full cleanse stays with condition recovery');
assert.deepEqual(itemListIndexes(everyKind,everyMaster,{kind:'clear',sort:'kind'}),[2,6,7],
 'status recovery filter includes Luna Stone');
assert.deepEqual(itemListIndexes(everyKind,everyMaster,{sort:'kind',withinKindSort:'name'}).slice(0,3),[5,4,3],
 'kind ordering always takes priority over previous name sorting');
assert.deepEqual(everyKind.map(x=>x.id),['escape_scroll','life_ruby','clear_bolt','elixir_s','mana_s','heal_s','luna_stone','clear_flame'],
 'kind ordering never modifies inventory');

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
