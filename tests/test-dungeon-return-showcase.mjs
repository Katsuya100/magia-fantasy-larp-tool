import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,items,collections]=await Promise.all(['balance','levels','floors','player-base','enemies','consumables','collections'].map(csv));
configure({balance,levels,floors,playerBase});
const wait=async(check)=>{
 const end=Date.now()+9000;
 while(!(await check())&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(await check(),'checkpoint opens');
};
const attack={role:'attack',attribute:'flame',power:5000};
const create=async(xp,bonusClaimed)=>{
 const factory=fakeIndexedDB(),db=await openStore(factory),p=await getProfile(db);
 p.name='帰還演出';p.returns=1;p.level=30;p.slots=['c1','c2','c3',null,null];
 for(let i=1;i<=3;i++)await putCircle(db,{id:'c'+i,image:new Blob(['photo']),analysis:attack,revealed:true});
 p.run={floor:50,slotIds:[...p.slots],
  hero:G.makeUnit(p.base,30,{},[attack,attack,attack,null,null],'player'),
  enemy:G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19),enemyName:'十層ボス',
  carry:[null,null,null,null,null],loot:[],xp,usedItems:0,bonusClaimed,log:[],stage:'checkpoint'};
 await saveProfile(db,p);
 return {factory,db};
};
const originalRandom=Math.random;Math.random=()=>.5;
try{
 const {factory,db}=await create(0,false),env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=return-bonus-item');
  await wait(()=>$('checkpoint').hidden===false);
  await $('bonus-item').fire('click');
  const earned=(await getProfile(db)).run.carry.find(Boolean);
  assert.equal(earned.returnBonus,true,'direct carry bonus is tagged only for this expedition');
  await $('returnHome').fire('click');
  assert.equal($('returnShowcase').hidden,false);
  assert.equal($('returnSceneTitle').textContent,'アイテム報酬','no collection or EXP sequence');
  assert.equal($('returnCollections').hidden,true);
  assert.equal($('returnExperience').hidden,true);
  assert.equal($('returnNext').textContent,'完了');
  assert.ok($('returnRewards').innerHTML.includes(items.find(row=>row.id===earned.id).name));
  const saved=await getProfile(db);
  assert.equal(saved.inventory.some(item=>item.returnBonus),false,'temporary bonus marker never enters saved inventory');
  await $('returnNext').fire('click');
  assert.equal($('home').hidden,false);
 }finally{env.restore();}

 const none=await create(0,true),env2=fakeDungeonBrowser({factory:none.factory}),$2=id=>env2.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=return-no-reward');
  await wait(()=>$2('checkpoint').hidden===false);
  await $2('returnHome').fire('click');
  assert.equal($2('returnShowcase').hidden,true,'no awards or XP skips the entire ceremony');
  assert.equal($2('home').hidden,false);
 }finally{env2.restore();}

 // NEW is based on the complete acquisition history, not current inventory.
 const history=await create(0,true),initial=await getProfile(history.db);
 const [oldItem,newItem]=items.slice(0,2),[oldCollection,newCollection]=collections.slice(0,2);
 initial.obtainedItemIds=[oldItem.id];
 initial.collection[oldCollection.id]=1;
 initial.run.loot=[
  {type:'use',id:oldItem.id,value:10,bonus:null},
  {type:'use',id:newItem.id,value:10,bonus:null},
  {type:'collection',id:oldCollection.id},
  {type:'collection',id:newCollection.id},
  {type:'stone'}
 ];
 const repeatRun=structuredClone(initial.run);
 await saveProfile(history.db,initial);
 const historyEnv=fakeDungeonBrowser({factory:history.factory}),$h=id=>historyEnv.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=return-new-sorting');
  await wait(()=>$h('checkpoint').hidden===false);
  await $h('returnHome').fire('click');
  assert.equal($h('returnSceneTitle').textContent,'コレクション報酬');
  const displayedCollections=$h('returnCollections').innerHTML;
  assert.ok(displayedCollections.indexOf(newCollection.name)<displayedCollections.indexOf(oldCollection.name),'first-ever collections come before already known ones');
  assert.equal((displayedCollections.match(/class="return-new"/g)||[]).length,1,'only first-ever collection receives NEW');
  await $h('returnNext').fire('click');
  assert.equal($h('returnSceneTitle').textContent,'アイテム報酬');
  const displayedRewards=$h('returnRewards').innerHTML;
  assert.ok(displayedRewards.indexOf('魔導石')<displayedRewards.indexOf(newItem.name),'magic stones are always the first reward');
  assert.ok(displayedRewards.indexOf(newItem.name)<displayedRewards.indexOf(oldItem.name),'first-ever item precedes previously acquired item');
  assert.equal((displayedRewards.match(/class="return-new"/g)||[]).length,1,'only first-ever item receives NEW');
  const saved=await getProfile(history.db);
  assert.ok(saved.obtainedItemIds.includes(newItem.id),'the first-ever item is recorded persistently');
 }finally{historyEnv.restore();}
 // Even when the player uses up every copy, previously acquired items never become NEW again.
 const repeatProfile=await getProfile(history.db);
 repeatProfile.inventory=[];
 repeatProfile.run={...repeatRun,loot:[{type:'use',id:newItem.id,value:11,bonus:null},{type:'collection',id:newCollection.id}]};
 await saveProfile(history.db,repeatProfile);
 const repeated=fakeDungeonBrowser({factory:history.factory}),$r=id=>repeated.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=return-history-repeat');
  await wait(()=>$r('checkpoint').hidden===false);
  await $r('returnHome').fire('click');
  assert.doesNotMatch($r('returnCollections').innerHTML,/class="return-new"/,'repeat collection does not get NEW');
  await $r('returnNext').fire('click');
  assert.doesNotMatch($r('returnRewards').innerHTML,/class="return-new"/,'used-up, previously acquired item does not get NEW');
 }finally{repeated.restore();}
 
 const xpOnly=await create(45,true),env3=fakeDungeonBrowser({factory:xpOnly.factory}),$3=id=>env3.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=return-xp-only');
  await wait(()=>$3('checkpoint').hidden===false);
  await $3('returnHome').fire('click');
  assert.equal($3('returnSceneTitle').textContent,'EXP','XP-only return skips empty collection and reward scenes');
  assert.equal($3('returnNext').textContent,'完了');
  assert.equal($3('returnCollections').hidden,true);
  assert.equal($3('returnRewards').hidden,true);
 }finally{env3.restore();}
 console.log('PASS return bonus reward, NEW sorting and persistence, empty-stage skipping, XP-only return and completion');
}finally{Math.random=originalRandom;}
