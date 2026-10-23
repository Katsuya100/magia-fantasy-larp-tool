// Pure alchemy rules. One relic and exactly five distinct consumable instances.
const TIERS=['small','medium','large','extreme'];
const numeric=item=>Math.max(0,Number(item?.value)||0);
const kindOf=(item,rows)=>rows.find(row=>row.id===item.id)?.kind||'unknown';
const tierOf=(item,rows)=>rows.find(row=>row.id===item.id)?.tier||'small';
const strongest=(items,rows,cap='extreme')=>{
 const max=TIERS.indexOf(cap);
 return TIERS[Math.min(max,Math.max(0,...items.map(item=>TIERS.indexOf(tierOf(item,rows)))))]||'small';
};
const tierSuffix={small:'s',medium:'m',large:'l',extreme:'xl'};
const elixirValue={small:35,medium:65,large:100};

export function alchemyRecipe(relic,ingredients,rows){
 if(!Array.isArray(ingredients)||ingredients.length!==5)throw Error('錬金には携行品が5個必要です');
 if(!rows?.length||ingredients.some(item=>!item||!rows.some(row=>row.id===item.id)))throw Error('錬金素材が不正です');
 const rare=['epic','legendary'].includes(relic?.rarity);
 const groups=ingredients.map(item=>({item,kind:kindOf(item,rows)}));
 const of=kind=>groups.filter(group=>group.kind===kind).map(group=>group.item);
 const hp=of('heal'),mp=of('mana'),both=of('elixir');
 const clear=of('clear'),clearAll=of('clear_all'),escape=of('escape'),revive=of('revive');
 const cleanCount=clear.length+clearAll.length;
 // Epic recipes override ordinary matching and the escape fallback.
 if(rare&&both.length&&clearAll.length&&escape.length)return {id:'life_ruby',value:0};
 if(rare&&clear.length===5&&new Set(clear.map(item=>rows.find(row=>row.id===item.id)?.attribute)).size===5)return {id:'luna_stone',value:0};
 if(rare&&hp.length&&mp.length){
  const tier=strongest([...hp,...mp],rows,'large');
  return {id:'elixir_'+tierSuffix[tier],value:elixirValue[tier]};
 }
 // Combined HP/MP restoratives remain combined if one is in the mix.
 if(both.length){
  const tier=strongest([...both,...hp,...mp],rows,'large');
  return {id:'elixir_'+tierSuffix[tier],value:Math.min(100,Math.max(elixirValue[tier],both.reduce((v,item)=>v+numeric(item),0)))};
 }
 const specials=[...escape,...revive];
 if(specials.length>=2)return {id:revive.length===specials.length?'life_ruby':'escape_scroll',
  value:specials.reduce((n,item)=>n+numeric(item),0)*2+specials.length};
 if(hp.length||mp.length){
  // Equal pairs favor HP when there are two of each, otherwise MP.
  const target=hp.length===mp.length?(hp.length>=2?'heal':'mana'):(hp.length>mp.length?'heal':'mana');
  const tier=strongest(target==='heal'?hp:mp,rows);
  const value=[...hp,...mp].reduce((n,item)=>n+numeric(item),0)+cleanCount*10;
  return {id:(target==='heal'?'heal_':'mana_')+tierSuffix[tier],value};
 }
 // Every combination not covered above becomes an escape scroll.
 return {id:'escape_scroll',value:0};
}

export function alchemyAutoSelect(inventory,rows,kind='all',priority='value'){
 const types=kind==='hp'?['heal']:kind==='mp'?['mana']:kind==='status'?['clear','clear_all']:null;
 return inventory.map((item,index)=>({item,index,kind:kindOf(item,rows)}))
  .filter(x=>!types||types.includes(x.kind))
  .sort((a,b)=>{
   if(priority==='value')return numeric(b.item)-numeric(a.item)||a.index-b.index;
   if(priority==='value-asc')return numeric(a.item)-numeric(b.item)||a.index-b.index;
   return a.index-b.index;
  }).slice(0,5).map(x=>x.index);
}

export function craftAlchemy(profile,relic,indexes,rows,buffs=[],random=Math.random,newId=()=>crypto.randomUUID()){
 if(profile?.run)throw Error('探索中は錬金できません');
 if(!relic||Number(profile?.collection?.[relic.id]||0)<2)throw Error('コレクションが不足しています');
 if(!Array.isArray(indexes)||indexes.length!==5||new Set(indexes).size!==5||
  indexes.some(i=>!Number.isInteger(i)||i<0||i>=profile.inventory.length))throw Error('錬金素材を5個選択してください');
 const ingredients=indexes.map(i=>profile.inventory[i]);
 const outcome=alchemyRecipe(relic,ingredients,rows);
 const created={...outcome,instanceId:newId()};
 const chance=Math.max(0,Math.min(1,Number(random())||0));
 if(relic.rarity==='epic'||relic.rarity==='uncommon'&&chance<.5){
  created.value=Math.round(created.value*1.25);
  // Elixirs use percentages and cannot exceed a full heal.
  if(created.id.startsWith('elixir_'))created.value=Math.min(100,created.value);
  created.alchemyBoost=true;
 }
 if(relic.rarity==='legendary'||relic.rarity==='rare'&&chance<.5){
  const choices=buffs.filter(row=>row.kind==='buff'&&row.id?.startsWith('buff_'));
  if(choices.length)created.bonus=choices[Math.min(choices.length-1,Math.floor(Math.max(0,Math.min(.999999,Number(random())||0))*choices.length))].id;
 }
 const consumed=new Set(indexes),removedIds=new Set(ingredients.map(item=>item.instanceId));
 return {...profile,
  inventory:[...profile.inventory.filter((_,i)=>!consumed.has(i)),created],
  collection:{...profile.collection,[relic.id]:Number(profile.collection[relic.id])-1},
  carrySlots:(profile.carrySlots||[]).map(id=>removedIds.has(id)?null:id),
  obtainedItemIds:[...new Set([...(profile.obtainedItemIds||[]),created.id])]};
}
