// Controlled, paired deck comparison. The six journeys supply genuine banked
// upgrades/items; fixed-deck circles are a comparator, NEVER owner resources.
// Both arms have the same owner base, level, inventory, rank, tactics and seed.
import assert from 'node:assert/strict';
import {assertPairedCharacters} from './dungeon-test-contract.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
import {upgradeSpells} from '../tests/test-dungeon-progression-simulation.mjs';
import {withNeutralAttackAttributes} from '../tests/helpers/dungeon-neutral-loadout.mjs';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const goals=load('config/dungeon-approved-goals.v1.json');
const economy=load('reports/dungeon-linked-256-economy-v1.json');
const enemyMaster=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
assert.equal(economy.samplesPerPolicy,goals.strictSamples);
const INTRO=[['attack','flame',220],['attack','bolt',260],['attack','gravity',300],
 ['support','aqua',200],['defense','law',160]];
const NORMAL=[['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]];
const sourceSpells=goals.bands.map(b=>withNeutralAttackAttributes(
 (b.from===1?INTRO:NORMAL).map(([role,attribute,power])=>({role,attribute,power})),
 enemyMaster,b.from,b.to).spells);
const ledger=Array.from({length:goals.strictSamples},(_,i)=>
 simulateProgression(17011+i*13+81).milestones);
const referenceSpells=goals.bands.map((b,index)=>
 Array.from({length:goals.strictSamples},(_,i)=>{
  const prior=b.from-1;
  const stones=prior===0?0:ledger[i].find(row=>row.layer===prior)?.stones;
  assert.ok(Number.isFinite(stones),'fixed deck needs the original measured ledger');
  const rate=b.from<=10?.25:b.from<=20?.25+(b.from-10)*.05:.75;
  const invested=Math.floor(stones*rate+1e-8);
  return upgradeSpells(sourceSpells[index],invested).spells;
 }));
const percentile=(values,q)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.floor((sorted.length-1)*q)];
};
const score=(actual,fixed)=>{
 // No arbitrary tolerance or invented composite score: a build is proven
 // stronger only when it wins an otherwise lost sortie, or performs at least
 // as well on all measured combat axes and strictly better on one.
 if(actual.won&&!fixed.won)return 'WIN_ADVANTAGE';
 if(!actual.won||!fixed.won)return null;
 const differences=[
  actual.endHp-fixed.endHp,
  actual.endMp-fixed.endMp,
  fixed.casts-actual.casts,
  fixed.spellMpSpent-actual.spellMpSpent
 ];
 const tolerance=1e-8; // Floating representation only; not a gameplay threshold.
 if(differences.every(x=>x>=-tolerance)&&differences.some(x=>x>tolerance))
  return 'PARETO_ADVANTAGE';
 return null;
};
const report={schemaVersion:'dungeon-paired-build-strength-v1',
 method:'Actually earned, banked prepared and later re-farmed snapshots versus original fixed deck. No unapproved candidate reference is an entry gate. Equal owner level, base, rank, legal inventory, HP/MP, tactics, enemies and per-fight seeds.',
 candidatePromoted:false,strictSamples:goals.strictSamples,cases:[]};
for(const p of economy.policies){
 const owners=p.ownerEntries;
 assert.equal(owners.length,goals.strictSamples,'only independent real owner snapshots');
 for(const [index,band] of goals.bands.entries()){
  let stronger=0,observed=0,missing=0,actualWins=0,fixedWins=0;
  const deltas=[],rounds=[],sourceLoops=[],samples=[],reasonCounts={};
  for(let i=0;i<goals.strictSamples;i++){
   const owner=owners[i];
   assert.equal(owner.seed,17011+13*i,'paired banked owner seed');
   const original=owner.prepared?.[index];
   const post=owner.preparedFarming?.[index]??[];
   // Search ALL genuinely banked observed replays, not just the last state:
   // an earlier legal deck may outperform a later speculative rebuild.
   if(!original){missing++;samples.push({seed:owner.seed,status:'NO_ACTUALLY_PREPARED_OWNER'});continue;}
   const observations=[];
   for(let k=0;k<=post.length;k++){
    const candidate=k===0?original:post[k-1];
    if(!candidate)continue;
    const loops=k;
    if(loops>0)assert.ok(candidate.additionalBankedReplayFights>=50*loops,
     'each comparison must have real banked fights');
    assert.equal(candidate.unbankedXp,0);
    assert.equal(candidate.unbankedStone,0);
    assert.equal(candidate.unbankedInk,0);
    assert.ok(candidate.level>=goals.targetLevelCheckpoints[String(band.to)]);
    const hero=G.makeUnit(candidate.playerBase,candidate.level,{},candidate.circles,'hero');
    const shared={...candidate,playerHp:hero.stats.hp,playerMp:hero.maxMp,
     maxHp:hero.stats.hp,maxMp:hero.maxMp,statuses:[],
     cooldowns:candidate.circles.map(()=>0)};
    // Both arms own the same carried items: fixed circles never receive
    // simulated stones, level gains, potions, or extra returns.
    const combatSeed=37011+13*i;
    const fixedOwner={...shared,circles:referenceSpells[index][i]};
    assertPairedCharacters(shared,fixedOwner);
    const actual=challenge(shared,band.from,combatSeed,{route:'short',paired:true});
    const fixed=challenge(fixedOwner,
     band.from,combatSeed,{route:'short',paired:true});
    const commonLength=Math.min(actual.opponents.length,fixed.opponents.length);
    assert.deepEqual(actual.opponents.slice(0,commonLength),
     fixed.opponents.slice(0,commonLength),'paired arms must fight identical enemies');
    assert.equal(actual.opponents.length,actual.fightsAttempted);
    assert.equal(fixed.opponents.length,fixed.fightsAttempted);
    const advantage=score(actual,fixed);
    observations.push({loops,candidate,actual,fixed,advantage});
   }
   if(!observations.length){missing++;samples.push({
    seed:owner.seed,status:'NO_BANKED_REPLAY',observedLoops:0});continue;}
   // First independently proven stronger state wins the question "can the
   // journey create one?". If none succeeds, retain the last real observation.
   const chosen=observations.find(x=>x.advantage)??observations.at(-1);
   const {candidate,actual,fixed,advantage,loops}=chosen;
   if(advantage){stronger++;reasonCounts[advantage]=(reasonCounts[advantage]||0)+1;}
   observed++;actualWins+=Number(actual.won);fixedWins+=Number(fixed.won);
   deltas.push(actual.endMp-fixed.endMp);
   rounds.push(fixed.casts-actual.casts);
   sourceLoops.push(loops);
   samples.push({seed:owner.seed,status:advantage||'NOT_YET_STRONGER',
    loops,observedLoops:observations.length,
    progression:observations.map(x=>({loops:x.loops,won:x.actual.won,
     referenceWon:x.fixed.won,advantage:x.advantage,
     hpDelta:x.actual.endHp-x.fixed.endHp,
     mpDelta:x.actual.endMp-x.fixed.endMp,
     roundsSaved:x.fixed.casts-x.actual.casts,
     spellMpSaved:x.fixed.spellMpSpent-x.actual.spellMpSpent})),
    level:candidate.level,ownedStones:candidate.earned.stone,
    investedStones:candidate.spent.stone,earnedInk:candidate.earned.ink,
    spentInk:candidate.spent.ink,ownedItems:candidate.carry.length,
    actual:{won:actual.won,hp:actual.endHp,mp:actual.endMp,rounds:actual.casts,
     spentMp:actual.spellMpSpent,firstLoss:actual.firstLoss},
    fixed:{won:fixed.won,hp:fixed.endHp,mp:fixed.endMp,rounds:fixed.casts,
     spentMp:fixed.spellMpSpent,firstLoss:fixed.firstLoss}});
  }
  const row={style:p.style,route:p.route,band:band.from+'-'+band.to,
   population:goals.strictSamples,observed,missing,stronger,
   actualWinRate:100*actualWins/goals.strictSamples,
   fixedPairedWinRate:100*fixedWins/goals.strictSamples,
   medianMpDelta:percentile(deltas,.5),
   medianRoundsSaved:percentile(rounds,.5),
   replayLoops:{median:percentile(sourceLoops,.5),p90:percentile(sourceLoops,.9)},
   comparison:'COMMON_ENCOUNTERS_AND_PER_FIGHT_SEEDS_PARETO',
   improvementModes:reasonCounts,passed:stronger===goals.strictSamples,
   samples};
  report.cases.push(row);
  console.log('BUILD_STRENGTH '+JSON.stringify({...row,samples:undefined}));
 }
}
assert.equal(report.cases.length,60);
report.summary={bands:60,proven:report.cases.filter(x=>x.passed).length,
 insufficient:report.cases.filter(x=>!x.passed).length};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-paired-build-strength-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('BUILD_STRENGTH_SUMMARY '+JSON.stringify(report.summary));
