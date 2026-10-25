// Five separate verdicts from one immutable 256-owner economy artifact.
// This report never promotes an unapproved candidate to an approved baseline.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spread} from './simulate-dungeon-journeys.mjs';
import {reference,specFor,stoneCost,expectedPowers,assess,combatFixture} from './dungeon-readiness-reference.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
import {targetClearLevel} from '../assets/js/dungeon-design.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const economy=read('reports/dungeon-linked-256-economy-v1.json');
const approved=read('config/dungeon-approved-goals.v1.json');
const previous=read('reports/dungeon-linked-256-combat-v1.json');
const fixedDeck=read('reports/dungeon-fixed-deck-combat-v1.json');
const candidateOwners=read('reports/dungeon-linked-256-reference-v1.json');
assert.equal(candidateOwners.referenceStatus,reference.status);
assert.equal(candidateOwners.samplesPerPolicy,256);
assert.equal(approved.strictSamples,256);
assert.equal(economy.samplesPerPolicy,256);
assert.equal(economy.policies.length,6);
assert.equal(previous.cases.length,60,'all sixty actual-owner combat diagnostics must be reported');
assert.equal(fixedDeck.samples,approved.strictSamples);
assert.equal(fixedDeck.approvedGoals,approved.schemaVersion);
assert.equal(fixedDeck.bands.length,10);
assert.deepEqual(previous.economicSourceHashes,economy.sourceHashes);
for(const path of ['config/dungeon-approved-goals.v1.json',
 'config/dungeon-recommended-reference-candidate.v1.json',
 'scripts/dungeon-readiness-reference.mjs']){
 assert.equal(economy.sourceHashes[path],createHash('sha256').update(
  readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),
  'candidate reference or approved goals changed after 256-owner economy measurement');
}
const samples=approved.strictSamples,seed=i=>37011+13*i;
const referenceOwners=economy.policies.find(p=>p.style==='A'&&p.route==='short');
assert.ok(referenceOwners);
const percentile=x=>x.length?spread(x):{p10:null,median:null,p90:null};
const median=x=>percentile(x).median;
const report={schemaVersion:'dungeon-redefined-verdicts-v1',
 approval:reference.status,approvedGoals:approved.schemaVersion,
 seedPolicy:'256 owners 17011+13*i, paired battle 37011+13*i',
 purpose:'Original fixed-deck strict combat is independent from six journey growth strategies; candidate reference remains unapproved',
 COMBAT_BALANCE:fixedDeck.bands,CANDIDATE_COMBAT_DIAGNOSTIC:[],JOURNEY_READINESS:[],EXTRA_FARMING:[],
 RANK_ACQUISITION:[],BUILD_STRATEGY:[],
 designIntegrity:'PASS',warnings:[
  'UNAPPROVED combat fixture is a frozen proposal, not a physically proven economic owner.',
  'Only conditional combat fixtures receive prearranged cleansers; JOURNEY_READINESS only counts actually banked player inventory.',
  'The reference is a PRE-TRAINED 50-fight sortie at the existing FINAL boss recommended level; lower individual-floor recommended levels are not a claim that the hero levels up mid-sortie.',
  'F1-10 first-time play is a series of banked, short tutorial sorties, NOT this continuous 50-fight combat reference.',
  'Actual owner preparation after already clearing the target decade is reported separately from pre-first-clear preparation.',
  'New sortie HP/MP are full solely because the shipped game starts legal sorties full. No intra-sortie replenishment is performed.',
  'A 50-fight diagnostic is not an actual rewarded sortie and never changes its owning journey.',
  'Unobserved additional replays or incomplete readiness are recorded as missing observations, never filled by successful owners.',
  'Winner MP is conditional on actual 50-fight victory; failed players are never silently replaced.'
 ]};
const combatResults=[];
for(const [bandIndex,goal] of approved.bands.entries()){
 const s=specFor(goal.from);
 assert.equal(goal.from,s.from);assert.equal(goal.to,s.to);
 assert.equal(s.priorCheckpointLevel,goal.from===1?1:approved.targetLevelCheckpoints[String(goal.from-1)]);
 assert.equal(s.startLevel,approved.targetLevelCheckpoints[String(goal.to)]);
 assert.equal(s.endingCheckpointLevel,s.startLevel);
 const floorRecommendedLevels=Array.from({length:10},(_,i)=>targetClearLevel(s.from+i));
 assert.ok(floorRecommendedLevels.every(level=>level<=s.startLevel),
  'one banked start level must cover all ten actual floor recommendations');
 const tries=[];
 for(let i=0;i<samples;i++){
  const entry=referenceOwners.ownerEntries[i].snapshots[0];
  assert.ok(entry?.playerBase,'a genuine seeded initial hero base is required');
  assert.equal(referenceOwners.ownerEntries[i].seed,17011+13*i);
  const result=challenge(combatFixture(s,entry.playerBase),s.from,seed(i));
  assert.equal(result.startLevel,s.startLevel);
  assert.equal(result.endLevel,s.startLevel,'combat must not invent mid-sortie level ups');
  assert.ok(result.fightsAttempted>=1&&result.fightsAttempted<=50);
  if(result.won)assert.equal(result.fightsAttempted,50,'winning the full decade requires 50 fights');
  tries.push({seed:seed(i),won:result.won,hp:result.endHp,mp:result.endMp,
   rank:result.bossRankEligible,preRecovery:result.bossPreRecovery,
   cleansers:result.used,firstLoss:result.firstLoss});
 }
 const losses=tries.filter(x=>!x.won);
 const lossByFloor=Object.fromEntries([...new Set(losses.map(x=>x.firstLoss))]
  .sort((a,b)=>a-b).map(floor=>[floor,losses.filter(x=>x.firstLoss===floor).length]));
 const winners=tries.filter(x=>x.won),winRate=100*winners.length/samples,
  mp=median(winners.map(x=>x.mp)),hp=median(winners.map(x=>x.hp));
 const issues=[];
 if(winRate<goal.winRate[0]||winRate>goal.winRate[1])issues.push('WIN_RATE_OUTSIDE_APPROVED_RANGE');
 if(winRate<goal.winSafety[0]||winRate>goal.winSafety[1])issues.push('WIN_RATE_OUTSIDE_APPROVED_SAFETY');
 if(mp===null||mp<goal.winnerMedianMp[0]||mp>goal.winnerMedianMp[1])issues.push('WINNER_MEDIAN_MP_OUTSIDE_APPROVED_RANGE');
 if(s.from<=10&&tries.some(x=>Object.values(x.cleansers).some(v=>v)))throw Error('Early item use invariant broken');
 const row={band:s.from+'-'+s.to,referenceStatus:reference.status,
  approvalGate:reference.status==='USER_APPROVED'?'APPROVED_STRICT':'CANDIDATE_AWAITING_USER_APPROVAL',
  startLevel:s.startLevel,priorCheckpointLevel:s.priorCheckpointLevel,
  endCheckpointLevel:s.endingCheckpointLevel,
  levelBasis:'ALREADY_BANKED_FINAL_BOSS_RECOMMENDATION_BEFORE_50_FIGHTS',
  firstTimeClearIsSeparate:true,floorRecommendedLevels,
  requiredPriorRank:s.requiredPriorRank,spells:reference.spells,
  upgrades:s.upgrades,powers:expectedPowers(s),stoneCost:stoneCost(s),
  inkRequired:0,redrawOptional:true,requiredItems:s.requiredItems,
  startHpPercent:100,startMpPercent:100,sortieStart:s.from,
  count:samples,wins:winners.length,winRate,
  lossByFloor,losingMpMedian:median(losses.map(x=>x.mp)),
  winningMpP10:percentile(winners.map(x=>x.mp)).p10,
  winningMpP90:percentile(winners.map(x=>x.mp)).p90,
  winningMpMedian:mp,
  winningHpMedian:hp,winRateTarget:goal.winRate,winSafety:goal.winSafety,
  winningMpTarget:goal.winnerMedianMp,issues,actualGoalsMet:!issues.length,
  result:issues.length?'COMBAT_TARGET_UNMET':'COMBAT_TARGET_MET'};
 report.CANDIDATE_COMBAT_DIAGNOSTIC.push(row);combatResults.push(tries);
 console.log('COMBAT_BALANCE '+JSON.stringify(row));
}
for(const cohort of economy.policies){
 assert.equal(cohort.ownerEntries.length,samples);
 const referencePolicy=candidateOwners.policies.find(p=>p.style===cohort.style&&p.route===cohort.route);
 assert.ok(referencePolicy&&referencePolicy.owners.length===samples,'matching owner reference artifact is required');
 for(const [index,goal] of approved.bands.entries()){
  const s=specFor(goal.from),ready=[],absent=[],farmRows=[];
  let hasLevel=0,hasPower=0,hasItems=0;
  for(let i=0;i<samples;i++){
   const owner=cohort.ownerEntries[i],banked=referencePolicy.owners[i];
   assert.equal(owner.seed,17011+13*i);
   assert.equal(banked.seed,owner.seed,'actual seeded reference must match economy account');
   const original=owner.snapshots[index];
   const accepted=banked.reference?.[index]??null;
   const last=banked.lastReadiness?.[index]??null;
   if(accepted){
    const check=assess(accepted,s);
    assert.equal(check.ready,true,'unready owner must never be promoted to prepared');
    assert.equal(accepted.source,'POST_RETURN_BANKED_AND_INVESTED');
    assert.ok(accepted.actualFights<=cohort.accounts[i].fights);
    assert.ok(Number.isInteger(accepted.bankedBestLayer)&&accepted.bankedBestLayer>=0,
     'reference readiness needs actual pre-sortie cleared depth');
    ready.push({seed:owner.seed,snapshot:accepted});
   }else{
    const reasons=last?.reasons||(!original?['NEVER_REACHED_BAND']:['NO_POST_RETURN_CANDIDATE_READY_SNAPSHOT']);
    absent.push({seed:owner.seed,reasons,
     firstEntryLevel:original?.level??null,lastBankedLevel:last?.level??null});
   }
   const closest=accepted||original;
   if(closest&&closest.level>=s.startLevel)hasLevel++;
   if(closest&&closest.circles?.length===5&&closest.circles.every((c,j)=>
     c.power>=expectedPowers(s)[j]))hasPower++;
   if(closest&&Object.entries(s.requiredItems).every(([id,n])=>
     closest.carry.filter(x=>x.id===id).length>=n))hasItems++;
   farmRows.push({seed:owner.seed,base:accepted,post:banked.farming?.[index]??[]});
  }
  const outcomes=Object.entries(absent.reduce((a,x)=>
   (x.reasons.forEach(reason=>a[reason]=(a[reason]||0)+1),a),{}));
  const pct=n=>100*n/samples;
  const firstEntry=cohort.ownerEntries.map(x=>x.snapshots[index]).filter(Boolean);
  const extraFights=ready.map(x=>Math.max(0,x.snapshot.actualFights-
    (cohort.ownerEntries[(x.seed-17011)/13].snapshots[index]?.actualFights??0)));
  // A banked prepared state may precede first entrance; never invent a negative preparation cost.
  const replay=ready.map(x=>x.snapshot.repeatedFights??0);
  const r={style:cohort.style,route:cohort.route,band:s.from+'-'+s.to,
   count:samples,prepared:ready.length,unprepared:absent.length,
   preparedBeforeFirstBandClear:ready.filter(x=>x.snapshot.bankedBestLayer<s.to).length,
   preparedOnlyAfterBandClear:ready.filter(x=>x.snapshot.bankedBestLayer>=s.to).length,
   readinessBasis:'REAL_BANKED_BEFORE_SORTIE; BEFORE_FIRST_CLEAR tracked separately',
   preparedPercent:pct(ready.length),levelObservedPercent:pct(hasLevel),
   powerObservedPercent:pct(hasPower),itemsObservedPercent:pct(hasItems),
   cumulativeFights:percentile(ready.map(x=>x.snapshot.actualFights)),
   additionalFightsAfterFirstEntry:percentile(extraFights),
   repeatFightsUntilReady:percentile(replay),
   sorties:percentile(ready.map(x=>x.snapshot.actualSorties)),
   returns:percentile(ready.map(x=>x.snapshot.actualReturns)),
   losses:percentile(ready.map(x=>x.snapshot.actualLosses)),
   bankedExperience:percentile(ready.map(x=>x.snapshot.bankedExperience)),
   stoneEarned:percentile(ready.map(x=>x.snapshot.earned.stone)),
   stoneSpent:percentile(ready.map(x=>x.snapshot.spent.stone)),
   inkEarned:percentile(ready.map(x=>x.snapshot.earned.ink)),
   inkSpent:percentile(ready.map(x=>x.snapshot.spent.ink)),
   missingReasons:outcomes,missingAccounts:absent,
   status:absent.length?'ECONOMY_PREPARATION_INCOMPLETE':'ALL_ACCOUNTS_PREPARED'};
  report.JOURNEY_READINESS.push(r);
  console.log('JOURNEY_READINESS '+JSON.stringify({...r,missingAccounts:undefined}));
  // Reuse SAME independently banked journey checkpoints and SAME paired RNG.
  // Never allocate earned resources in this measurement.
  const observations=farmRows.map(x=>{
   if(!x.base)return {seed:x.seed,points:[null,null,null,null],reason:'REFERENCE_NOT_READY'};
   const snapshots=[x.base,...[0,1,2].map(j=>x.post[j]||null)];
   return {seed:x.seed,points:snapshots.map((snap,k)=>{
    if(!snap)return null;
    if(k>0)assert.ok(snap.additionalBankedReplayFights>=50*k,'extra loop was not actually banked');
    const result=challenge(snap,s.from,seed((x.seed-17011)/13),{route:cohort.route});
    return {won:result.won,hp:result.endHp,mp:result.endMp,
     level:snap.level,stoneEarned:snap.earned.stone,stoneSpent:snap.spent.stone,
     inkEarned:snap.earned.ink,inkSpent:snap.spent.ink,
     carriedItems:snap.carry.length,
     additionalBankedReplayFights:snap.additionalBankedReplayFights??0};
   })};
  });
  const stages=[0,1,2,3].map(k=>{
   const points=observations.map(x=>x.points[k]).filter(Boolean);
   return {extraLoops:k,observedAccounts:points.length,winRate:points.length?
    100*points.filter(x=>x.won).length/points.length:null,
    hpMedian:median(points.filter(x=>x.won).map(x=>x.hp)),
    mpMedian:median(points.filter(x=>x.won).map(x=>x.mp)),
    level:percentile(points.map(x=>x.level)),stones:percentile(points.map(x=>x.stoneEarned)),
    investedStones:percentile(points.map(x=>x.stoneSpent)),
    ink:percentile(points.map(x=>x.inkEarned)),items:percentile(points.map(x=>x.carriedItems))};
  });
  const paired=[1,2,3].map(k=>{
   const pairs=observations.filter(x=>x.points[0]&&x.points[k]);
   const diff=f=>percentile(pairs.map(x=>f(x.points[k])-f(x.points[0])));
   const wins=pairs.reduce((a,x)=>a+Number(x.points[k].won)-Number(x.points[0].won),0);
   return {extraLoops:k,matchedSeeds:pairs.length,
    winDeltaPercent:pairs.length?100*wins/pairs.length:null,
    hpDelta:diff(x=>x.hp),mpDelta:diff(x=>x.mp),
    levelDelta:diff(x=>x.level),stoneDelta:diff(x=>x.stoneEarned),
    investedStoneDelta:diff(x=>x.stoneSpent),
    conclusion:!pairs.length?'NO_ACTUAL_BANKED_EXTRA_LOOP_OBSERVED':
     wins>0?'IMPROVED_WIN_FREQUENCY':wins<0?'DECREASED_WIN_FREQUENCY':'SAME_WIN_FREQUENCY'};
  });
  const farm={style:cohort.style,route:cohort.route,band:r.band,
   stages,paired,ownerCoverage:samples,
   outcome:paired.every(p=>p.matchedSeeds===0)?'NOT_YET_OBSERVED':'MEASURED_NOT_AUTO_APPROVED'};
  report.EXTRA_FARMING.push(farm);
  console.log('EXTRA_FARMING '+JSON.stringify(farm));
 }
}
// F1-10 initial discovery is NOT the fully-prepared 50-fight test: all six actual
// journey policies bank one new floor at a time before their first F10 clear.
report.tutorialEvidence=economy.policies.map(cohort=>{
 const firsts=cohort.accounts.map(a=>a.firstDecadeClearances[0]);
 const reached=firsts.filter(x=>x.sorties!==null);
 assert.ok(reached.every(x=>x.sorties>=10),
  'first F10 clear must require the ten separate banked tutorial expeditions');
 return {style:cohort.style,route:cohort.route,owners:cohort.accounts.length,
  first10Cleared:reached.length,first10NotCleared:samples-reached.length,
  first10ClearSorties:percentile(reached.map(x=>x.sorties)),
  interpretation:'ACTUAL_FIRST_TIME_TUTORIAL_NOT_A_50_FIGHT_REFERENCE'};
});
assert.equal(report.COMBAT_BALANCE.length,10);
assert.equal(report.CANDIDATE_COMBAT_DIAGNOSTIC.length,10);
assert.equal(report.JOURNEY_READINESS.length,60);
assert.equal(report.EXTRA_FARMING.length,60);
for(const goal of approved.bands){
 const rows=economy.policies.map(p=>({style:p.style,route:p.route,
  ...(p.floors[goal.to-1]||{})}));
 for(const row of rows){
  assert.ok(row.gradeEligible<=row.gradeChecks);
  assert.ok(row.gradeBanked<=row.gradeEligible);
 }
 report.RANK_ACQUISITION.push({band:goal.from+'-'+goal.to,
  thresholdHp:approved.rank.bothHpMpPercentAtLeast,
  thresholdMp:approved.rank.bothHpMpPercentAtLeast,
  moment:'BOSS_KILL_BEFORE_VICTORY_AND_MILESTONE_RECOVERY',
  policies:rows.map(x=>({style:x.style,route:x.route,checks:x.gradeChecks,
   eligible:x.gradeEligible,actuallyBanked:x.gradeBanked})),
  status:'INDEPENDENT_REAL_ACQUISITION_DIAGNOSTIC'});
}
for(const pair of economy.pairedLongitudinalCosts){
 assert.equal(pair.samples,256);
 report.BUILD_STRATEGY.push({route:pair.route,strategy:pair.style,
  commonRealSeeds:pair.samples,comparisonTo:'A',
  costs:pair.measured,checkpoints:pair.checkpoints,
  status:'ACTUAL_ECONOMIC_DIFFERENCE_MEASURED_NOT_A_WIN_RATE_GATE'});
}
assert.equal(report.RANK_ACQUISITION.length,10);
assert.equal(report.BUILD_STRATEGY.length,4);
const summary={referenceApproval:reference.status,combatMet:report.COMBAT_BALANCE.filter(x=>x.passed).length,
 combatUnmet:report.COMBAT_BALANCE.filter(x=>!x.passed).length,
 journeyReadyCases:report.JOURNEY_READINESS.filter(x=>x.prepared===256).length,
 journeyBeforeClearAccounts:report.JOURNEY_READINESS.reduce((n,x)=>n+x.preparedBeforeFirstBandClear,0),
 journeyAfterClearAccounts:report.JOURNEY_READINESS.reduce((n,x)=>n+x.preparedOnlyAfterBandClear,0),
 journeyIncompleteCases:report.JOURNEY_READINESS.filter(x=>x.prepared<256).length,
 farmingPairedCases:report.EXTRA_FARMING.filter(x=>x.paired.some(p=>p.matchedSeeds>0)).length,
 status:'DESIGN_INTEGRITY_PASS_SEPARATE_GAME_BALANCE_RESULTS'};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-redefined-verdicts-v1.json',import.meta.url),
 JSON.stringify({...report,summary},null,2)+'\n');
console.log('DUNGEON_TEST_DESIGN_SUMMARY '+JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Separated player journey test design\n'+
 Object.keys({COMBAT_BALANCE:1,JOURNEY_READINESS:1,EXTRA_FARMING:1,RANK_ACQUISITION:1,BUILD_STRATEGY:1})
 .map(k=>'- '+k+': measured, see archived verdicts\n').join('')+
 'Reference: '+reference.status+'; combat target met '+summary.combatMet+'/10; remaining '+
 summary.combatUnmet+' actual balance failures (NOT passed by CI design success).\n'+
 'Real owner readiness fully reached '+summary.journeyReadyCases+'/60 conditions; 50-fight extra farming measured in '+
 summary.farmingPairedCases+'/60 conditions.\n');
// The fixed deck strict CI job independently fails when any of its approved combat goals miss.
