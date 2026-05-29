// Prediction tracker — snapshots model predictions and grades them after games finish.
//
// recordPredictions(result)  → MLB: inserts one row per game+market+selection per day.
// recordNbaPropPredictions(proj, gameIso) → NBA: snapshots flagged prop edges pre-game.
// gradeFinishedGames()  → cron: grades pending MLB (team scores) and NBA (player gamelog).

const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate } = require("./mlbStatsApi");
const { fetchGamelog } = require("./nbaGamelog");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ISO timestamp -> Eastern calendar date "YYYY-MM-DD" (dependency-free).
function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch { return null; }
}

// ── RECORD (MLB) ────────────────────────────────────────────────────────────────
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

// ── RECORD (NBA player props) ───────────────────────────────────────────────────
// `proj` is the output of getNbaPropProjections. We record only FLAGGED edges
// (the model's actual picks) — suspects are deliberately excluded.
// selection encodes "athleteId:SIDE" so it's unique per player/stat/side AND
// carries the athlete id we need at grading time (no schema change needed).
async function recordNbaPropPredictions(proj, gameIso) {
  if (!proj || proj.available === false || !Array.isArray(proj.players)) return;
  const supabase = db();
  const gameDate = etDate(gameIso) || getEasternDate(0);
  const matchup = `${proj.away} @ ${proj.home}`;
  const rows = [];

  for (const pl of proj.players) {
    if (!pl.athleteId || !pl.markets) continue;
    for (const stat of ["points", "rebounds", "assists"]) {
      const mk = pl.markets[stat];
      if (!mk || !mk.flagged) continue; // picks only
      // Probability proxy: how often the recent window landed on our side.
      const overRate = typeof mk.overRate === "number" ? mk.overRate : 0.5;
      const prob = mk.side === "OVER" ? overRate : 1 - overRate;
      rows.push({
        game_id: String(proj.gameId), game_date: gameDate, league: "nba",
        matchup, market: `player_${stat}`,
        selection: `${pl.athleteId}:${mk.side}`,
        description: `${pl.name} ${stat} ${mk.side} ${mk.line}`,
        model_prob: prob, odds: -110, edge: mk.edge, confidence: prob, line: mk.line,
      });
    }
  }

  if (rows.length === 0) return;

  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, {
        onConflict: "game_id,market,selection,game_date",
        ignoreDuplicates: true,
      });
    if (error) console.error("[Tracker] nba record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} NBA prop picks for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] nba record exception:", e.message);
  }
}

// ── GRADE ─────────────────────────────────────────────────────────────────────
// Finds pending predictions for finished games and marks them. MLB is graded
// from team scores via the schedule; NBA props from each player's gamelog.
async function gradeFinishedGames() {
  const supabase = db();

  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("result", "pending");

  if (error) { console.error("[Tracker] grade fetch error:", error.message); return; }
  if (!pending || pending.length === 0) { console.log("[Tracker] No pending predictions to grade"); return; }

  const nbaPending = pending.filter(p => p.league === "nba");
  const mlbPending = pending.filter(p => p.league !== "nba");

  let graded = 0;
  graded += await gradeMlb(supabase, mlbPending);
  graded += await gradeNba(supabase, nbaPending);

  console.log(`[Tracker] Graded ${graded} predictions`);
  return graded;
}

// MLB grading — unchanged logic, scoped to MLB rows.
async function gradeMlb(supabase, pending) {
  if (!pending.length) return 0;

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
      if (!g || g.status !== "final") continue;
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
  return graded;
}

// NBA prop grading — pull each player's gamelog once, read the stat for the game.
async function gradeNba(supabase, pending) {
  if (!pending.length) return 0;

  const logCache = {}; // athleteId -> parsed games (one fetch per athlete per run)
  let graded = 0;

  for (const p of pending) {
    const [athleteId, side] = String(p.selection || "").split(":");
    if (!athleteId || !side) continue;

    let games = logCache[athleteId];
    if (!games) {
      try { games = await fetchGamelog(athleteId); logCache[athleteId] = games; }
      catch (e) { continue; } // try again next run
    }

    const g = games.find(x => String(x.eventId) === String(p.game_id));
    if (!g || !(g.minutes > 0)) continue; // not played yet (or DNP) → stay pending

    const outcome = gradeNbaProp(p, g, side);
    if (!outcome) continue;

    const { error: upErr } = await supabase
      .from("model_predictions")
      .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!upErr) graded++;
  }
  return graded;
}

// PURE: grade one NBA prop row against the player's finished game line.
function gradeNbaProp(p, game, side) {
  const stat = String(p.market || "").replace("player_", ""); // points|rebounds|assists
  const actual = game[stat];
  if (actual == null) return null;
  if (p.line == null) return null;
  if (actual === p.line) return { result: "push", actual };
  const won = side === "OVER" ? actual > p.line : actual < p.line;
  return { result: won ? "win" : "loss", actual };
}

// Decide win/loss/push for a single MLB prediction given the final game
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
    return { result: "push", actual: null }; // no-action until boxscore parsing
  }

  return null;
}

module.exports = { recordPredictions, recordNbaPropPredictions, gradeFinishedGames, gradeNbaProp };
