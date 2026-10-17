// Analyze a photographed circle before saving. Hidden power is revealed on first successful use.
// Legacy analyzed photos without "revealed" remain known, with their stored power visible.
export const MIN_EQUIPPED_CIRCLES=3,MAX_EQUIPPED_CIRCLES=5;
export const ATTRIBUTES={
 flame:{icon:'🔥',label:'flame'},bolt:{icon:'⚡',label:'bolt'},aqua:{icon:'💧',label:'aqua'},
 storm:{icon:'🌪️',label:'storm'},gravity:{icon:'🪨',label:'gravity'},
 law:{icon:'⚖️',label:'law'},chaos:{icon:'🌀',label:'chaos'}
};
export const ROLES={attack:'⚔️攻撃',defense:'🛡️防御',support:'✚回復',debuff:'🕸️弱体'};
export const equippedCircleCount=ids=>ids.filter(Boolean).length;
export const canDepartWithCircles=ids=>Array.isArray(ids)&&ids.length===5&&equippedCircleCount(ids)>=3&&equippedCircleCount(ids)<=5;
export const isRevealed=circle=>Boolean(circle?.analysis)&&circle.revealed!==false;
export function normalizeAnalysisResult({attribute,role,power}){
 const a=String(attribute||'').trim().toLowerCase();
 const r=({攻撃:'attack',防御:'defense',回復:'support',弱体:'debuff'})[String(role||'').trim()]||role;
 const p=Number(power);
 if(!Object.hasOwn(ATTRIBUTES,a)||!Object.hasOwn(ROLES,r)||!Number.isFinite(p)||p<=0)throw Error('魔法陣の解析結果が不正です');
 return {attribute:a,role:r,power:p};
}
export function newCapturedCircle(id,image,registeredAt){return {id,image,registeredAt,analysis:null,revealed:false};}
export function savePreanalysis(circle,analysis){return {...circle,analysis:normalizeAnalysisResult(analysis),revealed:false};}
export function revealOnUse(circle){return {...circle,revealed:true};}
export function spellEffect(a,buffs=[]){
 if(!a)return '未解析';
 const {role,attribute}=a,match=id=>buffs.find(b=>b.id===id)?.name;
 switch(role){
 case 'attack':return '⚔️属性攻撃';
 case 'defense':return attribute==='chaos'?'🛡️属性耐性＋ランダム強化':'🛡️属性耐性＋'+(match('buff_'+attribute)||'強化');
 case 'support':return '✚HP回復＋'+(ATTRIBUTES[attribute]?.label||attribute)+'の🕸️弱体解除';
 case 'debuff':return '🕸️'+(attribute==='chaos'?'ランダム弱体':(match('debuff_'+attribute)||'弱体'));
 default:return '未解析';
 }
}
export function circleSummary(circle,buffs=[],mpCost=()=>null){
 const a=circle?.analysis;if(!a)return '？？？ · 未解析';
 const info=ATTRIBUTES[a.attribute],mp=mpCost(a.power);
 const fields=[(info?.icon||'✦')+' '+(info?.label||a.attribute),ROLES[a.role]||a.role,spellEffect(a,buffs)];
 if(Number.isFinite(mp))fields.push('消費MP '+mp);
 if(isRevealed(circle))fields.push('威力 '+a.power);
 return fields.join(' / ');
}
export function circleDetails(circle,buffs=[],mpCost=()=>null){
 const a=circle?.analysis;
 if(!a)return {attribute:'？？？',role:'未解析',effect:'未解析',mp:'--',power:'未公開'};
 const at=ATTRIBUTES[a.attribute],mp=mpCost(a.power);
 return {attribute:(at?.icon||'✦')+' '+(at?.label||a.attribute),role:ROLES[a.role]||a.role,
 effect:spellEffect(a,buffs),mp:Number.isFinite(mp)?String(mp):'--',power:isRevealed(circle)?String(a.power):'未公開'};
}
// One effect per spell: never show an unrelated attribute's statuses on a thumbnail.
// Status values scale with the spell's hidden power and/or the recipient's resistance.
export const ROLE_ICONS={attack:'⚔️',defense:'🛡️',support:'✚',debuff:'🕸️'};
const EFFECT_TITLES={attack:'属性攻撃',defense:'属性防御',support:'HP回復・弱体解除',debuff:'属性弱体'};
const BUFF_DETAILS={
 flame:'与える攻撃ダメージが増加します。',
 bolt:'魔法の出力が高まり、与えるダメージや回復などを強化します。',
 aqua:'回復魔法によるHP回復量が増加します。',
 storm:'敵から受けるダメージが減少します。',
 gravity:'防御力が上昇し、攻撃の被害を軽減します。',
 law:'秩序の庇護を付与します。加えて防御魔法の属性耐性が上がります。',
 chaos:'七属性からランダムに強化効果を選んで付与します。'
};
const DEBUFF_DETAILS={
 flame:'火傷：ターン終了時に最大HPに応じた継続ダメージを受けます。',
 bolt:'感電：次に使った魔法の再使用待ち時間が延びます。',
 aqua:'浸水：属性耐性を高める加護の効果が弱まります。',
 storm:'目眩：攻撃が失敗することがあります。',
 gravity:'重圧：魔法の出力が下がり、与えるダメージや回復などが弱まります。',
 law:'封印：攻撃・防御・回復・弱体のうち一種類の魔法を一時的に使えなくします。',
 chaos:'混乱：次に使おうとした魔法が、別の装備魔法に変わることがあります。'
};
export function circleAttributeEffects(circle,buffs=[]){
 const a=circle?.analysis;
 if(!a||!Object.hasOwn(ATTRIBUTES,a.attribute))return null;
 const {attribute,role}=a,chaos=attribute==='chaos';
 const buff=buffs.find(x=>x.id==='buff_'+attribute);
 const debuff=buffs.find(x=>x.id==='debuff_'+attribute);
 return {
  buff:chaos?'ランダム強化':buff?.name||'強化',
  debuff:chaos?'ランダム弱体':debuff?.name||'弱体',
  buffActive:role==='defense',debuffActive:role==='debuff',
  buffDescription:BUFF_DETAILS[attribute],debuffDescription:DEBUFF_DETAILS[attribute],
  buffDuration:buff?.duration||'変動',debuffDuration:debuff?.duration||'変動'
 };
}
export function circleCardInfo(circle,buffs=[],mpCost=()=>null){
 const a=circle?.analysis;
 if(!a)return {symbols:'？ / ？',effectName:'未解析',statusName:'',mp:'--',power:''};
 const at=ATTRIBUTES[a.attribute],effect=circleAttributeEffects(circle,buffs);
 const statusName=a.role==='defense'?effect?.buff:a.role==='debuff'?effect?.debuff:'';
 const mp=mpCost(a.power);
 return {
  symbols:(at?.icon||'✦')+' / '+(ROLE_ICONS[a.role]||'？'),
  effectName:EFFECT_TITLES[a.role]||'未解析',
  statusName:statusName||'',
  mp:Number.isFinite(mp)?String(mp):'--',
  power:isRevealed(circle)?String(a.power):''
 };
}
export function circleEffectDetails(circle,buffs=[]){
 const a=circle?.analysis;if(!a)return {effect:'解析されていません。',statusName:'',statusDescription:'',duration:''};
 const {attribute,role}=a,info=circleAttributeEffects(circle,buffs);
 if(role==='attack')return {effect:'敵に'+ATTRIBUTES[attribute].label+'属性の魔法ダメージを与えます。ダメージは属性相性・相手の防御力・状態効果で変わります。',statusName:'',statusDescription:'',duration:''};
 if(role==='support')return {effect:'自分のHPを回復し、'+ATTRIBUTES[attribute].label+'属性の🕸️弱体効果を解除します。回復量はHPの不足分を超えません。',statusName:'',statusDescription:'',duration:''};
 if(role==='defense')return {
  effect:'自分に'+ATTRIBUTES[attribute].label+'属性への耐性を付与し、追加で🛡️強化効果を得ます。',
  statusName:info.buff,
  statusDescription:info.buffDescription,
  duration:attribute==='chaos'?'選ばれた強化の設定ターン数に従います。':'基本'+info.buffDuration+'ターン。耐性効果は別途持続します。強化量は魔法の威力によって変わります。'
 };
 return {
  effect:'敵に'+ATTRIBUTES[attribute].label+'属性の🕸️弱体効果を与えます。付与の強さと持続時間は魔法の威力・相手の耐性で変化します。',
  statusName:info.debuff,
  statusDescription:info.debuffDescription,
  duration:attribute==='chaos'?'七属性から弱体効果をランダムに選びます。持続ターン数は相手の耐性などで変わります。':'基本'+info.debuffDuration+'ターン。相手の耐性・魔法の威力に応じて短縮・延長される場合があります。'
 };
}
export function attributeEffectGuide(buffs=[]){
 return Object.entries(ATTRIBUTES).map(([attribute,{icon,label}])=>{
  const effects=circleAttributeEffects({analysis:{attribute}},buffs);
  return {attribute,icon,label,buff:effects.buff,debuff:effects.debuff};
 });
}
