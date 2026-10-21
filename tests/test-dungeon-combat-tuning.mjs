// No HP/MAG advantage or disadvantage may be applied solely because a
// combatant is an enemy: all 500 use the player stat/level formula.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {durabilityArchetype,combatBaseHpRanges} from '../assets/js/dungeon-durability-profiles.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),balance:csv('balance'),floors:csv('floors'),levels:csv('levels'),playerBase:csv('player-base')};
configure(data);
assert.equal(data.enemies.length,500);
assert.equal(data.floors.length,500);
assert.equal(data.balance.filter(r=>/^enemy_(?:hp|mag)_(?:band|last3|boss|scale_early|scale_late)/.test(r.key)).length,0);
assert.equal(typeof G.enemyScaling,'undefined');
assert.equal(typeof G.enemyCombatCoefficients,'undefined');
// All encounter HP are canonical RPG base stats, with no secondary combat-time scale.
const authored=G.parseCsv(readFileSync(new URL('./fixtures/dungeon-enemies-before-distribution.csv',import.meta.url),'utf8'));
assert.deepEqual(data.enemies.map(e=>[e.id,e.hp]),authored.map(e=>[e.id,e.hp]),
 'canonical HP is directly authored and identical to the verified 500-enemy fixture');
for(let i=0;i<500;i++){
 const row=data.enemies[i],lv=Number(data.floors[i].enemy_level),kind=row.boss_only==='1'?'boss':'normal';
 const base={hp:+row.hp,mag:+row.mag,def:+row.def,res:+row.res};
 const range=combatBaseHpRanges[kind][durabilityArchetype(row.name)];
 assert.ok(range&&base.hp>=range[0]&&base.hp<=range[1],row.id+' authored role HP range');
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
