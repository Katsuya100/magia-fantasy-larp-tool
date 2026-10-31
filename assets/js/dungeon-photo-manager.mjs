import {createCircleImageUrls} from './dungeon-image-urls.mjs';
import {createCircleThumbnail} from './dungeon-thumbnails.mjs';
import {getCircleThumbnail} from './dungeon-store.mjs?v=20261023.20';

// Match the grimoire card's CSS width and device density; do not enlarge other UI.
export function grimoireThumbnailSize(cssWidth,pixelRatio=globalThis.devicePixelRatio||1){
 const width=Number(cssWidth)||0;
 if(width<=0)return 192;
 const density=Math.min(3,Math.max(1,Number(pixelRatio)||1));
 return Math.max(192,Math.min(512,Math.ceil(width*density/64)*64));
}
// UI thumbnails are disposable, never part of the signed game save.
export function createDungeonPhotoManager(getDatabase,findCircle){
 const originals=createCircleImageUrls(),thumbUrls=createCircleImageUrls();
 const displayed=new Map(),pending=new Map();
 let queue=Promise.resolve(),observer=null,visible=new Set();
 function thumbnail(circle,size=192){
  const cached=displayed.get(circle.id);
  if(cached&&cached.size>=size)return Promise.resolve(cached.blob);
  const inFlight=pending.get(circle.id);
  if(inFlight?.size>=size)return inFlight.task;
  const task=queue.then(()=>getCircleThumbnail(getDatabase(),circle,createCircleThumbnail,size));
  queue=task.catch(()=>{});
  pending.set(circle.id,{task,size});
  void task.then(()=>{if(pending.get(circle.id)?.task===task)pending.delete(circle.id);},
   ()=>{if(pending.get(circle.id)?.task===task)pending.delete(circle.id);});
  return task;
 }
 async function attach(img,circle){
  try{
   // Only cards inside the grimoire receive a density-matched thumbnail.
   const size=img.closest?.('#library')?grimoireThumbnailSize(img.getBoundingClientRect?.().width):192;
   const blob=await thumbnail(circle,size);
   if(!visible.has(img)||img.isConnected===false)return;
   const old=displayed.get(circle.id);
   if(old?.blob&&old.blob!==blob)thumbUrls.release(old.blob);
   displayed.set(circle.id,{blob,size:old?.blob===blob?Math.max(old.size,size):size});
   img.src=thumbUrls.get(blob);
  }catch(error){
   if(visible.has(img)&&img.isConnected!==false){
    // Restored backups have no local thumbnail cache. If regeneration fails,
    // show their preserved original instead of leaving the grimoire blank.
    try{
     if(!(circle.image instanceof Blob)||!circle.image.size)throw error;
     const old=displayed.get(circle.id);
     if(old?.blob&&old.blob!==circle.image)thumbUrls.release(old.blob);
     displayed.set(circle.id,{blob:circle.image,size:0});
     img.src=thumbUrls.get(circle.image);
    }catch{img.alt='縮小画像を表示できません。';}
   }
   console.warn('縮小画像を読み込めませんでした',error);
  }
 }
 function refresh(roots){
  observer?.disconnect();
  const images=roots.flatMap(root=>[...(root?.querySelectorAll?.('img[data-circle-photo-id]')||[])]);
  const next=new Set(images);
  for(const img of visible)if(!next.has(img))img.removeAttribute?.('src');
  visible=next;
  const ids=new Set(images.map(img=>img.dataset.circlePhotoId));
  for(const [id,entry] of displayed)if(!ids.has(id)){
   thumbUrls.release(entry.blob);displayed.delete(id);
  }
  const load=img=>{
   const circle=findCircle(img.dataset.circlePhotoId);
   if(circle?.image&&!img.getAttribute('src'))void attach(img,circle);
  };
  if(typeof IntersectionObserver==='function'){
   observer=new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){
     observer?.unobserve(entry.target);load(entry.target);
    }
   },{rootMargin:'100px'});
   for(const img of images)if(!img.getAttribute('src'))observer.observe(img);
  }else for(const img of images)load(img);
 }
 function forget(id,original){
  const thumb=displayed.get(id);
  if(thumb)thumbUrls.release(thumb.blob);
  displayed.delete(id);
  for(const img of visible)if(img.dataset.circlePhotoId===id)img.removeAttribute?.('src');
  originals.release(original);
 }
 function releaseAll(){
  observer?.disconnect();observer=null;
  for(const img of visible)img.removeAttribute?.('src');
  visible.clear();displayed.clear();pending.clear();
  originals.releaseAll();thumbUrls.releaseAll();
 }
 return {get:blob=>originals.get(blob),release:blob=>originals.release(blob),thumbnail,refresh,forget,releaseAll};
}
