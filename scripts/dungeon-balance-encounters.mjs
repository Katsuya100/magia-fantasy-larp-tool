// Match the browser's once-per-floor shuffle of the four ordinary encounters.
// The boss is always fight five and keeps its own authored enemy ID.
// A returned selector belongs to ONE sortie; never share its layer cache across
// independent seeded trials or player journeys.
import {enemyForFight,layerForFight,shuffledLayerEnemyIds,DESIGNED_LAYERS}
 from '../assets/js/dungeon-design.mjs';

export function createSortieEncounterSelector(enemies,random){
 if(!Array.isArray(enemies)||typeof random!=='function')throw Error('Invalid encounter selector input');
 const orderByLayer=new Map(),byId=new Map(enemies.map(row=>[row.id,row]));
 return function encounterForFight(fight){
  const layer=layerForFight(fight),slot=(fight-1)%5;
  if(layer<=DESIGNED_LAYERS&&slot<4){
   let order=orderByLayer.get(layer);
   if(!order){
    order=shuffledLayerEnemyIds(enemies,layer,random,0);
    orderByLayer.set(layer,order);
   }
   const foe=byId.get(order[slot]);
   if(!foe||foe.boss_only==='1')throw Error('Invalid shuffled regular enemy');
   return foe;
  }
  return enemyForFight(enemies,fight,random);
 };
}
