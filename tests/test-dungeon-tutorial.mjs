import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {CIRCLE_TUTORIAL_STEPS,initCircleTutorial} from '../assets/js/dungeon-tutorial.mjs';
assert.equal(CIRCLE_TUTORIAL_STEPS.length,5);
assert.deepEqual(CIRCLE_TUTORIAL_STEPS.map(x=>x.title),['準備しましょう','外円を書きましょう','内円を書きましょう','呪文を書きましょう','紋を書きましょう']);
assert.match(CIRCLE_TUTORIAL_STEPS[0].hint,/最初にお手元に紙とペンをご用意ください/);
assert.match(CIRCLE_TUTORIAL_STEPS[0].detail,/できれば太めの油性ペンをお使いください/);
assert.match(CIRCLE_TUTORIAL_STEPS[1].hint,/大きな円.*ください/);
assert.match(CIRCLE_TUTORIAL_STEPS[2].hint,/外円の内側.*ください/);
assert.match(CIRCLE_TUTORIAL_STEPS[3].hint,/内円と外円の間.*英語の呪文.*ください/);
assert.match(CIRCLE_TUTORIAL_STEPS[4].hint,/内円の中に紋.*ください/);
assert.deepEqual(CIRCLE_TUTORIAL_STEPS.map(x=>x.image),[null,'tutorial-outer.gif','tutorial-inner.gif','tutorial-spell.gif','tutorial-sigil.gif']);
assert.match(CIRCLE_TUTORIAL_STEPS[3].detail,/相.*炎.*雷.*水.*風.*重力.*秩序.*混沌/);
assert.match(CIRCLE_TUTORIAL_STEPS[4].detail,/紋の種別.*形.*攻撃.*防御.*回復.*弱体/);
for(const i of [3,4])assert.match(CIRCLE_TUTORIAL_STEPS[i].freedom,/サンプルに合わせる必要はありません.*自由.*ください/);
for(const step of CIRCLE_TUTORIAL_STEPS){
 assert.match(step.title,/ましょう$/,step.title);
 assert.match(step.hint,/ください。$/,step.title+' hint');
 assert.match(step.detail,/ください。|決まります：/,step.title+' detail');
}
const env=fakeDungeonBrowser();
try{
 const $=id=>env.document.getElementById(id),exits=[];
 const tutorial=initCircleTutorial(env.document,toCamera=>exits.push(toCamera));
 tutorial.open();
 assert.equal($('tutorialCounter').textContent,'1 / 5');
 assert.equal($('tutorialFigure').hidden,true);
 assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[0].hint);
 assert.equal($('tutorialDetails').textContent,CIRCLE_TUTORIAL_STEPS[0].detail);
 assert.equal($('tutorialPrevious').hidden,true);
 assert.equal($('tutorialFreedom').hidden,true);
 assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[0].title);
 assert.equal($('dungeonApp').attributes.inert,'');
 for(let i=1;i<5;i++){
  $('tutorialContinue').fire('click');
  assert.equal(tutorial.isOpen(),true);
  assert.equal($('tutorialCounter').textContent,(i+1)+' / 5');
  assert.equal($('tutorialFigure').hidden,false);
  assert.ok($('tutorialAnimation').src.includes(CIRCLE_TUTORIAL_STEPS[i].image));
  assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[i].title);
  assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[i].hint);
  assert.equal($('tutorialDetails').textContent,CIRCLE_TUTORIAL_STEPS[i].detail);
  assert.equal($('tutorialFreedom').hidden,i<3);
  if(i>=3)assert.equal($('tutorialFreedom').textContent,CIRCLE_TUTORIAL_STEPS[i].freedom);
 }
 assert.equal($('tutorialContinue').textContent,'魔導書へ');
 $('tutorialPrevious').fire('click');
 assert.equal($('tutorialCounter').textContent,'4 / 5');
 $('tutorialContinue').fire('click');
 $('tutorialContinue').fire('click');
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[true]);
 assert.equal(tutorial.isOpen(),false);
 assert.equal($('dungeonApp').attributes.inert,undefined);
 tutorial.open();
 assert.equal($('tutorialCounter').textContent,'1 / 5');
 assert.equal($('tutorialFigure').hidden,true);
 $('tutorialSkip').fire('click');
 await new Promise(r=>setImmediate(r));
 tutorial.open();
 $('tutorialOverlay').fire('keydown',{key:'Escape'});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[true,false,false]);
}finally{env.restore();}
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const script=await readFile(new URL('../assets/js/dungeon-tutorial.mjs',import.meta.url),'utf8');
assert.match(html,/id="tutorialFigure" class="tutorial-animation" hidden/);
assert.match(html,/id="tutorialAnimation" alt="" width="320" height="320"/);
assert.match(html,/id="tutorialReplay"/);
assert.match(html,/data-release="20261018\.37"/);
assert.match(script,/gif\.src='assets\/images\/'/);
assert.doesNotMatch(html,/id="tutorialCanvas"|id="tutorialPad"/);
assert.doesNotMatch(script,/pointerdown|pointermove|setPointerCapture/);
const expectedGifHashes={
 'tutorial-outer.gif':'1e71d4a08a97f48d001bcec3f07246db3a0f562715c5c1232b9b6e97a83698d6',
 'tutorial-inner.gif':'54537c9826ae035968633a2b1dcad0008f19a846735b5c1b17b0db8e4d08969f',
 'tutorial-spell.gif':'765cf80bb40a6db906d86ef5b0383a88d87618d8d7a45af5f17978fc84e990f5',
 'tutorial-sigil.gif':'0bab6edb58785ed21cfb73448ea363907eaebce164d5654069e22b6339b9685a'
};
for(const step of CIRCLE_TUTORIAL_STEPS.filter(x=>x.image)){
 const b=await readFile(new URL('../assets/images/'+step.image,import.meta.url));
 assert.equal(b.subarray(0,6).toString('ascii'),'GIF89a');
 assert.equal(b.readUInt16LE(6),640,step.image+' width');
 assert.equal(b.readUInt16LE(8),640,step.image+' height');
 assert.equal(createHash('sha256').update(b).digest('hex'),expectedGifHashes[step.image],step.image+' must be the supplied optimized animation');
 let frames=0;for(let i=0;i<b.length-2;i++)if(b[i]===33&&b[i+1]===249&&b[i+2]===4)frames++;
 assert.ok(frames>=2,step.image+' must animate');
}
console.log('PASS five polite tutorial pages, four GIFs and navigation');
