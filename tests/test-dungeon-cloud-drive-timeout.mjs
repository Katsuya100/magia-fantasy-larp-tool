import assert from 'node:assert/strict';
import {createDungeonDrive} from '../assets/js/dungeon-cloud-drive.mjs';

// A stalled Google API request must not leave 「保存中…」 visible forever.
// The injected fetch mimics a stalled connection that reacts to abort.
let cancelled=0;
const stalled=(_url,options)=>new Promise((_resolve,reject)=>{
 options.signal?.addEventListener('abort',()=>{
  cancelled++;
  reject(new DOMException('request aborted','AbortError'));
 },{once:true});
});
const drive=createDungeonDrive('test-token',stalled,{timeoutMs:30});
const watchdog=new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('request never times out')),500));
await assert.rejects(Promise.race([drive.list(),watchdog]),/タイムアウト/);
assert.equal(cancelled,1,'a timed-out Drive request also cancels the network fetch');
console.log('PASS stalled Google Drive requests terminate and release syncing UI');
