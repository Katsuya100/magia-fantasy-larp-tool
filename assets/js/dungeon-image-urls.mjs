// Keep one live object URL per photo across grimoire, preparation and repeated
// battle renders. Revoking before the replacement image finishes decoding can
// intermittently leave a blank thumbnail on mobile browsers.
export function createCircleImageUrls(create=blob=>URL.createObjectURL(blob),revoke=url=>URL.revokeObjectURL(url)){
 let byBlob=new WeakMap();
 const active=new Set();
 return {
  get(blob){
   if(!blob)return '';
   let url=byBlob.get(blob);
   if(!url){
    url=create(blob);
    byBlob.set(blob,url);
    active.add(url);
   }
   return url;
  },
  release(blob){
   if(!blob)return;
   const url=byBlob.get(blob);
   if(url){
    revoke(url);
    active.delete(url);
    byBlob.delete(blob);
   }
  },
  releaseAll(){
   for(const url of active)revoke(url);
   active.clear();
   byBlob=new WeakMap();
  }
 };
}
