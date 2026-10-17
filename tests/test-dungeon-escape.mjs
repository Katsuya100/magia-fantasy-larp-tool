import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const factory=fakeIndexedDB(),db=await openStore(factory),profile=await getProfile(db);
profile.name='脱出テスト';
profile.returns=1;
profile.inventory=[];
profile.deepestReturnedLayer=0;
profile.slots=['c1','c2','c3',null,null];
const attack={role:'attack',attribute:'flame',power:500};
for(let i=1;i<=3;i++){
 await putCircle(db,{id:'c'+i,image:new Blob(['image-'+i]),analysis:attack,revealed:true});
}
const hero=G.makeUnit(profile.base,1,{},[attack,attack,attack,null,null],'player');
const enemy=G.fromEnemy(enemies.find(x=>x.id==='foe_l002_1'),3);
profile.run={
 floor:6,slotIds:[...profile.slots],hero,enemy,enemyName:'敵',
 carry:[
  {type:'use',id:'escape_scroll',value:0,bonus:null,instanceId:'scroll-1'},
  {type:'use',id:'heal_s',value:30,bonus:null,instanceId:'heal-1'},
  null,null,null
 ],
 loot:[
  {type:'use',id:'mana_s',value:18,bonus:null},
  {type:'stone',id:'magic_stone'},
  {type:'collection',id:'relic_boss_001'}
 ],
 xp:G.nextXp(1)+5,usedItems:0,log:[],stage:'battle'
};
await saveProfile(db,profile);
const env=fakeDungeonBrowser({factory}),doc=env.document,$=id=>doc.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=escape-scroll');
 const end=Date.now()+9000;
 while(!$('battleItems').innerHTML.includes('脱出の巻物')&&Date.now()<end)await new Promise(r=>setTimeout(r,25));
 assert.match($('battleItems').innerHTML,/脱出の巻物/);
 assert.match($('battleItems').innerHTML,/経験値・戦利品を持ち帰って脱出/);
 await doc.click({disabled:false,dataset:{use:'0'},closest(){return this;}});
 const saved=await getProfile(db);
 assert.equal(saved.run,null,'scroll exits immediately from battle');
 assert.equal(saved.returns,2,'escape counts as a successful return');
 assert.equal(saved.level,2,'pending battle XP is applied');
 assert.equal(saved.xp,5,'surplus XP is retained');
 assert.equal(saved.deepestReturnedLayer,1,'only the last completed boss counts toward returned depth');
 assert.deepEqual(saved.inventory.map(x=>x.id).sort(),['heal_s','mana_s'],'unused supplies and acquired consumables return, scroll is spent');
 assert.equal(saved.magicStones,1,'undelivered magic stone is banked');
 assert.equal(saved.collection.relic_boss_001,1,'undelivered relic is banked');
 assert.equal($('result').hidden,false,'escape displays the return result');
 assert.match($('resultTitle').textContent,/脱出成功/);
 assert.match($('resultText').textContent,/経験値/);
 assert.equal($('tab-dungeon').hidden,true);
 console.log('PASS escape scroll ends battle, preserves pending XP and all loot, consumes scroll and records completed depth');
}finally{
 env.restore();
}
