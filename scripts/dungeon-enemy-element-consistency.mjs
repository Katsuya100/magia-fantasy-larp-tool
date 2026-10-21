// Cross-check real primary/secondary spells against incoming damage multipliers.
// This final pass follows name-based resistances, durability and spell flavor.
// The individual seven-element resistance budget is conserved exactly.
export const elementResistanceCorrections=Object.freeze({
 'foe_l002_1':Object.freeze({bolt:1,aqua:1.2,gravity:0.8}),
 'foe_l002_2':Object.freeze({bolt:1,aqua:1.2,gravity:0.8}),
 'foe_l002_3':Object.freeze({bolt:1,aqua:1.2,gravity:0.8}),
 'foe_l002_4':Object.freeze({bolt:1,aqua:1.2,gravity:0.8}),
 'boss_l002':Object.freeze({bolt:1,aqua:1.5,gravity:0.95}),
 'boss_l011':Object.freeze({bolt:1,aqua:1.3,gravity:0.95}),
 'foe_l030_3':Object.freeze({aqua:1.2,gravity:0.8,chaos:1}),
 'foe_l086_1':Object.freeze({bolt:1,aqua:1.2,gravity:0.8}),
 'foe_l086_2':Object.freeze({bolt:1,gravity:0.8,law:1.2}),
 'foe_l086_4':Object.freeze({bolt:1,gravity:0.8,law:1.2}),
 'boss_l086':Object.freeze({bolt:1,gravity:0.95,law:1.5}),
 'foe_l097_1':Object.freeze({storm:1,law:1.05,chaos:0.8}),
 'boss_l010':Object.freeze({flame:1.35,chaos:0.95}),
 'foe_l025_1':Object.freeze({aqua:1.15,gravity:0.95}),
 'boss_l025':Object.freeze({aqua:1.35,gravity:0.95}),
 'foe_l030_2':Object.freeze({aqua:1.25,gravity:0.95}),
 'foe_l031_1':Object.freeze({storm:0.95,gravity:1.1}),
 'foe_l037_1':Object.freeze({law:1.1,chaos:0.95}),
 'boss_l045':Object.freeze({aqua:1.35,gravity:0.95}),
 'foe_l051_4':Object.freeze({aqua:1.25,gravity:0.95}),
 'foe_l056_1':Object.freeze({law:1.1,chaos:0.95}),
 'foe_l060_3':Object.freeze({law:1.25,chaos:0.95}),
 'boss_l060':Object.freeze({law:1.25,chaos:0.95}),
 'foe_l065_3':Object.freeze({aqua:1.25,gravity:0.95}),
 'foe_l093_1':Object.freeze({law:0.95,chaos:1.1}),
 'foe_l045_1':Object.freeze({bolt:1.15,gravity:0.8,chaos:0.95}),
 'foe_l072_1':Object.freeze({storm:0.95,gravity:1,law:1.3,chaos:0.8}),
 'foe_l036_3':Object.freeze({bolt:1.25,storm:0.95}),
 'foe_l038_1':Object.freeze({storm:0.95,gravity:1.1}),
 'foe_l043_1':Object.freeze({law:1.1,chaos:0.95}),
 'foe_l044_1':Object.freeze({bolt:1.3,law:0.95}),
 'foe_l044_4':Object.freeze({bolt:1.2,gravity:0.8}),
 'foe_l045_4':Object.freeze({bolt:1.2,law:0.8}),
 'foe_l049_3':Object.freeze({law:1.1,chaos:0.95}),
 'foe_l051_3':Object.freeze({bolt:1.25,gravity:0.95}),
 'boss_l051':Object.freeze({bolt:1.25,gravity:0.95}),
 'foe_l057_1':Object.freeze({storm:0.95,gravity:1.25}),
 'foe_l057_3':Object.freeze({storm:0.95,gravity:1.25}),
 'boss_l057':Object.freeze({storm:0.95,gravity:1.55}),
 'boss_l072':Object.freeze({law:1.25,chaos:0.95}),
 'foe_l086_3':Object.freeze({gravity:0.95,law:0.95,chaos:1.3}),
});
export const intendedElementWeaknesses=Object.freeze({
 'foe_l001_2':"飛行中に重量技を使えても、外部からの重力拘束や墜落には弱い",
 'foe_l001_3':"風・砂塵を攻撃に利用できても軽装の体は突風で姿勢を崩す",
 'foe_l001_4':"風・砂塵を攻撃に利用できても軽装の体は突風で姿勢を崩す",
 'boss_l001':"風を利用して火勢を増せるが、強風を受けると火炎は散らされる",
 'foe_l016_1':"術式を行使できることと身体の属性耐性は別。反作用と外部重力に弱い",
 'foe_l016_2':"術式を行使できることと身体の属性耐性は別。反作用と外部重力に弱い",
 'foe_l016_3':"術式を行使できることと身体の属性耐性は別。反作用と外部重力に弱い",
 'foe_l016_4':"飛行中に重量技を使えても、外部からの重力拘束や墜落には弱い",
 'boss_l016':"術式を行使できることと身体の属性耐性は別。反作用と外部重力に弱い",
 'foe_l020_1':"風を利用して火勢を増せるが、強風を受けると火炎は散らされる",
 'boss_l022':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l024_1':"水流や根を攻撃に利用するが、突風や重力による圧縮が苦手",
 'foe_l029_1':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l030_1':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'boss_l030':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l032_2':"風・砂塵を攻撃に利用できても軽装の体は突風で姿勢を崩す",
 'foe_l033_1':"術式を行使できることと身体の属性耐性は別。反作用と外部重力に弱い",
 'foe_l036_2':"水流や根を攻撃に利用するが、突風や重力による圧縮が苦手",
 'foe_l040_1':"水流や根を攻撃に利用するが、突風や重力による圧縮が苦手",
 'foe_l042_3':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l050_2':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l059_1':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l061_1':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l064_1':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'foe_l068_1':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l069_1':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l071_3':"飛行中に重量技を使えても、外部からの重力拘束や墜落には弱い",
 'foe_l077_1':"自らの術式と外部からの秩序・重力干渉は別。拘束を攻略用弱点として残す",
 'foe_l079_3':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'boss_l079':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'foe_l080_2':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'boss_l080':"80層の既定例外。星蝕の重力は扱えるが、外部の重力干渉で核が崩れる。重力1.25と秩序1.2の攻略用弱点を保持",
 'foe_l087_1':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'foe_l096_2':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'foe_l098_2':"技の属性と防御耐性は別。外部からの反作用・束縛に弱いという攻略用弱点として維持",
 'foe_l099_1':"自らの術式と外部からの秩序・重力干渉は別。拘束を攻略用弱点として残す",
 'foe_l100_1':"飛行中に重量技を使えても、外部からの重力拘束や墜落には弱い",
 'foe_l100_2':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'foe_l100_4':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
 'boss_l100':"重量技を使えても、外部からの重力固定は肉体や霊核への対抗手段になる",
});
export function reconcileEnemyElements(input){
 const attrs=['flame','bolt','aqua','storm','gravity','law','chaos'];
 return input.map(original=>{
  const row={...original},fix=elementResistanceCorrections[row.id];
  const sum=r=>attrs.reduce((n,a)=>n+Number(r['resist_'+a]),0);
  if(fix){for(const [a,v] of Object.entries(fix)){
   if(!attrs.includes(a)||!Number.isFinite(v)||v<=0)throw Error('Bad curated resistance '+row.id+' '+a);
   row['resist_'+a]=String(v);
  }if(Math.abs(sum(original)-sum(row))>1e-8)throw Error('Changed elemental budget '+row.id);}
  const slots=row.spells.split('|');if(slots.length!==5)throw Error('Expected 5 spells '+row.id);
  const p=slots[0].split(':')[1],s=slots[2].split(':')[1];
  if(!attrs.includes(p)||!attrs.includes(s))throw Error('Bad spell element '+row.id);
  const weakness=Number(row['resist_'+p])>1||Number(row['resist_'+s])>1;
  if(weakness!==Object.hasOwn(intendedElementWeaknesses,row.id))throw Error('Unreviewed own-element weakness '+row.id);
  return row;
 });
}
