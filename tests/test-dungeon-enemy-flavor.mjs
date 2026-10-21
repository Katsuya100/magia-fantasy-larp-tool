import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {tuneEnemyRows} from '../scripts/dungeon-enemy-flavor-rules.mjs';
import {nameAffinities} from '../scripts/dungeon-normal-enemy-affinities.mjs';

// GitHub Actions (npm test) is the only required test execution environment.
const csv=url=>G.parseCsv(readFileSync(new URL(url,import.meta.url),'utf8'));
const old=csv('./fixtures/dungeon-enemies-before-flavor.csv');
const now=csv('../assets/data/dungeon-enemies.csv');
const priorNormals=csv('./fixtures/dungeon-enemies-pre-readable-affinities.csv');
const attrs=G.ATTRS, keys=Object.keys(old[0]);
assert.equal(old.length,500);
assert.equal(now.length,500);
assert.deepEqual(now,tuneEnemyRows(old),'live monster catalog must match reviewed, reproducible flavor rules');
for(let i=0;i<500;i++){
 const b=old[i],a=now[i],layer=Math.floor(i/5)+1,slot=i%5;
 for(const field of keys){
  if(!['hp','mag','def','res',...attrs.map(attr=>'resist_'+attr)].includes(field)&&!(field==='spells'&&slot!==4))
   assert.equal(a[field],b[field],b.id+' stable '+field);
 }
 if(slot!==4){
  const prior=priorNormals[i],tags=nameAffinities(a.name);
  for(const field of keys)if(field!=='spells'&&!field.startsWith('resist_')&&!(field==='hp'&&new Set(["foe_l044_1","foe_l044_2","foe_l044_3","foe_l051_1","foe_l051_2"]).has(a.id)))
   assert.equal(a[field],prior[field],a.id+' stable non-elemental stat '+field);
  const sourceSpells=prior.spells.split('|'),newSpells=a.spells.split('|');
  assert.equal(newSpells.length,5,'five circle roles remain '+a.id);
  assert.deepEqual(newSpells.slice(1),sourceSpells.slice(1),'only the primary attack may change '+a.id);
  const oldPrimary=sourceSpells[0].split(':'),newPrimary=newSpells[0].split(':');
  assert.equal(newPrimary[0],oldPrimary[0],'primary spell role unchanged '+a.id);
  assert.equal(newPrimary[2],oldPrimary[2],'primary spell power unchanged '+a.id);
  if(tags.length)assert.equal(newPrimary[1],tags[0],'primary attack matches named attribute '+a.id);
    const total=row=>attrs.reduce((s,k)=>s+Number(row['resist_'+k]),0);
  assert.ok(Math.abs(total(a)-total(prior))<1e-8,'all-element budget unchanged per foe '+a.id);
  if(!tags.length)assert.deepEqual(a,prior,'no explicit innate element '+a.id);
  if(tags.length){
   assert.ok(tags.every(k=>Number(a['resist_'+k])<=1),'named attribute must not be weakness '+a.id);
   assert.ok(tags.some(k=>Number(a['resist_'+k])<1),'named attribute must include real resistance '+a.id);
  }
 }
 if(slot===4){
  const main=b.spells.split('|')[0].split(':')[1];
  if(layer===80){
   assert.equal(a.resist_chaos,'0.95','eclipse sovereign must resist chaos');
   assert.equal(a.resist_gravity,b.resist_gravity,'non-earth celestial sovereign keeps gravity counterplay');
  }else assert.equal(Number(a['resist_'+main]),.95,'boss has genuine resistance to own attack element '+b.id);
  assert.ok(Math.min(...attrs.map(k=>Number(a['resist_'+k])))<1,'boss has identity resistance '+b.id);
  assert.ok(Math.max(...attrs.map(k=>Number(a['resist_'+k])))>=1.25,'boss keeps explicit elemental weakness '+b.id);
  assert.ok(Number(a.hp)>=65,'boss HP never becomes trivial '+b.id);
  assert.ok(Math.abs(Number(a.res)-Number(b.res))<=1,'boss RES capped '+b.id);
  assert.ok(Math.abs(Number(a.def)-Number(b.def))<=2,'boss DEF capped '+b.id);
  const sumRes=x=>attrs.reduce((s,k)=>s+Number(x['resist_'+k]),0);
  assert.ok(Math.abs(sumRes(a)-sumRes(b))<1e-8,'boss total elemental budget unchanged '+b.id);
 }
 if(Number(a.hp)!==Number(b.hp)&&slot!==4)
  assert.ok(new Set(["foe_l044_1","foe_l044_2","foe_l044_3","foe_l051_1","foe_l051_2"]).has(a.id),'only calibrated metal golem HP may change '+a.id);
 if(Number(a.mag)!==Number(b.mag))assert.ok(Math.abs(a.mag-b.mag)<=2,'MAG bound '+b.id);
 if(Number(a.def)!==Number(b.def))assert.ok(Math.abs(a.def-b.def)<=3,'DEF bound '+b.id);
 for(const attr of attrs){
  const key='resist_'+attr,diff=Number(a[key])-Number(b[key]);
  if(slot!==4)assert.ok(Math.abs(diff)<=.4+1e-8,'regular resistance reallocation bound '+key+' '+b.id);
 }
}
const sum=(rows,key)=>rows.reduce((n,e)=>n+Number(e[key]),0);
for(let layer=1;layer<=100;layer++){
 const start=(layer-1)*5,previous=old.slice(start,start+4),current=now.slice(start,start+4);
 for(const key of ['mag','def','res'])
  assert.ok(Math.abs(sum(previous,key)-sum(current,key))<1e-9,
   'same four-encounter stat budget at layer '+layer+' '+key);
 assert.ok(Math.abs(attrs.reduce((s,k)=>s+sum(previous,'resist_'+k)-sum(current,'resist_'+k),0))<1e-8,
  'total seven-element encounter budget must be conserved at layer '+layer);
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

const trio=[{role:'attack',attribute:'flame',power:360},{role:'attack',attribute:'bolt',power:420},{role:'attack',attribute:'gravity',power:540}];
function bossBudget(unit,row){
 const spells=trio.map(spell=>G.damage(unit,row,spell,()=>.999)).sort((a,b)=>b-a);
 return (spells[0]+.72*spells[1]+.38*spells[2])/row.hp;
}
const differences=[];
for(let layer=1;layer<=100;layer++){
 const index=layer*5-1,level=targetClearLevel(layer);
 const player=G.makeUnit({hp:100,mag:10,def:7,res:7},level,{},trio);
 const b=G.fromEnemy(old[index],level),n=G.fromEnemy(now[index],level);
 const previous=bossBudget(player,b),changed=bossBudget(player,n);
 const delta=changed/previous-1;
 if(Math.abs(delta)>=.09)console.log('BOSS_BUDGET_OUTLIER '+JSON.stringify({layer,name:now[index].name,oldHP:old[index].hp,newHP:now[index].hp,delta}));
 differences.push(delta);
}
assert.ok(differences.every(delta=>Math.abs(delta)<.09),'all 100 boss expected effective-health budgets stay within 9%');
console.log('BOSS_FLAVOR_BUDGET '+JSON.stringify({count:differences.length,
 mean:differences.reduce((a,b)=>a+b,0)/differences.length,
 largest:Math.max(...differences.map(Math.abs))}));

const changedIds=now.filter((row,i)=>keys.some(k=>row[k]!==old[i][k])).map(row=>row.id);
assert.ok(changedIds.length>=100,'substantial 20-100F flavor differentiation');
console.log('ENEMY_FLAVOR_BUDGET '+JSON.stringify({changed:changedIds.length,damageToEnemyChange:means.outgoing/means.oldOut-1,damageToHeroChange:means.incoming/means.oldIn-1}));
console.log('PASS all 500 enemies, unchanged early regular foes and all-element encounter budgets, 100 thematic bosses');
