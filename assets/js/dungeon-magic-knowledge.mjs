// Analyze a photographed circle before saving. Hidden power is revealed on first successful use.
// Legacy analyzed photos without "revealed" remain known, with their stored power visible.
export const MIN_DUNGEON_POWER=250;
export const DUNGEON_POWER_ANCHOR=500;
// Preserve the original result from 500 upward; stretch weaker rolls into 250..500.
export const scaleDungeonPower=power=>power<DUNGEON_POWER_ANCHOR
 ? Math.round(MIN_DUNGEON_POWER+power/2)
 : power;
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
// Rules apply to newly analyzed dungeon magic only; old spells retain their power.
export function successfulDungeonAnalysis(result){
 const a=normalizeAnalysisResult(result);
 return {...a,power:scaleDungeonPower(a.power)};
}
export function failedDungeonAnalysis(random=Math.random){
 const attributes=Object.keys(ATTRIBUTES),roles=Object.keys(ROLES);
 return {
  attribute:attributes[Math.floor(random()*attributes.length)],
  role:roles[Math.floor(random()*roles.length)],
  power:200+Math.floor(random()*51)
 };
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
 case 'debuff':return '🕸️'+(match('debuff_'+attribute)||'弱体');
 default:return '未解析';
 }
}
export function circleSummary(circle,buffs=[],mpCost=()=>null){
 const d=circleCardInfo(circle,buffs,mpCost);
 return [d.symbols,'MP:'+d.mp+' / 威力:'+d.power].filter(Boolean).join(' / ');
}
export function circleDetails(circle,buffs=[],mpCost=()=>null){
 const a=circle?.analysis;
 if(!a)return {attribute:'？？？',role:'未解析',effect:'未解析',mp:'?',power:'?'};
 const at=ATTRIBUTES[a.attribute],known=isRevealed(circle);
 const mp=known?mpCost(circle.basePower??a.power):null;
 return {attribute:(at?.icon||'✦')+' '+(at?.label||a.attribute),role:ROLES[a.role]||a.role,
 effect:spellEffect(a,buffs),mp:known&&Number.isFinite(mp)?String(mp):'?',power:known?String(a.power):'?'};
}
// One effect per spell: never show an unrelated attribute's statuses on a thumbnail.
// Status values scale with the spell's hidden power and/or the recipient's resistance.
export const ROLE_ICONS={attack:'⚔️',defense:'🛡️',support:'✚',debuff:'🕸️'};
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
 flame:'火傷：威力に応じた最大HP割合の継続ダメージを毎ターン受けます。',
 bolt:'感電：威力に応じて次の魔法の再使用待ちが延びます。',
 aqua:'浸水：威力に応じて属性耐性が低下し、耐性の加護も弱まります。',
 storm:'目眩：威力に応じた確率で攻撃魔法や通常攻撃が失敗します。',
 gravity:'重圧：威力に応じて魔法の出力が下がり、攻撃や回復が弱まります。',
 law:'封印：威力に応じて最大二種類の紋を一時的に使えなくします。',
 chaos:'暴走：次に使用する魔法陣をランダムに選び直します。'
};
export function circleAttributeEffects(circle,buffs=[]){
 const a=circle?.analysis;
 if(!a||!Object.hasOwn(ATTRIBUTES,a.attribute))return null;
 const {attribute,role}=a,chaos=attribute==='chaos';
 const buff=buffs.find(x=>x.id==='buff_'+attribute);
 const debuff=buffs.find(x=>x.id==='debuff_'+attribute);
 return {
  buff:chaos?'ランダム強化':buff?.name||'強化',
  debuff:debuff?.name||'弱体',
  buffActive:role==='defense',debuffActive:role==='debuff',
  buffDescription:BUFF_DETAILS[attribute],debuffDescription:DEBUFF_DETAILS[attribute],
  buffDuration:buff?.duration||'変動',debuffDuration:debuff?.duration||'変動'
 };
}
export function circleCardInfo(circle,buffs=[],mpCost=()=>null){
 const a=circle?.analysis;
 if(!a)return {symbols:'？ / ？',mp:'?',power:'?'};
 const at=ATTRIBUTES[a.attribute];
 const revealed=isRevealed(circle),mp=revealed?mpCost(circle.basePower??a.power):null;
 return {
  symbols:(at?.icon||'✦')+' / '+(ROLE_ICONS[a.role]||'？'),
  mp:revealed&&Number.isFinite(mp)?String(mp):'?',
  power:revealed?String(a.power):'?'
 };
}
export function circleEffectDetails(circle,buffs=[],statusDuration=null){
 const a=circle?.analysis;if(!a)return {effect:'解析されていません。',statusName:'',statusDescription:'',duration:''};
 const {attribute,role}=a,info=circleAttributeEffects(circle,buffs);
 if(role==='attack')return {effect:'敵に'+ATTRIBUTES[attribute].label+'属性の魔法ダメージを与えます。ダメージは属性相性・相手の防御力・状態効果で変わります。',statusName:'',statusDescription:'',duration:''};
 if(role==='support')return {effect:'自分のHPを回復し、'+ATTRIBUTES[attribute].label+'属性の🕸️弱体効果を解除します。回復量はHPの不足分を超えません。',statusName:'',statusDescription:'',duration:''};
 if(role==='defense')return {
  effect:'自分に'+ATTRIBUTES[attribute].label+'属性への耐性を付与し、追加で🛡️強化効果を得ます。',
  statusName:info.buff,
  statusDescription:info.buffDescription,
  duration:isRevealed(circle)&&typeof statusDuration==='function'?statusDuration(a)+'ターン（威力連動）':'2〜6ターン（威力連動）'
 };
 return {
  effect:'敵に'+ATTRIBUTES[attribute].label+'属性の🕸️弱体効果を与えます。持続時間と強さは魔法の威力に応じて変わり、相手の耐性でも変化します。',
  statusName:info.debuff,
  statusDescription:info.debuffDescription,
  duration:isRevealed(circle)&&typeof statusDuration==='function'?statusDuration(a)+'ターン':'2〜6ターン'
 };
}
export function attributeEffectGuide(buffs=[]){
 return Object.entries(ATTRIBUTES).map(([attribute,{icon,label}])=>{
  const effects=circleAttributeEffects({analysis:{attribute}},buffs);
  return {attribute,icon,label,buff:effects.buff,debuff:effects.debuff};
 });
}
