import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,putCircle,saveProfile,allCircles,readDungeonSnapshot} from '../assets/js/dungeon-store.mjs';
import {verifyLocalSnapshot} from '../assets/js/dungeon-cloud-integrity.mjs';
import {serializeDungeonSnapshot,deserializeDungeonSnapshot} from '../assets/js/dungeon-cloud-snapshot.mjs';

const env=fakeDungeonBrowser(),$=id=>env.document.getElementById(id);
const photo=new Blob([Uint8Array.from([255,216,255,217])],{type:'image/jpeg'});
const relic={id:'family-relic',image:photo,registeredAt:1,
 analysis:{attribute:'flame',role:'attack',power:120},revealed:true,basePower:120,
 legacyHp:36,legacyOriginName:'<初代>',legacyHeirNames:['二代目','三代目']};
const normal={id:'new-circle',image:photo,registeredAt:2,
 analysis:{attribute:'aqua',role:'support',power:120},revealed:true,basePower:120};
const wait=async predicate=>{
 for(let i=0;i<240;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw Error('Timed out loading relic details');
};
try{
 const db=await openStore(env.factory);
 await putCircle(db,relic);await putCircle(db,normal);
 await saveProfile(db,{name:'四代目',level:1,xp:0,base:{hp:100,mag:10,def:8,res:8},
 returns:1,attempts:1,tutorialDone:true,inventory:[],obtainedItemIds:[],
 collection:{},defeatedBosses:{},adventurerRank:0,deepestReturnedLayer:1,magicStones:0,
 slots:[relic.id,normal.id,null,null,null],permadeath:true,legacies:[],run:null});
 await import('../assets/js/dungeon-app.mjs?integration=relic-provenance');
 await wait(()=>$('libraryCards').innerHTML.includes(relic.id));
 const button=id=>({dataset:{circleDetail:id},closest(){return this;}});
 await env.document.click(button(relic.id));
 assert.equal($('magicDetailsLegacyTitle').textContent,'<初代>の残した遺物');
 assert.equal($('magicDetailsLegacyTitle').hidden,false,'title appears for relic');
 const html=$('magicDetailsStats').innerHTML;
 assert.ok(html.indexOf('過去の継承者達')>html.indexOf('🔵🔥 継承'),'heirs appear after the inheritance bonus');
 assert.ok(html.indexOf('二代目')<html.indexOf('三代目'),'heirs remain chronological');
 assert.match(html,/<span class="legacy-heir-name">二代目<\/span>/);
 assert.match(html,/<span class="legacy-heir-name">三代目<\/span>/);
 assert.equal((await allCircles(db)).find(c=>c.id===relic.id).legacyOriginName,'<初代>');
 const snapshot=await readDungeonSnapshot(db);
 assert.equal((await verifyLocalSnapshot(snapshot)).status,'valid');
 const backup=deserializeDungeonSnapshot(await serializeDungeonSnapshot(snapshot));
 assert.deepEqual(backup.circles.find(c=>c.id===relic.id).legacyHeirNames,['二代目','三代目'],'cloud backup includes all names');
 await env.document.click(button(normal.id));
 assert.equal($('magicDetailsLegacyTitle').hidden,true,'normal spell has no relic inscription');
 assert.doesNotMatch($('magicDetailsStats').innerHTML,/過去の継承者達/,'normal spell has no inherited names');
 console.log('PASS relic first owner, nameplates, history after inheritance, backup and normal spell');
}finally{env.restore();}
