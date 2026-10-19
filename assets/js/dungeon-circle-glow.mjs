// The profile card's exact ink segmentation: local exposure normalization,
// Sobel edges and colored alpha. Render only when a ritual is requested.
import {circleOutlinePixels} from './dungeon-card-art.mjs?v=20261020.12';
export async function paintCircleGlow(canvas,photo,attribute){
 if(!canvas||!photo||typeof document==='undefined')return false;
 try{
  // Wait for the actual photographed image; CSS halos alone cannot reveal ink.
  if(typeof photo.decode==='function')await photo.decode();
  if(!(photo.naturalWidth||photo.videoWidth))return false;
  const size=256;
  const sample=document.createElement('canvas');
  sample.width=size;sample.height=size;
  const sampleCtx=sample.getContext('2d',{willReadFrequently:true});
  if(!sampleCtx)return false;
  sampleCtx.drawImage(photo,0,0,size,size);
  const outline=circleOutlinePixels(sampleCtx.getImageData(0,0,size,size),attribute);
  if(!outline.some((value,index)=>index%4===3&&value>14))return false;
  const mask=sampleCtx.createImageData(size,size);
  mask.data.set(outline);
  sampleCtx.clearRect(0,0,size,size);
  sampleCtx.putImageData(mask,0,0);
  const ctx=canvas.getContext('2d');
  if(!ctx)return false;
  canvas.width=size;canvas.height=size;
  ctx.clearRect(0,0,size,size);
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  ctx.imageSmoothingEnabled=true;
  // Same multi-radius bloom as paintCircleArt(), stronger for a temporary reveal.
  for(const [blur,alpha] of [[15,.95],[6,1],[2,1],[0,1]]){
   ctx.filter=blur?'blur('+blur+'px)':'none';
   ctx.globalAlpha=alpha;
   ctx.drawImage(sample,0,0,size,size);
  }
  ctx.restore();
  return true;
 }catch(error){
  console.warn('魔法陣の発光輪郭を生成できませんでした',error);
  return false;
 }
}
