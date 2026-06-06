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
const { gradeFinishedGames } = require("../services/predictionTracker");
const {
  getScheduleForDate, getGameHRHitters, getGamePitcherStrikeouts,
  getGameBatterHits, normPlayerName, getEasternDate,
} = require("../services/mlbStatsApi");
const { getRawTotalsDebug } = require("../services/oddsApi");
const { probeExpectedStats } = require("../services/savantApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

router.get("/", async (req, res) => {
  try {
    if (req.query.debug === "1" || req.query.debug === "true") return res.json(await debugReport());
    if (req.query.probe === "1" || req.query.probe === "true") return res.json(await probeReport());
    if (req.query.void_unmatched === "1" || req.query.void_unmatched === "true") return res.json(await voidUnmatched());
    if (req.query.counts === "1" || req.query.counts === "true") return res.json(await countsReport());
    if (req.query.prop_results === "1" || req.query.prop_results === "true") return res.json(await propResults());
    if (req.query.hr_tiers === "1" || req.query.hr_tiers === "true") return res.json(await hrTiers());
    if (req.query.savant_probe === "1" || req.query.savant_probe === "true") return res.json(await probeExpectedStats());
    if (req.query.totals_debug != null) return res.json(await getRawTotalsDebug(req.query.totals_debug));
    if (req.query.totals_audit === "1" || req.query.totals_audit === "true") return res.json(await totalsAudit());
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
          else box = { ok: "n/a (team market)" };
        } catch (e) { box = { ok: false, threw: e.message }; }
        boxCache.set(key, box);
      }

      const map = box && (box.hits || box.ks || box.hr);
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

// Mirror grade-time name matching: exact normalized, then UNIQUE last-name+initial.
function localResolve(map, playerName) {
  if (!(map instanceof Map)) return { found: false, value: null };
  const target = normPlayerName(playerName);
  if (!target) return { found: false, value: null };
  if (map.has(target)) return { found: true, value: map.get(target) };
  const parts = target.split(" ");
  if (parts.length >= 2) {
    const fi = parts[0][0], last = parts[parts.length - 1];
    const hits = [];
    for (const [name, v] of map.entries()) {
      const np = name.split(" ");
      if (np.length >= 2 && np[np.length - 1] === last && np[0][0] === fi) hits.push(v);
    }
    if (hits.length === 1) return { found: true, value: hits[0] };
  }
  return { found: false, value: null };
}

// WRITES. Mark prop picks "push" (no action) when their game is FINAL, the box read
// SUCCEEDS, and the player is provably absent (wrong-game assignment or a DNP). Such
// picks can never grade and would otherwise sit pending forever. Conservative: never
// touches a pick whose box can't be read (left pending to retry) or whose player is
// found (that grades normally). Idempotent.
async function voidUnmatched() {
  const supabase = db();
  const PROP = new Set(["hr_prop", "player_strikeouts", "player_hits"]);
  const props = (await pendingMlb()).filter(p => PROP.has(p.market));

  const byDate = {};
  for (const p of props) (byDate[p.game_date] ||= []).push(p);

  const schedCache = {};
  const boxCache = new Map();
  let voided = 0, finalChecked = 0;
  const details = [];

  for (const [date, preds] of Object.entries(byDate)) {
    if (!schedCache[date]) {
      try { const sgs = await getScheduleForDate(date); const m = {}; for (const g of sgs) m[String(g.id)] = g; schedCache[date] = m; }
      catch { schedCache[date] = {}; }
    }
    const sched = schedCache[date];
    for (const p of preds) {
      const g = sched[String(p.game_id)];
      if (!g || g.status !== "final") continue;     // only final games
      finalChecked++;

      const key = `${p.market}:${p.game_id}`;
      let box;
      if (boxCache.has(key)) box = boxCache.get(key);
      else {
        try {
          if (p.market === "player_strikeouts") box = await getGamePitcherStrikeouts(p.game_id);
          else if (p.market === "player_hits") box = await getGameBatterHits(p.game_id);
          else box = await getGameHRHitters(p.game_id);
        } catch { box = { ok: false }; }
        boxCache.set(key, box);
      }
      if (!box || !box.ok) continue;                // unreadable → leave pending, retry later

      const map = box.hits || box.ks || box.hr;
      const ci = p.selection.lastIndexOf(":");
      const pname = (p.market === "hr_prop") ? p.selection : (ci >= 0 ? p.selection.slice(0, ci) : p.selection);
      const { found } = localResolve(map, pname);
      if (found) continue;                          // would grade normally → don't void

      const { error: upErr } = await supabase
        .from("model_predictions")
        .update({ result: "push", actual_value: null, graded_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) { voided++; details.push({ market: p.market, game_id: String(p.game_id), selection: p.selection }); }
    }
  }
  return { ok: true, finalPropsChecked: finalChecked, voided, details };
}

// READ-ONLY. Real graded vs pending counts so nothing is taken on faith:
// overall, per market, and per recent date. "graded" = result is not pending
// (win/loss/push). Uses head:true count queries (no rows fetched).
async function countsReport() {
  const supabase = db();
  const LEAGUE = "mlb";

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

  const markets = ["moneyline", "total", "run_line", "hr_prop", "player_strikeouts", "player_hits"];
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

  return { ok: true, overall, byMarket, byDate };
}

// READ-ONLY. Every graded K / hits pick with projection vs actual, plus per-side
// aggregates — the raw material for calibrating the projections.
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

module.exports = router;
