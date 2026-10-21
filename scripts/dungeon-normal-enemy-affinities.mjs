/**
 * Explicit, user-readable name-to-element predictions for all 400 regular foes.
 * Only unmistakable lexical cues are interpreted; generic 'mage', 'guard',
 * colour, rank and faction names do not imply an innate element.
 * A weak element (damage multiplier >1) is never an innate named element.
 * The sum of all seven multipliers is conserved per individual enemy.
 */
export const nameAffinities = function nameAffinities(name){
 const rules={
  flame:/炎|火|焔|紅蓮|灼熱|熔岩|マグマ|業火|フレイム|ファイア|フェニックス|サラマンダー|煉獄|ヘルハウンド/,
  bolt:/雷|サンダー|ライトニング/,
  aqua:/水|海|潮|氷|霜|吹雪|スノー|フロスト|アイス|沼|鰻|イール|ナマズ|セイレーン|サハギン|フィッシュ|スキュラ|クラゲ|キャットフィッシュ|ガマ/,
  storm:/風|嵐|翼|飛|鳥|ワイバーン|グリフォン|ペガサス|シルフ|ウィンド|コウモリ|カラス|ワシ|大空|霧/,
  gravity:/岩|鉄|石|土|砂|ゴーレム|巨|鎧|アーマー|地脈|機兵|古代兵|盾|リビングソード|大地|トレント|ウッド|木|世界樹|根竜|装甲|黒曜|クリスタル|金属/,
  law:/聖|神聖|白銀|天使|裁判|秩序|預言|神域|光|星術|賢者|神官|聖職|神聖|銀河|神獣/,
  chaos:/闇|影|幽霊|死|冥|骸|血|毒|亡|呪|堕|深淵|黄泉|虚無|アビス|デーモン|ネザーロード|魔界|不死|スケルトン|ゾンビ|グール|レイス|アンデッド|ヴァンパイア|バンシー|ゴースト|スペクター|ドッペル|リッチ|腐界|腐朽|堕天|魔境/
 };
 return Object.entries(rules).map(([attr,pattern])=>({attr,index:name.search(pattern)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index||Object.keys(rules).indexOf(a.attr)-Object.keys(rules).indexOf(b.attr)).map(x=>x.attr);
};

export const alignNormalRows = function alignNormalRows(input){
 const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
 const counter={flame:['aqua','gravity'],bolt:['gravity','aqua'],aqua:['bolt','flame'],storm:['gravity','bolt'],gravity:['aqua','flame'],law:['chaos','gravity'],chaos:['law','flame']};
 const rows=input.map(x=>({...x}));let reviewed=0;
 for(const row of rows){
  if(row.boss_only==='1')continue;
  const tags=nameAffinities(row.name);if(!tags.length)continue;
  const get=a=>Number(row['resist_'+a]);
  const set=(a,v)=>row['resist_'+a]=String(Number(v.toFixed(2)));
  const chooseWeak=()=>{
   const ordered=[...counter[tags[0]],...attrs];
   return ordered.find(a=>!tags.includes(a)&&get(a)<1.2)??attrs.find(a=>!tags.includes(a)&&get(a)<1.2);
  };
  // A creature may NEVER be weak to a named innate element.
  for(const tag of tags){
   if(get(tag)<=1)continue;
   const newWeak=chooseWeak();if(!newWeak)throw Error('no counter for '+row.id);
   const value=get(tag);
   set(tag,get(newWeak));set(newWeak,value);
  }
  // One innate element must visibly resist damage. Move the authored .8
  // to the earliest explicit name cue when the original floor template disagrees.
  if(tags.every(a=>get(a)>=1)){
   const strongest=attrs.reduce((best,a)=>get(a)<get(best)?a:best,attrs[0]);
   if(get(strongest)>=1)throw Error('no innate resistance at '+row.id);
   const target=tags[0],value=get(target);
   set(target,get(strongest));set(strongest,value);
  }
  // For two-element creature names, make the second element slightly
  // resistant too; compensate on an untagged neutral element.
  for(const tag of tags.slice(1)){
   if(get(tag)!==1)continue;
   const donor=attrs.find(a=>!tags.includes(a)&&get(a)===1);
   if(!donor)continue;
   set(tag,.95);set(donor,1.05);
  }
  // Maintain exactly the previous seven-element damage-multiplier total
  // of every individual enemy (not merely the floor aggregate).
  const index=rows.indexOf(row);
  const before=attrs.reduce((s,a)=>s+Number(input[index]['resist_'+a]),0);
  const after=attrs.reduce((s,a)=>s+get(a),0);
  if(Math.abs(after-before)>1e-8)throw Error('elemental budget changed '+row.id+': '+before+' -> '+after);
  reviewed++;
 }
 return rows;
};
