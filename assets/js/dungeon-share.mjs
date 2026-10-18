import {highestRankLayer,rankTitle} from './dungeon-ranks.mjs';
import {deepestReturnedLayer} from './dungeon-progress.mjs';

export const DUNGEON_SHARE_URL='https://katsuya100.github.io/magia-fantasy-larp-tool/dungeon.html';
export function adventurerShareData(profile){
 const level=Number(profile?.level);
 return {
  rank:rankTitle(highestRankLayer(profile)),
  level:Number.isSafeInteger(level)&&level>0?level:1,
  deepest:deepestReturnedLayer(profile)
 };
}
export function adventurerShareText(data){
 return [
  'マギアサークル-ダンジョンアタック',
  '冒険者等級：'+data.rank,
  'Lv.'+data.level,
  '最深帰還：'+(data.deepest?data.deepest+'層':'未到達')
 ].join('\n');
}
export function adventurerXUrl(data){
 const params=new URLSearchParams({text:adventurerShareText(data),url:DUNGEON_SHARE_URL});
 return 'https://x.com/intent/tweet?'+params.toString();
}

// Pure browser Canvas rendering. Nothing is uploaded: only three progress values
// are included, and the player name is intentionally excluded.
export function paintAdventurerCard(canvas,data){
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
 ctx.fillStyle='#adabb8';ctx.font='600 24px sans-serif';ctx.fillText('冒険者等級',82,246);
 ctx.fillStyle='#f6d796';ctx.font='700 76px sans-serif';ctx.fillText(data.rank,82,331,610);
 ctx.fillStyle='#adabb8';ctx.font='600 24px Georgia, serif';ctx.fillText('LEVEL',83,411);
 ctx.fillText('最深帰還',361,411);
 ctx.fillStyle='#fbebcb';ctx.font='700 58px Georgia, sans-serif';ctx.fillText('Lv.'+data.level,83,483,280);
 ctx.font='700 58px sans-serif';ctx.fillText(data.deepest?data.deepest+'層':'未到達',361,483,320);
 ctx.strokeStyle='#a8845566';ctx.beginPath();ctx.moveTo(335,393);ctx.lineTo(335,490);ctx.stroke();
 // A geometric magic-circle seal, drawn locally without remote images or fonts.
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
 ctx.textAlign='start';
 ctx.strokeStyle='#ae8b5866';ctx.beginPath();ctx.moveTo(82,548);ctx.lineTo(1116,548);ctx.stroke();
 ctx.fillStyle='#c6b4a4';ctx.font='20px Georgia, serif';ctx.fillText('ADVENTURER CARD',82,594);
 ctx.textAlign='right';ctx.fillText('THE ARCANE EXPEDITION',1115,594);ctx.textAlign='start';
 return canvas;
}
