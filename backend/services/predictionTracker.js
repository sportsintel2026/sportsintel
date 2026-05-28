// Prediction tracker — snapshots model predictions and grades them after games finish.
//
// recordPredictions(result)  → called after edges compute; inserts one row per
//   game+market+selection per day (the unique constraint dedups automatically,
//   so "lock at first sighting" needs no extra logic).
//
// gradeFinishedGames()  → called by cron; finds pending predictions whose games
//   are final and marks win/loss/push.

const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate } = require("./mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── RECORD ────────────────────────────────────────────────────────────────────
// Snapshots every edge the model surfaced today. Only records games that are
// NOT yet final (we want pre-game predictions, not post-hoc).
async function recordPredictions(result) {
  if (!result || !Array.isArray(result.games)) return;
  const supabase = db();
  const gameDate = result.date || getEasternDate(0);
  const rows = [];

  // Build a quick lookup of game status by id (skip finals)
  const statusById = {};
  for (const g of result.games) statusById[g.id] = g.status;

  // Moneyline — record both sides when an edge exists
  for (const e of result.moneylineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "moneyline", selection: e.side,
      description: `${e.teamAbbr} ML`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: null,
    });
  }

  // Totals
  for (const e of result.totalsEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "total", selection: e.side,
      description: `${e.side === "over" ? "Over" : "Under"} ${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: e.line,
    });
  }

  // HR props
  for (const e of result.hrPropEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.game, market: "hr_prop", selection: e.player,
      description: `${e.player} HR`,
      model_prob: e.hrProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: null,
    });
  }

  if (rows.length === 0) return;

  // Defensive: drop any row missing a game_id (shouldn't happen, but the DB
  // not-null constraint will reject the whole batch if even one is null).
  const validRows = rows.filter(r => r.game_id);
  const dropped = rows.length - validRows.length;
  if (dropped > 0) {
    console.warn(`[Tracker] Dropped ${dropped} rows missing game_id`);
  }
  if (validRows.length === 0) return;

  try {
    // upsert with ignoreDuplicates: the unique constraint (game_id, market,
    // selection, game_date) means re-runs during the day are no-ops.
    const { error } = await supabase
      .from("model_predictions")
      .upsert(validRows, {
        onConflict: "game_id,market,selection,game_date",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("[Tracker] record error:", error.message);
    } else {
      console.log(`[Tracker] Snapshotted ${validRows.length} predictions for ${gameDate} (dups ignored)`);
    }
  } catch (e) {
    console.error("[Tracker] record exception:", e.message);
  }
}

// ── GRADE ─────────────────────────────────────────────────────────────────────
// Finds pending predictions for finished games and marks them.
async function gradeFinishedGames() {
  const supabase = db();

  // Pull pending predictions from the last few days
  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("result", "pending");

  if (error) { console.error("[Tracker] grade fetch error:", error.message); return; }
  if (!pending || pending.length === 0) { console.log("[Tracker] No pending predictions to grade"); return; }

  // Group pending predictions by date so we fetch each day's schedule once
  const byDate = {};
  for (const p of pending) (byDate[p.game_date] ||= []).push(p);

  let graded = 0;

  for (const [date, preds] of Object.entries(byDate)) {
    let schedule;
    try { schedule = await getScheduleForDate(date); }
    catch (e) { console.error(`[Tracker] schedule fetch failed for ${date}:`, e.message); continue; }

    const gameById = {};
    for (const g of schedule) gameById[g.id] = g;

    for (const p of preds) {
      const g = gameById[p.game_id];
      if (!g || g.status !== "final") continue; // not finished yet
      if (g.awayScore == null || g.homeScore == null) continue;

      const outcome = gradeOne(p, g);
      if (!outcome) continue;

      const { error: upErr } = await supabase
        .from("model_predictions")
        .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) graded++;
    }
  }

  console.log(`[Tracker] Graded ${graded} predictions`);
  return graded;
}

// Decide win/loss/push for a single prediction given the final game
function gradeOne(p, g) {
  const total = g.awayScore + g.homeScore;
  const awayWon = g.awayScore > g.homeScore;

  if (p.market === "moneyline") {
    const pickedAway = p.selection === "away";
    const won = pickedAway ? awayWon : !awayWon;
    return { result: won ? "win" : "loss", actual: awayWon ? 0 : 1 };
  }

  if (p.market === "total") {
    if (p.line == null) return null;
    if (total === p.line) return { result: "push", actual: total };
    const wentOver = total > p.line;
    const won = p.selection === "over" ? wentOver : !wentOver;
    return { result: won ? "win" : "loss", actual: total };
  }

  if (p.market === "hr_prop") {
    // We don't have per-player HR results from the schedule endpoint alone.
    // Mark as 'ungraded_hr' so it's excluded from win% until we add boxscore parsing.
    return { result: "push", actual: null }; // treat as no-action for now
  }

  return null;
}

module.exports = { recordPredictions, gradeFinishedGames };
