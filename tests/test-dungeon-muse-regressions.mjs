import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {playCombatSequence} from '../assets/js/dungeon-combat-fx.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {fakeDungeonBrowser} from './helpers/fake-dungeon-browser.mjs';
import {openStore,getProfile,saveProfile,putCircle} from '../assets/js/dungeon-store.mjs';

const checks=[];
async function verify(label,run){
 try{await run();console.log('PASS '+label);}
 catch(error){checks.push(label);console.error('REPRO '+label+': '+error.message);}
}
// Two different priority phases can occur after an enemy has reached 0 HP.
// Victory cannot display a pre-retaliation hero snapshot.
await verify('fatal ceremony uses the final resolved combat phase',async()=>{
 const events=[],steps=[
  {role:'attack',side:'hero',hero:{hp:99},enemy:{hp:0}},
  {role:'basic',side:'enemy',hero:{hp:71},enemy:{hp:0}}
 ];
 await playCombatSequence(steps,()=>{},{
  duration:0,overlap:0,
  onFatal:(side,phase)=>{events.push({side,hp:phase.at(-1).hero.hp});}
 });
 assert.deepEqual(events,[{side:'enemy',hp:71}]);
});

const csv=async name=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,items,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','enemies','consumables','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const env=fakeDungeonBrowser(),doc=env.document,$=id=>doc.getElementById(id);
const button=data=>({dataset:data,disabled:false,closest(){return this;}});
const wait=async(check,label)=>{
 const end=Date.now()+9000;
 while(!(await check())&&Date.now()<end)await new Promise(r=>setTimeout(r,25));
 assert.ok(await check(),label);
};
try{
 const db=await openStore(env.factory),profile=await getProfile(db);
 const spellData=[
  {role:'defense',attribute:'aqua',power:701},
  {role:'support',attribute:'aqua',power:701},
  {role:'attack',attribute:'flame',power:701}
 ];
 const ids=spellData.map((_,i)=>'muse-'+i);
 profile.name='50層検証';
 profile.level=30;
 profile.returns=1;
 profile.slots=[...ids,null,null];
 profile.run={
  floor:50,slotIds:[...ids,null,null],
  hero:G.makeUnit(profile.base,profile.level,{},[...spellData,null,null],'player'),
  enemy:G.fromEnemy(enemies.find(x=>x.id==='boss_l010'),19),enemyName:'10層ボス',
  carry:[null,null,null,null,null,null],loot:[],xp:0,log:['前の戦闘：敵が現れた','撃破！ 3個を入手（未確定）'],
  stage:'checkpoint',bonusClaimed:false
 };
 await saveProfile(db,profile);
 for(let i=0;i<ids.length;i++)await putCircle(db,{
  id:ids[i],registeredAt:i+1,image:new Blob(['muse-'+i],{type:'image/jpeg'}),
  analysis:spellData[i],revealed:true
 });
 await import('../assets/js/dungeon-app.mjs?integration=muse-evidence');
 await wait(()=>$('checkpoint').hidden===false,'checkpoint rendered');
 await verify('checkpoint explains that a bonus must be chosen',async()=>{
  assert.match($('checkpointInfo').textContent,/利益を選んで/);
 });
 await verify('detail photo decoder gets one fresh URL before showing repair',async()=>{
  await doc.click(button({circleDetail:'muse-0'}));
  const img=$('magicDetailsImage'),first=img.src;
  assert.equal($('magicDetailsDialog').open,true);
  doc.emit('error',img);
  assert.equal(img.dataset.photoRetried,'true');
  assert.notEqual(img.src,first,'retry must not reuse a revoked URL');
  doc.emit('error',img);
  assert.match(img.alt,/写真を表示できません/,'a genuinely corrupt photo remains diagnosed');
  await $('closeMagicDetails').fire('click');
 });
 await $('bonus-item').fire('click');
 const awarded=(await getProfile(db)).run;
 assert.equal(awarded.bonusClaimed,true,'actual item bonus was awarded');
 await verify('checkpoint announces awarded carry item',async()=>{
  assert.match($('checkpointInfo').textContent,/携行品.*獲得/);
 });
 await $('deeper').fire('click');
 await wait(()=>$('battle').hidden===false,'next fight rendered');
 await verify('previous victory log is not repeated in the next encounter',async()=>{
  assert.doesNotMatch($('battleLog').innerHTML,/撃破！ 3個を入手/);
  const saved=await getProfile(db);
  assert.ok(saved.run.log.some(s=>s.includes('撃破！ 3個')),'expedition audit history remains intact');
 });
 await verify('cooldown and item state refresh at resolution rather than next action',async()=>{
  assert.match($('battleSpells').innerHTML,/tile-cooldown">発動/);
  const pending=doc.click(button({cast:'0'}));
  await Promise.resolve();
  assert.match($('battleSpells').innerHTML,/tile-cooldown">待機 1</);
  await pending;
 });
 // The cleanse predicate itself is sound; the reported disabled button
 // must be investigated at the UI snapshot/animation boundary.
 await verify('flame cleanser matches real burn and removes only flame',()=>{
  const hero=G.makeUnit(profile.base,30);
  hero.statuses=[
   {id:'debuff_flame',kind:'debuff',attribute:'flame',effect:'burn',turns:2},
   {id:'debuff_aqua',kind:'debuff',attribute:'aqua',effect:'soak',turns:2}
  ];
  const potion={id:'clear_flame',value:0};
  assert.equal(G.canUseBattleItem(hero,potion,items,buffs),true);
  G.potion(hero,potion,items,buffs);
  assert.deepEqual(hero.statuses.map(x=>x.attribute),['aqua']);
 });
 await verify('aqua self-soak requires an enemy debuff, not healing itself',()=>{
  const hero=G.makeUnit(profile.base,30,{},[spellData[1]]);
  const enemy=G.makeUnit(profile.base,30,{},[{role:'debuff',attribute:'aqua',power:200}]);
  hero.hp=Math.max(1,hero.hp-100);
  const log=G.round(hero,enemy,0,0,buffs,()=>.9);
  assert.ok(log.some(x=>x.includes('敵：aqua弱体付与')));
  assert.ok(hero.statuses.some(x=>x.id==='debuff_aqua'));
 });
}finally{env.restore();}
if(checks.length)throw Error('Muse reproduced regressions: '+checks.join(', '));
console.log('PASS Muse 50F playtest verification');
