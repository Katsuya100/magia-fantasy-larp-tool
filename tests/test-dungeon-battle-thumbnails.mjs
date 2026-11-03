import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
const oldRandom=Math.random;Math.random=()=>.01;
const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const button=dataset=>({dataset,disabled:false,closest(){return this;}});
const photoIds=markup=>[...markup.matchAll(/<img alt=""[^>]*data-circle-photo-id="([^"]+)"/g)].map(m=>m[1]);
const wait=async(predicate,label)=>{const limit=Date.now()+9000;while(Date.now()<limit){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timeout: '+label);};
try{
 const db=await openStore(env.factory);
 // The app initializes balancing tables on load, so seed an explicit profile
 // before importing it rather than calling getProfile() before configuration.
 const profile={name:'写真の魔導士',level:1,xp:0,base:{hp:100,mag:30,def:15,res:15},
  returns:0,attempts:0,inventory:[],collection:{},highest:0,run:null,slots:['a','b','c',null,null]};
 await saveProfile(db,profile);
 const photos=['a','b','c'].map((id,i)=>({id,registeredAt:i+1,image:new Blob([id],{type:'image/jpeg'}),analysis:{attribute:'flame',role:'attack',power:5000},revealed:false}));
 for(const photo of photos)await putCircle(db,photo);
 // Mimic actual image elements: the app owns delegated load/error handling.
 const mockPhoto=(id,alt,original)=>({
  dataset:{circlePhotoId:id,circlePhotoOriginal:original?'true':'false'},
  alt,src:'blob:existing-'+id,isConnected:true,
  getAttribute(name){return name==='src'?this.src:null;}
 });
 const labeled=mockPhoto('a','魔法陣',true);
 const decorative=mockPhoto('b','',true);
 const fallback=mockPhoto('c','魔法陣',true);
 $('prepare').querySelectorAll=selector=>selector==='img[data-circle-photo-id]'?[labeled,decorative,fallback]:[];
 await import('../assets/js/dungeon-app.mjs?integration=stable-photo-urls');
 await wait(()=>$('playerStats').innerHTML.includes('写真の魔導士'),'page startup');
 for(const [img,expected] of [[labeled,'魔法陣'],[decorative,'']]){
  doc.emit('error',img);
  assert.equal(img.alt,'縮小画像を表示できません。','failed original gets error text');
  img.src='blob:restored-'+img.dataset.circlePhotoId;
  doc.emit('load',img);
  assert.equal(img.alt,expected,'success restores the exact authored alt (including empty)');
 }
 // First an original fails, then its thumbnail is replaced by a valid original.
 doc.emit('error',fallback);
 assert.equal(fallback.alt,'縮小画像を表示できません。');
 fallback.dataset.circlePhotoOriginal='false';
 fallback.src='blob:broken-thumb';
 doc.emit('error',fallback);
 assert.match(fallback.src,/^blob:mock-/,'thumbnail decode failure falls back to the original photo');
 assert.equal(fallback.dataset.circlePhotoOriginal,'true');
 doc.emit('load',fallback);
 assert.equal(fallback.alt,'魔法陣','successful fallback clears stale error text');
 // The independent detail-photo recovery must still retry a fresh object URL.
 await doc.click(button({circleDetail:'a'}));
 const details=$('magicDetailsImage'),firstUrl=details.src;
 assert.equal($('magicDetailsDialog').open,true);
 doc.emit('error',details);
 assert.equal(details.dataset.photoRetried,'true');
 assert.notEqual(details.src,firstUrl,'details retry a fresh original URL');
 doc.emit('load',details);
 assert.equal($('repairSelectedCircleImage').hidden,true,'detail photo load clears the repair prompt');
 $('magicDetailsDialog').close();
 assert.equal(($('slotCards').innerHTML.match(/<img alt=""/g)||[]).length,3);
 await $('startAttack').fire('click');
 assert.equal($('battle').hidden,false);
 const battleBefore=$('battleSpells').innerHTML,idsBefore=photoIds(battleBefore);
 assert.deepEqual(idsBefore,['a','b','c'],'only equipped circles have deferred thumbnail targets');
 assert.doesNotMatch(battleBefore,/src="blob:mock-/,'battle never allocates original URLs eagerly');
 assert.equal((battleBefore.match(/data-cast="\d"/g)||[]).length,3,'only equipped spell slots are cast controls');
 assert.equal((battleBefore.match(/class="loadout-tile battle-tile battle-spell-tile empty"/g)||[]).length,2,'04/05 use empty tile state');
 assert.equal((battleBefore.match(/>未装備<\/span>/g)||[]).length,2,'04/05 visibly say not equipped');
 assert.doesNotMatch(battleBefore,/tile-empty-icon"[^>]*>◎/,'empty slots have no missing-glyph icon');
 assert.equal(env.revokedImageUrls.length,0,'first render leaves source URLs alive');
 for(let round=0;round<3;round++){
  await doc.click(button({cast:'0'}));
  await wait(async()=>{const p=await getProfile(db);return p.run?.floor===round+2;},'round '+(round+1));
  const current=$('battleSpells').innerHTML;
  assert.deepEqual(photoIds(current),idsBefore,'all equipped circle thumbnail targets survive round '+(round+1));
  assert.equal(env.revokedImageUrls.length,0,'casting never revokes active thumbnails');
  assert.equal((current.match(/>未装備<\/span>/g)||[]).length,2,'empty slots remain correct after redrawing');
 }
 assert.equal(new Set(idsBefore).size,3,'each saved photograph keeps its distinct identity');
 console.log('PASS 3 equipped/2 empty battle slots and deferred photos during repeated casts');
}finally{Math.random=oldRandom;env.restore();}
