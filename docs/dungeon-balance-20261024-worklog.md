# 2026-10-24 — Journey balance model corrections and first-decade tuning

**Status: INCOMPLETE. Mandatory CI is RED until all approved targets actually pass.** This file is a worklog; it does not replace the frozen baseline or constitute user approval of a new limit.

## Problems discovered and corrected

1. **Early long dive had no economically valid MP survival at Lv1.** A 256-seed, actual-owner, fixed-five, 50-fight first-entry test produced 239/256 wins (93.36%) and winner MP median 22%. That is *not* the approved 99–100% and 50–100%.
2. **The encounter simulations had regular enemies in fixed authored order.** The shipped UI actually rolls `shuffledLayerEnemyIds()` once per floor for four normal enemies; the fifth boss is fixed. The new `dungeon-balance-encounters.mjs` selector now uses that exact game function in economic journeys, economic combat, owner-entry combat, and ink/stone replay comparisons. Tests in GitHub Actions validate its per-floor random draw count and unshuffled boss.
3. **Long expeditions were losing meaningful inventory preparation in the model.** A return-state carry selector based only on a sortie's start floor prevented carrying already owned specialist cleansers for later 51F+/71F+ fights. It now considers the real planned dive, selects only genuinely banked inventory within actual carry capacity, reserves at most two *owned* broad-spectrum items for 71F+, and distributes specific inventory toward encountered debuff attributes. No item or ink is created.
4. **Entry snapshots were mixing real economy with an implicit full HP/MP start.** Each entry now records the hero's actual current HP, MP, cooldowns, statuses, all five spell upgrades, physically carried items, plus banked and unbanked XP/stone/ink. The `dungeon-actual-owner-combat.mjs` 256-seed diagnostic starts from *one coherent player account* rather than medians independently spliced into an impossible loadout. It never grants HP/MP restores between floors.
5. **Grade outcomes need independent evidence.** Each actual tenth boss victory now records HP and MP *before* victory MP restore, eligibility against the unchanged simultaneous ≥80% rule, and whether the earned grade was eventually safely banked. This is separate from the 0–15% winner-MP difficulty criterion. No rank is handed out for free.

## Real game tuning, without approved target changes

Source `assets/data/dungeon-balance.csv`:
- `victory_mp_intro_floor_bonus=0.10` adds only to the shipped **on-victory** MP recovery at 1–10F. It cannot be triggered as a combat healing spell or item; 11F onward retains the original exact recovery formula. First 0.03 trial confirmed improvement in 1–10F (247/256 wins, 96.48%, MP median 25%). A 0.10 trial, with the same seeded shuffled foes, yielded **249/256 wins (97.27%) and median winner MP 94%**. Thus MP is in the target interval, but the 99–100% win target still fails.
- `enemy_intro_attack_preference=0.003` replaces the source-hardcoded 0.01 attack choice for 1–10F only, while the existing early rules still forbid both opponents' use of combat healing/debuff spells. This candidate is being checked in [GitHub Actions #40048172287](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/40048172287) and should **not be presented as certified** before reading the completed job.
- The earlier `xp_overlevel_decay_per_10_levels=1.85` remains part of the real EXP rule; at-level XP, recommended Lv checkpoints and player Lv150 cap were not altered. Deeper stone rates (1F 30%, 150F 90%) and boss ink chance (20%) stay unchanged.

No main change, PR merge, release, deployment or Copilot use has occurred. Existing EXP migration, backup, rollback and Drive sync functionality was not edited.

## Reality check

With the shuffled foes and current XP, 256-seed owner first-entry tests show:
- **Short A at 11F:** Lv27, and cannot clear all 50 next fights at once without returning/banking. This is a *preparation gap*, not an excuse to grant Lv37 or extra stones in a test.
- **Short A at 51F:** Lv99, with no owned status-cleansing carry in the measured representative account at that particular entry before the next return; no replenishment is invented.
- **Long A at 91F:** first-entry MP/item state and real rank vary by account; it cannot be silently compared as identical to short A.
- The previous same-owner ink paired comparison, after shuffling, did **not** demonstrate a winning redraw example. The C policy has therefore been corrected to compare the *same original drawing quality*, charge five actually owned inks, and allow a later-game redraw only when stone upgrade tiers make its marginal power per stone better. It does not transfer old upgrades; the updated CI must assess whether this actually makes C viable. Both continuation and ink redo being rational remains an **unmet** mandatory strategy proof. The 24-seed re-farming comparison and 1–3 redraw diagnostics remain measurements, not proof of equal combat readiness.

The 256-seed strict original reference still fails 8/10 later bands because its current fixed advanced spells are too strong, frequently winning 97.3–100%, outside the 92–95% safety margin. The owner-snapshot 256-seed diagnostic also fails most bands for the opposite or varying reasons. Tuning must address this entire gap, not merely the 1–10F opener.

## Baselines and CI safety

The economic first-entry frozen candidate v1 remains unchanged. Earlier version 2 was review-only and no longer reflects the full simulation policy after the authentic enemy-shuffle correction. A new **v3 review-only JSON report**, `reports/dungeon-baseline-review-proposal-v3.json`, is generated per Actions run from whole-owner snapshots. It is **not** imported by the strict tester and never rewrites accepted config.

The economy-job output separates source/inventory validation, unapproved-baseline drift and unmet strategy proof. Failures are not suppressed: diagnostic jobs may continue gathering evidence after a step fails, but an explicit final GitHub Actions gate still returns failure. No new p90 fight/return limit is asserted as user-approved.

## Remaining priority

- Confirm the latest 1–10F survival after changing *real* enemy behaviour; if win% remains below 99, tune the game again rather than the target.
- Diagnose 11–100F by challenge-ready *economically attained* states, not automatically awarded levels, and make short+long routes converge to the same approved win/MP experience.
- Demonstrate rank-oriented 80/80 reserves and ink continuing/rebuilding rationality through independent strategy evaluation.
- Run final 256-seed CI and save migration/Drive/regression suites after all game changes, and keep the PR open until release authorization.
