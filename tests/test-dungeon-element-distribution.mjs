// Full-roster / 100-layer authored seven-element balance contract.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCsv,ATTRS} from '../assets/js/dungeon-core.mjs';
import {nameAffinities} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {combatBalanceResistCalibrations,combatBalanceMagOverrides,combatBalanceSupplementalCounters} from '../scripts/dungeon-element-distribution.mjs';
const read=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const base=read('./fixtures/dungeon-enemies-before-distribution.csv');
const master=read('../assets/data/dungeon-enemies.csv');
const plan=read('../assets/data/dungeon-element-plan.csv');
const concepts=read('../assets/data/dungeon-layer-concepts.csv');
assert.equal(base.length,500);assert.equal(master.length,500);
assert.equal(plan.length,500);assert.equal(concepts.length,100);
// Historical authoring fixtures are not a source of truth for final combat tuning.
// Pin the independently approved final CSV blob, and verify its present rows,
// legal spells, resistance structure and authored floor distribution directly.
const rawMaster=readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url));
const actualBlob=createHash('sha1').update('blob '+rawMaster.length+'\0')
 .update(rawMaster).digest('hex');
assert.equal(actualBlob,'9eed8dd1ac6c15e166ddee39ee5820d2f663d4d0',
 'reviewed final enemy roster changed without explicit data-contract approval');
assert.equal(new Set(master.map(row=>row.id)).size,500,'unique enemy identifiers');
assert.equal(new Set(plan.map(row=>row.id)).size,500,'unique plan identifiers');
const primary=Object.fromEntries(ATTRS.map(a=>[a,0]));
const secondary=Object.fromEntries(ATTRS.map(a=>[a,0]));
const magic=Object.fromEntries(ATTRS.map(a=>[a,0]));
const sum=r=>ATTRS.reduce((total,a)=>total+Number(r['resist_'+a]),0);
let primaryChanges=0,secondaryChanges=0,renames=0;
for(let i=0;i<500;i++){
 const a=base[i],b=master[i],old=a.spells.split('|').map(s=>s.split(':')),s=b.spells.split('|').map(s=>s.split(':'));
 assert.equal(plan[i].id,b.id,'approved element plan order must track final roster');
 for(const key of ['hp','mag','def','res']){
  assert.ok(Number.isFinite(Number(b[key]))&&Number(b[key])>0,
   'positive and finite final combat statistic '+b.id+' '+key);
 }
 assert.ok(Number.isSafeInteger(Number(b.hp)),'HP is a whole-number combat stat '+b.id);
 assert.equal(Number(b.weight)>0,true,'enemy has valid spawn weight '+b.id);
 assert.equal(s.length,5);
 for(const k of ['id','name','res','weight','min_level','boss_only','favored_collection_ids'])
  assert.equal(a[k],b[k],'identity, drops and base combat stats preserved '+a.id+' '+k);
 for(let k=0;k<5;k++){
  assert.equal(s[k][0],old[k][0],'same spell role '+a.id);
  assert.ok(Number.isSafeInteger(Number(s[k][2]))&&Number(s[k][2])>0,
   'positive integer final spell power '+a.id+' slot '+k);
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
assert.equal(Object.keys(combatBalanceResistCalibrations).length,89,'all targeted resistance budgets are reviewed');
for(const [id,shift] of Object.entries(combatBalanceResistCalibrations)){
 const before=base.find(r=>r.id===id),after=master.find(r=>r.id===id);
 assert.ok(before&&after,'calibrated enemy exists '+id);
 assert.ok(shift>=-0.3&&shift<=0.35&&shift!==0,'bounded authored shift only '+id);
 assert.ok(Number(after.hp)>0&&Number(after.mag)>0,
  'approved current combat tuning must retain valid stats '+id);
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
assert.equal(Object.keys(combatBalanceMagOverrides).length,36,'32 regular 61-68F adjustments and four later casters');
assert.equal(Object.keys(combatBalanceSupplementalCounters).length,5,'all five 70F foes have a second readable counter');
assert.ok(primaryChanges>100&&secondaryChanges>150);
const jpToAttr={炎:'flame',雷:'bolt',水:'aqua',風:'storm',重力:'gravity',秩序:'law',混沌:'chaos'};
const attrToJp=Object.fromEntries(Object.entries(jpToAttr).map(([jp,attr])=>[attr,jp]));
const handAuthoredBossLore=new Set([5,11,17,28,41,50,73,80,100]);
assert.equal(new Set(concepts.map(c=>c.concept)).size,100,'all 100 authored floor names are unique');
for(let layer=1;layer<=100;layer++){
 const c=concepts[layer-1],enemies=master.slice((layer-1)*5,layer*5);
 assert.equal(Number(c.layer),layer);
 assert.ok(c.concept.length>=5&&c.interpretation.includes(enemies[4].name),
  'every floor has an authored named concept tied to its boss '+layer);
 const slots=enemies.map(r=>r.spells.split('|').map(s=>s.split(':')[1]));
 const used=new Set(slots.flat());
 const motif=c.interpretation.match(/(炎|雷|水|風|重力|秩序|混沌)と(炎|雷|水|風|重力|秩序|混沌)が交差/);
 if(motif)for(const jp of [motif[1],motif[2]])
  assert.ok(used.has(jpToAttr[jp]),'floor lore cannot claim an absent spell element '+layer+' '+jp);
 if(handAuthoredBossLore.has(layer)){
  const bossSpells=slots[4];
  for(const attr of new Set(bossSpells))
   assert.ok(c.interpretation.includes(attrToJp[attr]),
    'hand-authored lore must acknowledge each boss element '+layer+' '+attr);
 }
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
