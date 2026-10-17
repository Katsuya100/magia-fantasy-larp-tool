import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
const oldRandom=Math.random;Math.random=()=>.01;
const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const button=dataset=>({dataset,disabled:false,closest(){return this;}});
const imageUrls=markup=>[...markup.matchAll(/<img alt="" src="(blob:mock-\d+)"/g)].map(m=>m[1]);
const wait=async(predicate,label)=>{const limit=Date.now()+9000;while(Date.now()<limit){if(await predicate())return;}throw Error('Timeout: '+label);};
try{
 const db=await openStore(env.factory);
 // The app initializes balancing tables on load, so seed an explicit profile
 // before importing it rather than calling getProfile() before configuration.
 const profile={name:'写真の魔導士',level:1,xp:0,base:{hp:100,mag:30,def:15,res:15},
  returns:0,attempts:0,inventory:[],collection:{},highest:0,run:null,slots:['a','b','c',null,null]};
 await saveProfile(db,profile);
 const photos=['a','b','c'].map((id,i)=>({id,registeredAt:i+1,image:new Blob([id],{type:'image/jpeg'}),analysis:{attribute:'flame',role:'attack',power:5000},revealed:false}));
 for(const photo of photos)await putCircle(db,photo);
 await import('../assets/js/dungeon-app.mjs?integration=stable-photo-urls');
 await wait(()=>$('playerStats').innerHTML.includes('写真の魔導士'),'page startup');
 assert.equal(($('slotCards').innerHTML.match(/<img alt=""/g)||[]).length,3);
 await $('startAttack').fire('click');
 assert.equal($('battle').hidden,false);
 const battleBefore=$('battleSpells').innerHTML,urlsBefore=imageUrls(battleBefore);
 assert.equal(urlsBefore.length,3,'only three equipped circles have thumbnails');
 assert.equal((battleBefore.match(/data-cast="\d"/g)||[]).length,3,'only equipped spell slots are cast controls');
 assert.equal((battleBefore.match(/class="loadout-tile battle-tile battle-spell-tile empty"/g)||[]).length,2,'04/05 use empty tile state');
 assert.equal((battleBefore.match(/>未装備<\/span>/g)||[]).length,2,'04/05 visibly say not equipped');
 assert.doesNotMatch(battleBefore,/tile-empty-icon"[^>]*>◎/,'empty slots have no missing-glyph icon');
 assert.equal(env.revokedImageUrls.length,0,'first render leaves source URLs alive');
 for(let round=0;round<3;round++){
  await doc.click(button({cast:'0'}));
  await wait(async()=>{const p=await getProfile(db);return p.run?.floor===round+2;},'round '+(round+1));
  const current=$('battleSpells').innerHTML;
  assert.deepEqual(imageUrls(current),urlsBefore,'all thumbnails keep identical non-revoked URLs after round '+(round+1));
  assert.equal(env.revokedImageUrls.length,0,'casting never revokes active thumbnails');
  assert.equal((current.match(/>未装備<\/span>/g)||[]).length,2,'empty slots remain correct after redrawing');
 }
 assert.equal(new Set(urlsBefore).size,3,'each saved photograph has its own source');
 console.log('PASS 3 equipped/2 empty battle slots, repeated casts and permanent valid thumbnail URLs');
}finally{Math.random=oldRandom;env.restore();}
