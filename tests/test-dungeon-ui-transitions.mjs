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
assert.equal(dialogs.length,17,'all dungeon dialogs are still present');
assert.equal(new Set(dialogs).size,17);
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


// A single visible close primitive is reused while existing control IDs and
// handlers remain untouched, including the drawing editor's Close/Back mode.
const optionalClosers={
 nameDialog:'cancelNameDialog',
 loadoutDialog:'closeLoadoutDialog',
 circleDrawingDialog:'circleDrawingClose',
 circleCameraDialog:'cameraStop',
 magicDetailsDialog:'closeMagicDetails',
 circleActionDialog:'cancelCircleAction',
 magicStoneTutorialDialog:'closeMagicStoneTutorial',
 creatorCongratulationsDialog:'creatorCongratulationsClose',
 milestoneChoiceDialog:'milestoneClose',
 supportPromptDialog:'supportPromptClose',
 imageRepairDialog:'imageRepairLater',
 googleDriveConflictDialog:'data-action="later"',
 googleDriveOverwriteDialog:'data-action="back"',
 googleDriveExpiredDialog:'data-action="later"',
 deleteDataDialog:'cancelDeleteData'
};
assert.equal(Object.keys(optionalClosers).length,15);
for(const [dialogId,buttonId] of Object.entries(optionalClosers)){
 const dialogStart=html.indexOf('<dialog id="'+dialogId+'"');
 const dialogEnd=html.indexOf('</dialog>',dialogStart);
 assert.ok(dialogStart>=0&&dialogEnd>dialogStart,'dialog exists: '+dialogId);
 const segment=html.slice(dialogStart,dialogEnd);
 const buttonTags=[...segment.matchAll(/<button\b[^>]*>/g)].map(match=>match[0]);
 const closers=buttonTags.filter(tag=>tag.includes('dungeon-dialog-close'));
 assert.equal(closers.length,1,'exactly one shared close control: '+dialogId);
 assert.ok(closers[0].includes(buttonId.startsWith('data-action')?buttonId:'id="'+buttonId+'"'),'existing handler kept: '+dialogId);
}
// Required/acknowledgement dialogs are not silently dismissible.
// The cancel button for required naming is still initially hidden.
for(const dialogId of ['backupSetupDialog','saveErrorDialog']){
 const segment=html.slice(html.indexOf('<dialog id="'+dialogId+'"'),html.indexOf('</dialog>',html.indexOf('<dialog id="'+dialogId+'"')));
 assert.doesNotMatch(segment,/dungeon-dialog-close/,'mandatory decision remains explicit: '+dialogId);
}
assert.match(html,/<button[^>]*id="cancelNameDialog"[^>]*dungeon-dialog-close[^>]*hidden>/);
assert.match(html,/<button[^>]*dungeon-dialog-close[^>]*data-action="later"[^>]*hidden>/);
assert.match(css,/dialog button\.dungeon-dialog-close\{[^}]*position:absolute!important;[^}]*width:42px!important;[^}]*height:42px!important;/);
assert.match(css,/dialog button\.dungeon-dialog-close:focus-visible\{outline:3px/);
assert.match(css,/dialog button\.dungeon-dialog-close\[hidden\]\{display:none!important\}/);
assert.match(css,/#circleDrawingDialog \.circle-drawing-actions\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.25fr\)\}/);
assert.match(css,/dialog\.circle-camera-dialog \.camera-actions\{grid-template-columns:minmax\(0,1fr\)\}/);
assert.match(css,/#circleDrawingDialog #circleDrawingReset\{grid-column:1\}/);
assert.match(css,/#circleDrawingDialog #circleDrawingConfirm\{grid-column:2\}/);

console.log('PASS all dungeon dialogs, repeated rename, crossfades, Escape and reduced motion');
