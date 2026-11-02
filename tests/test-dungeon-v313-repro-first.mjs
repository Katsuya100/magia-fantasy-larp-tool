import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createBattleInputBuffer,LAST_PHASE_OVERLAP_RATIO} from '../assets/js/dungeon-battle-input.mjs';
import {attackHitAffinity} from '../assets/js/dungeon-combat-fx.mjs';

const csv=async key=>G.parseCsv(await readFile(new URL('../assets/data/dungeon-'+key+'.csv',import.meta.url),'utf8'));
const [balance,levels,floors,playerBase,enemies,buffs]=await Promise.all(
 ['balance','levels','floors','player-base','enemies','buffs'].map(csv));
configure({balance,levels,floors,playerBase});
const failures=[];
globalThis.__dungeonAppSource=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const check=(name,fn)=>{
 try{fn();console.log('PASS '+name);}
 catch(error){failures.push(name+': '+error.message);console.error('REPRO '+name+': '+error.message);}
};

// #12a/#12b: distinguish a spell that truly dealt zero damage from a lost click.
const flame={role:'attack',attribute:'flame',power:681};
let enemyCount=0;
check('28–29F and 47–49F real enemies receive ordinary flame damage',()=>{
 for(const layer of [28,29,47,48,49]){
  const prefix=String(layer).padStart(3,'0');
  const rows=enemies.filter(row=>new RegExp('^(foe|boss)_l'+prefix+'(?:_|$)').test(row.id));
  assert.equal(rows.length,5,layer+'F has its four ordinary enemies and boss');
  for(const row of rows){
   const lv=Number(row.min_level);
   const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},lv,{},[flame],'player');
   const foe=G.fromEnemy(row,lv);
   assert.ok(G.damage(hero,foe,flame,()=>.99)>0,
    row.id+': legitimate 681-power non-dizzy attack is nonzero');
   const events=[];
   G.round(hero,foe,0,-1,buffs,()=>.99,event=>events.push(event));
   const attack=events.find(event=>event.side==='hero'&&event.role==='attack');
   assert.ok(attack?.amount>0,row.id+': battle log records actual damage');
   enemyCount++;
  }
 }
 assert.equal(enemyCount,25);
});
check('Dizziness can create a real 0-damage miss without fake RESIST',()=>{
 const row=enemies.find(x=>x.id==='boss_l049');
 const lv=Number(row.min_level);
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},lv,{},[flame],'player');
 const foe=G.fromEnemy(row,lv);
 assert.ok(G.damage(hero,foe,flame,()=>.99)>0);
 G.addStatus(hero,{id:'debuff_storm',kind:'debuff',attribute:'storm',effect:'dizzy',value:.45,turns:2});
 const events=[];
 G.round(hero,foe,0,-1,buffs,()=>0,event=>events.push(event));
 const missed=events.find(event=>event.side==='hero'&&event.role==='attack');
 assert.equal(missed?.amount,0);
 assert.equal(attackHitAffinity(missed),'none');
});

check('47–49F enemy healing and a landed flame attack occupy separate phases',()=>{
 for(const layer of [47,48,49]){
  const boss=enemies.find(row=>row.id==='boss_l'+String(layer).padStart(3,'0'));
  assert.ok(boss,layer+'F boss data exists');
  const level=Number(boss.min_level);
  const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},level,{},[flame],'player');
  const enemy=G.fromEnemy(boss,level);
  const supportIndex=enemy.spells.findIndex(spell=>spell?.role==='support');
  assert.ok(supportIndex>=0,layer+'F real boss can heal');
  enemy.hp=Math.floor(enemy.hp/2);
  const before=enemy.hp,steps=[];
  G.round(hero,enemy,0,supportIndex,buffs,()=>.99,step=>steps.push(step));
  const heal=steps.find(step=>step.side==='enemy'&&step.role==='support');
  const strike=steps.find(step=>step.side==='hero'&&step.role==='attack');
  assert.ok(heal?.amount>0,layer+'F support phase actually heals');
  assert.ok(strike?.amount>0,layer+'F flame still deals real damage');
  assert.ok(steps.indexOf(heal)<steps.indexOf(strike),'support action resolves before attack');
  assert.equal(enemy.hp,Math.max(0,Math.min(enemy.stats.hp,before+heal.amount)-strike.amount),
   layer+'F enemy HP is the independent sum of heal and damage');
 }
});

// #17: the first tap during active battle animations must not be silently lost.
check('First-phase combat input is retained for the last-phase window',()=>{
 const timers=[];
 const buffer=createBattleInputBuffer({
  setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:()=>{}
 });
 assert.equal(LAST_PHASE_OVERLAP_RATIO,.7);
 assert.equal(buffer.offer({kind:'cast',index:0}),false,'no tap before combat');
 // The live game begins animating its first combat phase now.
 // Before the fix, begin() is called only at the final phase.
 const early={kind:'cast',index:1,floor:49};
 assert.equal(buffer.offer(early),true,'REPRO: first animation phase drops the click');
 const release=buffer.begin(440);
 assert.equal(timers[0].ms,308);
 timers[0].fn();
 buffer.close();
 assert.deepEqual(buffer.take(),early);
 void release;
});

// #15: death must remove both older WEAK and newer RESIST visual echoes.
check('Fatal ceremony removes all old elemental visual echoes',()=>{
 const app=globalThis.__dungeonAppSource;
 const section=app.slice(app.indexOf('async function animateBattle('),app.indexOf('async function ceremony('));
 assert.match(section,/onFatal:side=>/,'actual death callback exists');
 assert.match(section,/\b(?:activeEchoes|fxEchoes)\b/,'old phases have their own echo references');
 assert.match(section,/for\(const echo of (?:activeEchoes|fxEchoes)\)echo\.dispose\(\)/,
  'REPRO: only the last WEAK/RESIST echo is currently disposed');
});

// #11/#13/#14: preserve confirmed behavior without changing combat balance.
check('Post-victory spell UI is disabled and combat stage guards casting',()=>{
 const app=globalThis.__dungeonAppSource;
 assert.match(app,/disabled=run\.stage!=='battle'\|\|Boolean\(s&&!G\.canCast\(hero,i\)\)/);
 assert.match(app,/async function takeTurn\(index\)\{[\s\S]*?run\.stage!=='battle'/);
});
check('Confusion consumes only the redirected spell cooldown',()=>{
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},30,{},[flame,{role:'attack',attribute:'bolt',power:681}],'player');
 G.addStatus(hero,{id:'debuff_chaos',kind:'debuff',attribute:'chaos',effect:'confused',value:1,turns:2});
 assert.equal(G.prepare(hero,1,()=>0).attribute,'flame');
 assert.ok(hero.cooldowns[0]>0);
 assert.equal(hero.cooldowns[1],0);
});
check('Inherited maximum HP reduction cannot take a foe below 1',()=>{
 const hero=G.makeUnit({hp:110,mag:12,def:10,res:10},1,{},[],'player');
 const foe=G.makeUnit({hp:181,mag:12,def:10,res:10},1,{},[],'enemy');
 G.applyLegacyHp(hero,foe,{role:'attack',legacyHp:999});
 assert.equal(foe.stats.hp,1);
 assert.equal(foe.hp,1);
});
if(failures.length)throw Error('Reproduced v313 regressions: '+failures.join(' | '));
console.log('PASS v313 reproducible combat contracts');
