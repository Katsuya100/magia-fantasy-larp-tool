// Visual-only 200 ms exit for custom modal overlays. hidden remains synchronous.
export const DUNGEON_MODAL_DURATION_MS=200;
const pendingHides=new WeakMap();

export function showUiOverlay(element){
 if(!element)return;
 const timer=pendingHides.get(element);
 if(timer!==undefined){clearTimeout(timer);pendingHides.delete(element);}
 delete element.dataset.uiExiting;
 element.hidden=false;
}

export function hideUiOverlay(element,{reducedMotion=false}={}){
 if(!element||element.hidden)return;
 element.hidden=true;
 if(reducedMotion||globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches){
  delete element.dataset.uiExiting;
  return;
 }
 element.dataset.uiExiting='true';
 const timer=setTimeout(()=>{
  if(pendingHides.get(element)!==timer)return;
  pendingHides.delete(element);
  delete element.dataset.uiExiting;
 },DUNGEON_MODAL_DURATION_MS);
 pendingHides.set(element,timer);
 timer.unref?.();
}
