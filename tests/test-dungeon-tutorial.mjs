import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {CIRCLE_TUTORIAL_STEPS,initCircleTutorial} from '../assets/js/dungeon-tutorial.mjs';
assert.equal(CIRCLE_TUTORIAL_STEPS.length,4);
assert.deepEqual(CIRCLE_TUTORIAL_STEPS.map(x=>x.title),['外円を書く','内円を書く','呪文を書く','紋を書く']);
assert.match(CIRCLE_TUTORIAL_STEPS[0].hint,/大きな円/);
assert.match(CIRCLE_TUTORIAL_STEPS[1].hint,/外円の内側/);
assert.match(CIRCLE_TUTORIAL_STEPS[2].hint,/内円と外円の間.*英語の呪文/);
assert.match(CIRCLE_TUTORIAL_STEPS[3].hint,/内円の中に紋/);
assert.deepEqual(CIRCLE_TUTORIAL_STEPS.map(x=>x.image),['tutorial-outer.gif','tutorial-inner.gif','tutorial-spell.gif','tutorial-sigil.gif']);
assert.match(CIRCLE_TUTORIAL_STEPS[2].detail,/相.*炎.*雷.*水.*風.*重力.*秩序.*混沌/);
assert.match(CIRCLE_TUTORIAL_STEPS[3].detail,/紋の種別.*形.*攻撃.*防御.*回復.*弱体/);
for(const i of [2,3])assert.match(CIRCLE_TUTORIAL_STEPS[i].freedom,/サンプルどおりでなくてOK.*自由/);
const env=fakeDungeonBrowser();
try{
 const $=id=>env.document.getElementById(id),exits=[];
 const tutorial=initCircleTutorial(env.document,toCamera=>exits.push(toCamera));
 tutorial.open();
 assert.equal($('tutorialCounter').textContent,'1 / 4');
 assert.equal($('tutorialPrevious').hidden,true);
 assert.equal($('tutorialFreedom').hidden,true);
 assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[0].title);
 assert.equal($('dungeonApp').attributes.inert,'');
 for(let i=1;i<4;i++){
  $('tutorialContinue').fire('click');
  assert.equal(tutorial.isOpen(),true);
  assert.equal($('tutorialCounter').textContent,(i+1)+' / 4');
  assert.ok($('tutorialAnimation').src.includes(CIRCLE_TUTORIAL_STEPS[i].image));
  assert.equal($('tutorialTitle').textContent,CIRCLE_TUTORIAL_STEPS[i].title);
  assert.equal($('tutorialHint').textContent,CIRCLE_TUTORIAL_STEPS[i].hint);
  assert.equal($('tutorialDetails').textContent,CIRCLE_TUTORIAL_STEPS[i].detail);
  assert.equal($('tutorialFreedom').hidden,i<2);
  if(i>=2)assert.equal($('tutorialFreedom').textContent,CIRCLE_TUTORIAL_STEPS[i].freedom);
 }
 assert.equal($('tutorialContinue').textContent,'魔導書へ');
 $('tutorialPrevious').fire('click');
 assert.equal($('tutorialCounter').textContent,'3 / 4');
 $('tutorialContinue').fire('click');
 $('tutorialContinue').fire('click');
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[true]);
 assert.equal(tutorial.isOpen(),false);
 assert.equal($('dungeonApp').attributes.inert,undefined);
 tutorial.open();
 assert.equal($('tutorialCounter').textContent,'1 / 4');
 $('tutorialSkip').fire('click');
 await new Promise(r=>setImmediate(r));
 tutorial.open();
 $('tutorialOverlay').fire('keydown',{key:'Escape'});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[true,false,false]);
}finally{env.restore();}
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const script=await readFile(new URL('../assets/js/dungeon-tutorial.mjs',import.meta.url),'utf8');
assert.match(html,/id="tutorialAnimation" src="assets\/images\/tutorial-outer\.gif\?v=20261018\.36"/);
assert.match(html,/id="tutorialReplay"/);
assert.match(html,/data-release="20261018\.36"/);
assert.match(script,/gif\.src='assets\/images\/'/);
assert.doesNotMatch(html,/id="tutorialCanvas"|id="tutorialPad"/);
assert.doesNotMatch(script,/pointerdown|pointermove|setPointerCapture/);
for(const step of CIRCLE_TUTORIAL_STEPS){
 const b=await readFile(new URL('../assets/images/'+step.image,import.meta.url));
 assert.equal(b.subarray(0,6).toString('ascii'),'GIF89a');
 let frames=0;for(let i=0;i<b.length-2;i++)if(b[i]===33&&b[i+1]===249&&b[i+2]===4)frames++;
 assert.ok(frames>=2,step.image+' must animate');
}
console.log('PASS four animated tutorial pages, lessons and navigation');
