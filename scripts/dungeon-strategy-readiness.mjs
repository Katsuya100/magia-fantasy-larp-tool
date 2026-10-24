// Full-campaign same-seed tradeoff joined with independently tested 256-owner
// fifty-fight combat readiness.  A/C and A/B pairs are real banked accounts.
// No conclusion is certified unless both arms actually meet locked combat goals.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const eco=load('reports/dungeon-linked-256-economy-v1.json');
const combat=load('reports/dungeon-linked-256-combat-v1.json');
const goals=load('config/dungeon-approved-goals.v1.json');
assert.equal(eco.samplesPerPolicy,256);
assert.equal(combat.combatSamples,goals.strictSamples);
assert.equal(combat.approvedGoals,goals.schemaVersion);
assert.deepEqual(combat.economicSourceHashes,eco.sourceHashes);
assert.equal(eco.pairedLongitudinalCosts.length,4);
const report={schemaVersion:'dungeon-paired-opportunity-v1',
 strategyReference:'Actual initial identical seed, A unchanged circles versus B dispersed stones or C paid ink redraw',
 economics:eco.schemaVersion,combat:combat.schemaVersion,
 seededAccounts:goals.strictSamples,acceptedGoals:goals.schemaVersion,
 status:'MEASURED_NOT_EQUAL_READINESS_CERTIFIED',
 notes:[
  'Same initial account seed is preserved; subsequent divergent decisions consume independent portions of the PRNG stream.',
  'All combat measures use the unaltered true starting HP, MP, spells and owned items at each band first entry.',
  'A/B/C short or long may enter a 10-floor band at differing levels/HP/MP; a 50-fight counterfactual does not secretly level up.',
  'The full-campaign cost vector is real additional battles, defeats, ranks, spent stones and 5-ink circle redraws. It cannot prove a level/power-equated causal comparison by itself.',
  'Equal combat readiness requires BOTH economic strategies to meet the approved 256-seed win/MP criteria. No alternate target, p90 cap or free resources are fabricated.'
 ],pairedCases:[],strictReadyPairs:0,missingReadinessCases:0};
for(const pair of eco.pairedLongitudinalCosts){
 assert.equal(pair.samples,goals.strictSamples);
 assert.equal(pair.pairs.length,goals.strictSamples);
 assert.ok(['B','C'].includes(pair.style));
 const a=eco.policies.find(p=>p.route===pair.route&&p.style==='A');
 const variant=eco.policies.find(p=>p.route===pair.route&&p.style===pair.style);
 assert.ok(a&&variant&&a.ownerEntries.length===256&&variant.ownerEntries.length===256);
 for(let i=0;i<goals.strictSamples;i++){
  assert.equal(pair.pairs[i].seed,a.ownerEntries[i].seed,'A pair must use a real owner seed');
  assert.equal(pair.pairs[i].seed,variant.ownerEntries[i].seed,'variation owner seed must match A');
  if(pair.style==='C')assert.equal(pair.pairs[i].inkActuallyConsumed,pair.pairs[i].paidRedraws*5,
   'C can only spend exactly five actually acquired inks per redraw');
 }
 const decades=goals.bands.map((band,index)=>{
  const name=band.from+'-'+band.to;
  const ref=combat.cases.find(x=>x.route===pair.route&&x.style==='A'&&x.band===name);
  const test=combat.cases.find(x=>x.route===pair.route&&x.style===pair.style&&x.band===name);
  if(!ref||!test||ref.strictDenominator!==256||test.strictDenominator!==256)
   throw Error('Missing real independently evaluated approved-combat cohort '+pair.style+' '+name);
  const checkpoint=pair.checkpoints[index];
  assert.equal(checkpoint.to,band.to);
  const equalReady=ref.hardTargetPassed&&test.hardTargetPassed;
  const issues=[];
  if(!ref.hardTargetPassed)issues.push('A reference does not meet unchanged 256-seed combat goals');
  if(!test.hardTargetPassed)issues.push(pair.style+' does not meet unchanged 256-seed combat goals');
  if(checkpoint.comparedPairs<256)issues.push('Not all 256 accounts reached the same checkpoint');
  const cost={pairedAccounts:checkpoint.comparedPairs,
   extraActualFights:checkpoint.extraFights,
   extraActualSorties:checkpoint.extraSorties,
   fullCampaignExtraFights:pair.measured.extraTotalFights,
   fullCampaignExtraDefeats:pair.measured.extraDeaths,
   paidInkConsumption:pair.measured.inkActuallyConsumed,
   paidRedraws:pair.measured.paidRedraws};
  if(equalReady)report.strictReadyPairs++;
  else report.missingReadinessCases++;
  return {band:name,equalsApprovedReadiness:equalReady,
   verdict:issues.length?'REAL_COST_MEASURED_READINESS_UNPROVEN':'BOTH_STRICT_GOALS_MET_COST_COMPARABLE',
   actualOwnerCombat:{A:{available:ref.ownersAvailable,wins:ref.clears,
     winRate:ref.winRateOf256,winMpMedian:ref.winnerMp.median,
     gradeEligible:ref.gradeIndependent.eligible},
    alternative:{available:test.ownersAvailable,wins:test.clears,
     winRate:test.winRateOf256,winMpMedian:test.winnerMp.median,
     gradeEligible:test.gradeIndependent.eligible},
    observedWinRateDifference:test.winRateOf256-ref.winRateOf256,
    observedMedianMpDifference:ref.winnerMp.median!==null&&test.winnerMp.median!==null
     ?test.winnerMp.median-ref.winnerMp.median:null},
   realEconomyOpportunityCost:cost,issues};
 });
 report.pairedCases.push({base:'A',alternative:pair.style,route:pair.route,
  commonRealSeeds:256,completeAt100:{
   reference:a.completion,alternative:variant.completion,
   difference:variant.completion-a.completion},
  real100FloorCost:{...pair.measured},decades});
}
assert.equal(report.pairedCases.length,4);
assert.equal(report.pairedCases.reduce((n,c)=>n+c.decades.length,0),40);
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-strategy-readiness-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
const summary={pairedStrategies:report.pairedCases.length,
 tenFloorReadinessComparisons:40,realOwnersPerArm:256,
 bothMetApprovedReadiness:report.strictReadyPairs,
 readinessUnproved:report.missingReadinessCases,
 status:report.status};
console.log('DUNGEON_STRATEGY_READINESS '+JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## 256 real-owner strategy readiness joined to real economic opportunity cost\n'+
 'A vs B/C, short/long: '+summary.tenFloorReadinessComparisons+
 ' depth comparisons × 256 matched initial-seed accounts.\n'+
 'Both strategies meet unchanged combat goals: '+summary.bothMetApprovedReadiness+
 '; different/insufficient readiness: '+summary.readinessUnproved+
 '. Costs still measured without inventing resources.\n');
