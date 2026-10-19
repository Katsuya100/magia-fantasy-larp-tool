import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {openStore,getProfile,saveProfile,readDungeonSnapshot,saveCloudSyncState} from '../assets/js/dungeon-store.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {initDungeonCloudSync} from '../assets/js/dungeon-cloud-sync.mjs';

const csv=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});

const wait=async(check,message)=>{
 const end=Date.now()+9000;
 while(Date.now()<end){
  if(await check())return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.ok(await check(),message);
};
class Element{
 constructor(id){
  this.id=id;this.hidden=id==='backupRollbackWarning';this.disabled=false;this.open=false;this.textContent='';
  this.handlers=new Map();this.children=new Map();
 }
 addEventListener(name,handler){
  if(!this.handlers.has(name))this.handlers.set(name,new Set());
  this.handlers.get(name).add(handler);
 }
 removeEventListener(name,handler){this.handlers.get(name)?.delete(handler);}
 click(){for(const handler of this.handlers.get('click')||[])handler();}
 showModal(){this.open=true;}
 close(){this.open=false;}
 querySelector(selector){
  if(!this.children.has(selector))this.children.set(selector,new Element(selector));
  return this.children.get(selector);
 }
 setAttribute(name,value){this[name]=value;}
}
function fakeUi(){
 const elements=new Map();
 const doc={
  getElementById(id){
   if(!elements.has(id))elements.set(id,new Element(id));
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
function remoteApi(initial=null,{tamperReadback=false}={}){
 const id='backup-1',modified=()=>new Date(Date.UTC(2026,9,19,10,0,version)).toISOString();
 let version=1,value=initial,expired=false,uploads=0,downloads=0,failUpload=false;
 const fetchImpl=async (url,options={})=>{
  if(expired)return new Response('',{status:401});
  const u=String(url),method=options.method||'GET';
  if(u.includes('spaces=appDataFolder')){
   return Response.json({files:value===null?[]:[{id,name:'magia-dungeon-save-v1.json',modifiedTime:modified()}]});
  }
  if(u.includes('?alt=media')){
   downloads++;
   if(value===null)return new Response('',{status:404});
   return new Response(tamperReadback&&uploads>0?'tampered':value);
  }
  if(u.includes('?fields=id,name,modifiedTime'))return Response.json({id,name:'magia-dungeon-save-v1.json',modifiedTime:modified()});
  if(u.includes('uploadType=resumable')){
   assert.ok(method==='POST'||method==='PATCH','create vs update upload method');
   if(method==='PATCH')assert.notEqual(value,null,'updates require an existing remote file');
   return new Response('',{status:200,headers:{Location:'https://www.googleapis.com/upload/session/mock'}});
  }
  if(u.includes('/upload/session/mock')){
   assert.equal(method,'PUT');
   if(failUpload)return new Response('',{status:503});
   value=await options.body.text();
   version++;
   uploads++;
   return Response.json({id,modifiedTime:modified()});
  }
  throw Error('Unexpected Drive request: '+method+' '+u);
 };
 return {
  fetchImpl,
  get current(){return value;},
  get uploads(){return uploads;},
  get downloads(){return downloads;},
  expire(){expired=true;},
  failUploads(){failUpload=true;}
 };
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
async function connect(ui,button='setupGoogleDrive'){
 await wait(()=>!ui.get(button).disabled,'OAuth initialized');
 ui.get(button).click();
}
const auth=mockGoogle();
try{
 // 1. First connection: a real empty-player backup is uploaded AND read back
 // before the game is allowed to ask for a player name.
 const firstDb=await newDb(),firstUi=fakeUi(),firstDrive=remoteApi();
 let firstReady=0;
 const firstController=start(firstDb,firstUi,firstDrive.fetchImpl,{
  onInitialReady:()=>{
   assert.equal(firstDrive.uploads,1,'initial save must exist before naming');
   assert.ok(firstDrive.downloads>=1,'a successful upload must be read back');
   firstReady++;
  }
 });
 await connect(firstUi);
 await wait(()=>firstReady===1,'no existing backup opens player naming directly');
 assert.equal(firstDrive.uploads,1,'the empty starting profile is uploaded exactly once');
 assert.equal(deserializeDungeonSnapshot(firstDrive.current).profile.name,undefined,'initial file precedes the name');
 assert.equal(firstUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(firstUi.button.hidden,true,'no redundant button once a real file is verified');
 assert.equal(firstUi.get('backupRiskWarning').hidden,true,'unbacked save warning is hidden only on success');
 assert.equal(firstUi.get('backupRollbackWarning').hidden,false);

 // The name is real user data, not a reason to keep treating the save as empty.
 const newlyNamed=await getProfile(firstDb);
 newlyNamed.name='星の魔導士';
 await saveProfile(firstDb,newlyNamed);
 assert.equal(await firstController.syncNow(),'ready','name is uploaded on demand, without debounce');
 assert.equal(firstDrive.uploads,2,'one upload before name and another immediately after name');
 assert.equal(deserializeDungeonSnapshot(firstDrive.current).profile.name,'星の魔導士','the remote contains the exact saved name');
 assert.equal(firstUi.status.textContent,'GoogleDrive同期済み','only confirmed bytes count as synced');
 assert.equal(firstUi.get('googleDriveConflictDialog').open,false,'naming never reopens the restore/new chooser');
 assert.ok(firstDrive.downloads>=2,'both uploads were verified with Drive downloads');

 // 2. Fresh local browser + existing named cloud backup: require only two
 // choices, never a name form until the user chooses a new game.
 const recoveringDb=await newDb(),recoveringUi=fakeUi(),recoveringDrive=remoteApi(firstDrive.current);
 let recoveringNames=0,reloads=0;
 start(recoveringDb,recoveringUi,recoveringDrive.fetchImpl,{
  onInitialReady:()=>recoveringNames++,onRestore:()=>reloads++
 });
 await connect(recoveringUi);
 await wait(()=>recoveringUi.get('googleDriveConflictDialog').open,'existing remote opens restore/new chooser');
 assert.equal(recoveringNames,0);
 assert.equal(recoveringUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,true,'only two startup choices');
 assert.equal(recoveringDrive.uploads,0,'never replace the stored name before an explicit choice');
 recoveringUi.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').click();
 await wait(()=>reloads===1,'existing player restored');
 assert.equal((await readDungeonSnapshot(recoveringDb)).profile.name,'星の魔導士');
 assert.equal(recoveringNames,0,'restoration does not open a new name dialog');

 // 3. Fresh browser + existing backup + explicit new game: the unnamed seed
 // replaces the backup BEFORE naming; the name is then synced immediately.
 const newGameDb=await newDb(),newGameUi=fakeUi(),newGameDrive=remoteApi(firstDrive.current);
 let newGameReady=0;
 const newGameController=start(newGameDb,newGameUi,newGameDrive.fetchImpl,{onInitialReady:()=>newGameReady++});
 await connect(newGameUi);
 await wait(()=>newGameUi.get('googleDriveConflictDialog').open,'new-game choice presented');
 newGameUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').click();
 await wait(()=>newGameReady===1,'new game opens name entry only after initial backup');
 assert.equal(newGameDrive.uploads,1,'new initial state is backed up before naming');
 assert.ok(!deserializeDungeonSnapshot(newGameDrive.current).profile.name,'old name intentionally replaced only on explicit user choice');
 const newGameProfile=await getProfile(newGameDb);
 newGameProfile.name='新たな冒険者';
 await saveProfile(newGameDb,newGameProfile);
 assert.equal(await newGameController.syncNow(),'ready','new-game name syncs immediately');
 assert.equal(deserializeDungeonSnapshot(newGameDrive.current).profile.name,'新たな冒険者');
 assert.equal(newGameDrive.uploads,2);

 // 4. Reconnecting to the same initial backup should not show the chooser
 // just because a player has not entered a name yet.
 const seed=await readDungeonSnapshot(await newDb()),identicalDb=await newDb();
 const {replaceDungeonSnapshot}=await import('../assets/js/dungeon-store.mjs');
 await replaceDungeonSnapshot(identicalDb,seed);
 const identicalUi=fakeUi(),identicalDrive=remoteApi(await serializeDungeonSnapshot(seed));
 let identicalReady=0;
 start(identicalDb,identicalUi,identicalDrive.fetchImpl,{onInitialReady:()=>identicalReady++});
 await connect(identicalUi);
 await wait(()=>identicalReady===1,'identical seed is already backed up');
 assert.equal(identicalUi.get('googleDriveConflictDialog').open,false,'matching initial save is not a conflict');
 assert.equal(identicalDrive.uploads,0,'same save avoids redundant writes');

 // 5. If an account was previously synced, a missing Drive file is an ERROR.
 // Never silently create a new seed under the wrong account.
 const missingDb=await newDb(),missingUi=fakeUi(),missingDrive=remoteApi();
 await saveCloudSyncState(missingDb,{fileId:'backup-1',hash:'previous-sync'});
 let missingReady=0;
 start(missingDb,missingUi,missingDrive.fetchImpl,{onInitialReady:()=>missingReady++});
 await connect(missingUi);
 await wait(()=>missingUi.status.textContent.includes('同期エラー'),'lost remote backup is a visible error');
 assert.equal(missingReady,0);
 assert.equal(missingDrive.uploads,0,'missing prior file must not be overwritten or recreated');
 assert.equal(missingUi.button.hidden,false,'error gives a recovery action');
 assert.equal(missingUi.get('backupRiskWarning').hidden,false,'never falsely show healthy backup');

 // 6. A server error or invalid read-back must never claim "synced" or open
 // name entry. The user's local data remains available.
 const badDb=await newDb(),badUi=fakeUi(),badDrive=remoteApi(null,{tamperReadback:true});
 let badReady=0;
 start(badDb,badUi,badDrive.fetchImpl,{onInitialReady:()=>badReady++});
 await connect(badUi);
 await wait(()=>badUi.status.textContent.includes('同期エラー'),'incorrect downloaded bytes detected');
 assert.equal(badReady,0);
 assert.equal(badDrive.uploads,1,'server accepted upload but readback failed');
 assert.notEqual(badUi.status.textContent,'GoogleDrive同期済み');

 // 7. A previously verified account loses synced status when authorization ends.
 firstDrive.expire();
 await firstController.sync(true);
 assert.equal(firstUi.button.hidden,false,'expired auth reveals reconnect');
 assert.match(firstUi.status.textContent,/再接続/);
 assert.notEqual(firstUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(firstUi.get('googleDriveExpiredDialog').open,true);
 console.log('PASS initial pre-name upload and readback, immediate name upload, restore/new flow, same seed, lost backup errors, readback failure and expiry');
}finally{auth.restore();}
