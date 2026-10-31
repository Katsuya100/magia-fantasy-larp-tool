import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const wait=async (predicate,message)=>{
 const until=Date.now()+9000;
 while(!predicate()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(predicate(),message);
};
const attack={role:'attack',attribute:'flame',power:100};
const create=async (stage='checkpoint')=>{
 const factory=fakeIndexedDB(),db=await openStore(factory),profile=await getProfile(db);
 profile.name='保存失敗の再現';profile.level=30;profile.returns=1;
 profile.slots=['c1','c2','c3',null,null];
 for(let i=1;i<=3;i++)await putCircle(db,{id:'c'+i,image:new Blob(['img'+i]),analysis:attack,revealed:true});
 const hero=G.makeUnit(profile.base,30,{},[attack,attack,attack,null,null],'player');
 const enemy=G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19);
 profile.run={floor:stage==='checkpoint'?50:49,slotIds:[...profile.slots],hero,enemy,
  enemyName:'十層ボス',carry:[null,null,null,null,null],loot:[{type:'stone'}],xp:0,
  usedItems:0,bonusClaimed:true,log:[],stage};
 await saveProfile(db,profile);
 return {factory,db};
};
const checkCheckpoint=async action=>{
 const {factory,db}=await create(),env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=closing-'+action);
  await wait(()=>$('checkpoint').hidden===false,'checkpoint opens');
  factory.failNextTransactions=2; // two failed transaction openings exhaust the single reconnect retry
  await $(action).fire('click');
  assert.equal($('checkpoint').hidden,false,'failed save leaves the checkpoint displayed');
  assert.equal((await getProfile(db)).run.stage,'checkpoint','disk state remains checkpoint');
  assert.equal((await getProfile(db)).run.floor,50,'disk floor does not advance');
  $('saveErrorDialog').close();
  await $(action).fire('click');
  const saved=await getProfile(db);
  if(action==='deeper'){
   assert.equal(saved.run.stage,'battle','the same continue button works on retry');
   assert.equal(saved.run.floor,51);
   assert.equal($('battle').hidden,false);
  }else{
   assert.equal(saved.run,null,'returning on retry finishes the run');
   assert.equal(saved.magicStones,1,'the return reward is committed exactly once');
   assert.equal($('returnShowcase').hidden,false);
  }
 }finally{env.restore();}
};
await checkCheckpoint('deeper');
await checkCheckpoint('returnHome');

const {factory,db}=await create('battle'),env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=closing-battle');
 await wait(()=>$('battle').hidden===false,'battle opens');
 const oldLog=$('battleLog').innerHTML;
 factory.failNextTransactions=2;
 const button={dataset:{cast:'-1'},disabled:false,closest(){return this;}};
 await env.document.click(button);
 await wait(()=>$('battleLog').innerHTML!==oldLog,'the combat log renders even after a save failure');
 assert.equal($('battleError').hidden,false,'save failure remains visible');
 assert.equal($('saveErrorDialog').open,true,'save failure dialog still opens');
}finally{env.restore();}
console.log('PASS checkpoint continue/return retries and combat renders through save failures');
