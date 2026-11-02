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
const browser=fakeDungeonBrowser({factory:localFactory});
try{
 const app=await import('../assets/js/dungeon-app.mjs?integration=drive-hot-restore');
 const get=id=>browser.document.getElementById(id);
 await wait(()=>get('startupMask').hidden===true,'game starts with a local-only blank save');
 assert.equal(get('backupSetupDialog').open,true,'backup setup is visible before an initial Drive restore');

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
 assert.match(get('libraryCards').innerHTML,/drive-magic/,'the restored grimoire is rendered immediately');
 assert.match(get('libraryCards').innerHTML,/data-circle-photo-id="drive-magic"/);
 assert.equal(get('prepare').hidden,false,'the player can immediately continue in the restored game');
 assert.equal((await allCircles(localDb))[0].image instanceof Blob,true);
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
