// services/dailyCard.js — "Today's Card": one locked daily card (a single value
// pick + a small model parlay) assembled from the model's already-recorded
// value edges in model_predictions. Touches no edge math — it only reads picks
// the model already produced, packages them, and stores one card per day.
const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate } = require("./mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const QUALIFY = ["HIGH", "MEDIUM"];
const CARD_MARKETS = ["moneyline", "total"]; // low-variance core only — run_line/spread (margin bets) excluded from the daily card

// Scope = which sport(s) a card draws from. Each scope is its own locked, tracked
// daily card so subscribers can pick Mix / MLB / NBA from the dropdown.
const SCOPES = { mix: ["mlb", "nba"], mlb: ["mlb"], nba: ["nba"] };
function normScope(s) { return SCOPES[s] ? s : "mix"; }
function leaguesFor(scope) { return SCOPES[normScope(scope)]; }

// Returns the set of MLB game_ids that have NOT started yet (true pre-game), by
// status + start time from the live schedule. A daily card must only ever draw
// from games whose line hasn't closed — a pick on an already-live game reflects
// in-play odds, not a number a subscriber could actually still bet (this is what
// surfaced the in-game +4500 garbage). NBA status isn't sourced here yet, so NBA
// rows pass through unchanged (follow-up: wire an NBA schedule/status feed).
async function preGameMlbIds(date) {
  try {
    const schedule = await getScheduleForDate(date);
    const now = Date.now();
    const ids = new Set();
    for (const g of schedule) {
      const notStarted = g.status === "scheduled"
        && g.startTimeUTC && new Date(g.startTimeUTC).getTime() > now;
      if (notStarted) ids.add(String(g.id));
    }
    return ids;
  } catch (e) {
    console.error("[DailyCard] schedule fetch failed:", e.message);
    return null; // null = couldn't determine → caller leaves rows untouched (never hide real picks on an error)
  }
}

// Keep only picks whose game is still pre-game. MLB is gated by the schedule;
// NBA passes through (no status source yet). On a schedule error (mlbSet null)
// nothing is stripped.
function keepPreGame(rows, mlbSet) {
  if (!mlbSet) return rows;
  return rows.filter(p => p.league !== "mlb" || mlbSet.has(String(p.game_id)));
}

// American <-> decimal helpers.
function toDecimal(a) {
  if (a == null) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}
function toAmerican(dec) {
  if (dec == null || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}
function round4(n) { return Math.round(n * 10000) / 10000; }

function legFrom(p) {
  return {
    predictionId: p.id,
    league: p.league,
    gameId: p.game_id,
    matchup: p.matchup,
    market: p.market,
    selection: p.selection,
    description: p.description,
    odds: p.odds,
    modelProb: p.model_prob,
    edge: p.edge,
    line: p.line,
    confidence: p.confidence,
  };
}

// Returns today's card, generating + locking it on first call of the day.
async function getOrGenerateDailyCard(scope = "mix") {
  scope = normScope(scope);
  const leagues = leaguesFor(scope);
  const supabase = db();
  const date = getEasternDate(0);

  const { data: existing } = await supabase
    .from("daily_card").select("*").eq("game_date", date).eq("scope", scope).maybeSingle();
  if (existing) return existing;

  // Today's qualified, positive-edge, not-yet-started picks, best edge first.
  const { data: preds } = await supabase
    .from("model_predictions")
    .select("id, league, game_id, matchup, market, selection, description, model_prob, odds, edge, confidence, line")
    .in("league", leagues)
    .eq("game_date", date)
    .eq("result", "pending")
    .in("market", CARD_MARKETS)
    .gt("edge", 0)
    .order("edge", { ascending: false });

  const qualified = (preds || []).filter(p =>
    QUALIFY.includes((p.confidence || "").toUpperCase()) && p.odds != null && p.model_prob != null);

  // Drop any pick whose game has already started — the card must only ever lock
  // pre-game prices a subscriber could still actually bet.
  const mlbSet = await preGameMlbIds(date);
  const rows = keepPreGame(qualified, mlbSet);

  // No pre-game picks left. Distinguish "edges haven't computed yet" (notReady)
  // from "every game today has already started" (allStarted) so the UI can tell
  // subscribers which it is. Neither state locks a card.
  if (rows.length === 0) {
    const allStarted = qualified.length > 0; // we HAD qualified picks; they've all started
    return { game_date: date, scope, single: null, parlay: null, single_result: "pending", parlay_result: "pending", notReady: !allStarted, allStarted };
  }

  // Single = best value pick.
  const single = legFrom(rows[0]);

  // Parlay = best picks from DISTINCT games (2-3 legs).
  const legs = [];
  const usedGames = new Set();
  for (const p of rows) {
    if (usedGames.has(p.game_id)) continue;
    usedGames.add(p.game_id);
    legs.push(legFrom(p));
    if (legs.length >= 3) break;
  }
  let parlay = null;
  if (legs.length >= 2) {
    const used = legs.slice(0, legs.length >= 3 ? 3 : 2);
    const bookDec = used.reduce((a, l) => a * toDecimal(l.odds), 1);
    const combinedModelProb = used.reduce((a, l) => a * l.modelProb, 1);
    const bookImplied = 1 / bookDec;
    parlay = {
      legs: used,
      bookOdds: toAmerican(bookDec),
      fairOdds: toAmerican(1 / combinedModelProb),
      modelProb: round4(combinedModelProb),
      edge: round4(combinedModelProb - bookImplied), // + = model sees value vs the book payout
    };
  }

  const card = { game_date: date, scope, single, parlay, single_result: "pending", parlay_result: "pending" };
  await supabase.from("daily_card").upsert(card, { onConflict: "game_date,scope" });
  return card;
}

// Rolls up card results from the linked prediction rows (graded by the existing
// grader). Single = its leg's result. Parlay = win iff every leg wins (push is
// treated as a surviving leg), loss if any leg loses, else still pending.
async function gradeDailyCard() {
  const supabase = db();
  const { data: cards } = await supabase
    .from("daily_card").select("*")
    .or("single_result.eq.pending,parlay_result.eq.pending");
  if (!cards || cards.length === 0) return 0;

  let graded = 0;
  for (const card of cards) {
    const ids = [];
    if (card.single?.predictionId) ids.push(card.single.predictionId);
    for (const l of card.parlay?.legs || []) if (l.predictionId) ids.push(l.predictionId);
    if (ids.length === 0) continue;

    const { data: preds } = await supabase
      .from("model_predictions").select("id, result").in("id", ids);
    const byId = {};
    for (const p of preds || []) byId[p.id] = p.result;

    const upd = {};
    if (card.single_result === "pending" && card.single?.predictionId) {
      const r = byId[card.single.predictionId];
      if (r && r !== "pending") upd.single_result = r;
    }
    if (card.parlay_result === "pending" && card.parlay?.legs?.length) {
      const results = card.parlay.legs.map(l => byId[l.predictionId]);
      if (results.some(r => !r || r === "pending")) {
        // leave pending
      } else if (results.some(r => r === "loss")) {
        upd.parlay_result = "loss";
      } else {
        upd.parlay_result = "win";
      }
    }
    if (Object.keys(upd).length) {
      upd.graded_at = new Date().toISOString();
      await supabase.from("daily_card").update(upd).eq("game_date", card.game_date).eq("scope", card.scope);
      graded++;
    }
  }
  return graded;
}

// Aggregates the card's settled history into single + parlay records (W-L,
// ROI per 1u stake) plus a recent history list. Parlay is tracked by ROI with a
// high-variance framing — a parlay loses most days even when it's priced right.
async function getDailyCardRecord(scope = "mix") {
  scope = normScope(scope);
  const supabase = db();
  const { data: cards } = await supabase
    .from("daily_card").select("*").eq("scope", scope).order("game_date", { ascending: false });
  const rows = cards || [];

  const single = { wins: 0, losses: 0, profit: 0, settled: 0 };
  const parlay = { wins: 0, losses: 0, profit: 0, settled: 0 };
  const history = [];

  for (const c of rows) {
    if (c.single && (c.single_result === "win" || c.single_result === "loss")) {
      single.settled++;
      if (c.single_result === "win") { single.wins++; single.profit += toDecimal(c.single.odds) - 1; }
      else { single.losses++; single.profit -= 1; }
    }
    if (c.parlay && (c.parlay_result === "win" || c.parlay_result === "loss")) {
      parlay.settled++;
      if (c.parlay_result === "win") { parlay.wins++; parlay.profit += toDecimal(c.parlay.bookOdds) - 1; }
      else { parlay.losses++; parlay.profit -= 1; }
    }
    history.push({
      date: c.game_date,
      single: c.single ? { description: c.single.description, matchup: c.single.matchup, odds: c.single.odds, result: c.single_result } : null,
      parlay: c.parlay ? { legs: (c.parlay.legs || []).length, bookOdds: c.parlay.bookOdds, result: c.parlay_result } : null,
    });
  }

  const roi = (g) => (g.settled > 0 ? round4(g.profit / g.settled) : null);
  return {
    single: { wins: single.wins, losses: single.losses, settled: single.settled, roi: roi(single) },
    parlay: { wins: parlay.wins, losses: parlay.losses, settled: parlay.settled, roi: roi(parlay) },
    history: history.slice(0, 30),
  };
}

// Personal re-roll (Option A): returns ONE alternate value pick that is NOT the
// official single — for a subscriber who wants "show me another play." Read-only:
// it never writes, locks, or grades anything, so the shared/tracked card is
// untouched. Picks randomly from the day's top value edges (excluding the
// official one) so it's varied but still genuinely value-backed — never random.
async function getAlternatePick(scope = "mix") {
  scope = normScope(scope);
  const leagues = leaguesFor(scope);
  const supabase = db();
  const date = getEasternDate(0);

  const { data: existing } = await supabase
    .from("daily_card").select("single").eq("game_date", date).eq("scope", scope).maybeSingle();
  const officialId = existing?.single?.predictionId || null;

  const { data: preds } = await supabase
    .from("model_predictions")
    .select("id, league, game_id, matchup, market, selection, description, model_prob, odds, edge, confidence, line")
    .in("league", leagues)
    .eq("game_date", date)
    .eq("result", "pending")
    .in("market", CARD_MARKETS)
    .gt("edge", 0)
    .order("edge", { ascending: false });

  const qualified = (preds || []).filter(p =>
    QUALIFY.includes((p.confidence || "").toUpperCase()) &&
    p.odds != null && p.model_prob != null && p.id !== officialId);

  // Only ever offer an alternate on a game that hasn't started.
  const mlbSet = await preGameMlbIds(date);
  const rows = keepPreGame(qualified, mlbSet);

  if (rows.length === 0) return { pick: null, allStarted: qualified.length > 0 };

  // Random among the top value picks for variety, still a real edge.
  const pool = rows.slice(0, 8);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { pick: legFrom(pick) };
}

module.exports = { getOrGenerateDailyCard, gradeDailyCard, getDailyCardRecord, getAlternatePick };
