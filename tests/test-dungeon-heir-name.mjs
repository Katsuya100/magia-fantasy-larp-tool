import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';
const factory=fakeIndexedDB();
const db=await openStore(factory);
await saveProfile(db,{
 name:'',level:1,xp:0,base:{hp:100,mag:10,def:7,res:7},returns:0,attempts:0,
 tutorialDone:true,inventory:[],obtainedItemIds:[],collection:{},
 defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,magicStones:4,
 legacies:[{name:'先代',level:8,enemyId:'test_enemy',circles:[],items:[],loot:[]}],
 run:null,permadeath:true,awaitingHeir:true
});
const env=fakeDungeonBrowser({factory}),$=id=>env.document.getElementById(id);
const wait=async predicate=>{for(let i=0;i<250;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out opening the successor name form');};
try{
 await import('../assets/js/dungeon-app.mjs?integration=heir-name');
 await wait(()=>$('nameDialog').open);
 assert.equal($('backupSetupDialog').open,false,'a successor must not repeat initial backup setup');
 assert.equal($('permadeathChoice').hidden,true,'no mode selector in the successor dialog');
 assert.equal($('permadeathInput').value,'permadeath');
 assert.equal($('savePlayerName').disabled,false);
 $('playerNameInput').value='二代目';
 await $('nameForm').fire('submit');
 assert.equal($('nameDialog').open,false,'successor confirmation closes the dialog');
 assert.equal($('savePlayerName').disabled,false,'button remains usable');
 const next=await getProfile(db);
 assert.equal(next.name,'二代目');
 assert.equal(next.awaitingHeir,false);
 assert.equal(next.permadeath,true,'the heir is always permadeath');
 assert.equal(next.level,1);
 assert.equal(next.magicStones,4);
 assert.equal(next.legacies.length,1);
 assert.match($('playerStats').innerHTML,/二代目/);
 await env.document.click({dataset:{action:'rename'},closest(){return this;}});
 assert.equal($('permadeathChoice').hidden,true,'renaming never exposes mode selection');
 $('playerNameInput').value='三代目';
 await $('nameForm').fire('submit');
 assert.equal((await getProfile(db)).name,'三代目');
 assert.equal((await getProfile(db)).permadeath,true);
 console.log('PASS successor name confirmation and persisted permadeath');
}finally{env.restore();}
