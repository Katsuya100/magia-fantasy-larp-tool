import assert from 'node:assert/strict';
import {paintCircleGlow} from '../assets/js/dungeon-circle-glow.mjs';

// Verify that the actual image contours are converted into painted light,
// rather than relying on circular CSS shadows. Synthetic dark ink on pale paper.
const size=256,rgba=new Uint8ClampedArray(size*size*4);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const isInk=(Math.abs(Math.hypot(x-128,y-128)-78)<3) ||
  (Math.abs(x-128)<2&&y>=50&&y<204);
 const v=isInk?20:244,i=(y*size+x)*4;
 rgba[i]=v;rgba[i+1]=v;rgba[i+2]=v;rgba[i+3]=255;
}
const passes=[];
const mockCtx={
 drawImage(){passes.push({filter:this.filter,alpha:this.globalAlpha});},
 getImageData(){return {width:size,height:size,data:rgba};},
 createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
 clearRect(){},putImageData(data){this.outline=data;},save(){},restore(){}
};
const maskCtx={...mockCtx};
const canvasCtx={...mockCtx};
const originalDocument=globalThis.document;
globalThis.document={createElement:()=>({getContext:()=>maskCtx,width:0,height:0})};
try{
 const target={getContext:()=>canvasCtx,width:0,height:0};
 const photo={naturalWidth:512,decode:async()=>{}};
 const success=await paintCircleGlow(target,photo,'aqua');
 assert.equal(success,true,'real ink yields a contour layer');
 assert.equal(target.width,256);
 assert.ok(maskCtx.outline.data.some((v,i)=>i%4===3&&v>0),'extracted ink has nontransparent edge pixels');
 assert.equal(passes.length,5,'source photo plus four glow/bloom passes are drawn');
 assert.ok(passes.some(x=>x.filter==='blur(15px)'),'broad soft bloom exists');
 assert.ok(passes.some(x=>x.filter==='none'),'central visible outline exists');
}finally{globalThis.document=originalDocument;}
console.log('PASS profile-derived photo outlines drive the temporary ritual bloom');
