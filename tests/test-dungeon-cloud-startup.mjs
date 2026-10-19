import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,readDungeonSnapshot} from '../assets/js/dungeon-store.mjs';
import {serializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {initDungeonCloudSync} from '../assets/js/dungeon-cloud-sync.mjs';

const csv=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});

const wait=async(condition,message)=>{
 const end=Date.now()+6000;
 while(Date.now()<end){
  if(condition())return;
  await new Promise(resolve=>setTimeout(resolve,15));
 }
 assert.ok(condition(),message);
};
class FakeElement{
 constructor(hidden=false){
  this.hidden=hidden;this.disabled=false;this.open=false;this.textContent='';
  this.handlers=new Map();this.children=new Map();
 }
 addEventListener(event,handler){
  if(!this.handlers.has(event))this.handlers.set(event,new Set());
  this.handlers.get(event).add(handler);
 }
 removeEventListener(event,handler){this.handlers.get(event)?.delete(handler);}
 click(){for(const handler of this.handlers.get('click')||[])handler();}
 showModal(){this.open=true;}
 close(){this.open=false;}
 querySelector(selector){
  if(!this.children.has(selector))this.children.set(selector,new FakeElement());
  return this.children.get(selector);
 }
 setAttribute(name,value){this[name]=value;}
}
function fakeUi(){
 const elements=new Map();
 const doc={
  getElementById(id){
   if(!elements.has(id))elements.set(id,new FakeElement(
    ['setupCreatePlayer','setupSwitchGoogleDrive'].includes(id)
   ));
   return elements.get(id);
  },
  addEventListener(){},
  head:{append(){throw Error('Unexpected Google script injection');}}
 };
 const get=id=>doc.getElementById(id);
 return {get,doc,win:{document:doc,addEventListener(){}},button:get('connectGoogleDrive'),status:get('googleDriveStatus')};
}
function mockGoogle(){
 const requests=[];
 const original=globalThis.google;
 globalThis.google={accounts:{oauth2:{initTokenClient(config){
  return {requestAccessToken(args){
   requests.push(args);
   queueMicrotask(()=>config.callback({access_token:'test-token',expires_in:3600}));
  }};
 }}}};
 return {requests,restore(){globalThis.google=original;}};
}
function remoteApi(snapshotText=null){
 const file={id:'backup-1',name:'magia-dungeon-save-v1.json',modifiedTime:'2026-10-19T01:00:00.000Z'};
 let expire=false;
 const fetchImpl=async url=>{
  if(expire)return new Response('',{status:401});
  const u=String(url);
  if(u.includes('spaces=appDataFolder'))return Response.json({files:snapshotText?[file]:[]});
  if(u.includes('?alt=media'))return new Response(snapshotText||'',{status:snapshotText?200:404});
  if(u.includes('?fields=id,name,modifiedTime'))return Response.json(file);
  throw Error('Unexpected Drive request: '+u);
 };
 return {fetchImpl,expire(){expire=true;}};
}
async function newDb(){
 const db=await openStore(fakeIndexedDB());
 await getProfile(db);
 return db;
}
function start(db,ui,fetchImpl,callbacks={}){
 return initDungeonCloudSync({
  db,button:ui.button,status:ui.status,fetchImpl,windowImpl:ui.win,
  onRestore:callbacks.onRestore||(()=>{}),
  onInitialReady:callbacks.onInitialReady||(()=>{}),
  onRepairImages:async()=>false
 });
}

const auth=mockGoogle();
try{
 // An existing Drive backup takes priority on a browser whose local data vanished.
 // Logging in must ask to restore rather than open an empty player name dialog.
 const seeded=await newDb(),profile=await getProfile(seeded);
 profile.name='Driveに残った冒険者';
 profile.level=14;
 profile.attempts=7;
 await saveProfile(seeded,profile);
 const remote=remoteApi(await serializeDungeonSnapshot(await readDungeonSnapshot(seeded)));
 const fresh=await newDb(),ui=fakeUi();
 let names=0,restores=0;
 start(fresh,ui,remote.fetchImpl,{onInitialReady:()=>names++,onRestore:()=>restores++});
 await wait(()=>!ui.button.disabled,'Google sign-in initialized');
 ui.get('setupGoogleDrive').click();
 await wait(()=>ui.get('googleDriveConflictDialog').open,'old save presented for recovery');
 assert.equal(names,0,'Drive data must be checked before player naming');
 assert.equal(ui.button.hidden,true,'the action is hidden while an authenticated decision is pending');
 assert.equal(ui.get('setupCreatePlayer').hidden,true,'new game option is not offered before comparing saved data');
 ui.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').click();
 await wait(()=>restores===1,'existing Drive save restored');
 assert.equal((await readDungeonSnapshot(fresh)).profile.name,'Driveに残った冒険者');
 assert.equal(names,0,'restoring never asks for a new player name');

 // A mistaken/empty Google account cannot silently turn an existing player
 // into a new one. Offer switching accounts or an explicit new-game choice.
 const emptyDb=await newDb(),emptyUi=fakeUi(),emptyApi=remoteApi();
 let namedWithoutBackup=0;
 start(emptyDb,emptyUi,emptyApi.fetchImpl,{onInitialReady:()=>namedWithoutBackup++});
 await wait(()=>!emptyUi.button.disabled,'empty-Drive connection initialized');
 emptyUi.get('setupGoogleDrive').click();
 await wait(()=>!emptyUi.get('setupCreatePlayer').hidden,'no-backup choice presented');
 assert.equal(namedWithoutBackup,0,'successful OAuth with no Drive file must not start the name dialog');
 assert.equal(emptyUi.get('setupGoogleDrive').hidden,true,'no redundant connection button while logged in');
 assert.equal(emptyUi.button.hidden,true,'connected account hides the profile connection button');
 assert.equal(emptyUi.get('setupSwitchGoogleDrive').hidden,false,'user may check a different account');
 emptyUi.get('setupSwitchGoogleDrive').click();
 await wait(()=>auth.requests.some(args=>args.prompt==='select_account'),'switch-account action opens the account picker');
 assert.equal(namedWithoutBackup,0);
 await wait(()=>!emptyUi.get('setupCreatePlayer').hidden,'empty account rechecked');
 emptyUi.get('setupCreatePlayer').click();
 assert.equal(namedWithoutBackup,1,'naming requires an explicit new-game choice');

 // Local-only start must really disconnect, even if the user just signed in
 // to inspect a Google account with no previous backup.
 const localDb=await newDb(),localUi=fakeUi(),localApi=remoteApi();
 const localSession=start(localDb,localUi,localApi.fetchImpl);
 await wait(()=>!localUi.button.disabled,'local-only choice initialized');
 localUi.get('setupGoogleDrive').click();
 await wait(()=>!localUi.get('setupCreatePlayer').hidden,'local-only account checked');
 localSession.disconnect();
 assert.equal(localUi.button.hidden,false,'explicit local-only play reveals a future connect action');
 assert.match(localUi.status.textContent,/同期オフ/);
 assert.equal(await localSession.sync(true),'deferred','local-only choice has disabled the live Drive session');

 // Only a verified, authenticated sync earns the "synced" label.
 const signedUi=fakeUi(),signedApi=remoteApi(await serializeDungeonSnapshot(await readDungeonSnapshot(seeded)));
 let existingNames=0;
 const controller=start(seeded,signedUi,signedApi.fetchImpl,{onInitialReady:()=>existingNames++});
 await wait(()=>!signedUi.button.disabled,'existing-save Google connection initialized');
 signedUi.button.click();
 await wait(()=>signedUi.status.textContent==='GoogleDrive同期済み','verified saved game shows synced status');
 assert.equal(signedUi.button.hidden,true,'verified sync hides redundant connect action');
 assert.equal(signedUi.get('setupGoogleDrive').hidden,true,'verified sync hides setup reconnect button');

 // Expired authorization restores the action without claiming active sync.
 signedApi.expire();
 await controller.sync(true);
 assert.equal(signedUi.button.hidden,false,'expired authorization reveals reconnect');
 assert.equal(signedUi.get('setupGoogleDrive').hidden,false);
 assert.match(signedUi.status.textContent,/再接続/);
 assert.notEqual(signedUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(signedUi.get('googleDriveExpiredDialog').open,true,'expiration explains why sync stopped');
 assert.equal(existingNames,1,'a successful named-profile recheck does not create a different player');
 console.log('PASS cloud startup recovery before naming, no-backup account choice, synced-only presentation and reconnect on expiry');
}finally{auth.restore();}
