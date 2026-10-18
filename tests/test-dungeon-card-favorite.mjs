import assert from 'node:assert/strict';
import {selectCardCircle,circleOutlinePixels,ATTRIBUTE_GLOW} from '../assets/js/dungeon-card-art.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';

const a={id:'a',image:new Blob(['a']),registeredAt:1,analysis:{attribute:'flame',role:'attack',power:100},revealed:false};
const b={id:'b',image:new Blob(['b']),registeredAt:2,analysis:{attribute:'aqua',role:'attack',power:200},revealed:false};
assert.equal(selectCardCircle([a,b],'b',['a']),b,'favorite overrides first deck slot');
assert.equal(selectCardCircle([a,b],'missing',['a']),a,'deleted favorite falls back to slot 1');
assert.equal(selectCardCircle([a,b],null,[null,'b']),null,'empty first slot keeps original seal');
assert.equal(selectCardCircle([],null,['a']),null,'empty grimoire keeps original seal');
assert.equal(ATTRIBUTE_GLOW.aqua,'#71dcff');

const width=9,height=9,data=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const i=(y*width+x)*4;
 data[i]=data[i+1]=data[i+2]=x<4?0:255;data[i+3]=255;
}
const pixels=circleOutlinePixels({width,height,data},'aqua');
assert.equal(pixels.length,data.length);
const edgeIndex=(4*width+4)*4;
assert.ok(pixels[edgeIndex+3]>0,'strong boundary survives extraction');
assert.deepEqual([...pixels.slice(edgeIndex,edgeIndex+3)],[0x71,0xdc,0xff],'colorized to aqua');
assert.equal(pixels[(4*width+1)*4+3],0,'flat photo background removed');

const factory=fakeIndexedDB(),db=await openStore(factory),profile=await getProfile(db);
Object.assign(profile,{name:'試験',tutorialDone:true,slots:['a',null,null,null,null]});
await saveProfile(db,profile);
await putCircle(db,a);await putCircle(db,b);
const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
try{
 await import('../assets/js/dungeon-app.mjs?integration=favorite');
 const deadline=Date.now()+9000;
 while(!$('startupMask').hidden&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
 assert.equal($('startupMask').hidden,true,'dungeon loaded');
 const grid=$('libraryCards');
 const target={closest(selector){
  if(selector==='button')return null;
  if(selector==='[data-circle-id]')return {dataset:{circleId:'b'}};
  return null;
 },matches(selector){return selector==='.card img';}};
 grid.fire('pointerdown',{target,button:0,clientX:10,clientY:10});
 grid.fire('pointerup',{target});
 await new Promise(r=>setTimeout(r,590));
 assert.equal((await getProfile(db)).favoriteCircleId,undefined,'short tap does not set favorite');
 grid.fire('pointerdown',{target,button:0,clientX:10,clientY:10});
 await new Promise(r=>setTimeout(r,620));
 assert.equal((await getProfile(db)).favoriteCircleId,'b','long hold persists the photo ID');
 assert.match(grid.innerHTML,/data-circle-id="b" data-favorite="true"/,'star marker follows saved favorite');
 grid.fire('pointerdown',{target,button:0,clientX:10,clientY:10});
 await new Promise(r=>setTimeout(r,620));
 assert.equal((await getProfile(db)).favoriteCircleId,null,'holding again removes favorite');
 grid.fire('keydown',{target,key:'Enter'});
 await new Promise(r=>setTimeout(r,35));
 assert.equal((await getProfile(db)).favoriteCircleId,'b','keyboard toggles favorite');
}finally{env.restore();}
console.log('PASS favorite long press, toggle, saved ID, art priority and tinted edges');
