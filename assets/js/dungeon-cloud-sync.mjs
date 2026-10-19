import {GOOGLE_CLIENT_ID} from './dungeon-google-config.mjs';
import {createDungeonDrive,DriveAuthError,DRIVE_SCOPE} from './dungeon-cloud-drive.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot,snapshotHash} from './dungeon-cloud-snapshot.mjs';
import {readDungeonSnapshot,replaceDungeonSnapshot,getCloudSyncState,saveCloudSyncState,onDungeonDataChange,putCircle,establishLegacyIntegrity} from './dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from './dungeon-cloud-integrity.mjs';

// Last-write-wins: the timestamp belongs to the game save, not Drive metadata.
// Equal timestamps are resolved in Drive's favor. Hash equality is a no-op.
export function decideCloudSync({file,localHash,remoteHash,localSavedAt=0,remoteSavedAt=0,pristine=false,blocked=false}){
 if(blocked)return 'blocked';
 if(!file)return 'upload';
 if(localHash&&remoteHash&&localHash===remoteHash)return 'synced';
 if(pristine)return 'choose';
 return Number(localSavedAt)>Number(remoteSavedAt)?'upload':'download';
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
 let client=null,drive=null,expires=0,busy=false,again=false,timer=null,expiryTimer=null,restoring=false,stopped=false;
 let expiryNoticeShown=false,choicePending=false,validatedDrive=null,initializing=false,initialChoiceCommitted=false;
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
 const riskWarning=doc?.getElementById('backupRiskWarning');
 const rollbackWarning=doc?.getElementById('backupRollbackWarning');
 const localOnlyButton=doc?.getElementById('setupWithoutBackup');
 const syncingIcons=[doc?.getElementById('backupSetupSpinner'),doc?.getElementById('googleDriveSpinner')];
 function setSyncing(active){
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
  if(outcome==='ready'||outcome==='start-new')onInitialReady();
  else if(outcome!=='restored'&&!initialChoiceCommitted)lockLocalOnly(false);
 }
 const show=message=>{const lines=message.replace(/。(?!$)/g,'。\n');status.textContent=lines;const setup=doc?.getElementById('backupSetupStatus');if(setup)setup.textContent=lines;};
 function connectedPresentation(){
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  if(riskWarning)riskWarning.hidden=true;
  if(rollbackWarning)rollbackWarning.hidden=false;
 }
 function reconnectPresentation(message){
  button.hidden=false;
  button.textContent='GoogleDriveに同期する';
  if(setupButton)setupButton.hidden=false;
  if(riskWarning)riskWarning.hidden=false;
  if(rollbackWarning)rollbackWarning.hidden=true;
  if(message)show(message);
 }
 function syncedPresentation(){
  connectedPresentation();
  show('GoogleDrive同期済み');
 }
 function expireConnection(){
  clearTimeout(expiryTimer);
  expiryTimer=null;
  clearAuthCookie();
  drive=null;expires=0;validatedDrive=null;
  reconnectPresentation('認証が切れました。再接続してください。');
  if(!expiryNoticeShown){
   expiryNoticeShown=true;
   const dialog=doc?.getElementById('googleDriveExpiredDialog');
   if(dialog&&!dialog.open)dialog.showModal?.();
  }
 }
 // Expiry is an event; do not wait until the next save to discover it.
 // Only the one-time notification flag is kept in memory.
 function watchTokenExpiry(){
  clearTimeout(expiryTimer);
  expiryTimer=null;
  if(!drive||!expires||stopped)return;
  const remaining=expires-Date.now();
  if(remaining<=0){expireConnection();return;}
  expiryTimer=setTimeout(()=>{
   expiryTimer=null;
   if(!drive||stopped)return;
   if(Date.now()>=expires)expireConnection();
   else watchTokenExpiry();
  },Math.min(remaining,2147483647));
  expiryTimer?.unref?.();
 }
 function schedule(){
  if(!drive||stopped||restoring||choicePending)return;
  clearTimeout(timer);
  timer=setTimeout(()=>{void sync(false);},1800);
 }
 function chooseCloud(description,{allowOverwrite=true,initialChoice=false}={}){
  return new Promise(resolve=>{
   if(!conflictDialog?.showModal){resolve('later');return;}
   choicePending=true;
   conflictDialog.querySelector('[data-role="description"]').textContent=description.replace(/。(?!$)/g,'。\n');
   conflictDialog.querySelector('[data-action="overwrite"]').hidden=!allowOverwrite;
   conflictDialog.querySelector('[data-action="later"]').hidden=initialChoice;
   const title=doc?.getElementById('googleDriveConflictTitle');
   if(title)title.textContent=initialChoice?'バックアップが見つかりました':'冒険データの確認';
   const finish=choice=>{
    // Hide the dangerous local-only option BEFORE the topmost chooser
    // closes, so it can never flash or receive a mis-tap during restoration.
    if(choice==='restore'||choice==='overwrite'){
     initialChoiceCommitted=true;
     lockLocalOnly(true);
    }
    choicePending=false;
    conflictDialog.close();
    conflictDialog.removeEventListener('cancel',cancel);
    for(const [name,handler] of handlers)conflictDialog.querySelector('[data-action="'+name+'"]')?.removeEventListener('click',handler);
    resolve(choice);
   };
   const cancel=event=>{event.preventDefault();if(!initialChoice)finish('later');};
   const handlers=[['restore',()=>finish('restore')],['overwrite',()=>finish('overwrite')],['later',()=>finish('later')]];
   for(const [name,handler] of handlers)conflictDialog.querySelector('[data-action="'+name+'"]')?.addEventListener('click',handler,{once:true});
   conflictDialog.addEventListener('cancel',cancel);
   conflictDialog.showModal();
  });
 }
 async function checkedRemote(file,refresh=false){
  if(!file)return {valid:false,data:null,invalidImages:[]};
  if(!refresh&&validatedDrive?.id===file.id&&validatedDrive.modifiedTime===file.modifiedTime)return validatedDrive.result;
  try{
   const remoteText=await drive.download(file.id);
   const data=deserializeDungeonSnapshot(remoteText);
   const invalidImages=[];
   for(const circle of data.circles){
    if(!circle.image){invalidImages.push(circle.id);continue;}
    try{await digestPhoto(circle.image);}catch{invalidImages.push(circle.id);}
   }
   const result={valid:invalidImages.length===0,data,invalidImages,text:remoteText,hash:await snapshotHash(remoteText),trusted:!data.legacy};
   if(result.valid)validatedDrive={id:file.id,modifiedTime:file.modifiedTime,result};
   return result;
  }catch(error){
   if(error instanceof DriveAuthError)throw error;
   return {valid:false,data:null,invalidImages:[],error};
  }
 }
 async function restore(remote,file,{explicit=false}={}){
  if(!remote.valid)throw Error('破損したDriveバックアップは復元できません。');
  const before=await readDungeonSnapshot(db);
  if(before.profile?.run&&!isPristineDungeonSnapshot(before)&&!explicit){
   show('探索中に新しいDriveデータが見つかりました。探索終了まで自動復元と上書きを停止しています。');
   return 'deferred';
  }
  const current=await drive.metadata(file.id);
  if(current.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  lockLocalOnly(true);
  restoring=true;
  await replaceDungeonSnapshot(db,remote.data);
  await saveCloudSyncState(db,{fileId:file.id,hash:remote.hash,modifiedTime:file.modifiedTime});
  show('Google Driveの正常なセーブを復元しました。画面を読み込み直します。');
  onRestore();
  return 'restored';
 }
 async function upload(snapshot,file,{allowInitial=false}={}){
  // The exact serialized, inspected bytes are uploaded; do not recompute
  // a new checksum from damaged IndexedDB data after verification.
  const verification=await verifyLocalSnapshot(snapshot);
  if(isPristineDungeonSnapshot(snapshot)&&!allowInitial)throw Error('初期セーブのアップロードは接続確認時のみ許可します。');
  if(verification.status!=='valid')throw Error('端末セーブの整合性を検証できないため、バックアップの上書きを中止しました。');
  const text=await serializeDungeonSnapshot(snapshot);
  // A concurrent game write must not make an earlier snapshot clobber a later one.
  const latest=await readDungeonSnapshot(db);
  if(latest.savedAt!==snapshot.savedAt) {again=true;return 'deferred';}
  if(file){
   const now=await drive.metadata(file.id);
   if(now.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  }
  show('保存中…');
  const saved=await drive.upload(text,file?.id||null);
  const hash=await snapshotHash(text);
  // An upload response is not enough: verify the exact remote contents.
  const downloaded=await drive.download(saved.id);
  if(await snapshotHash(downloaded)!==hash)throw Error('Drive側の保存内容が一致しません。');
  const confirmed=deserializeDungeonSnapshot(downloaded);
  validatedDrive={id:saved.id,modifiedTime:saved.modifiedTime,result:{valid:true,data:confirmed,hash,text:downloaded,invalidImages:[],trusted:true}};
  await saveCloudSyncState(db,{fileId:saved.id,modifiedTime:saved.modifiedTime,hash});
  const newest=await readDungeonSnapshot(db);
  if(newest.savedAt!==snapshot.savedAt){
   again=true;
   show('同期中…');
   return 'deferred';
  }
  syncedPresentation();
  return 'ready';
 }
 async function sync(initial=false){
  if(!drive||stopped||choicePending)return 'deferred';
  if(busy){again=true;return 'deferred';}
  if(Date.now()>=expires){expireConnection();return 'deferred';}
  busy=true;
  setSyncing(true);
  show('同期中…');
  let result='deferred';
  try{
   const meta=await getCloudSyncState(db);
   let local=await readDungeonSnapshot(db);
   let verification=await verifyLocalSnapshot(local);
   const files=await drive.list();
   if(files.length>1){show('Driveに複数のバックアップがあります。安全のため自動同期を停止しました。');return result;}
   const file=files[0]||null;
   // An account previously confirmed as synced must have a real Drive file.
   if(!file&&meta?.fileId&&!meta?.blocked){
    // Allow a different Google account to be selected on the next connect.
    clearAuthCookie();
    clearTimeout(expiryTimer);expiryTimer=null;
    drive=null;expires=0;
    reconnectPresentation('同期エラー：Drive上にバックアップがありません。');
    return result;
   }
   const remote=await checkedRemote(file,initial);
   if(!file&&verification.status==='legacy'){
    await establishLegacyIntegrity(db,local);
    local=await readDungeonSnapshot(db);
    verification=await verifyLocalSnapshot(local);
   }
   if(meta?.blocked){
    if(!file)await saveCloudSyncState(db,{});
    else{
     if(!remote.valid){show('バックアップが破損しています。復元できません。');return result;}
     const choice=await chooseCloud('引き継ぐか、新しく始めるか選んでください。',{initialChoice:true});
     if(choice==='restore')return await restore(remote,file,{explicit:true});
     if(choice==='overwrite'){
      // New game replaces the old backup only after the explicit choice.
      const outcome=await upload(local,file,{allowInitial:true});
      return outcome==='ready'?'start-new':outcome;
     }
     return result;
    }
   }
   if(verification.status==='corrupt'){
    if(remote.valid&&remote.trusted){
     const rescue=doc?.getElementById('backupSetupDialog')?.open;
     return await restore(remote,file,{explicit:Boolean(rescue)});
    }
    if(remote.valid){
     const choice=await chooseCloud('端末セーブの破損を検出しました。Driveの旧形式バックアップは完全性を確認できません。復元する場合は内容が古い可能性があります。',{allowOverwrite:false});
     if(choice==='restore')return await restore(remote,file,{explicit:true});
    }
    show('端末のセーブが破損しています。確認済みのDriveバックアップがないため上書きを停止しました。');
    return result;
   }
   if(verification.status==='badImages'){
    // A newer complete Drive save wins before any local image repair can advance savedAt.
    if(initial&&remote.valid&&Number(remote.data.savedAt||0)>=Number(local.savedAt||0))return await restore(remote,file);
    const restored=[];
    if(remote.data){
     for(const id of verification.badImageIds){
      const localCircle=local.circles.find(c=>c.id===id);
      const driveCircle=remote.data.circles.find(c=>c.id===id);
      if(localCircle&&driveCircle?.image){
       try{
        await digestPhoto(driveCircle.image);
        await putCircle(db,{...localCircle,image:driveCircle.image},{repairImage:true});
        restored.push(id);
       }catch{ /* The other Drive photos may still be individually usable. */ }
      }
     }
    }
    if(restored.length){
     local=await readDungeonSnapshot(db);
     verification=await verifyLocalSnapshot(local);
     show(restored.length+'件の魔法陣画像をDriveから個別復旧しました。');
     await onImagesRestored(restored);
    }
    if(verification.status==='badImages'){
     const repaired=await onRepairImages(verification.badImageIds);
     if(!repaired){
      show('画像の撮り直し待ちです。修復までDriveへの上書きを停止します。');
      return result;
     }
     local=await readDungeonSnapshot(db);
     verification=await verifyLocalSnapshot(local);
    }
   }
   if(verification.status==='legacy'){
    if(remote.valid){
     const choice=await chooseCloud('この端末は旧形式のセーブです。整合性と更新日時を比較できないため、自動上書きせず選択を待ちます。Driveから復元するか、バックアップを変更せず保留してください。',{allowOverwrite:false});
     if(choice==='restore')return await restore(remote,file,{explicit:true});
     return result;
    }
    if(file){
     show('旧端末セーブを安全に検証できず、Driveも破損しています。自動上書きを停止しました。');
     return result;
    }
   }
   if(verification.status!=='valid'){
    show('セーブの破損・画像欠損を検出しました。復旧するまで自動バックアップを停止します。');
    return result;
   }
   const pristine=isPristineDungeonSnapshot(local);
   if(file&&!remote.valid){
    // A valid sealed local copy can replace a broken Drive copy.
    if(pristine){show('Driveのバックアップが破損しています。端末データでの上書きは停止しました。');return result;}
    return await upload(local,file);
   }
   if(!file){
    // Save the unnamed starting profile before allowing a name to be entered.
    return await upload(local,null,{allowInitial:true});
   }
   const localText=await serializeDungeonSnapshot(local);
   const decision=decideCloudSync({file,localHash:await snapshotHash(localText),remoteHash:remote.hash,
    localSavedAt:local.savedAt,remoteSavedAt:remote.data?.savedAt||0,pristine});
   if(meta?.freshStart&&!pristine){
    if(decision==='upload')return await upload(local,file);
    show('Drive側に新しい記録があります。バックアップの上書きは保留しています。');
    return result;
   }
   if(decision==='choose'){
    // Never silently overwrite a blank/new browser with Drive data, or vice versa.
    const choice=await chooseCloud('引き継ぐか、新しく始めるか選んでください。',{initialChoice:initial});
    if(choice==='restore')return await restore(remote,file,{explicit:true});
    if(choice==='overwrite'){
     // Replace only after explicit user consent, and protect even the unnamed profile.
     const outcome=await upload(local,file,{allowInitial:true});
     return outcome==='ready'?'start-new':outcome;
    }
    show('バックアップを変更せず保留しました。');
    return result;
   }
   if(decision==='synced'){syncedPresentation();return 'ready';}
   if(decision==='download'){
    if(!initial){show('Driveにより新しい記録があります。プレイ中は復元・上書きを保留します。再接続時に照合してください。');return result;}
    return await restore(remote,file);
   }
   if(decision==='upload')return await upload(local,file);
   return 'ready';
  }catch(error){
   if(error instanceof DriveAuthError)expireConnection();
   else reconnectPresentation('同期エラー：'+error.message);
   return 'deferred';
  }finally{
   busy=false;
   setSyncing(false);
   if(again&&!stopped){again=false;schedule();}
  }
 }
 async function acceptGoogleToken(result){
  if(result.error||!result.access_token){show('Google連携が完了しませんでした。');return;}
  expiryNoticeShown=false;
  doc?.getElementById('googleDriveExpiredDialog')?.close?.();
  expires=Date.now()+Math.max(0,Number(result.expires_in||3600)-60)*1000;
  saveAuthCookie(result.access_token,expires);
  drive=createDungeonDrive(result.access_token,fetchImpl);
  validatedDrive=null;
  watchTokenExpiry();
  // OAuth is not backup success. Only hide the risk once a real file is verified.
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  lockLocalOnly(true);
  show('確認中…');
  const outcome=await sync(true);
  completeInitialCheck(outcome);
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
   error_callback:()=>show('Googleログインが中断されました。再度お試しください。')
  });
  button.disabled=false;
  if(setupButton)setupButton.disabled=false;
  if(!drive&&!expiryNoticeShown)show('未接続');
  void getCloudSyncState(db).then(meta=>{
   if(!drive&&!expiryNoticeShown&&meta?.fileId&&meta?.hash)show('未接続。再接続してください。');
  }).catch(()=>{});
 }).catch(error=>show(error.message));
 button.disabled=true;
 button.hidden=false;
 const expiredDialog=doc?.getElementById('googleDriveExpiredDialog');
 expiredDialog?.querySelector('[data-action="reconnect"]')?.addEventListener('click',()=>{
  expiredDialog.close();
  client?.requestAccessToken({prompt:'consent'});
 });
 expiredDialog?.querySelector('[data-action="later"]')?.addEventListener('click',()=>expiredDialog.close());
 const connectOrCheck=()=>{
  if(drive&&Date.now()<expires){
   void sync(true).then(outcome=>{
    if(outcome==='deferred')reconnectPresentation();
    if(outcome==='ready'||outcome==='start-new')onInitialReady();
   });
  }else client?.requestAccessToken({prompt:'consent'});
 };
 button.addEventListener('click',connectOrCheck);
 setupButton?.addEventListener('click',connectOrCheck);
 // The caller explicitly disconnects before opening a local-only new game.
 function disconnect(){
  clearTimeout(expiryTimer);expiryTimer=null;
  clearAuthCookie();
  drive=null;expires=0;validatedDrive=null;
  clearTimeout(timer);
  reconnectPresentation('未接続');
 }
 const unsubscribe=onDungeonDataChange(db,schedule);
 windowImpl?.addEventListener?.('online',schedule);
 doc?.addEventListener?.('visibilitychange',()=>{if(!doc.hidden)schedule();});
 const savedAuth=readAuthCookie();
 if(savedAuth){
  lockLocalOnly(true);
  // On reload, verify Drive's actual bytes before displaying "同期済み".
  expires=savedAuth.expires;
  drive=createDungeonDrive(savedAuth.token,fetchImpl);
  watchTokenExpiry();
  button.hidden=true;
  if(setupButton)setupButton.hidden=true;
  show('確認中…');
  void sync(true).then(completeInitialCheck);
 }
 return {ready:true,unsubscribe,sync,disconnect,syncNow:()=>{clearTimeout(timer);return sync(false);}};
}
