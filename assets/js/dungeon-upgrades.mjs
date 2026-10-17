// Every consumed stone adds exactly 10% of the original analyzed power.
// Recalculate from the original rather than compounding already-upgraded power.
export function upgradeCircle(circle){
 const power=Number(circle?.analysis?.power);
 const base=Number(circle?.basePower??power);
 const level=Number(circle?.upgradeLevel??0);
 if(!Number.isFinite(power)||power<=0||!Number.isFinite(base)||base<=0||!Number.isSafeInteger(level)||level<0||level>=100000)throw Error('強化できない魔法陣です');
 const next=level+1;
 return {...circle,basePower:base,upgradeLevel:next,
  analysis:{...circle.analysis,power:Number((base*(1+next/10)).toFixed(8))}};
}
