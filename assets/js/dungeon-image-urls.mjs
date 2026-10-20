// Keep one current object URL per photo. Mobile image decoders can reject
// an individual object URL even when IndexedDB still has the original Blob.
// Allow ONE non-destructive URL retry; keep old URLs until a safe release.
export function createCircleImageUrls(create=blob=>URL.createObjectURL(blob),revoke=url=>URL.revokeObjectURL(url)){
 let byBlob=new WeakMap(),history=new WeakMap();
 const active=new Set(),owners=new Map();
 const generate=blob=>{
  const url=create(blob);
  byBlob.set(blob,url);
  active.add(url);
  owners.set(url,blob);
  const urls=history.get(blob)||[];
  urls.push(url);
  history.set(blob,urls);
  return url;
 };
 return {
  get(blob){
   if(!blob)return '';
   return byBlob.get(blob)||generate(blob);
  },
  findBlob(url){return owners.get(url)||null;},
  refresh(blob){
   if(!blob)return '';
   // An earlier failed URL remains valid for already-decoded elements,
   // but the new URL is used for all subsequent renders.
   return generate(blob);
  },
  release(blob){
   if(!blob)return;
   for(const url of history.get(blob)||[]){
    revoke(url);
    active.delete(url);
    owners.delete(url);
   }
   history.delete(blob);
   byBlob.delete(blob);
  },
  releaseAll(){
   for(const url of active)revoke(url);
   active.clear();
   owners.clear();
   byBlob=new WeakMap();
   history=new WeakMap();
  }
 };
}
