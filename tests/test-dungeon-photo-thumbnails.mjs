import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,saveProfile,putCircle,deleteCircle,readDungeonSnapshot,getCircleThumbnail} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';
import {createCircleThumbnail} from '../assets/js/dungeon-thumbnails.mjs';
import {createDungeonPhotoManager,grimoireThumbnailSize} from '../assets/js/dungeon-photo-manager.mjs';

const db=await openStore(fakeIndexedDB());
await saveProfile(db,{name:'縮小画像検証',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},
 returns:0,attempts:0,inventory:[],collection:{},run:null});
const original=new Blob([Uint8Array.from([255,216,255,224,1,2,3,4,5,6,7,8,255,217])],{type:'image/jpeg'});
const circle={id:'thumbnail-test',image:original,registeredAt:1,analysis:{attribute:'flame',role:'attack',power:100},revealed:false};
await putCircle(db,circle);
const before=await readDungeonSnapshot(db);
let builds=0;
const encode=async()=>{builds++;return new Blob(['small'],{type:'image/jpeg'});};
const thumb=await getCircleThumbnail(db,circle,encode);
assert.equal(thumb.size,5);
assert.equal((await getCircleThumbnail(db,circle,encode)).size,5);
assert.equal(builds,1,'thumbnail is saved and reused without recoding');
assert.equal((await getCircleThumbnail(db,circle,encode,448)).size,5);
assert.equal(builds,2,'a grimoire request regenerates the legacy 192px thumbnail');
await getCircleThumbnail(db,circle,encode,384);
assert.equal(builds,2,'smaller requests reuse the upgraded thumbnail');
const after=await readDungeonSnapshot(db);
assert.equal(after.savedAt,before.savedAt,'disposable thumbnail does not advance save time');
assert.equal(after.integrity.records,before.integrity.records,'thumbnail is outside the signed game state');
assert.equal(after.circles[0].image.size,original.size,'original remains intact');
assert.equal((await verifyLocalSnapshot(after)).status,'valid','photo integrity is retained');

const replacement=new Blob([Uint8Array.from([255,216,255,224,8,9,0,255,217])],{type:'image/jpeg'});
await putCircle(db,{...circle,image:replacement},{repairImage:true});
await getCircleThumbnail(db,{...circle,image:replacement},encode);
assert.equal(builds,3,'photo repair invalidates the old thumbnail');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
await deleteCircle(db,circle.id);
assert.equal((await readDungeonSnapshot(db)).circles.length,0,'deletion retains the original save semantics');

assert.equal(grimoireThumbnailSize(140,1),192,'low DPR needs 192px');
assert.equal(grimoireThumbnailSize(175,2),384,'desktop retina needs 384px');
assert.equal(grimoireThumbnailSize(140,3),448,'mobile retina needs 448px');
assert.equal(grimoireThumbnailSize(260,2),512,'large cards cap at 512px');
const oldDocument=globalThis.document,oldBitmap=globalThis.createImageBitmap;
let draws=0,closed=0,canvasSize=0;
globalThis.createImageBitmap=async()=>({width:640,height:480,close(){closed++;}});
globalThis.document={createElement(tag){
 assert.equal(tag,'canvas');
 const canvas={width:0,height:0,getContext(){return {drawImage(){draws++;canvasSize=canvas.width;}};},
  toBlob(callback,type){callback(new Blob(['tiny'],{type}));}};
 return canvas;
}};
try{
 const reduced=await createCircleThumbnail(original);
 assert.equal(reduced.type,'image/jpeg');
 assert.equal(reduced.size,4);
 assert.equal(canvasSize,192,'short-lived thumbnail decoding uses a bounded canvas');
 assert.equal(draws,1);
 assert.equal(closed,1,'temporary decoded bitmap is closed');
}finally{globalThis.document=oldDocument;globalThis.createImageBitmap=oldBitmap;}

const uiDb=await openStore(fakeIndexedDB());
await saveProfile(uiDb,{name:'画面検証',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},
 returns:0,attempts:0,inventory:[],collection:{},run:null});
await putCircle(uiDb,circle);
let observer=null;
const oldObserver=globalThis.IntersectionObserver;
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldDpr=globalThis.devicePixelRatio;
globalThis.devicePixelRatio=3;
const made=[],revoked=[];
globalThis.IntersectionObserver=class{
 constructor(callback){this.callback=callback;observer=this;}
 observe(image){this.pending=image;}
 unobserve(){}
 disconnect(){}
 trigger(){this.callback([{target:this.pending,isIntersecting:true}]);}
};
URL.createObjectURL=blob=>{const url='blob:test-'+(made.length+1);made.push({url,blob});return url;};
URL.revokeObjectURL=url=>revoked.push(url);
globalThis.createImageBitmap=async()=>({width:640,height:480,close(){}});
globalThis.document={createElement(){const canvas={width:0,height:0,getContext(){return {drawImage(){canvasSize=canvas.width;}};},
 toBlob(cb,type){cb(new Blob(['tiny'],{type}));}};return canvas;}};
try{
 const photo={dataset:{circlePhotoId:circle.id},src:'',isConnected:true,
  closest:selector=>selector==='#library'?{}:null,getBoundingClientRect:()=>({width:140}),
  getAttribute(name){return name==='src'?this.src:'';},
  removeAttribute(name){if(name==='src')this.src='';}};
 const library={querySelectorAll(){return [photo];}};
 const manager=createDungeonPhotoManager(()=>uiDb,id=>id===circle.id?circle:null);
 manager.refresh([library]);
 assert.equal(photo.src,'','offscreen photo does not load on scene entry');
 assert.equal(made.length,0,'no full or thumbnail URL is allocated before visibility');
 observer.trigger();
 const until=Date.now()+3000;
 while(!photo.src&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
 assert.match(photo.src,/^blob:test-/,'visible card displays a thumbnail');
 assert.equal(made[0].blob.size,4,'card URL points to reduced bytes');
 assert.equal(canvasSize,448,'grimoire thumbnails follow actual rendered size times DPR');
 manager.refresh([]);
 assert.equal(photo.src,'','leaving view detaches image source');
 assert.ok(revoked.includes(made[0].url),'leaving view revokes thumbnail URL');
 const detail=manager.get(original);
 assert.match(detail,/^blob:test-/);
 assert.equal(made.at(-1).blob.size,original.size,'details use original bytes');
 manager.release(original);
 assert.ok(revoked.includes(detail),'closing details revokes original URL');
 manager.releaseAll();
}finally{
 globalThis.IntersectionObserver=oldObserver;
 URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;
 globalThis.createImageBitmap=oldBitmap;globalThis.document=oldDocument;
 if(oldDpr===undefined)delete globalThis.devicePixelRatio;
 else globalThis.devicePixelRatio=oldDpr;
}

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
assert.match(html,/id="analysisProgress" max="5" value="0"/);
assert.match(html,/id="analysisProgressCount">0\/5</);
assert.match(html,/id="analysisError"/);
assert.match(app,/frame\.src='magia-circle\.html\?dungeon=1'/);
assert.match(app,/request\.fail=error=>finish\(error\)/,'analyzer failures immediately stop the wait');
console.log('PASS bounded stored thumbnails, screen-scoped URLs, original integrity and analysis progress');
