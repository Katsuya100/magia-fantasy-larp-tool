import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {isClosedRing,completedPractice,initCircleTutorial} from '../assets/js/dungeon-tutorial.mjs';

const ring=(radius,closed=true)=>{
 const points=Array.from({length:33},(_,i)=>({
  x:160+Math.cos(-Math.PI/2+i*(closed?2:1.7)*Math.PI/32)*radius,
  y:160+Math.sin(-Math.PI/2+i*(closed?2:1.7)*Math.PI/32)*radius
 }));
 return points;
};
assert.equal(isClosedRing(ring(116),116),true,'completed outer circle accepted');
assert.equal(isClosedRing(ring(66),66),true,'completed inner circle accepted');
assert.equal(isClosedRing(ring(116,false),116),false,'open ring rejected');
assert.equal(isClosedRing([{x:160,y:30},{x:160,y:30}],116),false,'one tap rejected');
assert.equal(isClosedRing(ring(66),116),false,'inner ring cannot satisfy outer target');
assert.equal(completedPractice(3,[[{x:80,y:100},{x:120,y:50}]]),false,'word needs multiple real pen strokes');
assert.equal(completedPractice(4,[[{x:160,y:160},{x:165,y:165}]]),false,'short symbol scribble rejected');

const env=fakeDungeonBrowser();
try{
 const $=id=>env.document.getElementById(id);
 let completed=[];
 const tutorial=initCircleTutorial(env.document,async toCamera=>{completed.push(toCamera);});
 const pointer=(event,p)=>{
  $('tutorialCanvas').fire(event,{clientX:p.x,clientY:p.y,pointerId:1});
 };
 function trace(points){
  pointer('pointerdown',points[0]);
  for(const p of points.slice(1))pointer('pointermove',p);
  pointer('pointerup',points.at(-1));
 }
 tutorial.open();
 assert.equal(tutorial.isOpen(),true);
 assert.equal($('dungeonApp').attributes.inert,'','background is inert during the lesson');
 assert.equal($('tutorialExample').hidden,false,'the existing sample is presented first');
 assert.equal($('tutorialContinue').disabled,false);
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialPad').dataset.step,'1');
 assert.equal($('tutorialContinue').disabled,true,'cannot skip an unperformed drawing');
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialPad').dataset.step,'1','disabled next does not advance');
 trace(ring(116,false));
 assert.equal($('tutorialContinue').disabled,true,'open outer circle cannot advance');
 $('tutorialRetry').fire('click');
 trace(ring(116));
 assert.equal($('tutorialContinue').disabled,false,'closed outer circle enables next');
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialContinue').disabled,true,'inner circle must be drawn separately');
 trace(ring(66));
 assert.equal($('tutorialContinue').disabled,false);
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialPad').dataset.step,'3','spell must be between both circles');
 trace([{x:80,y:100},{x:110,y:65},{x:140,y:52},{x:175,y:45}]);
 assert.equal($('tutorialContinue').disabled,true,'a single short stroke is insufficient for a word');
 trace([{x:180,y:47},{x:210,y:60},{x:245,y:100}]);
 assert.equal($('tutorialContinue').disabled,false,'two substantial writing strokes accepted');
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialContinue').disabled,true,'symbol needs its own drawing');
 trace([{x:146,y:135},{x:182,y:160},{x:144,y:174},{x:175,y:195}]);
 assert.equal($('tutorialContinue').disabled,false);
 $('tutorialContinue').fire('click');
 assert.equal($('tutorialExample').hidden,false,'finish repeats the sample and camera rules');
 $('tutorialContinue').fire('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(completed,[true],'finishing directs to the camera page');
 assert.equal(tutorial.isOpen(),false);
 assert.equal($('dungeonApp').attributes.inert,undefined,'background unlocks after completion');
 tutorial.open();
 $('tutorialSkip').fire('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(completed,[true,false],'skip exits without camera permission');
 assert.equal(tutorial.isOpen(),false);
}finally{env.restore();}
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.match(html,/id="tutorialOverlay"[\s\S]*?id="tutorialCanvas"/);
assert.match(html,/id="tutorialReplay"/);
assert.match(html,/assets\/images\/sample\.png\?v=20261018\.25/);
console.log('PASS first-circle tutorial: sample, gated pen gestures, unlock, skip and replay');
