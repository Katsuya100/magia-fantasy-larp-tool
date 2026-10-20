import {createCircleImageUrls} from './dungeon-image-urls.mjs';
import {createCircleThumbnail} from './dungeon-thumbnails.mjs';
import {getCircleThumbnail} from './dungeon-store.mjs';

// UI thumbnails are disposable, never part of the signed game save.
export function createDungeonPhotoManager(getDatabase,findCircle){
 const originals=createCircleImageUrls(),thumbUrls=createCircleImageUrls();
 const displayed=new Map(),pending=new Map();
 let queue=Promise.resolve(),observer=null,visible=new Set();
 function thumbnail(circle){
  let task=pending.get(circle.id);
  if(!task){
   task=queue.then(()=>getCircleThumbnail(getDatabase(),circle,createCircleThumbnail));
   queue=task.catch(()=>{});
   pending.set(circle.id,task);
   void task.then(()=>{if(pending.get(circle.id)===task)pending.delete(circle.id);},
    ()=>{if(pending.get(circle.id)===task)pending.delete(circle.id);});
  }
  return task;
 }
 async function attach(img,circle){
  try{
   const blob=await thumbnail(circle);
   if(!visible.has(img)||img.isConnected===false)return;
   const old=displayed.get(circle.id);
   if(old&&old!==blob)thumbUrls.release(old);
   displayed.set(circle.id,blob);
   img.src=thumbUrls.get(blob);
  }catch(error){
   if(visible.has(img))img.alt='縮小画像を表示できません。';
   console.warn('縮小画像を読み込めませんでした',error);
  }
 }
 function refresh(roots){
  observer?.disconnect();
  const images=roots.flatMap(root=>[...(root?.querySelectorAll?.('img[data-circle-photo-id]')||[])]);
  visible=new Set(images);
  const ids=new Set(images.map(img=>img.dataset.circlePhotoId));
  for(const [id,blob] of displayed)if(!ids.has(id)){
   // Detach old DOM sources before revoking their URL.
   for(const root of roots)for(const img of root?.querySelectorAll?.('img[data-circle-photo-id]')||[])
    if(img.dataset.circlePhotoId===id)img.removeAttribute('src');
   thumbUrls.release(blob);displayed.delete(id);
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
  if(thumb)thumbUrls.release(thumb);
  displayed.delete(id);
  originals.release(original);
 }
 function releaseAll(){
  observer?.disconnect();observer=null;visible.clear();displayed.clear();pending.clear();
  originals.releaseAll();thumbUrls.releaseAll();
 }
 return {get:blob=>originals.get(blob),release:blob=>originals.release(blob),thumbnail,refresh,forget,releaseAll};
}
