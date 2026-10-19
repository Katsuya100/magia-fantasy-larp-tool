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
 const operations=[];
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
   operations.push(method);
   const metadata=JSON.parse(options.body);
   if(method==='POST')assert.deepEqual(metadata.parents,['appDataFolder'],'new backups must be created in the private appDataFolder');
   if(method==='PATCH'){
    assert.notEqual(value,null,'updates require an existing remote file');
    assert.equal(metadata.parents,undefined,'updates must preserve the existing Drive file');
   }
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
  get operations(){return [...operations];},
  expire(){expired=true;},
  failUploads(){failUpload=true;},
  resumeUploads(){failUpload=false;}
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
 assert.deepEqual(firstDrive.operations,['POST'],'missing backup creates a new file using Drive POST');
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
 assert.deepEqual(firstDrive.operations,['POST','PATCH'],'naming updates the created file through Drive PATCH');
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
 assert.deepEqual(recoveringDrive.operations,[],'a found backup must not receive POST or PATCH before choosing');
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
 assert.deepEqual(newGameDrive.operations,['PATCH'],'explicit new-game choice updates only the existing file');
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
 const loginsBefore=auth.requests.length;
 missingUi.button.click();
 await wait(()=>auth.requests.length===loginsBefore+1,'missing backup offers new Google account authentication');
 await wait(()=>missingUi.status.textContent.includes('同期エラー'),'wrong account retry must not create a blank file');
 assert.equal(missingDrive.uploads,0);

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

 // 7. Without Google Drive, beginning locally must never upload anything.
 // The app's setupWithoutBackup button calls disconnect() before opening the name form.
 const localOnlyDb=await newDb(),localOnlyUi=fakeUi(),localOnlyDrive=remoteApi();
 let localOnlyReady=0;
 const localOnlyController=start(localOnlyDb,localOnlyUi,localOnlyDrive.fetchImpl,{onInitialReady:()=>localOnlyReady++});
 await wait(()=>!localOnlyUi.get('setupGoogleDrive').disabled,'local-only setup is ready');
 localOnlyController.disconnect();
 const localOnlyProfile=await getProfile(localOnlyDb);
 localOnlyProfile.name='端末だけの冒険者';
 await saveProfile(localOnlyDb,localOnlyProfile);
 assert.equal(await localOnlyController.syncNow(),'deferred','no Drive token means no network sync');
 assert.equal(localOnlyReady,0);
 assert.deepEqual(localOnlyDrive.operations,[]);
 assert.equal(localOnlyDrive.current,null);
 assert.equal(localOnlyUi.button.hidden,false,'disconnected status offers syncing later');

 // 8. A failed initial POST retains the empty local save and allows an explicit retry.
 const failedSeedDb=await newDb(),failedSeedUi=fakeUi(),failedSeedDrive=remoteApi();
 failedSeedDrive.failUploads();
 let failedSeedReady=0;
 const failedSeedController=start(failedSeedDb,failedSeedUi,failedSeedDrive.fetchImpl,{onInitialReady:()=>failedSeedReady++});
 await connect(failedSeedUi);
 await wait(()=>failedSeedUi.status.textContent.includes('同期エラー'),'failed initial upload is reported');
 assert.equal(failedSeedReady,0,'do not open the name form after a failed POST');
 assert.equal(failedSeedDrive.current,null);
 assert.equal(failedSeedUi.button.hidden,false);
 assert.equal((await getProfile(failedSeedDb)).name,undefined);
 failedSeedDrive.resumeUploads();
 assert.equal(await failedSeedController.sync(true),'ready','retry can create the missing file');
 assert.equal(failedSeedDrive.uploads,1);
 assert.deepEqual(failedSeedDrive.operations,['POST','POST']);
 assert.equal(failedSeedUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(failedSeedUi.button.hidden,true);

 // 9. A failed name PATCH must preserve local data, never claim success, and retry.
 const retryDb=await newDb(),retryUi=fakeUi(),retryDrive=remoteApi();
 let retryReady=0;
 const retryController=start(retryDb,retryUi,retryDrive.fetchImpl,{onInitialReady:()=>retryReady++});
 await connect(retryUi);
 await wait(()=>retryReady===1,'retry test creates a starting backup');
 retryDrive.failUploads();
 const retryProfile=await getProfile(retryDb);
 retryProfile.name='保存を再試行する冒険者';
 await saveProfile(retryDb,retryProfile);
 assert.equal(await retryController.syncNow(),'deferred');
 assert.equal((await getProfile(retryDb)).name,'保存を再試行する冒険者','failed backup must not lose the local name');
 assert.notEqual(deserializeDungeonSnapshot(retryDrive.current).profile.name,'保存を再試行する冒険者','failed PATCH must not alter the remote');
 assert.match(retryUi.status.textContent,/同期エラー/);
 assert.equal(retryUi.button.hidden,false);
 retryDrive.resumeUploads();
 assert.equal(await retryController.syncNow(),'ready','failed name upload can be retried');
 assert.equal(deserializeDungeonSnapshot(retryDrive.current).profile.name,'保存を再試行する冒険者');
 assert.deepEqual(retryDrive.operations,['POST','PATCH','PATCH']);
 assert.equal(retryUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(retryUi.button.hidden,true);

 // 10. A new browser after a complete backup needs a restore/new decision again.
 const reopenedDb=await newDb(),reopenedUi=fakeUi(),reopenedDrive=remoteApi(firstDrive.current);
 let reopenedReady=0;
 start(reopenedDb,reopenedUi,reopenedDrive.fetchImpl,{onInitialReady:()=>reopenedReady++});
 await connect(reopenedUi);
 await wait(()=>reopenedUi.get('googleDriveConflictDialog').open,'page restart detects an existing backup');
 assert.equal(reopenedReady,0);
 assert.deepEqual(reopenedDrive.operations,[],'startup must not silently overwrite existing Drive data');
 assert.equal(reopenedUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,true);

 // 11. A previously verified account loses synced status when authorization ends.
 firstDrive.expire();
 await firstController.sync(true);
 assert.equal(firstUi.button.hidden,false,'expired auth reveals reconnect');
 assert.match(firstUi.status.textContent,/再接続/);
 assert.notEqual(firstUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(firstUi.get('googleDriveExpiredDialog').open,true);
 console.log('PASS Drive POST/PATCH, initial and name uploads, restore/new, local-only, retry, restart, data preservation, readback and expiry');
}finally{auth.restore();}
