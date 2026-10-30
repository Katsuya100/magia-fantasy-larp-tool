// Full 256-owner formula audit for the six unchanged legal journey policies.
// The campaign path remains genuine; the recommended-strength ledger is a
// separate deterministic calculation and never runs fights or grants rewards.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,openSync,writeSync,closeSync,renameSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as G from '../assets/js/dungeon-core.mjs';
import {assert256Seeds,assertPreRecoveryRankGate,summarizeJourneyStrength}
 from './dungeon-test-contract.mjs';
import {runJourney,approvedGoals,ECONOMY_VERSION} from './simulate-dungeon-journeys.mjs';

assert.equal(approvedGoals.strictSamples,256,'fixed owner denominator');
assert.equal(approvedGoals.bands.length,10,'all ten authored bands');
const seeds=Array.from({length:256},(_,i)=>17011+13*i);
assert256Seeds(seeds);
const sources=[
 'assets/data/dungeon-balance.csv','assets/data/dungeon-enemies.csv',
 'assets/data/dungeon-floors.csv','assets/data/dungeon-levels.csv',
 'assets/data/dungeon-player-base.csv','assets/data/dungeon-consumables.csv',
 'assets/data/dungeon-collections.csv','assets/data/dungeon-buffs.csv',
 'assets/js/dungeon-core.mjs','assets/js/dungeon-tuning.mjs',
 'assets/js/dungeon-design.mjs','assets/js/dungeon-upgrades.mjs',
 'assets/js/dungeon-ranks.mjs','assets/js/dungeon-alchemy.mjs',
 'scripts/dungeon-balance-encounters.mjs','scripts/simulate-dungeon-journeys.mjs',
 'scripts/dungeon-test-contract.mjs','scripts/dungeon-fixed-deck-reference.mjs',
 'scripts/dungeon-recommended-strength.mjs','scripts/dungeon-journey-strength-audit.mjs',
 'scripts/check-dungeon-journey-strength.mjs','tests/test-dungeon-floor-strength.mjs',
 'config/dungeon-approved-goals.v1.json'
];
const sourceHashes=Object.fromEntries(sources.map(path=>[path,
 createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
const policies=[];
const ranks=[];
const firstEntryReferences=[];
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
function* jsonChunks(value,depth=0){
 if(value===null||typeof value!=='object'){
  yield JSON.stringify(value);return;
 }
 const entries=Array.isArray(value)?value:Object.entries(value)
  .filter(([,child])=>child!==undefined);
 if(!entries.length){yield Array.isArray(value)?'[]':'{}';return;}
 const array=Array.isArray(value),open=array?'[':'{',close=array?']':'}';
 yield open+'\n';
 for(let index=0;index<entries.length;index++){
  const entry=entries[index];
  yield '  '.repeat(depth+1);
  if(array)yield* jsonChunks(entry,depth+1);
  else{
   yield JSON.stringify(entry[0])+': ';
   yield* jsonChunks(entry[1],depth+1);
  }
  yield index<entries.length-1?',\n':'\n';
 }
 yield '  '.repeat(depth)+close;
}
function writeReportFile(file,value){
 const target=new URL('../reports/'+file,import.meta.url);
 const pending=new URL('../reports/'+file+'.tmp',import.meta.url);
 const descriptor=openSync(pending,'w');
 try{
  let buffer='';
  for(const chunk of jsonChunks(value)){
   buffer+=chunk;
   if(buffer.length>=64*1024){writeSync(descriptor,buffer);buffer='';}
  }
  writeSync(descriptor,buffer+'\n');
 }finally{closeSync(descriptor);}
 renameSync(pending,target);
}

for(const style of ['A','B','C'])for(const route of ['short','long']){
 const accounts=[],entryOwners=[],strengthOwners=approvedGoals.bands.map(band=>({
  band:band.from+'-'+band.to,owners:[]}));
 for(const seed of seeds){
  const run=runJourney(seed,{style,route,maxSorties:600,maxFights:6500,
   observeStrength:true,observeFirstEntry:true});
  assert.equal(run.seed,seed);
  assert.equal(run.style,style);assert.equal(run.route,route);
  assert.equal(run.resourceLedger.items.held,run.inventory);
  assert.equal(run.earned.stone,run.spent.stone+run.balances.stone);
  assert.equal(run.earned.ink,run.spent.ink+run.balances.ink);
  assert.equal(run.resourceLedger.items.bankedDrops+run.resourceLedger.items.alchemyCreated,
   run.resourceLedger.items.battleConsumed+run.resourceLedger.items.alchemyConsumed+run.inventory);
  for(const record of run.rankAudit)assertPreRecoveryRankGate(record);
  // The battle trace, not the formula readiness result, proves 100F was won.
  // A successful banked floor has five real fights and a real return.
  const credited=new Map();
  for(const row of run.floorAudit){
   if(row.cleared&&row.banked&&row.attemptedFights===5&&!credited.has(row.layer))
    credited.set(row.layer,{layer:row.layer,sortie:row.sortie,
     attemptedFights:row.attemptedFights,cleared:row.cleared,banked:row.banked});
  }
  const clearedFloors=Array.from({length:100},(_,i)=>credited.get(i+1)??null);
  const trace=run.trace.map(step=>({sortie:step.sortie,start:step.start,
   goal:step.goal,cleared:step.cleared,returned:step.returned,
   defeat:step.defeat,rank:step.rank}));
  const legalStarts=trace.every((step,i)=>step.start>=1&&step.goal<=100&&
   step.start<=step.goal&&step.start<=(i?trace[i-1].rank:0)+1&&
   step.rank>=(i?trace[i-1].rank:0));
  const finalClear=clearedFloors[99];
  const finalReturn=finalClear?trace.find(step=>
   step.sortie===finalClear.sortie&&step.returned&&step.cleared>=100):null;
  const actualCompletion=run.best>=100&&clearedFloors.every(Boolean)&&
   Boolean(finalReturn)&&legalStarts;
  // Independent finished-floor receipts anchor the entry claims to actual
  // fights and resulting HP/MP, including replayed floors.
  const before=new Map(),floors=new Map();
  let fightPrefix=0;
  for(const floor of run.floorAudit){
   const id=floor.sortie+'/'+floor.layer;
   before.set(id,fightPrefix);floors.set(id,floor);
   fightPrefix+=floor.attemptedFights;
  }
  assert.equal(fightPrefix,run.fights,'all observed battles have real receipts');
  const entries=Object.values(run.firstEntries);
  entryOwners.push({seed,entries,
   reachedEvents:approvedGoals.bands.map(band=>({from:band.from,
    firstReached:run.journeyStrength[band.from]?.firstReached??null})),
   receipts:entries.map(entry=>{
   const id=entry.sortie+'/'+entry.layer;
   return {layer:entry.layer,sortie:entry.sortie,
    fightsBefore:before.get(id),floor:floors.get(id),
    previousFloor:floors.get(entry.sortie+'/'+(entry.layer-1))??null};
  }),sorties:run.trace.map(t=>({sortie:t.sortie,start:t.start,goal:t.goal,
   fights:t.fights,returned:t.returned,defeat:t.defeat,
   cleared:t.cleared,rank:t.rank,stone:t.stone,ink:t.ink,levelAfter:t.levelAfter}))});
  accounts.push({seed,best:run.best,level:run.profile.level,rank:run.profile.rank,
   completed:actualCompletion,sorties:run.sorties,returns:run.returns,losses:run.losses,
   fights:run.fights,blockers:run.blockers,rankAudit:run.rankAudit,
   completionEvidence:{clearedFloors,trace,legalStarts,
    finalReturnSortie:finalReturn?.sortie??null},
   firstDecadeEntries:run.entrySnapshots,
   resourceLedger:run.resourceLedger,earned:run.earned,spent:run.spent,
   balances:run.balances});
  for(const [index,band] of approvedGoals.bands.entries()){
   const result=run.journeyStrength[band.from];
   assert.ok(result,'every account must record all ten formula bands');
   assert.equal(result.band,band.from+'-'+band.to);
   strengthOwners[index].owners.push({
    seed,status:result.status,attempts:result.attempts,
    firstReached:result.firstReached,lastAssessment:result.lastAssessment});
  }
 }
 const policy={style,route,samples:accounts.length,completion:accounts.filter(x=>x.completed).length,
  accounts,journeyStrength:strengthOwners};
 const summary=summarizeJourneyStrength(policy,seeds);
 policy.strengthSummary=summary;
 for(const band of approvedGoals.bands){
  const checks=accounts.flatMap(owner=>owner.rankAudit)
   .filter(row=>row.layer===band.to);
  const eligible=checks.filter(row=>row.eligible).length;
  const banked=checks.filter(row=>row.banked&&row.eligible).length;
  // Only real, returned, banked badge awards count; repeated boss checks
  // are never mistaken for additional owners.
  const acquiredOwners=accounts.filter(account=>account.rankAudit.some(row=>
   row.layer===band.to&&row.eligible&&row.banked&&
   row.hpPercent>=80&&row.mpPercent>=80)).length;
  const missingSeeds=accounts.filter(account=>!account.rankAudit.some(row=>
   row.layer===band.to&&row.eligible&&row.banked&&
   row.hpPercent>=80&&row.mpPercent>=80)).map(account=>account.seed);
  ranks.push({style,route,chapter:band.from+'-'+band.to,rankLayer:band.to,
   eligible,banked,checks:checks.length,acquiredOwners,missingSeeds,
   thresholdHp:approvedGoals.rank.bothHpMpPercentAtLeast,
   thresholdMp:approvedGoals.rank.bothHpMpPercentAtLeast,
   moment:'ACTUAL_BOSS_KILL_BEFORE_VICTORY_RECOVERY',
   status:'INDEPENDENT_80_80_RANK_ACQUISITION'});
 }
 policies.push(policy);
 const firstEntryFile='dungeon-first-entry-v1-'+style+'-'+route+'.json';
 writeReportFile(firstEntryFile,{schemaVersion:'dungeon-first-entry-v1',style,route,
  samples:seeds.length,owners:entryOwners});
 firstEntryReferences.push({style,route,file:firstEntryFile,
  samples:seeds.length,entries:entryOwners.reduce((n,owner)=>n+owner.entries.length,0)});
 console.log('DUNGEON_JOURNEY_STRENGTH_POLICY '+JSON.stringify({
  style,route,samples:accounts.length,completion:policy.completion,
  chapterOwners:ranks.filter(rank=>rank.style===style&&rank.route===route)
   .map(rank=>({layer:rank.rankLayer,acquired:rank.acquiredOwners,missing:rank.missingSeeds.length})),
  bands:summary.map(x=>({band:x.band,reached:x.reached,unreached:x.unreached,
   status:x.status}))}));
}
// Keep the entire evidence for all 15,360 owner-band cases, but shard by
// legal policy. A monolithic report exceeds Node's maximum UTF-8 string size
// and makes a real strict audit impossible to parse.
const policyReferences=policies.map(({style,route,samples,completion,strengthSummary})=>({
 style,route,samples,completion,strengthSummary,
 file:'dungeon-journey-strength-v2-'+style+'-'+route+'.json'
}));
const report={
 schemaVersion:'dungeon-journey-strength-v2',
 strengthModel:'dungeon-recommended-strength-v3',
 economySource:ECONOMY_VERSION,method:'RECOMMENDED_STRENGTH_FORMULA_LEDGER',
 journeyExecution:{
  continuationRule:'NORMAL_CAMPAIGN_THEN_REAL_SORTIES_AND_POST_RETURN_INVESTMENT_UNTIL_ALL_TEN_BANDS_REACHED',
  postCampaignStartLayer:91,postCampaignGoalLayer:100,enemyLayerCap:100,
  maxSorties:600,maxFights:6500,maxTurnsPerFight:80,
  stopRule:'CAMPAIGN_AND_ALL_TEN_BANDS_REACHED_OR_EXISTING_SORTIE_FIGHT_BUDGET_EXHAUSTED'},
 seedRule:'17011+13*i',samplesPerPolicy:approvedGoals.strictSamples,
 policies:policyReferences,ranks,sourceHashes,
 firstEntryEvidence:{schemaVersion:'dungeon-first-entry-v1',
  status:'FIRST_ENTRY_NOT_CALCULATOR_ASSESSED',
  total:firstEntryReferences.reduce((n,p)=>n+p.entries,0),
  policies:firstEntryReferences},
 legacyDisposition:{
  rule:'OLD_REAL_FIXED_DECK_FLOOR_BATTLES_PARETO_COMPARISONS_AND_THREE_PAID_REPLAY_CYCLES_ARE_NOT_THIS_GATE',
  previousReport:'reports/dungeon-journey-strength-v1.json',
  previousMeasuredOutcome:'6,474 REACHED / 8,886 UNMET preserved as v1 evidence',
  preLoopFixReport:'reports/pr264-journey-strength-v2-pre-loopfix-20261030.json',
  preLoopFixOutcome:'13,304 REACHED / 2,056 UNMET; preserved as a separate result, not reused or relabelled',
  oldResults:'PRESERVED_AS_LEGACY_EVIDENCE_ONLY; NOT_REUSED_OR_RELABELLED_AS_FORMULA_PASSES',
  knownUnmet:{'B/short/F90':'255/256 legacy rank; not promoted',
   'C/long/F100':'255/256 legacy rank; not promoted',
   'C/long/F91-100':'255/256 legacy farming; not promoted'},
  independentChapterRule:'The boss-kill 80/80 HP/MP rank acquisition check remains separate and unchanged',
  xpTaper:'NOT_IMPLEMENTED'}
};
const output=new URL('../reports/dungeon-journey-strength-v2.json',import.meta.url);
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
// The index is committed only after every full-evidence policy shard exists.
for(let i=0;i<policies.length;i++)
 writeReportFile(policyReferences[i].file,policies[i]);
writeReportFile('dungeon-journey-strength-v2.json',report);
console.log('DUNGEON_JOURNEY_STRENGTH_REPORT '+output.pathname);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log('DUNGEON_JOURNEY_STRENGTH_SUMMARY '+JSON.stringify({
  policies:policies.length,bands:approvedGoals.bands.length,
  ownersPerPolicy:seeds.length,formulaRows:policies.length*approvedGoals.bands.length,
  formulaOwnerRows:policies.length*approvedGoals.bands.length*seeds.length,
  firstEntryRows:firstEntryReferences.reduce((n,p)=>n+p.entries,0),
  status:'FORMULA_RESULTS_RECORDED; NO_BATTLE_PROOF'}));
