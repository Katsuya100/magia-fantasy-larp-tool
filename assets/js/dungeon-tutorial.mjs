// Four short GIF demonstrations. The real circle is drawn on paper.
export const CIRCLE_TUTORIAL_STEPS=[
 {title:'外円を描く',hint:'紙に大きな円を描こう。',detail:'線をつないで閉じよう。',image:'tutorial-outer.gif'},
 {title:'内円を描く',hint:'外円の内側に、小さな円を描こう。',detail:'内円も線をつないで閉じよう。',image:'tutorial-inner.gif'},
 {title:'呪文を書く',hint:'2つの円の間に、英語の呪文を書こう。',detail:'相は呪文の意味から決まる：🔥炎・⚡雷・💧水・🌪風・🪨重力・⚖秩序・🌀混沌。',freedom:'見本に合わせなくてOK。英単語は自由に書こう。',image:'tutorial-spell.gif'},
 {title:'紋を描く',hint:'内円の中に紋を描こう。',detail:'紋の種別：⚔️攻撃・🛡️防御・✚回復・🕸️弱体。形から判定される。',freedom:'見本に合わせなくてOK。紋は自由に描こう。',image:'tutorial-sigil.gif'}
];
export function initCircleTutorial(doc,onFinish){
 const $=id=>doc.getElementById(id);
 const overlay=$('tutorialOverlay'),next=$('tutorialContinue'),back=$('tutorialPrevious'),gif=$('tutorialAnimation');
 let step=0,previousFocus=null;
 function render(){
  const info=CIRCLE_TUTORIAL_STEPS[step],freedom=$('tutorialFreedom');
  $('tutorialCounter').textContent=(step+1)+' / '+CIRCLE_TUTORIAL_STEPS.length;
  $('tutorialTitle').textContent=info.title;
  $('tutorialHint').textContent=info.hint;
  $('tutorialDetails').textContent=info.detail;
  freedom.textContent=info.freedom||'';
  freedom.hidden=!info.freedom;
  gif.src='assets/images/'+info.image+'?v=20261018.33';
  gif.alt=info.title+'アニメーション';
  back.hidden=step===0;
  next.textContent=step===3?'魔導書へ':'次へ';
 }
 function open(){
  if(!overlay.hidden)return;
  step=0;previousFocus=doc.activeElement;render();overlay.hidden=false;
  $('dungeonApp').setAttribute('inert','');next.focus();
 }
 function close(toCamera){
  if(overlay.hidden)return;
  overlay.hidden=true;$('dungeonApp').removeAttribute('inert');
  if(!toCamera)previousFocus?.focus?.();
  Promise.resolve().then(()=>onFinish(toCamera)).catch(error=>console.error('チュートリアルの終了処理に失敗',error));
 }
 next.addEventListener('click',()=>{if(step<3){step++;render();}else close(true);});
 back.addEventListener('click',()=>{if(step>0){step--;render();}});
 $('tutorialSkip').addEventListener('click',()=>close(false));
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(false);}});
 gif.addEventListener('error',()=>{gif.alt='GIFを読み込めませんでした';});
 return {open,isOpen:()=>!overlay.hidden};
}
