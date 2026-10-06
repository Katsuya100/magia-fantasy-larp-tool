import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKotodamaDom, repositoryFetch, renderedSnapshot } from './kotodama-harness.mjs';
import { createKotodamaRenderer, escapeHtml } from '../assets/js/kotodama-rendering.js';

const baseline=JSON.parse(await readFile(new URL('../fixtures/kotodama/scoring-baseline.json',import.meta.url),'utf8'));
const dom=createKotodamaDom();
let start;
Object.assign(globalThis,{
  document:dom.document,window:{addEventListener(){}},requestAnimationFrame:callback=>callback(),
  setTimeout:callback=>{start=callback;return 1;},fetch:repositoryFetch,
});
await import('../assets/js/kotodama-app.js');
await start();
assert.equal(dom.get('cast').disabled,false);
assert.ok(dom.get('loadStatus').textContent.includes('40,146'));
for(const {input,rendered} of baseline.cases){
  dom.get('spell').value=input;
  await dom.get('cast').handlers.click();
  assert.deepEqual(renderedSnapshot(dom),rendered,`original game output: ${input}`);
}
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
const renderer=createKotodamaRenderer({$:dom.get,getVectors:()=>null,getScoring:()=>null,getLogs:()=>[],knownAttrs:new Set()});
renderer.renderNearResults([[malicious,.5]]);
assert.ok(dom.get('nearResults').innerHTML.includes('&lt;img'));
assert.ok(!dom.get('nearResults').innerHTML.includes('<img'));
console.log('PASS_KOTODAMA_APP_ORIGINAL_GAME_DISPLAY_FAILURE_RECOVERY_AND_HTML_SAFETY');
