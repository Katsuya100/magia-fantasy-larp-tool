// Static element-cross audit: never executes a playthrough.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv,ATTRS} from '../assets/js/dungeon-core.mjs';
import {tuneDurability} from '../scripts/dungeon-enemy-durability-rules.mjs';
import {nameAffinities,alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {alignEnemySpellFlavor} from '../scripts/dungeon-enemy-spell-flavor.mjs';
import {tuneEnemyRows} from '../scripts/dungeon-enemy-flavor-rules.mjs';
import {reconcileEnemyElements,elementResistanceCorrections,intendedElementWeaknesses} from '../scripts/dungeon-enemy-element-consistency.mjs';
const read=p=>parseCsv(readFileSync(new URL(p,import.meta.url),'utf8'));
const old=read('./fixtures/dungeon-enemies-pre-readable-affinities.csv');
const source=read('./fixtures/dungeon-enemies-before-flavor.csv');
const now=read('../assets/data/dungeon-enemies.csv');
const before=alignEnemySpellFlavor(tuneDurability(alignNormalRows(old)));
assert.equal(now.length,500);
assert.deepEqual(now,tuneEnemyRows(source),'whole pipeline regenerates all 500');
assert.deepEqual(now,reconcileEnemyElements(before),'last pass is reproducible');
assert.equal(Object.keys(elementResistanceCorrections).length,41);
assert.equal(Object.keys(intendedElementWeaknesses).length,40);
const sum=r=>ATTRS.reduce((n,a)=>n+Number(r['resist_'+a]),0);
let changedRes=0,changedSpells=0,exceptions=0,primaryWeak=0,bothWeak=0;
for(let i=0;i<500;i++){
 const a=before[i],b=now[i],as=a.spells.split('|').map(s=>s.split(':')),bs=b.spells.split('|').map(s=>s.split(':'));
 assert.equal(a.id,b.id);assert.equal(as.length,5);assert.equal(bs.length,5);
 for(const k of Object.keys(a))if(k!=='spells'&&!k.startsWith('resist_'))assert.equal(a[k],b[k],'unchanged non-flavor '+a.id);
 assert.ok(Math.abs(sum(a)-sum(b))<1e-8,'seven-element budget '+a.id);
 for(let j=0;j<5;j++){
  assert.equal(as[j][0],bs[j][0],'same role '+a.id);
  assert.equal(as[j][2],bs[j][2],'same power '+a.id);
  if(![2,4].includes(j))assert.equal(as[j][1],bs[j][1],'main element is preserved '+a.id);
 }
 const r=ATTRS.some(k=>a['resist_'+k]!==b['resist_'+k]),s=a.spells!==b.spells;
 if(r)changedRes++;if(s)changedSpells++;assert.ok(!r||!s,'spell & resistance corrections separated '+a.id);
 const m=bs[0][1],n=bs[2][1],mw=Number(b['resist_'+m])>1,sw=Number(b['resist_'+n])>1;
 if(mw)primaryWeak++;if(mw&&sw)bothWeak++;
 const ex=Object.hasOwn(intendedElementWeaknesses,b.id);assert.equal(mw||sw,ex,'no unreviewed weaknesses '+b.id);
 if(ex)exceptions++;
 if(b.boss_only==='0')for(const k of nameAffinities(b.name))assert.ok(Number(b['resist_'+k])<=1,'no weakness to literal named element '+b.id);
}
const secondaryPlan={
 'foe_l004_1':'law','foe_l008_1':'gravity','foe_l008_3':'gravity','foe_l008_4':'gravity',
 'foe_l009_4':'law','boss_l019':'storm','foe_l027_1':'law','boss_l027':'gravity',
 'foe_l043_2':'gravity','foe_l043_3':'chaos','foe_l043_4':'chaos','boss_l043':'law',
 'foe_l057_2':'gravity','foe_l057_4':'gravity','boss_l061':'law','foe_l062_3':'aqua',
 'boss_l062':'aqua','foe_l065_1':'gravity','boss_l070':'storm','foe_l072_3':'aqua',
 'foe_l078_1':'chaos','foe_l078_2':'gravity','foe_l078_3':'chaos','foe_l078_4':'chaos',
 'boss_l078':'chaos','foe_l079_1':'storm','foe_l079_2':'storm','foe_l079_4':'law','boss_l097':'storm'
};
assert.equal(Object.keys(secondaryPlan).length,29);
for(const [id,expected] of Object.entries(secondaryPlan)){
 const enemy=now.find(r=>r.id===id);
 assert.ok(enemy,'known reviewed secondary slot '+id);
 const spells=enemy.spells.split('|').map(s=>s.split(':'));
 for(const slot of [2,4])assert.equal(spells[slot][1],expected,'approved secondary retarget '+id);
 assert.ok(Number(enemy['resist_'+expected])<=1,'secondary target is not weak '+id);
}
assert.equal(changedRes,41);
assert.equal(changedSpells,0,'secondary spell changes are already applied by the spell flavor stage');
assert.equal(exceptions,40);assert.equal(primaryWeak,1);assert.equal(bothWeak,1);
assert.deepEqual(now.find(r=>r.id==='boss_l080'),before.find(r=>r.id==='boss_l080'),'80F boss exception preserved');
for(const id of ['foe_l091_2','foe_l096_4']){const i=now.findIndex(r=>r.id===id);assert.deepEqual(now[i],before[i],'approved unchanged enemy '+id);}
const report=readFileSync(new URL('../docs/DUNGEON-ENEMY-ELEMENT-CONSISTENCY.md',import.meta.url),'utf8');
for(const id of Object.keys(elementResistanceCorrections)){const r=now.find(x=>x.id===id);assert.ok(report.includes('| '+r.name+' |'),'each corrected enemy documented '+id);}
for(const id of Object.keys(intendedElementWeaknesses)){const r=now.find(x=>x.id===id);assert.ok(report.includes('| '+r.name+' |'),'each retained exception documented '+id);}
console.log('PASS all 500 enemies reconciled; 41 resistance fixes, 29 spell fixes, 40 documented exceptions; no playthrough');
