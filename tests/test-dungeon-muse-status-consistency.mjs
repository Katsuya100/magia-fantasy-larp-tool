import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,putCircle,saveProfile} from '../assets/js/dungeon-store.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {effectCaption} from '../assets/js/dungeon-combat-fx.mjs';

const csv=async key=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+key+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,collections,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','enemies','collections','buffs'].map(csv));
configure({balance,levels,floors,playerBase});

// An actual support cast must announce its observed HP delta, regardless of
// the spell's nominal power or the target's later turn phases.
const healing=G.makeUnit({hp:100,mag:10,def:8,res:8},102,{},[
 {role:'support',attribute:'aqua',power:701}
]);
const healingFoe=G.makeUnit({hp:100,mag:8,def:8,res:8},70,{},[
 {role:'basic',attribute:'law',power:0}
]);
healing.hp-=500;
const priorHeal=healing.hp,steps=[];
const messages=G.round(healing,healingFoe,0,-1,buffs,()=>.99,e=>steps.push(e));
const healStep=steps.find(s=>s.side==='hero'&&s.role==='support');
assert.ok(healStep&&healStep.amount>0,'healing action produces positive observed delta');
assert.equal(Number(messages[0].match(/HP (\d+)回復/)?.[1]),healStep.amount,'the logged HP recovery is the actual HP delta');
assert.match(effectCaption(healStep),new RegExp('\\+'+healStep.amount+'$'),'FX shows actual healed amount, not nominal strength');

// Older saved statuses can retain their debuff ID without a `kind` field.
// The badge renderer already recognizes that ID; item availability must agree.
const oldBurn=G.makeUnit({hp:100,mag:10,def:8,res:8},50);
oldBurn.statuses=[{id:'debuff_flame',attribute:'flame',effect:'burn',value:.1,turns:2}];
const consumables=await csv('consumables');
assert.equal(G.canUseBattleItem(oldBurn,{type:'use',id:'clear_flame',value:0},consumables,buffs),true,
 'flame cleanser works for a visible legacy burn with missing kind');
G.potion(oldBurn,{type:'use',id:'clear_flame',value:0},consumables,buffs);
assert.equal(oldBurn.statuses.length,0,'using the cleanser actually removes the visible legacy burn');

const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const wait=async(predicate,label)=>{
 const end=Date.now()+9000;
 while(!(await predicate())&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
 assert.ok(await predicate(),label);
};
const button=dataset=>({dataset,disabled:false,closest(){return this;}});
try{
 const db=await openStore(env.factory),profile=await getProfile(db);
 const spell={role:'attack',attribute:'flame',power:150};
 const circle={id:'muse-expiring-burn',image:new Blob(['spell'],{type:'image/jpeg'}),analysis:spell,registeredAt:1,revealed:true};
 profile.name='50層浄化検証';profile.level=102;profile.returns=1;
 profile.slots=[circle.id,null,null,null,null];
 profile.collection=Object.fromEntries(collections.slice(0,220).map(x=>[x.id,1]));
 const hero=G.makeUnit(profile.base,102,{},[spell,null,null,null,null],'player');
 hero.statuses=[{id:'debuff_flame',kind:'debuff',attribute:'flame',effect:'burn',value:.03,turns:1}];
 // An expiring burn cannot be tested against a foe that may reapply flame debuff.
 const enemy=G.fromEnemy(enemies.find(row=>row.id==='foe_l042_2'),80);
 assert.ok(enemy.spells.every(s=>s?.role!=='debuff'||s.attribute!=='flame'),'the test enemy cannot renew the expiring burn');
 profile.run={floor:207,slotIds:[circle.id,null,null,null,null],hero,enemy,enemyName:enemy.name,
  carry:[{type:'use',id:'clear_flame',value:0},null,null,null,null,null],loot:[],xp:0,log:[],stage:'battle'};
 await saveProfile(db,profile);
 await putCircle(db,circle);
 await import('../assets/js/dungeon-app.mjs?integration=muse-expiring-status');
 await wait(()=>$('battle').hidden===false,'active 42F battle rendered');
 assert.match($('collectionProgress').innerHTML,/220 \/ 300/,'discovery summary is computed from all 220 saved types');
 assert.equal(($('collectionGrid').innerHTML.match(/class="relic-card discovered"/g)||[]).length,220,
  'collection summary and discovered cards are one consistent saved set');
 assert.match($('heroStats').innerHTML,/status-debuff/,'burn is initially visible');
 assert.doesNotMatch($('battleItems').innerHTML,/no-effect/,'the matching cleanser is available before the burn expires');
 const ongoing=doc.click(button({cast:'0'}));
 await Promise.resolve();
 assert.match($('battleItems').innerHTML,/no-effect/,'spent final burn cannot be cleansed');
 assert.doesNotMatch($('heroStats').innerHTML,/status-debuff/,
  'a finished debuff must not still be shown while the matching cleanser is disabled');
 await ongoing;
 assert.doesNotMatch($('heroStats').innerHTML,/status-debuff/,'expired burn stays absent after combat animation');
 console.log('PASS Muse healing delta, discovery count and debuff/item status synchronization');
}finally{env.restore();}
