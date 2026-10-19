import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCsv,validateMasters,drops} from '../assets/js/dungeon-core.mjs';
import {rollCollection,rarityWeights} from '../assets/js/dungeon-design.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';

const read=async file=>parseCsv(await readFile(new URL('../assets/data/'+file,import.meta.url),'utf8'));
const [enemies,collections,items,buffs,balance,levels,floors,playerBase]=await Promise.all(
 ['dungeon-enemies.csv','dungeon-collections.csv','dungeon-consumables.csv','dungeon-buffs.csv','dungeon-balance.csv','dungeon-levels.csv','dungeon-floors.csv','dungeon-player-base.csv'].map(read));
configure({balance,levels,floors,playerBase});
assert.ok(validateMasters(enemies,items,collections,buffs));
const byId=new Map(collections.map(item=>[item.id,item]));
const favored=new Map(enemies.map(enemy=>[enemy.id,enemy.favored_collection_ids.split('|')]));
const all=new Set();
for(const enemy of enemies){
 const layer=+enemy.id.match(/l(\d{3})/)[1],ids=favored.get(enemy.id);
 assert.ok(ids.some(id=>byId.get(id)?.rarity==='common'),'every monster favors a common');
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ids){
  const item=byId.get(id);assert.ok(item,'valid collection ID '+id);
  assert.ok(!item.boss_enemy_id||item.boss_enemy_id===enemy.id,'boss-only exclusivity');
  if(!item.boss_enemy_id)assert.ok(layer>=({common:1,uncommon:6,rare:31,epic:50,legendary:75}[item.rarity]));
  all.add(id);
 }
}
assert.equal(all.size,300,'all collection entries are favored');
for(const item of collections.filter(item=>item.boss_enemy_id))
 assert.deepEqual(enemies.filter(x=>favored.get(x.id).includes(item.id)).map(x=>x.id),[item.boss_enemy_id]);
const names=layer=>enemies.filter(x=>+x.id.match(/l(\d{3})/)[1]===layer).flatMap(x=>favored.get(x.id).map(id=>byId.get(id).rarity));
assert.equal(names(1).filter(x=>x!=='common').length,1,'first boss trophy is the early exception');
assert.ok(names(30).filter(x=>x==='uncommon').length>=4,'uncommon is widespread by 30');
assert.ok(names(90).includes('epic')&&names(100).includes('legendary'));
assert.ok(favored.get('foe_l001_1').includes('slime_core'));
assert.ok(favored.get('foe_l001_2').includes('fang'));
assert.ok(enemies.filter(x=>x.name.includes('スケルトン')).some(x=>favored.get(x.id).includes('bone')));
const w=rarityWeights(70),total=w.reduce((x,y)=>x+y,0),epicTicket=(w[0]+w[1]+w[2]+w[3]/2)/total;
const makeRandom=()=>{let seq=[epicTicket,0,0];return ()=>seq.shift()??0;};
const boss='boss_l070',trophy=collections.find(x=>x.boss_enemy_id===boss);
assert.equal(rollCollection(collections,70,makeRandom(),boss,[trophy.id]).id,trophy.id);
assert.notEqual(rollCollection(collections,70,makeRandom(),null,[trophy.id]).id,trophy.id);
assert.deepEqual(drops(items,collections,150,()=>.999,{layer:100,bossEnemyId:'boss_l100',favoredCollectionIds:favored.get('boss_l100')}),[]);
let seed=9384122;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const observed={common:0,uncommon:0,rare:0,epic:0,legendary:0},N=40000;
for(let i=0;i<N;i++)observed[rollCollection(collections,70,rng,boss,favored.get(boss)).rarity]++;
for(const [i,name] of ['common','uncommon','rare','epic','legendary'].entries())
 assert.ok(Math.abs(observed[name]/N-w[i]/total)<.012,'rarity probability unchanged '+name);
console.log('PASS themed collection drops, 500 enemies, 300 covered, rarity odds');
