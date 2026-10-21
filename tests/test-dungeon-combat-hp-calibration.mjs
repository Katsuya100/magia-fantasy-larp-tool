// Combat endurance calibration must affect real encounters but not authored CSVs.
// The original 500-monster element distribution remains exactly reproducible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {combatTunedEnemy,COMBAT_HP_BALANCE_BY_DECADE,enemyForFight,targetClearLevel} from '../assets/js/dungeon-design.mjs';
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const enemies=csv('enemies');
configure({balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')});
assert.equal(COMBAT_HP_BALANCE_BY_DECADE.length,10);
assert.equal(enemies.length,500);
for(let layer=1;layer<=100;layer++){
 const [originalScale,neutralScale]=COMBAT_HP_BALANCE_BY_DECADE[Math.floor((layer-1)/10)];
 assert.ok(Number.isFinite(originalScale)&&originalScale>0);
 assert.ok(Number.isFinite(neutralScale)&&neutralScale>0);
 for(let slot=1;slot<=5;slot++){
  const fight=(layer-1)*5+slot,source=enemies[fight-1],baseHp=source.hp;
  const expected=Math.max(1,Math.round(Math.round(Number(baseHp)*originalScale)*neutralScale));
  const tuned=combatTunedEnemy(source),fromEncounter=enemyForFight(enemies,fight);
  assert.notEqual(tuned,source,'combat tuning must create a copy for '+source.id);
  assert.equal(tuned.id,source.id);
  assert.equal(tuned.hp,String(expected),'combat HP matches calibrated band '+source.id);
  assert.equal(fromEncounter.hp,tuned.hp,'combat selection applies the same calibration '+source.id);
  assert.equal(source.hp,baseHp,'authored source row never changes '+source.id);
  const a=G.fromEnemy(tuned,targetClearLevel(layer));
  const b=G.fromEnemy({...source,hp:String(expected)},targetClearLevel(layer));
  assert.equal(a.hp,b.hp,'gameplay uses calibrated HP '+source.id);
  assert.equal(a.stats.hp,b.stats.hp);
 }
}
const adhoc={id:'other',hp:'70'};
assert.equal(combatTunedEnemy(adhoc),adhoc,'unrecognized encounters stay untouched');
assert.equal(enemies.every((row,i)=>row.hp===csv('enemies')[i].hp),true,'master data immutable');
console.log('PASS all 500 combat-calibrated encounters use stable HP without modifying authored masters');
