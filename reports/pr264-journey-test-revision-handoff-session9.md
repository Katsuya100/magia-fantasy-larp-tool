# PR #264 journey test loop correction — session 9 handoff

Date: 2026-10-30 (Asia/Tokyo)
Branch: `feat/scale-xp-45-save-migration`
Base HEAD: `07d8fecdaea58aee3d12a2cfa74f008ca798b079`
PR remains open. This work did not push, merge, deploy, change CSV values, or edit combat formulas.

## Implemented

- `runJourney` preserves the existing campaign through 100F and rank 100. With `observeStrength: true`, if any of the ten bands remains unmet after that campaign, it repeats the legal 91–100F route using real fights, returns, banked rewards, and the existing investment policy. It stops after all ten bands reach `REACHED`, or at the existing 600-sortie / 6,500-fight budgets; each battle remains limited to 80 turns.
- The post-campaign start is resolved by `allowedStartLayer` at 91F. The goal and floor simulation stay at or below 100F. The loop remains unchanged when `observeStrength` is false.
- Strength reached during the ordinary campaign does not skip later campaign or chapter records. Added strength-training sorties no longer create duplicate rank observations after rank 100 has already been acquired; the 80/80 rule itself is unchanged.
- The audit JSON now records its continuation and budget contract. The checker verifies those fields without weakening unmet-result assertions. The validation document distinguishes the historical pre-loop-fix report from the new run.

## Focused same-source before/after evidence

The old simulator from HEAD and the corrected simulator were run for seed `17011`, A/B long, with the same current core hash `d31928ae710a53d7d4a76cc6870b4f2fb0833ae7e4dc3d1f8df34338267cbbe9`, `maxSorties: 60`, and `maxFights: 3000`.

| Policy | Before: sorties / fights / reached bands | Added actual sorties / fights | After: sorties / fights / reached bands | Stone earned / spent / held | Ink earned | Losses before → after |
|---|---:|---:|---:|---:|---:|---:|
| A long | 47 / 2,125 / 9 of 10 | 9 / 450 | 56 / 2,575 / 10 of 10 | 730/730/0 → 986/982/4 | 59 → 73 | 6 → 6 |
| B long | 48 / 2,175 / 9 of 10 | 8 / 365 | 56 / 2,540 / 10 of 10 | 859/858/1 → 1,095/1,092/3 | 73 → 85 | 3 → 3 |

All added sorties began at legal 91F and fought no layer above 100F. B had one real early return after 93F and banked that sortie's actual rewards. Prior unbanked losses remained: A lost 178 stones and 11 ink; B lost 88 stones and 3 ink. Rank observation counts stayed at 32 for A and 36 for B between each before/after pair.

## Full 6 × 10 × 256 audit

`node scripts/dungeon-journey-strength-audit.mjs` completed all 1,536 campaign owners and 15,360 owner-band rows. It wrote `reports/dungeon-journey-strength-v2.json` (287,928,648 bytes, SHA-256 `7b58723b293ae8a508ae5bae2f48d782093782912d8955e77cafc1db20573fb7`). Source hashes are embedded in that report.

| Policy | 1–10 | 11–20 | 21–30 | 31–40 | 41–50 | 51–60 | 61–70 | 71–80 | 81–90 | 91–100 | 100F completion |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A short | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 |
| A long | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 |
| B short | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 |
| B long | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 255 | 255 | 255 |
| C short | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 |
| C long | 103 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 | 256 |

Total: 14,440 `REACHED`, 920 unmet. Of the unmet rows, 918 are 1–10 `MP_BURDEN_EXCEEDS_RECOMMENDED`; B long has one further 81–90 row with that reason and one 91–100 `UNREACHED_NO_LEGAL_BANKED_SNAPSHOT`. The latter owner did not complete 100F. These are measured misses and remain misses.

The independent chapter audit contains 60 rows. Eligible and banked counts are 256/256 for all but B long at 81–90 and 91–100, each 255/256. Additional strength sorties add no rank checks. Across all policies the ledgers reconcile: 4,143,484 stones earned, 4,138,681 spent, 4,803 banked, 98,626 lost unbanked; 316,634 ink earned, 6,800 spent, 309,834 banked, 6,489 lost unbanked. There were 3,561 actual campaign losses. Per-owner sortie and fight budgets were not raised; the report retains each owner's actual counts and ledgers.

The previous 13,304/2,056 report is preserved at `reports/pr264-journey-strength-v2-pre-loopfix-20261030.json`, SHA-256 `467b04a422ae012e9ffefef6867262db66bf0e02fa6d8062d67075ca5b79d38f`. It was generated with core hash `b1ef085f…`, while this run used the already modified candidate hash `d31928ae…`. The aggregate difference cannot be attributed to the loop correction alone. The candidate core modification predated this work, remains untouched, and must not be included in this commit.

## Verification

| Check | Result |
|---|---|
| `node tests/test-dungeon-journeys.mjs` | PASS, including post-100 real training, reached-stop, cap, ledger, actual-loss, and chapter non-duplication cases |
| `node tests/test-dungeon-floor-strength.mjs` | PASS |
| `node scripts/check-syntax.mjs` | PASS |
| `node scripts/check-dungeon-journey-strength.mjs` | Exit 1 only after source hashes, denominator, all measured 50-target rows, owner ledgers, and rank record structure validated; the 920 legitimate unmet rows remain unmet |
| Strict fixed-50 diagnostic on an isolated archive of base HEAD, `DUNGEON_BALANCE_STRICT=1` | PASS, 10/10 bands at 256 seeds |

In the current workspace the existing, uncommitted MP-recovery curve candidate makes `node tests/test-dungeon-default-balance.mjs` report `NEEDS_TUNING` for four bands (21–30, 31–40, 41–50, 51–60); that diagnostic command exits 0. The fixed-50 source, test, targets, and CSVs were not changed here. This result belongs to the separate tuning handoff and is not part of the commit below.

## Commit boundary

Commit only the journey simulator, journey test, audit and checker, validation document, and this handoff. Do not stage `assets/js/dungeon-core.mjs`, either 280MB+ audit JSON, the legacy evidence copy, or unrelated untracked reports. No push was performed; the parent agent owns push and later tuning handoff.
