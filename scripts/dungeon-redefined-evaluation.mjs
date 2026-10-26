// Five separate verdicts from one immutable 256-owner economy artifact.
// This report never promotes an unapproved candidate to an approved baseline.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spread} from './simulate-dungeon-journeys.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
import {summarizeOfficialJourneyReadiness} from './dungeon-test-contract.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const economy=read('reports/dungeon-linked-256-economy-v1.json');
const approved=read('config/dungeon-approved-goals.v1.json');
const previous=read('reports/dungeon-linked-256-combat-v1.json');
const fixedDeck=read('reports/dungeon-fixed-deck-combat-v1.json');
assert.equal(approved.strictSamples,256);
assert.equal(economy.samplesPerPolicy,256);
assert.equal(economy.policies.length,6);
assert.equal(previous.cases.length,60,'all sixty actual-owner combat diagnostics must be reported');
assert.equal(fixedDeck.samples,approved.strictSamples);
assert.equal(fixedDeck.approvedGoals,approved.schemaVersion);
assert.equal(fixedDeck.bands.length,10);
assert.deepEqual(previous.economicSourceHashes,economy.sourceHashes);
for(const path of ['config/dungeon-approved-goals.v1.json']){
 assert.equal(economy.sourceHashes[path],createHash('sha256').update(
  readFileSync(new URL('../'+path,import.meta.url))).digest('hex'),
  'approved goals changed after 256-owner economy measurement');
}
const samples=approved.strictSamples,seed=i=>37011+13*i;
const referenceOwners=economy.policies.find(p=>p.style==='A'&&p.route==='short');
assert.ok(referenceOwners);
const percentile=x=>x.length?spread(x):{p10:null,median:null,p90:null};
const median=x=>percentile(x).median;
const report={schemaVersion:'dungeon-redefined-verdicts-v1',
 approval:'CANDIDATE_DIAGNOSTIC_SEPARATE',approvedGoals:approved.schemaVersion,
 seedPolicy:'256 owners 17011+13*i, paired battle 37011+13*i',
 purpose:'Original fixed-deck strict combat is independent from six journey growth strategies; candidate reference remains unapproved',
 COMBAT_BALANCE:fixedDeck.bands,CANDIDATE_COMBAT_DIAGNOSTIC:[],
 CANDIDATE_JOURNEY_DIAGNOSTIC:[],JOURNEY_READINESS:[],EXTRA_FARMING:[],
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
// Candidate checks run only in the separate diagnostic workflow, never here.
for(const cohort of economy.policies){
 assert.equal(cohort.ownerEntries.length,samples);
 for(const [index,goal] of approved.bands.entries()){
  const farmRows=cohort.ownerEntries.map(owner=>({
   seed:owner.seed,base:owner.prepared?.[index]??null,
   post:owner.preparedFarming?.[index]??[]
  }));
  // EXTRA_FARMING measures only genuinely banked owner replays.
  const observations=farmRows.map(x=>{
   if(!x.base)return {seed:x.seed,points:[null,null,null,null],reason:'NO_ACTUAL_BANKED_PREPARED_SNAPSHOT'};
   const snapshots=[x.base,...[0,1,2].map(j=>x.post[j]||null)];
   return {seed:x.seed,points:snapshots.map((snap,k)=>{
    if(!snap)return null;
    if(k>0)assert.ok(snap.additionalBankedReplayFights>=50*k,'extra loop was not actually banked');
    const result=challenge(snap,goal.from,seed((x.seed-17011)/13),{route:'short'});
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
  const farm={style:cohort.style,route:cohort.route,band:goal.from+'-'+goal.to,
   stages,paired,ownerCoverage:samples,
   outcome:paired.every(p=>p.matchedSeeds===0)?'NOT_YET_OBSERVED':'MEASURED_NOT_AUTO_APPROVED'};
  report.EXTRA_FARMING.push(farm);
  console.log('EXTRA_FARMING '+JSON.stringify(farm));
 }
}
// Formal readiness has NO thresholds from the unapproved candidate.
// All 100 floors use original fixed deck same-character real combat evidence.
for(const cohort of economy.policies){
 const owners=Array.from({length:samples},(_,i)=>17011+13*i);
 assert.deepEqual(cohort.accounts.map(a=>a.seed),owners);
 for(const row of summarizeOfficialJourneyReadiness(cohort,owners)){
  report.JOURNEY_READINESS.push(row);
  console.log('JOURNEY_READINESS '+JSON.stringify({...row,missingAccounts:undefined}));
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
// D is a path-axis comparison for the same A/B/C owner seeds, never a seventh character.
for(const style of ['A','B','C']){
 const short=economy.policies.find(p=>p.style===style&&p.route==='short');
 const long=economy.policies.find(p=>p.style===style&&p.route==='long');
 assert.ok(short&&long&&short.accounts.length===samples&&long.accounts.length===samples);
 const pairs=short.accounts.map((s,i)=>{
  const l=long.accounts[i];assert.equal(s.seed,l.seed,'D path comparison requires the same owner seed');
  return {seed:s.seed,shortClear:s.completed,longClear:l.completed,
   shortReturns:s.returns,longReturns:l.returns,
   shortLostXp:s.lostXp,longLostXp:l.lostXp,
   shortDeaths:s.deathCount,longDeaths:l.deathCount,
   shortFights:s.fights,longFights:l.fights,
   shortBankedStone:s.stoneEarned,longBankedStone:l.stoneEarned,
   shortStoneAtRisk:s.maxPendingStoneExposure,longStoneAtRisk:l.maxPendingStoneExposure,
   shortInkAtRisk:s.maxPendingInkExposure,longInkAtRisk:l.maxPendingInkExposure};
 });
 report.BUILD_STRATEGY.push({strategy:'D',style,route:'short-vs-long',
  commonRealSeeds:samples,comparisonTo:'SAME_SEED_D_PATH_AXIS',
  costs:{returnDelta:percentile(pairs.map(x=>x.longReturns-x.shortReturns)),
   lostXpDelta:percentile(pairs.map(x=>x.longLostXp-x.shortLostXp)),
   deathDelta:percentile(pairs.map(x=>x.longDeaths-x.shortDeaths)),
   fightDelta:percentile(pairs.map(x=>x.longFights-x.shortFights)),
   bankedStoneDelta:percentile(pairs.map(x=>x.longBankedStone-x.shortBankedStone)),
   unbankedStoneExposureDelta:percentile(pairs.map(x=>x.longStoneAtRisk-x.shortStoneAtRisk)),
   unbankedInkExposureDelta:percentile(pairs.map(x=>x.longInkAtRisk-x.shortInkAtRisk)),
   shortCompleted:pairs.filter(x=>x.shortClear).length,
   longCompleted:pairs.filter(x=>x.longClear).length},
  checkpoints:approved.bands.map((goal,index)=>({
   to:goal.to,shortClears:short.accounts.filter(x=>x.firstDecadeClearances[index].fights!==null).length,
   longClears:long.accounts.filter(x=>x.firstDecadeClearances[index].fights!==null).length})),
  pairs,status:'ACTUAL_256_SEED_PATH_RISK_AND_RETURN_COSTS'});
}
assert.equal(report.BUILD_STRATEGY.length,7);
const summary={referenceApproval:'CANDIDATE_DIAGNOSTIC_SEPARATE',combatMet:report.COMBAT_BALANCE.filter(x=>x.passed).length,
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
 'Reference: '+'CANDIDATE_DIAGNOSTIC_SEPARATE'+'; combat target met '+summary.combatMet+'/10; remaining '+
 summary.combatUnmet+' actual balance failures (NOT passed by CI design success).\n'+
 'Real owner readiness fully reached '+summary.journeyReadyCases+'/60 conditions; 50-fight extra farming measured in '+
 summary.farmingPairedCases+'/60 conditions.\n');
// The fixed deck strict CI job independently fails when any of its approved combat goals miss.
