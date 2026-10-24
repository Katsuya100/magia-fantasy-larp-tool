# 2026-10-24 — Journey balance model corrections and first-decade tuning

**Status: INCOMPLETE. Mandatory CI is RED until all approved targets actually pass.** This file is a worklog; it does not replace the frozen baseline or constitute user approval of a new limit.

## Problems discovered and corrected

1. **Early long dive had no economically valid MP survival at Lv1.** A 256-seed, actual-owner, fixed-five, 50-fight first-entry test produced 239/256 wins (93.36%) and winner MP median 22%. That is *not* the approved 99–100% and 50–100%.
2. **The encounter simulations had regular enemies in fixed authored order.** The shipped UI actually rolls `shuffledLayerEnemyIds()` once per floor for four normal enemies; the fifth boss is fixed. The new `dungeon-balance-encounters.mjs` selector now uses that exact game function in economic journeys, economic combat, owner-entry combat, and ink/stone replay comparisons. Tests in GitHub Actions validate its per-floor random draw count and unshuffled boss.
3. **Long expeditions were losing meaningful inventory preparation in the model.** A return-state carry selector based only on a sortie's start floor prevented carrying already owned specialist cleansers for later 51F+/71F+ fights. It now considers the real planned dive, selects only genuinely banked inventory within actual carry capacity, reserves at most two *owned* broad-spectrum items for 71F+, and distributes specific inventory toward encountered debuff attributes. No item or ink is created.
4. **Entry snapshots were mixing real economy with an implicit full HP/MP start.** Each entry now records the hero's actual current HP, MP, cooldowns, statuses, all five spell upgrades, physically carried items, plus banked and unbanked XP/stone/ink. The `dungeon-actual-owner-combat.mjs` 256-seed diagnostic starts from *one coherent player account* rather than medians independently spliced into an impossible loadout. It never grants HP/MP restores between floors.
5. **Grade outcomes need independent evidence.** Each actual tenth boss victory now records HP and MP *before* victory MP restore, eligibility against the unchanged simultaneous ≥80% rule, and whether the earned grade was eventually safely banked. This is separate from the 0–15% winner-MP difficulty criterion. No rank is handed out for free.

## Parameter rollback and validation-first correction (after user feedback)

The earlier tuning-first approach was **not authorized**. Three invented knobs
(`xp_overlevel_decay_per_10_levels`, `victory_mp_intro_floor_bonus`,
`enemy_intro_attack_preference`) have been **removed from the actual game
CSV and core logic**. Specifically:

- EXP decay on overleveled replay is **prohibited** and removed. The XP test
  now enforces equal replay rewards at every below-cap player level.
- Victory MP continues through the already existing
  `victory_mp_early_layer_bonus` mechanism. No intro-only recovery term remains.
- Early foes use existing `enemy_attack_preference` rather than an almost
  nonattacking introduction. The *previously changed* authored early MAG
  master rows and early-layer existing MP value are still on the branch;
  **these are unapproved, premature tuning candidates, not accepted balance**.

The earlier 100% win-rate statement with 0.3% intro attacks has **no
relevance as acceptance evidence**, because that AI rule has been withdrawn.
Subsequent strict runs report different outcomes, including first-decade
failure. No target was relaxed and no new balance knob was added during the
subsequent **validation infrastructure** work.

A prior change to the authored enemy MAG values also makes the separate
full `offline` test expose the canonical enemy-plan mismatch. Do **not**
modify the enemy-plan expectations merely to turn the test green. Resolve
the game-master conflict only in a separately authorized tuning phase.

### Actual GitHub Actions evidence and unresolved game-master mismatch

[CI #40050473763](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/40050473763)
completed the separately gated **structural 256-account × 6-policy audit**:
1,536 independent real-economic accounts checked, real banked resource ledgers
reconciled, reproducible first-entry profiles archived. The 100F reach counts
were A short 256/256, A long 256/256, B short **255/256**, B long
256/256, C short 256/256 and C long 256/256. The single B non-completion
is retained as a failed run, not concealed. The companion
`dungeon-linked-256-combat-strict` ran all 60 policy/depth cases and **failed
all 60 approved target gates**. Those failures are faithfully reported, not
a failure of the structural engine itself.

Later source changes add same-original-seed A/B/C full-campaign **paired
opportunity-cost traces** and replace B's earlier unapproved first-entry
median comparison with the actual same-seed A F31 equipment (without granting
stones or victory). Their current HEAD Actions rerun must be checked before
calling that latest refinement verified.

After the first successful foundation, the real-account audit was strengthened:
the player base is now **rolled once per seed using the actual shipped
`G.startingBase` and retained across casual-mode sorties** instead of always
using the reference HP/MAG/DEF/RES values. This materially changes the
measured account outcomes; incomplete runs must remain incomplete rather than
being replaced with a stronger profile. For B, if the matching A account
never reaches F31, the recovery target is explicitly **UNAVAILABLE**, not
silently substituted with a frozen median. The infrastructure checks this
absence and the 5-ink-per-redraw conservation. Owner rewards can be summed
per floor into banked or lost stones, ink, items, collections and XP;
that sum is asserted equal to the actual character's resource ledger.
Optional permanent-death/legacy mode is not claimed covered: the required
A/B/C/D cohort models the shipped casual-mode defeat rules.

The new `dungeon-strategy-readiness-v1.json` joins the same-seed A-versus-B/C
full-campaign re-farming/return/redraw costs to both arms' **actual 256-owner
win rate, MP and grade readiness** in each decade. It can calculate genuine
costs even when identical combat readiness is not demonstrated; it cannot
promote either policy to an approved break-even result unless both pass
the unchanged hard targets. [CI #40051278967](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/40051278967)
verified the previous fixed-hero cohort and ran the new readiness report:
40 real paired decade comparisons measured, **0/40** with both policies
meeting all approved readiness targets. The subsequently rolled-hero cohort
is a different source fingerprint; its results must be rechecked on HEAD.

The prior `offline` source-master mismatch has now been addressed by
reverting the unauthorized F1–10 MAG override to its original canonical
values; this is a *rollback*, not a new balancing hypothesis. Gameplay
formulae and expectation data were untouched. Actions evidence is tracked
on PR #264, with original hard difficulty failures remaining visible.

### 2026-10-24 verification-foundation correction: independent readiness, untouched difficulty

**Issue 1 (false first-entry combat difficulty):** `dungeon-linked-256-combat.mjs`
previously passed raw first-entry snapshots to every mandatory 50-fight
challenge, effectively scoring underprepared players as combat losses. This
has been corrected without relaxing `config/dungeon-approved-goals.v1.json`:

- `entrySnapshots` remain unchanged, labelled **FIRST_ENTRY_ECONOMIC_DIAGNOSTIC**.
- After each *actually banked return*, character level comes from *banked
  actual combat XP*, magic stone upgrades and magic-ink redraws are *paid
  for*, and the actual rank is preserved. Only then do we capture the FIRST
  `preparedSnapshots` entry for each band whose player level reaches the
  **authored end-of-band target level**, whose rank enables a **legal start
  directly at the band's first floor**, and which has five actually equipped
  reference circles. The new simulated sortie starts at full HP/MP exactly
  as shipped `dungeon-app.begin()` does after preparing at home, with
  carried cleansers drawn from the same actual warehouse and game capacity.
  This qualification does not examine the outcome of any challenge.
- The strict 256-seed hard gate consumes **prepared** snapshots only.
  Any absent snapshot is reported for that individual seed as
  `ECONOMY_NOT_READY` / reachability failure, never converted into an
  automatic 50-fight combat defeat; no subset of ready winners can pass a
  256-denominator acceptance. A fully prepared cohort is still held to
  precisely the original win-rate and MP bands, unchanged.
- The paired ink/stone strategy readiness join also distinguishes economy
  unready from tested combat failure. Existing C strategy does **not** have
  to redraw by force on a seed that never earns a rational redraw; the test
  now verifies exact payment **when** an actual redraw occurs.

**Issue 2 (authored enemy MAG):** All **50 MAG cells on F1–10** in
`assets/data/dungeon-enemies.csv` were restored from the never-modified
`tests/fixtures/dungeon-enemies-before-distribution.csv` canonical
source. `scripts/dungeon-element-distribution.mjs`,
`assets/data/dungeon-element-plan.csv`, and
`tests/test-dungeon-element-distribution.mjs` were **not altered**.
The standard 500-enemy deterministic regeneration test must pass on
GitHub Actions. No gameplay core, math, status, new balance constant or
balance CSV was changed for either correction.

### Structural and hard-goal checks must stay separate

- `dungeon-foundation-256-accounts` measures **256 genuinely fought and
  banked seeded accounts per A/B/C x short/long strategy (1536 accounts)**.
  Its per-floor observations and individual-owner snapshots are reproducible.
  It checks owned consumables/collections, alchemy input conservation,
  banked vs lost stones/ink/XP, replay, grade checks and grade banking.
- `dungeon-linked-256-combat-strict` consumes only the upstream genuine
  owner states and independently evaluates each ten-floor 50-fight challenge
  across all sixty route x band cases with the exact approved 256 denominator.
  It must stay RED when win/MP targets or real equipment readiness fail.
- The earlier fixed optimized-circle strict suite remains an independent
  reference. Candidate economic baseline v1 remains explicitly **not
  user approved** and must not be overwritten from measured medians.
- Magic-ink paired battle and actual power-restoration farming remain
  separately reported, with the unsolved equal-readiness break-even explicitly
  marked unproven. Layers 101-150 have no equivalent authored encounter
  design; only conditional drop extrapolation is possible.

The completion gate is **not** a fabricated green score. Structural scripts
must pass Actions, source-master/regression mismatches must be identified
without altering game values, and all unmet balance goals must remain
visible separately. No main merge, deploy, release, or local test.

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
