# CFB Historical Calibration Phase 2

Decision: **B — Parallel v2 shadow justified.**

Candidate: `cfb-preseason-prior-shadow-v2-2026-rp1-tal2.5-hfa3-sig17.5`

Parameters: RP 1, talent 2.5, HFA 3, sigma 17.5, historical uncertainty scale 0.

Historical returning production uses exact target-season CFBD `percentPPA`; no 2026 outcomes were used. Historical uncertainty was unavailable and therefore not reconstructed.

## Aggregate validation (2023-2025)

- Games: 2210
- V1 comparable: MAE 14.10966982, RMSE 17.87991859, Brier 0.20643131, log loss 0.59867387
- Candidate: MAE 13.83350226, RMSE 17.53372975, Brier 0.20365648, log loss 0.59144126
- Delta: MAE -0.27616756, RMSE -0.34618884, Brier -0.00277483, log loss -0.00723261

- Calibration: V1 ECE 0.01067596; candidate ECE 0.03345562. The primary scores improve, but fixed-bin ECE worsens and remains a prospective risk.

## Walk-forward folds

| Validation | n | Δ MAE | Δ RMSE | Δ Brier | Δ log loss |
|---:|---:|---:|---:|---:|---:|
| 2023 | 729 | -0.36735826 | -0.47494304 | -0.00272556 | -0.0066167 |
| 2024 | 741 | -0.27649197 | -0.26240509 | -0.00457545 | -0.0121943 |
| 2025 | 740 | -0.16323344 | -0.28498445 | -0.00141491 | -0.00501674 |

## Paired bootstrap (1,000 per-game replicates)

- Absolute error delta: -0.27616756; 95% CI [-0.3730156, -0.1890439].
- Squared error delta: -12.25981009; 95% CI [-15.77991067, -8.71218206].
- Brier delta: -0.00277483; 95% CI [-0.0048793, -0.00063029].
- Log-loss delta: -0.00723261; 95% CI [-0.01224572, -0.002102].

## Prospective parallel-v2 refit

After the held-out gate passed, the unchanged search was refit on all 2021-2025 data solely for future shadow collection. The frozen v2 configuration is RP 1.25, talent 2.5, HFA 3, sigma 15.5, uncertainty scale 0. Its in-sample refit metrics are not validation evidence.

## Semantic coverage

| Season | exact CFBD rows | teams with percentPPA | evaluated games |
|---:|---:|---:|---:|
| 2021 | 128 | 128 | 679 |
| 2022 | 130 | 130 | 724 |
| 2023 | 131 | 131 | 729 |
| 2024 | 133 | 133 | 741 |
| 2025 | 134 | 134 | 740 |

## Parameter findings

- CFBD percentPPA adds value. The supported RP coefficient varies by fold; the final all-pre-2026 prospective refit is 1.25.
- Talent remains additive after residualizing against prior rating and percentPPA. Performance improves through the 2.5 boundary, so scale identifiability is unresolved and the search is not expanded indefinitely.
- HFA 3.0 remains the stable simple choice; neutral HFA is always zero.
- Sigma 14 beats 15.5 on held-out 2023-2025 probability scores, while 2021-2022 preferred 17.5 and the all-history refit returned 15.5. The instability is why v2 keeps 15.5 and requires prospective comparison.
- Historical uncertainty is not semantically reconstructible. Scale 0 is the only honest historical comparison; live v1 uncertainty is unchanged.

## Scientific limits

- The live v1 uncertainty architecture cannot be reconstructed historically; its scale remains unchanged in production.
- Phase 1's overall-returning proxy is not treated as equivalent to CFBD percentPPA.
- This result can justify only a parallel prospective shadow lane, never customer promotion.
- Provider calls attempted: 7 of 40.
