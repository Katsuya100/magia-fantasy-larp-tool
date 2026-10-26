// Controlled, paired deck comparison. The six journeys supply genuine banked
// upgrades/items; fixed-deck circles are a comparator, NEVER owner resources.
// Both arms have the same owner base, level, inventory, rank, tactics and seed.
import assert from 'node:assert/strict';
import {evaluatePaidBuild} from './dungeon-fixed-deck-pair.mjs';
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
const percentile=(values,q)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.floor((sorted.length-1)*q)];
};
const report={schemaVersion:'dungeon-paired-build-strength-v1',
 method:'Actually earned, banked prepared and later re-farmed snapshots versus original fixed deck. No unapproved candidate reference is an entry gate. Equal owner level, base, rank, legal inventory, HP/MP, tactics, enemies and per-fight seeds.',
 candidatePromoted:false,strictSamples:goals.strictSamples,cases:[],C_REDRAW_STRATEGY:[]};
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
    const loops=candidate.completedExtraLoops??0;
    if(loops>0)assert.ok(candidate.additionalBankedReplayFights>=50*loops,
     'each comparison must have real banked fights');
    assert.equal(candidate.unbankedXp,0);
    assert.equal(candidate.unbankedStone,0);
    assert.equal(candidate.unbankedInk,0);
    assert.ok(candidate.level>=goals.targetLevelCheckpoints[String(band.to)]);
    const {actual,fixed,advantage}=evaluatePaidBuild(candidate,index,i);
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
// An actual paid C redraw is compared with the genuinely owned spell that
// was sacrificed. No free ink, upgrade refund or higher-quality reroll.
// These are paired, fixed-character counterfactual battles, not C owners
// substituted by one conveniently chosen representative seed.
for(const route of ['short','long']){
 const cohort=economy.policies.find(x=>x.style==='C'&&x.route===route);
 assert.ok(cohort&&cohort.ownerEntries.length===goals.strictSamples);
 const cases=[];
 for(let i=0;i<goals.strictSamples;i++){
  const owner=cohort.ownerEntries[i],account=cohort.accounts[i];
  assert.equal(owner.seed,account.seed);
  const snapshots=[...(owner.prepared??[]),
   ...(owner.preparedFarming??[]).flat()].filter(Boolean);
  let matched=null;
  for(const event of account.redrawEvents??[]){
   if(!event.originalCircle||!Number.isInteger(event.circleIndex))throw Error('Paid C redraw has no sunk-upgrade ledger');
   assert.equal(event.inkConsumed,5,'ink redraw is never free');
   assert.ok(event.sunkStones>=0&&event.originalCircle.upgradeLevel>=0);
   const snap=snapshots.find(x=>x.bankedBestLayer>=event.layer&&
    x.circles[event.circleIndex]?.basePower===event.newPower);
   if(snap){matched={event,snap};break;}
  }
  if(!matched){
   cases.push({seed:owner.seed,status:'NO_POST_REDRAW_BANKED_COMPARISON',
    earnedRedraws:(account.redrawEvents??[]).length});
   continue;
  }
  const {event,snap}=matched;
  const original=event.originalCircle;
  const controlCircles=snap.circles.map((circle,j)=>
   j===event.circleIndex?{...original}:circle);
  const retained={...snap,circles:controlCircles};
  assertPairedCharacters(snap,retained);
  const combatSeed=37011+13*i;
  const drawn=challenge(snap,snap.layer,combatSeed,{route:'short',paired:true});
  const kept=challenge(retained,snap.layer,combatSeed,{route:'short',paired:true});
  const overlap=Math.min(drawn.opponents.length,kept.opponents.length);
  assert.deepEqual(drawn.opponents.slice(0,overlap),kept.opponents.slice(0,overlap),
   'C alternatives must face identical actual encounter sequence');
  const gain=score(drawn,kept),cost=score(kept,drawn);
  assert.ok(!(gain&&cost),'same battle cannot Pareto-dominate both ways');
  cases.push({seed:owner.seed,status:gain?'REDRAW_RATIONAL':cost?'KEEP_RATIONAL':'TRADEOFF_OR_TIE',
   band:snap.layer+'-'+snap.to,inkActuallyConsumed:event.inkConsumed,
   sunkStones:event.sunkStones,originalUpgrades:event.originalCircle.upgradeLevel,
   newUpgrades:snap.circles[event.circleIndex].upgradeLevel,
   sameLevel:snap.level,rank:snap.rank,carried:snap.carry.length,
   redraw:{won:drawn.won,hp:drawn.endHp,mp:drawn.endMp,actions:drawn.casts},
   keep:{won:kept.won,hp:kept.endHp,mp:kept.endMp,actions:kept.casts}});
 }
 assert.equal(cases.length,goals.strictSamples);
 const row={route,denominator:goals.strictSamples,drawn:cases.filter(x=>x.status!=='NO_POST_REDRAW_BANKED_COMPARISON').length,
  redrawRational:cases.filter(x=>x.status==='REDRAW_RATIONAL').length,
  keepRational:cases.filter(x=>x.status==='KEEP_RATIONAL').length,
  unresolved:cases.filter(x=>x.status==='TRADEOFF_OR_TIE').length,
  missing:cases.filter(x=>x.status==='NO_POST_REDRAW_BANKED_COMPARISON').length,
  status:'PAID_256_OWNER_DECISION_EVIDENCE',cases};
 report.C_REDRAW_STRATEGY.push(row);
 console.log('C_REDRAW_STRATEGY '+JSON.stringify({...row,cases:undefined}));
}
assert.equal(report.C_REDRAW_STRATEGY.length,2);

report.summary={bands:60,proven:report.cases.filter(x=>x.passed).length,
 insufficient:report.cases.filter(x=>!x.passed).length};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-paired-build-strength-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('BUILD_STRENGTH_SUMMARY '+JSON.stringify(report.summary));
