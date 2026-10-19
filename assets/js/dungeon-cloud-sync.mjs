import {GOOGLE_CLIENT_ID} from './dungeon-google-config.mjs';
import {createDungeonDrive,DriveAuthError,DRIVE_SCOPE} from './dungeon-cloud-drive.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot,snapshotHash} from './dungeon-cloud-snapshot.mjs';
import {readDungeonSnapshot,replaceDungeonSnapshot,getCloudSyncState,saveCloudSyncState,onDungeonDataChange,putCircle,establishLegacyIntegrity} from './dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from './dungeon-cloud-integrity.mjs';

// Last-write-wins: the timestamp belongs to the game save, not Drive metadata.
// Equal timestamps are resolved in Drive's favor. Hash equality is a no-op.
export function decideCloudSync({file,localHash,remoteHash,localSavedAt=0,remoteSavedAt=0,pristine=false,blocked=false}){
 if(blocked)return 'blocked';
 if(!file)return pristine?'wait':'upload';
 if(pristine)return 'choose';
 if(localHash===remoteHash)return 'synced';
 return Number(localSavedAt)>Number(remoteSavedAt)?'upload':'download';
}
export function initDungeonCloudSync({db,button,status,onRestore,onInitialReady=()=>{},onRepairImages=async()=>false,fetchImpl=globalThis.fetch,windowImpl=globalThis.window}){
 if(!GOOGLE_CLIENT_ID){
  windowImpl?.document?.getElementById('setupGoogleDrive')?.setAttribute('disabled','');
  status.textContent='Google連携を利用できません。この端末内のセーブだけでは消失する可能性があります。';
  button.disabled=true;
  return {ready:false};
 }
 let client=null,drive=null,expires=0,busy=false,again=false,timer=null,restoring=false,stopped=false;
 let expiryNoticeShown=false,choicePending=false,validatedDrive=null,initializing=false;
 const doc=windowImpl?.document;
 const conflictDialog=doc?.getElementById('googleDriveConflictDialog');
 const setupButton=doc?.getElementById('setupGoogleDrive');
 const show=message=>{status.textContent=message;const setup=doc?.getElementById('backupSetupStatus');if(setup)setup.textContent=message;};
 function expireConnection(){
  drive=null;
  show('Google認証の期限が切れました。再接続するまでバックアップは停止します。');
  if(!expiryNoticeShown){
   expiryNoticeShown=true;
   doc?.getElementById('googleDriveExpiredDialog')?.showModal?.();
  }
 }
 function schedule(){
  if(!drive||stopped||restoring||choicePending)return;
  clearTimeout(timer);
  timer=setTimeout(()=>{void sync(false);},1800);
 }
 function chooseCloud(description,{allowOverwrite=true}={}){
  return new Promise(resolve=>{
   if(!conflictDialog?.showModal){resolve('later');return;}
   choicePending=true;
   conflictDialog.querySelector('[data-role="description"]').textContent=description;
   conflictDialog.querySelector('[data-action="overwrite"]').hidden=!allowOverwrite;
   const finish=choice=>{
    choicePending=false;
    conflictDialog.close();
    conflictDialog.removeEventListener('cancel',cancel);
    for(const [name,handler] of handlers)conflictDialog.querySelector('[data-action="'+name+'"]')?.removeEventListener('click',handler);
    resolve(choice);
   };
   const cancel=event=>{event.preventDefault();finish('later');};
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
 async function restore(remote,file){
  if(!remote.valid)throw Error('破損したDriveバックアップは復元できません。');
  const before=await readDungeonSnapshot(db);
  if(before.profile?.run&&!isPristineDungeonSnapshot(before)){
   show('探索中に新しいDriveデータが見つかりました。探索終了まで自動復元と上書きを停止しています。');
   return 'deferred';
  }
  const current=await drive.metadata(file.id);
  if(current.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  restoring=true;
  await replaceDungeonSnapshot(db,remote.data);
  await saveCloudSyncState(db,{fileId:file.id,hash:remote.hash,modifiedTime:file.modifiedTime});
  show('Google Driveの正常なセーブを復元しました。画面を読み込み直します。');
  onRestore();
  return 'restored';
 }
 async function upload(snapshot,file){
  // The exact serialized, inspected bytes are uploaded; do not recompute
  // a new checksum from damaged IndexedDB data after verification.
  const verification=await verifyLocalSnapshot(snapshot);
  if(isPristineDungeonSnapshot(snapshot))throw Error('空の冒険記録でDriveを上書きできません。');
  if(verification.status!=='valid')throw Error('端末セーブの整合性を検証できないため、バックアップの上書きを中止しました。');
  const text=await serializeDungeonSnapshot(snapshot);
  // A concurrent game write must not make an earlier snapshot clobber a later one.
  const latest=await readDungeonSnapshot(db);
  if(latest.savedAt!==snapshot.savedAt) {again=true;return 'deferred';}
  if(file){
   const now=await drive.metadata(file.id);
   if(now.modifiedTime!==file.modifiedTime){again=true;return 'deferred';}
  }
  const saved=await drive.upload(text,file?.id||null);
  const hash=await snapshotHash(text);
  validatedDrive={id:saved.id,modifiedTime:saved.modifiedTime,result:{valid:true,data:snapshot,hash,text,invalidImages:[],trusted:true}};
  await saveCloudSyncState(db,{fileId:saved.id,modifiedTime:saved.modifiedTime,hash});
  show('Google Driveにバックアップ済み。変更時は接続中に自動更新します。');
  return 'ready';
 }
 async function sync(initial=false){
  if(!drive||stopped||choicePending)return 'deferred';
  if(busy){again=true;return 'deferred';}
  if(Date.now()>=expires){expireConnection();return 'deferred';}
  busy=true;
  let result='deferred';
  try{
   const meta=await getCloudSyncState(db);
   let local=await readDungeonSnapshot(db);
   let verification=await verifyLocalSnapshot(local);
   const files=await drive.list();
   if(files.length>1){show('Driveに複数のバックアップがあります。安全のため自動同期を停止しました。');return result;}
   const file=files[0]||null;
   const remote=await checkedRemote(file,initial);
   if(!file&&verification.status==='legacy'){
    await establishLegacyIntegrity(db,local);
    local=await readDungeonSnapshot(db);
    verification=await verifyLocalSnapshot(local);
   }
   if(meta?.blocked){
    if(!file){await saveCloudSyncState(db,{});show('Driveにバックアップはありません。新しい冒険の記録を自動保存します。');return 'ready';}
    const choice=await chooseCloud('この端末では以前の冒険データを削除しています。Driveから復元するか、新しい端末データでバックアップを置き換えるか選んでください。');
    if(choice==='restore')return await restore(remote,file);
    if(choice==='overwrite'){
     await saveCloudSyncState(db,{freshStart:true,fileId:file.id});
     show('新しい冒険を開始します。セーブ変更後にバックアップを更新します。');
     return 'ready';
    }
    show('選択を保留しました。Driveのバックアップは変更していません。');
    return result;
   }
   if(verification.status==='corrupt'){
    if(remote.valid&&remote.trusted)return await restore(remote,file);
    show('端末のセーブが破損しています。正常なDriveバックアップもないため、上書きを停止しました。');
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
    if(remote.valid&&remote.trusted)return await restore(remote,file);
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
   if(!file&&pristine){
    show('Google Driveに接続しました。冒険者作成後の変更から自動バックアップします。');
    return 'ready';
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
    if(meta?.freshStart)return 'ready';
    // Never silently overwrite a blank/new browser with Drive data, or vice versa.
    const choice=await chooseCloud('Driveに以前の冒険の記録があります。「復元」でその記録を使用、「端末データ」で新しい冒険を開始します。新規開始するとDriveのバックアップは上書きされます。');
    if(choice==='restore')return await restore(remote,file);
    if(choice==='overwrite'){
     // Starting fresh must not replace a healthy older backup with an empty save.
     await saveCloudSyncState(db,{freshStart:true,fileId:file.id});
     show('新しい冒険を開始します。最初の進行が保存されるまでDriveは上書きしません。');
     return 'ready';
    }
    show('バックアップを変更せず保留しました。');
    return result;
   }
   if(decision==='synced'){show('Google Driveと同期済み。変更は自動バックアップされます。');return 'ready';}
   if(decision==='download'){
    if(!initial){show('Driveにより新しい記録があります。プレイ中は復元・上書きを保留します。再接続時に照合してください。');return result;}
    return await restore(remote,file);
   }
   if(decision==='upload'){
    if(pristine)return 'ready';
    return await upload(local,file);
   }
   return 'ready';
  }catch(error){
   if(error instanceof DriveAuthError)expireConnection();
   else show('バックアップ処理を停止しました（端末内のデータは保持）：'+error.message);
   return 'deferred';
  }finally{
   busy=false;
   if(again&&!stopped){again=false;schedule();}
  }
 }
 async function acceptGoogleToken(result){
  if(result.error||!result.access_token){show('Google連携が完了しませんでした。');return;}
  expiryNoticeShown=false;
  doc?.getElementById('googleDriveExpiredDialog')?.close?.();
  expires=Date.now()+Math.max(0,Number(result.expires_in||3600)-60)*1000;
  drive=createDungeonDrive(result.access_token,fetchImpl);
  validatedDrive=null;
  button.textContent='Google Driveに再接続';
  show('Driveとセーブを検証・照合中…');
  const outcome=await sync(true);
  if(outcome==='ready')onInitialReady();
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
  show('Google Driveに接続すると、端末データの消失に備えて自動バックアップします。認証期限切れやオフライン中は停止します。');
 }).catch(error=>show(error.message));
 button.disabled=true;
 const expiredDialog=doc?.getElementById('googleDriveExpiredDialog');
 expiredDialog?.querySelector('[data-action="reconnect"]')?.addEventListener('click',()=>{
  expiredDialog.close();
  client?.requestAccessToken({prompt:'consent'});
 });
 expiredDialog?.querySelector('[data-action="later"]')?.addEventListener('click',()=>expiredDialog.close());
 button.addEventListener('click',()=>{client?.requestAccessToken({prompt:'consent'});});
 setupButton?.addEventListener('click',()=>{client?.requestAccessToken({prompt:'consent'});});
 const unsubscribe=onDungeonDataChange(db,schedule);
 windowImpl?.addEventListener?.('online',schedule);
 doc?.addEventListener?.('visibilitychange',()=>{if(!doc.hidden)schedule();});
 return {ready:true,unsubscribe,sync};
}
