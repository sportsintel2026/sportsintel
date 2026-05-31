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

const SCOREBOARD = (league, dateStr) =>
  `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/scoreboard` +
  (dateStr ? `?dates=${dateStr}` : ``);
const SUMMARY = (league, id) =>
  `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/summary?event=${id}`;
const STANDINGS = (league) =>
  `https://site.api.espn.com/apis/v2/sports/${PATHS[league]}/standings`;

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

// Fetch + parse one scoreboard day (optionally for a specific YYYYMMDD date).
async function fetchScoreboardDay(league, dateStr) {
  const res = await fetch(SCOREBOARD(league, dateStr));
  if (!res.ok) throw new Error("espn scoreboard " + res.status);
  const json = await res.json();
  const games = (json.events || []).map((e) => {
    const g = parseEvent(e);
    g.league = league;
    return g;
  });
  // attach detailId per league
  if (league === "nba") {
    for (const g of games) g.detailId = g.id;
  } else if (league === "mlb") {
    const idMap = await mlbBackendIdMap();
    for (const g of games) {
      const key = `${nick(g.away.name)}|${nick(g.home.name)}`;
      g.detailId = idMap[key] || null;
    }
  }
  return games;
}

// ET date as YYYYMMDD (ESPN scoreboard's ?dates= format), offset in days.
function espnDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // en-CA gives YYYY-MM-DD in ET; strip dashes
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "");
}

async function getScores(league) {
  if (!PATHS[league]) throw new Error("unknown league");
  const ck = `scores:${league}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  // Default scoreboard day (ESPN decides which day this is).
  let games = await fetchScoreboardDay(league);
  let rolled = false;

  // A day is "useful" if it has at least one game that isn't already final.
  const hasPlayable = (arr) => Array.isArray(arr) && arr.length > 0 && arr.some((g) => g.bucket !== "final");

  // ROLLOVER: if the default day has nothing playable (e.g. late at night ESPN
  // still returns yesterday's finished slate), step forward ONE DAY AT A TIME
  // starting from TODAY (ET) — so we land on today's real slate first and only
  // advance to tomorrow if today is empty/all-final. This keeps the scores list
  // on the same day the model/edges feed is using, so games link up correctly.
  if (!hasPlayable(games)) {
    for (let off = 0; off <= 3; off++) {
      try {
        const day = await fetchScoreboardDay(league, espnDateStr(off));
        if (hasPlayable(day)) { games = day; rolled = off > 0; break; }
      } catch (_) { /* try the next day */ }
    }
  }

  const out = {
    league,
    rolledToNextDay: rolled,
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

  // current series ("ATL leads series 1-0"). Only use the genuine CURRENT series —
  // never preseason or a stale completed one (ESPN sometimes returns those).
  let series = null;
  const ss = (summary.seasonseries || []).find(
    (s) => s.type === "current" && String(s.type).toLowerCase() !== "preseason"
  );
  if (ss && ss.summary) {
    series = {
      summary: ss.summary,                   // "ATL leads series 1-0"
      score: ss.seriesScore || null,         // "1-0"
      totalGames: ss.totalCompetitions || null, // 3
      completed: !!ss.completed,
    };
  }

  // home plate umpire (from the officials list in gameInfo). Name only — no
  // tendency data (not reliably available without a paid feed).
  let umpire = null;
  const officials =
    (summary.gameInfo && summary.gameInfo.officials) ||
    (summary.boxscore && summary.boxscore.officials) ||
    [];
  const hp = officials.find(
    (o) => o.position && /home plate/i.test(o.position.name || o.position.displayName || "")
  );
  if (hp && hp.displayName) umpire = hp.displayName;

  const out = {
    league,
    gameId: String(gameId),
    state: status.state || "pre",
    bucket: bucketFor(status.state || "pre"),
    statusDetail: status.shortDetail || status.detail || "",
    series,
    umpire,
    lineScore: parseLineScore(summary),
    players: parsePlayers(summary),
    generatedAt: new Date().toISOString(),
  };
  cacheSet(ck, out);
  return out;
}

// ── Standings (streak + last 10 + record) ───────────────────────────────────
// Returns a map keyed by ESPN team id: { record, streak, lastTen, streakType }.
// Walks the nested league->children->standings->entries structure. Cached longer
// (standings change slowly — once per completed game).
const standingsCache = { t: 0, v: null };
const STANDINGS_TTL = 5 * 60 * 1000; // 5 min

function statByType(stats, type) {
  const s = (stats || []).find((x) => x.type === type || x.name === type);
  return s || null;
}

async function getStandings(league) {
  if (!PATHS[league]) throw new Error("unknown league");
  if (standingsCache.v && standingsCache.league === league && Date.now() - standingsCache.t < STANDINGS_TTL) {
    return standingsCache.v;
  }
  const res = await fetch(STANDINGS(league));
  if (!res.ok) throw new Error("espn standings " + res.status);
  const json = await res.json();

  // entries can live under json.children[].standings.entries (divisions/leagues)
  // or directly under json.standings.entries. Collect them all.
  const buckets = [];
  if (json.standings && json.standings.entries) buckets.push(json.standings.entries);
  for (const child of json.children || []) {
    if (child.standings && child.standings.entries) buckets.push(child.standings.entries);
    // some shapes nest one more level
    for (const gc of child.children || []) {
      if (gc.standings && gc.standings.entries) buckets.push(gc.standings.entries);
    }
  }

  const map = {};
  for (const entries of buckets) {
    for (const e of entries) {
      const team = e.team || {};
      const id = String(team.id || "");
      if (!id) continue;
      const stats = e.stats || [];
      const wins = statByType(stats, "wins");
      const losses = statByType(stats, "losses");
      const streak = statByType(stats, "streak");
      const lastTen = statByType(stats, "lasttengames") || statByType(stats, "Last Ten Games");
      const diff = statByType(stats, "pointdifferential");
      map[id] = {
        abbrev: team.abbreviation || null,
        record: wins && losses ? `${wins.displayValue}-${losses.displayValue}` : null,
        streak: streak ? streak.displayValue : null,        // e.g. "W3" / "L4"
        streakValue: streak ? streak.value : null,           // +3 / -4
        lastTen: lastTen ? lastTen.displayValue : null,      // e.g. "6-4"
        runDiff: diff ? diff.displayValue : null,            // e.g. "+24"
      };
      // also key by abbreviation (uppercased) for easy frontend matching
      if (team.abbreviation) map[String(team.abbreviation).toUpperCase()] = map[id];
    }
  }

  standingsCache.t = Date.now();
  standingsCache.league = league;
  standingsCache.v = map;
  return map;
}

module.exports = { getScores, getGameDetail, getStandings, parseEvent, parseLineScore, parsePlayers };
