// services/dailyCard.js — "Today's Card": one locked daily card (a single value
// pick + a small model parlay) assembled from the model's already-recorded
// value edges in model_predictions. Touches no edge math — it only reads picks
// the model already produced, packages them, and stores one card per day.
const { createClient } = require("@supabase/supabase-js");
const { getEasternDate } = require("./mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const QUALIFY = ["HIGH", "MEDIUM"];
const CARD_MARKETS = ["moneyline", "total", "run_line"]; // no longshot HR props on the card

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
async function getOrGenerateDailyCard() {
  const supabase = db();
  const date = getEasternDate(0);

  const { data: existing } = await supabase
    .from("daily_card").select("*").eq("game_date", date).maybeSingle();
  if (existing) return existing;

  // Today's qualified, positive-edge, not-yet-started picks, best edge first.
  const { data: preds } = await supabase
    .from("model_predictions")
    .select("id, game_id, matchup, market, selection, description, model_prob, odds, edge, confidence, line")
    .eq("league", "mlb")
    .eq("game_date", date)
    .eq("result", "pending")
    .in("market", CARD_MARKETS)
    .gt("edge", 0)
    .order("edge", { ascending: false });

  const rows = (preds || []).filter(p =>
    QUALIFY.includes((p.confidence || "").toUpperCase()) && p.odds != null && p.model_prob != null);

  // Not enough data yet (edges haven't computed today) — return an unsaved
  // "not ready" shell so the UI can show a friendly waiting state. We only
  // LOCK (save) a card once there's something real to lock.
  if (rows.length === 0) {
    return { game_date: date, single: null, parlay: null, single_result: "pending", parlay_result: "pending", notReady: true };
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

  const card = { game_date: date, single, parlay, single_result: "pending", parlay_result: "pending" };
  await supabase.from("daily_card").upsert(card, { onConflict: "game_date" });
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
      await supabase.from("daily_card").update(upd).eq("game_date", card.game_date);
      graded++;
    }
  }
  return graded;
}

module.exports = { getOrGenerateDailyCard, gradeDailyCard };
