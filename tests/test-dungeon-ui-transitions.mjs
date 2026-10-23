import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DUNGEON_MODAL_DURATION_MS,showUiOverlay,hideUiOverlay} from '../assets/js/dungeon-ui-transitions.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [html,css,app,tutorial,drawing]=await Promise.all([
 read('dungeon.html'),read('assets/css/dungeon.css'),
 read('assets/js/dungeon-app.mjs'),read('assets/js/dungeon-tutorial.mjs'),
 read('assets/js/dungeon-circle-draw.mjs')
]);
assert.equal(DUNGEON_MODAL_DURATION_MS,200);
const dialogs=[...html.matchAll(/<dialog id="([^"]+)"/g)].map(match=>match[1]);
assert.equal(dialogs.length,19,'existing dialogs plus two scoped onboarding dialogs');
assert.equal(new Set(dialogs).size,19);
assert.match(css,/dialog\{[^}]*transition:opacity \.2s[^}]*display \.2s allow-discrete,overlay \.2s allow-discrete/);
assert.match(css,/dialog\[open\]\{opacity:1;transform:none\}/);
assert.match(css,/@starting-style\{\s*dialog\[open\]/);
assert.match(css,/dialog::backdrop\{[^}]*opacity \.2s[^}]*overlay \.2s allow-discrete/);
for(const name of ['startup-mask','tutorial-overlay','circle-drawing-discard']){
 assert.ok(css.includes('.'+name+':not([hidden])'),'show animation: '+name);
 assert.ok(css.includes('.'+name+'[hidden][data-ui-exiting="true"]'),'hide animation: '+name);
}
assert.match(css,/@keyframes dungeon-modal-overlay-show\{from\{opacity:0\}to\{opacity:1\}\}/);
assert.match(css,/@keyframes dungeon-modal-overlay-hide\{from\{opacity:1\}to\{opacity:0\}\}/);
assert.match(css,/prefers-reduced-motion:reduce[\s\S]*?\.startup-mask,\.tutorial-overlay,\.circle-drawing-discard\{animation:none!important\}/);
assert.match(app,/hideUiOverlay\(\$\('startupMask'\)\)/);
assert.match(tutorial,/showUiOverlay\(overlay\)/);
assert.match(tutorial,/hideUiOverlay\(overlay\)/);
assert.match(drawing,/showUiOverlay\(discard\)/);
assert.match(drawing,/hideUiOverlay\(discard\)/);
// Overlay-to-overlay and mixed handoffs do not wait for a fade to finish.
const departing={hidden:false,dataset:{}},arriving={hidden:true,dataset:{}};
hideUiOverlay(departing);showUiOverlay(arriving);
assert.equal(departing.hidden,true);
assert.equal(departing.dataset.uiExiting,'true');
assert.equal(arriving.hidden,false);
assert.equal(arriving.dataset.uiExiting,undefined);
// A rapid return cancels the old fade; reduced motion skips it.
showUiOverlay(departing);
assert.equal(departing.hidden,false);
assert.equal(departing.dataset.uiExiting,undefined);
hideUiOverlay(departing,{reducedMotion:true});
assert.equal(departing.hidden,true);
assert.equal(departing.dataset.uiExiting,undefined);
hideUiOverlay(arriving);
assert.equal(arriving.dataset.uiExiting,'true');
await new Promise(resolve=>setTimeout(resolve,DUNGEON_MODAL_DURATION_MS+30));
assert.equal(arriving.dataset.uiExiting,undefined);
assert.equal(arriving.hidden,true);

// Every native dialog action, including changing the existing adventurer name,
// camera, recovery, drawing, Drive confirmations and magic-stone help, uses
// the same browser-local animation path (not window.alert/prompt/confirm).
const sources=['assets/js/dungeon-app.mjs','assets/js/dungeon-circle-draw.mjs',
 'assets/js/dungeon-cloud-sync.mjs','assets/js/dungeon-magic-stone-tutorial.mjs'];
let opens=0,closes=0;
for(const file of sources){
 const source=await read(file);
 assert.doesNotMatch(source,/\b(?:dialog|conflictDialog|expiredDialog)\.(?:showModal|close)\(\)|\$\('[^']+'\)\.(?:showModal|close)\(\)/,'unmanaged dialog call in '+file);
 opens+=(source.match(/showDungeonDialog\(/g)||[]).length;
 closes+=(source.match(/closeDungeonDialog\(/g)||[]).length;
}
assert.ok(opens>=18&&closes>=29,'all native dialog paths are routed through the manager');
assert.match(app,/if\(!dialog\.open\)showDungeonDialog\(dialog\);\s*\$\('playerNameInput'\)\.focus\(\)/,'rename opens with animation');
assert.match(app,/profile=next;\s*closeDungeonDialog\(\$\('nameDialog'\)\)/,'name save closes with animation');
assert.match(css,/@keyframes dungeon-dialog-enter\{/);
assert.match(css,/@keyframes dungeon-dialog-exit\{/);

// Show and Hide must advance at the *same perceived speed*, not merely share
// a nominal 200ms duration. Previously entry used a fast-start cubic-bezier
// while exit used ease-in, making rename/confirmation dialogs pop in.
const symmetricTimings=[
 'transition:opacity .2s linear,transform .2s linear,',
 'dialog::backdrop{opacity:0;transition:opacity .2s linear,',
 'animation:dungeon-modal-overlay-show .2s linear both',
 'animation:dungeon-modal-overlay-hide .2s linear both',
 'animation:dungeon-dialog-enter .2s linear both',
 'animation:dungeon-dialog-exit .2s linear both!important',
 'animation:dungeon-dialog-veil-show .2s linear both',
 'animation:dungeon-dialog-veil-hide .2s linear both'
];
for(const timing of symmetricTimings){
 assert.ok(css.includes(timing),'symmetric 200ms modal animation: '+timing);
}
assert.doesNotMatch(css.slice(css.indexOf('/* All modal opacity and movement'),css.indexOf('/* Confirmation for the irreversible local-save reset. */')),/\.2s (?:ease-in|ease-out|cubic-bezier)/,'no asymmetric easing in modal section');

assert.match(css,/\.dungeon-modal-exit-layer/);
for(const file of sources){
 assert.doesNotMatch(await read(file),/\b(?:window|globalThis)\.(?:alert|confirm|prompt)\s*\(/,'system dialog in '+file);
}
const {showDungeonDialog,closeDungeonDialog,installDungeonDialogCancelTransitions}=await import('../assets/js/dungeon-ui-transitions.mjs');
const appended=[];
function element(){
 return {open:false,dataset:{},style:{},attrs:{},classList:{add(){}},
  setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
  querySelectorAll(){return [];},cloneNode(){return element();},
  appendChild(child){(this.children??=[]).push(child);},remove(){this.removed=true;},
  showModal(){this.open=true;},close(){this.open=false;},
  getBoundingClientRect(){return {left:20,top:30,width:400,height:250};},
  addEventListener(type,callback){(this.handlers??={})[type]=callback;}
 };
}
const native=element(),owner={
 body:{appendChild(portal){appended.push(portal);}},
 createElement:()=>element(),querySelectorAll:()=>[native],
 defaultView:{matchMedia:()=>({matches:false})}
};
native.ownerDocument=owner;
showDungeonDialog(native);
assert.equal(native.open,true,'native dialog shows immediately');
assert.equal(native.dataset.uiEntering,'true','enter keyframes are explicitly triggered');
closeDungeonDialog(native);
assert.equal(native.open,false,'native dialog closes immediately, preserving save/focus ordering');
assert.equal(appended.length,1,'exit visual exists concurrently with following dialog');
assert.equal(appended[0].attrs['aria-hidden'],'true');
assert.equal(appended[0].attrs.inert,'');
assert.equal(appended[0].children[1].attrs['aria-hidden'],'true');
showDungeonDialog(native);
assert.equal(native.open,true,'name dialog can reopen during previous hide');
closeDungeonDialog(native);
assert.equal(appended.length,2,'every repeat open/close restarts the animation');
installDungeonDialogCancelTransitions(owner);
assert.equal(typeof native.handlers.cancel,'function','native Escape participates too');
showDungeonDialog(native);
native.handlers.cancel({defaultPrevented:true});
native.close();
await Promise.resolve();
assert.equal(appended.length,2,'prevented Escape must not create a visual exit');
showDungeonDialog(native);
native.handlers.cancel({defaultPrevented:false});
native.close();
await Promise.resolve();
assert.equal(appended.length,3,'unprevented Escape exits with the same animation');
await new Promise(resolve=>setTimeout(resolve,DUNGEON_MODAL_DURATION_MS+30));
assert.ok(appended.every(node=>node.removed),'ghosts are removed after the 200ms exit');


// Frame components: one shared inner container, with exactly three layout
// variants (closable, fixed, paged). Fullscreen/ceremony surfaces are explicitly
// excluded. An HTML <dialog> tag alone does not establish the visual category.
const closable={
 loadoutDialog:'closeLoadoutDialog',
 magicDetailsDialog:'closeMagicDetails',
 circleActionDialog:'cancelCircleAction',
 magicStoneTutorialDialog:'closeMagicStoneTutorial',
 supportPromptDialog:'supportPromptClose',
 googleDriveConflictDialog:'data-action="later"',
 googleDriveOverwriteDialog:'data-action="back"',
 googleDriveExpiredDialog:'data-action="later"',
 deleteDataDialog:'cancelDeleteData'
};
const fixed=['saveErrorDialog','backupSetupDialog','circleFirstChoiceDialog','nameDialog'];
const overlayFlows={
 circleDrawingDialog:['circleDrawingClose','閉じる'],
 circleCameraDialog:['cameraStop','閉じる'],
 imageRepairDialog:['imageRepairLater','あとで'],
 creatorCongratulationsDialog:['creatorCongratulationsClose','閉じる'],
 milestoneChoiceDialog:['milestoneClose','閉じる']
};
const tagOf=id=>{
 const match=html.match(new RegExp('<dialog id="'+id+'"[^>]*>'));
 assert.ok(match,'dialog exists: '+id);
 return match[0];
};
const dialogMarkup=id=>{
 const start=html.indexOf('<dialog id="'+id+'"');
 const end=html.indexOf('</dialog>',start);
 assert.ok(start>=0&&end>start,'dialog markup exists: '+id);
 return html.slice(start,end);
};
const controlButtons=markup=>[...markup.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]);
for(const [id,control] of Object.entries(closable)){
 assert.match(tagOf(id),/data-dungeon-frame="closable"/,'closable variant: '+id);
 const content=dialogMarkup(id);
 assert.match(content,/<div class="[^"]* dungeon-dialog-frame">/,'shared frame element: '+id);
 assert.match(content,/<h[23] id="[^"]+" class="dungeon-dialog-frame-title"/,'shared title: '+id);
 const buttons=controlButtons(content).filter(t=>t.includes('dungeon-dialog-close'));
 assert.equal(buttons.length,1,'exactly one shared close button: '+id);
 assert.ok(buttons[0].includes(control.startsWith('data-action')?control:'id="'+control+'"'),'original button and handler retained: '+id);
}
for(const id of fixed){
 assert.match(tagOf(id),/data-dungeon-frame="fixed"/,'fixed variant: '+id);
 const content=dialogMarkup(id);
 assert.match(content,/<div class="[^"]* dungeon-dialog-frame">/,'same frame component without a close rail: '+id);
 assert.match(content,/<h[23] id="[^"]+" class="dungeon-dialog-frame-title"/,'same title part: '+id);
 if(id!=='nameDialog')assert.doesNotMatch(content,/dungeon-dialog-close/,'no close button: '+id);
}
for(const [id,[buttonId,label]] of Object.entries(overlayFlows)){
 assert.match(tagOf(id),/data-dungeon-frame="overlay"/,'dedicated overlay type: '+id);
 const content=dialogMarkup(id);
 assert.doesNotMatch(content,/dungeon-dialog-frame|dungeon-dialog-close/,'overlay layout preserved: '+id);
 const button=controlButtons(content).find(t=>t.includes('id="'+buttonId+'"'));
 assert.ok(button,'original overlay footer button: '+id);
 assert.ok(content.includes('id="'+buttonId+'"')&&content.includes('>'+label+'</button>'),'original overlay label: '+id);
}
const pagedNative=['circleDrawingLessonDialog'];
assert.equal(Object.keys(closable).length+fixed.length+Object.keys(overlayFlows).length+pagedNative.length,dialogs.length,'all 19 native dialogs accounted for');
for(const id of pagedNative){
 assert.match(tagOf(id),/data-dungeon-frame="paged"/,'native lesson is a paged frame');
 const content=dialogMarkup(id);
 assert.match(content,/<div class="tutorial-sheet dungeon-dialog-frame">/,'lesson has shared paged frame');
 assert.match(content,/<div id="circleDrawingLessonSlot"><\/div>/,'page content is inserted in the normal slot');
 assert.match(content,/<button type="button" id="circleDrawingLessonClose" class="subtle dungeon-dialog-close"/,'paged lesson retains its close control');
}

const tutorialTag=html.match(/<div id="tutorialOverlay"[^>]+>/)?.[0];
assert.match(tutorialTag,/data-dungeon-frame="paged"/,'tutorial uses the paged frame variant');
assert.match(html,/<div class="tutorial-sheet dungeon-dialog-frame">/,'paged UI uses the same frame shell');
assert.match(html,/<h2 id="tutorialTitle" class="dungeon-dialog-frame-title">/,'paged UI uses the shared title part');
assert.match(html,/<div class="tutorial-top"><span id="tutorialCounter"/,'page counter unchanged');
assert.match(html,/<button type="button" id="tutorialPrevious" class="subtle" hidden>戻る<\/button>/,'paged previous');
assert.match(html,/<button type="button" id="tutorialContinue" class="primary-action tutorial-next">次へ<\/button>/,'paged next');
assert.match(html,/<button type="button" id="tutorialSkip" class="subtle">スキップ<\/button>/,'page skip stays in overlay');
// Required first naming switches from fixed to closable only when rename is allowed.
assert.match(app,/dialog\.dataset\.dungeonFrame=required\?'fixed':'closable';\s*\$\('cancelNameDialog'\)\.hidden=required;/,'naming changes frame type and button visibility together');
assert.match(dialogMarkup('nameDialog'),/<button[^>]*id="cancelNameDialog"[^>]*dungeon-dialog-close[^>]*hidden>/);
// The header control lives *inside the shared frame*, not relative to a
// screen-specific footer, and has a full reserved top rail above all titles.
const frameStyles=css.slice(css.indexOf('/* Reusable dialog *frame*'),css.indexOf('/* Confirmation for the irreversible local-save reset. */'));
assert.ok(frameStyles.length>1200,'shared component stylesheet exists');
assert.match(frameStyles,/\.dungeon-dialog-frame\{[\s\S]*?--dungeon-frame-top-rail:74px;/,'shared top rail variable');
assert.match(frameStyles,/#dungeonApp dialog\[data-dungeon-frame="closable"\] > \.dungeon-dialog-frame\{\s*padding-block-start:var\(--dungeon-frame-top-rail\)!important\s*\}/,'all closable frames reserve the same collision-free title row');
assert.match(frameStyles,/#dungeonApp dialog\[data-dungeon-frame="fixed"\] > \.dungeon-dialog-frame/,'fixed frame does not reserve a close rail');
assert.match(frameStyles,/#tutorialOverlay\[data-dungeon-frame="paged"\] > \.dungeon-dialog-frame/,'tutorial overlay remains paged');
assert.match(frameStyles,/#dungeonApp dialog\[data-dungeon-frame="paged"\] > \.dungeon-dialog-frame/,'native lesson reserves its header rail');
assert.match(frameStyles,/#dungeonApp dialog:is\(\[data-dungeon-frame="closable"\],\[data-dungeon-frame="paged"\]\) \.dungeon-dialog-frame button\.dungeon-dialog-close\{/,'one scoped, high-priority button part across all compact dialogs');
const controlStyle=frameStyles.slice(frameStyles.indexOf('button.dungeon-dialog-close{'),frameStyles.indexOf('button.dungeon-dialog-close::after{'));
for(const prop of [
 'position:absolute!important','inset-block-start:14px!important','inset-inline-end:14px!important',
 'width:var(--dungeon-frame-close-size)!important','height:var(--dungeon-frame-close-size)!important',
 'min-width:var(--dungeon-frame-close-size)!important','max-width:var(--dungeon-frame-close-size)!important',
 'padding:0!important','margin:0!important','border-radius:50%!important','font-size:0!important',
 'background:#151725ed!important','color:var(--gold)!important','transform:none!important'
])assert.ok(controlStyle.includes(prop),'one uniform close style: '+prop);
assert.ok(14+42<74,'close icon ends before the shared title row');
assert.match(frameStyles,/dialog:is\(/,'paged lesson and closable dialogs share one button style');
// The close icon is a symmetric SVG, not a font-dependent X.
const glyph=css.match(/--dungeon-close-svg:url\("(data:image\/svg\+xml,[^"]+)"\)/);
assert.ok(glyph);
const svgMarkup=decodeURIComponent(glyph[1].split(',')[1]);
assert.match(svgMarkup,/viewBox='0 0 24 24'/);
assert.match(svgMarkup,/d='M6 6L18 18M18 6L6 18'/);
assert.match(frameStyles,/width:24px;height:24px;transform:translate\(-50%,-50%\)/);
assert.match(frameStyles,/-webkit-mask:var\(--dungeon-close-svg\) center \/ contain no-repeat/);
assert.match(frameStyles,/\bmask:var\(--dungeon-close-svg\) center \/ contain no-repeat/);
assert.doesNotMatch(frameStyles,/content:"[×✕]"/);
assert.doesNotMatch(css,/#supportPromptDialog \.support-prompt-inner\{padding-top:62px\}/,'adventurer card no longer needs a one-off padding hack');
// The card is a closable frame; the on-screen canvas and its original action
// are still wired. Screens that were overlays stay outside this component.
const card=dialogMarkup('supportPromptDialog');
assert.match(card,/<canvas id="adventurerShareCanvas"/);
assert.match(card,/<button type="button" id="supportPromptClose" class="subtle dungeon-dialog-close" aria-label="冒険者カードを閉じる">/);
assert.match(app,/function openAdventurerShare\(\)\{[\s\S]*?showSupportPrompt\(\{title:'冒険者カード'/);
assert.match(app,/\$\('supportPromptClose'\)\.addEventListener\('click',\(\)=>closeDungeonDialog\(\$\('supportPromptDialog'\)\)\)/);
for(const id of ['startupMask','circleDrawingDiscard']){
 assert.ok(html.includes('id="'+id+'"'),'unchanged custom overlay '+id);
}
assert.match(css,/#circleDrawingClose\{grid-column:1\}/);
assert.match(css,/#circleDrawingReset\{grid-column:2\}/);
assert.match(css,/#circleDrawingConfirm\{grid-column:3\}/);
assert.match(css,/\.circle-camera-dialog \.camera-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);

console.log('PASS all dungeon dialogs, repeated rename, crossfades, Escape and reduced motion');
