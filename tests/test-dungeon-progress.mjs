import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layerOfFight,encounterOfFight,isLayerBoss,encounterLabel,battleHeading,battleEncounter,layerName,LAYER_NAMES,
 clearedLayer,nextLayer,deepestReturnedLayer,recordReturnedLayer,deepestReachedLayer,recordReachedLayer,hasHundredFloorCrown,FIGHTS_PER_LAYER,dungeonDepthBlend} from '../assets/js/dungeon-progress.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
assert.equal(FIGHTS_PER_LAYER,5);
for(const [fight,crimson,darkness,fog] of [
 [0,'0%','0%','0%'],[1,'2%','0%','0%'],[245,'98%','0%','0%'],
 [246,'100%','0%','18%'],[250,'100%','0%','18%'],
 [251,'100%','2%','18%'],[495,'100%','98%','28%'],
 [496,'100%','100%','28%'],[500,'100%','100%','28%'],
 [505,'100%','100%','28%']
])assert.deepEqual(dungeonDepthBlend(fight),{crimson,darkness,fog},'dungeon panel background at fight '+fight);

for(const [fight,layer,round,boss] of [
 [1,1,1,false],[4,1,4,false],[5,1,5,true],
 [6,2,1,false],[9,2,4,false],[10,2,5,true],
 [11,3,1,false],[25,5,5,true],[495,99,5,true],[500,100,5,true],[505,101,5,true]
]){
 assert.equal(layerOfFight(fight),layer);
 assert.equal(encounterOfFight(fight),round);
 assert.equal(isLayerBoss(fight),boss);
 assert.equal(encounterLabel(fight),layer+'層'+round+'戦目');
 assert.equal(battleHeading(fight),layer+'層 '+layerName(layer));
 assert.equal(battleEncounter(fight),round+'戦目');
 assert.equal(clearedLayer(fight),boss?layer:0);
 assert.equal(nextLayer(fight),layer+1);
}
assert.equal(LAYER_NAMES.length,100,'every designed layer has a name');
assert.equal(new Set(LAYER_NAMES).size,100,'each layer name is unique');
assert.ok(LAYER_NAMES.every(name=>name.length>0&&name.length<=10&&!name.includes('竜')),
 'layer names stay short and consistently use 龍 rather than 竜');
for(const [layer,expected] of [
 [1,'はじまりの魔窟'],[8,'毒鰻の沼'],[24,'幽霊船の甲板'],
 [38,'落雷の高原'],[63,'絶海の鰻龍宮'],[99,'世界樹の終末'],[100,'永劫の魔王城']
])assert.equal(layerName(layer),expected,'boss-linked layer name at layer '+layer);
assert.equal(layerName(101),'終わりなき深淵','endless layers have a sensible label');
assert.equal(battleHeading(0),'未到達');
assert.equal(battleEncounter(0),'');
assert.equal(layerName(0),'');
assert.equal(layerOfFight(0),0);
assert.equal(encounterOfFight(0),0);
assert.equal(encounterLabel(0),'未到達');
assert.equal(layerOfFight(-1),0);
const data=parseCsv(await readFile(new URL('../assets/data/dungeon-floors.csv',import.meta.url),'utf8'));
assert.equal(data.length,500);
for(const record of data){
 const fight=Number(record.floor);
 assert.equal(Number(record.boss),Number(isLayerBoss(fight)));
 assert.equal(Boolean(record.boss_enemy_id),isLayerBoss(fight));
}
const fresh={returns:0,highest:2,run:null};
assert.equal(deepestReturnedLayer(fresh),0,'a previously visited layer is not a return');
assert.equal(recordReturnedLayer(fresh,1),0,'entering floor one does not count');
assert.equal(recordReturnedLayer(fresh,4),0,'winning a non-boss does not count');
assert.equal(recordReturnedLayer(fresh,5),1,'first successful return counts layer one');
assert.equal(recordReturnedLayer(fresh,6),1,'descending to next layer never raises the record');
assert.equal(recordReturnedLayer(fresh,10),2,'return after beating second layer boss counts two');
assert.equal(recordReturnedLayer(fresh,5),2,'later shallow returns do not reduce it');
assert.equal(deepestReturnedLayer({highest:495,returns:7}),0,'unverifiable legacy visit record is ignored');
assert.equal(deepestReachedLayer({deepestReturnedLayer:10}),10,'legacy successful returns count as arrival');
assert.equal(deepestReachedLayer({run:{floor:501}}),101,'legacy ongoing run establishes arrival');
const adventurer={returns:0,deepestReachedLayer:0,deepestReturnedLayer:0,run:null};
assert.equal(recordReachedLayer(adventurer,1),1,'entering first layer establishes an arrival');
assert.equal(deepestReturnedLayer(adventurer),0,'arrival does not imply return');
assert.equal(recordReachedLayer(adventurer,501),101,'endless first fight reaches layer 101');
assert.equal(recordReachedLayer(adventurer,5),101,'later shallow attempts never lower arrival');
assert.equal(recordReturnedLayer(adventurer,500),100,'successful return records layer 100');
assert.equal(deepestReachedLayer(adventurer),101,'successful return does not lower highest arrival');
assert.equal(deepestReturnedLayer(adventurer),100,'return and arrival are independent');
assert.equal(hasHundredFloorCrown({defeatedBosses:{boss_l100:true}}),true);
assert.equal(hasHundredFloorCrown({adventurerRank:100,defeatedBosses:{}}),false,'rank is not a crown trigger');
assert.equal(hasHundredFloorCrown({defeatedBosses:{boss_l100:false}}),false);
console.log('PASS separate deepest reached/returned records and 100F crown eligibility');
