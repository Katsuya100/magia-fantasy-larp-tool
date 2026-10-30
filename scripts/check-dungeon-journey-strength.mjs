import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {unlockedStartLayers} from '../assets/js/dungeon-ranks.mjs';
import {strengthenedPower,totalUpgradeStoneCost} from '../assets/js/dungeon-upgrades.mjs';
import * as G from '../assets/js/dungeon-core.mjs';
import {approvedGoals} from './simulate-dungeon-journeys.mjs';
import {assert256Seeds,assertPreRecoveryRankGate,summarizeJourneyStrength}
 from './dungeon-test-contract.mjs';


const close=(a,b)=>Math.abs(a-b)<1e-7;
const uniqueIds=items=>{
 assert.ok(Array.isArray(items));
 const ids=items.map(x=>x.instanceId);
 assert.ok(ids.every(id=>typeof id==='string'&&id.length>0),'all item instances require IDs');
 assert.equal(new Set(ids).size,ids.length,'duplicate physical item instance');
 return new Set(ids);
};
const countById=items=>items.reduce((m,item)=>{
 m[item.id]=(m[item.id]||0)+1;return m;
},{});
// Uses only shipped rules, the original independent floor receipts, banked
// account proof and the untouched 10-band official calculator observations.
export function validateFirstEntryOwner(account,record,strengthOwners,{requireComplete=true}={}){
 assert.equal(record.seed,account.seed);
 assert.ok(Array.isArray(record.entries)&&record.entries.length>0);
 if(requireComplete)assert.equal(record.entries.length,100,'100 physical first entries per completed owner');
 assert.equal(record.receipts.length,record.entries.length);
 assert.equal(record.reachedEvents.length,10);
 const steps=record.sorties;
 assert.ok(steps.length>0);
 for(let i=0;i<steps.length;i++){
  const t=steps[i];
  assert.equal(t.sortie,i+1);
  assert.ok(t.start>=1&&t.start<=t.goal&&t.goal<=100);
  assert.ok(t.fights>=(i?steps[i-1].fights:0));
 }
 for(let i=0;i<10;i++){
  assert.equal(record.reachedEvents[i].from,i*10+1);
  const official=strengthOwners[i];
  assert.deepEqual(record.reachedEvents[i].firstReached,official.firstReached,
   'official post-return assessment must not be backdated or rewritten');
  const reached=official.firstReached;
  if(!reached)continue;
  const event=steps[reached.actualSorties-1];
  assert.ok(event&&event.returned,'strength reached only after a banked return');
  assert.equal(event.fights,reached.actualFights,'reached event must be on a real sortie');
  assert.equal(steps.slice(0,reached.actualSorties).filter(x=>x.returned).length,
   reached.actualReturns,'reached event must match the return ledger');
 }
 const seen=new Set(),byLayer=new Map(),firstBySortie=new Map();
 let prev=null;
 for(let i=0;i<record.entries.length;i++){
  const e=record.entries[i],receipt=record.receipts[i];
  assert.equal(e.event,'FIRST_ENTRY');
  assert.equal(e.assessment,'NOT_ASSESSED_AT_FIRST_ENTRY',
   'unassessed entry must never be promoted using a later calculator result');
  assert.equal(e.seed,account.seed);
  assert.equal(e.style,account.style);
  assert.equal(e.route,account.route);
  assert.ok(Number.isSafeInteger(e.layer)&&e.layer>=1&&e.layer<=100);
  assert.ok(!seen.has(e.layer),'duplicate first physical entry');
  seen.add(e.layer);byLayer.set(e.layer,e);
  assert.equal(e.eventNumber,i+1,'first-entry event IDs are strictly increasing');
  assert.equal(e.layer,i+1,'first-entry floors are contiguous and chronological');
  assert.equal(e.firstFightNumber,(e.layer-1)*5+1);
  assert.equal(e.actualSorties,e.sortie);
  const sortie=steps[e.sortie-1];
  assert.ok(sortie,'sortie must exist in real combat trace');
  assert.equal(e.sortieStart,sortie.start);assert.equal(e.sortieGoal,sortie.goal);
  assert.ok(e.layer>=sortie.start&&e.layer<=sortie.goal);
  const previousSorties=steps.slice(0,e.sortie-1);
  const returns=previousSorties.filter(t=>t.returned).length;
  const losses=previousSorties.filter(t=>t.defeat).length;
  assert.equal(e.actualReturns,returns,'returns cannot come from the future');
  assert.equal(e.actualLosses,losses,'losses cannot come from the future');
  assert.equal(e.rank,previousSorties.at(-1)?.rank??0,'unearned rank cannot unlock a future start');
  assert.equal(e.bankedBestLayer,Math.max(0,...previousSorties.filter(t=>t.returned).map(t=>t.cleared)),
   'deepest banked floor cannot include the current unbanked expedition');
  assert.deepEqual(e.legalStarts,unlockedStartLayers({adventurerRank:e.rank}));
  assert.ok(e.legalStarts.includes(e.sortieStart),'sortie must have a legally earned start rank');
  assert.ok(e.bankedBestLayer>=0&&e.bankedBestLayer<=100);
  assert.equal(e.bankedStones,previousSorties.at(-1)?.stone??0,
   'unbanked drops cannot be invested on an expedition');
  assert.equal(e.bankedInk,previousSorties.at(-1)?.ink??0,
   'unbanked ink cannot be invested on an expedition');
  assert.equal(e.earned.stone,e.spent.stone+e.bankedStones);
  assert.equal(e.earned.ink,e.spent.ink+e.bankedInk);
  if(previousSorties.length)assert.equal(e.level,previousSorties.at(-1).levelAfter);
  assert.ok(Number.isSafeInteger(e.level)&&e.level>=1&&e.level<=150);
  assert.ok(Number.isFinite(e.xp)&&e.xp>=0);
  assert.ok(e.playerHp>=0&&e.playerHp<=e.maxHp&&e.playerMp>=0&&e.playerMp<=e.maxMp);
  assert.equal(e.circles.length,5,'the active deck contains five true spells');
  assert.equal(e.cooldowns.length,5);
  assert.ok(Array.isArray(e.statuses));
  for(const c of e.circles){
   assert.ok(Number.isSafeInteger(c.upgradeLevel)&&c.upgradeLevel>=0);
   assert.equal(c.power,strengthenedPower(c.basePower,c.upgradeLevel),
    'no future upgrade power may be copied into an earlier first entry');
   assert.equal(c.mpCost,G.spellMpCost(c),'the shipped MP cost must be preserved');
  }
  assert.ok(e.circles.reduce((n,c)=>n+totalUpgradeStoneCost(c.upgradeLevel),0)<=e.spent.stone,
   'spell upgrades must have been funded by previously banked stones');
  const expectedHero=G.makeUnit(e.playerBase,e.level,{},e.circles,'hero');
  assert.equal(e.maxHp,expectedHero.stats.hp);
  assert.equal(e.maxMp,expectedHero.maxMp);
  const initial=uniqueIds(e.sortieInitialCarry),current=uniqueIds(e.carry);
  assert.ok(Number.isSafeInteger(e.itemSerial)&&e.itemSerial>=0);
  assert.ok(Number.isSafeInteger(e.warehouseCount)&&e.warehouseCount>=0);
  const warehouse=Buffer.from(e.warehouseBits,'base64');
  assert.equal(warehouse.length,Math.ceil(e.itemSerial/4));
  let warehouseCount=0;
  for(let serial=0;serial<e.itemSerial;serial++){
   const state=(warehouse[serial>>2]>>((serial&3)*2))&3;
   assert.notEqual(state,3,'one item serial cannot exist twice');
   if(state)warehouseCount++;
  }
  assert.equal(warehouseCount,e.warehouseCount,'compressed warehouse ledger must reconcile');
  assert.ok(e.carry.length<=G.capacity(e.level),'real carry capacity');
  assert.ok(e.sortieInitialCarry.length<=G.capacity(e.level),'sortie packed within real capacity');
  for(const item of e.sortieInitialCarry){
   const match=/^(item|crafted)-([1-9][0-9]*)$/.exec(item.instanceId);
   assert.ok(match,'physical carry has a tracked minted ID');
   const serial=Number(match[2])-1;
   assert.ok(Number.isSafeInteger(serial)&&serial>=0&&serial<e.itemSerial);
   assert.equal((warehouse[serial>>2]>>((serial&3)*2))&3,0,
    'equipped item instance cannot simultaneously remain in bank');
  }
  assert.ok([...current].every(id=>initial.has(id)),
   'carried items may only come from initial owned instances');
  const usedItems=e.sortieInitialCarry.filter(item=>!current.has(item.instanceId));
  assert.deepEqual(countById(usedItems),Object.fromEntries(
   Object.entries(e.usedById).filter(([,n])=>n!==0)),
   'used physical instances cannot reappear or be consumed twice');
  const itemLedger=e.itemLedger;
  assert.equal(itemLedger.bankedDrops+itemLedger.alchemyCreated-
   itemLedger.battleConsumed-itemLedger.alchemyConsumed,
   e.warehouseCount+e.sortieInitialCarry.length,
   'warehouse and original carry must reconcile to paid banked acquisitions');
  assert.ok(Number.isFinite(e.unbankedXp)&&e.unbankedXp>=0);
  assert.ok(Number.isSafeInteger(e.unbankedStone)&&e.unbankedStone>=0);
  assert.ok(Number.isSafeInteger(e.unbankedInk)&&e.unbankedInk>=0);
  assert.equal(receipt.layer,e.layer);assert.equal(receipt.sortie,e.sortie);
  assert.equal(receipt.fightsBefore,e.actualFights,
   'first entry must precede the first battle, not follow a later fight');
  assert.ok(receipt.floor&&receipt.floor.layer===e.layer&&receipt.floor.sortie===e.sortie);
  assert.ok(receipt.floor.attemptedFights>=1&&receipt.floor.attemptedFights<=5);
  assert.ok(close(100*e.playerHp/e.maxHp,receipt.floor.entryHpPercent),
   'entry HP must be the HP measured before the actual first fight');
  assert.ok(close(100*e.playerMp/e.maxMp,receipt.floor.entryMpPercent),
   'entry MP must be the MP measured before the actual first fight');
  const previous=receipt.previousFloor;
  if(previous){
   assert.equal(previous.layer,e.layer-1);
   assert.equal(previous.sortie,e.sortie);
   assert.equal(previous.cleared,true,'cannot advance past a failed fight');
   const expectedHp=previous.layer%10===0?100:previous.exitHpPercent;
   const expectedMp=previous.layer%10===0?100:previous.exitMpPercent;
   assert.ok(close(100*e.playerHp/e.maxHp,expectedHp),
    'in-sortie HP must carry over from the previous fight');
   assert.ok(close(100*e.playerMp/e.maxMp,expectedMp),
    'in-sortie MP must carry over from the previous fight');
  }else{
   assert.equal(e.sortieStart,e.layer,'missing previous floor must be the sortie start');
   assert.equal(e.playerHp,e.maxHp,'new sortie starts at real max HP');
   assert.equal(e.playerMp,e.maxMp,'new sortie starts at real max MP');
   assert.equal(e.unbankedXp,0);
   assert.equal(e.unbankedStone,0);
   assert.equal(e.unbankedInk,0);
  }
  if(prev){
   assert.ok(e.actualFights>=prev.actualFights);
   assert.ok(e.actualSorties>=prev.actualSorties);
   assert.ok(e.actualReturns>=prev.actualReturns);
   assert.ok(e.actualLosses>=prev.actualLosses);
   assert.ok(e.earned.stone>=prev.earned.stone);
   assert.ok(e.earned.ink>=prev.earned.ink);
   assert.ok(e.spent.stone>=prev.spent.stone);
   assert.ok(e.spent.ink>=prev.spent.ink);
   if(prev.sortie===e.sortie){
    assert.equal(e.level,prev.level);
    assert.equal(e.xp,prev.xp);
    assert.equal(e.rank,prev.rank);
    assert.deepEqual(e.circles,prev.circles,
     'no off-camp magic circle improvement is legal');
    assert.deepEqual(e.earned,prev.earned);
    assert.deepEqual(e.spent,prev.spent);
    assert.deepEqual(e.sortieInitialCarry,prev.sortieInitialCarry);
    assert.equal(e.warehouseCount,prev.warehouseCount);
    assert.equal(e.itemSerial,prev.itemSerial);
    assert.equal(e.warehouseBits,prev.warehouseBits);
    if(prev.layer===e.layer-1){
     const last=record.receipts[i-1].floor;
     assert.ok(close(e.unbankedXp,prev.unbankedXp+last.gainedXp),
      'pending EXP must come from actual battles in this sortie');
     assert.equal(e.unbankedStone,prev.unbankedStone+last.pendingStone);
     assert.equal(e.unbankedInk,prev.unbankedInk+last.pendingInk);
    }
   }
  }
  const decade=account.firstDecadeEntries[e.layer];
  if(decade){
   for(const key of ['sortie','level','rank','xp','actualFights','actualReturns',
    'actualLosses','bankedStones','bankedInk','playerHp','playerMp','maxHp','maxMp',
    'unbankedXp','unbankedStone','unbankedInk'])
    assert.equal(e[key],decade[key],'existing decade entry must agree: '+key);
   assert.deepEqual(e.circles,decade.circles);
   assert.deepEqual(e.cooldowns,decade.cooldowns);
   assert.deepEqual(e.statuses,decade.statuses);
   assert.deepEqual(e.carry,decade.carry);
  }
  if(!firstBySortie.has(e.sortie))firstBySortie.set(e.sortie,e);
  prev=e;
 }
 assert.equal(seen.size,record.entries.length);
 if(requireComplete)for(let layer=1;layer<=100;layer++)
  assert.ok(seen.has(layer),'missing first-entry floor '+layer);
 return record.entries.length;
}

function main(){
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
assert.equal(report.firstEntryEvidence.schemaVersion,'dungeon-first-entry-v1');
assert.equal(report.firstEntryEvidence.status,'FIRST_ENTRY_NOT_CALCULATOR_ASSESSED');
assert.equal(report.firstEntryEvidence.total,153600);
assert.equal(report.firstEntryEvidence.policies.length,6);
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
 const entryMeta=report.firstEntryEvidence.policies.find(x=>
  x.style===meta.style&&x.route===meta.route);
 assert.ok(entryMeta,'every policy has its own first-entry evidence shard');
 assert.equal(entryMeta.file,'dungeon-first-entry-v1-'+meta.style+'-'+meta.route+'.json');
 const firstEntryShard=JSON.parse(readFileSync(
  new URL('../reports/'+entryMeta.file,import.meta.url),'utf8'));
 assert.equal(firstEntryShard.schemaVersion,'dungeon-first-entry-v1');
 assert.equal(firstEntryShard.style,meta.style);assert.equal(firstEntryShard.route,meta.route);
 assert.equal(firstEntryShard.samples,256);
 assert.equal(firstEntryShard.owners.length,256);
 assert.equal(firstEntryShard.owners.reduce((n,o)=>n+o.entries.length,0),entryMeta.entries);
 for(let ownerIndex=0;ownerIndex<256;ownerIndex++){
  const account=policy.accounts[ownerIndex];
  const proof=firstEntryShard.owners[ownerIndex];
  const bands=policy.journeyStrength.map(b=>b.owners[ownerIndex]);
  assert.equal(proof.seed,seeds[ownerIndex]);
  validateFirstEntryOwner({...account,style:policy.style,route:policy.route},
   proof,bands,{requireComplete:true});
 }
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
console.log('DUNGEON_FIRST_ENTRY_STRICT 153600/153600 FIRST_ENTRY, UNASSESSED_AT_FIRST_ENTRY, full legal evidence');
console.log('PASS 60/60 strength bands, 1536/1536 actual F100 clears and 60 owner-level 80/80 chapter gates');

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
