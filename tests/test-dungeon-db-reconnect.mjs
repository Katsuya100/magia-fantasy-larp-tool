import assert from 'node:assert/strict';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {
 openStore,getProfile,saveProfile,readDungeonSnapshot,replaceDungeonSnapshot,
 getCloudSyncState,saveCloudSyncState
} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot} from '../assets/js/dungeon-cloud-integrity.mjs';

const factory=fakeIndexedDB(),db=await openStore(factory);
const profile=await getProfile(db);
profile.name='接続復旧のテスト';
await saveProfile(db,profile);
const revision=profile.saveRevision;
factory.closeConnections();
assert.equal(db.closed,true,'the original connection was actually closed');
profile.name='閉鎖後に保存';
await saveProfile(db,profile);
assert.equal(profile.saveRevision,revision+1);
assert.equal((await getProfile(db)).name,'閉鎖後に保存');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');

const opensAfterClose=factory.opens;
factory.failNextTransactions=1;
profile.name='取引開始時の例外を回復';
await saveProfile(db,profile);
assert.ok(factory.opens>opensAfterClose,'InvalidStateError at transaction creation reopens the database');
assert.equal((await getProfile(db)).name,'取引開始時の例外を回復');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');

const current=[...factory.connections.get('magia-dungeon-v1')].at(-1);
current.onversionchange();
assert.equal(current.closed,true,'versionchange closes the active connection');
profile.name='versionchange 後に保存';
await saveProfile(db,profile);
assert.equal((await getProfile(db)).name,'versionchange 後に保存');
await saveCloudSyncState(db,{fileId:'recovered'});
assert.deepEqual(await getCloudSyncState(db),{fileId:'recovered'},'cloud sync metadata uses the refreshed connection');

const snapshot=await readDungeonSnapshot(db);
factory.closeConnections();
await replaceDungeonSnapshot(db,snapshot);
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid','snapshot restore and integrity survive reconnect');

const previousRevision=profile.saveRevision;
factory.failNextTransactions=2;
await assert.rejects(saveProfile(db,profile),/connection is closing/);
assert.equal(profile.saveRevision,previousRevision,'failed writes never advance the caller revision');
profile.name='再試行後の保存';
await saveProfile(db,profile);
assert.equal((await getProfile(db)).name,'再試行後の保存');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
console.log('PASS closed/closing IndexedDB recovers safely with intact save integrity');
