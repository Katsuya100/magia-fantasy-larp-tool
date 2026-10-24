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
 mandatory:{status:'NOT CERTIFIED',reason:'Existing strict 256-seed combat Action is authoritative. Economy baseline has not been approved or frozen; route-specific combat benchmark missing.'},
 diagnostics:{status:'MEASURED',complete:journeys.combinations.map(x=>({
  style:x.style,route:x.route,reached100:x.completed,samples:x.samples,
  p90ReplayFights:x.distributions.replayedFights.p90,
  p90PurposefulRecoveryFights:x.distributions.recoveryFights.p90,
  p90PreRestoreGradeEligible:x.distributions.gradeEligible.p90,
  p90GradeFailedMp:x.distributions.gradeFailedMp.p90,
  p90GradeFailedHp:x.distributions.gradeFailedHp.p90,
  p90Losses:x.distributions.losses.p90,
  p90StoneEarned:x.distributions['earned.stone'].p90
 }))},
 outstanding:['Get per-route measured median baselines and lock a versioned, reviewed candidate',
  'Run independent 256-seed linked-combat acceptance on both economic routes',
  'Construct identical-state paired ink versus stone strategy samples',
  'Alchemy paired diagnostics and 101-150F conditional extrapolation are not a substitute for authored combat/bankable resources',
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
 '| Investment | Expedition | 100F completes | p90 extra fights | p90 defeats | p90 stones earned |',
 '|---|---|---:|---:|---:|---:|',
 ...journeys.combinations.map(x=>{
  const d=x.distributions;
  return '| '+x.style+' | '+x.route+' | '+x.completed+'/'+x.samples+
   ' | '+d.replayedFights.p90+' | '+d.losses.p90+' | '+d['earned.stone'].p90+' |';
 }),
 '',
 '**Independent grade reserves:** observed pre-victory-restore HP and MP are captured on each actual boss defeat; zero demonstrated grade wins cannot be called a pass.',
 '',
 '**Hard targets: NOT CERTIFIED.** Existing strict combat gates still apply unchanged. No fixed economy-derived median equipment or route-specific strict comparison is yet approved.',
 '',
 '**Missing work:** per-route baseline lock; coupled 256-seed combat; grade feasibility; paired ink/stone replacement; alchemy and 101–150F diagnostics.',
 '',
 '**Assumptions:** fixed named circles; actual enemy combat and drops; no alchemy; no automatic ranks; bank XP only on return; unbanked rewards lost on defeat.'];
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n');
console.log('DUNGEON_JOURNEY_REPORT '+JSON.stringify(status));
