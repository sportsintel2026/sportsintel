/**
 * services/nbaMatchup.js — SportsIntel NBA matchup detail
 * --------------------------------------------------------------------------
 * Fetches ESPN's free game "summary" endpoint for a single game and trims the
 * ~600KB response down to a compact payload the NBA detail page can render:
 * team season stats, statistical leaders (with headshots), injuries, the
 * playoff series state, the book line, and ESPN's own win projection.
 *
 * Exposed via GET /api/nba/matchup/:gameId  (see routes/nba.js)
 *
 * No API key, no new npm deps. Node 18+ global fetch. CommonJS.
 * -------------------------------------------------------------------------- */

const SUMMARY_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=';

// tiny in-memory cache (summary changes slowly pre-game)
const _cache = new Map();
const TTL_MS = 60 * 1000;
function cacheGet(k) {
  const e = _cache.get(k);
  if (e && Date.now() - e.t < TTL_MS) return e.v;
  return null;
}
function cacheSet(k, v) {
  _cache.set(k, { t: Date.now(), v });
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchSummary(gameId) {
  const cached = cacheGet(gameId);
  if (cached) return cached;
  const res = await fetch(SUMMARY_URL + encodeURIComponent(gameId), {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('ESPN summary ' + res.status);
  const json = await res.json();
  cacheSet(gameId, json);
  return json;
}

// season stats live in boxscore.teams[].statistics (name/displayValue pairs)
function statsFromBoxTeam(boxTeam) {
  const map = {};
  for (const s of boxTeam.statistics || []) map[s.name] = s.displayValue;
  return {
    ppg: num(map.avgPoints),
    papg: num(map.avgPointsAgainst),
    fgPct: num(map.fieldGoalPct),
    threePct: num(map.threePointFieldGoalPct),
    reb: num(map.avgRebounds),
    ast: num(map.avgAssists),
    blk: num(map.avgBlocks),
    stl: num(map.avgSteals),
    streak: map.streak || null,
    lastTen: map['Last Ten Games'] || null,
  };
}

// leaders block -> [{category, value, label, name, headshot, ...}]
function leadersForTeam(leadersBlock) {
  const out = [];
  for (const cat of leadersBlock.leaders || []) {
    const top = (cat.leaders || [])[0];
    if (!top) continue;
    out.push({
      category: cat.displayName, // "Points" / "Assists" / "Rebounds"
      value: top.displayValue,
      label: top.mainStat?.label || '',
      name: top.athlete?.fullName || top.athlete?.displayName || null,
      shortName: top.athlete?.shortName || null,
      headshot: top.athlete?.headshot?.href || null,
      position: top.athlete?.position?.abbreviation || '',
      jersey: top.athlete?.jersey || '',
      summary: top.summary || '',
    });
  }
  return out;
}

async function getNbaMatchup(gameId) {
  const s = await fetchSummary(gameId);

  const comp = s.header?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const homeC = competitors.find((c) => c.homeAway === 'home') || {};
  const awayC = competitors.find((c) => c.homeAway === 'away') || {};
  const homeId = homeC.team?.id;
  const awayId = awayC.team?.id;

  const boxTeams = s.boxscore?.teams || [];
  const boxHome = boxTeams.find((t) => t.homeAway === 'home');
  const boxAway = boxTeams.find((t) => t.homeAway === 'away');

  const leadersArr = s.leaders || [];
  const leadHome = leadersArr.find((l) => l.team?.id === homeId);
  const leadAway = leadersArr.find((l) => l.team?.id === awayId);

  const injArr = s.injuries || [];
  const injForId = (id) => {
    const block = injArr.find((i) => i.team?.id === id);
    return (block?.injuries || []).map((x) => ({
      name: x.athlete?.fullName || x.athlete?.displayName || 'Unknown',
      status: x.status || null,
      detail: [x.details?.type, x.details?.detail].filter(Boolean).join(' ') || null,
    }));
  };

  const recordOf = (c) => {
    const r = {};
    for (const rec of c.record || []) r[rec.type] = rec.summary;
    return r.total || null;
  };

  const teamObj = (c, box, lead) => ({
    id: c.team?.id || null,
    abbr: c.team?.abbreviation || null,
    name: c.team?.name || null,
    displayName: c.team?.displayName || null,
    logo: c.team?.logos?.[0]?.href || null,
    color: c.team?.color || null,
    record: recordOf(c),
    seasonStats: box ? statsFromBoxTeam(box) : null,
    leaders: lead ? leadersForTeam(lead) : [],
    injuries: injForId(c.team?.id),
  });

  // playoff series state
  let series = null;
  const playoff =
    (comp.series || []).find((x) => x.type === 'playoff') ||
    (s.seasonseries || []).find((x) => x.type === 'playoff');
  if (playoff) {
    series = {
      title: playoff.title || playoff.round || 'Playoff Series',
      summary: playoff.summary || null,
      completed: !!playoff.completed,
    };
  }

  // ESPN's own win projection
  let predictor = null;
  if (s.predictor) {
    predictor = {
      homeId: s.predictor.homeTeam?.id || null,
      homePct: num(s.predictor.homeTeam?.gameProjection),
      awayPct: num(s.predictor.awayTeam?.gameProjection),
    };
  }

  // book line (first provider in pickcenter)
  let odds = null;
  const pc = (s.pickcenter || [])[0];
  if (pc) {
    odds = {
      provider: pc.provider?.name || null,
      details: pc.details || null,
      spread: pc.spread ?? null,
      total: pc.overUnder ?? null,
      overOdds: pc.overOdds ?? null,
      underOdds: pc.underOdds ?? null,
      homeML: pc.homeTeamOdds?.moneyLine ?? null,
      awayML: pc.awayTeamOdds?.moneyLine ?? null,
    };
  }

  const venue = s.gameInfo?.venue;
  const venueStr = venue
    ? [venue.fullName, venue.address?.city, venue.address?.state]
        .filter(Boolean)
        .join(', ')
    : null;

  return {
    gameId: String(gameId),
    gameNote: s.header?.gameNote || null, // e.g. "West Finals - Game 7"
    date: comp.date || null,
    state: comp.status?.type?.state || null,
    statusDetail: comp.status?.type?.detail || null,
    venue: venueStr,
    home: teamObj(homeC, boxHome, leadHome),
    away: teamObj(awayC, boxAway, leadAway),
    series,
    predictor,
    odds,
  };
}

module.exports = { getNbaMatchup };
