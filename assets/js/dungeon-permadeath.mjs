// Lost equipment remains tied to the enemy that defeated its owner.
// Each circle stores its first creator and the names of deceased inheritors.
const recordedName=value=>typeof value==='string'?value.trim().slice(0,20):'';
const inheritedNames=circle=>Array.isArray(circle?.legacyHeirNames)
 ?[...new Set(circle.legacyHeirNames.map(recordedName).filter(Boolean))]:[];
// Inheritance is the sum of unique deceased owners' levels (no multiplier).
// Older saves stored HP = level * 2. Retain their known total without inventing missing levels.
export function circleLegacyLevelSources(circle){
 const current=Array.isArray(circle?.legacyLevelSources)?circle.legacyLevelSources:null;
 const previous=Array.isArray(circle?.legacyHpSources)?circle.legacyHpSources:null;
 const entries=current??previous?.map(source=>({name:source.name,level:Number(source.hp)/2}))??[];
 const seen=new Set(),result=[];
 for(const entry of entries){
  const name=recordedName(entry?.name),level=Math.floor(Number(entry?.level));
  if(!name||!Number.isSafeInteger(level)||level<=0||seen.has(name))continue;
  seen.add(name);result.push({name,level});
 }
 if(!result.length&&Number(circle?.legacyHp)>0){
  const level=Math.floor(Number(circle.legacyHp)/2);
  if(Number.isSafeInteger(level)&&level>0){
   const name=inheritedNames(circle).length?'旧記録':recordedName(circle.legacyOriginName)||'旧記録';
   result.push({name,level});
  }
 }
 return result;
}
export const totalLegacyLevel=circle=>circleLegacyLevelSources(circle).reduce((sum,source)=>sum+source.level,0);
function withLegacyLevel(circle,name,level){
 const sources=circleLegacyLevelSources(circle),owner=recordedName(name),value=Math.floor(Number(level));
 if(owner&&Number.isSafeInteger(value)&&value>0&&!sources.some(source=>source.name===owner))sources.push({name:owner,level:value});
 const {legacyHpSources,...saved}=circle;
 return {...saved,legacyLevelSources:sources,legacyHp:sources.reduce((sum,source)=>sum+source.level,0)};
}
export function markCircleCreator(circle,name){
 const creator=recordedName(name);
 return creator?{...circle,legacyOriginName:creator}:circle;
}
export function circleRelicHistory(circle){
 return {originName:recordedName(circle?.legacyOriginName),heirNames:inheritedNames(circle)};
}
function circleLostWithOwner(circle,currentName){
 const current=recordedName(currentName);
 // Never pretend the latest heir created an already-recovered, old relic.
 const origin=recordedName(circle.legacyOriginName)||(circle.legacyHp?'':current);
 const heirs=inheritedNames(circle);
 if(current&&current!==origin&&!heirs.includes(current))heirs.push(current);
 return {...circle,legacyOriginName:origin,legacyHeirNames:heirs};
}
function recoveredCircle(circle,legacyName){
 return {...circle,
  legacyOriginName:recordedName(circle.legacyOriginName)||recordedName(legacyName),
  legacyHeirNames:inheritedNames(circle)};
}
export function createLostLegacy(profile,run,circles){
 const equipped=new Set((run.slotIds||[]).filter(Boolean));
 return {
  name:profile.name||'名もなき冒険者',level:profile.level,
  enemyId:run.enemy.id,
  circles:circles.filter(circle=>equipped.has(circle.id)).map(circle=>circleLostWithOwner(circle,profile.name)),
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
 const result={circles:(legacy.circles||[]).map(circle=>recoveredCircle(withLegacyLevel(circle,legacy.name,legacy.level),legacy.name)),items:[...(legacy.items||[])],
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
