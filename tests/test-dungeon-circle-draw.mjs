import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,drawnPower,pointOnPad,glyphPoint,glyphAngle,caretAngle,sigilPoint,normalizedGlyph,createDrawingModel,paintCircle,paintCaret,initCircleDrawing} from '../assets/js/dungeon-circle-draw.mjs';

assert.equal(DRAWN_GLYPH_LIMIT,32);
assert.equal(DRAWN_POWER_RATE,.6);
assert.equal(drawnPower(500),300);
assert.equal(drawnPower(200),120,'weaker fallback magic remains scaled');
assert.equal(drawnPower(1),1);
assert.throws(()=>drawnPower(NaN));
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
const glyph=normalizedGlyph([[{x:-.1,y:-.2},{x:.1,y:.2}]]);
assert.equal(glyph.length,1);
assert.ok(glyph[0][0].x<0&&glyph[0][1].y>0);

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
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width>=128*.008),'inner circle line is more substantial');
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
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.008),'sigil ink is visibly thicker in the final image');

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const source=await readFile(new URL('../assets/js/dungeon-circle-draw.mjs',import.meta.url),'utf8');
assert.match(html,/id="circleDrawingPad"[^>]*width="420" height="420"/,'pad is a square canvas');
assert.match(html,/<strong id="circleDrawingStage" class="circle-drawing-stage"[^>]*>呪文を書く<\/strong>/,'stage label is a floating centered element');
assert.match(html,/id="circleDrawingPreview"[\s\S]*?id="circleDrawingCaret" width="512" height="512" aria-hidden="true"/,'caret has a distinct transparent overlay canvas');
assert.match(css,/\.circle-drawing-display\{[^}]*background:#070914/,'parchment does not fill the preview surroundings');
assert.match(css,/\.circle-drawing-entry\{[^}]*background:#070914/,'top and bottom surroundings use the same dark background');
assert.match(css,/\.circle-drawing-stage\{[^}]*left:50%;top:50%;transform:translate\(-50%,-50%\)/,'stage label is in the center of the screen');
assert.match(css,/#circleDrawingCaret\{[^}]*animation:circle-drawing-caret-blink 1s steps\(1,end\) infinite/,'only the caret blinks');
assert.match(source,/sigil\?'紋を書く':'呪文を書く'/,'both steps use the requested writing labels');
assert.match(source,/paintCaret\(get\('circleDrawingCaret'\),model\.state/,'redraw follows the active character');
assert.doesNotMatch(html,/id="circleDrawingSpace"|id="circleDrawingHint"|id="circleDrawingCount"/,'no extra space, help or count labels');
assert.match(css,/\.circle-drawing-pad-zone\{[^}]*container-type:size/);
assert.match(css,/width:min\(100cqw,100cqh\);height:min\(100cqw,100cqh\)/,'pad remains square even on short viewports');
assert.match(source,/ctx\.moveTo\(w\/2,0\);ctx\.lineTo\(w\/2,h\);ctx\.moveTo\(0,h\/2\);ctx\.lineTo\(w,h\/2\)/,'subtle dotted crosshair is drawn');
assert.doesNotMatch(source,/circleDrawingSpace|window\.confirm\('呪文を最初から描き直しますか/,'no space button or reset confirmation');

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
  querySelector(sel){assert.equal(sel,'.circle-drawing-shell');return nodes.get('drawingShell');},
  showModal(){this.open=true;},close(){this.open=false;this.dispatch('close');}
 };
 nodes.set(id,e);return e;
}
for(const id of ['circleDrawingDialog','drawingShell','circleDrawingPreview','circleDrawingCaret',
 'circleDrawingPad','circleDrawingConfirm','circleDrawingStatus','circleDrawingStage',
 'circleDrawingInput','circleDrawingBack','circleDrawingUndo','circleDrawingRedo',
 'circleDrawingReset','circleDrawingClose','circleDrawingDiscard','circleDrawingDiscardKeep',
 'circleDrawingDiscardConfirm'])element(id);
fakeDoc={activeElement:element('priorFocus'),getElementById:id=>{
 assert.ok(nodes.has(id),'editor element exists: '+id);return nodes.get(id);
}};
const oldWindow=globalThis.window;
globalThis.window={devicePixelRatio:1,addEventListener(){}};
try{
 const editor=initCircleDrawing(fakeDoc,{onSave:async()=>{}});
 const get=id=>nodes.get(id),dialog=get('circleDrawingDialog'),discard=get('circleDrawingDiscard');
 const shell=get('drawingShell'),keep=get('circleDrawingDiscardKeep');
 editor.open();
 get('circleDrawingClose').dispatch('click');
 assert.equal(dialog.open,false,'an empty editor closes without confirmation');
 editor.open();
 get('circleDrawingInput').dispatch('click'); // A blank entry is still unsaved.
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
 dialog.close();
}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}

console.log('PASS ritual blank Input, pad-only reset, character undo, centered caret, thick ink and parchment');
