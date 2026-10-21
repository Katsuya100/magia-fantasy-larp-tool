// Static review only. Do not interpret these checks as seeded-playthrough parity.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {durabilityArchetype,durabilityRanges,tuneDurability} from '../scripts/dungeon-enemy-durability-rules.mjs';
import {alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';

const load=x=>parseCsv(readFileSync(new URL(x,import.meta.url),'utf8'));
const prior=load('./fixtures/dungeon-enemies-pre-readable-affinities.csv');
const now=load('../assets/data/dungeon-enemies.csv');
const recalculated=tuneDurability(alignNormalRows(prior));
assert.deepEqual(now,recalculated,'catalog exactly matches declared survival archetypes');
const categories={},changed={hp:0,def:0,res:0,ordinary:0,boss:0};
for(let i=0;i<500;i++){
 const row=now[i],old=prior[i],type=durabilityArchetype(row.name);
 categories[type]=(categories[type]||0)+1;
 assert.notEqual(type,'unmarked','no unreviewed enemy class '+row.id);
 for(const key of Object.keys(row)){
  if(key==='hp'||key==='def'||key==='res'||key.startsWith('resist_'))continue;
  assert.equal(row[key],old[key],'no changes outside approved durability and affinity fields '+row.id+' '+key);
 }
 const config=durabilityRanges[row.boss_only==='1'?'boss':'normal'][type];
 for(const key of ['hp','def','res']){
  if(row[key]!==old[key])changed[key]++;
  assert.ok(Number(row[key])>=config[key][0]&&Number(row[key])<=config[key][1],
   'survival range '+row.id+' '+key);
 }
 if(['hp','def','res'].some(key=>row[key]!==old[key]))
  changed[row.boss_only==='1'?'boss':'ordinary']++;
}
assert.equal(now.length,500);
assert.equal(now.filter(x=>x.boss_only==='1').length,100);
assert.ok(Object.keys(categories).length>=10,'named monsters use distinct profiles');
assert.ok(changed.ordinary>=300&&changed.boss>=75,'both boss and normal survival anomalies addressed');
const report=readFileSync(new URL('../docs/DUNGEON-ENEMY-DURABILITY-REVIEW.md',import.meta.url),'utf8');
for(const row of now)assert.ok(report.includes('| '+row.name+' |'),'every named monster appears in the review table '+row.id);
console.log('DUNGEON_DURABILITY_STATIC '+JSON.stringify({count:500,changed,categories,playthroughRun:false}));
console.log('PASS all 500 enemies classified; magic/MAG unchanged; no simulation');
