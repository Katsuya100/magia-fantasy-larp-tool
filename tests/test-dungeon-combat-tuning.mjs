// Audits *live* per-decade HP/MAG tuning, independent of static flavor audits.
// Full 128-seed acceptance stays in test-dungeon-default-balance.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {durabilityArchetype,durabilityRanges} from '../assets/js/dungeon-durability-profiles.mjs';
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),balance:csv('balance'),floors:csv('floors'),levels:csv('levels'),playerBase:csv('player-base')};
configure(data);
const keyRows=data.balance.filter(x=>/^enemy_(?:hp|mag)_(?:band|last3|boss)_\d+$/.test(x.key));
assert.equal(keyRows.length,17,'all 17 local coefficients accounted for');
assert.equal(new Set(keyRows.map(x=>x.key)).size,keyRows.length);
assert.ok(keyRows.every(x=>Number.isFinite(Number(x.value))&&Number(x.value)>0));
assert.equal(data.enemies.length,500);
const changed=[];
for(let i=0;i<500;i++){
 const row=data.enemies[i],floor=Math.floor(i/5)+1;
 const actual=G.fromEnemy(row,Number(data.floors[i].enemy_level));
 const factor=G.enemyCombatCoefficients(row);
 const species=durabilityArchetype(row.name),limits=durabilityRanges[row.boss_only==='1'?'boss':'normal'][species];
 assert.ok(limits,'all 500 species reviewed '+row.id);
 const expectedHP=factor.hp===1?Number(row.hp):Math.max(limits.hp[0],Math.min(limits.hp[1],Math.round(Number(row.hp)*factor.hp)));
 const expectedMAG=Math.max(1,Math.round(Number(row.mag)*factor.mag));
 assert.equal(actual.base.hp,Math.max(1,Math.round(expectedHP*G.enemyScaling(actual.level).hp)),row.id+' live HP');
 assert.equal(actual.base.mag,Math.max(1,Math.round(expectedMAG*G.enemyScaling(actual.level).mag)),row.id+' live MAG');
 if(factor.hp!==1){
  assert.ok(expectedHP>=limits.hp[0]&&expectedHP<=limits.hp[1],row.id+' species HP limits');
  if(expectedHP!==Number(row.hp))changed.push({id:row.id,name:row.name,floor,old:Number(row.hp),now:expectedHP});
 }
 assert.equal(actual.spells.length,5,row.id+' spell slots');
 const authored=row.spells.split('|').map(spell=>{const [role,attribute,power]=spell.split(':');return {role,attribute,power:Number(power)};});
 assert.deepEqual(actual.spells,authored,row.id+' authored spell roles/elements/powers');
 for(const attr of G.ATTRS)assert.equal(actual.resists[attr],Number(row['resist_'+attr]),row.id+' unchanged element '+attr);
}
const star=data.enemies.find(x=>x.id==='boss_l080');
assert.equal(Number(star.resist_gravity),1.25);
assert.equal(Number(star.resist_law),1.2);
assert.equal(G.enemyCombatCoefficients(data.enemies[0]).hp,1,'1-10F HP unaffected');
assert.equal(G.enemyCombatCoefficients(data.enemies[0]).mag,1,'1-10F MAG unaffected');
console.log('DUNGEON_COMBAT_RUNTIME '+JSON.stringify({total:500,authoredStatsIntact:true,changedEffectiveHp:changed}));
console.log('PASS 500 live foes retain authored world lore, attacks, and role-based HP limits under floor-local battle tuning');
