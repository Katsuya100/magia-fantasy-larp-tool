// Data/schema and authorial-flavor invariant checks. These are NOT a playthrough.
// Difficulty parity remains an independent CI gate to run after user review.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv,ATTRS} from '../assets/js/dungeon-core.mjs';
import {tuneEnemyRows} from '../scripts/dungeon-enemy-flavor-rules.mjs';
import {durabilityArchetype,durabilityRanges,tuneDurability} from '../scripts/dungeon-enemy-durability-rules.mjs';
import {alignNormalRows,nameAffinities} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {alignEnemySpellFlavor} from '../scripts/dungeon-enemy-spell-flavor.mjs';
import {reconcileEnemyElements} from '../scripts/dungeon-enemy-element-consistency.mjs';

const load=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const raw=load('./fixtures/dungeon-enemies-before-flavor.csv');
const base=load('./fixtures/dungeon-enemies-pre-readable-affinities.csv');
const shipped=load('../assets/data/dungeon-enemies.csv');
assert.equal(raw.length,500);assert.equal(base.length,500);assert.equal(shipped.length,500);
assert.deepEqual(shipped,tuneEnemyRows(raw),'full historical regeneration must match the shipped catalog');
assert.deepEqual(shipped,reconcileEnemyElements(alignEnemySpellFlavor(tuneDurability(alignNormalRows(base)))),'second-pass durability regeneration must be reproducible');

let altered=0,regularChanged=0,bossChanged=0;
for(let i=0;i<shipped.length;i++){
 const now=shipped[i],old=base[i],role=durabilityArchetype(now.name),boss=now.boss_only==='1';
 assert.notEqual(role,'unmarked','all 500 enemies have an explicit review class '+now.name);
 for(const key of ['id','name','mag','weight','min_level','boss_only','favored_collection_ids'])
  assert.equal(now[key],old[key],'unchanged identity/offense '+now.id+' '+key);
 assert.equal(now.spells,alignEnemySpellFlavor([old])[0].spells,'curated spell-worldview regeneration '+now.id);
 const band=durabilityRanges[boss?'boss':'normal'][role];
 for(const stat of ['hp','def','res']){
  assert.ok(Number.isInteger(Number(now[stat])),'integer survival stat '+now.id+' '+stat);
  assert.ok(Number(now[stat])>=band[stat][0]&&Number(now[stat])<=band[stat][1],
   'expected role-based survivability '+now.id+' '+stat);
 }
 if(!boss){
  const labels=nameAffinities(now.name);
  const sum=r=>ATTRS.reduce((x,a)=>x+Number(r['resist_'+a]),0);
  assert.ok(Math.abs(sum(now)-sum(old))<1e-8,'unchanged seven-element vulnerability budget '+now.id);
  if(labels.length){
   assert.ok(labels.every(a=>Number(now['resist_'+a])<=1),'no own-element vulnerability '+now.name);
   assert.ok(labels.some(a=>Number(now['resist_'+a])<1),'named element has an actual defense '+now.name);
  }
 }else{
  for(const a of ATTRS)assert.equal(now['resist_'+a],reconcileEnemyElements([alignEnemySpellFlavor([old])[0]])[0]['resist_'+a],'authored boss resistance '+now.id);
 }
 if(['hp','def','res'].some(k=>now[k]!==old[k])){altered++;if(boss)bossChanged++;else regularChanged++;}
}
assert.ok(altered>=390&&regularChanged>=300&&bossChanged>=75,'entire dungeon receives role-based durability review');
console.log('PASS 500 monster flavor records; changed '+altered+' ('+regularChanged+' ordinary, '+bossChanged+' bosses); curated worldview spell edits only; no MAG edits');
