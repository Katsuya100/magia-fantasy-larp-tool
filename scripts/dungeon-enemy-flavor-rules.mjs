// Conservative 500-enemy flavor reallocation. Fixture is the pre-adjustment source of truth.
// 1-19F and all 100 bosses remain identical; the four regular encounters in
// each later layer preserve summed MAG/DEF and summed resistance for every element.
// Re-run: node scripts/tune-dungeon-enemy-flavor.mjs
export const tuneEnemyRows = function tuneEnemyRows(input){
 const rows=input.map(r=>({...r}));
 // Small, paired neutral-element shifts only: lower resist_* means LESS damage.
 const affinity={
  flame:/炎|火|紅蓮|業火|焔|灼熱|マグマ|熔岩|フレイム|ファイア|サラマンダー/,
  bolt:/雷|サンダー|ライトニング|落雷/,
  aqua:/氷|霜|吹雪|フロスト|スノー|アイス|水|海|沼|潮|鰻|イール|ナマズ|スキュラ|セイレーン|サハギン|フィッシュ|クラゲ/,
  storm:/風|翼|飛|嵐|霧|大空|鳥|コウモリ|カラス|ペガサス|ワイバーン|グリフォン|ウィンド|シルフ/,
  gravity:/岩|鉄|石|土|砂|ゴーレム|巨|鎧|アーマー|地脈|機兵|古代兵|リビングシールド|大地|トレント/,
  law:/聖|神聖|白|天使|裁|秩序|預言|守護|神域|光|銀|星術|賢者/,
  chaos:/闇|影|幽霊|死|冥|骸|血|毒|亡|呪|堕|深淵|黄泉|虚無|アビス|デーモン|ネザーロード/
 };
 const caster=/メイジ|魔法使い|魔導師|ウォーロック|ネクロマンサー|星術師|占星師|錬金術師|ドルイド|プリースト|巫女|魔女|賢者|預言者|操霊師|ウィスプ|精霊|呪術師/;
 const sturdy=/ゴーレム|巨人|ジャイアント|リビングアーマー|鎧|機兵|巨兵|ストーン|トレント|古代兵|リビングシールド|竜兵|龍|竜|騎士|守護兵|ヘカトンケイル/;
 const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
 for(let layer=20;layer<=100;layer++){
  const offset=(layer-1)*5, party=rows.slice(offset,offset+4);
  const old=input.slice(offset,offset+4);
  for(const attr of attrs){
   const field='resist_'+attr;
   if(Number(party[0][field])!==1)continue; // Keep authored primary and counter.
   const aligned=party.map((row,i)=>affinity[attr].test(row.name)?i:-1).filter(i=>i!==-1);
   const other=party.map((row,i)=>!affinity[attr].test(row.name)?i:-1).filter(i=>i!==-1);
   if(!aligned.length||!other.length)continue;
   const changes=i=>attrs.filter(a=>party[i]['resist_'+a]!==old[i]['resist_'+a]).length;
   const protectedIndex=aligned.find(i=>changes(i)<2);
   const donorIndex=other.find(i=>changes(i)<2);
   if(protectedIndex===undefined||donorIndex===undefined)continue;
   party[protectedIndex][field]='0.95';
   party[donorIndex][field]='1.05';
  }
  // Transfer a little DEF to recognizable constructs, without changing total DEF.
  const tank=party.findIndex(e=>sturdy.test(e.name)&&Number(e.def)<=5);
  const armorDonor=party.findIndex((e,i)=>i!==tank&&!sturdy.test(e.name)&&Number(e.def)>=8);
  if(tank>=0&&armorDonor>=0){
   const amount=Math.min(3,7-Number(party[tank].def),Number(party[armorDonor].def)-5);
   if(amount>0){
    party[tank].def=String(Number(party[tank].def)+amount);
    party[armorDonor].def=String(Number(party[armorDonor].def)-amount);
   }
  }
  // Likewise: move at most 2 MAG to an explicit spellcaster from a noncaster.
  const mage=party.findIndex(e=>caster.test(e.name)&&Number(e.mag)<=9);
  const magicDonor=party.findIndex((e,i)=>i!==mage&&!caster.test(e.name)&&Number(e.mag)>=11);
  if(mage>=0&&magicDonor>=0){
   const amount=Math.min(2,10-Number(party[mage].mag),Number(party[magicDonor].mag)-9);
   if(amount>0){
    party[mage].mag=String(Number(party[mage].mag)+amount);
    party[magicDonor].mag=String(Number(party[magicDonor].mag)-amount);
   }
  }
 }
 return rows;
};
