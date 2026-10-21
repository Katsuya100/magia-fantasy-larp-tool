import assert from 'node:assert/strict';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,saveHeirName,readDungeonSnapshot,putCircle} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';

const factory=fakeIndexedDB(),db=await openStore(factory);
const photo=new Blob([Uint8Array.from([255,216,255,224,23,42,255,217])],{type:'image/jpeg'});
const lostCircle={id:'legacy-c',image:photo,legacyOriginName:'初代',legacyHeirNames:['二代目'],
 analysis:{attribute:'flame',role:'attack',power:88},legacyHp:24};
const profile={name:'',level:1,xp:0,returns:0,attempts:0,
 base:{hp:100,mag:10,def:7,res:7},inventory:[],obtainedItemIds:[],
 defeatedBosses:{},collection:{},magicStones:12,permadeath:true,awaitingHeir:true,
 legacies:[{name:'二代目',enemyId:'foe',level:12,circles:[lostCircle],items:[],loot:[]}],run:null};
await saveProfile(db,profile);
await putCircle(db,{id:'active-c',image:photo,analysis:{attribute:'aqua',role:'support',power:99}});
const before=await readDungeonSnapshot(db);
assert.equal((await verifyLocalSnapshot(before)).status,'valid');
factory.failProfileBlobWrites=true;
await saveProfile(db,{...profile,magicStones:13});
assert.equal((await readDungeonSnapshot(db)).profile.magicStones,13,'normal metadata edit does not rewrite inherited Blob');
const next=await saveHeirName(db,'三代目');
assert.equal(next.name,'三代目');
assert.equal(next.awaitingHeir,false);
assert.equal(next.permadeath,true);
assert.equal(next.magicStones,13);
assert.deepEqual(next.legacies[0].circles[0].legacyHeirNames,['二代目']);
const actual=await getProfile(db);
assert.equal(actual.name,'三代目');
assert.equal(actual.awaitingHeir,false);
assert.equal(actual.legacies[0].circles[0].image.size,photo.size);
const raw=factory.databases.get('magia-dungeon-v1').get('settings').get('profile');
assert.equal(raw.name,'','name is stored only in the overlay');
assert.equal(raw.legacies[0].circles[0].image.__magiaArchivedPhoto,true,'the original is referenced by magic ID, not copied into profile');
const snapshot=await readDungeonSnapshot(db);
assert.equal(snapshot.profile.name,'三代目');
assert.equal((await verifyLocalSnapshot(snapshot)).status,'valid','overlay and integrity seal agree');
assert.equal(await digestPhoto(snapshot.profile.legacies[0].circles[0].image),await digestPhoto(photo));
assert.equal(await digestPhoto(snapshot.circles[0].image),await digestPhoto(photo));
const text=await serializeDungeonSnapshot(snapshot);
const backup=deserializeDungeonSnapshot(text);
assert.equal(backup.profile.name,'三代目','Drive backup contains the newly committed name');
assert.equal(backup.profile.legacies[0].circles[0].legacyOriginName,'初代');
assert.equal(await digestPhoto(backup.profile.legacies[0].circles[0].image),await digestPhoto(photo));
await assert.rejects(saveHeirName(db,'四代目'),/入力状態/,'second heir name must not re-write a running character');
// Simulate a page reopen; the merged view remains valid and does not need
// to deserialize nested images during name confirmation.
db.close();
const reopened=await openStore(factory);
assert.equal((await getProfile(reopened)).name,'三代目');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(reopened))).status,'valid');
// Once the browser accepts ordinary profile writes, fold the overlay away.
factory.failProfileBlobWrites=false;
const updated={...await getProfile(reopened),magicStones:15};
await saveProfile(reopened,updated);
assert.equal(factory.databases.get('magia-dungeon-v1').get('settings').has('heirNameOverride'),false);
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(reopened))).status,'valid');
assert.equal((await getProfile(reopened)).magicStones,15);
assert.equal((await getProfile(reopened)).name,'三代目');
console.log('PASS inherited-photo-safe heir name, verified save, restart, backup and normal save');
