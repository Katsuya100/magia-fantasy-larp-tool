import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layerOfFight,encounterOfFight,isLayerBoss,encounterLabel,battleHeading,
 clearedLayer,nextLayer,migrateHighestLayer,recordLayerVisit,FIGHTS_PER_LAYER} from '../assets/js/dungeon-progress.mjs';
import {parseCsv} from '../assets/js/dungeon-core.mjs';
assert.equal(FIGHTS_PER_LAYER,5);
for(const [fight,layer,round,boss] of [
 [1,1,1,false],[4,1,4,false],[5,1,5,true],
 [6,2,1,false],[9,2,4,false],[10,2,5,true],
 [11,3,1,false],[25,5,5,true],[495,99,5,true]
]){
 assert.equal(layerOfFight(fight),layer,'layer at fight '+fight);
 assert.equal(encounterOfFight(fight),round,'within-layer fight '+fight);
 assert.equal(isLayerBoss(fight),boss,'only every fifth is a layer boss');
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
assert.equal(data.length,495);
for(const record of data){
 const fight=Number(record.floor);
 assert.equal(Number(record.boss),Number(isLayerBoss(fight)),'CSV boss selection matches fifth fight at '+fight);
 assert.equal(Boolean(record.boss_enemy_id),isLayerBoss(fight),'every layer boss specifies its unique enemy');
}
const legacy={highest:5};
assert.equal(migrateHighestLayer(legacy),true);
assert.deepEqual(legacy,{highest:1,highestUnit:'layer'},'previous highest 5戦 becomes 1層');
assert.equal(migrateHighestLayer(legacy),false);
assert.equal(legacy.highest,1,'already converted score does not shrink on reload');
assert.equal(recordLayerVisit(legacy,6),2,'visiting 2層 immediately updates deepest layer');
assert.equal(recordLayerVisit(legacy,5),2,'older fights never reduce the record');
assert.equal(migrateHighestLayer(legacy),false);
assert.equal(recordLayerVisit(legacy,10),2,'clearing 2層 boss remains at 2層');
assert.equal(recordLayerVisit(legacy,11),3,'next encounter reaches 3層');
for(const [old,converted] of [[0,0],[1,1],[4,1],[6,2],[10,2],[11,3],[495,99]]){
 const profile={highest:old};
 migrateHighestLayer(profile);
 assert.equal(profile.highest,converted,'legacy fight highscore converted to layer');
}
const legacyActive={highest:5,run:{floor:11,stage:'battle'}};
migrateHighestLayer(legacyActive);
recordLayerVisit(legacyActive,legacyActive.run.floor);
assert.equal(legacyActive.highest,3,'resumed legacy save promotes the actual currently visited layer');
console.log('PASS n層n戦目 progression, every fifth encounter is a layer boss, 495 CSV rows and one-time save migration');
