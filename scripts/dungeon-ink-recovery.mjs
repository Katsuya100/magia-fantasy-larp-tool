// Economic opportunity cost of five-ink re-creation, measured in actual
// encounters rather than an imaginary stone-per-fight conversion.
// The comparison is a *partial* power-recovery diagnostic, NOT certification
// that either strategy attains approved ten-layer combat difficulty.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {configure} from '../assets/js/dungeon-tuning.mjs';
import {createSortieEncounterSelector} from './dungeon-balance-encounters.mjs';
import {unlockedStartLayers} from '../assets/js/dungeon-ranks.mjs';
import {strengthenedPower,upgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import {inkEnhancedAnalysis} from '../assets/js/dungeon-ink.mjs';
import {rng,spread,investmentRate} from './simulate-dungeon-journeys.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const csv=n=>G.parseCsv(readFileSync(new URL('../assets/data/dungeon-'+n+'.csv',import.meta.url),'utf8'));
const data={enemies:csv('enemies'),items:csv('consumables'),collections:csv('collections'),
 buffs:csv('buffs'),balance:csv('balance'),levels:csv('levels'),floors:csv('floors'),playerBase:csv('player-base')};
configure(data);
const economy=read('reports/dungeon-journeys-v1.json');
const getPower=c=>strengthenedPower(c.basePower,c.upgradeLevel);
const pickHero=(h,e,l)=>{
 const choices=G.available(h);
 const heal=l>10?choices.find(i=>h.spells[i].role==='support'):undefined;
 if(heal!==undefined&&h.hp/h.stats.hp<.69)return heal;
 const attacks=choices.filter(i=>h.spells[i].role==='attack');
 if(attacks.length)return attacks.sort((a,b)=>{
  const value=i=>G.effectivePower(h,h.spells[i])*G.resist(e,h.spells[i].attribute);
  return value(b)-value(a)||a-b;
 })[0];
 return heal!==undefined&&h.hp/h.stats.hp<.9?heal:-1;
};
function useOwnedCleanser(hero,carry,layer){
 if(layer<51)return null;
 const status=hero.statuses.find(s=>s.kind==='debuff');
 if(!status)return null;
 let index=carry.findIndex(x=>x.id==='clear_'+status.attribute&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(index<0&&layer>=71)index=carry.findIndex(x=>x.id==='luna_stone'&&G.canUseBattleItem(hero,x,data.items,data.buffs));
 if(index<0)return null;
 const item=carry[index];G.potion(hero,item,data.items,data.buffs);carry.splice(index,1);
 return item.id;
}
function replay(seed,snapshot,requestedLayer,limit=20){
 const random=rng(seed),startingLevel=snapshot.level,profile={level:startingLevel,xp:snapshot.xp,
  adventurerRank:snapshot.rank};
 const legal=unlockedStartLayers(profile).filter(x=>x<requestedLayer);
 const from=legal.at(-1)||1;
 // Never start from a floor above the previous progress; all fight numbering
 // remains exactly five per authored layer and no rank gets handed out.
 const to=Math.min(requestedLayer-1,from+9);
 const old=snapshot.circles[0],originalPower=old.power;
 const inkCost=5;
 if(snapshot.bankedInk<inkCost)return {status:'INSUFFICIENT_INK',extraFights:0};
 const newPower=inkEnhancedAnalysis({power:old.basePower},inkCost).power;
 const circles=snapshot.circles.map(c=>({...c}));
 circles[0]={...old,basePower:newPower,power:newPower,upgradeLevel:0,ink:inkCost};
 let stones=snapshot.bankedStones,grossStones=snapshot.earned.stone,spentStones=snapshot.spent.stone;
 let fights=0,sorties=0,losses=0,inkFound=0,xpLost=0,stonesLost=0,stoneEarned=0,itemsSpent=0;
 // A fresh legal farming sortie may repack BOTH warehouse and previously
 // carried items. Neither branch is granted an item not owned at entry.
 let stocked=[...(snapshot.bankedInventory||[]),...(snapshot.carry||[])]
  .map(x=>({...x})),xpEarned=0;
 const stockedIds=stocked.map(x=>x.instanceId);
 if(stockedIds.some(id=>typeof id!=='string')||
    new Set(stockedIds).size!==stockedIds.length)
  throw Error('Duplicate or unidentified item in real-owner replay stock');
 const spentAfter=()=>{
  const budget=Math.floor(grossStones*investmentRate(requestedLayer)+1e-8);
  while(getPower(circles[0])<originalPower){
   const cost=upgradeStoneCost(circles[0].upgradeLevel);
   if(stones<cost||spentStones+cost>budget)break;
   stones-=cost;spentStones+=cost;circles[0].upgradeLevel++;
   circles[0].power=getPower(circles[0]);
  }
 };
 spentAfter();
 while(getPower(circles[0])<originalPower&&sorties<limit){
  sorties++;
  const hero=G.makeUnit(snapshot.playerBase,profile.level,{},circles.map(c=>({
   role:c.role,attribute:c.attribute,power:getPower(c),basePower:c.basePower
  })),'hero');
  // Carry items only if legitimately owned; drop-acquired supplies become
  // available after a successful return. No replenishment from a fixture.
  const permitted=x=>{
   const item=data.items.find(row=>row.id===x.id);
   return item&&(item.kind==='clear'&&from>=51||item.kind==='clear_all'&&from>=71);
  };
  const encounterForFight=createSortieEncounterSelector(data.enemies,random);
  const carry=stocked.filter(permitted).slice(0,G.capacity(profile.level));
  const taken=new Set(carry);
  stocked=stocked.filter(x=>!taken.has(x));
  let pending={stone:0,ink:0,xp:0,items:[]},defeat=false;
  for(let layer=from;layer<=to&&!defeat;layer++){
   for(let slot=1;slot<=5;slot++){
    const n=(layer-1)*5+slot;
    const foe=encounterForFight(n),enemy=G.fromEnemy(foe,
     Number(data.floors[n-1].enemy_level));
    fights++;
    let won=false;
    for(let turn=0;turn<80;turn++){
     if(useOwnedCleanser(hero,carry,layer))itemsSpent++;
     const ours=pickHero(hero,enemy,layer),theirs=G.chooseEnemySpell(enemy,random);
     if(layer<=10&&((ours>=0&&hero.spells[ours].role==='support')||
      (theirs>=0&&enemy.spells[theirs].role==='support')))
      throw Error('Invalid combat healing in first decade');
     G.round(hero,enemy,ours,theirs,data.buffs,random);
     if(hero.hp<=0)break;
     if(enemy.hp<=0){won=true;break;}
    }
    if(!won){defeat=true;break;}
    const drops=G.drops(data.items,data.collections,enemy.level,random,
     {layer,playerLevel:profile.level,bossEnemyId:slot===5?foe.id:null,firstClear:false,
      favoredCollectionIds:foe.favored_collection_ids?.split('|')||[]});
    for(const drop of drops){
     if(drop.type==='stone')pending.stone++;
     else if(drop.type==='ink')pending.ink++;
     else if(drop.type==='use')pending.items.push({id:drop.id,value:drop.value,bonus:drop.bonus});
    }
    pending.xp=G.normalizeXp(pending.xp+G.fightExperience(enemy.level,profile.level,layer));
    hero.statuses=[];hero.cooldowns=hero.cooldowns.map(()=>0);
    G.recoverVictoryMp(hero,layer);
   }
   if(!defeat&&layer%10===0){hero.hp=hero.stats.hp;hero.mp=hero.maxMp;}
  }
  // Spent carried items remain consumed even on defeat; unspent ones return.
  stocked.push(...carry);
  if(defeat){
   losses++;xpLost+=pending.xp;stonesLost+=pending.stone;
  }else{
   stones+=pending.stone;grossStones+=pending.stone;stoneEarned+=pending.stone;
   inkFound+=pending.ink;stocked.push(...pending.items);
   xpEarned+=pending.xp;G.experience(profile,pending.xp);
   spentAfter();
  }
 }
 return {status:getPower(circles[0])>=originalPower?'RECOVERED':'UNRECOVERED_AFTER_DIAGNOSTIC_CAP',
  from,to,initialLevel:startingLevel,finalLevel:profile.level,
  firstEntryStones:snapshot.bankedStones,initialInk:snapshot.bankedInk,
  inkConsumed:inkCost,originalSpellPower:originalPower,redrawnBasePower:newPower,
  restoredSpellPower:getPower(circles[0]),finalUpgrades:circles[0].upgradeLevel,
  stoneEarned,stoneSpent:spentStones-snapshot.spent.stone,
  stoneBalance:stones,inkFound,
  extraFights:fights,sorties,losses,stonesLost,xpEarned,xpLost,
  cleansersSpent:itemsSpent,unusedItemsAtEnd:stocked.length,
  budget:'invest at most 75% of all genuinely banked lifetime stones; previous sunk stones not refunded',
  limit:'20 sorties is an incomplete diagnostic cap, NOT a user-approved p90 upper limit'};
}
const report={schemaVersion:'dungeon-ink-recovery-v1',economyVersion:economy.schemaVersion,
 seed:economy.seed,repeatSeeds:24,studied:[],warnings:[]};
for(const route of ['short','long']){
 const cohort=economy.combinations.find(x=>x.route===route&&x.style==='A');
 if(!cohort?.comparisonStates)throw Error('Absent owner-state recordings');
 for(const layer of [11,21,31,51,71,91]){
  const owned=cohort.comparisonStates.filter(x=>x.snapshots[layer]?.bankedInk>=5);
  if(!owned.length){report.studied.push({route,layer,status:'NO_REAL_INK'});continue;}
  // Use indivisible real accounts, and vary the farming RNG (not the wallet).
  owned.sort((a,b)=>a.snapshots[layer].level-b.snapshots[layer].level||
   a.snapshots[layer].bankedStones-b.snapshots[layer].bankedStones||a.seed-b.seed);
  const source=owned[Math.floor((owned.length-1)/2)];
  const trials=Array.from({length:report.repeatSeeds},(_,i)=>replay(
   33011+i*29,source.snapshots[layer],layer));
  const fields=['extraFights','sorties','losses','stoneEarned','stoneSpent','stonesLost',
   'xpEarned','xpLost','cleansersSpent','finalLevel'];
  const dist=Object.fromEntries(fields.map(field=>[field,spread(trials.map(x=>x[field]))]));
  const successes=trials.filter(x=>x.status==='RECOVERED').length;
  const row={route,layer,referenceSeed:source.seed,eligibleOwners:owned.length,
   samples:trials.length,successes,unsuccessful:trials.length-successes,
   initial:snapshotSummary(source.snapshots[layer]),distributions:dist,
   p90ExtraFightsCompletedOnly:spread(trials.filter(x=>x.status==='RECOVERED').map(x=>x.extraFights)).p90,
   trials};
  report.studied.push(row);
  console.log('DUNGEON_INK_RECOVERY '+JSON.stringify({...row,trials:undefined}));
 }
}
function snapshotSummary(s){
 return {level:s.level,rank:s.rank,stone:s.bankedStones,ink:s.bankedInk,
  oldUpgrades:s.circles[0].upgradeLevel,oldPower:s.circles[0].power,
  investment:s.spent.stone};
}
const failures=report.studied.filter(x=>x.samples&&x.unsuccessful);
report.warnings.push('This measures the actual cost of restoring one original spell power, not the additional fights required to achieve the approved 256-seed battle win rate.');
if(failures.length)report.warnings.push('Some legal farm routes failed to catch up within the diagnostic sortie cap; do not omit these from p90 interpretation.');
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-ink-recovery-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
const summary={version:report.schemaVersion,measured:report.studied.filter(x=>x.samples).length,
 incomplete:failures.length,recovery:report.studied.map(x=>({route:x.route,layer:x.layer,
 success:x.successes,samples:x.samples,p90Fights:x.distributions?.extraFights.p90}))};
console.log('DUNGEON_INK_RECOVERY_SUMMARY '+JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Magic ink opportunity cost: real return/bank/failure replay\n'+report.studied.map(x=>
  x.samples?x.route+' '+x.layer+'F: '+x.successes+'/'+x.samples+' recover; p90 fights '+
  x.distributions.extraFights.p90+'; p90 losses '+x.distributions.losses.p90+'\n'
  :x.route+' '+x.layer+'F: insufficient actual ink\n').join('')+
 '\nThis is a diagnostic power-restoration burden, not a pass of the strategic break-even goal.\n');
