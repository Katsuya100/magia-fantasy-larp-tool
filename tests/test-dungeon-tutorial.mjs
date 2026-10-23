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
assert.match(CIRCLE_TUTORIAL_STEPS[3].detail,/相.*意味.*決まります。/);
assert.match(CIRCLE_TUTORIAL_STEPS[3].attributes,/flame.*bolt.*aqua.*storm.*gravity.*law.*chaos/);
assert.match(CIRCLE_TUTORIAL_STEPS[4].detail,/紋の種別.*形.*決まります。/);
assert.match(CIRCLE_TUTORIAL_STEPS[4].attributes,/攻撃.*防御.*回復.*弱体/);
for(const i of [3,4])assert.match(CIRCLE_TUTORIAL_STEPS[i].freedom,/サンプルに合わせる必要はありません.*自由.*ください/);
for(const step of CIRCLE_TUTORIAL_STEPS){
 assert.match(step.title,/ましょう$/,step.title);
 assert.match(step.hint,/ください。$/,step.title+' hint');
 assert.match(step.detail,/ください。|決まります。/,step.title+' detail');
 if(step.attributes)assert.doesNotMatch(step.attributes,/。$/,step.title+' attributes must not end with a period');
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
 assert.equal($('tutorialAttributes').hidden,true);
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
  assert.equal($('tutorialAttributes').hidden,i<3);
  if(i>=3)assert.equal($('tutorialAttributes').textContent,CIRCLE_TUTORIAL_STEPS[i].attributes);
  assert.equal($('tutorialFreedom').hidden,i<3);
  if(i>=3)assert.equal($('tutorialFreedom').textContent,CIRCLE_TUTORIAL_STEPS[i].freedom);
 }
 assert.equal($('tutorialContinue').textContent,'撮影する📷','final lesson offers a direct camera action');
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
 const body=$('tutorialBody'),home=$('tutorialBodyHome'),slot=$('circleDrawingLessonSlot');
 assert.equal(body.parentNode,home,'the camera tutorial owns the original body');
 assert.equal(tutorial.openLesson('spell'),true);
 assert.equal($('circleDrawingLessonDialog').open,true);
 assert.equal(body.parentNode,slot,'the actual body moves into the single-step dialog');
 assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[3].title);
 assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[3].hint);
 assert.equal($('tutorialAttributes').textContent,CIRCLE_TUTORIAL_STEPS[3].attributes);
 assert.equal($('tutorialFreedom').textContent,CIRCLE_TUTORIAL_STEPS[3].freedom);
 assert.ok($('tutorialAnimation').src.includes('tutorial-spell.gif'));
 assert.equal(tutorial.openLesson('sigil'),false,'focused lesson cannot stack');
 $('circleDrawingLessonClose').fire('click');
 assert.equal($('circleDrawingLessonDialog').open,false);
 assert.equal(body.parentNode,home,'the shared body returns to the original walkthrough');
 assert.equal(tutorial.openLesson('sigil'),true);
 assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[4].title);
 assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[4].hint);
 assert.equal($('tutorialDetails').textContent,CIRCLE_TUTORIAL_STEPS[4].detail);
 assert.equal($('tutorialAttributes').textContent,CIRCLE_TUTORIAL_STEPS[4].attributes);
 assert.ok($('tutorialAnimation').src.includes('tutorial-sigil.gif'));
 $('circleDrawingLessonDialog').fire('cancel');
 assert.equal($('circleDrawingLessonDialog').open,false,'Escape closes a single-step lesson');
 assert.equal(body.parentNode,home);
 tutorial.open();
 assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[0].title,'five-step replay still starts from its first page');
 $('tutorialSkip').fire('click');
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[true,false,false,false]);
}finally{env.restore();}
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const script=await readFile(new URL('../assets/js/dungeon-tutorial.mjs',import.meta.url),'utf8');
assert.match(html,/id="tutorialFigure" class="tutorial-animation" hidden/);
assert.match(html,/id="tutorialAnimation" alt="" width="320" height="320"/);
assert.match(html,/id="tutorialReplay"/);
assert.match(html,/id="tutorialAttributes" hidden/);
const release=html.match(/data-release="(\d{8}\.\d+)"/)?.[1];
assert.ok(release,'tutorial HTML contains a release version');
assert.ok(html.includes('dungeon-app.mjs?v='+release),'tutorial HTML loads the current app');
assert.match(script,/preview\.src='assets\/images\/'/);
assert.doesNotMatch(html,/id="tutorialCanvas"|id="tutorialPad"/);
assert.doesNotMatch(script,/pointerdown|pointermove|setPointerCapture/);
// The four GIFs are the user's uploaded optimized animations in REVERSED order.
// The hashes match exact source bytes; each file retains its GIF animation and dimensions.
const uploadedOptimizedAnimations=[
 ['tutorial-outer.gif','a409d1dfd8e99907ec060473a833982efd65f6f2',24,409521,4300575],
 ['tutorial-inner.gif','1d3ccd3b736cda30c4b855e371a1446a5c76909c',24,344262,4600687],
 ['tutorial-spell.gif','4d90fe876b65e3a586b73e17265a4fc8fd64673a',13,326987,2790874],
 ['tutorial-sigil.gif','13a4c46ba06fce8def556d253d410faa2a2e4b02',28,470418,5847905]
];
for(const [name,blobSha,expectedFrames,expectedBytes,originalBytes] of uploadedOptimizedAnimations){
 const b=await readFile(new URL('../assets/images/'+name,import.meta.url));
 assert.equal(b.subarray(0,6).toString('ascii'),'GIF89a',name);
 assert.equal(b.readUInt16LE(6),820,name+' width');
 assert.equal(b.readUInt16LE(8),820,name+' height');
 assert.equal(b.length,expectedBytes,name+' exact compressed size');
 assert.ok(b.length<originalBytes,name+' smaller than the uploaded original');
 assert.equal(createHash('sha1').update('blob '+b.length).update(Buffer.from([0])).update(b).digest('hex'),blobSha,name+' matches the uploaded optimized GIF');
 let frames=0;
 for(let i=0;i<b.length-2;i++)if(b[i]===33&&b[i+1]===249&&b[i+2]===4)frames++;
 assert.equal(frames,expectedFrames,name+' preserves the animated frame count');
}
assert.doesNotMatch(script,/tutorial-[a-z]+[.]webp/);
console.log('PASS five tutorial pages, original optimized animated GIFs and navigation');
