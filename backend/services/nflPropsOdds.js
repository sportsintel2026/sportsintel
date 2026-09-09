// WZ-NFLPROPSODDS-2026-07-05
// nflPropsOdds.js — WizePicks NFL/CFB player-prop Odds API fetcher/parser.
//
// Fetches event-level football player-prop markets from The Odds API and normalizes
// them into per-player lines the recorder can pair with a verified identity. Mirrors the
// proven MLB prop pattern (parseHitsProps / parseTotalBasesProps): iterate
// bookmakers -> markets (by key) -> outcomes, where outcome.description = player,
// outcome.name = Over/Under, outcome.point = line, outcome.price = American odds;
// keep the player's PRIMARY line (lowest line quoted with BOTH sides), first book wins.
// Touchdown scorer and milestone offers keep their provider-native price structure.
//
// Isolated module (own axios, own helpers) so a bug here cannot destabilize the feed.
// CommonJS. Node 18+.

const axios = require("axios");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const FOOTBALL_SPORTS = Object.freeze({
  nfl: "americanfootball_nfl",
  cfb: "americanfootball_ncaaf",
});
const TIMEOUT_MS = 9000;

// These are the active customer markets requested from the existing event-odds call.
// Touchdown markets without a WizePicks projection remain verified market data only.
const MARKET_SPECS = Object.freeze({
  player_pass_yds: Object.freeze({ market: "pass_yds", offer: "over-under" }),
  player_rush_yds: Object.freeze({ market: "rush_yds", offer: "over-under" }),
  player_receptions: Object.freeze({ market: "receptions", offer: "over-under" }),
  player_reception_yds: Object.freeze({ market: "rec_yds", offer: "over-under" }),
  player_pass_tds: Object.freeze({ market: "pass_tds", offer: "over-under" }),
  player_rush_tds: Object.freeze({ market: "rush_tds", offer: "over-under" }),
  player_reception_tds: Object.freeze({ market: "rec_tds", offer: "over-under" }),
  player_anytime_td: Object.freeze({ market: "anytime_td", offer: "yes-no" }),
  player_1st_td: Object.freeze({ market: "first_td", offer: "yes-no" }),
  player_last_td: Object.freeze({ market: "last_td", offer: "yes-no" }),
  player_tds_over: Object.freeze({ market: "touchdown_milestone", offer: "milestone" }),
});
const ALL_ODDSKEYS = Object.keys(MARKET_SPECS);
const MARKET_TO_ODDSKEY = Object.freeze(Object.fromEntries(Object.entries(MARKET_SPECS)
  .map(([oddsKey, spec]) => [spec.market, oddsKey])));
const ODDSKEY_TO_MARKET = Object.freeze(Object.fromEntries(Object.entries(MARKET_SPECS)
  .map(([oddsKey, spec]) => [oddsKey, spec.market])));

// ── implied-prob + de-vig (mirrors oddsApi.americanToImpliedProb exactly) ────────
function americanToImplied(american) {
  if (american == null) return null;
  if (american >= 100) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}
// Two-way de-vig: fair Over probability = impliedOver / (impliedOver + impliedUnder).
function devigOver(overOdds, underOdds) {
  const io = americanToImplied(overOdds), iu = americanToImplied(underOdds);
  if (io == null || iu == null || io + iu <= 0) return null;
  return Math.round((io / (io + iu)) * 1e4) / 1e4;
}

function isBetterAmericanPrice(candidate, current) {
  const next = Number(candidate), existing = Number(current);
  return Number.isFinite(next) && (!Number.isFinite(existing) || next > existing);
}

// ── PURE: parse an event-odds payload into normalized per-player prop lines ───────
// Returns [{ player, market, line, overOdds, underOdds, fairOverProb, book }].
// Per (market, player): keep the PRIMARY line (lowest line with both sides priced);
// across books, the first book to fully price that market+player wins.
function parsePropLines(oddsJson) {
  const out = new Map(); // key `${market}::${player}` -> record (first book wins)
  for (const bm of (oddsJson && oddsJson.bookmakers) || []) {
    for (const m of bm.markets || []) {
      const spec = MARKET_SPECS[m.key];
      if (!spec) continue;
      const book = bm.title || bm.key;

      if (spec.offer === "yes-no") {
        const byPlayer = new Map();
        for (const outcome of m.outcomes || []) {
          const player = String(outcome.description || "").trim();
          const side = String(outcome.name || "").trim().toLowerCase();
          if (!player || outcome.price == null || (side !== "yes" && side !== "no")) continue;
          if (!byPlayer.has(player)) byPlayer.set(player, {});
          byPlayer.get(player)[side] = outcome.price;
        }
        for (const [player, quote] of byPlayer) {
          // The live provider commonly publishes scorer markets as YES-only boards.
          // Preserve the verified posted price without fabricating a NO counterprice
          // or fair probability; use a two-way quote only when both sides exist.
          if (quote.yes == null) continue;
          const hasCounterprice = quote.no != null;
          const key = `${spec.market}::${player}`;
          const existing = out.get(key);
          if (existing && spec.market !== "anytime_td") continue;
          const bookQuote = {
            book,
            price: quote.yes,
            counterPrice: hasCounterprice ? quote.no : null,
            priceMode: hasCounterprice ? "yes-no" : "over-only",
          };
          const quotes = spec.market === "anytime_td"
            ? [...(existing?.quotes || []), bookQuote]
                .filter((item, index, all) => all.findIndex((other) => other.book === item.book && other.price === item.price && other.counterPrice === item.counterPrice) === index)
                .sort((a, b) => Number(b.price) - Number(a.price))
            : undefined;
          if (existing && !isBetterAmericanPrice(quote.yes, existing.overOdds)) {
            out.set(key, { ...existing, quotes });
            continue;
          }
          out.set(key, {
            player, market: spec.market, line: null,
            overOdds: quote.yes, underOdds: hasCounterprice ? quote.no : null,
            fairOverProb: hasCounterprice ? devigOver(quote.yes, quote.no) : null,
            book,
            priceMode: hasCounterprice ? "yes-no" : "over-only",
            overLabel: "YES",
            underLabel: hasCounterprice ? "NO" : null,
            ...(quotes ? { quotes } : {}),
          });
        }
        continue;
      }

      if (spec.offer === "milestone") {
        for (const outcome of m.outcomes || []) {
          const player = String(outcome.description || "").trim();
          const side = String(outcome.name || "").trim().toLowerCase();
          const point = Number(outcome.point);
          if (!player || outcome.price == null || side !== "over" || !Number.isFinite(point)) continue;
          const market = point === 1.5 ? "touchdowns_2_plus" : point === 2.5 ? "touchdowns_3_plus" : null;
          if (!market) continue;
          const key = `${market}::${player}`;
          if (out.has(key)) continue;
          out.set(key, {
            player, market, line: point, overOdds: outcome.price, underOdds: null,
            fairOverProb: null, book, priceMode: "over-only", overLabel: `${Math.ceil(point)}+`, underLabel: null,
          });
        }
        continue;
      }

      const market = spec.market;
      // player -> line -> { over, under }
      const byPlayer = new Map();
      for (const o of m.outcomes || []) {
        const player = o.description;
        if (!player || o.price == null || o.point == null) continue;
        const side = String(o.name || "").toLowerCase();
        if (side !== "over" && side !== "under") continue;
        if (!byPlayer.has(player)) byPlayer.set(player, new Map());
        const byLine = byPlayer.get(player);
        if (!byLine.has(o.point)) byLine.set(o.point, {});
        byLine.get(o.point)[side] = o.price;
      }
      for (const [player, byLine] of byPlayer) {
        // primary line = lowest line quoted with BOTH sides
        let primary = null;
        for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
          const q = byLine.get(line);
          if (q.over != null && q.under != null) { primary = { line, ...q }; break; }
        }
        if (!primary) continue;
        const key = `${market}::${player}`;
        if (out.has(key)) continue; // first book wins
        out.set(key, {
          player,
          market,
          line: primary.line,
          overOdds: primary.over,
          underOdds: primary.under,
          fairOverProb: devigOver(primary.over, primary.under),
          book,
          priceMode: "over-under",
          overLabel: "OVER",
          underLabel: "UNDER",
        });
      }
    }
  }
  return [...out.values()];
}

// ── LIVE: fetch one event's prop lines ───────────────────────────────────────────
async function oddsGet(path, params) {
  const res = await axios.get(`${ODDS_BASE}${path}`, {
    timeout: TIMEOUT_MS,
    params: { apiKey: ODDS_API_KEY, oddsFormat: "american", ...params },
  });
  return { data: res.data, remaining: res.headers["x-requests-remaining"] || null };
}

function sportKey(sport) {
  return FOOTBALL_SPORTS[String(sport || "").toLowerCase()] || null;
}

async function fetchEventPropLines(eventId, sport = "nfl") {
  const providerSport = sportKey(sport);
  if (!providerSport) throw new Error(`unsupported football props sport: ${sport}`);
  const { data, remaining } = await oddsGet(`/sports/${providerSport}/events/${eventId}/odds`, {
    regions: "us",
    markets: ALL_ODDSKEYS.join(","),
  });
  return { lines: parsePropLines(data), remaining, capturedAt: new Date().toISOString() };
}

// ── LIVE: list football events within a day window (the free /events call) ───────
async function listEventsWithin(daysAhead, sport = "nfl") {
  const providerSport = sportKey(sport);
  if (!providerSport) throw new Error(`unsupported football props sport: ${sport}`);
  const res = await axios.get(`${ODDS_BASE}/sports/${providerSport}/events`, {
    timeout: TIMEOUT_MS,
    params: { apiKey: ODDS_API_KEY, dateFormat: "iso" },
  });
  const now = Date.now();
  const horizon = now + daysAhead * 864e5;
  return (Array.isArray(res.data) ? res.data : [])
    .map((e) => ({ id: e.id, commence: e.commence_time, home: e.home_team, away: e.away_team, t: e.commence_time ? new Date(e.commence_time).getTime() : null }))
    .filter((e) => e.t != null && e.t >= now && e.t <= horizon)
    .sort((a, b) => a.t - b.t);
}

// ── LIVE: aggregate normalized prop lines across the imminent slate ──────────────
// daysAhead mirrors the shadow logger's imminence window. maxEvents caps credit spend.
async function getFootballPropLines({ sport = "nfl", daysAhead = 8, maxEvents = 16 } = {}) {
  const league = String(sport || "").toLowerCase();
  if (!sportKey(league)) return { ok: false, sport: league, error: "unsupported football props sport", lines: [] };
  if (!ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured", lines: [] };
  let events = [];
  try { events = await listEventsWithin(daysAhead, league); }
  catch (e) { return { ok: false, error: `events list failed: ${e.message}`, lines: [] }; }

  const sampled = events.slice(0, maxEvents);
  const allLines = [];
  const byEvent = {};
  let remaining = null;
  for (const ev of sampled) {
    try {
      const { lines, remaining: rem, capturedAt } = await fetchEventPropLines(ev.id, league);
      if (rem != null) remaining = rem;
      byEvent[ev.id] = { matchup: `${ev.away} @ ${ev.home}`, commence: ev.commence, capturedAt, lines: lines.length };
      for (const ln of lines) allLines.push({ ...ln, eventId: ev.id, matchup: `${ev.away} @ ${ev.home}`, quoteCapturedAt: capturedAt });
    } catch (e) {
      byEvent[ev.id] = { matchup: `${ev.away} @ ${ev.home}`, error: e.message };
    }
  }

  const byMarket = {};
  for (const ln of allLines) byMarket[ln.market] = (byMarket[ln.market] || 0) + 1;

  return {
    ok: true,
    sport: league,
    daysAhead,
    eventsInWindow: events.length,
    eventsSampled: sampled.length,
    linesFound: allLines.length,
    byMarket,
    creditsRemaining: remaining,
    note: allLines.length === 0
      ? `No ${league.toUpperCase()} player-prop lines were returned in this window.`
      : "Normalized per-player prop lines. Each displayed price remains attached to its source book and line.",
    byEvent,
    lines: allLines,
  };
}

async function getNflPropLines(options = {}) {
  return getFootballPropLines({ ...options, sport: "nfl" });
}

module.exports = {
  parsePropLines,
  devigOver,
  americanToImplied,
  fetchEventPropLines,
  getFootballPropLines,
  getNflPropLines,
  FOOTBALL_SPORTS,
  MARKET_SPECS,
  MARKET_TO_ODDSKEY,
  ODDSKEY_TO_MARKET,
};
