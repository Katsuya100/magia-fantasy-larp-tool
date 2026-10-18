// A guided demonstration only. Players draw real circles on paper, not on a phone.
export function initCircleTutorial(doc,onFinish){
 const $=id=>doc.getElementById(id);
 const overlay=$('tutorialOverlay'),finish=$('tutorialContinue');
 let previousFocus=null;
 function open(){
  if(!overlay.hidden)return;
  previousFocus=doc.activeElement;
  overlay.hidden=false;
  $('dungeonApp').setAttribute('inert','');
  finish.focus();
 }
 function close(toCamera){
  if(overlay.hidden)return;
  overlay.hidden=true;
  $('dungeonApp').removeAttribute('inert');
  if(!toCamera)previousFocus?.focus?.();
  Promise.resolve().then(()=>onFinish(toCamera)).catch(error=>console.error('チュートリアルの終了処理に失敗',error));
 }
 finish.addEventListener('click',()=>close(true));
 $('tutorialSkip').addEventListener('click',()=>close(false));
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();close(false);}
 });
 $('tutorialAnimation').addEventListener('error',()=>{
  // The static sample is still useful before the first asset deployment.
  if(!$('tutorialAnimation').src.endsWith('/sample.png')){
   $('tutorialAnimation').src='assets/images/sample.png';
  }
 });
 return {open,isOpen:()=>!overlay.hidden};
}
