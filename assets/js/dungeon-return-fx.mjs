// A single one-second timeline, including level thresholds crossed.
export const RETURN_XP_DURATION_MS=1000;
export function returnXpFrame(before,earned,elapsedMs,nextXp,maxLevel){
 const fraction=Math.max(0,Math.min(1,Number(elapsedMs)/RETURN_XP_DURATION_MS||0));
 let level=before.level,xp=before.xp+Math.max(0,earned)*fraction;
 while(level<maxLevel&&xp>=nextXp(level)){
  xp-=nextXp(level);
  level++;
 }
 const threshold=nextXp(level);
 return {level,xp,percent:threshold>0?Math.max(0,Math.min(100,100*xp/threshold)):100};
}
