# CFB Historical Calibration Phase 1

Version: `cfb-historical-calibration-phase1-v1-2026-08-31`

Input SHA-256: `ab02849dceefae3cef3c8fc1be3ba6bcfb749ea9b6eeebe07c3d8a264b4088cb`

Result SHA-256: `c8c1d1fb2c68e7974858bfa4d29ab1e5374f952f15601590a4363937baaf15cd`

## Scope and safety

This is an inert, deterministic, pre-2026 research lab. It is not imported by the
server, routes, schedulers, customer model, prediction tracker, grading, or the
live CFB shadow collector. It writes no database rows and calls no providers.
No customer formula, selection, probability, threshold, market blend, API shape,
or prospective 2026 record is changed.

The current live v1 assumptions are mirrored only for comparison: returning
production `0.75` points/residual SD, talent `0.50`, HFA `3.0`, base sigma
`15.5`, uncertainty scale `1.0`, quadrature uncertainty, and normal-CDF
moneyline probability.

## Historical data

The committed snapshot normalizes 16 versioned SportsDataverse release assets:

- Results and prior-rating inputs: `cfb_schedules`, 2020–2025.
- Returning production: `cfb_returning_production`, 2021–2025. The available
  field is `overall_returning`, derived from prior ESPN player-box evidence. It
  is a proxy and is **not** CFBD `percentPPA`; its fitted coefficient is not a
  drop-in coefficient for the live feature.
- Talent: `cfb_team_talent`, 2021–2025, using the published 247Sports composite.
- Identity: exact durable numeric ESPN team IDs. No fuzzy or player-name match.
- Market: unavailable. There is no trustworthy internal pre-2026 market ledger,
  and no historical Odds API or Pinnacle data was fetched.
- Uncertainty: exact historical QB, transfer, coaching, and roster-evidence
  snapshots are unavailable. A narrow missingness proxy is reported but its
  scale is not fit.

New calls consumed: CFBD `0/40`; Odds API `0`; Pinnacle `0`; ESPN API `0`.

| Target | Prior | FBS teams | Prior rating | Returning | Talent | Eligible | Excluded | Neutral | Evaluated |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2021 | 2020 | 130 | 125 | 128 | 127 | 732 | 53 | 20 | 679 |
| 2022 | 2021 | 131 | 130 | 130 | 128 | 734 | 10 | 19 | 724 |
| 2023 | 2022 | 133 | 131 | 133 | 130 | 750 | 21 | 21 | 729 |
| 2024 | 2023 | 134 | 133 | 134 | 131 | 752 | 11 | 35 | 741 |
| 2025 | 2024 | 136 | 134 | 136 | 135 | 762 | 22 | 22 | 740 |

Every exclusion above is a missing prior rating after the active minimum-games
gate. Identity failures are zero. The dataset retains missing feature values and
adds uncertainty rather than silently fabricating them.

## Walk-forward design

Prior ratings for target season Y are rebuilt only from regular-season Y-1
scores with the active SRS constants: regression `0.72`, minimum four games,
margin cap `28`, 12 iterations, FCS level `-28`, and SOS weight `0.80`.
Target-season scores are outcomes only and cannot enter their preseason inputs.

The initial frozen selection fits 1,890 configurations on 2021–2022, then tests
the selected configurations independently on 2023, 2024, and 2025. Additional
expanding folds are 2021–2022→2023, 2021–2023→2024, and 2021–2024→2025.
Search-space version is `cfb-historical-grid-v1-2026-08-31`. Bootstrap comparisons
use 1,000 paired replicates and seed `20260831` plus fixed metric offsets.

The deterministic search grid is:

- Returning production: `0, .25, .5, .75, 1, 1.25, 1.5`
- Talent: `0, .25, .5, .75, 1, 1.25`
- HFA: `1.5, 2, 2.5, 3, 3.5`
- Base sigma: `12, 13, 14, 15, 15.5, 16, 17, 18, 19`
- Uncertainty scale: `1` only; historical uncertainty fitting is disabled

## V1 and prior-only baselines

Metrics are home-margin and home-win metrics. Calibration columns are logistic
intercept/slope; ECE uses the five predeclared reliability bins in the JSON.

| Baseline | Season | n | Bias | MAE | RMSE | Brier | Log loss | Cal int. | Cal slope | ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| V1 | 2023–25 | 2,210 | -0.9170 | 14.0928 | 17.8633 | .206370 | .598651 | -.0092 | 1.1149 | .01571 |
| V1 | 2023 | 729 | -0.3914 | 13.3957 | 17.0206 | .194734 | .572846 | -.1142 | 1.4423 | .04475 |
| V1 | 2024 | 741 | -1.1176 | 14.5501 | 18.3402 | .216005 | .618688 | .0416 | .9040 | .02401 |
| V1 | 2025 | 740 | -1.2340 | 14.3217 | 18.1869 | .208185 | .604008 | .0302 | 1.0683 | .02826 |
| Prior only | 2023–25 | 2,210 | -0.9768 | 14.2782 | 18.0896 | .209870 | .606936 | .0217 | 1.0230 | .01325 |
| Prior only | 2023 | 729 | -0.4286 | 13.6460 | 17.3455 | .199525 | .584114 | -.0780 | 1.3097 | .05213 |
| Prior only | 2024 | 741 | -1.1852 | 14.7575 | 18.5224 | .219848 | .627823 | .0720 | .8202 | .04362 |
| Prior only | 2025 | 740 | -1.3081 | 14.4211 | 18.3671 | .210071 | .608501 | .0555 | 1.0043 | .01578 |

V1 improves prior-only MAE, RMSE, Brier, and log loss in every validation season.
Prior-only has slightly lower aggregate ECE, showing why no single metric is used
for selection.

## Frozen candidates

| Candidate | RP | Talent | HFA | Sigma | Unc. | Bias | MAE | RMSE | Brier | Log loss | ECE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 balanced | 1.00 | 1.25 | 3.0 | 17 | 1 | -.8489 | 13.9490 | 17.6860 | .204910 | .595262 | .03182 |
| 2 margin | 1.00 | 1.25 | 3.0 | 14 | 1 | -.8489 | 13.9490 | 17.6860 | .203734 | .591670 | .00948 |
| 3 probability | 1.25 | 1.25 | 3.5 | 18 | 1 | -.3604 | 13.9181 | 17.6557 | .205111 | .595883 | .03519 |

Candidate 1 improves V1 MAE by `0.1438`, RMSE by `0.1772`, Brier by
`.001460`, and log loss by `.003389`; all paired bootstrap intervals exclude
zero. Its aggregate calibration slope `1.3008` and ECE `.03182` show material
underconfidence, so it is not a probability-calibration winner.

Candidate 2 uses the same margin mean as candidate 1 and improves V1 MAE by
`0.1438`, RMSE by `0.1772`, Brier by `.002636`, log loss by `.006981`, and ECE
by `.006236`. The paired 95% bootstrap intervals are MAE
`[-.1814, -.1074]`, squared error `[-7.6405, -4.8574]`, Brier
`[-.003494, -.001793]`, and log loss `[-.008950, -.005006]`.

Candidate 2 also improves all four primary metrics in each validation year:

| Season | n | Bias | MAE | RMSE | Brier | Log loss | ECE |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2023 | 729 | -.3399 | 13.2090 | 16.7771 | .190294 | .561279 | .04656 |
| 2024 | 741 | -1.0444 | 14.4084 | 18.2008 | .214187 | .613745 | .03183 |
| 2025 | 740 | -1.1546 | 14.2180 | 18.0320 | .206509 | .599504 | .01679 |

Candidate 3 has the best aggregate margin metrics but worse aggregate ECE than
V1, a calibration slope of `1.3665`, and a paired log-loss interval that reaches
zero (`[-.005507, .000062]`). It is less stable as a probability candidate.

The expanding balanced fold selects RP/talent/HFA/sigma of `1/1.25/3/17` for
2023 and `1.5/1.25/3/15.5` for 2024 and 2025. RP drifts upward and talent sits at
the search boundary, so the precise coefficients are not treated as settled.

## Feature conclusions

- **Returning production adds value in this reconstruction.** Returning-only
  improves prior-only MAE (`14.1961` vs `14.2782`), Brier (`.207932` vs
  `.209870`), and log loss (`.602614` vs `.606936`). Its source mismatch means
  the magnitude cannot be transferred directly to live CFBD `percentPPA`.
- **Talent adds value.** Talent-only improves prior-only MAE (`14.1766`), Brier
  (`.208328`), and log loss (`.602989`); full V1 improves further.
- **HFA 3.0 is supported within the tested architecture.** It is chosen by the
  balanced search in all expanding folds. Raw home-margin differences are only
  descriptive because schedules are not venue-randomized.
- **Sigma 15.5 is plausible but not the best aggregate calibration.** The
  candidate-2 sigma of 14 improves aggregate Brier, log loss, slope, and ECE,
  but the year-level calibration response is not uniform, especially in 2024.
- **Historical uncertainty is not validated.** The honest availability proxy
  correlates `-0.0184` with absolute error and has almost no dispersion because
  the key historical QB/transfer/coaching/roster components do not exist.
- **Weakest current assumption:** the uncertainty architecture is not
  historically reconstructible. Among testable numeric assumptions, the
  universal `15.5` sigma is the clearest challenger, while the feature-weight
  estimates require source-compatible prospective confirmation.

## Recommendation

**B. A v2 shadow candidate is justified for future parallel prospective testing.**

Proposed research identifier: `cfb-preseason-game-shadow-v2-candidate-2026`.
The defensible starting candidate is RP `1.00`, talent `1.25`, HFA `3.0`, base
sigma `14`, and uncertainty scale `1`. This is not approval to import, deploy,
or promote it. Before a parallel lane is built, its returning-production feature
must be translated and revalidated against the exact live 2026 CFBD `percentPPA`
semantics; the talent boundary and year-level calibration instability must be
treated as explicit risks. The live v1 identifier and experiment stay frozen.

No 2026 outcomes were used for calibration. The live CFB v1 challenger and all customer prediction behavior remain unchanged.
