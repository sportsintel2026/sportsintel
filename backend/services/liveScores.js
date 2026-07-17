// services/liveScores.js — live scores + box scores for MLB and NBA from ESPN's
// public scoreboard/summary feeds. No API key. Node 18+ global fetch. CommonJS.
//
// Exposed via routes/scores.js:
//   GET /api/scores/:league            -> { league, live:[], upcoming:[], final:[] }
//   GET /api/scores/:league/:gameId    -> { game, lineScore, players }

const PATHS = {
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nfl: "football/nfl",
  cfb: "football/college-football",
  nhl: "hockey/nhl",
};

const SCOREBOARD = (league, dateStr) => {
  const params = [];
  if (dateStr) params.push(`dates=${dateStr}`);
  // College football returns every division unless filtered to FBS (group 80).
  if (league === "cfb") { params.push("groups=80"); params.push("limit=300"); }
  const qs = params.length ? `?${params.join("&")}` : ``;
  return `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/scoreboard${qs}`;
};
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

// LIVESCORES-DEDUP-INNING-ABBR-2026-06-24
function ordinal(n){ const s=["th","st","nd","rd"], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }
// ESPN's MLB shortDetail can come back with a doubled half-inning ("Top Top 8",
// "Top Bottom 1") during inning transitions. Collapse the leading duplicate and
// re-add the ordinal so it reads "Top 8th" / "Bottom 1st".
function cleanStatusDetail(s){
  if(!s) return s;
  let t=String(s).trim();
  t=t.replace(/^(Top|Bottom|Mid|Middle|End)\s+(Top|Bottom|Mid|Middle|End)\b/i,"$2");
  if(/^(Top|Bottom|Mid|Middle|End)\b/i.test(t)) t=t.replace(/\b(\d+)\s*$/,(m,n)=>n+ordinal(+n));
  return t;
}
// Align ESPN team abbreviations to the ones the model/edges feed uses so the same
// team never shows two ways and dedup keys line up.
const ABBR_FIX={ CHW:"CWS" };
function fixAbbr(a){ return (a&&ABBR_FIX[a])||a; }


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
      abbrev: fixAbbr(t.abbreviation) || "TBD",
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
    statusDetail: cleanStatusDetail(status.shortDetail || status.detail || status.description || ""),
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

// Fetch the model's MLB edges feed once. Returns the parsed object
// ({ date: "YYYY-MM-DD", games: [...] }) or null. Used for two things:
//   1) the DATE the model is currently serving, so the scores list can align to
//      the exact same day (this is the safety net against day-drift), and
//   2) the id map that links each ESPN game to its backend game id.
async function fetchEdgesMLB() {
  try {
    const res = await fetch(EDGES_MLB);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Build a "away|home" nickname -> backend game id map from the edges feed.
function buildIdMap(edges) {
  const map = {};
  for (const g of (edges && edges.games) || []) {
    map[`${nick(g.away)}|${nick(g.home)}`] = String(g.id);
  }
  return map;
}

// Fetch + parse one scoreboard day (optionally a specific YYYYMMDD). No detailId.
async function fetchScoreboardRaw(league, dateStr) {
  const res = await fetch(SCOREBOARD(league, dateStr));
  if (!res.ok) throw new Error("espn scoreboard " + res.status);
  const json = await res.json();
  return (json.events || []).map((e) => {
    const g = parseEvent(e);
    g.league = league;
    return g;
  });
}

// Attach detailId — the id the detail page resolves a game by. MLB links via the
// model id map (by team nicknames); other leagues use ESPN's own id.
function attachDetailIds(league, games, idMap) {
  if (league === "mlb") {
    for (const g of games) g.detailId = (idMap && idMap[`${nick(g.away.name)}|${nick(g.home.name)}`]) || null;
  } else {
    for (const g of games) g.detailId = g.id;
  }
  return games;
}

// A day is "useful" if it has at least one game that isn't already final.
const hasPlayable = (arr) => Array.isArray(arr) && arr.length > 0 && arr.some((g) => g.bucket !== "final");

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

  let games = [];
  let rolled = false;

  if (league === "mlb") {
    // SAFETY NET: align the scores list to the SAME day the model is serving, so
    // the list and the model can never drift onto different days (the thing that
    // silently breaks game links). Read the model's date + id map once.
    const edges = await fetchEdgesMLB();
    const idMap = buildIdMap(edges);
    const modelDateStr = edges && edges.date ? String(edges.date).replace(/-/g, "") : null;
    const todayStr = espnDateStr(0);

    // Pull TODAY's scoreboard (live + final + scheduled for the current ET day).
    let todayGames = [];
    try { todayGames = attachDetailIds(league, await fetchScoreboardRaw(league, todayStr), idMap); } catch (_) { todayGames = []; }

    // A game that starts before midnight ET can still be LIVE — or only just
    // FINAL — after midnight, but ESPN files it under YESTERDAY's date. So once
    // it's past midnight ET, "today" has flipped to the new slate (which hasn't
    // started) and yesterday's games are the ones actually playing/finishing.
    // When today has produced no live/final games yet, pull yesterday so those
    // late live games and just-completed finals keep showing. Once today's slate
    // starts producing live/final games, we stop pulling yesterday (no stale
    // finals lingering into the afternoon).
    const yestStr = espnDateStr(-1);
    const todayHasActivity = todayGames.some((g) => g.bucket === "live" || g.bucket === "final");
    let yestGames = [];
    if (!todayHasActivity) {
      try { yestGames = attachDetailIds(league, await fetchScoreboardRaw(league, yestStr), idMap); } catch (_) { yestGames = []; }
    }

    // When the model has rolled to a later day, pull that day too — that's where
    // the UPCOMING games come from. (Same day as today → nothing extra to merge.)
    let modelGames = [];
    if (modelDateStr && modelDateStr !== todayStr) {
      try { modelGames = attachDetailIds(league, await fetchScoreboardRaw(league, modelDateStr), idMap); } catch (_) { modelGames = []; }
    }

    // Merge, deduped by id. From yesterday we only keep LIVE/FINAL games (its
    // scheduled/upcoming games are not relevant); from today and the model day we
    // keep everything.
    const merged = [];
    const idSeen = new Set();
    const keyIndex = new Map();          // matchup+start -> index in merged
    const bucketRank = { live: 3, final: 2, upcoming: 1 };
    const keyOf = (g) => {
      const a = g.away && g.away.abbrev, h = g.home && g.home.abbrev;
      const t = g.startTime ? String(g.startTime).slice(0, 16) : "";
      return a && h && t ? `${a}|${h}|${t}` : null;   // doubleheaders differ by start time
    };
    const addGames = (arr, onlyLiveFinal) => {
      for (const g of arr) {
        if (onlyLiveFinal && g.bucket !== "live" && g.bucket !== "final") continue;
        const k = keyOf(g);
        if (k && keyIndex.has(k)) {
          // same game already present (from another day-fetch): keep the most
          // advanced state (a live rain-delay beats the same game's "scheduled").
          const i = keyIndex.get(k);
          if ((bucketRank[g.bucket] || 0) > (bucketRank[merged[i].bucket] || 0)) merged[i] = g;
          continue;
        }
        if (idSeen.has(g.id)) continue;
        idSeen.add(g.id);
        if (k) keyIndex.set(k, merged.length);
        merged.push(g);
      }
    };
    addGames(todayGames, false);
    addGames(yestGames, true);
    addGames(modelGames, false);
    games = merged;
    rolled = !!(modelDateStr && modelDateStr !== todayStr);

    // Fallback (no model date, or ESPN had nothing for that day): default day,
    // then step forward from TODAY until we find a playable slate.
    if (!games || games.length === 0) {
      try { games = attachDetailIds(league, await fetchScoreboardRaw(league), idMap); } catch (_) { games = []; }
      if (!hasPlayable(games)) {
        for (let off = 0; off <= 3; off++) {
          try {
            const day = attachDetailIds(league, await fetchScoreboardRaw(league, espnDateStr(off)), idMap);
            if (hasPlayable(day)) { games = day; rolled = off > 0; break; }
          } catch (_) { /* try the next day */ }
        }
      }
    }
  } else {
    // NBA / NFL (and any non-MLB): default day, then today-first rollover.
    // NFL plays weekly (Thu/Sun/Mon), so scan a full week ahead; NBA is daily.
    const maxOff = (league === "nfl" || league === "cfb") ? 7 : 3;
    try { games = attachDetailIds(league, await fetchScoreboardRaw(league), null); } catch (_) { games = []; }
    if (!hasPlayable(games)) {
      for (let off = 0; off <= maxOff; off++) {
        try {
          const day = attachDetailIds(league, await fetchScoreboardRaw(league, espnDateStr(off)), null);
          if (hasPlayable(day)) { games = day; rolled = off > 0; break; }
        } catch (_) { /* try the next day */ }
      }
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

// WZ-FB-BRIEF-2026-07-16 :: football team brief from the ESPN summary - 2025 record /
// scoring / division rank + recent form + (in-season) statistical leaders. Every field is
// read defensively; returns null when the summary has no usable team data (e.g. MLB feeds).
function ord(n) { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function parseFbBrief(summary) {
  const comp = (((summary.header || {}).competitions) || [])[0] || {};
  const cs = comp.competitors || [];
  const homeId = String((((cs.find(c => c.homeAway === "home") || {}).team) || {}).id || "");
  const awayId = String((((cs.find(c => c.homeAway === "away") || {}).team) || {}).id || "");
  if (!homeId || !awayId) return null;

  const st = summary.standings || {};
  const season = String(st.header || "").replace(/\s*Standings\s*$/i, "").trim() || null;
  const statOf = (stats, name) => { const x = (stats || []).find(v => v.name === name); return x ? x.value : null; };
  const recOf = (stats) => { const o = (stats || []).find(v => v.name === "overall" || v.type === "total"); return o ? (o.summary || o.displayValue || null) : null; };

  const standing = (teamId) => {
    for (const g of st.groups || []) {
      const entries = ((g.standings || {}).entries) || [];
      const idx = entries.findIndex(e => String(e.id) === teamId);
      if (idx < 0) continue;
      const e = entries[idx];
      const w = statOf(e.stats, "wins"), l = statOf(e.stats, "losses"), t = statOf(e.stats, "ties");
      const pf = statOf(e.stats, "pointsFor"), pa = statOf(e.stats, "pointsAgainst");
      const gp = (w || 0) + (l || 0) + (t || 0);
      return {
        record: recOf(e.stats),
        ppf: gp ? Math.round((pf / gp) * 10) / 10 : null,
        ppa: gp ? Math.round((pa / gp) * 10) / 10 : null,
        winPct: statOf(e.stats, "winPercent"),
        rank: ord(idx + 1),
        div: g.divisionHeader || null,
      };
    }
    return {};
  };
  const form = (teamId) => {
    const blk = (summary.lastFiveGames || []).find(x => String((x.team || {}).id) === teamId);
    return blk ? (blk.events || []).slice(-5).map(ev => ({
      r: ev.gameResult || "", score: ev.score || "",
      opp: ((ev.opponent || {}).abbreviation) || "", at: ev.atVs || "",
    })) : [];
  };
  const leaders = (teamId) => {
    const blk = (summary.leaders || []).find(x => String((x.team || {}).id) === teamId);
    if (!blk) return [];
    const out = [];
    for (const cat of blk.leaders || []) {
      const top = (cat.leaders || [])[0];
      if (!top || !top.athlete) continue;              // empty pre-season -> skipped
      if (!/passing|rushing|receiving/i.test(cat.name || "")) continue;
      out.push({
        cat: cat.displayName || cat.name || "",
        player: top.athlete.shortName || top.athlete.displayName || "",
        pos: ((top.athlete.position || {}).abbreviation) || "",
        value: top.displayValue || String(top.value != null ? top.value : ""),
      });
    }
    return out.slice(0, 3);
  };

  const brief = { season, home: {}, away: {} };
  brief.home = { ...standing(homeId), form: form(homeId), leaders: leaders(homeId) };
  brief.away = { ...standing(awayId), form: form(awayId), leaders: leaders(awayId) };
  const has = b => b.record || (b.form || []).length || (b.leaders || []).length;
  return (has(brief.home) || has(brief.away)) ? brief : null;
}

// WZ-TEAMNEWS-2026-07-16 :: pull ONE team's ESPN news feed and keep only items genuinely about
// that team (ESPN's own team-tag category, or the team nickname as a whole word) so it can never
// surface generic league news. Fail-safe: returns [] on any error.
async function fetchTeamNews(league, teamId, names) {
  if (!PATHS[league] || !teamId) return [];
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${PATHS[league]}/news?limit=40&team=${teamId}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    const arts = Array.isArray(data && data.articles) ? data.articles : [];
    const dec = (x) => String(x || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
    const tid = String(teamId);
    const nicks = (names || []).map((n) => String(n || "").toLowerCase().split(/\s+/).pop()).filter((n) => n.length >= 4);
    const pad = (x) => " " + String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    // distinct TEAM tags on the article: 1-2 = a team-specific piece; 8-32 = a league-wide
    // "by team" listicle (trade tiers / rankings / owners) that we must NOT surface.
    const teamIdsOf = (a) => { const set = new Set(); for (const c of (a.categories || [])) { if (c && c.type === "team") { const id = String(c.teamId || (c.team || {}).id || ""); if (id) set.add(id); } } return set; };
    const mentions = (a) => { const t = pad(`${a.headline || ""} ${a.description || ""}`); return nicks.some((n) => t.includes(" " + n + " ")); };
    return arts
      // include videos (player interviews / camp clips are the most team-specific content);
      // keep only pieces about THIS team AND scoped to a few teams (drops all-32 listicles).
      .filter((a) => { const ids = teamIdsOf(a); return (ids.has(tid) || mentions(a)) && ids.size <= 5; })
      .map((a) => ({
        headline: dec(a.headline || ""),
        summary: dec(a.description || ""),
        link: (a.links && a.links.web && a.links.web.href) || "",
        published: a.published || a.lastModified || null,
        type: (a.type || "").toLowerCase() === "recap" ? "recap" : "headline",
      }))
      .filter((x) => x.headline);
  } catch (_) { return []; }
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

  // home plate umpire (from the officials list in gameInfo). We enrich the bare
  // name with our own season tendencies (umpire_games table) just below.
  let umpire = null;
  const officials =
    (summary.gameInfo && summary.gameInfo.officials) ||
    (summary.boxscore && summary.boxscore.officials) ||
    [];
  const hp = officials.find(
    (o) => o.position && /home plate/i.test(o.position.name || o.position.displayName || "")
  );
  if (hp && hp.displayName) umpire = hp.displayName;

  // Enrich to { name, favor, runs, k, bb } for the game page's umpire block. Lazy
  // require + try/catch so a lookup miss or error degrades to the bare name and can
  // never break the detail feed.
  let umpireOut = null;
  if (umpire) {
    try {
      const { getUmpireDisplay } = require("./umpireStore");
      umpireOut = await getUmpireDisplay(umpire);
    } catch (_) {
      umpireOut = { name: umpire };
    }
  }

  // team news for both sides (WZ-TEAMNEWS-2026-07-16) - genuinely team-tagged/mentioning items only,
  // merged / deduped / newest-first; fail-safe so it never blocks the detail response.
  let teamNews = [];
  if (league === "nfl" || league === "cfb" || league === "mlb") {
    try {
      const _c0 = ((summary.header && summary.header.competitions) || [])[0] || {};
      const _cs = _c0.competitors || [];
      const _teamOf = (ha) => ((_cs.find((c) => c.homeAway === ha) || {}).team) || {};
      const _nm = (t) => [t.displayName, t.name, t.shortDisplayName].filter(Boolean);
      const _aT = _teamOf("away"), _hT = _teamOf("home");
      const [_an, _hn] = await Promise.all([
        fetchTeamNews(league, String(_aT.id || ""), _nm(_aT)),
        fetchTeamNews(league, String(_hT.id || ""), _nm(_hT)),
      ]);
      const _seen = new Set();
      teamNews = [..._an, ..._hn]
        .filter((x) => { const k = x.headline.toLowerCase(); if (_seen.has(k)) return false; _seen.add(k); return true; })
        .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0))
        .slice(0, 6);
    } catch (_) { teamNews = []; }
  }

  const out = {
    league,
    gameId: String(gameId),
    state: status.state || "pre",
    bucket: bucketFor(status.state || "pre"),
    statusDetail: status.shortDetail || status.detail || "",
    series,
    umpire: umpireOut,
    lineScore: parseLineScore(summary),
    players: parsePlayers(summary),
    brief: (league === "nfl" || league === "cfb") ? parseFbBrief(summary) : null,   // WZ-FB-BRIEF-2026-07-16
    teamNews,   // WZ-TEAMNEWS-2026-07-16
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

// ── Final score by date + team matchup ───────────────────────────────────────
// The Expert-Picks grader stores the Odds-API-derived edges id on each pick, but
// ESPN's getGameDetail is keyed by ESPN's own event id — a direct lookup never
// lands (the same cross-feed gap the detail page bridges). So instead of looking a
// game up by id, resolve its FINAL score by the pick's date + team matchup, which is
// stable across both feeds. Returns { away, home } final numbers, or null if there's
// no FINAL game matching those teams on that date. dateStr = "YYYY-MM-DD".
const ABBR_ALIAS = {
  CHW: "CWS", CWS: "CWS", WAS: "WSH", WSH: "WSH", SDP: "SD", SD: "SD",
  SFG: "SF", SF: "SF", TBR: "TB", TB: "TB", KCR: "KC", KC: "KC", ARI: "AZ", AZ: "AZ",
};
const canonAbbr = (s) => { const u = String(s || "").trim().toUpperCase(); return ABBR_ALIAS[u] || u; };

async function getFinalScoreByMatchup(league, dateStr, awayName, homeName) {
  if (!PATHS[league]) return null;
  const ymd = String(dateStr || "").replace(/-/g, "").slice(0, 8);
  if (ymd.length !== 8) return null;

  let games;
  try { games = await fetchScoreboardRaw(league, ymd); } catch (_) { return null; }

  const wantAabbr = canonAbbr(awayName), wantHabbr = canonAbbr(homeName);
  const wantAnick = nick(awayName), wantHnick = nick(homeName);

  for (const g of games) {
    if (g.bucket !== "final") continue;
    const a = g.away || {}, h = g.home || {};
    const hit =
      (canonAbbr(a.abbrev) === wantAabbr && canonAbbr(h.abbrev) === wantHabbr) ||
      (nick(a.name) === wantAnick && nick(h.name) === wantHnick) ||
      (nick(a.abbrev) === wantAnick && nick(h.abbrev) === wantHnick);
    if (!hit) continue;
    if (a.score == null || h.score == null) return null; // final but no score yet — skip
    return { away: Number(a.score), home: Number(h.score) };
  }
  return null;
}

module.exports = { getScores, getGameDetail, getStandings, parseEvent, parseLineScore, parsePlayers, getFinalScoreByMatchup };
