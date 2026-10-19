import {GOOGLE_CLIENT_ID} from './dungeon-google-config.mjs';
import {createDungeonDrive,DriveAuthError,DRIVE_SCOPE} from './dungeon-cloud-drive.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot,snapshotHash} from './dungeon-cloud-snapshot.mjs';
import {readDungeonSnapshot,replaceDungeonSnapshot,getCloudSyncState,saveCloudSyncState,onDungeonDataChange} from './dungeon-store.mjs';

export function decideCloudSync({file,meta,hash,pristine}){
 if(meta?.blocked)return 'blocked';
 if(!file)return 'upload';
 if(!meta?.fileId||meta.fileId!==file.id)return pristine?'download':'conflict';
 const localChanged=hash!==meta.hash;
 const remoteChanged=file.modifiedTime!==meta.modifiedTime;
 if(localChanged&&remoteChanged)return 'conflict';
 if(remoteChanged)return 'download';
 if(localChanged)return 'upload';
 return 'synced';
}

// No credentials or user data are written to URLs, localStorage, GitHub, or logs.
export function initDungeonCloudSync({db,button,status,onRestore,fetchImpl=globalThis.fetch,windowImpl=globalThis.window}){
 if(!GOOGLE_CLIENT_ID){
  status.textContent='Google CloudのOAuth設定待ちです。現在は端末内のみ保存されます。';
  button.disabled=true;
  return {ready:false};
 }
 let token=null,expires=0,client=null,busy=false,again=false,timer=null,restoring=false;
 let drive=null,stopped=false,expiryNoticeShown=false,choicePending=false;
 function expireConnection(){
  drive=null;
  show('Google認証が切れました。再接続すると自動同期が再開します。');
  if(expiryNoticeShown)return;
  expiryNoticeShown=true;
  windowImpl?.document?.getElementById('googleDriveExpiredDialog')?.showModal?.();
 }
 const spinner=windowImpl?.document?.getElementById('googleDriveSpinner');
 const show=message=>{status.textContent=message;if(spinner){spinner.hidden=!busy;status.prepend(spinner);}};
 function schedule(){
  if(!drive||stopped||restoring||choicePending)return;
  clearTimeout(timer);timer=setTimeout(()=>{void sync();},1800);
 }
 async function sync(){
  if(!drive||stopped||choicePending)return;
  if(busy){again=true;return;}
  if(Date.now()>=expires){expireConnection();return;}
  busy=true;
  show('Google Driveへバックアップ・同期中…');
  try{
   const meta=await getCloudSyncState(db);
   const snapshot=await readDungeonSnapshot(db);
   const text=await serializeDungeonSnapshot(snapshot),hash=await snapshotHash(text);
   const files=await drive.list();
   if(files.length>1){show('複数のクラウドセーブが見つかりました。安全のため自動上書きを停止しました。');return;}
   const file=files[0]||null;
   const decision=decideCloudSync({file,meta,hash,pristine:isPristineDungeonSnapshot(snapshot)});
   if(decision==='blocked'||decision==='conflict'){
    choicePending=true;
    show('端末とGoogle Driveのセーブを確認してください。選択するまで同期は停止します。');
    const dialog=windowImpl?.document?.getElementById('googleDriveConflictDialog');
    if(!dialog?.showModal){show('セーブの選択画面を開けません。安全のため同期を停止しました。');return;}
    const detail=dialog.querySelector('[data-role="description"]');
    if(detail)detail.textContent=decision==='blocked'
     ?'この端末で冒険データを削除しています。Google Driveのセーブを復元するか、現在の端末データでクラウドを上書きするか選んでください。'
     :'端末とGoogle Driveに異なるセーブがあります。残す方を選んでください。選ばなかったデータは上書きされます。';
    dialog.showModal();
    return;
   }
   if(decision==='synced'){show('Google Driveと同期済み。セーブ変更は自動でバックアップされます。');return;}
   if(decision==='download'){
    const remoteText=await drive.download(file.id);
    const data=deserializeDungeonSnapshot(remoteText);
    // Do not replace an active combat session with state from another device.
    if(snapshot.profile?.run&&!isPristineDungeonSnapshot(snapshot)){
     show('探索中はクラウドからの復元を保留しています。帰還後に確認します。');return;
    }
    restoring=true;
    await replaceDungeonSnapshot(db,data);
    await saveCloudSyncState(db,{fileId:file.id,modifiedTime:file.modifiedTime,hash:await snapshotHash(remoteText)});
    show('Google Driveからセーブを復元しました。画面を再読み込みします。');
    onRestore();
    return;
   }
   // Recheck the remote timestamp immediately before overwriting it.
   if(file){
    const newest=await drive.metadata(file.id);
    if(newest.modifiedTime!==file.modifiedTime){again=true;return;}
   }
   const saved=await drive.upload(text,file?.id||null);
   await saveCloudSyncState(db,{fileId:saved.id,modifiedTime:saved.modifiedTime,hash});
   show('Google Driveへ自動バックアップ済み。今後の変更も自動で保存します。');
  }catch(error){
   if(error instanceof DriveAuthError)expireConnection();
   else show('クラウド同期に失敗しました。端末内のセーブは保持されています：'+error.message);
  }finally{
   busy=false;
   if(spinner)spinner.hidden=true;
   if(again&&!stopped){again=false;schedule();}
  }
 }
 const conflictDialog=windowImpl?.document?.getElementById('googleDriveConflictDialog');
 async function resolveChoice(mode){
  if(!choicePending||busy||!drive)return;
  const confirmMessage=mode==='restore'
   ?'端末の現在の冒険データをGoogle Driveのセーブで上書きします。よろしいですか？'
   :'Google Driveのバックアップを現在の端末データで上書きします。元のバックアップは失われます。よろしいですか？';
  if(!windowImpl?.confirm?.(confirmMessage))return;
  busy=true;
  try{
   if(Date.now()>=expires){expireConnection();return;}
   const files=await drive.list();
   if(files.length!==1)throw Error('クラウドセーブが変更されています。再度接続して確認してください。');
   const file=files[0];
   const snapshot=await readDungeonSnapshot(db);
   if(mode==='restore'){
    const text=await drive.download(file.id);
    const data=deserializeDungeonSnapshot(text);
    // Verify the remote file did not change while downloading.
    const current=await drive.metadata(file.id);
    if(current.modifiedTime!==file.modifiedTime)throw Error('クラウドセーブが更新されました。再度確認してください。');
    restoring=true;
    await replaceDungeonSnapshot(db,data);
    await saveCloudSyncState(db,{fileId:file.id,modifiedTime:file.modifiedTime,hash:await snapshotHash(text)});
    choicePending=false;
    conflictDialog?.close();
    show('Google Driveのセーブを復元しました。再読み込みします。');
    onRestore();
   }else{
    const text=await serializeDungeonSnapshot(snapshot);
    const current=await drive.metadata(file.id);
    if(current.modifiedTime!==file.modifiedTime)throw Error('クラウドセーブが更新されました。再度確認してください。');
    const saved=await drive.upload(text,file.id);
    await saveCloudSyncState(db,{fileId:saved.id,modifiedTime:saved.modifiedTime,hash:await snapshotHash(text)});
    choicePending=false;
    conflictDialog?.close();
    show('端末のデータでGoogle Driveを上書きしました。自動同期を再開します。');
   }
  }catch(error){
   if(error instanceof DriveAuthError)expireConnection();
   else show('セーブの選択処理に失敗しました：'+error.message);
  }finally{busy=false;}
 }
 conflictDialog?.querySelector('[data-action="restore"]')?.addEventListener('click',()=>{void resolveChoice('restore');});
 conflictDialog?.querySelector('[data-action="overwrite"]')?.addEventListener('click',()=>{void resolveChoice('overwrite');});
 conflictDialog?.querySelector('[data-action="later"]')?.addEventListener('click',()=>{
  conflictDialog.close();
  show('セーブの選択を保留しています。Google Driveに再接続すると再表示できます。');
 });
 const unsubscribe=onDungeonDataChange(db,schedule);
 windowImpl?.addEventListener?.('online',schedule);
 windowImpl?.document?.addEventListener?.('visibilitychange',()=>{if(!windowImpl.document.hidden)schedule();});
 async function acceptGoogleToken(result){
  if(result.error||!result.access_token){show('Google連携が完了しませんでした。');return;}
  expiryNoticeShown=false;
  windowImpl?.document?.getElementById('googleDriveExpiredDialog')?.close?.();
  token=result.access_token;
  expires=Date.now()+Math.max(0,Number(result.expires_in||3600)-60)*1000;
  choicePending=false;
  conflictDialog?.close();
  drive=createDungeonDrive(token,fetchImpl);
  button.textContent='Google Driveに再接続';
  windowImpl?.alert?.('バックアップ中は回転マークが表示されます。完了までページを閉じると最新の変更がDriveに保存されない場合があります。認証期限切れ時は再接続が必要です。');
  show('Google Driveとセーブデータを照合中…');
  await sync();
 }
 function loadIdentity(){
  return new Promise((resolve,reject)=>{
   if(globalThis.google?.accounts?.oauth2){resolve();return;}
   const script=document.createElement('script');
   script.src='https://accounts.google.com/gsi/client';
   script.async=true;
   script.onload=resolve;
   script.onerror=()=>reject(Error('Google認証ライブラリの読み込みに失敗しました。'));
   document.head.append(script);
  });
 }
 // Start loading the library ahead of the user's click to preserve iOS Safari user activation.
 void loadIdentity().then(()=>{
  if(stopped)return;
  client=globalThis.google.accounts.oauth2.initTokenClient({
   client_id:GOOGLE_CLIENT_ID,scope:DRIVE_SCOPE,
   callback:result=>{void acceptGoogleToken(result);},
   error_callback:()=>show('Googleログインが中断されました。再度お試しください。')
  });
  button.disabled=false;
  show('Google Driveに一度接続すると、接続中のセーブ変更は自動でバックアップされます。');
 }).catch(error=>show(error.message));
 button.disabled=true;
 const expiredDialog=windowImpl?.document?.getElementById('googleDriveExpiredDialog');
 expiredDialog?.querySelector('[data-action="reconnect"]')?.addEventListener('click',()=>{
  expiredDialog.close();
  if(client)client.requestAccessToken({prompt:'consent'});
 });
 expiredDialog?.querySelector('[data-action="later"]')?.addEventListener('click',()=>expiredDialog.close());
 button.addEventListener('click',()=>{
  if(!client)return;
  // Google requires a direct user gesture for this popup (not an awaited Promise).
  client.requestAccessToken({prompt:'consent'});
 });
 return {ready:true,unsubscribe,sync};
}
