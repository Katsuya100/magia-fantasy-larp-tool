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
   for(const node of fx.querySelectorAll('[id]')){node.removeAttribute('id');node.textContent='';}
   copy.append(fx);
  }
  echo.append(copy);
 }
 // Affinity words live outside the shaking fighters, so their 720ms
 // presentation must be echoed separately as a stable arena overlay.
 for(const side of ['hero','enemy']){
  const caption=arena.querySelector('#'+side+'AffinityWord');
  if(!caption?.cloneNode||caption.dataset.affinity==='none')continue;
  const copy=caption.cloneNode(false);
  copy.removeAttribute('id');
  copy.style.cssText='left:'+caption.offsetLeft+'px;top:'+caption.offsetTop+'px;width:'+caption.offsetWidth+'px;height:'+caption.offsetHeight+'px';
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

// Keep prior FX tails through subsequent phases, including MISS or zero hits.
// Only a terminal battle transition explicitly disposes unfinished effects.
export function disposeCombatEchoes(arena,echoes){
 for(const echo of echoes)echo.dispose();
 echoes.length=0;
 // Previous-turn FX echoes outlive their original animateBattle handles
 // when an input starts at the 70% overlap point.
 for(const node of arena?.querySelectorAll?.('.combat-fx-echo')||[])node.remove();
}
