// Browser-only finger-drawn magic circle editor. Geometry/state helpers are pure and CI-testable.
export const DRAWN_GLYPH_LIMIT=32;
export const DRAWN_POWER_RATE=0.6;
export const MIN_DUNGEON_POWER=250;
const INNER_RADIUS=.255;
const GUIDE_RADIUS=.92;
// The same scale in both axes preserves each drawn letter's aspect ratio.
export const GLYPH_INK_SCALE=.11;
export const REVOLVER_DURATION_MS=250;
const GLYPH_STEP=2*Math.PI/DRAWN_GLYPH_LIMIT;
// The editor magnifies the angular sweep; saved glyph positions stay on the original 32-slot circle.
export const EDITOR_GLYPH_STEP=GLYPH_STEP*2.25;

export function drawnPower(power,rate=DRAWN_POWER_RATE){
 if(!Number.isFinite(power)||power<=0||!Number.isFinite(rate)||rate<=0||rate>1)throw Error('手書き魔法陣の威力が不正です。');
 return Math.max(MIN_DUNGEON_POWER,Math.round(power*rate));
}
// Bring older hand-drawn circles into line when read, without modifying
// the signed/backup copy of the original magic-circle image or undoing upgrades.
export function withDrawnPowerFloor(circle){
 if(circle?.origin!=='drawn'||!circle.analysis)return circle;
 const current=Number(circle.analysis.power);
 const base=Number(circle.basePower??current);
 if(!Number.isFinite(current)||current<=0||!Number.isFinite(base)||base<=0)return circle;
 const floor=circle.creationInk?Math.ceil(Number((MIN_DUNGEON_POWER*1.1).toFixed(8))):MIN_DUNGEON_POWER;
 if(base>=floor&&current>=floor)return circle;
 const level=Number.isSafeInteger(circle.upgradeLevel)&&circle.upgradeLevel>0?circle.upgradeLevel:0;
 const correctedBase=Math.max(base,floor);
 const upgraded=Math.ceil(Number((correctedBase*(1+level/10)).toFixed(8)));
 return {...circle,basePower:correctedBase,analysis:{...circle.analysis,power:Math.max(current,upgraded)}};
}
export function pointOnPad(clientX,clientY,rect){
 const scale=Math.min(rect.width,rect.height)/2;
 if(!(scale>0))throw Error('タッチパッドのサイズが不正です。');
 return {x:(clientX-rect.left-rect.width/2)/scale,y:(clientY-rect.top-rect.height/2)/scale};
}
export function glyphAngle(index,count){return -Math.PI/2+(index-(count-1)/2)*GLYPH_STEP;}
export function caretAngle(count){return -Math.PI/2+count*GLYPH_STEP/2;}
export function glyphPoint(point,index,count=1,viewIndex=null){
 const angle=viewIndex===null?glyphAngle(index,count):-Math.PI/2+(index-viewIndex)*GLYPH_STEP;
 const tangent=angle+Math.PI/2,dx=point.x*GLYPH_INK_SCALE,dy=point.y*GLYPH_INK_SCALE;
 return {x:.5+.345*Math.cos(angle)+dx*Math.cos(tangent)-dy*Math.sin(tangent),
  y:.5+.345*Math.sin(angle)+dx*Math.sin(tangent)+dy*Math.cos(tangent)};
}
export function sigilPoint(point){
 return {x:.5+point.x*INNER_RADIUS/GUIDE_RADIUS,y:.5+point.y*INNER_RADIUS/GUIDE_RADIUS};
}
export function normalizedGlyph(strokes){
 const points=strokes.flat();
 if(!points.length)return [];
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const span=Math.max(maxX-minX,maxY-minY,.05);
 const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
 return strokes.map(stroke=>stroke.map(p=>({x:(p.x-cx)*1.7/span,y:(p.y-cy)*1.7/span})));
}
// Each touchpad coordinate is a real scaled position on the finished ring.
// Left/right select slots, while history applies only to strokes of the central sigil.
function snapshot(s){return s.sigil.map(stroke=>stroke.slice());}
export function createDrawingModel(){
 const state={mode:'spell',letters:[],index:0,ink:[],sigil:[]};
 let undo=[],redo=[];
 const load=()=>{state.ink=state.letters[state.index]?.strokes?.map(stroke=>stroke.slice())||[];};
 function saveCurrent(allowSpace=false){
  if(state.index>=DRAWN_GLYPH_LIMIT)return;
  if(state.ink.length)state.letters[state.index]={strokes:state.ink.map(stroke=>stroke.slice())};
  else if(state.index<state.letters.length||allowSpace)state.letters[state.index]={space:true};
 }
 function history(direction){
  const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;
  if(!from.length)return false;
  to.push(snapshot(state));state.sigil=from.pop();return true;
 }
 return {
  state,
  get canUndo(){return state.mode==='sigil'&&undo.length>0;},
  get canRedo(){return state.mode==='sigil'&&redo.length>0;},
  get canPrevious(){return state.mode==='spell'&&state.index>0;},
  get canNext(){return state.mode==='spell'&&state.index<DRAWN_GLYPH_LIMIT-1;},
  addStroke(points){
   if(!Array.isArray(points)||!points.length)return false;
   const stroke=points.map(p=>({x:Number(p.x),y:Number(p.y)}));
   if(stroke.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return false;
   if(state.mode==='spell')state.ink.push(stroke);
   else {undo.push(snapshot(state));if(undo.length>100)undo.shift();redo=[];state.sigil.push(stroke);}
   return true;
  },
  move(direction){
   if(state.mode!=='spell'||!Number.isInteger(direction)||Math.abs(direction)!==1)return false;
   const next=state.index+direction;
   if(next<0||next>=DRAWN_GLYPH_LIMIT)return false;
   // Moving right across an empty slot deliberately inserts a space.
   saveCurrent(direction===1);
   state.index=next;load();
   return true;
  },
  // Kept for existing integrations: entering a glyph is a rightward turn.
  enterGlyph(){return this.move(1);},
  goSigil(){
   if(state.mode!=='spell')return false;
   saveCurrent();
   if(!state.letters.some(glyph=>glyph&&!glyph.space))return false;
   state.mode='sigil';undo=[];redo=[];return true;
  },
  goSpell(){state.mode='spell';undo=[];redo=[];load();},
  reset(){
   if(state.mode==='spell'){
    const hadInk=state.ink.length>0||Boolean(state.letters[state.index]&&!state.letters[state.index].space);
    state.ink=[];
    if(state.index<state.letters.length)state.letters[state.index]={space:true};
    return hadInk;
   }
   if(!state.sigil.length)return false;
   undo.push(snapshot(state));if(undo.length>100)undo.shift();redo=[];
   state.sigil=[];return true;
  },
  undo(){return history('undo');},
  redo(){return history('redo');},
  get complete(){return state.letters.some(x=>x&&!x.space)&&state.sigil.length>0&&state.mode==='sigil';}
 };
}
function strokePath(ctx,points,transform,lineWidth,color,glow=0){
 if(!points.length)return;
 ctx.beginPath();
 const start=transform(points[0]);
 ctx.moveTo(start.x,start.y);
 for(let i=1;i<points.length;i++){const p=transform(points[i]);ctx.lineTo(p.x,p.y);}
 ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.lineCap='round';ctx.lineJoin='round';
 ctx.shadowColor=color;ctx.shadowBlur=glow;ctx.stroke();
 if(points.length===1){ctx.beginPath();ctx.arc(start.x,start.y,lineWidth/2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
 ctx.shadowBlur=0;
}
// Deterministic warm parchment: the preview and the registered image share the same finish.
function paintParchment(ctx,size){
 ctx.fillStyle='#f2e4c6';ctx.fillRect(0,0,size,size);
 const light=ctx.createRadialGradient(size*.38,size*.28,size*.06,size*.51,size*.55,size*.78);
 light.addColorStop(0,'rgba(255,252,235,.62)');
 light.addColorStop(1,'rgba(166,122,73,.13)');
 ctx.fillStyle=light;ctx.fillRect(0,0,size,size);
 // Reproducible fiber-like flecks give the surface texture without a network image.
 let seed=263119;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<Math.round(size*1.3);i++){
  const x=rand()*size,y=rand()*size;
  ctx.fillStyle=i%3===0?'rgba(115,77,40,.11)':'rgba(255,252,238,.24)';
  ctx.fillRect(x,y,Math.max(.6,size*.0013)*(.4+rand()),Math.max(.5,size*.0009)*(.4+rand()));
 }
}
function brushCircle(ctx,size,radius,width){
 const steps=240,center=size/2,rad=size*radius;
 ctx.beginPath();
 for(let i=0;i<=steps;i++){
  const t=i*Math.PI*2/steps;
  const waviness=(Math.sin(t*17+2)+Math.sin(t*41-1)*.5)*size*.00055;
  const x=center+(rad+waviness)*Math.cos(t),y=center+(rad+waviness)*Math.sin(t);
  if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
 }
 ctx.closePath();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=size*width;
 ctx.globalAlpha=.85;ctx.strokeStyle='#2b211a';ctx.stroke();
 ctx.globalAlpha=.19;ctx.strokeStyle='#4f3a28';ctx.lineWidth=size*width*.68;ctx.stroke();
 ctx.globalAlpha=1;
}
function brushStroke(ctx,points,transform,width){
 if(!points.length)return;
 ctx.globalAlpha=.85;
 strokePath(ctx,points,transform,width,'#231b15');
 ctx.globalAlpha=.15;
 const jittered=points.map((p,i)=>{
  const q=transform(p),n=width*.15;
  return {x:q.x+Math.sin(i*2.71+p.x*13)*n,y:q.y+Math.cos(i*2.37+p.y*9)*n};
 });
 strokePath(ctx,jittered,p=>p,width*.42,'#75573b');
 ctx.globalAlpha=1;
}
export function paintCircle(canvas,state,{exportImage=false,activeStroke=null,size=512,viewIndex=null}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('魔法陣を描画できません。');
 ctx.clearRect(0,0,size,size);
 paintParchment(ctx,size);
 brushCircle(ctx,size,.43,.0055);
 brushCircle(ctx,size,INNER_RADIUS,.0095);
 const visible=state.letters.slice();
 if(state.mode==='spell'&&(state.ink.length||activeStroke?.length))visible[state.index]={strokes:[...state.ink,...(activeStroke?.length?[activeStroke]:[])]};
 for(let i=0;i<visible.length;i++){
  const glyph=visible[i];
  if(!glyph||glyph.space)continue;
  for(const stroke of glyph.strokes){
   brushStroke(ctx,stroke,p=>{const q=glyphPoint(p,i,visible.length,exportImage?null:viewIndex);return {x:q.x*size,y:q.y*size};},size*.0072);
  }
 }
 const transform=p=>{const q=sigilPoint(p);return {x:q.x*size,y:q.y*size};};
 for(const stroke of state.sigil)brushStroke(ctx,stroke,transform,size*.0096);
 if(state.mode==='sigil'&&activeStroke?.length)brushStroke(ctx,activeStroke,transform,size*.0096);
}
// Draw the cursor on its own transparent layer so CSS can blink it without
// dimming the parchment or affecting the exported image.
export function paintCaret(canvas,state,{size=512,viewIndex=null}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('呪文の入力位置を描画できません。');
 ctx.clearRect(0,0,size,size);
 if(state.mode!=='spell'||state.index>=DRAWN_GLYPH_LIMIT)return;
 const angle=viewIndex===null?glyphAngle(state.index,Math.max(1,state.letters.length)):-Math.PI/2+(state.index-viewIndex)*GLYPH_STEP;
 const radius=size*.345,half=size*.027;
 ctx.beginPath();
 ctx.moveTo(size/2+(radius-half)*Math.cos(angle),size/2+(radius-half)*Math.sin(angle));
 ctx.lineTo(size/2+(radius+half)*Math.cos(angle),size/2+(radius+half)*Math.sin(angle));
 ctx.strokeStyle='#a64a31';ctx.lineWidth=size*.006;ctx.lineCap='round';ctx.globalAlpha=.92;ctx.stroke();ctx.globalAlpha=1;
}
// The pad is a zoomed, un-clipped section of the circle: neighboring letters
// stay visible and blend into the active-ink color as the revolver turns.
function padGlyphPoint(point,index,viewIndex){
 const theta=-Math.PI/2+(index-viewIndex)*EDITOR_GLYPH_STEP,tangent=theta+Math.PI/2;
 const x=.345*Math.cos(theta)+GLYPH_INK_SCALE*(point.x*Math.cos(tangent)-point.y*Math.sin(tangent));
 const y=.345*Math.sin(theta)+GLYPH_INK_SCALE*(point.x*Math.sin(tangent)+point.y*Math.cos(tangent));
 return {x:x/GLYPH_INK_SCALE,y:(y+.345)/GLYPH_INK_SCALE};
}
// Canvas-space crosshairs follow the curved letter band, not a rectangular grid.
export function paintPad(canvas,state,activeStroke=null,viewIndex=state.index,transition=null){
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
 ctx.fillStyle='#03050b';ctx.fillRect(0,0,w,h);
 const scale=Math.min(w,h)/2,at=p=>({x:w/2+p.x*scale,y:h/2+p.y*scale});
 const ringPoint=(radius,angle)=>at({x:radius*Math.sin(angle)/GLYPH_INK_SCALE,
  y:(.345-radius*Math.cos(angle))/GLYPH_INK_SCALE});
 const halfStep=EDITOR_GLYPH_STEP/2;
 const drawSpell=()=>{
  // Actual inner and outer ring arcs.
  ctx.save();ctx.lineWidth=1.5*dpr;ctx.setLineDash([5*dpr,6*dpr]);
  for(const radius of [.43,INNER_RADIUS]){
   ctx.beginPath();
   for(let i=0;i<=120;i++){
    const p=ringPoint(radius,(i/120-.5)*1.1);
    if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
   }
   ctx.strokeStyle=radius===INNER_RADIUS?'#a48968':'#866e9c';ctx.stroke();
  }
  // The two spokes delimit exactly one magnified revolver turn.
  ctx.strokeStyle='#b8a0d6';ctx.lineWidth=1.35*dpr;ctx.setLineDash([3*dpr,5*dpr]);
  for(const theta of [-halfStep,halfStep]){
   const inner=ringPoint(INNER_RADIUS-.025,theta),outer=ringPoint(.43+.025,theta);
   ctx.beginPath();ctx.moveTo(inner.x,inner.y);ctx.lineTo(outer.x,outer.y);ctx.stroke();
  }
  // Fine dotted central cross: radial axis and a *curved* tangential axis.
  ctx.strokeStyle='#f3dcaa';ctx.lineWidth=1*dpr;ctx.setLineDash([1.5*dpr,3.4*dpr]);
  let p=ringPoint(INNER_RADIUS-.045,0),q=ringPoint(.43+.045,0);
  ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  ctx.beginPath();
  for(let i=0;i<=96;i++){
   p=ringPoint(.345,(i/96-.5)*EDITOR_GLYPH_STEP);
   if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();ctx.restore();
  const drawn=state.letters.slice();
  if(state.ink.length||activeStroke?.length)drawn[state.index]={strokes:[...state.ink,...(activeStroke?.length?[activeStroke]:[])]};
  for(let i=0;i<drawn.length;i++){
   const glyph=drawn[i];if(!glyph?.strokes||Math.abs(i-viewIndex)>3)continue;
   const highlight=Math.max(0,1-Math.abs(i-viewIndex));
   const color='rgb('+[0,1,2].map(k=>Math.round([113,169,186][k]*(1-highlight)+[210,183,255][k]*highlight)).join(',')+')';
   for(const stroke of glyph.strokes)strokePath(ctx,stroke,p=>at(padGlyphPoint(p,i,viewIndex)),3.2*dpr,color,7*dpr);
  }
 };
 const drawSigil=()=>{
  ctx.save();ctx.strokeStyle='#74718b';ctx.lineWidth=1.5*dpr;ctx.setLineDash([5*dpr,7*dpr]);
  ctx.beginPath();ctx.arc(w/2,h/2,scale*GUIDE_RADIUS,0,Math.PI*2);ctx.stroke();ctx.restore();
  for(const stroke of state.sigil)strokePath(ctx,stroke,at,2.4*dpr,'#d2b7ff',9*dpr);
  if(activeStroke?.length&&state.mode==='sigil')strokePath(ctx,activeStroke,at,2.4*dpr,'#e8d9ff',13*dpr);
 };
 if(transition){
  const t=Math.max(0,Math.min(1,transition.progress));
  // Both drawing surfaces visibly move AND scale, crossfading in both directions.
  const layer=(alpha,dx,dy,zoom,paint)=>{
   if(alpha<=0)return;
   ctx.save();ctx.globalAlpha=alpha;
   ctx.translate(w/2+dx*w,h/2+dy*h);ctx.scale(zoom,zoom);ctx.translate(-w/2,-h/2);
   paint();ctx.restore();
  };
  layer(1-t,-.17*t,.14*t,1-.3*t,drawSpell);
  layer(t,.17*(1-t),-.14*(1-t),.7+.3*t,drawSigil);
 }else if(state.mode==='spell')drawSpell();
 else drawSigil();
}
function canvasBlob(canvas,type,quality){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('魔法陣画像を作成できません。')),type,quality));
}

export function initCircleDrawing(doc,{onSave}){
 const get=id=>doc.getElementById(id);
 const dialog=get('circleDrawingDialog'),preview=get('circleDrawingPreview'),pad=get('circleDrawingPad');
 const confirm=get('circleDrawingConfirm'),status=get('circleDrawingStatus'),shell=get('circleDrawingShell');
 const discard=get('circleDrawingDiscard'),keep=get('circleDrawingDiscardKeep'),discardButton=get('circleDrawingDiscardConfirm');
 let model=createDrawingModel(),pointerId=null,activeStroke=null,busy=false,animating=false,previousFocus=null,viewIndex=0;
 let animationId=0,padTransition=null;
 const message=text=>{status.textContent=text;};
 function repaint(){
  const sigil=model.state.mode==='sigil';
  paintCircle(preview,model.state,{activeStroke,size:512});
  paintCaret(get('circleDrawingCaret'),model.state,{size:512});
  paintPad(pad,model.state,activeStroke,viewIndex,padTransition);
  get('circleDrawingStage').textContent=sigil?'紋':'呪文';
  get('circleDrawingClose').textContent=sigil?'戻る':'閉じる';
  get('circleDrawingUndo').disabled=busy||animating||!(sigil?model.canUndo:model.canPrevious);
  get('circleDrawingRedo').disabled=busy||animating||!(sigil?model.canRedo:model.canNext);
  get('circleDrawingUndo').setAttribute?.('aria-label',sigil?'取り消す':'前の文字');
  get('circleDrawingRedo').setAttribute?.('aria-label',sigil?'やり直す':'次の文字');
  get('circleDrawingReset').disabled=busy||animating;
  confirm.disabled=busy||animating;
  confirm.textContent=busy?'登録中…':sigil?'決定':'紋を描く';
 }
 const release=()=>{pointerId=null;activeStroke=null;};
 function animateTurn(target){
  const startIndex=viewIndex,token=++animationId;
  animating=true;
  repaint();
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const raf=window.requestAnimationFrame;
  if(typeof raf!=='function'||reduced){
   viewIndex=target;animating=false;repaint();return;
  }
  let start=null;
  const step=time=>{
   if(token!==animationId||!dialog.open)return;
   if(start===null)start=time;
   const t=Math.min(1,(time-start)/REVOLVER_DURATION_MS);
   const eased=t*t*(3-2*t);
   viewIndex=startIndex+(target-startIndex)*eased;
   // Restore the wheel's original angle before entering sigil mode.
   repaint();
   if(t<1)raf.call(window,step);
   else{animating=false;repaint();}
  };
  raf.call(window,step);
 }
 function animateMode(toMode,done){
  const token=++animationId,forward=toMode==='sigil';
  animating=true;
  const render=t=>{padTransition={progress:forward?t:1-t};repaint();};
  const complete=()=>{padTransition=null;animating=false;done();repaint();};
  render(0);
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const raf=window.requestAnimationFrame;
  if(typeof raf!=='function'||reduced){complete();return;}
  let start=null;
  const frame=time=>{
   if(token!==animationId||!dialog.open)return;
   if(start===null)start=time;
   const t=Math.min(1,(time-start)/320),eased=t*t*(3-2*t);
   render(eased);
   if(t<1)raf.call(window,frame);
   else complete();
  };
  raf.call(window,frame);
 }
 function finishPointer(event,cancel=false){
  if(pointerId!==event.pointerId)return;
  if(!cancel&&activeStroke?.length)model.addStroke(activeStroke);
  release();message('');repaint();
 }
 pad.addEventListener('pointerdown',event=>{
  if(busy||animating||pointerId!==null||event.pointerType==='mouse'&&event.button!==0)return;
  event.preventDefault();
  pointerId=event.pointerId;activeStroke=[pointOnPad(event.clientX,event.clientY,pad.getBoundingClientRect())];
  pad.setPointerCapture?.(event.pointerId);repaint();
 });
 pad.addEventListener('pointermove',event=>{
  if(pointerId!==event.pointerId||!activeStroke)return;
  event.preventDefault();
  const p=pointOnPad(event.clientX,event.clientY,pad.getBoundingClientRect()),prev=activeStroke.at(-1);
  if(Math.hypot(p.x-prev.x,p.y-prev.y)>.005&&activeStroke.length<2500){activeStroke.push(p);repaint();}
 });
 pad.addEventListener('pointerup',event=>finishPointer(event));
 pad.addEventListener('pointercancel',event=>finishPointer(event,true));
 pad.addEventListener('lostpointercapture',event=>finishPointer(event,true));
 get('circleDrawingUndo').addEventListener('click',()=>{
  if(busy||animating||pointerId!==null)return;
  if(model.state.mode==='sigil'){if(model.undo())repaint();}
  else if(model.move(-1)){message('');animateTurn(model.state.index);}
 });
 get('circleDrawingRedo').addEventListener('click',()=>{
  if(busy||animating||pointerId!==null)return;
  if(model.state.mode==='sigil'){if(model.redo())repaint();}
  else if(model.move(1)){message('');animateTurn(model.state.index);}
 });
 get('circleDrawingReset').addEventListener('click',()=>{
  if(busy||animating||pointerId!==null)return;
  model.reset();message('');repaint();
 });
 async function finish(){
  if(busy||animating||pointerId!==null)return;
  if(model.state.mode==='spell'){
   if(!model.state.ink.length&&!model.state.letters.some(x=>x&&!x.space)){
    message('呪文を描いてください。');return;
   }
   message('');
   animateMode('sigil',()=>{model.goSigil();release();});
   return;
  }
  if(!model.complete){message('紋を描いてください。');return;}
  busy=true;message('魔法陣を封印しています…');repaint();
  try{
   const canvas=doc.createElement('canvas');
   paintCircle(canvas,model.state,{exportImage:true,size:1024});
   const image=await canvasBlob(canvas,'image/jpeg',.92);
   dialog.close();release();await onSave(image);
  }catch(error){message('登録できませんでした：'+String(error?.message||error));}
  finally{busy=false;repaint();}
 }
 confirm.addEventListener('click',()=>void finish());
 let discardReturnFocus=null;
 function hideDiscard(restoreFocus=true){
  if(discard.hidden)return;
  discard.hidden=true;shell.inert=false;
  if(restoreFocus&&dialog.open)discardReturnFocus?.focus?.();
  discardReturnFocus=null;
 }
 function close(){
  if(busy||animating||!dialog.open||!discard.hidden)return;
  if(model.state.mode==='sigil'){
   animateMode('spell',()=>{model.goSpell();viewIndex=model.state.index;release();message('');});return;
  }
  if(!(model.state.letters.length||model.state.ink.length||model.state.sigil.length||activeStroke?.length)){
   dialog.close();return;
  }
  discardReturnFocus=doc.activeElement;shell.inert=true;discard.hidden=false;keep.focus();
 }
 get('circleDrawingClose').addEventListener('click',close);
 keep.addEventListener('click',()=>hideDiscard());
 discardButton.addEventListener('click',()=>{hideDiscard(false);dialog.close();});
 dialog.addEventListener('cancel',event=>{
  event.preventDefault();
  if(!discard.hidden)hideDiscard();else close();
 });
 dialog.addEventListener('close',()=>{
  animationId++;animating=false;padTransition=null;
  hideDiscard(false);release();previousFocus?.focus?.();
 });
 window.addEventListener('resize',()=>{if(dialog.open)repaint();});
 function present(){
  release();hideDiscard(false);busy=false;animating=false;padTransition=null;viewIndex=model.state.index;message('');
  if(!dialog.open)dialog.showModal();
  repaint();confirm.focus();
 }
 return {
  open(){model=createDrawingModel();previousFocus=doc.activeElement;present();},
  // Analysis cancellation resumes the existing spell and sigil, not a fresh draft.
  resume(){present();}
 };
}
