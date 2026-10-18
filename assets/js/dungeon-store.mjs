import {startingBase} from './dungeon-core.mjs';
import {applySavedUpgrade} from './dungeon-upgrades.mjs';
const DB_NAME='magia-dungeon-v1';
const DB_VERSION=2;
const STORES=['circles','settings'];
const changes=new WeakMap();
function notifyDungeonDataChange(db){
 for(const cb of changes.get(db)||[])try{cb();}catch(error){console.error('セーブ変更通知の失敗',error);}
}
export function onDungeonDataChange(db,cb){
 if(!changes.has(db))changes.set(db,new Set());
 changes.get(db).add(cb);
 return ()=>changes.get(db)?.delete(cb);
}
export function validateDatabase(db){
  if(!db||typeof db.transaction!=='function')throw Error('ブラウザの保存領域を開けませんでした。通常モードでページを開き直してください。');
  if(!STORES.every(name=>db.objectStoreNames?.contains(name)))throw Error('魔導書の保存領域が不完全です。ブラウザのサイトデータ設定を確認してください。');
  return db;
}
export function openStore(factory=globalThis.indexedDB){
  return new Promise((resolve,reject)=>{
    if(!factory?.open){reject(Error('このブラウザでは魔導書を保存できません（IndexedDB非対応）。'));return;}
    let settled=false;
    const fail=e=>{if(!settled){settled=true;reject(e instanceof Error?e:Error(String(e)));}};
    let q;
    try{q=factory.open(DB_NAME,DB_VERSION);}catch(e){fail(e);return;}
    q.onupgradeneeded=()=>{const db=q.result;if(!db)throw Error('保存データベースの初期化に失敗');for(const name of STORES)if(!db.objectStoreNames.contains(name))db.createObjectStore(name,name==='circles'?{keyPath:'id'}:undefined);};
    q.onsuccess=event=>{
      let db;
      try{db=validateDatabase(event?.target?.result||q.result);}
      catch(e){fail(e);return;}
      if(!settled){settled=true;db.onversionchange=()=>db.close();resolve(db);}
    };
    q.onerror=()=>fail(q.error||Error('魔導書の保存領域を開けませんでした。'));
    q.onblocked=()=>fail(Error('別のタブで魔導書を開いています。ほかのタブを閉じて再度お試しください。'));
  });
}
function request(db,store,mode,op,{silent=false}={}){
  validateDatabase(db);
  return new Promise((resolve,reject)=>{
    let result,transaction;
    try{
      transaction=db.transaction(store,mode);
      transaction.oncomplete=()=>{if(mode==='readwrite'&&!silent)notifyDungeonDataChange(db);resolve(result);};
      transaction.onerror=()=>reject(transaction.error||Error('保存に失敗しました。'));
      transaction.onabort=()=>reject(transaction.error||Error('保存が中断されました。'));
      const q=op(transaction.objectStore(store));
      q.onsuccess=()=>{result=q.result;};
      q.onerror=()=>reject(q.error||Error('保存データにアクセスできません。'));
    }catch(e){reject(e);}
  });
}
export async function allCircles(db){
 const [circles,profile]=await Promise.all([
  request(db,'circles','readonly',s=>s.getAll()),
  request(db,'settings','readonly',s=>s.get('profile'))
 ]);
 const upgrades=profile?.circleUpgrades||{};
 return circles.map(circle=>applySavedUpgrade(circle,upgrades[circle.id]));
}
export const putCircle=(db,circle)=>request(db,'circles','readwrite',s=>s.put(circle));
export const deleteCircle=(db,id)=>request(db,'circles','readwrite',s=>s.delete(id));
// Atomically erase only this dungeon game's own IndexedDB data.
// Keeping both stores in one transaction prevents a partially erased profile.
export function clearDungeonData(db){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  try{
   const transaction=db.transaction(STORES,'readwrite');
   transaction.oncomplete=()=>{notifyDungeonDataChange(db);resolve();};
   transaction.onerror=()=>reject(transaction.error||Error('保存データの削除に失敗しました。'));
   transaction.onabort=()=>reject(transaction.error||Error('保存データの削除が中断されました。'));
   for(const name of STORES)transaction.objectStore(name).clear();
   // A local wipe must not silently resurrect an old cloud backup.
   transaction.objectStore('settings').put({blocked:true},'cloudSyncState');
  }catch(error){reject(error);}
 });
}
export const saveProfile=(db,p)=>request(db,'settings','readwrite',s=>s.put(p,'profile'));
export async function getProfile(db){
  let p=await request(db,'settings','readonly',s=>s.get('profile'));
  if(!p){
    p={level:1,xp:0,base:startingBase(),returns:0,attempts:0,tutorialDone:false,inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,magicStones:0,run:null};
    await saveProfile(db,p);
  }
  return p;
}

/** Read raw magic circles and profile atomically; do not apply UI-only upgrades. */
export function readDungeonSnapshot(db){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readonly');
   let profile,circles;
   tx.oncomplete=()=>resolve({profile,circles});
   tx.onerror=()=>reject(tx.error||Error('セーブの読み出しに失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブの読み出しが中断されました。'));
   const p=tx.objectStore('settings').get('profile');
   p.onsuccess=()=>{profile=p.result;};
   const c=tx.objectStore('circles').getAll();
   c.onsuccess=()=>{circles=c.result;};
  }catch(error){reject(error);}
 });
}
export function replaceDungeonSnapshot(db,{profile,circles}){
 validateDatabase(db);
 if(!profile||typeof profile!=='object'||!Array.isArray(circles))return Promise.reject(Error('セーブの形式が不正です。'));
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readwrite');
   tx.oncomplete=()=>{notifyDungeonDataChange(db);resolve();};
   tx.onerror=()=>reject(tx.error||Error('セーブ復元に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブ復元が中断されました。'));
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   settings.clear();items.clear();
   settings.put(profile,'profile');
   for(const circle of circles)items.put(circle);
  }catch(error){reject(error);}
 });
}
export const getCloudSyncState=db=>request(db,'settings','readonly',store=>store.get('cloudSyncState'));
export const saveCloudSyncState=(db,state)=>request(db,'settings','readwrite',store=>store.put(state,'cloudSyncState'),{silent:true});
