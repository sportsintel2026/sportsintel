// WZ-NFLPROPSODDS-2026-07-05
// nflPropsOdds.js  —  WizePicks NFL player-prop ODDS fetcher/parser (Phase 3, B-1).
//
// Fetches event-level NFL player-prop markets from The Odds API and normalizes them
// into per-player lines the shadow logger can pair with a projection. Mirrors the
// proven MLB prop pattern (parseHitsProps / parseTotalBasesProps): iterate
// bookmakers -> markets (by key) -> outcomes, where outcome.description = player,
// outcome.name = Over/Under, outcome.point = line, outcome.price = American odds;
// keep the player's PRIMARY line (lowest line quoted with BOTH sides), first book wins.
//
// VERIFICATION STATUS: the fetch/parse plumbing is exercised live via the diagnostic
// route, but NFL player props are not posted by books until ~preseason (first opener
// ~Aug 7), so today this returns empty and the PARSER is verified offline against a
// realistic fixture. When the first real NFL prop lands in August, re-run the route
// and confirm the shape before the shadow logger relies on it ("wired != flowing").
//
// Isolated module (own axios, own helpers) so a bug here cannot destabilize the feed.
// CommonJS. Node 18+.

const axios = require("axios");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const NFL_SPORT = "americanfootball_nfl";
const TIMEOUT_MS = 9000;

// internal market <-> The Odds API market key
const MARKET_TO_ODDSKEY = {
  pass_yds: "player_pass_yds",
  rush_yds: "player_rush_yds",
  receptions: "player_receptions",
  rec_yds: "player_reception_yds",
};
const ODDSKEY_TO_MARKET = Object.fromEntries(Object.entries(MARKET_TO_ODDSKEY).map(([k, v]) => [v, k]));
const ALL_ODDSKEYS = Object.values(MARKET_TO_ODDSKEY);

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

// ── PURE: parse an event-odds payload into normalized per-player prop lines ───────
// Returns [{ player, market, line, overOdds, underOdds, fairOverProb, book }].
// Per (market, player): keep the PRIMARY line (lowest line with both sides priced);
// across books, the first book to fully price that market+player wins.
function parsePropLines(oddsJson) {
  const out = new Map(); // key `${market}::${player}` -> record (first book wins)
  for (const bm of (oddsJson && oddsJson.bookmakers) || []) {
    for (const m of bm.markets || []) {
      const market = ODDSKEY_TO_MARKET[m.key];
      if (!market) continue;
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
          book: bm.title || bm.key,
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

async function fetchEventPropLines(eventId) {
  const { data, remaining } = await oddsGet(`/sports/${NFL_SPORT}/events/${eventId}/odds`, {
    regions: "us",
    markets: ALL_ODDSKEYS.join(","),
  });
  return { lines: parsePropLines(data), remaining };
}

// ── LIVE: list NFL events within a day window (the free /events call) ────────────
async function listEventsWithin(daysAhead) {
  const res = await axios.get(`${ODDS_BASE}/sports/${NFL_SPORT}/events`, {
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
async function getNflPropLines({ daysAhead = 8, maxEvents = 16 } = {}) {
  if (!ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured", lines: [] };
  let events = [];
  try { events = await listEventsWithin(daysAhead); }
  catch (e) { return { ok: false, error: `events list failed: ${e.message}`, lines: [] }; }

  const sampled = events.slice(0, maxEvents);
  const allLines = [];
  const byEvent = {};
  let remaining = null;
  for (const ev of sampled) {
    try {
      const { lines, remaining: rem } = await fetchEventPropLines(ev.id);
      if (rem != null) remaining = rem;
      byEvent[ev.id] = { matchup: `${ev.away} @ ${ev.home}`, commence: ev.commence, lines: lines.length };
      for (const ln of lines) allLines.push({ ...ln, eventId: ev.id, matchup: `${ev.away} @ ${ev.home}` });
    } catch (e) {
      byEvent[ev.id] = { matchup: `${ev.away} @ ${ev.home}`, error: e.message };
    }
  }

  const byMarket = {};
  for (const ln of allLines) byMarket[ln.market] = (byMarket[ln.market] || 0) + 1;

  return {
    ok: true,
    daysAhead,
    eventsInWindow: events.length,
    eventsSampled: sampled.length,
    linesFound: allLines.length,
    byMarket,
    creditsRemaining: remaining,
    note: allLines.length === 0
      ? "No NFL player-prop lines posted in this window yet (expected until ~preseason opener ~Aug 7). Plumbing ran clean; re-verify shape when the first real line lands."
      : "Normalized per-player prop lines. First book wins; primary (lowest fully-priced) line kept.",
    byEvent,
    lines: allLines,
  };
}

module.exports = {
  parsePropLines,
  devigOver,
  americanToImplied,
  fetchEventPropLines,
  getNflPropLines,
  MARKET_TO_ODDSKEY,
  ODDSKEY_TO_MARKET,
};
