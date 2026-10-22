import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {initMagicStoneTutorial,shouldShowMagicStoneTutorial} from '../assets/js/dungeon-magic-stone-tutorial.mjs';

assert.equal(shouldShowMagicStoneTutorial({magicStones:0}),false);
assert.equal(shouldShowMagicStoneTutorial({magicStones:1}),true);
assert.equal(shouldShowMagicStoneTutorial({magicStones:2,magicStoneTutorialSeen:true}),false);
assert.equal(shouldShowMagicStoneTutorial(null),false);

const env=fakeDungeonBrowser();
try{
 const $=id=>env.document.getElementById(id);
 const frames=[],positions=[];
 const view={scrollY:120,scrollTo(x,y){positions.push([x,y]);}};
 $('magicStoneBalance').getBoundingClientRect=()=>({top:380});
 const tutorial=initMagicStoneTutorial(env.document,{view,requestFrame:cb=>frames.push(cb)});
 assert.equal($('magicStoneTutorialDialog').open,false);
 tutorial.open();
 tutorial.open();
 assert.equal($('magicStoneTutorialDialog').open,true);
 assert.equal(positions.length,0,'opening must not scroll');
 $('closeMagicStoneTutorial').fire('click');
 assert.equal($('magicStoneTutorialDialog').open,false);
 assert.equal(positions.length,0,'scroll starts on the close event, not before');
 $('magicStoneTutorialDialog').fire('close');
 assert.equal(frames.length,1);
 frames.shift()(0);
 assert.deepEqual(positions.at(-1),[0,120]);
 frames.shift()(250);
 assert.ok(positions.at(-1)[1]>120&&positions.at(-1)[1]<500);
 frames.shift()(500);
 assert.deepEqual(positions.at(-1),[0,500],'label top aligns with viewport at 500ms');
 assert.equal(frames.length,0,'animation finishes after half a second');
}finally{env.restore();}

const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const image=await readFile(new URL('../assets/images/magic-stone-tutorial.webp',import.meta.url));
assert.match(html,/id="magicStoneTutorialDialog"/);
assert.match(html,/src="assets\/images\/magic-stone-tutorial\.webp"/);
assert.match(html,/魔導石を使えば、あなたの魔法を強化できます。/);
assert.equal(image.subarray(0,4).toString('ascii'),'RIFF');
assert.equal(image.subarray(8,12).toString('ascii'),'WEBP');
assert.match(app,/b\.dataset\.view==='library'&&shouldShowMagicStoneTutorial\(profile\)/);
assert.match(app,/profile\.magicStoneTutorialSeen=true;/);
assert.match(app,/magicStoneTutorial\.open\(\);\s*void persist\(\)/);
console.log('PASS first magic-stone grimoire visit and 500ms label scroll');
