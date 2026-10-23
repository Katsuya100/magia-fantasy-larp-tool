import {showUiOverlay,hideUiOverlay,showDungeonDialog,closeDungeonDialog} from './dungeon-ui-transitions.mjs?v=20261023.32';
// Five tutorial pages using four uploaded GIF animations, in reverse upload order.
export const CIRCLE_TUTORIAL_STEPS=[
 {title:'準備しましょう',hint:'最初にお手元に紙とペンをご用意ください。',detail:'ペンは、できれば太めの油性ペンをお使いください。',image:null},
 {title:'外円を書きましょう',hint:'紙に大きな円を書いてください。',detail:'線をつないで閉じてください。',image:'tutorial-outer.gif'},
 {title:'内円を書きましょう',hint:'外円の内側に、小さな円を書いてください。',detail:'内円も閉じた線にしてください。',image:'tutorial-inner.gif'},
 {title:'呪文を書きましょう',hint:'内円と外円の間に英語の呪文を書いてください。',detail:'相(属性)は呪文の意味によって決まります。',attributes:'🔥flame・⚡bolt・💧aqua\n🌪storm・🪨gravity\n⚖law・🌀chaos',freedom:'サンプルに合わせる必要はありません。英単語は自由に書いてください。',image:'tutorial-spell.gif'},
 {title:'紋を書きましょう',hint:'内円の中に紋を書いてください。',detail:'紋の種別は形によって決まります。',attributes:'⚔️攻撃・🛡️防御・✚回復・🕸️弱体',freedom:'サンプルに合わせる必要はありません。紋は自由に描いてください。',image:'tutorial-sigil.gif'}
];
export function initCircleTutorial(doc,onFinish,onLessonClosed=()=>{}){
 const $=id=>doc.getElementById(id);
 const overlay=$('tutorialOverlay'),next=$('tutorialContinue'),back=$('tutorialPrevious'),preview=$('tutorialAnimation');
 const lesson=$('circleDrawingLessonDialog'),home=$('tutorialBodyHome'),slot=$('circleDrawingLessonSlot'),body=$('tutorialBody');
 let step=0,previousFocus=null,lessonFocus=null;
 // The real page already nests this body under the home slot; the fake DOM in
 // the Node test harness doesn't parse HTML, so establish its initial parent.
 if(!body.parentNode)home.appendChild(body);
 function render(){
  const info=CIRCLE_TUTORIAL_STEPS[step],freedom=$('tutorialFreedom');
  $('tutorialCounter').textContent=(step+1)+' / '+CIRCLE_TUTORIAL_STEPS.length;
  $('tutorialTitle').textContent=info.title;
  // Keep sentences on distinct lines; attribute names are not sentences.
  const sentences=text=>String(text||'').replace(/。(?!$)/g,'。\n');
  $('tutorialHint').textContent=sentences(info.hint);
  $('tutorialDetails').textContent=sentences(info.detail);
  const attributes=$('tutorialAttributes');
  attributes.textContent=info.attributes||'';
  attributes.hidden=!info.attributes;
  freedom.textContent=info.freedom||'';
  freedom.hidden=!info.freedom;
  $('tutorialFigure').hidden=!info.image;
  if(info.image){
   preview.src='assets/images/'+info.image+'?v=20261023.14';
   preview.alt=info.title+'の描画アニメーション';
  }else preview.alt='';
  back.hidden=step===0;
  next.textContent=step===CIRCLE_TUTORIAL_STEPS.length-1?'撮影する📷':'次へ';
 }
 function open(){
  if(!overlay.hidden||lesson.open)return;
  step=0;previousFocus=doc.activeElement;render();showUiOverlay(overlay);
  $('dungeonApp').setAttribute('inert','');next.focus();
 }
 function close(toCamera){
  if(overlay.hidden)return;
  hideUiOverlay(overlay);$('dungeonApp').removeAttribute('inert');
  if(!toCamera)previousFocus?.focus?.();
  Promise.resolve().then(()=>onFinish(toCamera)).catch(error=>console.error('チュートリアルの終了処理に失敗',error));
 }
 next.addEventListener('click',()=>{if(step<CIRCLE_TUTORIAL_STEPS.length-1){step++;render();}else close(true);});
 back.addEventListener('click',()=>{if(step>0){step--;render();}});
 $('tutorialSkip').addEventListener('click',()=>close(false));
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(false);}});
 function restoreLessonBody(){
  if(body.parentNode!==home)home.appendChild(body);
 }
 function closeLesson(){
  if(!lesson.open)return;
  closeDungeonDialog(lesson);
  restoreLessonBody();
  lessonFocus?.focus?.();
  lessonFocus=null;
  onLessonClosed();
 }
 function openLesson(mode){
  if(!overlay.hidden||lesson.open||!['spell','sigil'].includes(mode))return false;
  step=mode==='spell'?3:4;
  lessonFocus=doc.activeElement;
  slot.appendChild(body);
  render();
  showDungeonDialog(lesson);
  $('circleDrawingLessonClose').focus();
  return true;
 }
 $('circleDrawingLessonClose').addEventListener('click',closeLesson);
 lesson.addEventListener('cancel',event=>{event.preventDefault();closeLesson();});
 lesson.addEventListener('close',restoreLessonBody);
 preview.addEventListener('error',()=>{preview.alt='GIFアニメーションを読み込めませんでした';});
 return {open,openLesson,isOpen:()=>!overlay.hidden};
}
