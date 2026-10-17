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
// Old profiles stored the deepest *fight* under highest. Convert once, then
// tag the unit so visiting/reloading never divides an already-converted layer.
export function migrateHighestLayer(profile){
 if(profile.highestUnit==='layer')return false;
 profile.highest=layerOfFight(profile.highest);
 profile.highestUnit='layer';
 return true;
}
export function recordLayerVisit(profile,fight){
 migrateHighestLayer(profile);
 const reached=layerOfFight(fight);
 profile.highest=Math.max(Number(profile.highest)||0,reached);
 return profile.highest;
}
