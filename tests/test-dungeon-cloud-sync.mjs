import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseCsv,nextXp} from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,saveProfile,putCircle,allCircles,readDungeonSnapshot,replaceDungeonSnapshot,saveCloudSyncState,getCloudSyncState,onDungeonDataChange,clearDungeonData} from '../assets/js/dungeon-store.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot,isPristineDungeonSnapshot,snapshotHash} from '../assets/js/dungeon-cloud-snapshot.mjs';
import {createDungeonDrive,DRIVE_SCOPE,DriveAuthError} from '../assets/js/dungeon-cloud-drive.mjs';
import {decideCloudSync,compareDungeonProgress,cumulativeDungeonXp,canAutoSyncPlay,requiresActiveRunChoice} from '../assets/js/dungeon-cloud-sync.mjs';
import {createSuccessorProfile} from '../assets/js/dungeon-permadeath.mjs';
import {verifyLocalSnapshot,quickFingerprint} from '../assets/js/dungeon-cloud-integrity.mjs';

const csv=async name=>parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase]=await Promise.all(['balance','levels','floors','player-base'].map(csv));
configure({balance,levels,floors,playerBase});

const db=await openStore(fakeIndexedDB());
let changes=0;
const stop=onDungeonDataChange(db,()=>changes++);
const profile={name:'冒険者',level:12,attempts:3,inventory:[{id:'potion'}],run:{floor:12}};
await saveProfile(db,profile);
const photo=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'});
await putCircle(db,{id:'sigil-1',name:'魔法陣',image:photo,analysis:{power:42}});
assert.equal(changes,2);
const original=await readDungeonSnapshot(db);
assert.equal((await verifyLocalSnapshot(original)).status,'valid');
assert.match(original.profile.playId,/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i,'a cryptographically random play ID is stored');
const successor=createSuccessorProfile(original.profile,{slotIds:[],enemy:{id:'test'}},[],original.profile.base);
assert.equal(successor.playId,original.profile.playId,'permadeath keeps the same play lineage even after the adventurer is replaced');
assert.equal(successor.permadeathGeneration,1);
const laterSuccessor=createSuccessorProfile({...successor,name:'後継者二代目',level:35},
 {slotIds:[],enemy:{id:'test-2'}},[],original.profile.base);
assert.equal(laterSuccessor.permadeathGeneration,2,'the lineage keeps a monotonically increasing generation');
const postDeath={...successor,name:'後継者二代目',level:1,xp:0};
assert.equal(postDeath.playId,original.profile.playId,'name, level and XP do not define play identity');
const encoded=await serializeDungeonSnapshot(original);
assert.ok(original.savedAt>0);
assert.match(encoded,/"checksum":"[0-9a-f]+"/);
assert.match(encoded,/"format":"magia-dungeon-save-v1"/);
assert.ok(!encoded.includes('access_token'));
const decoded=deserializeDungeonSnapshot(encoded);
assert.deepEqual(decoded.profile,profile);
assert.equal(decoded.savedAt,original.savedAt);
assert.equal(decoded.profile.name,original.profile.name);
assert.equal(decoded.circles[0].image.type,'image/png');
assert.deepEqual(new Uint8Array(await decoded.circles[0].image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
assert.equal(await snapshotHash(encoded,webcrypto),await snapshotHash(encoded,webcrypto));
assert.throws(()=>deserializeDungeonSnapshot(encoded.replace('"冒険者"','"改ざん"')),/チェックサム/);
assert.equal(isPristineDungeonSnapshot(original),false);
assert.equal(isPristineDungeonSnapshot({profile:{name:'新規冒険者',tutorialDone:true,level:1,attempts:0,returns:0,run:null},circles:[]}),false,'a player name is valuable progress that must be backed up');
assert.equal(isPristineDungeonSnapshot({profile:{name:'',attempts:0,returns:0,run:null},circles:[]}),true);
assert.equal(isPristineDungeonSnapshot({profile:{...successor,collection:{},legacies:[]},circles:[]}),false,
 'a pending successor is never mistaken for an untouched save even if discoveries and local photos are absent');
await assert.rejects(serializeDungeonSnapshot({profile:null,circles:[]}),/形式/);
assert.throws(()=>deserializeDungeonSnapshot('{"format":"unsupported","profile":{},"circles":[]}'),/未対応/);
const signedPayload=payload=>JSON.stringify({...payload,checksum:quickFingerprint(payload)});
assert.throws(()=>deserializeDungeonSnapshot(signedPayload({format:'magia-dungeon-save-v1',profile:{},circles:[{id:'duplicate'},{id:'duplicate'}]})),/不正/);
assert.throws(()=>deserializeDungeonSnapshot(signedPayload({format:'magia-dungeon-save-v1',profile:{},circles:[{id:'bad',image:{blob:true,type:'image/png',base64:'@'}}]})),/不正/);

await saveCloudSyncState(db,{fileId:'abc',modifiedTime:'t0',hash:'h0'});
assert.equal(changes,2,'sync metadata must not trigger a recursive upload');
assert.deepEqual(await getCloudSyncState(db),{fileId:'abc',modifiedTime:'t0',hash:'h0'});
await replaceDungeonSnapshot(db,{profile:{name:'復元',level:7,
 magicOverrides:{'sigil-1':{image:null,analysis:{power:99}}}},circles:decoded.circles});
assert.equal(changes,3);
assert.equal((await readDungeonSnapshot(db)).profile.name,'復元');
assert.equal(await (await readDungeonSnapshot(db)).circles[0].image.type,'image/png');
const restoredCircle=(await allCircles(db))[0];
assert.equal(restoredCircle.image instanceof Blob,true,'stale profile image metadata cannot hide the restored original');
assert.deepEqual(new Uint8Array(await restoredCircle.image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
assert.equal(restoredCircle.analysis.power,99,'legacy metadata still applies without overriding photo bytes');
assert.equal(await getCloudSyncState(db),undefined,'restoring a snapshot drops device-specific metadata');
await clearDungeonData(db);
assert.equal(changes,4);
assert.equal(await getCloudSyncState(db),undefined,'deleting local data resets sync history; the next connection uses case 3');
stop();

const file={id:'1',name:'magia-dungeon-save-v1.json',modifiedTime:'t2'};
assert.equal(decideCloudSync({file:null,pristine:true}),'upload','even unnamed starting profiles need a Drive backup');
assert.equal(decideCloudSync({file:null,pristine:false}),'upload');
assert.equal(decideCloudSync({file,localHash:'same',remoteHash:'same'}),'synced','equal verified bytes never need a second upload');
assert.equal(decideCloudSync({file,localHash:'h',remoteHash:'h'}),'synced');
assert.equal(decideCloudSync({file,localHash:'a',remoteHash:'b',localSavedAt:10,remoteSavedAt:9}),'upload');
assert.equal(decideCloudSync({file,localHash:'a',remoteHash:'b',localSavedAt:9,remoteSavedAt:10}),'download');
assert.equal(decideCloudSync({file,localHash:'a',remoteHash:'b',localSavedAt:10,remoteSavedAt:10}),'upload','exactly tied progress and timestamps prefer local without a chooser');
assert.equal(decideCloudSync({file,localHash:'a',remoteHash:'b',localSavedAt:0,remoteSavedAt:10}),'upload','unknown timestamp only breaks a full progress tie, local fallback');
assert.equal(decideCloudSync({file,localHash:'a',remoteHash:'b',localSavedAt:10,remoteSavedAt:0}),'upload','unknown timestamp never beats known progress');
// EXP is banked as the remainder after each level; derive actual lifetime
// earned EXP for this character from the game's level thresholds.
assert.equal(cumulativeDungeonXp({level:1,xp:7}),7);
assert.equal(cumulativeDungeonXp({level:2,xp:7}),nextXp(1)+7);
assert.equal(cumulativeDungeonXp({level:3,xp:12}),nextXp(1)+nextXp(2)+12);
const score=(localProfile,remoteProfile,localSavedAt=1,remoteSavedAt=999)=>
 decideCloudSync({file,localHash:'local',remoteHash:'remote',
  localProfile,remoteProfile,localSavedAt,remoteSavedAt});
const rankHigh={adventurerRank:50,level:1,xp:0,deepestReturnedLayer:0,deepestReachedLayer:0};
const rankLow={adventurerRank:40,level:120,xp:900000,deepestReturnedLayer:100,deepestReachedLayer:120};
assert.equal(score(rankHigh,rankLow),'upload','higher adventurer badge wins even when every other field and timestamp is lower');
assert.equal(score(rankLow,rankHigh),'download','the badge takes precedence in either direction');
const deadGeneration={...rankHigh,permadeath:true,permadeathGeneration:0,
 name:'先代',collection:{discovered:1}};
const livingGeneration={...rankLow,permadeath:true,permadeathGeneration:1,
 name:'',awaitingHeir:true,collection:{discovered:1}};
assert.equal(score(livingGeneration,deadGeneration),'upload','newer death generation beats old rank, XP and floors');
assert.equal(score(deadGeneration,livingGeneration),'download','older champion on Drive cannot replace newer local successor');
const twiceReborn={...livingGeneration,permadeathGeneration:2,adventurerRank:0,level:1,xp:0};
assert.equal(score(twiceReborn,livingGeneration),'upload','generation beats higher rank from an earlier heir');
assert.equal(score(livingGeneration,twiceReborn),'download');
assert.equal(score({...rankLow,permadeathGeneration:0},rankHigh),'download',
 'same-generation regular saves keep the existing rank-first comparison');
const xpHigh={adventurerRank:30,level:25,xp:3,deepestReturnedLayer:10,deepestReachedLayer:12};
const xpLow={adventurerRank:30,level:24,xp:0,deepestReturnedLayer:100,deepestReachedLayer:120};
assert.ok(cumulativeDungeonXp(xpHigh)>cumulativeDungeonXp(xpLow));
assert.equal(score(xpHigh,xpLow),'upload','cumulative level-earned EXP outranks floor progression and timestamp');
assert.equal(score(xpLow,xpHigh),'download','higher cumulative EXP on Drive wins despite an older timestamp');
const returnedHigh={...xpHigh,deepestReturnedLayer:30,deepestReachedLayer:31};
const returnedLow={...xpHigh,deepestReturnedLayer:20,deepestReachedLayer:100};
assert.equal(score(returnedHigh,returnedLow),'upload','returned layer outranks reached layer and save time');
assert.equal(score(returnedLow,returnedHigh),'download');
const reachedHigh={...xpHigh,deepestReturnedLayer:20,deepestReachedLayer:51};
const reachedLow={...xpHigh,deepestReturnedLayer:20,deepestReachedLayer:50};
assert.equal(score(reachedHigh,reachedLow),'upload','reached layer outranks savedAt');
assert.equal(score(reachedLow,reachedHigh),'download');
assert.equal(score(reachedLow,reachedLow,10,11),'download','timestamp is the final discriminator');
assert.equal(score(reachedLow,reachedLow,11,10),'upload');
assert.equal(compareDungeonProgress(reachedLow,reachedLow),0,'matching ranks, cumulative EXP and depths are tied');
assert.equal(score(reachedLow,reachedLow,10,10),'upload','fully identical progress and timestamp use deterministic local copy');
assert.equal(score(reachedLow,reachedLow,0,0),'upload','unknown time cannot block a complete progress tie');
assert.equal(decideCloudSync({file,localHash:'identical',remoteHash:'identical',
 localProfile:rankLow,remoteProfile:rankHigh}),'synced','byte identical saves never rewrite either side');

const activeFirst={run:{stage:'battle',floor:496,hero:{hp:200,mp:80},enemy:{hp:500},battleTurns:0}};
const activeLater={run:{stage:'battle',floor:498,hero:{hp:150,mp:65},enemy:{hp:300},battleTurns:2}};
assert.equal(requiresActiveRunChoice(activeFirst,activeLater,{remoteHash:'new',verifiedRemoteHash:'old'}),true);
assert.equal(requiresActiveRunChoice(activeFirst,activeLater,{remoteHash:'old',verifiedRemoteHash:'old'}),false);
assert.equal(requiresActiveRunChoice(activeFirst,activeFirst,{remoteHash:'new'}),false);
assert.equal(requiresActiveRunChoice({run:null},activeLater,{remoteHash:'new',verifiedRemoteHash:'old'}),true);
assert.equal(requiresActiveRunChoice({run:null},{run:null},{remoteHash:'new'}),false);
const playOne='00000000-0000-4000-8000-000000000001',playTwo='00000000-0000-4000-8000-000000000002';
assert.equal(canAutoSyncPlay({localPlayId:playOne,remotePlayId:playOne}),true,'one play permits automatic backup regardless of adventurer');
assert.equal(canAutoSyncPlay({localPlayId:playOne,remotePlayId:playTwo}),false,'different play IDs prevent automatic overwrite and restore regardless of timestamps');
assert.equal(canAutoSyncPlay({localPlayId:playOne,remotePlayId:null}),false,'missing cloud ID cannot silently be identified');
assert.equal(canAutoSyncPlay({localPlayId:playOne,remotePlayId:null,identical:true}),false,'prior file matches never silently adopt a backup with no play ID');
assert.equal(canAutoSyncPlay({localPlayId:null,remotePlayId:playTwo}),false,'remote play cannot be restored automatically into unknown local game');

// Simulate an unplanned IndexedDB record loss. The preexisting trusted seal
// must detect it rather than creating a new valid checksum on the next save.
const tamperFactory=fakeIndexedDB(),damaged=await openStore(tamperFactory);
await saveProfile(damaged,{name:'検証対象',level:5});
await putCircle(damaged,{id:'tamper-circle',name:'画像',image:photo});
const maps=tamperFactory.databases.get('magia-dungeon-v1');
const circleTable=maps.get('circles');
const intact=structuredClone(circleTable.get('tamper-circle'));
circleTable.set('tamper-circle',{...intact,image:null});
assert.deepEqual((await verifyLocalSnapshot(await readDungeonSnapshot(damaged))).badImageIds,['tamper-circle']);
circleTable.set('tamper-circle',intact);
circleTable.delete('tamper-circle');
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(damaged))).status,'corrupt');
await assert.rejects(saveProfile(damaged,{name:'誤上書き',level:5}),/整合性/);

// Permadeath legacies retain their photographs inside nested profile objects.
// JSON.stringify(Blob) used to discard these without warning.
const legacyFactory=fakeIndexedDB(),legacyDb=await openStore(legacyFactory);
await saveProfile(legacyDb,{name:'後継者',level:2});
await putCircle(legacyDb,{id:'lost-photo',image:photo,analysis:{power:8}});
const heir=await readDungeonSnapshot(legacyDb);
heir.profile.legacies=[{name:'先代',circles:[{id:'lost-photo',image:photo}],loot:[]}];
await saveProfile(legacyDb,heir.profile);
const sealedLegacy=await readDungeonSnapshot(legacyDb);
assert.equal((await verifyLocalSnapshot(sealedLegacy)).status,'valid','nested photos have trusted evidence');
const legacyText=await serializeDungeonSnapshot(sealedLegacy);
const legacyDecoded=deserializeDungeonSnapshot(legacyText);
assert.ok(legacyDecoded.profile.legacies[0].circles[0].image instanceof Blob,'the backup preserves a nested image');
assert.deepEqual(new Uint8Array(await legacyDecoded.profile.legacies[0].circles[0].image.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
const corruptedPhoto=new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,1])],{type:'image/png'});
const storedProfile=legacyFactory.databases.get('magia-dungeon-v1').get('settings').get('profile');
storedProfile.legacies[0].circles[0].image=corruptedPhoto;
legacyFactory.databases.get('magia-dungeon-v1').get('settings').set('profile',storedProfile);
assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(legacyDb))).status,'corrupt','tampered legacy photo cannot silently overwrite backup');

const calls=[];
const mockedFetch=async(url,options={})=>{
 calls.push({url:String(url),options});
 assert.equal(options.headers.Authorization,'Bearer test-ephemeral-token');
 if(url.includes('?alt=media'))return new Response(encoded);
 if(url.includes('uploadType=resumable'))return new Response('',{status:200,headers:{Location:'https://www.googleapis.com/upload/session/safe'}});
 if(url.includes('/upload/session/safe'))return Response.json({id:'1',modifiedTime:'t3'});
 if(url.includes('?fields=id,name,modifiedTime'))return Response.json({id:'1',modifiedTime:'t2'});
 if(url.includes('spaces=appDataFolder'))return Response.json({files:[file]});
 throw Error('Unexpected URL '+url);
};
const drive=createDungeonDrive('test-ephemeral-token',mockedFetch);
assert.deepEqual(await drive.list(),[file]);
assert.equal(await drive.download('1'),encoded);
assert.deepEqual(await drive.metadata('1'),{id:'1',modifiedTime:'t2'});
assert.deepEqual(await drive.upload(encoded,'1'),{id:'1',modifiedTime:'t3'});
assert.equal(calls.filter(c=>c.url.includes('uploadType=resumable')).length,1);
assert.ok(calls.some(c=>c.options.method==='PUT'),'photo-inclusive backup uses resumable transfer');
assert.ok(calls.every(c=>!c.url.includes('test-ephemeral-token')),'token must not enter URLs');
await assert.rejects(createDungeonDrive('expired',async()=>new Response('',{status:401})).list(),DriveAuthError);
await assert.rejects(createDungeonDrive('revoked',async()=>Response.json({error:{message:'insufficient permissions'}},{status:403})).list(),DriveAuthError);
await assert.rejects(createDungeonDrive('quota',async()=>Response.json({error:{errors:[{reason:'rateLimitExceeded'}]}},{status:403})).list(),/HTTP 403/);
assert.equal(DRIVE_SCOPE,'https://www.googleapis.com/auth/drive.appdata');
console.log('PASS dungeon cloud snapshot photos, atomic restore, conflict rules, safe Drive requests and write hooks');
