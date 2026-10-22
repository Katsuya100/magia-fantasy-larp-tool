import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,drawnPower,pointOnPad,glyphPoint,glyphAngle,caretAngle,sigilPoint,normalizedGlyph,createDrawingModel,paintCircle} from '../assets/js/dungeon-circle-draw.mjs';

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
assert.equal(previewStrokes,drawings.filter(d=>d.kind==='stroke').length+1,'caret is not baked into registered spell art');
assert.ok(drawings.some(d=>d.kind==='fill'&&d.color==='#f2e4c6'),'export has the same parchment finish');
const sigil={mode:'sigil',letters:circle.letters,ink:[],sigil:[stroke]};
drawings.length=0;paintCircle(fakeCanvas,sigil,{size:128,exportImage:true});
assert.ok(drawings.some(d=>d.kind==='stroke'&&d.width===128*.008),'sigil ink is visibly thicker in the final image');

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const source=await readFile(new URL('../assets/js/dungeon-circle-draw.mjs',import.meta.url),'utf8');
assert.match(html,/id="circleDrawingPad"[^>]*width="420" height="420"/,'pad is a square canvas');
assert.doesNotMatch(html,/id="circleDrawingSpace"|id="circleDrawingHint"|id="circleDrawingCount"/,'no extra space, help or count labels');
assert.match(css,/\.circle-drawing-pad-zone\{[^}]*container-type:size/);
assert.match(css,/width:min\(100cqw,100cqh\);height:min\(100cqw,100cqh\)/,'pad remains square even on short viewports');
assert.match(source,/ctx\.moveTo\(w\/2,0\);ctx\.lineTo\(w\/2,h\);ctx\.moveTo\(0,h\/2\);ctx\.lineTo\(w,h\/2\)/,'subtle dotted crosshair is drawn');
assert.doesNotMatch(source,/circleDrawingSpace|window\.confirm\('呪文を最初から描き直しますか/,'no space button or reset confirmation');
console.log('PASS ritual blank Input, pad-only reset, character undo, centered caret, thick ink and parchment');
