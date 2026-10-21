// Verifies all 400 name-predicted normal enemy elemental defenses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {nameAffinities,alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {tuneDurability,durabilityArchetype,durabilityRanges} from '../scripts/dungeon-enemy-durability-rules.mjs';
const load=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const previous=load('./fixtures/dungeon-enemies-pre-readable-affinities.csv'),now=load('../assets/data/dungeon-enemies.csv');
const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
assert.equal(previous.length,500);
assert.equal(now.length,500);
assert.deepEqual(now,tuneDurability(alignNormalRows(previous)),'normal resistance and durability rules reproduce all 500 rows');
let named=0,changed=0,weaknessesFixed=0;
for(let i=0;i<500;i++){
 const a=previous[i],b=now[i],tags=nameAffinities(b.name);
 if(b.boss_only==='1'){
  for(const key of Object.keys(a))if(!['hp','def','res'].includes(key))assert.equal(a[key],b[key],'boss spells/attributes/identity unchanged '+b.id+' '+key);
  continue;
 }
 const total=x=>attrs.reduce((n,k)=>n+Number(x['resist_'+k]),0);
 assert.ok(Math.abs(total(a)-total(b))<1e-8,'same seven-element damage budget '+b.id);
 if(tags.length){
  named++;
  assert.ok(tags.every(k=>Number(b['resist_'+k])<=1),'name incorrectly hints vulnerability '+b.name);
  assert.ok(tags.some(k=>Number(b['resist_'+k])<1),'name has no actual elemental defense '+b.name);
 }
 assert.equal(b.spells,a.spells,'all five spells and their attributes remain unchanged '+b.id);
  if(attrs.some(k=>a['resist_'+k]!==b['resist_'+k]))changed++;
 if(tags.some(k=>Number(a['resist_'+k])>=1.2))weaknessesFixed++;
}
assert.equal(now.filter(x=>x.boss_only==='0').length,400);
assert.ok(changed>=60,'fix many individual misleading affinities');
assert.ok(weaknessesFixed>=20,'clear all inverted named elemental weaknesses');
console.log('NORMAL_AFFINITY_AUDIT '+JSON.stringify({regular:400,named,changed,weaknessesFixed}));
for(let i=0;i<500;i++){
 const r=now[i],kind=durabilityArchetype(r.name);
 const ranges=durabilityRanges[r.boss_only==='1'?'boss':'normal'][kind];
 for(const field of ['hp','def','res'])assert.ok(Number(r[field])>=ranges[field][0]&&Number(r[field])<=ranges[field][1],
  'semantic durability range '+r.id+' '+field);
 assert.equal(r.mag,previous[i].mag,'MAG unchanged in this review '+r.id);
 assert.equal(r.spells,previous[i].spells,'all 5 spell circles unchanged '+r.id);
}
console.log('PASS name-inferred elemental defenses for all 400 regular enemies');
