const ET = "America/New_York";

const DATE_FIELDS = [
  "commenceTime", "commence_time", "startTimeUTC", "startTime", "scheduled",
  "gameDate", "eventDate", "date", "time",
];

export function canonicalSport(value) {
  const sport = String(value || "").trim().toLowerCase();
  return ["mlb", "nfl", "cfb", "nba", "nhl", "ufc"].includes(sport) ? sport : null;
}

export function easternDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: ET });
}

export function eventDateKey(item, fallbackDate = null) {
  if (!item || typeof item !== "object") return fallbackDate;
  for (const field of DATE_FIELDS) {
    const value = item[field];
    if (!value) continue;
    const bare = String(value).match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
    if (bare && !String(value).includes("T")) return bare[1];
    const date = easternDate(value);
    if (date) return date;
  }
  return fallbackDate;
}

export function isEventSettled(item) {
  if (!item) return false;
  if (item.completed === true) return true;
  const status = String(item.status || item.state || item.st || item.bucket || item.statusDetail || "").toLowerCase();
  return ["final", "post", "completed", "complete", "cancelled", "canceled"].some((word) => status.includes(word));
}

export function eventDateGroups(items, fallbackDate = null) {
  const byDate = new Map();
  for (const item of items || []) {
    const date = eventDateKey(item, fallbackDate);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, games]) => ({ date, games, complete: games.length > 0 && games.every(isEventSettled) }));
}

export function chooseEventDate(items, { now = new Date(), fallbackDate = null } = {}) {
  const groups = eventDateGroups(items, fallbackDate);
  if (!groups.length) return fallbackDate || null;
  const today = easternDate(now);
  const todayGroup = groups.find((group) => group.date === today);
  if (todayGroup && !todayGroup.complete) return todayGroup.date;
  const next = groups.find((group) => group.date > today && !group.complete);
  if (next) return next.date;
  const unfinished = groups.find((group) => !group.complete);
  return unfinished ? unfinished.date : groups[groups.length - 1].date;
}

export function formatEventDate(date, { compact = false } = {}) {
  if (!date) return "Schedule";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", compact
    ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
    : { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function sportStartLabel(sport) {
  if (sport === "mlb") return "first pitch";
  if (sport === "nfl" || sport === "cfb") return "kickoff";
  if (sport === "nba") return "tipoff";
  if (sport === "nhl") return "puck drop";
  if (sport === "ufc") return "walkouts";
  return "start";
}

function idOf(value) {
  return value == null ? null : String(value);
}

export function scopeEdgeFeed(feed, selectedDate) {
  if (!feed || !selectedDate || !Array.isArray(feed.games)) return feed || {};
  const fallbackDate = feed.date || null;
  const games = feed.games.filter((game) => eventDateKey(game, fallbackDate) === selectedDate);
  if (!games.length && feed.games.length) return { ...feed, games: [] };
  const ids = new Set(games.flatMap((game) => [idOf(game.id), idOf(game.gameId), idOf(game.eventId)]).filter(Boolean));
  const matchups = new Set(games.map((game) => String(game.matchup || `${game.awayTeam || game.away || ""} @ ${game.homeTeam || game.home || ""}`).trim()).filter(Boolean));
  const keep = (row) => {
    const rowId = idOf(row && (row.gameId ?? row.eventId ?? row.id));
    if (rowId && ids.has(rowId)) return true;
    return !!(row && row.matchup && matchups.has(String(row.matchup).trim()));
  };
  const arrays = ["moneylineEdges", "totalsEdges", "runLineEdges", "spreadEdges", "marketMovers"];
  const out = { ...feed, date: selectedDate, games };
  for (const key of arrays) if (Array.isArray(feed[key])) out[key] = feed[key].filter(keep);
  if (feed.marketByGame && typeof feed.marketByGame === "object") {
    out.marketByGame = Object.fromEntries(Object.entries(feed.marketByGame).filter(([key, value]) => ids.has(String(key)) || keep(value)));
  }
  return out;
}

export function scopeProps(rows, sport) {
  const wanted = canonicalSport(sport);
  if (!wanted) return [];
  return (rows || []).filter((row) => canonicalSport(row && (row.sport || row.league)) === wanted);
}

export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin(scope) { generation += 1; return { generation, scope: canonicalSport(scope) || scope }; },
    accepts(token, scope) { return !!token && token.generation === generation && token.scope === (canonicalSport(scope) || scope); },
    invalidate() { generation += 1; },
  };
}
