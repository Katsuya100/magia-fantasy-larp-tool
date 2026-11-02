import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(
 ['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const browser=fakeDungeonBrowser(),doc=browser.document,get=id=>doc.getElementById(id);
const button=data=>({dataset:data,disabled:false,closest(){return this;}});
const wait=async(check,message,timeout=12000)=>{
 const limit=Date.now()+timeout;
 while(!await check()&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,15));
 assert.ok(await check(),message);
};
try{
 const db=await openStore(browser.factory),profile=await getProfile(db);
 const spellData=[
  {role:'defense',attribute:'aqua',power:681},
  {role:'support',attribute:'aqua',power:681},
  {role:'attack',attribute:'flame',power:681}
 ];
 const ids=spellData.map((_,i)=>'ui-runtime-'+i);
 profile.name='戦闘UI再現';
 profile.level=120;profile.returns=1;profile.slots=[...ids,null,null];
 const enemy=G.fromEnemy(enemies.find(row=>row.id==='boss_l049'),86);
 // Keep real enemy growth and affinities; a deterministic guard action avoids
 // random injury and isolates UI event timing from enemy spell selection.
 enemy.spells=[{role:'defense',attribute:'law',power:120}];
 enemy.cooldowns=[0];
 const hero=G.makeUnit(profile.base,profile.level,{},[...spellData,null,null],'player');
 hero.hp=Math.max(1,Math.round(hero.hp*.8));
 profile.run={floor:245,slotIds:[...ids,null,null],hero,enemy,enemyName:'49層ボス',
  carry:Array(6).fill(null),loot:[],xp:0,log:[],stage:'battle',battleTurns:0};
 await saveProfile(db,profile);
 for(let i=0;i<ids.length;i++)await putCircle(db,{
  id:ids[i],name:'UI検証'+i,registeredAt:i+1,
  image:new Blob(['runtime-'+i],{type:'image/jpeg'}),analysis:spellData[i],revealed:true
 });
 const app=await import('../assets/js/dungeon-app.mjs?integration=v313-combat-ui-runtime');
 await wait(()=>get('battle').hidden===false,'existing 49F encounter renders');
 // A real non-reduced-motion phase makes the first click genuinely asynchronous.
 window.matchMedia=()=>({matches:false});
 const first=doc.click(button({cast:'0'}));
 await Promise.resolve();
 const second=doc.click(button({cast:'1'}));
 await first;
 await second;
 await wait(async()=>(await getProfile(db)).run?.battleTurns===2,
  'a healing click during the first defense animation must become the next turn');
 const afterDouble=await getProfile(db);
 assert.equal(afterDouble.run.stage,'battle');
 assert.equal(afterDouble.run.battleTurns,2,'one buffered tap results in exactly one extra turn');
 assert.ok(afterDouble.run.hero.cooldowns.length>=3);
 // An ordinary attack against a weak foe should briefly show WEAK, and the
 // death ceremony must start with all fighter affinity state reset.
 afterDouble.run.enemy.hp=1;
 afterDouble.run.enemy.resists.flame=1.5;
 afterDouble.run.enemy.cooldowns=[0];
 afterDouble.run.hero.cooldowns[2]=0;
 await saveProfile(db,afterDouble);
 await app.refreshDungeonViewFromBackup();
 const finishing=doc.click(button({cast:'2'}));
 await wait(()=>get('battleCeremony').dataset.event==='enemy-death',
  'a fatal flame attack enters the real death ceremony');
 assert.equal(get('enemyCombatant').dataset.affinity,'none',
  'WEAK cannot remain on the dying enemy when the ceremony begins');
 assert.equal(get('heroCombatant').dataset.affinity,'none',
  'no previous resistance effect can remain on the surviving player');
 await finishing;
 const saved=await getProfile(db);
 assert.equal(saved.run?.stage,'checkpoint','the 49F boss victory enters the checkpoint');
 const mpBefore=saved.run.hero.mp,cooldowns=[...saved.run.hero.cooldowns],hpBefore=saved.run.hero.hp;
 await doc.click(button({cast:'1'}));
 const noExtra=await getProfile(db);
 assert.equal(noExtra.run.stage,'checkpoint');
 assert.equal(noExtra.run.hero.mp,mpBefore,'post-victory support cannot consume MP');
 assert.equal(noExtra.run.hero.hp,hpBefore,'post-victory support cannot change HP');
 assert.deepEqual(noExtra.run.hero.cooldowns,cooldowns,'post-victory support cannot start cooldown');
 console.log('PASS real UI early buffered heal, fatal WEAK cleanup and postvictory cast guard');
}finally{browser.restore();}
