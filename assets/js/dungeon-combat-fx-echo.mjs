// A visual-only echo runs alongside the live arena. It is hidden until the
// next phase overwrites the original nodes, so the old CSS animations can finish.
export function captureCombatFxEcho(arena,visualDuration){
 if(visualDuration<=0||typeof arena?.append!=='function'||typeof arena.querySelector!=='function')return null;
 const actors=['enemyCombatant','heroCombatant'].map(id=>arena.querySelector('#'+id));
 if(actors.some(actor=>!actor?.cloneNode||!actor.querySelector||!Number.isFinite(actor.offsetLeft)))return null;
 const echo=document.createElement('div');
 echo.className='combat-fx-echo';
 echo.dataset.active='false';
 echo.setAttribute('aria-hidden','true');
 for(const actor of actors){
  const copy=actor.cloneNode(false);
  copy.removeAttribute('id');
  copy.removeAttribute('data-defeated');
  copy.style.cssText='left:'+actor.offsetLeft+'px;top:'+actor.offsetTop+'px;width:'+actor.offsetWidth+'px;height:'+actor.offsetHeight+'px';
  const fx=actor.querySelector('.combatant-fx')?.cloneNode(true);
  if(fx){
   for(const node of fx.querySelectorAll('[id]'))node.removeAttribute('id');
   copy.append(fx);
  }
  echo.append(copy);
 }
 const flight=arena.querySelector('.spell-flight')?.cloneNode(true);
 if(flight){
  for(const node of flight.querySelectorAll('[id]'))node.removeAttribute('id');
  echo.append(flight);
 }
 arena.append(echo);
 const timer=setTimeout(()=>echo.remove(),visualDuration);
 return {reveal(){echo.dataset.active='true';},dispose(){clearTimeout(timer);echo.remove();}};
}
