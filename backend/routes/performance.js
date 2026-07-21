// Performance route — serves the model's tracked record, per sport (league).
//
// GET /api/performance/:league   (league = mlb | nba | nfl | cfb)
//   → win/loss/ROI by market and confidence tier, a CLV summary, and a SEPARATE
//     props table. Props NEVER count toward the core record or CLV — they live in
//     their own table, measured by hit-rate / ROI (plus-money longshots).
//
// "Qualified picks": the model publishes every edge it finds, but its low-conviction
// (NEUTRAL / LOW) plays are noise and drag the record down. The headline record
// reflects only QUALIFIED picks (confidence in QUALIFYING_TIERS). The FULL record
// is returned alongside it, so nothing is hidden.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const calibrationGuard = require("../services/calibrationGuard"); // WZ-CALIB-GUARD-2026-07-17
const { runLineCoverModel } = require("../services/edgesModel"); // WZ-RL-BACKTEST-2026-07-17 :: real run-line model for replay

// --- per-sport market config -------------------------------------------------
// core  = team markets that count toward the overall record + CLV
// props = prop markets shown in their OWN table (hit-rate / ROI), never in core
// clv   = markets eligible for a captured closing line; a market with none simply
//         yields clv = null (honest "not captured yet" state for new sports)
const LEAGUE_CONFIG = {
  mlb: { core: ["moneyline", "total", "run_line"], props: ["hr_prop", "player_strikeouts", "player_hits"], clv: ["moneyline", "total"], propsLabel: "Player props" },
  nba: { core: ["moneyline", "spread", "total"], props: ["player_points", "player_rebounds", "player_assists", "player_threes"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  nfl: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  cfb: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
};

// --- selection rule (tune here) ---------------------------------------------
// WZ-COUNT-ALL-TIERS-2026-07-18 :: every core pick counts, win or lose.
// Previously only HIGH+MEDIUM reached the headline, which silently dropped the LOW and
// NEUTRAL tiers from the published record even though those picks WERE shown on the board
// and WERE graded. That hid the single best-performing slice: NEUTRAL (the smallest claimed
// edge) ran 37-26 / +8.1% ROI while HIGH ran 16-17 / -7.4%. A record that omits winning
// picks is not a record. All four tiers now count; the frontend already renders all four.
// Reversible: put ["HIGH","MEDIUM"] back to restore the old headline.
const QUALIFYING_TIERS = ["HIGH", "MEDIUM", "LOW", "NEUTRAL"];
function isQualified(r) {
  const conf = (r.confidence || "NEUTRAL").toUpperCase();
  return QUALIFYING_TIERS.includes(conf);
}
// WZ-BENCH-NOT-COUNTED-2026-07-18 :: a pick made while its market was benched off the board
// is RECORDED (so the market can prove itself and earn release) but is NOT counted in the
// published headline -- subscribers never saw it, so it cannot flatter or damage the number
// they were actually shown. Those rows still appear in fullSample for internal analysis.
function wasShownToSubscribers(r) {
  return r.benched_at_pick !== true;
}
// ----------------------------------------------------------------------------

// --- per-market track-record resets -----------------------------------------
// A market's published record only counts graded picks on/after this date,
// because the model for that market was materially rebuilt and older picks no
// longer reflect it. NON-DESTRUCTIVE: the old rows stay in the DB, they're just
// not counted on the page (reversible — remove the entry to count them again).
// The cutoff date is also returned to the page so it can show an honest
// "tracking reset on <date>" note rather than silently dropping a record.
const MARKET_RESET = {
  hr_prop: "2026-06-07",     // bumped 6/6→6/7: HR power factor revived onto Savant xwOBA today (was ISO fallback), so count the new model from a clean slate
  player_hits: "2026-06-07", // hits model rebuilt today onto xBA + binomial + market anchor; earlier picks were the broken season-AVG model
};
function afterReset(r) {
  const cut = MARKET_RESET[r.market];
  return !cut || (r.game_date && r.game_date >= cut);
}
// WZ-CORE-RESET-2026-07-10 :: MLB CORE track-record resets. Audit 2026-07-09 found the
// published MLB record was contaminated by two non-current-model sources: (a) a pre-launch
// backfill (246 rows on 2026-06-11, before the 2026-06-22 launch), and (b) the RETIRED
// edge-first board's sub-55% moneyline dogs -- 513 rows the current winners-first model
// structurally never picks. Count each MLB core market only from the date its CURRENT model
// took over: moneyline from the winners-first pivot, total/run_line from the win-prob
// calibration deploy. Same NON-DESTRUCTIVE, reversible idiom as MARKET_RESET above (rows
// stay in the DB, just aren't counted). Scoped to MLB so NBA/NFL/CFB records are untouched.
const MLB_CORE_RESET = {
  moneyline: "2026-07-08", // winners-first pivot clean window (drops pre-launch + sub-55 dog junk)
  total:     "2026-07-02", // win-prob calibration deploy
  run_line:  "2026-07-02", // win-prob calibration deploy
};
function afterCoreReset(league, r) {
  if (league !== "mlb") return true;      // only MLB core is being reset here
  const cut = MLB_CORE_RESET[r.market];
  return !cut || (r.game_date && r.game_date >= cut);
}
// ----------------------------------------------------------------------------

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
// American odds → profit on a 1-unit win (for ROI). -110 → 0.909, +150 → 1.5
function unitProfit(odds) {
  if (odds == null) return 1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
// Average odds must be computed in DECIMAL space — linearly averaging American
// odds is meaningless when picks straddle the +/- line (e.g. -110 and +110
// "average" to 0). Convert → average decimals → convert back to American.
function americanToDecimal(o) {
  if (o == null) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
function decimalToAmerican(d) {
  if (d == null || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

// -- WZ-CALIB-PROBE-2026-07-10 :: TEMPORARY read-only calibration probe --------
// GET /api/performance/calibprobe
// Phone-friendly diagnostics so no Supabase SQL editor is needed:
//   1. calibration    - claimed model_prob vs actual win rate, banded, per core
//                       market, counted ONLY inside each market's current reset
//                       window (same afterCoreReset() scoping as the record).
//                       gapPts positive = model overconfident in that band.
//   2. pipeline       - pending/win/loss/push counts per core market, split
//                       before vs since its reset cutoff (answers "where's
//                       moneyline": young window vs dead pipeline).
//   3. moneylineGap   - moneyline rows dated 2026-07-02..2026-07-07, the data
//                       for the "pull ML cutoff back to 7/02?" decision.
//   4. totalsSides    - totals split by over/under since 2026-07-02: record,
//                       ROI, avg CLV per side (quantifies the over-lean flag).
// Read-only: SELECTs only, echoes no secrets, mutates nothing. Units match the
// main route: edge and clv are stored as fractions and reported here as percent.
// REMOVE this route together with /api/ufc/probe once calibration work is done.
// Registered BEFORE "/:league" so Express does not swallow it as a league name.
router.get("/calibprobe", async (req, res) => {
  try {
    const supabase = db();
    const core = LEAGUE_CONFIG.mlb.core;
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, selection, model_prob, odds, edge, confidence, result, game_date, clv")
        .eq("league", "mlb")
        .in("market", core)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const settled = (r) => r.result === "win" || r.result === "loss";
    const pct1 = (x) => Math.round(x * 1000) / 10;          // fraction -> percent, 1 dp
    const pct2 = (x) => Math.round(x * 10000) / 100;        // fraction -> percent, 2 dp (CLV)

    // ---- 1. calibration bands (settled, since each market's reset) ----------
    const BANDS = [
      { key: "<0.40", lo: -Infinity, hi: 0.40 },
      { key: "0.40-0.45", lo: 0.40, hi: 0.45 },
      { key: "0.45-0.50", lo: 0.45, hi: 0.50 },
      { key: "0.50-0.55", lo: 0.50, hi: 0.55 },
      { key: "0.55-0.60", lo: 0.55, hi: 0.60 },
      { key: "0.60+", lo: 0.60, hi: Infinity },
    ];
    const bandKey = (p) => { for (const b of BANDS) { if (p >= b.lo && p < b.hi) return b.key; } return null; };
    const calibration = {};
    for (const m of core) calibration[m] = { settledNoModelProb: 0, bands: {} };
    for (const r of rows) {
      if (!settled(r) || !afterCoreReset("mlb", r)) continue;
      const c = calibration[r.market];
      if (r.model_prob == null) { c.settledNoModelProb++; continue; }
      const k = bandKey(Number(r.model_prob));
      if (!k) continue;
      const b = (c.bands[k] ||= { n: 0, wins: 0, probSum: 0, edgeSum: 0, edgeN: 0, clvSum: 0, clvN: 0 });
      b.n++;
      if (r.result === "win") b.wins++;
      b.probSum += Number(r.model_prob);
      if (r.edge != null) { b.edgeSum += Number(r.edge); b.edgeN++; }
      if (r.clv != null) { b.clvSum += Number(r.clv); b.clvN++; }
    }
    for (const m of Object.keys(calibration)) {
      for (const k of Object.keys(calibration[m].bands)) {
        const b = calibration[m].bands[k];
        calibration[m].bands[k] = {
          n: b.n,
          wins: b.wins,
          claimedPct: pct1(b.probSum / b.n),
          actualPct: pct1(b.wins / b.n),
          gapPts: Math.round(((b.probSum / b.n) - (b.wins / b.n)) * 1000) / 10,
          avgEdgePct: b.edgeN ? pct1(b.edgeSum / b.edgeN) : null,
          avgClvPct: b.clvN ? pct2(b.clvSum / b.clvN) : null,
        };
      }
    }

    // ---- 2. pipeline: result counts before vs since each market's reset -----
    const pipeline = {};
    for (const m of core) pipeline[m] = { resetCutoff: MLB_CORE_RESET[m] || null, sinceReset: {}, beforeReset: {}, sinceResetDates: null };
    for (const r of rows) {
      const p = pipeline[r.market];
      if (!p) continue;
      const since = afterCoreReset("mlb", r);
      const bucket = since ? p.sinceReset : p.beforeReset;
      const key = r.result || "unknown";
      bucket[key] = (bucket[key] || 0) + 1;
      if (since && r.game_date) {
        if (!p.sinceResetDates) p.sinceResetDates = { first: r.game_date, last: r.game_date };
        else {
          if (r.game_date < p.sinceResetDates.first) p.sinceResetDates.first = r.game_date;
          if (r.game_date > p.sinceResetDates.last) p.sinceResetDates.last = r.game_date;
        }
      }
    }

    // ---- 3. moneyline gap window (cutoff decision data) ----------------------
    const moneylineGap = { window: "2026-07-02 to 2026-07-07", counts: {} };
    for (const r of rows) {
      if (r.market !== "moneyline" || !r.game_date) continue;
      if (r.game_date < "2026-07-02" || r.game_date > "2026-07-07") continue;
      const key = r.result || "unknown";
      moneylineGap.counts[key] = (moneylineGap.counts[key] || 0) + 1;
    }

    // ---- 4. totals over/under split since 2026-07-02 -------------------------
    const sideBlank = () => ({ settled: 0, wins: 0, units: 0, pending: 0, clvSum: 0, clvN: 0 });
    const totalsSides = { since: "2026-07-02", over: sideBlank(), under: sideBlank() };
    for (const r of rows) {
      if (r.market !== "total" || !r.game_date || r.game_date < "2026-07-02") continue;
      const side = r.selection === "over" ? totalsSides.over : r.selection === "under" ? totalsSides.under : null;
      if (!side) continue;
      if (settled(r)) {
        side.settled++;
        const won = r.result === "win";
        if (won) side.wins++;
        side.units += won ? unitProfit(r.odds) : -1;
        if (r.clv != null) { side.clvSum += Number(r.clv); side.clvN++; }
      } else if (r.result === "pending" || r.result == null) {
        side.pending++;
      }
    }
    for (const s of [totalsSides.over, totalsSides.under]) {
      s.winPct = s.settled ? pct1(s.wins / s.settled) : null;
      s.roi = s.settled ? pct1(s.units / s.settled) : null;
      s.units = Math.round(s.units * 100) / 100;
      s.avgClvPct = s.clvN ? pct2(s.clvSum / s.clvN) : null;
      delete s.clvSum; delete s.clvN;
    }

    // ---- 5. WZ-SLATE-SHADOW-2026-07-10 :: full-slate shadow calibration ------
    // Reads the *_shadow rows written by the full-slate shadow recorder in
    // predictionTracker.js (one fixed-side row per game per core market, every
    // scheduled game, no board filters). These rows never touch the published
    // record; this section is their only readout.
    const SHADOW_MARKETS = ["moneyline_shadow", "total_shadow", "run_line_shadow"];
    const shadowRows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, model_prob, result, game_date")
        .eq("league", "mlb")
        .in("market", SHADOW_MARKETS)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      shadowRows.push(...batch);
      if (batch.length < PAGE) break;
    }
    const shadowFullSlate = {};
    for (const m of SHADOW_MARKETS) shadowFullSlate[m] = { pending: 0, settled: 0, firstDate: null, lastDate: null, bands: {} };
    for (const r of shadowRows) {
      const s = shadowFullSlate[r.market];
      if (!s) continue;
      if (r.game_date) {
        if (!s.firstDate || r.game_date < s.firstDate) s.firstDate = r.game_date;
        if (!s.lastDate || r.game_date > s.lastDate) s.lastDate = r.game_date;
      }
      if (!settled(r)) { s.pending++; continue; }
      s.settled++;
      if (r.model_prob == null) continue;
      const k = bandKey(Number(r.model_prob));
      if (!k) continue;
      const b = (s.bands[k] ||= { n: 0, wins: 0, probSum: 0 });
      b.n++;
      if (r.result === "win") b.wins++;
      b.probSum += Number(r.model_prob);
    }
    for (const m of SHADOW_MARKETS) {
      for (const k of Object.keys(shadowFullSlate[m].bands)) {
        const b = shadowFullSlate[m].bands[k];
        shadowFullSlate[m].bands[k] = {
          n: b.n,
          wins: b.wins,
          claimedPct: pct1(b.probSum / b.n),
          actualPct: pct1(b.wins / b.n),
          gapPts: Math.round(((b.probSum / b.n) - (b.wins / b.n)) * 1000) / 10,
        };
      }
    }

    res.json({
      token: "WZ-CALIB-PROBE-2026-07-10",
      generatedAt: new Date().toISOString(),
      rowsScanned: rows.length,
      calibration,
      pipeline,
      moneylineGap,
      totalsSides,
      shadowFullSlate,
    });
  } catch (err) {
    res.status(500).json({ token: "WZ-CALIB-PROBE-2026-07-10", error: String(err && err.message || err) });
  }
});
// -- end WZ-CALIB-PROBE-2026-07-10 ---------------------------------------------

// WZ-CALIB-GUARD-2026-07-17 :: live calibration-guard status (what is benched, the gap, and why)
router.get("/guard", (req, res) => { res.json(calibrationGuard.getStatus()); });

// WZ-RL-BACKTEST-2026-07-17 :: read-only run-line REPLAY backtest. Re-runs the REBUILT margin model
// (runLineCoverModel) over graded shadow games and reports claimed-vs-actual cover calibration -- the
// evidence check ahead of un-benching run-line. Directional read (two documented input proxies), NOT
// the final gate; the clean gate is the forward shadow sample (new model logging since 2026-07-17)
// maturing. GET /api/performance/rlbacktest  [?since=YYYY-MM-DD]
router.get("/rlbacktest", async (req, res) => {
  try {
    const supabase = db();
    const SHADOW = ["moneyline_shadow", "total_shadow", "run_line_shadow"];
    const since = req.query.since || null;
    const phiOverride = req.query.phi != null ? Number(req.query.phi) : null; // WZ-RL-PHIDIAL-2026-07-17 :: tuning dial

    const PAGE = 1000; let from = 0; const rows = [];
    for (let i = 0; i < 40; i++) {
      let q = supabase.from("model_predictions")
        .select("game_id, matchup, market, selection, model_prob, line, odds, result, game_date")
        .eq("league", "mlb").in("market", SHADOW)
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (since) q = q.gte("game_date", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Join the three shadow markets per game (game_id when present, else matchup+date).
    const games = new Map();
    for (const r of rows) {
      const key = (r.game_id != null ? String(r.game_id) : (r.matchup || "?")) + "|" + (r.game_date || "?");
      let g = games.get(key); if (!g) { g = {}; games.set(key, g); }
      if (r.market === "moneyline_shadow") g.homeWin = r.model_prob != null ? Number(r.model_prob) : null;
      else if (r.market === "total_shadow") g.total = r.line != null ? Number(r.line) : null;
      else if (r.market === "run_line_shadow") { g.rlLine = r.line != null ? Number(r.line) : null; g.rlResult = r.result; }
    }

    const band = (p) => p < 0.50 ? "<0.50" : p < 0.55 ? "0.50-0.55" : p < 0.60 ? "0.55-0.60" : "0.60+";
    const conf = {}, full = {};
    let n = 0, skipped = 0;
    for (const g of games.values()) {
      if (g.homeWin == null || g.total == null || g.rlLine == null || (g.rlResult !== "win" && g.rlResult !== "loss")) { skipped++; continue; }
      const predHomeCover = runLineCoverModel(g.total, g.homeWin, g.rlLine, phiOverride); // WZ-RL-PHIDIAL: phi from ?phi=
      const homeCovered = g.rlResult === "win"; // shadow selection is always home vs its own homeLine
      n++;

      const fk = band(predHomeCover);
      (full[fk] ||= { n: 0, claimSum: 0, hit: 0 });
      full[fk].n++; full[fk].claimSum += predHomeCover; if (homeCovered) full[fk].hit++;

      const confP = Math.max(predHomeCover, 1 - predHomeCover);
      const confCovered = predHomeCover >= 0.5 ? homeCovered : !homeCovered;
      const ck = band(confP);
      (conf[ck] ||= { n: 0, claimSum: 0, hit: 0 });
      conf[ck].n++; conf[ck].claimSum += confP; if (confCovered) conf[ck].hit++;
    }

    const fin = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, {
      n: v.n,
      claimedPct: v.n ? Math.round((v.claimSum / v.n) * 1000) / 10 : null,
      actualPct: v.n ? Math.round((v.hit / v.n) * 1000) / 10 : null,
      gapPts: v.n ? Math.round(((v.claimSum / v.n) - (v.hit / v.n)) * 1000) / 10 : null,
    }]));

    res.json({
      token: "WZ-RL-BACKTEST-2026-07-17",
      phiUsed: phiOverride != null ? phiOverride : 1.35,
      dialUsage: "Add ?phi=1.5 (etc.) to re-score every game at that overdispersion. Find the phi that drops confidentSideBands 0.60+ gapPts under 4. Default phi=1.35.",
      whatThisIs: "Replay of the REBUILT run-line margin model over graded shadow games. Confident-side bands are the audit's lens -- OLD run-line there: 0.55-0.60 claimed 58.5 -> actual 50.0; 0.60+ claimed 62.5 -> actual 50.0 (n=94). Small gaps here = the rebuild fixed it.",
      gamesScored: n,
      gamesSkipped: skipped,
      confidentSideBands: fin(conf),
      homeCoverCalibration: fin(full),
      tuningKnob: "edgesModel RUN_PHI (currently 1.35). If confident bands still run hot (claimed >> actual), raise RUN_PHI and re-run.",
      caveats: [
        "Proxy 1: market TOTAL line used as projected total (model uses its own projectedTotal; usually within ~0.3-0.5 runs).",
        "Proxy 2: raw home win prob used, not the live 55/45 market-blended one.",
        "Directional sanity read, NOT the un-bench gate. Clean gate = the forward shadow sample maturing ~2 weeks, then re-check these bands.",
        "Un-bench run-line ONLY if the confident bands calibrate (gap small) AND a real edge exists; else tune RUN_PHI and re-run.",
      ],
    });
  } catch (err) {
    console.error("[rlbacktest] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WZ-TOTALSBIAS-2026-07-17 :: read-only totals over-lean meter. For graded full-slate total_shadow rows
// that carry a stored projected total, measures mean(projected - actual_value) = the projection's bias in
// runs (+ = projects HIGH = over-lean), recommends the TOTAL_MEAN_ADJ that centers it, and dials candidate
// adjustments against real over/under outcomes. Populates once the projected-logging deploy is live and
// games settle. GET /api/performance/totalsbias [?since=YYYY-MM-DD]
router.get("/totalsbias", async (req, res) => {
  try {
    const supabase = db();
    const since = req.query.since || null;
    const PAGE = 1000; let from = 0; const rows = [];
    for (let i = 0; i < 40; i++) {
      let q = supabase.from("model_predictions")
        .select("projected, actual_value, line, result, game_date, model_prob, edge, confidence")
        .eq("league", "mlb").eq("market", "total_shadow")
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (since) q = q.gte("game_date", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE; // WZ-TOTALSBIAS-PAGEFIX-2026-07-19 :: the cursor was declared and never advanced.
      // Dormant only while the graded total_shadow count stays under one page: `data.length < PAGE`
      // breaks on the first pass, so nobody saw it. Past 1000 rows the loop would have re-fetched page
      // ONE up to 40 times and pushed it 40 times -- n inflated ~40x, every mean and percentile in this
      // endpoint silently wrong, and no error anywhere. Same class as the gradeFinishedGames cap, but it
      // duplicates instead of dropping. At ~15 graded shadow rows/day that lands in ~9 weeks.
    }
    const usable = rows.filter(r => r.projected != null && r.actual_value != null && r.line != null);
    const n = usable.length;
    if (!n) {
      return res.json({
        token: "WZ-TOTALSBIAS-2026-07-17", n: 0,
        note: "No graded total_shadow rows carry a stored projected total yet. This populates going forward, once the projected-logging deploy is live and games settle. Re-check after ~1-2 weeks of slates.",
      });
    }
    let sumBias = 0, projOverLine = 0, wentOver = 0;
    const deltas = [-0.6, -0.4, -0.2, 0, 0.2];
    const dial = {}; for (const d of deltas) dial[d] = { overPicks: 0, overWins: 0, underPicks: 0, underWins: 0 };
    for (const r of usable) {
      const proj = Number(r.projected), act = Number(r.actual_value), line = Number(r.line);
      sumBias += (proj - act);
      if (proj > line) projOverLine++;
      const actualOver = act > line;
      if (actualOver) wentOver++;
      for (const d of deltas) {
        const c = dial[d];
        if ((proj + d) > line) { c.overPicks++; if (actualOver) c.overWins++; }
        else { c.underPicks++; if (!actualOver) c.underWins++; }
      }
    }
    const meanBias = Math.round((sumBias / n) * 100) / 100;
    const dialOut = {};
    for (const d of deltas) {
      const c = dial[d];
      const oW = c.overPicks ? Math.round((c.overWins / c.overPicks) * 1000) / 10 : null;
      const uW = c.underPicks ? Math.round((c.underWins / c.underPicks) * 1000) / 10 : null;
      dialOut["adj_" + d] = { overPicks: c.overPicks, overWinPct: oW, underPicks: c.underPicks, underWinPct: uW,
        spreadPts: (oW != null && uW != null) ? Math.round((oW - uW) * 10) / 10 : null };
    }
    // WZ-TOTALS-DISPERSION-2026-07-19 :: projection-vs-MARKET instrument (read-only, no pricing change).
    // Everything above measures projected vs ACTUAL. That is the bias (mean) half of the story. But the
    // PICK is generated by projected vs LINE, so the dispersion of (projected - line) is what decides
    // which side we take and how big an edge we claim. A projection can be near-unbiased against reality
    // (meanProjMinusActual 0.35) and still scatter wildly around the market number -- and because the
    // confident band selects the largest deviations, it selects the largest projection ERRORS. This block
    // measures that scatter, and grades the model's own claimed probability against what actually
    // happened, bucketed by deviation size. No behavior changes; this only reports.
    const SIG = (x) => 1 / (1 + Math.exp(-x));
    const LIVE_DIVISOR = 4.0;            // must mirror TOTAL_SD in edgesModel.js line ~1649
    const devs = [];                      // signed projected - line
    const picks = [];                     // { absDev, won }
    for (const r of usable) {
      const proj = Number(r.projected), act = Number(r.actual_value), line = Number(r.line);
      const dev = proj - line;
      devs.push(dev);
      const pickedOver = dev > 0;
      const actualOver = act > line;
      picks.push({ absDev: Math.abs(dev), won: pickedOver === actualOver });
    }
    const meanDev = devs.reduce((a, b) => a + b, 0) / n;
    const varDev = n > 1 ? devs.reduce((a, b) => a + (b - meanDev) * (b - meanDev), 0) / (n - 1) : 0;
    const sdDev = Math.sqrt(varDev);
    const absMeanDev = devs.reduce((a, b) => a + Math.abs(b), 0) / n;
    const sorted = devs.slice().sort((a, b) => a - b);
    const pct = (p) => {
      if (!sorted.length) return null;
      const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
      return Math.round(sorted[i] * 100) / 100;
    };
    const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
    const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

    // Deviation buckets: does the model win where it barely disagrees with the market, and lose where it
    // disagrees loudly? That is the totals-level test of the tier inversion (HANDOFF-39 section 2G).
    const EDGES = [0, 0.5, 1, 2, 3, Infinity];
    const LABELS = ["0-0.5", "0.5-1", "1-2", "2-3", "3+"];
    const buckets = LABELS.map(() => ({ n: 0, wins: 0, claimSum: 0, devSum: 0 }));
    for (const p of picks) {
      let bi = EDGES.length - 2;
      for (let i = 0; i < EDGES.length - 1; i++) {
        if (p.absDev >= EDGES[i] && p.absDev < EDGES[i + 1]) { bi = i; break; }
      }
      const b = buckets[bi];
      b.n++; if (p.won) b.wins++;
      b.claimSum += SIG(p.absDev / LIVE_DIVISOR);
      b.devSum += p.absDev;
    }
    const byDeviation = {};
    LABELS.forEach((lab, i) => {
      const b = buckets[i];
      if (!b.n) { byDeviation[lab] = { n: 0 }; return; }
      const claimed = (b.claimSum / b.n) * 100;
      const actual = (b.wins / b.n) * 100;
      byDeviation[lab] = {
        n: b.n, meanAbsDev: r2(b.devSum / b.n),
        rawClaimedPct: r1(claimed), actualPct: r1(actual), gapPts: r1(claimed - actual),
      };
    });

    // Empirical scale. The live code prices totals as sigmoid(dev / 4.0) and its comment calls 4.0 "the
    // standard deviation" -- but a LOGISTIC with scale s has SD = s*pi/sqrt(3), so scale 4.0 is really a
    // ~7.26-run SD, not 4.0. Rather than argue from theory, fit the divisor that minimises Brier score
    // against real settled outcomes. Larger fitted divisor = the model's disagreement with the market
    // carries LESS information than it currently claims. Gated on sample size -- a fit on 15 rows is noise.
    const MIN_FIT_N = 100;
    let empirical = { fitted: null, note: `needs n >= ${MIN_FIT_N} to fit; currently ${n}` };
    if (n >= MIN_FIT_N) {
      let bestD = null, bestBrier = Infinity;
      for (let d = 1.0; d <= 30.0; d += 0.05) {
        let s = 0;
        for (const p of picks) { const q = SIG(p.absDev / d); s += (q - (p.won ? 1 : 0)) ** 2; }
        const brier = s / n;
        if (brier < bestBrier) { bestBrier = brier; bestD = d; }
      }
      let liveBrier = 0;
      for (const p of picks) { const q = SIG(p.absDev / LIVE_DIVISOR); liveBrier += (q - (p.won ? 1 : 0)) ** 2; }
      liveBrier /= n;
      empirical = {
        fitted: Math.round(bestD * 100) / 100,
        liveDivisor: LIVE_DIVISOR,
        brierFitted: Math.round(bestBrier * 10000) / 10000,
        brierLive: Math.round(liveBrier * 10000) / 10000,
        brierCoinFlip: 0.25,
        note: "fitted > live => the model over-claims on totals and its projection-vs-line gap should be shrunk toward the market. fitted < live => it under-claims. If brierLive and brierFitted both sit at or above 0.25, the projection carries no usable information over a coin flip and NO divisor fixes that -- the projection itself is the problem.",
      };
    }

    // Shrink dial: the interpretable form of the same fit. k = how much of our disagreement with the
    // market we keep. k=1 is today's behavior. Reports what we WOULD have claimed vs what actually
    // happened. It cannot change which side we pick (shrinking never flips the sign), only how loudly
    // we claim it -- which is exactly what sets the confidence band and the conviction tier.
    const shrinkDial = {};
    for (const k of [1.0, 0.75, 0.5, 0.35, 0.25]) {
      let cs = 0, w = 0;
      for (const p of picks) { cs += SIG((k * p.absDev) / LIVE_DIVISOR); if (p.won) w++; }
      const claimed = (cs / n) * 100, actual = (w / n) * 100;
      shrinkDial["k_" + k] = { meanClaimedPct: r1(claimed), actualPct: r1(actual), gapPts: r1(claimed - actual) };
    }

    // WZ-CONF-SOURCE-2026-07-19 :: where does the published confidence actually COME FROM?
    // The board shows a blended probability: blended = W_MODEL*rawModel + (1-W_MODEL)*fairMarket.
    // Two sources are mixed and published as one number, and nobody has ever measured the mix. If the
    // confident band (>= 0.55) is mostly the MARKET term, we are reading the book's own lean back to the
    // subscriber as our edge -- which would explain an over-claim the projection is too small to produce.
    //
    // No new data is needed. In edgesModel.js `blendedEdge` returns (blended - fair) and `overProb` IS
    // that same `blended`, so the stored columns satisfy an exact identity:
    //        fairMarket = model_prob - edge
    // And independently, since rawModel = sigmoid((projected - line)/TOTAL_SD):
    //        fairMarket = (model_prob - W_MODEL*rawModel) / (1 - W_MODEL)
    // Two independent recoveries of the same quantity. They MUST agree. `crossCheck` below measures the
    // disagreement -- if it is not ~0, this decomposition's model of the pipeline is wrong and every
    // number in this block should be discarded rather than believed.
    const W_MODEL_MIRROR = 0.55;   // must mirror W_MODEL in edgesModel.js (~line 1225)
    const CONF_BAND = 0.55;        // must mirror calibrationGuard confidentBand
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const sd = (a) => {
      if (a.length < 2) return 0;
      const m = mean(a);
      return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1));
    };
    const pctOf = (arr, p) => {
      if (!arr.length) return null;
      const s2 = arr.slice().sort((x, y) => x - y);
      const i = Math.min(s2.length - 1, Math.max(0, Math.round(p * (s2.length - 1))));
      return Math.round(s2[i] * 1000) / 1000;
    };
    const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

    function decompose(recs) {
      // recs: { claimed, fair, raw|null, won }
      if (!recs.length) return { n: 0 };
      const claimed = recs.map(r => r.claimed);
      const fair = recs.map(r => r.fair);
      const excess = [], modelShare = [];
      for (const r of recs) {
        const tot = r.claimed - 0.5;
        if (Math.abs(tot) < 0.01) continue;                 // no meaningful confidence to attribute
        const mTerm = r.raw != null ? W_MODEL_MIRROR * (r.raw - 0.5) : null;
        const kTerm = (1 - W_MODEL_MIRROR) * (r.fair - 0.5);
        excess.push(tot);
        // share of stated confidence-above-a-coinflip contributed by OUR model
        if (mTerm != null) modelShare.push(mTerm / tot);
        else modelShare.push(1 - kTerm / tot);
      }
      const wins = recs.filter(r => r.won).length;
      return {
        n: recs.length,
        meanClaimedPct: r1(mean(claimed) * 100),
        meanFairMarketPct: r1(mean(fair) * 100),
        fairMarket: { mean: r3(mean(fair)), sd: r3(sd(fair)), p10: pctOf(fair, 0.10), p50: pctOf(fair, 0.50), p90: pctOf(fair, 0.90) },
        modelSharePct: modelShare.length ? r1(mean(modelShare) * 100) : null,
        marketSharePct: modelShare.length ? r1((1 - mean(modelShare)) * 100) : null,
        lopsidedMarketRows: recs.filter(r => r.fair >= 0.54).length,
        actualWinPct: recs.length ? r1((wins / recs.length) * 100) : null,
        gapPts: recs.length ? r1(mean(claimed) * 100 - (wins / recs.length) * 100) : null,
      };
    }

    // ---- A. total_shadow rows (this endpoint's population; carries `projected`, so BOTH recoveries work)
    const shadowRecs = [], xcheck = [];
    let blendInactive = 0;
    for (const r of usable) {
      const mp = r.model_prob == null ? null : Number(r.model_prob);
      const ed = r.edge == null ? null : Number(r.edge);
      if (mp == null || ed == null) continue;
      const raw = SIG((Number(r.projected) - Number(r.line)) / LIVE_DIVISOR);
      const fairFromEdge = mp - ed;                                       // exact identity
      const fairFromProb = (mp - W_MODEL_MIRROR * raw) / (1 - W_MODEL_MIRROR);
      // When no clean two-way market exists the code falls back to the RAW prob (no blend). Those rows
      // cannot be decomposed and must not be averaged in as if they could.
      if (Math.abs(mp - raw) < 0.0015) { blendInactive++; continue; }
      xcheck.push(Math.abs(fairFromEdge - fairFromProb));
      shadowRecs.push({
        claimed: mp, fair: fairFromEdge, raw,
        won: (Number(r.actual_value) > Number(r.line)),                   // shadow always books the OVER
      });
    }
    const confidentShadow = shadowRecs.filter(r => r.claimed >= CONF_BAND);

    // ---- B. core `total` rows -- the population the guard's 58.8% actually reports on.
    // No `projected` needed here: fair = model_prob - edge is exact on its own.
    let coreOut = { n: 0, note: "no graded core total rows with both model_prob and edge" };
    try {
      const coreRows = [];
      let cfrom = 0;
      for (let i = 0; i < 40; i++) {
        let cq = supabase.from("model_predictions")
          .select("model_prob, edge, selection, result, game_date")
          .eq("league", "mlb").eq("market", "total")
          .in("result", ["win", "loss"])
          .order("game_date", { ascending: true }).range(cfrom, cfrom + PAGE - 1);
        if (since) cq = cq.gte("game_date", since);
        const { data, error } = await cq;
        if (error) throw error;
        if (!data || !data.length) break;
        coreRows.push(...data);
        if (data.length < PAGE) break;
        cfrom += PAGE;
      }
      const cUsable = coreRows
        .filter(r => r.model_prob != null && r.edge != null)
        .map(r => ({ claimed: Number(r.model_prob), fair: Number(r.model_prob) - Number(r.edge), raw: null, won: r.result === "win" }));
      const cConf = cUsable.filter(r => r.claimed >= CONF_BAND);
      coreOut = {
        allGraded: decompose(cUsable),
        confidentBand: decompose(cConf),
        note: `Core \`total\` rows -- the same population the guard reports as claimed/actual. fairMarket recovered exactly as model_prob - edge. marketSharePct is the fraction of stated confidence-above-50% that came from the BOOK's de-vigged price rather than from our projection. If that is large in confidentBand, the confident band is selecting lopsided two-way markets and publishing the market's lean as our edge.`,
      };
    } catch (e) {
      coreOut = { n: 0, error: e.message };
    }

    const confidenceSource = {
      token: "WZ-CONF-SOURCE-2026-07-19",
      wModelMirror: W_MODEL_MIRROR,
      confidentBand: CONF_BAND,
      crossCheck: {
        rowsChecked: xcheck.length,
        meanAbsDiff: xcheck.length ? Math.round(mean(xcheck) * 100000) / 100000 : null,
        maxAbsDiff: xcheck.length ? Math.round(Math.max(...xcheck) * 100000) / 100000 : null,
        note: "Two independent recoveries of fairMarket. Rounding alone should keep this under ~0.003. If it is larger, this block's model of the pricing pipeline is WRONG -- discard the numbers below, do not act on them.",
      },
      blendInactiveRows: blendInactive,
      shadowAllGraded: decompose(shadowRecs),
      shadowConfidentBand: decompose(confidentShadow),
      core: coreOut,
      reading: "modelSharePct + marketSharePct = 100. modelSharePct is how much of the published confidence we EARNED; marketSharePct is how much we borrowed from the book's price. A high marketSharePct in the confident band means the band is selecting games where the two-way total is lopsided -- that is the market saying the true number sits between two half-run increments, not an edge we found. Publishing it as our confidence is what an over-claim with a small projection deviation looks like.",
    };

    res.json({
      token: "WZ-TOTALSBIAS-2026-07-17",
      dispersionToken: "WZ-TOTALS-DISPERSION-2026-07-19",
      n,
      meanProjMinusActual: meanBias,
      recommendedTotalMeanAdj: Math.round((-meanBias) * 100) / 100,
      modelOverRate: Math.round((projOverLine / n) * 1000) / 10,
      actualOverRate: Math.round((wentOver / n) * 1000) / 10,
      dial: dialOut,
      projMinusLine: {
        n,
        mean: r2(meanDev),
        sd: r2(sdDev),
        meanAbs: r2(absMeanDev),
        p10: pct(0.10), p25: pct(0.25), p50: pct(0.50), p75: pct(0.75), p90: pct(0.90),
        min: r2(sorted[0]), max: r2(sorted[sorted.length - 1]),
        note: "How far the bottom-up projection lands from the market total, in runs. `mean` is the lean; `sd` and `meanAbs` are the SCATTER. The market total is the sharpest number in the sport, so a large sd here is projection noise, not edge -- and the confident band selects the biggest deviations, i.e. the biggest errors.",
      },
      byDeviation,
      empiricalScale: empirical,
      shrinkDial,
      confidenceSource,
      reading: "meanProjMinusActual > 0 => model projects HIGH (over-lean); recommendedTotalMeanAdj is the runs to add (negative = subtract) to center projections on reality. Dial: pick the adj where overWinPct and underWinPct are both above ~52.4% (break-even at -110) and spreadPts is near 0 (no lean). WZ-TOTALS-DISPERSION-2026-07-19: `dial` and recommendedTotalMeanAdj only move the MEAN. If modelOverRate is far from 50% while meanProjMinusActual is near 0, the mean is not the problem and no TOTAL_MEAN_ADJ will fix it -- read projMinusLine.sd and byDeviation instead.",
    });
  } catch (err) {
    console.error("[totalsbias] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WZ-SELECT-BACKTEST-2026-07-20 :: READ-ONLY. Does the confident band pick the right GAMES?
// /totalsbias measured how loudly we claim. This measures WHICH ROWS we claim on -- a different
// defect with a different fix. The board's published totals prob is a blend:
//        claimed = W_MODEL*raw + (1-W_MODEL)*fairMarket
// and the confident band selects on `claimed`. So ~45% of the selection variable is the BOOK's
// de-vigged price. When the two-way total is lopsided (fair >= 0.54, i.e. the true number sits
// between two half-run increments) that market term alone can lift a row into the band with no
// contribution from our projection -- and symmetrically, when we strongly DISAGREE with a lopsided
// book, that same term drags a large real edge back down below the cut and we never publish it.
//
// This endpoint does NOT assume the alternative is better. HANDOFF PRIOR (moneyline selector):
// "never cut on edge" -- cutting on edge selects for maximum MODEL ERROR when the model is
// miscalibrated, which is a real and well-documented failure mode. That prior is not ignored here,
// it is TESTED. Four candidate selectors are replayed over the same graded history at the same
// selection size, and the actual returned win% is read off real settled rows. Nothing ships unless
// it beats the incumbent on this population.
//
// Recoveries (exact, no new data): fair = claimed - edge   (blendedEdge returns claimed - fair)
//                                  raw  = (claimed - (1-W_MODEL)*fair) / W_MODEL
// GET /api/performance/selectbacktest [?since=YYYY-MM-DD][&league=mlb][&market=total]
router.get("/selectbacktest", async (req, res) => {
  try {
    const supabase = db();
    const since = req.query.since || null;
    const league = req.query.league || "mlb";
    const market = req.query.market || "total";
    const W = 0.55;              // must mirror W_MODEL in edgesModel.js
    const BAND = 0.55;           // must mirror calibrationGuard confidentBand
    const LOPSIDED = 0.54;       // must mirror lopsidedMarketRows in /totalsbias
    const BREAK_EVEN = 52.4;     // -110
    const PAGE = 1000;

    const rows = [];
    let from = 0;
    for (let i = 0; i < 40; i++) {
      let q = supabase.from("model_predictions")
        .select("game_id, model_prob, edge, selection, result, game_date")
        .eq("league", league).eq("market", market)
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (since) q = q.gte("game_date", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    let rawOutOfRange = 0;
    const pop = [];
    for (const r of rows) {
      if (r.model_prob == null || r.edge == null) continue;
      const claimed = Number(r.model_prob);
      const edge = Number(r.edge);
      if (!Number.isFinite(claimed) || !Number.isFinite(edge)) continue;
      const fair = claimed - edge;
      const raw = (claimed - (1 - W) * fair) / W;
      if (!(raw > -0.01 && raw < 1.01)) rawOutOfRange++;
      pop.push({
        claimed, edge, fair, raw,
        won: r.result === "win",
        lopsided: fair >= LOPSIDED,
        // WZ-SELECT-KEYFIX-2026-07-20 :: was `${game_date}|${selection}` -- totals selections are only
        // "over"/"under", so every row on a given date collided and overlapWithCurrentPct reported ~100%
        // between selections with different W-L records (impossible). game_id is the real unit.
        key: `${r.game_id}|${r.selection}|${r.game_date}`,
      });
    }

    const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

    // A selection is judged ONLY on what it actually returned on settled rows.
    function score(sel, label, note) {
      const n = sel.length;
      if (!n) return { label, n: 0, note: note || "empty selection" };
      const wins = sel.filter(r => r.won).length;
      const winPct = (wins / n) * 100;
      // flat-stake return at -110: a win pays 0.909u, a loss costs 1u
      const roi = ((wins * (100 / 110) - (n - wins)) / n) * 100;
      return {
        label,
        n,
        wins,
        losses: n - wins,
        meanClaimedPct: r1(mean(sel.map(r => r.claimed)) * 100),
        actualWinPct: r1(winPct),
        gapPts: r1(mean(sel.map(r => r.claimed)) * 100 - winPct),
        vsBreakEvenPts: r1(winPct - BREAK_EVEN),
        roiPctFlatAt110: r1(roi),
        lopsidedRows: sel.filter(r => r.lopsided).length,
        meanFairMarketPct: r1(mean(sel.map(r => r.fair)) * 100),
        note: note || undefined,
      };
    }

    const current = pop.filter(r => r.claimed >= BAND);
    const N = current.length;
    const topBy = (arr, f, k) => arr.slice().sort((a, b) => f(b) - f(a)).slice(0, k);

    const byEdge = topBy(pop, r => r.edge, N);
    const byRaw = topBy(pop, r => r.raw, N);
    const exLopsided = current.filter(r => !r.lopsided);

    const curKeys = new Set(current.map(r => r.key));
    const overlap = (sel) => (sel.length ? Math.round((sel.filter(r => curKeys.has(r.key)).length / sel.length) * 1000) / 10 : null);

    const rules = {
      current_claimedBand: {
        ...score(current, `claimed >= ${BAND} (INCUMBENT -- what ships today)`),
        overlapWithCurrentPct: 100,
      },
      candidate_topNByEdge: {
        ...score(byEdge, `top ${N} by edge (model minus book)`, "The handoff prior says never cut on edge. This row is the test of that prior, not a recommendation."),
        overlapWithCurrentPct: overlap(byEdge),
      },
      candidate_topNByRawModel: {
        ...score(byRaw, `top ${N} by raw model prob (market stripped out)`, "Selection on our projection alone, with the book's price removed from the sort key."),
        overlapWithCurrentPct: overlap(byRaw),
      },
      candidate_currentMinusLopsided: {
        ...score(exLopsided, `claimed >= ${BAND} AND fair < ${LOPSIDED}`, "Incumbent with lopsided-book rows dropped. Subtractive -- smaller board, no new picks."),
        overlapWithCurrentPct: 100,
      },
    };

    // Shape of the edge selector at several sizes, so a single N is not mistaken for a result.
    const sweepSizes = [25, 50, 100, 150, 200, N, 300, 400].filter((v, i, a) => v > 0 && v <= pop.length && a.indexOf(v) === i).sort((a, b) => a - b);
    const edgeSweep = sweepSizes.map(k => {
      const s = score(topBy(pop, r => r.edge, k), `top ${k} by edge`);
      return { topN: k, n: s.n, actualWinPct: s.actualWinPct, vsBreakEvenPts: s.vsBreakEvenPts, roiPctFlatAt110: s.roiPctFlatAt110, lopsidedRows: s.lopsidedRows };
    });

    res.json({
      token: "WZ-SELECT-BACKTEST-2026-07-20",
      league,
      market,
      since: since || "all",
      population: {
        gradedRowsPulled: rows.length,
        usable: pop.length,
        lopsidedRowsInPopulation: pop.filter(r => r.lopsided).length,
        rawOutOfRange,
        wModelMirror: W,
        confidentBand: BAND,
        lopsidedThreshold: LOPSIDED,
        breakEvenPct: BREAK_EVEN,
      },
      selectionSize: N,
      rules,
      edgeSweep,
      reading: "Compare actualWinPct and roiPctFlatAt110 across `rules` at the SAME selectionSize -- that is the only apples-to-apples comparison, because a smaller board always looks better on win%. A candidate ships ONLY if it beats current_claimedBand on actual return at equal n AND holds up across edgeSweep rather than at one lucky size. If rawOutOfRange is not 0, the blend identity does not hold on some rows and every number here is suspect. gapPts is over-claim (claimed minus delivered); vsBreakEvenPts under 0 means the selection lost money at -110 regardless of how good the win% looks.",
    });
  } catch (err) {
    console.error("[selectbacktest] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WZ-OOS-SPLIT-2026-07-20 :: READ-ONLY. Does a rule survive games it was never shown?
//
// /selectbacktest chose the top-50-by-edge cutoff by looking at all 768 graded rows, then judged that
// cutoff on the same 768 rows. That is marking your own exam with the answer key open: with 8 sizes
// tried and the best one reported, a 68% "result" is a description of games already read, not evidence.
// This endpoint fixes the method: form the rule on EARLY rows only, freeze it, then score it on LATE
// rows that were never inspected while choosing it. Split is by DATE, never shuffled -- the real
// question is whether a rule built on the past survives the future, and shuffling leaks the future back.
//
// The rule is frozen as a FRACTION of the population, not an absolute N. Halves differ in size, so a
// fraction is the only thing that transfers honestly between them.
//
// REGIME WARNING, and it is the first thing to read: the market blend (WZ-TOT-WINBLEND-2026-07-12)
// went live 2026-07-12. Rows graded BEFORE that date had their published prob set by the RAW sigmoid;
// rows after had it set by 0.55*raw + 0.45*fairMarket. Those are two different pricing systems. Any
// number pooled across the boundary is an average of two regimes. `regimeSplit` below reports the
// count and the incumbent's real return on each side separately, so the pooled figures can be checked
// rather than trusted. If nearly all rows are pre-blend, then /selectbacktest measured a selection
// mechanism that barely existed in that data -- and its verdict is weaker than it was stated to be.
//
// GET /api/performance/oossplit [?league=mlb][&market=total][&cutoff=YYYY-MM-DD][&blend=YYYY-MM-DD]
router.get("/oossplit", async (req, res) => {
  try {
    const supabase = db();
    const league = req.query.league || "mlb";
    const market = req.query.market || "total";
    const BLEND_DATE = req.query.blend || "2026-07-12";  // WZ-TOT-WINBLEND-2026-07-12 went live
    const W = 0.55;
    const BAND = 0.55;
    const BREAK_EVEN = 52.4;   // -110
    const MIN_N = 40;          // mirrors the guard's minimum readable sample
    const PAGE = 1000;

    const rows = [];
    let from = 0;
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.from("model_predictions")
        .select("game_id, model_prob, edge, selection, result, game_date")
        .eq("league", league).eq("market", market)
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const outOfRangeRows = [];
    const pop = [];
    for (const r of rows) {
      if (r.model_prob == null || r.edge == null || !r.game_date) continue;
      const claimed = Number(r.model_prob);
      const edge = Number(r.edge);
      if (!Number.isFinite(claimed) || !Number.isFinite(edge)) continue;
      const fair = claimed - edge;
      const raw = (claimed - (1 - W) * fair) / W;
      const rec = { date: String(r.game_date).slice(0, 10), claimed, edge, fair, raw, won: r.result === "win" };
      // Promised in the last handoff: identify the rawOutOfRange rows rather than step around them.
      if (!(raw > -0.01 && raw < 1.01)) {
        outOfRangeRows.push({ date: rec.date, game_id: String(r.game_id), selection: r.selection,
          model_prob: Math.round(claimed * 1000) / 1000, edge: Math.round(edge * 1000) / 1000,
          impliedFair: Math.round(fair * 1000) / 1000, recoveredRaw: Math.round(raw * 1000) / 1000 });
      }
      pop.push(rec);
    }
    pop.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
    function score(sel) {
      const n = sel.length;
      if (!n) return { n: 0 };
      const wins = sel.filter(r => r.won).length;
      const winPct = (wins / n) * 100;
      const roi = ((wins * (100 / 110) - (n - wins)) / n) * 100;
      return {
        n, wins, losses: n - wins,
        actualWinPct: r1(winPct),
        vsBreakEvenPts: r1(winPct - BREAK_EVEN),
        roiPctFlatAt110: r1(roi),
        readable: n >= MIN_N,
      };
    }
    const topFrac = (arr, frac) => {
      const k = Math.max(1, Math.round(frac * arr.length));
      return arr.slice().sort((a, b) => b.edge - a.edge).slice(0, k);
    };
    const band = (arr) => arr.filter(r => r.claimed >= BAND);

    // ---- 1. REGIME. Read this before anything else.
    const pre = pop.filter(r => r.date < BLEND_DATE);
    const post = pop.filter(r => r.date >= BLEND_DATE);
    const regimeSplit = {
      blendLiveDate: BLEND_DATE,
      dateRange: pop.length ? { first: pop[0].date, last: pop[pop.length - 1].date } : null,
      preBlend: { rowsInPopulation: pre.length, incumbentBand: score(band(pre)) },
      postBlend: { rowsInPopulation: post.length, incumbentBand: score(band(post)) },
      pctOfHistoryPreBlend: pop.length ? r1((pre.length / pop.length) * 100) : null,
      note: "If pctOfHistoryPreBlend is high, the pooled /selectbacktest numbers -- INCLUDING the incumbent's +3.5% -- are mostly a measurement of the pre-blend pricing system, not the one running today. Neither the edge thesis nor its refutation is as settled as it was stated.",
    };

    // ---- 2. OUT-OF-SAMPLE SPLIT. Form on early, freeze, score on late.
    const cutIdx = req.query.cutoff
      ? pop.findIndex(r => r.date >= req.query.cutoff)
      : Math.floor(pop.length / 2);
    const splitIdx = cutIdx < 0 ? Math.floor(pop.length / 2) : cutIdx;
    const inSample = pop.slice(0, splitIdx);
    const outSample = pop.slice(splitIdx);

    const FRACS = [0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.35, 0.50];
    const inSweep = FRACS.map(f => ({ frac: f, ...score(topFrac(inSample, f)) }));
    // Chosen on IN-SAMPLE ONLY. Best-of-9 in-sample is itself a multiple-comparison problem -- that is
    // exactly why the out-of-sample column below, not this one, is the verdict.
    const readableIn = inSweep.filter(s => s.n >= MIN_N);
    const chosen = (readableIn.length ? readableIn : inSweep)
      .slice().sort((a, b) => (b.roiPctFlatAt110 ?? -999) - (a.roiPctFlatAt110 ?? -999))[0] || null;

    const frozenFrac = chosen ? chosen.frac : null;
    const oosEdge = frozenFrac == null ? { n: 0 } : score(topFrac(outSample, frozenFrac));
    const oosIncumbent = score(band(outSample));
    const inIncumbent = score(band(inSample));

    const delta = (oosEdge.roiPctFlatAt110 != null && oosIncumbent.roiPctFlatAt110 != null)
      ? r1(oosEdge.roiPctFlatAt110 - oosIncumbent.roiPctFlatAt110) : null;

    let verdict;
    if (!pop.length) verdict = "NO DATA.";
    else if (!oosEdge.readable || !oosIncumbent.readable)
      verdict = `INCONCLUSIVE -- out-of-sample n is under ${MIN_N} (edge rule n=${oosEdge.n}, incumbent n=${oosIncumbent.n}). This is the expected outcome on a history this short. It is NOT evidence the rule works and NOT evidence it fails. Do not ship on this.`;
    else if (delta != null && delta > 0)
      verdict = `SURVIVED out-of-sample by ${delta} ROI points. This earns the right to be shadow-recorded FORWARD on unplayed games. It is not clearance to publish.`;
    else
      verdict = `FAILED out-of-sample (${delta} ROI points vs incumbent). Drop the edge selector. The in-sample result was pattern-fitting.`;

    res.json({
      token: "WZ-OOS-SPLIT-2026-07-20",
      league, market,
      population: { gradedRowsPulled: rows.length, usable: pop.length, minReadableN: MIN_N, breakEvenPct: BREAK_EVEN },
      regimeSplit,
      split: {
        cutoffDate: outSample.length ? outSample[0].date : null,
        inSampleRows: inSample.length,
        outOfSampleRows: outSample.length,
      },
      inSample: { edgeSweep: inSweep, incumbentBand: inIncumbent, chosenFrac: frozenFrac,
        note: "Formed by looking at these rows only. Best-of-9 here proves nothing on its own." },
      outOfSample: { frozenFrac, edgeRule: oosEdge, incumbentBand: oosIncumbent, deltaRoiPts: delta,
        note: "Never inspected while the fraction was chosen. THIS is the test." },
      verdict,
      rawOutOfRange: { count: outOfRangeRows.length, rows: outOfRangeRows.slice(0, 20),
        note: "Rows where claimed/edge cannot be decomposed into the 55/45 blend -- expected on games with no clean two-way price. Listed rather than stepped around." },
      reading: "Read regimeSplit FIRST. Then read `verdict` -- and if it says INCONCLUSIVE, that is the honest answer and nothing ships. A rule that beats the incumbent out-of-sample has earned forward shadow-recording only; it has not earned a customer.",
    });
  } catch (err) {
    console.error("[oossplit] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WZ-FBALL-CALIB-2026-07-17 :: football (NFL/CFB) shadow-calibration + bias meter. Mirrors the MLB
// /calibprobe shadowFullSlate and totalsbias, reading the full-slate *_shadow rows the football
// recorder writes (moneyline_shadow / spread_shadow / total_shadow, per league). Read-only — these
// rows never touch the published record. Uses WIDE POOLED probability bands (playbook: don't slice
// thin on a weekly sport, so a read is meaningful in 2-3 weeks not half a season). Bias section is
// the football analogue of totalsbias: mean(projected - actual) for margin (spread) and total.
// ?league=nfl|cfb (default nfl). Registered BEFORE "/:league" so Express doesn't read "fbcalib" as a league.
router.get("/fbcalib", async (req, res) => {
  try {
    const league = String(req.query.league || "nfl").toLowerCase() === "cfb" ? "cfb" : "nfl";
    const supabase = db();
    const PAGE = 1000;
    const MARKETS = ["moneyline_shadow", "spread_shadow", "total_shadow"];
    const settled = (r) => r.result === "win" || r.result === "loss"; // pushes excluded from win-rate
    const pct1 = (x) => Math.round(x * 1000) / 10;
    const BANDS = [{ key: "<45%", lo: 0, hi: 0.45 }, { key: "45-55%", lo: 0.45, hi: 0.55 }, { key: ">55%", lo: 0.55, hi: 1.01 }];
    const bandKey = (p) => { for (const b of BANDS) if (p >= b.lo && p < b.hi) return b.key; return null; };

    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, model_prob, result, game_date, projected_margin, projected, actual_value")
        .eq("league", league)
        .in("market", MARKETS)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const markets = {};
    for (const m of MARKETS) markets[m] = { pending: 0, settled: 0, pushes: 0, firstDate: null, lastDate: null, bands: {} };
    let sDiffSum = 0, sN = 0, tDiffSum = 0, tN = 0; // bias accumulators
    for (const r of rows) {
      const s = markets[r.market];
      if (!s) continue;
      if (r.game_date) {
        if (!s.firstDate || r.game_date < s.firstDate) s.firstDate = r.game_date;
        if (!s.lastDate || r.game_date > s.lastDate) s.lastDate = r.game_date;
      }
      if (r.result === "push") { s.pushes++; continue; }
      if (!settled(r)) { s.pending++; continue; }
      s.settled++;
      if (r.model_prob != null) {
        const k = bandKey(Number(r.model_prob));
        if (k) { const b = (s.bands[k] ||= { n: 0, wins: 0, probSum: 0 }); b.n++; if (r.result === "win") b.wins++; b.probSum += Number(r.model_prob); }
      }
      // bias: spread stores actual home margin in actual_value (vs projected_margin); total stores actual total (vs projected)
      if (r.market === "spread_shadow" && r.projected_margin != null && r.actual_value != null) { sDiffSum += Number(r.projected_margin) - Number(r.actual_value); sN++; }
      if (r.market === "total_shadow" && r.projected != null && r.actual_value != null) { tDiffSum += Number(r.projected) - Number(r.actual_value); tN++; }
    }
    for (const m of MARKETS) for (const k of Object.keys(markets[m].bands)) {
      const b = markets[m].bands[k];
      markets[m].bands[k] = { n: b.n, wins: b.wins, claimedPct: pct1(b.probSum / b.n), actualPct: pct1(b.wins / b.n), gapPts: Math.round(((b.probSum / b.n) - (b.wins / b.n)) * 1000) / 10 };
    }
    const bias = {
      spreadMargin: sN ? { n: sN, meanProjMinusActual: Math.round((sDiffSum / sN) * 100) / 100, note: "mean(projected home margin - actual home margin). Persistent >0 = model over-favors home; subtract it as a margin bias." } : { n: 0, note: "no settled spread shadows yet" },
      total: tN ? { n: tN, meanProjMinusActual: Math.round((tDiffSum / tN) * 100) / 100, note: "mean(projected total - actual total). Once n is meaningful, set the football TOTAL_MEAN_ADJ to the NEGATIVE of this (same recipe as MLB totalsbias)." } : { n: 0, note: "no settled total shadows yet" },
    };
    res.json({ token: "WZ-FBALL-CALIB-2026-07-17", league, generatedAt: new Date().toISOString(), rowsScanned: rows.length, markets, bias });
  } catch (err) {
    res.status(500).json({ token: "WZ-FBALL-CALIB-2026-07-17", error: String(err && err.message || err) });
  }
});

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  const cfg = LEAGUE_CONFIG[league];
  if (!cfg) {
    return res.status(400).json({ error: "Unknown league", league, supported: Object.keys(LEAGUE_CONFIG) });
  }
  try {
    const supabase = db();
    // Fetch ALL graded rows by paging. Supabase caps a single select at 1000 rows;
    // once MLB passed ~1000 graded win/loss rows, an unpaginated query silently
    // returned only the OLDEST 1000 and dropped the NEWEST — hiding recent grades,
    // including every newly added strikeout/hits pick (the most recent rows). Page
    // through in 1000-row chunks ordered by id so nothing is lost.
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds, benched_at_pick")
        .eq("league", league)
        .in("result", ["win", "loss"]) // graded, decisive only (skip pending/push)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    // Props are kept entirely out of the core record and CLV — own table only.
    const coreRows = rows.filter(r => cfg.core.includes(r.market) && afterCoreReset(league, r));
    const propRows = rows.filter(r => cfg.props.includes(r.market) && afterReset(r));

    // Qualified set drives the headline; full set kept for transparency.
    const qualifiedRows = coreRows.filter(r => isQualified(r) && wasShownToSubscribers(r)); // WZ-BENCH-NOT-COUNTED-2026-07-18

    const build = (set) => {
      const buckets = { overall: blank(), byMarket: {}, byConfidence: {} };
      for (const r of set) {
        const won = r.result === "win";
        const profit = won ? unitProfit(r.odds) : -1;
        tally(buckets.overall, won, profit);
        buckets.byMarket[r.market] ||= blank();
        tally(buckets.byMarket[r.market], won, profit);
        const conf = (r.confidence || "NEUTRAL").toUpperCase();
        buckets.byConfidence[conf] ||= blank();
        tally(buckets.byConfidence[conf], won, profit);
      }
      finalize(buckets.overall);
      for (const k of Object.keys(buckets.byMarket)) finalize(buckets.byMarket[k]);
      for (const k of Object.keys(buckets.byConfidence)) finalize(buckets.byConfidence[k]);
      return buckets;
    };

    const qualified = build(qualifiedRows);
    const full = build(coreRows);

    // pending (core markets for THIS league only — matches the headline record)
    const { count: pendingCount } = await supabase
      .from("model_predictions")
      .select("id", { count: "exact", head: true })
      .eq("league", league)
      .eq("result", "pending")
      .in("market", cfg.core);

    // ── CLV summary (core markets with a captured closing line) ───────────────
    // A sport with no captured closing lines simply returns clv = null.
    const { data: clvData } = await supabase
      .from("model_predictions")
      .select("confidence, clv, beat_close, game_date, pinnacle_clv, pinnacle_beat_close")
      .eq("league", league)
      .in("market", cfg.clv)
      .not("clv", "is", null);
    const clvRows = (clvData || []).filter(isQualified);
    let clvSummary = null;
    if (clvRows.length > 0) {
      // Report beat / tied / worse separately. A flat best-of-books price (clv === 0)
      // is a TIE, not a loss — folding ties into "didn't beat" mechanically depresses
      // the beat rate below 50%, so we split them out and report the decisive rate too.
      const beat = clvRows.filter(r => Number(r.clv) > 0).length;
      const worse = clvRows.filter(r => Number(r.clv) < 0).length;
      const tied = clvRows.length - beat - worse;
      const decisive = beat + worse;
      const avgClv = clvRows.reduce((s, r) => s + (Number(r.clv) || 0), 0) / clvRows.length;
      clvSummary = {
        sample: clvRows.length,
        beat, tied, worse,
        beatClose: beat,
        beatClosePct: Math.round((beat / clvRows.length) * 1000) / 10,
        beatDecisivePct: decisive ? Math.round((beat / decisive) * 1000) / 10 : null,
        avgClvPct: Math.round(avgClv * 10000) / 100,
      };

      // SHARP CLV vs Pinnacle — the benchmark that actually validates edge (de-vigged
      // close from the lowest-vig book vs the price we took). Null until enough picks
      // have been captured in the final-30-min window post-deploy.
      const pinRows = clvRows.filter(r => r.pinnacle_clv != null);
      if (pinRows.length > 0) {
        const pBeat = pinRows.filter(r => Number(r.pinnacle_clv) > 0).length;
        const pWorse = pinRows.filter(r => Number(r.pinnacle_clv) < 0).length;
        const pTied = pinRows.length - pBeat - pWorse;
        const pDecisive = pBeat + pWorse;
        const pAvg = pinRows.reduce((s, r) => s + (Number(r.pinnacle_clv) || 0), 0) / pinRows.length;
        clvSummary.pinnacle = {
          sample: pinRows.length,
          beat: pBeat, tied: pTied, worse: pWorse,
          beatClosePct: Math.round((pBeat / pinRows.length) * 1000) / 10,
          beatDecisivePct: pDecisive ? Math.round((pBeat / pDecisive) * 1000) / 10 : null,
          avgClvPct: Math.round(pAvg * 10000) / 100,
        };
      }
    }

    // ── Range windows — headline KPIs + cumulative units curve + CLV per window ─
    // BY CONVICTION (byConfidence) and BY MARKET (byMarket) stay season-level
    // above. The headline KPIs, the units-over-time curve, and the CLV grid are
    // range-aware here: 7D / 30D / Season / All, each computed from the qualified
    // rows + qualified CLV rows inside that date window. The series is cumulative
    // 1-unit-flat P/L in chronological order — the real proof curve, not synthetic.
    const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const SEASON_START = { mlb: "2026-03-01", nba: "2025-10-01", nfl: "2025-09-01", cfb: "2025-08-01" }[league] || "2000-01-01";
    const WINDOWS = [["7D", daysAgoIso(7)], ["30D", daysAgoIso(30)], ["Season", SEASON_START], ["All", "0000-00-00"]];
    const inWindow = (gd, cut) => cut === "0000-00-00" || (gd && gd >= cut);
    const rangeStats = (cut) => {
      const set = qualifiedRows.filter(r => inWindow(r.game_date, cut));
      const sorted = [...set].sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      // WZ-WINRATE-CURVE-2026-07-06 :: build a range-aware cumulative WIN RATE curve alongside the
      // units curve, so the Performance win-rate chart redraws per window (7D/30D/Season/All) just
      // like the units chart already does. winSeries[k] = win% after the first k+1 graded picks in
      // this window. Additive: new field only; nothing existing changes.
      let cum = 0, wins = 0, losses = 0; const series = [0]; const winSeries = [];
      for (const r of sorted) { const won = r.result === "win"; const p = won ? unitProfit(r.odds) : -1; cum += p; if (won) wins++; else losses++; series.push(Math.round(cum * 100) / 100); winSeries.push(Math.round((wins / (wins + losses)) * 1000) / 10); }
      const total = wins + losses;
      const cwin = clvRows.filter(r => inWindow(r.game_date, cut));
      const beat = cwin.filter(r => r.beat_close === true).length;
      const avgClv = cwin.length ? cwin.reduce((s, r) => s + (Number(r.clv) || 0), 0) / cwin.length : null;
      return {
        roi: total ? Math.round((cum / total) * 1000) / 10 : 0,
        units: Math.round(cum * 100) / 100,
        w: wins, l: losses, p: 0,
        clv: avgClv == null ? 0 : Math.round(avgClv * 10000) / 100,
        bc: cwin.length ? Math.round((beat / cwin.length) * 1000) / 10 : 0,
        n: total,
        series: series.length > 1 ? series : [0, 0],
        winSeries,
      };
    };
    const ranges = {};
    for (const [name, cut] of WINDOWS) ranges[name] = rangeStats(cut);

    // ── Home stat-card sparklines — compact cumulative curves ─────────────────
    // ROI% and win% accrue over the qualified set; CLV% over the captured-close
    // set, all within the season window. A short warmup is skipped so the first
    // 1–2 picks (±100% noise) don't dominate the axis. Real cumulative paths,
    // downsampled to ≤24 points; short/absent curves return [] (card shows none).
    const downsample = (arr, k = 24) => {
      if (!arr || arr.length <= k) return arr || [];
      const out = [], step = (arr.length - 1) / (k - 1);
      for (let i = 0; i < k; i++) out.push(arr[Math.round(i * step)]);
      return out;
    };
    const roiCurve = [], winCurve = [], clvCurve = [];
    {
      const set = qualifiedRows
        .filter(r => inWindow(r.game_date, SEASON_START))
        .sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      let sc = 0, sw = 0, sl = 0; const WARM = 10;
      for (const r of set) {
        const won = r.result === "win"; sc += won ? unitProfit(r.odds) : -1; if (won) sw++; else sl++;
        const tot = sw + sl;
        if (tot >= WARM) { roiCurve.push(Math.round((sc / tot) * 1000) / 10); winCurve.push(Math.round((sw / tot) * 1000) / 10); }
      }
    }
    {
      const set = clvRows
        .filter(r => inWindow(r.game_date, SEASON_START))
        .sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      let cc = 0; const WARM = 5;
      set.forEach((r, i) => { cc += Number(r.clv) || 0; if (i + 1 >= WARM) clvCurve.push(Math.round((cc / (i + 1)) * 10000) / 100); });
    }
    const spark = { roi: downsample(roiCurve), win: downsample(winCurve), clv: downsample(clvCurve) };

    // ── Recent graded picks (core + props), newest first, with a readable label ─
    let recent = [];
    try {
      const sel = "market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds, matchup, selection, line";
      const { data: recRows, error: recErr } = await supabase
        .from("model_predictions")
        .select(sel)
        .eq("league", league)
        .in("market", cfg.core) // WZ-PROPS-DARK-2026-07-10 :: recent list is core-only; props stay unpublished
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(60);
      if (recErr) { console.warn("[performance] recent query failed:", recErr.message); }
      const elig = (recRows || []).filter(r => isQualified(r)); // WZ-PROPS-DARK-2026-07-10 :: core-only
      recent = elig.slice(0, 20).map(r => {
        const won = r.result === "win";
        return {
          date: r.game_date,
          pick: pickLabel(r),
          result: won ? "W" : "L",
          edge: r.edge != null ? Math.round(Number(r.edge) * 1000) / 10 : null,
          units: won ? Math.round(unitProfit(r.odds) * 100) / 100 : -1,
          clvPct: r.clv != null ? Math.round(Number(r.clv) * 10000) / 100 : null,
          clvCents: (r.odds != null && r.closing_odds != null) ? clvCents(r.odds, r.closing_odds) : null,
        };
      });
    } catch (_) { recent = []; }

    // ── Props table (SEPARATE; hit-rate + ROI; never in core record or CLV) ───
    // Overall props summary PLUS a per-stat breakdown (points / rebounds /
    // assists / 3PT for NBA; a single HR-props entry for MLB). Each stat type
    // becomes its own sub-row on the page.
    // WZ-PROPS-DARK-2026-07-10 :: props are GRADED behind the scenes (the recorder +
    // grader still settle every prop for our own measurement/R&D) but their record --
    // win rate, ROI, CLV, recent rows -- is NEVER surfaced to subscribers. Props are
    // props for a reason: the honest expectation is a negative return, so we do not
    // publish one. Held null so the page renders no prop record of any kind.
    const props = null;

    res.json({
      league,
      // Headline = qualified picks (what we stand behind).
      ...qualified,
      totalGraded: qualifiedRows.length,
      // Range-aware headline KPIs + cumulative units curve + CLV grid.
      ranges,
      // Compact cumulative curves (roi/win/clv) for the Home stat-card sparklines.
      spark,
      // Newest graded picks (core + props) for the Recent Results list.
      recent,
      // Full sample kept visible so nothing is hidden.
      fullSample: { ...full, totalGraded: rows.length },
      clv: clvSummary,
      props,
      // Reset cutoffs (per market) so the page can show "tracking reset on <date>".
      propResets: MARKET_RESET,
      // Back-compat: the existing MLB page reads `hrProps`. Keep it for mlb until
      // the page is updated to the generic `props` field.
      hrProps: league === "mlb" ? props : undefined,
      filter: {
        qualifyingTiers: QUALIFYING_TIERS,
        excludedCount: rows.length - qualifiedRows.length,
      },
      pendingCount: pendingCount || 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Performance] error:", err.message);
    res.status(500).json({ error: "Failed to load performance", details: err.message });
  }
});

function blank() { return { wins: 0, losses: 0, units: 0 }; }
function tally(b, won, profit) {
  if (won) b.wins++; else b.losses++;
  b.units += profit;
}
// CLV in cents: our price vs the closing price on the same side. Positive = we
// locked in a better number than the market closed at.
function clvCents(our, close) {
  const toCents = (o) => { const n = Number(o); if (!n || isNaN(n)) return null; return n >= 100 ? n - 100 : n <= -100 ? n + 100 : 0; };
  const a = toCents(our), b = toCents(close);
  if (a == null || b == null) return null;
  return Math.round(a - b);
}
// Derive a team label from "AWAY @ HOME" matchup + a side ("away"/"home").
function teamFromMatchup(matchup, side) {
  const parts = String(matchup || "").split(/\s+(?:@|vs|at)\s+/i);
  if (parts.length === 2) return (String(side).toLowerCase() === "home" ? parts[1] : parts[0]).trim();
  return String(side).toLowerCase() === "home" ? "Home" : "Away";
}
// Human-readable pick label for Recent Results. model_predictions stores the
// side INSIDE `selection`: "away"/"home" for ML/RL, "over"/"under" for totals,
// the player name for HR props, and "Player:side" for hits/K props.
function pickLabel(r) {
  const mu = r.matchup || "", sel = String(r.selection || ""), line = r.line, m = r.market;
  const sign = (x) => (Number(x) > 0 ? "+" : "") + x;
  if (m === "moneyline") return `${teamFromMatchup(mu, sel)} ML`;
  if (m === "run_line" || m === "spread") return `${teamFromMatchup(mu, sel)} ${line != null ? sign(line) : ""}`.trim();
  if (m === "total") return `${sel === "under" ? "Under" : "Over"}${line != null ? " " + line : ""}${mu ? " " + mu : ""}`.trim();
  if (m === "hr_prop") return `${sel} Over ${line != null ? line : "0.5"} HR`.trim();
  if (m === "player_hits" || m === "player_strikeouts") {
    const [player, side] = sel.split(":");
    const ou = String(side || "").toLowerCase() === "under" ? "Under" : "Over";
    const unit = m === "player_hits" ? "Hits" : "K";
    return `${player || sel} ${ou} ${line != null ? line : ""} ${unit}`.trim();
  }
  return `${sel || mu || "Pick"}${line != null ? " " + line : ""}`.trim();
}
function finalize(b) {
  const total = b.wins + b.losses;
  b.total = total;
  b.winPct = total > 0 ? Math.round((b.wins / total) * 1000) / 10 : null;
  b.roi = total > 0 ? Math.round((b.units / total) * 1000) / 10 : null; // % ROI per unit
  b.units = Math.round(b.units * 100) / 100;
}
// Hit-rate / ROI summary for a set of prop rows (used for the props table and
// each per-stat sub-row). Props are graded by hit-rate + ROI, never win/loss record.
function propSummary(rows) {
  let wins = 0, units = 0, decSum = 0, decN = 0;
  for (const r of rows) {
    const won = r.result === "win";
    if (won) wins++;
    units += won ? unitProfit(r.odds) : -1;
    if (r.odds != null) { const d = americanToDecimal(Number(r.odds)); if (d) { decSum += d; decN++; } }
  }
  const n = rows.length;
  return {
    picks: n,
    hits: wins,
    misses: n - wins,
    hitRatePct: Math.round((wins / n) * 1000) / 10,
    roi: Math.round((units / n) * 1000) / 10,
    avgOdds: decN ? decimalToAmerican(decSum / decN) : null,
  };
}
module.exports = router;
