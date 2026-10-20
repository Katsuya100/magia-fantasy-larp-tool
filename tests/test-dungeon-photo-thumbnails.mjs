import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,putCircle,deleteCircle,readDungeonSnapshot,getCircleThumbnail} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';
import {createCircleThumbnail} from '../assets/js/dungeon-thumbnails.mjs';
import {createDungeonPhotoManager} from '../assets/js/dungeon-photo-manager.mjs';

const db=await openStore(fakeIndexedDB());
await getProfile(db);
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
const after=await readDungeonSnapshot(db);
assert.equal(after.savedAt,before.savedAt,'disposable thumbnail does not advance save time');
assert.equal(after.integrity.records,before.integrity.records,'thumbnail is outside the signed game state');
assert.equal(after.circles[0].image.size,original.size,'original remains intact');
assert.equal((await verifyLocalSnapshot(after)).status,'valid','photo integrity is retained');

const replacement=new Blob([Uint8Array.from([255,216,255,224,8,9,0,255,217])],{type:'image/jpeg'});
await putCircle(db,{...circle,image:replacement},{repairImage:true});
await getCircleThumbnail(db,{...circle,image:replacement},encode);
assert.equal(builds,2,'photo repair invalidates the old thumbnail');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
await deleteCircle(db,circle.id);
assert.equal((await readDungeonSnapshot(db)).circles.length,0,'deletion retains the original save semantics');

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
await getProfile(uiDb);
await putCircle(uiDb,circle);
let observer=null;
const oldObserver=globalThis.IntersectionObserver;
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
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
globalThis.document={createElement(){return {width:0,height:0,getContext(){return {drawImage(){}};},
 toBlob(cb,type){cb(new Blob(['tiny'],{type}));}};}};
try{
 const photo={dataset:{circlePhotoId:circle.id},src:'',isConnected:true,
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
}

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
assert.match(html,/id="analysisProgress" max="5" value="0"/);
assert.match(html,/id="analysisProgressCount">0\/5</);
assert.match(html,/id="analysisError"/);
assert.match(app,/frame\.src='magia-circle\.html\?dungeon=1'/);
assert.match(app,/request\.fail=error=>finish\(error\)/,'analyzer failures immediately stop the wait');
console.log('PASS bounded stored thumbnails, screen-scoped URLs, original integrity and analysis progress');
