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
assert.equal(report.samplesPerPolicy,256);
assert.equal(report.policies.length,6);
assert.equal(report.ranks.length,60);
assert.equal(report.legacyDisposition.xpTaper,'NOT_IMPLEMENTED');
assert.equal(report.legacyDisposition.oldResults,
 'PRESERVED_AS_LEGACY_EVIDENCE_ONLY; NOT_REUSED_OR_RELABELLED_AS_FORMULA_PASSES');
assert.equal(report.legacyDisposition.previousReport,'reports/dungeon-journey-strength-v1.json');
assert.equal(report.legacyDisposition.previousMeasuredOutcome,
 '6,474 REACHED / 8,886 UNMET preserved as v1 evidence');
const seeds=Array.from({length:256},(_,i)=>17011+13*i);
assert256Seeds(seeds);
const expectedPairs=['A/short','A/long','B/short','B/long','C/short','C/long'];
assert.deepEqual(report.policies.map(p=>p.style+'/'+p.route),expectedPairs);
const failures=[];
for(const policy of report.policies){
 assert.equal(policy.samples,256);
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
 for(const account of policy.accounts){
  assert.equal(account.resourceLedger.items.held,
   account.resourceLedger.items.bankedDrops+account.resourceLedger.items.alchemyCreated-
    account.resourceLedger.items.battleConsumed-account.resourceLedger.items.alchemyConsumed);
  for(const rank of account.rankAudit)assertPreRecoveryRankGate(rank);
 }
}
assert.equal(report.policies.reduce((sum,p)=>sum+p.journeyStrength.reduce((n,b)=>n+b.owners.length,0),0),
 6*10*256,'all independent owner-band formula observations must remain in the denominator');
for(const rank of report.ranks){
 assert.equal(rank.thresholdHp,approvedGoals.rank.bothHpMpPercentAtLeast);
 assert.equal(rank.thresholdMp,approvedGoals.rank.bothHpMpPercentAtLeast);
 assert.equal(rank.status,'INDEPENDENT_80_80_RANK_ACQUISITION');
}
for(const [file,hash] of Object.entries(report.sourceHashes)){
 assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),
  hash,'audited source changed after report: '+file);
}
if(failures.length)throw Error('RECOMMENDED_STRENGTH_NOT_REACHED_OR_UNPROVEN: '+
 JSON.stringify(failures.slice(0,30)));
console.log('PASS 6 policies x 10 bands x 256 owners; formula-only acceptance and independent 80/80 rank audit');
