// Dungeon progression keeps its stable fight index for CSV masters and saved runs.
// Five encounters make one layer; its fifth encounter is the layer boss.
export const FIGHTS_PER_LAYER=5;
export function layerOfFight(fight){
 const n=Number(fight);
 return Number.isSafeInteger(n)&&n>0?Math.ceil(n/FIGHTS_PER_LAYER):0;
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
export function battleHeading(fight){return encounterLabel(fight)+(isLayerBoss(fight)?' · 階層ボス':'');}
export function clearedLayer(fight){return isLayerBoss(fight)?layerOfFight(fight):0;}
export function nextLayer(fight){return layerOfFight(fight)+1;}
// Only a successful return from a defeated layer boss establishes a record.
// Legacy "highest" tracked *visits*, so it cannot safely be treated as a return.
export function deepestReturnedLayer(profile){
 const depth=Number(profile?.deepestReturnedLayer);
 return Number.isSafeInteger(depth)&&depth>0?depth:0;
}
export function recordReturnedLayer(profile,fight){
 const completed=clearedLayer(fight);
 if(completed)profile.deepestReturnedLayer=Math.max(deepestReturnedLayer(profile),completed);
 return deepestReturnedLayer(profile);
}
