import assert from 'node:assert/strict';
import {isDungeonNameBlocked} from '../assets/js/dungeon-name-filter.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile} from '../assets/js/dungeon-store.mjs';

assert.equal(isDungeonNameBlocked('星渡り'),false);
assert.equal(isDungeonNameBlocked('暁の旅人'),false);
assert.equal(isDungeonNameBlocked('カスミ'),false,'short substrings must not reject ordinary names');
assert.equal(isDungeonNameBlocked('アホ毛'),false);
assert.equal(isDungeonNameBlocked('バカ'),true);
assert.equal(isDungeonNameBlocked('ﾊﾞ ・ ｶ'),true,'width/spacing/punctuation bypass');
assert.equal(isDungeonNameBlocked('異界のキチガイ'),true,'distinctive long slurs in names');
assert.equal(isDungeonNameBlocked('妖精のレイプ'),true);
assert.equal(isDungeonNameBlocked('シ・ネ！'),true,'short threats inside names');

const wait=async(predicate,message)=>{
  const end=Date.now()+9000;
  while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
  throw Error('UI timeout: '+message);
};
const fresh=fakeDungeonBrowser(),$=id=>fresh.document.getElementById(id);
try {
  await import('../assets/js/dungeon-app.mjs?integration=ng-name-initial');
  await wait(()=>$('backupSetupDialog').open,'backup setup');
  await $('setupWithoutBackup').fire('click');
  assert.equal($('nameDialog').open,true);
  $('playerNameInput').value='異界のキチガイ';
  await $('nameForm').fire('submit');
  assert.match($('nameError').textContent,/使用できません/);
  assert.equal($('nameDialog').open,true);
  assert.equal($('savePlayerName').disabled,false);
  assert.equal((await getProfile(await openStore(fresh.factory))).name||'','','blocked initial name must not persist');
  $('playerNameInput').value='星渡り';
  await $('nameForm').fire('submit');
  assert.equal($('nameDialog').open,false);
  assert.equal((await getProfile(await openStore(fresh.factory))).name,'星渡り');
  await fresh.document.click({dataset:{action:'rename'},closest(){return this;}});
  $('playerNameInput').value='シ・ネ';
  await $('nameForm').fire('submit');
  assert.equal($('nameDialog').open,true);
  assert.equal((await getProfile(await openStore(fresh.factory))).name,'星渡り','rejected rename must not overwrite save');
  $('playerNameInput').value='暁の旅人';
  await $('nameForm').fire('submit');
  assert.equal((await getProfile(await openStore(fresh.factory))).name,'暁の旅人');
} finally {fresh.restore();}

const factory=fakeIndexedDB(),db=await openStore(factory);
const photo=new Blob([Uint8Array.from([255,216,255,217])],{type:'image/jpeg'});
await saveProfile(db,{
  name:'',level:1,xp:0,base:{hp:100,mag:10,def:7,res:7},returns:0,attempts:0,
  tutorialDone:true,inventory:[],obtainedItemIds:[],collection:{},
  defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,
  legacies:[{name:'先代',level:8,enemyId:'test_enemy',circles:[
    {id:'previous-circle',image:photo,legacyOriginName:'先代',analysis:{attribute:'flame',role:'attack',power:120}}
  ],items:[],loot:[]}],
  run:null,permadeath:true,awaitingHeir:true
});
const heir=fakeDungeonBrowser({factory}),get=id=>heir.document.getElementById(id);
try {
  await import('../assets/js/dungeon-app.mjs?integration=ng-name-heir');
  await wait(()=>get('nameDialog').open,'heir dialog');
  get('playerNameInput').value='バカ';
  await get('nameForm').fire('submit');
  assert.match(get('nameError').textContent,/使用できません/);
  assert.equal(get('nameDialog').open,true);
  let current=await getProfile(db);
  assert.equal(current.name,'');
  assert.equal(current.awaitingHeir,true);
  assert.equal(current.legacies[0].circles[0].image.size,photo.size);
  get('playerNameInput').value='二代目';
  await get('nameForm').fire('submit');
  current=await getProfile(db);
  assert.equal(current.name,'二代目');
  assert.equal(current.awaitingHeir,false);
  assert.equal(current.legacies[0].circles[0].image.size,photo.size);
} finally {heir.restore();}
console.log('PASS dungeon NG word matching and initial/rename/heir save isolation');
