// Cloud payload deliberately includes the original magic-circle photos and raw game state.
// Only plain data crosses the network. No OAuth information is included in the payload.
const FORMAT='magia-dungeon-save-v1';
const MAX_PAYLOAD=100*1024*1024;
const MAX_PHOTO=25*1024*1024;
function toBase64(bytes){
 let result='';
 for(let i=0;i<bytes.length;i+=32768)result+=btoa(String.fromCharCode(...bytes.subarray(i,i+32768)));
 return result;
}
function fromBase64(text){
 if(typeof text!=='string'||text.length>MAX_PHOTO*2||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||text.length%4)throw Error('不正な画像データです。');
 const binary=atob(text),bytes=new Uint8Array(binary.length);
 if(bytes.length>MAX_PHOTO)throw Error('画像データが大きすぎます。');
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
function assertShape(snapshot){
 if(!snapshot||typeof snapshot!=='object'||!snapshot.profile||typeof snapshot.profile!=='object'||Array.isArray(snapshot.profile)||!Array.isArray(snapshot.circles)||snapshot.circles.length>500)throw Error('セーブデータの形式が不正です。');
 const ids=new Set();
 for(const circle of snapshot.circles){
  if(!circle||typeof circle!=='object'||typeof circle.id!=='string'||!circle.id||ids.has(circle.id))throw Error('魔法陣データが不正です。');
  ids.add(circle.id);
 }
}
export async function serializeDungeonSnapshot(snapshot){
 assertShape(snapshot);
 const circles=await Promise.all(snapshot.circles.map(async circle=>{
  if(circle.image==null)return {...circle,image:null};
  if(!(circle.image instanceof Blob)||circle.image.size>MAX_PHOTO)throw Error('魔法陣画像をバックアップできません。');
  return {...circle,image:{blob:true,type:circle.image.type,base64:toBase64(new Uint8Array(await circle.image.arrayBuffer()))}};
 }));
 const payload={format:FORMAT,profile:snapshot.profile,circles,savedAt:Number.isFinite(snapshot.savedAt)?snapshot.savedAt:Date.now()};
 payload.checksum=await snapshotHash(JSON.stringify(payload));
 const text=JSON.stringify(payload);
 if(text.length>MAX_PAYLOAD)throw Error('バックアップ容量が上限を超えました。');
 return text;
}
export async function verifyDungeonSnapshot(text){
 if(typeof text!=='string'||text.length>MAX_PAYLOAD)throw Error('バックアップ容量が上限を超えました。');
 const data=JSON.parse(text);
 if(data?.format!==FORMAT)throw Error('未対応のバックアップ形式です。');
 assertShape(data);
 if(data.checksum!==undefined){
  if(typeof data.checksum!=='string'||!Number.isFinite(data.savedAt))throw Error('バックアップの検証情報が不正です。');
  const {checksum,...payload}=data;
  if(await snapshotHash(JSON.stringify(payload))!==checksum)throw Error('バックアップのチェックサムが一致しません。');
 }
 return deserializeDungeonSnapshot(text);
}
export function deserializeDungeonSnapshot(text){
 if(typeof text!=='string'||text.length>MAX_PAYLOAD)throw Error('バックアップ容量が上限を超えました。');
 const data=JSON.parse(text);
 if(data?.format!==FORMAT)throw Error('未対応のバックアップ形式です。');
 assertShape(data);
 const circles=data.circles.map(circle=>{
  if(circle.image===null||circle.image===undefined)return {...circle,image:null};
  if(circle.image?.blob!==true||typeof circle.image.type!=='string')throw Error('画像形式が不正です。');
  return {...circle,image:new Blob([fromBase64(circle.image.base64)],{type:circle.image.type})};
 });
 return {profile:data.profile,circles,savedAt:data.savedAt??null};
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
