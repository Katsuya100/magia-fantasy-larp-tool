// Thumbnails are disposable local UI data; original photos remain untouched.
export async function createCircleThumbnail(blob,size=192){
 if(!(blob instanceof Blob)||!blob.size)throw Error('写真がありません。');
 let image=null,url=null,canvas=null;
 try{
  if(typeof createImageBitmap==='function')image=await createImageBitmap(blob);
  else{
   url=URL.createObjectURL(blob);
   image=new Image();
   if(typeof image.decode==='function'){image.src=url;await image.decode();}
   else await new Promise((resolve,reject)=>{
    image.onload=resolve;
    image.onerror=()=>reject(Error('写真を読み込めません。'));
    image.src=url;
   });
  }
  if(typeof document==='undefined')throw Error('画像を縮小できません。');
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  if(!width||!height)throw Error('画像の大きさを取得できません。');
  const scale=Math.min(1,size/Math.max(width,height));
  canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('画像を縮小できません。');
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
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
