// Dungeon-only modal animation control. Never delay native open/close state,
// persistence, focus handling or a transition to the next modal.
export const DUNGEON_MODAL_DURATION_MS=200;
const pendingHides=new WeakMap();
const pendingEntries=new WeakMap();

function motionReduced(element){
 return element?.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  ??globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  ??false;
}

export function showUiOverlay(element){
 if(!element)return;
 const timer=pendingHides.get(element);
 if(timer!==undefined){clearTimeout(timer);pendingHides.delete(element);}
 if(element.dataset)delete element.dataset.uiExiting;
 element.hidden=false;
}

export function hideUiOverlay(element,{reducedMotion=false}={}){
 if(!element||element.hidden)return;
 element.hidden=true;
 if(!element.dataset)return;
 if(reducedMotion||motionReduced(element)){delete element.dataset.uiExiting;return;}
 element.dataset.uiExiting='true';
 const timer=setTimeout(()=>{
  if(pendingHides.get(element)!==timer)return;
  pendingHides.delete(element);
  delete element.dataset.uiExiting;
 },DUNGEON_MODAL_DURATION_MS);
 pendingHides.set(element,timer);
 timer.unref?.();
}

// The entering keyframes restart on *every* showModal, even on repeat naming,
// and do not rely on CSS @starting-style implementation differences.
export function showDungeonDialog(dialog){
 if(!dialog||dialog.open)return;
 const timer=pendingEntries.get(dialog);
 if(timer!==undefined){clearTimeout(timer);pendingEntries.delete(dialog);}
 if(dialog.dataset&&!motionReduced(dialog))dialog.dataset.uiEntering='true';
 dialog.showModal();
 if(dialog.dataset?.uiEntering){
  const cleanup=setTimeout(()=>{
   if(pendingEntries.get(dialog)!==cleanup)return;
   pendingEntries.delete(dialog);
   delete dialog.dataset.uiEntering;
  },DUNGEON_MODAL_DURATION_MS);
  pendingEntries.set(dialog,cleanup);
  cleanup.unref?.();
 }
}

// A visual-only, noninteractive copy lets the original native dialog close
// synchronously. In particular, rename, camera cleanup and Drive decisions
// keep their existing .open / close-event ordering, while the old picture
// fades under the next dialog or custom overlay.
// No media players or scripts run inside the copy; IDs are removed.
function captureDialogExit(dialog){
 const doc=dialog.ownerDocument;
 if(!doc?.body?.appendChild||typeof dialog.cloneNode!=='function'||motionReduced(dialog))return null;
 const bounds=dialog.getBoundingClientRect?.();
 if(!bounds||bounds.width<=0||bounds.height<=0)return null;
 const ghost=dialog.cloneNode(true);
 ghost.removeAttribute('id');
 ghost.removeAttribute('aria-modal');
 ghost.setAttribute('aria-hidden','true');
 ghost.setAttribute('inert','');
 for(const child of ghost.querySelectorAll('[id]'))child.removeAttribute('id');
 ghost.setAttribute('open','');
 ghost.classList.add('dungeon-dialog-ghost');
 // Freeze geometry before .close() removes the original from the top layer.
 ghost.style.position='fixed';
 ghost.style.left=bounds.left+'px';
 ghost.style.top=bounds.top+'px';
 ghost.style.width=bounds.width+'px';
 ghost.style.height=bounds.height+'px';
 ghost.style.margin='0';
 const portal=doc.createElement('div');
 portal.className='dungeon-modal-exit-layer';
 portal.setAttribute('aria-hidden','true');
 portal.setAttribute('inert','');
 const veil=doc.createElement('div');
 veil.className='dungeon-modal-exit-veil';
 portal.appendChild(veil);
 portal.appendChild(ghost);
 return portal;
}

export function closeDungeonDialog(dialog){
 if(!dialog?.open)return;
 const timer=pendingEntries.get(dialog);
 if(timer!==undefined){clearTimeout(timer);pendingEntries.delete(dialog);}
 if(dialog.dataset)delete dialog.dataset.uiEntering;
 const exit= captureDialogExit(dialog);
 dialog.close(); // Preserve synchronous native state and all close handlers.
 if(!exit)return;
 dialog.ownerDocument.body.appendChild(exit);
 const cleanup=setTimeout(()=>exit.remove(),DUNGEON_MODAL_DURATION_MS);
 cleanup.unref?.();
}
