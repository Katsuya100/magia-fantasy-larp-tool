import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';

const wait=async(check,message)=>{
 const end=Date.now()+9000;
 while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
 assert.ok(check(),message);
};
// Keep the first CSV response outstanding to verify that the loading overlay
// cannot be dismissed before the data and saved profile are ready.
const slow=fakeDungeonBrowser();
const get=id=>slow.document.getElementById(id);
let releaseFetch;
const gate=new Promise(resolve=>{releaseFetch=resolve;});
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{await gate;return originalFetch(url);};
try{
 await import('../assets/js/dungeon-app.mjs?integration=startup-overlay-slow');
 await wait(()=>get('startupDetail').textContent.includes('迷宮の資料を読み込んでいる'),'startup has reached CSV loading');
 assert.equal(get('startupMask').hidden,false,'the overlay stays visible until actual loading finishes');
 assert.notEqual(get('dungeonApp').attributes['aria-busy'],'false','game stays busy until startup completes');
 assert.equal(get('startupRetry').hidden,false,'fake DOM does not parse static hidden attributes; the loading state has not reported an error');
 releaseFetch();
 await wait(()=>get('startupMask').hidden===true,'loading overlay closes on successful startup');
 assert.equal(get('dungeonApp').attributes['aria-busy'],'false');
 assert.equal(get('nameDialog').open,true,'new adventurer naming begins after the loader closes');
}finally{releaseFetch();globalThis.fetch=originalFetch;slow.restore();}
const failure=fakeDungeonBrowser();
const failFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:false,status:503,text:async()=>''});
try{
 await import('../assets/js/dungeon-app.mjs?integration=startup-overlay-fetch-failed');
 await wait(()=>getFail('startupMask').dataset.state==='error','failed download shows startup error');
 function getFail(id){return failure.document.getElementById(id);}
 assert.equal(getFail('startupMask').hidden,false);
 assert.match(getFail('startupTitle').textContent,/開かなかった/);
 assert.match(getFail('startupDetail').textContent,/取得に失敗/);
 assert.equal(getFail('startupRetry').hidden,false,'user can reload from the error screen');
 assert.notEqual(getFail('dungeonApp').attributes['aria-busy'],'false','a failed startup never unlocks the page');
}finally{globalThis.fetch=failFetch;failure.restore();}
console.log('PASS first-paint startup overlay, real asynchronous gate, naming-dialog order and retryable failure');
