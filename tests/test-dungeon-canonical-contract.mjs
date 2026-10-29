import assert from 'node:assert/strict';
import {assertFixedTrace,assertFixedInventory,journeySpellAllowed,journeyItemAllowed,
 assertPairedCharacters,assert256Seeds,assertBankedJourneySnapshot,assertPreRecoveryRankGate,assertNotFalsePass,summarizeJourneyStrength} from '../scripts/dungeon-test-contract.mjs';
const good={win:true,cleared:50,maxHp:100,maxMp:100,hp:90,mp:90,
 restores:0,initialLoadout:[],
 layerStats:Array.from({length:10},(_,i)=>({layer:i+1,startHp:100-i,startMp:100-i,
 endHp:99-i,endMp:99-i,cleared:true})),
 fightStats:Array.from({length:50},(_,i)=>({fight:i+1,win:true,
  hpBefore:100-i/5,hpAfter:100-(i+1)/5,
  mpBefore:100-i/5,mpAfter:100-(i+1)/5,
  mpAfterVictoryRecovery:100-(i+1)/5}))};
assert.doesNotThrow(()=>assertFixedTrace(good,1,10));
assert.throws(()=>assertFixedTrace({...good,mp:100},1,10),/elective full recovery/);
assert.throws(()=>assertFixedTrace({...good,hp:100},1,10),/elective full recovery/);
assert.throws(()=>assertFixedTrace({...good,restores:1},1,10),/mid-sortie/);
const midFightHeal=structuredClone(good);
midFightHeal.fightStats[2].hpBefore=100;
assert.throws(()=>assertFixedTrace(midFightHeal,1,10),/between fights/);
const midFightMana=structuredClone(good);
midFightMana.fightStats[2].mpBefore=100;
assert.throws(()=>assertFixedTrace(midFightMana,1,10),/between fights/);
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

const seeds=Array.from({length:256},(_,i)=>17011+13*i);
const policy={style:'A',route:'short',samples:256,journeyStrength:Array.from({length:10},(_,i)=>({
 band:(i*10+1)+'-'+(i*10+10),completion:256,
 owners:seeds.map(seed=>({seed,status:'REACHED',lastAssessment:{reasons:[]}}))}))};
const strength=summarizeJourneyStrength(policy,seeds);
assert.equal(strength.length,10);
assert.ok(strength.every(row=>row.reached===256&&row.status==='ALL_256_REACHED_RECOMMENDED_STRENGTH'));
assert.equal(strength[0].legacyResults,'NOT_CARRIED_FORWARD_OR_RELABELLED');
const cutoff=structuredClone(policy);
cutoff.journeyStrength[0].owners[0]={seed:seeds[0],attempts:2,status:'ASSESSED_UNMET',
 lastAssessment:{reasons:['MP_RESOURCE_SHORTAGE']}};
cutoff.journeyStrength[0].owners[1]={seed:seeds[1],attempts:0,
 status:'UNREACHED_NO_LEGAL_BANKED_SNAPSHOT',lastAssessment:null};
const cutoffRows=summarizeJourneyStrength(cutoff,seeds);
assert.equal(cutoffRows[0].reached,254,'unmet and unobserved owners cannot be converted into passes');
assert.equal(cutoffRows[0].unreached,2);
assert.deepEqual(cutoffRows[0].missingReasons,
 [['MP_RESOURCE_SHORTAGE',1],['UNREACHED_NO_LEGAL_BANKED_SNAPSHOT',1]]);
assert.equal(cutoffRows[0].status,'RECOMMENDED_STRENGTH_NOT_REACHED_OR_UNPROVEN');

console.log('PASS canonical journey formula contracts and legacy-pass separation');
