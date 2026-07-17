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
const QUALIFYING_TIERS = ["HIGH", "MEDIUM"];
function isQualified(r) {
  const conf = (r.confidence || "NEUTRAL").toUpperCase();
  return QUALIFYING_TIERS.includes(conf);
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
        .select("projected, actual_value, line, result, game_date")
        .eq("league", "mlb").eq("market", "total_shadow")
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (since) q = q.gte("game_date", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < PAGE) break;
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
    res.json({
      token: "WZ-TOTALSBIAS-2026-07-17", n,
      meanProjMinusActual: meanBias,
      recommendedTotalMeanAdj: Math.round((-meanBias) * 100) / 100,
      modelOverRate: Math.round((projOverLine / n) * 1000) / 10,
      actualOverRate: Math.round((wentOver / n) * 1000) / 10,
      dial: dialOut,
      reading: "meanProjMinusActual > 0 => model projects HIGH (over-lean); recommendedTotalMeanAdj is the runs to add (negative = subtract) to center projections on reality. Dial: pick the adj where overWinPct and underWinPct are both above ~52.4% (break-even at -110) and spreadPts is near 0 (no lean).",
    });
  } catch (err) {
    console.error("[totalsbias] error:", err.message);
    res.status(500).json({ error: err.message });
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
        .select("market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds")
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
    const qualifiedRows = coreRows.filter(isQualified);

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
