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
window.matchMedia=()=>({matches:false});
const button=data=>({dataset:data,disabled:false,closest(){return this;}});
const wait=async(check,message)=>{
 const end=Date.now()+12000;
 while(!await check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,15));
 assert.ok(await check(),message);
};
try{
 const db=await openStore(browser.factory),profile=await getProfile(db);
 const row=enemies.find(x=>x.id==='foe_l028_1');
 assert.ok(row,'reported 28F real foe exists');
 const level=Number(row.min_level);
 const spells=[
  {role:'attack',attribute:'flame',power:681},
  {role:'attack',attribute:'flame',power:681},
  {role:'support',attribute:'aqua',power:681}
 ];
 const ids=spells.map((_,i)=>'repro-28f-'+i);
 profile.name='28層の再現';
 profile.level=level;profile.returns=1;profile.slots=[...ids,null,null];
 const hero=G.makeUnit(profile.base,level,{},[...spells,null,null],'player');
 const enemy=G.fromEnemy(row,level);
 // Isolate UI phase timing: the real foe, level, resistance and spells remain.
 // The extra HP only avoids automatic navigation during the pair of casts.
 enemy.stats.hp=Math.max(enemy.stats.hp,30000);
 enemy.hp=enemy.stats.hp;
 profile.run={floor:136,slotIds:[...ids,null,null],hero,enemy,enemyName:row.name,
  carry:Array(6).fill(null),loot:[],xp:0,log:[],stage:'battle',battleTurns:0};
 await saveProfile(db,profile);
 for(let i=0;i<ids.length;i++)await putCircle(db,{
  id:ids[i],name:'炎魔法'+i,registeredAt:i+1,
  image:new Blob(['repro-28f-'+i],{type:'image/png'}),
  basePower:681,analysis:spells[i],revealed:true
 });
 await import('../assets/js/dungeon-app.mjs?integration=v313-real-battle-click');
 await wait(()=>get('battle').hidden===false,'28F real foe displayed');
 assert.equal((await getProfile(db)).run.hero.statuses.length,0,'no dizziness before the reported 0-damage tap');
 const enemyHp=(await getProfile(db)).run.enemy.hp;
 const first=doc.click(button({cast:'0'}));
 await wait(()=>get('battleSpells').attributes['aria-busy']==='true','first attack is still animating');
 const second=doc.click(button({cast:'1'}));
 await Promise.all([first,second]);
 await wait(async()=>{const current=(await getProfile(db)).run;return current?.battleTurns===2;},
  'second flame tap during first FX must never disappear');
 const saved=(await getProfile(db)).run;
 assert.equal(saved.floor,136,'both actions stay in the same 28F encounter');
 assert.equal(saved.hero.statuses.some(x=>x.effect==='dizzy'),false,'no dizziness occurred');
 assert.equal(saved.battleTurns,2,'two distinct clicks created two combat turns');
 assert.ok(enemyHp-saved.enemy.hp>0,'unblocked flame damage is actually dealt');
 assert.ok(saved.hero.cooldowns[0]>=0&&saved.hero.cooldowns[1]>=0);
 console.log('PASS actual 28F flame button pressed during animation retains the second combat turn');
}finally{browser.restore();}
