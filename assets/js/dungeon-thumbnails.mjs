// Thumbnails are disposable local UI data; original photos remain untouched.
export async function createCircleThumbnail(blob,size=192){
 if(!(blob instanceof Blob)||!blob.size)throw Error('写真がありません。');
 let image=null,url=null,canvas=null;
 try{
  if(typeof createImageBitmap==='function')image=await createImageBitmap(blob);
  else{
   url=URL.createObjectURL(blob);
   image=new Image();
   image.src=url;
   if(typeof image.decode==='function')await image.decode();
   else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('写真を読み込めません。'));});
  }
  if(typeof document==='undefined')throw Error('画像を縮小できません。');
  canvas=document.createElement('canvas');
  canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('画像を縮小できません。');
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  const side=Math.min(width,height);
  ctx.drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,size,size);
  const reduced=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.75));
  if(!(reduced instanceof Blob)||!reduced.size)throw Error('縮小画像を作成できません。');
  return reduced;
 }finally{
  image?.close?.();
  if(image&&!('close' in image))image.src='';
  if(url)URL.revokeObjectURL(url);
  if(canvas){canvas.width=0;canvas.height=0;}
 }
}
