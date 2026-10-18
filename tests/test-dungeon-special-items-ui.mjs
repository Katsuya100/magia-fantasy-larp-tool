import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {fakeIndexedDB} from './helpers/fake-indexeddb.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies]=await Promise.all(['balance','levels','floors','player-base','enemies'].map(csv));
configure({balance,levels,floors,playerBase});
const wait=async(check,description)=>{const end=Date.now()+9000;while(!(await check())&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.ok(await check(),description);};
const btn=data=>({dataset:data,disabled:false,closest(){return this;}});
const attack={role:'attack',attribute:'flame',power:5000};
const ready=async(factory,label)=>{const db=await openStore(factory),profile=await getProfile(db);profile.name=label;profile.returns=1;profile.slots=['c1','c2','c3',null,null];for(let i=1;i<=3;i++)await putCircle(db,{id:'c'+i,image:new Blob(['photo-'+i]),analysis:attack,revealed:true});return {db,profile};};
const originalRandom=Math.random;Math.random=()=>.5;
try{
 // 1. All library/collection filter values and both distinct picker contexts survive navigation.
 const f1=fakeIndexedDB(),{db:db1,profile:p1}=await ready(f1,'フィルター確認');
 p1.inventory=[
 {type:'use',id:'elixir_l',value:100},
 {type:'use',id:'life_ruby',value:0},
 {type:'use',id:'elixir_s',value:35},
 {type:'use',id:'heal_s',value:45},
 {type:'use',id:'mana_s',value:22}
 ];
 await saveProfile(db1,p1);
 const env=fakeDungeonBrowser({factory:f1}),doc=env.document,$=id=>doc.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=special-filter-session');
  await wait(()=>$('gearCards').innerHTML.includes('elixir')||$('gearCards').innerHTML.includes('携行品'),'preparation ready');
  $('libraryRoleFilter').value='support';await $('libraryRoleFilter').fire('change');
  $('libraryAttributeFilter').value='aqua';await $('libraryAttributeFilter').fire('change');
  $('librarySort').value='oldest';await $('librarySort').fire('change');
  $('collectionDiscoveryFilter').value='missing';await $('collectionDiscoveryFilter').fire('change');
  $('collectionRarityFilter').value='epic';await $('collectionRarityFilter').fire('change');
  $('collectionSort').value='name';await $('collectionSort').fire('change');
  await doc.click(btn({openSlot:'0'}));
  assert.equal($('loadoutDialog').open,true);
  $('pickerFilter').value='attack';await $('pickerFilter').fire('change');
  $('pickerSort').value='oldest';await $('pickerSort').fire('change');
  await $('closeLoadoutDialog').fire('click');
  await doc.click(btn({openItem:'0'}));
  assert.equal($('pickerFilter').value,'all','items have independent filter history');
  assert.equal($('pickerSort').value,'default');
  assert.match($('pickerFilter').innerHTML,/value="elixir"/);
  assert.match($('pickerFilter').innerHTML,/value="revive"/);
  assert.match($('pickerSort').innerHTML,/value="value-asc"/);
  assert.match($('pickerSort').innerHTML,/効果量が高い順/);
  assert.doesNotMatch($('pickerSort').innerHTML,/効果量が大きい順/);
  $('pickerFilter').value='elixir';await $('pickerFilter').fire('change');
  $('pickerSort').value='value-asc';await $('pickerSort').fire('change');
  assert.deepEqual([...$('loadoutOptions').innerHTML.matchAll(/data-choose-item="(\d+)"/g)].map(x=>Number(x[1])),[2,0],'ascending values sort only the elixirs');
  await $('closeLoadoutDialog').fire('click');
  await doc.click(btn({view:'home'}));await doc.click(btn({view:'library'}));
  for(const [id,expected] of [['libraryRoleFilter','support'],['libraryAttributeFilter','aqua'],['librarySort','oldest'],['collectionDiscoveryFilter','missing'],['collectionRarityFilter','epic'],['collectionSort','name']]){
   assert.equal($(id).value,expected,'session keeps filter '+id);
  }
  await doc.click(btn({view:'prepare'}));
  await doc.click(btn({openItem:'1'}));
  assert.equal($('pickerFilter').value,'elixir','item filter preserved after leaving and returning');
  assert.equal($('pickerSort').value,'value-asc','item sort preserved after leaving and returning');
  await $('closeLoadoutDialog').fire('click');
  await doc.click(btn({openSlot:'1'}));
  assert.equal($('pickerFilter').value,'attack','circle filter preserved independently');
  assert.equal($('pickerSort').value,'oldest','circle sort preserved independently');
  await $('closeLoadoutDialog').fire('click');
  await doc.click(btn({openItem:'0'}));
  $('pickerFilter').value='revive';await $('pickerFilter').fire('change');
  assert.deepEqual([...$('loadoutOptions').innerHTML.matchAll(/data-choose-item="(\d+)"/g)].map(x=>Number(x[1])),[1],'ruby filter selects only life ruby');
  assert.match($('loadoutOptions').innerHTML,/死亡時に1回だけHP50%で復活/);
  await $('closeLoadoutDialog').fire('click');
 }finally{env.restore();}

 // 2. A prepared elixir restores HP and MP at the same time, using saved values.
 const f2=fakeIndexedDB(),{db:db2,profile:p2}=await ready(f2,'エリクシール確認');
 const hero=G.makeUnit(p2.base,1,{},[attack,attack,attack,null,null],'player');
 hero.hp=1;hero.mp=1;
 const enemy=G.fromEnemy(enemies.find(x=>x.id==='foe_l001_1'),1);
 p2.run={floor:1,slotIds:p2.slots,hero,enemy,enemyName:enemy.id,
 carry:[{type:'use',id:'elixir_s',value:35,bonus:null},null,null,null,null],
 loot:[],xp:0,usedItems:0,log:[],stage:'battle'};
 await saveProfile(db2,p2);
 const env2=fakeDungeonBrowser({factory:f2}),doc2=env2.document,$2=id=>doc2.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=special-elixir-battle');
  await wait(()=>$2('battleItems').innerHTML.includes('エリクシール小'),'elixir battle ready');
  assert.match($2('battleItems').innerHTML,/❤️💠35%/,'elixir displays icon and percent rather than a sentence');
  assert.doesNotMatch($2('battleItems').innerHTML,/>HP\/MP各35%回復</,'long effect text is not visible');
  await doc2.click(btn({use:'0'}));
  const after=await getProfile(db2);
  assert.equal(after.run.hero.hp,1+Math.ceil(after.run.hero.stats.hp*.35));
  assert.equal(after.run.hero.mp,1+Math.ceil(after.run.hero.maxMp*.35));
  assert.equal(after.run.carry[0],null,'elixir is consumed');
  assert.equal(after.run.usedItems,1,'elixir respects the normal one-item-per-round limit');
 }finally{env2.restore();}

 // 3. Activating a ruby survives the first fatal hit, but not a second.
 const f3=fakeIndexedDB(),{db:db3,profile:p3}=await ready(f3,'生命の紅石確認');
 const savedHero=G.makeUnit(p3.base,1,{},[attack,attack,attack,null,null],'player');savedHero.hp=1;
 const foe=G.fromEnemy(enemies.find(x=>x.id==='foe_l001_1'),1);
 foe.hp=300;foe.stats.hp=300;foe.stats.mag=1000;foe.spells=[];foe.cooldowns=[];
 p3.run={floor:1,slotIds:p3.slots,hero:savedHero,enemy:foe,enemyName:foe.id,
 carry:[{type:'use',id:'life_ruby',value:0,bonus:null},{type:'use',id:'life_ruby',value:0,bonus:null},null,null,null],
 loot:[],xp:0,usedItems:0,log:[],stage:'battle'};
 await saveProfile(db3,p3);
 const env3=fakeDungeonBrowser({factory:f3}),doc3=env3.document,$3=id=>doc3.getElementById(id);
 try{
  await import('../assets/js/dungeon-app.mjs?integration=special-ruby-battle');
  await wait(()=>$3('battleItems').innerHTML.includes('生命の紅石'),'life ruby ready');
   assert.equal($3('heroName').textContent,'生命の紅石確認','wing is absent before arming the ruby');
  await doc3.click(btn({use:'0'}));
  let after=await getProfile(db3);
  assert.equal(after.run.hero.reviveArmed,true,'ruby is armed');
  assert.equal(after.run.carry[0],null);
  assert.match($3('battleInfo').textContent,/復活待機中/);
   assert.equal($3('heroName').textContent,'生命の紅石確認 🪽','armed life ruby adds a wing next to the adventurer name');
   assert.equal($3('heroName').attributes['aria-label'],'生命の紅石確認・生命の紅石：復活待機中');
  await doc3.click(btn({cast:'-1'}));
  after=await getProfile(db3);
  assert.ok(after.run,'ruby prevents losing the expedition at first lethal hit');
  assert.equal(after.run.hero.reviveUsed,true);
  assert.equal(after.run.hero.reviveArmed,false);
   assert.equal($3('heroName').textContent,'生命の紅石確認','wing disappears after revival');
   assert.equal($3('heroName').attributes['aria-label'],undefined,'no stale aria announcement');
  assert.ok(after.run.hero.hp>0);
  assert.match(after.run.log.join(' '),/生命の紅石：復活/);
  await doc3.click(btn({use:'1'}));
  after=await getProfile(db3);
  assert.ok(after.run.carry[1],'the second ruby is not wasted on the same combat');
  await doc3.click(btn({cast:'-1'}));
  after=await getProfile(db3);
  assert.equal(after.run,null,'second fatal hit ends the expedition');
  assert.equal($3('result').hidden,false);
  assert.equal(after.inventory.filter(item=>item.id==='life_ruby').length,1,'unused second ruby returns to inventory');
 }finally{env3.restore();}
 console.log('PASS special consumable UI, all session filters, ascending value, simultaneous HP/MP healing and one-shot fatal revival');
}finally{Math.random=originalRandom;}
