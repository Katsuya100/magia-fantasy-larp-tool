import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [relics,enemies]=await Promise.all([csv('collections'),csv('enemies')]);
const [relicA,relicB,relicC]=relics.slice(0,3);
const item=(id,index,value=20)=>({id,value,instanceId:'muse25-item-'+index});
const clickButton=dataset=>({dataset,disabled:false,closest(){return this;}});
const wait=async(check,label)=>{
 const end=Date.now()+9000;
 while(!(await check())&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(await check(),label);
};
const buttonMarkup=(html,id)=>html.match(new RegExp('<button[^>]+data-alchemy="'+id+'"[^>]*>[^<]*<\\/button>'))?.[0]||'';

async function makeSave(env){
 const db=await openStore(env.factory),profile=await getProfile(db);
 profile.name='Muse錬金検証';
 profile.returns=1;
 profile.initialCircleChoiceDone=true;
 profile.tutorialDone=true;
 profile.collection={[relicA.id]:2,[relicB.id]:2,[relicC.id]:2};
 profile.inventory=[
  ...Array.from({length:5},(_,i)=>item('heal_s',i)),
  ...Array.from({length:5},(_,i)=>item('clear_flame',i+5,0)),
  item('mana_s',10)
 ];
 await saveProfile(db,profile);
 return {db,profile};
}

// Stored, non-expedition state: a regular recipe, a non-recipe fallback,
// collection exhaustion and the remaining-item shortage all use real UI actions.
{
 const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
 try{
  const {db}=await makeSave(env);
  await import('../assets/js/dungeon-app.mjs?integration=muse25-alchemy-normal');
  await wait(()=>$('playerStats').innerHTML.includes('Muse錬金検証'),'loaded saved character');
  await doc.click(clickButton({view:'collection'}));

  assert.match(buttonMarkup($('collectionGrid').innerHTML,relicA.id),/>錬金<\\/button>/);
  await doc.click(clickButton({alchemy:relicA.id}));
  assert.equal($('alchemyDialog').open,true,'two copies of the saved relic open alchemy');
  assert.equal($('alchemyCraft').disabled,true,'no ingredients are initially selected');
  assert.match($('alchemyError').textContent,/5個選択/,'disabled craft explains the required material count');

  await doc.click(clickButton({openAlchemyItem:'0'}));
  assert.equal($('alchemyPickerDialog').open,true,'the actual item picker opens');
  await doc.click(clickButton({chooseAlchemyItem:'0'}));
  assert.equal($('alchemyPickerDialog').open,false);
  assert.equal($('alchemyCraft').disabled,true,'one ingredient alone cannot craft');
  $('alchemyAutoKind').value='all';
  $('alchemyAutoPriority').value='default';
  await $('alchemyAutoPick').fire('click');
  assert.equal($('alchemyCraft').disabled,false,'five saved instances enable craft');
  assert.equal($('alchemyError').textContent,'');
  await $('alchemyCraft').fire('click');
  assert.equal($('alchemyReveal').hidden,false);
  assert.equal($('alchemyCreatedName').textContent,'ヒールポーション小');
  let saved=await getProfile(db);
  assert.equal(saved.collection[relicA.id],1,'consumes exactly one duplicate');
  assert.equal(saved.inventory.length,7,'consumes exactly five material instances and yields one');
  assert.equal(saved.inventory.at(-1).id,'heal_s');

  await $('alchemyRevealDone').fire('click');
  assert.match(buttonMarkup($('collectionGrid').innerHTML,relicA.id),/disabled/);
  assert.match(buttonMarkup($('collectionGrid').innerHTML,relicA.id),/>あと1個<\\/button>/);
  await doc.click(clickButton({alchemy:relicA.id}));
  assert.equal($('alchemyDialog').open,false,'a single remaining relic cannot reopen the dialog');

  await doc.click(clickButton({alchemy:relicB.id}));
  assert.equal($('alchemyDialog').open,true);
  $('alchemyAutoKind').value='all';
  $('alchemyAutoPriority').value='default';
  await $('alchemyAutoPick').fire('click');
  assert.equal($('alchemyCraft').disabled,false,
   'an unmatched five-item combination is eligible, never recipe-gated');
  await $('alchemyCraft').fire('click');
  assert.equal($('alchemyCreatedName').textContent,'脱出の巻物');
  saved=await getProfile(db);
  assert.equal(saved.inventory.at(-1).id,'escape_scroll');
  assert.equal(saved.collection[relicB.id],1);
  assert.equal(saved.inventory.length,3);

  await $('alchemyRevealDone').fire('click');
  await doc.click(clickButton({alchemy:relicC.id}));
  assert.equal($('alchemyDialog').open,true,'material shortage does not silently block opening');
  assert.equal($('alchemyCraft').disabled,true);
  assert.match($('alchemyError').textContent,/携行品が5個必要/);
  assert.equal((await getProfile(db)).collection[relicC.id],2,'shortage consumes nothing');
 }finally{env.restore();}
}

// A still-active saved expedition blocks the entry button and the open handler.
{
 const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
 try{
  const {db,profile}=await makeSave(env);
  const enemy=enemies.find(row=>row.id.startsWith('foe_l001_'))||enemies[0];
  profile.run={
   floor:1,stage:'battle',slotIds:Array(5).fill(null),
   hero:G.makeUnit(profile.base,1,{},Array(5).fill(null),'player'),
   enemy:G.fromEnemy(enemy,1),enemyName:enemy.name,
   carry:[],loot:[],xp:0,log:[]
  };
  await saveProfile(db,profile);
  await import('../assets/js/dungeon-app.mjs?integration=muse25-alchemy-exploring');
  await wait(()=>$('playerStats').innerHTML.includes('Muse錬金検証'),'active expedition loaded');
  assert.match(buttonMarkup($('collectionGrid').innerHTML,relicA.id),/disabled/);
  assert.match(buttonMarkup($('collectionGrid').innerHTML,relicA.id),/>探索中<\\/button>/);
  await doc.click(clickButton({alchemy:relicA.id}));
  assert.equal($('alchemyDialog').open,false,'entry cannot bypass the saved expedition guard');
  assert.equal((await getProfile(db)).collection[relicA.id],2);
 }finally{env.restore();}
}
console.log('PASS Muse #25 alchemy stored-save UI: recipe, fallback, shortages, exploration');
