import {highestRankLayer,rankTitle,rankMetalPalette} from './dungeon-ranks.mjs';
import {deepestReachedLayer,deepestReturnedLayer,hasHundredFloorCrown} from './dungeon-progress.mjs';
import {paintCircleArt} from './dungeon-card-art.mjs?v=20261020.33';

export const DUNGEON_SHARE_URL='https://katsuya100.github.io/magia-fantasy-larp-tool/dungeon.html';
export function adventurerShareData(profile){
 const level=Number(profile?.level);
 return {
  rank:rankTitle(highestRankLayer(profile)),
  rankLayer:highestRankLayer(profile),
  level:Number.isSafeInteger(level)&&level>0?level:1,
  name:String(profile?.name||'名もなき冒険者').trim().slice(0,20),
  crowned:hasHundredFloorCrown(profile),
  deepestReached:deepestReachedLayer(profile),
  deepestReturned:deepestReturnedLayer(profile)
 };
}
export function adventurerShareText(data){
 return [
  'マギアサークル-ダンジョンアタック',
  '冒険者等級：'+data.rank,
  'Lv.'+data.level,
  '最深到達階層：'+(data.deepestReached?data.deepestReached+'層':'未到達'),
  '最深帰還階層：'+(data.deepestReturned?data.deepestReturned+'層':'未到達')
 ].join('\n');
}
export function adventurerXUrl(data){
 const params=new URLSearchParams({text:adventurerShareText(data),url:DUNGEON_SHARE_URL});
 return 'https://x.com/intent/tweet?'+params.toString();
}

// Pure browser Canvas rendering. The saved PNG includes the character name
// by design; the X-post text omits it so only the image exposes the name.
export function paintAdventurerCard(canvas,data,artwork=null){
 if(!canvas?.getContext)throw Error('画像を作成できませんでした。');
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('画像を作成できませんでした。');
 const width=1200,height=675;
 canvas.width=width;canvas.height=height;
 const bg=ctx.createLinearGradient(0,0,width,height);
 bg.addColorStop(0,'#24172b');bg.addColorStop(.52,'#111c2b');bg.addColorStop(1,'#080d19');
 ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
 const glow=ctx.createRadialGradient(918,309,30,918,309,420);
 glow.addColorStop(0,'#74503466');glow.addColorStop(1,'#74503400');
 ctx.fillStyle=glow;ctx.fillRect(510,0,690,675);
 ctx.strokeStyle='#c5a06a';ctx.lineWidth=3;ctx.strokeRect(29,29,width-58,height-58);
 ctx.strokeStyle='#c5a06a66';ctx.lineWidth=1;ctx.strokeRect(41,41,width-82,height-82);
 ctx.fillStyle='#ddbe85';ctx.font='600 22px Georgia, serif';ctx.fillText('MAGIA CIRCLE  /  DUNGEON ATTACK',82,101);
 ctx.fillStyle='#f6e4c2';ctx.font='600 34px sans-serif';ctx.fillText('マギアサークル - ダンジョンアタック',82,157,630);
 ctx.strokeStyle='#ae8b5866';ctx.beginPath();ctx.moveTo(82,184);ctx.lineTo(688,184);ctx.stroke();
 // Reserve a dedicated name panel to the LEFT of the rank plaque.
 // Both panels remain inside the original 82–688 layout, clear of the magic seal.
 const nameX=82,nameW=248,rankX=342,rankW=346,plaqueY=260,plaqueH=106;
 ctx.fillStyle='#adabb8';ctx.font='600 21px sans-serif';
 ctx.fillText('冒険者名',nameX+10,242);
 ctx.fillText('冒険者等級',rankX+10,242);
 const namePlate=ctx.createLinearGradient(nameX,plaqueY,nameX+nameW,plaqueY+plaqueH);
 namePlate.addColorStop(0,'#38293e');namePlate.addColorStop(1,'#162335');
 ctx.fillStyle=namePlate;ctx.fillRect(nameX,plaqueY,nameW,plaqueH);
 ctx.strokeStyle='#c9a46b';ctx.lineWidth=2;ctx.strokeRect(nameX,plaqueY,nameW,plaqueH);
 ctx.strokeStyle='#f1d6a457';ctx.lineWidth=1;ctx.strokeRect(nameX+6,plaqueY+6,nameW-12,plaqueH-12);
 // Use up to three centered lines; preserve the last line's space for a crown.
 const heroName=data.name||'名もなき冒険者';
 const nameTextWidth=data.crowned?186:220;
 let nameFont=26,nameLines=[];
 const nameMeasure=value=>ctx.measureText?.(value)?.width??[...value].length*nameFont;
 for(;nameFont>=18;nameFont--){
  ctx.font='700 '+nameFont+'px sans-serif';
  nameLines=[''];
  for(const char of [...heroName]){
   const last=nameLines.length-1;
   if(nameLines[last]&&nameMeasure(nameLines[last]+char)>nameTextWidth)
    nameLines.push(char);
   else nameLines[last]+=char;
  }
  if(nameLines.length<=3)break;
 }
 const lineGap=nameFont+5,firstBaseline=320-(nameLines.length-1)*lineGap/2;
 ctx.fillStyle='#fff0d4';ctx.shadowColor='#e9ba7d7a';ctx.shadowBlur=7;
 for(const [index,line] of nameLines.entries())
  ctx.fillText(line,nameX+14,firstBaseline+index*lineGap,nameTextWidth);
 ctx.shadowBlur=0;
 if(data.crowned){
  const last=nameLines.at(-1)||'',lastWidth=nameMeasure(last);
  ctx.font='29px sans-serif';
  ctx.fillText('👑',Math.min(nameX+nameW-37,nameX+19+lastWidth),
   firstBaseline+(nameLines.length-1)*lineGap,30);
 }
 // The rank plaque mirrors the profile's --rank-light/mid/deep/glow insignia.
 const metal=rankMetalPalette(data.rankLayer);
 const plate=ctx.createLinearGradient(rankX,plaqueY,rankX+rankW,plaqueY+plaqueH);
 plate.addColorStop(0,metal.deep);plate.addColorStop(.48,'#151422');plate.addColorStop(1,metal.deep);
 ctx.fillStyle=plate;ctx.fillRect(rankX,plaqueY,rankW,plaqueH);
 ctx.lineWidth=3;ctx.strokeStyle=metal.mid;ctx.strokeRect(rankX,plaqueY,rankW,plaqueH);
 const shine=ctx.createLinearGradient(0,265,0,358);
 shine.addColorStop(0,'#ffffff33');shine.addColorStop(.4,'#ffffff0a');shine.addColorStop(1,'#ffffff00');
 ctx.fillStyle=shine;ctx.fillRect(rankX+3,plaqueY+3,rankW-6,plaqueH-7);
 const lettering=ctx.createLinearGradient(rankX+20,0,rankX+rankW-20,0);
 if(data.rankLayer===90){
  for(const [at,color] of [[0,'#a28df9'],[.34,'#ebd2ff'],[.52,'#ffffff'],[.72,'#baa4ff'],[1,'#8ddce9']])lettering.addColorStop(at,color);
 }else if(data.rankLayer===100){
  for(const [at,color] of [[0,'#ffd7ba'],[.25,'#fff4b2'],[.48,'#fffefa'],[.68,'#c6e7ff'],[.88,'#f9b7ef'],[1,'#ffd680']])lettering.addColorStop(at,color);
 }else{
  for(const [at,color] of [[0,metal.mid],[.31,metal.light],[.49,'#fffdf3'],[.68,metal.light],[1,metal.mid]])lettering.addColorStop(at,color);
 }
 ctx.shadowColor=metal.glow;ctx.shadowBlur=14;
 ctx.fillStyle=lettering;
 let rankFont=56;
 while(rankFont>32){
  ctx.font='800 '+rankFont+'px sans-serif';
  const width=ctx.measureText?.(data.rank)?.width??[...data.rank].length*rankFont;
  if(width<=rankW-40)break;
  rankFont-=2;
 }
 ctx.fillText(data.rank,rankX+20,335,rankW-40);
 ctx.shadowBlur=0;
 ctx.fillStyle='#adabb8';ctx.font='600 20px sans-serif';
 ctx.fillText('LEVEL',83,411);
 ctx.fillText('最深到達階層',255,411);
 ctx.fillText('最深帰還階層',466,411);
 ctx.fillStyle='#fbebcb';ctx.font='700 42px sans-serif';
 ctx.fillText('Lv.'+data.level,83,483,145);
 ctx.fillText(data.deepestReached?data.deepestReached+'層':'未到達',255,483,190);
 ctx.fillText(data.deepestReturned?data.deepestReturned+'層':'未到達',466,483,172);
 ctx.strokeStyle='#a8845566';ctx.beginPath();ctx.moveTo(237,393);ctx.lineTo(237,490);ctx.moveTo(454,393);ctx.lineTo(454,490);ctx.stroke();
 // Prefer extracted photo contours; retain the geometric seal as the fallback.
 if(!paintCircleArt(ctx,artwork)){
 const cx=917,cy=335;
 for(const [radius,alpha] of [[184,.68],[161,.46],[117,.55],[93,.36]]){
  ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);
  ctx.strokeStyle='rgba(224,190,133,'+alpha+')';ctx.lineWidth=radius===184?3:2;ctx.stroke();
 }
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6-Math.PI/2;
  ctx.beginPath();
  ctx.moveTo(cx+125*Math.cos(angle),cy+125*Math.sin(angle));
  ctx.lineTo(cx+180*Math.cos(angle),cy+180*Math.sin(angle));
  ctx.strokeStyle='#e4c58b80';ctx.lineWidth=2;ctx.stroke();
 }
 ctx.beginPath();
 for(let i=0;i<8;i++){
  const angle=i*Math.PI/4-Math.PI/2;
  const x=cx+117*Math.cos(angle),y=cy+117*Math.sin(angle);
  if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
 }ctx.closePath();ctx.strokeStyle='#d2ab73aa';ctx.lineWidth=2;ctx.stroke();
 ctx.fillStyle='#f9dd9b';ctx.font='116px Georgia, serif';ctx.textAlign='center';ctx.fillText('✦',cx,cy+43);
 }
 ctx.textAlign='start';
 ctx.strokeStyle='#ae8b5866';ctx.beginPath();ctx.moveTo(82,548);ctx.lineTo(1116,548);ctx.stroke();
 ctx.fillStyle='#c6b4a4';ctx.font='20px Georgia, serif';ctx.fillText('ADVENTURER CARD',82,594);
 ctx.textAlign='right';ctx.fillText('THE ARCANE EXPEDITION',1115,594);ctx.textAlign='start';
 return canvas;
}
