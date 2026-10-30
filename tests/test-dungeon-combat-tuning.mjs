// No HP/MAG advantage or disadvantage may be applied solely because a
// combatant is an enemy: all 500 use the player stat/level formula.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),balance:csv('balance'),floors:csv('floors'),levels:csv('levels'),playerBase:csv('player-base')};
configure(data);
assert.equal(data.enemies.length,500);
assert.equal(data.floors.length,500);
assert.equal(data.balance.filter(r=>/^enemy_(?:hp|mag)_(?:band|last3|boss|scale_early|scale_late)/.test(r.key)).length,0);
assert.equal(typeof G.enemyScaling,'undefined');
assert.equal(typeof G.enemyCombatCoefficients,'undefined');
// Historical generation fixtures predate the approved final combat tuning.
// The separate element-distribution test pins the published 500-row CSV;
// this test guards the more important enemy/player shared combat formulas.
for(let i=0;i<500;i++){
 const row=data.enemies[i],lv=Number(data.floors[i].enemy_level);
 const base={hp:+row.hp,mag:+row.mag,def:+row.def,res:+row.res};
 for(const [stat,value] of Object.entries(base))
  assert.ok(Number.isFinite(value)&&value>0,
   row.id+' approved final '+stat+' must be a usable combat stat');
 assert.ok(Number.isSafeInteger(lv)&&lv>=1,'valid authored encounter level '+row.id);
 const actual=G.fromEnemy(row,lv);
 assert.deepEqual(actual.base,base,row.id+' authored RPG base');
 assert.deepEqual(actual.stats,G.stats(base,lv),row.id+' shared level growth');
 assert.deepEqual(actual.stats,G.makeUnit(base,lv,{},[],row.id).stats,row.id+' equal to player stats');
 for(const testLevel of [1,75,150])
  assert.deepEqual(G.fromEnemy(row,testLevel).stats,G.stats(base,testLevel),row.id+' shared growth at level '+testLevel);
 const spells=row.spells.split('|').map(spell=>{const [role,attribute,power]=spell.split(':');return {role,attribute,power:+power};});
 assert.equal(spells.length,5);
 assert.deepEqual(actual.spells,spells,row.id+' five unchanged circles');
 for(const a of G.ATTRS)assert.equal(actual.resists[a],Number(row['resist_'+a]),row.id+' unchanged defense '+a);
}
const star=data.enemies.find(x=>x.id==='boss_l080');
assert.equal(+star.resist_gravity,1.25);assert.equal(+star.resist_law,1.2);
console.log('PASS 500 canonical enemy RPG bases and shared player/enemy growth, zero combat multipliers');
