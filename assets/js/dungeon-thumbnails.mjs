// Disposable, separately persisted thumbnails. Never mutate the signed dungeon
// save, and never run more than one image decode at a time.
const CACHE_NAME='magia-dungeon-thumbnails-v1';
const SIZE=240;
async function shrink(photo){
 let bitmap;
 try{
  try{bitmap=await createImageBitmap(photo,{resizeWidth:SIZE,resizeQuality:'medium'});}
  catch{bitmap=await createImageBitmap(photo);}
  const canvas=document.createElement('canvas');
  canvas.width=SIZE;canvas.height=SIZE;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('サムネイル用キャンバスを開けませんでした');
  const side=Math.min(bitmap.width,bitmap.height);
  ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,SIZE,SIZE);
  const output=await new Promise((resolve,reject)=>
   canvas.toBlob(blob=>blob?resolve(blob):reject(Error('サムネイルを保存できませんでした')),'image/jpeg',.78));
  canvas.width=1;canvas.height=1;
  return output;
 }finally{bitmap?.close?.();}
}
export function createCircleThumbnails({
 makeThumbnail=shrink,openCache=()=>globalThis.caches?.open(CACHE_NAME),
 createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)
}={}){
 let proofs={},paused=false,busy=false,current=Promise.resolve(),generation=0;
 const queued=[],pending=new Map(),live=new Map();
 function cacheKey(id){
  const proof=proofs[id];
  if(typeof proof!=='string'||!/^[a-f\d]{64}$/.test(proof))return null;
  return new URL('assets/dungeon-thumbnails/'+encodeURIComponent(id)+'-'+proof+'.jpg',document.baseURI).href;
 }
 async function produce(circle,run){
  const key=cacheKey(circle.id);
  let photo=null;
  if(key){
   try{const storage=await openCache();const found=await storage?.match(key);
    if(found?.ok){const cached=await found.blob();if(cached.type==='image/jpeg'&&cached.size>0)photo=cached;}
   }catch{/* Derived image cache is optional; never affect the original save. */}
  }
  if(!photo){
   photo=await makeThumbnail(circle.image);
   if(key){try{const storage=await openCache();await storage?.put(key,new Response(photo,{headers:{'Content-Type':'image/jpeg'}}));}
    catch{/* Cache quota is optional. */}}
  }
  // Deletion, restoration or page reset may have invalidated this decode.
  if(run!==generation||!pending.has(circle.id))return '';
  const url=createUrl(photo);
  live.set(circle.id,{url,source:circle.image});
  return url;
 }
 function drain(){
  if(paused||busy||!queued.length)return;
  const item=queued.shift();
  if(!pending.has(item.circle.id)){drain();return;}
  busy=true;
  const run=generation;
  current=produce(item.circle,run)
   .then(url=>item.resolve(url),error=>item.reject(error))
   .finally(()=>{
    if(pending.get(item.circle.id)===item.promise)pending.delete(item.circle.id);
    busy=false;drain();
   });
 }
 return {
  setProofs(next){proofs={...next};},
  setProof(id,hash){proofs[id]=hash;},
  get(circle){
   if(!circle?.image)return Promise.resolve('');
   const cached=live.get(circle.id);
   if(cached&&cached.source===circle.image)return Promise.resolve(cached.url);
   if(pending.has(circle.id))return pending.get(circle.id);
   let resolve,reject;
   const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
   pending.set(circle.id,promise);
   queued.push({circle,promise,resolve,reject});
   drain();
   return promise;
  },
  async pause(){paused=true;await current.catch(()=>{});},
  resume(){paused=false;drain();},
  forget(id){
   const old=live.get(id);if(old){revokeUrl(old.url);live.delete(id);}
   // A pending decode can finish, but cannot publish its result after a reset.
   generation++;
   for(const item of queued.splice(0))item.resolve('');
   pending.clear();
  },
  releaseAll(){
   generation++;
   for(const item of queued.splice(0))item.resolve('');
   pending.clear();
   for(const {url} of live.values())revokeUrl(url);
   live.clear();
  },
  async clearCache(){
   try{await globalThis.caches?.delete(CACHE_NAME);}
   catch{/* Cache cleanup must not block save deletion. */}
  }
 };
}
