import {GRID_COLUMNS} from './dungeon-loadout.mjs';
export function itemSymbol(item){return item?.id?.startsWith('heal_')?'✚':item?.id?.startsWith('mana_')?'✧':'◈';}
export function spellGrid(slots,circles,imageUrl,escapeText,active=true){
 const byId=new Map(circles.map(circle=>[circle.id,circle]));
 return '<div class="loadout-grid" role="group" aria-label="魔法陣の編成">'
  +slots.map((id,index)=>{
   const c=byId.get(id);
   return '<button type="button" class="loadout-tile '+(c?'equipped':'empty')+'" data-open-slot="'+index+'" aria-label="魔法陣 '+(index+1)+'枠目 '+(c?escapeText(c.name):'未装備')+'" '+(active?'':'disabled')+'>'
   +'<span class="tile-index">'+String(index+1).padStart(2,'0')+'</span>'
   +(c?'<img alt="" src="'+imageUrl(c.image)+'">':'<span class="tile-empty-icon" aria-hidden="true">＋</span>')
   +'<span class="tile-title">'+(c?escapeText(c.name):'未装備')+'</span>'
   +'</button>';
  }).join('')+'</div>';
}
export function itemGrid(slots,inventory,capacity,unlocked,itemName,escapeText,active=true){
 return '<div class="loadout-grid" role="group" aria-label="持ち込みアイテム">'
  +slots.map((inventoryIndex,index)=>{
    const usable=unlocked&&index<capacity&&active;
    const value=Number.isInteger(inventoryIndex)?inventory[inventoryIndex]:null;
    const locked=index>=capacity||!unlocked;
    return '<button type="button" class="loadout-tile '+(locked?'locked':value?'equipped':'empty')+'" data-open-item="'+index+'" aria-label="持ち込み '+(index+1)+'枠目 '+(locked?'未解放':value?escapeText(itemName(value)):'空き')+'" '+(usable?'':'disabled')+'>'
     +'<span class="tile-index">'+String(index+1).padStart(2,'0')+'</span>'
     +'<span class="tile-item-icon" aria-hidden="true">'+(locked?'♙':value?itemSymbol(value):'＋')+'</span>'
     +'<span class="tile-title">'+(locked?'未解放':value?escapeText(itemName(value)):'空き')+'</span>'
     +'</button>';
   }).join('')+'</div>';
}
export function circleChoices(circles,slots,imageUrl,escapeText){
 if(!circles.length)return '<p class="collection-empty">魔導書に魔法陣を登録してください。</p>';
 return circles.map((c,i)=>'<button type="button" class="picker-option" data-choose-circle="'+i+'">'
  +'<img alt="" src="'+imageUrl(c.image)+'"><span class="picker-label">'+escapeText(c.name)
  +'<small>'+(c.analysis?escapeText(c.analysis.attribute+' / '+c.analysis.role):'？？？ 未鑑定')+'</small></span>'
  +(slots.includes(c.id)?'<span class="picker-equipped">編成中</span>':'')+'</button>').join('');
}
export function itemChoices(inventory,slots,itemName,escapeText){
 if(!inventory.length)return '<p class="collection-empty">持ち込みできるアイテムがありません。</p>';
 return inventory.map((item,index)=>'<button type="button" class="picker-option" data-choose-item="'+index+'">'
  +'<span class="picker-item-icon" aria-hidden="true">'+itemSymbol(item)+'</span>'
  +'<span class="picker-label">'+escapeText(itemName(item))+'<small>'
  +(item.value?'効果量 '+item.value:'状態異常解除')+(item.bonus?' ✦追加効果':'')+'</small></span>'
  +(slots.includes(index)?'<span class="picker-equipped">編成中</span>':'')+'</button>').join('');
}
