// Saved favorite photo takes priority over the first equipped spell.
export const ATTRIBUTE_GLOW={
 flame:'#ff914f',bolt:'#ffe272',aqua:'#71dcff',storm:'#a5f5ad',
 gravity:'#bb9aff',law:'#ffe5a0',chaos:'#ff94d9'
};
export function selectCardCircle(circles,favoriteId,slots){
 const byId=new Map((Array.isArray(circles)?circles:[]).map(circle=>[circle.id,circle]));
 return byId.get(favoriteId)||byId.get(Array.isArray(slots)?slots[0]:null)||null;
}
// Locally normalize exposure before edge detection. Broad shadows become
// white paper, while ink stays dark, even under uneven room lighting.
function cleanInkMask(gray,width,height){
 const stride=width+1,integral=new Float64Array(stride*(height+1));
 for(let y=0;y<height;y++){
  let row=0;
  for(let x=0;x<width;x++){
   row+=gray[y*width+x];
   integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;
  }
 }
 const radius=Math.max(1,Math.round(Math.min(width,height)*.07));
 const mask=new Uint8Array(gray.length);
 for(let y=0;y<height;y++){
  const y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
  for(let x=0;x<width;x++){
   const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1);
   const sum=integral[y1*stride+x1]-integral[y0*stride+x1]
    -integral[y1*stride+x0]+integral[y0*stride+x0];
   const paper=sum/((x1-x0)*(y1-y0)),i=y*width+x;
   const exposure=Math.min(255,gray[i]*255/Math.max(48,paper));
   const contrast=Math.max(0,Math.min(255,(exposure-128)*1.5+150));
   // Require both dark ink after white balance and substantial local contrast.
   mask[i]=contrast<205&&paper-gray[i]>40?0:255;
  }
 }
 return mask;
}
// Sobel edge extraction turns the cleaned black-ink mask into colored alpha.
export function circleOutlinePixels({width,height,data},attribute){
 if(!Number.isInteger(width)||!Number.isInteger(height)||data?.length!==width*height*4)throw Error('Invalid circle image');
 const color=ATTRIBUTE_GLOW[attribute]||'#e8c98c';
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 const luminance=new Float32Array(width*height),out=new Uint8ClampedArray(data.length);
 for(let i=0;i<luminance.length;i++)luminance[i]=data[4*i]*.2126+data[4*i+1]*.7152+data[4*i+2]*.0722;
 const gray=cleanInkMask(luminance,width,height);
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const i=y*width+x,top=i-width,bot=i+width;
  const gx=-gray[top-1]+gray[top+1]-2*gray[i-1]+2*gray[i+1]-gray[bot-1]+gray[bot+1];
  const gy=-gray[top-1]-2*gray[top]-gray[top+1]+gray[bot-1]+2*gray[bot]+gray[bot+1];
  const edge=Math.min(1,Math.max(0,(Math.hypot(gx,gy)-85)/290));
  const radius=Math.hypot((x+.5-width/2)/(width/2),(y+.5-height/2)/(height/2));
  const fade=Math.min(1,Math.max(0,(1.01-radius)*16));
  const pos=i*4;
  out[pos]=rgb[0];out[pos+1]=rgb[1];out[pos+2]=rgb[2];out[pos+3]=Math.round(255*edge*fade);
 }
 return out;
}
// Gaussian-softened glow only: avoid reintroducing jagged Sobel pixels with a hard core.
export function paintCircleArt(ctx,artwork){
 if(!artwork?.image||typeof document==='undefined')return false;
 try{
  const source=document.createElement('canvas'),size=256;
  source.width=size;source.height=size;
  const sctx=source.getContext('2d',{willReadFrequently:true});
  if(!sctx)return false;
  sctx.drawImage(artwork.image,0,0,size,size);
  const pixels=circleOutlinePixels(sctx.getImageData(0,0,size,size),artwork.attribute);
  const result=sctx.createImageData(size,size);
  result.data.set(pixels);
  sctx.clearRect(0,0,size,size);
  sctx.putImageData(result,0,0);
  // Blur a separate mask *before* the additive passes, so no raw jagged
  // Sobel pixels are ever composited directly onto the adventurer card.
  const glowBase=document.createElement('canvas');
  glowBase.width=size;glowBase.height=size;
  const gctx=glowBase.getContext('2d');
  if(!gctx)return false;
  gctx.filter='blur(3px)';
  gctx.drawImage(source,0,0);
  gctx.filter='none';
  // Let the outline visually reach the decorative rim without covering the card text.
  const cx=920,cy=328,diameter=468;
  ctx.save();
  ctx.beginPath();ctx.arc(cx,cy,229,0,Math.PI*2);ctx.clip();
  ctx.globalCompositeOperation='lighter';
  ctx.filter='blur(22px)';ctx.globalAlpha=.72;
  ctx.drawImage(glowBase,cx-diameter/2,cy-diameter/2,diameter,diameter);
  ctx.filter='blur(9px)';ctx.globalAlpha=.82;
  ctx.drawImage(glowBase,cx-diameter/2,cy-diameter/2,diameter,diameter);
  // A brighter near glow replaces the previous unblurred sharp core.
  ctx.filter='blur(2px)';ctx.globalAlpha=.98;
  ctx.drawImage(glowBase,cx-diameter/2,cy-diameter/2,diameter,diameter);
  ctx.restore();
  return true;
 }catch(error){
  console.warn('魔法陣の輪郭描画に失敗しました',error);
  return false;
 }
}
