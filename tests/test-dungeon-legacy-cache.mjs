import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,putCircle,allCircles} from '../assets/js/dungeon-store.mjs';
import {clearLegacyThumbnailCache,LEGACY_THUMBNAIL_CACHE_NAME} from '../assets/js/dungeon-legacy-cache.mjs';

const factory=fakeIndexedDB(),db=await openStore(factory);
// Seed a valid legacy profile before the app has loaded its CSV tunables.
await saveProfile(db,{name:'キャッシュ削除テスト',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},returns:0,attempts:0,tutorialDone:true,
 inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,
 magicStones:0,slots:[null,null,null,null,null],permadeath:false,awaitingHeir:false,legacies:[],run:null});
await putCircle(db,{id:'cache-proof-photo',image:new Blob([Uint8Array.from([255,216,255,217])],{type:'image/jpeg'}),analysis:{attribute:'flame',role:'attack',power:100},revealed:true,registeredAt:1});
assert.equal((await allCircles(db)).length,1);
const names=new Set([LEGACY_THUMBNAIL_CACHE_NAME,'unrelated-cache']);
const deletes=[],opens=[];
const oldCaches=globalThis.caches;
globalThis.caches={
 async delete(name){deletes.push(name);return names.delete(name);},
 async keys(){return [...names];},
 async open(name){opens.push(name);throw Error('Legacy cleanup must never open or populate a cache');}
};
const env=fakeDungeonBrowser({factory});
try{
 await import('../assets/js/dungeon-app.mjs?integration=legacy-cache-erasure');
 const $=id=>env.document.getElementById(id);
 const end=Date.now()+9000;
 while(!$('playerStats').innerHTML.includes('Lv.1')){
  if(Date.now()>end)throw Error('Dungeon startup timed out');
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.ok(env.createdImageUrls.length>0,'original saved circle is displayed before account deletion');
 $('deleteDataPhrase').value='削除';
 await $('confirmDeleteData').fire('click');
 assert.equal($('deleteDataDialog').open,false,'successful deletion closes confirmation');
 assert.deepEqual(await globalThis.caches.keys(),['unrelated-cache'],'old thumbnail images are gone without deleting other sites caches');
 assert.deepEqual(deletes,[LEGACY_THUMBNAIL_CACHE_NAME],'the legacy cache is deleted once');
 assert.deepEqual(opens,[],'no cache is opened and no thumbnails are generated');
 assert.equal((await allCircles(db)).length,0,'original saved photos are removed by the explicit save deletion operation');
 assert.equal((await getProfile(db)).name,'','the save data is reset only after user confirmation');
 for(const image of env.createdImageUrls)assert.ok(env.revokedImageUrls.includes(image.url),'live original-photo URLs are released');
 assert.equal(await clearLegacyThumbnailCache(null),false,'missing Cache Storage needs no cleanup');
}finally{
 env.restore();
 if(oldCaches===undefined)delete globalThis.caches;
 else globalThis.caches=oldCaches;
}
console.log('PASS save deletion drains existing thumbnail Cache Storage only, keeps no generated photos, resets originals and revokes URLs');
