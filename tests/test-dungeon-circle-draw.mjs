import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,MIN_DUNGEON_POWER,withDrawnPowerFloor,drawnPower,pointOnPad,glyphPoint,glyphAngle,caretAngle,spellCamera,sigilCamera,padToCircle,circleToPad,interpolateCamera,GLYPH_PAD_SCALE,sigilPoint,normalizedGlyph,createDrawingModel,paintCircle,paintCaret,paintPad,initCircleDrawing} from '../assets/js/dungeon-circle-draw.mjs';

assert.equal(DRAWN_GLYPH_LIMIT,32);
assert.equal(DRAWN_POWER_RATE,.6);
assert.equal(MIN_DUNGEON_POWER,250);
assert.equal(drawnPower(500),300,'strong handwritten spells still use 60%');
assert.equal(drawnPower(200),250,'failed OCR cannot create magic below 250');
assert.equal(drawnPower(1),250,'even weak valid analysis respects the floor');
assert.equal(drawnPower(416),250,'rounded reduced power below the floor is clamped');
assert.equal(drawnPower(417),250,'boundary is included');
assert.equal(drawnPower(418),251,'scaling resumes beyond the floor');
assert.throws(()=>drawnPower(NaN));
assert.throws(()=>drawnPower(0));
assert.throws(()=>drawnPower(100,1.1));
const oldDrawn={id:'older',origin:'drawn',analysis:{attribute:'aqua',role:'attack',power:120}};
const corrected=withDrawnPowerFloor(oldDrawn);
assert.equal(corrected.basePower,250,'old unupgraded drawing is corrected on read');
assert.equal(corrected.analysis.power,250);
assert.equal(oldDrawn.analysis.power,120,'historical stored content is not mutated');
assert.equal(withDrawnPowerFloor(corrected),corrected,'normalization is idempotent');
assert.equal(withDrawnPowerFloor({...oldDrawn,creationInk:true}).analysis.power,275,'old ink-assisted drawing retains ink advantage');
const upgraded=withDrawnPowerFloor({...oldDrawn,basePower:120,upgradeLevel:3,analysis:{...oldDrawn.analysis,power:156}});
assert.equal(upgraded.basePower,250);
assert.equal(upgraded.analysis.power,325,'old stone investment retains three 10% upgrades');
assert.equal(upgraded.upgradeLevel,3);
assert.equal(withDrawnPowerFloor({...oldDrawn,origin:'photo'}).analysis.power,120,'historical photographed spells remain unchanged');
const unknownOldDrawn={...oldDrawn,analysis:null};
assert.equal(withDrawnPowerFloor(unknownOldDrawn),unknownOldDrawn,'unanalyzed records are untouched');
assert.equal(withDrawnPowerFloor({...oldDrawn,analysis:{...oldDrawn.analysis,power:400}}).analysis.power,400);
const pad={left:10,top:20,width:200,height:300};
assert.deepEqual(pointOnPad(110,170,pad),{x:0,y:0});
assert.deepEqual(pointOnPad(10,70,pad),{x:-1,y:-1});
const inner=sigilPoint({x:.92,y:0});
assert.ok(Math.abs(inner.x-(.5+.255))<1e-9,'near-full-pad dashed guide maps exactly to the inner circle');
assert.ok(sigilPoint({x:1,y:0}).x>inner.x,'sigil points outside the guide remain unclipped');
const top=glyphPoint({x:0,y:0},0);
assert.ok(Math.abs(top.x-.5)<1e-9&&top.y<.2);
const centered=[0,1,2].map(i=>glyphPoint({x:0,y:0},i,3));
assert.ok(Math.abs(centered[1].x-.5)<1e-9,'three-character ritual is centered on the top');
assert.ok(Math.abs(centered[0].x+centered[2].x-1)<1e-9,'adjacent runes straddle the vertical axis symmetrically');
assert.ok(Math.abs(glyphAngle(1,3)+Math.PI/2)<1e-9);
assert.ok(Math.abs(caretAngle(0)+Math.PI/2)<1e-9);
assert.ok(caretAngle(3)>caretAngle(1),'caret advances by character slots');
assert.equal(GLYPH_PAD_SCALE,.105,'one pad unit spans enough of the true circle to cross rings and neighboring letters');
for(const count of [0,1,7,31]){
 const camera=spellCamera(count);
 for(const point of [{x:0,y:0},{x:-.7,y:.8},{x:1,y:-1}]){
  const world=padToCircle(point,camera),recovered=circleToPad(world,camera);
  assert.ok(Math.hypot(recovered.x-point.x,recovered.y-point.y)<1e-12,'camera roundtrips exact pen coordinates');
  const stored=glyphPoint(point,count,count+1);
  assert.ok(Math.hypot(stored.x-world.x,stored.y-world.y)<1e-12,'saved glyph uses exact scaled magic-circle geometry');
 }
}
assert.ok(Math.hypot(padToCircle({x:0,y:-1},spellCamera(0)).x-.5,padToCircle({x:0,y:-1},spellCamera(0)).y-.5)>.43,
 'pen can extend past the outer circle');
assert.ok(Math.hypot(padToCircle({x:0,y:1},spellCamera(0)).x-.5,padToCircle({x:0,y:1},spellCamera(0)).y-.5)<.255,
 'pen can extend beyond the inner circle');
assert.ok(Math.hypot(glyphPoint({x:0,y:0},0,1).x-glyphPoint({x:0,y:0},1,2).x,
 glyphPoint({x:0,y:0},0,1).y-glyphPoint({x:0,y:0},1,2).y)<GLYPH_PAD_SCALE,
 'neighboring text centers share overlapping touchpad regions');
const mid=interpolateCamera(spellCamera(3),sigilCamera(),.5);
assert.ok(mid.scale>GLYPH_PAD_SCALE&&mid.scale<sigilCamera().scale,'sigil transition smoothly zooms out');
assert.ok(Math.abs(mid.rotation)<Math.abs(spellCamera(3).rotation),'camera un-rotates toward the inner circle');

const glyph=normalizedGlyph([[{x:-.1,y:-.2},{x:.1,y:.2}]]);
assert.equal(glyph.length,1);
assert.ok(glyph[0][0].x<0&&glyph[0][1].y>0);

// A square drawn on the pad must stay square after being laid tangentially
// around the ring; the previous independent 0.029/0.048 scales stretched it.
const square=normalizedGlyph([[{x:-.6,y:-.6},{x:.6,y:-.6},{x:.6,y:.6},{x:-.6,y:.6}]])[0];
for(const [index,count] of [[0,1],[1,3],[7,16],[31,32]]){
 const corners=square.map(p=>glyphPoint(p,index,count));
 const edge=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 assert.ok(Math.abs(edge(corners[0],corners[1])-edge(corners[1],corners[2]))<1e-12,
  'spell glyph aspect ratio is preserved at ring slot '+index);
}
assert.deepEqual(pointOnPad(210,270,pad),{x:1,y:1},
 'even a rectangular pad uses the same coordinate scale on both axes');

const stroke=[{x:0,y:-.3},{x:.2,y:.2}];
const draft=createDrawingModel();
assert.equal(draft.addStroke(stroke),true);
assert.equal(draft.canUndo,false,'pen strokes do not enter character undo history');
assert.equal(draft.reset(),true,'reset clears uncommitted lines on the touchpad');
assert.equal(draft.state.ink.length,0);
assert.equal(draft.canUndo,false,'reset does not add a character undo');
assert.equal(draft.enterGlyph(),true,'empty pad plus Input inserts one space');
assert.equal(draft.state.letters[0].space,true);
assert.equal(draft.undo(),true,'a blank entry is still a committed character');
assert.equal(draft.state.letters.length,0);
assert.equal(draft.redo(),true);
assert.equal(draft.state.letters.length,1);
assert.equal(draft.goSigil(),false,'a space alone cannot be registered as a magic word');

const model=createDrawingModel();
assert.equal(model.goSigil(),false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.canUndo,false,'multiple strokes of one draft letter do not become undo steps');
assert.equal(model.enterGlyph(),true);
assert.equal(model.state.letters.length,1);
assert.equal(model.state.ink.length,0);
assert.deepEqual(model.state.letters[0].strokes,[stroke,stroke],'input preserves exact pen paths rather than shrinking into a slot');
assert.equal(model.canUndo,true);
assert.equal(model.enterGlyph(),true,'empty Input adds a word separator without separate button');
assert.equal(model.state.letters[1].space,true);
assert.equal(model.enterGlyph(),true,'repeated blank inputs are valid separate space slots');
assert.equal(model.state.letters[2].space,true);
assert.equal(model.undo(),true);
assert.equal(model.state.letters.length,2,'undo removes one committed character');
assert.equal(model.redo(),true);
assert.equal(model.state.letters.length,3);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.reset(),true);
assert.equal(model.state.letters.length,3,'reset keeps already committed letters/spaces');
assert.equal(model.state.ink.length,0);
assert.equal(model.canUndo,true);
assert.equal(model.goSigil(),true);
assert.equal(model.complete,false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.complete,true);
assert.equal(model.undo(),true,'sigil mode undoes one complete stroke');
assert.equal(model.complete,false);
assert.equal(model.redo(),true);
assert.equal(model.complete,true);
assert.equal(model.reset(),true,'sigil reset empties the current touchpad');
assert.equal(model.complete,false);
assert.equal(model.state.letters.length,3,'sigil reset keeps the spell');
assert.equal(model.undo(),true,'sigil reset can be undone as a single step');
assert.equal(model.complete,true);
model.goSpell();
assert.equal(model.state.letters.length,3,'returning to text retains finalized letters');
assert.equal(model.reset(),false,'nothing on the pad means nothing to reset');
const full=createDrawingModel();
for(let i=0;i<DRAWN_GLYPH_LIMIT;i++){
 full.addStroke(stroke);
 assert.equal(full.enterGlyph(),true);
}
assert.equal(full.state.letters.length,DRAWN_GLYPH_LIMIT);
assert.equal(full.enterGlyph(),false);
assert.equal(full.goSigil(),true);

const drawings=[];
const ctx={
 clearRect(){},fillRect(){drawings.push({kind:'fill',color:this.fillStyle});},
 beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},
 stroke(){drawings.push({kind:'stroke',width:this.lineWidth,color:this.strokeStyle});},
 fill(){},createRadialGradient(){return {addColorStop(){}};}
};
const fakeCanvas={width:0,height:0,getContext(){return ctx;}};
const circle={mode:'spell',letters:[{strokes:normalizedGlyph([stroke])}],ink:[],sigil:[]};
paintCircle(fakeCanvas,circle,{size:128});
assert.equal(fakeCanvas.width,128);
assert.ok(drawings.some(d=>d.kind==='fill'&&d.color==='#f2e4c6'),'preview is warm parchment rather than plain white');
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.0055),'outer ring is slightly bolder');
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.0095),'inner ring is slightly bolder');
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.0072),'glyph ink is slightly bolder');
const previewStrokes=drawings.filter(d=>d.kind==='stroke').length;
drawings.length=0;
paintCircle(fakeCanvas,circle,{size:128,exportImage:true});
assert.equal(previewStrokes,drawings.filter(d=>d.kind==='stroke').length,'preview and export share identical parchment artwork without a static caret');
assert.ok(drawings.some(d=>d.kind==='fill'&&d.color==='#f2e4c6'),'export has the same parchment finish');
drawings.length=0;paintCaret(fakeCanvas,circle,{size:128});
assert.equal(drawings.filter(d=>d.kind==='stroke').length,1,'caret has an independent transparent canvas layer');
assert.equal(drawings.filter(d=>d.kind==='fill').length,0,'caret never repaints a parchment background');
drawings.length=0;paintCaret(fakeCanvas,{...circle,mode:'sigil'},{size:128});
assert.equal(drawings.length,0,'caret layer is blank while writing the sigil');
const sigil={mode:'sigil',letters:circle.letters,ink:[],sigil:[stroke]};
drawings.length=0;paintCircle(fakeCanvas,sigil,{size:128,exportImage:true});
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.0096),'sigil ink is slightly bolder in the final image');

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const source=await readFile(new URL('../assets/js/dungeon-circle-draw.mjs',import.meta.url),'utf8');
assert.match(html,/id="circleDrawingPad"[^>]*width="420" height="420"/,'pad is a square canvas');
assert.match(html,/<strong id="circleDrawingStage" class="circle-drawing-stage"[^>]*>呪文を1文字ずつ書く<\/strong>/,'stage label is a floating centered element');
assert.match(html,/id="circleDrawingPreview"[\s\S]*?id="circleDrawingCaret" width="512" height="512" aria-hidden="true"/,'caret has a distinct transparent overlay canvas');
assert.match(css,/\.circle-drawing-display\{[^}]*background:#070914/,'parchment does not fill the preview surroundings');
assert.match(css,/\.circle-drawing-entry\{[^}]*background:#070914/,'top and bottom surroundings use the same dark background');
assert.match(css,/\.circle-drawing-stage\{[^}]*left:50%;top:50%;transform:translate\(-50%,-50%\)/,'stage label stays centered');
assert.match(css,/\.circle-drawing-header\{\s*position:absolute;left:0;right:0;top:50%;z-index:3;/,
 'close/back and confirm sit at the middle left/right sides instead of using an upper header row');
assert.match(css,/#circleDrawingDialog \.circle-drawing-actions button\{flex:none;min-height:34px;padding:4px 10px;font-size:12px\}/,
 'input and reset have compact controls to free touchpad height');
assert.match(css,/\.circle-drawing-preview-art\{[^}]*calc\(\(94dvh - 88px\)\/2\)/,
 'removing the header increases available drawing area');
assert.doesNotMatch(html,/id="circleDrawingBack"|呪文へ戻る/,'no redundant spell back action');
assert.match(html,/id="circleDrawingReset"[^>]*>クリア<\/button>/,'pad action is now labeled クリア');
assert.doesNotMatch(source,/circleDrawingBack/,'script has no reference to the removed return button');
assert.match(css,/#circleDrawingCaret\{[^}]*animation:circle-drawing-caret-blink 1s steps\(1,end\) infinite/,'only the caret blinks');
assert.match(source,/sigil\?'紋を書く':'呪文を1文字ずつ書く'/,'both steps use the requested writing labels');
assert.match(source,/paintCaret\(get\('circleDrawingCaret'\),model\.state/,'redraw follows the active character');
assert.match(source,/animateCamera\('revolver',fromCount,fromCount\+1,420\)/,'Input advances with animated reel');
assert.match(source,/animateCamera\('sigil',fromCount,0,720\)/,'Decision rotates and zooms the camera to sigil');
assert.match(source,/window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)/,'accessibility setting skips camera motion');
assert.doesNotMatch(html,/id="circleDrawingSpace"|id="circleDrawingHint"|id="circleDrawingCount"/,'no extra space, help or count labels');
assert.match(css,/\.circle-drawing-pad-zone\{[^}]*container-type:size/);
assert.match(css,/width:min\(100cqw,100cqh\);height:min\(100cqw,100cqh\)/,'pad remains square even on short viewports');
assert.match(source,/ctx\.moveTo\(w\/2,0\);ctx\.lineTo\(w\/2,h\);ctx\.moveTo\(0,h\/2\);ctx\.lineTo\(w,h\/2\)/,'subtle dotted crosshair is drawn');
assert.doesNotMatch(source,/circleDrawingSpace|window\.confirm\('呪文を最初から描き直しますか/,'no space button or reset confirmation');

assert.match(html,/id="circleDrawingShell" class="circle-drawing-shell"/);
assert.match(html,/id="circleDrawingDiscard"[^>]*role="alertdialog" aria-modal="true"/,'discard uses an accessible in-app confirmation');
assert.match(html,/<strong id="circleDrawingDiscardTitle">魔法陣を破棄しますか？<\/strong>/);
assert.match(html,/id="circleDrawingDiscardKeep"[^>]*>戻る<\/button>/);
assert.match(html,/id="circleDrawingDiscardConfirm"[^>]*>破棄<\/button>/);
assert.match(css,/\.circle-drawing-discard\[hidden\]\{display:none\}/,'hidden confirmation never overlays the editor');
assert.doesNotMatch(source,/window\.confirm/,'system confirmation must never appear in drawing flow');

// Headless UI interaction: close, keep, Esc, destroy, and focus must be safe.
const fakeContext={
 clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},
 stroke(){},fill(){},save(){},restore(){},setLineDash(){},
 createRadialGradient(){return {addColorStop(){}};}
};
const nodes=new Map();
let fakeDoc;
function element(id){
 const listeners=new Map();
 const e={id,hidden:id==='circleDrawingDiscard',inert:false,open:false,width:0,height:0,
  textContent:'',disabled:false,
  addEventListener(name,fn){listeners.set(name,fn);},
  dispatch(name,arg={}){return listeners.get(name)?.(arg);},
  focus(){fakeDoc.activeElement=this;},
  getBoundingClientRect(){return {width:0,height:0,left:0,top:0};},
  getContext(){return fakeContext;},
  querySelector(sel){assert.equal(sel,'.circle-drawing-shell');return nodes.get('circleDrawingShell');},
  showModal(){this.open=true;},close(){this.open=false;this.dispatch('close');}
 };
 nodes.set(id,e);return e;
}
for(const id of ['circleDrawingDialog','circleDrawingShell','circleDrawingPreview','circleDrawingCaret',
 'circleDrawingPad','circleDrawingConfirm','circleDrawingStatus','circleDrawingStage',
 'circleDrawingInput','circleDrawingUndo','circleDrawingRedo',
 'circleDrawingReset','circleDrawingClose','circleDrawingDiscard','circleDrawingDiscardKeep',
 'circleDrawingDiscardConfirm'])element(id);
fakeDoc={activeElement:element('priorFocus'),getElementById:id=>{
 assert.ok(nodes.has(id),'editor element exists: '+id);return nodes.get(id);
},createElement:tag=>{
 assert.equal(tag,'canvas');
 return {width:0,height:0,getContext:()=>fakeContext,toBlob(cb,type){cb(new Blob(['ritual'],{type}));}};
}};
const oldWindow=globalThis.window;
globalThis.window={devicePixelRatio:1,addEventListener(){}};
try{
 let savedDrafts=0;
 const editor=initCircleDrawing(fakeDoc,{onSave:async image=>{assert.equal(image.type,'image/jpeg');savedDrafts++;}});
 const get=id=>nodes.get(id),dialog=get('circleDrawingDialog'),discard=get('circleDrawingDiscard');
 const shell=get('circleDrawingShell'),keep=get('circleDrawingDiscardKeep');
 editor.open();
 assert.equal(get('circleDrawingClose').textContent,'閉じる','spell mode shows close');
 get('circleDrawingClose').dispatch('click');
 assert.equal(dialog.open,false,'an empty editor closes without confirmation');
 editor.open();
 get('circleDrawingInput').dispatch('click'); // A blank entry is still unsaved.
 get('circleDrawingClose').focus(); // Simulate a keyboard click; DOM stubs do not move focus on dispatch.
 get('circleDrawingClose').dispatch('click');
 assert.equal(dialog.open,true);
 assert.equal(discard.hidden,false,'edited circles must open the in-game confirmation');
 assert.equal(shell.inert,true,'background drawing controls are blocked while confirming');
 assert.equal(fakeDoc.activeElement,keep,'safe option receives initial focus');
 keep.dispatch('click');
 assert.equal(discard.hidden,true);
 assert.equal(shell.inert,false);
 assert.equal(fakeDoc.activeElement,get('circleDrawingClose'),'keep returns focus to close button');
 get('circleDrawingClose').dispatch('click');
 let prevented=false;
 dialog.dispatch('cancel',{preventDefault(){prevented=true;}});
 assert.ok(prevented,'Esc is intercepted');
 assert.equal(dialog.open,true);
 assert.equal(discard.hidden,true,'Esc dismisses the discard prompt but keeps the drawing');
 dialog.dispatch('cancel',{preventDefault(){}});
 assert.equal(discard.hidden,false,'Esc at the editor layer asks before discarding');
 get('circleDrawingDiscardConfirm').dispatch('click');
 assert.equal(dialog.open,false,'only the explicit discard option destroys the draft');
 assert.equal(shell.inert,false,'the editor is restored after discarding');
 assert.equal(fakeDoc.activeElement,get('priorFocus'),'focus returns to the launch point');
 editor.open();
 assert.equal(discard.hidden,true,'discard prompt never leaks into the next session');
 // Follow the complete spell -> sigil -> export -> cancelled analysis path.
 // The real game closes the editor for analysis, then calls resume() on cancel.
 const drawingPad=get('circleDrawingPad');
 drawingPad.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200});
 const inkEvent=(pointerId,x,y)=>({pointerId,clientX:x,clientY:y,pointerType:'touch',preventDefault(){}});
 drawingPad.dispatch('pointerdown',inkEvent(1,40,45));
 drawingPad.dispatch('pointermove',inkEvent(1,90,95));
 drawingPad.dispatch('pointerup',inkEvent(1,90,95));
 get('circleDrawingInput').dispatch('click');
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く','editor advances to sigil');
 assert.equal(get('circleDrawingClose').textContent,'戻る','sigil mode replaces close label with back');
 get('circleDrawingClose').dispatch('click');
 assert.equal(dialog.open,true,'sigil back stays inside editor');
 assert.equal(discard.hidden,true,'sigil back does not ask to discard');
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く','sigil back returns to spell stage');
 assert.equal(get('circleDrawingClose').textContent,'閉じる','spell mode restores close label');
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く','the original spell can advance to sigil again');
 drawingPad.dispatch('pointerdown',inkEvent(2,60,60));
 drawingPad.dispatch('pointermove',inkEvent(2,120,130));
 drawingPad.dispatch('pointerup',inkEvent(2,120,130));
 assert.equal(get('circleDrawingUndo').disabled,false,'sigil stroke has undo history');
 get('circleDrawingConfirm').dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(dialog.open,false,'editor closes to analyze the completed drawing');
 assert.equal(savedDrafts,1,'export reaches analysis callback');
 editor.resume();
 assert.equal(dialog.open,true,'cancelling analysis reopens the drawing interface');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く','sigil editing stage is preserved');
 assert.equal(get('circleDrawingClose').textContent,'戻る','cancelled analysis restores contextual back control');
 assert.equal(get('circleDrawingUndo').disabled,false,'undo history is preserved on return');
 assert.equal(get('circleDrawingConfirm').disabled,false,'drawing can be edited and submitted again');
 get('circleDrawingUndo').dispatch('click');
 assert.equal(get('circleDrawingRedo').disabled,false,'undo works after cancelled analysis');
 get('circleDrawingRedo').dispatch('click');
 assert.equal(get('circleDrawingUndo').disabled,false,'redo restores the last sigil stroke');
 get('circleDrawingConfirm').dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(savedDrafts,2,'restored draft can be submitted again');
 editor.open();
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く','a truly new drawing still starts empty');
 assert.equal(get('circleDrawingUndo').disabled,true,'fresh editor does not inherit old history');
 dialog.close();

 const padColors=[];
 const padCtx={...fakeContext,stroke(){padColors.push(this.strokeStyle);}};
 const canvasPad={width:0,height:0,getBoundingClientRect:()=>({width:240,height:240}),getContext:()=>padCtx};
 paintPad(canvasPad,{mode:'spell',letters:[{strokes:[stroke]},{strokes:[stroke]}],ink:[],sigil:[]});
 assert.ok(padColors.some(c=>String(c).includes('244,197,127')),'outer ring is shown as a dotted guide');
 assert.ok(padColors.some(c=>String(c).includes('138,190,206')),'inner ring is shown as a dotted guide');
 assert.ok(padColors.includes('#77d5ff')&&padColors.includes('#dfb0fa'),'adjacent letters glow in alternating distinct colors');

 // Exercise actual requestAnimationFrame advancement without browser libraries.
 const frames=[];
 globalThis.window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 const step=time=>{const frame=frames.shift();assert.equal(typeof frame,'function');frame(time);};
 const animated=initCircleDrawing(fakeDoc,{onSave:async()=>{}});
 animated.open();
 drawingPad.dispatch('pointerdown',inkEvent(3,40,50));
 drawingPad.dispatch('pointermove',inkEvent(3,95,100));
 drawingPad.dispatch('pointerup',inkEvent(3,95,100));
 get('circleDrawingInput').dispatch('click');
 assert.equal(get('circleDrawingInput').disabled,true,'revolver blocks new input until the rotation finishes');
 assert.equal(get('circleDrawingConfirm').disabled,true,'cannot switch mode in the middle of a reel');
 step(1000);step(1210);
 assert.equal(get('circleDrawingInput').disabled,true,'Input remains disabled halfway through the animated advance');
 step(1421);
 assert.equal(get('circleDrawingInput').disabled,false,'Input is restored after the revolver settles');
 get('circleDrawingConfirm').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'紋を書く');
 assert.equal(get('circleDrawingConfirm').disabled,true,'sigil zoom blocks premature registration');
 step(2000);step(2360);step(2721);
 assert.equal(get('circleDrawingConfirm').disabled,false,'sigil edit is enabled after the rotate/zoom settles');
 get('circleDrawingClose').dispatch('click');
 assert.equal(get('circleDrawingStage').textContent,'呪文を1文字ずつ書く','Back begins returning to the spell camera');
 step(3000);step(3290);step(3581);
 assert.equal(get('circleDrawingInput').disabled,false,'reversed zoom settles at the next spell entry');
 dialog.close();
}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}

console.log('PASS ritual blank Input, pad-only reset, character undo, centered caret, thick ink and parchment');
