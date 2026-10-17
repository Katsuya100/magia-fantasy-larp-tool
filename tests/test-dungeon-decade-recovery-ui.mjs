import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(
 ['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const wait=async(check,label)=>{
 const end=Date.now()+9000;
 while(!(await check())&&Date.now()<end)await new Promise(r=>setTimeout(r,25));
 assert.ok(await check(),label);
};
const btn=data=>({dataset:data,disabled:false,closest(){return this;}});
const attack={role:'attack',attribute:'flame',power:5000};
const spells=[attack,attack,attack,null,null];
const createFixture=async name=>{
 const factory=fakeIndexedDB(),db=await openStore(factory),profile=await getProfile(db);
 profile.name=name;profile.returns=1;profile.level=30;
 profile.slots=['c1','c2','c3',null,null];
 for(let i=1;i<=3;i++){
  await putCircle(db,{id:'c'+i,image:new Blob(['recovery-image']),analysis:attack,revealed:true});
 }
 return {factory,db,profile};
};
const spellReady=markup=>{
 const first=markup.match(/<button[^>]*data-cast="0"[^>]*>/)?.[0];
 return Boolean(first&&!first.includes('disabled')&&!first.includes('unavailable'));
};
const originalRandom=Math.random;
Math.random=()=>.5;
try{
 // The actual 10-layer checkpoint choice restores both resources to full,
 // and the next fight must allow normal magic.
 const {factory,db,profile}=await createFixture('十層全回復');
 const hero=G.makeUnit(profile.base,profile.level,{},spells,'player');
 hero.hp=1;hero.mp=0;
 const boss=G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19);
 profile.run={
  floor:50,slotIds:[...profile.slots],hero,enemy:boss,enemyName:'十層ボス',
  carry:[null,null,null,null,null],loot:[],xp:0,usedItems:0,
  bonusClaimed:false,log:[],stage:'checkpoint'
 };
 await saveProfile(db,profile);
 const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=decade-restoration');
  await wait(()=>$('checkpoint').hidden===false,'10-layer checkpoint loaded');
  await $('bonus-restore').fire('click');
  let saved=await getProfile(db);
  assert.equal(saved.run.hero.hp,saved.run.hero.stats.hp,'HP becomes full');
  assert.equal(saved.run.hero.mp,saved.run.hero.maxMp,'MP becomes full, never undefined');
  assert.ok(G.canCast(saved.run.hero,0),'magic can be cast after the restore choice');
  assert.equal(saved.run.bonusClaimed,true,'the bonus cannot be selected twice');
  await $('deeper').fire('click');
  saved=await getProfile(db);
  assert.equal(saved.run.floor,51,'the next fight begins at layer 11');
  assert.equal(saved.run.hero.mp,saved.run.hero.maxMp,'maximum MP carries into the next fight');
  assert.ok(spellReady($('battleSpells').innerHTML),'first magic circle is no longer greyed out');
  assert.equal(G.canCast(saved.run.hero,1),true,'other equipped spells also remain castable');
  await env.document.click(btn({cast:'0'}));
  saved=await getProfile(db);
  assert.ok(saved.run,'casting magic does not fail or abort the expedition');
  assert.ok(saved.run.hero.mp<saved.run.hero.maxMp,'casting costs MP normally');
 }finally{env.restore();}

 // Existing players may already have a saved undefined/NaN MP from the faulty choice.
 // On app startup, restore only invalid MP; never overwrite a legitimate zero.
 const {factory:oldFactory,db:oldDb,profile:oldProfile}=await createFixture('既存探索の修復');
 const oldHero=G.makeUnit(oldProfile.base,oldProfile.level,{},spells,'player');
 oldHero.hp=Math.floor(oldHero.stats.hp/2);oldHero.mp=undefined;
 const foe=G.fromEnemy(enemies.find(x=>x.id==='foe_l011_1'),23);
 oldProfile.run={
  floor:51,slotIds:[...oldProfile.slots],hero:oldHero,enemy:foe,enemyName:'十一層の敵',
  carry:[null,null,null,null,null],loot:[],xp:0,usedItems:0,
  bonusClaimed:false,log:[],stage:'battle'
 };
 await saveProfile(oldDb,oldProfile);
 const oldEnv=fakeDungeonBrowser({factory:oldFactory}),el=id=>oldEnv.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=decade-saved-mp-repair');
  await wait(() => el('battle').hidden===false,'previously corrupted battle loaded');
  const fixed=await getProfile(oldDb);
  assert.equal(fixed.run.hero.mp,fixed.run.hero.maxMp,'saved invalid MP is repaired on reload');
  assert.equal(fixed.run.hero.hp,oldHero.hp,'fix does not refill unrelated HP');
  assert.ok(spellReady(el('battleSpells').innerHTML),'saved battle can use magic immediately');
  await oldEnv.document.click(btn({cast:'0'}));
  assert.ok((await getProfile(oldDb)).run,'previously broken expedition can continue');
 }finally{oldEnv.restore();}
 const legitimateEmpty=G.makeUnit(oldProfile.base,30,{},spells);
 legitimateEmpty.mp=0;
 assert.equal(G.repairInvalidMp(legitimateEmpty),false,'valid zero MP must stay zero');
 assert.equal(legitimateEmpty.mp,0);
 assert.equal(G.repairInvalidMp({mp:NaN,maxMp:120}),true,'non-finite MP can be repaired');
 assert.equal(G.repairInvalidMp({mp:undefined,maxMp:undefined}),false,'never repair without a valid MP limit');
 console.log('PASS 10-layer HP/MP bonus, next-fight spell availability, legacy save recovery, and legitimate empty MP');
}finally{Math.random=originalRandom;}
