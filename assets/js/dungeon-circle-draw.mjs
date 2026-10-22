// Browser-only finger-drawn magic circle editor. Geometry/state helpers are pure and CI-testable.
export const DRAWN_GLYPH_LIMIT=32;
export const DRAWN_POWER_RATE=0.6;
const INNER_RADIUS=.255;
export const SIGIL_GUIDE_RADIUS=.94;

export function drawnPower(power,rate=DRAWN_POWER_RATE){
 if(!Number.isFinite(power)||power<=0||!Number.isFinite(rate)||rate<=0||rate>1)throw Error('手書き魔法陣の威力が不正です。');
 return Math.max(1,Math.round(power*rate));
}
export function pointOnPad(clientX,clientY,rect){
 const scale=Math.min(rect.width,rect.height)/2;
 if(!(scale>0))throw Error('タッチパッドのサイズが不正です。');
 return {x:(clientX-rect.left-rect.width/2)/scale,y:(clientY-rect.top-rect.height/2)/scale};
}
export function glyphPoint(point,index,count=1){
 const angle=-Math.PI/2+(index-(count-1)/2)*2*Math.PI/DRAWN_GLYPH_LIMIT;
 const tangent=angle+Math.PI/2,dx=point.x*.029,dy=point.y*.048;
 return {x:.5+.345*Math.cos(angle)+dx*Math.cos(tangent)-dy*Math.sin(tangent),
  y:.5+.345*Math.sin(angle)+dx*Math.sin(tangent)+dy*Math.cos(tangent)};
}
export function sigilPoint(point){
 return {x:.5+point.x*INNER_RADIUS/SIGIL_GUIDE_RADIUS,y:.5+point.y*INNER_RADIUS/SIGIL_GUIDE_RADIUS};
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
// Undo in the spell step records committed character slots, never individual pen strokes.
export function createDrawingModel(){
 const state={mode:'spell',letters:[],ink:[],sigil:[]};
 let undo=[],redo=[];
 function key(){return state.mode==='spell'?'letters':'sigil';}
 function checkpoint(){
  undo.push(state[key()].slice());if(undo.length>100)undo.shift();redo=[];
 }
 function history(direction){
  const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;
  if(!from.length)return false;
  const field=key();to.push(state[field].slice());state[field]=from.pop();return true;
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
   else{checkpoint();state.sigil.push(stroke);}
   return true;
  },
  enterGlyph(){
   if(state.mode!=='spell'||state.letters.length>=DRAWN_GLYPH_LIMIT)return false;
   checkpoint();
   // Pressing Input with a blank pad commits a visible gap in the outer ring.
   state.letters.push(state.ink.length?{strokes:normalizedGlyph(state.ink)}:{space:true});
   state.ink=[];return true;
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
   checkpoint();state.sigil=[];return true;
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
function paintParchment(ctx,size){
 const gradient=ctx.createRadialGradient(size*.44,size*.38,size*.02,size*.5,size*.5,size*.72);
 gradient.addColorStop(0,'#fbf1d9');
 gradient.addColorStop(.65,'#f1e0bd');
 gradient.addColorStop(1,'#d9bc8b');
 ctx.fillStyle=gradient;ctx.fillRect(0,0,size,size);
 // Seeded, very faint paper fibers: redraws do not flicker and JPEGs are reproducible.
 let seed=0x4d414749;
 for(let i=0;i<Math.round(size*.85);i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const x=(seed/4294967296)*size;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const y=(seed/4294967296)*size;
  ctx.fillStyle=i%3?'#7355310c':'#fff9e51f';
  ctx.fillRect(x,y,Math.max(.7,size*.0017),Math.max(.7,size*.001));
 }
}
function brushStroke(ctx,points,transform,width){
 // Warm, slightly irregular ink edges and a nearly-black brush core.
 strokePath(ctx,points,transform,width,'#513824');
 strokePath(ctx,points,transform,width*.78,'#18130f');
 if(points.length<2)return;
 ctx.save();
 ctx.globalAlpha=.55;ctx.strokeStyle='#0c0b09';ctx.lineCap='round';ctx.lineJoin='round';
 ctx.lineWidth=width*.22;ctx.beginPath();
 const skip=Math.max(1,Math.floor(points.length/160));
 for(let i=0;i<points.length;i+=skip){
  const p=transform(points[i]),jitter=Math.sin(i*12.9898)*width*.09;
  if(i===0)ctx.moveTo(p.x+jitter,p.y-jitter);
  else ctx.lineTo(p.x+jitter,p.y-jitter);
 }
 const end=transform(points.at(-1));ctx.lineTo(end.x,end.y);ctx.stroke();ctx.restore();
}
export function paintCircle(canvas,state,{exportImage=false,activeStroke=null,size=512}={}){
 if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('魔法陣を描画できません。');
 ctx.clearRect(0,0,size,size);
 paintParchment(ctx,size);
 for(const [radius,width] of [[.43,.0055],[INNER_RADIUS,.007]]){
  ctx.strokeStyle='#201712';ctx.lineWidth=size*width;
  ctx.lineCap='round';ctx.beginPath();ctx.arc(size/2,size/2,size*radius,0,Math.PI*2);ctx.stroke();
 }
 const count=state.letters.length;
 for(let i=0;i<count;i++){
  const glyph=state.letters[i];
  if(glyph.space)continue;
  for(const stroke of glyph.strokes){
   brushStroke(ctx,stroke,p=>{const q=glyphPoint(p,i,count);return {x:q.x*size,y:q.y*size};},size*.007);
  }
 }
 const transform=p=>{const q=sigilPoint(p);return {x:q.x*size,y:q.y*size};};
 for(const stroke of state.sigil)brushStroke(ctx,stroke,transform,size*.0075);
 if(state.mode==='sigil'&&activeStroke?.length)brushStroke(ctx,activeStroke,transform,size*.0075);
 // Editing caret is intentionally absent from the saved picture.
 if(!exportImage&&state.mode==='spell'&&count<DRAWN_GLYPH_LIMIT){
  const p=glyphPoint({x:-.7,y:-.84},count,Math.max(count,1));
  const q=glyphPoint({x:-.7,y:.84},count,Math.max(count,1));
  ctx.beginPath();ctx.moveTo(p.x*size,p.y*size);ctx.lineTo(q.x*size,q.y*size);
  ctx.strokeStyle='#9f412b';ctx.lineWidth=Math.max(2,size*.004);ctx.stroke();
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
 if(state.mode==='sigil'){
  ctx.save();ctx.strokeStyle='#74718b';ctx.lineWidth=1.5*dpr;ctx.setLineDash([5*dpr,7*dpr]);
  ctx.beginPath();ctx.arc(w/2,h/2,scale*SIGIL_GUIDE_RADIUS,0,Math.PI*2);ctx.stroke();ctx.restore();
 }
 const strokes=state.mode==='spell'?state.ink:state.sigil;
 const width=4*dpr;
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
  get('circleDrawingReset').disabled=busy||(sigil?!model.state.sigil.length:!model.state.ink.length);
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
