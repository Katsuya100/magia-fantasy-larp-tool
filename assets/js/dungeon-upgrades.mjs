import {circleLegacyLevelSources,totalLegacyLevel} from './dungeon-permadeath.mjs';
// No first-upgrade barrier; repeat-farming yields about five times more stones.
// Subsequent purchases cost five, increasing every 40 upgrades. Saved levels are unchanged.
export function upgradeStoneCost(level=0){
 const current=Number(level);
 if(!Number.isSafeInteger(current)||current<0)throw Error('無効な強化段階です');
 return current===0?1:5+Math.floor((current-1)/40);
}
export function totalUpgradeStoneCost(level){
 const count=Number(level);
 if(!Number.isSafeInteger(count)||count<0)throw Error('無効な強化段階です');
 if(count===0)return 0;
 const afterFirst=count-1,tiers=Math.floor(afterFirst/40),rest=afterFirst%40;
 return 1+40*(5*tiers+tiers*(tiers-1)/2)+rest*(5+tiers);
}
// Each upgrade increases power by 10% of original, never compounding.
// Round the final effective power upward and suppress representation noise.
export function strengthenedPower(base,level){
 const value=Number((base*(1+level/10)).toFixed(8));
 return Math.ceil(value);
}
export function upgradeCircle(circle){
 const power=Number(circle?.analysis?.power);
 const base=Number(circle?.basePower??power);
 const level=Number(circle?.upgradeLevel??0);
 if(!Number.isFinite(power)||power<=0||!Number.isFinite(base)||base<=0||!Number.isSafeInteger(level)||level<0||level>=100000)throw Error('強化できない魔法陣です');
 const next=level+1;
 return {...circle,basePower:base,upgradeLevel:next,
  analysis:{...circle.analysis,power:strengthenedPower(base,next)}};
}
export function combatSpell(circle){
 return circle?.analysis?{...circle.analysis,basePower:circle.basePower??circle.analysis.power,
  upgradeLevel:Number.isSafeInteger(circle.upgradeLevel)&&circle.upgradeLevel>0?circle.upgradeLevel:0,
  ...(totalLegacyLevel(circle)>0?{legacyHp:totalLegacyLevel(circle),legacyHpSources:circleLegacyLevelSources(circle).map(({name,level})=>({name,hp:level}))}:{})}:null;
}
// Avoid rewriting an already-saved photograph Blob for every power upgrade.
export function savedUpgrade(circle){
 return {basePower:circle.basePower,upgradeLevel:circle.upgradeLevel};
}
export function applySavedUpgrade(circle,record){
 if(!circle?.analysis)return circle;
 // Read either current profile metadata or the older upgraded photo record.
 const source=record??circle;
 const base=Number(source.basePower),level=Number(source.upgradeLevel);
 if(!Number.isFinite(base)||base<=0||!Number.isSafeInteger(level)||level<1||level>100000)return circle;
 return {...circle,basePower:base,upgradeLevel:level,
  analysis:{...circle.analysis,power:strengthenedPower(base,level)}};
}
