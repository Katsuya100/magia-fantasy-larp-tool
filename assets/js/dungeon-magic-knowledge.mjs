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
export function attributeEffectGuide(buffs=[]){
 return Object.entries(ATTRIBUTES).map(([attribute,{icon,label}])=>({attribute,icon,label,
 buff:buffs.find(x=>x.id==='buff_'+attribute)?.name||'ランダム強化',
 debuff:buffs.find(x=>x.id==='debuff_'+attribute)?.name||'ランダム弱体'}));
}