import {digestPhoto} from './dungeon-cloud-integrity.mjs';

// A magic circle's original image stays in the 'circles' store throughout all
// generations. Historical character records keep ONLY its ID and image proof.
const PHOTO_REF='__magiaArchivedPhoto';
export const isArchivedPhotoRef=value=>Boolean(value&&typeof value==='object'&&value[PHOTO_REF]===true
 &&typeof value.id==='string'&&value.id.length>0
 &&typeof value.hash==='string'&&/^[0-9a-f]{64}$/.test(value.hash)
 &&typeof value.type==='string'&&Number.isInteger(value.size)&&value.size>0);

export async function prepareProfilePhotoRefs(profile){
 const photos=new Map(),parents=new Set();
 const visit=async(value,depth)=>{
  if(depth>50)throw Error('セーブ内の入れ子が深すぎます。');
  if(!value||typeof value!=='object'||isArchivedPhotoRef(value))return value;
  if(value instanceof Blob)throw Error('魔法陣IDのない画像はプロフィールに保存できません。');
  if(parents.has(value))throw Error('セーブ内の循環参照を検出しました。');
  parents.add(value);
  try{
   if(Array.isArray(value)){
    const result=[];
    for(const item of value)result.push(await visit(item,depth+1));
    return result;
   }
   const result={};
   for(const [key,item] of Object.entries(value)){
    if(key==='image'&&item instanceof Blob&&typeof value.id==='string'&&value.id){
     const hash=await digestPhoto(item),previous=photos.get(value.id);
     if(previous&&previous.hash!==hash)throw Error('同じ魔法陣IDに異なる画像が登録されています。');
     photos.set(value.id,{circle:value,hash});
     result.image={[PHOTO_REF]:true,id:value.id,hash,size:item.size,type:item.type};
    }else result[key]=await visit(item,depth+1);
   }
   return result;
  }finally{parents.delete(value);}
 };
 return {profile:await visit(profile,0),photos};
}

export async function restoreProfilePhotoRefs(profile,readCircle){
 const refs=new Map(),parents=new Set();
 const collect=(value,depth)=>{
  if(depth>50)throw Error('セーブ内の入れ子が深すぎます。');
  if(!value||typeof value!=='object'||value instanceof Blob)return;
  if(value[PHOTO_REF]===true){
   if(!isArchivedPhotoRef(value))throw Error('保存された魔法陣の参照情報が不正です。');
   const previous=refs.get(value.id);
   if(previous&&previous.hash!==value.hash)throw Error('魔法陣の参照情報が一致しません。');
   refs.set(value.id,value);return;
  }
  if(parents.has(value))throw Error('セーブ内の循環参照を検出しました。');
  parents.add(value);
  for(const item of Object.values(value))collect(item,depth+1);
  parents.delete(value);
 };
 collect(profile,0);
 if(refs.size>500)throw Error('魔法陣の数が上限を超えました。');
 if(!refs.size)return profile;
 const entries=await Promise.all([...refs].map(async ([id,ref])=>{
  const circle=await readCircle(id),blob=circle?.image;
  return [id,blob instanceof Blob&&blob.size===ref.size&&blob.type===ref.type?blob:null];
 }));
 const photos=new Map(entries);
 const inflate=value=>{
  if(isArchivedPhotoRef(value))return photos.get(value.id)??null;
  if(!value||typeof value!=='object'||value instanceof Blob)return value;
  if(Array.isArray(value))return value.map(inflate);
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,inflate(item)]));
 };
 return inflate(profile);
}

// Expand compact backup references from the one authoritative circles array.
export function restoreProfilePhotoRefsFromCircles(profile,circles){
 const byId=new Map(circles.map(circle=>[circle.id,circle]));
 const visit=(value,depth=0)=>{
  if(depth>50)throw Error('バックアップの入れ子が深すぎます。');
  if(!value||typeof value!=='object'||value instanceof Blob)return value;
  if(value[PHOTO_REF]===true){
   if(!isArchivedPhotoRef(value))throw Error('魔法陣の画像参照が不正です。');
   const blob=byId.get(value.id)?.image;
   if(!(blob instanceof Blob)||blob.size!==value.size||blob.type!==value.type)
    throw Error('バックアップに必要な魔法陣の画像が見つかりません。');
   return blob;
  }
  if(Array.isArray(value))return value.map(item=>visit(item,depth+1));
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item,depth+1)]));
 };
 return visit(profile);
}
