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
 return quickFingerprint({profile:snapshot.profile,circles:snapshot.circles.map(({image,...other})=>other)});
}
export function photoDescriptors(circles){
 return Object.fromEntries(circles.map(c=>[c.id,c.image instanceof Blob?{size:c.image.size,type:c.image.type}:null]));
}
export async function digestPhoto(blob,cryptoImpl=globalThis.crypto){
 // An existing image's exact bytes are authenticated by a trusted SHA-256
 // proof. Strict file signatures are not assumed: some camera/exporters add
 // metadata or encode noncanonical container variants.
 if(!(blob instanceof Blob)||blob.size<1||blob.size>25*1024*1024||!(blob.type===''||/^image\/(jpeg|png|webp|gif)$/.test(blob.type)))throw Error('魔法陣画像が欠損・破損しています。');
 if(!cryptoImpl?.subtle?.digest)throw Error('HTTPSの安全な環境で開いてください。');
 const hash=new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',await blob.arrayBuffer()));
 return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function photoEvidence(circles){
 const pairs=await Promise.all(circles.map(async circle=>[circle.id,circle.image==null?null:await digestPhoto(circle.image)]));
 return Object.fromEntries(pairs);
}
export async function verifyLocalSnapshot(snapshot){
 try{checkSnapshotShape(snapshot);}catch(error){return {status:'corrupt',message:error.message,badImageIds:[]};}
 const proof=snapshot.integrity;
 if(!proof||proof.version!==1||proof.legacy||Object.values(proof.photos||{}).some(x=>x==='unknown'))return {status:'legacy',badImageIds:[]};
 if(proof.records!==recordFingerprint(snapshot)||proof.savedAt!==snapshot.savedAt)return {status:'corrupt',message:'セーブ本体の整合性が一致しません。',badImageIds:[]};
 const descriptors=photoDescriptors(snapshot.circles);
 const ids=snapshot.circles.map(c=>c.id);
 if(ids.length!==Object.keys(proof.photos||{}).length||ids.some(id=>!(id in proof.photos)))return {status:'corrupt',message:'魔法陣の記録数が一致しません。',badImageIds:[]};
 const badImageIds=[];
 for(const circle of snapshot.circles){
  const expected=proof.photos[circle.id];
  if(expected===null&&circle.image==null)continue;
  try{
   if(typeof expected!=='string'||!(circle.image instanceof Blob)||!circle.image.type||!descriptors[circle.id]||await digestPhoto(circle.image)!==expected)badImageIds.push(circle.id);
  }catch{badImageIds.push(circle.id);}
 }
 return {status:badImageIds.length?'badImages':'valid',badImageIds};
}
