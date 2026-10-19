// Real combat simulations of consecutive five-encounter layers without carried items.
// Only the actual tenth-layer checkpoint can fully restore HP/MP. No XP is
// applied while the expedition is underway; stone rewards are banked on return.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure,num} from '../assets/js/dungeon-tuning.mjs';
import {targetClearLevel,enemyForFight} from '../assets/js/dungeon-design.mjs';
import {strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const rng=seed=>()=>{
 seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 return seed/4294967296;
};
const SPELLS={
 beginner:[{role:'attack',attribute:'flame',power:300},{role:'attack',attribute:'bolt',power:330},{role:'support',attribute:'aqua',power:270}],
 three:[{role:'attack',attribute:'flame',power:360},{role:'attack',attribute:'bolt',power:420},{role:'support',attribute:'aqua',power:300}],
 five:[{role:'attack',attribute:'flame',power:360},{role:'attack',attribute:'bolt',power:420},{role:'attack',attribute:'gravity',power:540},
  {role:'support',attribute:'aqua',power:320},{role:'defense',attribute:'law',power:270}]
};
function enemyAction(unit,r){
 const ids=G.available(unit);
 if(!ids.length)return -1;
 const heal=ids.find(i=>unit.spells[i].role==='support');
 if(unit.hp<unit.stats.hp*num('enemy_heal_threshold')&&heal!==undefined)return heal;
 const offense=ids.filter(i=>unit.spells[i].role==='attack');
 return offense.length&&r()<num('enemy_attack_preference')
  ?offense[Math.floor(r()*offense.length)]:ids[Math.floor(r()*ids.length)];
}
function heroAction(hero,enemy){
 const ids=G.available(hero);
 if(!ids.length)return -1;
 const heal=ids.find(i=>hero.spells[i].role==='support');
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const offense=ids.filter(i=>hero.spells[i].role==='attack');
 if(offense.length)return offense.sort((a,b)=>G.damage(hero,enemy,hero.spells[b],()=>.999)-G.damage(hero,enemy,hero.spells[a],()=>.999))[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
// Rewards and XP are gathered fight-by-fight but committed only on boss return.
// The ledger is a plausible *supply forecast*, not a guarantee that the fights
// were winnable; the combat simulator validates survivability separately.
export function stoneLedger(seed,throughLayer){
 const r=rng(seed),progress={level:1,xp:0},levels=[],returns=[];
 let unconfirmedXp=0,unconfirmedStones=0,bank=0,lastLevel=1;
 for(let layer=1;layer<=throughLayer;layer++){
  for(let i=0;i<5;i++){
   const fight=(layer-1)*5+i+1;
   const foe=enemyForFight(data.enemies,fight);
   const enemyLevel=Number(data.floors[fight-1].enemy_level);
   const drops=G.drops(data.items,data.collections,enemyLevel,r,{layer,playerLevel:progress.level,bossEnemyId:i===4?foe.id:null});
   unconfirmedStones+=drops.filter(x=>x.type==='stone').length;
   unconfirmedXp+=G.fightExperience(enemyLevel,progress.level,layer);
  }
  // Boss return: only now are stones and experience banked.
  bank+=unconfirmedStones;
  G.experience(progress,unconfirmedXp);
  if(progress.level>lastLevel)levels.push({from:lastLevel,to:progress.level,stones:bank,layer});
  lastLevel=progress.level;
  returns.push({layer,level:progress.level,stones:bank});
  unconfirmedStones=0;unconfirmedXp=0;
 }
 return {level:progress.level,stones:bank,levels,returns};
}
// Spend a modest fraction of acquired stones on the currently selected circles.
// Most previously earned stones are assumed to have been spent on earlier gear
// or saved. Upgrades use the same permanent 10%-of-base rule as the real game.
export function upgradeSpells(spells,budget){
 const base=spells.map(s=>({...s}));
 const counts=base.map(()=>0);
 for(let n=0;n<budget;n++){
  const candidate=base.map((s,i)=>({s,i})).filter(x=>x.s.role==='attack'||x.s.role==='support');
  candidate.sort((a,b)=>{
   const score=x=>{
    const orig=spells[x.i].power,now=x.s.power,next=strengthenedPower(orig,counts[x.i]+1);
    const gain=G.basePower(next)-G.basePower(now);
    const extraMp=G.mpCost(next)-G.mpCost(now);
    return (gain+.15)/(1+extraMp) / (counts[x.i]+1)**.25;
   };
   return score(b)-score(a)||a.i-b.i;
  });
  const {i}=candidate[0];
  counts[i]++;
  base[i].power=strengthenedPower(spells[i].power,counts[i]);
 }
 return {spells:base,counts,costs:base.map(s=>G.mpCost(s.power))};
}
export function simulate(seed,{level=12,fromLayer=1,toLayer=3,spells='five',stones='none',baseStats=null}={}){
 const r=rng(seed),base=baseStats||{hp:100,mag:10,def:7,res:7};
 const history=stones==='earned'?stoneLedger(seed+81,fromLayer-1):{stones:0};
 const budget=stones==='earned'?Math.min(16,Math.floor(history.stones*.12)):Math.max(0,Number(stones)||0);
 const equipment=upgradeSpells(SPELLS[spells],budget);
 const hero=G.makeUnit(base,level,{},equipment.spells,'player');
 const first=(fromLayer-1)*5+1,last=toLayer*5;
 const stats={win:false,clear:first-1,turns:0,normalAttacks:0,restores:0,
  startLevel:level,fromLayer,toLayer,spells,spentStones:budget,availableStones:history.stones,
  initialHp:hero.hp,initialMp:hero.mp,minMp:hero.mp,mpRestored:0,fightStats:[]};
 for(let fight=first;fight<=last;fight++){
  const foe=enemyForFight(data.enemies,fight);
  const enemy=G.fromEnemy(foe,+data.floors[fight-1].enemy_level);
  const hpBefore=hero.hp,mpBefore=hero.mp;
  let turns=0,win=false;
  for(;turns<80;turns++){
   const pick=heroAction(hero,enemy);
   const enemyPick=enemyAction(enemy,r);
   if(pick===-1)stats.normalAttacks++;
   G.round(hero,enemy,pick,enemyPick,data.buffs,r);
   stats.turns++;
   stats.minMp=Math.min(hero.mp,stats.minMp);
   if(hero.hp<=0)break;
   if(enemy.hp<=0){win=true;break;}
  }
  stats.fightStats.push({fight,layer:Math.ceil(fight/5),win,turns:turns+1,hpBefore,hpAfter:hero.hp,mpBefore,mpAfter:hero.mp});
  if(!win)break;
  stats.clear=fight;
  hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
  stats.mpRestored+=G.recoverVictoryMp(hero);
  if(fight%50===0&&fight<last){ // 10th/20th/... layer, after the boss
   hero.hp=hero.stats.hp;hero.mp=hero.maxMp;stats.restores++;
  }
 }
 stats.win=stats.clear===last;
 stats.hp=hero.hp;stats.mp=hero.mp;
 return stats;
}
// A target-level player starts fully recovered at the beginning of the chosen
// band. Each band is a true unbroken expedition through consecutive fights.
export const scenarios=[
 {name:'Lv1 / 1F / 3 circles / no items',level:1,fromLayer:1,toLayer:1,spells:'beginner'},
 {name:'Lv3 / 1-2F / 3 circles / no items',level:3,fromLayer:1,toLayer:2,spells:'beginner'},
 {name:'Lv5 / 1-3F / 3 circles / no items',level:5,fromLayer:1,toLayer:3,spells:'beginner'},
 {name:'Lv12 / 1-3F / 3 circles / no items',level:12,fromLayer:1,toLayer:3,spells:'three'},
 {name:'Lv19 / 1-10F / 5 circles / no items',level:19,fromLayer:1,toLayer:10,spells:'five'},
 {name:'Lv37 / 10-20F / 5 circles / no items',level:37,fromLayer:10,toLayer:20,spells:'five'},
 {name:'Lv55 / 20-30F / 5 circles / no items / earned stones',level:55,fromLayer:20,toLayer:30,spells:'five',stones:'earned'},
 {name:'Lv72 / 30-40F / 5 circles / no items / earned stones',level:72,fromLayer:30,toLayer:40,spells:'five',stones:'earned'},
  {name:'Lv87 / 40-50F / 5 circles / no items',level:87,fromLayer:40,toLayer:50,spells:'five'},
 {name:'Lv102 / 50-60F / 5 circles / no items / earned stones',level:102,fromLayer:50,toLayer:60,spells:'five',stones:'earned'},
 {name:'Lv115 / 60-70F / 5 circles / no items / earned stones',level:115,fromLayer:60,toLayer:70,spells:'five',stones:'earned'},
 {name:'Lv128 / 70-80F / 5 circles / no items / earned stones',level:128,fromLayer:70,toLayer:80,spells:'five',stones:'earned'},
 {name:'Lv139 / 80-90F / 5 circles / no items / earned stones',level:139,fromLayer:80,toLayer:90,spells:'five',stones:'earned'},
 {name:'Lv150 / 90-100F / 5 circles / no items / no stones',level:150,fromLayer:90,toLayer:100,spells:'five',stones:'none'},
 {name:'Lv150 / 90-100F / 5 circles / no items / earned stones',level:150,fromLayer:90,toLayer:100,spells:'five',stones:'earned'}
];
export function summarize(config,samples=32){
 const runs=Array.from({length:samples},(_,i)=>simulate(17011+i*13,config));
 const wins=runs.filter(x=>x.win);
 const avg=x=>Math.round(x.reduce((n,v)=>n+v,0)/x.length*10)/10;
 return {name:config.name,winRate:Math.round(100*wins.length/samples),
  avgCleared:avg(runs.map(x=>x.clear)),
  avgTurns:avg(runs.map(x=>x.turns)),avgNormalAttacks:avg(runs.map(x=>x.normalAttacks)),
  avgRestores:avg(runs.map(x=>x.restores)),
  avgHpPercent:wins.length?Math.round(100*avg(wins.map(x=>x.hp/x.initialHp))):null,
  avgMpPercent:wins.length?Math.round(100*avg(wins.map(x=>x.mp/x.initialMp))):null,
  avgStones:avg(runs.map(x=>x.availableStones)),
  avgSpentStones:avg(runs.map(x=>x.spentStones)),
  lossByFight:Object.entries(runs.filter(x=>!x.win).reduce((a,x)=>{const f=x.clear+1;a[f]=(a[f]||0)+1;return a;},{}))};
}
for(const config of scenarios)console.log('PROGRESSION_SIM '+JSON.stringify(summarize(config)));
// Every planned band is checked using the level intended for its final boss.
for(const config of scenarios.filter(x=>x.toLayer>=10)){
 assert.equal(config.level,targetClearLevel(config.toLayer),'intended boss level '+config.toLayer);
}
const baseline=summarize(scenarios.find(x=>x.level===5));
assert.ok(baseline.winRate>=70,'level 5 item-free party must have a reasonable chance through layer 3');
const overleveled=summarize(scenarios.find(x=>x.level===12));
assert.ok(overleveled.winRate>=95,'a level 12 party should reliably clear layer 3 without consumables');
const endgame=summarize(scenarios.find(x=>x.level===150&&x.stones==='earned'));
assert.ok(endgame.winRate>=70,'item-free level 150 party using earned stone upgrades should clear through layer 100');
assert.ok(endgame.avgMpPercent<=25,'final stretch should be close in MP, not trivial');
const ledger=stoneLedger(7293,10);
console.log('MAGIC_STONE_LEDGER '+JSON.stringify({throughLayer:10,level:ledger.level,stones:ledger.stones,
 levels:ledger.levels,returns:ledger.returns}));
assert.ok(scenarios.every(x=>x.fromLayer<=x.toLayer),'scenarios cover consecutive layer bands');
assert.equal(simulate(1,{level:1,fromLayer:1,toLayer:1,spells:'beginner'}).spentStones,0);
assert.ok(upgradeSpells(SPELLS.five,10).spells.every((s,i)=>s.power>=SPELLS.five[i].power));
assert.equal(stoneLedger(1,0).stones,0);
assert.ok(ledger.stones>0,'stones are banked across completed checkpoints');
assert.ok(ledger.levels.every(x=>x.to>x.from),'level ups require accumulated XP');
assert.ok(ledger.levels.every((x,i)=>i===0||x.stones>=ledger.levels[i-1].stones),'stone bank is never debited before upgrades');
assert.ok(ledger.returns.every((x,i)=>i===0||x.level>=ledger.returns[i-1].level),'return-only levels are monotonic');
console.log('PASS seeded full combat with resource carryover, tenth-layer HP/MP recovery, saved reward ledger and permanent stone upgrades');


// Audit-only matrix: high-power photographs can be equipped from level 1.
// This deliberately does not change battle logic or assert a target win rate.
const originalMpDivisor=data.balance.find(x=>x.key==='mp_cost_divisor').value;
const originalSpells=Object.fromEntries(Object.entries(SPELLS).map(([k,v])=>[k,v]));
const mpProbeBands=[
 {id:'Lv1 / layer 1',level:1,fromLayer:1,toLayer:1,spells:'beginner'},
 {id:'Lv3 / layers 1-2',level:3,fromLayer:1,toLayer:2,spells:'beginner'},
 {id:'Lv5 / layers 1-3',level:5,fromLayer:1,toLayer:3,spells:'beginner'},
 {id:'Lv19 / layers 1-10',level:19,fromLayer:1,toLayer:10,spells:'five'},
 {id:'Lv37 / layers 10-20',level:37,fromLayer:10,toLayer:20,spells:'five'}
];
function probeSummary(config,samples=32){
 const runs=Array.from({length:samples},(_,i)=>simulate(17011+i*13,config));
 const avg=f=>Math.round(runs.reduce((n,x)=>n+f(x),0)/runs.length*10)/10;
 const completed=runs.filter(x=>x.win);
 return {winRate:Math.round(100*completed.length/samples),avgClear:avg(x=>x.clear),
  avgTurns:avg(x=>x.turns),avgNormal:avg(x=>x.normalAttacks),
  avgFightMpCost:avg(x=>x.fightStats.reduce((s,f)=>s+f.mpBefore-f.mpAfter,0)),
  avgRestored:avg(x=>x.mpRestored),
  avgEndMpPercent:Math.round(avg(x=>100*x.mp/x.initialMp)),
  avgEndHpPercent:Math.round(avg(x=>100*x.hp/x.initialHp)),
  avgFights:avg(x=>x.fightStats.length)};
}
for(const power of [300,400,600,800,1000])
 console.log('MP_POWER_COST '+JSON.stringify({power,baseMagic:G.basePower(power),cost:G.mpCost(power),
  lv1MaxMp:G.makeUnit({hp:100,mag:10,def:7,res:7},1).maxMp,
  lv1WinRestore:Math.round(100*(.09+.045))/100}));
for(const p of [400,1000]){
 const up=strengthenedPower(p,10);
 console.log('MP_UPGRADE_AUDIT '+JSON.stringify({originalPower:p,afterTenStones:up,
  inGameMp:G.spellMpCost({power:up,basePower:p}),existingSimulatorMp:G.mpCost(up)}));
}
for(const divisor of [12,8,6,4]){
 data.balance.find(x=>x.key==='mp_cost_divisor').value=String(divisor);
 configure(data);
 // Existing playtest loadouts unchanged: potential collateral at all levels.
 for(const s of scenarios){
  console.log('MP_ORIGINAL_SWEEP '+JSON.stringify({divisor,band:s.name,
   ...probeSummary(s,32)}));
 }
 for(const power of [300,400,600,800,1000]){
  SPELLS.beginner=[
   {role:'attack',attribute:'flame',power},
   {role:'attack',attribute:'bolt',power},
   {role:'support',attribute:'aqua',power:Math.round(power*.8)}
  ];
  SPELLS.five=[
   {role:'attack',attribute:'flame',power},
   {role:'attack',attribute:'bolt',power},
   {role:'attack',attribute:'gravity',power},
   {role:'support',attribute:'aqua',power:Math.round(power*.8)},
   {role:'defense',attribute:'law',power:Math.round(power*.8)}
  ];
  for(const cohort of mpProbeBands)
   console.log('MP_EARLY_POWER_SWEEP '+JSON.stringify({divisor,power,band:cohort.id,
    ...probeSummary(cohort,32)}));
 }
}
data.balance.find(x=>x.key==='mp_cost_divisor').value=originalMpDivisor;
for(const [k,v] of Object.entries(originalSpells))SPELLS[k]=v;
configure(data);
console.log('PASS MP consumption and high-power early-loadout audit matrix');
