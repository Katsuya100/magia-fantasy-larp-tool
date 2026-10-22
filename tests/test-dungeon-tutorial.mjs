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
assert.deepEqual(CIRCLE_TUTORIAL_STEPS.map(x=>x.image),['tutorial-prepare.webp','tutorial-outer.webp','tutorial-inner.webp','tutorial-complete.webp','tutorial-complete.webp']);
assert.match(CIRCLE_TUTORIAL_STEPS[3].detail,/相.*意味.*決まります。/);
assert.match(CIRCLE_TUTORIAL_STEPS[3].attributes,/炎.*雷.*水.*風.*重力.*秩序.*混沌/);
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
 assert.equal($('tutorialFigure').hidden,false);
 assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[0].hint);
 assert.equal($('tutorialDetails').textContent,CIRCLE_TUTORIAL_STEPS[0].detail);
 assert.ok($('tutorialAnimation').src.includes('tutorial-prepare.webp'));
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
 assert.equal($('tutorialFigure').hidden,false);
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
assert.match(html,/id="tutorialAttributes" hidden/);
const release=html.match(/data-release="(\d{8}\.\d+)"/)?.[1];
assert.ok(release,'tutorial HTML contains a release version');
assert.ok(html.includes('dungeon-app.mjs?v='+release),'tutorial HTML loads the current app');
assert.match(script,/preview\.src='assets\/images\/'/);
assert.doesNotMatch(html,/id="tutorialCanvas"|id="tutorialPad"/);
assert.doesNotMatch(script,/pointerdown|pointermove|setPointerCapture/);
const expectedImageHashes={
 'tutorial-prepare.webp':'7f94c9231f45766eff4eff895ca3003d3150f0ac89424577c311fbaf01383b51',
 'tutorial-outer.webp':'dda569913e61c21c6e24f1562cd88c188aa18a719d0de06b3e466e75b5be8a68',
 'tutorial-inner.webp':'c1253a99bb8eed7e41921cd94eae2f48ae45b63d156ebf249264fc95601bf631',
 'tutorial-complete.webp':'59aa8ede91add8b12927d67f392dde6437d0cb240fdb145a3e70a7333525b3c3'
};
for(const [name,hash] of Object.entries(expectedImageHashes)){
 const b=await readFile(new URL('../assets/images/'+name,import.meta.url));
 assert.equal(b.subarray(0,4).toString('ascii'),'RIFF',name);
 assert.equal(b.subarray(8,12).toString('ascii'),'WEBP',name);
 assert.equal(b.subarray(12,16).toString('ascii'),'VP8 ',name);
 assert.equal(b.readUInt16LE(26)&0x3fff,320,name+' width');
 assert.equal(b.readUInt16LE(28)&0x3fff,320,name+' height');
 assert.equal(createHash('sha256').update(b).digest('hex'),hash,name+' must match the supplied lightweight art');
 assert.ok(b.length<10240,name+' must stay under 10 KiB');
}
assert.doesNotMatch(script,/\.gif/);
console.log('PASS five tutorial pages, four supplied WebP examples and navigation');
