// Accepted combat goals measured using 256 INDEPENDENT real economic owners.
// Each owner has actually fought/banked/levelled under A/B/C and short/D.
// This is a separate ten-layer counterfactual at first entry; for short-return
// journeys it is intentionally NOT a claim of what happens after intermediate
// banking and leveling. No baseline medians or invented consumables are used.
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
 methodology:'First entry from the SAME real economic player for each seeded sample; exact pre-entry HP/MP, five circles, cooldowns, status and owned carried cleansers. 50 battles without invented refills, banking or level-ups between fights. Independent of frozen reference median.',
 cases:[],failures:[],coverage:[],
 warnings:[
  'A full decade in short route is a stress-test counterfactual: normal short players return and level between layers.',
  'The 256 distinct actual owner entry accounts are NOT a random photo-circle population; reference circles are an explicit controlled assumption.',
  'No eligibility gap, zero winners, rank failure or absent cleanser stock can be silently replaced by a test-only fixture.',
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
   const snapshot=account.snapshots[bandIndex];
   if(!snapshot){missing.push(account.seed);continue;}
   assert.equal(snapshot.from,band.from);
   assert.equal(snapshot.circles.length,5);
   const consumed=challenge(snapshot,band.from,37011+13*i);
   results.push({seed:account.seed,combatSeed:37011+13*i,sourceLevel:snapshot.level,
    sourceRank:snapshot.rank,sourceHp:100*snapshot.playerHp/snapshot.maxHp,
    sourceMp:100*snapshot.playerMp/snapshot.maxMp,
    ownedItems:snapshot.carry.length,bankedInventory:snapshot.bankedItems,
    bankedStones:snapshot.bankedStones,bankedInk:snapshot.bankedInk,
    win:consumed.won,cleared:consumed.cleared,endingHp:consumed.endHp,
    endingMp:consumed.endMp,heals:consumed.heals,enemyHeals:consumed.enemyHeals,
    firstLoss:consumed.firstLoss,gradeEligible:consumed.bossRankEligible,
    gradeBeforeRecovery:consumed.bossPreRecovery,itemsUsed:consumed.used});
  }
  const wins=results.filter(r=>r.win),count=results.length;
  const winRate=100*wins.length/goals.strictSamples;
  const conditionalWinRate=count?100*wins.length/count:null;
  const mp=spread(wins.map(r=>r.endingMp)),hp=spread(wins.map(r=>r.endingHp));
  const issues=[];
  if(missing.length)issues.push('Some real owners did not reach this first-entry floor; no 256-sample prepared cohort');
  if(winRate<band.winRate[0]||winRate>band.winRate[1])
   issues.push('Observed 256-denominator win rate outside user-approved interval');
  if(winRate<band.winSafety[0]||winRate>band.winSafety[1])
   issues.push('Observed 256-denominator win rate outside user-approved interior safety margin');
  if(mp.median===null||mp.median<band.winnerMedianMp[0]||mp.median>band.winnerMedianMp[1])
   issues.push('Winner MP median outside user-approved interval');
  if(band.from>=51&&results.some(r=>r.ownedItems===0))
   issues.push('Some owners lack earned and carried specialist cleanser supply');
  if(band.from<=10&&results.some(r=>r.heals||r.enemyHeals))
   throw Error('Early no-combat-healing invariant broken');
  const grade=wins.filter(r=>r.gradeBeforeRecovery);
  const row={style:cohort.style,route:cohort.route,band:band.from+'-'+band.to,
   ownersAvailable:count,ownersMissing:missing.length,missingSeeds:missing,
   strictDenominator:goals.strictSamples,clears:wins.length,
   winRateOf256:winRate,conditionalWinRate,
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
   issues,hardTargetPassed:issues.length===0};
  report.cases.push(row);
  if(issues.length)report.failures.push({style:cohort.style,route:cohort.route,band:row.band,issues});
  console.log('DUNGEON_LINKED_256_COMBAT '+JSON.stringify({
   style:row.style,route:row.route,band:row.band,
   realOwners:count,missing:missing.length,wins:row.clears,
   observedWinPercent:winRate,winnerMpMedian:mp.median,
   rankEligibleBeforeRecovery:row.gradeIndependent.eligible,
   passed:row.hardTargetPassed,issues}));
 }
}
assert.equal(report.cases.length,6*goals.bands.length,'evaluate all 60 policy-decade combinations');
report.coverage={cases:report.cases.length,policies:economy.policies.length,
 approvedSeeds:goals.strictSamples,met:report.cases.filter(x=>x.hardTargetPassed).length,
 unmet:report.failures.length};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-linked-256-combat-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
console.log('DUNGEON_LINKED_256_COMBAT_SUMMARY '+JSON.stringify(report.coverage));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Paired strict 256-real-owner ten-layer combat\n'+
 'Real owner states: '+report.coverage.cases+' policy/depth cases, 256 seeds/case.\n'+
 'User-approved target met: '+report.coverage.met+'/'+report.coverage.cases+
 '; remaining unmet: '+report.coverage.unmet+'.\n'+
 '**A completed structural CI does NOT imply this acceptance gate passes.**\n');
if(report.failures.length)process.exitCode=1;
