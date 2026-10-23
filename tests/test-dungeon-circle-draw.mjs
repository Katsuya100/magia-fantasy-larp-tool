import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,MIN_DUNGEON_POWER,GLYPH_INK_SCALE,REVOLVER_DURATION_MS,EDITOR_GLYPH_STEP,EDITOR_ZOOM,
 drawnPower,withDrawnPowerFloor,pointOnPad,glyphPoint,glyphAngle,sigilPoint,visibleGlyphs,projectCircleToPad,
 padGlyphPoint,glyphInputPoint,sigilPadPoint,sigilInputPoint,sigilGlyphPadPoint,
 createDrawingModel,paintCircle,paintCaret,paintPad,initCircleDrawing
} from '../assets/js/dungeon-circle-draw.mjs';

assert.equal(DRAWN_GLYPH_LIMIT,24,'upper and lower circles must both have 24 slots');
assert.equal(DRAWN_POWER_RATE,.6);
assert.equal(GLYPH_INK_SCALE,.11,'the pad can reach both rings and neighboring slots');
assert.equal(REVOLVER_DURATION_MS,250);
assert.ok(Math.abs(EDITOR_GLYPH_STEP-Math.PI/12)<1e-12,'each letter spans exactly 15 degrees on both screens');
assert.ok(Math.abs(glyphAngle(1,1)-glyphAngle(0,1)-EDITOR_GLYPH_STEP)<1e-12,'upper letter interval equals lower revolver step');
const visibleSlots=2*Math.asin((GLYPH_INK_SCALE/EDITOR_ZOOM)/.345)/EDITOR_GLYPH_STEP;
assert.ok(visibleSlots>2&&visibleSlots<2.1,'lower viewport shows the center character and half of each neighbor');
assert.ok(EDITOR_ZOOM>1&&EDITOR_ZOOM<1.22,'real optical zoom preserves both visible ring guides');
assert.equal(drawnPower(500),300);
assert.equal(drawnPower(1),250);
assert.throws(()=>drawnPower(0));
assert.throws(()=>drawnPower(NaN));
assert.equal(withDrawnPowerFloor({origin:'drawn',basePower:120,analysis:{power:120}}).analysis.power,250);
assert.deepEqual(pointOnPad(110,170,{left:10,top:20,width:200,height:300}),{x:0,y:0});
assert.ok(Math.abs(sigilPoint({x:.92,y:0}).x-.755)<1e-9);
assert.ok(Math.abs(glyphAngle(1,3)+Math.PI/2)<1e-9);
assert.ok(Math.abs(glyphPoint({x:0,y:0},1,3).x-.5)<1e-9);
assert.ok(glyphPoint({x:0,y:-1},0,1).y<.07,'letter ink reaches beyond the outer circle');
assert.ok(glyphPoint({x:0,y:1},0,1).y>.24,'letter ink reaches beyond the inner circle');
assert.ok(glyphPoint({x:1,y:0},0,2).x>.55,'a stroke overlaps the neighboring slot');
for(const [i,count] of [[0,1],[1,3],[7,16],[23,24]]){
 const square=[{x:-.6,y:-.6},{x:.6,y:-.6},{x:.6,y:.6}].map(p=>glyphPoint(p,i,count));
 const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 assert.ok(Math.abs(d(square[0],square[1])-d(square[1],square[2]))<1e-12,'glyph aspect ratio remains square');
}

// Matching the same upper-circle geometry is mandatory: the lower pad is not
// allowed to stretch neighboring angular gaps independently.
const eq=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-10,msg+': '+a+' != '+b);
const spellRadius=GLYPH_INK_SCALE/EDITOR_ZOOM;
const sigilRadius=(sigilPoint({x:1,y:0}).x-.5)/sigilPadPoint({x:1,y:0}).x;
for(const i of [0,1,3,8,23]){
 for(const view of [0,.5,1,3,7]){
  for(const point of [{x:0,y:0},{x:-1,y:.7},{x:.8,y:-1.2}]){
   const top=glyphPoint(point,i,1),dx=top.x-.5,dy=top.y-.5;
   const theta=-view*EDITOR_GLYPH_STEP;
   const lower=padGlyphPoint(point,i,view),sigil=sigilGlyphPadPoint(point,i);
   eq(lower.x,(dx*Math.cos(theta)-dy*Math.sin(theta))/spellRadius,'lower x is top crop');
   eq(lower.y,(dx*Math.sin(theta)+dy*Math.cos(theta)+.345)/spellRadius,'lower y is top crop');
   eq(sigil.x,dx/sigilRadius,'sigil text x is top crop');
   eq(sigil.y,dy/sigilRadius,'sigil text y is top crop');
  }
 }
 for(const p of [{x:0,y:0},{x:.5,y:-.8},{x:-1,y:.75}]){
  const actual=padGlyphPoint(glyphInputPoint(p),i,i);
  eq(actual.x,p.x,'spell pointer mapped to pixel x');
  eq(actual.y,p.y,'spell pointer mapped to pixel y');
 }
}
for(const i of [0,6,12,18,23]){
 const outside=sigilGlyphPadPoint({x:0,y:-1},i,24);
 const inside=sigilGlyphPadPoint({x:0,y:1},i,24);
 assert.ok(Math.hypot(outside.x,outside.y)>1,'sigil crop excludes outer-ring lettering');
 assert.ok(Math.hypot(inside.x,inside.y)<1,'sigil crop shows only glyph marks entering the original inner area');
}
eq(Math.hypot(sigilPadPoint({x:.92,y:0}).x,sigilPadPoint({x:.92,y:0}).y),.92,'sigil retains its original writing boundary');
assert.ok(.43/sigilRadius>1.5,'outer ring cannot appear completely inside sigil pad');
for(const count of [1,2,7,24]){
 for(const i of [0,Math.min(count-1,1),count-1]){
  for(const p of [{x:0,y:0},{x:.8,y:-1}]){
   const top=glyphPoint(p,i,count);
   const start=projectCircleToPad(top,i,0,count),end=projectCircleToPad(top,i,1,count);
   const spell=padGlyphPoint(p,i,i,count),sigil=sigilGlyphPadPoint(p,i,count);
   eq(start.x,spell.x,'spell frame starts at same upper-centered point');
   eq(start.y,spell.y,'spell frame starts at same upper-centered point');
   eq(end.x,sigil.x,'sigil frame ends at same upper-centered point');
   eq(end.y,sigil.y,'sigil frame ends at same upper-centered point');
  }
 }
 eq((glyphAngle(0,count)+glyphAngle(count-1,count))/2,-Math.PI/2,'whole upper spell stays centered');
}
const testWorld={x:.5+.345,y:.5};
const rotateQuarter=projectCircleToPad(testWorld,0,.25,1);
const rotateHalf=projectCircleToPad(testWorld,0,.5,1);
assert.ok(rotateQuarter.y>0&&rotateHalf.x<0,'one camera visibly rotates even on the first glyph');
for(const p of [{x:0,y:0},{x:.6,y:-.8},{x:-1,y:1}]){
 const actual=sigilPadPoint(sigilInputPoint(p));
 eq(actual.x,p.x,'sigil pointer mapped to pixel x');
 eq(actual.y,p.y,'sigil pointer mapped to pixel y');
}

const stroke=[{x:-.8,y:-.9},{x:.8,y:.9}];
const model=createDrawingModel();
assert.equal(model.canPrevious,false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.canUndo,false,'spell mode repurposes history buttons as navigation');
assert.equal(model.move(-1),false);
assert.equal(model.move(1),true);
assert.deepEqual(model.state.letters[0].strokes[0],stroke,'character coordinates are not normalized or clipped');
assert.equal(model.state.index,1);
assert.equal(model.move(1),true,'passing an empty pad inserts a space');
assert.equal(model.state.letters[1].space,true);
assert.equal(model.move(-1),true);
assert.equal(model.move(-1),true);
assert.deepEqual(model.state.ink[0],stroke,'the prior glyph becomes editable again');
assert.equal(model.reset(),true,'clear affects the current slot');
assert.equal(model.state.letters[0].space,true);
assert.equal(model.state.letters[1].space,true,'the neighboring glyph remains unchanged');
assert.equal(model.addStroke(stroke),true);
assert.equal(model.goSigil(),true,'confirm saves the active character automatically');
assert.equal(model.state.letters[0].strokes.length,1);
assert.equal(model.complete,false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.complete,true);
assert.equal(model.undo(),true,'sigil undo acts on a complete pen stroke');
assert.equal(model.complete,false);
assert.equal(model.redo(),true);
assert.equal(model.reset(),true);
assert.equal(model.undo(),true,'sigil reset can be undone');
assert.equal(model.complete,true);
model.goSpell();
assert.equal(model.state.ink.length,1,'back from sigil retains the active text');
const spaces=createDrawingModel();
assert.equal(spaces.move(1),true);
assert.equal(spaces.goSigil(),false,'blank glyphs are not enough to confirm');
const full=createDrawingModel();
for(let i=0;i<DRAWN_GLYPH_LIMIT;i++){
 assert.equal(full.addStroke(stroke),true);
 if(i<DRAWN_GLYPH_LIMIT-1)assert.equal(full.move(1),true);
}
assert.equal(full.move(1),false);
assert.equal(full.goSigil(),true);
assert.equal(full.state.letters.length,DRAWN_GLYPH_LIMIT);

const draws=[];
const ctx={
 clearRect(){},fillRect(){draws.push(['fill',this.fillStyle]);},
 beginPath(){},moveTo(x,y){draws.push(['move',x,y]);},lineTo(){},closePath(){},arc(){},save(){},restore(){},
 translate(x,y){draws.push(['translate',x,y]);},scale(x,y){draws.push(['scale',x,y]);},
 setLineDash(dash){draws.push(['dash',...dash]);},
 stroke(){draws.push(['stroke',this.strokeStyle,this.lineWidth]);},fill(){},
 createRadialGradient(){return {addColorStop(){}};}
};
const canvas={width:0,height:0,getContext(){return ctx;},getBoundingClientRect(){return {left:0,top:0,width:200,height:200};}};
const state={mode:'spell',letters:[{strokes:[stroke]},{strokes:[stroke]}],index:0,ink:[stroke],sigil:[]};
paintCircle(canvas,state,{size:128,viewIndex:0});
assert.ok(draws.some(d=>d[0]==='fill'&&d[1]==='#f2e4c6'));
assert.ok(draws.some(d=>d[0]==='stroke'&&d[2]===128*.0055),'outer ring retained');
assert.ok(draws.some(d=>d[0]==='stroke'&&d[2]===128*.0095),'inner ring retained');
assert.ok(draws.some(d=>d[0]==='stroke'&&d[2]===128*.0072),'letter ink retained');
const strokeCount=draws.filter(d=>d[0]==='stroke'&&d[2]===128*.0072).length;
draws.length=0;paintCircle(canvas,state,{size:128,activeStroke:stroke});
assert.ok(draws.filter(d=>d[0]==='stroke'&&d[2]===128*.0072).length>strokeCount,'live pen stroke immediately appears on the fixed upper preview');
draws.length=0;
paintCircle(canvas,{...state,mode:'sigil',ink:[]},{size:128,exportImage:true});
assert.ok(draws.some(d=>d[0]==='stroke'&&d[2]===128*.0072),'export includes both finished letters');
draws.length=0;paintCaret(canvas,state,{size:128});
assert.equal(draws.filter(d=>d[0]==='stroke').length,1);
const caret=draws.find(d=>d[0]==='move');
const caretRadius=Math.hypot(caret[1]-64,caret[2]-64)/128;
assert.ok(caretRadius>.255&&caretRadius<.43,'caret is inside the magic-circle glyph band');
const caretAngle=Math.atan2(caret[2]-64,caret[1]-64);
assert.ok(Math.abs(caretAngle-(glyphAngle(0,2)-EDITOR_GLYPH_STEP/2))<1e-10,'caret marks the LEFT edge, not the glyph center');
draws.length=0;paintCaret(canvas,{...state,index:1},{size:128});
const nextCaret=draws.find(d=>d[0]==='move');
const nextAngle=Math.atan2(nextCaret[2]-64,nextCaret[1]-64);
assert.ok(Math.abs(nextAngle-caretAngle-EDITOR_GLYPH_STEP)<1e-10,'caret moves by exactly the same 15-degree slot as both screens');
draws.length=0;paintCaret(canvas,{...state,mode:'sigil'},{size:128});
assert.equal(draws.length,0);
const originalWindow=globalThis.window;
globalThis.window={devicePixelRatio:1,addEventListener(){}};
try{
 draws.length=0;paintPad(canvas,state,[],0);
 assert.ok(draws.some(d=>d[1]==='#866e9c')&&draws.some(d=>d[1]==='#a48968'),'outer/inner scaled ring guides are visible');
 assert.ok(draws.some(d=>d[1]==='rgb(210,183,255)'),'active text uses the highlight ink');
 assert.ok(draws.some(d=>d[1]==='rgb(113,169,186)'),'adjacent text uses a different ink');
 assert.ok(draws.some(d=>d[0]==='dash'&&d[1]===1.5&&d[2]===3.4),'the fine central dotted cross is rendered');
 draws.length=0;paintPad(canvas,state,[],0,{progress:.5});
 assert.equal(draws.filter(d=>d[0]==='stroke'&&Math.abs(d[2]-2.7)<1e-10).length,2,'two glyphs are each painted once during transition');
 assert.equal(draws.some(d=>d[0]==='scale'||d[0]==='translate'),false,'no layered, scaled renderings of two separate screens');
 draws.length=0;paintPad(canvas,{...state,mode:'sigil',ink:[]},[],0);
 assert.ok(draws.some(d=>d[0]==='stroke'&&d[1]==='rgb(169,155,194)'),'sigil crop preserves projected glyph strokes');
 draws.length=0;paintPad(canvas,state,[],.5);
 assert.ok(draws.some(d=>d[1]==='rgb(162,176,221)'),'color blends during the turn');
}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const source=await readFile(new URL('../assets/js/dungeon-circle-draw.mjs',import.meta.url),'utf8');
assert.match(html,/id="circleDrawingPad"[^>]*width="420" height="420"/);
assert.match(html,/id="circleDrawingStage"[^>]*>呪文を1文字ずつ書く<\/strong>/);
assert.match(html,/class="circle-drawing-navigation"[\s\S]*?id="circleDrawingUndo"[\s\S]*?id="circleDrawingRedo"/);
assert.match(html,/class="circle-drawing-actions"[\s\S]*?id="circleDrawingClose"[\s\S]*?id="circleDrawingReset"[\s\S]*?id="circleDrawingConfirm"/);
assert.match(html,/id="circleDrawingConfirm"[^>]*>紋を描く<\/button>/);
assert.doesNotMatch(html,/id="circleDrawingInput"/);
assert.doesNotMatch(source,/get\('circleDrawingInput'\)/);
assert.match(css,/\.circle-drawing-navigation\{\s*position:absolute;top:50%/,'arrows belong at the middle of the lower half');
assert.match(css,/\.circle-drawing-entry\{\s*position:relative/);
assert.doesNotMatch(css,/circle-drawing-to-sigil/,'upper preview no longer animates');
assert.match(source,/export const EDITOR_GLYPH_STEP=GLYPH_STEP;/);
assert.match(source,/ringPoint\(RING_RADIUS,\(i\/96-\.5\)\*GLYPH_STEP\)/,'crosshair follows the actual upper-ring arc');
assert.match(source,/paintCircle\(preview,model\.state,\{activeStroke,size:512\}\)/,'upper preview stays fixed while lower pad spins');
assert.match(source,/glyphPoint\(p,i,count,exportImage\?null:viewIndex\)/,'upper preview and export center the complete spell');
assert.match(source,/animateMode\('sigil'/);
assert.match(source,/animateMode\('spell'/);
assert.match(source,/glyphInputPoint\(padPoint\)/);
assert.match(source,/sigilInputPoint\(padPoint\)/);
assert.match(source,/project\(glyphPoint\(p,i,count\)\)/,'both screens use the same centered ink projection');
assert.match(source,/const SIGIL_VIEW_RADIUS=INNER_RADIUS\/GUIDE_RADIUS;/,'original sigil crop retained');
assert.doesNotMatch(source,/layer\(1-t|layer\(t,0/,'no composited render layers');
assert.match(css,/\.circle-drawing-pad-zone\{[^}]*container-type:size/);
assert.match(css,/width:min\(100cqw,100cqh\);height:min\(100cqw,100cqh\)/);
assert.match(source,/viewIndex=startIndex\+\(target-startIndex\)\*eased/);
assert.match(html,/id="circleDrawingDiscard"[^>]*role="alertdialog"/,'discard confirmation retained');

let doc;
const nodes=new Map();
function element(id){
 const listeners=new Map();
 const e={
  id,hidden:id==='circleDrawingDiscard',open:false,inert:false,disabled:false,textContent:'',width:0,height:0,
  addEventListener(name,fn){listeners.set(name,fn);},
  dispatch(name,arg={}){return listeners.get(name)?.(arg);},
  setAttribute(name,value){this[name]=value;},
  focus(){doc.activeElement=this;},
  getBoundingClientRect(){return {left:0,top:0,width:0,height:0};},
  getContext(){return ctx;},
  showModal(){this.open=true;},close(){this.open=false;this.dispatch('close');}
 };
 nodes.set(id,e);return e;
}
for(const id of [
 'circleDrawingDialog','circleDrawingShell','circleDrawingPreview','circleDrawingCaret','circleDrawingPad',
 'circleDrawingConfirm','circleDrawingStatus','circleDrawingStage','circleDrawingUndo','circleDrawingRedo',
 'circleDrawingReset','circleDrawingClose','circleDrawingDiscard','circleDrawingDiscardKeep','circleDrawingDiscardConfirm'
])element(id);
doc={activeElement:element('priorFocus'),getElementById:id=>{
 assert.ok(nodes.has(id),'expected control '+id);return nodes.get(id);
},createElement:tag=>{
 assert.equal(tag,'canvas');
 return {width:0,height:0,getContext(){return ctx;},toBlob(cb,type){cb(new Blob(['ritual'],{type}));}};
}};
const saved=[];
const previousWindow=globalThis.window;
globalThis.window={devicePixelRatio:1,addEventListener(){}};
try{
 const get=id=>nodes.get(id),dialog=get('circleDrawingDialog');
 const editor=initCircleDrawing(doc,{onSave:async image=>saved.push(image)});
 editor.open();
 assert.equal(get('circleDrawingClose').textContent,'閉じる');
 assert.equal(get('circleDrawingConfirm').textContent,'紋を描く');
 assert.equal(get('circleDrawingUndo').disabled,true);
 get('circleDrawingClose').dispatch('click');
 assert.equal(dialog.open,false,'empty draft closes directly');
 editor.open();
 get('circleDrawingRedo').dispatch('click');
 get('circleDrawingClose').focus();
 get('circleDrawingClose').dispatch('click');
 assert.equal(get('circleDrawingDiscard').hidden,false,'nonempty text requires discard confirmation');
 assert.equal(get('circleDrawingShell').inert,true);
 get('circleDrawingDiscardKeep').dispatch('click');
 assert.equal(get('circleDrawingDiscard').hidden,true);
 assert.equal(doc.activeElement,get('circleDrawingClose'));
 get('circleDrawingClose').dispatch('click');
 get('circleDrawingDiscardConfirm').dispatch('click');
 assert.equal(dialog.open,false);
 assert.equal(doc.activeElement,get('priorFocus'));
 editor.open();
 const pad=get('circleDrawingPad');
 pad.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200});
 const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',preventDefault(){}});
 pad.dispatch('pointerdown',pointer(1,40,45));
 pad.dispatch('pointermove',pointer(1,90,95));
 pad.dispatch('pointerup',pointer(1,90,95));
 // Exercise a real 250ms frame sequence, including disabled buttons during transition.
 const frames=[];
 globalThis.window.requestAnimationFrame=cb=>frames.push(cb);
 get('circleDrawingRedo').dispatch('click');
 assert.equal(get('circleDrawingRedo').disabled,true);
 assert.equal(frames.length,1);
 frames.shift()(0);frames.shift()(125);
 assert.equal(get('circleDrawingRedo').disabled,true);
 frames.shift()(250);
 assert.equal(get('circleDrawingRedo').disabled,false);
 delete globalThis.window.requestAnimationFrame;
 get('circleDrawingUndo').dispatch('click');
 assert.equal(get('circleDrawingRedo').disabled,false);
 globalThis.window.requestAnimationFrame=cb=>frames.push(cb);
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く','stage changes only when lower zoom/move finishes');
 assert.equal(get('circleDrawingConfirm').disabled,true);
 assert.equal(frames.length,1);
 frames.shift()(0);frames.shift()(160);frames.shift()(320);
 assert.equal(get('circleDrawingStage').textContent,'紋を書く');
 assert.equal(get('circleDrawingConfirm').textContent,'決定');
 assert.equal(get('circleDrawingClose').textContent,'戻る');
 get('circleDrawingClose').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く','reverse transform keeps sigil until complete');
 frames.shift()(0);frames.shift()(160);frames.shift()(320);
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く');
 delete globalThis.window.requestAnimationFrame;
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く');
 pad.dispatch('pointerdown',pointer(2,60,60));
 pad.dispatch('pointermove',pointer(2,120,130));
 pad.dispatch('pointerup',pointer(2,120,130));
 assert.equal(get('circleDrawingUndo').disabled,false);
 get('circleDrawingUndo').dispatch('click');
 assert.equal(get('circleDrawingRedo').disabled,false);
 get('circleDrawingRedo').dispatch('click');
 get('circleDrawingConfirm').dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(dialog.open,false);
 assert.equal(saved.length,1);
 assert.equal(saved[0].type,'image/jpeg');
 editor.resume();
 assert.equal(get('circleDrawingStage').textContent,'紋を書く','analysis cancellation retains the sigil screen');
 get('circleDrawingConfirm').dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saved.length,2);
 editor.open();
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く');
 assert.equal(get('circleDrawingUndo').disabled,true);
 dialog.close();
}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
console.log('PASS centered spell, exact world projections, original sigil crop, one rotating camera and left-edge caret');
