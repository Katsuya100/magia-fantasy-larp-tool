import {checkSnapshotShape,quickFingerprint,digestPhoto} from './dungeon-cloud-integrity.mjs';
// Cloud payload deliberately includes the original magic-circle photos and raw game state.
// Only plain data crosses the network. No OAuth information is included in the payload.
const FORMAT='magia-dungeon-save-v1';
const MAX_PAYLOAD=100*1024*1024;
const MAX_PHOTO=25*1024*1024;
function toBase64(bytes){
 let result='';
 for(let i=0;i<bytes.length;i+=32766)result+=btoa(String.fromCharCode(...bytes.subarray(i,i+32766)));
 return result;
}
function fromBase64(text){
 if(typeof text!=='string'||text.length>MAX_PHOTO*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length%4)throw Error('不正な画像データです。');
 const binary=atob(text),bytes=new Uint8Array(binary.length);
 if(bytes.length>MAX_PHOTO)throw Error('画像データが大きすぎます。');
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
const assertShape=checkSnapshotShape;
// The profile can contain hidden photos in permadeath legacies, including
// nested lost rewards. JSON.stringify(Blob) silently turns those into {}.
async function encodeNested(value,depth=0){
 if(depth>50)throw Error('バックアップの入れ子が深すぎます。');
 if(value instanceof Blob){
  await digestPhoto(value);
  return {__magiaSavePhoto:true,type:value.type,base64:toBase64(new Uint8Array(await value.arrayBuffer()))};
 }
 if(Array.isArray(value))return Promise.all(value.map(item=>encodeNested(item,depth+1)));
 if(!value||typeof value!=='object')return value;
 const entries=await Promise.all(Object.entries(value).map(async ([key,item])=>[key,await encodeNested(item,depth+1)]));
 return Object.fromEntries(entries);
}
function decodeNested(value,depth=0){
 if(depth>50)throw Error('バックアップの入れ子が深すぎます。');
 if(!value||typeof value!=='object')return value;
 if(value.__magiaSavePhoto===true){
  if(typeof value.type!=='string')throw Error('遺物の画像形式が不正です。');
  return new Blob([fromBase64(value.base64)],{type:value.type});
 }
 if(Array.isArray(value))return value.map(item=>decodeNested(item,depth+1));
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeNested(item,depth+1)]));
}

export async function serializeDungeonSnapshot(snapshot){
 assertShape(snapshot);
 const circles=await Promise.all(snapshot.circles.map(async circle=>{
  if(circle.image==null)return {...circle,image:null};
   await digestPhoto(circle.image);
  if(!(circle.image instanceof Blob)||circle.image.size>MAX_PHOTO||!/^image\/(jpeg|png|webp|gif)$/.test(circle.image.type))throw Error('魔法陣画像の形式をバックアップできません。');
  return {...circle,image:{blob:true,type:circle.image.type,base64:toBase64(new Uint8Array(await circle.image.arrayBuffer()))}};
 }));
 const payload={format:FORMAT,savedAt:Number(snapshot.savedAt)||0,profile:await encodeNested(snapshot.profile),circles};
  const text=JSON.stringify({...payload,checksum:quickFingerprint(payload)});
 if(text.length>MAX_PAYLOAD)throw Error('バックアップ容量が上限を超えました。');
 return text;
}
export function deserializeDungeonSnapshot(text){
 if(typeof text!=='string'||text.length>MAX_PAYLOAD)throw Error('バックアップ容量が上限を超えました。');
 const data=JSON.parse(text);
 if(data?.format!==FORMAT)throw Error('未対応のバックアップ形式です。');
 assertShape(data);
 const {checksum,...payload}=data;
 if(checksum!==undefined&&checksum!==quickFingerprint(payload))throw Error('バックアップのチェックサムが一致しません。');
 if(data.savedAt!==undefined&&(!Number.isFinite(data.savedAt)||data.savedAt<0))throw Error('バックアップの保存日時が不正です。');
 const circles=data.circles.map(circle=>{
  if(circle.image===null||circle.image===undefined)return {...circle,image:null};
  if(circle.image?.blob!==true||typeof circle.image.type!=='string')throw Error('画像形式が不正です。');
  return {...circle,image:new Blob([fromBase64(circle.image.base64)],{type:circle.image.type})};
 });
 return {profile:decodeNested(data.profile),circles,savedAt:Number(data.savedAt)||0,legacy:checksum===undefined};
}
export function isPristineDungeonSnapshot(snapshot){
 const p=snapshot.profile;
 // A fresh installation asks for a name before the player can connect Google.
 // The name and tutorial flag alone must not prevent automatic cloud recovery.
 return !p.attempts&&!p.returns&&!p.run&&!p.pendingReturn
  &&Number(p.level||1)===1&&!p.xp&&!p.magicStones
  &&!p.deepestReturnedLayer&&!p.adventurerRank
  &&(!p.inventory||p.inventory.length===0)&&!snapshot.circles.length
  &&!Object.values(p.collection||{}).some(Boolean);
}
export async function snapshotHash(text,cryptoImpl=globalThis.crypto){
 if(!cryptoImpl?.subtle?.digest)throw Error('HTTPSの安全な環境で開いてください。');
 const bytes=new TextEncoder().encode(text);
 const digest=new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',bytes));
 return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
