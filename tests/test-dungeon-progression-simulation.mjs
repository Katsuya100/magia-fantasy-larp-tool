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
export function stoneLedger(seed,throughLayer,returnEvery=1){
 const r=rng(seed),progress={level:1,xp:0},levels=[],returns=[];
 let unconfirmedXp=0,unconfirmedStones=0,bank=0,lastLevel=1;
 for(let layer=1;layer<=throughLayer;layer++){
  const levelBefore=progress.level;
  const chance=G.magicStoneDropChance(levelBefore,layer);
  for(let i=0;i<5;i++){
   const fight=(layer-1)*5+i+1;
   const foe=enemyForFight(data.enemies,fight);
   const enemyLevel=Number(data.floors[fight-1].enemy_level);
   const drops=G.drops(data.items,data.collections,enemyLevel,r,{layer,playerLevel:progress.level,bossEnemyId:i===4?foe.id:null});
   unconfirmedStones+=drops.filter(x=>x.type==='stone').length;
   unconfirmedXp+=G.fightExperience(enemyLevel,progress.level,layer);
  }
  // Both policies settle loot/XP only when the party returns after a layer boss.
  // A decade-return policy more closely matches the unlockable 11,21,... entries,
  // but ignores the 80% HP+MP requirement for earning those rank badges.
  const settled=layer%returnEvery===0||layer===throughLayer;
  const earned=unconfirmedStones;
  if(settled){
   bank+=unconfirmedStones;
   G.experience(progress,unconfirmedXp);
   if(progress.level>lastLevel)levels.push({from:lastLevel,to:progress.level,stones:bank,layer});
   lastLevel=progress.level;
   unconfirmedStones=0;unconfirmedXp=0;
  }
  returns.push({layer,levelBefore,level:progress.level,stones:bank,
   gained:earned,expectedGained:5*chance,settled,pendingStones:unconfirmedStones});
 }
 return {level:progress.level,stones:bank,levels,returns};
}
// Repeat the last conquered boss layer after each ten-layer milestone.
// This deliberately models successful repeat runs, not guaranteed wins, and
// applies both the game's falling overlevel stone drop chance and reduced XP.
// Spending is handled separately: bank here means stones earned, not still held.
export function stoneFarmingLedger(seed,throughLayer,extraRunsPerDecade=0){
 const r=rng(seed),progress={level:1,xp:0},reports=[];
 let earned=0,pendingStones=0,pendingXp=0,farmStones=0,farmBattles=0;
 const completeLayer=layer=>{
  for(let i=0;i<5;i++){
   const fight=(layer-1)*5+i+1,foe=enemyForFight(data.enemies,fight);
   const enemyLevel=Number(data.floors[fight-1].enemy_level);
   pendingStones+=G.drops(data.items,data.collections,enemyLevel,r,{
    layer,playerLevel:progress.level,bossEnemyId:i===4?foe.id:null
   }).filter(x=>x.type==='stone').length;
   pendingXp+=G.fightExperience(enemyLevel,progress.level,layer);
  }
 };
 const returnHome=()=>{
  const stones=pendingStones;
  earned+=stones;
  G.experience(progress,pendingXp);
  pendingStones=0;pendingXp=0;
  return stones;
 };
 for(let layer=1;layer<=throughLayer;layer++){
  completeLayer(layer);
  if(layer%10!==0&&layer!==throughLayer)continue;
  returnHome();
  if(layer%10===0){
   const levelBeforeFarm=progress.level,before=earned;
   for(let n=0;n<extraRunsPerDecade;n++){
    completeLayer(layer);
    farmStones+=returnHome();
    farmBattles+=5;
   }
   reports.push({layer,levelBeforeFarm,levelAfterFarm:progress.level,
    earnedFromFarming:earned-before,totalEarned:earned});
  }
 }
 return {level:progress.level,stones:earned,earnedFromFarming:farmStones,
  farmBattles,returns:reports};
}
// Allocate a documented share of stones earned before this band to the equipped circles.
// Unlike the former 12%-and-16-cap shortcut, no fabricated upper limit is imposed.
// Players can spend anything from 0% to 100%, so sensitivity is measured below.
export function upgradeSpells(spells,budget){
 const base=spells.map(s=>({...s,basePower:s.basePower??s.power}));
 const counts=base.map(()=>0);
 for(let n=0;n<budget;n++){
  const candidate=base.map((s,i)=>({s,i})).filter(x=>x.s.role==='attack'||x.s.role==='support');
  candidate.sort((a,b)=>{
   const score=x=>{
    const orig=spells[x.i].power,now=x.s.power,next=strengthenedPower(orig,counts[x.i]+1);
    const gain=G.basePower(next)-G.basePower(now);
    return (gain+.15)/(counts[x.i]+1)**.25;
   };
   return score(b)-score(a)||a.i-b.i;
  });
  const {i}=candidate[0];
  counts[i]++;
  base[i].power=strengthenedPower(spells[i].power,counts[i]);
 }
 // Real circles retain their original basePower, hence their original MP cost.
 return {spells:base,counts,costs:base.map(s=>G.spellMpCost(s))};
}
const ledgerCache=new Map();
export function simulate(seed,{level=12,fromLayer=1,toLayer=3,spells='five',stones='none',baseStats=null,stoneUse=.5,mpRecoveryFactor=undefined,farmRunsPerDecade=0}={}){
 const r=rng(seed),base=baseStats||{hp:100,mag:10,def:7,res:7};
 const ledgerKey=seed+':'+fromLayer+':farm'+farmRunsPerDecade;
 if(stones==='earned'&&!ledgerCache.has(ledgerKey))ledgerCache.set(ledgerKey,
  farmRunsPerDecade>0?stoneFarmingLedger(seed+81,fromLayer-1,farmRunsPerDecade)
   :stoneLedger(seed+81,fromLayer-1,10));
 const history=stones==='earned'?ledgerCache.get(ledgerKey):{stones:0};
 const budget=stones==='earned'?Math.floor(history.stones*Math.max(0,Math.min(1,stoneUse))):Math.max(0,Number(stones)||0);
 const equipment=upgradeSpells(SPELLS[spells],budget);
 const effectiveLevel=level==='forecast'?(history.level||1):level;
 const hero=G.makeUnit(base,effectiveLevel,{},equipment.spells,'player');
 const first=(fromLayer-1)*5+1,last=toLayer*5;
 const stats={win:false,clear:first-1,turns:0,normalAttacks:0,restores:0,
  startLevel:effectiveLevel,forecastLevelAtEntry:history.level??null,fromLayer,toLayer,spells,spentStones:budget,availableStones:history.stones,unspentStones:Math.max(0,history.stones-budget),farmStones:history.earnedFromFarming??0,farmBattles:history.farmBattles??0,upgradeCounts:equipment.counts,
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
  stats.mpRestored+=G.recoverVictoryMp(hero,Math.ceil(fight/5),mpRecoveryFactor);
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
 {name:'Lv37 / 10-20F / 5 circles / no items / earned stones',level:37,fromLayer:10,toLayer:20,spells:'five',stones:'earned'},
 {name:'Lv55 / 20-30F / 5 circles / no items / earned stones',level:55,fromLayer:20,toLayer:30,spells:'five',stones:'earned'},
 {name:'Lv72 / 30-40F / 5 circles / no items / earned stones',level:72,fromLayer:30,toLayer:40,spells:'five',stones:'earned'},
  {name:'Lv87 / 40-50F / 5 circles / no items / earned stones',level:87,fromLayer:40,toLayer:50,spells:'five',stones:'earned'},
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
  avgFarmStones:avg(runs.map(x=>x.farmStones)),
  avgFarmBattles:avg(runs.map(x=>x.farmBattles)),
  avgUnspentStones:avg(runs.map(x=>x.unspentStones)),
  forecastLevelAtEntry:avg(runs.map(x=>x.forecastLevelAtEntry??0)),
  lossByFight:Object.entries(runs.filter(x=>!x.win).reduce((a,x)=>{const f=x.clear+1;a[f]=(a[f]||0)+1;return a;},{}))};
}
for(const config of scenarios)console.log('PROGRESSION_SIM '+JSON.stringify(summarize(config)));

// Economic baseline: one five-fight layer per expedition, always return at the boss.
// This is a cumulative earned-stones forecast, NOT unspent inventory or a guaranteed
// successful combat path. Death, repeated farming and replacing upgraded circles differ.
const economyRuns=Array.from({length:128},(_,i)=>stoneLedger(47119+i*113,100));
const decadeEconomyRuns=Array.from({length:128},(_,i)=>stoneLedger(47119+i*113,100,10));
for(const layer of [10,20,30,40,50,60,70,80,90,100]){
 const sorted=economyRuns.map(run=>run.returns[layer-1].stones).sort((a,b)=>a-b);
 const example=economyRuns[0].returns[layer-1];
 const mean=Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length*10)/10;
 const expectedDrops=Math.round(economyRuns.reduce((a,run)=>a+run.returns.slice(Math.max(0,layer-10),layer).reduce((x,y)=>x+y.expectedGained,0),0)/economyRuns.length*10)/10;
 console.log('STONE_ECONOMY '+JSON.stringify({layer,levelBefore:example.levelBefore,levelAfterReturn:example.level,
  targetClearLevel:targetClearLevel(layer),meanEarned:mean,p10:sorted[12],median:sorted[64],p90:sorted[115],
  meanExpectedDropsLast10Layers:expectedDrops,model:'single-clear;return-after-each-layer;no-spending'}));
}

// The player cannot actually select 2,3,... as starting layers: compare a
// ten-layer expedition plus return, assuming a badge was earned each decade.

// A layer-by-layer ledger distinguishes stones already confirmed at the last
// successful return from the unconfirmed drops held during the current sortie.
for(let layer=1;layer<=100;layer++){
 const at=decadeEconomyRuns.map(run=>run.returns[layer-1]);
 const mean=fn=>Math.round(at.reduce((sum,row)=>sum+fn(row),0)/at.length*10)/10;
 const confirmed=mean(r=>r.stones),pending=mean(r=>r.pendingStones);
 const cumulative=mean(r=>r.stones+r.pendingStones);
 const spendHalf=mean(r=>Math.floor(r.stones/2));
 const afterHalf=mean(r=>r.stones-Math.floor(r.stones/2));
 console.log('STONE_ECONOMY_LAYER '+JSON.stringify({layer,
  recommendedLevel:targetClearLevel(layer),playerLevelDuringLayer:at[0].levelBefore,
  playerLevelAfterReturn:at[0].level,banked:confirmed,pending,
  earnedCumulative:cumulative,spentIfHalf:spendHalf,remainingIfHalf:afterHalf,
  justReturned:at[0].settled}));
}
for(const layer of [10,20,30,40,50,60,70,80,90,100]){
 const sorted=decadeEconomyRuns.map(run=>run.returns[layer-1].stones).sort((a,b)=>a-b);
 const example=decadeEconomyRuns[0].returns[layer-1];
 const mean=Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length*10)/10;
 console.log('STONE_ECONOMY_DECADE '+JSON.stringify({layer,levelBefore:example.levelBefore,
  levelAfterReturn:example.level,targetClearLevel:targetClearLevel(layer),
  meanEarned:mean,p10:sorted[12],median:sorted[64],p90:sorted[115],
  model:'return-at-10/20/...;rank-unlock-assumed;no-spending'}));
}
for(const target of [20,30,50,70,90,100]){
 const result=summarize({name:'On-curve / '+(target-9)+'-'+target+' layers',level:'forecast',
  fromLayer:target-9,toLayer:target,spells:'five',stones:'earned',stoneUse:.5},32);
 console.log('STONE_ON_CURVE_COMBAT '+JSON.stringify(result));
}
// Recovery-rate grid is evaluated against a realistic range of stone use.
// Exact stage levels in these comparisons are boss-target benchmark levels;
// the separate STONE_ON_CURVE_COMBAT probes entry at the actual XP forecast.
const diagnosticBands=scenarios.filter(x=>x.stones==='earned'&&[37,55,72,87,102,139,150].includes(x.level));
for(const rate of [0,.2,.35,.5,.65,.75,.87]){
 for(const band of diagnosticBands){
  const result=summarize({...band,stoneUse:.5,mpRecoveryFactor:rate},32);
  console.log('STONE_MP_GRID '+JSON.stringify({rate,stoneUse:.5,level:band.level,fromLayer:band.fromLayer,
   toLayer:band.toLayer,winRate:result.winRate,mpPercent:result.avgMpPercent,
   cleared:result.avgCleared,earned:result.avgStones,spent:result.avgSpentStones}));
 }
}
const boundaryCandidates={
 37:[.67,.69,.7,.72],55:[.57,.6,.62,.65],72:[.53,.56,.59,.62],
 87:[.40,.43,.46,.49],102:[.35,.38,.41,.44],
 115:[.27,.3,.33,.36],128:[.24,.27,.30,.33],
 139:[.15,.18,.21,.24],150:[.15,.18,.21,.24]};
for(const [key,rates] of Object.entries(boundaryCandidates)){
 const config=scenarios.find(x=>x.level===Number(key)&&x.stones==='earned');
 for(const rate of rates){
  const result=summarize({...config,stoneUse:.5,mpRecoveryFactor:rate},32);
  console.log('STONE_MP_BOUNDARY '+JSON.stringify({level:config.level,fromLayer:config.fromLayer,
   toLayer:config.toLayer,rate,winRate:result.winRate,mpPercent:result.avgMpPercent}));
 }
}
const depthCurves=[
 {name:'gentle',points:[[1,1],[10,1],[20,.74],[30,.68],[40,.62],[50,.53],[60,.48],[70,.39],[80,.34],[90,.25],[100,.22]]},
 {name:'medium',points:[[1,1],[10,1],[20,.71],[30,.63],[40,.58],[50,.47],[60,.42],[70,.33],[80,.29],[90,.20],[100,.17]]},
 {name:'hard',points:[[1,1],[10,1],[20,.68],[30,.60],[40,.55],[50,.43],[60,.37],[70,.30],[80,.25],[90,.17],[100,.14]]}
];
for(const curve of depthCurves){
 for(const band of scenarios.filter(x=>x.stones==='earned')){
  const result=summarize({...band,stoneUse:.5,mpRecoveryFactor:curve.points},32);
  console.log('STONE_MP_DEPTH_CURVE '+JSON.stringify({curve:curve.name,level:band.level,
   fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse:.5,
   winRate:result.winRate,mpPercent:result.avgMpPercent,avgCleared:result.avgCleared}));
 }
}
// Aggressive no-regen depth policies, with 50% and 100% invested stone budgets.
// These are deliberately stress-test alternatives, not adopted production values.
const zeroCurves=[
 {name:'zero90',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,0],[100,0]]},
 {name:'zero70',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,0],[80,0],[90,0],[100,0]]},
 {name:'zero50',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,0],[60,0],[70,0],[80,0],[90,0],[100,0]]}
];
for(const curve of zeroCurves){
 for(const stoneUse of [.5,1]){
  for(const band of scenarios.filter(x=>x.stones==='earned')){
   const result=summarize({...band,stoneUse,mpRecoveryFactor:curve.points},32);
   console.log('STONE_MP_ZERO_CURVE '+JSON.stringify({curve:curve.name,level:band.level,
    fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse,winRate:result.winRate,
    mpPercent:result.avgMpPercent,avgCleared:result.avgCleared,avgSpentStones:result.avgSpentStones}));
  }
 }
}
// Where to stop victory regeneration entirely? Bracket a late shutdown.
const depthZeroCandidates=[
 {name:'zero95',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[95,0],[100,0]]},
 {name:'zero100',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[99,.20],[100,0]]},
 {name:'nearZero100',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[100,.08]]}
];
for(const curve of depthZeroCandidates){
 for(const stoneUse of [.5,.75,1]){
  for(const band of scenarios.filter(x=>x.stones==='earned'&&[128,139,150].includes(x.level))){
   const result=summarize({...band,stoneUse,mpRecoveryFactor:curve.points},64);
   console.log('STONE_MP_ZERO_ONSET '+JSON.stringify({curve:curve.name,level:band.level,
    fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse,
    winRate:result.winRate,mpPercent:result.avgMpPercent,
    avgSpentStones:result.avgSpentStones,avgCleared:result.avgCleared}));
  }
 }
}
for(const stoneUse of [.5,.75,1]){
 for(const band of scenarios.filter(x=>x.stones==='earned'&&[37,55,87,115,139,150].includes(x.level))){
  const result=summarize({...band,stoneUse,mpRecoveryFactor:zeroCurves[0].points},128);
  console.log('STONE_MP_ZERO128 '+JSON.stringify({curve:'zero90',level:band.level,
   fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse,
   winRate:result.winRate,mpPercent:result.avgMpPercent,
   avgSpentStones:result.avgSpentStones,avgCleared:result.avgCleared}));
 }
}
const lateZeroOnsets=[96,97,98,99];
for(const zeroFrom of lateZeroOnsets){
 const points=[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],
  [60,.43],[70,.34],[80,.29],[90,.23],[zeroFrom,0],[100,0]];
 for(const stoneUse of [.5,.75,1]){
  for(const level of [139,150]){
   const band=scenarios.find(x=>x.level===level&&x.stones==='earned');
   const result=summarize({...band,stoneUse,mpRecoveryFactor:points},128);
   console.log('STONE_MP_ZERO_FINE '+JSON.stringify({zeroFrom,stoneUse,level,
    winRate:result.winRate,mpPercent:result.avgMpPercent,avgCleared:result.avgCleared,
    avgSpentStones:result.avgSpentStones}));
  }
 }
}
const zero97Policy=[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],
 [60,.43],[70,.34],[80,.29],[90,.23],[97,0],[100,0]];
for(const stoneUse of [.5,.75,1]){
 for(const level of [37,55,72,87,102,115,128,139,150]){
  const band=scenarios.find(x=>x.level===level&&x.stones==='earned');
  const result=summarize({...band,stoneUse,mpRecoveryFactor:zero97Policy},128);
  console.log('STONE_MP_ZERO97_FULL '+JSON.stringify({level,stoneUse,
   winRate:result.winRate,mpPercent:result.avgMpPercent,
   earned:result.avgStones,spent:result.avgSpentStones,cleared:result.avgCleared}));
 }
}
for(const startLayer of [11,21,41,61,81,91]){
 for(const stoneUse of [.5,.75,1]){
  const band={name:'On-curve '+startLayer+'-'+(startLayer+9),level:'forecast',
   fromLayer:startLayer,toLayer:startLayer+9,spells:'five',stones:'earned',stoneUse,
   mpRecoveryFactor:zero97Policy};
  const result=summarize(band,128);
  console.log('STONE_MP_ZERO97_ONCURVE '+JSON.stringify({startLayer,stoneUse,
   forecastLevelAtEntry:result.forecastLevelAtEntry,winRate:result.winRate,
   mpPercent:result.avgMpPercent,earned:result.avgStones,
   spent:result.avgSpentStones,cleared:result.avgCleared}));
 }
}
const onCurveLateRecovery=[
 ['zero97',.23,0,97],
 ['zero100',.23,0,100],
 ['flat23',.23,.23,100],
 ['flat35',.35,.30,100],
 ['flat45',.45,.40,100],
 ['flat55',.55,.50,100],
 ['flat65',.65,.60,100],
 ['flat75',.75,.70,100]
];
for(const [curveName,rate90,rateEnd,layerEnd] of onCurveLateRecovery){
 const policy=[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],
  [60,.43],[70,.34],[80,.29],[90,rate90],[layerEnd,rateEnd],[100,rateEnd]];
 for(const stoneUse of [.75,1]){
  const onCurve=summarize({name:'forecast-Lv141 / 91-100F',level:'forecast',
   fromLayer:91,toLayer:100,spells:'five',stones:'earned',stoneUse,
   mpRecoveryFactor:policy},128);
  const target=scenarios.find(x=>x.level===150&&x.stones==='earned');
  const atTarget=summarize({...target,stoneUse,mpRecoveryFactor:policy},128);
  console.log('STONE_MP_ONCURVE_SWEEP '+JSON.stringify({curveName,stoneUse,
   forecastLevel:onCurve.forecastLevelAtEntry,oncurveWinRate:onCurve.winRate,
   oncurveMpPercent:onCurve.avgMpPercent,level150WinRate:atTarget.winRate,
   level150MpPercent:atTarget.avgMpPercent}));
 }
}
// Final boss (fight 500): count actual combat rounds, not the entire 10-layer trek.
// Include all attempts that reach the boss; give a separate distribution for wins.
const bossPolicies=[
 {name:'zero97',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[97,0],[100,0]]},
 {name:'zero99',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[99,0],[100,0]]},
 {name:'flat35',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],[50,.49],[60,.43],[70,.34],[80,.29],[90,.35],[100,.30]]}
];
for(const policy of bossPolicies){
 for(const stoneUse of [.5,.75,1]){
  for(const entryLevel of [150,'forecast']){
   const config={level:entryLevel,fromLayer:91,toLayer:100,spells:'five',
    stones:'earned',stoneUse,mpRecoveryFactor:policy.points};
   const sims=Array.from({length:128},(_,i)=>simulate(17011+i*13,config));
   const bossFights=sims.map(run=>run.fightStats.find(f=>f.fight===500)).filter(Boolean);
   const wins=bossFights.filter(f=>f.win);
   const sorted=wins.map(f=>f.turns).sort((a,b)=>a-b);
   const hist=Object.entries(wins.reduce((m,f)=>(m[f.turns]=(m[f.turns]||0)+1,m),{}))
    .sort((a,b)=>Number(a[0])-Number(b[0]));
   const avg=wins.length?Math.round(wins.reduce((total,f)=>total+f.turns,0)*10/wins.length)/10:null;
   console.log('FINAL_BOSS_500_TURNS '+JSON.stringify({policy:policy.name,stoneUse,
    entryLevel:entryLevel==='forecast'?sims[0].startLevel:entryLevel,
    attempts:sims.length,reachBoss:bossFights.length,bossWins:wins.length,
    meanTurns:avg,minTurns:sorted[0]??null,medianTurns:sorted[Math.floor(sorted.length/2)]??null,
    maxTurns:sorted.at(-1)??null,turnHistogram:hist}));
  }
 }
}
// The user's question is about the 100F boss itself, not the entire 91-100F expedition.
// 'turns' counts player/enemy combat exchanges, one player action per turn.
const bossTurnPolicies=[
 {name:'zero97',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],
  [50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[97,0],[100,0]]},
 {name:'zero100',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],
  [50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[100,0]]},
 {name:'flat23',points:[[1,1],[10,1],[20,.72],[30,.65],[40,.58],
  [50,.49],[60,.43],[70,.34],[80,.29],[90,.23],[100,.23]]}
];
for(const policy of bossTurnPolicies){
 for(const level of [150,'forecast']){
  for(const stoneUse of [.5,.75,1]){
   const runs=Array.from({length:128},(_,i)=>simulate(17011+i*13,{
    level,fromLayer:91,toLayer:100,spells:'five',stones:'earned',stoneUse,
    mpRecoveryFactor:policy.points}));
   const atBoss=runs.filter(x=>x.fightStats.at(-1)?.fight===500);
   const victories=atBoss.filter(x=>x.win);
   const turns=victories.map(x=>x.fightStats.at(-1).turns).sort((a,b)=>a-b);
   const allBossTurns=atBoss.map(x=>x.fightStats.at(-1).turns);
   const pct=i=>turns.length?turns[Math.floor((turns.length-1)*i)]:null;
   const avg=xs=>xs.length?Math.round(10*xs.reduce((a,b)=>a+b,0)/xs.length)/10:null;
   console.log('STONE_BOSS100_TURNS '+JSON.stringify({
    policy:policy.name,level,stoneUse,cleared: victories.length,
    reachedBoss:atBoss.length,samples:runs.length,
    bossWinRateAmongReached:atBoss.length?Math.round(100*victories.length/atBoss.length):null,
    meanTurnsOnWin:avg(turns),medianTurnsOnWin:pct(.5),
    p10TurnsOnWin:pct(.1),p90TurnsOnWin:pct(.9),
    minTurnsOnWin:turns[0]??null,maxTurnsOnWin:turns.at(-1)??null,
    avgBossTurnsAllAttempts:avg(allBossTurns),
    avgMpBeforeBoss:avg(atBoss.map(x=>x.fightStats.at(-1).mpBefore))
   }));
  }
 }
}
// Release-candidate verification: deliberately omit mpRecoveryFactor so this
// exercises the exact default curve exported by dungeon-core.mjs and used by the app.
// Counts are 128 independent seeded combat runs per selected band.
for(const stoneUse of [.5,.75,1]){
 for(const band of scenarios.filter(x=>x.stones==='earned')){
  const result=summarize({...band,stoneUse},128);
  console.log('RECOMMENDED_MP_REVIEW '+JSON.stringify({level:band.level,
   fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse,
   winRate:result.winRate,mpPercent:result.avgMpPercent,earned:result.avgStones,
   spent:result.avgSpentStones,cleared:result.avgCleared}));
 }
}
for(const startLayer of [11,21,41,61,81,91]){
 for(const stoneUse of [.5,.75,1]){
  const cfg={name:'Actual XP trajectory',level:'forecast',fromLayer:startLayer,
   toLayer:startLayer+9,spells:'five',stones:'earned',stoneUse};
  const result=summarize(cfg,128);
  console.log('RECOMMENDED_MP_ONCURVE '+JSON.stringify({startLayer,
   forecastLevelAtEntry:result.forecastLevelAtEntry,stoneUse,
   winRate:result.winRate,mpPercent:result.avgMpPercent,
   earned:result.avgStones,spent:result.avgSpentStones,cleared:result.avgCleared}));
 }
}
const actualLast=summarize({name:'Actual XP final',level:'forecast',
 fromLayer:91,toLayer:100,spells:'five',stones:'earned',stoneUse:.75},128);
assert.ok(actualLast.winRate>=70,'recommended MP recovery curve needs at least 70% clears from forecast level at 91F, with 75% earned-stone upgrades');
assert.ok(actualLast.avgMpPercent<=25,'recommended curve should leave <=25% MP at the final boss');
// Base case is one clear of each 10-layer milestone. Also repeat the frontier
// layer 2, 5, and 10 extra times after each rank milestone: the drop penalty
// grows as the character overlevels, so extra runs do not yield 1.5 stones each.
for(const extraRuns of [0,2,5,10]){
 const ledgers=Array.from({length:128},(_,i)=>stoneFarmingLedger(99173+i*73,90,extraRuns));
 const sorted=ledgers.map(x=>x.stones).sort((a,b)=>a-b);
 const mean=k=>Math.round(10*ledgers.reduce((a,x)=>a+x[k],0)/ledgers.length)/10;
 console.log('FARMING_STONE_ECONOMY '+JSON.stringify({extraRunsPerDecade:extraRuns,
  totalFarmBattles:mean('farmBattles'),meanEarned:mean('stones'),
  meanFarmStones:mean('earnedFromFarming'),p10:sorted[12],
  median:sorted[64],p90:sorted[115],meanLevelAfter90:mean('level')}));
}
for(const extraRuns of [0,2,5,10]){
 for(const entryLevel of [150,'forecast']){
  for(const band of scenarios.filter(x=>x.stones==='earned'&&[37,55,87,115,139,150].includes(x.level))){
   const result=summarize({...band,level:entryLevel==='forecast'?'forecast':band.level,
    stoneUse:1,farmRunsPerDecade:extraRuns},128);
   console.log('FARMING_100_PERCENT_COMBAT '+JSON.stringify({
    extraRunsPerDecade:extraRuns,entryLevel:entryLevel==='forecast'?'forecast':'target',
    targetLevel:band.level,fromLayer:band.fromLayer,toLayer:band.toLayer,
    forecastLevel:result.forecastLevelAtEntry,
    winRate:result.winRate,mpPercent:result.avgMpPercent,
    earned:result.avgStones,farmStones:result.avgFarmStones,
    spent:result.avgSpentStones,avgCleared:result.avgCleared}));
  }
 }
}
for(const band of scenarios.filter(x=>x.stones==='earned')){
 const result=summarize({...band,stoneUse:.25,mpRecoveryFactor:depthCurves[1].points},32);
 console.log('STONE_MP_DEPTH_STRESS '+JSON.stringify({curve:'medium',level:band.level,
  fromLayer:band.fromLayer,toLayer:band.toLayer,stoneUse:.25,winRate:result.winRate,
  mpPercent:result.avgMpPercent,avgCleared:result.avgCleared}));
}
for(const config of scenarios.filter(x=>x.stones==='earned'&&[37,55,87,150].includes(x.level))){
 for(const stoneUse of [0,.5,1]){
  const result=summarize({...config,stoneUse},32);
  console.log('STONE_COMBAT_SENSITIVITY '+JSON.stringify({name:config.name,stoneUse,...result}));
 }
}

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
const noStoneEndgame=summarize({...scenarios.find(x=>x.level===150&&x.stones==='earned'),stones:'none'});
assert.ok(noStoneEndgame.avgMpPercent<=25,'unupgraded reference should be close in MP');
const ledger=stoneLedger(7293,10);
console.log('MAGIC_STONE_LEDGER '+JSON.stringify({throughLayer:10,level:ledger.level,stones:ledger.stones,
 levels:ledger.levels,returns:ledger.returns}));
assert.ok(scenarios.every(x=>x.fromLayer<=x.toLayer),'scenarios cover consecutive layer bands');
assert.equal(simulate(1,{level:1,fromLayer:1,toLayer:1,spells:'beginner'}).spentStones,0);
assert.ok(upgradeSpells(SPELLS.five,10).spells.every((s,i)=>s.power>=SPELLS.five[i].power));
assert.ok(upgradeSpells(SPELLS.five,80).costs.every((mp,i)=>mp===G.mpCost(SPELLS.five[i].power)),'upgraded spells must retain original MP cost');
assert.equal(G.magicStoneDropChance(targetClearLevel(30),30),.3);
assert.equal(G.magicStoneDropChance(targetClearLevel(30)+1,30),.15);
assert.equal(stoneLedger(1,0).stones,0);
for(const sample of [1,7293,8191]){
 const standard=stoneLedger(sample,90,10);
 const farm0=stoneFarmingLedger(sample,90,0);
 assert.equal(farm0.stones,standard.stones,'zero farming must preserve natural stone supply');
 assert.equal(farm0.level,standard.level,'zero farming must preserve natural XP level');
}
assert.equal(stoneLedger(1,10,10).returns.filter(x=>x.settled).length,1,'ten-layer return policy settles exactly once');
assert.ok(ledger.stones>0,'stones are banked across completed checkpoints');
assert.ok(ledger.levels.every(x=>x.to>x.from),'level ups require accumulated XP');
assert.ok(ledger.levels.every((x,i)=>i===0||x.stones>=ledger.levels[i-1].stones),'stone bank is never debited before upgrades');
assert.ok(ledger.returns.every((x,i)=>i===0||x.level>=ledger.returns[i-1].level),'return-only levels are monotonic');
console.log('PASS seeded full combat with resource carryover, tenth-layer HP/MP recovery, saved reward ledger and permanent stone upgrades');
