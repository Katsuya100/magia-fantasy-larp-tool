# PR #264 journey test implementation handoff

Date: 2026-10-29 (Asia/Tokyo)  
Branch: `feat/scale-xp-45-save-migration`  
Audit source base: `5156283433c90342dcf3d6b41294deaa014c154e`  
PR remains open; this work did not push, merge, deploy, or change game parameters.

## Scope and selective cleanup

- Kept the approved journey-strength contract: six policies × ten bands × 256 independent owners, real post-return banked snapshots, the recommended-level fixed reference, existing combat formulas, actual carry, and separate chapter results.
- Kept `G.round` and `G.chooseEnemySpell` read-only. The player attack selection now matches the existing fixed-combat benchmark's maximum effective-damage rule and support thresholds. Removed the newer dependency on `compareNeutralAttackChoices`, which was a test-only loadout helper rather than the fixed benchmark action rule.
- Aligned fixed-reference cleanser allocation ties with the existing journey pack policy (stable first-authored enemy order). Counts and types still come from `FIXED_CARRY`; items are legal owned benchmark stock, not free recovery.
- Kept HP depletion and unresolved targets diagnostic. Added a basic-attack count beside paid attack MP so zero-cost basic fallback cannot be mistaken for paid spell use. Recovery diagnostics retain the unique item instance ID and record item effects only once.
- No edits to `assets/js/dungeon-core.mjs`, fixed-50 tests, enemy/game CSV values, approved goals, combat formulas, or thresholds. The pre-existing approved MP recovery table is unchanged.
- Preserved all existing historical reports and both earlier v2 attempts. The complete current v2 JSON is saved separately and was not staged with the report archive.

## Focused contract cases

`tests/test-dungeon-floor-strength.mjs` now checks equal-reference reach, low-level strong/high-level weak circles, absolute damage beyond the HP clamp, spell-recovery cost and unfunded MP, unavailable recovery, basic fallback and unresolved targets without a battle-clear gate, one legal carried heal item by exact instance ID, all 50 target rows, seed `17011` at 11–20F, and seed `17154` with an actual campaign loss followed by a reached banked snapshot.

The seed `17011` / 11–20F case preserves the historical boundary: fixed simulation was 50/50 while v1's reduced formula path stopped at 33/50. The current `G.round` reference path processes and resolves all 50 targets and reaches its equal-reference boundary. This is a calculator regression, not a journey battle gate.

## Verification

| Command | Result |
|---|---|
| `node tests/test-dungeon-floor-strength.mjs` | PASS |
| `node scripts/check-syntax.mjs` | PASS |
| `node tests/test-dungeon-journeys.mjs` | PASS |
| `node tests/test-dungeon-default-balance.mjs` | PASS, all 10 fixed bands meet the approved targets |
| `node scripts/dungeon-journey-strength-audit.mjs` | PASS, generated all 6 × 10 × 256 = 15,360 formula observations |
| `node scripts/check-dungeon-journey-strength.mjs` | Expected exit 1 for measured misses; schema, denominator, 50-target coverage, banked snapshots, rank checks, and source hashes validated before the final unmet assertion |

The strict check reports 13,304 `REACHED` and 2,056 unmet of 15,360. Every unmet row has only `MP_BURDEN_EXCEEDS_RECOMMENDED`; there are no missing target rows, source-hash mismatches, or structural errors. All six economic campaigns complete 256/256. All 60 independent chapter rows are eligible and banked 256/256 at the existing 80/80 threshold. EXP taper remains `NOT_IMPLEMENTED`.

| Band | A short | A long | B short | B long | C short | C long |
|---|---:|---:|---:|---:|---:|---:|
| 1–10 | 103 | 103 | 103 | 103 | 103 | 103 |
| 11–20 | 256 | 256 | 256 | 256 | 256 | 256 |
| 21–30 | 256 | 256 | 256 | 256 | 256 | 256 |
| 31–40 | 256 | 256 | 256 | 256 | 256 | 256 |
| 41–50 | 256 | 256 | 256 | 256 | 256 | 256 |
| 51–60 | 256 | 256 | 256 | 256 | 256 | 256 |
| 61–70 | 256 | 256 | 256 | 256 | 256 | 256 |
| 71–80 | 256 | 250 | 256 | 248 | 256 | 238 |
| 81–90 | 255 | 206 | 253 | 200 | 255 | 163 |
| 91–100 | 206 | 8 | 206 | 4 | 206 | 4 |

## Evidence and source hashes

- Full source-hash-bearing audit: `reports/dungeon-journey-strength-v2.json` (282,021,144 bytes).
- Audit JSON SHA-256: `467b04a422ae012e9ffefef6867262db66bf0e02fa6d8062d67075ca5b79d38f`.
- The strict checker independently compared every source hash below and reached only the expected unmet-result assertion.

| Source | SHA-256 |
|---|---|
| `assets/data/dungeon-balance.csv` | `c7af757079425fec4553b9c1d19b7486849f80632bc767b1f100ac6b367b734c` |
| `assets/data/dungeon-enemies.csv` | `26a662ee05b798e5322eed76c849e4741f2bd97bf85a1bc8cdacf06bd2f3101f` |
| `assets/data/dungeon-floors.csv` | `e206c525a535cca09ab0e23ae82202fc6d1d993769a96ab734a2bd2065690f8a` |
| `assets/data/dungeon-levels.csv` | `ee4dbacf5dc3222f1a727d58b8959744ea7c75e636d2873c036551eb530215f5` |
| `assets/data/dungeon-player-base.csv` | `34878cbfef0314ce4cc3fc2b05af5995de675b7ba69676eb07314bcc1c10e338` |
| `assets/data/dungeon-consumables.csv` | `1bb24610658ea0231800ab9ff2ab4da1b16547c98f7f85f67c16829fc63fd8fa` |
| `assets/data/dungeon-collections.csv` | `5fc95ca70b5e33d99448e5f2b5b818b70d590b148e12efc423d42b850671a2fa` |
| `assets/data/dungeon-buffs.csv` | `d8779b29bfbeb34abf9b40cb3b382d11c196963418e0d260f2e62df552b326ad` |
| `assets/js/dungeon-core.mjs` | `b1ef085fc3ab78a750ecca5fa28b135545da5df28405063a52f99438207c10e3` |
| `assets/js/dungeon-tuning.mjs` | `7b41db354d7e1bf5e2b7b2394b5e9f8196981270251d840a2b630e69497b7204` |
| `assets/js/dungeon-design.mjs` | `1341006856774c4977b53973e782e43be32c71054e32414089ecff35de462c34` |
| `assets/js/dungeon-upgrades.mjs` | `8fafb2959439f1faf25dfeaa20ae60415f2b7df684d831b53f38473fdeedf2a8` |
| `assets/js/dungeon-ranks.mjs` | `de55bdc6219f4a2783d57623adc6628b54b12e140a42b7ac95c5f461cffdaef1` |
| `assets/js/dungeon-alchemy.mjs` | `40377bd2347e0a641e6669006136c7befb5525ee212aafb3cce7a6ef8df7f6ec` |
| `scripts/dungeon-balance-encounters.mjs` | `e5fb006344a41d9b5f6a390abfa1ec949f2e834c501ef2a2530586f2531a4e51` |
| `scripts/simulate-dungeon-journeys.mjs` | `8575a58fa8a1d9d146a8064560af804b5999fc9100264595119ce08480346c43` |
| `scripts/dungeon-test-contract.mjs` | `267bda79e2f9c149b0d9fdef8b14eaa67ab0820388d4504ddbc3ff0f2b343493` |
| `scripts/dungeon-fixed-deck-reference.mjs` | `9ed8a6c5158701cd8167d9f76242fc1d85ab8c62532a8a6a32287ec60a0d5582` |
| `scripts/dungeon-recommended-strength.mjs` | `29101477a963a3bd027e57559229b4dc3d6875b5f6b10c2c324afc2e6dce962b` |
| `scripts/dungeon-journey-strength-audit.mjs` | `01d8fd1b2c1c6f4253172525cfb1951754e78d2317063aec0224d6870a9dac63` |
| `scripts/check-dungeon-journey-strength.mjs` | `d501d8406f73ae721c7241036df3f9f21a14532a6595276fc953bd258d15478b` |
| `tests/test-dungeon-floor-strength.mjs` | `1895e87909b35dbcb786989e558593a501dea9f5e269b954bb6018867308ce22` |
| `config/dungeon-approved-goals.v1.json` | `91bf95943deaf16d4bd2722fa8dad879491ae3162095afe9dc459a7570f3e6fc` |

## Next adjustment owner

Treat the 2,056 measured misses as the tuning target; do not edit this calculator, test contract, simulator, checker, fixed-50 gates, combat formulas, or approved thresholds. Use only the already approved balance-data parameters and existing MP recovery table scope, preserve chapter and economy checks, then rerun fixed-50 and the full source-hash-pinned 6 × 10 × 256 audit. Do not report success unless the strict checker passes. Weak-layer EXP taper is a separate, still-unimplemented task.
