import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {playCombatSequence,attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';
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
// v313 #12: exercise the exact reported floor bands against every real enemy.
const flameSpell={role:'attack',attribute:'flame',power:681};
for(const layer of [28,29,47,48,49]){
 const rows=enemies.filter(row=>new RegExp('^(foe|boss)_l'+String(layer).padStart(3,'0')+'(?:_|$)').test(row.id));
 assert.ok(rows.length>=5,'all reported layer '+layer+' enemies are present');
 for(const row of rows){
  const level=Number(row.min_level);
  const attacker=G.makeUnit({hp:110,mag:12,def:10,res:10},level,{},[flameSpell],'player');
  const target=G.fromEnemy(row,level);
  assert.ok(G.damage(attacker,target,flameSpell,()=>.99)>0,
   layer+'F '+row.id+': flame magic cannot silently do zero damage without a hit-blocking status');
  const steps=[];
  G.round(attacker,target,0,-1,buffs,()=>.99,step=>steps.push(step));
  const hit=steps.find(step=>step.side==='hero'&&step.role==='attack');
  assert.ok(hit?.amount>0,layer+'F '+row.id+': combat timeline keeps a nonzero actual flame hit');
 }
}
// #12a: an enemy defense spell executes first, but cannot turn a real 681-power
// elemental hit into a silent zero. Test the actual 25 row spell loadouts.
for(const layer of [28,29,47,48,49]){
 const rows=enemies.filter(row=>new RegExp('^(foe|boss)_l'+String(layer).padStart(3,'0')+'(?:_|$)').test(row.id));
 for(const row of rows){
  const defenderSpell=G.fromEnemy(row,Number(row.min_level)).spells.findIndex(spell=>spell.role==='defense');
  if(defenderSpell<0)continue;
  const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},Number(row.min_level),{},[flameSpell],'player');
  const target=G.fromEnemy(row,Number(row.min_level));
  const effects=[];
  G.round(hero,target,0,defenderSpell,buffs,()=>.99,event=>effects.push(event));
  const hit=effects.find(event=>event.side==='hero'&&event.role==='attack');
  assert.ok(hit?.amount>0,layer+'F '+row.id+': a defense cast does not silently erase a 681-power flame hit');
 }
}
// The only intentional instant 0 on a viable attack is a successful dizziness
// miscast. Verify both the miss and the same spell's unblocked counterpart.
{
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},86,{},[flameSpell],'player');
 const enemy=G.fromEnemy(enemies.find(row=>row.id==='boss_l049'),86);
 const clean=G.damage(hero,enemy,flameSpell,()=>0);
 assert.ok(clean>0,'a viable flame spell does not miss without a debuff');
 G.addStatus(hero,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:.45,turns:2});
 assert.equal(G.damage(hero,enemy,flameSpell,()=>0),0,'an actual dizziness miss deals exactly zero');
 assert.equal(G.damage(hero,enemy,flameSpell,()=>.99),clean,'the same spell hits when the dizziness roll fails');
}
// #12b: support/healing phases are distinct from the subsequent attack phase.
{
 const attacker=G.makeUnit({hp:110,mag:12,def:10,res:10},86,{},[flameSpell],'player');
 const healer=G.fromEnemy(enemies.find(row=>row.id==='boss_l049'),86);
 healer.hp=Math.floor(healer.hp/2);
 const steps=[];
 G.round(attacker,healer,0,2,buffs,()=>.99,step=>steps.push(step));
 assert.ok(steps.some(step=>step.side==='enemy'&&step.role==='support'&&step.amount>0),
  '49F healing is a legitimate enemy support action, not negative player damage');
 assert.ok(steps.some(step=>step.side==='hero'&&step.role==='attack'&&step.amount>0),
  'healing enemy still receives flame damage in its own phase');
}
// #13: confusion selects the actual spent spell, with that spell's cooldown.
{
 const spells=[flameSpell,{role:'attack',attribute:'bolt',power:681}];
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},30,{},spells,'player');
 G.addStatus(hero,{id:'debuff_chaos',kind:'debuff',attribute:'chaos',effect:'confused',value:1,turns:2});
 const cast=G.prepare(hero,1,()=>0);
 assert.equal(cast.attribute,'flame');
 assert.ok(hero.cooldowns[0]>0);
 assert.equal(hero.cooldowns[1],0,'confusion consumes the redirected circle only');
}
// #14: inherited HP reduction is clamped to one, never wraps below zero.
{
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},1,{},[],'player');
 const target=G.makeUnit({hp:181,mag:12,def:10,res:10},1,{},[],'enemy');
 const before=target.stats.hp;
 const message=G.applyLegacyHp(hero,target,{role:'attack',legacyHp:before+100});
 assert.equal(target.stats.hp,1);
 assert.equal(target.hp,1);
 assert.match(message,/最大HP-/);
}
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
 await verify('boss 50 self-heal uses normal shared spell formula and HP threshold',()=>{
  const row=enemies.find(item=>item.id==='boss_l050');
  assert.ok(row,'actual 50F boss data exists');
  const boss=G.fromEnemy(row,Number(row.min_level));
  const healIndex=boss.spells.findIndex(spell=>spell.role==='support');
  assert.ok(healIndex>=0,'50F boss has a heal spell');
  boss.hp=1;
  assert.equal(G.chooseEnemySpell(boss,()=>0.9),healIndex,
   'low-HP boss chooses its own healing spell if it can cast');
  const heal=boss.spells[healIndex];
  const expected=Math.min(boss.stats.hp-boss.hp,
   Math.round(G.effectivePower(boss,heal)*G.factor(boss,'heal')*G.factor(boss,'output')));
  assert.ok(expected>0,'boss 50 heal must have nonzero power');
  const before=boss.hp;
  const result=G.cast(boss,G.makeUnit(profile.base,Number(row.min_level)),heal,buffs,()=>0.9);
  assert.equal(boss.hp-before,expected,'enemy healing uses the same calculation as player healing');
  assert.match(result,new RegExp('HP '+expected+'回復'));
  boss.hp=1;
  assert.equal(G.cast(boss,G.makeUnit(profile.base,Number(row.min_level)),heal,buffs,()=>0.5),
   result,'unchanged stats and missing HP give the same repeated heal amount');
 });
 await verify('RESIST/WEAK derives from true attribute multiplier and only landed attacks',()=>{
  const row=enemies.find(item=>item.id==='boss_l050');
  const boss=G.fromEnemy(row,Number(row.min_level));
  const baseline=G.resist(boss,'law');
  assert.ok(baseline<1,'real 50F boss starts resistant to law');
  assert.equal(attackHitAffinity({role:'attack',side:'hero',amount:32,attribute:'law',enemy:boss}),
   'resist','a landed law attack reports RESIST');
  assert.equal(attackHitAffinity({role:'attack',side:'hero',amount:0,attribute:'law',enemy:boss}),
   'none','missed spells must not report RESIST');
  assert.equal(attackHitAffinity({role:'support',side:'hero',amount:32,attribute:'law',enemy:boss}),
   'none','healing is not an affinity hit');
  const weak=G.fromEnemy(row,Number(row.min_level));
  assert.ok(G.resist(weak,'chaos')>1,'real boss has chaos weakness');
  assert.equal(attackHitAffinity({role:'attack',side:'hero',amount:32,attribute:'chaos',enemy:weak}),
   'weak','a landed chaos attack reports WEAK');
  G.cast(boss,G.makeUnit(profile.base,Number(row.min_level)),
   {role:'defense',attribute:'law',power:136},buffs,()=>0.5);
  assert.ok(G.resist(boss,'law')<baseline,'law defense reduces true effective resistance');
 });
}finally{env.restore();}
if(checks.length)throw Error('Muse reproduced regressions: '+checks.join(', '));
console.log('PASS Muse 50F playtest verification');
