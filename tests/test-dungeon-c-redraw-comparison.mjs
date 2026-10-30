// Regression of the real C short/long paid-redraw comparison.
// Ordinary CI checks the common scorer. Strict CI MUST also verify the
// report from all 256 economic owners, after running the battle comparisons.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pairedAdvantage} from '../scripts/dungeon-fixed-deck-pair.mjs';

const arm=(overrides={})=>({won:true,endHp:75,endMp:40,casts:20,
 spellMpSpent:50,remainingCarry:0,...overrides});
assert.equal(pairedAdvantage(arm(),arm({won:false})), 'WIN_ADVANTAGE');
assert.equal(pairedAdvantage(arm({endHp:85}),arm()), 'PARETO_ADVANTAGE');
assert.equal(pairedAdvantage(arm(),arm({endMp:50})),null);
assert.equal(pairedAdvantage(arm(),arm()),null);
assert.equal(pairedAdvantage(arm({won:false}),arm()),null);
assert.equal(pairedAdvantage(arm({endHp:85}),arm({endHp:85})),null);
assert.ok(!(pairedAdvantage(arm({endHp:85}),arm())&&
 pairedAdvantage(arm(),arm({endHp:85}))),
 'retained and redrawn circles must not both dominate in one paired fight');

if(process.argv.includes('--report')){
 const report=JSON.parse(readFileSync(new URL(
  '../reports/dungeon-paired-build-strength-v1.json',import.meta.url),'utf8'));
 assert.equal(report.schemaVersion,'dungeon-paired-build-strength-v1');
 assert.equal(report.candidatePromoted,false);
 assert.equal(report.strictSamples,256);
 assert.equal(report.cases.length,60,'all owner-build comparisons must finish');
 assert.equal(report.C_REDRAW_STRATEGY.length,2,
  'both C short and C long comparison loops must run to completion');
 assert.deepEqual(report.C_REDRAW_STRATEGY.map(r=>r.route),['short','long']);
 for(const route of ['short','long']){
  const row=report.C_REDRAW_STRATEGY.find(r=>r.route===route);
  assert.equal(row.status,'PAID_256_OWNER_DECISION_EVIDENCE');
  assert.equal(row.denominator,256);
  assert.equal(row.cases.length,256,
   'all 256 independent C owners must be accounted for: '+route);
  const statuses=['REDRAW_RATIONAL','KEEP_RATIONAL','TRADEOFF_OR_TIE',
   'NO_POST_REDRAW_BANKED_COMPARISON'];
  for(const [i,record] of row.cases.entries()){
   assert.equal(record.seed,17011+13*i,'independent same-seed owner '+route);
   assert.ok(statuses.includes(record.status),'unexpected C result '+route);
   if(record.status==='NO_POST_REDRAW_BANKED_COMPARISON'){
    assert.ok(Number.isInteger(record.earnedRedraws)&&record.earnedRedraws>=0);
    continue;
   }
   assert.equal(record.inkActuallyConsumed,5,'C cannot obtain a free redraw');
   assert.ok(Number.isFinite(record.sunkStones)&&record.sunkStones>=0);
   assert.ok(Number.isSafeInteger(record.sameLevel)&&record.sameLevel>0);
   assert.ok(record.redraw&&record.keep,'both paired combats must complete');
   for(const arm of [record.redraw,record.keep]){
    assert.equal(typeof arm.won,'boolean');
    for(const field of ['hp','mp','actions'])
     assert.ok(Number.isFinite(arm[field]),'actual measured '+field+' required');
   }
  }
  const count=status=>row.cases.filter(c=>c.status===status).length;
  assert.equal(row.redrawRational,count('REDRAW_RATIONAL'));
  assert.equal(row.keepRational,count('KEEP_RATIONAL'));
  assert.equal(row.unresolved,count('TRADEOFF_OR_TIE'));
  assert.equal(row.missing,count('NO_POST_REDRAW_BANKED_COMPARISON'));
  assert.equal(row.drawn,256-row.missing);
  assert.ok(row.drawn>0,'no actual C redraw paired battle was evaluated: '+route);
  console.log('PASS C_'+route.toUpperCase()+'_REBUILD_256 '+JSON.stringify({
   owners:row.denominator,paired:row.drawn,redrawRational:row.redrawRational,
   keepRational:row.keepRational,unresolved:row.unresolved,missing:row.missing}));
 }
}
console.log('PASS shared pairedAdvantage and C redraw/keep comparison regression'+
 (process.argv.includes('--report')?' with strict 256-owner battle evidence':''));
