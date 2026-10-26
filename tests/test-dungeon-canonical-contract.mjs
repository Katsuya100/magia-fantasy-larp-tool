import assert from 'node:assert/strict';
import {assertFixedTrace,assertFixedInventory,journeySpellAllowed,journeyItemAllowed,
 assertPairedCharacters,assert256Seeds} from '../scripts/dungeon-test-contract.mjs';
const good={win:true,cleared:50,maxHp:100,maxMp:100,restores:0,initialLoadout:[],
 layerStats:Array.from({length:10},(_,i)=>({layer:i+1,startHp:100-i,startMp:100-i,
 endHp:99-i,endMp:99-i,cleared:true}))};
assert.doesNotThrow(()=>assertFixedTrace(good,1,10));
assert.throws(()=>assertFixedTrace({...good,restores:1},1,10),/mid-sortie/);
const wrong=structuredClone(good);wrong.layerStats[3].startMp=100;
assert.throws(()=>assertFixedTrace(wrong,1,10),/MP recovery/);
assert.throws(()=>assertFixedInventory(1,['heal_s']));
assert.throws(()=>assertFixedInventory(71,Array(13).fill('clear_flame').concat(['luna_stone','elixir_s'])));
assert.doesNotThrow(()=>assertFixedInventory(71,Array(13).fill('clear_flame').concat(['luna_stone','luna_stone'])));
for(let layer=1;layer<=5;layer++){
 assert.equal(journeySpellAllowed(layer,true,'support'),false);
 for(const kind of ['heal','elixir','revive','clear','clear_all','escape'])assert.equal(journeyItemAllowed(layer,kind),false);
 assert.equal(journeyItemAllowed(layer,'mana'),true);
}
assert.equal(journeySpellAllowed(2,false,'defense'),false);
assert.equal(journeySpellAllowed(3,true,'defense'),true);
assert.equal(journeySpellAllowed(6,true,'support'),true);
for(const kind of ['heal','mana','elixir','revive','clear','clear_all','escape'])assert.equal(journeyItemAllowed(6,kind),true);
const hero={level:37,rank:10,playerHp:90,playerMp:70,maxHp:100,maxMp:100,
 playerBase:{hp:100,mag:10,def:7,res:7},carry:[],statuses:[],cooldowns:[0,0,0,0,0],
 circles:Array.from({length:5},(_,i)=>({power:100+i}))};
assert.doesNotThrow(()=>assertPairedCharacters(hero,{...hero,circles:hero.circles.map(c=>({...c,power:c.power+1}))}));
assert.throws(()=>assertPairedCharacters(hero,{...hero,level:38}),/level/);
assert.throws(()=>assertPairedCharacters(hero,{...hero,playerBase:{...hero.playerBase,mag:11}}),/playerBase/);
assert.throws(()=>assert256Seeds(Array.from({length:256},()=>42)),/duplicate/);
assert.throws(()=>assert256Seeds(Array.from({length:255},(_,i)=>i)),/denominator/);
console.log('PASS canonical test contract and mutation regressions');
