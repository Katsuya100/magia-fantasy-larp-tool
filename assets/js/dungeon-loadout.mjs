// Positional, five-column preparation grids. Keep gaps; never duplicate unique selections.
export const GRID_COLUMNS=5;
export const DEFAULT_SPELL_SLOTS=5;
export function normalizeSlots(values,limit,valid) {
 const source=Array.isArray(values)?values:[];
 const result=Array(limit).fill(null),used=new Set();
 for(let i=0;i<Math.min(limit,source.length);i++){
  const value=source[i];
  if(value!==null&&value!==undefined&&valid(value)&&!used.has(value)){result[i]=value;used.add(value);}
 }
 return result;
}
export function setSlot(current,index,value) {
 if(!Number.isInteger(index)||index<0||index>=current.length)throw Error('Invalid slot');
 const next=[...current],before=next[index];
 if(value===null){next[index]=null;return next;}
 const previous=next.findIndex((item,i)=>i!==index&&item===value);
 if(previous>=0)next[previous]=before??null;
 next[index]=value;
 return next;
}
export function prepareCircles(values,ids,limit=DEFAULT_SPELL_SLOTS){
 const validIds=new Set(ids);
 return normalizeSlots(values,limit,value=>typeof value==='string'&&validIds.has(value));
}
export function prepareItems(values,inventoryLength,capacity){
 return normalizeSlots(values,Math.max(GRID_COLUMNS,capacity),value=>Number.isInteger(value)&&value>=0&&value<inventoryLength);
}
export function pickedValues(values){return values.filter(value=>value!==null&&value!==undefined);}
export function isFull(values){return values.length>0&&values.every(value=>value!==null&&value!==undefined);}

// Persist individual consumable instances (not type IDs or mutable inventory offsets).
export function ensureItemInstances(profile,newId=()=>crypto.randomUUID()){
 const seen=new Set();let changed=false;
 for(const item of [...(profile.inventory||[]),...(profile.run?.carry||[])]) {
  if(!item)continue;
  if(typeof item.instanceId!=='string'||!item.instanceId||seen.has(item.instanceId)){
   let id;do{id=newId();}while(seen.has(id));
   item.instanceId=id;changed=true;
  }
  seen.add(item.instanceId);
 }
 return changed;
}
export function saveCarrySlots(indexSlots,inventory){
 return indexSlots.map(i=>Number.isInteger(i)&&inventory[i]?.instanceId||null);
}
export function restoreCarrySlots(savedSlots,inventory,capacity){
 const byInstance=new Map(inventory.map((item,index)=>[item.instanceId,index]));
 const ids=normalizeSlots(savedSlots,Math.max(GRID_COLUMNS,capacity),id=>typeof id==='string'&&byInstance.has(id));
 return ids.map(id=>id===null?null:byInstance.get(id));
}
export function validCarrySlots(savedSlots,inventory,capacity){
 return saveCarrySlots(restoreCarrySlots(savedSlots,inventory,capacity),inventory);
}
