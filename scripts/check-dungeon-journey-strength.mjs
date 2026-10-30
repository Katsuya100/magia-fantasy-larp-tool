import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {approvedGoals} from './simulate-dungeon-journeys.mjs';
import {assert256Seeds,assertPreRecoveryRankGate,summarizeJourneyStrength}
 from './dungeon-test-contract.mjs';

const path=new URL('../reports/dungeon-journey-strength-v2.json',import.meta.url);
const report=JSON.parse(readFileSync(path,'utf8'));
assert.equal(report.schemaVersion,'dungeon-journey-strength-v2');
assert.equal(report.strengthModel,'dungeon-recommended-strength-v3');
assert.equal(report.method,'RECOMMENDED_STRENGTH_FORMULA_LEDGER');
assert.deepEqual(report.journeyExecution,{
 continuationRule:'NORMAL_CAMPAIGN_THEN_REAL_SORTIES_AND_POST_RETURN_INVESTMENT_UNTIL_ALL_TEN_BANDS_REACHED',
 postCampaignStartLayer:91,postCampaignGoalLayer:100,enemyLayerCap:100,
 maxSorties:600,maxFights:6500,maxTurnsPerFight:80,
 stopRule:'CAMPAIGN_AND_ALL_TEN_BANDS_REACHED_OR_EXISTING_SORTIE_FIGHT_BUDGET_EXHAUSTED'});
assert.equal(report.samplesPerPolicy,256);
assert.equal(report.policies.length,6);
assert.equal(report.ranks.length,60);
assert.equal(report.legacyDisposition.xpTaper,'NOT_IMPLEMENTED');
assert.equal(report.legacyDisposition.oldResults,
 'PRESERVED_AS_LEGACY_EVIDENCE_ONLY; NOT_REUSED_OR_RELABELLED_AS_FORMULA_PASSES');
assert.equal(report.legacyDisposition.previousReport,'reports/dungeon-journey-strength-v1.json');
assert.equal(report.legacyDisposition.previousMeasuredOutcome,
 '6,474 REACHED / 8,886 UNMET preserved as v1 evidence');
assert.equal(report.legacyDisposition.preLoopFixOutcome,
 '13,304 REACHED / 2,056 UNMET; preserved as a separate result, not reused or relabelled');
const seeds=Array.from({length:256},(_,i)=>17011+13*i);
assert256Seeds(seeds);
const expectedPairs=['A/short','A/long','B/short','B/long','C/short','C/long'];
assert.deepEqual(report.policies.map(p=>p.style+'/'+p.route),expectedPairs);
const failures=[];
const completionFailures=[];
const chapterFailures=[];
const completionTotals=[];
const chapterTotals=[];
const rankAuditsByPolicy=new Map();
let observedOwnerBandCount=0;
for(const meta of report.policies){
 assert.ok(/^[ABC]$/.test(meta.style)&&['short','long'].includes(meta.route),
  'only the six approved policy references may be loaded');
 assert.equal(meta.file,'dungeon-journey-strength-v2-'+meta.style+'-'+meta.route+'.json',
  'index cannot point to a different evidence file');
 // Load one complete 256-owner shard at a time, preserving all full 50-target
 // ledgers without exceeding Node's maximum UTF-8 string or heap capacity.
 const policy=JSON.parse(readFileSync(new URL('../reports/'+meta.file,import.meta.url),'utf8'));
 assert.equal(policy.style,meta.style);
 assert.equal(policy.route,meta.route);
 assert.equal(policy.samples,meta.samples);
 assert.equal(policy.completion,meta.completion);
 assert.deepEqual(policy.strengthSummary,meta.strengthSummary,
  'index summary must match the complete independently archived measurements');
 assert.equal(policy.samples,256);
 observedOwnerBandCount+=policy.journeyStrength.reduce((n,b)=>n+b.owners.length,0);
 assert.equal(policy.accounts.length,256);
 assert.equal(policy.journeyStrength.length,10);
 assert.deepEqual(policy.accounts.map(x=>x.seed),seeds);
 const summary=summarizeJourneyStrength(policy,seeds);
 assert.equal(summary.length,10);
 for(const [index,row] of summary.entries()){
  assert.equal(row.band,(index*10+1)+'-'+(index*10+10));
  assert.equal(row.count,256);
  if(row.unreached)failures.push({policy:policy.style+'/'+policy.route,band:row.band,
   unreached:row.unreached,missingReasons:row.missingReasons});
  for(const owner of policy.journeyStrength[index].owners){
   assert.ok(owner.status!=='UNASSESSED');
   const measure=owner.lastAssessment;
   if(!measure)continue;
   assert.equal(measure.schemaVersion,'dungeon-recommended-strength-v3');
   assert.equal(measure.actual.numericTargetsCovered,true);
   assert.equal(measure.decision.numericTargetsCovered,true);
   assert.equal(measure.reference.numericTargetsCovered,true);
   assert.equal(measure.actual.targetsProcessed,50);
   assert.equal(measure.reference.targetsProcessed,50);
   const input=measure.ownerInput;
   assert.ok(input,'formula snapshot must be inspectable');
   assert.equal(input.circles.length,5);
   assert.ok(input.carry.length<=G.capacity(input.level));
   assert.equal(new Set(input.carry.map(x=>x.instanceId)).size,input.carry.length);
   assert.ok(input.carry.every(item=>typeof item.instanceId==='string'));
   assert.equal(input.earned.stone,input.spent.stone+measure.ownerInput.bankedStones);
   assert.equal(input.earned.ink,input.spent.ink+measure.ownerInput.bankedInk);
   assert.ok(input.rank<=input.bankedBestLayer);
  }
 }
 assert.equal(policy.completion,policy.accounts.filter(owner=>owner.completed).length,
  'owner completion count must match evidence-backed completion flags');
 let actualCompleted=0;
 for(const account of policy.accounts){
  const proof=account.completionEvidence;
  assert.ok(proof&&Array.isArray(proof.clearedFloors)&&Array.isArray(proof.trace),
   'real per-floor and sortie evidence must be preserved for every owner');
  assert.equal(proof.clearedFloors.length,100);
  const allFloors=proof.clearedFloors.every((floor,index)=>floor&&
   floor.layer===index+1&&floor.cleared===true&&floor.banked===true&&
   floor.attemptedFights===5&&Number.isSafeInteger(floor.sortie)&&floor.sortie>0);
  const legalStarts=proof.trace.every((step,index)=>
   step.start>=1&&step.goal<=100&&step.start<=step.goal&&
   step.start<=(index?proof.trace[index-1].rank:0)+1&&
   step.rank>=(index?proof.trace[index-1].rank:0));
  assert.equal(proof.legalStarts,legalStarts,'legal routes must agree with measured sorties');
  const finale=proof.clearedFloors[99];
  const finalReturn=finale&&proof.trace.some(step=>step.sortie===finale.sortie&&
   step.returned===true&&step.cleared>=100&&step.sortie===proof.finalReturnSortie);
  const completed=account.best>=100&&allFloors&&legalStarts&&Boolean(finalReturn);
  assert.equal(account.completed,completed,'unbanked or unfought F100 cannot be called completed');
  if(completed)actualCompleted++;
  else completionFailures.push({policy:policy.style+'/'+policy.route,seed:account.seed,
   best:account.best,allFloors:Boolean(allFloors),legalStarts,
   finalReturn:Boolean(finalReturn),blockers:account.blockers});
  assert.equal(account.resourceLedger.items.held,
   account.resourceLedger.items.bankedDrops+account.resourceLedger.items.alchemyCreated-
    account.resourceLedger.items.battleConsumed-account.resourceLedger.items.alchemyConsumed);
  for(const rank of account.rankAudit)assertPreRecoveryRankGate(rank);
 }
 completionTotals.push({policy:policy.style+'/'+policy.route,
  completed:actualCompleted,required:256});
 rankAuditsByPolicy.set(policy.style+'/'+policy.route,
  policy.accounts.map(account=>({seed:account.seed,rankAudit:account.rankAudit})));
}
assert.equal(observedOwnerBandCount,6*10*256,
 'all independent owner-band formula observations must remain in the denominator');
for(const rank of report.ranks){
 assert.equal(rank.thresholdHp,approvedGoals.rank.bothHpMpPercentAtLeast);
 assert.equal(rank.thresholdMp,approvedGoals.rank.bothHpMpPercentAtLeast);
 assert.equal(rank.status,'INDEPENDENT_80_80_RANK_ACQUISITION');
 const accounts=rankAuditsByPolicy.get(rank.style+'/'+rank.route);
 assert.ok(accounts&&accounts.length===256,'each chapter row belongs to a measured 256-owner policy');
 const missing=accounts.filter(account=>!account.rankAudit.some(event=>
  event.layer===rank.rankLayer&&event.eligible&&event.banked&&
  event.hpPercent>=80&&event.mpPercent>=80)).map(account=>account.seed);
 assert.deepEqual(rank.missingSeeds,missing,'unearned chapters remain unearned');
 assert.equal(rank.acquiredOwners,256-missing.length,
  'chapter acquisitions count distinct banked owners');
 const exceptional=rank.rankLayer===90&&rank.route==='short'&&
  (rank.style==='B'||rank.style==='C');
 const required=exceptional?255:256;
 chapterTotals.push({policy:rank.style+'/'+rank.route,layer:rank.rankLayer,
  acquired:rank.acquiredOwners,required,missing});
 if(rank.acquiredOwners<required)
  chapterFailures.push({policy:rank.style+'/'+rank.route,layer:rank.rankLayer,
   acquired:rank.acquiredOwners,required,missing});
}
for(const [file,hash] of Object.entries(report.sourceHashes)){
 assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),
  hash,'audited source changed after report: '+file);
}
console.log('DUNGEON_STRICT_100F_COMPLETION '+JSON.stringify(completionTotals));
console.log('DUNGEON_STRICT_CHAPTER_ACQUISITION '+JSON.stringify(chapterTotals));
if(failures.length||completionFailures.length||chapterFailures.length)
 throw Error('DUNGEON_STRICT_UNMET '+JSON.stringify({
  recommendedStrength:failures.slice(0,30),
  completion:completionFailures.slice(0,30),
  chapters:chapterFailures}));
console.log('PASS 60/60 strength bands, 1536/1536 actual F100 clears and 60 owner-level 80/80 chapter gates');
