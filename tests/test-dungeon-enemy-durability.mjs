// Static review only. Do not interpret these checks as seeded-playthrough parity.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {durabilityArchetype,durabilityRanges,tuneDurability,curatedDurabilityFixes} from '../scripts/dungeon-enemy-durability-rules.mjs';
import {alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {alignEnemySpellFlavor} from '../scripts/dungeon-enemy-spell-flavor.mjs';
import {reconcileEnemyElements} from '../scripts/dungeon-enemy-element-consistency.mjs';

const load=x=>parseCsv(readFileSync(new URL(x,import.meta.url),'utf8'));
const prior=load('./fixtures/dungeon-enemies-pre-readable-affinities.csv');
const now=load('../assets/data/dungeon-enemies.csv');
const recalculated=reconcileEnemyElements(alignEnemySpellFlavor(tuneDurability(alignNormalRows(prior))));
assert.deepEqual(now,recalculated,'catalog exactly matches declared survival archetypes');
const categories={},changed={hp:0,def:0,res:0,ordinary:0,boss:0};
for(let i=0;i<500;i++){
 const row=now[i],old=prior[i],type=durabilityArchetype(row.name);
 categories[type]=(categories[type]||0)+1;
 assert.notEqual(type,'unmarked','no unreviewed enemy class '+row.id);
 for(const key of Object.keys(row)){
  if(key==='hp'||key==='def'||key==='res'||key==='spells'||key.startsWith('resist_'))continue;
  assert.equal(row[key],old[key],'no changes outside approved durability and affinity fields '+row.id+' '+key);
 }
 assert.equal(row.spells,alignEnemySpellFlavor([old])[0].spells,'approved authored five spells '+row.id);
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

const approvedCuratedIds=["foe_l023_2","foe_l041_2","foe_l052_2","foe_l053_3","foe_l059_4","foe_l068_3","foe_l071_2","foe_l084_4","foe_l085_4","foe_l088_2","foe_l095_2","foe_l100_2"];
const deferredMicroTuningIds=["foe_l002_2","foe_l005_3","foe_l010_4","foe_l011_2","foe_l017_2","foe_l019_4","foe_l021_2","foe_l021_3","foe_l022_4","boss_l022","foe_l026_4","foe_l029_2","foe_l031_4","foe_l040_2","foe_l042_4","foe_l050_4","foe_l051_4","foe_l054_4","foe_l057_2","foe_l061_4","foe_l065_2","foe_l070_4","foe_l081_4"];
assert.deepEqual(Object.keys(curatedDurabilityFixes).sort(),approvedCuratedIds.slice().sort(),
 'only the 12 explicitly requested fixes are curated');
const lookup=new Map(now.map(x=>[x.id,x]));
const oldLookup=new Map(prior.map(x=>[x.id,x]));
for(const id of approvedCuratedIds){
 const row=lookup.get(id),expected=curatedDurabilityFixes[id];
 assert.ok(row,'approved correction exists '+id);
 for(const key of ['hp','def','res'])assert.equal(Number(row[key]),expected[key],'approved corrected stat '+id+' '+key);
}
for(const id of deferredMicroTuningIds){
 assert.ok(lookup.has(id),'deferred review candidate exists '+id);
 for(const key of ['hp','def','res'])
  assert.equal(lookup.get(id)[key],oldLookup.get(id)[key],'deferred candidate must be unchanged '+id+' '+key);
}

console.log('DUNGEON_DURABILITY_STATIC '+JSON.stringify({count:500,changed,categories,playthroughRun:false}));
console.log('PASS all 500 enemies classified; magic roles aligned with worldview; MAG unchanged; no simulation');
