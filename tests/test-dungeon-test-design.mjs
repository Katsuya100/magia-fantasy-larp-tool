import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reference,specFor,assess,stoneCost,combatFixture,expectedPowers} from '../scripts/dungeon-readiness-reference.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
const approved=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
assert.equal(reference.status,'CANDIDATE_NOT_USER_APPROVED','candidate may not auto-approve');
assert.equal(approved.strictSamples,256);
assert.equal(approved.playerLevelMax,150);
assert.deepEqual(approved.bands.map(x=>x.winRate),[[99,100],[99,100],...Array.from({length:8},()=>[90,97])]);
assert.deepEqual(approved.bands.map(x=>x.winSafety),[[99,100],[99,100],...Array.from({length:8},()=>[92,95])]);
assert.deepEqual(approved.bands.map(x=>x.winnerMedianMp),[[50,100],...Array.from({length:9},()=>[0,15])]);
assert.equal(approved.rank.bothHpMpPercentAtLeast,80);
for(const s of reference.bands){
 assert.equal(s.startLevel,s.from===1?1:targetClearLevel(s.from-1));
 assert.equal(s.endingCheckpointLevel,targetClearLevel(s.to));
 assert.ok(stoneCost(s)>=0);
 assert.equal(expectedPowers(s).length,5);
 assert.deepEqual(reference.spells.map(x=>x.role),['attack','attack','attack','support','defense']);
 const base={hp:50,mag:20,def:20,res:20};
 const potential=combatFixture(s,base);
 assert.equal(potential.level,s.startLevel);
 assert.equal(potential.playerHp,potential.maxHp);
 assert.equal(potential.playerMp,potential.maxMp);
 assert.ok(potential.carry.every(x=>x.id.startsWith('clear_')||x.id==='luna_stone'));
 const actual={...potential,source:'POST_RETURN_BANKED_AND_INVESTED',
  unbankedXp:0,unbankedStone:0,unbankedInk:0};
 assert.ok(assess(actual,s).ready);
 assert.ok(!assess({...actual,level:Math.max(0,s.startLevel-1)},s).ready);
 assert.ok(!assess({...actual,circles:actual.circles.slice(1)},s).ready);
 if(Object.keys(s.requiredItems).length)
  assert.ok(!assess({...actual,carry:[]},s).ready);
 assert.ok(!assess({...actual,unbankedStone:1},s).ready);
}
console.log('PASS dungeon separated readiness contract (approved values unchanged; unapproved reference never certified)');
