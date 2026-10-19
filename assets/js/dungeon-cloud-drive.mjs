// Minimal Drive v3 client: appDataFolder only. Access token is memory-only.
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.appdata';
const API='https://www.googleapis.com/drive/v3/files';
const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
const FILE_NAME='magia-dungeon-save-v1.json';
export class DriveAuthError extends Error{}
export function createDungeonDrive(token,fetchImpl=globalThis.fetch){
 if(!token)throw Error('Google認証が必要です。');
 const headers={Authorization:'Bearer '+token};
 async function request(url,options={}){
  const response=await fetchImpl(url,{...options,headers:{...headers,...options.headers}});
  if(response.status===401)throw new DriveAuthError('Google認証の期限が切れました。再接続してください。');
  if(!response.ok)throw Error('Google Driveへの通信に失敗しました (HTTP '+response.status+')');
  return response;
 }
 async function list(){
  const search=new URLSearchParams({spaces:'appDataFolder',q:"name contains 'magia-dungeon-save-v1' and trashed = false",fields:'nextPageToken,files(id,name,modifiedTime)',pageSize:'100'});
  let page,files=[];
  do{
   if(page)search.set('pageToken',page);else search.delete('pageToken');
   const result=await (await request(API+'?'+search)).json();
   files.push(...(result.files||[]));
   page=result.nextPageToken;
  }while(page&&files.length<1000);
  return files.filter(file=>file.name===FILE_NAME||file.name.startsWith('magia-dungeon-save-v1-')).sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
 }
 async function download(id){
  return (await request(API+'/'+encodeURIComponent(id)+'?alt=media')).text();
 }
 async function upload(text,id=null){
  // Resumable upload handles large photos; simple/multipart uploads are size-limited.
  const bytes=new Blob([text],{type:'application/json'});
  const url=id?UPLOAD+'/'+encodeURIComponent(id)+'?uploadType=resumable&fields=id,modifiedTime':UPLOAD+'?uploadType=resumable&fields=id,modifiedTime';
  const init=await request(url,{
   method:id?'PATCH':'POST',
   headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(bytes.size)},
   body:JSON.stringify(id?{mimeType:'application/json'}:{name:FILE_NAME,mimeType:'application/json',parents:['appDataFolder']})
  });
  const session=init.headers.get('Location');
  if(!session||new URL(session).origin!=='https://www.googleapis.com')throw Error('Google Driveのアップロード先を取得できませんでした。');
  const done=await request(session,{method:'PUT',headers:{'Content-Type':'application/json'},body:bytes});
  const file=await done.json();
  if(!file?.id||!file.modifiedTime)throw Error('保存完了の確認ができませんでした。');
  return file;
 }
 async function uploadAtomic(text){
  const bytes=new Blob([text],{type:'application/json'});
  const name='magia-dungeon-save-v1-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.json';
  const init=await request(UPLOAD+'?uploadType=resumable&fields=id,modifiedTime',{
   method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(bytes.size)},
   body:JSON.stringify({name,mimeType:'application/json',parents:['appDataFolder']})
  });
  const session=init.headers.get('Location');
  if(!session||new URL(session).origin!=='https://www.googleapis.com')throw Error('安全なアップロード先を取得できませんでした。');
  const done=await request(session,{method:'PUT',headers:{'Content-Type':'application/json'},body:bytes});
  const file=await done.json();
  if(!file?.id)throw Error('バックアップの確定に失敗しました。');
  const written=await download(file.id);
  if(written!==text)throw Error('アップロード後の検証に失敗しました。以前のバックアップは保持されます。');
  return file;
 }
 async function metadata(id){
  return (await request(API+'/'+encodeURIComponent(id)+'?fields=id,name,modifiedTime')).json();
 }
 return {list,download,upload,uploadAtomic,metadata};
}
