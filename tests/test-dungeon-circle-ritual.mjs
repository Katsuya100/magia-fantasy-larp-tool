import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CIRCLE_RITUAL_DURATION_MS,circleRitualLabels,playCircleReveal,playCircleUpgrade} from '../assets/js/dungeon-circle-ritual.mjs';

const source=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const html=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
assert.equal(CIRCLE_RITUAL_DURATION_MS,800,'both sequences must last 0.8 seconds');
const attributes={
 flame:'🔥 炎の相',bolt:'⚡ 雷の相',aqua:'💧 水の相',storm:'🌪️ 風の相',
 gravity:'🪨 重力の相',law:'⚖️ 秩序の相',chaos:'🌀 混沌の相'
};
const roles={attack:'⚔️ 攻撃の紋',defense:'🛡️ 防御の紋',support:'✚ 回復の紋',debuff:'🕸️ 弱体の紋'};
for(const [attribute,text] of Object.entries(attributes))
 assert.equal(circleRitualLabels({attribute,role:'attack'})[0],text);
for(const [role,text] of Object.entries(roles))
 assert.equal(circleRitualLabels({attribute:'flame',role})[1],text);
assert.match(source,/show\('library'\);\s*returnToCameraScroll\(\);\s*await playCircleReveal\(analyzed,imageUrl\(analyzed.image\)\)/,'photo realization is after saved circle and visible library');
assert.match(source,/show\('battle'\);await playCircleReveal\(circle,imageUrl\(circle.image\)\);await takeTurn\(index\)/,'dungeon analysis has its own reveal before casting');
assert.match(source,/saveProfile\(db,nextProfile\)[\s\S]*?playCircleUpgrade\(circle,\$\('magicUpgradeEffect'\)\)/,'upgrade effect starts only after profile saving');
assert.match(html,/<div class="magic-details-art"><img id="magicDetailsImage"[^>]*><div id="magicUpgradeEffect"/,'new glow overlays the existing real photo');
assert.match(css,/\.circle-ritual__veil[\s\S]*?circle-ritual-veil var\(--ritual-duration\)/,'reveal includes black backdrop');
assert.match(css,/@keyframes circle-ritual-physical/,'photo solidifies under the fading black');
assert.match(css,/\.circle-ritual__physical\{/,'real saved photo exists behind glow');
for(const animation of ['circle-ritual-ring-in','circle-upgrade-aura','circle-ritual-ink','circle-ritual-veil']){
 assert.ok(css.includes('@keyframes '+animation),'missing '+animation);
}
assert.match(css,/--ritual-duration:\.8s/,'CSS duration stays synchronized with JS');
assert.doesNotMatch(css,/circle-upgrade-glow|data-enhancing="true"\] \.magic-details-content:after/,'old long upgrade animation is removed without changing combat timing');
assert.match(css,/\.circle-ritual--upgrade\{/,'upgrades share ritual glow without a black backdrop');
assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*\.circle-ritual--upgrade\{display:none!important\}/,'reduced-motion keeps static result but disables upgrade animation');
await playCircleReveal({analysis:{attribute:'law',role:'support'},image:new Blob(['photo'])});
await playCircleUpgrade({analysis:{attribute:'law',role:'support'}},null);
assert.match(css,/\.circle-ritual--reveal\{[\s\S]*?pointer-events:auto/,'fullscreen overlay intercepts page taps');
assert.match(css,/\.circle-ritual--reveal\[data-ready="true"\] \.circle-ritual__hint\{opacity:/,'tap hint only appears after the animation');
assert.match(css,/100%\{opacity:1;transform:scale\(1\)\}/,'the physical circle remains visible after realization');
assert.match(source,/await playCircleReveal\(analyzed,imageUrl\(analyzed.image\)\)/);
assert.match(source,/await playCircleReveal\(circle,imageUrl\(circle.image\)\);await takeTurn\(index\)/);

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
 assert.equal(advance.disabled,true,'accidental taps during the 0.8s animation are ignored');
 advance.click();
 assert.equal(settled,false);
 await new Promise(resolve=>setTimeout(resolve,CIRCLE_RITUAL_DURATION_MS+60));
 assert.equal(settled,false,'the reveal never auto-advances after 0.8s');
 assert.equal(body.children.length,1,'the overlay remains visible until a tap');
 assert.equal(advance.disabled,false);
 assert.equal(modal.dataset.ready,'true');
 assert.equal(advance.children[0].textContent,'タップして進む');
 advance.click();
 await playing;
 assert.equal(settled,true,'a tap completes the reveal');
 assert.equal(body.children.length,0,'overlay is removed after the tap');
 assert.equal(doc.activeElement,prior,'focus returns to the prior control');
 globalThis.window.matchMedia=()=>({matches:true});
 const reduced=playCircleReveal(circle,'blob:real-photo');
 await new Promise(resolve=>setImmediate(resolve));
 const instant=body.children[0],reducedAdvance=instant.children.at(-1);
 assert.equal(reducedAdvance.disabled,false,'reduced motion still requires a tap, without waiting 0.8s');
 assert.equal(instant.dataset.ready,'true');
 reducedAdvance.click();
 await reduced;
 assert.equal(body.children.length,0);
}finally{
 globalThis.document=originalDocument;
 globalThis.window=originalWindow;
}
console.log('PASS fullscreen tap-to-continue circle reveal, seven aspects, four sigils and 800ms upgrade');
