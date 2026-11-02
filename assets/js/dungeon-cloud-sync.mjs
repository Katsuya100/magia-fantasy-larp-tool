import {showDungeonDialog,closeDungeonDialog} from './dungeon-ui-transitions.mjs?v=20261102.320';
import {GOOGLE_CLIENT_ID} from './dungeon-google-config.mjs';
import {createDungeonDrive,DriveAuthError,DRIVE_SCOPE} from './dungeon-cloud-drive.mjs?v=20261102.321';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot,snapshotHash} from './dungeon-cloud-snapshot.mjs';
import {readDungeonSnapshot,replaceDungeonSnapshot,getCloudSyncState,saveCloudSyncState,getDriveSyncIntent,saveDriveSyncIntent,onDungeonDataChange,putCircle,getProfile,saveProfile} from './dungeon-store.mjs?v=20261102.320';
import {verifyLocalSnapshot,digestPhoto,recordFingerprint} from './dungeon-cloud-integrity.mjs';
import {nextXp} from './dungeon-core.mjs?v=20261102.320';
import {highestRankLayer} from './dungeon-ranks.mjs';
import {deepestReturnedLayer,deepestReachedLayer} from './dungeon-progress.mjs';

// profile.xp is only EXP remaining after level-ups; reconstruct earned EXP
// from the same level thresholds used by the actual game.
export function cumulativeDungeonXp(profile){
 const level=Number(profile?.level);
 let earned=Math.max(0,Number(profile?.xp)||0);
 if(!Number.isSafeInteger(level)||level<1)return earned;
 for(let current=1;current<level;current++)earned+=nextXp(current);
 return earned;
}

// Compare the SAME play history lexicographically: rank, earned EXP,
// deepest successful return, deepest reach. Timestamp is checked last.
export function compareDungeonProgress(local,remote){
 const measures=[highestRankLayer,cumulativeDungeonXp,deepestReturnedLayer,deepestReachedLayer];
 for(const measure of measures){
  const left=measure(local),right=measure(remote);
  if(left!==right)return left>right?1:-1;
 }
 return 0;
}
export function decideCloudSync({file,localHash,remoteHash,localProfile=null,remoteProfile=null,localSavedAt=0,remoteSavedAt=0}){
 if(!file)return 'upload';
 if(localHash&&remoteHash&&localHash===remoteHash)return 'synced';
 const progress=compareDungeonProgress(localProfile,remoteProfile);
 if(progress!==0)return progress>0?'upload':'download';
 const localTime=Number(localSavedAt),remoteTime=Number(remoteSavedAt);
 if(Number.isFinite(localTime)&&Number.isFinite(remoteTime)&&localTime>0&&remoteTime>0&&localTime!==remoteTime)
  return localTime>remoteTime?'upload':'download';
 // When all progress measures and timestamps tie (or time is unavailable),
 // either copy is acceptable. Choose local deterministically; no extra dialog.
 return 'upload';
}
// Never infer game continuity from player name, level or timestamps.
export function canAutoSyncPlay({localPlayId,remotePlayId,identical=false}){
 if(localPlayId&&remotePlayId)return localPlayId===remotePlayId;
 // Missing lineage is not an existing player's permission to overwrite:
 // only byte-identical saves with both IDs absent are automatically the same.
 return !localPlayId&&!remotePlayId&&identical;
}
export function initDungeonCloudSync({db,button,status,onRestore,onInitialReady=()=>{},onRepairImages=async()=>false,onImagesRestored=async()=>{},fetchImpl=globalThis.fetch,windowImpl=globalThis.window}){
 if(!GOOGLE_CLIENT_ID){
  windowImpl?.document?.getElementById('setupGoogleDrive')?.setAttribute('disabled','');
  status.textContent='GoogleDriveを利用できません。';
  const setupStatus=windowImpl?.document?.getElementById('backupSetupStatus');
  if(setupStatus)setupStatus.textContent=status.textContent;
  button.disabled=true;
  return {ready:false};
 }
 let client=null,drive=null,accessToken='',expires=0,busy=false,again=false,timer=null,expiryTimer=null,restoring=false,stopped=false;
 let lastVerifiedLocalSavedAt=null,syncIndicatorVisible=false;
 let expiryNoticeShown=false,choicePending=false,validatedDrive=null,initialChoiceCommitted=false,initialRetryQueued=false,restoredInSession=false;
 let connectionEpoch=0,activeSyncEpoch=0,requestController=null,oauthPending=false,renewalPending=false,manuallyDisconnected=false,pendingChoiceCancel=null;
 let disconnectPending=false,disconnectPromise=null,resolveDisconnect=null;
 let renewalAttemptedExpiry=0,renewalGestureAttemptedExpiry=0,tokenIssuedAt=0;
 const isCurrent=epoch=>epoch===connectionEpoch&&Boolean(drive);
 const ensureCurrent=epoch=>{if(!isCurrent(epoch))throw Error('Drive同期は解除されました。');};
 // A short-lived access token is kept only in an HTTPS, path-scoped cookie so
 // a page refresh can resume syncing. Never persist a Google refresh token.
 const cookieName='__Secure-magiaDungeonDriveToken';
 const location=windowImpl?.location;
 const cookiePath=location?.pathname?.slice(0,location.pathname.lastIndexOf('/')+1)||'/';
 const canUseCookie=location?.protocol==='https:'&&Boolean(windowImpl?.document);
 function clearAuthCookie(){
  if(canUseCookie)doc.cookie=cookieName+'=; Path='+cookiePath+'; Secure; SameSite=Strict; Max-Age=0';
 }
 function readAuthCookie(){
  if(!canUseCookie)return null;
  const raw=String(doc.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(cookieName+'='));
  if(!raw)return null;
  try{
   const value=JSON.parse(decodeURIComponent(raw.slice(cookieName.length+1)));
   if(typeof value.token==='string'&&value.token.length>0&&Number.isFinite(value.expires)){
    if(value.expires>Date.now()+1000)return value;
    // A present but stale cookie is positive evidence that authentication expired.
    expireConnection();
    return null;
   }
  }catch{ /* A damaged or expired cookie cannot authorize Drive. */ }
  clearAuthCookie();
  return null;
 }
 function saveAuthCookie(token,expiresAt){
  if(!canUseCookie)return;
  const ttl=Math.floor((expiresAt-Date.now())/1000);
  if(ttl<=0){clearAuthCookie();return;}
  doc.cookie=cookieName+'='+encodeURIComponent(JSON.stringify({token,expires:expiresAt}))
   +'; Path='+cookiePath+'; Secure; SameSite=Strict; Max-Age='+ttl;
 }
 const doc=windowImpl?.document;
 const conflictDialog=doc?.getElementById('googleDriveConflictDialog');
 const setupButton=doc?.getElementById('setupGoogleDrive');
 const disconnectButton=doc?.getElementById('disconnectGoogleDrive');
 const riskWarning=doc?.getElementById('backupRiskWarning');
 const rollbackWarning=doc?.getElementById('backupRollbackWarning');
 const localOnlyButton=doc?.getElementById('setupWithoutBackup');
 const syncingIcons=[doc?.getElementById('backupSetupSpinner'),doc?.getElementById('googleDriveSpinner')];
 function setSyncing(active){
  syncIndicatorVisible=Boolean(active);
  for(const spinner of syncingIcons)if(spinner)spinner.hidden=!active;
  const activity=doc?.getElementById('driveSyncActivity');
  if(activity)activity.hidden=!active;
  status?.setAttribute?.('aria-busy',String(active));
  doc?.getElementById('backupSetupStatus')?.setAttribute?.('aria-busy',String(active));
 }
 function lockLocalOnly(locked){
  if(!localOnlyButton)return;
  localOnlyButton.disabled=locked;
  localOnlyButton.hidden=locked;
 }
 function completeInitialCheck(outcome){
  if(disconnectPending||manuallyDisconnected)return;
  // A concurrent save may require another network pass before startup
  // can consider the backup connected.
  if(outcome==='deferred'&&initialRetryQueued)return;
  if(outcome!=='deferred')initialRetryQueued=false;
  if((outcome==='ready'||outcome==='start-new')&&!restoredInSession)onInitialReady();
  else if(outcome!=='restored'&&!initialChoiceCommitted)lockLocalOnly(false);
 }
 const show=message=>{const lines=message.replace(/。(?!$)/g,'。\n');status.textContent=lines;const setup=doc?.getElementById('backupSetupStatus');if(setup)setup.textContent=lines;};
 function connectedPresentation(){
  if(disconnectButton)disconnectButton.hidden=false;
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  if(riskWarning)riskWarning.hidden=true;
  if(rollbackWarning)rollbackWarning.hidden=false;
 }
 function reconnectPresentation(message){
  if(disconnectButton)disconnectButton.hidden=true;
  button.hidden=false;
  button.textContent='GoogleDriveに同期する';
  if(setupButton)setupButton.hidden=false;
  if(riskWarning)riskWarning.hidden=false;
  if(rollbackWarning)rollbackWarning.hidden=true;
  if(message)show(message);
 }
 async function syncedPresentation(savedAt){
  await saveDriveSyncIntent(db,true);
  if(disconnectPending)return;
  if(Number.isFinite(Number(savedAt)))lastVerifiedLocalSavedAt=Number(savedAt);
  connectedPresentation();
  show('GoogleDrive同期済み');
 }
 function expireConnection(){
  clearTimeout(expiryTimer);
  expiryTimer=null;
  clearAuthCookie();
  oauthPending=false;renewalPending=false;
  accessToken='';drive=null;expires=0;validatedDrive=null;
  requestController?.abort();requestController=null;
  connectionEpoch++;
  reconnectPresentation('認証が切れました。再接続してください。');
  if(!expiryNoticeShown){
   expiryNoticeShown=true;
   const dialog=doc?.getElementById('googleDriveExpiredDialog');
   if(dialog&&!dialog.open)showDungeonDialog(dialog);
  }
 }
 // The GIS token model may require a user gesture; renewal is best-effort.
 // A failed attempt keeps the original token usable until it expires.
 const RENEW_BEFORE_MS=5*60*1000;
 function tryRenewToken(fromUserGesture=false){
  if(!drive||!client||stopped||disconnectPending||manuallyDisconnected||oauthPending)return;
  if(!fromUserGesture&&renewalAttemptedExpiry===expires)return;
  if(fromUserGesture&&renewalGestureAttemptedExpiry===expires)return;
  const lead=Math.min(RENEW_BEFORE_MS,Math.max(0,Math.floor((expires-tokenIssuedAt)/5)));
  if(Date.now()<expires-lead||Date.now()>=expires)return;
  if(fromUserGesture)renewalGestureAttemptedExpiry=expires;
  renewalAttemptedExpiry=expires;
  oauthPending=true;
  renewalPending=true;
  try{client.requestAccessToken({prompt:''});}
  catch{
   oauthPending=false;
   renewalPending=false;
  }
 }
 function watchTokenExpiry(){
  clearTimeout(expiryTimer);
  expiryTimer=null;
  if(!drive||!expires||stopped||disconnectPending)return;
  const remaining=expires-Date.now();
  if(remaining<=0){expireConnection();return;}
  // Use a fraction of short token lifetimes to avoid immediate reentry.
  const lead=Math.min(RENEW_BEFORE_MS,Math.max(0,Math.floor((expires-tokenIssuedAt)/5)));
  const renewalDue=expires-lead;
  if(client&&!oauthPending&&renewalAttemptedExpiry!==expires&&Date.now()>=renewalDue)tryRenewToken();
  const delay=client&&renewalAttemptedExpiry!==expires
   ?Math.max(1,renewalDue-Date.now()):Math.max(1,expires-Date.now());
  expiryTimer=setTimeout(()=>watchTokenExpiry(),Math.min(delay,2147483647));
  expiryTimer?.unref?.();
 }
 function schedule(){
  if(!drive||stopped||restoring||choicePending||disconnectPending)return;
  // One upload at a time; changes made during network IO only reserve one
  // follow-up pass, which will read the latest IndexedDB snapshot.
  if(busy){again=true;return;}
  clearTimeout(timer);
  timer=setTimeout(()=>{void sync(false);},1800);
 }
 function saveDetails(label,snapshot){
  const name=snapshot?.profile?.name;
  const savedAt=Number(snapshot?.savedAt);
  const displayName=typeof name==='string'&&name.trim()?name.trim():'未設定';
  const level=Number(snapshot?.profile?.level);
  const date=Number.isFinite(savedAt)&&savedAt>0?new Date(savedAt).toLocaleString('ja-JP'):'不明';
  return label+'：'+displayName+' Lv.'+(Number.isInteger(level)&&level>0?level:'不明')+'（最終保存：'+date+'）';
 }
 // Every collision uses the same chooser. An unnamed local save is a new game,
 // not a second player. Neither copy changes until the user selects one.
 function chooseCloud({local,remote,mode='different',allowLocal=true,canStartLocal=true}){
  return new Promise(resolve=>{
   if(!conflictDialog?.showModal){resolve('cancel');return;}
   // This is a decision wait, not an in-flight Drive transfer.
   // An actual restore/upload will resume the activity indicator itself.
   setSyncing(false);
   show('バックアップを選択してください');
   choicePending=true;
   const fresh=mode==='fresh';
   const remoteName=String(remote?.profile?.name||'').trim()||'バックアップ';
   const localName=String(local?.profile?.name||'').trim()||'端末の冒険者';
   const description=conflictDialog.querySelector('[data-role="description"]');
   description.textContent=(fresh
    ?saveDetails('Drive',remote)
    :[saveDetails('端末',local),saveDetails('Drive',remote)].join('\n'))
    +'\n選ばなかったデータは上書きされます。';
   const title=doc?.getElementById('googleDriveConflictTitle');
   if(title)title.textContent='バックアップ情報が見つかりました';
   const localButton=conflictDialog.querySelector('[data-action="overwrite"]');
   const driveButton=conflictDialog.querySelector('[data-action="restore"]');
   const cancelButton=conflictDialog.querySelector('[data-action="later"]');
   const closeButton=conflictDialog.querySelector('[data-action="cancel"]');
   localButton.hidden=!allowLocal;
   // Two distinct saves can have the same visible name (especially an equal-
   // timestamp conflict). In that case identify the storage side on buttons.
   const sameName=!fresh&&localName===remoteName;
   localButton.textContent=fresh?'新しく始める':(sameName?'端末の':'')+localName+'で始める';
   driveButton.textContent=(sameName?'Driveの':'')+remoteName+'で始める';
   cancelButton.hidden=fresh;
   cancelButton.textContent='キャンセル';
   if(closeButton)closeButton.hidden=fresh;
   const finish=choice=>{
    if(choice==='restore'||choice==='overwrite'){
     initialChoiceCommitted=true;
     lockLocalOnly(true);
    }
    choicePending=false;
    pendingChoiceCancel=null;
    closeDungeonDialog(conflictDialog);
    for(const [element,name,handler] of handlers)element?.removeEventListener(name,handler);
    resolve(choice);
   };
   const cancel=()=>{
    finish('cancel');
    // Cancel means no cloud writes and local-only play until reconnected.
    void disconnect().then(()=>{if(canStartLocal)onInitialReady();});
   };
   const handlers=[
    [driveButton,'click',()=>finish('restore')],
    [localButton,'click',()=>finish('overwrite')],
    [cancelButton,'click',cancel],
    [closeButton,'click',cancel],
    [conflictDialog,'cancel',event=>{event.preventDefault();if(!fresh)cancel();}]
   ];
   for(const [element,name,handler] of handlers)element?.addEventListener(name,handler);
   pendingChoiceCancel=()=>finish('cancel');
   showDungeonDialog(conflictDialog);
  });
 }
 async function checkedRemote(file,refresh=false){
  if(!file)return {valid:false,data:null,invalidImages:[]};
  if(!refresh&&validatedDrive?.id===file.id&&validatedDrive.modifiedTime===file.modifiedTime)return validatedDrive.result;
  try{
   const remoteText=await drive.download(file.id);
   ensureCurrent(activeSyncEpoch);
   const data=deserializeDungeonSnapshot(remoteText);
   const invalidImages=[];
   for(const circle of data.circles){
    if(!circle.image){invalidImages.push(circle.id);continue;}
    try{await digestPhoto(circle.image);}catch{invalidImages.push(circle.id);}
   }
   const result={valid:invalidImages.length===0,data,invalidImages,text:remoteText,hash:await snapshotHash(remoteText),trusted:true};
   if(result.valid)validatedDrive={id:file.id,modifiedTime:file.modifiedTime,result};
   return result;
  }catch(error){
   if(error instanceof DriveAuthError)throw error;
   return {valid:false,data:null,invalidImages:[],error};
  }
 }
 async function restore(remote,file,{expectedLocal=null}={}){
  if(!syncIndicatorVisible){setSyncing(true);show('同期中…');}
  if(!remote.valid)throw Error('破損したDriveバックアップは復元できません。');
  ensureCurrent(activeSyncEpoch);
  // The selected source was compared against this particular local snapshot.
  // An in-flight save must not be lost while Drive metadata is being checked.
  let expectedCurrentRecords=null;
  if(expectedLocal?.profile){
   try{expectedCurrentRecords=recordFingerprint(expectedLocal);}
   catch{ /* An invalid local record can only be replaced by explicit recovery. */ }
  }
  const current=await drive.metadata(file.id);
  ensureCurrent(activeSyncEpoch);
  if(current.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  lockLocalOnly(true);
  try{
   await replaceDungeonSnapshot(db,remote.data,{expectedCurrentRecords,expectedCurrentSavedAt:expectedLocal?.savedAt??null});
  }catch(error){
   if(/別のタブ(?:がセーブを更新|でセーブが更新され)/.test(String(error?.message||''))){
    again=true;
    return 'deferred';
   }
   throw error;
  }
  restoring=true;
  try{
   await saveCloudSyncState(db,{fileId:file.id,hash:remote.hash,modifiedTime:file.modifiedTime});
   await onRestore();
   ensureCurrent(activeSyncEpoch);
   restoredInSession=true;
   // Save made during view hydration still must reach Drive.
   const latest=await readDungeonSnapshot(db);
   ensureCurrent(activeSyncEpoch);
   if(latest.savedAt!==remote.data.savedAt){again=true;show('同期中…');return 'deferred';}
   again=false;
   await syncedPresentation(latest.savedAt);
   return 'restored';
  }catch(error){again=false;throw error;}
  finally{restoring=false;}
 }
 async function upload(snapshot,file,{allowInitial=false}={}){
  if(!syncIndicatorVisible){setSyncing(true);show('同期中…');}
  // The exact serialized, inspected bytes are uploaded; do not recompute
  // a new checksum from damaged IndexedDB data after verification.
  ensureCurrent(activeSyncEpoch);
  const verification=await verifyLocalSnapshot(snapshot);
  ensureCurrent(activeSyncEpoch);
  if(isPristineDungeonSnapshot(snapshot)&&!allowInitial)throw Error('初期セーブのアップロードは接続確認時のみ許可します。');
  if(verification.status!=='valid')throw Error('端末セーブの整合性を検証できないため、バックアップの上書きを中止しました。');
  const text=await serializeDungeonSnapshot(snapshot);
  ensureCurrent(activeSyncEpoch);
  // A concurrent game write must not make an earlier snapshot clobber a later one.
  const latest=await readDungeonSnapshot(db);
  ensureCurrent(activeSyncEpoch);
  if(latest.savedAt!==snapshot.savedAt) {again=true;return 'deferred';}
  if(file){
   const now=await drive.metadata(file.id);
   ensureCurrent(activeSyncEpoch);
   if(now.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  }
  show('保存中…');
  const saved=await drive.upload(text,file?.id||null);
  ensureCurrent(activeSyncEpoch);
  const hash=await snapshotHash(text);
  // An upload response is not enough: verify the exact remote contents.
  const downloaded=await drive.download(saved.id);
  ensureCurrent(activeSyncEpoch);
  if(await snapshotHash(downloaded)!==hash)throw Error('Drive側の保存内容が一致しません。');
  ensureCurrent(activeSyncEpoch);
  const confirmed=deserializeDungeonSnapshot(downloaded);
  validatedDrive={id:saved.id,modifiedTime:saved.modifiedTime,result:{valid:true,data:confirmed,hash,text:downloaded,invalidImages:[],trusted:true}};
  await saveCloudSyncState(db,{fileId:saved.id,modifiedTime:saved.modifiedTime,hash});
  const newest=await readDungeonSnapshot(db);
  ensureCurrent(activeSyncEpoch);
  if(newest.savedAt!==snapshot.savedAt){
   again=true;
   show('同期中…');
   return 'deferred';
  }
  await syncedPresentation(snapshot.savedAt);
  return 'ready';
 }
 async function sync(initial=false){
  if(!drive||stopped||choicePending||disconnectPending)return 'deferred';
  if(busy){again=true;return 'deferred';}
  if(Date.now()>=expires){expireConnection();return 'deferred';}
  busy=true;
  activeSyncEpoch=connectionEpoch;
  let result='deferred';
  try{
   let local=await readDungeonSnapshot(db);
   // A read-only cloud recheck does not represent a new save.
   if(initial||lastVerifiedLocalSavedAt===null||local.savedAt!==lastVerifiedLocalSavedAt){
    setSyncing(true);show('同期中…');
   }
   let verification=await verifyLocalSnapshot(local);
   const files=await drive.list();
   ensureCurrent(activeSyncEpoch);
   if(files.length>1){
    show('Driveに複数のバックアップがあります。データ保護のため同期できません。');
    return result;
   }
   const file=files[0]||null;
   const remote=await checkedRemote(file,initial);
   ensureCurrent(activeSyncEpoch);
   if(file&&!remote.valid){
    show('Driveのバックアップを検証できません。同期を停止しました。');
    return result;
   }

   // A missing Drive backup always means create it, even if this device
   // previously synced another file or account. No historical file-ID gate.
   if(!file){

    if(verification.status!=='valid'){
     show('端末セーブを検証できません。バックアップを作成できません。');
     return result;
    }
    if(!local.profile?.playId){
     await saveProfile(db,await getProfile(db));
     local=await readDungeonSnapshot(db);
    }
    return await upload(local,null,{allowInitial:true});
   }

   // Corrupt local data is an error, never an empty/new game. A verified
   // Drive copy can be explicitly restored without authorizing an upload.
   if(verification.status==='corrupt'){
    const choice=await chooseCloud({local,remote:remote.data,mode:'different',allowLocal:false,canStartLocal:false});
    if(choice==='restore')return await restore(remote,file,{expectedLocal:local});
    return result;
   }
   const pristine=isPristineDungeonSnapshot(local);
   if(pristine){
    if(isPristineDungeonSnapshot(remote.data)){
     // Both saves have no player progress. An empty placeholder file is not
     // a separate adventurer or a reason to show a destructive choice.
     const localHash=await snapshotHash(await serializeDungeonSnapshot(local));
     if(localHash===remote.hash){
      await saveCloudSyncState(db,{fileId:file.id,hash:remote.hash,modifiedTime:file.modifiedTime});
      await syncedPresentation(local.savedAt);
      return 'ready';
     }
     return await upload(local,file,{allowInitial:true});
    }
    // Case 3: local has no player progress but Drive contains an adventurer.
    const choice=await chooseCloud({local,remote:remote.data,mode:'fresh'});
    if(choice==='restore')return await restore(remote,file,{expectedLocal:local});
    if(choice==='overwrite'){
     if(verification.status!=='valid'){
      show('端末セーブを検証できません。');return result;
     }
     const outcome=await upload(local,file,{allowInitial:true});
     return outcome==='ready'?'start-new':outcome;
    }
    return result;
   }

   // A valid but untouched Drive placeholder contains no player data.
   // Treat it as an empty backup, rather than inventing a sixth lineage conflict.
   if(isPristineDungeonSnapshot(remote.data)){

    if(verification.status!=='valid'){
     show('端末セーブを検証できません。バックアップを更新できません。');
     return result;
    }
    return await upload(local,file,{allowInitial:true});
   }
   const localPlayId=local.profile?.playId,remotePlayId=remote.data?.profile?.playId;
   let identical=false;
   if(!localPlayId&&!remotePlayId&&verification.status!=='corrupt'){
    const encoded=await serializeDungeonSnapshot(local);
    identical=(await snapshotHash(encoded))===remote.hash;
   }
   const samePlay=canAutoSyncPlay({localPlayId,remotePlayId,identical});
   if(!samePlay){
    // Case 5: different (or unidentifiable) players always require a choice.
    // No re-authentication or opaque blocked/freshStart state is involved.
    const choice=await chooseCloud({local,remote:remote.data,allowLocal:verification.status==='valid',
     canStartLocal:verification.status==='valid'});
    if(choice==='restore')return await restore(remote,file,{expectedLocal:local});
    if(choice==='overwrite'){

     if(verification.status!=='valid'){
      show('端末セーブを検証できません。');return result;
     }
     const outcome=await upload(local,file,{allowInitial:true});
     return outcome==='ready'?'start-new':outcome;
    }
    return result;
   }

   // Same play does not mean interchangeable discovery histories: a higher
   // level on another device must not silently erase locally found relics.
   const preferred=decideCloudSync({file,localProfile:local.profile,remoteProfile:remote.data.profile,
    localSavedAt:local.savedAt,remoteSavedAt:remote.data.savedAt});
   const losesDiscovered=(discarded,winner)=>Object.entries(discarded?.collection||{}).some(
    ([id,count])=>Number(count)>0&&!(Number(winner?.collection?.[id])>0));
   const losesRelics=preferred==='download'
    ?losesDiscovered(local.profile,remote.data.profile)
    :preferred==='upload'&&losesDiscovered(remote.data.profile,local.profile);
   // Case 4: same play. Resolve actual progress before image repair;
   // a newer timestamp must never beat a more advanced adventurer.
   if(verification.status==='badImages'){
    // Preserve local unique discoveries; repair photos before offering a source choice.
    if(!losesRelics&&preferred==='download')
     return await restore(remote,file,{expectedLocal:local});
    const restored=[];
    for(const id of verification.badImageIds){
     const localCircle=local.circles.find(c=>c.id===id);
     const driveCircle=remote.data.circles.find(c=>c.id===id);
     if(localCircle&&driveCircle?.image){
      try{
       await digestPhoto(driveCircle.image);
       await putCircle(db,{...localCircle,image:driveCircle.image},{repairImage:true});
       restored.push(id);
      }catch{ /* Keep intact local and Drive data on repair failure. */ }
     }
    }
    if(restored.length){
     local=await readDungeonSnapshot(db);
     verification=await verifyLocalSnapshot(local);
     await onImagesRestored(restored);
    }
    if(verification.status==='badImages'){
     if(!await onRepairImages(verification.badImageIds)){
      show('魔法陣画像の修復が必要です。同期を停止しました。');
      return result;
     }
     local=await readDungeonSnapshot(db);
     verification=await verifyLocalSnapshot(local);
    }
   }

   // A legacy local seal cannot be uploaded, but an explicitly selected
   // verified Drive restore must remain possible. Photo repair runs above.
   if(losesRelics&&verification.status!=='valid'){
    const choice=await chooseCloud({local,remote:remote.data,allowLocal:false,canStartLocal:false});
    if(choice==='restore')return await restore(remote,file,{expectedLocal:local});
    return result;
   }
   if(verification.status!=='valid'){
    show('端末セーブを検証できません。同期を停止しました。');
    return result;
   }
   // A photo-repairable local save must retain the keep-local option.
   if(losesRelics){
    const choice=await chooseCloud({local,remote:remote.data,
     allowLocal:verification.status==='valid',canStartLocal:verification.status==='valid'});
    if(choice==='restore')return await restore(remote,file,{expectedLocal:local});
    if(choice==='overwrite'&&verification.status==='valid')return await upload(local,file,{allowInitial:true});
    return result;
   }

   const localText=await serializeDungeonSnapshot(local);
   const localHash=await snapshotHash(localText);
   ensureCurrent(activeSyncEpoch);
   const decision=decideCloudSync({file,localHash,remoteHash:remote.hash,
    localProfile:local.profile,remoteProfile:remote.data.profile,
    localSavedAt:local.savedAt,remoteSavedAt:remote.data.savedAt});
   if(decision==='synced'){
    await saveCloudSyncState(db,{fileId:file.id,hash:remote.hash,modifiedTime:file.modifiedTime});
    await syncedPresentation(local.savedAt);
    return 'ready';
   }
   if(decision==='download')return await restore(remote,file,{expectedLocal:local});
   return await upload(local,file);
  }catch(error){
   if(!isCurrent(activeSyncEpoch))return 'deferred';
   if(error instanceof DriveAuthError)expireConnection();
   else reconnectPresentation('同期エラー：'+error.message);
   return 'deferred';
  }finally{
   busy=false;
   if(disconnectPending){
    void finishDisconnect();
   }else if(again&&!stopped&&!restoring&&drive){
    again=false;
    const retryInitial=initial||initialRetryQueued;
    if(retryInitial)initialRetryQueued=true;
    // A queued read-only recheck must not flash a save-in-progress label.
    if(syncIndicatorVisible)show('同期中…');
    queueMicrotask(()=>{
     if(drive&&!stopped&&!restoring){
      void sync(retryInitial).then(outcome=>{if(retryInitial)completeInitialCheck(outcome);});
     }else setSyncing(false);
    });
   }else{
    again=false;
    setSyncing(false);
   }
  }
 }
 async function acceptGoogleToken(result){
  if(!oauthPending)return; // Ignore an authorization response after disconnect.
  const renewing=renewalPending&&Boolean(drive);
  oauthPending=false;renewalPending=false;
  if(result.error||!result.access_token){
   if(!renewing)show('Google連携が完了しませんでした。');
   return;
  }
  tokenIssuedAt=Date.now();
  expires=tokenIssuedAt+Math.max(0,Number(result.expires_in||3600)-60)*1000;
  accessToken=result.access_token;
  saveAuthCookie(accessToken,expires);
  if(renewing){
   // Retain the Drive instance/connection epoch through in-flight transfers.
   // Each subsequent API request reads the newly issued access token.
   watchTokenExpiry();
   return;
  }
  expiryNoticeShown=false;
  doc?.getElementById('googleDriveExpiredDialog')?.close?.();
  connectionEpoch++;
  requestController?.abort();
  requestController=new AbortController();
  drive=createDungeonDrive(()=>accessToken,fetchImpl,{signal:requestController.signal});
  manuallyDisconnected=false;
  validatedDrive=null;
  if(disconnectButton)disconnectButton.hidden=false;
  watchTokenExpiry();
  // OAuth is not backup success. Only hide the risk once a real file is verified.
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  lockLocalOnly(true);
  show('確認中…');
  const outcome=await sync(true);
  if(!disconnectPending&&!manuallyDisconnected)completeInitialCheck(outcome);
  // A failed Drive read or upload never opens the naming dialog.
 }
 function loadIdentity(){
  return new Promise((resolve,reject)=>{
   if(globalThis.google?.accounts?.oauth2){resolve();return;}
   const script=doc.createElement('script');
   script.src='https://accounts.google.com/gsi/client';
   script.async=true;
   script.onload=resolve;
   script.onerror=()=>reject(Error('Google認証ライブラリの読み込みに失敗しました。'));
   doc.head.append(script);
  });
 }
 void loadIdentity().then(()=>{
  if(stopped)return;
  client=globalThis.google.accounts.oauth2.initTokenClient({
   client_id:GOOGLE_CLIENT_ID,scope:DRIVE_SCOPE,
   callback:result=>{void acceptGoogleToken(result);},
   error_callback:()=>{
    if(renewalPending){oauthPending=false;renewalPending=false;return;}
    oauthPending=false;
    show('Googleログインが中断されました。再度お試しください。');
   }
  });
  button.disabled=false;
  if(setupButton)setupButton.disabled=false;
  if(!drive&&!expiryNoticeShown&&!manuallyDisconnected)show('未接続');
  if(drive)watchTokenExpiry();
  void getCloudSyncState(db).then(meta=>{
   if(!drive&&!expiryNoticeShown&&!manuallyDisconnected&&meta?.fileId&&meta?.hash)show('未接続。再接続してください。');
  }).catch(()=>{});
 }).catch(error=>show(error.message));
 button.disabled=true;
 button.hidden=false;
 const expiredDialog=doc?.getElementById('googleDriveExpiredDialog');
 expiredDialog?.querySelector('[data-action="reconnect"]')?.addEventListener('click',()=>{
  closeDungeonDialog(expiredDialog);
  renewalPending=false;
  oauthPending=Boolean(client);
  client?.requestAccessToken({prompt:'consent'});
 });
 expiredDialog?.querySelector('[data-action="later"]')?.addEventListener('click',()=>closeDungeonDialog(expiredDialog));
 const connectOrCheck=()=>{
  if(drive&&Date.now()<expires){
   void sync(true).then(outcome=>{
    if(disconnectPending||manuallyDisconnected)return;
    if(outcome==='deferred')reconnectPresentation();
    if(outcome==='ready'||outcome==='start-new')onInitialReady();
   });
  }else{
   renewalPending=false;
   oauthPending=Boolean(client);
   client?.requestAccessToken({prompt:'consent'});
  }
 };
 button.addEventListener('click',connectOrCheck);
 setupButton?.addEventListener('click',connectOrCheck);
 // Only finalize after an in-flight Drive request has completed and readback
 // has been checked. Aborting a resumable PUT could leave an uncertain backup.
 async function finishDisconnect(){
  if(!disconnectPending)return;
  disconnectPending=false;
  manuallyDisconnected=true;
  oauthPending=false;renewalPending=false;
  connectionEpoch++;
  requestController=null; // No abort: all in-flight requests have settled.
  again=false;
  clearTimeout(expiryTimer);expiryTimer=null;
  clearTimeout(timer);timer=null;
  clearAuthCookie();
  accessToken='';drive=null;expires=0;validatedDrive=null;
  setSyncing(false);
  if(!initialChoiceCommitted)lockLocalOnly(false);
  if(disconnectButton)disconnectButton.disabled=false;
  doc?.getElementById('googleDriveExpiredDialog')?.close?.();
  reconnectPresentation('Google Driveの同期を解除しました。端末とDriveのデータは残ります。');
  const done=resolveDisconnect;
  resolveDisconnect=null;
  disconnectPromise=null;
  try{await saveDriveSyncIntent(db,false);}catch(error){show('同期は解除しましたが、設定を保存できませんでした：'+error.message);}
  done?.();
 }
 function disconnect(){
  if(disconnectPending)return disconnectPromise;
  disconnectPending=true;
  oauthPending=false;
  again=false;
  clearTimeout(timer);timer=null;
  // An idle-expiry timer must not abort the already running resumable upload.
  // Credentials remain until its Drive readback has finished.
  clearTimeout(expiryTimer);expiryTimer=null;
  disconnectPromise=new Promise(resolve=>{resolveDisconnect=resolve;});
  const completed=disconnectPromise;
  // Cancel user decisions, not active Drive transfers.
  pendingChoiceCancel?.();
  if(busy){
   if(disconnectButton)disconnectButton.disabled=true;
   show('同期の完了後に解除します…');
  }else void finishDisconnect();
  return completed;
 }
 disconnectButton?.addEventListener('click',()=>{void disconnect();});
 const unsubscribe=onDungeonDataChange(db,schedule);
 windowImpl?.addEventListener?.('online',()=>{watchTokenExpiry();schedule();});
 doc?.addEventListener?.('visibilitychange',()=>{if(!doc.hidden){watchTokenExpiry();schedule();}});
 // GIS recommends token acquisition from a user gesture. If a timed attempt
 // was blocked, the next actual game-button click offers one more chance.
 doc?.addEventListener?.('click',event=>{
  if(event.isTrusted&&event.target?.closest?.('button'))tryRenewToken(true);
 });
 const savedAuth=readAuthCookie();
 if(savedAuth){
  lockLocalOnly(true);
  // On reload, verify Drive's actual bytes before displaying "同期済み".
  accessToken=savedAuth.token;
  expires=savedAuth.expires;
  tokenIssuedAt=Date.now();
  requestController=new AbortController();
  drive=createDungeonDrive(()=>accessToken,fetchImpl,{signal:requestController.signal});
  if(disconnectButton)disconnectButton.hidden=false;
  watchTokenExpiry();
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  show('確認中…');
  void sync(true).then(completeInitialCheck);
 }else if(!expiryNoticeShown){
  // Browser cookie expiry removes the token before JS can inspect it.
  // Keep a separate durable intent, and migrate existing verified backups.
  void Promise.all([getDriveSyncIntent(db),getCloudSyncState(db)]).then(([intent,meta])=>{
   if(drive||oauthPending||manuallyDisconnected||disconnectPending||expiryNoticeShown||stopped)return;
   if(intent===true||(intent===undefined&&meta?.fileId&&meta?.hash))expireConnection();
  }).catch(()=>{});
 }
 return {ready:true,unsubscribe,sync,disconnect,syncNow:()=>{clearTimeout(timer);return sync(false);}};
}
