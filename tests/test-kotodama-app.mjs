import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKotodamaDom, repositoryFetch, renderedSnapshot } from './kotodama-harness.mjs';
import { createKotodamaRenderer, escapeHtml } from '../assets/js/kotodama-rendering.js';

const baseline=JSON.parse(await readFile(new URL('../fixtures/kotodama/scoring-baseline.json',import.meta.url),'utf8'));
const inputBaseline=JSON.parse(await readFile(new URL('../fixtures/kotodama/input-baseline.json',import.meta.url),'utf8'));
const dom=createKotodamaDom();
let start;
Object.assign(globalThis,{
  document:dom.document,window:{addEventListener(){}},requestAnimationFrame:callback=>callback(),
  setTimeout:callback=>{start=callback;return 1;},fetch:repositoryFetch,
});
await import('../assets/js/kotodama-app.js');
await start();
assert.equal(dom.get('cast').disabled,false);
assert.ok(dom.get('loadStatus').textContent.includes('400,000'));
for(const {input,rendered} of [...baseline.cases,...inputBaseline.cases]){
  dom.get('spell').value=input;
  await dom.get('cast').handlers.click();
  assert.deepEqual(renderedSnapshot(dom),rendered,`original game output: ${input}`);
}
// An uncached input may take time; editing/clear/random actions must not replace
// the spell snapshot while its exact words are being prepared.
const rareCase=inputBaseline.cases.find(item=>item.input.includes('quasar'));
let releaseChunk,enteredChunk;
const chunkGate=new Promise(resolve=>{releaseChunk=resolve;});
const chunkStarted=new Promise(resolve=>{enteredChunk=resolve;});
globalThis.fetch=async url=>{
  if(/kotodama-input-\d+\.f32$/.test(new URL(url).pathname)){enteredChunk();await chunkGate;}
  return repositoryFetch(url);
};
dom.get('spell').value='fire + heat - reporting';
await dom.get('loadRemoteGlove').handlers.click();
dom.get('spell').value=rareCase.input;
const pendingCast=dom.get('cast').handlers.click();
await chunkStarted;
assert.equal(dom.get('spell').readOnly,true);
assert.equal(dom.get('clearSpell').disabled,true);
dom.get('clearSpell').handlers.click(); dom.get('randomSpell').handlers.click();
assert.equal(dom.get('spell').value,rareCase.input,'queued actions cannot change the in-flight formula');
releaseChunk(); await pendingCast;
assert.deepEqual(renderedSnapshot(dom),rareCase.rendered);
assert.equal(dom.get('spell').readOnly,false);
assert.equal(dom.get('clearSpell').disabled,false);
globalThis.fetch=repositoryFetch;
dom.get('clearSpell').handlers.click();
assert.equal(dom.get('spell').value,'');
dom.get('clearLog').handlers.click();
assert.ok(dom.get('log').textContent.includes('まだ一枚'));

// External errors must create a text node, preserving the warning styling.
const malicious='<img src=x onerror=alert(1)>';
globalThis.fetch=async()=>{throw new Error(malicious);};
await dom.get('loadRemoteGlove').handlers.click();
assert.ok(dom.document.body.classList.contains('load-failed'));
assert.equal(dom.get('loadRemoteGlove').disabled,false,'a failed load must allow a manual retry');
assert.equal(dom.get('loadStatus').children[0].tagName,'SPAN');
assert.ok(dom.get('loadStatus').children[0].textContent.includes(malicious));
assert.equal(dom.get('loadStatus').innerHTML,'','external errors must never become an HTML template');
globalThis.fetch=repositoryFetch;
await dom.get('loadRemoteGlove').handlers.click();
assert.equal(dom.document.body.classList.contains('load-failed'),false);
assert.equal(dom.get('cast').disabled,false);

// Private mode may deny cache deletion as well as cache writes. A refresh still plays.
const warnings=[];
const originalWarn=console.warn;
console.warn=(...args)=>warnings.push(args);
globalThis.caches={async delete(){throw new DOMException('storage denied','SecurityError');},async open(){throw new DOMException('storage denied','SecurityError');}};
try {
  await dom.get('loadRemoteGlove').handlers.click();
  assert.equal(dom.document.body.classList.contains('load-failed'),false);
  assert.equal(dom.get('cast').disabled,false);
  assert.ok(warnings.length >= 2);
} finally { console.warn=originalWarn; delete globalThis.caches; }

assert.equal(escapeHtml(malicious),'&lt;img src=x onerror=alert(1)&gt;');
const renderer=createKotodamaRenderer({$:dom.get,getCandidateVectors:()=>null,getScoring:()=>null,getLogs:()=>[],knownAttrs:new Set()});
renderer.renderNearResults([[malicious,.5]]);
assert.ok(dom.get('nearResults').innerHTML.includes('&lt;img'));
assert.ok(!dom.get('nearResults').innerHTML.includes('<img'));
console.log('PASS_KOTODAMA_APP_ORIGINAL_GAME_DISPLAY_FAILURE_RECOVERY_AND_HTML_SAFETY');
