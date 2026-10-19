// Lost equipment remains tied to the enemy that defeated its owner.
export function createLostLegacy(profile,run,circles){
 const equipped=new Set((run.slotIds||[]).filter(Boolean));
 return {
  name:profile.name||'名もなき冒険者',level:profile.level,
  enemyId:run.enemy.id,
  circles:circles.filter(circle=>equipped.has(circle.id)),
  items:(run.carry||[]).filter(Boolean),
  loot:run.loot||[],
  rank:profile.adventurerRank||0
 };
}
export function createSuccessorProfile(profile,run,circles,newBase){
 const legacy=createLostLegacy(profile,run,circles);
 const lost=new Set(legacy.circles.map(circle=>circle.id));
 return {
  ...profile,name:'',level:1,xp:0,base:newBase,returns:0,attempts:0,
  adventurerRank:0,deepestReturnedLayer:0,defeatedBosses:{},collection:{},
  obtainedItemIds:[...new Set((profile.inventory||[]).map(item=>item.id))],
  slots:(profile.slots||[]).map(id=>lost.has(id)?null:id),
  favoriteCircleId:lost.has(profile.favoriteCircleId)?null:profile.favoriteCircleId,
  circleUpgrades:Object.fromEntries(Object.entries(profile.circleUpgrades||{}).filter(([id])=>!lost.has(id))),
  run:null,pendingReturn:null,tutorialDone:true,awaitingHeir:true,permadeath:true,
  legacies:[...(profile.legacies||[]),legacy]
 };
}
// A recovered bundle can contain an earlier bundle if another heir died before returning.
export function legacyContents(legacy){
 const result={circles:[...(legacy.circles||[])],items:[...(legacy.items||[])],
  loot:[],rank:Number(legacy.rank)||0};
 for(const reward of legacy.loot||[]){
  if(reward.type!=='legacy'){result.loot.push(reward);continue;}
  const nested=legacyContents(reward.legacy);
  result.circles.push(...nested.circles);
  result.items.push(...nested.items);
  result.loot.push(...nested.loot);
  result.rank=Math.max(result.rank,nested.rank);
 }
 return result;
}
export function reclaimLegacies(profile,enemyId,run){
 const found=(profile.legacies||[]).filter(legacy=>legacy.enemyId===enemyId);
 if(!found.length)return [];
 run.loot.push(...found.map(legacy=>({type:'legacy',legacy})));
 profile.legacies=profile.legacies.filter(legacy=>legacy.enemyId!==enemyId);
 return found;
}
