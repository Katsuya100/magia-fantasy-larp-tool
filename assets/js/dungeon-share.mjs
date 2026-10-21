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
 // Row 1: prominently stretched adventurer name + level.
 // Row 2: adventurer rank, deepest reached and deepest returned.
 // All information remains in the left half, clear of the circle artwork.
 const topY=250,topH=101,bottomY=397,bottomH=104;
 const nameX=82,nameW=420,levelX=514,levelW=174;
 const rankX=82,rankW=258,reachedX=352,reachedW=158,returnedX=522,returnedW=166;
 const label=(text,x,y)=>{ctx.fillStyle='#bbadbd';ctx.font='600 20px sans-serif';ctx.fillText(text,x+9,y);};
 const panel=(x,y,w,h,edge='#c9a46b')=>{
  const bg=ctx.createLinearGradient(x,y,x+w,y+h);
  bg.addColorStop(0,'#38293e');bg.addColorStop(1,'#162335');
  ctx.fillStyle=bg;ctx.fillRect(x,y,w,h);
  ctx.strokeStyle=edge;ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
  ctx.strokeStyle='#f1d6a457';ctx.lineWidth=1;ctx.strokeRect(x+6,y+6,w-12,h-12);
 };
 label('冒険者名',nameX,234);
 label('LEVEL',levelX,234);
 panel(nameX,topY,nameW,topH);
 panel(levelX,topY,levelW,topH);
 const heroName=data.name||'名もなき冒険者';
 const codepoints=[...heroName].length;
 const nameFont=codepoints>15?34:codepoints>10?39:codepoints>6?44:50;
 const availableNameWidth=nameW-34-(data.crowned?45:0),nameStart=nameX+16,nameBaseline=321;
 ctx.font='800 '+nameFont+'px sans-serif';
 const naturalWidth=ctx.measureText?.(heroName)?.width??codepoints*nameFont;
 // Stretch a short name horizontally (up to 1.8x); fit long names on one line.
 const horizontalScale=Math.min(1.8,availableNameWidth/Math.max(1,naturalWidth));
 const stretchedWidth=naturalWidth*horizontalScale;
 ctx.save?.();
 ctx.translate?.(nameStart,nameBaseline);
 ctx.scale?.(horizontalScale,1);
 ctx.fillStyle='#fff2db';ctx.shadowColor='#e9ba7d99';ctx.shadowBlur=10;
 if(ctx.save&&ctx.translate&&ctx.scale&&ctx.restore)ctx.fillText(heroName,0,0);
 else ctx.fillText(heroName,nameStart,nameBaseline,availableNameWidth);
 ctx.shadowBlur=0;
 ctx.restore?.();
 if(data.crowned){
  ctx.fillStyle='#ffe6ad';ctx.font='34px sans-serif';
  ctx.fillText('👑',nameStart+Math.min(stretchedWidth,availableNameWidth)+6,nameBaseline,38);
 }
 ctx.fillStyle='#fce9bf';ctx.font='800 52px sans-serif';
 ctx.fillText('Lv.'+data.level,levelX+14,321,levelW-28);

 label('冒険者等級',rankX,381);
 label('最深到達階層',reachedX,381);
 label('最深帰還階層',returnedX,381);
 panel(reachedX,bottomY,reachedW,bottomH);
 panel(returnedX,bottomY,returnedW,bottomH);
 ctx.fillStyle='#f7e6c7';ctx.font='700 33px sans-serif';
 ctx.fillText(data.deepestReached?data.deepestReached+'層':'未到達',reachedX+10,467,reachedW-20);
 ctx.fillText(data.deepestReturned?data.deepestReturned+'層':'未到達',returnedX+10,467,returnedW-20);
 // The rank plaque retains its metallic palette even in its new position.
 const metal=rankMetalPalette(data.rankLayer);
 const metalPlate=ctx.createLinearGradient(rankX,bottomY,rankX+rankW,bottomY+bottomH);
 metalPlate.addColorStop(0,metal.deep);metalPlate.addColorStop(.48,'#151422');metalPlate.addColorStop(1,metal.deep);
 ctx.fillStyle=metalPlate;ctx.fillRect(rankX,bottomY,rankW,bottomH);
 ctx.strokeStyle=metal.mid;ctx.lineWidth=3;ctx.strokeRect(rankX,bottomY,rankW,bottomH);
 const shine=ctx.createLinearGradient(0,bottomY,0,bottomY+bottomH);
 shine.addColorStop(0,'#ffffff33');shine.addColorStop(.4,'#ffffff0a');shine.addColorStop(1,'#ffffff00');
 ctx.fillStyle=shine;ctx.fillRect(rankX+3,bottomY+3,rankW-6,bottomH-7);
 const lettering=ctx.createLinearGradient(rankX+16,0,rankX+rankW-16,0);
 if(data.rankLayer===90){
  for(const [at,color] of [[0,'#a28df9'],[.34,'#ebd2ff'],[.52,'#ffffff'],[.72,'#baa4ff'],[1,'#8ddce9']])lettering.addColorStop(at,color);
 }else if(data.rankLayer===100){
  for(const [at,color] of [[0,'#ffd7ba'],[.25,'#fff4b2'],[.48,'#fffefa'],[.68,'#c6e7ff'],[.88,'#f9b7ef'],[1,'#ffd680']])lettering.addColorStop(at,color);
 }else{
  for(const [at,color] of [[0,metal.mid],[.31,metal.light],[.49,'#fffdf3'],[.68,metal.light],[1,metal.mid]])lettering.addColorStop(at,color);
 }
 ctx.shadowColor=metal.glow;ctx.shadowBlur=12;ctx.fillStyle=lettering;
 ctx.font='800 44px sans-serif';
 ctx.fillText(data.rank,rankX+12,466,rankW-24);
 ctx.shadowBlur=0;
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
