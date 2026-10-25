// Pure list projections: never reorder the save file, inventory or slot IDs.
// Selection controls keep original indexes so filtered pickers cannot equip a wrong item.
const compareText=(a,b)=>String(a??'').localeCompare(String(b??''),'ja');
const validNumber=v=>Number.isFinite(Number(v))?Number(v):0;
const circlePower=c=>c?.revealed===false||!c?.analysis?null:validNumber(c.analysis.power);
export const itemKind=(item,masterItems=[])=>masterItems.find(row=>row.id===item?.id)?.kind||(
 item?.id==='life_ruby'?'revive':item?.id==='luna_stone'?'clear_all':item?.id==='escape_scroll'?'escape':item?.id?.startsWith('elixir_')?'elixir':item?.id?.startsWith('heal_')?'heal':item?.id?.startsWith('mana_')?'mana':item?.id?.startsWith('clear_')?'clear':'other');
export function circleListIndexes(circles,{role='all',attribute='all',sort='newest',slots=[]}={}){
 const equipped=new Map();
 if(sort==='equipped')slots.forEach((id,index)=>{if(id&&!equipped.has(id))equipped.set(id,index);});
 return circles.map((circle,index)=>({circle,index})).filter(({circle})=>
  (role==='all'||circle.analysis?.role===role)&&(attribute==='all'||circle.analysis?.attribute===attribute)
 ).sort((a,b)=>{
  const x=a.circle,y=b.circle;
  let order=0;
  if(sort==='equipped'){
   const aSlot=equipped.get(x.id)??Infinity,bSlot=equipped.get(y.id)??Infinity;
   order=aSlot===bSlot?0:aSlot-bSlot;
  }
  else if(sort==='oldest')order=validNumber(x.registeredAt)-validNumber(y.registeredAt);
  else if(sort==='role')order=compareText(x.analysis?.role,y.analysis?.role);
  else if(sort==='attribute')order=compareText(x.analysis?.attribute,y.analysis?.attribute);
  else if(sort==='power'){
   const px=circlePower(x),py=circlePower(y);
   order=px===null?(py===null?0:1):py===null?-1:py-px;
  }else order=validNumber(y.registeredAt)-validNumber(x.registeredAt);
  return order||a.index-b.index;
 }).map(row=>row.index);
}
const ITEM_KIND_ORDER=['heal','mana','elixir','clear','revive','escape'];
const itemKindGroup=kind=>kind==='clear_all'?'clear':kind;
export function itemListIndexes(inventory,masterItems=[],{kind='all',sort='default',withinKindSort='default'}={}){
 const previousOrder=sort==='kind'?new Map(itemListIndexes(inventory,masterItems,{
  sort:withinKindSort==='kind'?'default':withinKindSort
 }).map((index,position)=>[index,position])):null;
 const counts=new Map();
 if(sort==='count')for(const item of inventory)counts.set(item.id,(counts.get(item.id)||0)+1);
 return inventory.map((item,index)=>({item,index})).filter(({item})=>{
  const type=itemKind(item,masterItems);
  return kind==='all'||type===kind||(kind==='clear'&&type==='clear_all');
 })
 .sort((a,b)=>{
  let order=0;
  if(sort==='count')order=(counts.get(b.item.id)||0)-(counts.get(a.item.id)||0);
  if(sort==='name')order=compareText(masterItems.find(r=>r.id===a.item.id)?.name||a.item.id,
   masterItems.find(r=>r.id===b.item.id)?.name||b.item.id);
  if(sort==='kind'){
   const rank=item=>{const i=ITEM_KIND_ORDER.indexOf(itemKindGroup(itemKind(item,masterItems)));return i<0?ITEM_KIND_ORDER.length:i;};
   order=rank(a.item)-rank(b.item)||previousOrder.get(a.index)-previousOrder.get(b.index);
  }
  if(sort==='value')order=validNumber(b.item.value)-validNumber(a.item.value);
   if(sort==='value-asc')order=validNumber(a.item.value)-validNumber(b.item.value);
  return order||a.index-b.index;
 }).map(row=>row.index);
}
export const RARITY_ORDER={common:1,uncommon:2,rare:3,epic:4,legendary:5};
// Visual-only rarity marks; filters and sorting keep the original rarity names.
export const collectionRarityMarks=rarity=>'✴︎'.repeat(RARITY_ORDER[rarity]||0);
export function collectionListIndexes(collections,owned={}, {discovery='all',rarity='all',sort='common'}={}){
 const found=row=>validNumber(owned[row.id])>0;
 return collections.map((item,index)=>({item,index})).filter(({item})=>
  (discovery==='all'||(discovery==='found' ? found(item):!found(item)))&&
  // Keep undiscovered rarities a secret, even when filtering rare items.
  (rarity==='all'||found(item)&&item.rarity===rarity)
 ).sort((a,b)=>{
  const x=a.item,y=b.item,ax=found(x),by=found(y);
  let order=0;
  if(sort==='name')order=ax&&by?compareText(x.name,y.name):Number(by)-Number(ax);
  if(sort==='count')order=validNumber(owned[y.id])-validNumber(owned[x.id]);
  if(sort==='rare'||sort==='common'){
   const rarityA=ax?RARITY_ORDER[x.rarity]||0:0,rarityB=by?RARITY_ORDER[y.rarity]||0:0;
   order=sort==='rare'?rarityB-rarityA:
    ax!==by?Number(by)-Number(ax):rarityA-rarityB;
  }
  return order||a.index-b.index;
 }).map(row=>row.index);
}
