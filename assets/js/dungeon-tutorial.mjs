// First-time drawing practice. No analysis, photos or game state are created here.
const STEPS=[
 {title:'魔法陣の作り方',hint:'サンプルを見て、順番に描いてみよう。',action:'描いてみる'},
 {title:'外円を描く',hint:'大きな輪を、ぐるっと閉じよう。',action:'次へ'},
 {title:'内円を描く',hint:'内側にも、小さな輪を閉じよう。',action:'次へ'},
 {title:'呪文を書く',hint:'二つの円の間に「FIRE」と書こう。',action:'次へ'},
 {title:'紋様を描く',hint:'内円の中に、炎などの印を描こう。',action:'次へ'},
 {title:'本物を登録しよう',hint:'紙に描き、明るい場所で全体を撮影しよう。',action:'魔導書へ'}
];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const length=points=>points.slice(1).reduce((n,p,i)=>n+dist(points[i],p),0);
export function isClosedRing(points,radius){
 if(points.length<8)return false;
 const x=points.map(p=>p.x),y=points.map(p=>p.y);
 const spanX=Math.max(...x)-Math.min(...x),spanY=Math.max(...y)-Math.min(...y);
 const centerX=(Math.max(...x)+Math.min(...x))/2,centerY=(Math.max(...y)+Math.min(...y))/2;
 return spanX>=radius*1.45&&spanY>=radius*1.45
  &&Math.hypot(centerX-160,centerY-160)<=radius*.3
  &&length(points)>=radius*4.4
  &&dist(points[0],points.at(-1))<=radius*.55;
}
export function completedPractice(step,strokes){
 if(step===1)return strokes.some(s=>isClosedRing(s,116));
 if(step===2)return strokes.some(s=>isClosedRing(s,66));
 if(step===3)return strokes.filter(s=>length(s)>=13).length>=2&&strokes.reduce((n,s)=>n+length(s),0)>=135;
 if(step===4)return strokes.some(s=>length(s)>=65);
 return true;
}
function allowedAt(step,p){
 const r=Math.hypot(p.x-160,p.y-160);
 if(step===1)return r>=75&&r<=157;
 if(step===2)return r>=35&&r<=100;
 if(step===3)return r>=66&&r<=148;
 if(step===4)return r<=85;
 return false;
}
export function initCircleTutorial(doc,onFinish){
 const $=id=>doc.getElementById(id),overlay=$('tutorialOverlay'),canvas=$('tutorialCanvas');
 const stages=[[],[],[],[],[]];
 let step=0,active=null,previousFocus=null;
 const button=$('tutorialContinue'),pad=$('tutorialPad'),feedback=$('tutorialFeedback');
 function draw(){
  const ctx=canvas.getContext('2d');
  if(!ctx?.clearRect||!ctx?.beginPath)return;
  ctx.clearRect(0,0,320,320);
  ctx.strokeStyle='#3a2936';ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';
  for(let n=1;n<=4;n++)for(const stroke of stages[n]){
   if(!stroke.length)continue;
   ctx.beginPath();ctx.moveTo(stroke[0].x,stroke[0].y);
   for(const p of stroke.slice(1))ctx.lineTo(p.x,p.y);
   ctx.stroke();
  }
 }
 function render(){
  const item=STEPS[step],drawing=step>=1&&step<=4;
  $('tutorialCount').textContent=(step+1)+' / '+STEPS.length;
  $('tutorialTitle').textContent=item.title;
  $('tutorialHint').textContent=item.hint;
  $('tutorialExample').hidden=drawing;
  pad.hidden=!drawing;
  pad.dataset.step=String(step);
  $('tutorialFinger').hidden=!drawing;
  $('tutorialRetry').hidden=!drawing;
  feedback.textContent='';
  button.textContent=item.action;
  button.disabled=drawing&&!completedPractice(step,stages[step]);
  button.className='primary-action tutorial-next'+(button.disabled?'':' tutorial-ready');
  if(drawing)draw();
 }
 function open(){
  if(!overlay.hidden)return;
  previousFocus=doc.activeElement;
  for(const strokes of stages)strokes.length=0;
  step=0;active=null;overlay.hidden=false;
  $('dungeonApp').setAttribute('inert','');
  render();button.focus();
 }
 function close(toCamera){
  active=null;overlay.hidden=true;
  $('dungeonApp').removeAttribute('inert');
  if(!toCamera)previousFocus?.focus?.();
  Promise.resolve(onFinish(toCamera)).catch(error=>console.error('チュートリアルの保存に失敗',error));
 }
 function retry(){
  stages[step].length=0;active=null;render();
 }
 const point=e=>{
  const rect=canvas.getBoundingClientRect();
  return {x:(e.clientX-rect.left)*320/rect.width,y:(e.clientY-rect.top)*320/rect.height};
 };
 canvas.addEventListener('pointerdown',e=>{
  if(overlay.hidden||step<1||step>4||active!==null)return;
  const p=point(e);
  if(!allowedAt(step,p))return;
  e.preventDefault();
  active={id:e.pointerId,points:[p]};
  stages[step].push(active.points);
  canvas.setPointerCapture?.(e.pointerId);
  feedback.textContent='';
 });
 canvas.addEventListener('pointermove',e=>{
  if(!active||e.pointerId!==active.id)return;
  e.preventDefault();
  const p=point(e);
  if(allowedAt(step,p)&&dist(p,active.points.at(-1))>=2)active.points.push(p);
  draw();
 });
 const end=e=>{
  if(!active||e.pointerId!==active.id)return;
  e.preventDefault();
  const p=point(e);
  if(allowedAt(step,p)&&dist(p,active.points.at(-1))>=2)active.points.push(p);
  if(active.points.length<2)stages[step].pop();
  active=null;
  canvas.releasePointerCapture?.(e.pointerId);
  draw();
  const done=completedPractice(step,stages[step]);
  button.disabled=!done;
  button.className='primary-action tutorial-next'+(done?' tutorial-ready':'');
  feedback.textContent=done?'できた！':'指で線を描こう';
  if(done)button.focus({preventScroll:true});
 };
 canvas.addEventListener('pointerup',end);
 canvas.addEventListener('pointercancel',e=>{
  if(!active||e.pointerId!==active.id)return;
  stages[step].pop();active=null;draw();
 });
 button.addEventListener('click',()=>{
  if(button.disabled)return;
  if(step===STEPS.length-1){close(true);return;}
  step++;render();
 });
 $('tutorialRetry').addEventListener('click',retry);
 $('tutorialSkip').addEventListener('click',()=>close(false));
 overlay.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();close(false);}
 });
 return {open,isOpen:()=>!overlay.hidden};
}
