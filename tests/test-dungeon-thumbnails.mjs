import assert from 'node:assert/strict';
import {createCircleThumbnails} from '../assets/js/dungeon-thumbnails.mjs';

const priorDocument=globalThis.document;
globalThis.document={baseURI:'https://example.test/magia-fantasy-larp-tool/'};
const store=new Map(),created=[],revoked=[],started=[];
let running=0,peak=0,releaseFirst=null;
const gate=new Promise(resolve=>releaseFirst=resolve);
let productionCount=0;
const factory=()=>createCircleThumbnails({
 makeThumbnail:async source=>{
  const call=++productionCount;
  started.push(call);running++;peak=Math.max(peak,running);
  if(call===1)await gate;
  const result=new Blob(['thumb:'+await source.text()],{type:'image/jpeg'});
  running--;return result;
 },
 openCache:async()=>({
  match:async key=>store.get(key)?.clone()||null,
  put:async(key,response)=>{store.set(key,response.clone());}
 }),
 createUrl:blob=>{const url='blob:thumb-'+(created.length+1);created.push({url,blob});return url;},
 revokeUrl:url=>revoked.push(url)
});
try{
 const first={id:'a',image:new Blob(['large-photo-a'],{type:'image/jpeg'})};
 const second={id:'b',image:new Blob(['large-photo-b'],{type:'image/jpeg'})};
 const proofs={a:'a'.repeat(64),b:'b'.repeat(64)};
 const thumbs=factory();thumbs.setProofs(proofs);
 const a=thumbs.get(first),b=thumbs.get(second);
 await Promise.resolve();
 assert.equal(started.length,1,'never begin a second decode while one is active');
 const pause=thumbs.pause();
 releaseFirst();
 await pause;
 assert.equal(started.length,1,'pausing for OCR drains the current decode and blocks all new decodes');
 const aUrl=await a;
 assert.match(aUrl,/blob:thumb-/);
 thumbs.resume();
 const bUrl=await b;
 assert.notEqual(aUrl,bUrl);
 assert.equal(peak,1,'at most one high-resolution source is ever decoded');
 assert.equal(store.size,2,'thumbs are persisted separately by signed-image proof');
 assert.equal(await first.image.text(),'large-photo-a','original saved photo is never modified');
 assert.equal(created[0].blob.type,'image/jpeg');
 const onNextPage=factory();onNextPage.setProofs(proofs);
 const before=productionCount;
 const cachedUrl=await onNextPage.get(first);
 assert.match(cachedUrl,/blob:thumb-/);
 assert.equal(productionCount,before,'persisted thumbnail is reused without decoding large photo');
 const changed={id:'a',image:new Blob(['replaced-photo'],{type:'image/jpeg'})};
 onNextPage.forget('a');
 onNextPage.setProof('a','c'.repeat(64));
 const replacement=await onNextPage.get(changed);
 assert.match(replacement,/blob:thumb-/);
 assert.equal(productionCount,before+1,'new verified hash prevents old thumbnail reuse');
 assert.equal(revoked.length>0,true,'replaced cached object URL is revoked');
 const third={id:'c',image:new Blob(['third-photo'],{type:'image/jpeg'})};
 onNextPage.setProof('c','d'.repeat(64));
 onNextPage.forget('a');
 const thirdUrl=await onNextPage.get(third);
 assert.match(thirdUrl,/blob:thumb-/,'unrelated previews survive individual repairs');
 thumbs.releaseAll();onNextPage.releaseAll();
}finally{globalThis.document=priorDocument;}
console.log('PASS serial/lazy thumbnail caching, signed proof invalidation, original Blob preservation and OCR pause');
