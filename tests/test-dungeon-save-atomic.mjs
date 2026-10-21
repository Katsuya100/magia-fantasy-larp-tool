import assert from 'node:assert/strict';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,saveProfile,saveHeirName,putCircle,readDungeonSnapshot,getProfile,allCircles} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto,recordFingerprint,profilePhotoEvidence,quickFingerprint} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {createSuccessorProfile} from '../assets/js/dungeon-permadeath.mjs';

const factory=fakeIndexedDB(),db=await openStore(factory);
const photo=new Blob([Uint8Array.from([255,216,255,224,5,4,3,2,255,217])],{type:'image/jpeg'});
const magic={id:'original-image',image:photo,analysis:{attribute:'flame',role:'attack',power:80},revealed:true};
const profile={name:'初代',level:11,attempts:2,returns:1,inventory:[],slots:['original-image',null,null,null,null],
 tutorialDone:true,permadeath:true,legacies:[],run:null,base:{hp:100,mag:10,def:7,res:7},magicStones:10};
await saveProfile(db,profile);
await putCircle(db,magic);
const run={enemy:{id:'enemy_1'},slotIds:['original-image',null,null,null,null],carry:[],loot:[]};
const next=createSuccessorProfile(await getProfile(db),run,[magic],profile.base);
const beforeCircle=factory.databases.get('magia-dungeon-v1').get('circles').get(magic.id);
const before=factory.transactions.length;
await saveProfile(db,next);
const writes=factory.transactions.slice(before).filter(tx=>tx.mode==='readwrite');
assert.equal(writes.length,1,'one death = exactly one atomic readwrite transaction');
assert.deepEqual(writes[0].writes.filter(w=>w.store==='circles'),[],'death does not rewrite or delete a magic record');
assert.equal(await digestPhoto(factory.databases.get('magia-dungeon-v1').get('circles').get(magic.id).image),await digestPhoto(beforeCircle.image),'original photo bytes are untouched');
assert.equal((await allCircles(db)).length,0,'lost magic is hidden, not deleted');
const stored=factory.databases.get('magia-dungeon-v1').get('settings').get('profile');
assert.equal(stored.legacies[0].circles[0].image.__magiaArchivedPhoto,true,'historical profile has only a reference');
assert.equal(stored.legacies[0].circles[0].image.id,magic.id);
assert.ok(!(stored.legacies[0].circles[0].image instanceof Blob));
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
const name=await saveHeirName(db,'二代目');
assert.equal(name.name,'二代目');
factory.failProfileBlobWrites=true;
const current=await getProfile(db);
const beforeEquipment=factory.transactions.length;
await saveProfile(db,{...current,slots:[null,null,null,null,null],magicStones:11});
const equipmentWrites=factory.transactions.slice(beforeEquipment).filter(tx=>tx.mode==='readwrite');
assert.equal(equipmentWrites.length,1,'one equipment save = one readwrite transaction');
assert.deepEqual(equipmentWrites[0].writes.filter(w=>w.store==='circles'),[],'ordinary save does not write photos');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid');
const encoded=await serializeDungeonSnapshot(await readDungeonSnapshot(db));
assert.equal([...encoded.matchAll(/"base64":/g)].length,1,'a cloud backup includes the shared original image only once');
const decoded=deserializeDungeonSnapshot(encoded);
assert.equal(await digestPhoto(decoded.profile.legacies[0].circles[0].image),await digestPhoto(photo));
assert.equal(await digestPhoto(decoded.circles[0].image),await digestPhoto(photo));

const stable=await readDungeonSnapshot(db);
factory.failIntegrityWrites=true;
await assert.rejects(saveProfile(db,{...await getProfile(db),magicStones:999}),/Injected integrity write failure/);
factory.failIntegrityWrites=false;
const afterFailure=await readDungeonSnapshot(db);
assert.equal(afterFailure.profile.magicStones,stable.profile.magicStones,'failed integrity write rolls back profile');
assert.deepEqual(afterFailure.integrity,stable.integrity,'failed transaction does not advance integrity seal');
assert.equal(await digestPhoto(afterFailure.circles[0].image),await digestPhoto(photo));

const env=fakeDungeonBrowser({factory});
try{
 await import('../assets/js/dungeon-app.mjs?integration=atomic-save-error-dialog');
 const $=id=>env.document.getElementById(id);
 for(let i=0;i<400&&!$('startupMask').hidden;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal($('startupMask').hidden,true,'the heir save loads');
 // The available magic remains lost, so trigger name save instead of equipment.
 factory.failIntegrityWrites=true;
 await env.document.click({disabled:false,dataset:{action:'rename'},closest(){return this;}});
 $('playerNameInput').value='三代目';
 await $('nameForm').fire('submit');
 assert.equal($('saveErrorDialog').open,true,'save failure gets a modal');
 assert.match($('saveErrorMessage').textContent,/名前の保存に失敗|冒険者名の保存に失敗/);
 await $('closeSaveError').fire('click');
 assert.equal($('saveErrorDialog').open,false,'the modal requires acknowledgement');
 factory.failIntegrityWrites=false;
}finally{env.restore();}
console.log('PASS single-transaction permadeath and edits, no photo copies, rollback, visible failure dialog');


// Real on-disk v1 layout: nested photo Blobs exist in old historical
// profiles, including a carried legacy within an unfinished expedition,
// while the circles store contains neither original record.
const oldFactory=fakeIndexedDB(),oldDb=await openStore(oldFactory);
const oldProfile={
 name:'二代目',level:4,inventory:[],magicStones:1,legacies:[
  {name:'初代',enemyId:'fallen',circles:[{id:'old-photo',image:photo,analysis:{power:20}}],loot:[]}
 ],
 run:{floor:4,loot:[{type:'legacy',legacy:{name:'祖父',circles:[{id:'nested-photo',image:photo,analysis:{power:10}}],loot:[]}}]}
};
const oldSettings=oldFactory.databases.get('magia-dungeon-v1').get('settings');
const oldHash=await digestPhoto(photo);
const oldEvidence=await profilePhotoEvidence(oldProfile);
oldSettings.set('profile',structuredClone(oldProfile));
oldSettings.set('integrity',{
 version:1,records:recordFingerprint({profile:oldProfile,circles:[]}),photos:{},
 profilePhotos:oldEvidence,savedAt:1000,legacy:false
});
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(oldDb))).status,'valid','pre-migration old on-disk save is trusted');
const oldTxStart=oldFactory.transactions.length;
await saveProfile(oldDb,{...await getProfile(oldDb),magicStones:2});
const oldWrites=oldFactory.transactions.slice(oldTxStart).filter(tx=>tx.mode==='readwrite');
assert.equal(oldWrites.length,1,'v1 nested-Blob migration commits in one transaction');
assert.deepEqual(oldWrites[0].writes.filter(w=>w.store==='circles').map(w=>w.key).sort(),['nested-photo','old-photo'],'exactly one first image record per legacy magic');
const migratedRaw=oldSettings.get('profile');
assert.equal(migratedRaw.legacies[0].circles[0].image.__magiaArchivedPhoto,true);
assert.equal(migratedRaw.run.loot[0].legacy.circles[0].image.__magiaArchivedPhoto,true);
assert.equal(await digestPhoto(oldFactory.databases.get('magia-dungeon-v1').get('circles').get('old-photo').image),oldHash);
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(oldDb))).status,'valid','old on-disk save remains verified after conversion');
const secondWriteAt=oldFactory.transactions.length;
await saveProfile(oldDb,{...await getProfile(oldDb),magicStones:3});
assert.deepEqual(oldFactory.transactions.slice(secondWriteAt).flatMap(tx=>tx.writes).filter(w=>w.store==='circles'),[],
 'all subsequent profile saves reuse original photo records without rewriting them');
const compactOld=await serializeDungeonSnapshot(await readDungeonSnapshot(oldDb));
assert.equal([...compactOld.matchAll(/"base64":/g)].length,2,'each distinct historic image appears only once in Drive backup');

// A Drive v1 file has embedded legacy photos and no circles records at all.
// Deserialization must preserve it and restoration must migrate atomically.
const legacyPhoto={__magiaSavePhoto:true,type:photo.type,base64:Buffer.from(await photo.arrayBuffer()).toString('base64')};
const oldPayload={format:'magia-dungeon-save-v1',savedAt:500,
 profile:{name:'旧クラウド',level:6,inventory:[],legacies:[{name:'初代',circles:[{id:'drive-photo',image:legacyPhoto}],loot:[]}]},
 circles:[]};
const decodedOld=deserializeDungeonSnapshot(JSON.stringify({...oldPayload,checksum:quickFingerprint(oldPayload)}));
assert.equal(await digestPhoto(decodedOld.profile.legacies[0].circles[0].image),oldHash,'old Drive embedded photo decodes');
const restoredFactory=fakeIndexedDB(),restoredDb=await openStore(restoredFactory);
const restoreStart=restoredFactory.transactions.length;
await import('../assets/js/dungeon-store.mjs').then(store=>store.replaceDungeonSnapshot(restoredDb,decodedOld));
assert.equal(restoredFactory.transactions.slice(restoreStart).filter(tx=>tx.mode==='readwrite').length,1,'old Drive restore is atomic');
const restoredSnap=await readDungeonSnapshot(restoredDb);
assert.equal((await verifyLocalSnapshot(restoredSnap)).status,'valid');
assert.equal(restoredSnap.circles[0].id,'drive-photo');
assert.equal(await digestPhoto(restoredSnap.circles[0].image),oldHash);
assert.equal(restoredFactory.databases.get('magia-dungeon-v1').get('settings').get('profile').legacies[0].circles[0].image.id,'drive-photo');

// Failed conversion never strands new photos without the matching profile.
const failingFactory=fakeIndexedDB(),failingDb=await openStore(failingFactory);
const failingSettings=failingFactory.databases.get('magia-dungeon-v1').get('settings');
failingSettings.set('profile',structuredClone(oldProfile));
failingSettings.set('integrity',{
 version:1,records:recordFingerprint({profile:oldProfile,circles:[]}),photos:{},
 profilePhotos:oldEvidence,savedAt:1000,legacy:false
});
failingFactory.failIntegrityWrites=true;
await assert.rejects(saveProfile(failingDb,{...await getProfile(failingDb),magicStones:5}),/Injected integrity write failure/);
assert.equal(failingFactory.databases.get('magia-dungeon-v1').get('circles').size,0,'aborted migration leaves original store untouched');
assert.ok(failingSettings.get('profile').legacies[0].circles[0].image instanceof Blob,'aborted migration leaves original embedded photos available');
assert.equal(failingSettings.get('integrity').savedAt,1000);
console.log('PASS old on-disk nested Blob, nested loot, legacy Drive backup migration and atomic rollback');
