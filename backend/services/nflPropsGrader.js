// WZ-NFLPROPSGRADER-2026-07-05
// nflPropsGrader.js  —  WizePicks NFL player-props GRADER (Phase 3, B-3b, final piece).
//
// Closes the loop: finds ungraded player_*_shadow rows whose game has finished,
// resolves the ESPN game by matchup+date (the stored game_id is the Odds-API id, not
// ESPN's), pulls the box score, extracts the player's REAL stat with the confirmed
// extractor, and writes back { result, actual_value, graded_at } — the exact schema
// the MLB/NBA graders use. That turns the shadow log into a graded track record the
// props model calibrates against.
//
// Mirrors gradeNba/gradeNFL: one scoreboard fetch per date (cached), match across the
// stored date and +/-1 (a night game can file under a neighboring ET/UTC date),
// update by row id. A finished game where the player has NO box-score line (DNP or no
// recorded activity) is marked 'void' rather than assumed 0 — we don't fabricate an
// actual. Pure grading logic (gradeOutcome / gradeShadowRow / matchGame) is unit-tested
// offline; gradeNflPropShadows does the live DB + fetch work (verified in-season).
//
// Isolated module (own supabase client). Reuses nflPropsActuals (extractor + fetches)
// and nflPropsShadow.normalizeName so grader matching is identical to the logger's.
// CommonJS, Node 18+.

const { createClient } = require("@supabase/supabase-js");
const { extractBoxscoreActuals, fetchFinals, fetchSummary } = require("./nflPropsActuals");
const { normalizeName } = require("./nflPropsShadow");
const { teamKey } = require("./teamKey"); // WZ-TEAMKEY-SSOT-2026-07-17

const SHADOW_TO_BASE = {
  player_pass_yds_shadow: "pass_yds",
  player_rush_yds_shadow: "rush_yds",
  player_receptions_shadow: "receptions",
  player_rec_yds_shadow: "rec_yds",
};
const SHADOW_MARKETS = Object.keys(SHADOW_TO_BASE);

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }
function easternToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
// shift a YYYY-MM-DD by N days, anchored at noon UTC so no tz edge rolls the day
// (mirrors predictionTracker.shiftYmd).
function shiftYmd(dateStr, deltaDays) {
  if (!dateStr) return dateStr;
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// ── PURE: player name from a `${player}:OVER` selection ──────────────────────────
function playerFromSelection(selection) {
  return String(selection || "").replace(/:(OVER|UNDER)$/i, "").trim();
}

// ── PURE: match a "AWAY @ HOME" matchup to an ESPN scoreboard game ────────────────
function matchGame(matchup, games) {
  if (!matchup) return null;
  const parts = String(matchup).split(" @ ");
  if (parts.length !== 2) return null;
  const away = normalizeName(parts[0]), home = normalizeName(parts[1]);
  // WZ-TEAMKEY-SSOT-2026-07-17 :: canonical, collision-safe pass FIRST, scanned across ALL games.
  // Both teams must resolve to a canonical NFL key AND agree, so an abbreviated matchup ("SF @ SEA")
  // resolves reliably where the normalizeName substring pass is inconsistent ("sea" hits "seattle"
  // but "sf" misses "sanfrancisco"). This is a grading path, so precision matters; the normalizeName
  // exact/contains pass below is kept UNCHANGED as a fallback (reached only when canonical finds
  // nothing), so anything that matched before still matches.
  const aK = teamKey(parts[0], "nfl"), hK = teamKey(parts[1], "nfl");
  if (aK && hK) {
    for (const g of games || []) {
      if (teamKey(g.away, "nfl") === aK && teamKey(g.home, "nfl") === hK) return g;
    }
  }
  for (const g of games || []) {
    const gh = normalizeName(g.home), ga = normalizeName(g.away);
    if (!gh || !ga) continue;
    const exact = gh === home && ga === away;
    const contains = gh && ga && home && away && (gh.includes(home) || home.includes(gh)) && (ga.includes(away) || away.includes(ga));
    if (exact || contains) return g;
  }
  return null;
}

// ── PURE: Over result from actual vs line ────────────────────────────────────────
function gradeOutcome(actual, line) {
  if (actual == null || line == null) return null;
  if (actual === line) return "push";
  return actual > line ? "win" : "loss";
}

// ── PURE: grade one shadow row against a game's extracted actuals ─────────────────
// actualsByNorm: { [normalizedName]: { pass_yds, rush_yds, receptions, rec_yds } }
// Returns { result, actual_value } — 'void'/null when the player has no box-score line.
function gradeShadowRow(row, actualsByNorm) {
  const base = SHADOW_TO_BASE[row.market];
  if (!base) return null;
  const player = playerFromSelection(row.selection);
  const rec = actualsByNorm ? actualsByNorm[normalizeName(player)] : null;
  const actual = rec ? rec[base] : null;
  if (actual == null) return { result: "void", actual_value: null }; // DNP / no recorded line
  const result = gradeOutcome(actual, row.line);
  if (!result) return null;
  return { result, actual_value: actual };
}

// ── LIVE: grade all pending NFL prop-shadow rows (dryRun returns previews) ─────────
async function gradeNflPropShadows({ dryRun = false } = {}) {
  const supabase = db();
  const today = easternToday();
  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("id, game_id, game_date, matchup, market, selection, line")
    .eq("league", "nfl")
    .in("market", SHADOW_MARKETS)
    .is("result", null)
    .lte("game_date", today);
  if (error) { console.error("[NflPropGrader] select error:", error.message); return dryRun ? { error: error.message } : 0; }
  if (!pending || pending.length === 0) return dryRun ? { pending: 0, previews: [] } : 0;

  const sbCache = {};
  const boxCache = {};
  const boardFor = async (date) => {
    if (sbCache[date] !== undefined) return sbCache[date];
    try { sbCache[date] = await fetchFinals(date); } catch { sbCache[date] = null; }
    return sbCache[date];
  };
  const boxFor = async (eventId) => {
    if (boxCache[eventId] !== undefined) return boxCache[eventId];
    try { boxCache[eventId] = extractBoxscoreActuals(await fetchSummary(eventId)); } catch { boxCache[eventId] = null; }
    return boxCache[eventId];
  };

  let graded = 0;
  const previews = [];
  for (const p of pending) {
    let game = null;
    for (const d of [p.game_date, shiftYmd(p.game_date, -1), shiftYmd(p.game_date, 1)]) {
      const games = await boardFor(d);
      game = matchGame(p.matchup, games || []);
      if (game) break;
    }
    if (!game || !game.final) continue; // not found / not final yet -> stay pending
    const actuals = await boxFor(game.eventId);
    if (!actuals) continue;
    const outcome = gradeShadowRow(p, actuals);
    if (!outcome) continue;

    if (dryRun) {
      previews.push({ selection: p.selection, market: p.market, line: p.line, actual: outcome.actual_value, result: outcome.result });
      continue;
    }
    const { error: upErr } = await supabase
      .from("model_predictions")
      .update({ result: outcome.result, actual_value: outcome.actual_value, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!upErr) graded++;
  }

  if (dryRun) return { pending: pending.length, graded: previews.length, previews: previews.slice(0, 25) };
  if (graded) console.log(`[NflPropGrader] Graded ${graded} prop-shadow rows`);
  return graded;
}

module.exports = {
  gradeNflPropShadows,
  gradeShadowRow,
  gradeOutcome,
  matchGame,
  playerFromSelection,
  SHADOW_TO_BASE,
  SHADOW_MARKETS,
};
