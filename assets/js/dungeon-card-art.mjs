// Saved favorite photo takes priority over the first equipped spell.
export const ATTRIBUTE_GLOW={
 flame:'#ff914f',bolt:'#ffe272',aqua:'#71dcff',storm:'#a5f5ad',
 gravity:'#bb9aff',law:'#ffe5a0',chaos:'#ff94d9'
};
export function selectCardCircle(circles,favoriteId,slots){
 const byId=new Map((Array.isArray(circles)?circles:[]).map(circle=>[circle.id,circle]));
 return byId.get(favoriteId)||byId.get(Array.isArray(slots)?slots[0]:null)||null;
}
// Sobel edge extraction turns a photographed circle into a colored alpha mask.
export function circleOutlinePixels({width,height,data},attribute){
 if(!Number.isInteger(width)||!Number.isInteger(height)||data?.length!==width*height*4)throw Error('Invalid circle image');
 const color=ATTRIBUTE_GLOW[attribute]||'#e8c98c';
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 const gray=new Float32Array(width*height),out=new Uint8ClampedArray(data.length);
 for(let i=0;i<gray.length;i++)gray[i]=data[4*i]*.2126+data[4*i+1]*.7152+data[4*i+2]*.0722;
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
// Additive screen glow over the card, with an unblurred contour on top.
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
  // Let the outline visually reach the decorative rim without covering the card text.
  const cx=920,cy=328,diameter=468;
  ctx.save();
  ctx.beginPath();ctx.arc(cx,cy,229,0,Math.PI*2);ctx.clip();
  ctx.globalCompositeOperation='lighter';
  ctx.filter='blur(19px)';ctx.globalAlpha=.85;
  ctx.drawImage(source,cx-diameter/2,cy-diameter/2,diameter,diameter);
  ctx.filter='blur(6px)';ctx.globalAlpha=.95;
  ctx.drawImage(source,cx-diameter/2,cy-diameter/2,diameter,diameter);
  ctx.filter='none';ctx.globalAlpha=1;
  ctx.drawImage(source,cx-diameter/2,cy-diameter/2,diameter,diameter);
  ctx.restore();
  return true;
 }catch(error){
  console.warn('魔法陣の輪郭描画に失敗しました',error);
  return false;
 }
}
