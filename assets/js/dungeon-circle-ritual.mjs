import {circleOutlinePixels} from './dungeon-card-art.mjs';

// Purely visual. A failed photo decode must never block saving or casting.
export const CIRCLE_RITUAL_DURATION_MS=800;
const ATTRIBUTES={
 flame:['🔥','炎'],bolt:['⚡','雷'],aqua:['💧','水'],storm:['🌪️','風'],
 gravity:['🪨','重力'],law:['⚖️','秩序'],chaos:['🌀','混沌']
};
const ROLES={attack:['⚔️','攻撃'],defense:['🛡️','防御'],support:['✚','回復'],debuff:['🕸️','弱体']};
export function circleRitualLabels(analysis){
 const attribute=ATTRIBUTES[analysis?.attribute]||['✦','未知'];
 const role=ROLES[analysis?.role]||['✧','未知'];
 return [attribute[0]+' '+attribute[1]+'の相',role[0]+' '+role[1]+'の紋'];
}
function reducedMotion(){
 return typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function element(tag,className){
 const node=document.createElement(tag);node.className=className;return node;
}
async function circleOutline(image,attribute){
 if(!(image instanceof Blob)||typeof document==='undefined')return null;
 let source=null,url=null;
 try{
  if(typeof createImageBitmap==='function'){
   source=await createImageBitmap(image);
  }else if(typeof Image!=='undefined'&&typeof URL?.createObjectURL==='function'){
   url=URL.createObjectURL(image);
   source=new Image();
   source.src=url;
   if(typeof source.decode==='function')await source.decode();
   else await new Promise((resolve,reject)=>{source.onload=resolve;source.onerror=reject;});
  }else return null;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext?.('2d',{willReadFrequently:true});
  if(!ctx)return null;
  ctx.drawImage(source,0,0,256,256);
  const outlined=circleOutlinePixels(ctx.getImageData(0,0,256,256),attribute);
  const imageData=ctx.createImageData(256,256);
  imageData.data.set(outlined);
  ctx.clearRect(0,0,256,256);
  ctx.putImageData(imageData,0,0);
  return canvas;
 }catch{return null;}
 finally{source?.close?.();if(url)URL.revokeObjectURL(url);}
}
function addGlow(stage,outline){
 if(!outline)return;
 for(const cls of ['circle-ritual__bloom','circle-ritual__ink']){
  const canvas=element('canvas',cls);
  canvas.width=256;canvas.height=256;
  canvas.getContext?.('2d')?.drawImage(outline,0,0);
  stage.appendChild(canvas);
 }
}
function stageFor(mode,analysis,outline){
 const root=element('div','circle-ritual circle-ritual--'+mode);
 if(mode==='reveal'){
  const veil=element('div','circle-ritual__veil');
  veil.setAttribute('aria-hidden','true');
  root.appendChild(veil);
 }
 const focus=element('div','circle-ritual__focus');
 const haloIn=element('span','circle-ritual__ring circle-ritual__ring--in');
 const haloOut=element('span','circle-ritual__ring circle-ritual__ring--out');
 const light=element('span','circle-ritual__light');
 for(const node of [haloIn,light,haloOut])node.setAttribute('aria-hidden','true');
 focus.append(haloIn,light);
 addGlow(focus,outline);
 focus.appendChild(haloOut);
 root.appendChild(focus);
 if(mode==='reveal'){
  const labels=element('div','circle-ritual__labels');
  for(const value of circleRitualLabels(analysis)){
   const label=element('span','circle-ritual__label');
   label.textContent=value;labels.appendChild(label);
  }
  root.appendChild(labels);
  root.setAttribute('role','status');
  root.setAttribute('aria-label',circleRitualLabels(analysis).join('、'));
 }else root.setAttribute('aria-hidden','true');
 return root;
}
export async function playCircleReveal(circle){
 if(typeof document==='undefined'||!document.body||reducedMotion())return;
 // Pre-decode while the analyzer scene is still covered, then reveal the saved photo underneath.
 const outline=await circleOutline(circle?.image,circle?.analysis?.attribute);
 const previous=document.querySelector?.('.circle-ritual--reveal');
 previous?.remove();
 const root=stageFor('reveal',circle?.analysis,outline);
 document.body.appendChild(root);
 try{await sleep(CIRCLE_RITUAL_DURATION_MS);}
 finally{root.remove();}
}
export async function playCircleUpgrade(circle,host){
 if(!host||typeof document==='undefined'||reducedMotion())return;
 // Start the halo immediately. A photo that decodes a little later can still join the flash.
 const root=stageFor('upgrade',circle?.analysis,null);
 try{
  host.replaceChildren(root);
  void circleOutline(circle?.image,circle?.analysis?.attribute).then(outline=>{
   if(root.isConnected)addGlow(root.querySelector('.circle-ritual__focus'),outline);
  }).catch(()=>{});
  await sleep(CIRCLE_RITUAL_DURATION_MS);
 }finally{root.remove();}
}
