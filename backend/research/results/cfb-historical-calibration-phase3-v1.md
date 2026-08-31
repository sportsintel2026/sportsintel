# CFB Historical Calibration Phase 3

Decision: **C — In-season-updating parallel v3 justified.**

No 2026 outcomes were used. QB, defensive returning production, and transfers were rejected rather than fabricated.

## Validation (2023-2025)

| Model | n | MAE | RMSE | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|---:|
| v1 | 2210 | 14.10966982 | 17.87991859 | 0.20643131 | 0.59867387 | 0.01067596 |
| v2 | 2210 | 13.82384733 | 17.52625393 | 0.20246531 | 0.58776604 | 0.01865772 |
| phase3Preseason | 2210 | 13.61577744 | 17.27483084 | 0.2015341 | 0.5840988 | 0.01048504 |
| phase3Updater | 2210 | 12.84559772 | 16.22911986 | 0.18613123 | 0.5484734 | 0.02811035 |

## Walk-forward selections

| Validation | preseason parameters | prior games | preseason MAE | updater MAE |
|---:|---|---:|---:|---:|
| 2023 | {"offenseReturningWeight":1,"talentWeight":4,"homeFieldAdvantage":3,"baseSigma":17} | 4 | 12.80680668 | 12.47951079 |
| 2024 | {"offenseReturningWeight":1.5,"talentWeight":4,"homeFieldAdvantage":3,"baseSigma":17} | 4 | 14.22251682 | 13.44284878 |
| 2025 | {"offenseReturningWeight":1.5,"talentWeight":4,"homeFieldAdvantage":3,"baseSigma":17} | 4 | 13.80516365 | 12.60818468 |

## Frozen architecture

Preseason offense = prior offense + RP_OFF × residualized offensive percentPPA + 0.5 × TALENT × residualized talent.

Preseason defense = prior defense + 0.5 × TALENT × residualized talent.

Projected margin = home offense − away defense − away offense + home defense + neutral-aware HFA.

After both sides have at least four completed games, each offense/defense posterior is (K × preseason + games × current opponent-adjusted estimate) / (K + games). The inner current-season fit uses one zero-centered pseudo-game to prevent sparse-graph oscillation; K is selected walk-forward from the frozen admissible grid.

Prospective refit: {"offenseReturningWeight":1.5,"talentWeight":4,"homeFieldAdvantage":3,"baseSigma":17}; updater prior games=4.

## Time bands

| Band | n | MAE | RMSE | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|---:|
| weeks1To3 | 426 | 13.71640669 | 17.26229129 | 0.16873486 | 0.50422922 | 0.03731523 |
| weeks4To6 | 465 | 12.65518051 | 16.26923477 | 0.19673707 | 0.57280726 | 0.04075048 |
| week7Plus | 1319 | 12.63148051 | 15.86660461 | 0.18801079 | 0.55418438 | 0.03885012 |

## Minimum completed games across the matchup

| Games | n | MAE | RMSE | Brier | Log loss |
|---|---:|---:|---:|---:|---:|
| 0 | 242 | 13.6634369 | 17.33976967 | 0.16796226 | 0.50633754 |
| 1 | 210 | 14.06628514 | 17.43899964 | 0.18285562 | 0.53098071 |
| 2 | 198 | 12.11640142 | 15.89718673 | 0.18569391 | 0.54811455 |
| 3 | 198 | 12.69423381 | 16.26510775 | 0.20148819 | 0.58556058 |
| 4+ | 1362 | 12.6400834 | 15.87008043 | 0.18769561 | 0.55331785 |

## Ablations (positive delta means removing the component is worse)

| Removed | MAE delta | RMSE delta | Brier delta | Log-loss delta |
|---|---:|---:|---:|---:|
| noOffenseReturning | 0.0659613 | 0.07225953 | 0.00111004 | 0.0024566 |
| noTalent | 0.39913659 | 0.46145823 | 0.00398385 | 0.01150211 |
| noUpdater | 0.77017972 | 1.04571098 | 0.01540287 | 0.0356254 |

## Deterministic paired bootstrap

| Baseline | Metric | Mean candidate-minus-baseline | 95% interval |
|---|---|---:|---|
| vsV1 | absoluteMarginError | -1.2640721 | [-1.51833026, -1.0091947] |
| vsV1 | squaredMarginError | -56.30715751 | [-66.19883608, -47.39686555] |
| vsV1 | brier | -0.02030008 | [-0.0247137, -0.01564238] |
| vsV1 | logLoss | -0.05020047 | [-0.06142641, -0.03884358] |
| vsV2 | absoluteMarginError | -0.97824961 | [-1.19013728, -0.7812092] |
| vsV2 | squaredMarginError | -43.78524544 | [-52.17042346, -35.54680988] |
| vsV2 | brier | -0.01633407 | [-0.01982395, -0.01251703] |
| vsV2 | logLoss | -0.03929263 | [-0.04923177, -0.02980885] |

## Data limits

- Offense/defense priors use only previous-season FBS-vs-FBS final scores.
- CFBD returning production is offensive. No defensive RP field exists in the inspected payload.
- No exact historical starting-QB identity exists; name joins remain forbidden.
- No cached exact 2021-2025 portal aggregate exists; transfer effects are excluded.
- New Phase 3 CFBD calls: 0 of 60.
