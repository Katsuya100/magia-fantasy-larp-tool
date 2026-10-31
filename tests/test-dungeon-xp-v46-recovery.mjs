
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openStore,getProfile,saveProfile,migrateDungeonXp,migrateDungeonIntegerXp,
 readDungeonSnapshot,replaceDungeonSnapshot,getDungeonXp46RecoveryBackup,putCircle,allCircles}
 from '../assets/js/dungeon-store.mjs';
import {parseCsv,nextXp,experience} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {v46NextXp} from '../assets/js/dungeon-xp-v46.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {verifyLocalSnapshot} from '../assets/js/dungeon-cloud-integrity.mjs';

const read=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(read));
configure({balance,levels,floors,playerBase});
for(const [level,xp] of [[1,15],[21,390],[34,1300],[50,4925],[92,115625],[100,102445],[150,484770],
 [151,Math.round(484770*(6175/6135)*Math.pow(1.1,.1))]])
 assert.equal(v46NextXp(level),xp,'historic v46 threshold '+level);
const db=await openStore(fakeIndexedDB());
const profile=await getProfile(db);
profile.xpScaleVersion=46;delete profile.xpIntegerVersion;
profile.level=92;profile.xp=30000;
profile.run={floor:452,xp:200000,loot:[]};
profile.magicStones=156;profile.collection={relic_001:2};
const photo=new Blob([Uint8Array.from([137,80,78,71,42,31])],{type:'image/png'});
await putCircle(db,{id:'v46-photo',name:'元の写真',image:photo});
await saveProfile(db,profile);
const source=await readDungeonSnapshot(db);
assert.equal((await verifyLocalSnapshot(source)).status,'valid');
const result=await migrateDungeonXp(db);
assert.equal(result.xpScaleVersion,45);
assert.equal(result.xpIntegerVersion,1);
assert.equal(result.level,92);
assert.equal(result.xp,Math.ceil(30000/115625*nextXp(92)));
assert.equal(result.magicStones,156);
assert.deepEqual(result.collection,{relic_001:2});
assert.ok(Number.isSafeInteger(result.run.xp)&&result.run.xp>0);
const afterRun={level:result.level,xp:result.xp};
experience(afterRun,result.run.xp);
let oldLevel=92,oldGauge=30000+200000;
while(oldGauge>=v46NextXp(oldLevel)){oldGauge-=v46NextXp(oldLevel);oldLevel++;}
assert.equal(afterRun.level,oldLevel,'unbanked v46 reward preserves reached level');
assert.equal(afterRun.xp,Math.ceil(oldGauge/v46NextXp(oldLevel)*nextXp(oldLevel)),'unbanked gauge ratio');
const backup=await getDungeonXp46RecoveryBackup(db);
assert.equal(backup.profile.xp,30000);
assert.equal(backup.profile.run.xp,200000);
assert.equal(backup.profile.xpScaleVersion,46);
assert.deepEqual(new Uint8Array(await backup.circles[0].image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
assert.deepEqual(await migrateDungeonXp(db),result,'v46 cannot be scaled twice');
assert.deepEqual(await migrateDungeonIntegerXp(db),result,'v46 integer migration is not repeated');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
assert.equal((await allCircles(db)).length,1);
// Cloud-restored signed v46 can migrate again.
await replaceDungeonSnapshot(db,source);
const again=await migrateDungeonXp(db);
assert.equal(again.xp,result.xp);assert.equal(again.run.xp,result.run.xp);
// Return reward is mapped through the old endpoints.
const sourceReturn=await getProfile(db);
sourceReturn.xpScaleVersion=46;delete sourceReturn.xpIntegerVersion;
sourceReturn.level=92;sourceReturn.xp=30000;sourceReturn.run=null;
sourceReturn.pendingReturn={before:{level:91,xp:v46NextXp(91)-100},gained:30100,steps:['xp'],step:0};
await saveProfile(db,sourceReturn);
const returnResult=await migrateDungeonXp(db);
const playback={...returnResult.pendingReturn.before};
experience(playback,returnResult.pendingReturn.gained);
assert.equal(playback.level,returnResult.level);
assert.equal(playback.xp,returnResult.xp);
assert.ok(Number.isSafeInteger(returnResult.pendingReturn.gained));
// Mismatched metadata must fail without overwriting the signed old save.
const invalid=await getProfile(db);
invalid.xpScaleVersion=46;delete invalid.xpIntegerVersion;
invalid.pendingReturn={before:{level:92,xp:0},gained:1,steps:['xp'],step:0};
await saveProfile(db,invalid);
const beforeBad=await readDungeonSnapshot(db);
await assert.rejects(migrateDungeonXp(db),/旧帰還報酬と保存されたEXPが一致/);
const afterBad=await readDungeonSnapshot(db);
assert.deepEqual(afterBad.profile,beforeBad.profile);assert.deepEqual(afterBad.integrity,beforeBad.integrity);
// Unsupported future marker is still rejected.
const future=await getProfile(db);future.xpScaleVersion=47;
await saveProfile(db,future);
const preFuture=await readDungeonSnapshot(db);
await assert.rejects(migrateDungeonXp(db),/未対応のEXPバージョン/);
assert.deepEqual((await readDungeonSnapshot(db)).profile,preFuture.profile);
// Even a failed integrity write must not half-migrate.
const factory=fakeIndexedDB(),failDb=await openStore(factory);
const old=await getProfile(failDb);
old.xpScaleVersion=46;delete old.xpIntegerVersion;old.level=92;old.xp=10000;
await saveProfile(failDb,old);
const beforeFail=await readDungeonSnapshot(failDb);
factory.failIntegrityWrites=true;
await assert.rejects(migrateDungeonXp(failDb),/Injected integrity write failure/);
assert.deepEqual((await readDungeonSnapshot(failDb)).profile,beforeFail.profile);
assert.deepEqual((await readDungeonSnapshot(failDb)).integrity,beforeFail.integrity);
assert.equal(await getDungeonXp46RecoveryBackup(failDb),null);
factory.failIntegrityWrites=false;
await migrateDungeonXp(failDb);
assert.equal((await getDungeonXp46RecoveryBackup(failDb)).profile.xp,10000);
console.log('PASS v46 historical save recovery, expedition, return, cloud, backup and rollback');
