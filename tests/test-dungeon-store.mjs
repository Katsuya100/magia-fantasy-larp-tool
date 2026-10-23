import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openStore,validateDatabase,allCircles,putCircle,deleteCircle,getProfile,saveProfile,migrateDungeonXp,getDungeonXpMigrationBackup,restoreDungeonXpMigrationBackup,readDungeonSnapshot,replaceDungeonSnapshot,clearDungeonData} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
const {parseCsv}=G;
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
const get=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(get));
configure({balance,levels,floors,playerBase});
const factory=fakeIndexedDB();
const db=await openStore(factory);
assert.equal(validateDatabase(db),db);
assert.equal(db.objectStoreNames.contains('circles'),true);
assert.equal(db.objectStoreNames.contains('settings'),true);
const p=await getProfile(db);
assert.equal(p.level,1);
assert.ok(p.base.hp>=90&&p.base.hp<=110);
assert.equal(p.run,null);
assert.deepEqual(p.obtainedItemIds,[],'new profiles begin without acquired item types');
p.returns=2;p.inventory=[{id:'heal_s',value:27,bonus:'buff_aqua'}];p.run={floor:3,hp:42,loot:[]};
await saveProfile(db,p);
// Existing signed saves must convert EXP exactly once, including unbanked
// battle rewards and unfinished return-screen rewards.
delete p.xpScaleVersion; // Simulate a genuine pre-migration signed save.
p.level=92;p.xp=20000;p.run.xp=45000;
// The pending reward must reconcile with the already-saved current gauge.
p.pendingReturn={gained:15500,before:{level:92,xp:4500},steps:['xp'],step:0};
await saveProfile(db,p);
const converted=await migrateDungeonXp(db);
const backupFirst=await getDungeonXpMigrationBackup(db);
assert.equal(backupFirst.profile.xp,20000,'the original gauge is recoverable');
assert.equal(backupFirst.profile.run.xp,45000,'the original unbanked reward is recoverable');
assert.equal(backupFirst.profile.xpScaleVersion,undefined,'backup preserves the legacy format');
assert.ok(converted.xp>0&&converted.xp<2000,'old XP progress converts to flatter curve');
assert.ok(converted.run.xp>0&&converted.run.xp<1000,'unbanked XP is converted');
assert.ok(converted.pendingReturn.gained>0&&converted.pendingReturn.gained<500,'pending reward is converted');
assert.ok(converted.pendingReturn.before.xp>0&&converted.pendingReturn.before.xp<100,'return animation XP is converted');
assert.equal(converted.xpScaleVersion,45);
assert.deepEqual(await migrateDungeonXp(db),converted,'repeat startup never scales twice');
assert.equal((await getProfile(db)).xp,converted.xp,'converted signed save persists');
 
// A real legacy save at 92 with 20% of the old gauge, and unbanked EXP
// crossing a level boundary, must keep its exact earned level after migration.
const oldNeed=lvl=>Math.ceil(Number(levels[lvl-1].xp_to_next)*Math.pow(2.1,(lvl-1)/10));
const oldAdvance=(lvl,xp,award)=>{
 xp+=award;
 while(lvl<150&&xp>=oldNeed(lvl)){xp-=oldNeed(lvl);lvl++;}
 return {level:lvl,xp:lvl===150?0:xp};
};
const legacyStartXp=Math.floor(oldNeed(92)*0.20);
const earnedInRun=oldNeed(92)+Math.floor(oldNeed(93)*0.65);
const oldRunEnd=oldAdvance(92,legacyStartXp,earnedInRun);
const legacySave={...converted,level:92,xp:legacyStartXp,run:{...converted.run,xp:earnedInRun},
 magicStones:77,adventurerRank:40,inventory:[{id:'heal_s',value:27,bonus:'buff_aqua'}],
 slots:['xp-migration-photo',null],collection:{relic_001:3}};
delete legacySave.pendingReturn;
delete legacySave.xpScaleVersion;
const migrationPhoto=new Blob([Uint8Array.from([137,80,78,71,1,2,3])],{type:'image/png'});
await putCircle(db,{id:'xp-migration-photo',name:'写真の保護',image:migrationPhoto,
 analysis:{attribute:'law',role:'attack',power:300}});
await saveProfile(db,legacySave);
const oldDriveSnapshot=await readDungeonSnapshot(db);
const exact=await migrateDungeonXp(db);
const backupFull=await getDungeonXpMigrationBackup(db);
assert.equal(backupFull.profile.xp,legacyStartXp,'the migrated save retains its exact old EXP');
assert.deepEqual(new Uint8Array(await backupFull.circles.find(x=>x.id==='xp-migration-photo').image.arrayBuffer()),
 new Uint8Array(await migrationPhoto.arrayBuffer()),'full backup retains original magic-circle photo bytes');
// Recovery API restores the actual old profile, photo and original gauge,
// then the converter can safely replay on the next startup.
await restoreDungeonXpMigrationBackup(db);
const originalRecovered=await getProfile(db);
assert.equal(originalRecovered.xpScaleVersion,undefined,'recovery returns to the original unscaled XP format');
assert.equal(originalRecovered.xp,legacyStartXp,'recovery retains the exact original gauge');
assert.equal(originalRecovered.magicStones,77,'recovery retains original stones');
assert.deepEqual(new Uint8Array(await (await allCircles(db)).find(x=>x.id==='xp-migration-photo').image.arrayBuffer()),
 new Uint8Array(await migrationPhoto.arrayBuffer()),'recovery retains the actual photo bytes');
const replayedMigration=await migrateDungeonXp(db);
assert.equal(replayedMigration.xp,exact.xp,'the backed-up old save safely re-migrates');
assert.equal(replayedMigration.run.xp,exact.run.xp,'the backed-up expedition safely re-migrates');
assert.ok(await getDungeonXpMigrationBackup(db),'re-migration regenerates a valid rescue point');
assert.equal(exact.level,92);
assert.ok(Math.abs(exact.xp/G.nextXp(92)-legacyStartXp/oldNeed(92))<0.000001,
 'Lv92 current-level EXP progress remains the same');
const resumed={level:exact.level,xp:exact.xp};
G.experience(resumed,exact.run.xp);
assert.equal(resumed.level,oldRunEnd.level,'pending exploration XP yields the same final level');
assert.ok(Math.abs(resumed.xp/G.nextXp(resumed.level)-oldRunEnd.xp/oldNeed(oldRunEnd.level))<0.000001,
 'pending exploration XP keeps the earned post-return gauge fraction');
assert.equal(exact.magicStones,77,'magic stone progress is untouched');
assert.equal(exact.adventurerRank,40,'adventurer rank is untouched');
assert.deepEqual(exact.inventory,legacySave.inventory,'items are untouched');
assert.deepEqual(exact.slots,legacySave.slots,'equipped magic circles stay equipped');
assert.deepEqual(exact.collection,legacySave.collection,'collection progress stays untouched');
assert.deepEqual(new Uint8Array(await (await allCircles(db)).find(x=>x.id==='xp-migration-photo').image.arrayBuffer()),
 new Uint8Array(await migrationPhoto.arrayBuffer()),'circle photo bytes survive migration');

// Simulate restoring an old, signed Google Drive snapshot and reloading.
// The restored legacy marker is absent and must be migrated just once.
await replaceDungeonSnapshot(db,oldDriveSnapshot);
assert.equal((await getProfile(db)).xpScaleVersion,undefined,'cloud backup retains the old EXP version');
const restored=await migrateDungeonXp(db);
assert.equal((await getDungeonXpMigrationBackup(db)).profile.xp,legacyStartXp,'Drive legacy restore creates a fresh original backup');
assert.equal(restored.xp,exact.xp,'restored legacy gauge migrates consistently');
assert.equal(restored.run.xp,exact.run.xp,'restored unbanked EXP migrates consistently');
assert.deepEqual(await migrateDungeonXp(db),restored,'restored save does not convert twice');
assert.deepEqual(restored.slots,legacySave.slots,'Drive restoration preserves equipment');
assert.deepEqual(restored.collection,legacySave.collection,'Drive restoration preserves collected relics');
assert.deepEqual(new Uint8Array(await (await allCircles(db)).find(x=>x.id==='xp-migration-photo').image.arrayBuffer()),
 new Uint8Array(await migrationPhoto.arrayBuffer()),'Drive recovery keeps the original magic-circle image');

// Pending-return reward animation must end at the already-awarded real level.
const returnReward=oldNeed(92)+Math.floor(oldNeed(93)*0.37);
const returnEnd=oldAdvance(92,legacyStartXp,returnReward);
const returning={...legacySave,saveRevision:(await getProfile(db)).saveRevision,level:returnEnd.level,xp:returnEnd.xp,run:null,
 pendingReturn:{before:{level:92,xp:legacyStartXp},gained:returnReward,steps:['xp'],step:0}};
delete returning.xpScaleVersion;
await saveProfile(db,returning);
const migratedReturn=await migrateDungeonXp(db);
const frameStart={level:92,xp:migratedReturn.pendingReturn.before.xp};
G.experience(frameStart,migratedReturn.pendingReturn.gained);
assert.equal(frameStart.level,migratedReturn.level,'the full return animation ends at the real awarded level');
assert.ok(Math.abs(frameStart.xp-migratedReturn.xp)<0.00001,'the animation ends at exactly the saved EXP');
assert.deepEqual(await migrateDungeonXp(db),migratedReturn,'reloading the return animation cannot duplicate XP');
// A historic return record without its 'before' object can be reversed
// exactly from the old final level, gauge and gained EXP.
const missingBefore={...returning,saveRevision:(await getProfile(db)).saveRevision,
 pendingReturn:{gained:returnReward,steps:['xp'],step:0}};
await saveProfile(db,missingBefore);
const recoveredBefore=await migrateDungeonXp(db);
assert.equal(recoveredBefore.level,returnEnd.level,'recover missing return start without losing levels');
const recoveredStart={...recoveredBefore.pendingReturn.before};
G.experience(recoveredStart,recoveredBefore.pendingReturn.gained);
assert.equal(recoveredStart.level,recoveredBefore.level,'reconstructed pending reward ends on the actual level');
assert.ok(Math.abs(recoveredStart.xp-recoveredBefore.xp)<0.00001,'reconstructed pending reward ends on the actual gauge');
// Inconsistent return reward metadata must stop with the signed old save intact.
const mismatchedReturn={...returning,saveRevision:(await getProfile(db)).saveRevision,
 pendingReturn:{before:{level:92,xp:legacyStartXp},gained:1,steps:['xp'],step:0}};
await saveProfile(db,mismatchedReturn);
const beforeMismatched=await readDungeonSnapshot(db);
await assert.rejects(migrateDungeonXp(db),/帰還報酬とセーブ済みレベルが一致/);
const afterMismatched=await readDungeonSnapshot(db);
assert.deepEqual(afterMismatched.profile,beforeMismatched.profile,'invalid return metadata keeps original profile');
assert.deepEqual(afterMismatched.integrity,beforeMismatched.integrity,'invalid return metadata keeps original seal');

// An invalid legacy reward must fail before writing either the profile or
// its integrity seal; this is the same transaction-safety path as startup.
const unknownVersion={...legacySave,saveRevision:(await getProfile(db)).saveRevision,xpScaleVersion:G.XP_SCALE+1};
await saveProfile(db,unknownVersion);
const beforeUnknownVersion=await readDungeonSnapshot(db);
await assert.rejects(migrateDungeonXp(db),/未対応のEXPバージョン/);
const afterUnknownVersion=await readDungeonSnapshot(db);
assert.deepEqual(afterUnknownVersion.profile,beforeUnknownVersion.profile,'future EXP saves are never converted');
assert.deepEqual(afterUnknownVersion.integrity,beforeUnknownVersion.integrity,'future XP rejection preserves seal');
const invalidLegacy={...legacySave,saveRevision:(await getProfile(db)).saveRevision,run:{...legacySave.run,xp:-1}};
delete invalidLegacy.xpScaleVersion;
await saveProfile(db,invalidLegacy);
const beforeFailedMigration=await readDungeonSnapshot(db);
await assert.rejects(migrateDungeonXp(db),/探索中の旧経験値が不正/);
const afterFailedMigration=await readDungeonSnapshot(db);
assert.deepEqual(afterFailedMigration.profile,beforeFailedMigration.profile,'a failed migration leaves profile intact');
assert.deepEqual(afterFailedMigration.integrity,beforeFailedMigration.integrity,'a failed migration does not resign partial data');
await deleteCircle(db,'xp-migration-photo');
// A stale second game tab must not roll back a successfully committed save.
const stale=await getProfile(db),updated=await getProfile(db);
updated.magicStones=901;
await saveProfile(db,updated);
stale.magicStones=1;
await assert.rejects(saveProfile(db,stale),/別のタブでセーブが更新/);
assert.equal((await getProfile(db)).magicStones,901,'stale tab cannot clobber saved game progress');
const oldFormatBackup=await getDungeonXpMigrationBackup(db);
assert.equal(oldFormatBackup.profile.xp,returnEnd.xp,'regular gameplay never changes the latest successfully migrated rescue copy');


const clean=await getProfile(db);
clean.level=1;clean.xp=0;clean.run={...p.run,xp:0};delete clean.pendingReturn;clean.xpScaleVersion=45;
await saveProfile(db,clean);
const reread=await getProfile(db);
assert.deepEqual(reread,clean);
reread.level=99;assert.equal((await getProfile(db)).level,1);
const photo=new Blob([Uint8Array.from([255,216,0,0,255,217])],{type:'image/jpeg'});
await putCircle(db,{id:'c1',name:'test',image:photo,analysis:null});
await putCircle(db,{id:'c2',name:'known',image:photo,analysis:{attribute:'flame',role:'attack',power:300}});
await putCircle(db,{id:'legacy',image:photo,basePower:33.3,upgradeLevel:1,analysis:{attribute:'flame',role:'attack',power:36.63},revealed:true});
assert.equal((await allCircles(db)).find(c=>c.id==='legacy').analysis.power,37,'legacy upgrades restore integer power from the original base');
assert.equal(factory.databases.get('magia-dungeon-v1').get('circles').get('legacy').analysis.power,36.63,'conversion never rewrites the saved photo');
await deleteCircle(db,'legacy');
const circles=await allCircles(db);
assert.equal(circles.length,2);
assert.deepEqual(new Uint8Array(await circles[0].image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
assert.equal(circles[1].analysis.power,300);
await putCircle(db,{...circles[0],analysis:{attribute:'storm',role:'support',power:500}});
assert.equal((await allCircles(db))[0].analysis.attribute,'storm');
await deleteCircle(db,'c2');
assert.deepEqual((await allCircles(db)).map(x=>x.id),['c1']);
// After upgrading to DB v3, pre-update v2 JavaScript can never reopen storage.
await new Promise((resolve,reject)=>{
 const request=factory.open('magia-dungeon-v1',2);
 request.onsuccess=()=>reject(Error('v2 tab unexpectedly reopened a v3 save'));
 request.onerror=()=>{try{assert.equal(request.error.name,'VersionError');resolve();}catch(e){reject(e);}};
});
db.close();
const db2=await openStore(factory);
assert.equal((await getProfile(db2)).run.floor,3);
assert.equal((await allCircles(db2)).length,1);
await clearDungeonData(db2);
assert.equal((await allCircles(db2)).length,0,'all magic-circle image records are removed');
const fresh=await getProfile(db2);
assert.equal(fresh.level,1,'profile is regenerated from initial values after deletion');
assert.equal(fresh.run,null);
assert.equal(fresh.returns,0);
assert.equal(fresh.magicStones,0);
assert.equal(fresh.deepestReturnedLayer,0);
assert.equal(fresh.deepestReachedLayer,0);
assert.equal(await getDungeonXpMigrationBackup(db2),null,'explicit game reset removes the old backup');
// A later ordinary save must not destroy the profile or photos.
fresh.name='protected-save';
await saveProfile(db2,fresh);
await putCircle(db2,{id:'protected',name:'survivor',image:photo});
assert.equal((await getProfile(db2)).name,'protected-save');
assert.deepEqual(new Uint8Array(await (await allCircles(db2))[0].image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
assert.throws(()=>validateDatabase(undefined),/保存領域/);
await assert.rejects(openStore(undefined),/IndexedDB非対応/);
await assert.rejects(openStore(fakeIndexedDB({onOpen:'undefined'})),/保存領域/);
await assert.rejects(openStore(fakeIndexedDB({onOpen:'error'})),/IndexedDB unavailable/);
await assert.rejects(openStore(fakeIndexedDB({onOpen:'blocked'})),/別のタブ/);
await assert.rejects(openStore(fakeIndexedDB({onOpen:'throw'})),/Storage denied/);
// Quota failure while writing the backup must abort conversion atomically.
const quotaFactory=fakeIndexedDB(),quotaDb=await openStore(quotaFactory);
const quotaProfile=await getProfile(quotaDb);
delete quotaProfile.xpScaleVersion;
quotaProfile.level=92;quotaProfile.xp=20000;
await saveProfile(quotaDb,quotaProfile);
const beforeQuota=await readDungeonSnapshot(quotaDb);
quotaFactory.failMigrationBackupWrites=true;
await assert.rejects(migrateDungeonXp(quotaDb),/Injected migration backup quota error/);
const afterQuota=await readDungeonSnapshot(quotaDb);
assert.deepEqual(afterQuota.profile,beforeQuota.profile,'failed backup never partially migrates the profile');
assert.deepEqual(afterQuota.integrity,beforeQuota.integrity,'failed backup never resigns the profile');
assert.equal(await getDungeonXpMigrationBackup(quotaDb),null,'failed migration creates no partial backup');
quotaFactory.failMigrationBackupWrites=false;
const afterRetry=await migrateDungeonXp(quotaDb);
assert.equal(afterRetry.xpScaleVersion,45,'migration can retry safely after quota becomes available');
assert.equal((await getDungeonXpMigrationBackup(quotaDb)).profile.xp,20000,'retry preserves original old EXP');
quotaDb.close();
console.log('PASS dungeon IndexedDB startup, atomic EXP backup, tab collision guard, photo persistence and failure modes');
