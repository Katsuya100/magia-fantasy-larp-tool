import {startingBase} from './dungeon-core.mjs';
import {applySavedUpgrade} from './dungeon-upgrades.mjs';
import {recordFingerprint,photoDescriptors,photoEvidence,profilePhotoEvidence,digestPhoto} from './dungeon-cloud-integrity.mjs';
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
  let result,tx;
  try{
   tx=db.transaction(store,mode);
   tx.oncomplete=()=>{if(mode==='readwrite'&&!silent)notifyDungeonDataChange(db);resolve(result);};
   tx.onerror=()=>reject(tx.error||Error('保存に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('保存が中断されました。'));
   const q=op(tx.objectStore(store));
   q.onsuccess=()=>{result=q.result;};
   q.onerror=()=>reject(q.error||Error('保存データにアクセスできません。'));
  }catch(error){reject(error);}
 });
}
// Read and verify the previous seal BEFORE applying writes. A missing record
// cannot be silently legitimized by a later (unrelated) profile update.
function mutate(db,perform,overrides={},profileHashes=null){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  let tx;
  try{
   tx=db.transaction(STORES,'readwrite');
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   const previousProfile=settings.get('profile'),previousCircles=items.getAll(),previousSeal=settings.get('integrity');
   let reads=0;
   const ready=()=>{
    if(++reads!==3)return;
    try{
     const p=previousProfile.result,c=previousCircles.result,seal=previousSeal.result;
     if(seal?.version===1){
      if(!p||seal.records!==recordFingerprint({profile:p,circles:c})||seal.savedAt===undefined)throw Error('保存データの整合性が一致しません。復元が必要です。');
     }
     perform(settings,items);
     const nextProfile=settings.get('profile'),nextCircles=items.getAll();
     let after=0;
     const stamp=()=>{
      if(++after!==2)return;
      const next={profile:nextProfile.result,circles:nextCircles.result};
      if(!next.profile)return;
      const desc=photoDescriptors(next.circles),old=seal?.photos||{};
      const photos=Object.fromEntries(next.circles.map(circle=>[circle.id,
       Object.hasOwn(overrides,circle.id)?overrides[circle.id]:
       Object.hasOwn(old,circle.id)?old[circle.id]:
       desc[circle.id]===null?null:'unknown'
      ]));
      const savedAt=Math.max(Date.now(),Number(seal?.savedAt||0)+1);
      settings.put({version:1,records:recordFingerprint(next),photos,profilePhotos:profileHashes||seal?.profilePhotos||{},savedAt,
       legacy:Boolean(seal?.legacy||(!seal&&Boolean(p||c.length))||Object.values(photos).includes('unknown'))},'integrity');
     };
     nextProfile.onsuccess=stamp;nextCircles.onsuccess=stamp;
    }catch(error){
     try{tx.abort?.();}catch{}
     reject(error);
    }
   };
   previousProfile.onsuccess=ready;previousCircles.onsuccess=ready;previousSeal.onsuccess=ready;
   tx.oncomplete=()=>{notifyDungeonDataChange(db);resolve();};
   tx.onerror=()=>reject(tx.error||Error('セーブの保存に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブの整合性を確認できませんでした。'));
  }catch(error){reject(error);}
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
export async function putCircle(db,circle,{repairImage=false}={}){
 const proof=circle.image==null?null:await digestPhoto(circle.image);
 const before=await readDungeonSnapshot(db);
 const prior=before.integrity?.photos?.[circle.id];
 // Regular record edits must never "bless" bytes that differ from the
 // previously trusted photo. Explicit repair is limited to the recovery UI.
 if(!repairImage&&typeof prior==='string'&&prior!=='unknown'&&proof!==prior)
  throw Error('以前の画像検証記録と一致しません。画像復旧画面から撮り直してください。');
 if(repairImage&&proof===null)throw Error('復旧画像がありません。');
 return mutate(db,(_settings,items)=>items.put(circle),{[circle.id]:proof});
}
export const deleteCircle=(db,id)=>mutate(db,(_settings,items)=>items.delete(id));
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
   transaction.objectStore('settings').put({blocked:true},'cloudSyncState');
  }catch(error){reject(error);}
 });
}
async function trustedProfileHashes(db,profile){
 const hashes=await profilePhotoEvidence(profile);
 const existing=await readDungeonSnapshot(db);
 const seal=existing.integrity;
 if(seal?.version===1&&!seal.legacy){
  const trusted=new Set([...Object.values(seal.photos||{}),...Object.values(seal.profilePhotos||{})].filter(x=>typeof x==='string'));
  if(Object.values(hashes).some(hash=>!trusted.has(hash)))
   throw Error('未確認の遺物画像があります。Driveへ誤保存しないため更新を停止しました。');
 }
 return hashes;
}
export async function saveProfile(db,p){
 const hashes=await trustedProfileHashes(db,p);
 return mutate(db,settings=>settings.put(p,'profile'),{},hashes);
}
// One IndexedDB transaction prevents a lost/recovered photo and its owner from diverging.
export async function saveProfileWithCircles(db,profile,added=[],removed=[]){
 const hashes=await photoEvidence(added),profileHashes=await trustedProfileHashes(db,profile);
 return mutate(db,(settings,items)=>{
  for(const id of removed)items.delete(id);
  for(const circle of added)items.put(circle);
  settings.put(profile,'profile');
 },hashes,profileHashes);
}

export async function getProfile(db){
  let p=await request(db,'settings','readonly',s=>s.get('profile'));
  if(!p){
    p={level:1,xp:0,base:startingBase(),returns:0,attempts:0,tutorialDone:false,inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,magicStones:0,run:null};
    const seal=await request(db,'settings','readonly',s=>s.get('integrity'));
    // A missing profile with a prior seal means corruption, not a new player.
    // Keep it missing on disk so Drive can restore the complete trusted save.
    if(!seal)await saveProfile(db,p);
  }
  return p;
}

/** Read raw magic circles and profile atomically; do not apply UI-only upgrades. */
export function readDungeonSnapshot(db){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readonly');
   let profile,circles,integrity;
   tx.oncomplete=()=>resolve({profile,circles,savedAt:integrity?.savedAt||0,integrity});
   tx.onerror=()=>reject(tx.error||Error('セーブの読み出しに失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブの読み出しが中断されました。'));
   const p=tx.objectStore('settings').get('profile');
   p.onsuccess=()=>{profile=p.result;};
   const c=tx.objectStore('circles').getAll();
   c.onsuccess=()=>{circles=c.result;};
   const i=tx.objectStore('settings').get('integrity');
   i.onsuccess=()=>{integrity=i.result;};
  }catch(error){reject(error);}
 });
}
export async function replaceDungeonSnapshot(db,{profile,circles,savedAt=0}){
 validateDatabase(db);
 const next={profile,circles};
 const records=recordFingerprint(next),photos=await photoEvidence(circles),profilePhotos=await profilePhotoEvidence(profile);
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
   settings.put({version:1,records,photos,profilePhotos,savedAt:Number(savedAt)||0,legacy:false},'integrity');
  }catch(error){reject(error);}
 });
}
// Legacy saves have no trusted photo seal. Seal only after the caller has checked
// that no sound Drive backup would be at risk from accepting this baseline.
export async function establishLegacyIntegrity(db,snapshot){
 const hashes=await photoEvidence(snapshot.circles),profileHashes=await profilePhotoEvidence(snapshot.profile),records=recordFingerprint(snapshot);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readwrite');
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   const p=settings.get('profile'),c=items.getAll(),old=settings.get('integrity');
   let pending=3;
   const done=()=>{
    if(--pending)return;
    if(recordFingerprint({profile:p.result,circles:c.result})!==records){reject(Error('検証中にセーブが変更されました。'));tx.abort?.();return;}
    const prev=old.result;
    if(prev?.version===1&&prev.records!==records){reject(Error('保存データの整合性が一致しません。'));tx.abort?.();return;}
    settings.put({version:1,records,photos:hashes,profilePhotos:profileHashes,savedAt:prev?.savedAt||Date.now(),legacy:false},'integrity');
   };
   p.onsuccess=done;c.onsuccess=done;old.onsuccess=done;
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||Error('検証情報を保存できませんでした。'));
   tx.onabort=()=>reject(tx.error||Error('検証が中断されました。'));
  }catch(error){reject(error);}
 });
}

export const getCloudSyncState=db=>request(db,'settings','readonly',s=>s.get('cloudSyncState'));
export const saveCloudSyncState=(db,state)=>request(db,'settings','readwrite',s=>s.put(state,'cloudSyncState'),{silent:true});
