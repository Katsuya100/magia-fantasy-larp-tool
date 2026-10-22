// Browser-only finger-drawn magic circle editor. Geometry/state helpers are pure and CI-testable.
export const DRAWN_GLYPH_LIMIT=32;
export const DRAWN_POWER_RATE=0.6;
const INNER_RADIUS=.255;
const GUIDE_RADIUS=.92;
const GLYPH_STEP=2*Math.PI/DRAWN_GLYPH_LIMIT;

export function drawnPower(power,rate=DRAWN_POWER_RATE){
 if(!Number.isFinite(power)||power<=0||!Number.isFinite(rate)||rate<=0||rate>1)throw Error('手書き魔法陣の威力が不正です。');
 return Math.max(1,Math.round(power*rate));
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
 const tangent=angle+Math.PI/2,dx=point.x*.029,dy=point.y*.048;
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
    state.letters.push(state.ink.length?{strokes:normalizedGlyph(state.ink)}:{space:true});
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
export function paintCircle(canvas,state,{exportImage=false,activeStroke=null,size=512}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('魔法陣を描画できません。');
 ctx.clearRect(0,0,size,size);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);
 const circleColor='#111';
 ctx.strokeStyle=circleColor;ctx.shadowBlur=0;
 for(const r of [.43,INNER_RADIUS]){
  ctx.lineWidth=size*(r===.43?.004:.007);
  ctx.beginPath();ctx.arc(size/2,size/2,size*r,0,Math.PI*2);ctx.stroke();
 }
 ctx.shadowBlur=0;
 for(let i=0;i<state.letters.length;i++){
  const glyph=state.letters[i];
  if(glyph.space)continue;
  for(const stroke of glyph.strokes){
   strokePath(ctx,stroke,p=>{const q=glyphPoint(p,i,state.letters.length);return {x:q.x*size,y:q.y*size};},
    size*.006,'#111');
  }
 }
 const transform=p=>{const q=sigilPoint(p);return {x:q.x*size,y:q.y*size};};
 for(const stroke of state.sigil)strokePath(ctx,stroke,transform,size*.007,'#111');
 if(state.mode==='sigil'&&activeStroke?.length)
  strokePath(ctx,activeStroke,transform,size*.007,'#111');
 if(!exportImage&&state.mode==='spell'){
  const angle=caretAngle(state.letters.length),r=size*.345,half=size*.024;
  ctx.beginPath();
  ctx.moveTo(size/2+(r-half)*Math.cos(angle),size/2+(r-half)*Math.sin(angle));
  ctx.lineTo(size/2+(r+half)*Math.cos(angle),size/2+(r+half)*Math.sin(angle));
  ctx.strokeStyle='#111';ctx.lineWidth=size*.006;ctx.lineCap='round';ctx.stroke();
 }
}
function paintPad(canvas,state,activeStroke){
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 const dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
 ctx.fillStyle='#03050b';ctx.fillRect(0,0,w,h);
 const scale=Math.min(w,h)/2;
 const at=p=>({x:w/2+p.x*scale,y:h/2+p.y*scale});
 ctx.save();
 ctx.strokeStyle='rgba(176,168,204,.35)';ctx.lineWidth=dpr*.9;ctx.setLineDash([3*dpr,8*dpr]);
 ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
 ctx.restore();
 if(state.mode==='sigil'){
  ctx.save();ctx.strokeStyle='#74718b';ctx.lineWidth=1.5*dpr;ctx.setLineDash([5*dpr,7*dpr]);
  ctx.beginPath();ctx.arc(w/2,h/2,scale*GUIDE_RADIUS,0,Math.PI*2);ctx.stroke();ctx.restore();
 }
 const strokes=state.mode==='spell'?state.ink:state.sigil;
 const width=state.mode==='spell'?4*dpr:2*dpr;
 for(const stroke of strokes)strokePath(ctx,stroke,at,width,'#d2b7ff',9*dpr);
 if(activeStroke?.length)strokePath(ctx,activeStroke,at,width,'#e8d9ff',13*dpr);
}
function canvasBlob(canvas,type,quality){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('魔法陣画像を作成できません。')),type,quality));
}

export function initCircleDrawing(doc,{onSave}){
 const get=id=>doc.getElementById(id);
 const dialog=get('circleDrawingDialog'),preview=get('circleDrawingPreview'),pad=get('circleDrawingPad');
 const confirm=get('circleDrawingConfirm'),status=get('circleDrawingStatus');
 let model=createDrawingModel(),pointerId=null,activeStroke=null,busy=false,previousFocus=null;
 const message=text=>{status.textContent=text;};
 function repaint(){
  paintCircle(preview,model.state,{activeStroke,size:512});
  paintPad(pad,model.state,activeStroke);
  const sigil=model.state.mode==='sigil';
  get('circleDrawingStage').textContent=sigil?'紋を描く':'呪文を描く';
   get('circleDrawingCount').textContent=sigil?'紋の線：'+model.state.sigil.length:'環：'+model.state.letters.length+' / '+DRAWN_GLYPH_LIMIT;
  get('circleDrawingInput').hidden=sigil;
 get('circleDrawingBack').hidden=!sigil;
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
 get('circleDrawingBack').addEventListener('click',()=>{if(!busy){model.goSpell();message('');repaint();}});
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
 function close(){
  if(busy)return;
  if((model.state.letters.length||model.state.ink.length||model.state.sigil.length)&&!window.confirm('描いている魔法陣を破棄しますか？'))return;
  dialog.close();
 }
 get('circleDrawingClose').addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{release();previousFocus?.focus?.();});
 window.addEventListener('resize',()=>{if(dialog.open)repaint();});
 return {
  open(){
   model=createDrawingModel();release();message('');previousFocus=doc.activeElement;
   dialog.showModal();repaint();confirm.focus();
  }
 };
}
