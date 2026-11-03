import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,putCircle,saveProfile,readDungeonSnapshot} from '../assets/js/dungeon-store.mjs';

const oldRandom=Math.random;Math.random=()=>.01;
const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const button=dataset=>({dataset,disabled:false,closest(){return this;}});
const until=async(check,label)=>{
 const deadline=Date.now()+9000;
 while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}
 throw Error('Timeout: '+label);
};
try{
 const db=await openStore(env.factory);
 const base={name:'写真の魔導士',level:1,xp:0,base:{hp:100,mag:30,def:15,res:15},
  returns:0,attempts:0,inventory:[],collection:{},highest:0,run:null,slots:['a','b','c',null,null]};
 await saveProfile(db,base);
 for(const [i,id] of ['a','b','c'].entries())await putCircle(db,{
  id,registeredAt:i+1,image:new Blob([id],{type:'image/jpeg'}),
  analysis:{attribute:'flame',role:'attack',power:5000},revealed:false
 });
 // The real app uses capture-phase load/error listeners on document.
 const image=(id,alt)=>({
  dataset:{circlePhotoId:id,circlePhotoOriginal:'true'},alt,
  src:'blob:original-'+id,isConnected:true,
  getAttribute(name){return name==='src'?this.src:null;}
 });
 const labeled=image('a','魔法陣'),decorative=image('b',''),fallback=image('c','魔法陣');
 $('prepare').querySelectorAll=selector=>selector==='img[data-circle-photo-id]'
  ?[labeled,decorative,fallback]:[];
 await import('../assets/js/dungeon-app.mjs?integration=photo-alt');
 await until(()=>$('playerStats').innerHTML.includes('写真の魔導士'),'page startup');
 assert.equal($('prepare').hidden,false);

 // Errors are announced; a subsequent successful image load restores its exact alt.
 for(const [img,original] of [[labeled,'魔法陣'],[decorative,'']]){
  doc.emit('error',img);
  assert.equal(img.alt,'縮小画像を表示できません。','failed original shows fallback text');
  img.src='blob:restored-'+img.dataset.circlePhotoId;
  doc.emit('load',img);
  assert.equal(img.alt,original,'success restores authored alt, including decorative empty text');
  assert.equal(img.dataset.originalCircleAlt,undefined,'temporary DOM alt is released');
 }
 // A failed original may later be retried as a thumbnail and recover through
 // the existing thumbnail -> original URL fallback without changing saved photos.
 doc.emit('error',fallback);
 assert.equal(fallback.alt,'縮小画像を表示できません。');
 fallback.dataset.circlePhotoOriginal='false';
 fallback.src='blob:bad-thumbnail';
 doc.emit('error',fallback);
 assert.match(fallback.src,/^blob:mock-/,'decoded thumbnail is replaced with original URL');
 assert.equal(fallback.dataset.circlePhotoOriginal,'true');
 doc.emit('load',fallback);
 assert.equal(fallback.alt,'魔法陣','fallback load restores the proper alt');

 // This feature must not intercept the pre-existing detail-photo retry.
 await doc.click(button({circleDetail:'a'}));
 const details=$('magicDetailsImage'),initialSrc=details.src;
 assert.equal($('magicDetailsDialog').open,true);
 doc.emit('error',details);
 assert.equal(details.dataset.photoRetried,'true','detail performs its single fresh URL retry');
 assert.notEqual(details.src,initialSrc);
 doc.emit('load',details);
 assert.equal($('repairSelectedCircleImage').hidden,true);
 $('magicDetailsDialog').close();
 const snapshot=await readDungeonSnapshot(db);
 assert.equal(snapshot.circles.length,3);
 assert.equal(snapshot.circles[0].image instanceof Blob,true,'photo data remains in IndexedDB');
 console.log('PASS original/decorative alt restoration, thumbnail fallback and detail-photo recovery');
}finally{Math.random=oldRandom;env.restore();}
