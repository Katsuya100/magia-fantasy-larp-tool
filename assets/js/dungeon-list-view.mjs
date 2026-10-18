// Pure list projections: never reorder the save file, inventory or slot IDs.
// Selection controls keep original indexes so filtered pickers cannot equip a wrong item.
const compareText=(a,b)=>String(a??'').localeCompare(String(b??''),'ja');
const validNumber=v=>Number.isFinite(Number(v))?Number(v):0;
const circlePower=c=>c?.revealed===false||!c?.analysis?null:validNumber(c.analysis.power);
export const itemKind=(item,masterItems=[])=>masterItems.find(row=>row.id===item?.id)?.kind||(
 item?.id==='life_ruby'?'revive':item?.id?.startsWith('elixir_')?'elixir':item?.id?.startsWith('heal_')?'heal':item?.id?.startsWith('mana_')?'mana':item?.id?.startsWith('clear_')?'clear':'other');
export function circleListIndexes(circles,{role='all',attribute='all',sort='newest'}={}){
 return circles.map((circle,index)=>({circle,index})).filter(({circle})=>
  (role==='all'||circle.analysis?.role===role)&&(attribute==='all'||circle.analysis?.attribute===attribute)
 ).sort((a,b)=>{
  const x=a.circle,y=b.circle;
  let order=0;
  if(sort==='oldest')order=validNumber(x.registeredAt)-validNumber(y.registeredAt);
  else if(sort==='role')order=compareText(x.analysis?.role,y.analysis?.role);
  else if(sort==='attribute')order=compareText(x.analysis?.attribute,y.analysis?.attribute);
  else if(sort==='power'){
   const px=circlePower(x),py=circlePower(y);
   order=px===null?(py===null?0:1):py===null?-1:py-px;
  }else order=validNumber(y.registeredAt)-validNumber(x.registeredAt);
  return order||a.index-b.index;
 }).map(row=>row.index);
}
export function itemListIndexes(inventory,masterItems=[],{kind='all',sort='default'}={}){
 return inventory.map((item,index)=>({item,index})).filter(({item})=>kind==='all'||itemKind(item,masterItems)===kind)
 .sort((a,b)=>{
  let order=0;
  if(sort==='name')order=compareText(masterItems.find(r=>r.id===a.item.id)?.name||a.item.id,
   masterItems.find(r=>r.id===b.item.id)?.name||b.item.id);
  if(sort==='kind')order=compareText(itemKind(a.item,masterItems),itemKind(b.item,masterItems));
  if(sort==='value')order=validNumber(b.item.value)-validNumber(a.item.value);
   if(sort==='value-asc')order=validNumber(a.item.value)-validNumber(b.item.value);
  return order||a.index-b.index;
 }).map(row=>row.index);
}
export const RARITY_ORDER={common:1,uncommon:2,rare:3,epic:4,legendary:5};
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
