// Browser-only finger-drawn magic circle editor. Geometry/state helpers are pure and CI-testable.
export const DRAWN_GLYPH_LIMIT=32;
export const DRAWN_POWER_RATE=0.6;
export const MIN_DUNGEON_POWER=250;
const INNER_RADIUS=.255;
const GUIDE_RADIUS=.92;
// One touchpad unit is actual magic-circle space (not a normalized letter box).
// Its half-width reaches past both rings and multiple adjacent 32-slot letters.
export const GLYPH_PAD_SCALE=.105;
const GLYPH_INK_SCALE=GLYPH_PAD_SCALE;
const GLYPH_STEP=2*Math.PI/DRAWN_GLYPH_LIMIT;

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
export function glyphPoint(point,index,count=1){
 const angle=glyphAngle(index,count);
 const tangent=angle+Math.PI/2,dx=point.x*GLYPH_INK_SCALE,dy=point.y*GLYPH_INK_SCALE;
 return {x:.5+.345*Math.cos(angle)+dx*Math.cos(tangent)-dy*Math.sin(tangent),
  y:.5+.345*Math.sin(angle)+dx*Math.sin(tangent)+dy*Math.cos(tangent)};
}
export function spellCamera(count){
 const angle=caretAngle(count);
 return {cx:.5+.345*Math.cos(angle),cy:.5+.345*Math.sin(angle),rotation:angle+Math.PI/2,scale:GLYPH_PAD_SCALE};
}
export function sigilCamera(){
 return {cx:.5,cy:.5,rotation:0,scale:INNER_RADIUS/GUIDE_RADIUS};
}
export function padToCircle(point,camera){
 const c=Math.cos(camera.rotation),s=Math.sin(camera.rotation);
 return {x:camera.cx+camera.scale*(point.x*c-point.y*s),
  y:camera.cy+camera.scale*(point.x*s+point.y*c)};
}
export function circleToPad(point,camera){
 const dx=(point.x-camera.cx)/camera.scale,dy=(point.y-camera.cy)/camera.scale;
 const c=Math.cos(camera.rotation),s=Math.sin(camera.rotation);
 return {x:dx*c+dy*s,y:-dx*s+dy*c};
}
export function interpolateCamera(a,b,progress){
 const t=Math.max(0,Math.min(1,progress));
 return {cx:a.cx+(b.cx-a.cx)*t,cy:a.cy+(b.cy-a.cy)*t,
  rotation:a.rotation+(b.rotation-a.rotation)*t,scale:a.scale+(b.scale-a.scale)*t};
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
// Undo/redo only tracks committed characters (or complete sigil strokes), never pen movements.
function snapshot(s){return {letters:s.letters.slice(),sigil:s.sigil.slice()};}
export function createDrawingModel(){
 const state={mode:'spell',letters:[],ink:[],sigil:[]};
 let undo=[],redo=[];
 function checkpoint(){undo.push(snapshot(state));if(undo.length>100)undo.shift();redo=[];}
 function mutate(fn){checkpoint();fn();}
 function history(direction){
  const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;
  if(!from.length)return false;
  to.push(snapshot(state));Object.assign(state,from.pop());return true;
 }
 return {
  state,
  get canUndo(){return undo.length>0;},
  get canRedo(){return redo.length>0;},
  addStroke(points){
   if(!Array.isArray(points)||!points.length)return false;
   const stroke=points.map(p=>({x:Number(p.x),y:Number(p.y)}));
   if(stroke.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return false;
   if(state.mode==='spell')state.ink.push(stroke);
   else mutate(()=>state.sigil.push(stroke));
   return true;
  },
  enterGlyph(){
   if(state.mode!=='spell'||state.letters.length>=DRAWN_GLYPH_LIMIT)return false;
   mutate(()=>{
    state.letters.push(state.ink.length?{strokes:state.ink.map(stroke=>stroke.map(point=>({...point})))}:{space:true});
    state.ink=[];
   });
   return true;
  },
  goSigil(){
   if(state.mode!=='spell'||!state.letters.some(x=>!x.space)||state.ink.length)return false;
   state.mode='sigil';undo=[];redo=[];return true;
  },
  goSpell(){state.mode='spell';undo=[];redo=[];},
  reset(){
   if(state.mode==='spell'){
    if(!state.ink.length)return false;
    state.ink=[];return true;
   }
   if(!state.sigil.length)return false;
   mutate(()=>state.sigil=[]);
   return true;
  },
  undo(){return history('undo');},
  redo(){return history('redo');},
  get complete(){return state.letters.some(x=>!x.space)&&state.sigil.length>0&&state.mode==='sigil';}
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
export function paintCircle(canvas,state,{exportImage=false,activeStroke=null,size=512,transition=null}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('魔法陣を描画できません。');
 ctx.clearRect(0,0,size,size);
 paintParchment(ctx,size);
 brushCircle(ctx,size,.43,.0055);
 brushCircle(ctx,size,INNER_RADIUS,.0095);
 for(let i=0;i<state.letters.length;i++){
  const glyph=state.letters[i];
  if(glyph.space)continue;
  for(const stroke of glyph.strokes){
   // Existing letters recenter gradually during a revolver step; the just-entered
   // letter stays where the pen drew it and rotates out of the current view.
   const count=transition?.type==='revolver'&&i<transition.fromCount
    ?transition.fromCount+transition.progress:state.letters.length;
   brushStroke(ctx,stroke,p=>{const q=glyphPoint(p,i,count);return {x:q.x*size,y:q.y*size};},size*.0072);
  }
 }
 if(state.mode==='spell'){
  // Before 入力 the unfinished pen marks are also visible on the large preview.
  const camera=spellCamera(state.letters.length);
  for(const stroke of state.ink)brushStroke(ctx,stroke,p=>{
   const q=padToCircle(p,camera);return {x:q.x*size,y:q.y*size};
  },size*.0072);
  if(activeStroke?.length)brushStroke(ctx,activeStroke,p=>{
   const q=padToCircle(p,camera);return {x:q.x*size,y:q.y*size};
  },size*.0072);
 }
 const transform=p=>{const q=sigilPoint(p);return {x:q.x*size,y:q.y*size};};
 for(const stroke of state.sigil)brushStroke(ctx,stroke,transform,size*.0096);
 if(state.mode==='sigil'&&activeStroke?.length)brushStroke(ctx,activeStroke,transform,size*.0096);
}
// Draw the cursor on its own transparent layer so CSS can blink it without
// dimming the parchment or affecting the exported image.
export function paintCaret(canvas,state,{size=512,transition=null}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('呪文の入力位置を描画できません。');
 ctx.clearRect(0,0,size,size);
 if(state.mode!=='spell'||state.letters.length>=DRAWN_GLYPH_LIMIT)return;
 const visibleCount=transition?.type==='revolver'?transition.fromCount+transition.progress:state.letters.length;
 const angle=caretAngle(visibleCount),radius=size*.345,half=size*.027;
 ctx.beginPath();
 ctx.moveTo(size/2+(radius-half)*Math.cos(angle),size/2+(radius-half)*Math.sin(angle));
 ctx.lineTo(size/2+(radius+half)*Math.cos(angle),size/2+(radius+half)*Math.sin(angle));
 ctx.strokeStyle='#a64a31';ctx.lineWidth=size*.006;ctx.lineCap='round';ctx.globalAlpha=.92;ctx.stroke();ctx.globalAlpha=1;
}
// The pad is a moving magnified window onto the actual magic circle, not
// a separate square of ink that gets shrunk into a letter slot.
export function paintPad(canvas,state,activeStroke=null,transition=null){
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
 ctx.fillStyle='#03050b';ctx.fillRect(0,0,w,h);
 const scale=Math.min(w,h)/2;
 const pixel=p=>({x:w/2+p.x*scale,y:h/2+p.y*scale});
 const finalCamera=state.mode==='spell'?spellCamera(state.letters.length):sigilCamera();
 let camera=finalCamera;
 if(transition){
  const from=transition.type==='revolver'||transition.type==='sigil'
   ?spellCamera(transition.fromCount):sigilCamera();
  const to=transition.type==='revolver'||transition.type==='back'
   ?spellCamera(transition.toCount):sigilCamera();
  camera=interpolateCamera(from,to,transition.progress);
 }
 const project=q=>pixel(circleToPad(q,camera));
 // The inner and outer ring are genuine projected circle guides. They are
 // not boundaries: a stroke may cross either arc or overlap adjacent letters.
 for(const [radius,color] of [[.43,'rgba(244,197,127,.75)'],[INNER_RADIUS,'rgba(138,190,206,.68)']]){
  ctx.save();ctx.beginPath();
  for(let i=0;i<=240;i++){
   const a=i*Math.PI*2/240;
   const p=project({x:.5+radius*Math.cos(a),y:.5+radius*Math.sin(a)});
   if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
  }
  ctx.strokeStyle=color;ctx.lineWidth=dpr*1.35;ctx.setLineDash([5*dpr,6*dpr]);ctx.stroke();ctx.restore();
 }
 ctx.save();
 ctx.strokeStyle='rgba(176,168,204,.28)';ctx.lineWidth=dpr*.9;ctx.setLineDash([3*dpr,8*dpr]);
 ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
 ctx.restore();
 // Render nearby, already committed letters in alternating glow colors.
 // Their location rotates continuously while the revolver moves to the next slot.
 for(let i=0;i<state.letters.length;i++){
  const glyph=state.letters[i];if(glyph.space)continue;
  const layoutCount=transition?.type==='revolver'&&i<transition.fromCount
   ?transition.fromCount+transition.progress:state.letters.length;
  const at=p=>project(glyphPoint(p,i,layoutCount));
  const color=i%2===0?'#77d5ff':'#dfb0fa';
  for(const stroke of glyph.strokes)strokePath(ctx,stroke,at,3*dpr,color,8*dpr);
 }
 // The current ink is authored in the *target* spell camera coordinates and
 // shown through whichever camera is currently being animated.
 if(state.mode==='spell'){
  const target=spellCamera(state.letters.length);
  const at=p=>project(padToCircle(p,target));
  for(const stroke of state.ink)strokePath(ctx,stroke,at,4.8*dpr,'#e7c5ff',9*dpr);
  if(activeStroke?.length)strokePath(ctx,activeStroke,at,4.8*dpr,'#fff1c9',13*dpr);
 }
 for(const stroke of state.sigil)
  strokePath(ctx,stroke,p=>project(sigilPoint(p)),2.4*dpr,'#e7c5ff',9*dpr);
 if(state.mode==='sigil'&&activeStroke?.length)
  strokePath(ctx,activeStroke,p=>project(sigilPoint(p)),2.4*dpr,'#fff1c9',13*dpr);
}
function canvasBlob(canvas,type,quality){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('魔法陣画像を作成できません。')),type,quality));
}

export function initCircleDrawing(doc,{onSave}){
 const get=id=>doc.getElementById(id);
 const dialog=get('circleDrawingDialog'),preview=get('circleDrawingPreview'),pad=get('circleDrawingPad');
 const confirm=get('circleDrawingConfirm'),status=get('circleDrawingStatus');
 const shell=get('circleDrawingShell');
 const discard=get('circleDrawingDiscard'),keep=get('circleDrawingDiscardKeep'),discardButton=get('circleDrawingDiscardConfirm');
 let model=createDrawingModel(),pointerId=null,activeStroke=null,busy=false,previousFocus=null;
 const message=text=>{status.textContent=text;};
 function repaint(){
  paintCircle(preview,model.state,{activeStroke,size:512});
  paintCaret(get('circleDrawingCaret'),model.state,{size:512});
  paintPad(pad,model.state,activeStroke);
  const sigil=model.state.mode==='sigil';
  get('circleDrawingStage').textContent=sigil?'紋を書く':'呪文を1文字ずつ書く';
  get('circleDrawingClose').textContent=sigil?'戻る':'閉じる';
  get('circleDrawingInput').hidden=sigil;
  get('circleDrawingInput').disabled=model.state.letters.length>=DRAWN_GLYPH_LIMIT||busy;
 get('circleDrawingUndo').disabled=!model.canUndo||busy;
  get('circleDrawingRedo').disabled=!model.canRedo||busy;
  get('circleDrawingReset').disabled=busy;
  confirm.disabled=busy;
  confirm.textContent=busy?'登録中…':'決定';
 }
 const release=()=>{pointerId=null;activeStroke=null;};
 function finishPointer(event,cancel=false){
  if(pointerId!==event.pointerId)return;
  if(!cancel&&activeStroke?.length)model.addStroke(activeStroke);
  release();message('');repaint();
 }
 pad.addEventListener('pointerdown',event=>{
  if(busy||pointerId!==null||event.pointerType==='mouse'&&event.button!==0)return;
  if(model.state.mode==='spell'&&model.state.letters.length>=DRAWN_GLYPH_LIMIT){message('環は32文字までです。');return;}
  event.preventDefault();
  pointerId=event.pointerId;activeStroke=[pointOnPad(event.clientX,event.clientY,pad.getBoundingClientRect())];
  pad.setPointerCapture?.(event.pointerId);repaint();
 });
 pad.addEventListener('pointermove',event=>{
  if(pointerId!==event.pointerId||!activeStroke)return;
  event.preventDefault();
  const p=pointOnPad(event.clientX,event.clientY,pad.getBoundingClientRect());
  const prev=activeStroke.at(-1);
  if(Math.hypot(p.x-prev.x,p.y-prev.y)>.005&&activeStroke.length<2500){activeStroke.push(p);repaint();}
 });
 pad.addEventListener('pointerup',event=>finishPointer(event));
 pad.addEventListener('pointercancel',event=>finishPointer(event,true));
 pad.addEventListener('lostpointercapture',event=>finishPointer(event,true));
 get('circleDrawingInput').addEventListener('click',()=>{
  if(!busy&&model.enterGlyph()){message('');repaint();}
 });
get('circleDrawingUndo').addEventListener('click',()=>{if(!busy&&model.undo())repaint();});
 get('circleDrawingRedo').addEventListener('click',()=>{if(!busy&&model.redo())repaint();});
 get('circleDrawingReset').addEventListener('click',()=>{
  if(busy)return;
  model.reset();message('');repaint();
 });
 async function finish(){
  if(busy||pointerId!==null)return;
  if(model.state.mode==='spell'){
   if(model.state.ink.length&&model.state.letters.length<DRAWN_GLYPH_LIMIT)model.enterGlyph();
   if(!model.goSigil()){message('呪文を1文字以上入力してください。');repaint();return;}
   message('');repaint();return;
  }
  if(!model.complete){message('紋を描いてから決定してください。');return;}
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
  if(busy||!dialog.open||!discard.hidden)return;
  if(model.state.mode==='sigil'){
   model.goSpell();release();message('');repaint();return;
  }
  if(!(model.state.letters.length||model.state.ink.length||model.state.sigil.length||activeStroke?.length)){
   dialog.close();return;
  }
  discardReturnFocus=doc.activeElement;
  shell.inert=true;
  discard.hidden=false;keep.focus();
 }
 get('circleDrawingClose').addEventListener('click',close);
 keep.addEventListener('click',()=>hideDiscard());
 discardButton.addEventListener('click',()=>{hideDiscard(false);dialog.close();});
 dialog.addEventListener('cancel',event=>{
  event.preventDefault();
  if(!discard.hidden)hideDiscard();
  else close();
 });
 dialog.addEventListener('close',()=>{hideDiscard(false);release();previousFocus?.focus?.();});
 window.addEventListener('resize',()=>{if(dialog.open)repaint();});
 function present(){
  release();hideDiscard(false);busy=false;message('');
  if(!dialog.open)dialog.showModal();
  repaint();confirm.focus();
 }
 return {
  open(){
   model=createDrawingModel();previousFocus=doc.activeElement;
   present();
  },
  // Reopen the exact draft after cancelling analysis. Never reset the model:
  // this preserves letters, pen strokes, sigil stage and undo/redo history.
  resume(){present();}
 };
}
