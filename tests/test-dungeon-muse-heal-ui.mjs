import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import * as G from '../assets/js/dungeon-core.mjs';

const csv=async key=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+key+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(
 ['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});
const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const wait=async (check,label)=>{
 const end=Date.now()+9000;
 while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(check(),label);
};
const hpShown=markup=>Number(String(markup).match(/battle-vital-label">HP (\d+)\//)?.[1]);
try{
 const db=await openStore(env.factory),profile=await getProfile(db);
 const spell={role:'support',attribute:'aqua',power:701};
 const circle={id:'muse-healing-429',image:new Blob(['heal'],{type:'image/jpeg'}),
  analysis:spell,registeredAt:1,revealed:true};
 profile.name='回復演出の再現';profile.level=102;profile.returns=1;
 profile.slots=[circle.id,null,null,null,null];
 const hero=G.makeUnit(profile.base,102,{},[spell,null,null,null,null],'player');
 assert.ok(hero.hp>429,'test hero has enough HP to simulate the reported 429 HP change');
 hero.hp-=429;
 const foe=G.makeUnit({hp:200,mag:8,def:8,res:8},70,{},[],'enemy');
 profile.run={floor:207,slotIds:[circle.id,null,null,null,null],
  hero,enemy:foe,enemyName:'演習の敵',carry:[],loot:[],xp:0,log:[],stage:'battle'};
 await saveProfile(db,profile);
 await putCircle(db,circle);
 const displays=[],labels=[];
 const health=$('heroStats'),fx=$('heroFxText');
 let html='',caption='';
 Object.defineProperty(health,'innerHTML',{get(){return html;},set(value){html=String(value);displays.push(hpShown(html));}});
 Object.defineProperty(fx,'textContent',{get(){return caption;},set(value){caption=String(value);if(caption.includes('回復 +'))labels.push({text:caption,frame:displays.length});}});
 await import('../assets/js/dungeon-app.mjs?integration=muse-heal-ui-429');
 await wait(()=>$('battle').hidden===false,'battle shown');
 const before=hpShown(health.innerHTML);
 assert.equal(before,hero.hp,'initial UI matches saved HP');
 assert.ok(G.canCast(hero,0),'support spell usable in the saved battle');
 const button={dataset:{cast:'0'},disabled:false,closest(){return this;}};
 await doc.click(button);
 await wait(()=>labels.length>0,'aqua healing FX was shown');
 const healedLabel=Number(labels[0].text.match(/\+(\d+)$/)?.[1]);
 const firstFrame=displays[labels[0].frame];
 assert.equal(healedLabel,firstFrame-before,
  'Muse #8: floating healing text equals the actual battle HP change at the healing phase');
 assert.equal(healedLabel,429,'the reported 429-point recovery must be labeled +429');
 console.log('PASS Muse #8 UI healing label and phase HP both report actual +429');
}finally{env.restore();}
