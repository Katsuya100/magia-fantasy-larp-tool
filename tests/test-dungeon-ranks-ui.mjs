import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const wait=async(check,description)=>{const end=Date.now()+9000;while(!(await check())&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.ok(await check(),description);};
const btn=data=>({dataset:data,disabled:false,closest(){return this;}});
const attack={role:'attack',attribute:'flame',power:5000};
const originalRandom=Math.random;
try{
 // Start from the tenth-layer boss, so the badge is earned through actual UI combat.
 const factory=fakeIndexedDB(),db=await openStore(factory),p=await getProfile(db);
 p.name='階級試験';p.returns=1;p.level=30;p.slots=['c1','c2','c3',null,null];
 for(let i=1;i<=3;i++)await putCircle(db,{id:'c'+i,image:new Blob(['badge-photo']),analysis:attack,revealed:true});
 const hero=G.makeUnit(p.base,p.level,{},[attack,attack,attack,null,null],'player');
 const enemy=G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19);
 enemy.hp=1;enemy.spells=[];enemy.stats.mag=0;
 p.run={floor:50,slotIds:[...p.slots],hero,enemy,enemyName:'十層ボス',
  carry:[null,null,null,null,null],loot:[],xp:15,usedItems:0,log:[],stage:'battle'};
 await saveProfile(db,p);
 const env=fakeDungeonBrowser({factory}),doc=env.document,$=id=>doc.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=rank-award');
  await wait(()=>$('battle').hidden===false,'saved boss battle resumes');
  assert.equal($('startLayer').value,'1','default route is always first layer');
  await doc.click(btn({cast:'-1'}));
  await wait(async()=> (await getProfile(db)).run?.stage==='checkpoint','boss defeated');
  let saved=await getProfile(db);
  assert.equal(saved.adventurerRank,0,'badge is pending until returning');
  assert.ok(saved.run.loot.some(item=>item.type==='rank'&&item.layer===10),'badge appears as a loot drop');
  assert.match($('checkpointInfo').textContent,/鉛級冒険者章を発見/);
  assert.ok(!saved.run.loot.some(item=>item.type==='collection'&&item.id?.includes('adventurer')),'badge is not a collectible');
  const expectedCollections=saved.run.loot.filter(item=>item.type==='collection').length;
  await $('bonus-restore').fire('click');
  await $('returnHome').fire('click');
  saved=await getProfile(db);
  assert.equal(saved.adventurerRank,10,'rank is saved on successful return');
  assert.equal(saved.run,null);
  assert.equal(Object.values(saved.collection).reduce((n,x)=>n+x,0),
   expectedCollections,'rank badge never appears in the collection ledger');
  assert.ok(!saved.inventory.some(item=>item.type==='rank'),'badge is not an inventory item');
  assert.match($('resultText').textContent,/鉛級冒険者章を獲得/);
  await doc.click(btn({view:'home'}));
  assert.match($('playerStats').innerHTML,/冒険者等級：<strong>鉛級<\/strong>/);
  assert.match($('playerStats').innerHTML,/取得済み冒険者章：鉛級/);
  await doc.click(btn({view:'prepare'}));
  assert.match($('startLayer').innerHTML,/value="1">1層から<\/option>/,'dynamic first-floor label is concise');
  assert.match($('startLayer').innerHTML,/value="11">11層から（鉛級）<\/option>/,'鉛級の短縮表示に「初戦」は含めない');
  assert.doesNotMatch($('startLayer').innerHTML,/value="21"/);
  $('startLayer').value='11';await $('startLayer').fire('change');
  await $('startAttack').fire('click');
  saved=await getProfile(db);
  assert.equal(saved.run.floor,51,'鉛級 shortcuts to layer 11 first encounter');
  assert.equal($('floorLabel').textContent,'11層1戦目');
 }finally{env.restore();}
 // Starting higher must not manufacture lower collection entries.
 const factory2=fakeIndexedDB(),db2=await openStore(factory2),p2=await getProfile(db2);
 p2.name='金級試験';p2.returns=1;p2.adventurerRank=60;
 p2.slots=['gold1','gold2','gold3',null,null];
 for(let i=1;i<=3;i++)await putCircle(db2,{id:'gold'+i,image:new Blob(['gold-photo']),analysis:attack,revealed:true});
 await saveProfile(db2,p2);
 const env2=fakeDungeonBrowser({factory:factory2}),$2=id=>env2.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=rank-gold');
  await wait(()=>$2('playerStats').innerHTML.includes('金級'),'higher rank renders');
  assert.deepEqual([...$2('startLayer').innerHTML.matchAll(/value="(\d+)"/g)].map(x=>Number(x[1])),
   [1,11,21,31,41,51,61],'gold auto-unlocks all lower entry floors');
  assert.deepEqual([... $2('startLayer').innerHTML.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)]
   .map(([,layer,label])=>[Number(layer),label]),[
    [1,'1層から'],[11,'11層から（鉛級）'],[21,'21層から（鉄級）'],
    [31,'31層から（鋼級）'],[41,'41層から（銅級）'],
    [51,'51層から（銀級）'],[61,'61層から（金級）']
   ],'all unlocked shortcut labels use 層から without 初戦');
  assert.match($2('playerStats').innerHTML,/鉛級・鉄級・鋼級・銅級・銀級・金級/);
  assert.doesNotMatch($2('collectionGrid').innerHTML,/冒険者章/);
  $2('startLayer').value='41';await $2('startLayer').fire('change');
  await $2('startAttack').fire('click');
  const next=await getProfile(db2);
  assert.equal(next.run.floor,201,'41層 enters at the first fight');
  assert.equal($2('floorLabel').textContent,'41層1戦目');
  assert.deepEqual(next.collection,{},'no badge is stored in the collection');
 }finally{env2.restore();}
 // Post-victory MP recovery must not retroactively qualify a low-MP win.
 const factory3=fakeIndexedDB(),db3=await openStore(factory3),p3=await getProfile(db3);
 p3.name='魔力不足';p3.returns=1;p3.level=30;p3.slots=['x1','x2','x3',null,null];
 for(let i=1;i<=3;i++)await putCircle(db3,{id:'x'+i,image:new Blob(['photo']),analysis:attack,revealed:true});
 const lowHero=G.makeUnit(p3.base,p3.level,{},[attack,attack,attack,null,null],'player');
 lowHero.mp=Math.floor(lowHero.maxMp*.79);
 const boss=G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19);boss.hp=1;boss.spells=[];boss.stats.mag=0;
 p3.run={floor:50,slotIds:[...p3.slots],hero:lowHero,enemy:boss,enemyName:'十層ボス',
  carry:[null,null,null,null,null],loot:[],xp:0,usedItems:0,log:[],stage:'battle'};
 await saveProfile(db3,p3);
 const env3=fakeDungeonBrowser({factory:factory3});
 try{
  await import('../assets/js/dungeon-app.mjs?integration=rank-low-mp');
  await wait(()=>env3.document.getElementById('battle').hidden===false,'low MP battle resumes');
  await env3.document.click(btn({cast:'-1'}));
  const end=await getProfile(db3);
  assert.equal(end.run.stage,'checkpoint');
  assert.equal(end.run.loot.some(x=>x.type==='rank'),false,'MP below 80% cannot award a badge even with post-win recovery');
 }finally{env3.restore();}
 console.log('PASS milestone badge drop, return save, profile, selectable shortcuts, higher-rank inheritance and low-MP check');
}finally{Math.random=originalRandom;}
