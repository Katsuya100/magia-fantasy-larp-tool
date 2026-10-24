// Assemble distinct structural, approved-target, and diagnostic statuses.
// A completed diagnostic run is NOT an acceptance of the combat targets.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const goals=read('config/dungeon-approved-goals.v1.json');
const journeys=read('reports/dungeon-journeys-v1.json');
const manifest=read('reports/dungeon-balance-manifest.json');
if(goals.strictSamples!==256||goals.bands.length!==10||goals.bands[0].winnerMedianMp[0]!==50||
 goals.bands.some((b,i)=>i>1&&(b.winSafety[0]!==92||b.winSafety[1]!==95)))
 throw Error('Approved objectives changed: manual approval required');
const status={
 version:'balance-report-v1',seed:journeys.seed,economySamples:journeys.samples,
 strictCombatSamples:goals.strictSamples,economyModel:journeys.schemaVersion,
 manifestEntries:manifest.entries.length,
 structural:{status:'validated by separate tests/test-dungeon-journeys.mjs'},
 mandatory:{status:'NOT CERTIFIED',reason:'Frozen economic candidate v1 remains unapproved. The separate 256 independent-owner six-route strict Action is now implemented; its results and the original fixed-sortie hard gate must pass before approval.'},
 diagnostics:{status:'MEASURED',complete:journeys.combinations.map(x=>({
  style:x.style,route:x.route,reached100:x.completed,samples:x.samples,
   boss10Rounds:x.floorObservations[9].bossRounds,
   boss10FirstClearRounds:x.floorObservations[9].firstClearBossRounds,
   boss10Clears:x.floorObservations[9].clears,
  p90ReplayFights:x.distributions.replayedFights.p90,
  p90PurposefulRecoveryFights:x.distributions.recoveryFights.p90,
  p90PreRestoreGradeEligible:x.distributions.gradeEligible.p90,
  acquiredGradeMedian:x.distributions.rankGranted.median,
  acquiredGradeP90:x.distributions.rankGranted.p90,
  p90GradeFailedMp:x.distributions.gradeFailedMp.p90,
  p90GradeFailedHp:x.distributions.gradeFailedHp.p90,
  p90Losses:x.distributions.losses.p90,
  p90StoneEarned:x.distributions['earned.stone'].p90
 }))},
 outstanding:['Get per-route measured median baselines and lock a versioned, reviewed candidate',
  'Evaluate the separately gated independent 256-account owner-combat strict results (all six routes); never replace frozen v1 automatically',
  'Validate complete equal-readiness ink versus stone strategy break-even after actual re-farming; existing paired initial fights alone are insufficient',
  'Alchemy paired diagnostics and 101-150F conditional extrapolation remain distinct from actual authored combat; 101-150F has no equivalent authored enemies',
  'Fix any combat win targets by changing game parameters rather than the assertions'],
 warning:'No economy p90 cap is approved. No modeled achievements imply target acceptance.'
};
mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../reports/dungeon-status-v1.json',import.meta.url),JSON.stringify(status,null,2)+'\n');
const md=['## Dungeon journeys — measured diagnostics only',
 'Seed: `'+journeys.seed+'` · economy trials per route: `'+journeys.samples+
 '` · strict combat CI: `'+goals.strictSamples+'` seeds (separate job).',
 'Balance manifest: **'+manifest.entries.length+'** source parameters.',
 '',
 '| Investment | Expedition | 100F completes | p90 extra fights | p90 defeats | p90 stones earned | Median safely acquired grades |',
 '|---|---|---:|---:|---:|---:|---:|',
 ...journeys.combinations.map(x=>{
  const d=x.distributions;
  return '| '+x.style+' | '+x.route+' | '+x.completed+'/'+x.samples+
   ' | '+d.replayedFights.p90+' | '+d.losses.p90+' | '+d['earned.stone'].p90+' | '+d.rankGranted.median+' |';
 }),
 '',
 '**Independent grade reserves:** observed pre-victory-restore HP and MP are captured on each actual boss defeat; zero demonstrated grade wins cannot be called a pass.',
 '',
 '**Hard targets: NOT CERTIFIED.** Strict combat gates apply unchanged. An independent 256-real-owner strict linked Action is available; no measured/economic median candidate is user approved.',
 '',
 '**Missing acceptance:** approval of baseline, passing strict 256-seed combat targets, independently eligible grades, equal-readiness ink break-even. Authored 101–150F combat is out of scope.',
 '',
 '**Assumptions:** fixed named circles; actual enemy combat and drops; no alchemy; no automatic ranks; bank XP only on return; unbanked rewards lost on defeat.'];
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n');
console.log('DUNGEON_JOURNEY_REPORT '+JSON.stringify(status));
