import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,saveProfile,getProfile,readDungeonSnapshot,allCircles} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot,digestPhoto} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';

const image=new Blob([Uint8Array.from([255,216,255,224,1,2,3,4,255,217])],{type:'image/jpeg'});
const circle={id:'fallen-relic-circle',image,analysis:{attribute:'flame',role:'attack',power:120},revealed:true,registeredAt:1,basePower:120};
const legacy={name:'先代',level:12,enemyId:'enemy_1',circles:[circle],items:[],loot:[],rank:0};
const factory=fakeIndexedDB();
const db=await openStore(factory);
await saveProfile(db,{name:'後継者',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},returns:0,attempts:1,tutorialDone:true,
 inventory:[],obtainedItemIds:[],collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:0,
 magicStones:0,slots:[null,null,null,null,null],permadeath:true,awaitingHeir:false,legacies:[],
 run:{stage:'checkpoint',floor:5,carry:[],loot:[{type:'legacy',legacy}],xp:0,bonusClaimed:true,hero:{level:1}}});
const wait=async pred=>{for(let i=0;i<200;i++){if(await pred())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('legacy image test timed out');};
let env=fakeDungeonBrowser({factory});
try{
 const $=id=>env.document.getElementById(id);
 await import('../assets/js/dungeon-app.mjs?integration=legacy-relic-return');
 await wait(()=>$('checkpoint').hidden===false);
 await $('returnHome').fire('click');
 await wait(async()=>(await allCircles(db)).some(c=>c.id===circle.id));
 const after=await allCircles(db);
 assert.equal(after.length,1);
 assert.ok(after[0].image instanceof Blob,'recovered relic must remain a real Blob');
 assert.equal(after[0].image.type,'image/jpeg');
 assert.equal(await digestPhoto(after[0].image),await digestPhoto(image),'original photo bytes survive return');
 assert.equal(after[0].legacyHp,12,'one level 12 owner contributes 12 HP');
 assert.equal((await getProfile(db)).run,null);
 assert.equal((await verifyLocalSnapshot(await readDungeonSnapshot(db))).status,'valid','relic save stays authenticated');
 const exported=await serializeDungeonSnapshot(await readDungeonSnapshot(db));
 const backup=deserializeDungeonSnapshot(exported);
 assert.equal(await digestPhoto(backup.circles[0].image),await digestPhoto(image),'cloud backup preserves relic photo bytes');
}finally{env.restore();}
env=fakeDungeonBrowser({factory});
try{
 const $=id=>env.document.getElementById(id);
 await import('../assets/js/dungeon-app.mjs?integration=legacy-relic-reload');
 await wait(()=>$('libraryCards').innerHTML.includes('fallen-relic-circle'));
 assert.match($('libraryCards').innerHTML,/data-circle-photo-id="fallen-relic-circle"/,'saved relic is listed without eagerly decoding its original');
 assert.doesNotMatch($('libraryCards').innerHTML,/src="blob:mock-/,'grimoire does not eagerly load the original');
 await env.document.click({dataset:{circleDetail:circle.id},closest(){return this;}});
 assert.equal($('magicDetailsLegacyTitle').hidden,false,'recovered relic shows the inscription');
 assert.match($('magicDetailsImage').src,/^blob:mock-/,'detail lazily displays the intact original');
 assert.equal($('magicDetailsLegacyTitle').textContent,'先代の残した遺物','earliest character name is recovered from older legacy records');
 assert.match($('magicDetailsStats').innerHTML,/<dt>🔵🔥 継承<\/dt><dd>敵の最大HP-12（合計Lv.12）<\/dd>/,'attack uses level sum');
 assert.doesNotMatch($('magicDetailsStats').innerHTML,/自分の最大HP\+/,'attack must never list defensive inheritance');
 assert.match($('magicDetailsStats').innerHTML,/<dt class="legacy-heirs-label">過去の継承者達<\/dt>/);
 assert.match($('magicDetailsStats').innerHTML,/先代 Lv.12/,'details show contributor and level');
 assert.equal((await allCircles(db))[0].image.size,image.size);
}finally{env.restore();}
// The recovered original Blob is displayed directly; no derived cache is required.
assert.equal((await allCircles(db))[0].image.size,image.size);
console.log('PASS PR140: relic photo persisted/read back, reload, cloud snapshot, original Blob display without thumbnail caching');
