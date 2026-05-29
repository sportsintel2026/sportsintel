// nbaGamelog.js
// Parse + fetch ESPN player gamelog (hidden API).
// Endpoint: https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/gamelog
//
// The numbers live in seasonTypes[].categories[].events[].stats[] (array of strings),
// indexed by the position of each stat in the top-level `names` array.
// Per-game metadata (date, opponent, result) lives in the top-level `events` map keyed by gameId.

// Build {statKey -> index} from the `names` array so we never hardcode column order.
function buildStatIndex(names) {
  const idx = {};
  (names || []).forEach((n, i) => { idx[n] = i; });
  return idx;
}

// "7-23" -> { made: 7, att: 23 }; safe on bad/empty input.
function splitMadeAtt(s) {
  if (typeof s !== "string" || s.indexOf("-") === -1) return { made: 0, att: 0 };
  const [m, a] = s.split("-");
  return { made: Number(m) || 0, att: Number(a) || 0 };
}

function num(s) {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Turn one raw stats[] row into a typed per-game line using the name->index map.
function parseStatsRow(stats, ix) {
  const fg = splitMadeAtt(stats[ix["fieldGoalsMade-fieldGoalsAttempted"]]);
  const tp = splitMadeAtt(stats[ix["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]]);
  const ft = splitMadeAtt(stats[ix["freeThrowsMade-freeThrowsAttempted"]]);
  return {
    minutes: num(stats[ix["minutes"]]),
    fgMade: fg.made, fgAtt: fg.att,
    tpMade: tp.made, tpAtt: tp.att,
    ftMade: ft.made, ftAtt: ft.att,
    rebounds: num(stats[ix["totalRebounds"]]),
    assists: num(stats[ix["assists"]]),
    blocks: num(stats[ix["blocks"]]),
    steals: num(stats[ix["steals"]]),
    fouls: num(stats[ix["fouls"]]),
    turnovers: num(stats[ix["turnovers"]]),
    points: num(stats[ix["points"]]),
  };
}

// Main parser: raw ESPN gamelog JSON -> array of per-game objects, newest first.
// Each game: { eventId, date, opponent, atVs, result, seasonType, ...stats }
function parseGamelog(json) {
  if (!json || !Array.isArray(json.names)) return [];
  const ix = buildStatIndex(json.names);
  const meta = json.events || {};
  const out = [];

  for (const st of json.seasonTypes || []) {
    const seasonType = st.displayName || "";
    for (const cat of st.categories || []) {
      // Only "event" categories carry per-game rows; "total" rows are aggregates we skip.
      if (cat.type !== "event" || !Array.isArray(cat.events)) continue;
      for (const ev of cat.events) {
        if (!ev || !Array.isArray(ev.stats)) continue;
        const m = meta[ev.eventId] || {};
        out.push({
          eventId: ev.eventId,
          date: m.gameDate || null,
          opponent: (m.opponent && m.opponent.abbreviation) || null,
          atVs: m.atVs || null,
          result: m.gameResult || null,
          eventNote: m.eventNote || null,
          seasonType,
          ...parseStatsRow(ev.stats, ix),
        });
      }
    }
  }

  // De-dupe by eventId (a game can appear once) and sort newest first by date.
  const seen = new Set();
  const dedup = out.filter(g => (seen.has(g.eventId) ? false : seen.add(g.eventId)));
  dedup.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return dedup;
}

// Fetch + parse for one athlete. Uses native fetch (Node 18+).
async function fetchGamelog(athleteId) {
  const url = `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/gamelog`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`ESPN gamelog ${athleteId} -> ${res.status}`);
  const json = await res.json();
  return parseGamelog(json);
}

module.exports = { parseGamelog, fetchGamelog, buildStatIndex, splitMadeAtt };
