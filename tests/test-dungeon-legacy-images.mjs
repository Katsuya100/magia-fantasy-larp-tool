import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,saveProfile,getProfile,readDungeonSnapshot,allCircles} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {displayCircleThumbnail,restoreOriginalOnThumbnailError} from '../assets/js/dungeon-thumbnails.mjs';

const image=new Blob([Uint8Array.from([255,216,255,224,1,2,3,4,255,217])],{type:'image/jpeg'});
const circle={id:'fallen-relic-circle',image,analysis:{attribute:'flame',role:'attack',power:120},revealed:true,registeredAt:1,basePower:120};
const legacy={name:'先代',level:12,enemyId:'enemy_1',circles:[circle],items:[],loot:[],rank:0};
const factory=fakeIndexedDB();
const db=await openStore(factory);
await saveProfile(db,{name:'後継者',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},returns:0,attempts:1,tutorialDone:true,
 inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,
 magicStones:0,slots:[null,null,null,null,null],permadeath:true,awaitingHeir:false,legacies:[],
 run:{stage:'checkpoint',floor:5,carry:[],loot:[{type:'legacy',legacy}],xp:0,bonusClaimed:true,hero:{level:1}}});
const wait=async pred=>{for(let i=0;i<200;i++){if(await pred())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('legacy image test timed out');};
let env=fakeDungeonBrowser({factory});
try{
 const $=id=>env.document.getElementById(id);
 await import('../assets/js/dungeon-app.mjs?integration=legacy-relic-return');
 await wait(()=>$('checkpoint').hidden===false);
 await $('returnHome').fire('click');
 await wait(async()=>(await allCircles(db)).some(c=>c.id===circle.id));
 const after=await allCircles(db);
 assert.equal(after.length,1);
 assert.ok(after[0].image instanceof Blob,'recovered relic must remain a real Blob');
 assert.equal(after[0].image.type,'image/jpeg');
 assert.equal(await digestPhoto(after[0].image),await digestPhoto(image),'original photo bytes survive return');
 assert.equal(after[0].legacyHp,24,'relic powers are restored');
 assert.equal((await getProfile(db)).run,null);
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid','relic save stays authenticated');
 const exported=await serializeDungeonSnapshot(await readDungeonSnapshot(db));
 const backup=deserializeDungeonSnapshot(exported);
 assert.equal(await digestPhoto(backup.circles[0].image),await digestPhoto(image),'cloud backup preserves relic photo bytes');
}finally{env.restore();}
env=fakeDungeonBrowser({factory});
try{
 const $=id=>env.document.getElementById(id);
 await import('../assets/js/dungeon-app.mjs?integration=legacy-relic-reload');
 await wait(()=>$('libraryCards').innerHTML.includes('fallen-relic-circle'));
 assert.match($('libraryCards').innerHTML,/src="blob:mock-/,'saved relic is renderable after restart');
 assert.equal((await allCircles(db))[0].image.size,image.size);
}finally{env.restore();}
const img={isConnected:true,dataset:{circleThumb:circle.id},src:'',alt:''};
await displayCircleThumbnail(img,circle,{get:async()=>{throw Error('simulated bitmap decode failure');}},()=> 'blob:original');
assert.equal(img.src,'blob:original','decode failure displays original instead of transparent placeholder');
assert.equal(img.dataset.circleImageSource,'original');
await displayCircleThumbnail(img,circle,{get:async()=>''},()=> 'blob:original-second');
assert.equal(img.src,'blob:original-second','cancelled thumbnail generation uses original');
await displayCircleThumbnail(img,circle,{get:async()=> 'blob:derived'},()=> 'blob:original');
assert.equal(img.src,'blob:derived');
assert.equal(restoreOriginalOnThumbnailError(img,circle,()=> 'blob:original-third'),true);
assert.equal(img.src,'blob:original-third','undecodable cached thumbnail falls back to original');
assert.equal(restoreOriginalOnThumbnailError(img,circle,()=> 'blob:unused'),false,'original error does not loop');
const detached={isConnected:false,dataset:{circleThumb:circle.id},src:'untouched'};
await displayCircleThumbnail(detached,circle,{get:async()=>''},()=> 'blob:unexpected');
assert.equal(detached.src,'untouched','stale elements do not receive recycled URLs');
console.log('PASS recovered relic photo IndexedDB bytes, reload, cloud snapshot and thumbnail fallback');
