import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {openStore,getProfile,saveProfile,putCircle,readDungeonSnapshot,saveCloudSyncState} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot} from '../assets/js/dungeon-cloud-integrity.mjs';
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
  this.id=id;this.hidden=['backupRollbackWarning','backupSetupSpinner','googleDriveSpinner','driveSyncActivity'].includes(id);this.disabled=false;this.open=false;this.textContent='';this.showModalCount=0;
  this.handlers=new Map();this.children=new Map();
 }
 addEventListener(name,handler){
  if(!this.handlers.has(name))this.handlers.set(name,new Set());
  this.handlers.get(name).add(handler);
 }
 removeEventListener(name,handler){this.handlers.get(name)?.delete(handler);}
 click(){for(const handler of this.handlers.get('click')||[])handler();}
 showModal(){this.open=true;this.showModalCount++;}
 close(){this.open=false;}
 querySelector(selector){
  if(!this.children.has(selector))this.children.set(selector,new Element(selector));
  return this.children.get(selector);
 }
 setAttribute(name,value){this[name]=value;}
}
function createCookieJar(){
 const values=new Map(),writes=[];
 return {
  writes,
  get cookie(){
   for(const [name,item] of values)if(item.until<=Date.now())values.delete(name);
   return [...values].map(([name,item])=>name+'='+item.value).join('; ');
  },
  set cookie(line){
   writes.push(line);
   const [pair,...flags]=line.split(';').map(item=>item.trim());
   const separator=pair.indexOf('=');
   const name=pair.slice(0,separator),value=pair.slice(separator+1);
   const age=flags.find(item=>item.toLowerCase().startsWith('max-age='));
   const seconds=age?Number(age.slice(8)):Infinity;
   if(!value||seconds<=0)values.delete(name);
   else values.set(name,{value,until:Date.now()+seconds*1000});
  }
 };
}
function fakeUi(cookies=createCookieJar()){
 const elements=new Map();
 const doc={
  getElementById(id){
   if(!elements.has(id))elements.set(id,new Element(id));
   return elements.get(id);
  },
  addEventListener(){},
  get cookie(){return cookies.cookie;},
  set cookie(value){cookies.cookie=value;},
  head:{append(){throw Error('Unexpected Google script injection');}}
 };
 const get=id=>doc.getElementById(id);
 return {get,doc,cookies,win:{document:doc,location:{protocol:'https:',pathname:'/magia-fantasy-larp-tool/dungeon.html'},addEventListener(){}},button:get('connectGoogleDrive'),status:get('googleDriveStatus')};
}
function mockGoogle(){
 const requests=[];
 let tokenLifetime=3600;
 const original=globalThis.google;
 globalThis.google={accounts:{oauth2:{initTokenClient(config){
  return {requestAccessToken(args){
   requests.push(args);
   queueMicrotask(()=>config.callback({access_token:'test-token',expires_in:tokenLifetime}));
  }};
 }}}};
 return {requests,setExpiresIn(seconds){tokenLifetime=seconds;},restore(){globalThis.google=original;}};
}
function remoteApi(initial=null,{tamperReadback=false}={}){
 const id='backup-1',modified=()=>new Date(Date.UTC(2026,9,19,10,0,version)).toISOString();
 let version=1,value=initial,expired=false,uploads=0,downloads=0,failUpload=false,listPause=null,putPause=null,putRequests=0;
 const operations=[];
 const fetchImpl=async (url,options={})=>{
  if(expired)return new Response('',{status:401});
  const u=String(url),method=options.method||'GET';
  if(u.includes('spaces=appDataFolder')){
   if(listPause)await listPause;
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
   putRequests++;
   if(putPause){const paused=putPause;putPause=null;await paused;}
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
  get putRequests(){return putRequests;},
  get downloads(){return downloads;},
  get operations(){return [...operations];},
  pauseNextList(){
   let release;
   listPause=new Promise(resolve=>{release=resolve;});
   return ()=>{listPause=null;release();};
  },
  pauseNextUpload(){
   let release;
   putPause=new Promise(resolve=>{release=resolve;});
   return ()=>release();
  },
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
 const releaseInitialList=firstDrive.pauseNextList();
 await connect(firstUi);
 await wait(()=>firstUi.get('backupSetupSpinner').hidden===false,'initial Drive check visibly starts spinner');
 assert.equal(firstUi.get('googleDriveSpinner').hidden,false,'profile section shares background sync progress');
 assert.equal(firstUi.get('driveSyncActivity').hidden,false,'global spinner is visible from any gameplay tab');
 assert.equal(firstUi.get('setupWithoutBackup').hidden,true,'local-only action is untouchable during first Drive check');
 assert.equal(firstUi.get('setupWithoutBackup').disabled,true,'initial sync disables bypass');
 assert.equal(firstUi.status['aria-busy'],'true','screen reader receives busy state');
 releaseInitialList();
 await wait(()=>firstReady===1,'no existing backup opens player naming directly');
 assert.equal(firstUi.get('backupSetupSpinner').hidden,true,'spinner stops when verified upload finishes');
 assert.equal(firstUi.get('googleDriveSpinner').hidden,true);
 assert.equal(firstUi.get('driveSyncActivity').hidden,true);
 assert.equal(firstUi.status['aria-busy'],'false');
 assert.equal(firstDrive.uploads,1,'the empty starting profile is uploaded exactly once');
 assert.deepEqual(firstDrive.operations,['POST'],'missing backup creates a new file using Drive POST');
 assert.match(firstUi.doc.cookie,/__Secure-magiaDungeonDriveToken=/,'short-lived authorization is persisted to the HTTPS cookie');
 assert.ok(firstUi.cookies.writes.some(value=>value.includes('Secure; SameSite=Strict; Max-Age=')&&value.includes('Path=/magia-fantasy-larp-tool/')),'cookie is HTTPS-only, strict, expiring and path-scoped');
 assert.equal(deserializeDungeonSnapshot(firstDrive.current).profile.name,undefined,'initial file precedes the name');
 assert.equal(firstUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(firstUi.button.hidden,true,'no redundant button once a real file is verified');
 assert.equal(firstUi.get('backupRiskWarning').hidden,true,'unbacked save warning is hidden only on success');
 assert.equal(firstUi.get('backupRollbackWarning').hidden,false);

 // The name is real user data, not a reason to keep treating the save as empty.
 const newlyNamed=await getProfile(firstDb);
 newlyNamed.name='星の魔導士';
 await saveProfile(firstDb,newlyNamed);
 const releaseNameList=firstDrive.pauseNextList();
 const nameSync=firstController.syncNow();
 await wait(()=>!firstUi.get('googleDriveSpinner').hidden,'name change displays a nonblocking background sync spinner');
 assert.equal(firstUi.status.textContent,'同期中…');
 releaseNameList();
 assert.equal(await nameSync,'ready','name is uploaded on demand, without debounce');
 assert.equal(firstUi.get('googleDriveSpinner').hidden,true,'name sync spinner stops only after Drive verification');
 assert.equal(firstUi.get('driveSyncActivity').hidden,true,'global indicator stops with the verified save');
 assert.equal(firstDrive.uploads,2,'one upload before name and another immediately after name');
 assert.deepEqual(firstDrive.operations,['POST','PATCH'],'naming updates the created file through Drive PATCH');
 assert.equal(deserializeDungeonSnapshot(firstDrive.current).profile.name,'星の魔導士','the remote contains the exact saved name');
 assert.equal(firstUi.status.textContent,'GoogleDrive同期済み','only confirmed bytes count as synced');
 assert.equal(firstUi.get('googleDriveConflictDialog').open,false,'naming never reopens the restore/new chooser');
 assert.ok(firstDrive.downloads>=2,'both uploads were verified with Drive downloads');

 // Real autosave, not just an explicit syncNow(): a local edit schedules
 // a nonblocking backup after the 1.8s debounce and the spinner stays visible.
 const autoProfile=await getProfile(firstDb);
 autoProfile.magicStones=Number(autoProfile.magicStones||0)+1;
 const beforeAutoUploads=firstDrive.uploads;
 const releaseAutoList=firstDrive.pauseNextList();
 await saveProfile(firstDb,autoProfile);
 await wait(()=>!firstUi.get('driveSyncActivity').hidden,'automatic edit-triggered backup starts visibly without a syncNow call');
 assert.equal(firstDrive.uploads,beforeAutoUploads,'background sync is still waiting on the remote API');
 releaseAutoList();
 await wait(()=>firstDrive.uploads===beforeAutoUploads+1,'automatic backup uploads after local edit');
 await wait(()=>firstUi.get('driveSyncActivity').hidden&&firstUi.status.textContent==='GoogleDrive同期済み','automatic progress disappears only after verification');
 assert.equal(deserializeDungeonSnapshot(firstDrive.current).profile.magicStones,autoProfile.magicStones,'automatic backup preserves the changed resource');

 // Queued autosave: while a real upload PUT is in-flight, several local
 // name changes must commit immediately and reserve only one follow-up upload.
 const queuedDb=await newDb(),queuedUi=fakeUi(),queuedDrive=remoteApi();
 let queuedReady=0;
 const queuedController=start(queuedDb,queuedUi,queuedDrive.fetchImpl,{onInitialReady:()=>queuedReady++});
 await connect(queuedUi);
 await wait(()=>queuedReady===1,'queue test starts from a verified cloud backup');
 const firstRename=await getProfile(queuedDb);
 firstRename.name='最初の名前';
 await saveProfile(queuedDb,firstRename);
 const beforeQueuedPuts=queuedDrive.putRequests;
 const releaseInFlight=queuedDrive.pauseNextUpload();
 const firstNamePass=queuedController.syncNow();
 await wait(()=>queuedDrive.putRequests===beforeQueuedPuts+1,'first rename is in-flight at Drive');
 assert.equal(queuedUi.get('driveSyncActivity').hidden,false,'busy upload shows progress');
 const secondRename=await getProfile(queuedDb);
 secondRename.name='二度目の名前';
 await saveProfile(queuedDb,secondRename);
 assert.equal((await getProfile(queuedDb)).name,'二度目の名前','local rename commits while Drive is stalled');
 assert.equal(await queuedController.syncNow(),'deferred','another rename queues work rather than overlapping PUT requests');
 const finalRename=await getProfile(queuedDb);
 finalRename.name='最後の名前';
 await saveProfile(queuedDb,finalRename);
 assert.equal((await getProfile(queuedDb)).name,'最後の名前','third rename is also saved before upload completes');
 assert.equal(await queuedController.syncNow(),'deferred','additional requests set only one pending flag');
 assert.equal(queuedDrive.putRequests,beforeQueuedPuts+1,'there is still exactly one in-flight PUT');
 releaseInFlight();
 assert.equal(await firstNamePass,'deferred','outdated upload must not be reported as fully synced');
 await wait(()=>queuedDrive.putRequests===beforeQueuedPuts+2&&queuedUi.get('driveSyncActivity').hidden
  &&queuedUi.status.textContent==='GoogleDrive同期済み','queued pass flushes the latest data and stops the spinner');
 assert.equal(deserializeDungeonSnapshot(queuedDrive.current).profile.name,'最後の名前','last local edit wins after a single queued upload');
 assert.equal(queuedDrive.putRequests,beforeQueuedPuts+2,'three edits coalesce into two serialized PUTs');
 assert.equal(queuedUi.get('googleDriveConflictDialog').open,false,'no restore chooser is needed for queued saves');

 // 2. Fresh local browser + existing named cloud backup: require only two
 // choices, never a name form until the user chooses a new game.
 const recoveringDb=await newDb(),recoveringUi=fakeUi(),recoveringDrive=remoteApi(firstDrive.current);
 let recoveringNames=0,reloads=0;
 start(recoveringDb,recoveringUi,recoveringDrive.fetchImpl,{
  onInitialReady:()=>recoveringNames++,onRestore:()=>reloads++
 });
 await connect(recoveringUi);
 await wait(()=>recoveringUi.get('googleDriveConflictDialog').open,'existing remote opens restore/new chooser');
 // Reproduce the actual startup modal behind the restore chooser.
 recoveringUi.get('backupSetupDialog').showModal();
 recoveringUi.get('setupWithoutBackup').hidden=false;
 recoveringUi.get('setupWithoutBackup').disabled=false;
 assert.equal(recoveringNames,0);
 assert.equal(recoveringUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,true,'only two startup choices');
 assert.equal(recoveringDrive.uploads,0,'never replace the stored name before an explicit choice');
 assert.deepEqual(recoveringDrive.operations,[],'a found backup must not receive POST or PATCH before choosing');
 recoveringUi.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').click();
 assert.equal(recoveringUi.get('setupWithoutBackup').hidden,true,'skip option disappears synchronously BEFORE chooser closes');
 assert.equal(recoveringUi.get('setupWithoutBackup').disabled,true,'no mis-tap can bypass chosen restoration');
 assert.equal(recoveringUi.get('googleDriveConflictDialog').open,false);
 await wait(()=>reloads===1,'existing player restored');
 assert.equal(recoveringUi.get('setupWithoutBackup').hidden,true,'skip option cannot flash before reload');
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
 assert.equal(newGameUi.get('setupWithoutBackup').hidden,true,'new game selection also protects the initial upload');
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
 assert.equal(failedSeedUi.get('googleDriveSpinner').hidden,true,'failed save stops the busy indicator');
 assert.equal(failedSeedUi.get('setupWithoutBackup').hidden,false,'failed initial connection permits deliberately choosing local-only play');
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

 // 11. A page refresh restores the short-lived token from a cookie, then
 // verifies the actual Drive backup without another Google authorization popup.
 const refreshUi=fakeUi(firstUi.cookies);
 let refreshReady=0;
 const loginsBeforeRefresh=auth.requests.length;
 const beforeRefreshDownloads=firstDrive.downloads;
 start(firstDb,refreshUi,firstDrive.fetchImpl,{onInitialReady:()=>refreshReady++});
 await wait(()=>refreshReady===1,'refresh resumes sync from the HTTPS cookie automatically');
 assert.equal(auth.requests.length,loginsBeforeRefresh,'page refresh needs no OAuth popup while the token is valid');
 assert.equal(refreshUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(refreshUi.button.hidden,true);
 assert.ok(firstDrive.downloads>beforeRefreshDownloads,'cookie reloading still verifies the remote backup');
 assert.deepEqual(firstDrive.operations,['POST','PATCH','PATCH'],'refresh must not create or overwrite a matching backup');

 // 12. If that cached token is revoked, reconnection is required and the
 // cookie must be discarded instead of repeatedly claiming the user is synced.
 const revokedCookies=createCookieJar(),revokedUi=fakeUi(revokedCookies);
 revokedUi.doc.cookie=firstUi.doc.cookie.split(';')[0]+'; Path=/magia-fantasy-larp-tool/; Secure; SameSite=Strict; Max-Age=100';
 const revokedDrive=remoteApi(firstDrive.current);
 revokedDrive.expire();
 start(firstDb,revokedUi,revokedDrive.fetchImpl);
 await wait(()=>revokedUi.status.textContent.includes('再接続'),'revoked cookie shows reconnect');
 assert.equal(revokedUi.button.hidden,false);
 assert.notEqual(revokedUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(revokedUi.doc.cookie,'','revoked cookie must be removed');

 // 13. Expired cookie values never authorize requests or claim success.
 const expiredCookies=createCookieJar(),expiredUi=fakeUi(expiredCookies);
 expiredUi.doc.cookie='__Secure-magiaDungeonDriveToken='+encodeURIComponent(JSON.stringify({token:'expired',expires:Date.now()-5000}))
  +'; Path=/magia-fantasy-larp-tool/; Secure; SameSite=Strict; Max-Age=100';
 const expiredDrive=remoteApi(firstDrive.current);
 start(firstDb,expiredUi,expiredDrive.fetchImpl);
 await wait(()=>!expiredUi.get('setupGoogleDrive').disabled,'OAuth initialized without using the expired cookie');
 assert.equal(expiredUi.doc.cookie,'');
 assert.equal(expiredUi.get('googleDriveExpiredDialog').open,true,'present but expired cookie shows the expiry dialog on refresh');
 assert.equal(expiredUi.get('googleDriveExpiredDialog').showModalCount,1,'expired cookie raises exactly one modal');
 assert.notEqual(expiredUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(expiredUi.button.hidden,false);
 assert.equal(expiredDrive.downloads,0,'expired token never reads Drive');

 // 14. Page reload without any token still prompts reconnect, not "synced".
 const lostTokenDb=await newDb(),lostTokenUi=fakeUi(),lostTokenDrive=remoteApi(firstDrive.current);
 await saveCloudSyncState(lostTokenDb,{fileId:'backup-1',hash:'last-success'});
 start(lostTokenDb,lostTokenUi,lostTokenDrive.fetchImpl);
 await wait(()=>lostTokenUi.status.textContent.includes('再接続'),'last-sync metadata should prompt reconnect');
 assert.equal(lostTokenUi.button.hidden,false,'the connection button remains available after reload');
 assert.notEqual(lostTokenUi.status.textContent,'GoogleDrive同期済み');
 assert.ok(!lostTokenUi.status.textContent.includes('同期済み'),'do not label a tokenless session synced');
 assert.deepEqual(lostTokenDrive.operations,[],'without OAuth, reload cannot touch Drive');

 // Legacy v1 local saves must be migrated into the strong on-disk proof
 // without asking a spurious legacy-format question, or overwriting Drive.
 async function legacyDevice(name,{withPhoto=false,withoutTimestamp=false,missingPhoto=false,tampered=false}={}){
  const factory=fakeIndexedDB(),db=await openStore(factory);
  const profile=await getProfile(db);
  profile.name=name;profile.level=4;profile.attempts=2;
  await saveProfile(db,profile);
  if(withPhoto||missingPhoto){
   const image=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});
   await putCircle(db,{id:'legacy-art',name:'受け継いだ魔法陣',image});
  }
  const original=await readDungeonSnapshot(db);
  const settings=factory.databases.get('magia-dungeon-v1').get('settings');
  const existing=settings.get('integrity');
  if(withoutTimestamp)settings.delete('integrity');
  else settings.set('integrity',{...existing,legacy:true});
  if(missingPhoto){
   const circles=factory.databases.get('magia-dungeon-v1').get('circles');
   circles.set('legacy-art',{...circles.get('legacy-art'),image:null});
  }
  if(tampered)settings.set('profile',{...settings.get('profile'),name:'未検証の変更'});
  assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'legacy');
  return {db,original};
 }
 // Identical cloud data: convert silently and recognize it as already synced.
 const sameLegacy=await legacyDevice('同一の旧データ',{withPhoto:true});
 const sameLegacyUi=fakeUi(),sameLegacyDrive=remoteApi(await serializeDungeonSnapshot(sameLegacy.original));
 let sameLegacyReady=0;
 start(sameLegacy.db,sameLegacyUi,sameLegacyDrive.fetchImpl,{onInitialReady:()=>sameLegacyReady++});
 await connect(sameLegacyUi);
 await wait(()=>sameLegacyReady===1,'matching legacy save converts automatically and initializes');
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(sameLegacy.db))).status,'valid');
 assert.equal((await readDungeonSnapshot(sameLegacy.db)).savedAt,sameLegacy.original.savedAt,'conversion does not fake a newer last save');
 assert.deepEqual(sameLegacyDrive.operations,[],'matching remote file is never overwritten during migration');
 assert.equal(sameLegacyUi.get('googleDriveConflictDialog').open,false,'no old-format decision dialog for matching saves');
 assert.equal(sameLegacyUi.status.textContent,'GoogleDrive同期済み');
 assert.deepEqual(new Uint8Array(await (await readDungeonSnapshot(sameLegacy.db)).circles[0].image.arrayBuffer()),
  new Uint8Array(await sameLegacy.original.circles[0].image.arrayBuffer()),'conversion preserves exact photo bytes');

 // Standalone legacy save: upgrade, upload the full save, and verify readback.
 const aloneLegacy=await legacyDevice('端末の古い冒険者',{withPhoto:true});
 const aloneUi=fakeUi(),aloneDrive=remoteApi();
 let aloneReady=0;
 start(aloneLegacy.db,aloneUi,aloneDrive.fetchImpl,{onInitialReady:()=>aloneReady++});
 await connect(aloneUi);
 await wait(()=>aloneReady===1,'standalone legacy save converts and uploads automatically');
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(aloneLegacy.db))).status,'valid');
 assert.equal((await readDungeonSnapshot(aloneLegacy.db)).savedAt,aloneLegacy.original.savedAt);
 assert.equal(deserializeDungeonSnapshot(aloneDrive.current).profile.name,'端末の古い冒険者');
 assert.equal(deserializeDungeonSnapshot(aloneDrive.current).circles.length,1,'converted photo is included in cloud backup');
 assert.deepEqual(aloneDrive.operations,['POST']);
 assert.equal(aloneUi.get('googleDriveConflictDialog').open,false,'legacy conversion does not prompt if no backup exists');

 // An established newer cloud save wins using the original (not migration)
 // savedAt; converting an old device must not overwrite its remote backup.
 const staleLegacy=await legacyDevice('古い端末の記録',{withPhoto:true});
 const newerProfile={...staleLegacy.original.profile,name:'Driveの新しい記録',level:9};
 const newerRemote=await serializeDungeonSnapshot({...staleLegacy.original,profile:newerProfile,savedAt:staleLegacy.original.savedAt+100000});
 const staleUi=fakeUi(),staleDrive=remoteApi(newerRemote);
 let staleRestored=0;
 start(staleLegacy.db,staleUi,staleDrive.fetchImpl,{onRestore:()=>staleRestored++});
 await connect(staleUi);
 await wait(()=>staleRestored===1,'newer Drive backup is restored after legacy conversion');
 assert.equal((await readDungeonSnapshot(staleLegacy.db)).profile.name,'Driveの新しい記録');
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(staleLegacy.db))).status,'valid');
 assert.deepEqual(staleDrive.operations,[],'local migration cannot upload over a newer cloud save');
 assert.equal(staleUi.get('googleDriveConflictDialog').open,false,'time ordering avoids a legacy-format chooser');

 // No historical timestamp means a real conflict cannot be ordered safely.
 // Keep both copies untouched and hide the irrelevant overwrite warning.
 const unknownLegacy=await legacyDevice('日時不明の端末',{withoutTimestamp:true});
 const unknownUi=fakeUi(),unknownDrive=remoteApi(newerRemote);
 start(unknownLegacy.db,unknownUi,unknownDrive.fetchImpl);
 await connect(unknownUi);
 await wait(()=>unknownUi.get('googleDriveConflictDialog').open,'only real unknown-timestamp conflicts require a choice');
 assert.equal((await readDungeonSnapshot(unknownLegacy.db)).savedAt,0,'migration does not invent a timestamp');
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(unknownLegacy.db))).status,'valid');
 assert.equal(unknownUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').hidden,true);
 assert.equal(unknownUi.get('googleDriveOverwriteWarning').hidden,true,'disallowed overwrite warning must not mislead');
 assert.ok(!unknownUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent.includes('旧形式'),'old-format dialog is replaced by an actual conflict explanation');
 assert.deepEqual(unknownDrive.operations,[],'neither side is silently overwritten');

 // Missing legacy photos or mismatching historic fingerprints must not be
 // legitimized by migration and uploaded as new trusted saves.
 const photoLegacy=await legacyDevice('画像が欠けた冒険者',{missingPhoto:true});
 const photoUi=fakeUi(),photoDrive=remoteApi(newerRemote);
 start(photoLegacy.db,photoUi,photoDrive.fetchImpl);
 await connect(photoUi);
 await wait(()=>photoUi.status.textContent.includes('画像が不足'),'legacy photo failure is explained');
 assert.deepEqual(photoDrive.operations,[],'missing photo never overwrites Drive');
 assert.equal(photoUi.get('googleDriveConflictDialog').open,false);
 const corruptLegacy=await legacyDevice('記録改ざん',{tampered:true});
 const corruptUi=fakeUi(),corruptDrive=remoteApi(newerRemote);
 start(corruptLegacy.db,corruptUi,corruptDrive.fetchImpl);
 await connect(corruptUi);
 await wait(()=>corruptUi.status.textContent.includes('整合性'),'mismatching historic proof prevents migration');
 assert.deepEqual(corruptDrive.operations,[],'corrupt local record never overwrites the healthy remote');

 // 15. An idle tab proactively notifies at token expiry without waiting
 // for another save. The dialog is one-shot until a fresh token is authorized.
 auth.setExpiresIn(61.5); // 1.5 seconds beyond the standard 60s expiry safety margin.
 const idleDb=await newDb(),idleUi=fakeUi(),idleDrive=remoteApi();
 let idleReady=0;
 const idleController=start(idleDb,idleUi,idleDrive.fetchImpl,{onInitialReady:()=>idleReady++});
 await connect(idleUi);
 await wait(()=>idleReady===1,'idle test starts with a verified Drive backup');
 assert.equal(idleUi.status.textContent,'GoogleDrive同期済み');
 await wait(()=>idleUi.get('googleDriveExpiredDialog').open,'idle timeout opens the expiry dialog without another sync');
 assert.equal(idleUi.get('googleDriveExpiredDialog').showModalCount,1,'idle expiry dialog opens once');
 assert.equal(idleUi.button.hidden,false,'expiry exposes the reconnect button');
 assert.match(idleUi.status.textContent,/再接続/);
 assert.equal(idleUi.doc.cookie,'','expiry clears the token cookie');
 assert.equal(await idleController.syncNow(),'deferred','expired credentials never upload again');
 assert.equal(idleUi.get('googleDriveExpiredDialog').showModalCount,1,'further save attempts cannot repeat the dialog');
 auth.setExpiresIn(3600);
 idleUi.get('googleDriveExpiredDialog').querySelector('[data-action="reconnect"]').click();
 await wait(()=>idleUi.status.textContent==='GoogleDrive同期済み','dialog reconnect verifies Drive again');
 assert.equal(idleUi.get('googleDriveExpiredDialog').open,false);
 idleDrive.expire();
 await idleController.sync(true);
 assert.equal(idleUi.get('googleDriveExpiredDialog').showModalCount,2,'a new expired login can notify once again');

 // 16. A previously verified account loses synced status when authorization ends.
 firstDrive.expire();
 await firstController.sync(true);
 assert.equal(firstUi.button.hidden,false,'expired auth reveals reconnect');
 assert.match(firstUi.status.textContent,/再接続/);
 assert.notEqual(firstUi.status.textContent,'GoogleDrive同期済み');
 assert.equal(firstUi.get('googleDriveExpiredDialog').open,true);
 assert.equal(firstUi.get('googleDriveExpiredDialog').showModalCount,1);
 await firstController.sync(true);
 assert.equal(firstUi.get('googleDriveExpiredDialog').showModalCount,1,'repeated failures do not show duplicate expiry modals');
 console.log('PASS Drive POST/PATCH, cookie resume, proactive one-shot idle expiry, login renewal, name sync, restore/new, readback and 401 detection');
}finally{auth.restore();}
