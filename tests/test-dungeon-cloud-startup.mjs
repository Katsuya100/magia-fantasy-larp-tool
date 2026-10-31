import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {openStore,getProfile,saveProfile,putCircle,readDungeonSnapshot,saveCloudSyncState,clearDungeonData} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
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
  this.id=id;this.hidden=['backupRollbackWarning','backupSetupSpinner','googleDriveSpinner','driveSyncActivity','disconnectGoogleDrive'].includes(id);this.disabled=false;this.open=false;this.textContent='';this.showModalCount=0;
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
 let version=1,value=initial,expired=false,uploads=0,downloads=0,failUpload=false,listPause=null,putPause=null,metadataPause=null,metadataRequests=0,putRequests=0;
 const operations=[],signals=[];
 const fetchImpl=async (url,options={})=>{
  if(options.signal)signals.push(options.signal);
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
  if(u.includes('?fields=id,name,modifiedTime')){
   metadataRequests++;
   if(metadataPause){const paused=metadataPause;metadataPause=null;await paused;}
   return Response.json({id,name:'magia-dungeon-save-v1.json',modifiedTime:modified()});
  }
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
  get metadataRequests(){return metadataRequests;},
  get downloads(){return downloads;},
  get operations(){return [...operations];},
  get signals(){return [...signals];},
  erase(){value=null;},
  pauseNextList(){
   let release;
   listPause=new Promise(resolve=>{release=resolve;});
   return ()=>{listPause=null;release();};
  },
  pauseNextMetadata(){
   let release;
   metadataPause=new Promise(resolve=>{release=resolve;});
   return ()=>release();
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
 assert.equal(firstUi.get('disconnectGoogleDrive').hidden,false,'connected profile exposes a disconnect action');
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

 // Different play histories never auto-merge: the choice is offered even
 // when a save changes during an already authenticated session.
 const separateDb=await newDb(),separateUi=fakeUi(),separateDrive=remoteApi();
 let separateReady=0;
 const separateController=start(separateDb,separateUi,separateDrive.fetchImpl,{onInitialReady:()=>separateReady++});
 await connect(separateUi);
 await wait(()=>separateReady===1,'play-lineage test starts with a verified backup');
 const originalHistory=deserializeDungeonSnapshot(separateDrive.current);
 const separateProfile=await getProfile(separateDb);
 separateProfile.playId=globalThis.crypto.randomUUID();
 separateProfile.name='新しい冒険者';separateProfile.level=99;separateProfile.xp=999999;
 await saveProfile(separateDb,separateProfile);
 const writesBeforeMismatch=separateDrive.uploads;
 const mismatchSync=separateController.syncNow();
 await wait(()=>separateUi.get('googleDriveConflictDialog').open,'different play immediately offers the chooser');
 assert.equal(separateDrive.uploads,writesBeforeMismatch,'different players cannot overwrite without selection');
 separateUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 assert.equal(await mismatchSync,'deferred');
 assert.equal(deserializeDungeonSnapshot(separateDrive.current).profile.playId,originalHistory.profile.playId);
 assert.equal((await getProfile(separateDb)).playId,separateProfile.playId);
 assert.equal(separateUi.doc.cookie,'','cancel disconnects instead of retrying an old flow');

 // After a *new authentication*, explicit restore is allowed even when the
 // new browser belongs to a completely different play.
 const optInDb=await newDb(),optInUi=fakeUi(),optInDrive=remoteApi(separateDrive.current);
 const beforeOptIn=(await getProfile(optInDb)).playId;
 assert.notEqual(beforeOptIn,originalHistory.profile.playId,'the second browser begins as an unrelated play');
 let optInRestored=0;
 start(optInDb,optInUi,optInDrive.fetchImpl,{onRestore:()=>optInRestored++});
 await connect(optInUi);
 await wait(()=>optInUi.get('googleDriveConflictDialog').open,'new authorization asks before crossing play lineage');
 assert.equal(optInDrive.uploads,0,'nothing is automatically uploaded across separate plays');
 optInUi.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').click();
 await wait(()=>optInRestored===1,'explicit post-auth restore can take over a different play');
 assert.equal((await getProfile(optInDb)).playId,originalHistory.profile.playId,'explicit restore adopts the remote play ID intact');
 assert.equal(optInDrive.uploads,0,'explicit restore does not overwrite the Drive backup');

 // Selecting the local player is itself the explicit overwrite decision.
 const differentDb=await newDb(),differentUi=fakeUi(),differentDrive=remoteApi(separateDrive.current);
 const differentProfile=await getProfile(differentDb);
 differentProfile.name='端末の別の冒険者';
 await saveProfile(differentDb,differentProfile);
 const differentId=differentProfile.playId;
 let differentReady=0;
 start(differentDb,differentUi,differentDrive.fetchImpl,{onInitialReady:()=>differentReady++});
 await connect(differentUi);
 await wait(()=>differentUi.get('googleDriveConflictDialog').open,'different history requires human choice');
 assert.equal(differentDrive.uploads,0,'neither copy is modified before choosing');
 differentUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').click();
 await wait(()=>differentReady===1,'local player selection finishes');
 assert.equal(deserializeDungeonSnapshot(differentDrive.current).profile.playId,differentId);
 assert.equal(deserializeDungeonSnapshot(differentDrive.current).profile.name,'端末の別の冒険者');

 // Explicit unlink leaves both copies intact, cancels autosaves and the
 // short-lived token cookie. Reconnection remains possible without data loss.
 const detachedDb=await newDb(),detachedUi=fakeUi(),detachedDrive=remoteApi();
 let detachedReady=0;
 const detachedController=start(detachedDb,detachedUi,detachedDrive.fetchImpl,{onInitialReady:()=>detachedReady++});
 await connect(detachedUi);
 await wait(()=>detachedReady===1,'disconnect test starts with a verified backup');
 assert.equal(detachedUi.get('disconnectGoogleDrive').hidden,false,'disconnect becomes available on verified connection');
 const storedBeforeDetach=await readDungeonSnapshot(detachedDb),remoteBeforeDetach=detachedDrive.current;
 const uploadedBeforeDetach=detachedDrive.uploads;
 detachedUi.get('disconnectGoogleDrive').click();
 assert.equal(detachedUi.doc.cookie,'','disconnect removes the short-lived authentication cookie');
 assert.equal(detachedUi.button.hidden,false,'disconnect makes the connect button available again');
 assert.equal(detachedUi.get('disconnectGoogleDrive').hidden,true,'disconnect button is hidden until reconnected');
 assert.equal(detachedUi.get('backupRiskWarning').hidden,false,'offline data-loss warning is shown after unlink');
 assert.equal(detachedUi.get('backupRollbackWarning').hidden,true,'concurrent-device warning is hidden when offline');
 assert.equal(detachedUi.get('googleDriveSpinner').hidden,true,'disconnect hides the active spinner');
 assert.equal(detachedUi.get('driveSyncActivity').hidden,true,'disconnect hides the global spinner');
 assert.match(detachedUi.status.textContent,/同期を解除しました/);
 assert.deepEqual(await readDungeonSnapshot(detachedDb),storedBeforeDetach,'disconnect does not delete or modify local game data');
 assert.equal(detachedDrive.current,remoteBeforeDetach,'disconnect does not delete or overwrite Drive backup');
 const detachedProfile=await getProfile(detachedDb);
 detachedProfile.name='解除後の冒険者';
 await saveProfile(detachedDb,detachedProfile);
 assert.equal(await detachedController.syncNow(),'deferred','manual sync cannot upload after disconnect');
 assert.equal(detachedDrive.uploads,uploadedBeforeDetach,'local edits after disconnect do not reach Drive');
 // A page refresh cannot silently log back in after the access cookie is gone.
 const refreshDetachedUi=fakeUi(detachedUi.cookies);
 const refreshDetachedController=start(detachedDb,refreshDetachedUi,detachedDrive.fetchImpl);
 await wait(()=>!refreshDetachedUi.button.disabled,'refreshed local-only view can reconnect');
 assert.equal(refreshDetachedUi.button.hidden,false,'refresh stays disconnected');
 assert.equal(refreshDetachedUi.get('disconnectGoogleDrive').hidden,true);
 assert.equal(detachedDrive.uploads,uploadedBeforeDetach,'refresh never uploads while disconnected');
 await connect(refreshDetachedUi,'connectGoogleDrive');
 await wait(()=>refreshDetachedUi.status.textContent==='GoogleDrive同期済み','manual reconnect resumes verified backup');
 assert.equal(deserializeDungeonSnapshot(detachedDrive.current).profile.name,'解除後の冒険者','reconnect uploads retained local edits');
 assert.equal(refreshDetachedUi.get('disconnectGoogleDrive').hidden,false);
 assert.equal(detachedDrive.operations.filter(method=>method==='POST').length,1,'reconnect updates existing backup, never creates a duplicate');

 // Disconnect during a Drive list waits for the existing request to settle
 // before dropping the cookie; no partial transfer or stale result is exposed.
 const detachingDb=await newDb(),detachingUi=fakeUi(),detachingDrive=remoteApi();
 let detachingReady=0;
 const detachingController=start(detachingDb,detachingUi,detachingDrive.fetchImpl,{onInitialReady:()=>detachingReady++});
 await connect(detachingUi);
 await wait(()=>detachingReady===1,'in-flight wait starts connected');
 const releaseStaleList=detachingDrive.pauseNextList();
 const detachingRequest=detachingController.syncNow();
 await wait(()=>!detachingUi.get('googleDriveSpinner').hidden,'network sync has begun');
 detachingUi.get('disconnectGoogleDrive').click();
 assert.equal(detachingUi.get('googleDriveSpinner').hidden,false,'spinner remains visible until the Drive request settles');
 assert.equal(detachingUi.get('disconnectGoogleDrive').disabled,true,'button cannot issue repeated unlink actions');
 assert.match(detachingUi.doc.cookie,/__Secure-magiaDungeonDriveToken/,'access cookie is retained until transfer finishes');
 assert.match(detachingUi.status.textContent,/完了後に解除/,'status explains unlink is waiting');
 assert.equal(detachingDrive.signals.some(signal=>signal.aborted),false,'disconnect does not abort an active request');
 releaseStaleList();
 assert.equal(await detachingRequest,'ready','active request completes normally before unlink');
 assert.equal(detachingUi.doc.cookie,'','cookie is cleared after the request finishes');
 assert.equal(detachingUi.get('googleDriveSpinner').hidden,true,'spinner clears after disconnect completes');
 assert.equal(detachingUi.get('disconnectGoogleDrive').hidden,true);
 assert.match(detachingUi.status.textContent,/同期を解除しました/,'completed work cannot override disconnected status');
 assert.equal(detachingDrive.uploads,1,'stale request cannot start another upload');
 const afterStaleEdit=await getProfile(detachingDb);
 afterStaleEdit.name='オフライン冒険者';
 await saveProfile(detachingDb,afterStaleEdit);
 assert.equal(await detachingController.syncNow(),'deferred','further updates stay local only');
 assert.equal(detachingDrive.uploads,1,'no queued upload survives disconnect');

 // If Drive is already receiving a PUT, wait until upload + readback ends.
 // Suppress additional queued transfers after the user requests unlink.
 const midDb=await newDb(),midUi=fakeUi(),midDrive=remoteApi();
 let midReady=0;
 const midController=start(midDb,midUi,midDrive.fetchImpl,{onInitialReady:()=>midReady++});
 await connect(midUi);
 await wait(()=>midReady===1,'upload-disconnect scenario starts connected');
 const midProfile=await getProfile(midDb);
 midProfile.name='送信途中';
 await saveProfile(midDb,midProfile);
 const releaseMidUpload=midDrive.pauseNextUpload();
 const uploadAtDisconnect=midController.syncNow();
 await wait(()=>midDrive.putRequests===2,'upload has reached Drive transport');
 const queuedProfile=await getProfile(midDb);
 queuedProfile.name='解除後の変更';
 await saveProfile(midDb,queuedProfile);
 assert.equal(await midController.syncNow(),'deferred','a second edit queues while the first PUT is active');
 midUi.get('disconnectGoogleDrive').click();
 assert.match(midUi.doc.cookie,/__Secure-magiaDungeonDriveToken/,'credential remains while an upload is in flight');
 assert.equal(midUi.get('driveSyncActivity').hidden,false,'ongoing upload stays visible');
 assert.equal(midDrive.signals.some(signal=>signal.aborted),false,'resumable PUT was not canceled');
 const downloadsBeforeWait=midDrive.downloads;
 const uploadsWhenDetached=midDrive.putRequests;
 releaseMidUpload();
 assert.equal(await uploadAtDisconnect,'deferred','an old upload finishes, but pending local changes remain unsynced');
 assert.ok(midDrive.downloads>downloadsBeforeWait,'unlink waited through remote readback verification');
 assert.equal(midDrive.putRequests,uploadsWhenDetached,'new queued upload is suppressed after unlink request');
 assert.equal(midDrive.signals.some(signal=>signal.aborted),false,'no Drive requests are aborted during unlink');
 assert.equal(midUi.doc.cookie,'','cookie is removed only after PUT and readback');
 assert.match(midUi.status.textContent,/同期を解除しました/,'upload completion cannot restore the connected status');
 assert.equal((await getProfile(midDb)).name,'解除後の変更','local game remains current after unlink');

 // Account deletion unlinks first so a refreshed blank profile cannot
 // silently reconnect and reopen the cloud restore/new dialog.
 const deleteDb=await newDb(),deleteUi=fakeUi(),deleteDrive=remoteApi();
 let deleteReady=0;
 const deleteController=start(deleteDb,deleteUi,deleteDrive.fetchImpl,{onInitialReady:()=>deleteReady++});
 await connect(deleteUi);
 await wait(()=>deleteReady===1,'account deletion begins from a connected session');
 const backupBeforeDelete=deleteDrive.current;
 await deleteController.disconnect();
 await clearDungeonData(deleteDb);
 assert.equal(deleteUi.doc.cookie,'','account deletion clears OAuth cookie before local save reset');
 assert.equal(deleteDrive.current,backupBeforeDelete,'account deletion leaves cloud backup on Drive');
 const afterDeleteUi=fakeUi(deleteUi.cookies);
 start(deleteDb,afterDeleteUi,deleteDrive.fetchImpl);
 await wait(()=>!afterDeleteUi.button.disabled,'blank device may choose when to connect');
 assert.equal(afterDeleteUi.get('googleDriveConflictDialog').open,false,'deleted account refresh never opens restore chooser');
 assert.equal(afterDeleteUi.get('disconnectGoogleDrive').hidden,true,'deleted account stays unlinked');
 assert.equal((await readDungeonSnapshot(deleteDb)).profile?.name,undefined,'local account is deleted');

 // 2. Fresh local browser + existing named cloud backup: require an explicit
 // choice, never a name form until the user chooses a new game or local save.
 const recoveringDb=await newDb(),recoveringUi=fakeUi(),recoveringDrive=remoteApi(firstDrive.current);
 let recoveringNames=0,reloads=0;
 start(recoveringDb,recoveringUi,recoveringDrive.fetchImpl,{
  onInitialReady:()=>recoveringNames++,onRestore:()=>reloads++
 });
 await connect(recoveringUi);
 await wait(()=>recoveringUi.get('googleDriveConflictDialog').open,'existing remote opens restore/new chooser');
 const recoveringDescription=recoveringUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent;
 const recoveringLocal=await readDungeonSnapshot(recoveringDb),recoveringRemote=deserializeDungeonSnapshot(recoveringDrive.current);
 assert.ok(recoveringDescription.includes('Drive：星の魔導士 Lv.'+recoveringRemote.profile.level+'（最終保存：'+new Date(recoveringRemote.savedAt).toLocaleString('ja-JP')+'）'));
 assert.ok(!recoveringDescription.includes('端末：'),'case 3 shows only the Drive player');
 // Reproduce the actual startup modal behind the restore chooser.
 recoveringUi.get('backupSetupDialog').showModal();
 recoveringUi.get('setupWithoutBackup').hidden=false;
 recoveringUi.get('setupWithoutBackup').disabled=false;
 assert.equal(recoveringNames,0);
 assert.equal(recoveringUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,true,'case 3 offers only Drive or new game');
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

 // Case 5 cancellation: both players remain intact, and local play can continue
 // without Drive. The cancel action is not offered in case 3.
 const laterDb=await newDb(),laterUi=fakeUi(),laterDrive=remoteApi(firstDrive.current);
 const laterNamed=await getProfile(laterDb);
 laterNamed.name='ローカルで続ける冒険者';
 await saveProfile(laterDb,laterNamed);
 let laterReady=0,laterRestores=0;
 const laterController=start(laterDb,laterUi,laterDrive.fetchImpl,{
  onInitialReady:()=>{laterReady++;laterUi.get('backupSetupDialog').close();},
  onRestore:()=>laterRestores++
 });
 laterUi.get('backupSetupDialog').showModal();
 await connect(laterUi);
 await wait(()=>laterUi.get('googleDriveConflictDialog').open,'different players present cancel');
 const laterLocalBefore=await readDungeonSnapshot(laterDb),laterRemoteBefore=laterDrive.current;
 assert.equal(laterUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,false);
 laterUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 await wait(()=>laterReady===1,'cancel resumes local startup after unlink');
 assert.equal(laterUi.get('googleDriveConflictDialog').open,false);
 assert.equal(laterUi.get('backupSetupDialog').open,false);
 assert.equal(laterUi.doc.cookie,'','cancel clears saved token');
 assert.equal(laterRestores,0);
 assert.deepEqual(await readDungeonSnapshot(laterDb),laterLocalBefore);
 assert.equal(laterDrive.current,laterRemoteBefore);
 assert.deepEqual(laterDrive.operations,[]);
 const resumedLocal=await getProfile(laterDb);
 resumedLocal.level=12;
 await saveProfile(laterDb,resumedLocal);
 assert.equal(await laterController.syncNow(),'deferred','cancel stops cloud syncing');
 assert.equal(laterDrive.current,laterRemoteBefore,'local-only edits never overwrite the Drive');
 const laterRefreshUi=fakeUi(laterUi.cookies);
 start(laterDb,laterRefreshUi,laterDrive.fetchImpl);
 await wait(()=>!laterRefreshUi.button.disabled,'later refresh can reconnect manually');
 assert.equal(laterRefreshUi.get('googleDriveConflictDialog').open,false);
 assert.equal(laterRefreshUi.button.hidden,false);

 // One adventurer can have a lower-level Drive checkpoint than the local
 // device. Explicit "引き継ぐ" is a deliberate choice: restore the verified
 // Drive copy regardless of the local level, progression or later timestamp.
 const deliberateDb=await newDb();
 const deliberateUi=fakeUi(),deliberateDrive=remoteApi(firstDrive.current);
 const oldCloud=deserializeDungeonSnapshot(firstDrive.current);
 const deliberateLocal=await getProfile(deliberateDb);
 deliberateLocal.name=oldCloud.profile.name;
 deliberateLocal.level=120;
 deliberateLocal.xp=99999;
 deliberateLocal.returns=42;
 await saveProfile(deliberateDb,deliberateLocal);
 await saveCloudSyncState(deliberateDb,{blocked:true});
 const localBeforeChoice=await readDungeonSnapshot(deliberateDb);
 assert.ok(deliberateLocal.level>oldCloud.profile.level,'same adventurer can appear more advanced locally');
 let deliberateRestores=0;
 start(deliberateDb,deliberateUi,deliberateDrive.fetchImpl,{onRestore:()=>deliberateRestores++});
 await connect(deliberateUi,'connectGoogleDrive');
 await wait(()=>deliberateUi.get('googleDriveConflictDialog').open,'same-adventurer divergent saves require a real choice');
 const deliberateDescription=deliberateUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent;
 assert.ok(deliberateDescription.includes('Drive：'+oldCloud.profile.name+' Lv.'+oldCloud.profile.level+'（最終保存：'+new Date(oldCloud.savedAt).toLocaleString('ja-JP')+'）'));
 assert.ok(deliberateDescription.includes('端末：'+deliberateLocal.name+' Lv.120（最終保存：'+new Date(localBeforeChoice.savedAt).toLocaleString('ja-JP')+'）'));
 assert.equal(deliberateDrive.uploads,0,'higher level alone never authorizes overwriting Drive');
 deliberateUi.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').click();
 await wait(()=>deliberateRestores===1,'explicit import is respected despite apparent local progress');
 const deliberatelyRestored=await readDungeonSnapshot(deliberateDb);
 assert.equal(deliberatelyRestored.profile.name,deliberateLocal.name,'restored checkpoint belongs to the same adventurer');
 assert.equal(deliberatelyRestored.profile.level,oldCloud.profile.level,'explicit import overrides higher local level');
 assert.equal(deliberatelyRestored.profile.xp,oldCloud.profile.xp,'explicit import overrides higher local XP');
 assert.equal(deliberatelyRestored.savedAt,oldCloud.savedAt,'the selected Drive saved timestamp is retained');
 assert.deepEqual(deliberateDrive.operations,[],'explicit restore never uploads the other checkpoint');
 assert.notEqual(deliberatelyRestored.savedAt,localBeforeChoice.savedAt,'local timestamp does not override explicit selection');

 // "あとで" also retains an existing higher-level local adventurer.
 const postponeDb=await newDb(),postponeUi=fakeUi(),postponeDrive=remoteApi(firstDrive.current);
 const postponeProfile=await getProfile(postponeDb);
 postponeProfile.name='端末の冒険者';postponeProfile.level=80;
 await saveProfile(postponeDb,postponeProfile);
 await saveCloudSyncState(postponeDb,{blocked:true});
 const postponeSnapshot=await readDungeonSnapshot(postponeDb),postponeRemote=postponeDrive.current;
 let postponeRestores=0;
 const postponeController=start(postponeDb,postponeUi,postponeDrive.fetchImpl,{onRestore:()=>postponeRestores++});
 await connect(postponeUi,'connectGoogleDrive');
 await wait(()=>postponeUi.get('googleDriveConflictDialog').open,'named local save can choose later');
 postponeUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 await wait(()=>postponeUi.doc.cookie==='','named later unlinks before further local play');
 assert.deepEqual(await readDungeonSnapshot(postponeDb),postponeSnapshot,'named later preserves level and local progress');
 assert.equal(postponeDrive.current,postponeRemote,'named later leaves Drive backup intact');
 assert.equal(postponeRestores,0,'named later does not restore');
 assert.equal(await postponeController.syncNow(),'deferred','named later keeps sync disconnected');

 // Case 3: explicitly choose a new game, replacing only the selected Drive
 // backup. There is no hidden second confirmation or old overwrite branch.
 const newGameDb=await newDb(),newGameUi=fakeUi(),newGameDrive=remoteApi(firstDrive.current);
 let newGameReady=0;
 const newGameController=start(newGameDb,newGameUi,newGameDrive.fetchImpl,{onInitialReady:()=>newGameReady++});
 await connect(newGameUi);
 await wait(()=>newGameUi.get('googleDriveConflictDialog').open,'new-game choice presented');
 assert.equal(newGameUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').textContent,'新しく始める');
 assert.equal(newGameUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').hidden,true);
 assert.equal(newGameDrive.uploads,0,'no write before the selection');
 newGameUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').click();
 await wait(()=>newGameReady===1,'new game opens naming after verified upload');
 assert.equal(newGameDrive.uploads,1);
 assert.deepEqual(newGameDrive.operations,['PATCH']);
 assert.ok(!deserializeDungeonSnapshot(newGameDrive.current).profile.name);
 const newGameProfile=await getProfile(newGameDb);
 newGameProfile.name='新たな冒険者';
 await saveProfile(newGameDb,newGameProfile);
 assert.equal(await newGameController.syncNow(),'ready','new name syncs');
 assert.equal(deserializeDungeonSnapshot(newGameDrive.current).profile.name,'新たな冒険者');
 assert.equal(newGameDrive.uploads,2);

 // Case 5: the same single chooser works from the profile screen.
 const profileChoiceDb=await newDb(),profileChoiceUi=fakeUi(),profileChoiceDrive=remoteApi(firstDrive.current);
 const namedLocal=await getProfile(profileChoiceDb);
 namedLocal.name='端末側の冒険者';
 await saveProfile(profileChoiceDb,namedLocal);
 let profileChoiceReady=0;
 start(profileChoiceDb,profileChoiceUi,profileChoiceDrive.fetchImpl,{onInitialReady:()=>profileChoiceReady++});
 await connect(profileChoiceUi,'connectGoogleDrive');
 await wait(()=>profileChoiceUi.get('googleDriveConflictDialog').open,'profile connection opens shared Drive chooser');
 const profileDescription=profileChoiceUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent;
 const profileLocal=await readDungeonSnapshot(profileChoiceDb),profileRemote=deserializeDungeonSnapshot(profileChoiceDrive.current);
 assert.ok(profileDescription.includes('Drive：星の魔導士 Lv.'+profileRemote.profile.level+'（最終保存：'+new Date(profileRemote.savedAt).toLocaleString('ja-JP')+'）'));
 assert.ok(profileDescription.includes('端末：端末側の冒険者 Lv.'+profileLocal.profile.level+'（最終保存：'+new Date(profileLocal.savedAt).toLocaleString('ja-JP')+'）'));
 assert.equal(profileChoiceDrive.uploads,0);
 assert.equal(profileChoiceUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').textContent,'端末側の冒険者で始める');
 profileChoiceUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').click();
 await wait(()=>profileChoiceReady===1,'one selection saves local data');
 assert.equal(profileChoiceDrive.uploads,1);
 assert.equal(profileChoiceDrive.operations[0],'PATCH');

 // Unlinking while the choice is open cancels it and leaves both copies intact.
 const confirmDb=await newDb(),confirmUi=fakeUi(),confirmDrive=remoteApi(firstDrive.current);
 const confirmController=start(confirmDb,confirmUi,confirmDrive.fetchImpl);
 await connect(confirmUi);
 await wait(()=>confirmUi.get('googleDriveConflictDialog').open,'unlink test has a chooser');
 const confirmBefore=confirmDrive.current;
 await confirmController.disconnect();
 assert.equal(confirmUi.get('googleDriveConflictDialog').open,false);
 assert.equal(confirmUi.doc.cookie,'');
 assert.equal(confirmDrive.current,confirmBefore);
 assert.deepEqual(confirmDrive.operations,[]);

 // A Drive file with no player progress is not a separate player.
 // Both empty backups are case 1 regardless of stale file-ID metadata.
 const seed=await readDungeonSnapshot(await newDb()),identicalDb=await newDb();
 const {replaceDungeonSnapshot}=await import('../assets/js/dungeon-store.mjs');
 await replaceDungeonSnapshot(identicalDb,seed);
 const identicalUi=fakeUi(),identicalDrive=remoteApi(await serializeDungeonSnapshot(seed));
 let identicalReady=0;
 start(identicalDb,identicalUi,identicalDrive.fetchImpl,{onInitialReady:()=>identicalReady++});
 await connect(identicalUi);
 await wait(()=>identicalReady===1,'two byte-identical unstarted saves are already synchronized');
 assert.equal(identicalUi.get('googleDriveConflictDialog').open,false);
 assert.equal(identicalDrive.uploads,0,'matching empty backup never rewrites');

 const blankOtherDb=await newDb(),blankOtherUi=fakeUi();
 const blankOtherDrive=remoteApi(await serializeDungeonSnapshot(seed));
 let blankOtherReady=0;
 start(blankOtherDb,blankOtherUi,blankOtherDrive.fetchImpl,{onInitialReady:()=>blankOtherReady++});
 await connect(blankOtherUi);
 await wait(()=>blankOtherReady===1,'two different empty placeholders synchronize without prompting');
 assert.equal(blankOtherUi.get('googleDriveConflictDialog').open,false);
 assert.deepEqual(blankOtherDrive.operations,['PATCH'],'local unstarted save replaces empty Drive placeholder');
 assert.equal(isPristineDungeonSnapshot(deserializeDungeonSnapshot(blankOtherDrive.current)),true);

 // Case 4: same play with a newer local timestamp uploads automatically.
 const newerLocalDb=await newDb(),newerLocalUi=fakeUi();
 const localOldProfile=await getProfile(newerLocalDb);
 localOldProfile.name='タイムスタンプ検証';
 await saveProfile(newerLocalDb,localOldProfile);
 const localOldSnapshot=await readDungeonSnapshot(newerLocalDb);
 const newerLocalDrive=remoteApi(await serializeDungeonSnapshot(localOldSnapshot));
 const localNewProfile=await getProfile(newerLocalDb);
 localNewProfile.level=18;
 await saveProfile(newerLocalDb,localNewProfile);
 const localNewSnapshot=await readDungeonSnapshot(newerLocalDb);
 assert.ok(localNewSnapshot.savedAt>localOldSnapshot.savedAt);
 let newerLocalReady=0;
 start(newerLocalDb,newerLocalUi,newerLocalDrive.fetchImpl,{onInitialReady:()=>newerLocalReady++});
 await connect(newerLocalUi);
 await wait(()=>newerLocalReady===1,'same play uses newer local save');
 assert.equal(deserializeDungeonSnapshot(newerLocalDrive.current).profile.level,18);
 assert.deepEqual(newerLocalDrive.operations,['PATCH']);
 assert.equal(newerLocalUi.get('googleDriveConflictDialog').open,false);

 // Case 4: a newer Drive snapshot takes precedence, including the same play ID.
 const newerRemoteDb=await newDb(),newerRemoteUi=fakeUi();
 const remoteLocalProfile=await getProfile(newerRemoteDb);
 remoteLocalProfile.name='Drive更新前';
 await saveProfile(newerRemoteDb,remoteLocalProfile);
 const remoteOldSnapshot=await readDungeonSnapshot(newerRemoteDb);
 const remoteFutureSnapshot={...remoteOldSnapshot,profile:{...remoteOldSnapshot.profile,name:'Drive更新後'},
  savedAt:remoteOldSnapshot.savedAt+100000};
 const newerRemoteDrive=remoteApi(await serializeDungeonSnapshot(remoteFutureSnapshot));
 let newerRemoteRestores=0;
 start(newerRemoteDb,newerRemoteUi,newerRemoteDrive.fetchImpl,{onRestore:()=>newerRemoteRestores++});
 await connect(newerRemoteUi);
 await wait(()=>newerRemoteRestores===1,'newer Drive snapshot restores automatically');
 assert.equal((await getProfile(newerRemoteDb)).name,'Drive更新後');
 assert.deepEqual(newerRemoteDrive.operations,[]);
 assert.equal(newerRemoteUi.get('googleDriveConflictDialog').open,false);

 // A local save made during an in-flight Drive restore must not disappear.
 // This exercises the IndexedDB transaction guard, not just a preflight check.
 const inFlightDb=await newDb(),inFlightUi=fakeUi();
 const inFlightProfile=await getProfile(inFlightDb);
 inFlightProfile.name='復元待機中の冒険者';
 await saveProfile(inFlightDb,inFlightProfile);
 const inFlightOld=await readDungeonSnapshot(inFlightDb);
 const inFlightRemote=await serializeDungeonSnapshot({...inFlightOld,
  profile:{...inFlightOld.profile,name:'古いDriveの冒険者'},
  savedAt:inFlightOld.savedAt+1});
 const inFlightDrive=remoteApi(inFlightRemote);
 const releaseMetadata=inFlightDrive.pauseNextMetadata();
 let unsafeRestores=0,inFlightReady=0;
 start(inFlightDb,inFlightUi,inFlightDrive.fetchImpl,{onRestore:()=>unsafeRestores++,onInitialReady:()=>inFlightReady++});
 await connect(inFlightUi);
 await wait(()=>inFlightDrive.metadataRequests===1,'Drive restore is paused before the atomic local check');
 for(let n=0;n<3;n++){
  const latestProfile=await getProfile(inFlightDb);
  latestProfile.name='通信中の新しい冒険者';
  await saveProfile(inFlightDb,latestProfile);
 }
 assert.ok((await readDungeonSnapshot(inFlightDb)).savedAt>inFlightOld.savedAt+1);
 releaseMetadata();
 await wait(()=>deserializeDungeonSnapshot(inFlightDrive.current).profile.name==='通信中の新しい冒険者',
  'new local write wins after guarded restore is rejected');
 assert.equal(unsafeRestores,0,'stale Drive result must never replace a concurrent local edit');
 assert.equal((await getProfile(inFlightDb)).name,'通信中の新しい冒険者');
 await wait(()=>inFlightReady===1,'initial connection finishes after the safe retry');
 assert.equal(inFlightUi.get('googleDriveConflictDialog').open,false);
 
 // Identical timestamps but different bytes must never silently discard a save.
 const tieDb=await newDb(),tieUi=fakeUi();
 const tieProfile=await getProfile(tieDb);
 tieProfile.name='同時刻のローカル';
 await saveProfile(tieDb,tieProfile);
 const tieLocal=await readDungeonSnapshot(tieDb);
 const tieDrive=remoteApi(await serializeDungeonSnapshot({...tieLocal,
  profile:{...tieLocal.profile,level:tieLocal.profile.level+1}}));
 let tieReady=0;
 start(tieDb,tieUi,tieDrive.fetchImpl,{onInitialReady:()=>tieReady++});
 await connect(tieUi);
 await wait(()=>tieUi.get('googleDriveConflictDialog').open,'equal timestamps with different bytes ask user');
 assert.equal(tieDrive.uploads,0);
 assert.equal(tieReady,0);
 assert.equal(tieUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').textContent,'端末の同時刻のローカルで始める');
 assert.equal(tieUi.get('googleDriveConflictDialog').querySelector('[data-action="restore"]').textContent,'Driveの同時刻のローカルで始める');
 tieUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 await wait(()=>tieUi.doc.cookie==='','equal timestamp cancel keeps both records');
 assert.equal((await getProfile(tieDb)).name,'同時刻のローカル');
 assert.equal(deserializeDungeonSnapshot(tieDrive.current).profile.level,tieLocal.profile.level+1);

 // Case 1: a previously synced but now empty Drive is created anew.
 // Stale file IDs, hashes, or blocked flags must not prevent creation.
 const missingDb=await newDb(),missingUi=fakeUi(),missingDrive=remoteApi();
 await saveCloudSyncState(missingDb,{fileId:'previous-id',hash:'previous-hash',blocked:false});
 let missingReady=0;
 start(missingDb,missingUi,missingDrive.fetchImpl,{onInitialReady:()=>missingReady++});
 await connect(missingUi);
 await wait(()=>missingReady===1,'missing cloud backup is recreated automatically');
 assert.equal(missingDrive.uploads,1);
 assert.deepEqual(missingDrive.operations,['POST']);
 assert.equal(missingUi.status.textContent,'GoogleDrive同期済み');

 // Case 2: the local save is real, and a formerly synced Drive is empty.
 // Preserve all local data, including magic-circle photos, when uploading.
 const soloDb=await newDb(),soloUi=fakeUi(),soloDrive=remoteApi();
 const soloProfile=await getProfile(soloDb);
 soloProfile.name='保存された端末冒険者';soloProfile.level=21;
 await saveProfile(soloDb,soloProfile);
 const soloBefore=await readDungeonSnapshot(soloDb);
 await saveCloudSyncState(soloDb,{fileId:'missing-previous-backup',hash:'old',blocked:true});
 let soloReady=0;
 start(soloDb,soloUi,soloDrive.fetchImpl,{onInitialReady:()=>soloReady++});
 await connect(soloUi);
 await wait(()=>soloReady===1,'local-only save uploads even after old cloud disappears');
 assert.equal(soloDrive.uploads,1);
 assert.deepEqual(soloDrive.operations,['POST']);
 assert.equal(deserializeDungeonSnapshot(soloDrive.current).profile.name,'保存された端末冒険者');
 assert.equal(deserializeDungeonSnapshot(soloDrive.current).profile.level,21);
 assert.deepEqual(await readDungeonSnapshot(soloDb),soloBefore);

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
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(unknownLegacy.db))).status,'legacy','unrelated old save is not silently migrated when lineage differs');
 assert.equal(unknownUi.get('googleDriveConflictDialog').querySelector('[data-action="overwrite"]').hidden,false,'unverified lineage is resolved by explicit selection');
 assert.match(unknownUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent,/選ばなかったデータ/);
 assert.ok(!unknownUi.get('googleDriveConflictDialog').querySelector('[data-role="description"]').textContent.includes('旧形式'),'old-format dialog is replaced by an actual conflict explanation');
 assert.deepEqual(unknownDrive.operations,[],'neither side is silently overwritten');

 // Missing legacy photos or mismatching historic fingerprints must not be
 // legitimized by migration and uploaded as new trusted saves.
 const photoLegacy=await legacyDevice('画像が欠けた冒険者',{missingPhoto:true});
 const photoUi=fakeUi(),photoDrive=remoteApi(newerRemote);
 start(photoLegacy.db,photoUi,photoDrive.fetchImpl);
 await connect(photoUi);
 await wait(()=>photoUi.get('googleDriveConflictDialog').open,'unrelated legacy save offers explicit restore but never automatic repair');
 assert.equal(photoDrive.uploads,0,'unverified local photos cannot overwrite without an explicit choice');
 assert.deepEqual(photoDrive.operations,[],'missing photo never overwrites Drive');
 const corruptLegacy=await legacyDevice('記録改ざん',{tampered:true});
 const corruptUi=fakeUi(),corruptDrive=remoteApi(newerRemote);
 let corruptReady=0;
 start(corruptLegacy.db,corruptUi,corruptDrive.fetchImpl,{onInitialReady:()=>corruptReady++});
 await connect(corruptUi);
 await wait(()=>corruptUi.get('googleDriveConflictDialog').open,'unrelated corrupt local save offers only explicit restore');
 assert.equal(corruptDrive.uploads,0,'unverified local data cannot overwrite without an explicit choice');
 assert.deepEqual(corruptDrive.operations,[],'corrupt local record never overwrites the healthy remote');
 const corruptLocalBefore=await readDungeonSnapshot(corruptLegacy.db);
 corruptUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 await wait(()=>corruptUi.doc.cookie==='','corrupt local later unlinks safely');
 assert.equal(corruptReady,1,'legacy local save remains playable after unlink');
 assert.deepEqual(await readDungeonSnapshot(corruptLegacy.db),corruptLocalBefore,'legacy local stays untouched');
 assert.deepEqual(corruptDrive.operations,[],'legacy local later never writes Drive');

 // A genuinely corrupt signed snapshot cannot bypass the startup integrity
 // gate through "あとで": unlinking is allowed, starting that save is not.
 const damagedFactory=fakeIndexedDB(),damagedDb=await openStore(damagedFactory);
 const damagedProfile=await getProfile(damagedDb);
 damagedProfile.name='署名済みの冒険者';
 await saveProfile(damagedDb,damagedProfile);
 const damagedSettings=damagedFactory.databases.get('magia-dungeon-v1').get('settings');
 damagedSettings.set('profile',{...damagedSettings.get('profile'),level:17});
 const damagedBefore=await readDungeonSnapshot(damagedDb);
 assert.equal((await verifyLocalSnapshot(damagedBefore)).status,'corrupt');
 const damagedUi=fakeUi(),damagedDrive=remoteApi(firstDrive.current);
 let damagedReady=0;
 start(damagedDb,damagedUi,damagedDrive.fetchImpl,{onInitialReady:()=>damagedReady++});
 await connect(damagedUi);
 await wait(()=>damagedUi.get('googleDriveConflictDialog').open,'corrupt verified local save requires a decision');
 damagedUi.get('googleDriveConflictDialog').querySelector('[data-action="later"]').click();
 await wait(()=>damagedUi.doc.cookie==='','later clears credentials even with corrupt local data');
 assert.equal(damagedReady,0,'corrupt signed local save cannot enter gameplay');
 assert.deepEqual(await readDungeonSnapshot(damagedDb),damagedBefore,'corrupt local stays unmodified');
 assert.deepEqual(damagedDrive.operations,[],'corrupt later never writes Drive');

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
 // The Drive file may vanish while OAuth is expired. Re-authentication must
 // pass through the same five cases (case 2), never the old missing-file error.
 idleDrive.erase();
 auth.setExpiresIn(3600);
 idleUi.get('googleDriveExpiredDialog').querySelector('[data-action="reconnect"]').click();
 await wait(()=>idleUi.status.textContent==='GoogleDrive同期済み','dialog reconnect recreates missing Drive backup');
 assert.deepEqual(idleDrive.operations,['POST','POST'],'reauthentication re-enters case 2');
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
