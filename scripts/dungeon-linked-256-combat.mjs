// Accepted combat goals measured using 256 INDEPENDENT real economic owners.
// Each owner has actually fought/banked/levelled under A/B/C and short/D.
// Initial entry is economic diagnostic ONLY. Mandatory ten-layer difficulty
// is evaluated after REAL completed returns, level-ups, banked upgrades and
// independently verified rank/level readiness. Missing readiness is an
// economic reachability failure, not an artificial combat defeat.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {spread} from './simulate-dungeon-journeys.mjs';
import {challenge} from './dungeon-coherent-battle.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const economy=read('reports/dungeon-linked-256-economy-v1.json');
const goals=read('config/dungeon-approved-goals.v1.json');
assert.equal(goals.strictSamples,256);
assert.equal(economy.samplesPerPolicy,goals.strictSamples);
assert.equal(economy.policies.length,6);
assert.equal(economy.structuralChecks,6*goals.strictSamples);
for(const [path,expected] of Object.entries(economy.sourceHashes)){
 const current=createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex');
 assert.equal(current,expected,'economic and combat source master mismatch: '+path);
}
const report={schemaVersion:'dungeon-linked-256-owner-combat-v1',
 status:'HARD_TARGETS_SEPARATE_FROM_STRUCTURAL_MEASUREMENT',
 economicSource:economy.schemaVersion,economicSourceHashes:economy.sourceHashes,
 approvedGoals:goals.schemaVersion,combatSamples:goals.strictSamples,
 seedRule:'one owner seed 17011+13*i, independent combat seed 37011+13*i',
 cohortDefinitions:'A/B/C strategy x short or long D route',
 methodology:'Separate first entry as economic diagnosis. Evaluate 50 fights only from the first actual post-return banked/prepared state per seed, with authored recommended end-of-band level, legal rank checkpoint, five owned reference circles and earned inventory; never infer readiness from a winning combat seed.',
 cases:[],failures:[],coverage:[],
 warnings:[
  'A prepared 50-fight challenge starts a new, legal sortie after an actual banked return; full start HP/MP comes from normal game sortie initialization, never from an intra-sortie refill.',
  'The 256 distinct actual owner entry accounts are NOT a random photo-circle population; reference circles are an explicit controlled assumption.',
  'An owner without a verified prepared snapshot counts as ECONOMY_NOT_READY; zero combat observations must never be represented as zero combat victories.',
  'This report does not auto-approve or replace the user-frozen candidate v1; it measures alternative genuine-owner outcomes.'
 ]};
for(const cohort of economy.policies){
 assert.equal(cohort.ownerEntries.length,256,'one actual owner per seed in '+cohort.style+' '+cohort.route);
 assert.equal(cohort.accounts.length,256);
 for(const [bandIndex,band] of goals.bands.entries()){
  const results=[],missing=[];
  for(const [i,account] of cohort.ownerEntries.entries()){
   const source=cohort.accounts[i];
   assert.equal(account.seed,source.seed,'combat owner must equal economic owner seed');
   assert.equal(account.seed,17011+13*i,'no skipped or substituted economic owner seed');
   const firstEntry=account.snapshots[bandIndex];
   const snapshot=account.prepared?.[bandIndex];
   if(!snapshot){missing.push({seed:account.seed,firstEntryReached:Boolean(firstEntry),
    firstEntryLevel:firstEntry?.level??null,
    reason:!firstEntry?'NOT_REACHED_ON_JOURNEY':'NO_LEGAL_BANKED_LEVEL_RANK_READY_SORTIE'});
    continue;}
   assert.equal(snapshot.from,band.from);
   assert.equal(snapshot.source,'POST_RETURN_BANKED_AND_INVESTED');
   assert.ok(snapshot.level>=snapshot.targetLevel,'no underlevel early-entry combat may enter the mandatory cohort');
   assert.equal(snapshot.unbankedXp,0);
   assert.equal(snapshot.circles.length,5);
   const consumed=challenge(snapshot,band.from,37011+13*i,{route:cohort.route});
   results.push({seed:account.seed,combatSeed:37011+13*i,sourceLevel:snapshot.level,
    preparationFights:snapshot.actualFights,preparationSorties:snapshot.actualSorties,
    firstEntryLevel:firstEntry?.level??null,
    sourceRank:snapshot.rank,sourceHp:100*snapshot.playerHp/snapshot.maxHp,
    sourceMp:100*snapshot.playerMp/snapshot.maxMp,
    ownedItems:snapshot.carry.length,bankedInventory:snapshot.bankedItems,
    bankedStones:snapshot.bankedStones,bankedInk:snapshot.bankedInk,
    circleUpgrades:snapshot.circles.map(x=>x.upgradeLevel),
    circlePowers:snapshot.circles.map(x=>x.power),
    carriedKinds:snapshot.carry.map(x=>x.id),
    win:consumed.won,cleared:consumed.cleared,endingHp:consumed.endHp,
    endingMp:consumed.endMp,heals:consumed.heals,enemyHeals:consumed.enemyHeals,
    firstLoss:consumed.firstLoss,firstLossDetail:consumed.firstLossDetail??null,gradeEligible:consumed.bossRankEligible,
    gradeBeforeRecovery:consumed.bossPreRecovery,itemsUsed:consumed.used});
  }
  const wins=results.filter(r=>r.win),count=results.length;
  // No missing player may be counted as a lost 50-fight challenge, and
  // no successful-owner filtering may be promoted into 256-seed acceptance.
  const fullCohort=count===goals.strictSamples;
  const winRate=fullCohort?100*wins.length/goals.strictSamples:null;
  const conditionalWinRate=count?100*wins.length/count:null;
  const mp=spread(wins.map(r=>r.endingMp)),hp=spread(wins.map(r=>r.endingHp));
  const issues=[];
  if(missing.length)issues.push('ECONOMY_NOT_READY: real prepared owner accounts missing; no 256-sample combat acceptance claim');
  if(fullCohort){
   if(winRate<band.winRate[0]||winRate>band.winRate[1])
    issues.push('Observed 256-denominator win rate outside user-approved interval');
   if(winRate<band.winSafety[0]||winRate>band.winSafety[1])
    issues.push('Observed 256-denominator win rate outside user-approved interior safety margin');
   if(mp.median===null||mp.median<band.winnerMedianMp[0]||mp.median>band.winnerMedianMp[1])
    issues.push('Winner MP median outside user-approved interval');
  }
  if(band.from>=51&&results.some(r=>r.ownedItems===0))
   issues.push('Some owners lack earned and carried specialist cleanser supply');
  if(band.from<=10&&results.some(r=>r.heals||r.enemyHeals))
   throw Error('Early no-combat-healing invariant broken');
  const grade=wins.filter(r=>r.gradeBeforeRecovery);
  const row={style:cohort.style,route:cohort.route,band:band.from+'-'+band.to,
   ownersAvailable:count,ownersMissing:missing.length,
   missingSeeds:missing.map(x=>x.seed),missingOwnerReasons:missing,
   firstEntryAccounts:cohort.ownerEntries.filter(x=>x.snapshots[bandIndex]).length,
   readinessGate:fullCohort?'ALL_256_INDEPENDENTLY_PREPARED':'ECONOMY_NOT_READY',
   strictDenominator:goals.strictSamples,clears:wins.length,
   winRateOf256:winRate,conditionalWinRate,
   conditionalSampleNotForApproval:!fullCohort,
   actualPreparation:{fights:spread(results.map(x=>x.preparationFights)),
    sorties:spread(results.map(x=>x.preparationSorties)),
    level:spread(results.map(x=>x.sourceLevel))},
   firstEntryDiagnostic:{level:spread(results.map(x=>x.firstEntryLevel).filter(Number.isFinite))},
   winnerMp:mp,winnerHp:hp,ownerFirstEntry:{
    hp:spread(results.map(r=>r.sourceHp)),mp:spread(results.map(r=>r.sourceMp)),
    level:spread(results.map(r=>r.sourceLevel)),
    carriedItems:spread(results.map(r=>r.ownedItems)),
    bankedItems:spread(results.map(r=>r.bankedInventory))},
   gradeIndependent:{eligible:wins.filter(r=>r.gradeEligible).length,
    bossPreRecoveryHp:spread(grade.map(r=>r.gradeBeforeRecovery.hp)),
    bossPreRecoveryMp:spread(grade.map(r=>r.gradeBeforeRecovery.mp))},
   healerCasts:results.reduce((n,r)=>n+r.heals,0),
   enemyHealerCasts:results.reduce((n,r)=>n+r.enemyHeals,0),
   cleanserUses:results.reduce((n,r)=>n+Object.values(r.itemsUsed).reduce((a,b)=>a+b,0),0),
   firstLosses:Object.entries(results.filter(r=>!r.win).reduce((a,r)=>
    (a[r.firstLoss]=(a[r.firstLoss]||0)+1,a),{})),
   issues,hardTargetPassed:fullCohort&&issues.length===0,
   status:!fullCohort?'ECONOMY_NOT_READY':issues.length?'COMBAT_TARGET_UNMET':'COMBAT_TARGET_MET'};
  report.cases.push(row);
  if(issues.length)report.failures.push({style:cohort.style,route:cohort.route,band:row.band,issues});
  console.log('DUNGEON_LINKED_256_COMBAT '+JSON.stringify({
   style:row.style,route:row.route,band:row.band,
   realOwners:count,missing:missing.length,wins:row.clears,
   gate:row.status,
   observedWinPercent:winRate,winnerMpMedian:mp.median,
   rankEligibleBeforeRecovery:row.gradeIndependent.eligible,
   passed:row.hardTargetPassed,issues}));
  // Diagnostics only: audit all seeds, including failed battles and missing
  // genuine owners. None of these observations changes eligibility or goals.
  console.log('DUNGEON_LINKED_256_DIAGNOSTIC '+JSON.stringify({
   style:row.style,route:row.route,band:row.band,
   ready:count,missing:missing.length,missingSeeds:row.missingSeeds,
   level:row.actualPreparation.level,
   upgrades:results.length?Array.from({length:5},(_,i)=>spread(results.map(r=>r.circleUpgrades[i]))):[],
   spellPowers:results.length?Array.from({length:5},(_,i)=>spread(results.map(r=>r.circlePowers[i]))):[],
   bankedStone:spread(results.map(r=>r.bankedStones)),
   bankedInk:spread(results.map(r=>r.bankedInk)),
   carried:spread(results.map(r=>r.ownedItems)),
   itemKinds:Object.entries(results.reduce((acc,r)=>{
    for(const kind of r.carriedKinds)acc[kind]=(acc[kind]||0)+1;
    return acc;
   },{})),
   winnerHp:row.winnerHp,winnerMp:row.winnerMp,
   lossesByLayer:row.firstLosses,
   sampleLosses:results.filter(r=>!r.win).slice(0,3).map(r=>({seed:r.seed,...r.firstLossDetail})),
   cleanserUses:row.cleanserUses,
   gradeEligible:row.gradeIndependent.eligible}));
 }
}
assert.equal(report.cases.length,6*goals.bands.length,'evaluate all 60 policy-decade combinations');
report.coverage={cases:report.cases.length,policies:economy.policies.length,
 approvedSeeds:goals.strictSamples,met:report.cases.filter(x=>x.hardTargetPassed).length,
 economyNotReady:report.cases.filter(x=>x.status==='ECONOMY_NOT_READY').length,
 preparedCombatUnmet:report.cases.filter(x=>x.status==='COMBAT_TARGET_UNMET').length,
 preparedCombatMet:report.cases.filter(x=>x.status==='COMBAT_TARGET_MET').length,
 unmet:report.failures.length};
assert.equal(report.coverage.economyNotReady+report.coverage.preparedCombatUnmet+
 report.coverage.preparedCombatMet,report.coverage.cases,
 'a missing economic owner must never be recategorised as a battle loss');
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-linked-256-combat-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('DUNGEON_LINKED_256_COMBAT_SUMMARY '+JSON.stringify(report.coverage));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Paired strict 256-real-owner ten-layer combat\n'+
 'Real owner states: '+report.coverage.cases+' policy/depth cases, 256 seeds/case.\n'+
 'User-approved target met: '+report.coverage.met+'/'+report.coverage.cases+
 '; economic unready: '+report.coverage.economyNotReady+
 '; fully prepared but combat unmatched: '+report.coverage.preparedCombatUnmet+
 '; remaining unmet total: '+report.coverage.unmet+'.\n'+
 '**A completed structural CI does NOT imply this acceptance gate passes.**\n');
if(report.failures.length)process.exitCode=1;
