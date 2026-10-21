import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {tuneEnemyRows} from '../scripts/dungeon-enemy-flavor-rules.mjs';

// GitHub Actions (npm test) is the only required test execution environment.
const csv=url=>G.parseCsv(readFileSync(new URL(url,import.meta.url),'utf8'));
const old=csv('./fixtures/dungeon-enemies-before-flavor.csv');
const now=csv('../assets/data/dungeon-enemies.csv');
const attrs=G.ATTRS, keys=Object.keys(old[0]);
assert.equal(old.length,500);
assert.equal(now.length,500);
assert.deepEqual(now,tuneEnemyRows(old),'live monster catalog must match reviewed, reproducible flavor rules');
for(let i=0;i<500;i++){
 const b=old[i],a=now[i],layer=Math.floor(i/5)+1,slot=i%5;
 for(const field of keys){
  if(!['mag','def',...attrs.map(attr=>'resist_'+attr)].includes(field))
   assert.equal(a[field],b[field],b.id+' stable '+field);
 }
 if(layer<20||slot===4)assert.deepEqual(a,b,b.id+' protected early/boss encounter');
 if(Number(a.mag)!==Number(b.mag))assert.ok(Math.abs(a.mag-b.mag)<=2,'MAG bound '+b.id);
 if(Number(a.def)!==Number(b.def))assert.ok(Math.abs(a.def-b.def)<=3,'DEF bound '+b.id);
 for(const attr of attrs){
  const key='resist_'+attr,diff=Number(a[key])-Number(b[key]);
  assert.ok(Math.abs(diff)<=.050000001,'resistance bound '+key+' '+b.id);
  if(Number(b[key])!==1)assert.equal(a[key],b[key],'authorial elemental weakness/strength '+b.id);
 }
}
const sum=(rows,key)=>rows.reduce((n,e)=>n+Number(e[key]),0);
for(let layer=1;layer<=100;layer++){
 const start=(layer-1)*5,previous=old.slice(start,start+4),current=now.slice(start,start+4);
 for(const key of ['hp','mag','def','res',...attrs.map(attr=>'resist_'+attr)])
  assert.ok(Math.abs(sum(previous,key)-sum(current,key))<1e-9,
   'same four-encounter stat/resistance budget at layer '+layer+' '+key);
}
configure({
 balance:csv('../assets/data/dungeon-balance.csv'),
 levels:csv('../assets/data/dungeon-levels.csv'),
 floors:csv('../assets/data/dungeon-floors.csv'),
 playerBase:csv('../assets/data/dungeon-player-base.csv')
});
// The main CI also runs all 1-100F seeded progression/debuff tests.
// Check a separate damage budget for EVERY designed layer and ALL seven elements.
const heroAttack=attrs.map(attribute=>({role:'attack',attribute,power:1200}));
const relative=(a,b)=>Math.abs(a-b)/Math.max(1,a);
const means={outgoing:0,incoming:0,oldOut:0,oldIn:0};
for(let layer=1;layer<=100;layer++){
 const start=(layer-1)*5,level=targetClearLevel(layer);
 const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},level,{},heroAttack,'balance-hero');
 const originals=old.slice(start,start+4).map(row=>G.fromEnemy(row,level));
 const changed=now.slice(start,start+4).map(row=>G.fromEnemy(row,level));
 const attackBudget=group=>group.reduce((t,enemy)=>t+heroAttack.reduce((n,spell)=>n+G.damage(hero,enemy,spell,()=>.999),0),0);
 const threatBudget=group=>group.reduce((t,enemy)=>t+G.damage(enemy,hero,enemy.spells[0],()=>.999),0);
 const oldOut=attackBudget(originals),newOut=attackBudget(changed);
 const oldIn=threatBudget(originals),newIn=threatBudget(changed);
 assert.ok(relative(oldOut,newOut)<=.04,'all-element incoming-to-enemies damage budget layer '+layer+': '+oldOut+' -> '+newOut);
 assert.ok(relative(oldIn,newIn)<=.06,'all-enemy outgoing-to-hero damage budget layer '+layer+': '+oldIn+' -> '+newIn);
 if(layer>=20){
  means.oldOut+=oldOut;means.outgoing+=newOut;
  means.oldIn+=oldIn;means.incoming+=newIn;
 }
}
assert.ok(relative(means.oldOut,means.outgoing)<=.01,'total hero damage change stays within 1%');
assert.ok(relative(means.oldIn,means.incoming)<=.01,'total enemy damage change stays within 1%');
const changedIds=now.filter((row,i)=>keys.some(k=>row[k]!==old[i][k])).map(row=>row.id);
assert.ok(changedIds.length>=100,'substantial 20-100F flavor differentiation');
console.log('ENEMY_FLAVOR_BUDGET '+JSON.stringify({changed:changedIds.length,damageToEnemyChange:means.outgoing/means.oldOut-1,damageToHeroChange:means.incoming/means.oldIn-1}));
console.log('PASS all 500 enemies, frozen early layers/bosses, 7-element encounter budgets');
