let numbers=new Map(),levels=new Map(),floors=new Map(),ranges=new Map();
export function configure(data){
 for(const key of ['balance','levels','floors','playerBase'])if(!Array.isArray(data[key])||!data[key].length)throw Error('Missing master '+key);
 numbers=new Map(data.balance.map(x=>[x.key,Number(x.value)]));
 levels=new Map(data.levels.map(x=>[Number(x.level),x]));
 floors=new Map(data.floors.map(x=>[Number(x.floor),x]));
 ranges=new Map(data.playerBase.map(x=>[x.stat,x]));
}
export function num(key){if(!numbers.has(key)||!Number.isFinite(numbers.get(key)))throw Error('Missing balance '+key);return numbers.get(key);}
export function level(l){const r=levels.get(Number(l));if(!r)throw Error('Missing level '+l);return r;}
export function floor(f){
 const fight=Number(f);
 if(!Number.isSafeInteger(fight)||fight<1)throw Error('No floor '+f);
 const row=floors.get(fight);
 if(row)return row;
 if(fight<=500)throw Error('No floor '+f);
 return {floor:String(fight),enemy_level:String(num('level_max')),boss:fight%5===0?'1':'0',minimum_enemy_level:'1',boss_enemy_id:''};
}
export function range(key){const r=ranges.get(key);if(!r)throw Error('Missing base stat '+key);return [+r.min,+r.max];}
