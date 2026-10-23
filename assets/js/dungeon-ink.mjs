// Independent boss-only crafting material, never a combat consumable.
export const MAGIC_INK_ID='magic_ink';
export const MAGIC_INK_NAME='魔導墨';
export const BOSS_INK_DROP_CHANCE=0.20;
export const bossDropsMagicInk=(bossEnemyId,random=Math.random)=>Boolean(bossEnemyId)&&random()<BOSS_INK_DROP_CHANCE;
// Apply once after drawn-circle adjustments and before future stone upgrades.
export function inkEnhancedAnalysis(analysis,count=1){
 const power=Number(analysis?.power);
 if(!Number.isFinite(power)||power<=0)throw Error('魔法陣の基礎威力が不正です');
 if(!Number.isSafeInteger(count)||count<0||count>5)throw Error('魔導墨の消費数が不正です');
 return {...analysis,power:Math.ceil(Number((power*(1+count/10)).toFixed(8)))};
}
