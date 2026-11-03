import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {combatSpell,strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {effectCaption,attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';
import {discardCombatEchoesOnMiss} from '../assets/js/dungeon-combat-fx-echo.mjs';
import {needsEmptyCarryConfirmation} from '../assets/js/dungeon-loadout.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';

const csv=async key=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+key+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const base={hp:110,mag:12,def:10,res:10},attack={role:'attack',attribute:'flame',power:681};
const unit=(spells=[],resists={})=>G.makeUnit(base,19,resists,spells,'player');
const missedByStorm=(role,side='hero')=>{
 const caster=unit(role==='basic'?[]:[attack]);
 const target=unit([],{flame:.5});
 G.addStatus(caster,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:1,turns:1});
 const steps=[];
 if(side==='hero')G.round(caster,target,role==='basic'?-1:0,-1,buffs,()=>0,step=>steps.push(step));
 else G.round(target,caster,-1,role==='basic'?-1:0,buffs,()=>0,step=>steps.push(step));
 return steps.find(step=>step.side===side&&step.role===role);
};
for(const role of ['attack','basic']){
 for(const side of ['hero','enemy']){
  const miss=missedByStorm(role,side);
  assert.equal(miss?.amount,0,role+' '+side+': storm dizziness costs the hit');
  assert.equal(miss?.missedByDizziness,true,'only the resolved RNG failure creates MISS');
  assert.equal(effectCaption(miss),'MISS','combat FX displays MISS rather than damage zero');
  assert.equal(attackHitAffinity(miss),'none','RESIST and WEAK never accompany MISS');
  if(role==='attack')assert.equal(attackHitAffinity({...miss,amount:12}),'none',
   'even an unrelated HP change during a missed legacy spell must not show RESIST');
 }
}
let disposed=0;
const ghosts=[{dispose(){disposed++;}}];
assert.equal(discardCombatEchoesOnMiss([missedByStorm('basic')],ghosts,{querySelectorAll:()=>[]}),true,
 'dizzy basic MISS clears an earlier RESIST/WEAK echo');
const legacyEcho=[{dispose(){disposed++;}}];
assert.equal(discardCombatEchoesOnMiss(
 [{role:'attack',amount:12,missedByDizziness:true}],legacyEcho,{querySelectorAll:()=>[]}),true,
 'inherited HP changes on a missed spell still clear prior affinity visuals');
assert.equal(disposed,2);
assert.deepEqual(ghosts,[]);
assert.equal(discardCombatEchoesOnMiss([{role:'basic',amount:0}],[],{querySelectorAll:()=>[]}),false,
 'zero basic damage without dizziness is not a MISS');
const hero=unit([attack]),enemy=unit([],{flame:.5}),landed=[];
G.round(hero,enemy,0,-1,buffs,()=>.99,step=>landed.push(step));
const hit=landed.find(step=>step.side==='hero'&&step.role==='attack');
assert.ok(hit.amount>0);
assert.notEqual(hit.missedByDizziness,true,'a landed attack is not marked as a miss');
assert.equal(attackHitAffinity(hit),'resist','real landed resistance is retained');
assert.notEqual(effectCaption(hit),'MISS');

const zeroHero=unit([attack]),deadTarget=unit([],{flame:.5}),zero=[];
deadTarget.hp=0;G.round(zeroHero,deadTarget,0,-1,buffs,()=>.99,step=>zero.push(step));
const zeroHit=zero.find(step=>step.side==='hero'&&step.role==='attack');
assert.equal(zeroHit.amount,0,'zero observed damage can result from an already empty HP bar');
assert.notEqual(zeroHit.missedByDizziness,true,'zero damage alone is not a dizziness failure');
assert.notEqual(effectCaption(zeroHit),'MISS');
assert.equal(attackHitAffinity(zeroHit),'none','zero observed damage does not show an affinity');

const sampleItem={id:'heal_s',instanceId:'item-one',type:'use',value:30};
assert.equal(needsEmptyCarryConfirmation([sampleItem],[null,null]),true);
assert.equal(needsEmptyCarryConfirmation([], [null,null]),false);
assert.equal(needsEmptyCarryConfirmation([sampleItem],[0,null]),false);
assert.equal(needsEmptyCarryConfirmation([sampleItem],[null,0]),false);

const page=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.match(page,/id="emptyCarryDepartureDialog"/);
assert.match(page,/携行品を持たずに出発しますか？/);
assert.match(page,/id="cancelEmptyCarryDeparture"[^>]*>戻る</);
assert.match(page,/id="confirmEmptyCarryDeparture"[^>]*>そのまま出発</);

const button=data=>({dataset:data,disabled:false,closest(){return this;}});
const wait=async(predicate,description)=>{
 const deadline=Date.now()+12000;
 while(!(await predicate())&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(await predicate(),description);
};
async function scenario({name,stock,selected=false,upgrade=0,level=35,invalid=false}){
 const browser=fakeDungeonBrowser(),doc=browser.document,$=id=>doc.getElementById(id);
 try{
  const db=await openStore(browser.factory),profile=await getProfile(db);
  const spellData=[
   {role:'defense',attribute:'storm',power:strengthenedPower(430,upgrade)},
   {role:'attack',attribute:'flame',power:700},
   {role:'support',attribute:'aqua',power:800}
  ];
  const ids=spellData.map((_,i)=>name+'-circle-'+i);
  profile.name='Muse分岐テスト';profile.level=level;profile.returns=1;
  profile.tutorialDone=true;profile.initialCircleChoiceDone=true;
  profile.slots=invalid?[ids[0],ids[1],null,null,null]:[...ids,null,null];
  profile.inventory=stock?[{...sampleItem,instanceId:name+'-item'}]:[];
  profile.carrySlots=selected?[name+'-item',null,null,null,null]:[null,null,null,null,null];
  profile.run=null;
  const initialAttempts=profile.attempts;
  await saveProfile(db,profile);
  for(let i=0;i<ids.length;i++)await putCircle(db,{
   id:ids[i],image:new Blob(['muse-'+i],{type:'image/jpeg'}),
   analysis:spellData[i],basePower:i===0?430:spellData[i].power,
   upgradeLevel:i===0?upgrade:0,revealed:true,registeredAt:i+1
  });
  await import('../assets/js/dungeon-app.mjs?integration=muse-12-24-26-'+name);
  await wait(()=>$('prepare').hidden===false,name+': preparation is ready');

  // #26: the existing detail slot displays only the storm buff's standalone
  // incoming-damage reduction, measured by applying the production cast.
  await doc.click(button({circleDetail:ids[0]}));
  const stormCircle={analysis:spellData[0],basePower:430,upgradeLevel:upgrade};
  const caster=G.makeUnit(profile.base,level,{},[],'player');
  G.cast(caster,caster,combatSpell(stormCircle),buffs,()=>.99);
  const reduction=Math.round((1-G.factor(caster,'incoming'))*1000)/10;
  assert.match($('magicDetailsStats').innerHTML,
   new RegExp('被ダメージ '+reduction+'%軽減（嵐の衣のみ）'),name+': detail matches the real resolved defense effect');
  const attacker=G.makeUnit(base,level,{},[attack],'enemy');
  const undefended=G.makeUnit(profile.base,level,{},[],'player');
  const before=G.damage(attacker,undefended,attack,()=>.99);
  const after=G.damage(attacker,caster,attack,()=>.99);
  assert.ok(Math.abs(after-before*(1-reduction/100))<=1.5,
   name+': incoming damage actually follows the displayed standalone reduction');
  await doc.click(button({circleDetail:ids[1]}));
  assert.doesNotMatch($('magicDetailsStats').innerHTML,/嵐の衣のみ|被ダメージ .*%軽減/,
   name+': other spell details remain unchanged');
  $('magicDetailsDialog').close();

  const launched=$('startAttack').fire('click');
  if(stock&&!selected&&!invalid){
   assert.equal($('emptyCarryDepartureDialog').open,true,name+': warns for an owned but unequipped item');
   $('startAttack').fire('click');
   assert.equal((await getProfile(db)).attempts,initialAttempts,'repeated launch cannot bypass the dialog');
   $('cancelEmptyCarryDeparture').fire('click');
   assert.equal($('emptyCarryDepartureDialog').open,false,'Back closes warning without a launch');
   assert.equal((await getProfile(db)).attempts,initialAttempts);
   $('startAttack').fire('click');
   assert.equal($('emptyCarryDepartureDialog').open,true,'retry opens one confirmation');
   const confirmed=$('confirmEmptyCarryDeparture').fire('click');
   $('confirmEmptyCarryDeparture').fire('click');
   await confirmed;
  }else{
   await launched;
   assert.equal($('emptyCarryDepartureDialog').open,false,
    name+': no warning without stock, with a prepared item, or with invalid spell setup');
  }
  if(invalid){
   assert.equal((await getProfile(db)).run,null,'ordinary 3-circle requirement is not loosened');
   return reduction;
  }
  await wait(async()=>(await getProfile(db)).run!==null,name+': departure is saved');
  const saved=await getProfile(db);
  assert.equal(saved.attempts,initialAttempts+1,'exactly one departure was recorded');
  assert.equal(saved.run.carry.filter(Boolean).length,selected?1:0);
  assert.equal(saved.inventory.length,stock-(selected?1:0),
   'only equipped items are transferred, without double consumption');
  return reduction;
 }finally{browser.restore();}
}

const low=await scenario({name:'stock-empty',stock:1,upgrade:0,level:1});
const high=await scenario({name:'stock-selected',stock:1,selected:true,upgrade:15,level:100});
await scenario({name:'no-stock',stock:0});
await scenario({name:'invalid',stock:1,invalid:true});
assert.notEqual(low,high,'player MAG, magic power and upgrades influence the displayed reduction');
console.log('PASS Muse #12/#24/#26: explicit MISS, guarded departure and effective storm-defense value');
