// Magic-stone guidance is intentionally separate from the drawing tutorial.
export function shouldShowMagicStoneTutorial(profile){
 return Number(profile?.magicStones)>0&&!profile?.magicStoneTutorialSeen;
}

export function initMagicStoneTutorial(doc,{view=globalThis.window,requestFrame=globalThis.requestAnimationFrame}={}){
 const dialog=doc.getElementById('magicStoneTutorialDialog');
 const closeButton=doc.getElementById('closeMagicStoneTutorial');
 closeButton.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{
  const label=doc.getElementById('magicStoneBalance');
  if(!label||typeof view?.scrollTo!=='function')return;
  const start=Number(view.scrollY??view.pageYOffset)||0;
  const target=Math.max(0,start+label.getBoundingClientRect().top);
  if(typeof requestFrame!=='function'){view.scrollTo(0,target);return;}
  let started=null;
  const frame=time=>{
   if(started===null)started=time;
   const fraction=Math.min(1,Math.max(0,(time-started)/500));
   const ease=1-(1-fraction)**3;
   view.scrollTo(0,start+(target-start)*ease);
   if(fraction<1)requestFrame(frame);
  };
  requestFrame(frame);
 });
 return {open(){if(!dialog.open)dialog.showModal();}};
}
