import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CIRCLE_RITUAL_DURATION_MS,CIRCLE_REVEAL_DURATION_MS,CIRCLE_GRAND_REVEAL_DURATION_MS,isGrandCircleReveal,circleRitualLabels,playCircleReveal,playCircleUpgrade} from '../assets/js/dungeon-circle-ritual.mjs';

const source=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const ritualSource=await readFile(new URL('../assets/js/dungeon-circle-ritual.mjs',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.equal(CIRCLE_RITUAL_DURATION_MS,800,'upgrade animation remains 0.8 seconds');
assert.equal(CIRCLE_REVEAL_DURATION_MS,1000,'ordinary reveal remains 1 second');
assert.equal(CIRCLE_GRAND_REVEAL_DURATION_MS,2300,'grand reveal runs for 2.3 seconds');
for(const power of [0,499,undefined,NaN])assert.equal(isGrandCircleReveal({power}),false);
for(const power of [500,501,1000])assert.equal(isGrandCircleReveal({power}),true);
assert.equal(isGrandCircleReveal(null),false);
const attributes={
 flame:'🔥 炎の相',bolt:'⚡ 雷の相',aqua:'💧 水の相',storm:'🌪️ 風の相',
 gravity:'🪨 重力の相',law:'⚖️ 秩序の相',chaos:'🌀 混沌の相'
};
const roles={attack:'⚔️ 攻撃の紋',defense:'🛡️ 防御の紋',support:'✚ 回復の紋',debuff:'🕸️ 弱体の紋'};
for(const [attribute,text] of Object.entries(attributes))
 assert.equal(circleRitualLabels({attribute,role:'attack'})[0],text);
for(const [role,text] of Object.entries(roles))
 assert.equal(circleRitualLabels({attribute:'flame',role})[1],text);
assert.match(source,/show\('library'\);\s*returnToCameraScroll\(\);\s*await revealOriginal\(analyzed\)/,'photo realization is after saved circle and visible library');
assert.match(source,/show\('battle'\);await revealOriginal\(circle\);await takeTurn\(index\)/,'dungeon analysis has its own reveal before casting');
assert.match(source,/saveProfile\(db,nextProfile\)[\s\S]*?playCircleUpgrade\(circle,\$\('magicUpgradeEffect'\)\)/,'upgrade effect starts only after profile saving');
assert.match(html,/<div class="magic-details-art"><img id="magicDetailsImage"[^>]*><div id="magicUpgradeEffect"/,'new glow overlays the existing real photo');
assert.match(css,/\.circle-ritual__veil[\s\S]*?circle-ritual-veil var\(--ritual-duration\)/,'reveal includes black backdrop');
assert.match(css,/@keyframes circle-ritual-physical/,'photo solidifies under the fading black');
assert.match(css,/\.circle-ritual__physical\{/,'saved circle artwork exists behind glow');
for(const animation of ['circle-ritual-ring-in','circle-upgrade-aura','circle-ritual-ink','circle-ritual-veil']){
 assert.ok(css.includes('@keyframes '+animation),'missing '+animation);
}
assert.match(css,/--ritual-duration:\.8s/,'upgrade CSS remains 0.8 seconds');
assert.match(css,/\.circle-ritual--reveal\{\s*--ritual-duration:1s;/,'ordinary reveal CSS stays 1 second');
assert.match(css,/\.circle-ritual--reveal\.circle-ritual--grand\{\s*--ritual-duration:2\.3s;/,'only grand reveal extends animation');
for(const effect of ['circle-grand-bolt','circle-grand-flash','circle-grand-shockwave'])
 assert.match(css,new RegExp('@keyframes '+effect),'grand reveal is cinematic');
assert.match(ritualSource,/else timer=setTimeout\(ready,grand\?CIRCLE_GRAND_REVEAL_DURATION_MS:CIRCLE_REVEAL_DURATION_MS\)/,'continue unlock uses the matching animation duration');
assert.match(ritualSource,/await sleep\(CIRCLE_RITUAL_DURATION_MS\)/,'upgrade still waits only 0.8 seconds');
assert.doesNotMatch(css,/circle-upgrade-glow|data-enhancing="true"\] \.magic-details-content:after/,'old long upgrade animation is removed without changing combat timing');
assert.match(css,/\.circle-ritual--upgrade\{/,'upgrades share ritual glow without a black backdrop');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*\.circle-ritual--upgrade\{display:none!important\}/,'reduced-motion keeps static result but disables upgrade animation');
await playCircleReveal({analysis:{attribute:'law',role:'support'},image:new Blob(['photo'])});
await playCircleUpgrade({analysis:{attribute:'law',role:'support'}},null);
assert.match(css,/\.circle-ritual--reveal\{[\s\S]*?pointer-events:auto/,'fullscreen overlay intercepts page taps');
assert.match(css,/\.circle-ritual--reveal\[data-ready="true"\] \.circle-ritual__hint\{opacity:/,'tap hint only appears after the animation');
assert.match(css,/100%\{opacity:1;transform:scale\(1\)\}/,'the physical circle remains visible after realization');
assert.match(source,/await revealOriginal\(analyzed\)/);
assert.match(source,/await revealOriginal\(circle\);await takeTurn\(index\)/);
assert.match(source,/async function revealOriginal\(circle\)\{[\s\S]*?originalUrl=circleImages\.get\(circle\.image\);[\s\S]*?await playCircleReveal\(circle,originalUrl\);/,'reveal uses the full stored original Blob and URL, not a thumbnail');
assert.doesNotMatch(source,/revealThumbnail|playCircleReveal\(\{\.\.\.circle,image:thumb\}/,'no downsampled photo is used for reveal');
assert.match(source,/\$\('magicDetailsImage'\)\.src=circleImages\.get\(circle\.image\)/,'details already use the original Blob and must keep doing so');

const originalDocument=globalThis.document,originalWindow=globalThis.window;
let doc;
class FakeElement{
 constructor(tag){
  this.tagName=tag;this.children=[];this.parent=null;this.className='';this.dataset={};
  this.attributes={};this.handlers=new Map();this.style={setProperty(){}};
  this.disabled=false;this.textContent='';
 }
 get isConnected(){return this.tagName==='body'||this.parent?.isConnected||false;}
 get firstChild(){return this.children[0]||null;}
 append(...items){for(const item of items)this.appendChild(item);}
 appendChild(item){item.parent=this;this.children.push(item);return item;}
 insertBefore(item,other){item.parent=this;const at=this.children.indexOf(other);this.children.splice(at<0?0:at,0,item);return item;}
 remove(){if(!this.parent)return;this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,handler){this.handlers.set(name,handler);}
 removeEventListener(name,handler){if(this.handlers.get(name)===handler)this.handlers.delete(name);}
 focus(){doc.activeElement=this;}
 click(){if(!this.disabled)this.handlers.get('click')?.({target:this});}
}
try{
 const body=new FakeElement('body');
 const prior={isConnected:true,focus(){doc.activeElement=this;}};
 doc={body,activeElement:prior,createElement:tag=>new FakeElement(tag)};
 globalThis.document=doc;
 globalThis.window={matchMedia:()=>({matches:false})};
 const circle={analysis:{attribute:'law',role:'support'},image:null};
 let settled=false;
 const playing=playCircleReveal(circle,'blob:real-photo').then(()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(body.children.length,1,'one full-screen dialog is mounted');
 const modal=body.children[0],advance=modal.children.at(-1);
 assert.equal(modal.attributes.role,'dialog');
 assert.equal(modal.attributes['aria-modal'],'true');
 assert.equal(modal.children[0].src,'blob:real-photo','original photo is on the overlay');
 assert.equal(advance.tagName,'button');
 assert.equal(advance.disabled,true,'accidental taps during the 1s reveal are ignored');
 advance.click();
 assert.equal(settled,false);
 await new Promise(resolve=>setTimeout(resolve,CIRCLE_REVEAL_DURATION_MS+60));
 assert.equal(settled,false,'the reveal never auto-advances after 1s');
 assert.equal(body.children.length,1,'the overlay remains visible until a tap');
 assert.equal(advance.disabled,false);
 assert.equal(modal.dataset.ready,'true');
 assert.equal(advance.children[0].textContent,'タップして進む');
 advance.click();
 await playing;
 assert.equal(settled,true,'a tap completes the reveal');
 assert.equal(body.children.length,0,'overlay is removed after the tap');
 assert.equal(doc.activeElement,prior,'focus returns to the prior control');
 let grandSettled=false;
 const grandReveal=playCircleReveal({analysis:{attribute:'aqua',role:'defense',power:500},image:null},'blob:grand-photo').then(()=>{grandSettled=true;});
 await new Promise(resolve=>setImmediate(resolve));
 const grandModal=body.children[0],grandAdvance=grandModal.children.at(-1);
 assert.match(grandModal.className,/circle-ritual--grand/,'power 500 gets the grand reveal');
 const lightning=grandModal.children.find(node=>node.className==='circle-ritual__lightning');
 assert.equal(lightning?.attributes['aria-hidden'],'true','lightning is purely decorative');
 assert.equal(lightning?.children.length,4,'four lightning strokes cross the screen');
 assert.doesNotMatch(grandModal.attributes['aria-label'],/\d/,'reveal never speaks the hidden power');
 assert.equal(grandAdvance.disabled,true,'grand reveal cannot be skipped');
 await new Promise(resolve=>setTimeout(resolve,CIRCLE_REVEAL_DURATION_MS+50));
 assert.equal(grandAdvance.disabled,true,'grand reveal is still playing after the normal 1 second');
 assert.equal(grandSettled,false);
 await new Promise(resolve=>setTimeout(resolve,CIRCLE_GRAND_REVEAL_DURATION_MS-CIRCLE_REVEAL_DURATION_MS+50));
 assert.equal(grandAdvance.disabled,false,'grand reveal can advance after 2.3 seconds');
 assert.equal(grandModal.dataset.ready,'true');
 grandAdvance.click();
 await grandReveal;
 assert.equal(grandSettled,true);
 assert.equal(body.children.length,0);
 globalThis.window.matchMedia=()=>({matches:true});
 const reduced=playCircleReveal(circle,'blob:real-photo');
 await new Promise(resolve=>setImmediate(resolve));
 const instant=body.children[0],reducedAdvance=instant.children.at(-1);
 assert.equal(reducedAdvance.disabled,false,'reduced motion still requires a tap, without waiting 1s');
 assert.equal(instant.dataset.ready,'true');
 reducedAdvance.click();
 await reduced;
 assert.equal(body.children.length,0);
}finally{
 globalThis.document=originalDocument;
 globalThis.window=originalWindow;
}
console.log('PASS 1000ms standard / 2300ms grand circle reveal, hidden power, seven aspects, four sigils and 800ms upgrade');
