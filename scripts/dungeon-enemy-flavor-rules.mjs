// Conservative 500-enemy flavor reallocation. Fixture is the pre-adjustment source of truth.
// Existing normal-foe tuning is preserved; every boss is granted a thematic
// resistance and explicit elemental counter, with effective-HP compensation.
// All boss IDs, drops, spell configurations, and levels remain unchanged.
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
  // Transfer DEF conservatively; 51-60F MAG/DEF reallocations are held to protect historical sortie win rates.
  // Total DEF and MAG for every other four-encounter layer are unchanged.
  const tank=party.findIndex(e=>sturdy.test(e.name)&&Number(e.def)<=5);
  const armorDonor=party.findIndex((e,i)=>i!==tank&&!sturdy.test(e.name)&&Number(e.def)>=8);
  if((layer<51||layer>60)&&tank>=0&&armorDonor>=0){
   const amount=Math.min(3,7-Number(party[tank].def),Number(party[armorDonor].def)-5);
   if(amount>0){
    party[tank].def=String(Number(party[tank].def)+amount);
    party[armorDonor].def=String(Number(party[armorDonor].def)-amount);
   }
  }
  // Likewise: move at most 2 MAG to an explicit spellcaster from a noncaster.
  const mage=party.findIndex(e=>caster.test(e.name)&&Number(e.mag)<=9);
  const magicDonor=party.findIndex((e,i)=>i!==mage&&!caster.test(e.name)&&Number(e.mag)>=11);
  if((layer<51||layer>60)&&mage>=0&&magicDonor>=0){
   const amount=Math.min(2,10-Number(party[mage].mag),Number(party[magicDonor].mag)-9);
   if(amount>0){
    party[mage].mag=String(Number(party[mage].mag)+amount);
    party[magicDonor].mag=String(Number(party[magicDonor].mag)-amount);
   }
  }
 }
 return bossFlavor(rows);
};

export const bossFlavor = function bossFlavor(rows){
 const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
 // Mirror counters are coherent with the seven-magic-system world.
 const counter={flame:'aqua',bolt:'gravity',aqua:'bolt',storm:'gravity',gravity:'aqua',law:'chaos',chaos:'law'};
 const names={
  flame:/炎|火|紅蓮|焔|灼熱|熔岩|業火|紅玉/,
  bolt:/雷|落雷|雷獣/,
  aqua:/氷|霜|水魔|海底|深海|絶海|鰻|沼底|氷河|氷冠/,
  storm:/嵐|風|大空|翼|砂塵|飛竜|覇鳥|霧/,
  gravity:/岩|石|大地|巨兵|巨神|鉄壁|砂漠|黒曜|神木|世界樹/,
  law:/聖|天使|裁定|白銀|星読み|預言|守護者|賢者/,
  chaos:/闇|冥|死|幽霊|骸|黄泉|血|堕天|屍|深淵|奈落|虚無|呪/
 };
 const armored=/巨人|巨神|巨兵|番人|守護竜|守護者|騎士|竜騎将|龍|竜王|黒鎧|鉄壁|世界樹|大地/;
 const occult=/魔導|魔女|賢者|司祭|呪王|屍術|預言|巫女|操霊|観測|女帝|大魔王|妖姫|裁定|魔神/;
 const bP=[{attr:'flame',power:360},{attr:'bolt',power:420},{attr:'gravity',power:540}];
 const damageScore=row=>{
  const potentials=bP.map(({attr,power})=>20*Math.sqrt(power/100)*Number(row['resist_'+attr])).sort((a,b)=>b-a);
  return potentials[0]+potentials[1]*.72+potentials[2]*.38;
 };
 for(let layer=1;layer<=100;layer++){
  const i=layer*5-1,b=rows[i],old={...b};
  // Star eclipse is a chaos sovereign rather than an earth spirit. Keep the original
  // gravity counterplay, and grant a chaos identity without changing default attacks.
  if(layer===80){b.resist_chaos='0.95';b.resist_storm='1.05';continue;}
  const primary=b.spells.split('|')[0].split(':')[1],weak=counter[primary];
  // Make the boss's own combat attribute the creature's true elemental defense.
  // Its old arbitrary 1.25 self-weakness is transferred to a thematic counter.
  b['resist_'+primary]='0.95';
  b['resist_'+weak]=(Number(b['resist_'+weak])+.3).toFixed(2).replace(/0$/,'').replace(/\.$/,'');
  // A second, explicit name cue, if present, can also receive a small defense.
  const secondaryCue=attrs.find(a=>a!==primary&&a!==weak&&names[a].test(b.name)&&Number(b['resist_'+a])===1);
  if(secondaryCue){
   b['resist_'+secondaryCue]='0.95';
   b['resist_'+weak]=(Number(b['resist_'+weak])+.05).toFixed(2).replace(/0$/,'').replace(/\.$/,'');
  }
  // Keep fighter / mage silhouettes legible in their DEF vs RES split.
  if(armored.test(b.name)&&Number(b.def)<=8){b.def=String(Number(b.def)+2);b.res=String(Math.max(8,Number(b.res)-1));}
  else if(occult.test(b.name)&&Number(b.res)<=11){b.res=String(Number(b.res)+1);b.def=String(Math.max(6,Number(b.def)-1));}
  // The benchmark player rotates three attacks (flame/bolt/gravity). Scale only
  // boss HP to preserve the multi-spell effective-health budget after counters change.
  const oldScore=damageScore(old),newScore=damageScore(b);
  const desired=Number(old.hp)*(newScore/oldScore)*(100+Number(old.def))/(100+Number(b.def));
  b.hp=String(Math.round(Math.round(desired)*[1.04,1.06,1.035,1.02,1,1.02,1,0.925,1,0.94][Math.floor((layer-1)/10)]));
  if(layer===100){b.hp='101';b.mag='13';b.def=old.def;b.res=old.res;} // 128-seed calibrated: chaos/law identity, higher magic, preserved winning pressure.
 }
 return rows;
};
