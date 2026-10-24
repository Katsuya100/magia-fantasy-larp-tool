// Full 256-account seeded A/B/C x short/long (D) progression audit.
// This is gameplay/economy measurement, not a substitute for the separate
// frozen, approved 256-seed ten-layer combat acceptance gates.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runJourney,spread,ECONOMY_VERSION} from './simulate-dungeon-journeys.mjs';
import * as G from '../assets/js/dungeon-core.mjs';

const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const goals=load('config/dungeon-approved-goals.v1.json');
assert.equal(goals.strictSamples,256,'approved strict sample count must not be lowered');
assert.equal(goals.bands.length,10,'all ten authored bands are required');
assert.equal(goals.playerLevelMax,150,'approved Lv150 cap must remain unchanged');
const sourceHashes=Object.fromEntries([
 'assets/data/dungeon-balance.csv',
 'assets/data/dungeon-enemies.csv',
 'assets/data/dungeon-floors.csv',
 'assets/data/dungeon-levels.csv',
 'assets/data/dungeon-player-base.csv',
 'assets/data/dungeon-consumables.csv',
 'assets/data/dungeon-collections.csv',
 'assets/data/dungeon-buffs.csv',
 'assets/js/dungeon-core.mjs',
 'assets/js/dungeon-design.mjs',
 'assets/js/dungeon-upgrades.mjs',
 'assets/js/dungeon-ink.mjs',
 'assets/js/dungeon-ranks.mjs',
 'assets/js/dungeon-alchemy.mjs',
 'scripts/dungeon-balance-encounters.mjs',
 'scripts/simulate-dungeon-journeys.mjs',
 'scripts/dungeon-coherent-battle.mjs',
 'config/dungeon-approved-goals.v1.json'
].map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]));
const seeds=Array.from({length:goals.strictSamples},(_,i)=>17011+13*i);
const select=x=>({seed:x.seed,level:x.profile.level,rank:x.profile.rank,
 reachedLayer:x.best,fights:x.fights,repeatedFights:x.replayedFights,
 bankedStone:x.balances.stone,bankedInk:x.balances.ink,
 stoneEarned:x.earned.stone,inkEarned:x.earned.ink,
 stoneSpent:x.spent.stone,inkSpent:x.spent.ink,
 deathCount:x.losses,sorties:x.sorties,returns:x.returns,
 redraws:x.replacements,crafts:x.alchemyCrafts,
 purposeFarmFights:x.farmingFights,recoveryFights:x.recovery.extraFights,
 rankGranted:x.rankGranted,
 recoveryComparison:x.recovery.comparison,
 recoveryTargetUpgrades:x.recovery.targetUpgrades,
 recoveryAchieved:x.recovery.achieved,
 gradeEligible:x.rankAudit.filter(r=>r.eligible).length,
 gradeFailedMp:x.rankAudit.filter(r=>r.failure?.includes('MP_BELOW_80')).length,
 gradeFailedHp:x.rankAudit.filter(r=>r.failure?.includes('HP_BELOW_80')).length,
 ownedItems:x.resourceLedger.items.held,collections:x.resourceLedger.collections.held,
 completed:x.best>=100,blockers:x.blockers,
 firstDecadeClearances:goals.bands.map(b=>{
  const cleared=x.trace.find(t=>t.cleared>=b.to&&!t.defeat);
  return {layer:b.to,fights:cleared?.fights??null,
   sorties:cleared?.sortie??null,level:cleared?.levelAfter??null};
 })});
const stats=values=>spread(values.filter(Number.isFinite));
const report={schemaVersion:'dungeon-linked-256-economy-v1',source:ECONOMY_VERSION,
 status:'STRUCTURAL_AUDIT_NOT_BALANCE_CERTIFICATION',
 scope:'authored 1-100F only; 101-150F is conditional drop extrapolation',
 samplesPerPolicy:goals.strictSamples,seedRule:'17011+13*i',
 sourceHashes,policies:[],warnings:[
  'A/B/C are different genuine stone/ink allocation strategies; D is long-expedition route paired with each.',
  'Reference five-circle drawing and fixed hero base are explicit controlled assumptions, not real photo/image RNG.',
  '256 independent complete accounts are not interchangeable with 256 attempts from a fully pre-prepared 50-fight sortie.',
  'Do not declare any win-rate, MP or rank goal met from account completion alone.',
  'No 101-150F authored combat, mandatory 101-150F clear, or new p90 replay threshold is implied.'
 ]};
for(const style of ['A','B','C'])for(const route of ['short','long']){
 const accounts=[],ownerEntries=[],entries=Array.from({length:10},(_,i)=>({band:10*i+1,
  level:[],hp:[],mp:[],stone:[],ink:[],upgrades:[],
  records:0,carriedCleansers:[],storedCleansers:[]}));
 const floors=Array.from({length:100},(_,i)=>({layer:i+1,attempted:0,cleared:0,
  lost:0,replays:0,banked:0,cleansers:0,gradeChecks:0,gradeEligible:0,
  gradeBanked:0,entryHp:[],entryMp:[],exitHp:[],exitMp:[]}));
 let conservationChecks=0;
 for(const seed of seeds){
  const run=runJourney(seed,{style,route});
  assert.equal(run.seed,seed);
  assert.equal(run.spent.ink,run.replacements*5,
   'every paid circle redraw must use exactly five genuinely banked inks');
  assert.equal(run.recovery.comparison==='REAL_SAME_SEED_A_F31',style==='B',
   'B rehabilitation benchmark must be same-seed A, never candidate equipment');
  assert.equal(run.style,style);assert.equal(run.route,route);
  assert.equal(run.resourceLedger.items.held,run.inventory);
  assert.equal(run.resourceLedger.collections.held,
   Object.values(run.collection).reduce((a,b)=>a+b,0));
  assert.equal(run.earned.stone,run.spent.stone+run.balances.stone);
  assert.equal(run.earned.ink,run.spent.ink+run.balances.ink);
  assert.equal(run.resourceLedger.items.bankedDrops+run.resourceLedger.items.alchemyCreated,
   run.resourceLedger.items.battleConsumed+run.resourceLedger.items.alchemyConsumed+run.inventory);
  assert.equal(run.floorAudit.reduce((a,f)=>a+f.attemptedFights,0),run.fights,
   'every real battle must be in the per-floor audit');
  assert.ok(run.floorAudit.every(f=>!f.bossRank||f.layer%10===0));
  assert.ok(run.rankAudit.every(r=>!r.banked||r.eligible));
  assert.ok(run.rankAudit.every(r=>r.hpPercent>=80&&r.mpPercent>=80||!r.eligible));
  conservationChecks++;
  accounts.push(select(run));
  ownerEntries.push({seed,snapshots:goals.bands.map(b=>{
   const snap=run.entrySnapshots[b.from];
   return snap?{from:b.from,layer:snap.layer,sortie:snap.sortie,
    level:snap.level,rank:snap.rank,xp:snap.xp,
    playerBase:snap.playerBase,playerHp:snap.playerHp,playerMp:snap.playerMp,
    maxHp:snap.maxHp,maxMp:snap.maxMp,
    circles:snap.circles,cooldowns:snap.cooldowns,statuses:snap.statuses,
    carry:snap.carry,bankedItems:snap.bankedInventory.length,
    bankedStones:snap.bankedStones,bankedInk:snap.bankedInk,
    unbankedXp:snap.unbankedXp,unbankedStone:snap.unbankedStone,
    unbankedInk:snap.unbankedInk}:null;
  })});
  for(const [i,e] of entries.entries()){
   const snap=run.entrySnapshots[e.band];
   if(!snap)continue;
   assert.equal(snap.circles.length,5);
   assert.ok(snap.carry.length<=G.capacity(snap.level),
    'no first-entry owner may carry more than the actual game slots');
   const owned=[...snap.carry,...snap.bankedInventory];
   assert.equal(new Set(owned.map(x=>x.instanceId)).size,owned.length);
   assert.ok(owned.every(x=>typeof x.instanceId==='string'));
   e.records++;e.level.push(snap.level);e.hp.push(100*snap.playerHp/snap.maxHp);
   e.mp.push(100*snap.playerMp/snap.maxMp);
   e.stone.push(snap.bankedStones);e.ink.push(snap.bankedInk);
   e.upgrades.push(snap.circles.map(c=>c.upgradeLevel));
   e.carriedCleansers.push(snap.carry.length);
   e.storedCleansers.push(snap.bankedInventory.filter(x=>x.id.startsWith('clear_')||x.id==='luna_stone').length);
  }
  for(const row of run.floorAudit){
   const f=floors[row.layer-1];
   f.attempted++;f.cleared+=Number(row.cleared);f.lost+=Number(row.defeated);
   f.replays+=Number(row.replay);f.banked+=Number(row.cleared&&row.banked);
   f.cleansers+=row.usedOwnedCleansers;f.entryHp.push(row.entryHpPercent);
   f.entryMp.push(row.entryMpPercent);
   if(row.cleared){f.exitHp.push(row.exitHpPercent);f.exitMp.push(row.exitMpPercent);}
   if(row.bossRank){
    f.gradeChecks++;f.gradeEligible+=Number(row.bossRank.eligible);
    f.gradeBanked+=Number(row.bossRank.banked);
   }
  }
 }
 const distributionKeys=['reachedLayer','fights','repeatedFights','stoneEarned','inkEarned',
  'stoneSpent','inkSpent','bankedStone','bankedInk','deathCount','sorties','returns',
  'redraws','crafts','purposeFarmFights','recoveryFights','rankGranted','gradeEligible',
  'gradeFailedMp','gradeFailedHp','ownedItems','collections'];
 const dist=Object.fromEntries(distributionKeys.map(key=>[key,stats(accounts.map(x=>x[key]))]));
 const completion=accounts.filter(x=>x.completed).length;
 const policy={style,route,meaning:style+' + '+(route==='long'?'D long expedition':'short returns'),
  samples:accounts.length,completion,nonCompletion:accounts.length-completion,
  conservationChecks,distributions:dist,
  firstEntry:entries.map(e=>({from:e.band,to:e.band+9,actualAccounts:e.records,
   level:stats(e.level),entryHp:stats(e.hp),entryMp:stats(e.mp),stone:stats(e.stone),
   ink:stats(e.ink),ownedCarry:stats(e.carriedCleansers),
   bankedCleanserStock:stats(e.storedCleansers),
   upgrades:[0,1,2,3,4].map(i=>stats(e.upgrades.map(x=>x[i])))})),
  floors:floors.map(f=>({layer:f.layer,attempted:f.attempted,cleared:f.cleared,
   lost:f.lost,replays:f.replays,banked:f.banked,cleansersUsed:f.cleansers,
   gradeChecks:f.gradeChecks,gradeEligible:f.gradeEligible,gradeBanked:f.gradeBanked,
   entryHp:stats(f.entryHp),entryMp:stats(f.entryMp),
   winExitHp:stats(f.exitHp),winExitMp:stats(f.exitMp)})),
  accounts,ownerEntries};
 report.policies.push(policy);
 console.log('DUNGEON_LINKED_256_POLICY '+JSON.stringify({style,route,samples:accounts.length,
  completion,nonCompletion:accounts.length-completion,conservationChecks,
  p90RepeatFights:dist.repeatedFights.p90,p90Defeats:dist.deathCount.p90,
  gradeMedian:dist.rankGranted.median,
  noAutoAcceptance:true}));
}
// Full-campaign opportunity costs: same initial seed and source spells.
// Decisions may diverge, so later loot RNG streams are not forced identical.
report.pairedLongitudinalCosts=[];
for(const route of ['short','long']){
 const reference=report.policies.find(x=>x.style==='A'&&x.route===route);
 for(const style of ['B','C']){
  const variant=report.policies.find(x=>x.style===style&&x.route===route);
  const pairs=reference.accounts.map((a,i)=>{
   const b=variant.accounts[i];
   assert.equal(a.seed,b.seed,'paired strategy must use the same initial economic seed');
   if(style==='B'){
    const a31=reference.ownerEntries[i].snapshots[3];
    const actualAUpgrades=a31?.circles.map(c=>c.upgradeLevel)??null;
    assert.deepEqual(b.recoveryTargetUpgrades,actualAUpgrades,
     'B may target only actual same-seed A upgrades at F31');
   }
   const checkpointDeltas=goals.bands.map((goal,j)=>{
    const left=a.firstDecadeClearances[j],right=b.firstDecadeClearances[j];
    return {layer:goal.to,reachedBoth:left.fights!==null&&right.fights!==null,
     additionalFights:left.fights!==null&&right.fights!==null?right.fights-left.fights:null,
     additionalSorties:left.sorties!==null&&right.sorties!==null?right.sorties-left.sorties:null};
   });
   return {seed:a.seed,reached100A:a.completed,reached100Variant:b.completed,
    extraTotalFights:b.fights-a.fights,extraRepeatFights:b.repeatedFights-a.repeatedFights,
    extraDeaths:b.deathCount-a.deathCount,extraReturns:b.returns-a.returns,
    acquiredRankDifference:b.rankGranted-a.rankGranted,
    stoneBalanceDifference:b.bankedStone-a.bankedStone,
    inkBalanceDifference:b.bankedInk-a.bankedInk,
    inkActuallyConsumed:b.inkSpent,stoneActuallyConsumed:b.stoneSpent,
    paidRedraws:b.redraws,purposeFarmFights:b.purposeFarmFights,
    checkpointDeltas};
  });
  report.pairedLongitudinalCosts.push({route,style,baselineStyle:'A',
   samples:pairs.length,actualSameSeed:true,
   status:'LONGITUDINAL_OPPORTUNITY_MEASURED_NOT_EQUAL_READINESS_PROOF',
   measured:{extraTotalFights:stats(pairs.map(x=>x.extraTotalFights)),
    extraRepeatFights:stats(pairs.map(x=>x.extraRepeatFights)),
    extraDeaths:stats(pairs.map(x=>x.extraDeaths)),
    acquiredRankDifference:stats(pairs.map(x=>x.acquiredRankDifference)),
    inkActuallyConsumed:stats(pairs.map(x=>x.inkActuallyConsumed)),
    paidRedraws:stats(pairs.map(x=>x.paidRedraws))},
   checkpoints:goals.bands.map((b,i)=>({to:b.to,
    comparedPairs:pairs.filter(x=>x.checkpointDeltas[i].reachedBoth).length,
    extraFights:stats(pairs.map(x=>x.checkpointDeltas[i].additionalFights)),
    extraSorties:stats(pairs.map(x=>x.checkpointDeltas[i].additionalSorties))})),
   pairs});
 }
}
report.structuralChecks=report.policies.reduce((n,x)=>n+x.conservationChecks,0);
assert.equal(report.structuralChecks,6*goals.strictSamples);
assert.equal(report.policies.length,6);
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-linked-256-economy-v1.json',import.meta.url),
 JSON.stringify(report,null,2)+'\n');
const summary={status:'STRUCTURAL_ECONOMY_COMPLETE_NOT_BALANCE_CERTIFIED',
 samplesPerPolicy:goals.strictSamples,policies:report.policies.length,
 independentAccountsChecked:report.structuralChecks,
 completedPerPolicy:report.policies.map(p=>({style:p.style,route:p.route,
  completed:p.completion,of:p.samples}))};
console.log('DUNGEON_LINKED_256_SUMMARY '+JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
 '## Real 256-account A/B/C/D economic and combat journey audit\n'+
 'Accounts: '+summary.independentAccountsChecked+
 '; each uses real fought battles, bank/defeat rules, and conserved owned resources.\n'+
 report.policies.map(p=>p.style+' '+p.route+': '+p.completion+'/'+p.samples+
 ' reached 100F; median legally acquired ranks '+p.distributions.rankGranted.median).join('\n')+
 '\n**This structural sample does not certify approved strict 50-fight win/MP targets.**\n');
