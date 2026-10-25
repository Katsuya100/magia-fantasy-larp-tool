// Strict checks for real, banked journey readiness and independent build growth.
// 60 actual-owner win rates are diagnostics; the fixed-deck job exclusively
// enforces approved 256-seed win/MP targets. Never auto-approve references.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const goals=load('config/dungeon-approved-goals.v1.json');
const combat=load('reports/dungeon-linked-256-combat-v1.json');
const verdict=load('reports/dungeon-redefined-verdicts-v1.json');
const paired=load('reports/dungeon-paired-build-strength-v1.json');
const samples=goals.strictSamples;
assert.equal(samples,256);
assert.equal(combat.combatSamples,samples);
assert.equal(paired.strictSamples,samples);
assert.equal(goals.bands.length,10);
assert.equal(verdict.COMBAT_BALANCE.length,10);
assert.equal(verdict.JOURNEY_READINESS.length,60);
assert.equal(verdict.EXTRA_FARMING.length,60);
assert.equal(verdict.RANK_ACQUISITION.length,10);
assert.equal(verdict.BUILD_STRATEGY.length,4);
assert.equal(combat.cases.length,60);
assert.equal(paired.cases.length,60);
assert.equal(paired.candidatePromoted,false,'unapproved candidate must remain unapproved');
const expected=new Set();
for(const style of ['A','B','C'])
 for(const route of ['short','long'])
  for(const band of goals.bands)expected.add(style+'/'+route+'/'+band.from+'-'+band.to);
const failures=[];
const seen=new Set();
const indexed=(rows,kind)=>{
 const map=new Map();
 for(const row of rows){
  const key=row.style+'/'+row.route+'/'+row.band;
  if(!expected.has(key)||map.has(key))failures.push(kind+' duplicate/unknown: '+key);
  map.set(key,row);
 }
 if(map.size!==expected.size)failures.push(kind+' missing cases: '+(expected.size-map.size));
 return map;
};
const ready=indexed(verdict.JOURNEY_READINESS,'JOURNEY_READINESS');
const farming=indexed(verdict.EXTRA_FARMING,'EXTRA_FARMING');
const builds=indexed(paired.cases,'BUILD_STRENGTH');
const diagnostics=indexed(combat.cases,'OWNER_COMBAT_DIAGNOSTIC');
let readyCases=0,strengthCases=0,extraCases=0;
for(const key of expected){
 const r=ready.get(key),f=farming.get(key),b=builds.get(key),d=diagnostics.get(key);
 if(!r||!f||!b||!d)continue;
 if(r.count!==samples||r.prepared+r.unprepared!==samples||
   r.prepared!==samples||r.status!=='ALL_ACCOUNTS_PREPARED')
  failures.push(key+' JOURNEY_READINESS '+r.prepared+'/'+samples);
 else readyCases++;
 if(d.strictDenominator!==samples||d.ownersAvailable+d.ownersMissing!==samples||
  d.readinessGate!=='ALL_256_INDEPENDENTLY_PREPARED')
  failures.push(key+' diagnostic owner coverage missing (NOT a win-rate failure)');
 // Six genuine routes must actually produce post-bank replay observations.
 if(f.ownerCoverage!==samples||f.stages?.length!==4||f.paired?.length!==3||
  f.stages[0]?.observedAccounts!==samples||
  f.paired.some((stage,i)=>stage.extraLoops!==i+1||stage.matchedSeeds!==samples))
  failures.push(key+' EXTRA_FARMING lacks complete 1/2/3 real banked replays');
 else extraCases++;
 if(b.population!==samples||b.observed+b.missing!==samples||
  b.stronger!==samples||b.passed!==true)
  failures.push(key+' BUILD_STRENGTH '+b.stronger+'/'+samples+
   ', paired='+b.observed+', missing='+b.missing);
 else strengthCases++;
}
for(const rank of verdict.RANK_ACQUISITION){
 if(rank.thresholdHp!==80||rank.thresholdMp!==80||
    rank.moment!=='BOSS_KILL_BEFORE_VICTORY_AND_MILESTONE_RECOVERY'||
    rank.policies?.length!==6)
  failures.push('RANK_ACQUISITION invalid independent 80/80 boss gate '+rank.band);
 for(const row of rank.policies||[]){
  if(!Number.isInteger(row.checks)||row.checks<0||row.eligible<0||
     row.eligible>row.checks||row.actuallyBanked>row.eligible)
   failures.push('RANK_ACQUISITION inconsistent real awards '+rank.band);
 }
}
for(const s of verdict.BUILD_STRATEGY){
 if(s.commonRealSeeds!==samples||!['B','C'].includes(s.strategy)||
    !['short','long'].includes(s.route)||!s.costs||s.checkpoints?.length!==10)
  failures.push('BUILD_STRATEGY missing paid, paired evidence '+s.route+'/'+s.strategy);
}
const coverage=combat.coverage;
if(coverage?.cases!==60||coverage.policies!==6||
 coverage.approvedSeeds!==samples||
 coverage.measured+coverage.economyNotReady!==60)
 failures.push('Real-owner diagnostic coverage ledger invalid');
console.log('DUNGEON_JOURNEY_STRICT_GATE '+JSON.stringify({
 approvedSeeds:samples,cases:60,
 JOURNEY_READINESS:readyCases,BUILD_STRENGTH:strengthCases,
 EXTRA_FARMING:extraCases,RANK_ACQUISITION:verdict.RANK_ACQUISITION.length,
 BUILD_STRATEGY:verdict.BUILD_STRATEGY.length,
 diagnosticWinRateMatches:coverage?.diagnosticMatches,
 failures:failures.length}));
assert.equal(failures.length,0,'Journey progression and paired build strength unmet:\n'+
 failures.slice(0,100).join('\n')+(failures.length>100?'\n... additional failures': ''));
