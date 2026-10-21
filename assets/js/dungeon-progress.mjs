// Dungeon progression keeps its stable fight index for CSV masters and saved runs.
// Five encounters make one layer; its fifth encounter is the layer boss.
// One stable name per designed layer (1–100); endless depths share a fallback name.
export const LAYER_NAMES=Object.freeze([
 'はじまりの魔窟','地下の亜人砦','黄泉の墓道','王墓の石廊','腐茸の森',
 '巨岩の洞穴','黒鎧の回廊','毒鰻の沼','魔女の迷路','呪術の祭壇',
 '獣牙の山道','骸の黄泉路','灼熱の魔窟','古井戸の水牢','封じられた石門',
 '深穴の魔導房','戦鬼の砦','翡翠龍の巣','影喰らう森','紅蓮の古城',
 '白銀騎士の砦','双牙の狩場','大地の破砕場','幽霊船の甲板','砂毒の荒野',
 '灰翼の断崖','忘れられた英雄廟','黒曜の龍門','嵐呼ぶ社','魔獣軍の陣地',
 '真紅の夜城','闇市の裏路地','魔導塔の書庫','霜牙の雪原','千眼の監視塔',
 '深森の霊樹','黒鉄の刑場','落雷の高原','灼熱の戦場','呪泥の沼底',
 '巨斧の闘技場','百足の毒巣','海底の神殿','機械仕掛けの宮殿','双剣の黒城',
 '星読みの天文台','地獄犬の狩場','氷河の神殿','闇翼の龍巣','忘却の霊廟',
 '黄金魔人の宝庫','熔岩の魔城','森羅の聖域','魔界の猟場','無貌の隠密街',
 '千年の屍術宮','雷獣の天峰','深海の妖宮','闇剣の修羅道','毒霧の魔境',
 '白骨軍の大本陣','大空の覇鳥の巣','絶海の鰻龍宮','黒曜女帝の宮','砂塵の覇道',
 '氷冠の魔女宮','紅玉の魔導炉','黄昏の処刑場','亡霊軍の古戦場','堕天の聖域',
 '鉄壁の龍騎城','虚空の魂牢','血月の獣都','冥土の戦姫廟','刻止まりの書庫',
 '神木の龍樹林','白銀槍の聖堂','焔獄の神殿','深淵の王座','星蝕の覇王宮',
 '災厄の黒龍城','終焉の予言殿','天喰らう巨神域','冥界の審判廷','堕天王の霊廟',
 '月蝕の龍帝宮','不滅の骸帝都','無窮の神獣界','虚数の魔導空間','静寂の天界',
 '星海の邪神殿','破戒の魔境寺','深宇宙の観測所','輪廻の裁定界','因果断絶の剣境',
 '奈落の古神殿','常闇の龍神域','万象の虚無界','世界樹の終末','永劫の魔王城'
]);
export const FIGHTS_PER_LAYER=5;
export function layerOfFight(fight){
 const n=Number(fight);
 return Number.isSafeInteger(n)&&n>0?Math.ceil(n/FIGHTS_PER_LAYER):0;
}
// From 1–50 layers the panel becomes crimson; from 51–100 it darkens.
export function dungeonDepthBlend(fight){
 const layer=Math.min(layerOfFight(fight),100);
 return {
  crimson:Math.min(layer*2,100)+'%',
  darkness:Math.max(0,(layer-50)*2)+'%',
  fog:layer>=50?(18+Math.round((layer-50)/5))+'%':'0%'
 };
}
export function encounterOfFight(fight){
 const n=Number(fight);
 return Number.isSafeInteger(n)&&n>0?(n-1)%FIGHTS_PER_LAYER+1:0;
}
export function isLayerBoss(fight){return encounterOfFight(fight)===FIGHTS_PER_LAYER;}
export function encounterLabel(fight){
 const layer=layerOfFight(fight),encounter=encounterOfFight(fight);
 return layer?layer+'層'+encounter+'戦目':'未到達';
}
export function layerName(layer){
 const n=Number(layer);
 return Number.isSafeInteger(n)&&n>0?(LAYER_NAMES[n-1]||'終わりなき深淵'):'';
}
export function battleHeading(fight){
 const layer=layerOfFight(fight);
 return layer?layer+'層 '+layerName(layer):'未到達';
}
export function battleEncounter(fight){
 const encounter=encounterOfFight(fight);
 return encounter?encounter+'戦目':'';
}
export function clearedLayer(fight){return isLayerBoss(fight)?layerOfFight(fight):0;}
export function nextLayer(fight){return layerOfFight(fight)+1;}
// An arrival counts even if an expedition later ends in defeat.
// Successfully returned layers and active runs establish legacy minimums.
export function deepestReachedLayer(profile){
 const depth=Number(profile?.deepestReachedLayer);
 return Math.max(Number.isSafeInteger(depth)&&depth>0?depth:0,
  deepestReturnedLayer(profile),layerOfFight(profile?.run?.floor));
}
export function recordReachedLayer(profile,fight){
 const reached=layerOfFight(fight);
 if(reached)profile.deepestReachedLayer=Math.max(deepestReachedLayer(profile),reached);
 return deepestReachedLayer(profile);
}
export const hasHundredFloorCrown=profile=>profile?.defeatedBosses?.boss_l100===true;
// Only a successful return from a defeated layer boss establishes a record.
// Legacy "highest" tracked *visits*, so it cannot safely be treated as a return.
export function deepestReturnedLayer(profile){
 const depth=Number(profile?.deepestReturnedLayer);
 return Number.isSafeInteger(depth)&&depth>0?depth:0;
}
export function recordReturnedLayer(profile,fight){
 const completed=clearedLayer(fight);
 if(completed){
  profile.deepestReturnedLayer=Math.max(deepestReturnedLayer(profile),completed);
  recordReachedLayer(profile,fight);
 }
 return deepestReturnedLayer(profile);
}
