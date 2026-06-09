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
  getGameBatterHits, normPlayerName, getEasternDate, getLinescore, getGameStatusAndScore,
} = require("../services/mlbStatsApi");
const { getRawTotalsDebug } = require("../services/oddsApi");
const { probeExpectedStats, probeBarrels } = require("../services/savantApi");
const { fetchScoreboard } = require("../services/nbaDataSource"); // TEMP: nba_audit probe (6/8)

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
    if (req.query.barrel_probe === "1" || req.query.barrel_probe === "true") return res.json(await probeBarrels());
    if (req.query.totals_debug != null) return res.json(await getRawTotalsDebug(req.query.totals_debug));
    if (req.query.totals_audit === "1" || req.query.totals_audit === "true") return res.json(await totalsAudit());
    if (req.query.score_probe === "1" || req.query.score_probe === "true") return res.json(await scoreProbe());
    if (req.query.game_audit != null) return res.json(await getGameStatusAndScore(req.query.game_audit));
    if (req.query.nba_audit === "1" || req.query.nba_audit === "true") return res.json(await nbaAudit());
    if (req.query.ml_backtest === "1" || req.query.ml_backtest === "true") return res.json(await mlBacktest());
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

// TEMP read-only diagnostic: for each pending MLB game, show what the SCHEDULE
// reports for status + scores vs what a direct LINESCORE read returns. No writes.
async function scoreProbe() {
  const mlb = await pendingMlb();
  const byDate = {};
  for (const p of mlb) (byDate[p.game_date] ||= []).push(p);
  const out = [];
  for (const [date, preds] of Object.entries(byDate)) {
    let schedule = [];
    try { schedule = await getScheduleForDate(date); } catch (_) {}
    const sched = {};
    for (const g of schedule) sched[String(g.id)] = g;
    const seen = new Set();
    for (const p of preds) {
      const id = String(p.game_id);
      if (seen.has(id)) continue; seen.add(id);
      const g = sched[id];
      let ls = null;
      try { ls = await getLinescore(id); } catch (_) {}
      out.push({
        date, game_id: id,
        inSchedule: !!g,
        schedStatus: g ? g.status : null,
        schedAwayScore: g ? (g.awayScore ?? null) : null,
        schedHomeScore: g ? (g.homeScore ?? null) : null,
        lsAwayRuns: ls && ls.teams && ls.teams.away ? (ls.teams.away.runs ?? null) : null,
        lsHomeRuns: ls && ls.teams && ls.teams.home ? (ls.teams.home.runs ?? null) : null,
        lsTeamsKeys: ls && ls.teams ? Object.keys(ls.teams) : null,
        lsTopKeys: ls ? Object.keys(ls).slice(0, 12) : null,
      });
    }
  }
  return { ok: true, games: out };
}

// ── TEMP read-only diagnostic (added 6/8) — REMOVE in the next cleanup ──────────
// Root-causes stuck NBA picks (e.g. the 3 on 401859965) the SAME WAY gradeNba sees
// the world: via the real ESPN scoreboard (fetchScoreboard). gradeNba finds a team
// pick's game with `fetchScoreboard(p.game_date).find(x => String(x.gameId)===id)`
// and only grades when `state==="post"` with scores. The two ways that silently
// fails forever are (a) the game is filed by ESPN under a DIFFERENT date than the
// one we stored (date-bucket mismatch), so the lookup never finds it, or (b) the id
// genuinely isn't on ESPN for any nearby date. This probe checks the stored date AND
// date±1 so we can tell those apart instead of voiding blind. Writes NOTHING.
function shiftDate(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T12:00:00Z`); // noon UTC avoids any DST/tz roll
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function pendingNba() {
  const supabase = db();
  const { data, error } = await supabase
    .from("model_predictions")
    .select("id,league,market,selection,line,game_id,game_date,result")
    .eq("result", "pending")
    .eq("league", "nba");
  if (error) throw new Error(error.message);
  return data || [];
}

async function nbaAudit() {
  const pend = await pendingNba();
  if (!pend.length) return { ok: true, pendingNba: 0, note: "No pending NBA picks." };

  // Build the set of dates we must fetch: each stored date and its neighbors.
  const dates = new Set();
  for (const p of pend) {
    if (!p.game_date) continue;
    dates.add(p.game_date);
    dates.add(shiftDate(p.game_date, -1));
    dates.add(shiftDate(p.game_date, +1));
  }

  // One scoreboard fetch per date; index games by id for each date.
  const boardByDate = {}; // date -> { gameId -> game }
  for (const date of dates) {
    try {
      const games = await fetchScoreboard(date);
      const idx = {};
      for (const g of games || []) idx[String(g.gameId)] = g;
      boardByDate[date] = idx;
    } catch (e) {
      boardByDate[date] = { __error: e.message };
    }
  }

  const describe = (g) => g && !g.__error ? {
    state: g.state,
    homeName: g.home?.displayName ?? null, homeScore: g.home?.score ?? null,
    awayName: g.away?.displayName ?? null, awayScore: g.away?.score ?? null,
  } : null;

  const rows = pend.map((p) => {
    const id = String(p.game_id);
    const onDate = boardByDate[p.game_date]?.[id] || null;
    const onPrev = boardByDate[shiftDate(p.game_date, -1)]?.[id] || null;
    const onNext = boardByDate[shiftDate(p.game_date, +1)]?.[id] || null;
    const matchDate = onDate ? p.game_date : onPrev ? shiftDate(p.game_date, -1) : onNext ? shiftDate(p.game_date, +1) : null;
    const matched = onDate || onPrev || onNext || null;

    let verdict;
    if (!matched) verdict = "id_not_found_on_any_date"; // wrong id, or game not on ESPN near this date
    else if (matched.state !== "post") verdict = `not_final (state=${matched.state})`;
    else if (matched.home?.score == null || matched.away?.score == null) verdict = "final_but_no_score";
    else if (onDate) verdict = "GRADEABLE_NOW_on_stored_date"; // grader *should* settle it → look elsewhere
    else verdict = `DATE_BUCKET_MISMATCH (stored ${p.game_date}, ESPN files it ${matchDate})`; // ROOT CAUSE candidate

    return {
      id: p.id, game_id: id, game_date: p.game_date,
      market: p.market, selection: p.selection, line: p.line,
      foundOn: { stored: !!onDate, prevDay: !!onPrev, nextDay: !!onNext },
      espnMatchDate: matchDate,
      game: describe(matched),
      verdict,
    };
  });

  return {
    ok: true,
    pendingNba: pend.length,
    datesFetched: Object.fromEntries(Object.entries(boardByDate).map(([d, idx]) => [d, idx.__error ? { error: idx.__error } : { games: Object.keys(idx).length }])),
    rows,
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

module.exports = router;
