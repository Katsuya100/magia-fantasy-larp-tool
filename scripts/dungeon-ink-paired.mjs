// Paired, seeded real-combat evaluation of continuing one existing circle
// versus a new circle drawn to the SAME original quality using owned magic ink.
// Does not transfer past upgrades, hand out ink/stones, or assert that drawing
// this base-power circle is guaranteed. Full additional-farming comparison
// remains an independent mandatory gap until simulated.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {enemyForFight} from '../assets/js/dungeon-design.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {strengthenedPower,totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {inkEnhancedAnalysis} from '../assets/js/dungeon-ink.mjs';
import {rng,spread} from './simulate-dungeon-journeys.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const MAX_SAMPLES=256,SEED_BASE=17011;
const economics=read('reports/dungeon-journeys-v1.json');
const powerRecovery=read('reports/dungeon-ink-recovery-v1.json');
const goals=read('config/dungeon-approved-goals.v1.json');
if(goals.strictSamples!==MAX_SAMPLES)throw Error('Approved 256 paired seeds required');
const choose=(hero,enemy,layer)=>{
 const ids=G.available(hero),heal=layer>=11?ids.find(i=>hero.spells[i].role==='support'):undefined;
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const attacks=ids.filter(i=>hero.spells[i].role==='attack');
 if(attacks.length)return attacks.sort((a,b)=>{
  const power=i=>G.effectivePower(hero,hero.spells[i])*G.resist(enemy,hero.spells[i].attribute);
  return power(b)-power(a)||a-b;
 })[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
};
function cleanse(hero,items,layer){
 if(layer<51)return null;
 const effect=hero.statuses.find(s=>s.kind==='debuff');
 if(!effect)return null;
 let index=items.findIndex(x=>x.id==='clear_'+effect.attribute&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(index<0&&layer>=71)index=items.findIndex(x=>x.id==='luna_stone'&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(index<0)return null;
 const item=items[index];G.potion(hero,item,data.items,data.buffs);
 items.splice(index,1);
 return item.id;
}
function fightSortie(snapshot,changedCircles,start,seed){
 const random=rng(seed),hero=G.makeUnit(snapshot.playerBase,snapshot.level,{},
  changedCircles.map(c=>({role:c.role,attribute:c.attribute,
   power:strengthenedPower(c.basePower,c.upgradeLevel),basePower:c.basePower})),'player');
 const carry=snapshot.carry.map(item=>({...item}));
 const stats={win:false,reached:start,cleared:start-1,winFights:0,
  mp:0,hp:0,casts:0,healCasts:0,itemsUsed:{},minMp:hero.maxMp};
 for(let layer=start;layer<start+10;layer++){
  stats.reached=layer;
  for(let slot=1;slot<=5;slot++){
   const fight=(layer-1)*5+slot;
   const enemy=G.fromEnemy(enemyForFight(data.enemies,fight,random),
    Number(data.floors[fight-1].enemy_level));
   let won=false;
   for(let turn=0;turn<80;turn++){
    const used=cleanse(hero,carry,layer);
    if(used)stats.itemsUsed[used]=(stats.itemsUsed[used]||0)+1;
    const ours=choose(hero,enemy,layer),theirs=G.chooseEnemySpell(enemy,random);
    if(ours>=0&&hero.spells[ours].role==='support')stats.healCasts++;
    G.round(hero,enemy,ours,theirs,data.buffs,random);
    stats.casts++;
    stats.minMp=Math.min(stats.minMp,hero.mp);
    if(hero.hp<=0)break;
    if(enemy.hp<=0){won=true;break;}
   }
   if(!won)return {...stats,mp:100*hero.mp/hero.maxMp,hp:100*hero.hp/hero.stats.hp};
   stats.winFights++;
   hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
   G.recoverVictoryMp(hero,layer);
  }
  stats.cleared=layer;
 }
 stats.win=true;
 return {...stats,mp:100*hero.mp/hero.maxMp,hp:100*hero.hp/hero.stats.hp};
}
function plan(snapshot){
 if(snapshot.bankedInk<5)return {reason:'insufficient real magic ink'};
 if(snapshot.circles.length!==5||snapshot.circles[0].role!=='attack')
  return {reason:'not the fixed five-circle attack reference'};
 // The new circle has the same authored drawing quality, not an RNG jackpot.
 const old=snapshot.circles[0],enhanced=inkEnhancedAnalysis({power:old.basePower},5).power;
 const keep=snapshot.circles.map(c=>({...c}));
 const redraw=keep.map(c=>({...c}));
 redraw[0]={...old,basePower:enhanced,upgradeLevel:0,power:enhanced,ink:5};
 const prior=old.power;
 let upgrades=0;
 while(upgrades<500&&strengthenedPower(enhanced,upgrades)<prior)upgrades++;
 return {keep,redraw,inkUsed:5,stoneUsedNow:0,lostCircles:old.upgradeLevel>0?1:0,
  sunkStoneCost:totalUpgradeStoneCost(old.upgradeLevel),
  oldPower:prior,oldMpCost:G.mpCost(old.basePower),
  redrawnPower:enhanced,redrawnMpCost:G.mpCost(enhanced),
  stonesNeededToMatchOldPower:totalUpgradeStoneCost(upgrades),
  upgradesNeededToMatchOldPower:upgrades,
  remainingInk:snapshot.bankedInk-5,
  drawQualityAssumption:'new original raw power equals existing original raw power, explicitly not guaranteed by RNG'};
}
const report={schemaVersion:'dungeon-ink-paired-v1',samples:MAX_SAMPLES,seedRule:'17011+13*i',
 economicsSource:economics.schemaVersion,economySeed:economics.seed,
 policies:{draw:'same original quality as a known circle',replacement:'slot 1 attacker, no old upgrade transfer',
 resource:'both arms start from same actual banked inventory; 5 ink required, no free stones or items',
 combat:'10 consecutive real layers, 50 fights at a fixed pre-return level; same combat RNG per pair'},
 cases:[],requirements:{continueRational:false,redrawRational:false,
 fullOpportunityCostMeasured:false,powerRecoveryFarmingMeasured:false},unmet:[],warnings:[]};
for(const route of ['short','long']){
 const group=economics.combinations.find(x=>x.style==='A'&&x.route===route);
 if(!group||!group.comparisonStates)throw Error('Missing actual economic account states '+route);
 for(const start of [11,21,31,51,71,91]){
  const candidates=group.comparisonStates.map(x=>({seed:x.seed,snapshot:x.snapshots[start]}))
   .filter(x=>x.snapshot&&x.snapshot.bankedInk>=5);
  // Median observed account (not independent median stats mashed together).
  candidates.sort((a,b)=>a.snapshot.level-b.snapshot.level||
   a.snapshot.bankedStones-b.snapshot.bankedStones||a.seed-b.seed);
  const source=candidates[Math.floor((candidates.length-1)/2)];
  if(!source){
   report.cases.push({route,from:start,to:start+9,
    status:'UNAVAILABLE',eligibleAccounts:0,outOf:group.comparisonStates.length,
    reason:'No observed owner holds 5 magic ink at that point'});
   continue;
  }
  const p=plan(source.snapshot);
  if(p.reason)throw Error('Bad pair setup: '+p.reason);
  const pairs=Array.from({length:MAX_SAMPLES},(_,i)=>{
   const combatSeed=SEED_BASE+13*i;
   const keep=fightSortie(source.snapshot,p.keep,start,combatSeed);
   const redraw=fightSortie(source.snapshot,p.redraw,start,combatSeed);
   return {seed:combatSeed,keep,redraw};
  });
  const summary=variant=>{
   const result=pairs.map(x=>x[variant]),wins=result.filter(x=>x.win);
   return {wins:wins.length,winRate:100*wins.length/MAX_SAMPLES,
    winnerHp:spread(wins.map(x=>x.hp)),winnerMp:spread(wins.map(x=>x.mp)),
    fightsWon:spread(result.map(x=>x.winFights)),cleansersUsed:result.reduce((sum,x)=>
     sum+Object.values(x.itemsUsed).reduce((a,b)=>a+b,0),0)};
  };
  const continuous=summary('keep'),replacement=summary('redraw');
  const winImprovement=replacement.winRate-continuous.winRate;
  const hpImprovement=(replacement.winnerHp.median??0)-(continuous.winnerHp.median??0);
  const mpImprovement=(replacement.winnerMp.median??0)-(continuous.winnerMp.median??0);
  // No arbitrary combined score: compare battle vectors and explicit cost.
  const combatUpgrade=winImprovement>0||(winImprovement===0&&
   (hpImprovement>0||mpImprovement>0));
  const combatDowngrade=winImprovement<0||(winImprovement===0&&
   hpImprovement<=0&&mpImprovement<=0);
  if(combatUpgrade)report.requirements.redrawRational=true;
  if(combatDowngrade)report.requirements.continueRational=true;
  const cost=powerRecovery.studied.find(x=>x.route===route&&x.layer===start&&x.samples);
  if(!cost||cost.referenceSeed!==source.seed)throw Error('Recovery is not for the same owner state');
  const row={route,from:start,to:start+9,status:'MEASURED',
   initialState:{seed:source.seed,level:source.snapshot.level,bankedInk:source.snapshot.bankedInk,
    bankedStone:source.snapshot.bankedStones,spentStone:source.snapshot.spent.stone,
    ownedCarry:source.snapshot.carry.map(x=>x.id)},
   eligibleAccounts:candidates.length,outOf:group.comparisonStates.length,
   opportunity:{inkConsumed:5,stoneConsumedNow:0,priorStoneSunk:p.sunkStoneCost,
    oldUpgradesLost:p.lostCircles,additionalStoneToMatchOldPower:p.stonesNeededToMatchOldPower,
    additionalCombatFightsForReacquisition:null,additionalSortiesForReacquisition:null},
   spells:{oldPower:p.oldPower,oldMpCost:p.oldMpCost,
    newPower:p.redrawnPower,newMpCost:p.redrawnMpCost},
   keep:continuous,redraw:replacement,
   tradeoff:{winRateDelta:winImprovement,hpMedianDelta:hpImprovement,
    mpMedianDelta:mpImprovement,combatUpgrade,combatDowngrade},
   economicPowerRecovery:{samples:cost.samples,successes:cost.successes,
    failedToRecover:cost.unsuccessful,extraFights:cost.distributions.extraFights,
    losses:cost.distributions.losses,additionalSorties:cost.distributions.sorties,
    extraStoneSpent:cost.distributions.stoneSpent,
    materialLimit:'Only a spell-power catch-up; not a certified 10-layer combat break-even'},
   drawQualityAssumption:p.drawQualityAssumption};
  report.cases.push(row);
  console.log('DUNGEON_INK_PAIR '+JSON.stringify(row));
 }
}
if(!report.requirements.continueRational)report.unmet.push('No observed state in which continuing is the better battle/economic choice');
if(!report.requirements.redrawRational)report.unmet.push('No observed state where ink redraw provides battle advantage');
report.requirements.powerRecoveryFarmingMeasured=report.cases.filter(x=>x.status==='MEASURED')
 .every(x=>x.economicPowerRecovery.samples>0);
report.unmet.push('Measured real replay cost to restore spell power, but equal-readiness combat performance and 1-3 circle redraw break-even are still unproven');
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-ink-paired-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('DUNGEON_INK_PAIRED_SUMMARY '+JSON.stringify({status:report.unmet.length?'NEEDS_TUNING':'PASS',
 measurable:report.cases.filter(x=>x.status==='MEASURED').length,
 requirements:report.requirements,unmet:report.unmet}));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Paired magic ink vs continued upgrades\n'+
 report.cases.map(r=>r.status!=='MEASURED'
  ?r.route+' '+r.from+'F: unavailable\n'
  :r.route+' '+r.from+'F: keep '+r.keep.winRate+'% / redraw '+r.redraw.winRate+
   '% ; ink -5, sunk stones '+r.opportunity.priorStoneSunk+
   ', p90 recovery fights '+r.economicPowerRecovery.extraFights.p90+'\n').join('')+
 '\nHard strategic proof remains **UNMET** without paired re-farming and break-even.\n');
if(report.unmet.length)process.exitCode=1;
