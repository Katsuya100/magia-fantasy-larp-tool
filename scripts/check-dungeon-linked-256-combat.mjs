// Final user-approved acceptance gate for 60 real-owner, 256-seed battles.
// Run after all diagnostic reports have been archived, so failed cases remain visible.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const goals = load('config/dungeon-approved-goals.v1.json');
const report = load('reports/dungeon-linked-256-combat-v1.json');
const samples = goals.strictSamples;
assert.equal(samples, 256, 'approved seed count must remain 256');
assert.equal(goals.bands.length, 10, 'all ten approved bands are required');
assert.equal(report.combatSamples, samples, 'report must use approved seeds');

const expected = new Set();
for (const style of ['A', 'B', 'C'])
 for (const route of ['short', 'long'])
  for (const band of goals.bands) expected.add(style + '/' + route + '/' + band.from + '-' + band.to);
assert.equal(expected.size, 60);
assert.equal(report.cases.length, expected.size, 'all 60 real-owner cases must be reported');

const failures = [];
const counts = {met: 0, economyNotReady: 0, preparedCombatUnmet: 0, preparedCombatMet: 0};
for (const row of report.cases) {
 const key = row.style + '/' + row.route + '/' + row.band;
 if (!expected.delete(key)) {failures.push('unexpected or duplicate case: ' + key); continue;}
 const band = goals.bands.find(b => b.from + '-' + b.to === row.band);
 if (!band) {failures.push('missing approved band: ' + key); continue;}
 const reasons = [];
 if (row.ownersAvailable !== samples || row.ownersMissing !== 0 ||
   row.strictDenominator !== samples || row.readinessGate !== 'ALL_256_INDEPENDENTLY_PREPARED')
  reasons.push('ECONOMY_NOT_READY');
 if (!Number.isInteger(row.clears) || row.clears < 0 || row.clears > samples ||
   row.winRateOf256 !== 100 * row.clears / samples)
  reasons.push('INVALID_OBSERVED_WIN_RATE');
 else if (![band.winRate, band.winSafety].every(([min, max]) =>
   row.winRateOf256 >= min && row.winRateOf256 <= max))
  reasons.push('WIN_RATE_OUTSIDE_APPROVED_TARGET');
 const mp = row.winnerMp?.median;
 if (!Number.isFinite(mp) || mp < band.winnerMedianMp[0] || mp > band.winnerMedianMp[1])
  reasons.push('WINNER_MP_OUTSIDE_APPROVED_TARGET');
 if (row.status !== 'COMBAT_TARGET_MET' || row.hardTargetPassed !== true ||
   !Array.isArray(row.issues) || row.issues.length)
  reasons.push('COMBAT_TARGET_UNMET');
 if (row.status === 'ECONOMY_NOT_READY') counts.economyNotReady++;
 else if (row.status === 'COMBAT_TARGET_UNMET') counts.preparedCombatUnmet++;
 else if (row.status === 'COMBAT_TARGET_MET') counts.preparedCombatMet++;
 if (!reasons.length) counts.met++;
 else failures.push(key + ': ' + reasons.join(', ') +
  ' (wins=' + row.clears + '/' + samples + ', winner MP=' + mp + ')');
}
if (expected.size) failures.push('missing cases: ' + [...expected].join(', '));
const coverage = report.coverage;
for (const [name, value] of Object.entries({
 cases: 60, policies: 6, approvedSeeds: 256, met: 60, unmet: 0,
 economyNotReady: 0, preparedCombatUnmet: 0, preparedCombatMet: 60
})) if (coverage?.[name] !== value) failures.push('coverage.' + name + '=' + coverage?.[name] + ' (required ' + value + ')');
if (counts.met !== 60 || counts.economyNotReady !== 0 ||
 counts.preparedCombatUnmet !== 0 || counts.preparedCombatMet !== 60)
 failures.push('independently validated case counts: ' + JSON.stringify(counts));
console.log('DUNGEON_OWNER_STRICT_GATE ' + JSON.stringify({
 approvedSeeds: samples, validated: counts, reportedCoverage: coverage, failures: failures.length
}));
assert.equal(failures.length, 0, 'Real-owner 60/60 strict gate failed:\n' + failures.join('\n'));
