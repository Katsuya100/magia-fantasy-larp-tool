import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import {adventurerShareData} from '../assets/js/dungeon-share.mjs';
import {deepestReachedLayer,deepestReturnedLayer} from '../assets/js/dungeon-progress.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async file=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+file+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const greeting=html.match(/<dialog id="creatorCongratulationsDialog"([\s\S]*?)<\/dialog>/)?.[1]||'';
assert.ok(greeting,'a unique 100F author greeting dialog exists');
assert.match(greeting,/id="creatorCongratulationsTitle">製作者より/);
assert.match(greeting,/100層突破おめでとうございます。\s*ここまで楽しんでいただきありがとうございました。\s*しかし、冒険はまだまだ続きます。\s*引き続きダンジョンアタックをお楽しみください。/);
assert.match(greeting,/id="creatorCongratulationsClose"[^>]*>閉じる<\/button>/);
assert.doesNotMatch(greeting,/シェア|応援|href=/,'the creator greeting has no promotional action');
assert.match(css,/\.creator-congratulations-dialog\{/,'distinct golden dialog style exists');
assert.match(css,/\.creator-congratulations-crest\{/,'special 100F emblem is styled');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*\.creator-congratulations-stars/,'motion preferences are respected');
const wait=async(fn,label)=>{
 const deadline=Date.now()+9000;
 while(!(await fn())&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(await fn(),label);
};
const attack={role:'attack',attribute:'flame',power:5000};
const slots=['c1','c2','c3',null,null];
async function fixture({defeated=false,atCheckpoint=false,pending=false}={}){
 const factory=fakeIndexedDB(),db=await openStore(factory),p=await getProfile(db);
 p.name='百層の勇者';p.tutorialDone=true;p.level=150;p.returns=1;p.slots=[...slots];
 p.adventurerRank=90;p.defeatedBosses=defeated?{boss_l100:true}:{};
 for(let i=1;i<=3;i++)await putCircle(db,{id:'c'+i,image:new Blob(['hero-photo']),analysis:attack,revealed:true});
 const hero=G.makeUnit(p.base,p.level,{},[attack,attack,attack,null,null],'player');
 hero.mp=0; // No rank badge; the crown must only depend on first defeating the boss.
 const boss=G.fromEnemy(enemies.find(e=>e.id==='boss_l100'),150);
 boss.hp=1;boss.spells=[];boss.stats.mag=0;
 p.run={floor:500,slotIds:[...slots],hero,enemy:boss,enemyName:'永劫の大魔王',
  carry:[null,null,null,null,null],loot:[],xp:0,log:[],stage:atCheckpoint?'checkpoint':'battle',
  ...(atCheckpoint?{lastMilestoneChoiceLayer:100,creatorCongratulationsPending:pending}:{})};
 await saveProfile(db,p);
 return {factory,db};
}
const btn=data=>({dataset:data,disabled:false,closest(){return this;}});

// Real UI combat must open the greeting on top of the checkpoint, BEFORE sharing.
{
 const {factory,db}=await fixture();
 const env=fakeDungeonBrowser({factory}),doc=env.document,$=id=>doc.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=creator-100-first-clear');
  await wait(()=>$('battle').hidden===false,'100F boss loads');
  assert.ok(!$('heroName').textContent.includes('👑'),'no premature crown');
  await doc.click(btn({cast:'-1'}));
  await wait(()=>$('creatorCongratulationsDialog').open,'first 100F clear opens greeting');
  assert.equal($('checkpoint').hidden,false,'checkpoint is visible beneath the greeting');
  assert.equal($('milestoneChoiceDialog').open,false,'share prompt waits for author greeting');
  assert.match($('heroName').textContent,/百層の勇者 👑/,'battle name gets the 100F crown immediately');
  let saved=await getProfile(db);
  assert.equal(saved.defeatedBosses.boss_l100,true,'crown is earned by defeating the boss');
  assert.equal(saved.run.creatorCongratulationsPending,true,'greeting survives a reload');
  assert.ok(!saved.run.loot.some(x=>x.type==='rank'&&x.layer===100),'low MP does not grant the rank');
  assert.equal(deepestReachedLayer(saved),100);
  assert.equal(deepestReturnedLayer(saved),0,'not yet returned');

  await $('creatorCongratulationsClose').fire('click');
  await wait(()=>$('milestoneChoiceDialog').open,'sharing follows the greeting');
  assert.equal($('creatorCongratulationsDialog').open,false);
  saved=await getProfile(db);
  assert.equal(saved.run.creatorCongratulationsPending,false,'acknowledgment is persisted');
  assert.equal($('milestoneChoiceTitle').textContent,'100層のボス撃破！');
  await $('milestoneShare').fire('click');
  assert.equal($('supportPromptDialog').open,true,'user can open the existing share flow');
  await $('supportPromptClose').fire('click');
  await $('bonus-restore').fire('click');
  await $('deeper').fire('click');
  saved=await getProfile(db);
  assert.equal(saved.run.floor,501,'101F remains playable');
  assert.equal(saved.deepestReachedLayer,101,'entering the next floor increments arrival');
  assert.equal(saved.deepestReturnedLayer,0,'entry does not credit a safe return');
  assert.equal(saved.run.enemy.level,151,'101F enemy scaling is preserved');
  assert.equal(adventurerShareData(saved).crowned,true,'card inherits the boss crown');
  assert.equal(adventurerShareData(saved).deepestReached,101,'card shows deepest arrival');
  assert.equal(adventurerShareData(saved).deepestReturned,0,'card separately shows safe returns');
  assert.match($('heroName').textContent,/百層の勇者 👑/,'crown remains in the 101F dungeon');
  await doc.click(btn({view:'home'}));
  assert.match($('playerStats').innerHTML,/百層の勇者<span class="hundred-floor-crown"/);
  assert.match($('playerStats').innerHTML,/最深到達階層：<strong>101層<\/strong>/);
  assert.match($('playerStats').innerHTML,/最深帰還階層：<strong>-<\/strong>/);
 }finally{env.restore();}
}

// An interrupted checkpoint displays the unacknowledged greeting on reload.
{
 const {factory,db}=await fixture({defeated:true,atCheckpoint:true,pending:true});
 const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=creator-100-saved-checkpoint');
  await wait(()=>$('creatorCongratulationsDialog').open,'pending greeting resumes');
  assert.equal($('checkpoint').hidden,false);
  assert.equal($('milestoneChoiceDialog').open,false);
  await $('creatorCongratulationsClose').fire('click');
  await wait(()=>$('milestoneChoiceDialog').open,'share follows recovered greeting');
  assert.equal((await getProfile(db)).run.creatorCongratulationsPending,false);
 }finally{env.restore();}
 const env2=fakeDungeonBrowser({factory}),el=id=>env2.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=creator-100-acknowledged-checkpoint');
  await wait(() => el('checkpoint').hidden===false,'acknowledged checkpoint reloads');
  assert.equal(el('creatorCongratulationsDialog').open,false,'no repeated creator dialog');
  assert.equal(el('milestoneChoiceDialog').open,false,'no repeated promotional dialog');
 }finally{env2.restore();}
}

// Clearing the 100F boss again does not reissue a first-clear celebration.
{
 const {factory,db}=await fixture({defeated:true});
 const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=creator-100-repeat-boss');
  await wait(()=>$('battle').hidden===false,'repeat boss loads');
  await env.document.click(btn({cast:'-1'}));
  await wait(()=>$('milestoneChoiceDialog').open,'normal milestone sharing remains');
  assert.equal($('creatorCongratulationsDialog').open,false,'first-clear greeting is not repeated');
  assert.equal((await getProfile(db)).run.creatorCongratulationsPending,undefined);
 }finally{env.restore();}
}
console.log('PASS 100F luxurious greeting, first-clear crown, share order, reload safety and separate depths');
