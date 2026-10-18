import {GRID_COLUMNS} from './dungeon-loadout.mjs';
import {circleCardInfo} from './dungeon-magic-knowledge.mjs';
// The same three-line layout is used beneath each individual circle thumbnail.
// Only defense and debuff spells get an additional status-name line.
export function circleEffectBadges(circle,buffs=[],escapeText=x=>String(x),mpCost=()=>null){
 const d=circleCardInfo(circle,buffs,mpCost);
 return '<div class="circle-card-info">'
  +'<span class="circle-card-symbols">'+escapeText(d.symbols)+'</span>'
  +(d.statusName?'<span class="circle-card-status">'+escapeText(d.statusName)+'</span>':'')
  +'<span class="circle-card-stats"><span class="circle-card-mp">MP:'+escapeText(d.mp)+'</span>'
  +'<span class="circle-card-power">威力:'+escapeText(d.power)+'</span></span>'
  +'</div>';
}
export function itemSymbol(item){return item?.id==='life_ruby'?'🔴':item?.id?.startsWith('elixir_')?'⚗':item?.id==='escape_scroll'?'📜':item?.id?.startsWith('heal_')?'✚':item?.id?.startsWith('mana_')?'✧':'◈';}
export function itemEffectText(item){return item?.id==='life_ruby'?'死亡時に1回だけHP50%で復活':item?.id?.startsWith('elixir_')?'HP/MP各'+item.value+'%回復':item?.id==='escape_scroll'?'経験値・戦利品を持ち帰って脱出':item?.value?'効果 '+item.value:'状態異常解除';}
export function spellGrid(slots,circles,imageUrl,escapeText,active=true,buffs=[],mpCost=()=>null){
 const byId=new Map(circles.map(circle=>[circle.id,circle]));
 return '<div class="loadout-grid" role="group" aria-label="魔法陣の編成">'
  +slots.map((id,index)=>{
   const c=byId.get(id);
   return '<div class="prepare-spell-frame"><button type="button" class="loadout-tile '+(c?'equipped':'empty')+'" data-open-slot="'+index+'" aria-label="魔法陣 '+(index+1)+'枠目 '+(c?'装備中':'未装備')+'" '+(active?'':'disabled')+'>'
   +'<span class="tile-index">'+String(index+1).padStart(2,'0')+'</span>'
   +(c?'<img alt="" src="'+imageUrl(c.image)+'">':'<span class="tile-empty-icon" aria-hidden="true">＋</span>')
   +(c?'':'<span class="tile-title">未装備</span>')
   +'</button>'+(c?circleEffectBadges(c,buffs,escapeText,mpCost)
    +'<button type="button" class="subtle magic-expand" data-circle-detail="'+escapeText(c.id)+'">詳細</button>':'')+'</div>';
  }).join('')+'</div>';
}
export function itemGrid(slots,inventory,capacity,unlocked,itemName,escapeText,active=true){
 return '<div class="loadout-grid" role="group" aria-label="携行品">'
  +slots.slice(0,unlocked?capacity:0).map((inventoryIndex,index)=>{
    const usable=unlocked&&index<capacity&&active;
    const value=Number.isInteger(inventoryIndex)?inventory[inventoryIndex]:null;
    const locked=index>=capacity||!unlocked;
    return '<button type="button" class="loadout-tile '+(locked?'locked':value?'equipped':'empty')+'" data-open-item="'+index+'" aria-label="携行品 '+(index+1)+'枠目 '+(locked?'未解放':value?escapeText(itemName(value)):'空き')+'" '+(usable?'':'disabled')+'>'
     +'<span class="tile-index">'+String(index+1).padStart(2,'0')+'</span>'
     +'<span class="tile-item-icon" aria-hidden="true">'+(locked?'♙':value?itemSymbol(value):'＋')+'</span>'
     +'<span class="tile-title">'+(locked?'未解放':value?escapeText(itemName(value)):'空き')+'</span>'
     +'</button>';
   }).join('')+'</div>';
}
// Highlight every equipped choice, including when the picker is sorted or filtered.
// The editing slot receives a second focus indicator; choosing another equipped
// entry still uses the existing swap behavior.
export function circleChoices(circles,slots,imageUrl,escapeText,summary,buffs=[],mpCost=()=>null,indexes=circles.map((_,i)=>i),editingSlot=-1){
 if(!circles.length)return '<p class="collection-empty">魔導書に魔法陣を登録してください。</p>';
 return indexes.map(i=>[circles[i],i]).map(([c,i])=>{
  const selectedSlot=slots.indexOf(c.id),selected=selectedSlot>=0,current=selected&&selectedSlot===editingSlot;
  return '<div class="picker-circle-wrap"><button type="button" class="picker-option'+(selected?' picker-selected':'')+(current?' picker-current':'')+'" data-choose-circle="'+i+'" aria-pressed="'+selected+'" aria-label="魔法陣の候補 '+(i+1)+(selected?'・選択中 '+(selectedSlot+1)+'枠目':'')+'">'
   +'<img alt="" src="'+imageUrl(c.image)+'">'
   +'</button>'
   +circleEffectBadges(c,buffs,escapeText,mpCost)
   +'<button type="button" class="subtle magic-expand" data-circle-detail="'+escapeText(c.id)+'">詳細</button></div>';
 }).join('');
}
export function itemChoices(inventory,slots,itemName,escapeText,indexes=inventory.map((_,i)=>i),editingSlot=-1){
 if(!inventory.length)return '<p class="collection-empty">携行品がありません。</p>';
 return indexes.map(index=>[inventory[index],index]).map(([item,index])=>{
  const selectedSlot=slots.indexOf(index),selected=selectedSlot>=0,current=selected&&selectedSlot===editingSlot;
  return '<button type="button" class="picker-option'+(selected?' picker-selected':'')+(current?' picker-current':'')+'" data-choose-item="'+index+'" aria-pressed="'+selected+'" aria-label="'+escapeText(itemName(item))+(selected?'・選択中 '+(selectedSlot+1)+'枠目':'')+'">'
   +'<span class="picker-item-icon" aria-hidden="true">'+itemSymbol(item)+'</span>'
   +'<span class="picker-label">'+escapeText(itemName(item))+'<small>'
   +(item.id==='life_ruby'||item.id?.startsWith('elixir_')||item.id==='escape_scroll'?itemEffectText(item):item.value?'効果量 '+item.value:'状態異常解除')+(item.bonus?' ✦追加効果':'')+'</small></span>'
   +'</button>';
 }).join('');
}
