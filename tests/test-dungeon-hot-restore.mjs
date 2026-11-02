import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,putCircle,readDungeonSnapshot,replaceDungeonSnapshot,allCircles} from '../assets/js/dungeon-store.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';

const wait=async(predicate,message)=>{
 const limit=Date.now()+9000;
 while(!predicate()&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(predicate(),message);
};
const csv=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});
const localFactory=fakeIndexedDB(),localDb=await openStore(localFactory);
await getProfile(localDb);
// A stale local circle must disappear when a different owned backup is restored.
await putCircle(localDb,{id:'obsolete-local-circle',name:'古い端末の魔法陣',image:new Blob(['old-local'],{type:'image/png'}),registeredAt:0,
 analysis:{attribute:'flame',role:'attack',power:681},revealed:true});
const browser=fakeDungeonBrowser({factory:localFactory});
try{
 const app=await import('../assets/js/dungeon-app.mjs?integration=drive-hot-restore');
 const get=id=>browser.document.getElementById(id);
 await wait(()=>get('startupMask').hidden===true,'game starts with a local-only blank save');
 assert.equal(get('backupSetupDialog').open,true,'backup setup is visible before an initial Drive restore');
 await browser.document.click({dataset:{remove:'obsolete-local-circle'},closest(){return this;}});
 assert.equal(get('circleActionDialog').open,true,'an old circle action is pending before restore');

 const driveDb=await openStore(fakeIndexedDB());
 const remoteProfile=await getProfile(driveDb);
 remoteProfile.name='復元された冒険者';
 remoteProfile.slots=['drive-magic',null,null,null,null];
 remoteProfile.level=8;
 await saveProfile(driveDb,remoteProfile);
 const photo=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});
 await putCircle(driveDb,{id:'drive-magic',name:'復元された魔法陣',image:photo,
  registeredAt:1,analysis:{attribute:'flame',role:'attack',power:123},revealed:true,basePower:123});
 // Exercise the same encoded backup and atomic replacement as a real Drive import.
 const backup=deserializeDungeonSnapshot(await serializeDungeonSnapshot(await readDungeonSnapshot(driveDb)));
 await replaceDungeonSnapshot(localDb,backup);
 await app.refreshDungeonViewFromBackup();

 assert.equal(get('backupSetupDialog').open,false,'backup setup closes without a page reload');
 assert.equal(get('circleActionDialog').open,false,'restoring ownership closes the old circle action dialog');
 await get('confirmCircleAction').fire('click');
 assert.deepEqual((await allCircles(localDb)).map(circle=>circle.id),['drive-magic'],
  'confirming a stale pre-restore deletion cannot remove a newly owned spell');

 await browser.document.click({dataset:{upgrade:'obsolete-local-circle'},closest(){return this;}});
 assert.equal(get('circleActionDialog').open,false,'stale upgrade click cannot target an unowned circle');
 assert.match(get('libraryCards').innerHTML,/drive-magic/,'the restored grimoire is rendered immediately');
 assert.match(get('libraryCards').innerHTML,/data-circle-photo-id="drive-magic"/);
 assert.doesNotMatch(get('libraryCards').innerHTML,/obsolete-local-circle/,'restoration must not display circles from the prior save');
 assert.deepEqual((await allCircles(localDb)).map(x=>x.id),['drive-magic'],'only the restored circle remains owned');
 await browser.document.click({dataset:{circleDetail:'obsolete-local-circle'},closest(){return this;}});
 assert.equal(get('magicDetailsDialog').open,false,'a stale click cannot open or upgrade an unowned circle');
 assert.equal(get('prepare').hidden,false,'the player can immediately continue in the restored game');
 assert.equal((await allCircles(localDb))[0].image instanceof Blob,true);
 await browser.document.click({dataset:{openSlot:'0'},closest(){return this;}});
 assert.equal(get('loadoutDialog').open,true,'first loadout click after hot restore is accepted');
 await app.refreshDungeonViewFromBackup();
 assert.equal(get('loadoutDialog').open,false,'a second restoration closes the stale picker');
 await get('clearLoadoutSlot').fire('click');
 assert.equal((await getProfile(localDb)).slots[0],'drive-magic',
  'a click from a closed pre-restore picker must never remove an owned circle');
 await browser.document.click({dataset:{circleDetail:'drive-magic'},closest(){return this;}});
 assert.match(get('magicDetailsImage').src,/^blob:mock-/,'restored original photo displays without reloading');
 assert.equal(await digestPhoto(browser.createdImageUrls.at(-1).blob),await digestPhoto(photo));

 // A second Drive restore must discard the old photo URL and show the new bytes.
 const oldUrl=get('magicDetailsImage').src;
 const newPhoto=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,1])],{type:'image/png'});
 await replaceDungeonSnapshot(localDb,{...backup,circles:[{...backup.circles[0],image:newPhoto}]});
 await app.refreshDungeonViewFromBackup();
 assert.ok(browser.revokedImageUrls.includes(oldUrl),'restoration revokes stale original-photo URLs');
 await browser.document.click({dataset:{circleDetail:'drive-magic'},closest(){return this;}});
 assert.match(get('magicDetailsImage').src,/^blob:mock-/);
 assert.equal(await digestPhoto(browser.createdImageUrls.at(-1).blob),await digestPhoto(newPhoto),
  'the new original appears without a page refresh or stale thumbnail');
 console.log('PASS Drive backup in-place rehydration, original image display and URL invalidation');
}finally{browser.restore();}
