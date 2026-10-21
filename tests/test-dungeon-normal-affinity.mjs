// Verifies all 400 name-predicted normal enemy elemental defenses.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {nameAffinities,alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
const load=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const previous=load('./fixtures/dungeon-enemies-pre-readable-affinities.csv'),now=load('../assets/data/dungeon-enemies.csv');
const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
const calibrated=new Set(["foe_l044_1","foe_l044_2","foe_l044_3","foe_l051_1","foe_l051_2"]);
assert.equal(previous.length,500);
assert.equal(now.length,500);
assert.deepEqual(now,alignNormalRows(previous),'normal resistance CSV must match deterministic explicit-name rules');
let named=0,changed=0,weaknessesFixed=0;
for(let i=0;i<500;i++){
 const a=previous[i],b=now[i],tags=nameAffinities(b.name);
 if(b.boss_only==='1'){assert.deepEqual(a,b,'boss remains unchanged '+b.id);continue;}
 const total=x=>attrs.reduce((n,k)=>n+Number(x['resist_'+k]),0);
 assert.ok(Math.abs(total(a)-total(b))<1e-8,'same seven-element damage budget '+b.id);
 if(tags.length){
  named++;
  assert.ok(tags.every(k=>Number(b['resist_'+k])<=1),'name incorrectly hints vulnerability '+b.name);
  assert.ok(tags.some(k=>Number(b['resist_'+k])<1),'name has no actual elemental defense '+b.name);
 }
 if(attrs.some(k=>a['resist_'+k]!==b['resist_'+k]))changed++;
 if(a.hp!==b.hp){
  assert.ok(calibrated.has(b.id),'only reviewed golem HP may change '+b.id);
  const score=x=>Math.max(...[['flame',360],['bolt',420],['gravity',540]].map(([k,p])=>Math.sqrt(p)*Number(x['resist_'+k])));
  assert.ok(Math.abs(score(b)/Number(b.hp)/(score(a)/Number(a.hp))-1)<=.03,
   'golem effective health must stay within 3% '+b.id);
 }
 if(tags.some(k=>Number(a['resist_'+k])>=1.2))weaknessesFixed++;
}
assert.equal(now.filter(x=>x.boss_only==='0').length,400);
assert.ok(changed>=60,'fix many individual misleading affinities');
assert.ok(weaknessesFixed>=20,'clear all inverted named elemental weaknesses');
console.log('NORMAL_AFFINITY_AUDIT '+JSON.stringify({regular:400,named,changed,weaknessesFixed}));
console.log('PASS name-inferred elemental defenses for all 400 regular enemies');
