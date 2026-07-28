-- ============================================================================
-- TOTALS-FIX VERIFICATION — centered temperature term (PR #12, merged 2026-07-26)
-- ----------------------------------------------------------------------------
-- ⛔ DO NOT RUN before ~2026-08-02. A few graded slates on the NEW centered-temp
--    logic must accumulate first. This query is windowed to POST-DEPLOY rows only.
--
-- WHY THE WINDOW: rows before 2026-07-26 carry the OLD asymmetric binary temp term
--    (hot >80F +0.3 / cold <55F -0.3) and MUST be excluded, or you measure a mix of
--    old+new formulas and get a meaningless verdict. The WHERE clause below does this.
--
-- ⚠ BOUNDARY CAVEAT: PR #12 deployed ON 2026-07-26 (~07:44 UTC). A game_date filter
--    cannot tell a 07-26 row recorded BEFORE the deploy from one recorded AFTER it,
--    so early-07-26 shadow rows may still carry the old formula. For a ZERO-risk
--    clean sample, change the window to  game_date >= '2026-07-27'  (one line below).
--    Kept at '2026-07-26' as specified; tighten to '2026-07-27' if you want no doubt.
--
-- COUNT GATE: run the count first. Post-deploy n starts tiny (positive-edge, non-
--    band-cut totals ∩ graded shadow). If n < 25, DO NOT trust the aggregate — wait
--    for more slates. The quartile poison test (overhit_top_q/bot_q) needs even more.
--
-- SUCCESS CRITERIA (all measured on these clean post-deploy rows):
--   1. baseline_bias (the NEW meanProjMinusActual) is MEANINGFULLY BELOW tonight's
--      +0.57  →  the centered fix reduced the over-lean.
--   2. weather_adj `bias_if_removed` is NO LONGER the largest mover toward 0 across
--      the seven terms  →  weather is no longer the dominant culprit.
--   3. weather_adj `overhit_top_q` vs `overhit_bot_q` is NO LONGER inverted (top-
--      quartile push no longer hits over WORSE than bottom)  →  the anti-predictive
--      push is gone.
--
-- IF THE LEAN DOES NOT SHRINK on clean post-deploy rows: temperature was not the
--    whole story — reassess (wind magnitude, base RPG staleness, projMinusLine.sd).
--    Do NOT read a verdict off any sample that mixes pre/post-2026-07-26 rows.
--
-- READING CAVEATS (unchanged from the original hunt):
--   • `base` is the ~8-9-run foundation, not an actionable term — its bias_if_removed
--     is meaningless ("can't remove base"). Sanity anchor only.
--   • `ace_adj` ⊂ `pitcher_adj` (pitcher_adj = linPitcher + ace) — overlapping, don't sum.
--   • Small-n quartiles are noisy; trust mean_contrib / bias_if_removed before the
--     overhit_top_q/bot_q split until n is comfortably large.
-- ============================================================================

-- ---- OPTIONAL COUNT GATE (run this first; need n >= 25 to trust the aggregate) ----
-- SELECT count(*) AS n
-- FROM model_predictions s
-- JOIN model_predictions c
--   ON c.game_id = s.game_id AND c.game_date = s.game_date AND c.market = 'total'
-- WHERE s.market = 'total_shadow'
--   AND s.projected IS NOT NULL AND s.actual_value IS NOT NULL
--   AND s.game_date >= '2026-07-26';          -- ← tighten to '2026-07-27' for zero pre-deploy risk

-- ---- THE VERIFICATION QUERY ----
WITH j AS (
  SELECT s.projected, s.actual_value, s.line,
         (s.actual_value > s.line)::int          AS over_hit,
         (s.projected - s.actual_value)          AS pma,      -- proj minus actual; avg = the lean
         COALESCE(c.base,0)        AS base,        COALESCE(c.pitcher_adj,0) AS pitcher_adj,
         COALESCE(c.ace_adj,0)     AS ace_adj,     COALESCE(c.park_adj,0)    AS park_adj,
         COALESCE(c.weather_adj,0) AS weather_adj, COALESCE(c.bullpen_adj,0) AS bullpen_adj,
         COALESCE(c.fatigue_adj,0) AS fatigue_adj
  FROM model_predictions s
  JOIN model_predictions c
    ON c.game_id = s.game_id AND c.game_date = s.game_date AND c.market = 'total'
  WHERE s.market = 'total_shadow'
    AND s.projected IS NOT NULL AND s.actual_value IS NOT NULL
    AND s.game_date >= '2026-07-26'          -- ← POST-DEPLOY ONLY. tighten to '2026-07-27' for zero risk.
),
u AS (
  SELECT term, val, pma, over_hit,
         ntile(4) OVER (PARTITION BY term ORDER BY val) AS q
  FROM j CROSS JOIN LATERAL (VALUES
    ('1_base',base),('2_pitcher_adj',pitcher_adj),('3_ace_adj',ace_adj),
    ('4_park_adj',park_adj),('5_weather_adj',weather_adj),
    ('6_bullpen_adj',bullpen_adj),('7_fatigue_adj',fatigue_adj)
  ) AS t(term,val)
)
SELECT term,
       count(*)                                                 AS n,
       round(avg(val)::numeric,3)                               AS mean_contrib_runs,
       round(avg((val<>0)::int)::numeric*100,1)                 AS fire_pct,
       round(avg(pma)::numeric,3)                               AS baseline_bias,   -- NEW meanProjMinusActual; want << +0.57
       round((avg(pma)-avg(val))::numeric,3)                    AS bias_if_removed,  -- weather_adj row should NOT be the biggest mover toward 0
       round((avg(over_hit) FILTER (WHERE q=4))::numeric*100,1) AS overhit_top_q,    -- term pushes total HIGHEST
       round((avg(over_hit) FILTER (WHERE q=1))::numeric*100,1) AS overhit_bot_q     -- term pushes LOWEST  (weather: want NOT inverted)
FROM u GROUP BY term ORDER BY term;
