import {startingBase,XP_SCALE,nextXp} from './dungeon-core.mjs?v=20261031.268';
import {v46NextXp} from './dungeon-xp-v46.mjs';
import {level as levelRow} from './dungeon-tuning.mjs';
import {applySavedUpgrade} from './dungeon-upgrades.mjs';
import {recordFingerprint,photoDescriptors,photoEvidence,profilePhotoEvidence,digestPhoto,verifyLocalSnapshot} from './dungeon-cloud-integrity.mjs';
import {prepareProfilePhotoRefs,restoreProfilePhotoRefs} from './dungeon-profile-photo-refs.mjs';
const DB_NAME='magia-dungeon-v1';
// v3 blocks old v2 game tabs from reopening after conversion.
const DB_VERSION=3;
const STORES=['circles','settings'];
// Modules can be imported with and without cache keys; preserve one listener bus.
const changes=globalThis[Symbol.for('magia-dungeon-save-changes')]??=new WeakMap();
// A successor name is stored separately so naming never rewrites large Blob
// values nested inside permadeath legacies. The signed profile is assembled
// from the canonical profile plus this small overlay when read.
const HEIR_NAME_KEY='heirNameOverride';
const XP_MIGRATION_BACKUP_KEY='xpMigrationBackupV1';
const XP_V46_RECOVERY_BACKUP_KEY='xpV46RecoveryBackupV1';
export const XP_INTEGER_VERSION=1;
// Reject accidental fractional writes after the one-time integer migration.
function assertWholeXp(profile){
 if(profile?.xpIntegerVersion!==XP_INTEGER_VERSION)return;
 const values=[['profile.xp',profile.xp]];
 if(profile.run)values.push(['run.xp',profile.run.xp??0]);
 if(profile.pendingReturn){
  values.push(['pendingReturn.gained',profile.pendingReturn.gained??0]);
  if(profile.pendingReturn.before)values.push(['pendingReturn.before.xp',profile.pendingReturn.before.xp]);
 }
 for(const [label,value] of values)
  if(!Number.isSafeInteger(value)||value<0)
   throw Error(label+' は整数EXPで保存してください。');
}
const thumbnailKey=id=>'circleThumbnail:'+id;
function applyHeirName(profile,overlay){
 return profile&&overlay?{...profile,...overlay}:profile;
}
// One random identity for the entire save history, including permadeath heirs.
function withPlayId(profile){
 if(!profile.playId){
  if(!globalThis.crypto?.randomUUID)throw Error('プレイの識別には安全なHTTPS接続が必要です。');
  profile.playId=globalThis.crypto.randomUUID();
 }
 return profile;
}
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
function mutate(db,perform,overrides={},profileHashes=null,{writesProfile=false,photoWrites=new Map(),expectedRevision=null,migrationSourceRecords=null,migrationSourceVersion=null}={}){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  let tx,committedAt;
  try{
   tx=db.transaction(STORES,'readwrite');
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   const previousProfile=settings.get('profile'),previousCircles=items.getAll(),previousSeal=settings.get('integrity');
   const previousName=settings.get(HEIR_NAME_KEY);
   let reads=0;
   const missingPhotos=new Set();
   const ready=()=>{
    if(++reads!==4+photoWrites.size)return;
    try{
     const p=applyHeirName(previousProfile.result,previousName.result),c=previousCircles.result,seal=previousSeal.result;
     const sourceRecords=p?recordFingerprint({profile:p,circles:c}):null;
     if(seal?.version===1){
      if(!p||seal.records!==sourceRecords||seal.savedAt===undefined)throw Error('保存データの整合性が一致しません。復元が必要です。');
     }
     // Detect stale in-memory profiles within the same write transaction.
     if(writesProfile&&expectedRevision!==null){
      const actual=Number.isSafeInteger(p?.saveRevision)?p.saveRevision:0;
      if(actual!==expectedRevision)throw Error('別のタブでセーブが更新されました。進捗を保護するため保存を停止しました。再読み込みしてください。');
     }
     if(migrationSourceRecords!==null){
      if(sourceRecords!==migrationSourceRecords||
       (migrationSourceVersion===46?p?.xpScaleVersion!==46:
        p?.xpScaleVersion!==undefined&&p?.xpScaleVersion!==null))
       throw Error('EXP変換中にセーブが変更されました。上書きせずに停止しました。再読み込みしてください。');
      // Back up the signed source in the same transaction. v46 conversion
      // never overwrites the earlier 1/45 migration backup.
      const backupKey=migrationSourceVersion===46?XP_V46_RECOVERY_BACKUP_KEY:XP_MIGRATION_BACKUP_KEY;
      settings.put({version:1,profile:p,circles:c,integrity:seal,sourceRecords,createdAt:Date.now()},backupKey);
     }
     perform(settings,items,c);
     // Store only newly encountered historical photos, atomically with the
     // metadata and integrity seal. Ordinary equipment saves never rewrite them.
     for(const [id,{circle}] of photoWrites)if(missingPhotos.has(id))items.put(circle);
     // A subsequent normal profile write incorporates the virtual name.
     // Delete the overlay atomically so stale names never override it.
     if(writesProfile)settings.delete(HEIR_NAME_KEY);
     const nextProfile=settings.get('profile'),nextCircles=items.getAll();
     let after=0;
     const stamp=()=>{
      if(++after!==2)return;
      const next={profile:applyHeirName(nextProfile.result,writesProfile?null:previousName.result),circles:nextCircles.result};
      if(!next.profile)return;
      const desc=photoDescriptors(next.circles),old=seal?.photos||{};
      const photos=Object.fromEntries(next.circles.map(circle=>[circle.id,
       Object.hasOwn(overrides,circle.id)?overrides[circle.id]:
       photoWrites.has(circle.id)?photoWrites.get(circle.id).hash:
       Object.hasOwn(old,circle.id)?old[circle.id]:
       desc[circle.id]===null?null:'unknown'
      ]));
      const savedAt=Math.max(Date.now(),Number(seal?.savedAt||0)+1);
      committedAt=savedAt;
      settings.put({version:1,records:recordFingerprint(next),photos,profilePhotos:profileHashes||seal?.profilePhotos||{},savedAt,
       legacy:Boolean(seal?.legacy||(!seal&&Boolean(p||c.length))||Object.values(photos).includes('unknown'))},'integrity');
     };
     nextProfile.onsuccess=stamp;nextCircles.onsuccess=stamp;
    }catch(error){
     try{tx.abort?.();}catch{}
     reject(error);
    }
   };
   previousProfile.onsuccess=ready;previousCircles.onsuccess=ready;previousSeal.onsuccess=ready;previousName.onsuccess=ready;
   for(const id of photoWrites.keys()){
    // getKey checks existence without deserializing or rewriting an image.
    const existing=items.getKey(id);
    existing.onsuccess=()=>{if(existing.result===undefined)missingPhotos.add(id);ready();};
   }
   tx.oncomplete=()=>{notifyDungeonDataChange(db);resolve(committedAt);};
   tx.onerror=()=>reject(tx.error||Error('セーブの保存に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブの整合性を確認できませんでした。'));
  }catch(error){reject(error);}
 });
}
// Lost magic stays in 'circles'; only its ownership changes across characters.
function lostCircleIds(profile){
 const lost=new Set();
 const scan=legacy=>{
  for(const circle of legacy?.circles||[])if(circle?.id)lost.add(circle.id);
  for(const reward of legacy?.loot||[])if(reward?.type==='legacy')scan(reward.legacy);
 };
 for(const legacy of profile?.legacies||[])scan(legacy);
 for(const reward of profile?.run?.loot||[])if(reward?.type==='legacy')scan(reward.legacy);
 return lost;
}
export async function allCircles(db){
 const [circles,profile]=await Promise.all([
  request(db,'circles','readonly',s=>s.getAll()),
  request(db,'settings','readonly',s=>s.get('profile'))
 ]);
 const upgrades=profile?.circleUpgrades||{},overrides=profile?.magicOverrides||{},lost=lostCircleIds(profile);
 return circles.filter(circle=>!lost.has(circle.id))
  .map(circle=>applySavedUpgrade({...circle,...(overrides[circle.id]||{})},upgrades[circle.id]));
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
 return mutate(db,(settings,items)=>{items.put(circle);if(repairImage)settings.delete(thumbnailKey(circle.id));},{[circle.id]:proof});
}
export const deleteCircle=(db,id)=>mutate(db,(settings,items)=>{items.delete(id);settings.delete(thumbnailKey(id));});
// Derived photos are not part of the sealed save or Drive backup.
export async function getCircleThumbnail(db,circle,createThumbnail,size=192){
 const [saved,integrity]=await Promise.all([
  request(db,'settings','readonly',s=>s.get(thumbnailKey(circle.id))),
  request(db,'settings','readonly',s=>s.get('integrity'))
 ]);
 const proof=integrity?.photos?.[circle.id];
 if(typeof proof==='string'&&saved?.proof===proof&&saved.image instanceof Blob&&saved.image.size&&(saved.size||192)>=size)return saved.image;
 const image=await createThumbnail(circle.image,size);
 if(typeof proof==='string'){
  // A full local-storage quota must not prevent viewing an existing photo.
  try{await request(db,'settings','readwrite',s=>s.put({proof,image,size},thumbnailKey(circle.id)),{silent:true});}
  catch(error){console.warn('縮小画像のキャッシュを保存できませんでした',error);}
 }
 return image;
}

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
  }catch(error){reject(error);}
 });
}
async function trustedProfileHashes(db,profile){
 const hashes=await profilePhotoEvidence(profile);
 const seal=await request(db,'settings','readonly',s=>s.get('integrity'));
 // The write transaction independently validates this seal against the
 // current stored profile and circles before committing any modification.
 if(seal?.version===1&&!seal.legacy){
  const trusted=new Set([...Object.values(seal.photos||{}),...Object.values(seal.profilePhotos||{})].filter(x=>typeof x==='string'));
  if(Object.values(hashes).some(hash=>!trusted.has(hash)))
   throw Error('未確認の遺物画像があります。Driveへ誤保存しないため更新を停止しました。');
 }
 return hashes;
}
export async function saveProfile(db,p,{migrationSourceRecords=null,migrationSourceVersion=null}={}){
 assertWholeXp(p);
 withPlayId(p);
 const expectedRevision=Number.isSafeInteger(p.saveRevision)?p.saveRevision:0;
 const hashes=await trustedProfileHashes(db,p);
 const prepared=await prepareProfilePhotoRefs(p);
 const nextRevision=expectedRevision+1;
 if(!Number.isSafeInteger(nextRevision))throw Error('セーブの改訂番号が上限を超えました。');
 await mutate(db,settings=>settings.put({...prepared.profile,saveRevision:nextRevision},'profile'),{},hashes,
  {writesProfile:true,photoWrites:prepared.photos,expectedRevision,migrationSourceRecords,migrationSourceVersion});
 p.saveRevision=nextRevision;
}
// One IndexedDB transaction prevents a lost/recovered photo and its owner from diverging.
export async function saveProfileWithCircles(db,profile,added=[],removed=[]){
 assertWholeXp(profile);
 withPlayId(profile);
 const hashes=await photoEvidence(added),profileHashes=await trustedProfileHashes(db,profile);
 if(added.length){
  profile.magicOverrides={...(profile.magicOverrides||{})};
  for(const circle of added){
   const {image,...metadata}=circle;
   profile.magicOverrides[circle.id]=metadata;
  }
 }
 const expectedRevision=Number.isSafeInteger(profile.saveRevision)?profile.saveRevision:0;
 const nextRevision=expectedRevision+1;
 if(!Number.isSafeInteger(nextRevision))throw Error('セーブの改訂番号が上限を超えました。');
 const prepared=await prepareProfilePhotoRefs(profile);
 const lost=lostCircleIds(profile);
 await mutate(db,(settings,items,previousCircles)=>{
  const present=new Set(previousCircles.map(circle=>circle.id));
  // A lost magic circle is inactive, NOT deleted from its one shared save.
  for(const id of removed)if(!lost.has(id)){items.delete(id);settings.delete(thumbnailKey(id));}
  // Upgraded/reclaimed magic is represented by metadata above; do not touch
  // existing Blob records. Only a previously unseen ID needs a first write.
  for(const circle of added)if(!present.has(circle.id))items.put(circle);
  settings.put({...prepared.profile,saveRevision:nextRevision},'profile');
 },hashes,profileHashes,{writesProfile:true,photoWrites:prepared.photos,expectedRevision});
 profile.saveRevision=nextRevision;
}
// Commit a successor name and its new integrity seal in one small transaction.
// No legacy photograph is re-serialized or copied by this path.
export function saveHeirName(db,name){
 const trimmed=typeof name==='string'?name.trim():'';
 if(!trimmed||trimmed.length>20)return Promise.reject(Error('1〜20文字の名前を入力してください。'));
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readwrite');
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   const p=settings.get('profile'),c=items.getAll(),sealRequest=settings.get('integrity'),overlay=settings.get(HEIR_NAME_KEY);
   let nextName=null,reads=0;
   const ready=()=>{
    if(++reads!==4)return;
    try{
     const raw=p.result,previous=applyHeirName(raw,overlay.result),seal=sealRequest.result;
     if(!previous?.awaitingHeir)throw Error('後継者名の入力状態が変更されました。画面を再読み込みしてください。');
     if(seal?.version===1&&(!raw||seal.records!==recordFingerprint({profile:previous,circles:c.result})||seal.savedAt===undefined))
      throw Error('保存データの整合性が一致しません。復元が必要です。');
     const nextRevision=(Number.isSafeInteger(previous.saveRevision)?previous.saveRevision:0)+1;
     if(!Number.isSafeInteger(nextRevision))throw Error('セーブの改訂番号が上限を超えました。');
     const next={...previous,name:trimmed,awaitingHeir:false,permadeath:true,saveRevision:nextRevision};
     withPlayId(next);
     const nameOverlay={name:trimmed,awaitingHeir:false,permadeath:true,saveRevision:nextRevision};
     if(!raw.playId)nameOverlay.playId=next.playId;
     const savedAt=Math.max(Date.now(),Number(seal?.savedAt||0)+1);
     settings.put(nameOverlay,HEIR_NAME_KEY);
     settings.put({version:1,records:recordFingerprint({profile:next,circles:c.result}),
      photos:seal?.photos||{},profilePhotos:seal?.profilePhotos||{},savedAt,
      legacy:Boolean(seal?.legacy||!seal)},'integrity');
     nextName=next;
    }catch(error){
     try{tx.abort?.();}catch{}
     reject(error);
    }
   };
   p.onsuccess=ready;c.onsuccess=ready;sealRequest.onsuccess=ready;overlay.onsuccess=ready;
   tx.oncomplete=()=>{notifyDungeonDataChange(db);void getProfile(db).then(resolve,reject);};
   tx.onerror=()=>reject(tx.error||Error('後継者名の保存に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('後継者名の保存が中断されました。'));
  }catch(error){reject(error);}
 });
}


/** Restore saved v46 integer EXP to the current v45 whole-EXP system.
 * v46 used different authored thresholds. Preserve gauge percentages,
 * previously earned levels, unbanked gains and return-animation endpoints.
 */
async function migrateDungeonXp46(db,p,source){
 const sourceRecords=recordFingerprint(source);
 const whole=(value,label)=>{
  if(!Number.isSafeInteger(value)||value<0)
   throw Error(label+' が不正です。元のセーブは変更していません。');
  return value;
 };
 const validState=(level,xp)=>{
  if(!Number.isSafeInteger(level)||level<1)throw Error('旧EXPのレベルが不正です。');
  whole(xp,'旧EXP');
  if(xp>=v46NextXp(level))throw Error('旧EXPとレベルが一致しません。元のセーブは変更していません。');
  return {level,xp};
 };
 const advance=(from,award)=>{
  let {level,xp}=from;
  xp+=whole(award,'旧EXP報酬');
  if(!Number.isSafeInteger(xp))throw Error('旧EXP報酬が大きすぎます。');
  while(xp>=v46NextXp(level)){xp-=v46NextXp(level);level++;}
  return {level,xp};
 };
 const mapGauge=({level,xp})=>{
  let gauge=Math.ceil(xp/v46NextXp(level)*nextXp(level));
  if(!Number.isSafeInteger(gauge))throw Error('変換後EXPが不正です。');
  while(gauge>=nextXp(level)){gauge-=nextXp(level);level++;}
  return {level,xp:gauge};
 };
 const difference=(before,after)=>{
  if(after.level<before.level)throw Error('帰還報酬のレベル順序が不正です。');
  let gain=after.xp-before.xp;
  for(let level=before.level;level<after.level;level++)gain+=nextXp(level);
  if(!Number.isSafeInteger(gain)||gain<0)throw Error('変換後EXP報酬が不正です。');
  return gain;
 };
 const original=validState(p.level,p.xp);
 const current=mapGauge(original);
 if(p.run){
  const oldGain=whole(p.run.xp??0,'探索中の旧EXP');
  p.run.xp=difference(current,mapGauge(advance(original,oldGain)));
 }
 if(p.pendingReturn){
  const oldGain=whole(p.pendingReturn.gained??0,'帰還中の旧EXP');
  let before=p.pendingReturn.before;
  if(!before){
   let level=original.level,xp=original.xp,remaining=oldGain;
   while(remaining>xp&&level>1){remaining-=xp;level--;xp=v46NextXp(level);}
   if(remaining>xp)throw Error('旧帰還報酬を復元できません。元のセーブは変更していません。');
   before={level,xp:xp-remaining};
  }
  const oldBefore=validState(before.level,before.xp);
  const oldEnd=advance(oldBefore,oldGain);
  if(oldEnd.level!==original.level||oldEnd.xp!==original.xp)
   throw Error('旧帰還報酬と保存されたEXPが一致しません。元のセーブは変更していません。');
  const newBefore=mapGauge(oldBefore);
  p.pendingReturn.before={...before,...newBefore};
  p.pendingReturn.gained=difference(newBefore,current);
 }
 p.level=current.level;p.xp=current.xp;
 p.xpScaleVersion=XP_SCALE;
 p.xpIntegerVersion=XP_INTEGER_VERSION;
 // Signed profile, original full backup and seal are written atomically.
 await saveProfile(db,p,{migrationSourceRecords:sourceRecords,migrationSourceVersion:46});
 return p;
}

// Convert signed legacy saves once, only after startup integrity verification.
// XP is stored in the new unit; all other player progress is unchanged.
export async function migrateDungeonXp(db){
 // Pin the source content; compare inside the final write transaction.
 const source=await readDungeonSnapshot(db);
 const p=await getProfile(db);
 if(!p||p.xpScaleVersion===XP_SCALE)return p;
 if(p.xpScaleVersion===46)return migrateDungeonXp46(db,p,source);
 const migrationSourceRecords=recordFingerprint(source);
 if(p.xpScaleVersion!==undefined&&p.xpScaleVersion!==null)
  throw Error('このセーブは未対応のEXPバージョンです。上書きせず復旧を停止しました。');
 const maxLevel=150;
 const oldNext=lvl=>Math.ceil(Number(levelRow(lvl).xp_to_next)*Math.pow(2.1,(Number(lvl)-1)/10));
 // Level and fraction of the current XP gauge are the durable progress.
 const convert=(xp,lvl)=>{
  const n=Number(xp);
  if(!Number.isFinite(n)||n<0)throw Error('旧経験値の値が不正です。セーブを更新せずに停止しました。');
  return Math.round(n/oldNext(lvl)*nextXp(lvl)*1e6)/1e6;
 };
 const rounded=n=>Math.max(0,Math.round(n*1e6)/1e6);
 const span=(before,after)=>{
  if(after.level<before.level)throw Error('旧経験値のレベル順序が不正です。');
  let earned=-before.xp;
  for(let level=before.level;level<after.level;level++)earned+=nextXp(level);
  if(after.level<maxLevel)earned+=after.xp;
  return rounded(earned);
 };
 const levelAfterOldAward=(level,xp,award)=>{
  let total=xp+award;
  while(level<maxLevel&&total>=oldNext(level)){total-=oldNext(level);level++;}
  return {level,xp:level>=maxLevel?0:total};
 };
 // Recalculate unbanked XP from the old expedition's actual end state,
 // not from the ratio at its starting level. The curves differ by level.
 const start={level:p.level,xp:convert(p.xp,p.level)};
 if(p.run){
  const oldAward=Number(p.run.xp||0);
  if(!Number.isFinite(oldAward)||oldAward<0)throw Error('探索中の旧経験値が不正です。');
  const oldEnd=levelAfterOldAward(p.level,Number(p.xp),oldAward);
  const newEnd={level:oldEnd.level,xp:oldEnd.level>=maxLevel?0:convert(oldEnd.xp,oldEnd.level)};
  p.run.xp=span(start,newEnd);
 }
 if(p.pendingReturn){
  const oldAward=Number(p.pendingReturn.gained||0);
  if(!Number.isFinite(oldAward)||oldAward<0)throw Error('帰還報酬の旧経験値が不正です。');
  // Reconstruct missing return-screen start state by reversing the exact old
  // level thresholds. A single ratio at the final level is not reversible.
  if(!p.pendingReturn.before){
   if(p.level>=maxLevel&&oldAward>0)
    throw Error('最大レベルの旧帰還報酬を安全に復元できません。旧セーブを保護して停止しました。');
   let level=p.level,xp=Number(p.xp),remaining=oldAward;
   while(remaining>xp&&level>1){remaining-=xp;level--;xp=oldNext(level);}
   if(remaining>xp)throw Error('旧帰還報酬と累計EXPが一致しません。旧セーブを保護して停止しました。');
   p.pendingReturn.before={level,xp:xp-remaining};
  }
  const before=p.pendingReturn.before;
  const beforeLevel=Number(before.level),oldBeforeXp=Number(before.xp);
  if(!Number.isSafeInteger(beforeLevel)||beforeLevel<1||beforeLevel>maxLevel||
   !Number.isFinite(oldBeforeXp)||oldBeforeXp<0||
   beforeLevel<maxLevel&&oldBeforeXp>=oldNext(beforeLevel))
   throw Error('帰還前の旧レベル・経験値が不正です。旧セーブを保護して停止しました。');
  const oldEnd=levelAfterOldAward(beforeLevel,oldBeforeXp,oldAward);
  if(oldEnd.level!==p.level||(p.level<maxLevel&&Math.abs(oldEnd.xp-Number(p.xp))>0.001))
   throw Error('帰還報酬とセーブ済みレベルが一致しません。旧セーブを保護して停止しました。');
  const beforeXp=convert(oldBeforeXp,beforeLevel);
  p.pendingReturn.gained=span({level:beforeLevel,xp:beforeXp},start);
  before.xp=beforeXp;
 }
 p.xp=start.xp;
 p.xpScaleVersion=XP_SCALE;
 // An old-scale restoration must always run the integer migration next.
 delete p.xpIntegerVersion;
 // The profile, XP-version marker and integrity seal commit in one transaction.
 await saveProfile(db,p,{migrationSourceRecords});
 return p;
}

/** Migrate XP_SCALE=45 decimal saves to whole EXP after integrity verification.
 * Signed profile/revision updates remain atomic; the original 1/45 migration
 * and its independent signed backup are not changed.
 */
export async function migrateDungeonIntegerXp(db){
 const p=await getProfile(db);
 if(!p||p.xpIntegerVersion===XP_INTEGER_VERSION)return p;
 if(p.xpScaleVersion!==XP_SCALE)throw Error('EXP整数化の前に1/45変換が必要です。');
 if(p.xpIntegerVersion!==undefined&&p.xpIntegerVersion!==null)
  throw Error('このセーブは未対応の整数EXPバージョンです。上書きせず停止しました。');
 const ceilXp=(value,label)=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(Math.ceil(n)))
   throw Error(label+' のEXPが不正です。');
  return Math.ceil(n);
 };
 const state=(level,xp)=>{
  if(!Number.isSafeInteger(level)||level<1)throw Error('EXPのレベルが不正です。');
  xp=ceilXp(xp,'保存済み');
  while(xp>=nextXp(level)){
   xp-=nextXp(level);
   level++;
   if(!Number.isSafeInteger(level))throw Error('EXPのレベルが上限を超えました。');
  }
  return {level,xp};
 };
 const rewardBetween=(before,after)=>{
  if(after.level<before.level)throw Error('帰還演出のレベル順序が不正です。');
  let gained=after.xp-before.xp;
  for(let level=before.level;level<after.level;level++)gained+=nextXp(level);
  if(!Number.isSafeInteger(gained)||gained<0)
   throw Error('帰還演出のEXPが一致しません。');
  return gained;
 };
 // Recover old return-screen starts before rounding when their metadata is
 // missing, so the animation still finishes at the exact saved end state.
 if(p.pendingReturn){
  const returnXp=ceilXp(p.pendingReturn.gained??0,'帰還報酬');
  if(!p.pendingReturn.before){
   let level=p.level,xp=Number(p.xp),remaining=Number(p.pendingReturn.gained??0);
   if(!Number.isFinite(xp)||xp<0)throw Error('帰還後EXPが不正です。');
   while(remaining>xp&&level>1){remaining-=xp;level--;xp=nextXp(level);}
   if(remaining>xp)throw Error('帰還前EXPを復元できません。');
   p.pendingReturn.before={level,xp:xp-remaining};
  }
  // Preserve the source reward's validity before replacing the display value.
  if(returnXp<0)throw Error('帰還報酬のEXPが不正です。');
 }
 const after=state(p.level,p.xp);
 if(p.run)p.run.xp=ceilXp(p.run.xp??0,'探索中');
 if(p.pendingReturn){
  const before=state(Number(p.pendingReturn.before.level),p.pendingReturn.before.xp);
  p.pendingReturn.before= {...p.pendingReturn.before,...before};
  p.pendingReturn.gained=rewardBetween(before,after);
 }
 p.level=after.level;
 p.xp=after.xp;
 p.xpIntegerVersion=XP_INTEGER_VERSION;
 await saveProfile(db,p);
 return p;
}
// Read-only full snapshot of the signed pre-recovery v46 save.
export async function getDungeonXp46RecoveryBackup(db){
 const backup=await request(db,'settings','readonly',s=>s.get(XP_V46_RECOVERY_BACKUP_KEY));
 if(!backup)return null;
 if(backup.version!==1||backup.profile?.xpScaleVersion!==46||!Array.isArray(backup.circles)||
  recordFingerprint({profile:backup.profile,circles:backup.circles})!==backup.sourceRecords||
  backup.integrity?.version===1&&backup.integrity.records!==backup.sourceRecords)
  throw Error('旧v46セーブの保全データが一致しません。');
 return backup;
}
// Read-only rescue point, unaffected by later game changes or cloud sync.
export async function getDungeonXpMigrationBackup(db){
 const backup=await request(db,'settings','readonly',s=>s.get(XP_MIGRATION_BACKUP_KEY));
 if(!backup)return null;
 if(backup.version!==1||!backup.profile||!Array.isArray(backup.circles)||
  recordFingerprint({profile:backup.profile,circles:backup.circles})!==backup.sourceRecords)
  throw Error('EXP変換前バックアップの整合性が一致しません。');
 if(backup.integrity?.version===1&&backup.integrity.records!==backup.sourceRecords)
  throw Error('EXP変換前バックアップの署名が一致しません。');
 return backup;
}
export const hasDungeonXpMigrationBackup=db=>request(db,'settings','readonly',s=>s.getKey(XP_MIGRATION_BACKUP_KEY)).then(key=>key!==undefined);
// Rolling back also discards all play after migration; only explicit UI
// confirmation may call this API. Full SHA checks guard original photos.
export async function restoreDungeonXpMigrationBackup(db){
 const backup=await getDungeonXpMigrationBackup(db);
 if(!backup)throw Error('EXP変換前の保全データが見つかりません。');
 const snapshot={profile:backup.profile,circles:backup.circles,integrity:backup.integrity,savedAt:backup.integrity?.savedAt||0};
 const health=await verifyLocalSnapshot(snapshot);
 if(health.status==='corrupt'||health.status==='badImages')
  throw Error('EXP変換前の保全データの署名または写真が一致しません。復元を停止しました。');
 if(health.status==='legacy'){await photoEvidence(snapshot.circles);await profilePhotoEvidence(snapshot.profile);}
 const current=await readDungeonSnapshot(db);
 await replaceDungeonSnapshot(db,snapshot,{expectedCurrentRecords:recordFingerprint(current)});
}
export async function getProfile(db){
  const [raw,nameOverride]=await Promise.all([
   request(db,'settings','readonly',s=>s.get('profile')),
   request(db,'settings','readonly',s=>s.get(HEIR_NAME_KEY))
  ]);
  let p=await restoreProfilePhotoRefs(applyHeirName(raw,nameOverride),id=>request(db,'circles','readonly',s=>s.get(id)));
  if(!p){
    p={level:1,xp:0,xpScaleVersion:XP_SCALE,xpIntegerVersion:XP_INTEGER_VERSION,base:startingBase(),returns:0,attempts:0,tutorialDone:false,inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReachedLayer:0,deepestReturnedLayer:0,magicStones:0,magicInk:0,run:null};
    const seal=await request(db,'settings','readonly',s=>s.get('integrity'));
    // A missing profile with a prior seal means corruption, not a new player.
    // Keep it missing on disk so Drive can restore the complete trusted save.
    if(!seal)await saveProfile(db,p);
  }
  if(p&&!p.playId)withPlayId(p); // Legacy: persist this ID with the next actual game edit.
  return p;
}

/** Read raw magic circles and profile atomically; do not apply UI-only upgrades. */
export function readDungeonSnapshot(db){
 validateDatabase(db);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readonly');
   let profile,circles,integrity,nameOverride;
   tx.oncomplete=()=>{const byId=new Map(circles.map(circle=>[circle.id,circle]));
    void restoreProfilePhotoRefs(applyHeirName(profile,nameOverride),id=>Promise.resolve(byId.get(id)))
    .then(restored=>resolve({profile:restored,circles,savedAt:integrity?.savedAt||0,integrity}),reject);};
   tx.onerror=()=>reject(tx.error||Error('セーブの読み出しに失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブの読み出しが中断されました。'));
   const p=tx.objectStore('settings').get('profile');
   p.onsuccess=()=>{profile=p.result;};
   const c=tx.objectStore('circles').getAll();
   c.onsuccess=()=>{circles=c.result;};
   const i=tx.objectStore('settings').get('integrity');
   i.onsuccess=()=>{integrity=i.result;};
   const n=tx.objectStore('settings').get(HEIR_NAME_KEY);
   n.onsuccess=()=>{nameOverride=n.result;};
  }catch(error){reject(error);}
 });
}
export async function replaceDungeonSnapshot(db,{profile,circles,savedAt=0},{expectedCurrentRecords=null,expectedCurrentSavedAt=null}={}){
 validateDatabase(db);
 const prepared=await prepareProfilePhotoRefs(profile);
 const all=[...circles];
 for(const [id,{circle}] of prepared.photos)if(!all.some(existing=>existing.id===id))all.push(circle);
 const records=recordFingerprint({profile,circles:all}),photos=await photoEvidence(all),profilePhotos=await profilePhotoEvidence(profile);
 return new Promise((resolve,reject)=>{
  try{
   const tx=db.transaction(STORES,'readwrite');
   tx.oncomplete=()=>{notifyDungeonDataChange(db);resolve();};
   tx.onerror=()=>reject(tx.error||Error('セーブ復元に失敗しました。'));
   tx.onabort=()=>reject(tx.error||Error('セーブ復元が中断されました。'));
   const settings=tx.objectStore('settings'),items=tx.objectStore('circles');
   const write=()=>{
    settings.clear();items.clear();
    settings.put(prepared.profile,'profile');
    for(const circle of all)items.put(circle);
    settings.put({version:1,records,photos,profilePhotos,savedAt:Number(savedAt)||0,legacy:false},'integrity');
   };
   if(expectedCurrentRecords!==null||expectedCurrentSavedAt!==null){
    const p=settings.get('profile'),c=items.getAll(),n=settings.get(HEIR_NAME_KEY),proof=settings.get('integrity');
    let remaining=4;
    const check=()=>{
     if(--remaining)return;
     try{
      if(expectedCurrentRecords!==null&&
         recordFingerprint({profile:applyHeirName(p.result,n.result),circles:c.result})!==expectedCurrentRecords)
       throw Error('保全データの復元中に別のタブがセーブを更新しました。上書きを停止しました。');
      if(expectedCurrentSavedAt!==null&&Number(proof.result?.savedAt||0)!==Number(expectedCurrentSavedAt))
       throw Error('保全データの復元中に別のタブでセーブが更新されました。上書きを停止しました。');
      write();
     }catch(error){try{tx.abort?.();}catch{}reject(error);}
    };
    p.onsuccess=check;c.onsuccess=check;n.onsuccess=check;proof.onsuccess=check;
   }else write();
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
    // Conversion must not falsely advance the game's last-save timestamp.
    const priorDate=Number(prev?.savedAt);
    const savedAt=Number.isFinite(priorDate)&&priorDate>0?priorDate:0;
    settings.put({version:1,records,photos:hashes,profilePhotos:profileHashes,savedAt,legacy:false},'integrity');
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
