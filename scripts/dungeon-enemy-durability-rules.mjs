// Characteristic physical / magical survivability for all 500 monsters.
// No MAG, spell, status, drops, ID or level changes. No simulation here.
export const durabilityArchetype = function durabilityArchetype(name){
 // Explicit named exceptions from the 102-enemy review: large ogres,
 // iron-clad soldiers / guards, and a small magic-oriented fairy dragon.
 if(/^(岩オーガ|赤オーガ)$/.test(name))return 'colossus';
 if(/^(鉄スケルトン兵|鉄リザードマン|亡者の執行人|堕天の護衛)$/.test(name))return 'armored';
 if(name==='フェアリードラゴン')return 'caster';
 if(/ゴーレム|古代兵|魔導人形|魔導機兵|魔導兵|機兵|リビングソード|リビングシールド|石像|天秤兵|機械仕掛け|機械皇帝/.test(name))return 'construct';
 if(/巨人|巨兵|巨神|ジャイアント|サイクロプス|ヘカトンケイル|トロール|巨斧|大破壊/.test(name))return 'colossus';
 if(/ドラゴン|竜|龍|ワイバーン|ドラゴニュート/.test(name))return 'dragon';
 if(/メイジ|魔法使い|魔導師|魔女|巫女|術師|錬金|賢者|預言|予言|占星|星術|司祭|神官|祭司|僧|ドルイド|呪術|プリースト|ネクロマンサー|ウォーロック|ウィッチ|操霊|魔導王|大魔王|精霊|ウィスプ|エレメンタル|シルフ|使い魔|妖姫|女帝|観測者|水魔|魔法|リッチ|呪王|ビホルダー|アーケインアイ|千眼|水精|スペルイーター|インプ|ピクシー|ノーム|セイレーン|スピリット|聖職者|使徒|呪|時読み|測量者|天使|裁定者|輪廻|観測|魔神|大邪神|古神|魔人|修験|妖精|魔皇|統べる|星蝕|賢人|伯爵|ダークエルフ|支配者/.test(name))return 'caster';
 if(/幽霊|亡霊|死霊|ゾンビ|スケルトン|骸骨|レイス|シャドウ|ゴースト|ファントム|バンシー|スペクター|アンデッド|不死|黄泉|冥府|影|虚無|ヴォイド|霊廟|亡者|屍|骸|ミイラ|呪い人形|吸血|ヴァンパイア|グール|デーモン|デビル|ドッペルゲンガー|ネザーロード|堕天|亡き|腐界|スピリット/.test(name)&&!/騎士|鎧|剣聖|処刑人|執行者/.test(name))return 'spectral';
 if(/騎士|騎兵|騎将|アーマー|鎧|デュラハン|剣聖|剣皇|将軍|大元帥|剣士|剣兵|槍兵|護衛|守護兵|衛兵|番人|処刑騎士|騎士団|ガーゴイル|守護者|裁判官|デスナイト|フレイムナイト|英雄|狩人|処刑人|執行者|番兵|剣霊|ヴァルキリー|黒鉄|征服者|墓守|城主/.test(name))return 'armored';
 if(/スライム|スワンプシング|ゼリー/.test(name))return 'slime';
 if(/トレント|ドライアド|キノコ|マンドラゴラ|世界樹|神木|木霊|木|樹|森羅|大樹|ウッド/.test(name))return 'plant';
 if(/コウモリ|カラス|ワシ|鳥|飛び|翼|グリフォン|ペガサス|フェニックス|大空|バード/.test(name))return 'flying';
 if(/ウルフ|狼|犬|獣|ゴブリン|コボルト|オーク|鬼|オーガ|イノシシ|猪|人狼|ワーム|トカゲ|リザードマン|サハギン|魚|ナマズ|鰻|イール|フィッシュ|クラゲ|ガマ|グモ|蜘蛛|ムカデ|スコーピオン|マンティコア|キマイラ|ケンタウロス|魔将|戦鬼|戦乙女|戦姫|猟犬|魔狼|牛|鰭|毒|ネズミ|ラット|サーペント|ハウンド|スキュラ|ミノタウロス|百足|フロストビースト|ファイアリザード|暴君|アラクネ|スパイダー|フェンリル|ウォーグ|サラマンダー|ヘルスパイダー|ヘルスパイダー|ベルセルク|デビルフィッシュ|ウィドウ|暗殺者|従者|眷属|インプ/.test(name))return 'beast';
 if(/海賊|乗組員|狙撃手/.test(name))return 'raider';
 if(/奈落の落とし子/.test(name))return 'spectral';
 return 'unmarked';
};
export const durabilityRanges = {
 normal:{
  construct:{hp:[94,119],def:[9,11],res:[8,11]},
  colossus:{hp:[105,122],def:[9,11],res:[7,10]},
  armored:{hp:[92,115],def:[8,10],res:[7,11]},
  dragon:{hp:[101,120],def:[8,10],res:[9,12]},
  caster:{hp:[76,95],def:[3,5],res:[11,13]},
  spectral:{hp:[75,100],def:[3,5],res:[10,13]},
  slime:{hp:[75,97],def:[3,5],res:[8,12]},
  plant:{hp:[93,112],def:[6,9],res:[9,12]},
  flying:{hp:[73,94],def:[3,6],res:[7,11]},
  beast:{hp:[85,111],def:[5,8],res:[7,11]},
  raider:{hp:[84,105],def:[5,7],res:[6,11]},
  unmarked:{hp:[73,110],def:[4,10],res:[6,13]}
 },
 boss:{
  construct:{hp:[119,156],def:[11,13],res:[10,13]},
  colossus:{hp:[126,157],def:[11,13],res:[9,12]},
  armored:{hp:[112,151],def:[10,13],res:[10,13]},
  dragon:{hp:[124,156],def:[10,13],res:[11,14]},
  caster:{hp:[99,128],def:[6,8],res:[12,14]},
  spectral:{hp:[100,132],def:[6,8],res:[12,14]},
  slime:{hp:[104,132],def:[6,8],res:[11,14]},
  plant:{hp:[119,151],def:[9,12],res:[11,14]},
  flying:{hp:[108,142],def:[7,10],res:[10,13]},
  beast:{hp:[112,150],def:[9,12],res:[9,12]},
  raider:{hp:[110,140],def:[8,11],res:[9,12]},
  unmarked:{hp:[96,150],def:[7,12],res:[9,14]}
 }
};
// Precisely the 12 explicitly approved corrections. The 23 candidates for later
// micro-tuning are deliberately NOT touched by these individual overrides.
export const curatedDurabilityFixes = Object.freeze({
 'foe_l023_2':Object.freeze({hp:105,def:9,res:8}),
 'foe_l041_2':Object.freeze({hp:108,def:9,res:8}),
 'foe_l052_2':Object.freeze({hp:94,def:8,res:8}),
 'foe_l053_3':Object.freeze({hp:88,def:5,res:12}),
 'foe_l059_4':Object.freeze({hp:96,def:9,res:10}),
 'foe_l068_3':Object.freeze({hp:99,def:11,res:10}),
 'foe_l071_2':Object.freeze({hp:98,def:9,res:8}),
 'foe_l084_4':Object.freeze({hp:98,def:9,res:10}),
 'foe_l085_4':Object.freeze({hp:99,def:9,res:10}),
 'foe_l088_2':Object.freeze({hp:111,def:8,res:11}),
 'foe_l095_2':Object.freeze({hp:104,def:8,res:8}),
 'foe_l100_2':Object.freeze({hp:108,def:8,res:8})
});
export const tuneDurability = function tuneDurability(input){
 const rows=input.map(r=>({...r}));
 const clamp=(n,[low,high])=>Math.max(low,Math.min(high,n));
 for(const row of rows){
  const type=durabilityArchetype(row.name);
  const range=durabilityRanges[row.boss_only==='1'?'boss':'normal'][type];
  for(const stat of ['hp','def','res'])row[stat]=String(clamp(Number(row[stat]),range[stat]));
  const correction=curatedDurabilityFixes[row.id];
  if(correction){
   if(row.boss_only!=='0')throw Error('curated correction must target normal enemy '+row.id);
   for(const stat of ['hp','def','res']){
    if(correction[stat]<range[stat][0]||correction[stat]>range[stat][1])
     throw Error('curated correction outside archetype '+row.id+' '+stat);
    row[stat]=String(correction[stat]);
   }
  }
 }
 return rows;
};
