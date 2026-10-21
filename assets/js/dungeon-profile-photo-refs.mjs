import {digestPhoto} from './dungeon-cloud-integrity.mjs';

// One logical dungeon save owns every generation. Historical photos are stored
// once in the same IndexedDB database, not rewritten with every profile edit.
const PHOTO_REF='__magiaArchivedPhoto';
export const archivedPhotoKey=(hash,type)=>'archivePhoto:'+hash+':'+type;
export const isArchivedPhotoRef=value=>Boolean(value&&typeof value==='object'&&value[PHOTO_REF]===true
 &&typeof value.hash==='string'&&/^[0-9a-f]{64}$/.test(value.hash)
 &&typeof value.type==='string'&&Number.isInteger(value.size)&&value.size>0);

export async function prepareProfilePhotoRefs(profile,knownHashes={}){
 const photos=new Map(),parents=new Set();
 const visit=async(value,path,depth)=>{
  if(depth>50)throw Error('セーブ内の入れ子が深すぎます。');
  if(value instanceof Blob){
   const hash=knownHashes[path]||await digestPhoto(value);
   if(!/^[0-9a-f]{64}$/.test(hash))throw Error('写真の検証情報が不正です。');
   const key=archivedPhotoKey(hash,value.type);
   photos.set(key,value);
   return {[PHOTO_REF]:true,hash,size:value.size,type:value.type};
  }
  if(!value||typeof value!=='object'||isArchivedPhotoRef(value))return value;
  if(parents.has(value))throw Error('セーブ内の循環参照を検出しました。');
  parents.add(value);
  try{
   if(Array.isArray(value)){
    const result=[];
    for(let i=0;i<value.length;i++)result.push(await visit(value[i],path+'['+JSON.stringify(String(i))+']',depth+1));
    return result;
   }
   const result={};
   for(const [key,item] of Object.entries(value))
    result[key]=await visit(item,path+'['+JSON.stringify(key)+']',depth+1);
   return result;
  }finally{parents.delete(value);}
 };
 return {profile:await visit(profile,'profile',0),photos};
}

export async function restoreProfilePhotoRefs(profile,readPhoto){
 const refs=new Map(),seen=new Set();
 const collect=(value,depth)=>{
  if(depth>50)throw Error('セーブ内の入れ子が深すぎます。');
  if(!value||typeof value!=='object'||value instanceof Blob)return;
  if(value[PHOTO_REF]===true){
   if(!isArchivedPhotoRef(value))throw Error('保存された写真の参照情報が不正です。');
   refs.set(archivedPhotoKey(value.hash,value.type),value);
   return;
  }
  if(seen.has(value))throw Error('セーブ内の循環参照を検出しました。');
  seen.add(value);
  for(const item of Object.values(value))collect(item,depth+1);
  seen.delete(value);
 };
 collect(profile,0);
 if(refs.size>1000)throw Error('写真の数が上限を超えました。');
 if(!refs.size)return profile;
 const entries=await Promise.all([...refs].map(async ([key,ref])=>{
  const blob=await readPhoto(key);
  return [key,blob instanceof Blob&&blob.size===ref.size&&blob.type===ref.type?blob:null];
 }));
 const photos=new Map(entries);
 const inflate=value=>{
  if(isArchivedPhotoRef(value))return photos.get(archivedPhotoKey(value.hash,value.type))??null;
  if(!value||typeof value!=='object'||value instanceof Blob)return value;
  if(Array.isArray(value))return value.map(inflate);
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,inflate(item)]));
 };
 return inflate(profile);
}
