// WZ-NFLPROPSSHADOW-2026-07-05
// nflPropsShadow.js  —  WizePicks NFL player-props SHADOW logger (Phase 3, B-2).
//
// Pairs each imminent book prop line with the model's projection and snapshots the
// model's Over probability into model_predictions, so the props model builds a graded
// track record to calibrate against — exactly like the MLB hits/K shadows. Publishes
// NOTHING; distinct `player_*_shadow` market strings keep it off every live surface.
//
// Mirrors the proven writers (recordHitsShadow / recordNFLPredictions):
//   • IMMINENCE GATE — only games within NFL_IMMINENT_DAYS. getNflPropLines already
//     windows by daysAhead, so this is a NO-OP all offseason (nearest game ~68d out)
//     and comes alive the week before the opener. We also bail BEFORE the expensive
//     roster crawl when no lines exist, so the offseason cost is one free events call.
//   • COLUMN REUSE (zero migration): model_prob = model Over prob; line = book line;
//     odds = book Over price; expected_ks = projected mean; proj_ip = games sample;
//     k_rate = market de-vig Over prob (so model-vs-market divergence is queryable).
//   • matchup is LOAD-BEARING for grading (Odds-API event id != ESPN scoreboard id) —
//     the grader matches on team-name + date, same as recordNFLPredictions.
//   • Idempotent upsert (game_id,market,selection,game_date) — safe to run daily.
//
// buildShadowRows is a PURE function (unit-tested offline); recordNflPropShadow does
// the live fetch + write. Isolated module (own supabase client) so it cannot
// destabilize the live feed. Delete-safe. CommonJS, Node 18+.

const { createClient } = require("@supabase/supabase-js");
const { getNflPropLines } = require("./nflPropsOdds");
const { buildPlayerProjections, overProb } = require("./nflPropsData");

const NFL_IMMINENT_DAYS = 7;
const SEED_SEASON = 2025;

const MARKET_TO_SHADOW = {
  pass_yds: "player_pass_yds_shadow",
  rush_yds: "player_rush_yds_shadow",
  receptions: "player_receptions_shadow",
  rec_yds: "player_rec_yds_shadow",
};

function db() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); }

// ET calendar date (mirrors predictionTracker.etDate — a bare date string rolls back
// a day in Eastern, so derive from the full ISO commence time).
function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch { return null; }
}
function easternToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
function round3(n) { return n == null ? null : Math.round(n * 1000) / 1000; }

// Normalize a player name for matching book line <-> projection roster (Odds API vs
// ESPN). Lowercase, drop periods/apostrophes, strip generational suffixes, collapse ws.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function normalizeName(name) {
  if (!name) return "";
  const cleaned = String(name).toLowerCase().replace(/[.'`]/g, "").replace(/[^a-z0-9\s-]/g, " ");
  return cleaned.split(/\s+/).filter((t) => t && !SUFFIXES.has(t)).join(" ").trim();
}

// ── PURE: build shadow rows from lines + projections (unit-tested) ───────────────
// lines: [{player, market, line, overOdds, fairOverProb, book, eventId, matchup}]
// byEvent: { [eventId]: { commence, matchup } }
// projections: [{ name, team, pos, gamesPlayed, projected:{ market: mean } }]
function buildShadowRows(lines, byEvent, projections) {
  const byName = new Map();
  for (const p of projections || []) byName.set(normalizeName(p.name), p);

  const rows = [];
  const unmatched = [];
  let matched = 0;
  for (const ln of lines || []) {
    const shadowMarket = MARKET_TO_SHADOW[ln.market];
    if (!shadowMarket) continue;
    const proj = byName.get(normalizeName(ln.player));
    if (!proj) { unmatched.push(ln.player); continue; }
    const mean = proj.projected ? proj.projected[ln.market] : null;
    if (mean == null) { unmatched.push(`${ln.player}:${ln.market}(no-proj)`); continue; }
    const mProb = overProb(mean, ln.line, ln.market);
    if (mProb == null) continue;
    matched++;
    const evt = (byEvent && byEvent[ln.eventId]) || {};
    const gameDate = etDate(evt.commence) || easternToday();
    rows.push({
      game_id: String(ln.eventId),
      game_date: gameDate,
      league: "nfl",
      matchup: ln.matchup || evt.matchup || null,
      market: shadowMarket,
      selection: `${ln.player}:OVER`,
      description: `${ln.player} ${ln.market} shadow (proj ${mean}, line ${ln.line}, mktOver ${ln.fairOverProb ?? "?"}, ${proj.gamesPlayed ?? "?"}g, ${proj.team ?? "?"} ${proj.pos ?? "?"}, ${ln.book ?? "?"})`,
      model_prob: round3(mProb),
      odds: ln.overOdds ?? -110,
      edge: null,
      confidence: round3(mProb),
      line: ln.line,
      expected_ks: mean,
      proj_ip: proj.gamesPlayed ?? null,
      k_rate: ln.fairOverProb ?? null,
    });
  }
  return { rows, matched, unmatched };
}

// ── LIVE: fetch lines + projections, build rows, upsert (dryRun returns rows) ─────
async function recordNflPropShadow({ daysAhead = NFL_IMMINENT_DAYS, dryRun = false } = {}) {
  const oddsRes = await getNflPropLines({ daysAhead });
  if (!oddsRes || !oddsRes.ok || !Array.isArray(oddsRes.lines) || oddsRes.lines.length === 0) {
    return { logged: 0, linesSeen: 0, reason: (oddsRes && oddsRes.error) || "no prop lines in imminence window (dormant)" };
  }

  // Only crawl rosters when there are actually lines to match (in-season).
  const projRes = await buildPlayerProjections({ season: SEED_SEASON, teamLimit: 0 });
  const { rows, matched, unmatched } = buildShadowRows(oddsRes.lines, oddsRes.byEvent, projRes.players || []);

  if (dryRun) {
    return { dryRun: true, linesSeen: oddsRes.lines.length, matched, wouldLog: rows.length, unmatchedSample: unmatched.slice(0, 15), sampleRows: rows.slice(0, 8) };
  }
  if (rows.length === 0) {
    return { logged: 0, linesSeen: oddsRes.lines.length, matched, reason: "no matched projectable lines", unmatchedSample: unmatched.slice(0, 15) };
  }

  try {
    const supabase = db();
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) {
      console.error("[NflPropShadow] upsert error:", error.message);
      return { logged: 0, error: error.message, linesSeen: oddsRes.lines.length, matched };
    }
    console.log(`[NflPropShadow] Snapshotted ${rows.length} prop-shadow rows (${matched} matched of ${oddsRes.lines.length} lines; dups ignored)`);
    return { logged: rows.length, linesSeen: oddsRes.lines.length, matched, unmatchedSample: unmatched.slice(0, 15) };
  } catch (e) {
    console.error("[NflPropShadow] exception:", e.message);
    return { logged: 0, error: e.message, linesSeen: oddsRes.lines.length, matched };
  }
}

module.exports = {
  recordNflPropShadow,
  buildShadowRows,
  normalizeName,
  MARKET_TO_SHADOW,
  NFL_IMMINENT_DAYS,
};
