import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openStore,validateDatabase,allCircles,putCircle,deleteCircle,getProfile,saveProfile,saveProfileWithCircles,migrateDungeonXp,getDungeonXpMigrationBackup,restoreDungeonXpMigrationBackup,getDungeonIntegerXpMigrationBackup,restoreDungeonIntegerXpMigrationBackup,readDungeonSnapshot,replaceDungeonSnapshot,clearDungeonData} from '../assets/js/dungeon-store.mjs';
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
// The app and Drive sync import the save module using release cache keys;
// saves through a bare import must still notify that same auto-sync bus.
const versionedStore=await import('../assets/js/dungeon-store.mjs?v=20261023.47');
let crossModuleSaveEvents=0;
const stopVersionedListener=versionedStore.onDungeonDataChange(db,()=>crossModuleSaveEvents++);
await saveProfile(db,p);
assert.equal(crossModuleSaveEvents,1,'cache-keyed Drive listeners receive game saves');
stopVersionedListener();
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
const intermediate45=await getDungeonIntegerXpMigrationBackup(db);
assert.equal(intermediate45.profile.xpScaleVersion,45,'legacy XP must pass through the existing 1/45 converter');
const originalNeed92=Math.ceil(Number(levels[91].xp_to_next)*Math.pow(2.1,91/10));
const priorNeed92=Math.ceil(Number(levels[91].xp_to_next)*Math.pow(1.85,9.1)/45);
assert.equal(intermediate45.profile.xp,Math.round(20000/originalNeed92*priorNeed92*1e6)/1e6,
 'first migration retains the precise historic 1/45 gauge formula');
assert.equal(intermediate45.profile.run.xp>0,true,'1/45 checkpoint also preserves converted pending XP');
assert.ok(Number.isSafeInteger(converted.xp)&&converted.xp>0&&converted.xp<G.nextXp(92),'old XP gauge converts into integer units');
assert.ok(Number.isSafeInteger(converted.run.xp)&&converted.run.xp>0,'unbanked XP is converted to whole units');
assert.ok(Number.isSafeInteger(converted.pendingReturn.gained)&&converted.pendingReturn.gained>0,'pending reward is converted to whole units');
assert.ok(Number.isSafeInteger(converted.pendingReturn.before.xp)&&converted.pendingReturn.before.xp>0,'return animation XP is converted');
assert.equal(converted.xpScaleVersion,46);
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
assert.ok(Math.abs(exact.xp/G.nextXp(92)-legacyStartXp/oldNeed(92))<=1/G.nextXp(92),
 'Lv92 current-level EXP progress remains the same');
const resumed={level:exact.level,xp:exact.xp};
G.experience(resumed,exact.run.xp);
assert.equal(resumed.level,oldRunEnd.level,'pending exploration XP yields the same final level');
assert.ok(Math.abs(resumed.xp/G.nextXp(resumed.level)-oldRunEnd.xp/oldNeed(oldRunEnd.level))<=1/G.nextXp(resumed.level),
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
// Migrate an actual v45 fractional signed save without touching its
// separate pre-v45 migration rescue point or unrelated progress.
const historicBackup=await getDungeonXpMigrationBackup(db);
const fractional=await getProfile(db);
fractional.xpScaleVersion=45;
fractional.level=2;
fractional.xp=0.4;
fractional.run={floor:7,loot:[],xp:1.2};
fractional.pendingReturn={before:{level:1,xp:2.4},gained:1,steps:['xp'],step:0};
fractional.magicStones=123;
await saveProfile(db,fractional);
const integer=await migrateDungeonXp(db);
assert.equal(integer.xpScaleVersion,G.XP_SCALE);
assert.equal(integer.xp,2,'fractional EXP gauge is expressed in whole units');
assert.equal(integer.run.xp,6,'unbanked battle rewards are whole numbers');
assert.equal(integer.pendingReturn.before.xp,12,'return start gauge remains exact');
assert.equal(integer.pendingReturn.gained,5,'pending return animation remains exact');
assert.equal(integer.magicStones,123,'conversion must not change magic stones');
assert.deepEqual(await getDungeonXpMigrationBackup(db),historicBackup,
 'integer conversion never overwrites the original pre-v45 backup');
const integerBackup=await getDungeonIntegerXpMigrationBackup(db);
assert.equal(integerBackup.profile.xpScaleVersion,45,'v45 rescue point retains its original format');
assert.equal(integerBackup.profile.run.xp,1.2,'v45 rescue preserves the fractional expedition');
assert.deepEqual(await migrateDungeonXp(db),integer,'a migrated signed save is never multiplied twice');
await restoreDungeonIntegerXpMigrationBackup(db);
assert.equal((await getProfile(db)).xpScaleVersion,45,'integer rescue restores the exact fractional source');
const reconverted=await migrateDungeonXp(db);
assert.equal(reconverted.xp,integer.xp,'restored v45 source reconverts without drift');
assert.equal(reconverted.run.xp,integer.run.xp,'restored v45 unbanked EXP reconverts without drift');
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
clean.level=1;clean.xp=0;clean.run={...p.run,xp:0};delete clean.pendingReturn;clean.xpScaleVersion=G.XP_SCALE;
await saveProfile(db,clean);
// An EXP regression must fail before the save writes or changes the seal.
// Historic v45 saves can contain fractions, but v46 never can.
const validSnapshot=await readDungeonSnapshot(db);
const invalidProfiles=[
 {...clean,xp:0.25},
 {...clean,xp:NaN},
 {...clean,xp:Number.MAX_SAFE_INTEGER+1},
 {...clean,run:{...clean.run,xp:1.2}},
 {...clean,pendingReturn:{before:{level:1,xp:1.2},gained:4,steps:['xp']}},
 {...clean,pendingReturn:{before:{level:1,xp:0},gained:4.2,steps:['xp']}}
];
for(const invalid of invalidProfiles){
 await assert.rejects(saveProfile(db,invalid),/整数EXP/,'invalid v46 EXP must fail before saving');
 const after=await readDungeonSnapshot(db);
 assert.deepEqual(after.profile,validSnapshot.profile,'a rejected fractional EXP cannot rewrite progress');
 assert.deepEqual(after.integrity,validSnapshot.integrity,'a rejected fractional EXP cannot re-sign progress');
}
await assert.rejects(saveProfileWithCircles(db,{...clean,run:{...clean.run,xp:0.5}}),/整数EXP/,
 'equipment saves must not bypass the integer EXP guard');
await assert.rejects(replaceDungeonSnapshot(db,{...validSnapshot,profile:{...clean,xp:0.5}}),/整数EXP/,
 'cloud restores must reject fractional EXP in an already-modern save');
assert.deepEqual((await readDungeonSnapshot(db)).profile,validSnapshot.profile,
 'rejected cloud snapshots cannot overwrite local progress');
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
await putCircle(quotaDb,{id:'pre-migration-proof',name:'保全する写真',image:photo});
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
// Failure at the very last integrity-seal write must also roll back the
// previously staged backup and profile in the same IndexedDB transaction.
quotaFactory.failIntegrityWrites=true;
await assert.rejects(migrateDungeonXp(quotaDb),/Injected integrity write failure/);
assert.deepEqual((await readDungeonSnapshot(quotaDb)).profile,beforeQuota.profile,'seal failure leaves unconverted profile');
assert.deepEqual((await readDungeonSnapshot(quotaDb)).integrity,beforeQuota.integrity,'seal failure leaves original proof');
assert.equal(await getDungeonXpMigrationBackup(quotaDb),null,'seal failure leaves no orphaned backup');
quotaFactory.failIntegrityWrites=false;
const afterRetry=await migrateDungeonXp(quotaDb);
assert.equal(afterRetry.xpScaleVersion,G.XP_SCALE,'migration can retry safely after quota becomes available');
assert.equal((await getDungeonXpMigrationBackup(quotaDb)).profile.xp,20000,'retry preserves original old EXP');
// Tampering with the archived photo cannot be laundered into a replacement save.
const archived=quotaFactory.databases.get('magia-dungeon-v1').get('settings').get('xpMigrationBackupV1');
archived.circles[0].image=new Blob([Uint8Array.from([1,2,3])],{type:'image/jpeg'});
const beforeBadPhotoRestore=await readDungeonSnapshot(quotaDb);
await assert.rejects(restoreDungeonXpMigrationBackup(quotaDb),/署名または写真が一致しません/);
const afterBadPhotoRestore=await readDungeonSnapshot(quotaDb);
assert.deepEqual(afterBadPhotoRestore.profile,beforeBadPhotoRestore.profile,'tampered archival photo cannot overwrite play progress');
assert.deepEqual(afterBadPhotoRestore.integrity,beforeBadPhotoRestore.integrity,'tampered archive cannot rewrite the trusted seal');
quotaDb.close();
console.log('PASS dungeon IndexedDB startup, atomic EXP backup, tab collision guard, photo persistence and failure modes');
