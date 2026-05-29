// services/liveScores.js — live scores + box scores for MLB and NBA from ESPN's
// public scoreboard/summary feeds. No API key. Node 18+ global fetch. CommonJS.
//
// Exposed via routes/scores.js:
//   GET /api/scores/:league            -> { league, live:[], upcoming:[], final:[] }
//   GET /api/scores/:league/:gameId    -> { game, lineScore, players }

const PATHS = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
};

const SCOREBOARD = (league) =>
  `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/scoreboard`;
const SUMMARY = (league, id) =>
  `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/summary?event=${id}`;

// tiny cache so the 30s frontend refresh doesn't hammer ESPN
const cache = new Map(); // key -> { t, v }
const TTL = 20 * 1000;
function cacheGet(k) { const e = cache.get(k); return e && Date.now() - e.t < TTL ? e.v : null; }
function cacheSet(k, v) { cache.set(k, { t: Date.now(), v }); }

// Map ESPN status.type.state -> our bucket. state is "pre" | "in" | "post".
function bucketFor(state) {
  if (state === "in") return "live";
  if (state === "post") return "final";
  return "upcoming";
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Normalize one ESPN event into a flat game object for the lists.
function parseEvent(ev) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const status = (comp.status || ev.status || {}).type || {};
  const state = status.state || "pre";
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home") || {};
  const away = competitors.find((c) => c.homeAway === "away") || {};
  const teamOf = (c) => {
    const t = c.team || {};
    return {
      id: t.id || null,
      abbrev: t.abbreviation || "TBD",
      name: t.shortDisplayName || t.displayName || t.name || "TBD",
      logo: t.logo || null,
      record: (c.records && c.records[0] && c.records[0].summary) || c.record || null,
      score: num(c.score),
      seed: c.curatedRank && c.curatedRank.current ? c.curatedRank.current : null,
    };
  };
  return {
    id: ev.id,
    league: null, // filled by caller
    state,
    bucket: bucketFor(state),
    statusDetail: status.shortDetail || status.detail || status.description || "",
    completed: !!status.completed,
    startTime: ev.date || comp.date || null,
    venue: (comp.venue && comp.venue.fullName) || null,
    neutralSite: !!comp.neutralSite,
    seriesSummary:
      (comp.series && comp.series.summary) ||
      (ev.notes && ev.notes[0] && ev.notes[0].headline) ||
      null,
    home: teamOf(home),
    away: teamOf(away),
  };
}

// For MLB we also fetch the app's own edges feed so we can attach the backend's
// game id to each ESPN game (the detail page looks games up by THAT id, not ESPN's).
// Matched by team nickname (last word of name), which both feeds share reliably.
const EDGES_MLB = (process.env.SELF_API_BASE || "https://sportsintel-production.up.railway.app") + "/api/edges/mlb";

const nick = (s) => String(s || "").trim().split(/\s+/).pop().toLowerCase();

async function mlbBackendIdMap() {
  try {
    const res = await fetch(EDGES_MLB);
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const g of data.games || []) {
      // key by "away|home" nicknames (last word of full team name) -> backend id
      const key = `${nick(g.away)}|${nick(g.home)}`;
      map[key] = String(g.id);
    }
    return map;
  } catch (_) {
    return {};
  }
}

async function getScores(league) {
  if (!PATHS[league]) throw new Error("unknown league");
  const ck = `scores:${league}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  const res = await fetch(SCOREBOARD(league));
  if (!res.ok) throw new Error("espn scoreboard " + res.status);
  const json = await res.json();

  const games = (json.events || []).map((e) => {
    const g = parseEvent(e);
    g.league = league;
    return g;
  });

  // NBA detail pages already use ESPN ids, so detailId = ESPN id.
  // MLB detail pages use the backend's own id — map it in (or null if no match).
  if (league === "nba") {
    for (const g of games) g.detailId = g.id;
  } else if (league === "mlb") {
    const idMap = await mlbBackendIdMap();
    for (const g of games) {
      const key = `${nick(g.away.name)}|${nick(g.home.name)}`;
      g.detailId = idMap[key] || null; // null => frontend hides the button
    }
  }

  const out = {
    league,
    live: games.filter((g) => g.bucket === "live"),
    upcoming: games.filter((g) => g.bucket === "upcoming"),
    final: games.filter((g) => g.bucket === "final"),
    generatedAt: new Date().toISOString(),
  };
  cacheSet(ck, out);
  return out;
}

// ── Box score / detail ──────────────────────────────────────────────────────
// MLB line score = runs per inning; NBA line score = points per quarter.
function parseLineScore(summary) {
  const header = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const comps = header.competitors || [];
  return comps.map((c) => ({
    abbrev: (c.team && c.team.abbreviation) || "",
    homeAway: c.homeAway,
    total: num(c.score),
    // linescores[] holds per-period values (innings or quarters)
    periods: (c.linescores || []).map((ls) => num(ls.value != null ? ls.value : ls.displayValue)),
  }));
}

// Player stat lines from boxscore.players. ESPN groups stats with a `names`
// array (column keys) and per-athlete `stats` array (string values) — same
// shape as the gamelog we already parse.
function parsePlayers(summary) {
  const teams = (summary.boxscore && summary.boxscore.players) || [];
  const out = [];
  for (const teamBlock of teams) {
    const teamAbbrev = (teamBlock.team && teamBlock.team.abbreviation) || "";
    for (const statBlock of teamBlock.statistics || []) {
      const cols = statBlock.names || statBlock.keys || [];
      const labels = statBlock.labels || cols;
      for (const a of statBlock.athletes || []) {
        const ath = a.athlete || {};
        if (!ath.displayName) continue;
        const stats = a.stats || [];
        const line = {};
        for (let i = 0; i < cols.length; i++) line[cols[i]] = stats[i] != null ? stats[i] : "";
        out.push({
          team: teamAbbrev,
          id: ath.id || null,
          name: ath.displayName,
          shortName: ath.shortName || ath.displayName,
          position: (ath.position && ath.position.abbreviation) || "",
          starter: !!a.starter,
          didNotPlay: !!a.didNotPlay,
          stats: line,
          columns: cols,
          labels,
        });
      }
    }
  }
  return out;
}

async function getGameDetail(league, gameId) {
  if (!PATHS[league]) throw new Error("unknown league");
  const ck = `detail:${league}:${gameId}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  const res = await fetch(SUMMARY(league, gameId));
  if (!res.ok) throw new Error("espn summary " + res.status);
  const summary = await res.json();

  const header = (summary.header && summary.header.competitions && summary.header.competitions[0]) || {};
  const status = (header.status || {}).type || {};

  const out = {
    league,
    gameId: String(gameId),
    state: status.state || "pre",
    bucket: bucketFor(status.state || "pre"),
    statusDetail: status.shortDetail || status.detail || "",
    lineScore: parseLineScore(summary),
    players: parsePlayers(summary),
    generatedAt: new Date().toISOString(),
  };
  cacheSet(ck, out);
  return out;
}

module.exports = { getScores, getGameDetail, parseEvent, parseLineScore, parsePlayers };
