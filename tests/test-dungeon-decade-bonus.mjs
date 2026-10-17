import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
import {isBonusLayer,bonusCollection,bonusConsumable,rarityWeights} from '../assets/js/dungeon-design.mjs';
const collections=parseCsv(readFileSync('assets/data/dungeon-collections.csv','utf8'));
const items=parseCsv(readFileSync('assets/data/dungeon-consumables.csv','utf8'));
for(let layer=1;layer<=110;layer++)assert.equal(isBonusLayer(layer),layer%10===0);
for(const layer of [10,20,30,50,80,100,110]){
 for(const r of [()=>0,()=>0.25,()=>0.5,()=>0.75,()=>0.999]){
  const collection=bonusCollection(collections,layer,r);
  assert.ok(['rare','epic','legendary'].includes(collection.rarity));
  assert.ok(!collection.boss_enemy_id);
  const item=bonusConsumable(items,layer,r);
  assert.ok(Number(item.min_layer)<=layer);
  if(layer>=100&&!['clear','escape','elixir','revive'].includes(item.kind))assert.equal(item.tier,'extreme');
 }
}
assert.deepEqual(rarityWeights(20),rarityWeights(20));
const app=readFileSync('assets/js/dungeon-app.mjs','utf8');
const html=readFileSync('dungeon.html','utf8');
assert.match(app,/run\.carry\[free\]=item/);
assert.match(app,/run\.bonusClaimed=true/);
assert.match(app,/run\.bonusClaimed=false/);
for(const choice of ['restore','collection','item'])assert.ok(html.includes('data-bonus="'+choice+'"'));
console.log('Decade bonus tests passed');
