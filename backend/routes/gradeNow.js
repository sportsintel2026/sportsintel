// routes/gradeNow.js — manual grading trigger + diagnostics.
//
//   GET /api/grade-now           -> runs gradeFinishedGames() ONCE, returns count.
//   GET /api/grade-now?debug=1   -> READ-ONLY. Per pending MLB date: game_id match +
//                                   status vs the schedule. Explains a "graded:0".
//   GET /api/grade-now?probe=1   -> READ-ONLY. For pending picks whose game is FINAL +
//                                   matched (the ones that *should* grade), fetch the
//                                   real box score and report: box ok? the normalized
//                                   name we search for, whether it's in the box, and a
//                                   sample of the actual box names. Pinpoints why a
//                                   pick won't settle (bad read vs name mismatch).
//
// Safe + idempotent. debug/probe write nothing. Same contract as /api/expert-grade.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { gradeFinishedGames, voidUnmatchedProps } = require("../services/predictionTracker");
const {
  getScheduleForDate, getGameHRHitters, getGamePitcherStrikeouts,
  getGameBatterHits, getGameBatterTotalBases, normPlayerName, getEasternDate, getLinescore,
} = require("../services/mlbStatsApi");
const { getRawTotalsDebug, probeOddsCoverage, getPinnacleAnchorComparison, getSportsCatalogue } = require("../services/oddsApi"); // WZ-ODDS-CATALOGUE-2026-07-20
const { probeExpectedStats, probeBarrels, probePitcherWhiff, probePitcherWhiffData } = require("../services/savantApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

router.get("/", async (req, res) => {
  try {
    if (req.query.debug === "1" || req.query.debug === "true") return res.json(await debugReport());
    if (req.query.probe === "1" || req.query.probe === "true") return res.json(await probeReport());
    if (req.query.void_unmatched === "1" || req.query.void_unmatched === "true") return res.json({ ok: true, ...(await voidUnmatchedProps()) });
    if (req.query.counts === "1" || req.query.counts === "true") return res.json(await countsReport(req.query.league));
    // WZ-ODDS-CATALOGUE-2026-07-20 :: READ-ONLY. Lists every football sport key the odds provider
    // offers, to settle whether a missing slate (e.g. NFL preseason) is "books have not posted yet"
    // or "filed under a key we never request". Costs no quota. adminGuard already covers this route.
    if (req.query.sports === "1" || req.query.sports === "true") {
      try { return res.json(await getSportsCatalogue(req.query.group)); }
      catch (e) { return res.json({ ok: false, error: String((e.response && e.response.status) || e.message) }); }
    }
    if (req.query.prop_results === "1" || req.query.prop_results === "true") return res.json(await propResults());
    if (req.query.tb_grade != null) {
      const v = String(req.query.tb_grade);
      const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      return res.json(await tbGrade(cutoff));
    }
    if (req.query.hr_tiers === "1" || req.query.hr_tiers === "true") return res.json(await hrTiers());
    if (req.query.savant_probe === "1" || req.query.savant_probe === "true") return res.json(await probeExpectedStats());
    if (req.query.barrel_probe === "1" || req.query.barrel_probe === "true") return res.json(await probeBarrels());
    if (req.query.whiff_probe === "1" || req.query.whiff_probe === "true") return res.json(await probePitcherWhiff());
    if (req.query.whiff_data === "1" || req.query.whiff_data === "true") return res.json(await probePitcherWhiffData());
    if (req.query.totals_debug != null) return res.json(await getRawTotalsDebug(req.query.totals_debug));
    if (req.query.odds_probe === "1" || req.query.odds_probe === "true") return res.json(await probeOddsCoverage({ regions: req.query.regions, markets: req.query.markets }));
    if (req.query.pinnacle_anchor === "1" || req.query.pinnacle_anchor === "true") return res.json(await getPinnacleAnchorComparison({ sport: req.query.sport, regions: req.query.regions }));
    if (req.query.totals_audit === "1" || req.query.totals_audit === "true") return res.json(await totalsAudit());
    if (req.query.ml_backtest === "1" || req.query.ml_backtest === "true") return res.json(await mlBacktest());
    if (req.query.k_backtest != null) {
      const v = String(req.query.k_backtest);
      const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; // YYYY-MM-DD = v2.1-era split; 1/true = all-time
      return res.json(await kBacktest(cutoff));
    }
    if (req.query.clv_audit === "1" || req.query.clv_audit === "true") return res.json(await clvAudit());
    if (req.query.hr_split != null) {
      const v = String(req.query.hr_split);
      const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "2026-06-04"; // PLACEHOLDER until the real v2 deploy date is set
      return res.json(await hrSplit(cutoff));
    }
    if (req.query.hr_backtest != null) {
      const v = String(req.query.hr_backtest);
      const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; // optional era split
      return res.json(await hrBacktest(cutoff));
    }
    const graded = await gradeFinishedGames();
    res.json({ ok: true, graded: graded == null ? 0 : graded });
  } catch (err) {
    console.error("[grade-now] failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function pendingMlb() {
  const supabase = db();
  const { data, error } = await supabase
    .from("model_predictions")
    .select("id,league,market,selection,game_id,game_date,line,result")
    .eq("result", "pending");
  if (error) throw new Error(error.message);
  return (data || []).filter(p => p.league !== "nba");
}

async function debugReport() {
  const mlb = await pendingMlb();
  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);
  const report = {};
  for (const [date, preds] of Object.entries(byDate)) {
    let schedule = [], schedErr = null;
    try { schedule = await getScheduleForDate(date); } catch (e) { schedErr = e.message; }
    const sched = {};
    for (const g of schedule) sched[String(g.id)] = g;
    const markets = {};
    for (const p of preds) markets[p.market] = (markets[p.market] || 0) + 1;
    const matched = [], unmatched = [], statuses = {}, seen = new Set();
    for (const p of preds) {
      const id = String(p.game_id);
      if (seen.has(id)) continue; seen.add(id);
      if (sched[id]) { matched.push(id); statuses[id] = sched[id].status; } else unmatched.push(id);
    }
    report[date] = {
      pending: preds.length, markets, scheduleGames: schedule.length,
      finalGames: schedule.filter(g => g.status === "final").length, schedErr,
      matchedGameIds: matched.slice(0, 25), matchedStatuses: statuses, unmatchedGameIds: unmatched.slice(0, 25),
    };
  }
  return { ok: true, mlbPendingTotal: mlb.length, byDate: report };
}

async function probeReport() {
  const mlb = await pendingMlb();
  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);

  const schedCache = {};      // date -> {id: game}
  const boxCache = new Map();  // `${market}:${game_id}` -> box
  const results = [];
  let probed = 0;
  const MAX = 10;

  for (const [date, preds] of Object.entries(byDate)) {
    if (probed >= MAX) break;
    if (!schedCache[date]) {
      try { const s = await getScheduleForDate(date); const m = {}; for (const g of s) m[String(g.id)] = g; schedCache[date] = m; }
      catch { schedCache[date] = {}; }
    }
    const sched = schedCache[date];
    for (const p of preds) {
      if (probed >= MAX) break;
      const g = sched[String(p.game_id)];
      if (!g || g.status !== "final") continue;        // only probe what *should* grade
      probed++;

      // selection -> player name (strip ":SIDE" for two-sided props)
      const ci = p.selection.lastIndexOf(":");
      const pname = (p.market === "hr_prop") ? p.selection : (ci >= 0 ? p.selection.slice(0, ci) : p.selection);
      const target = normPlayerName(pname);

      const key = `${p.market}:${p.game_id}`;
      let box;
      if (boxCache.has(key)) box = boxCache.get(key);
      else {
        try {
          if (p.market === "player_strikeouts") box = await getGamePitcherStrikeouts(p.game_id);
          else if (p.market === "player_hits") box = await getGameBatterHits(p.game_id);
          else if (p.market === "hr_prop") box = await getGameHRHitters(p.game_id);
          else if (p.market === "player_total_bases_shadow") box = await getGameBatterTotalBases(p.game_id);
          else box = { ok: "n/a (team market)" };
        } catch (e) { box = { ok: false, threw: e.message }; }
        boxCache.set(key, box);
      }

      const map = box && (box.hits || box.ks || box.hr || box.tb);
      const inMap = map instanceof Map ? map.has(target) : false;
      results.push({
        market: p.market, game_id: String(p.game_id), selection: p.selection,
        boxOk: box ? box.ok : null, boxThrew: box && box.threw ? box.threw : undefined,
        searchName: pname, normalized: target, foundInBox: inMap,
        value: inMap ? map.get(target) : null,
        boxNameCount: map instanceof Map ? map.size : 0,
        sampleBoxNames: map instanceof Map ? Array.from(map.keys()).slice(0, 18) : [],
      });
    }
  }
  return { ok: true, mlbPendingTotal: mlb.length, probed, results };
}

// (void-DNP sweep now lives in services/predictionTracker.js as voidUnmatchedProps — single source, shared by the hourly cron and ?void_unmatched=1)

// READ-ONLY. Real graded vs pending counts so nothing is taken on faith:
// overall, per market, and per recent date. "graded" = result is not pending
// (win/loss/push). Uses head:true count queries (no rows fetched).
// WZ-COUNTS-LEAGUE-2026-07-20 :: countsReport WAS HARDCODED TO MLB and to MLB's seven markets.
// This is the ledger census -- pending/graded/win/loss/push, overall and per market -- i.e. the one
// tool that answers "is the recorder writing rows, and is grading settling them." For football it
// answered NOTHING, and worse, it answered nothing SILENTLY: every football row is league nfl/cfb, so
// the mlb filter matched zero rows and the report returned a wall of clean zeroes that is
// indistinguishable from "recorded fine, graded fine, nothing pending." That is the same
// looks-fine-while-broken failure that hid the K-shadow row for 15 days, and preseason is ~2 weeks out.
//
// Now `?league=` selects the league and the market list FOLLOWS it. Three deliberate choices:
//  1. Default stays "mlb" with MLB's exact original market list, so the existing ?counts=1 call is
//     byte-for-byte unchanged.
//  2. An unrecognised league is a LOUD 400 listing what is valid -- never a silent zero-filled report.
//     Returning zeroes for a typo'd league is precisely the failure this endpoint exists to catch.
//  3. tbShadowByDate is renamed focusByDate and its market comes from the league. It was a
//     hardcoded 7-day trace of player_total_bases_shadow; the football equivalent is total_shadow.
//     Same purpose (watch one market's daily settle rate), no longer welded to one MLB market.
const COUNTS_LEAGUES = {
  mlb: {
    markets: ["moneyline", "total", "run_line", "hr_prop", "player_strikeouts", "player_hits", "player_total_bases_shadow"],
    focus: "player_total_bases_shadow",
  },
  nfl: {
    markets: ["moneyline", "spread", "total", "moneyline_shadow", "spread_shadow", "total_shadow"],
    focus: "total_shadow",
  },
  cfb: {
    markets: ["moneyline", "spread", "total", "moneyline_shadow", "spread_shadow", "total_shadow"],
    focus: "total_shadow",
  },
  nba: {
    markets: ["moneyline", "spread", "total", "player_points", "player_rebounds", "player_assists"],
    focus: "total",
  },
};

async function countsReport(leagueParam) {
  const supabase = db();
  const LEAGUE = String(leagueParam || "mlb").toLowerCase();
  const cfg = COUNTS_LEAGUES[LEAGUE];
  if (!cfg) {
    return { ok: false, error: `unknown league '${LEAGUE}'`, valid: Object.keys(COUNTS_LEAGUES) };
  }

  async function n(filter) {
    let q = supabase.from("model_predictions").select("*", { count: "exact", head: true }).eq("league", LEAGUE);
    for (const [col, op, val] of filter) {
      if (op === "eq") q = q.eq(col, val);
      else if (op === "neq") q = q.neq(col, val);
    }
    const { count, error } = await q;
    return error ? `err:${error.message}` : (count || 0);
  }

  const overall = {
    pending: await n([["result", "eq", "pending"]]),
    graded: await n([["result", "neq", "pending"]]),
    win: await n([["result", "eq", "win"]]),
    loss: await n([["result", "eq", "loss"]]),
    push: await n([["result", "eq", "push"]]),
  };

  const markets = cfg.markets;
  const byMarket = {};
  for (const m of markets) {
    byMarket[m] = {
      graded: await n([["market", "eq", m], ["result", "neq", "pending"]]),
      pending: await n([["market", "eq", m], ["result", "eq", "pending"]]),
      win: await n([["market", "eq", m], ["result", "eq", "win"]]),
      loss: await n([["market", "eq", m], ["result", "eq", "loss"]]),
      push: await n([["market", "eq", m], ["result", "eq", "push"]]),
    };
  }

  const byDate = {};
  for (let i = 0; i <= 6; i++) {
    const d = getEasternDate(-i);
    byDate[d] = {
      graded: await n([["game_date", "eq", d], ["result", "neq", "pending"]]),
      pending: await n([["game_date", "eq", d], ["result", "eq", "pending"]]),
    };
  }

  const focusByDate = {};
  for (let i = 0; i <= 6; i++) {
    const d = getEasternDate(-i);
    focusByDate[d] = {
      graded: await n([["market", "eq", cfg.focus], ["game_date", "eq", d], ["result", "neq", "pending"]]),
      pending: await n([["market", "eq", cfg.focus], ["game_date", "eq", d], ["result", "eq", "pending"]]),
    };
  }

  return { ok: true, league: LEAGUE, focusMarket: cfg.focus, overall, byMarket, byDate, focusByDate };
}

// READ-ONLY. Every graded K / hits pick with projection vs actual, plus per-side
// aggregates — the raw material for calibrating the projections.
// READ-ONLY. Total-Bases SHADOW calibration report. Reads graded TB shadow rows
// and answers: (1) is the model's Over probability calibrated (does 60% actually
// hit 60%)?, (2) what's the Over-bet ROI at -110-equivalent?, (3) is there a
// systematic Over bias, broken out BY LINE (0.5 vs 1.5+) — the suspected leak.
// Optional ?tb_grade=YYYY-MM-DD cutoff to restrict to rows on/after a date.
async function tbGrade(cutoff = null) {
  const supabase = db();
  let q = supabase
    .from("model_predictions")
    .select("selection,line,model_prob,edge,result,actual_value,game_date")
    .eq("league", "mlb")
    .eq("market", "player_total_bases_shadow")
    .neq("result", "pending")
    .limit(5000);
  if (cutoff) q = q.gte("game_date", cutoff);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const rows = (data || [])
    .map(r => {
      const ci = (r.selection || "").lastIndexOf(":");
      const player = ci >= 0 ? r.selection.slice(0, ci) : r.selection;
      return { player, line: r.line, modelProb: r.model_prob, edge: r.edge, result: r.result, actual: r.actual_value, date: r.game_date };
    })
    .filter(r => r.result === "win" || r.result === "loss"); // decisions only (drop pushes)

  const n = rows.length;
  if (!n) return { ok: true, note: "no graded TB shadow rows yet — give it a day after a slate completes", n: 0 };

  const amerToProfit = (o) => o == null ? null : (o > 0 ? o / 100 : 100 / Math.abs(o));
  const PROFIT_110 = amerToProfit(-110); // shadow rows store -110

  // All rows are modeled as the OVER side (selection is :OVER, model_prob = P(over)).
  function summarize(set) {
    const m = set.length;
    if (!m) return { n: 0 };
    const wins = set.filter(r => r.result === "win").length;
    const losses = m - wins;
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    // ROI if we'd bet every OVER at -110.
    let profit = 0;
    for (const r of set) profit += r.result === "win" ? PROFIT_110 : -1;
    return {
      n: m, wins, losses,
      overHitRatePct: Math.round((wins / m) * 100),     // how often Over actually cashed
      meanModelOverProb: +mean(set.map(r => r.modelProb)).toFixed(3), // what the model claimed
      meanActualTB: +mean(set.map(r => r.actual)).toFixed(2),
      meanLine: +mean(set.map(r => r.line)).toFixed(2),
      roiPctAt110: +((profit / m) * 100).toFixed(1),
    };
  }

  // Calibration buckets on the model's Over prob vs the realized Over rate.
  const calBuckets = [[0, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.7], [0.7, 1.01]];
  const calibration = calBuckets.map(([lo, hi]) => {
    const set = rows.filter(r => r.modelProb >= lo && r.modelProb < hi);
    const m = set.length;
    const actualOver = set.filter(r => r.result === "win").length; // win == Over hit
    return {
      bucket: `${lo.toFixed(2)}-${hi.toFixed(2)}`,
      n: m,
      claimedOverProb: m ? +((lo + hi) / 2).toFixed(2) : null,
      actualOverRatePct: m ? Math.round((actualOver / m) * 100) : null,
    };
  });

  return {
    ok: true,
    n,
    overall: summarize(rows),
    byLine: {
      "0.5": summarize(rows.filter(r => r.line === 0.5)),
      "1.5": summarize(rows.filter(r => r.line === 1.5)),
      "2.5+": summarize(rows.filter(r => r.line >= 2.5)),
    },
    calibration,
    interpretation: "If actualOverRatePct < claimedOverProb across buckets, the model is OVER-biased (projections too high). Compare byLine['0.5'] vs ['1.5'] to locate where the bias lives.",
  };
}

async function propResults() {
  const supabase = db();
  const { data, error } = await supabase
    .from("model_predictions")
    .select("market,selection,line,model_prob,odds,result,actual_value,confidence,game_date")
    .eq("league", "mlb")
    .in("market", ["player_strikeouts", "player_hits"])
    .neq("result", "pending")
    .limit(1000);
  if (error) return { ok: false, error: error.message };

  const rows = (data || []).map(r => {
    const ci = (r.selection || "").lastIndexOf(":");
    const side = ci >= 0 ? r.selection.slice(ci + 1).toUpperCase() : "OVER";
    const player = ci >= 0 ? r.selection.slice(0, ci) : r.selection;
    return { market: r.market, player, side, line: r.line, modelProb: r.model_prob, odds: r.odds, result: r.result, actual: r.actual_value, conf: r.confidence, date: r.game_date };
  });

  function agg(market, side) {
    const set = rows.filter(r => r.market === market && r.side === side && r.actual != null);
    const n = set.length;
    if (!n) return { n: 0 };
    const wins = set.filter(r => r.result === "win").length;
    const losses = set.filter(r => r.result === "loss").length;
    const push = set.filter(r => r.result === "push").length;
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      n, wins, losses, push,
      hitRatePct: Math.round((wins / (wins + losses || 1)) * 100),
      meanLine: +mean(set.map(r => r.line)).toFixed(2),
      meanActual: +mean(set.map(r => r.actual)).toFixed(2),
      meanModelProb: +mean(set.map(r => r.modelProb)).toFixed(3),
      actualOverLineRate: +(set.filter(r => r.actual > r.line).length / n).toFixed(2),
    };
  }

  return {
    ok: true,
    totals: { k: rows.filter(r => r.market === "player_strikeouts").length, hits: rows.filter(r => r.market === "player_hits").length },
    aggregates: {
      strikeouts: { OVER: agg("player_strikeouts", "OVER"), UNDER: agg("player_strikeouts", "UNDER") },
      hits: { OVER: agg("player_hits", "OVER"), UNDER: agg("player_hits", "UNDER") },
    },
    rows,
  };
}

// READ-ONLY. Strikeout-prop calibration backtest. Answers what the blanket 0.75
// shrink can't: (1) DIRECTIONAL bias — do OVER picks bleed while UNDERs hold (or
// vice versa)? (2) is the stated confidence honest (does a claimed 65% win 65%)?
// (3) is the model OVERCONFIDENT — a φ-aware temper sweep (pull the stored v2.1 prob
// toward 0.5, score by log-loss/Brier) that maps qualitatively to K_DISPERSION_PHI.
// v2.1 has NO post-hoc shrink (the negbin φ does the tempering), so the stored prob
// is the model's own output — we do NOT un-shrink it. Pages all graded K rows in
// 1,000-row chunks (Supabase caps select 1000).
async function kBacktest(cutoff = null) {
  const supabase = db();
  const amerToProfit = (o) => o == null ? null : (o > 0 ? o / 100 : 100 / Math.abs(o));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("selection, line, model_prob, odds, edge, result, actual_value, game_date")
      .eq("league", "mlb")
      .eq("market", "player_strikeouts")
      .neq("result", "pending")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const parsed = rows.map(r => {
    const ci = (r.selection || "").lastIndexOf(":");
    const side = ci >= 0 ? r.selection.slice(ci + 1).toUpperCase() : "OVER";
    return { side, line: r.line, sp: r.model_prob, odds: r.odds, edge: r.edge, result: r.result, actual: r.actual_value, date: r.game_date };
  }).filter(r => r.result === "win" || r.result === "loss"); // decisions only

  // Era split: when a cutoff is given, analyze ONLY the v2.1-era picks (game_date >= cutoff),
  // so the old pre-v2.1 K model can't contaminate the calibration/ROI we base K_ALLOW_OVERS on.
  const cut = cutoff && /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? cutoff : null;
  const before = cut ? parsed.filter(r => r.date && r.date < cut) : [];
  const after = cut ? parsed.filter(r => r.date && r.date >= cut) : parsed;
  const scope = after; // all detailed analysis below runs on this set

  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  function summarize(set) {
    const win = set.filter(r => r.result === "win").length;
    const loss = set.filter(r => r.result === "loss").length;
    const decisions = win + loss;
    let profit = 0;
    for (const r of set) {
      if (r.result === "win") { const p = amerToProfit(r.odds); profit += (p == null ? 0 : p); }
      else profit -= 1;
    }
    return {
      n: set.length, win, loss,
      hitRatePct: decisions ? +(win / decisions * 100).toFixed(1) : null,
      roiPct: decisions ? +(profit / decisions * 100).toFixed(1) : null,
      units: +profit.toFixed(1),
      meanModelProb: set.length ? +mean(set.map(r => r.sp).filter(x => x != null)).toFixed(3) : null,
      meanActual: set.length ? +mean(set.map(r => r.actual).filter(x => x != null)).toFixed(2) : null,
      meanLine: set.length ? +mean(set.map(r => r.line).filter(x => x != null)).toFixed(2) : null,
    };
  }

  // calibration on the CURRENT stored prob (prob of taken side = P(win))
  const calBuckets = [[0, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]];
  const calibration = calBuckets.map(([lo, hi]) => {
    const set = scope.filter(r => r.sp != null && r.sp >= lo && r.sp < hi);
    const win = set.filter(r => r.result === "win").length;
    return {
      bucket: `${lo}-${hi}`, n: set.length,
      meanStatedProb: set.length ? +(set.reduce((a, r) => a + r.sp, 0) / set.length).toFixed(3) : null,
      actualWinRate: set.length ? +(win / set.length).toFixed(3) : null,
    };
  }).filter(b => b.n > 0);

  // TEMPER sweep (φ-aware): v2.1 ABANDONED the old 0.75 post-hoc shrink — the negbin
  // dispersion (K_DISPERSION_PHI) now does the tempering. So we do NOT un-shrink the
  // stored prob (it IS the model's own output). This sweep simply pulls the stored
  // prob toward 0.5 by a factor t and scores log-loss, to measure IF / HOW MUCH the
  // model is overconfident. t=1.0 = model as-is. The LIVE lever is K_DISPERSION_PHI
  // (raising φ ≈ lowering t here); treat bestTemper as a DIRECTION signal only, never
  // a value to paste — there is no post-hoc shrink knob in v2.1 anymore.
  const tempers = [0.50, 0.60, 0.70, 0.80, 0.90, 1.00];
  const sweep = tempers.map(t => {
    let ll = 0, brier = 0, sumCand = 0, n = 0, win = 0;
    for (const r of scope) {
      if (r.sp == null) continue;
      const cand = clamp(0.5 + t * (r.sp - 0.5), 1e-6, 1 - 1e-6);
      const y = r.result === "win" ? 1 : 0;
      ll += -(y * Math.log(cand) + (1 - y) * Math.log(1 - cand));
      brier += (cand - y) * (cand - y);
      sumCand += cand; win += y; n++;
    }
    return {
      temper: t,
      logLoss: n ? +(ll / n).toFixed(4) : null,
      brier: n ? +(brier / n).toFixed(4) : null,
      meanStatedProb: n ? +(sumCand / n).toFixed(3) : null,
      actualWinRate: n ? +(win / n).toFixed(3) : null,
      calibrationGap: n ? +((sumCand - win) / n).toFixed(3) : null, // + = overconfident
      note: t === 1.00 ? "model as-is (v2.1 stored prob)" : "",
    };
  });
  const best = sweep.filter(x => x.logLoss != null).sort((a, b) => a.logLoss - b.logLoss)[0];

  // edge-band ROI: does a tighter edge gate help? which side is the leak?
  const edgeBands = [[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 1]].map(([lo, hi]) => ({
    band: `${lo}-${hi}`, ...summarize(scope.filter(r => (r.edge ?? 0) >= lo && (r.edge ?? 0) < hi)),
  }));

  return {
    ok: true,
    era: cut ? { cutoff: cut, note: `Detailed analysis below = v2.1-era only (game_date >= ${cut}). before/after = quick contrast.`, before: summarize(before), after: summarize(after) } : { cutoff: null, note: "No cutoff given (?k_backtest=1) = ALL strikeout picks pooled, including pre-v2.1. Pass ?k_backtest=YYYY-MM-DD to isolate v2.1." },
    method: "Decisions only (push/void excluded). model_prob = P(taken side) = P(win). ROI uses real American odds. TEMPER sweep pulls the STORED v2.1 prob toward 0.5 by factor t (NO false un-shrink — v2.1 has no post-hoc shrink); t=1.0 is the model as-is. Scored by log-loss (lower=better) vs real win/loss.",
    overall: summarize(scope),
    bySide: { OVER: summarize(scope.filter(r => r.side === "OVER")), UNDER: summarize(scope.filter(r => r.side === "UNDER")) },
    calibration,
    temperSweep: sweep,
    bestTemperByLogLoss: best ? best.temper : null,
    baselineLogLoss: +(-Math.log(0.5)).toFixed(4), // 0.6931 = pure coin flip
    byEdgeBand: edgeBands,
    verdictNote: "v2.1 tempering lever is K_DISPERSION_PHI (higher φ = wider tails = probs pulled toward 0.5), NOT a post-hoc shrink. If temperSweep's best t is well below 1.0 AND calibrationGap at t=1.0 is positive (overconfident) on a real sample (n>=70), RAISE φ (e.g. 1.5→2.0) and re-backtest — do not paste t anywhere. If bySide shows one side deeply -EV, that's a directional edge-gate problem, not φ. Compare every logLoss to baselineLogLoss (0.6931): if even t=1.0 can't beat a coin flip at real n, the K model lacks signal — hold overs OFF and widen the edge gate. NOTE: OVER picks stay suppressed (K_ALLOW_OVERS=false) so OVER n will be ~0 until overs are re-enabled; this sweep can only validate UNDER calibration until then.",
  };
}

// READ-ONLY. HR-prop ROI broken out by confidence tier, plus cumulative
// "gate" aggregates that map to candidate recording thresholds. Answers: would
// tightening the HR pick gate (HIGH-only / MEDIUM+ / LOW+) have actually made
// money, or is every tier underwater? Pages through ALL graded rows in 1,000-row
// chunks (Supabase silently caps a select at 1,000 and returns oldest-first, so
// an unbounded select would drop the newest grades — see the §8 1,000-row bug).
async function hrTiers() {
  const supabase = db();

  // American odds -> profit on a 1-unit win. -1 unit on a loss; push = no action.
  const amerToProfit = (odds) =>
    odds == null ? null : (odds > 0 ? odds / 100 : 100 / Math.abs(odds));

  // Paginate all graded HR picks.
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("odds,result,confidence,model_prob,edge,game_date,selection")
      .eq("league", "mlb")
      .eq("market", "hr_prop")
      .neq("result", "pending")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  function summarize(set) {
    const n = set.length;
    const win = set.filter(r => r.result === "win").length;
    const loss = set.filter(r => r.result === "loss").length;
    const push = set.filter(r => r.result === "push").length;
    const decisions = win + loss; // push excluded from ROI + hit rate
    let profit = 0;
    for (const r of set) {
      if (r.result === "win") { const p = amerToProfit(r.odds); profit += (p == null ? 0 : p); }
      else if (r.result === "loss") { profit -= 1; }
    }
    const mean = (vals) => {
      const f = vals.filter(v => v != null);
      return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
    };
    const mOdds = mean(set.map(r => r.odds));
    const mProb = mean(set.map(r => r.model_prob));
    const mEdge = mean(set.map(r => r.edge));
    return {
      n, win, loss, push,
      hitRatePct: decisions ? +(win / decisions * 100).toFixed(1) : null,
      roiPct: decisions ? +(profit / decisions * 100).toFixed(1) : null,
      unitsProfit: +profit.toFixed(1),
      meanOdds: mOdds == null ? null : Math.round(mOdds),
      meanModelProb: mProb == null ? null : +mProb.toFixed(3),
      meanEdge: mEdge == null ? null : +mEdge.toFixed(3),
    };
  }

  const tier = (r) => (r.confidence || "NEUTRAL").toUpperCase();
  const byTier = {};
  for (const t of ["HIGH", "MEDIUM", "LOW", "NEUTRAL"]) {
    byTier[t] = summarize(rows.filter(r => tier(r) === t));
  }

  // Cumulative gates — each is "what the record would look like if we only kept
  // picks at or above this edge tier." These map to the gate options directly.
  const gates = {
    "HIGH_only (edge>=5%)":  summarize(rows.filter(r => tier(r) === "HIGH")),
    "MEDIUM+ (edge>=2.5%)":  summarize(rows.filter(r => ["HIGH", "MEDIUM"].includes(tier(r)))),
    "LOW+ (edge>=0.5%)":     summarize(rows.filter(r => ["HIGH", "MEDIUM", "LOW"].includes(tier(r)))),
    "ALL_current (no gate)": summarize(rows),
  };

  return {
    ok: true,
    market: "hr_prop",
    totalGraded: rows.length,
    note: "roiPct = unit profit / (win+loss), 1u per play, real American odds; push excluded. ALL_current should match the Performance page; compare gates to pick the threshold.",
    byTier,
    gates,
  };
}

// READ-ONLY. Splits recorded MLB total picks into CLEAN (line in the real
// game-total range) vs JUNK (out-of-range lines like 1.5 / 15.5 that the old
// parser let through). Shows what each did to the record, so we can see how much
// the junk near-locks inflated the totals number before excluding them.
async function totalsAudit() {
  const supabase = db();
  const MIN = 5.5, MAX = 13.5;
  const amerToProfit = (o) => o == null ? null : (o > 0 ? o / 100 : 100 / Math.abs(o));

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("line, odds, result, selection, matchup, game_date, confidence")
      .eq("league", "mlb")
      .eq("market", "total")
      .neq("result", "pending")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  function summarize(set) {
    const win = set.filter(r => r.result === "win").length;
    const loss = set.filter(r => r.result === "loss").length;
    const push = set.filter(r => r.result === "push").length;
    const decisions = win + loss;
    let profit = 0;
    for (const r of set) {
      if (r.result === "win") { const p = amerToProfit(r.odds); profit += (p == null ? 0 : p); }
      else if (r.result === "loss") profit -= 1;
    }
    return {
      n: set.length, win, loss, push,
      hitRatePct: decisions ? +(win / decisions * 100).toFixed(1) : null,
      roiPct: decisions ? +(profit / decisions * 100).toFixed(1) : null,
    };
  }

  const inRange = (r) => r.line != null && r.line >= MIN && r.line <= MAX;
  const junk = rows.filter(r => !inRange(r));

  return {
    ok: true,
    lineRange: `${MIN}-${MAX}`,
    all: summarize(rows),                 // what the page shows today
    clean: summarize(rows.filter(inRange)), // what the record SHOULD be
    junk: summarize(junk),                // the contamination (expect near-locks)
    junkSamples: junk.slice(0, 30).map(r => ({
      matchup: r.matchup, selection: r.selection, line: r.line,
      odds: r.odds, result: r.result, date: r.game_date,
    })),
  };
}

// ── READ-ONLY win-prob calibration backtest (added 6/8) ────────────────────────
// Answers "how compressed are the moneyline win probs, and how much decompression
// does the data want?" For every GRADED ML pick we have the model's committed raw
// win prob (model_prob) and the actual result. We sweep a decompression factor k —
// p' = sigmoid(k * logit(p)) — which pushes probs AWAY from 0.5 for k>1, and report
// log-loss + Brier at each k plus a calibration table at the best k. The k with the
// lowest log-loss is the decompression to apply inside calculateMoneylineProjection
// (transform homeWinProb/awayWinProb before returning). Also splits picks by whether
// the bet side was the market favorite (odds<0) or underdog (odds>0) to quantify the
// favorite-fade directly. Writes NOTHING.
// CAVEAT: this calibrates the picks the model actually RECORDED (the +edge side), a
// selected sample — not every game. It's the most direct evidence we have of whether
// the committed probabilities match outcomes, but read it as "are our picks calibrated"
// not "is the universe calibrated."
function _logit(p) { const c = Math.min(0.999, Math.max(0.001, p)); return Math.log(c / (1 - c)); }
function _sharpen(p, k) { return 1 / (1 + Math.exp(-k * _logit(p))); }

async function mlBacktest() {
  const supabase = db();
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("model_prob,odds,result,game_date,selection")
      .eq("league", "mlb")
      .eq("market", "moneyline")
      .in("result", ["win", "loss"])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const b = data || [];
    rows.push(...b);
    if (b.length < PAGE) break;
  }
  const usable = rows.filter(r => r.model_prob != null);
  const n = usable.length;
  if (!n) return { ok: true, n: 0, note: "no graded ML picks yet" };

  const winRate = (set) => {
    const w = set.filter(r => r.result === "win").length;
    return set.length ? +(w / set.length * 100).toFixed(1) : null;
  };
  // American odds -> profit on a 1-unit win (-1 on loss). The real decider: a 44%
  // win rate on +money dogs can still be +EV, while 59% on juiced favorites may not.
  const amerToProfit = (odds) => odds == null ? null : (odds > 0 ? odds / 100 : 100 / Math.abs(odds));
  const roi = (set) => {
    let profit = 0, decisions = 0;
    for (const r of set) {
      if (r.result === "win") { const p = amerToProfit(r.odds); if (p != null) { profit += p; decisions++; } }
      else if (r.result === "loss") { profit -= 1; decisions++; }
    }
    return decisions ? { units: +profit.toFixed(2), roiPct: +(profit / decisions * 100).toFixed(1), avgOdds: Math.round(set.reduce((a, r) => a + (r.odds || 0), 0) / set.length) } : { units: 0, roiPct: null, avgOdds: null };
  };

  // Favorite-fade split: market favorite = negative American odds on the bet side.
  const dog = usable.filter(r => r.odds != null && r.odds > 0);
  const fav = usable.filter(r => r.odds != null && r.odds < 0);

  // Decompression sweep.
  const Ks = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  const sweep = Ks.map(k => {
    let ll = 0, br = 0;
    for (const r of usable) {
      const y = r.result === "win" ? 1 : 0;
      const p = Math.min(0.999, Math.max(0.001, _sharpen(r.model_prob, k)));
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      br += (p - y) * (p - y);
    }
    return { k, logLoss: +(ll / n).toFixed(4), brier: +(br / n).toFixed(4) };
  });
  const best = sweep.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));

  // Calibration table at the best k (and at k=1 for comparison).
  const bins = [[0, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 1.01]];
  const calibAt = (k) => bins.map(([lo, hi]) => {
    const set = usable.filter(r => { const p = _sharpen(r.model_prob, k); return p >= lo && p < hi; });
    const d = set.length;
    return {
      bucket: `${lo}-${hi === 1.01 ? 1 : hi}`,
      n: d,
      meanPred: d ? +(set.reduce((a, r) => a + _sharpen(r.model_prob, k), 0) / d).toFixed(3) : null,
      actualWinRate: d ? +(set.filter(r => r.result === "win").length / d).toFixed(3) : null,
    };
  });

  return {
    ok: true,
    n,
    overallWinRatePct: winRate(usable),
    roiOverall: roi(usable),
    rawMeanModelProb: +(usable.reduce((a, r) => a + r.model_prob, 0) / n).toFixed(3),
    favoriteFade: {
      betMarketUnderdog: { n: dog.length, winRatePct: winRate(dog), ...roi(dog) },
      betMarketFavorite: { n: fav.length, winRatePct: winRate(fav), ...roi(fav) },
      note: "ROI is the decider, not win rate. If favorites carry +ROI and dogs bleed → gate to favorite-agreement. If dogs are +ROI on +money → leave it. If both bleed → trim ML like the run line.",
    },
    sharpenSweep: sweep,
    bestK: best,
    calibrationRaw_k1: calibAt(1.0),
    calibrationAtBestK: calibAt(best.k),
    fixNote: `Apply k=${best.k} as p'=sigmoid(${best.k}*logit(p)) on homeWinProb/awayWinProb in calculateMoneylineProjection (raw win prob is what's stored). Re-run after each batch of grades — k will firm up as n grows.`,
    method: "p' = sigmoid(k*logit(p)); k>1 decompresses. bestK = lowest log-loss across graded ML picks.",
  };
}

// ── READ-ONLY HR before/after-rebuild split (added 6/8) ────────────────────────
// The HR record (944 graded, ~-8% ROI, HIGH tier ~-24%) is CONTAMINATED: it spans
// the era when the Statcast power factor was silently returning null (dead) AND the
// v2 era with live Statcast. We've never seen v2-alone. This splits graded HR picks
// at a cutoff game_date — before (likely dead-Statcast) vs after (v2/live) — and
// reports tier ROI for each, PLUS a per-day breakdown so you can find the real
// transition date and re-run with ?hr_split=YYYY-MM-DD. Writes NOTHING.
async function hrSplit(cutoff) {
  const supabase = db();
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("odds,result,confidence,model_prob,edge,game_date,selection")
      .eq("league", "mlb")
      .eq("market", "hr_prop")
      .neq("result", "pending")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const b = data || [];
    rows.push(...b);
    if (b.length < PAGE) break;
  }

  const amerToProfit = (o) => o == null ? null : (o > 0 ? o / 100 : 100 / Math.abs(o));
  const mean = (vals) => { const f = vals.filter(v => v != null); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null; };
  const summarize = (set) => {
    const n = set.length;
    const win = set.filter(r => r.result === "win").length;
    const loss = set.filter(r => r.result === "loss").length;
    const push = set.filter(r => r.result === "push").length;
    const decisions = win + loss;
    let profit = 0;
    for (const r of set) {
      if (r.result === "win") { const p = amerToProfit(r.odds); profit += (p == null ? 0 : p); }
      else if (r.result === "loss") profit -= 1;
    }
    const mOdds = mean(set.map(r => r.odds));
    const mProb = mean(set.map(r => r.model_prob));
    const mEdge = mean(set.map(r => r.edge));
    return {
      n, win, loss, push,
      hitRatePct: decisions ? +(win / decisions * 100).toFixed(1) : null,
      roiPct: decisions ? +(profit / decisions * 100).toFixed(1) : null,
      unitsProfit: +profit.toFixed(1),
      meanOdds: mOdds == null ? null : Math.round(mOdds),
      meanModelProb: mProb == null ? null : +mProb.toFixed(3),
      meanEdge: mEdge == null ? null : +mEdge.toFixed(3),
    };
  };
  const byTier = (set) => ({
    HIGH: summarize(set.filter(r => r.confidence === "HIGH")),
    MEDIUM: summarize(set.filter(r => r.confidence === "MEDIUM")),
    LOW: summarize(set.filter(r => r.confidence === "LOW")),
    NEUTRAL: summarize(set.filter(r => r.confidence === "NEUTRAL")),
  });

  const before = rows.filter(r => r.game_date && r.game_date < cutoff);
  const after = rows.filter(r => r.game_date && r.game_date >= cutoff);

  const dates = [...new Set(rows.map(r => r.game_date).filter(Boolean))].sort();
  const byDate = dates.map(d => {
    const s = summarize(rows.filter(r => r.game_date === d));
    return { date: d, n: s.n, win: s.win, loss: s.loss, roiPct: s.roiPct, meanModelProb: s.meanModelProb, meanEdge: s.meanEdge };
  });

  return {
    ok: true,
    cutoff,
    totalGraded: rows.length,
    cutoffNote: `⚠️ CONFIRM THE CUTOFF. '${cutoff}' is a PLACEHOLDER. Set the real v2/live-Statcast deploy date via ?hr_split=YYYY-MM-DD. 'afterRebuild' = game_date >= cutoff.`,
    readNote: "If afterRebuild ROI (esp. HIGH tier) is climbing toward break-even vs beforeRebuild, the v2 rebuild worked and the bad number is legacy. If afterRebuild is still deeply negative, v2 itself is betting overs that can't hit → real model fix needed.",
    beforeRebuild: { ...summarize(before), byTier: byTier(before) },
    afterRebuild: { ...summarize(after), byTier: byTier(after) },
    byDate,
  };
}

// ── READ-ONLY HR salvage backtest (added 6/8) ─────────────────────────────────
// HR is a confirmed leak (every era negative, confidence inverted, power factor
// anti-predictive). This answers the only remaining question: is there a GATE that
// rescues a +EV slice, or do we trim HR like the run line? Slices graded HR ROI by
// edge band and by odds band, shows calibration (model_prob vs actual), and flags
// any slice that's +EV with non-trivial volume. Writes NOTHING.
async function hrBacktest(cutoff) {
  const supabase = db();
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("odds,result,confidence,model_prob,edge,game_date")
      .eq("league", "mlb").eq("market", "hr_prop").neq("result", "pending")
      .order("id").range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const b = data || []; rows.push(...b);
    if (b.length < PAGE) break;
  }
  const graded = rows.filter(r => r.result === "win" || r.result === "loss");
  const n = graded.length;
  if (!n) return { ok: true, n: 0, note: "no graded HR picks" };

  const amerToProfit = (o) => o == null ? null : (o > 0 ? o / 100 : 100 / Math.abs(o));
  const summarize = (set) => {
    const w = set.filter(r => r.result === "win").length;
    const d = set.length;
    let profit = 0;
    for (const r of set) profit += r.result === "win" ? (amerToProfit(r.odds) ?? 0) : -1;
    return {
      n: d, win: w, loss: d - w,
      hitRatePct: d ? +(w / d * 100).toFixed(1) : null,
      roiPct: d ? +(profit / d * 100).toFixed(1) : null,
      units: +profit.toFixed(1),
      meanModelProb: d ? +(set.reduce((a, r) => a + (r.model_prob || 0), 0) / d).toFixed(3) : null,
    };
  };

  const baseRate = +(graded.filter(r => r.result === "win").length / n).toFixed(3);

  // ROI by edge band
  const edgeBands = [[-1, 0], [0, 0.02], [0.02, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 1]];
  const byEdge = edgeBands.map(([lo, hi]) => ({ band: `${lo}-${hi === 1 ? "+" : hi}`, ...summarize(graded.filter(r => r.edge != null && r.edge >= lo && r.edge < hi)) }));

  // ROI by odds band (HR is +money; longshots vs shorter prices behave differently)
  const oddsBands = [[-10000, 300], [300, 600], [600, 1000], [1000, 100000]];
  const byOdds = oddsBands.map(([lo, hi]) => ({ band: `${lo <= -10000 ? "<" : ""}${hi === 100000 ? "1000+" : `${lo}-${hi}`}`, ...summarize(graded.filter(r => r.odds != null && r.odds >= lo && r.odds < hi)) }));

  // Calibration: does model_prob mean anything?
  const probBins = [[0, 0.10], [0.10, 0.15], [0.15, 0.20], [0.20, 0.30], [0.30, 1]];
  const calibration = probBins.map(([lo, hi]) => {
    const set = graded.filter(r => r.model_prob != null && r.model_prob >= lo && r.model_prob < hi);
    return { bucket: `${lo}-${hi === 1 ? "+" : hi}`, n: set.length, meanModelProb: set.length ? +(set.reduce((a, r) => a + r.model_prob, 0) / set.length).toFixed(3) : null, actualHitRate: set.length ? +(set.filter(r => r.result === "win").length / set.length).toFixed(3) : null };
  });

  // Flag any slice that's +EV with >=30 picks
  const salvage = [...byEdge.map(b => ({ kind: "edge", ...b })), ...byOdds.map(b => ({ kind: "odds", ...b }))]
    .filter(b => b.roiPct != null && b.roiPct > 0 && b.n >= 30);

  // Candidate gate = keep HR only where edge <= 0.05 (low/modest-edge plays). Evaluate
  // it overall AND split by era so we know it isn't carried by the dead-Statcast period.
  const gateSet = (set) => set.filter(r => r.edge != null && r.edge <= 0.05);
  const candidateGate = { rule: "edge <= 0.05 (drop the inflated high-confidence region)", overall: summarize(gateSet(graded)) };
  let eraSplit = null;
  if (cutoff) {
    const before = graded.filter(r => r.game_date && r.game_date < cutoff);
    const after = graded.filter(r => r.game_date && r.game_date >= cutoff);
    const edgeBandsFor = (set) => edgeBands.map(([lo, hi]) => ({ band: `${lo}-${hi === 1 ? "+" : hi}`, ...summarize(set.filter(r => r.edge != null && r.edge >= lo && r.edge < hi)) }));
    eraSplit = {
      cutoff,
      beforeRebuild: { all: summarize(before), edgeBands: edgeBandsFor(before), candidateGate_edgeLte05: summarize(gateSet(before)) },
      afterRebuild: { all: summarize(after), edgeBands: edgeBandsFor(after), candidateGate_edgeLte05: summarize(gateSet(after)) },
      gateVerdictNote: "Trust the gate only if afterRebuild.candidateGate_edgeLte05 is clearly +EV with volume. If it's flat/negative post-rebuild, the +EV was a dead-Statcast-era artifact → trim HR instead.",
    };
  }

  return {
    ok: true, n, baseRate,
    overall: summarize(graded),
    byEdgeBand: byEdge,
    byOddsBand: byOdds,
    calibration,
    salvageableSlices: salvage,
    candidateGate,
    eraSplit,
    verdictNote: salvage.length
      ? "At least one slice is +EV with volume — consider GATING HR to it rather than trimming. Confirm it holds post-rebuild (pass ?hr_backtest=YYYY-MM-DD) before trusting it."
      : "No +EV slice with volume. The honest call is to TRIM HR from the recorded card (like the run line at -15%), or shelve it until the power factor is rebuilt and re-backtested.",
    method: "ROI = unit profit / decisions, real American odds, push excluded. Pass ?hr_backtest=YYYY-MM-DD to split the edge bands + candidate gate by era.",
  };
}

// ── READ-ONLY CLV (closing-line value) audit (added 2026-06-09) ─────────────────
// Answers "why is CLV flat?" by separating the THREE possible causes with facts:
//   (1) CAPTURE COVERAGE — what fraction of graded MLB ML/total picks ever got a
//       closing line at all. The capture cron runs every 30 min against a 35-min
//       pre-game window; if it misses, the pick has null closing/clv and reads as
//       "flat" when really it's ABSENT. Low coverage => a measurement/timing-of-
//       capture problem, not an edge problem.
//   (2) LINE MOVEMENT — for captured picks, how far the price actually moved from
//       our pick odds to the close (mean |move| in implied-prob points), and how
//       many moved ZERO. If we're pricing at/near the close, there's no room for
//       CLV by construction (zero-movement share high, mean move ~0).
//   (3) REAL EDGE — for captured picks with real movement, the signed CLV
//       distribution + % beat-close, split by market. CLV centered on 0 on an
//       efficient market is the honest "model agrees with the line" result.
// Also reports the record->close TIME GAP when a record timestamp exists (CLV can
// only exist when there's a gap between locking our price and the close). Writes
// NOTHING. clv is stored as a fraction (closeImplied - pickImplied); reported here
// as percentage POINTS for readability.
function _amerToImplied(a) {
  if (a == null || isNaN(a)) return null;
  const n = Number(a);
  return n < 0 ? (-n) / ((-n) + 100) : 100 / (n + 100);
}
function _median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function _pickRecordTs(r) {
  // model_predictions may or may not carry a record timestamp; read defensively.
  return r.created_at || r.inserted_at || r.recorded_at || null;
}
async function clvAudit() {
  const supabase = db();
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("model_predictions")
      .select("*")
      .eq("league", "mlb")
      .in("market", ["moneyline", "total", "run_line"])
      .in("result", ["win", "loss", "push"])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const b = data || [];
    rows.push(...b);
    if (b.length < PAGE) break;
  }

  const graded = rows.length;
  if (!graded) return { ok: true, graded: 0, note: "no graded MLB ML/total picks yet" };

  const recordTsAvailable = rows.some(r => _pickRecordTs(r) != null);

  // Per-pick derived view.
  const view = rows.map(r => {
    const captured = r.closing_odds != null;
    const pickImplied = _amerToImplied(r.odds);
    const closeImplied = _amerToImplied(r.closing_odds);
    // Prefer the stored clv (computed at capture time); fall back to recompute.
    let clv = r.clv;
    if (clv == null && pickImplied != null && closeImplied != null) clv = closeImplied - pickImplied;
    const moveAbs = (pickImplied != null && closeImplied != null) ? Math.abs(closeImplied - pickImplied) : null;
    const recTs = _pickRecordTs(r);
    const closeTs = r.closing_captured_at || null;
    const gapHours = (recTs && closeTs)
      ? (new Date(closeTs).getTime() - new Date(recTs).getTime()) / 3600000
      : null;
    return { market: r.market, selection: r.selection, line: r.line, odds: r.odds,
      closing_odds: r.closing_odds, captured, clv, moveAbs, beatClose: clv != null ? clv > 0 : null,
      gapHours, game_date: r.game_date, result: r.result };
  });

  const summarize = (set) => {
    const n = set.length;
    const cap = set.filter(v => v.captured);
    const withClv = cap.filter(v => v.clv != null);
    const clvs = withClv.map(v => v.clv);
    const moves = cap.filter(v => v.moveAbs != null).map(v => v.moveAbs);
    const zeroMove = moves.filter(m => m < 0.0005).length;
    const beat = withClv.filter(v => v.beatClose === true).length;
    const pct = (x, d) => d ? +(x / d * 100).toFixed(1) : null;
    const pp = (x) => x == null ? null : +(x * 100).toFixed(2); // fraction -> pct points
    return {
      graded: n,
      captured: cap.length,
      capturedPct: pct(cap.length, n),
      missingClosing: n - cap.length,
      withClv: withClv.length,
      meanClvPP: clvs.length ? pp(clvs.reduce((a, b) => a + b, 0) / clvs.length) : null,
      medianClvPP: clvs.length ? pp(_median(clvs)) : null,
      beatClosePct: pct(beat, withClv.length),
      minClvPP: clvs.length ? pp(Math.min(...clvs)) : null,
      maxClvPP: clvs.length ? pp(Math.max(...clvs)) : null,
      meanAbsMovePP: moves.length ? pp(moves.reduce((a, b) => a + b, 0) / moves.length) : null,
      zeroMovementPct: pct(zeroMove, moves.length),
    };
  };

  const ml = view.filter(v => v.market === "moneyline");
  const tot = view.filter(v => v.market === "total");
  const rl = view.filter(v => v.market === "run_line");

  // Coverage by game_date — the fast proof the capture fix is working. Pre-fix
  // dates stay ~50%; dates from the ratchet deploy (2026-06-09) forward should
  // climb toward ~90%+ as those slates grade in. Sorted newest-first.
  const FIX_DATE = "2026-06-09";
  const dateMap = {};
  for (const v of view) {
    const d = v.game_date || "unknown";
    (dateMap[d] ||= { graded: 0, captured: 0 });
    dateMap[d].graded++;
    if (v.captured) dateMap[d].captured++;
  }
  const byDateCoverage = Object.entries(dateMap)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, c]) => ({
      date, graded: c.graded, captured: c.captured,
      capturedPct: c.graded ? +(c.captured / c.graded * 100).toFixed(1) : null,
    }));
  // Pre/post split around the fix date for a one-glance verdict.
  const preFix = view.filter(v => v.game_date && v.game_date < FIX_DATE);
  const postFix = view.filter(v => v.game_date && v.game_date >= FIX_DATE);
  const covPct = (set) => set.length ? +(set.filter(v => v.captured).length / set.length * 100).toFixed(1) : null;
  const prePostCoverage = {
    fixDate: FIX_DATE,
    preFix: { graded: preFix.length, capturedPct: covPct(preFix) },
    postFix: { graded: postFix.length, capturedPct: covPct(postFix) },
    note: "preFix is frozen (those games already played under the old single-shot capture). postFix should trend ~90%+ as ratchet-era slates grade in; if postFix graded is still 0, no new slate has graded yet — re-check in a couple days.",
  };

  // Timing gap (record -> close), captured picks only.
  const gaps = view.filter(v => v.gapHours != null).map(v => v.gapHours);
  const timing = {
    recordTimestampAvailable: recordTsAvailable,
    nWithGap: gaps.length,
    meanGapHours: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : null,
    medianGapHours: gaps.length ? +(_median(gaps).toFixed(2)) : null,
    note: recordTsAvailable
      ? "Gap = hours between when the pick (and its odds) was recorded and when the closing line was captured. CLV needs this gap to exist; a tiny gap means we price near the close."
      : "No record timestamp column on model_predictions — can't measure the record->close gap directly. Infer timing from zeroMovementPct + meanAbsMovePP instead.",
  };

  // A small recent sample to eyeball.
  const sample = [...view]
    .filter(v => v.captured)
    .slice(-12)
    .map(v => ({
      game_date: v.game_date, market: v.market, selection: v.selection, line: v.line,
      odds: v.odds, closing_odds: v.closing_odds,
      clvPP: v.clv != null ? +(v.clv * 100).toFixed(2) : null,
      beatClose: v.beatClose, gapHours: v.gapHours != null ? +v.gapHours.toFixed(2) : null,
    }));

  // Factual flags (no spin) to point at the dominant cause.
  const overall = summarize(view);
  const flags = [];
  if (overall.capturedPct != null && overall.capturedPct < 70)
    flags.push(`LOW LIFETIME CAPTURE COVERAGE (${overall.capturedPct}% of all graded picks have a closing line). This is mostly the FROZEN pre-fix backlog (single-shot-capture era) dragging the lifetime average down — those games can't be recaptured. Judge capture health by prePostCoverage.postFix, not this lifetime number. The live ratchet uses a 120-min window with a 15-min cron (~8 ticks/game), so the mechanism is healthy; coverage converges up on its own as old picks age out.`);
  if (overall.zeroMovementPct != null && overall.zeroMovementPct >= 30)
    flags.push(`HIGH ZERO-MOVEMENT (${overall.zeroMovementPct}% of captured picks had ~no price change pick->close). Suggests we're pricing at/near the close (no room for CLV) or capturing a stale/identical line.`);
  if (overall.meanAbsMovePP != null && overall.meanAbsMovePP < 1.0)
    flags.push(`SMALL AVERAGE MOVEMENT (~${overall.meanAbsMovePP} pts pick->close). Little line travel to capture — consistent with pricing near the close.`);
  if (timing.meanGapHours != null && timing.meanGapHours < 1.0)
    flags.push(`SHORT RECORD->CLOSE GAP (mean ${timing.meanGapHours}h). Picks are recorded close to first pitch, leaving almost no window for the line to move our way.`);
  if (overall.withClv >= 30 && overall.meanClvPP != null && Math.abs(overall.meanClvPP) < 0.5 && (overall.zeroMovementPct == null || overall.zeroMovementPct < 30))
    flags.push(`CLV CENTERED ON ~0 WITH REAL MOVEMENT (mean ${overall.meanClvPP} pts, beat-close ${overall.beatClosePct}%). On the picks that DID move, we're neither beating nor losing the close — the honest "model ≈ market" result. Look market-by-market: totals is where the edge should show if anywhere.`);
  if (!flags.length) flags.push("No single cause dominates at these thresholds — read overall + byMarket + timing together.");

  if (prePostCoverage.postFix.graded > 0) {
    const pre = prePostCoverage.preFix.capturedPct, post = prePostCoverage.postFix.capturedPct;
    if (post != null && pre != null && post > pre + 15)
      flags.push(`CAPTURE FIX WORKING: post-fix coverage ${post}% vs pre-fix ${pre}% (over ${prePostCoverage.postFix.graded} graded ratchet-era picks). The ratchet is capturing closing lines as intended.`);
    else if (post != null)
      flags.push(`POST-FIX COVERAGE ${post}% over only ${prePostCoverage.postFix.graded} graded picks so far — small sample; give it a few more days before reading it.`);
  } else {
    flags.push("No ratchet-era (>= 2026-06-09) picks have GRADED yet, so capture coverage can't have moved — this is expected right after deploy. Re-run in 2-3 days.");
  }

  return {
    ok: true,
    league: "mlb",
    markets: ["moneyline", "total", "run_line"],
    graded,
    overall,
    byMarket: { moneyline: summarize(ml), total: summarize(tot), run_line: summarize(rl) },
    prePostCoverage,
    byDateCoverage,
    timing,
    sample,
    flags,
    legend: {
      clvPP: "closing implied prob - pick implied prob, in percentage POINTS. Positive = price shortened in our favor after we recorded = we beat the close.",
      capturedPct: "share of graded picks that actually have a closing line. Low = capture/timing problem, not an edge problem.",
      zeroMovementPct: "share of captured picks whose price didn't move pick->close. High = pricing at the close.",
      beatClosePct: "of picks with a real CLV value, share with positive CLV.",
    },
  };
}

module.exports = router;
