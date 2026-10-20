// A record seal is written in the same IndexedDB transaction as each game mutation.
// Photos are separately SHA-256 checked; corrupted bytes cannot be blessed by a later profile save.
export function quickFingerprint(value){
 const text=JSON.stringify(value);
 let a=2166136261,b=0x9e3779b9;
 for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b^n,2246822519);}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function checkSnapshotShape(snapshot){
 const p=snapshot?.profile,c=snapshot?.circles;
 if(!p||typeof p!=='object'||Array.isArray(p)||!Array.isArray(c)||c.length>500)throw Error('セーブデータの形式が不正です。');
 if(p.name!==undefined&&typeof p.name!=='string')throw Error('冒険者名が不正です。');
 if(p.playId!==undefined&&(typeof p.playId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.playId)))throw Error('プレイ識別子が不正です。');
 if(p.level!==undefined&&(!Number.isFinite(p.level)||p.level<1))throw Error('レベルが不正です。');
 if(p.inventory!==undefined&&!Array.isArray(p.inventory))throw Error('所持品データが不正です。');
 if(p.run!==undefined&&p.run!==null&&(typeof p.run!=='object'||Array.isArray(p.run)))throw Error('探索データが不正です。');
 const ids=new Set();
 for(const circle of c){
  if(!circle||typeof circle!=='object'||Array.isArray(circle)||typeof circle.id!=='string'||!circle.id||ids.has(circle.id))throw Error('魔法陣データが不正です。');
  ids.add(circle.id);
 }
}
export function recordFingerprint(snapshot){
 checkSnapshotShape(snapshot);
 return quickFingerprint({
  profile:JSON.parse(JSON.stringify(snapshot.profile,(_key,value)=>
   value instanceof Blob?{__photo:true,size:value.size,type:value.type}:value)),
  circles:snapshot.circles.map(({image,...other})=>other)
 });
}
export function photoDescriptors(circles){
 return Object.fromEntries(circles.map(c=>[c.id,c.image instanceof Blob?{size:c.image.size,type:c.image.type}:null]));
}
const cachedDigests=new WeakMap();
export async function digestPhoto(blob,cryptoImpl=globalThis.crypto){
 // An existing image's exact bytes are authenticated by a trusted SHA-256
 // proof. Strict file signatures are not assumed: some camera/exporters add
 // metadata or encode noncanonical container variants.
 if(!(blob instanceof Blob)||blob.size<1||blob.size>25*1024*1024||!(blob.type===''||/^image\/(jpeg|png|webp|gif)$/.test(blob.type)))throw Error('魔法陣画像が欠損・破損しています。');
 if(!cryptoImpl?.subtle?.digest)throw Error('HTTPSの安全な環境で開いてください。');
 if(cryptoImpl===globalThis.crypto&&cachedDigests.has(blob))return cachedDigests.get(blob);
 const hash=new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',await blob.arrayBuffer()));
 const digest=[...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(cryptoImpl===globalThis.crypto)cachedDigests.set(blob,digest);
 return digest;
}
export async function photoEvidence(circles){
 const pairs=await Promise.all(circles.map(async circle=>[circle.id,circle.image==null?null:await digestPhoto(circle.image)]));
 return Object.fromEntries(pairs);
}
// Images in permadeath legacies and nested rewards also belong to the save.
function nestedPhotos(value,path='profile',result={},depth=0,parents=new Set()){
 if(depth>50)throw Error('セーブ内の入れ子が深すぎます。');
 if(value instanceof Blob){result[path]=value;return result;}
 if(!value||typeof value!=='object')return result;
 if(parents.has(value))throw Error('セーブ内の循環参照を検出しました。');
 parents.add(value);
 for(const [key,item] of Object.entries(value))
  nestedPhotos(item,path+'['+JSON.stringify(key)+']',result,depth+1,parents);
 parents.delete(value);
 return result;
}
export async function profilePhotoEvidence(profile){
 const photos=nestedPhotos(profile);
 if(Object.keys(photos).length>1000)throw Error('写真の数が上限を超えました。');
 return Object.fromEntries(await Promise.all(Object.entries(photos).map(async ([key,blob])=>[key,await digestPhoto(blob)])));
}
export async function verifyLocalSnapshot(snapshot){
 try{checkSnapshotShape(snapshot);}catch(error){return {status:'corrupt',message:error.message,badImageIds:[]};}
 const proof=snapshot.integrity;
 if(!proof||proof.version!==1||proof.legacy||Object.values(proof.photos||{}).some(x=>x==='unknown'))
  return {status:'legacy',badImageIds:[]};
 if(proof.records!==recordFingerprint(snapshot)||proof.savedAt!==snapshot.savedAt)
  return {status:'corrupt',message:'セーブ本体の整合性が一致しません。',badImageIds:[]};
 let nestedHashes;
 try{nestedHashes=await profilePhotoEvidence(snapshot.profile);}
 catch(error){return {status:'corrupt',message:error.message,badImageIds:[]};}
 const baseline=proof.profilePhotos||{};
 if(Object.keys(nestedHashes).length!==Object.keys(baseline).length||
    Object.entries(nestedHashes).some(([path,hash])=>baseline[path]!==hash))
  return {status:'corrupt',message:'遺物の写真データが検証記録と一致しません。',badImageIds:[]};
 const descriptors=photoDescriptors(snapshot.circles);
 const ids=snapshot.circles.map(c=>c.id);
 if(ids.length!==Object.keys(proof.photos||{}).length||ids.some(id=>!(id in proof.photos)))
  return {status:'corrupt',message:'魔法陣の記録数が一致しません。',badImageIds:[]};
 const badImageIds=[];
 for(const circle of snapshot.circles){
  const expected=proof.photos[circle.id];
  if(circle.image==null){badImageIds.push(circle.id);continue;}
  try{
   if(typeof expected!=='string'||!(circle.image instanceof Blob)||!circle.image.type||
    !descriptors[circle.id]||await digestPhoto(circle.image)!==expected)badImageIds.push(circle.id);
  }catch{badImageIds.push(circle.id);}
 }
 return {status:badImageIds.length?'badImages':'valid',badImageIds};
}
