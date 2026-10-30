# Dungeon journey balance — measured phase report (2026-10-24)

Status: **INCOMPLETE / NOT RELEASE READY**. PR #264 remains open. No merge, deploy, release, or Copilot use. All tests/simulations executed only in GitHub Actions.

## Versioned provenance

| Purpose | Source |
|---|---|
| First run with linked economy and frozen median v1 | [Actions #39985490359](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/39985490359) |
| B's legal replay route repaired | [Actions #39985913762](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/39985913762) |
| 256-seed same-owner ink pairing (before XP falloff) | [Actions #39996360948](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/39996360948) |
| Depth-aware XP changed, baseline drift observed | [Actions #39997319002](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/39997319002) |
| 1–3 actual-ink forced redraw, real replay costs and strict failures | [Actions #39997977822](https://github.com/Katsuya100/magia-fantasy-larp-tool/actions/runs/39997977822) |

All rewards in the linked journey model are rolled using game functions; defeat loses unbanked experience and loot, while unspent carried inventory returns. Ranks use the pre-victory-restore HP/MP 80% rule and are not granted unconditionally. Short/long routes remain independent, with A/B/C build differences combinable with the long route. Baseline equipment consists of a named fixed set, not random rerolled strong spells. Neither optimistic economy forecasts nor extrapolated 101–150F loot establish combat acceptance.

## Approved hard combat goals: still failing

Legacy strict 256-seed observed point estimates (not Wilson-pass substitutes):

| Band | Observed win % | Approved interior win % | Winner MP goal |
|---|---:|---:|---:|
| 1–10F | passes | 99–100 | 50–100% |
| 11–20F | passes | 99–100 | 0–15% |
| 21–30F | 97.3 | 92–95 | 0–15% |
| 31–40F | 97.3 | 92–95 | 0–15% |
| 41–50F | 99.2 | 92–95 | 0–15% |
| 51–60F | 100 | 92–95 | 0–15% |
| 61–70F | 100 | 92–95 | 0–15% |
| 71–80F | 100 | 92–95 | 0–15% |
| 81–90F | 100 | 92–95 | 0–15% |
| 91–100F | 100 | 92–95 | 0–15% |

This is **2/10 passing and 8/10 failing**. The measured economic first-entry combat benchmark also fails. Its v1 equipment was explicitly frozen, not auto-refitted after the subsequent XP change, so it is now stale and must not be accepted as the latest prepared-state measurement. Adventurer rank conditions are independently asserted, but actual boss-grade acquisition viability under a special reserve-MP strategy has NOT been established.

## Actual game XP change, and its side effects

Shipped source input: `assets/data/dungeon-balance.csv` now has `xp_overlevel_decay_per_10_levels=1.85`. `fightExperience` keeps exactly the at-level 5-fight EXP budget and player cap 150, but weak lower-floor enemies now give progressively lower EXP to overleveled players. This does **not** change stone or ink drop probabilities. Neither past saves nor level-to-next XP were rescaled by this change.

Fixed A five-circle **first-entry** level medians before/after:

| Band entry | Short before | Short after | Long before | Long after |
|---|---:|---:|---:|---:|
| 11F | 32 | 27 | 21 | 21 |
| 31F | 74 | 66 | 57 | 60 |
| 51F | 110 | 99 | 95 | 91 |
| 71F | 150 | 135 | 124 | 117 |
| 91F | 150 | 150 | 150 | 146 |

The change reduced overlevelling on short routes but caused one of sixteen long-route A accounts to fail to clear 100F within the diagnostic sortie limit. This is a real trade-off, **not** a victory. A proposed v2 baseline records all 17 changed median level/upgrade observations at `config/dungeon-economy-baseline-proposal.v2.json`. It is **not active and awaiting approval**; the original v1 stays immutable. It is based on 16 seeds and must not be mislabeled a combat-ready standard.

## Cumulative playstyle diagnosis (post-XP)

| Journey / route | 100F reached, of 16 | Notes |
|---|---:|---|
| A / short | 16 | Frequent banking, high replay |
| A / long | 15 | Long-run defeat and resource risk |
| B / short | 16 | Real legal replay to recover scattered stone upgrades |
| B / long | 16 | Different repeat/level and rank timing |
| C / short | 16 | Ink replacement from actually banked ink |
| C / long | 15 | Same deep route risk with redraw decisions |

B short-route investment catch-up extra-fight **p90=400** (16 seeded accounts after XP change). No p90 acceptance limit was supplied or assumed. Across C forced 1, 2, 3 swaps, the simulator consumed 5, 10, 15 owned ink respectively, with zero freely granted materials. After three swaps the median sunk stone cost was **110 short-route / 75 long-route**; these are deliberately forced *diagnostic* alternatives, not proof that three redraws are optimal.

## Same-state magic ink versus continuation

256-seed paired combat now uses the same indivisible starting account, the same fixed five roles, identical random seeds, a new circle with exactly the same original drawing quality as the replaced one, actual 5-ink payment, and no transfer/refund of past upgrades. Real follow-on 10-layer farming, defeat losses, banking, and 75% stone investment quantify the extra fights needed to match original spell power.

After the XP change, 24 real replay seeds per available scenario yielded these p90 **spell-power restoration** burdens:

| Depth band | Short route extra fights p90 | Long route extra fights p90 |
|---|---:|---:|
| 31F entry | 100 | 0 |
| 51F entry | 250 | 100 |
| 71F entry | 300 | 200 |
| 91F entry | 500 | 250 |

A power-matched spell is **not automatically combat-ready**, because farming also changes level and resources. The paired comparison identified states with combat reasons to keep and to redraw, but proof that both are fully rational after all real preparation costs and target-winning battles is **still unmet**. The 1–3-circle forced-redraw diagnostics are intentionally separate.

## Stone, ink and other diagnostics

The provisional game stone curve remains 30% at F1 → 90% at F150, monotone exponential, then fixed. The game boss ink drop is still an independent 20%, with a max of five inks per circle at +10% original power each. 101–150F conditional all-victory projection, 250 fights, has stones **p10=180 / median=189 / p90=197** and ink **p10=7 / median=10 / p90=14**. This is a projection using shipped drop functions and extrapolated enemy levels, *not* battle wins or banked rewards. No alchemy is needed in mandatory benchmark. Optional actual-input alchemy comparisons are archived as reference diagnostics only.

The manifest currently inventories 15,096 source parameters, including CSV combat data and hard-coded non-CSV controls. Missing explicitly approved safe ranges remain `null` instead of inventing thresholds.

## Remaining hard blockers

1. Update the economic combat baseline **only after a v2 review**, using realistic ready-to-challenge state and genuinely stocked cleansing inventory. Do not simply feed target levels to tests.
2. Tune real enemy/HP/MP/combat parameters under that frozen version so BOTH routes and A/B/C + D combinations meet 256-seed observed win/MP targets, not merely a legacy optimistic fixture.
3. Independently demonstrate feasible HP/MP≥80% grade acquisition at each tenth boss before the automatic rewards, and measure optional status-cleanser supply from actual collection/carry.
4. Complete identical-state combat-plus-farming strategy break-even for ink and continued stone investment, including 1–3 redraws and all opportunity costs.
5. Repeat save migration/rollback/recovery/cloud-sync regressions and final GitHub Actions tests after each real balance change. No hard goal may be treated as diagnostic merely because it fails.

**Unapproved limits:** B recovery fights/returns p90 caps, C redraw cost/time caps, optional account completion p90. Provide observed distributions to the user; do not claim approval.

CI status remains **RED** on mandatory criteria. No main merge/deployment/release has occurred.
