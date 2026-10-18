// Five simple pages: paper and pen preparation, then four GIF demonstrations.
export const CIRCLE_TUTORIAL_STEPS=[
 {title:'準備しましょう',hint:'最初にお手元に紙とペンをご用意ください。',detail:'ペンは、できれば太めの油性ペンをお使いください。',image:null},
 {title:'外円を書きましょう',hint:'紙に大きな円を書いてください。',detail:'線をつないで閉じてください。',image:'tutorial-outer.gif'},
 {title:'内円を書きましょう',hint:'外円の内側に、小さな円を書いてください。',detail:'内円も閉じた線にしてください。',image:'tutorial-inner.gif'},
 {title:'呪文を書きましょう',hint:'内円と外円の間に英語の呪文を書いてください。',detail:'相は呪文の意味によって決まります：🔥炎・⚡雷・💧水・🌪風・🪨重力・⚖秩序・🌀混沌。',freedom:'サンプルに合わせる必要はありません。英単語は自由に書いてください。',image:'tutorial-spell.gif'},
 {title:'紋を書きましょう',hint:'内円の中に紋を書いてください。',detail:'紋の種別は形によって決まります：⚔️攻撃・🛡️防御・✚回復・🕸️弱体。',freedom:'サンプルに合わせる必要はありません。紋は自由に描いてください。',image:'tutorial-sigil.gif'}
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
  $('tutorialFigure').hidden=!info.image;
  if(info.image){
   gif.src='assets/images/'+info.image+'?v=20261018.37';
   gif.alt=info.title+'アニメーション';
  }else gif.alt='';
  back.hidden=step===0;
  next.textContent=step===CIRCLE_TUTORIAL_STEPS.length-1?'魔導書へ':'次へ';
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
 next.addEventListener('click',()=>{if(step<CIRCLE_TUTORIAL_STEPS.length-1){step++;render();}else close(true);});
 back.addEventListener('click',()=>{if(step>0){step--;render();}});
 $('tutorialSkip').addEventListener('click',()=>close(false));
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(false);}});
 gif.addEventListener('error',()=>{gif.alt='GIFを読み込めませんでした';});
 return {open,isOpen:()=>!overlay.hidden};
}
