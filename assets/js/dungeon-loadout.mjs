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
