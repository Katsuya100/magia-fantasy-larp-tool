// Shared dungeon level design: 100 five-fight layers, then endless mixed encounters.
export const DESIGNED_LAYERS=100;
export const RARITIES=['common','uncommon','rare','epic','legendary'];
export const BASE_RARITY_WEIGHTS=[40,20,10,5,2];
export const CONSUMABLE_TIERS=['small','medium','large','extreme'];
export function rollConsumableTier(layer,r=Math.random){
 const depth=Math.min(1,Math.max(0,(Number(layer)-1)/99));
 if(depth===0)return 'small';
 if(depth===1)return 'extreme';
 let tier=0;
 for(let i=0;i<3;i++)if(r()<depth)tier++;
 return CONSUMABLE_TIERS[tier];
}
export function eligibleConsumables(items,layer,tier){
 return items.filter(row=>Number(row.min_layer||1)<=layer &&
  (row.kind==='clear'||row.kind==='escape'||row.kind==='revive'||row.tier===tier||(row.kind==='elixir'&&tier==='extreme'&&row.tier==='large')));
}
export function targetClearLevel(layer){
 if(!Number.isSafeInteger(layer)||layer<1)throw Error('Invalid layer');
 const x=Math.min(99,layer-1);
 return Math.round(1+2*x-49*x*(x-1)/(99*98));
}
export const layerForFight=fight=>Math.ceil(fight/5);
export function enemyForFight(enemies,fight,r=Math.random){
 if(!Number.isSafeInteger(fight)||fight<1)throw Error('Invalid fight');
 const layer=layerForFight(fight),slot=(fight-1)%5+1;
 if(layer<=DESIGNED_LAYERS){
  const suffix=String(layer).padStart(3,'0');
  const id=slot===5?'boss_l'+suffix:'foe_l'+suffix+'_'+slot;
  const enemy=enemies.find(e=>e.id===id);
  if(!enemy)throw Error('Missing designed enemy '+id);
  return enemy;
 }
 // Post-100 regular fights can draw any of the 500 enemies.
 // The fifth encounter still picks a named boss, with a first-defeat trophy.
 const pool=slot===5?enemies.filter(e=>e.boss_only==='1'):enemies;
 if(!pool.length)throw Error('Empty enemy pool');
 return pool[Math.min(pool.length-1,Math.floor(Math.max(0,r())*pool.length))];
}
export function rarityWeights(layer){
 const d=Math.min(1,Math.max(0,(Number(layer)-1)/99));
 return BASE_RARITY_WEIGHTS.map((n,i)=>n*[1-.6*d,1-.3*d,1+1.2*d,1+1.7*d,1+.7*d][i]);
}
export function rollRarity(layer,r=Math.random){
 const weights=rarityWeights(layer),total=weights.reduce((a,b)=>a+b,0);
 let ticket=Math.min(1-Number.EPSILON,Math.max(0,r()))*total;
 for(let i=0;i<weights.length;i++){ticket-=weights[i];if(ticket<0)return RARITIES[i];}
 return RARITIES.at(-1);
}
export function rollCollection(collections,layer,r=Math.random,bossEnemyId=null){
 const rarity=rollRarity(layer,r);
 const pool=collections.filter(x=>x.rarity===rarity&&(!x.boss_enemy_id||x.boss_enemy_id===bossEnemyId));
 const total=pool.reduce((n,x)=>n+Number(x.weight),0);
 if(!total)throw Error('Missing random drop for '+rarity);
 let ticket=Math.min(1-Number.EPSILON,Math.max(0,r()))*total;
 for(const item of pool){ticket-=Number(item.weight);if(ticket<0)return item;}
 return pool.at(-1);
}
export function bossUniqueCollection(collections,id){
 const match=/^boss_l(\d{3})$/.exec(id);
 if(!match)throw Error('Invalid boss trophy ID '+id);
 const rarity=Number(match[1])%10===0?'legendary':'epic';
 const found=collections.filter(x=>x.boss_enemy_id===id);
 if(found.length!==1||found[0].rarity!==rarity)throw Error('Expected one '+rarity+' boss trophy for '+id);
 return found[0];
}

export const isBonusLayer=layer=>Number.isInteger(layer)&&layer>0&&layer%10===0;
export function bonusCollection(collections,layer,r=Math.random){const weights=rarityWeights(layer===10?20:layer).slice(2);let ticket=r()*weights.reduce((a,b)=>a+b,0);let rarity='legendary';for(let i=0;i<weights.length;i++){ticket-=weights[i];if(ticket<0){rarity=RARITIES[i+2];break;}}const pool=collections.filter(x=>x.rarity===rarity&&!x.boss_enemy_id);let v=r()*pool.reduce((n,x)=>n+Number(x.weight),0);for(const x of pool){v-=Number(x.weight);if(v<0)return x;}return pool.at(-1);}
export function bonusConsumable(items,layer,r=Math.random){const pool=eligibleConsumables(items,layer,rollConsumableTier(layer,r));let v=r()*pool.reduce((n,x)=>n+Number(x.weight),0);for(const x of pool){v-=Number(x.weight);if(v<0)return x;}return pool.at(-1);}
