import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,collections]=await Promise.all(
 ['balance','levels','floors','player-base','collections'].map(csv));
configure({balance,levels,floors,playerBase});
const collectible=collections[0].id;
const button={disabled:false,dataset:{cast:'-1'},closest(){return this;}};
const wait=async predicate=>{
 for(let i=0;i<400;i++){
  if(predicate())return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('Timed out waiting for dungeon UI');
};

async function runFatalSaveTest({failFirst=false}={}){
 const env=fakeDungeonBrowser(),db=await openStore(env.factory);
 try{
  const profile=await getProfile(db);
  const spell={role:'attack',attribute:'flame',power:10};
  const circle={id:'permadeath-test-sigil',image:new Blob(['picture'],{type:'image/png'}),
   analysis:spell,revealed:true,basePower:10};
  profile.name='おてて';
  profile.level=119;
  profile.permadeath=true;
  profile.adventurerRank=60;
  profile.deepestReturnedLayer=60;
  profile.deepestReachedLayer=70;
  profile.collection={[collectible]:3};
  profile.slots=[circle.id,null,null,null,null];
  const hero=G.makeUnit(profile.base,profile.level,{},[spell,null,null,null,null],'player');
  hero.hp=1;
  const enemy=G.makeUnit({hp:200,mag:100,def:100,res:100},115,{},[],'foe_l070_fatal_regression');
  enemy.stats.hp=1000000;enemy.hp=1000000;
  profile.run={floor:348,slotIds:[circle.id,null,null,null,null],
   hero,enemy,enemyName:'背徳の聖騎士',carry:[],loot:[],xp:0,log:[],stage:'battle'};
  await saveProfile(db,profile);
  await putCircle(db,circle);

  const stage=env.document.getElementById('battleCeremony');
  let hidden=stage.hidden,observedFatal=false;
  Object.defineProperty(stage,'hidden',{get(){return hidden;},set(value){
   hidden=value;
   if(value!==false||stage.dataset.event!=='hero-death')return;
   observedFatal=true;
   const stored=env.factory.databases.get('magia-dungeon-v1').get('settings').get('profile');
   assert.equal(stored.awaitingHeir,true,'the next generation is committed before the death overlay');
   assert.equal(stored.run,null,'the dead expedition cannot be restored');
   assert.equal(stored.permadeathGeneration,1);
   assert.deepEqual(stored.collection,{[collectible]:3},'confirmed collection survives the death');
   assert.equal(stored.legacies.length,1);
   assert.equal(stored.legacies[0].circles[0].id,circle.id);
  }});

  await import('../assets/js/dungeon-app.mjs?integration=fatal-commit-'+(failFirst?'retry':'success'));
  await wait(()=>env.document.getElementById('startupMask').hidden===true);
  assert.equal((await getProfile(db)).run.hero.hp,1,'the combat snapshot starts before the fatal hit');
  if(failFirst){
   env.factory.failIntegrityWrites=true;
   await env.document.click(button);
   assert.equal(observedFatal,false,'no death overlay may play if the successor write fails');
   assert.notEqual((await getProfile(db)).awaitingHeir,true,'failed transaction preserves the living save');
   assert.equal((await getProfile(db)).run.hero.hp,1,'failed save does not commit a lethal turn');
   env.factory.failIntegrityWrites=false;
  }
  await env.document.click(button);
  assert.equal(observedFatal,true,'the committed fatal hit shows its death overlay');
  const stored=await getProfile(db);
  assert.equal(stored.level,1);
  assert.equal(stored.awaitingHeir,true);
  assert.deepEqual(stored.collection,{[collectible]:3});
  assert.equal(stored.legacies[0].enemyId,'foe_l070_fatal_regression');
  assert.equal(env.document.getElementById('nameDialog').open,true);
 }finally{
  env.factory.failIntegrityWrites=false;
  env.restore();
 }
}
await runFatalSaveTest();
await runFatalSaveTest({failFirst:true});
console.log('PASS fatal combat saves heir before death overlay; failed writes cannot finalize death, retries keep discoveries');
