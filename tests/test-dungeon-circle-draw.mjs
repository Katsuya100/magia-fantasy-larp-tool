import assert from 'node:assert/strict';
import {
 DRAWN_GLYPH_LIMIT,DRAWN_POWER_RATE,SIGIL_GUIDE_RADIUS,
 drawnPower,pointOnPad,glyphPoint,sigilPoint,normalizedGlyph,createDrawingModel,paintCircle
} from '../assets/js/dungeon-circle-draw.mjs';

assert.equal(DRAWN_GLYPH_LIMIT,32);
assert.equal(DRAWN_POWER_RATE,.6);
assert.ok(SIGIL_GUIDE_RADIUS>=.9,'sigil guide fills almost the entire pad');
assert.equal(drawnPower(500),300);
assert.equal(drawnPower(200),120,'failed analysis is reduced to 60% too');
assert.equal(drawnPower(1),1);
assert.throws(()=>drawnPower(NaN));
const pad={left:10,top:20,width:200,height:300};
assert.deepEqual(pointOnPad(110,170,pad),{x:0,y:0});
assert.deepEqual(pointOnPad(10,70,pad),{x:-1,y:-1});
assert.ok(sigilPoint({x:1,y:0}).x>.5+.255,'drawing outside the guide stays possible');

const atTop=glyphPoint({x:0,y:0},1,3);
const atLeft=glyphPoint({x:0,y:0},0,3);
const atRight=glyphPoint({x:0,y:0},2,3);
assert.ok(Math.abs(atTop.x-.5)<1e-9&&atTop.y<.2,'middle glyph is centered at twelve o clock');
assert.ok(atLeft.x<.5&&atRight.x>.5,'glyph group is centered around twelve o clock');
const stroke=[{x:0,y:-.3},{x:.2,y:.2}];
const glyph=normalizedGlyph([stroke]);
assert.equal(glyph.length,1);
assert.ok(glyph[0][0].x<0&&glyph[0][1].y>0);

const model=createDrawingModel();
assert.equal(model.goSigil(),false);
assert.equal(model.enterGlyph(),true,'pressing Input with no strokes inserts a blank slot');
assert.equal(model.state.letters[0].space,true);
assert.equal(model.goSigil(),false,'blank spaces alone cannot create a magic circle');
assert.equal(model.undo(),true);
assert.equal(model.state.letters.length,0);
assert.equal(model.canUndo,false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.canUndo,false,'individual spell pen strokes are not undo steps');
assert.equal(model.reset(),true);
assert.equal(model.state.ink.length,0,'reset only clears the touch pad');
assert.equal(model.reset(),false);
model.addStroke(stroke);
assert.equal(model.enterGlyph(),true);
assert.equal(model.state.letters.length,1);
assert.equal(model.state.ink.length,0);
model.addStroke(stroke);
assert.equal(model.undo(),true,'spell undo removes a committed character');
assert.equal(model.state.letters.length,0);
assert.equal(model.state.ink.length,1,'undo preserves current unfinished pen strokes');
assert.equal(model.redo(),true);
assert.equal(model.state.letters.length,1);
assert.equal(model.state.ink.length,1,'redo preserves current unfinished pen strokes');
assert.equal(model.reset(),true);
assert.equal(model.state.letters.length,1,'reset never removes committed letters');
assert.equal(model.enterGlyph(),true,'a blank pad represents a space');
assert.equal(model.enterGlyph(),true,'multiple blank spaces are supported');
assert.equal(model.state.letters.length,3);
assert.equal(model.state.letters[1].space,true);
assert.equal(model.undo(),true);
assert.equal(model.state.letters.length,2);
assert.equal(model.redo(),true);
assert.equal(model.state.letters.length,3);
assert.equal(model.goSigil(),true);
assert.equal(model.complete,false);
assert.equal(model.addStroke(stroke),true);
assert.equal(model.complete,true);
assert.equal(model.reset(),true);
assert.equal(model.complete,false);
assert.equal(model.state.letters.length,3,'sigil pad reset preserves spell');
assert.equal(model.undo(),true,'sigil reset can be undone');
assert.equal(model.complete,true);
assert.equal(model.redo(),true);
assert.equal(model.complete,false);
model.goSpell();
assert.equal(model.state.letters.length,3,'switching phases preserves the spell');
assert.equal(model.reset(),false,'no spell strokes to erase');
assert.equal(model.undo(),false,'reset does not delete committed letters');

const full=createDrawingModel();
for(let i=0;i<DRAWN_GLYPH_LIMIT;i++){
 full.addStroke(stroke);
 assert.equal(full.enterGlyph(),true);
}
assert.equal(full.state.letters.length,DRAWN_GLYPH_LIMIT);
assert.equal(full.enterGlyph(),false);
assert.equal(full.goSigil(),true);

// Canvas output uses deterministic parchment and heavier, brush-like black marks.
const marks=[],colors=[];
const ctx={
 clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){},
 save(){},restore(){},
 createRadialGradient(){return {addColorStop(position,color){colors.push(color);}};},
 stroke(){marks.push({color:this.strokeStyle,width:this.lineWidth});}
};
const canvas={width:0,height:0,getContext(){return ctx;}};
const renderState={mode:'sigil',letters:[{strokes:glyph}],ink:[],sigil:[stroke]};
paintCircle(canvas,renderState,{size:1024,exportImage:true});
assert.equal(canvas.width,1024);
assert.ok(colors.includes('#fbf1d9')&&colors.includes('#d9bc8b'),'export uses parchment colors');
assert.ok(marks.some(m=>m.width>=1024*.007&&m.color==='#201712'),'inner ring is deliberately thicker');
assert.ok(marks.some(m=>m.width>=1024*.0075&&m.color==='#513824'),'sigil brush is thicker');
assert.ok(marks.some(m=>m.color==='#18130f'),'letter and sigil have a near-black core');
assert.equal(marks.some(m=>m.color==='#9f412b'),false,'caret is not burned into JPEG');

marks.length=0;
paintCircle(canvas,{...renderState,mode:'spell',sigil:[]},{size:512});
assert.ok(marks.some(m=>m.color==='#9f412b'),'editing caret appears in the preview');
console.log('PASS finger magic circles: spaces, character undo, pad-only reset, centering, caret, guide, brush export and power');
