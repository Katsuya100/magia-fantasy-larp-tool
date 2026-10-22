// Independent boss-only crafting material, never a combat consumable.
export const MAGIC_INK_ID='magic_ink';
export const MAGIC_INK_NAME='魔導のインク';
export const BOSS_INK_DROP_CHANCE=0.20;
export const bossDropsMagicInk=(bossEnemyId,random=Math.random)=>Boolean(bossEnemyId)&&random()<BOSS_INK_DROP_CHANCE;
// Apply once after drawn-circle adjustments and before future stone upgrades.
export function inkEnhancedAnalysis(analysis){
 const power=Number(analysis?.power);
 if(!Number.isFinite(power)||power<=0)throw Error('魔法陣の基礎威力が不正です');
 return {...analysis,power:Math.ceil(Number((power*1.1).toFixed(8)))};
}
