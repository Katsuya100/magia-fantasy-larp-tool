import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,MIN_DUNGEON_POWER,GLYPH_INK_SCALE,REVOLVER_DURATION_MS,
 drawnPower,withDrawnPowerFloor,pointOnPad,glyphPoint,glyphAngle,sigilPoint,
 createDrawingModel,paintCircle,paintCaret,paintPad,initCircleDrawing
} from '../assets/js/dungeon-circle-draw.mjs';

assert.equal(DRAWN_GLYPH_LIMIT,32);
assert.equal(DRAWN_POWER_RATE,.6);
assert.equal(GLYPH_INK_SCALE,.09,'the pad can reach both rings and neighboring slots');
assert.equal(REVOLVER_DURATION_MS,250);
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
for(const [i,count] of [[0,1],[1,3],[7,16],[31,32]]){
 const square=[{x:-.6,y:-.6},{x:.6,y:-.6},{x:.6,y:.6}].map(p=>glyphPoint(p,i,count));
 const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 assert.ok(Math.abs(d(square[0],square[1])-d(square[1],square[2]))<1e-12,'glyph aspect ratio remains square');
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
 beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},save(){},restore(){},setLineDash(){},
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
draws.length=0;
paintCircle(canvas,{...state,mode:'sigil',ink:[]},{size:128,exportImage:true});
assert.ok(draws.some(d=>d[0]==='stroke'&&d[2]===128*.0072),'export includes both finished letters');
draws.length=0;paintCaret(canvas,state,{size:128,viewIndex:0});
assert.equal(draws.filter(d=>d[0]==='stroke').length,1);
draws.length=0;paintCaret(canvas,{...state,mode:'sigil'},{size:128});
assert.equal(draws.length,0);
const originalWindow=globalThis.window;
globalThis.window={devicePixelRatio:1,addEventListener(){}};
try{
 draws.length=0;paintPad(canvas,state,[],0);
 assert.ok(draws.some(d=>d[1]==='#866e9c')&&draws.some(d=>d[1]==='#a48968'),'outer/inner scaled ring guides are visible');
 assert.ok(draws.some(d=>d[1]==='rgb(210,183,255)'),'active text uses the highlight ink');
 assert.ok(draws.some(d=>d[1]==='rgb(113,169,186)'),'adjacent text uses a different ink');
 draws.length=0;paintPad(canvas,state,[],.5);
 assert.ok(draws.some(d=>d[1]==='rgb(162,176,221)'),'color blends during the turn');
}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const source=await readFile(new URL('../assets/js/dungeon-circle-draw.mjs',import.meta.url),'utf8');
assert.match(html,/id="circleDrawingPad"[^>]*width="420" height="420"/);
assert.match(html,/id="circleDrawingStage"[^>]*>呪文<\/strong>/);
assert.match(html,/class="circle-drawing-navigation"[\s\S]*?id="circleDrawingUndo"[\s\S]*?id="circleDrawingRedo"/);
assert.match(html,/class="circle-drawing-actions"[\s\S]*?id="circleDrawingClose"[\s\S]*?id="circleDrawingReset"[\s\S]*?id="circleDrawingConfirm"/);
assert.match(html,/id="circleDrawingConfirm"[^>]*>紋を描く<\/button>/);
assert.doesNotMatch(html,/id="circleDrawingInput"/);
assert.doesNotMatch(source,/get\('circleDrawingInput'\)/);
assert.match(css,/\.circle-drawing-shell\.is-to-sigil \.circle-drawing-preview-art\{\s*animation:circle-drawing-to-sigil \.25s/);
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
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋');
 assert.equal(get('circleDrawingConfirm').textContent,'決定');
 assert.equal(get('circleDrawingClose').textContent,'戻る');
 get('circleDrawingClose').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'呪文');
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋');
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
 assert.equal(get('circleDrawingStage').textContent,'紋','analysis cancellation retains the sigil screen');
 get('circleDrawingConfirm').dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(saved.length,2);
 editor.open();
 assert.equal(get('circleDrawingStage').textContent,'呪文');
 assert.equal(get('circleDrawingUndo').disabled,true);
 dialog.close();
}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
console.log('PASS 0.25s revolver, true ring-space glyphs, dual guides, adjacent ink and sigil controls');
