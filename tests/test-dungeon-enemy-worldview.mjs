// Static authored-worldview unit tests. No playthrough, random fight or balance simulation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv,ATTRS} from '../assets/js/dungeon-core.mjs';
import {tuneEnemyRows} from '../scripts/dungeon-enemy-flavor-rules.mjs';
import {tuneDurability} from '../scripts/dungeon-enemy-durability-rules.mjs';
import {alignNormalRows} from '../scripts/dungeon-normal-enemy-affinities.mjs';
import {alignEnemySpellFlavor,enemySpellOverrides,undeadNames} from '../scripts/dungeon-enemy-spell-flavor.mjs';
import {reconcileEnemyElements} from '../scripts/dungeon-enemy-element-consistency.mjs';
const noBase=row=>{const {hp,mag,...lore}=row;return lore;};
const read=path=>parseCsv(readFileSync(new URL(path,import.meta.url),'utf8'));
const raw=read('./fixtures/dungeon-enemies-before-flavor.csv'),baseline=read('./fixtures/dungeon-enemies-pre-readable-affinities.csv'),now=read('./fixtures/dungeon-enemies-before-distribution.csv');
const beforeSpell=tuneDurability(alignNormalRows(baseline));
const reviewIds=new Set(['foe_l001_1','foe_l001_2','foe_l001_3','foe_l001_4','boss_l001','foe_l002_1','foe_l002_2','foe_l002_3','foe_l002_4','boss_l002','foe_l004_1','foe_l004_3','foe_l004_4','foe_l005_1','foe_l005_2','foe_l005_3','foe_l005_4','foe_l006_1','foe_l006_2','foe_l007_2','foe_l007_4','foe_l009_1','foe_l009_2','foe_l009_3','boss_l009','foe_l010_1','foe_l010_2','foe_l010_3','foe_l010_4','boss_l010','foe_l011_1','foe_l011_2','foe_l011_3','foe_l011_4','boss_l011','foe_l013_4','foe_l014_3','foe_l015_1','foe_l015_2','foe_l015_3','foe_l015_4','boss_l015','foe_l016_1','foe_l016_2','foe_l016_3','foe_l016_4','boss_l016','foe_l017_1','foe_l017_2','foe_l017_3','foe_l017_4','boss_l017','foe_l018_1','foe_l018_2','foe_l018_3','foe_l018_4','boss_l018','foe_l020_4','foe_l021_2','foe_l021_3','foe_l021_4','foe_l022_1','foe_l022_2','foe_l022_3','boss_l022','foe_l024_1','foe_l024_2','foe_l024_3','foe_l024_4','boss_l024','foe_l025_1','foe_l025_2','foe_l025_3','foe_l025_4','boss_l025','foe_l026_4','boss_l027','foe_l029_2','foe_l030_1','foe_l030_2','foe_l030_3','foe_l030_4','boss_l030','boss_l031','foe_l032_2','boss_l032','foe_l033_1','foe_l033_2','foe_l033_3','foe_l033_4','boss_l033','foe_l034_3','foe_l034_4','foe_l035_1','foe_l035_2','foe_l035_3','foe_l035_4','boss_l035','foe_l036_1','foe_l036_2','foe_l036_4','boss_l036','foe_l037_1','foe_l037_3','foe_l039_1','foe_l040_4','boss_l040','foe_l041_2','foe_l041_3','foe_l042_1','foe_l042_3','boss_l042','foe_l043_1','foe_l044_1','foe_l044_2','foe_l044_3','foe_l044_4','boss_l044','foe_l045_3','foe_l045_4','boss_l045','foe_l047_1','foe_l047_3','foe_l047_4','foe_l049_1','foe_l049_2','foe_l049_3','foe_l049_4','boss_l049','foe_l051_1','foe_l051_2','foe_l051_4','boss_l051','foe_l053_1','foe_l053_2','foe_l053_3','foe_l053_4','boss_l053','foe_l054_1','foe_l054_2','foe_l054_3','foe_l054_4','boss_l054','foe_l055_4','foe_l059_4','foe_l060_1','foe_l060_2','foe_l060_3','foe_l060_4','boss_l060','foe_l062_2','foe_l062_4','foe_l064_2','foe_l064_3','foe_l064_4','boss_l064','foe_l065_2','foe_l065_3','foe_l065_4','foe_l066_3','foe_l068_4','foe_l070_1','foe_l070_3','foe_l070_4','boss_l070','foe_l071_1','foe_l071_3','boss_l072','foe_l073_2','foe_l073_4','foe_l076_1','foe_l076_2','foe_l076_3','foe_l076_4','boss_l076','foe_l077_3','foe_l077_4','foe_l080_3','foe_l080_4','boss_l080','foe_l082_1','foe_l082_2','foe_l082_4','foe_l083_1','foe_l085_3','foe_l086_1','foe_l086_3','foe_l086_4','boss_l086','foe_l087_4','foe_l088_1','foe_l089_2','foe_l090_1','foe_l090_3','foe_l090_4','foe_l091_1','foe_l091_2','foe_l091_4','boss_l091','foe_l093_1','foe_l093_4','foe_l094_2','foe_l094_3','foe_l095_2','foe_l095_3','foe_l096_2','foe_l096_4','boss_l096','foe_l097_2','foe_l098_1','foe_l098_2','foe_l098_3','foe_l098_4','boss_l098','foe_l099_3','foe_l100_1','foe_l100_3']);
assert.equal(reviewIds.size,217,'exactly 217 previously flagged enemies are audited');
assert.equal(now.length,500);assert.equal(baseline.length,500);assert.deepEqual(now.map(noBase),tuneEnemyRows(raw).map(noBase),'full 500-enemy historical regeneration');
const doc=readFileSync(new URL('../docs/DUNGEON-ENEMY-WORLDVIEW-REVIEW.md',import.meta.url),'utf8');
let changed=0,healRemoved=0,priorUpdated=0,reviewUpdated=0;
for(let i=0;i<now.length;i++){
 const a=baseline[i],b=now[i],source=raw[i];
 assert.equal(a.id,b.id,'stable ID / encounter ordering');
 for(const field of Object.keys(a))if(field!=='hp'&&field!=='mag'&&field!=='def'&&field!=='res'&&!field.startsWith('resist_')&&field!=='spells')assert.equal(a[field],b[field],'stable identity/MAG/loot '+b.id+' '+field);
 for(const attr of ATTRS)assert.equal(reconcileEnemyElements([alignEnemySpellFlavor([beforeSpell[i]])[0]])[0]['resist_'+attr],b['resist_'+attr],'curated resistance reproducibility '+b.id);
 const expected=alignEnemySpellFlavor([a])[0];assert.equal(b.spells,expected.spells,'authored spell + undead guard '+b.id);
 const aa=a.spells.split('|'),bb=b.spells.split('|');assert.equal(aa.length,5);assert.equal(bb.length,5);
 for(let j=0;j<5;j++){
  const before=aa[j].split(':'),after=bb[j].split(':');
  assert.equal(before[2],after[2],'spell power preserved '+b.id+' '+j);
  assert.ok(before[0]===after[0]||(before[0]==='support'&&after[0]==='defense'&&undeadNames.test(b.name)),'only undead healing becomes defense '+b.id+' '+j);
 }
 if(undeadNames.test(b.name)){
  assert.ok(!bb.some(x=>x.startsWith('support:')),'undead cannot heal '+b.id);
  if(aa.some(x=>x.startsWith('support:')))healRemoved++;
 }
 if(a.spells!==b.spells){changed++;if(reviewIds.has(b.id))reviewUpdated++;}
 if(baseline[i].spells!==source.spells)priorUpdated++;
 if(reviewIds.has(b.id))assert.ok(doc.includes('`'+b.id+'`'),'every reviewed enemy documented '+b.id);
 if(!reviewIds.has(b.id)&&!Object.hasOwn(enemySpellOverrides,b.id)&&!undeadNames.test(b.name))assert.equal(a.spells,b.spells,'unreviewed unaffected '+b.id);
}
assert.ok(changed>=200);
assert.ok(reviewUpdated>=142);
assert.ok(healRemoved>=57);
assert.ok(Object.keys(enemySpellOverrides).length>=197,'45 earlier fixes and new approvals declared');
for(const id of Object.keys(enemySpellOverrides))assert.ok(now.some(e=>e.id===id),'no stale curated ID '+id);
for(const id of ['boss_l070','foe_l070_1','foe_l070_3'])if(now.some(e=>e.id===id))assert.equal(now.find(e=>e.id===id).spells.split('|')[0].split(':')[1],'law','evil and law coexist');
const named=id=>now.find(x=>x.id===id),attribute=(id,slot)=>named(id).spells.split('|')[slot].split(':')[1];
assert.equal(attribute('foe_l029_2',0),'bolt');assert.equal(attribute('foe_l062_4',0),'aqua');
assert.equal(attribute('foe_l024_2',0),'aqua');assert.equal(attribute('foe_l024_2',2),'chaos');
assert.equal(attribute('boss_l031',0),'flame');assert.equal(attribute('boss_l031',2),'chaos');
assert.equal(attribute('foe_l070_1',0),'law');assert.equal(attribute('foe_l097_2',0),'chaos');
console.log('PASS 500 authored spell records; '+reviewIds.size+' reviewed; '+changed+' spell rows changed; '+healRemoved+' undead heal roles removed; no playthrough');
