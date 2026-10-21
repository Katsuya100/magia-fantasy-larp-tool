// Historical HP archetype bounds for regeneration only; never affect combat.
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

// Current authored RPG HP-base bounds. Static validation only, never runtime clamping.
export const combatBaseHpRanges = Object.freeze({
 normal:Object.freeze({
  slime:Object.freeze([63,81]),
  flying:Object.freeze([63,87]),
  beast:Object.freeze([71,95]),
  spectral:Object.freeze([64,92]),
  armored:Object.freeze([78,91]),
  construct:Object.freeze([79,90]),
  plant:Object.freeze([79,89]),
  caster:Object.freeze([67,89]),
  colossus:Object.freeze([90,100]),
  dragon:Object.freeze([88,97]),
  raider:Object.freeze([73,80]),
 }),
 boss:Object.freeze({
  beast:Object.freeze([94,127]),
  dragon:Object.freeze([104,126]),
  spectral:Object.freeze([92,115]),
  armored:Object.freeze([95,129]),
  colossus:Object.freeze([107,119]),
  caster:Object.freeze([89,118]),
  plant:Object.freeze([106,106]),
  construct:Object.freeze([107,107]),
  flying:Object.freeze([130,130]),
 }),
});
