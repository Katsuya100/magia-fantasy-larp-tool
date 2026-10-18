import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {initCircleTutorial} from '../assets/js/dungeon-tutorial.mjs';

const env=fakeDungeonBrowser();
try{
 const $=id=>env.document.getElementById(id);
 const exits=[];
 const tutorial=initCircleTutorial(env.document,async toCamera=>{exits.push(toCamera);});
 assert.equal(tutorial.isOpen(),false);
 tutorial.open();
 assert.equal(tutorial.isOpen(),true,'first player sees the tutorial');
 assert.equal($('dungeonApp').attributes.inert,'','background interactions are locked');
 assert.equal($('tutorialContinue').disabled,false,'no forced drawing input');
 $('tutorialContinue').fire('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(exits,[true],'single button finishes and opens library');
 assert.equal(tutorial.isOpen(),false);
 assert.equal($('dungeonApp').attributes.inert,undefined,'game unlocks after tutorial');
 tutorial.open();
 $('tutorialSkip').fire('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(exits,[true,false],'skip exits without invoking camera');
 tutorial.open();
 $('tutorialOverlay').fire('keydown',{key:'Escape'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(exits,[true,false,false],'Escape can dismiss guided walkthrough');
}finally{
 env.restore();
}
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const script=await readFile(new URL('../assets/js/dungeon-tutorial.mjs',import.meta.url),'utf8');
assert.match(html,/id="tutorialAnimation" src="assets\/images\/dungeon-circle-tutorial\.gif\?v=20261018\.26"/);
assert.match(html,/外円 → 内円 → 英語の呪文 → 紋様/);
assert.match(html,/id="tutorialReplay"/);
assert.doesNotMatch(html,/id="tutorialCanvas"|id="tutorialPad"/,'touch drawing is removed');
assert.doesNotMatch(script,/pointerdown|pointermove|setPointerCapture/,'tutorial no longer listens for pen input');
console.log('PASS GIF tutorial: first-play gate, tap-through, escape and replay compatibility');
