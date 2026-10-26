import assert from 'node:assert/strict';
import {assertFixedTrace,assertFixedInventory,journeySpellAllowed,journeyItemAllowed,
 assertPairedCharacters,assert256Seeds,assertEntireFloorCoverage,
 assertBankedJourneySnapshot,assertPreRecoveryRankGate,assertNotFalsePass} from '../scripts/dungeon-test-contract.mjs';
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

const floors=Array.from({length:100},(_,i)=>({layer:i+1,readiness:{
 firstEntryReady:256,additionalFarmingReady:0,prepared:256,missingSeeds:[]}}));
assert.doesNotThrow(()=>assertEntireFloorCoverage(floors));
assert.throws(()=>assertEntireFloorCoverage(floors.filter(f=>f.layer%10===0)),/every individual floor/);
const missing=structuredClone(floors);missing[32].readiness.missingSeeds=[17011];
assert.throws(()=>assertEntireFloorCoverage(missing),/unready seeds/);
const state={source:'POST_RETURN_BANKED_AND_INVESTED',unbankedXp:0,
 unbankedStone:0,unbankedInk:0,earned:{stone:10,ink:5},
 spent:{stone:7,ink:5},bankedStones:3,bankedInk:0,
 rank:10,bankedBestLayer:20,carry:[],maxCarry:10};
assert.doesNotThrow(()=>assertBankedJourneySnapshot(state));
assert.throws(()=>assertBankedJourneySnapshot({...state,bankedStones:9}),/free magic stones/);
assert.throws(()=>assertBankedJourneySnapshot({...state,rank:30}),/unearned adventurer rank/);
assert.doesNotThrow(()=>assertPreRecoveryRankGate({hpPercent:90,mpPercent:79,eligible:false,failure:'MP_BELOW_80'}));
assert.throws(()=>assertPreRecoveryRankGate({hpPercent:90,mpPercent:79,eligible:true,failure:null}),/before victory recovery/);
assert.throws(()=>assertNotFalsePass({passed:true,missing:1}),/cannot PASS/);
assert.throws(()=>assertNotFalsePass({passed:true,cutoff:true}),/cannot PASS/);
