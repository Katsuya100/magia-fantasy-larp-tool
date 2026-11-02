import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,putCircle,allCircles,readDungeonSnapshot,replaceDungeonSnapshot} from '../assets/js/dungeon-store.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';

const csv=async key=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+key+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});
const factory=fakeIndexedDB(),db=await openStore(factory);
const before=await getProfile(db);
before.name='以前の冒険者';
before.magicStones=100;
before.slots=['previous-circle',null,null,null,null];
await saveProfile(db,before);
await putCircle(db,{id:'previous-circle',name:'前の魔法陣',registeredAt:1,
 image:new Blob(['older-save'],{type:'image/png'}),
 analysis:{role:'attack',attribute:'flame',power:681},basePower:681,revealed:true});
const browser=fakeDungeonBrowser({factory}),doc=browser.document,get=id=>doc.getElementById(id);
const btn=data=>({dataset:data,disabled:false,closest(){return this;}});
const wait=async(check,message)=>{
 const end=Date.now()+10000;
 while(!await check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,15));
 assert.ok(await check(),message);
};
try{
 const app=await import('../assets/js/dungeon-app.mjs?integration=v313-stale-ui-repro');
 await wait(()=>get('startupMask').hidden===true,'the previously saved game opens');
 // Real user opens both picker and an upgrade confirmation on the former save.
 await doc.click(btn({openSlot:'0'}));
 assert.equal(get('loadoutDialog').open,true);
 await doc.click(btn({upgrade:'previous-circle'}));
 assert.equal(get('circleActionDialog').open,true,'old account has a pending 681-power upgrade');

 const remoteDb=await openStore(fakeIndexedDB()),remote=await getProfile(remoteDb);
 remote.name='復元した冒険者';
 remote.level=8;remote.magicStones=20;
 remote.slots=['restored-circle',null,null,null,null];
 await saveProfile(remoteDb,remote);
 await putCircle(remoteDb,{id:'restored-circle',name:'本当に所持する魔法陣',registeredAt:2,
  image:new Blob(['restored-save'],{type:'image/png'}),
  analysis:{role:'attack',attribute:'aqua',power:255},basePower:255,revealed:true});
 const backup=deserializeDungeonSnapshot(await serializeDungeonSnapshot(await readDungeonSnapshot(remoteDb)));
 await replaceDungeonSnapshot(db,backup);
 await app.refreshDungeonViewFromBackup();
 const defects=[];
 try{
  assert.equal(get('circleActionDialog').open,false,
   'restoring a different owner must close the old account upgrade dialog');
 }catch(error){defects.push('#16 stale upgrade dialog: '+error.message);}
 try{
  await get('clearLoadoutSlot').fire('click');
  await wait(async()=>true,'click returns');
  const saved=await getProfile(db);
  assert.equal(saved.slots[0],'restored-circle',
   'old closed picker must not clear the newly restored owner\'s equipped spell');
 }catch(error){defects.push('#17 stale picker click: '+error.message);}
 try{
  assert.deepEqual((await allCircles(db)).map(circle=>circle.id),['restored-circle']);
  assert.doesNotMatch(get('libraryCards').innerHTML,/previous-circle/,
   'unowned circle must not be displayed in the current grimoire');
  await doc.click(btn({upgrade:'previous-circle'}));
  assert.equal(get('circleActionDialog').open,false,
   'clicks referencing a deleted unowned circle cannot reopen the upgrade dialog');
  assert.equal((await getProfile(db)).magicStones,20,
   'an unowned circle cannot spend the restored account magic stones');
  assert.equal((await allCircles(db)).length,1);
  await doc.click(btn({openSlot:'0'}));
  assert.equal(get('loadoutDialog').open,true,
   'a valid first click immediately after Drive restore opens the new owner\'s loadout');
  await get('closeLoadoutDialog').fire('click');
  assert.equal(get('loadoutDialog').open,false);
 }catch(error){defects.push('ownership display: '+error.message);}
 if(defects.length)throw Error('Reproduced stale account state: '+defects.join(' | '));
 console.log('PASS live restore rejects old-account upgrade and picker actions');
}finally{browser.restore();}
