// WZ-NFLPROPSSHADOW-2026-07-05
// nflPropsShadow.js — football prop recorder plus verified customer snapshot.
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
// CFB uses exact durable roster identity only. Markets without an active WizePicks
// prop model are exposed as verified market data with null model fields and never
// written as a fabricated model_predictions row.

const { createClient } = require("@supabase/supabase-js");
const { getFootballPropLines } = require("./nflPropsOdds");
const { buildPlayerProjections, overProb } = require("./nflPropsData");
const { teamKey, cfbNorm, cfbSchoolKey } = require("./teamKey");

const NFL_IMMINENT_DAYS = 7;
const SEED_SEASON = 2025;
const CFB_ROSTER_SEASON = 2026;

const MARKET_TO_SHADOW = {
  pass_yds: "player_pass_yds_shadow",
  rush_yds: "player_rush_yds_shadow",
  receptions: "player_receptions_shadow",
  rec_yds: "player_rec_yds_shadow",
};

const CUSTOMER_MARKETS = new Set([
  ...Object.keys(MARKET_TO_SHADOW),
  "pass_tds", "rush_tds", "rec_tds", "anytime_td", "touchdowns_2_plus",
  "touchdowns_3_plus", "first_td", "last_td",
]);

// Read-only customer snapshot populated by the EXISTING daily shadow run. The customer route
// never calls a provider; an empty cache is an honest "not verified yet" state after a restart.
const latestVerifiedSnapshots = {
  nfl: { sport: "nfl", generatedAt: null, props: [] },
  cfb: { sport: "cfb", generatedAt: null, props: [] },
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

// CFB identity never uses initials, partial names, suffix removal, or similarity.
// It only tolerates punctuation/diacritic/case differences around the exact full name.
function exactCfbPlayerName(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['\u2019\u2018`.-]/g, " ").replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function verifiedEventTeams(matchup, projectionTeam, sport = "nfl") {
  const parts = String(matchup || "").split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [awayTeam, homeTeam] = parts;
  const league = String(sport || "").toLowerCase();
  if (league === "cfb") {
    const playerTeamKey = cfbNorm(projectionTeam);
    const matches = (eventTeam) => {
      const exact = cfbNorm(teamKey(eventTeam, "cfb"));
      return playerTeamKey && (playerTeamKey === exact || playerTeamKey === cfbSchoolKey(eventTeam));
    };
    const awayMatch = matches(awayTeam);
    const homeMatch = matches(homeTeam);
    if (awayMatch === homeMatch) return null;
    return awayMatch ? { awayTeam, homeTeam, opponent: homeTeam } : { awayTeam, homeTeam, opponent: awayTeam };
  }
  const awayKey = teamKey(awayTeam, league);
  const homeKey = teamKey(homeTeam, league);
  const playerTeamKey = teamKey(projectionTeam, league);
  if (!awayKey || !homeKey || !playerTeamKey || awayKey === homeKey) return null;
  if (playerTeamKey === awayKey) return { awayTeam, homeTeam, opponent: homeTeam };
  if (playerTeamKey === homeKey) return { awayTeam, homeTeam, opponent: awayTeam };
  return null;
}

// ── PURE: build shadow rows from lines + projections (unit-tested) ───────────────
// lines: [{player, market, line, overOdds, fairOverProb, book, eventId, matchup}]
// byEvent: { [eventId]: { commence, matchup } }
// projections: [{ name, team, pos, gamesPlayed, projected:{ market: mean } }]
function buildShadowRows(lines, byEvent, projections, { sport = "nfl" } = {}) {
  const league = String(sport || "").toLowerCase();
  const playerKey = league === "cfb" ? exactCfbPlayerName : normalizeName;
  const byName = new Map();
  for (const p of projections || []) {
    const key = playerKey(p.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  const rows = [];
  const verifiedProps = [];
  const unmatched = [];
  let matched = 0;
  for (const ln of lines || []) {
    const shadowMarket = MARKET_TO_SHADOW[ln.market];
    const recordedModelMarket = league === "nfl" ? shadowMarket : null;
    if (!CUSTOMER_MARKETS.has(ln.market)) continue;
    if (!ln.book || ln.overOdds == null) { unmatched.push(`${ln.player}:${ln.market}(incomplete-price)`); continue; }
    const evt = (byEvent && byEvent[ln.eventId]) || {};
    const matchup = ln.matchup || evt.matchup || null;
    const candidates = (byName.get(playerKey(ln.player)) || [])
      .map((proj) => ({ proj, teams: verifiedEventTeams(matchup, proj.team, league) }))
      .filter((entry) => entry.teams);
    if (candidates.length !== 1) {
      unmatched.push(`${ln.player}:${ln.market}(${candidates.length ? "ambiguous-player-event" : "team-event-mismatch"})`);
      continue;
    }
    const { proj, teams } = candidates[0];
    const mean = recordedModelMarket && proj.projected ? proj.projected[ln.market] : null;
    const mProb = mean == null ? null : overProb(mean, ln.line, ln.market);
    if (recordedModelMarket && mProb == null) { unmatched.push(`${ln.player}:${ln.market}(no-proj)`); continue; }
    matched++;
    const gameDate = etDate(evt.commence) || easternToday();
    if (recordedModelMarket) {
      rows.push({
        game_id: String(ln.eventId),
        game_date: gameDate,
        league: "nfl",
        matchup,
        market: recordedModelMarket,
        selection: `${ln.player}:OVER`,
        description: `${ln.player} ${ln.market} shadow (proj ${mean}, line ${ln.line}, mktOver ${ln.fairOverProb ?? "?"}, ${proj.gamesPlayed ?? "?"}g, ${proj.team ?? "?"} ${proj.pos ?? "?"}, ${ln.book})`,
        model_prob: round3(mProb),
        odds: ln.overOdds,
        edge: null,
        confidence: round3(mProb),
        line: ln.line,
        expected_ks: mean,
        proj_ip: proj.gamesPlayed ?? null,
        k_rate: ln.fairOverProb ?? null,
      });
    }
    verifiedProps.push({
      sport: league,
      eventId: String(ln.eventId),
      eventDate: gameDate,
      commenceTime: evt.commence || null,
      matchup,
      awayTeam: teams.awayTeam,
      homeTeam: teams.homeTeam,
      opponent: teams.opponent,
      player: ln.player,
      playerId: proj.id == null ? null : String(proj.id),
      headshot: proj.headshot || null,
      teamLogoId: proj.teamLogoId || null,
      team: proj.team || null,
      position: proj.pos || null,
      market: ln.market,
      line: ln.line,
      overOdds: ln.overOdds,
      underOdds: ln.underOdds,
      book: ln.book || null,
      priceMode: ln.priceMode || "over-under",
      overLabel: ln.overLabel || "OVER",
      underLabel: ln.underLabel || "UNDER",
      marketFairOverProb: ln.fairOverProb ?? null,
      projection: mean,
      modelOverProb: round3(mProb),
      modelEdge: mProb == null || ln.fairOverProb == null ? null : round3(mProb - ln.fairOverProb),
      gamesUsed: proj.gamesPlayed ?? null,
    });
  }
  return { rows, verifiedProps, matched, unmatched };
}

function buildCfbRosterIdentities(snapshotRows = []) {
  const latestByTeam = new Map();
  for (const row of snapshotRows) {
    if (!row || !row.team_name || !["exact", "mapped"].includes(row.identity_status)) continue;
    const key = String(row.espn_team_id || row.team_name);
    if (!latestByTeam.has(key)) latestByTeam.set(key, row);
  }
  const players = [];
  for (const row of latestByTeam.values()) {
    const roster = Array.isArray(row.roster) ? row.roster : row.roster?.players;
    for (const player of roster || []) {
      const id = player?.id || player?.athleteId;
      const name = [player?.firstName, player?.lastName].filter(Boolean).join(" ").trim();
      if (!id || !name) continue;
      players.push({
        id: String(id), name, team: row.team_name, pos: player.position || null,
        headshot: null, teamLogoId: String(row.espn_team_id), projected: {},
      });
    }
  }
  return players;
}

async function loadCfbRosterIdentities(supabase = db()) {
  const response = await supabase
    .from("cfb_team_preseason_snapshots")
    .select("team_name,espn_team_id,identity_status,roster,snapshot_at")
    .eq("season", CFB_ROSTER_SEASON)
    .order("snapshot_at", { ascending: false });
  if (response.error) throw new Error(response.error.message);
  return buildCfbRosterIdentities(response.data || []);
}

// ── LIVE: fetch lines + projections, build rows, upsert (dryRun returns rows) ─────
async function recordFootballProps({ sport = "nfl", daysAhead = NFL_IMMINENT_DAYS, dryRun = false } = {}) {
  const league = String(sport || "").toLowerCase();
  if (league !== "nfl" && league !== "cfb") return { logged: 0, verified: 0, reason: "unsupported football props sport" };
  const oddsRes = await getFootballPropLines({ sport: league, daysAhead });
  if (!oddsRes || !oddsRes.ok || !Array.isArray(oddsRes.lines) || oddsRes.lines.length === 0) {
    return { logged: 0, linesSeen: 0, reason: (oddsRes && oddsRes.error) || "no prop lines in imminence window (dormant)" };
  }

  // Only load identities when there are actually lines to match (in-season).
  const players = league === "nfl"
    ? (await buildPlayerProjections({ season: SEED_SEASON, teamLimit: 0 })).players || []
    : await loadCfbRosterIdentities();
  const { rows, verifiedProps, matched, unmatched } = buildShadowRows(
    oddsRes.lines, oddsRes.byEvent, players, { sport: league },
  );

  if (dryRun) {
    return { dryRun: true, sport: league, linesSeen: oddsRes.lines.length, matched, verified: verifiedProps.length, wouldLog: rows.length, unmatchedSample: unmatched.slice(0, 15), sampleRows: rows.slice(0, 8), sampleProps: verifiedProps.slice(0, 8) };
  }
  if (verifiedProps.length === 0) {
    return { logged: 0, verified: 0, linesSeen: oddsRes.lines.length, matched, reason: "no exactly matched prop identities", unmatchedSample: unmatched.slice(0, 15) };
  }
  latestVerifiedSnapshots[league] = { sport: league, generatedAt: new Date().toISOString(), props: verifiedProps };

  // Market-only CFB and unmodeled touchdown props are customer-readable snapshots,
  // never fabricated model_predictions rows.
  if (rows.length === 0) {
    return { logged: 0, verified: verifiedProps.length, linesSeen: oddsRes.lines.length, matched, unmatchedSample: unmatched.slice(0, 15) };
  }

  try {
    const supabase = db();
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) {
      console.error(`[FootballProps:${league}] upsert error:`, error.message);
      return { logged: 0, error: error.message, linesSeen: oddsRes.lines.length, matched };
    }
    console.log(`[FootballProps:${league}] Snapshotted ${rows.length} prop-shadow rows (${matched} matched of ${oddsRes.lines.length} lines; dups ignored)`);
    return { logged: rows.length, verified: verifiedProps.length, linesSeen: oddsRes.lines.length, matched, unmatchedSample: unmatched.slice(0, 15) };
  } catch (e) {
    console.error(`[FootballProps:${league}] exception:`, e.message);
    return { logged: 0, error: e.message, linesSeen: oddsRes.lines.length, matched };
  }
}

async function recordNflPropShadow(options = {}) {
  return recordFootballProps({ ...options, sport: "nfl" });
}

function getLatestNflPropsSnapshot() {
  return getLatestFootballPropsSnapshot("nfl");
}

function getLatestFootballPropsSnapshot(sport) {
  const league = String(sport || "").toLowerCase();
  const snapshot = latestVerifiedSnapshots[league] || { sport: league, generatedAt: null, props: [] };
  return { ...snapshot, props: snapshot.props.map((prop) => ({ ...prop })) };
}

// The customer snapshot is intentionally process-local, so every deploy/restart begins
// empty even when today's scheduled recorder ran successfully before the restart. Warm
// NFL once on boot rather than making a paid customer request trigger provider work.
let nflBootWarm = null;
function warmNflPropsSnapshotOnBoot() {
  if (latestVerifiedSnapshots.nfl.props.length > 0) {
    return Promise.resolve({ skipped: true, verified: latestVerifiedSnapshots.nfl.props.length });
  }
  if (!nflBootWarm) {
    nflBootWarm = recordFootballProps({ sport: "nfl" }).finally(() => { nflBootWarm = null; });
  }
  return nflBootWarm;
}

module.exports = {
  recordNflPropShadow,
  recordFootballProps,
  buildShadowRows,
  buildCfbRosterIdentities,
  normalizeName,
  exactCfbPlayerName,
  verifiedEventTeams,
  getLatestNflPropsSnapshot,
  getLatestFootballPropsSnapshot,
  warmNflPropsSnapshotOnBoot,
  MARKET_TO_SHADOW,
  CUSTOMER_MARKETS,
  NFL_IMMINENT_DAYS,
};
