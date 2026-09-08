import { easternDate, eventDateKey, formatEventDate } from "./eventSlate.js";

export const SEO_SPORT_NAME = Object.freeze({ nfl: "NFL", cfb: "College Football", mlb: "MLB" });
export const SEO_SPORT_PREFIX = Object.freeze({ nfl: "/nfl", cfb: "/college-football", mlb: "/mlb" });

export const SEO_PHASE2_PAGES = Object.freeze({
  mlbPerformance: Object.freeze({
    kind: "performance", sport: "mlb", league: "mlb", path: "/performance/mlb",
    title: "MLB Prediction Performance & Model Record | WizePicks",
    description: "The authoritative graded WizePicks MLB prediction record, including wins, losses, units, ROI methodology, and market-level performance.",
    h1: "MLB Prediction Performance", hub: "/mlb-picks", hubLabel: "MLB picks",
  }),
  nflPerformance: Object.freeze({
    kind: "performance", sport: "nfl", league: "nfl", path: "/performance/nfl",
    title: "NFL Prediction Performance & Model Record | WizePicks",
    description: "The authoritative graded WizePicks NFL prediction record, including wins, losses, units, ROI, and market-level performance.",
    h1: "NFL Prediction Performance", hub: "/nfl-picks", hubLabel: "NFL picks",
  }),
  cfbPerformance: Object.freeze({
    kind: "performance", sport: "cfb", league: "cfb", path: "/performance/college-football",
    title: "College Football Prediction Performance & Model Record | WizePicks",
    description: "The authoritative graded WizePicks college-football prediction record, including wins, losses, units, ROI, and market-level performance.",
    h1: "College Football Prediction Performance", hub: "/college-football-picks", hubLabel: "College football picks",
  }),
});

export const SEO_PHASE2_LIST = Object.freeze(Object.values(SEO_PHASE2_PAGES));
export const SEO_PHASE2_BY_PATH = Object.freeze(Object.fromEntries(SEO_PHASE2_LIST.map((page) => [page.path, page])));

function cleanTeam(value) {
  const text = String(value || "").trim();
  if (!text || /^(away|home|team|tbd|to be determined)$/i.test(text)) return null;
  return text;
}

export function splitSeoMatchup(game) {
  const parts = String(game?.matchup || "").split(" @ ");
  return {
    away: cleanTeam(game?.awayTeam || game?.away || parts[0]),
    home: cleanTeam(game?.homeTeam || game?.home || parts[1]),
  };
}

export function seoSlug(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function seoGameId(game) {
  return String(game?.eventId ?? game?.gameId ?? game?.id ?? "");
}

export function seoGameDate(game, fallback = null) {
  return eventDateKey(game, fallback || null);
}

export function seoMatchupPath(sport, game, fallback = null) {
  const teams = splitSeoMatchup(game);
  const date = seoGameDate(game, fallback);
  if (!SEO_SPORT_PREFIX[sport] || !teams.away || !teams.home || !date) return null;
  return `${SEO_SPORT_PREFIX[sport]}/${seoSlug(teams.away)}-vs-${seoSlug(teams.home)}-prediction-odds-${date}`;
}

function isoStart(game) {
  const value = game?.commenceTime || game?.startTimeUTC || game?.startTime || game?.scheduled || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinCurrentWindow(sport, date, now) {
  const day = dateNumber(date);
  const today = dateNumber(easternDate(now));
  if (day == null || today == null) return false;
  const delta = (day - today) / 86400000;
  return sport === "mlb" ? delta >= -1 && delta <= 2 : delta >= -7 && delta <= 14;
}

export function usefulSeoGame(sport, game, fallback = null, now = new Date()) {
  const teams = splitSeoMatchup(game);
  const date = seoGameDate(game, fallback);
  return !!(["nfl", "cfb", "mlb"].includes(sport) && teams.away && teams.home && teams.away !== teams.home
    && seoGameId(game) && (isoStart(game) || String(game?.time || "").trim()) && withinCurrentWindow(sport, date, now));
}

function hubForSport(sport) {
  return sport === "cfb" ? "/college-football-picks" : `/${sport}-picks`;
}

function hubLabelForSport(sport) {
  return sport === "cfb" ? "College football picks" : `${SEO_SPORT_NAME[sport]} picks`;
}

function longDate(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function buildSeoMatchupPage(sport, game, fallback = null, now = new Date()) {
  if (!usefulSeoGame(sport, game, fallback, now)) return null;
  const teams = splitSeoMatchup(game);
  const date = seoGameDate(game, fallback);
  const label = longDate(date);
  const context = sport === "mlb" ? "first-pitch time and sportsbook context" : "kickoff time and market context";
  return Object.freeze({
    kind: "matchup", sport, path: seoMatchupPath(sport, game, fallback),
    title: `${teams.away} vs. ${teams.home} Prediction & Odds – ${label} | WizePicks`,
    description: `${teams.away} vs. ${teams.home} prediction, ${context}, and public-safe WizePicks analysis for ${label}.`,
    h1: `${teams.away} vs. ${teams.home} Prediction & Odds`, away: teams.away, home: teams.home,
    date, startDate: isoStart(game), gameId: seoGameId(game), hub: hubForSport(sport), hubLabel: hubLabelForSport(sport),
  });
}

function firstMondayOfSeptember(year) {
  const date = new Date(Date.UTC(year, 8, 1, 12));
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  return date;
}

export function footballWeekForDate(sport, date) {
  const value = dateNumber(date);
  if (value == null || !["nfl", "cfb"].includes(sport)) return null;
  const calendarYear = Number(String(date).slice(0, 4));
  const month = Number(String(date).slice(5, 7));
  const year = month <= 2 ? calendarYear - 1 : calendarYear;
  const anchor = firstMondayOfSeptember(year);
  if (sport === "cfb") anchor.setUTCDate(anchor.getUTCDate() - 7);
  const week = Math.floor((value - anchor.getTime()) / (7 * 86400000)) + 1;
  return { week: Math.max(sport === "cfb" ? 0 : 1, week), year };
}

function currentFeedDate(sport, feed, now) {
  const games = (feed?.games || []).filter((game) => usefulSeoGame(sport, game, feed?.date, now));
  if (!games.length) return null;
  if (sport === "mlb" && /^\d{4}-\d{2}-\d{2}$/.test(String(feed?.date || ""))) return feed.date;
  return seoGameDate(games[0], feed?.date || null);
}

export function buildSeoRollingPage(sport, feed, now = new Date()) {
  const date = currentFeedDate(sport, feed, now);
  if (!date) return null;
  const games = (feed.games || []).filter((game) => usefulSeoGame(sport, game, feed?.date, now));
  const hub = hubForSport(sport);
  const hubLabel = hubLabelForSport(sport);
  if (sport === "mlb") {
    const label = longDate(date);
    return Object.freeze({
      kind: "slate", sport, date, games, path: `/mlb-picks/${date}`,
      title: `MLB Picks for ${label} | WizePicks`,
      description: `MLB picks and predictions for ${label} with the day’s matchups, first-pitch times, sportsbook context, and public-safe WizePicks analysis.`,
      h1: `MLB Picks for ${label}`, label: formatEventDate(date).toUpperCase(), hub, hubLabel,
    });
  }
  const period = footballWeekForDate(sport, date);
  if (!period) return null;
  const name = SEO_SPORT_NAME[sport];
  const path = sport === "cfb" ? `/college-football-picks/week-${period.week}-${period.year}` : `/nfl-picks/week-${period.week}-${period.year}`;
  return Object.freeze({
    kind: "slate", sport, date, games, path,
    title: `${name} Week ${period.week} Picks & Predictions ${period.year} | WizePicks`,
    description: `${name} Week ${period.week} picks and predictions for ${period.year} with current matchups, kickoff times, market context, and public-safe WizePicks analysis.`,
    h1: `${name} Week ${period.week} Picks & Predictions`, label: `${period.year} · WEEK ${period.week}`, hub, hubLabel,
  });
}

export function buildCurrentSeoPages(feeds, now = new Date()) {
  const pages = [];
  const seen = new Set();
  for (const sport of ["nfl", "cfb", "mlb"]) {
    const feed = feeds?.[sport];
    if (!feed || !Array.isArray(feed.games)) continue;
    const rolling = buildSeoRollingPage(sport, feed, now);
    if (rolling && !seen.has(rolling.path)) { seen.add(rolling.path); pages.push(rolling); }
    for (const game of feed.games) {
      const page = buildSeoMatchupPage(sport, game, feed.date, now);
      if (!page || seen.has(page.path)) continue;
      seen.add(page.path);
      pages.push(page);
    }
  }
  return pages;
}

export function currentSeoPageForPath(sport, pathname, feed, now = new Date()) {
  if (!feed || !Array.isArray(feed.games)) return null;
  const rolling = buildSeoRollingPage(sport, feed, now);
  if (rolling?.path === pathname) return rolling;
  for (const game of feed.games) {
    const page = buildSeoMatchupPage(sport, game, feed.date, now);
    if (page?.path === pathname) return page;
  }
  return null;
}

export function seoPhase2ForSport(sport, feed = null, now = new Date()) {
  const current = feed ? buildCurrentSeoPages({ [sport]: feed }, now) : [];
  return [...current, ...SEO_PHASE2_LIST.filter((page) => page.sport === sport)];
}
