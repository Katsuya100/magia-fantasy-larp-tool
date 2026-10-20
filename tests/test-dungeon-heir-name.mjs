import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';
const factory=fakeIndexedDB();
const db=await openStore(factory);
const legacyPhoto=new Blob([Uint8Array.from([255,216,255,217])],{type:'image/jpeg'});
await saveProfile(db,{
 name:'',level:1,xp:0,base:{hp:100,mag:10,def:7,res:7},returns:0,attempts:0,
 tutorialDone:true,inventory:[],obtainedItemIds:[],collection:{},
 defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,magicStones:4,
 legacies:[{name:'先代',level:8,enemyId:'test_enemy',
  circles:[{id:'lost-original',image:legacyPhoto,legacyOriginName:'先代',
   legacyHeirNames:[],analysis:{attribute:'flame',role:'attack',power:120}}],
  items:[],loot:[]}],
 run:null,permadeath:true,awaitingHeir:true
});
// Reproduce mobile IndexedDB rejecting a Blob-carrying settings.profile put.
factory.failProfileBlobWrites=true;
const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
const wait=async predicate=>{for(let i=0;i<250;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out opening the successor name form');};
try{
 await import('../assets/js/dungeon-app.mjs?integration=heir-name');
 await wait(()=>$('nameDialog').open);
 assert.equal($('backupSetupDialog').open,false,'a successor must not repeat initial backup setup');
 assert.equal($('permadeathChoice').hidden,true,'no mode selector in the successor dialog');
 assert.equal($('permadeathInput').value,'permadeath');
 assert.equal($('savePlayerName').disabled,false);
 // Reproduce a concurrent game action holding the shared action lock.
 // The successor confirmation must be independent of that lock.
 let resumeCamera;
 navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resumeCamera=resolve;});
 const cameraAction=$('cameraStart').fire('click');
 await wait(()=>Boolean(resumeCamera));
 $('playerNameInput').value='二代目';
 await $('nameForm').fire('submit');
 resumeCamera({getTracks:()=>[{stop(){}}]});
 await cameraAction;
 assert.equal($('nameDialog').open,false,'successor confirmation closes the dialog');
 assert.equal($('savePlayerName').disabled,false,'button remains usable');
 const next=await getProfile(db);
 assert.equal(next.name,'二代目');
 assert.equal(next.awaitingHeir,false);
 assert.equal(next.permadeath,true,'the heir is always permadeath');
 assert.equal(next.level,1);
 assert.equal(next.magicStones,4);
 assert.equal(next.legacies.length,1);
 assert.equal(next.legacies[0].circles[0].image.size,legacyPhoto.size,'naming never damages inherited original photo');
 assert.equal(factory.databases.get('magia-dungeon-v1').get('settings').get('profile').name,'','name confirmation must not rewrite the legacy photo-bearing record');
 assert.match($('playerStats').innerHTML,/二代目/);
 // Renaming a living character can be an ordinary profile write on browsers
 // that permit photo-bearing records; check the overlay is folded into it.
 factory.failProfileBlobWrites=false;
 await env.document.click({dataset:{action:'rename'},closest(){return this;}});
 assert.equal($('permadeathChoice').hidden,true,'renaming never exposes mode selection');
 $('playerNameInput').value='三代目';
 await $('nameForm').fire('submit');
 assert.equal((await getProfile(db)).name,'三代目');
 assert.equal((await getProfile(db)).permadeath,true);
 assert.equal(factory.databases.get('magia-dungeon-v1').get('settings').has('heirNameOverride'),false,
  'normal profile write absorbs and removes the temporary heir name');
 console.log('PASS successor name confirmation without nested photo rewrites');
}finally{env.restore();}
