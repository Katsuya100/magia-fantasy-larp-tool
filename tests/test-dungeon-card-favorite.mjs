import assert from 'node:assert/strict';
import {selectCardCircle,circleOutlinePixels,ATTRIBUTE_GLOW,paintCircleArt} from '../assets/js/dungeon-card-art.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});

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


// A photographed page may have a sharp cast-shadow border. Only ink contours
// should survive: exposure normalization must discard the shadow boundary.
const sw=64,sh=64,photo=new Uint8ClampedArray(sw*sh*4);
for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
 const i=(y*sw+x)*4;
 const ink=(y>=12&&y<=52&&((x>=18&&x<=20)||(x>=47&&x<=49)));
 const value=ink?28:(x<32?165:230);
 photo[i]=photo[i+1]=photo[i+2]=value;photo[i+3]=255;
}
const cleaned=circleOutlinePixels({width:sw,height:sh,data:photo},'flame');
const alpha=(x,y)=>cleaned[(y*sw+x)*4+3];
assert.ok(Math.max(alpha(17,32),alpha(18,32),alpha(20,32),alpha(21,32))>100,
 'dark spell lines under the cast shadow remain visible');
assert.ok(Math.max(alpha(46,32),alpha(47,32),alpha(49,32),alpha(50,32))>100,
 'dark spell lines on the lit paper remain visible');
assert.equal(Math.max(...[30,31,32,33,34].map(x=>alpha(x,32))),0,
 'sharp cast-shadow outline is suppressed before Sobel');
const plain=new Uint8ClampedArray(sw*sh*4);
for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
 const i=(y*sw+x)*4;
 const value=165+Math.round(65*x/(sw-1));
 plain[i]=plain[i+1]=plain[i+2]=value;plain[i+3]=255;
}
const gradient=circleOutlinePixels({width:sw,height:sh,data:plain},'aqua');
assert.equal(gradient[(32*sw+32)*4+3],0,'gradual lighting variation stays transparent');


const drawCalls=[],offscreenDraws=[],canvases=[],clipCircles=[],saveCalls=[];
const originalDocument=globalThis.document;
try{
 globalThis.document={createElement(tag){
  assert.equal(tag,'canvas');
  const canvas={width:0,height:0};
  canvases.push(canvas);
  canvas.getContext=()=>({
   filter:'none',
   drawImage(...args){offscreenDraws.push({canvas,filter:this.filter,args});},
   getImageData:()=>({width:256,height:256,data:new Uint8ClampedArray(256*256*4)}),
   createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
   clearRect(){},putImageData(){}
  });
  return canvas;
 }};
 const ctx={
  filter:'none',globalAlpha:1,globalCompositeOperation:'source-over',
  save(){saveCalls.push('save');},restore(){saveCalls.push('restore');},
  beginPath(){},arc(...args){clipCircles.push(args);},clip(){},
  drawImage(...args){drawCalls.push({args,filter:this.filter,alpha:this.globalAlpha,composite:this.globalCompositeOperation});}
 };
 assert.equal(paintCircleArt(ctx,{image:{},attribute:'aqua'}),true);
}finally{
 if(originalDocument===undefined)delete globalThis.document;
 else globalThis.document=originalDocument;
}
assert.equal(canvases.length,2,'separate original contour and preblurred glow canvases');
assert.deepEqual([canvases[0].width,canvases[0].height,canvases[1].width,canvases[1].height],[256,256,256,256]);
const preblur=offscreenDraws.find(call=>call.canvas===canvases[1]);
assert.equal(preblur?.filter,'blur(3px)','glow mask is Gaussian-blurred before card painting');
assert.equal(preblur?.args[0],canvases[0],'preblur is derived from original extracted outlines');
assert.deepEqual(clipCircles[0].slice(0,3),[920,328,229],'artwork slightly overlaps the decorative frame');
assert.equal(drawCalls.length,4,'three softened glows and an original detailed contour');
assert.deepEqual(drawCalls.map(call=>call.filter),['blur(22px)','blur(9px)','blur(3px)','none'],'glow tiers are laid down before crisp outline');
assert.ok(drawCalls.slice(0,3).every(call=>call.args[0]===canvases[1]),'all glow passes use preblurred mask');
assert.equal(drawCalls[3].args[0],canvases[0],'unblurred original contour retains the center detail');
assert.ok(drawCalls.every(call=>call.args[3]===468&&call.args[4]===468),'all artwork layers use enlarged 468px diameter');
assert.ok(drawCalls.every(call=>call.composite==='lighter'),'glow and detailed outline retain additive blend');
assert.ok(drawCalls[3].alpha<1,'detail stays visible without becoming overly harsh');
assert.deepEqual(saveCalls,['save','restore'],'glow compositing state restored');

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
