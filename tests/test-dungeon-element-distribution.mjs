// Full-roster / 100-layer authored seven-element balance contract.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv,ATTRS} from '../assets/js/dungeon-core.mjs';
import {nameAffinities} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {applyElementDistribution,combatBalanceResistCalibrations} from '../scripts/dungeon-element-distribution.mjs';
const read=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const base=read('./fixtures/dungeon-enemies-before-distribution.csv');
const master=read('../assets/data/dungeon-enemies.csv');
const plan=read('../assets/data/dungeon-element-plan.csv');
const concepts=read('../assets/data/dungeon-layer-concepts.csv');
assert.equal(base.length,500);assert.equal(master.length,500);
assert.equal(plan.length,500);assert.equal(concepts.length,100);
assert.deepEqual(master,applyElementDistribution(base,plan,concepts),'plan must deterministically reproduce every published enemy');
const primary=Object.fromEntries(ATTRS.map(a=>[a,0]));
const secondary=Object.fromEntries(ATTRS.map(a=>[a,0]));
const magic=Object.fromEntries(ATTRS.map(a=>[a,0]));
const sum=r=>ATTRS.reduce((total,a)=>total+Number(r['resist_'+a]),0);
let primaryChanges=0,secondaryChanges=0,renames=0;
for(let i=0;i<500;i++){
 const a=base[i],b=master[i],old=a.spells.split('|').map(s=>s.split(':')),s=b.spells.split('|').map(s=>s.split(':'));
 assert.equal(s.length,5);
 for(const k of ['id','name','hp','mag','def','res','weight','min_level','boss_only','favored_collection_ids'])
  assert.equal(a[k],b[k],'identity, drops and base combat stats preserved '+a.id+' '+k);
 for(let k=0;k<5;k++){
  assert.equal(s[k][0],old[k][0],'same spell role '+a.id);
  assert.equal(s[k][2],old[k][2],'same spell power '+a.id);
  assert.ok(ATTRS.includes(s[k][1]),'valid spell element '+a.id);
  magic[s[k][1]]++;
 }
 if(s[0][1]!==old[0][1])primaryChanges++;
 if(s[2][1]!==old[2][1])secondaryChanges++;
 if(a.name!==b.name)renames++;
 assert.equal(s[0][1],s[1][1]);assert.equal(s[0][1],s[3][1]);
 assert.equal(s[2][1],s[4][1]);assert.notEqual(s[0][1],s[2][1]);
 primary[s[0][1]]++;secondary[s[2][1]]++;
 assert.ok(Math.abs(sum(a)-sum(b))<1e-8,'same seven-element defense budget '+a.id);
 if(b.id==='boss_l080'){
  assert.equal(b.resist_gravity,'1.25');assert.equal(b.resist_law,'1.2');
 }else{
  assert.ok(Number(b['resist_'+s[0][1]])<=1,'new primary cannot be weak '+b.id);
  assert.ok(Number(b['resist_'+s[2][1]])<=1,'new secondary cannot be weak '+b.id);
 }
 if(b.boss_only==='0'){
  const tags=nameAffinities(b.name);
  assert.ok(tags.every(t=>Number(b['resist_'+t])<=1),'named innate affinity cannot be weak '+b.id);
  if(tags.length)assert.ok(tags.some(t=>Number(b['resist_'+t])<1),'named innate affinity must resist '+b.id);
 }
}
assert.equal(Object.keys(combatBalanceResistCalibrations).length,73,'all targeted resistance budgets are reviewed');
for(const [id,shift] of Object.entries(combatBalanceResistCalibrations)){
 const before=base.find(r=>r.id===id),after=master.find(r=>r.id===id);
 assert.ok(before&&after,'calibrated enemy exists '+id);
 assert.ok([0.12,0.2].includes(shift),'bounded authored shift only '+id);
 assert.equal(before.hp,after.hp,'combat retune preserves HP '+id);
}
const ratio=(n,total)=>100*n/total;
for(const a of ATTRS){
 assert.ok(ratio(primary[a],500)>=13&&ratio(primary[a],500)<=15,'primary '+a+' outside 13-15%: '+primary[a]);
 assert.ok(ratio(magic[a],2500)>=13&&ratio(magic[a],2500)<=15,'all five spells '+a+' outside 13-15%: '+magic[a]);
 assert.ok(ratio(primary[a]+secondary[a],1000)>=13&&ratio(primary[a]+secondary[a],1000)<=15,'primary plus secondary '+a+' outside 13-15%');
}
assert.equal(Object.values(primary).reduce((a,b)=>a+b),500);
assert.equal(Object.values(magic).reduce((a,b)=>a+b),2500);
assert.equal(renames,0,'no existing character was replaced or renamed');
assert.ok(primaryChanges>100&&secondaryChanges>150);
for(let layer=1;layer<=100;layer++){
 const c=concepts[layer-1],enemies=master.slice((layer-1)*5,layer*5);
 assert.equal(Number(c.layer),layer);
 assert.ok(c.concept.length>=5&&c.interpretation.includes(enemies[4].name),
  'every floor has an authored named concept tied to its boss '+layer);
}
const finalBoss=master.find(r=>r.id==='boss_l100');
assert.equal(plan.find(r=>r.id==='boss_l100').primary,'law');
assert.equal(plan.find(r=>r.id==='boss_l100').secondary,'chaos');
assert.equal(finalBoss.spells.split('|')[0].split(':')[1],'law','final boss uses Law as primary');
assert.equal(finalBoss.spells.split('|')[2].split(':')[1],'chaos','final boss uses Chaos as secondary');
assert.equal(finalBoss.resist_law,'0.95','final boss cannot be weak to its own Law');
assert.ok(Number(finalBoss.resist_chaos)<=1,'final boss cannot be weak to its own Chaos');
assert.equal(finalBoss.resist_aqua,'1.35','water purification becomes its thematic weakness');
for(const [element,multiplier] of [['flame','1.2'],['bolt','0.95'],['gravity','1']])
 assert.equal(finalBoss['resist_'+element],multiplier,'preserve benchmark attack matchup '+element);
const layer41=master.slice(40*5,41*5);
assert.ok(layer41.filter(r=>r.spells.split('|')[0].split(':')[1]==='gravity').length<=2,
 '41F should not have an all-gravity primary lineup');
console.log('DUNGEON_ELEMENT_DISTRIBUTION '+JSON.stringify({primary,secondary,allSpellSlots:magic,primaryChanges,secondaryChanges,concepts:concepts.length,renames}));
console.log('PASS 500 monsters, 100 named floor concepts, and every primary/magic attribute at 13-15%');
