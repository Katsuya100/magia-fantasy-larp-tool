import assert from 'node:assert/strict';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,saveProfile,putCircle,getProfile,allCircles} from '../assets/js/dungeon-store.mjs';
const env=fakeDungeonBrowser(),$=id=>env.document.getElementById(id);
const button=dataset=>({disabled:false,dataset,closest(){return this;}});
const wait=async test=>{const end=Date.now()+5000;while(Date.now()<end){if(await test())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('timeout');};
try{
 const db=await openStore(env.factory);
 await saveProfile(db,{
  name:'魔術師',level:1,xp:0,base:{hp:100,mag:10,def:7,res:7},returns:0,attempts:0,
  inventory:[],collection:{},magicStones:2,deepestReturnedLayer:0,slots:[],run:null
 });
 await putCircle(db,{id:'circle-1',image:new Blob(['circle']),analysis:{attribute:'flame',role:'attack',power:100},revealed:true});
 await import('../assets/js/dungeon-app.mjs?integration=upgrade');
 await wait(()=>$('libraryCards').innerHTML.includes('circle-1'));
 assert.match($('magicStoneBalance').textContent,/2個/);
 await env.document.click(button({view:'library'}));
 await env.document.click(button({upgrade:'circle-1'}));
 assert.equal($('circleActionDialog').open,true,'upgrade requires a dialog');
 assert.match($('circleActionMessage').textContent,/10%/);
 await $('cancelCircleAction').fire('click');
 assert.equal((await getProfile(db)).magicStones,2,'cancel leaves stones untouched');
 assert.equal((await allCircles(db))[0].analysis.power,100,'cancel leaves power untouched');
 await env.document.click(button({upgrade:'circle-1'}));
 await $('confirmCircleAction').fire('click');
 assert.equal($('circleActionDialog').open,false);
 let saved=(await allCircles(db))[0];
 assert.equal(saved.analysis.power,110,'first stone boosts by 10% of initial 100');
 assert.equal(saved.upgradeLevel,1);
 assert.equal((await getProfile(db)).magicStones,1);
 assert.equal($('magicDetailsDialog').open,true,'enhancement opens full circle feedback');
 assert.equal($('magicDetailsDialog').dataset.enhancing,'true','ritual begins');
 assert.match($('upgradeFeedback').textContent,/強化成功/);
 await $('closeMagicDetails').fire('click');
 await env.document.click(button({upgrade:'circle-1'}));
 await $('confirmCircleAction').fire('click');
 saved=(await allCircles(db))[0];
 assert.equal(saved.analysis.power,120,'repeated upgrades do not compound');
 assert.equal(saved.basePower,100);
 assert.equal((await getProfile(db)).magicStones,0);
 assert.match($('magicStoneBalance').textContent,/0個/);
 await env.document.click(button({upgrade:'circle-1'}));
 assert.equal($('circleActionDialog').open,false,'no stones means no upgrade');
 await env.document.click(button({remove:'circle-1'}));
 assert.equal($('circleActionDialog').open,true,'deletion requires a dialog');
 await $('cancelCircleAction').fire('click');
 assert.equal((await allCircles(db)).length,1,'cancelling deletion preserves photo');
 await env.document.click(button({remove:'circle-1'}));
 await $('confirmCircleAction').fire('click');
 assert.equal((await allCircles(db)).length,0,'confirmed deletion removes photo');
 assert.equal($('circleActionDialog').open,false);
 console.log('PASS confirmed magic-stone upgrades, persisted balance, animation and confirmed deletion');
}finally{env.restore();}
