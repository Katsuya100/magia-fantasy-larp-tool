import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layerOfFight,encounterOfFight,isLayerBoss,encounterLabel,battleHeading,
 clearedLayer,nextLayer,deepestReturnedLayer,recordReturnedLayer,FIGHTS_PER_LAYER} from '../assets/js/dungeon-progress.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
assert.equal(FIGHTS_PER_LAYER,5);
for(const [fight,layer,round,boss] of [
 [1,1,1,false],[4,1,4,false],[5,1,5,true],
 [6,2,1,false],[9,2,4,false],[10,2,5,true],
 [11,3,1,false],[25,5,5,true],[495,99,5,true],[500,100,5,true],[505,101,5,true]
]){
 assert.equal(layerOfFight(fight),layer);
 assert.equal(encounterOfFight(fight),round);
 assert.equal(isLayerBoss(fight),boss);
 assert.equal(encounterLabel(fight),layer+'層'+round+'戦目');
 assert.equal(battleHeading(fight),layer+'層'+round+'戦目'+(boss?' · 階層ボス':''));
 assert.equal(clearedLayer(fight),boss?layer:0);
 assert.equal(nextLayer(fight),layer+1);
}
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
console.log('PASS layer progression and deepest successfully returned layer');
