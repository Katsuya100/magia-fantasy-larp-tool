// Shared dungeon level design: 100 five-fight layers, then endless mixed encounters.
export const DESIGNED_LAYERS=100;
export const RARITIES=['common','uncommon','rare','epic','legendary'];
// Relative weights of the four non-legendary rarities.
// Legendary is nearly impossible at layer 1, increasing to 10% at layer 100+.
export const BASE_RARITY_WEIGHTS=[40,20,10,5];
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
// Shuffle a layer's four regular encounters once per expedition. The fifth,
// boss encounter is intentionally excluded. A canonical prefix preserves
// previously fought opponents when resuming a pre-shuffle save mid-layer.
export function shuffledLayerEnemyIds(enemies,layer,r=Math.random,completed=0){
 if(!Number.isSafeInteger(layer)||layer<1||layer>DESIGNED_LAYERS)throw Error('Invalid designed layer');
 if(!Number.isInteger(completed)||completed<0||completed>4)throw Error('Invalid completed encounters');
 const suffix=String(layer).padStart(3,'0');
 const ids=Array.from({length:4},(_,i)=>'foe_l'+suffix+'_'+(i+1));
 if(ids.some(id=>!enemies.some(enemy=>enemy.id===id)))throw Error('Missing designed layer enemies '+layer);
 for(let i=ids.length-1;i>completed;i--){
  const draw=Math.min(1-Number.EPSILON,Math.max(0,Number(r())));
  const j=completed+Math.floor(draw*(i-completed+1));
  [ids[i],ids[j]]=[ids[j],ids[i]];
 }
 return ids;
}
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
export function legendaryDropRate(layer){
 const depth=Math.min(1,Math.max(0,(Number(layer)-1)/99));
 // 0.02% on layer 1; reaches 10% on layer 100 and stays there thereafter.
 return .0002+(.1-.0002)*depth*depth;
}
export function rarityWeights(layer){
 const d=Math.min(1,Math.max(0,(Number(layer)-1)/99));
 const ordinary=BASE_RARITY_WEIGHTS.map((n,i)=>n*[1-.6*d,1-.3*d,1+1.2*d,1+1.7*d][i]);
 const rate=legendaryDropRate(layer),total=ordinary.reduce((sum,weight)=>sum+weight,0);
 return [...ordinary,total*rate/(1-rate)];
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
export function bonusCollection(collections,layer,r=Math.random){
 // Decade bonus is rare+ with the same depth-scaled legendary rate.
 const [rare,epic]=rarityWeights(layer).slice(2,4);
 const rate=legendaryDropRate(layer);
 const weights=[rare,epic,(rare+epic)*rate/(1-rate)];
 let ticket=Math.min(1-Number.EPSILON,Math.max(0,r()))*weights.reduce((a,b)=>a+b,0);
 let rarity='legendary';
 for(let i=0;i<weights.length;i++){ticket-=weights[i];if(ticket<0){rarity=RARITIES[i+2];break;}}
 const pool=collections.filter(x=>x.rarity===rarity&&!x.boss_enemy_id);
 let v=Math.min(1-Number.EPSILON,Math.max(0,r()))*pool.reduce((n,x)=>n+Number(x.weight),0);
 for(const x of pool){v-=Number(x.weight);if(v<0)return x;}
 return pool.at(-1);
}
export function bonusConsumable(items,layer,r=Math.random){const pool=eligibleConsumables(items,layer,rollConsumableTier(layer,r));let v=r()*pool.reduce((n,x)=>n+Number(x.weight),0);for(const x of pool){v-=Number(x.weight);if(v<0)return x;}return pool.at(-1);}
