import {targetClearLevel,layerForFight} from './dungeon-design.mjs';
let numbers=new Map(),levels=new Map(),floors=new Map(),ranges=new Map();
export function configure(data){
 for(const key of ['balance','levels','floors','playerBase'])if(!Array.isArray(data[key])||!data[key].length)throw Error('Missing master '+key);
 numbers=new Map(data.balance.map(x=>[x.key,Number(x.value)]));
 levels=new Map(data.levels.map(x=>[Number(x.level),x]));
 floors=new Map(data.floors.map(x=>[Number(x.floor),x]));
 ranges=new Map(data.playerBase.map(x=>[x.stat,x]));
}
export function num(key){if(!numbers.has(key)||!Number.isFinite(numbers.get(key)))throw Error('Missing balance '+key);return numbers.get(key);}
export function level(l){
 const requested=Number(l),row=levels.get(requested);
 if(row)return row;
 const cap=num('level_max');
 if(!Number.isSafeInteger(requested)||requested<=cap)throw Error('Missing level '+l);
 // The last authored row is a growth reference, not a player level cap.
 // Extrapolate stats and progression beyond the CSV using the same shared rules.
 const prior2=levels.get(cap-2),prior=levels.get(cap-1),last=levels.get(cap);
 if(!prior2||!prior||!last)throw Error('Missing level growth rows');
 const n=requested-cap,result={...last,level:String(requested)};
 for(const stat of ['hp','mag','def','res']){
  const key=stat+'_multiplier',a=Number(prior2[key]),b=Number(prior[key]),c=Number(last[key]);
  result[key]=String(Number((c+n*(c-b)+n*(n+1)*(c-2*b+a)/2).toFixed(4)));
 }
 // The final authored XP baseline grows by roughly 40 per level.
 // Continue that slope without changing any level from 1 to 150.
 result.xp_to_next=String(Number(last.xp_to_next)+40*n);
 result.carry_limit=String(Number(last.carry_limit)+Math.floor(requested/10)-Math.floor(cap/10));
 return result;
}
export function floor(f){
 const fight=Number(f);
 if(!Number.isSafeInteger(fight)||fight<1)throw Error('No floor '+f);
 const row=floors.get(fight);
 if(row)return row;
 if(fight<=500)throw Error('No floor '+f);
 const enemyLevel=targetClearLevel(layerForFight(fight));
 return {floor:String(fight),enemy_level:String(enemyLevel),boss:fight%5===0?'1':'0',minimum_enemy_level:String(enemyLevel),boss_enemy_id:''};
}
export function range(key){const r=ranges.get(key);if(!r)throw Error('Missing base stat '+key);return [+r.min,+r.max];}
