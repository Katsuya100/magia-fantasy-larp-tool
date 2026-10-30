import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {strengthBands} from '../scripts/dungeon-recommended-strength.mjs';
import {referenceSpells} from '../scripts/dungeon-fixed-deck-reference.mjs';

const approved=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
assert.equal(approved.strictSamples,256);
assert.equal(approved.playerLevelMax,150);
assert.deepEqual(approved.bands.map(x=>x.winRate),[[99,100],[99,100],...Array.from({length:8},()=>[90,97])]);
assert.deepEqual(approved.bands.map(x=>x.winSafety),[[99,100],[99,100],...Array.from({length:8},()=>[92,95])]);
assert.deepEqual(approved.bands.map(x=>x.winnerMedianMp),[[50,60],...Array.from({length:9},()=>[0,15])]);
assert.equal(approved.rank.bothHpMpPercentAtLeast,80);
assert.equal(approved.rank.independentFromCombatBalance,true);
assert.equal(strengthBands.length,10);
assert.equal(referenceSpells.length,10);
for(const [index,band] of strengthBands.entries()){
 assert.equal(band.from,index*10+1);
 assert.equal(band.to,index*10+10);
 assert.equal(band.recommendedLevel,targetClearLevel(band.to));
 assert.equal(band.opponentIds.length,50,'each formula reference covers ten authored floors');
 assert.equal(new Set(band.opponentIds).size,50,'each authored opponent is counted once');
 assert.equal(referenceSpells[index].length,256,'fixed reference retains all seed-specific stone ledgers');
 for(const circles of referenceSpells[index]){
  assert.equal(circles.length,5);
  assert.deepEqual(circles.map(x=>x.role),['attack','attack','attack','support','defense']);
  assert.ok(circles.every(x=>Number.isFinite(x.power)&&Number.isFinite(x.basePower)&&
   Number.isInteger(x.upgradeLevel??0)));
 }
}
console.log('PASS unchanged approved combat goals, independent 80/80 rank rule and 6 x 10 x 256 formula-reference coverage');
