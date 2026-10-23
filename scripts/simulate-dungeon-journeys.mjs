// Seeded combat + banking model. Unlike simulate-dungeon-stones.mjs, never
// grants a victory, rank, recovery item, magic stone, or magic ink by fiat.
// The initial five spell powers are an explicitly named reference *assumption*;
// not a claim about every player-authored drawing.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {enemyForFight,targetClearLevel} from '../assets/js/dungeon-design.mjs';
import {allowedStartLayer,rankBadgeDrop,acquireAdventurerRank} from '../assets/js/dungeon-ranks.mjs';
import {upgradeStoneCost,strengthenedPower} from '../assets/js/dungeon-upgrades.mjs';
import {inkEnhancedAnalysis} from '../assets/js/dungeon-ink.mjs';

const csv=name=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const spells=[
 ['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]
];
export const ECONOMY_VERSION='journey-economy-v1-diagnostic';
export const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const quantile=(xs,p)=>{
 if(!xs.length)return null;
 const a=[...xs].sort((x,y)=>x-y),at=(a.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
 return a[lo]+(a[hi]-a[lo])*(at-lo);
};
export const spread=xs=>({p10:quantile(xs,.1),median:quantile(xs,.5),p90:quantile(xs,.9)});
export const investmentRate=layer=>layer<=10?.25:layer<=20?.25+(layer-10)*.05:.75;
const circle=(role,attribute,basePower,active=true)=>({role,attribute,basePower,upgrades:0,active,ink:0});
const actualPower=c=>strengthenedPower(c.basePower,c.upgrades);
const equipped=circles=>circles.filter(c=>c.active).map(c=>({
 role:c.role,attribute:c.attribute,power:actualPower(c),basePower:c.basePower,upgradeLevel:c.upgrades
}));
const percent=(value,max)=>max>0?100*value/max:null;
const chestSummary=p=>({level:p.level,rank:p.adventurerRank,xp:p.xp});

function chooseHero(hero,enemy,layer){
 const ready=G.available(hero);
 const heal=layer>10?ready.find(i=>hero.spells[i].role==='support'):undefined;
 if(heal!==undefined&&hero.hp/hero.stats.hp<.69)return heal;
 const attacks=ready.filter(i=>hero.spells[i].role==='attack');
 if(attacks.length)return attacks.sort((a,b)=>{
  const score=i=>G.effectivePower(hero,hero.spells[i])*G.resist(enemy,hero.spells[i].attribute);
  return score(b)-score(a)||a-b;
 })[0];
 return heal!==undefined&&hero.hp/hero.stats.hp<.9?heal:-1;
}
function cleanse(hero,carry,layer,usage){
 if(layer<51)return;
 const debuffs=hero.statuses.filter(x=>x.kind==='debuff');
 if(!debuffs.length)return;
 let i=carry.findIndex(x=>x&&x.id==='clear_'+debuffs[0].attribute&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(i<0&&layer>=71)i=carry.findIndex(x=>x&&x.id==='luna_stone'&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(i<0)return;
 const item=carry[i];
 G.potion(hero,item,data.items,data.buffs);
 carry[i]=null;usage[item.id]=(usage[item.id]||0)+1;
}
// Loadouts are selected only from real banked inventory, with the real
// level-dependent carry cap. No stocked-item fixture is smuggled into economy.
function pack(state,start){
 const allowable=item=>{
  const row=data.items.find(r=>r.id===item.id);
  return row&&(row.kind==='clear'&&start>=51||row.kind==='clear_all'&&start>=71);
 };
 const available=state.inventory.filter(allowable);
 available.sort((a,b)=>Number(a.id==='luna_stone')-Number(b.id==='luna_stone'));
 const count=Math.min(G.capacity(state.profile.level),available.length);
 const selected=available.slice(0,count);
 const chosen=new Set(selected.map(x=>x.instanceId));
 state.inventory=state.inventory.filter(x=>!chosen.has(x.instanceId));
 return selected;
}
function chooseUpgrade(state){
 const candidates=state.circles.filter(c=>['attack','support'].includes(c.role));
 if(!candidates.length)return null;
 // Split-stone journey spends deliberately on alternative non-equipped circles
 // until F30. Later it directs all new stones into the five equipped circles.
 const current=state.best+1;
 const eligible=state.style==='B'&&current<=30?candidates:candidates.filter(c=>c.active);
 const options=eligible.filter(c=>upgradeStoneCost(c.upgrades)<=state.stones);
 options.sort((a,b)=>{
  const score=c=>{
   const gain=G.basePower(strengthenedPower(c.basePower,c.upgrades+1))-G.basePower(actualPower(c));
   return (gain+.15)/(c.upgrades+1)**.25/upgradeStoneCost(c.upgrades);
  };
  return score(b)-score(a)||candidates.indexOf(a)-candidates.indexOf(b);
 });
 return options[0]||null;
}
function invest(state){
 const budget=Math.floor(state.earned.stone*investmentRate(Math.max(1,state.best+1))+1e-8);
 // A sunk upgrade is still counted as spent after a redraw.
 while(state.spent.stone<budget&&state.spent.stone+5<=state.earned.stone){
  const candidate=chooseUpgrade(state);if(!candidate)break;
  const cost=upgradeStoneCost(candidate.upgrades);
  if(cost>state.stones||state.spent.stone+cost>budget)break;
  candidate.upgrades++;state.stones-=cost;state.spent.stone+=cost;
 }
}
function considerInkRedraw(state){
 if(state.style!=='C'||state.best<30)return;
 const upgraded=state.circles.filter(c=>c.active);
 if(!upgraded.length||state.ink<5||state.replacements>=3)return;
 // Use a fixed, non-rerolled 250-power newly drawn spell: conservative and
 // transparent; no transferred stone levels, no free ink.
 const candidate=upgraded.sort((a,b)=>actualPower(a)-actualPower(b))[0];
 const used=5;
 const newBase=inkEnhancedAnalysis({power:250},used).power;
 const oldPower=actualPower(candidate);
 // Refuse to spend a rare material for a strictly inferior immediate spell.
 // Both strategy branches must still be assessed by a paired benchmark.
 if(newBase<=oldPower)return;
 state.ink-=used;state.spent.ink+=used;
 state.sunkCircles++;state.replacements++;
 state.circles[state.circles.indexOf(candidate)]={...circle(candidate.role,candidate.attribute,newBase),
  ink:used};
}
function commit(state,pending,unused,bestLayer){
 const p=state.profile;
 for(const reward of pending.loot){
  if(reward.type==='stone'){state.stones++;state.earned.stone++;}
  else if(reward.type==='ink'){state.ink++;state.earned.ink++;}
  else if(reward.type==='use')state.inventory.push({
   id:reward.id,value:reward.value,bonus:reward.bonus,
   instanceId:'item-'+(++state.itemSerial)
  });
  else if(reward.type==='collection')state.collection[reward.id]=(state.collection[reward.id]||0)+1;
  else if(reward.type==='rank'&&acquireAdventurerRank(p,reward.layer))state.rankGranted++;
 }
 state.inventory.push(...unused.filter(Boolean));
 G.experience(p,pending.xp);
 state.best=Math.max(bestLayer,state.best);
 state.returns++;
 invest(state);considerInkRedraw(state);
}
function battle(state,hero,layer,fight,carry,random,usage){
 const foe=enemyForFight(data.enemies,fight,random);
 const enemyLevel=Number(data.floors[fight-1]?.enemy_level??targetClearLevel(layer));
 const enemy=G.fromEnemy(foe,enemyLevel);
 let healCasts=0,enemyHealCasts=0,rounds=0,enemyDebuffs=0;
 while(hero.hp>0&&enemy.hp>0&&rounds<80){
  cleanse(hero,carry,layer,usage);
  const ours=chooseHero(hero,enemy,layer),theirs=G.chooseEnemySpell(enemy,random);
  if(ours>=0&&hero.spells[ours].role==='support')healCasts++;
  if(theirs>=0&&enemy.spells[theirs].role==='support')enemyHealCasts++;
  if(theirs>=0&&enemy.spells[theirs].role==='debuff')enemyDebuffs++;
  G.round(hero,enemy,ours,theirs,data.buffs,random);
  rounds++;
 }
 return {win:enemy.hp<=0&&hero.hp>0,foe,enemyLevel,rounds,healCasts,enemyHealCasts,enemyDebuffs};
}
export function runJourney(seed,{style='A',route='short',maxSorties=120,maxFights=10000}={}){
 if(!['A','B','C'].includes(style)||!['short','long'].includes(route))throw Error('Invalid journey');
 const random=rng(seed),profile={level:1,xp:0,adventurerRank:0};
 const state={style,route,profile,stones:0,ink:0,inventory:[],collection:{},
  circles:spells.map(([role,attribute,power])=>circle(role,attribute,power)),
  earned:{stone:0,ink:0},spent:{stone:0,ink:0},lost:{stone:0,ink:0,xp:0},
  best:0,returns:0,losses:0,sorties:0,fights:0,replayedFights:0,
  itemSerial:0,sunkCircles:0,replacements:0,rankChecks:0,rankGranted:0,
  entrySnapshots:{},
  healCasts:0,enemyHealCasts:0,enemyDebuffs:0,cleanseUses:{},trace:[],blockers:[],milestones:[],
  farmingFights:0};
 if(style==='B')state.circles.push(circle('attack','storm',300,false),circle('attack','aqua',290,false),circle('support','law',260,false));
 // D is the route axis; this permits A+D, B+D and C+D without
 // inventing a mutually exclusive 'D character'.
 for(let sortie=0;sortie<maxSorties&&state.best<100&&state.fights<maxFights;sortie++){
  const upcoming=state.best+1;
  const start=allowedStartLayer(profile,profile.adventurerRank+1);
  const goal=route==='short'?upcoming:100;
  const firstLevel=profile.level;
  const hero=G.makeUnit({hp:100,mag:10,def:7,res:7},firstLevel,{},equipped(state.circles),'hero');
  let pending={xp:0,loot:[]},lastClear=start-1,defeat=false;
  const carry=pack(state,start);
  const usage={};
  state.sorties++;
  for(let layer=start;layer<=goal&&state.fights<maxFights;layer++){
   if(layer%10===1&&!state.entrySnapshots[layer]){
    state.entrySnapshots[layer]={layer,sortie:state.sorties,level:firstLevel,
     targetLevel:targetClearLevel(Math.min(100,layer+9)),rank:profile.adventurerRank,
     xp:profile.xp,bankedStones:state.stones,bankedInk:state.ink,
     earned:{...state.earned},spent:{...state.spent},
     circles:state.circles.filter(c=>c.active).map(c=>({role:c.role,attribute:c.attribute,
      basePower:c.basePower,upgradeLevel:c.upgrades,power:actualPower(c),
      mpCost:G.mpCost(c.basePower),ink:c.ink})),
     carry:carry.map(item=>({id:item.id,value:item.value,bonus:item.bonus})),
     playerBase:{hp:100,mag:10,def:7,res:7},
     status:'FIRST_ENTRY_NOT_A_FIXED_BENCHMARK'};
   }
   let allWon=true;
   for(let slot=1;slot<=5;slot++){
    const fight=(layer-1)*5+slot;
    const outcome=battle(state,hero,layer,fight,carry,random,usage);
    state.fights++;
    if(layer<=state.best)state.replayedFights++;
    if(layer<=state.best&&style==='B')state.farmingFights++;
    state.healCasts+=outcome.healCasts;
    state.enemyHealCasts+=outcome.enemyHealCasts;
    state.enemyDebuffs+=outcome.enemyDebuffs;
    if(layer<=10&&(outcome.healCasts||outcome.enemyHealCasts))
     throw Error('Illegal 1-10F healing spell');
    if(!outcome.win){defeat=true;allWon=false;break;}
    const boss=slot===5?outcome.foe.id:null;
    const drops=G.drops(data.items,data.collections,outcome.enemyLevel,random,{
     layer,playerLevel:firstLevel,firstClear:layer>state.best,bossEnemyId:boss,
     favoredCollectionIds:outcome.foe.favored_collection_ids?.split('|')||[]});
    if(boss&&layer%10===0&&layer<=100){
     state.rankChecks++;
     const badge=rankBadgeDrop(fight,hero,profile,pending.loot);
     if(badge)drops.push(badge);
    }
    pending.loot.push(...drops);
    pending.xp=G.normalizeXp(pending.xp+G.fightExperience(outcome.enemyLevel,firstLevel,layer));
    hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
    G.recoverVictoryMp(hero,layer);
   }
   if(!allWon)break;
   lastClear=layer;
   if(layer%10===0){
    // Sample the boss outcome before granting the separately chosen
    // checkpoint recovery; never count full HP/MP as a boss rank award.
    state.milestones.push({layer,provisional:true,level:firstLevel,
     rank:profile.adventurerRank,stones:state.stones,ink:state.ink,
     bossExitHpPercent:percent(hero.hp,hero.stats.hp),
     bossExitMpPercent:percent(hero.mp,hero.maxMp),
     fights:state.fights});
    hero.hp=hero.stats.hp;hero.mp=hero.maxMp;
   }
   // Short journeys bank only AFTER reaching the intended new layer, not
   // after clearing the rank-gated route's first repeated layer.
   // Long journeys prefer a full decade of NEW layers, banking risky
   // unconfirmed loot at that milestone instead of assuming every win.
   if(route==='long'&&layer%10===0&&layer>=state.best+10)break;
   // A risk-aware long dive can still return at a completed layer when
   // resources become critical. These are strategy parameters, NOT new
   // acceptance thresholds for game balance.
   if(route==='long'&&(hero.hp/hero.stats.hp<.3||hero.mp/hero.maxMp<.2))break;
  }
  for(const [id,count] of Object.entries(usage))state.cleanseUses[id]=(state.cleanseUses[id]||0)+count;
  const earnedPending={stone:pending.loot.filter(x=>x.type==='stone').length,
   ink:pending.loot.filter(x=>x.type==='ink').length};
  if(defeat){
   state.losses++;state.lost.stone+=earnedPending.stone;
   state.lost.ink+=earnedPending.ink;state.lost.xp+=pending.xp;
   // The shipped game returns unused equipped items to the warehouse on defeat.
   state.inventory.push(...carry.filter(Boolean));
  }else if(lastClear>=start){
   commit(state,pending,carry,lastClear);
  }else state.inventory.push(...carry.filter(Boolean));
  state.trace.push({sortie:state.sorties,start,goal,cleared:lastClear,defeat,
   levelBefore:firstLevel,levelAfter:profile.level,rank:profile.adventurerRank,
   gainedPending:earnedPending,banked:!defeat,stone:state.stones,ink:state.ink,
   usedItems:usage,fights:state.fights,returned:!defeat,
   hpPercent:percent(hero.hp,hero.stats.hp),mpPercent:percent(hero.mp,hero.maxMp)});
  // B uses repeated wins as the only stone repair route, not a free redraw.
  // Revisiting is already counted by the rank-dependent legal start floor.
  if(state.trace.length>=3){
   const last=state.trace.at(-1),two=state.trace.at(-2),three=state.trace.at(-3);
   if(last.cleared<=two.cleared&&two.cleared<=three.cleared&&last.levelAfter===three.levelAfter
    &&state.stones<5)state.blockers.push('No effective combat progression or affordable upgrade across three sorties');
  }
 }
 if(state.best<100)state.blockers.push('Failed to clear 100F within measured sortie/fight budget (diagnostic cap, not a passing condition)');
 const invested=state.circles.map(c=>({active:c.active,role:c.role,attribute:c.attribute,basePower:c.basePower,
  upgradeLevel:c.upgrades,power:actualPower(c),mpCost:G.mpCost(c.basePower),ink:c.ink}));
 const stoneReconciled=state.earned.stone-state.spent.stone-state.stones;
 const inkReconciled=state.earned.ink-state.spent.ink-state.ink;
 if(stoneReconciled!==0||inkReconciled!==0)throw Error('Resource conservation violated');
 return {seed,style,route,profile:chestSummary(profile),best:state.best,
  sorties:state.sorties,returns:state.returns,losses:state.losses,fights:state.fights,
  replayedFights:state.replayedFights,farmingFights:state.farmingFights,
  earned:state.earned,spent:state.spent,lost:state.lost,balances:{stone:state.stones,ink:state.ink},
  inventory:state.inventory.length,collection:state.collection,circles:invested,
  sunkCircles:state.sunkCircles,replacements:state.replacements,
  healCasts:state.healCasts,enemyHealCasts:state.enemyHealCasts,
  enemyDebuffs:state.enemyDebuffs,cleanseUses:state.cleanseUses,
  rankChecks:state.rankChecks,rankGranted:state.rankGranted,
  trace:state.trace,milestones:state.milestones,entrySnapshots:state.entrySnapshots,blockers:state.blockers};
}
export function summarizeJourneys(samples=16,seed=20261024){
 if(!Number.isSafeInteger(samples)||samples<1||samples>512)throw Error('Invalid economy sample count');
 const combinations=['A','B','C'].flatMap(style=>['short','long'].map(route=>({style,route})));
 const all=combinations.map(({style,route})=>{
  const runs=Array.from({length:samples},(_,i)=>runJourney(seed+7919*i,{style,route}));
  const metrics=['best','sorties','returns','losses','fights','replayedFights','farmingFights','rankGranted','healCasts','replacements'];
  const distributions=Object.fromEntries(metrics.map(name=>[name,spread(runs.map(x=>x[name]))]));
  for(const type of ['stone','ink']){
   for(const field of ['earned','spent','lost','balances']){
    distributions[field+'.'+type]=spread(runs.map(x=>x[field][type]));
   }
  }
  const checkpoints=Array.from({length:10},(_,i)=>(i+1)*10).map(layer=>{
   const reached=runs.map(r=>r.trace.find(t=>t.cleared>=layer&&!t.defeat)).filter(Boolean);
   const prepared=runs.map(r=>r.entrySnapshots[layer-9]).filter(Boolean);
   return {layer,reached:reached.length,
    level:spread(reached.map(x=>x.levelAfter)),levelGap:spread(reached.map(x=>x.levelAfter-targetClearLevel(layer))),
    stone:spread(reached.map(x=>x.stone)),ink:spread(reached.map(x=>x.ink)),
    fights:spread(reached.map(x=>x.fights)),
    firstEntry:{count:prepared.length,
     level:spread(prepared.map(x=>x.level)),
     levelGap:spread(prepared.map(x=>x.level-x.targetLevel)),
     stoneBalance:spread(prepared.map(x=>x.bankedStones)),
     inkBalance:spread(prepared.map(x=>x.bankedInk)),
     upgrades:[0,1,2,3,4].map(i=>spread(prepared.map(x=>x.circles[i]?.upgradeLevel??0))),
     powers:[0,1,2,3,4].map(i=>spread(prepared.map(x=>x.circles[i]?.power??0)))}};
  });
  return {style,route,samples,distributions,checkpoints,completed:runs.filter(x=>x.best>=100).length,
   blocked:runs.length-runs.filter(x=>x.best>=100).length,examples:runs.slice(0,2)};
 });
 return {schemaVersion:ECONOMY_VERSION,seed,samples,alchemy:'off',
  assumptions:{circles:spells,referenceBase:{hp:100,mag:10,def:7,res:7},
   preparation:'only banked resources; combat uses shipped rules; no HP/MP or revival items',
   cleansers:'only real drops, prepared at start; specific 51F+, Luna Stone 71F+',
   noRankGuarantee:true,defeat:'unbanked loot+XP lost; unused carried items return',
   milestones:'choose real full recovery at 10-layer checkpoints',
   cap:'sorties/fights cap is diagnostic and never a success criterion',
   extrapolation:'not evaluated: authored 1-100F only'},
  combinations:all};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const count=Number(process.argv[2]||16);
 const report=summarizeJourneys(count);
 mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
 writeFileSync(new URL('../reports/dungeon-journeys-v1.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 for(const row of report.combinations){
  const d=row.distributions;
  console.log('DUNGEON_JOURNEY '+JSON.stringify({style:row.style,route:row.route,completed:row.completed,samples:row.samples,
   best:d.best,levelAt10:row.checkpoints[0].level,stoneAt100:row.checkpoints[9].stone,
   extraFights:d.replayedFights,p90ExtraFights:d.replayedFights.p90,losses:d.losses,
   earnedStone:d['earned.stone'],spentStone:d['spent.stone'],earnedInk:d['earned.ink'],
   replacements:d.replacements}));
 }
 const completed=report.combinations.reduce((n,x)=>n+x.completed,0);
 console.log('DUNGEON_JOURNEYS_SUMMARY '+JSON.stringify({version:ECONOMY_VERSION,
  completed,attempts:6*count,status:completed===6*count?'DIAGNOSTIC_REACHED_100':'DIAGNOSTIC_INCOMPLETE',
  report:'reports/dungeon-journeys-v1.json'}));
}
