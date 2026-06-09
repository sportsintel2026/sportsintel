// The Odds API client (the-odds-api.com)
// Free tier: 500 requests/month — we cache aggressively
// Docs: https://the-odds-api.com/liveapi/guides/v4/

const axios = require("axios");

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

// Sportsbooks we accept odds from
// Main markets (h2h, totals) — major US books
const PREFERRED_BOOKS_MAIN = ["draftkings", "fanduel", "betmgm", "caesars", "espnbet", "fanatics", "betrivers", "hardrockbet"];
// HR props — broader list because major books often don't post HR props
const PREFERRED_BOOKS_HR = [
  "draftkings", "fanduel", "betmgm", "caesars",
  "betrivers", "betonlineag", "bovada", "betus",
  "mybookieag", "lowvig", "williamhill_us", "espnbet",
  "fanatics", "hardrockbet",
];

function isCacheValid(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

async function oddsGet(path, params = {}) {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY not configured");
  }
  const res = await axios.get(`${ODDS_BASE}${path}`, {
    params: { apiKey: ODDS_API_KEY, ...params },
    timeout: 10000,
  });
  const remaining = res.headers["x-requests-remaining"];
  const used = res.headers["x-requests-used"];
  if (remaining != null) {
    console.log(`[OddsAPI] Used ${used}, Remaining ${remaining}`);
  }
  return res.data;
}

// ── MLB Moneyline + Totals ────────────────────────────────────────────────────

async function getMLBMainOdds() {
  const cacheKey = "mlb_main";
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log("[OddsAPI] Returning cached MLB main odds");
    return cached.data;
  }
  try {
    const data = await oddsGet("/sports/baseball_mlb/odds", {
      regions: "us",
      markets: "h2h,totals,spreads",
      oddsFormat: "american",
      dateFormat: "iso",
    });
    const games = (data || []).map(parseMainOddsEvent);
    cache.set(cacheKey, { data: games, fetchedAt: Date.now() });
    return games;
  } catch (e) {
    console.error("[OddsAPI] MLB main odds error:", e.message);
    if (cached) return cached.data;
    return [];
  }
}

// Live-game odds: SAME data shape as getMLBMainOdds, but a much shorter cache so
// in-game lines stay fresh for the live-edge route. Pre-game uses the 30-min
// cache above; only the live route should call this. 3-min cache keeps in-game
// lines current while staying within the API credit budget (only fetched while
// games are actually live, since the live route only calls it when it has live games).
const LIVE_ODDS_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getMLBLiveOdds() {
  const cacheKey = "mlb_live_odds";
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < LIVE_ODDS_TTL_MS) {
    return cached.data;
  }
  try {
    const data = await oddsGet("/sports/baseball_mlb/odds", {
      regions: "us",
      markets: "h2h,totals,spreads",
      oddsFormat: "american",
      dateFormat: "iso",
    });
    const games = (data || []).map(parseMainOddsEvent);
    cache.set(cacheKey, { data: games, fetchedAt: Date.now() });
    return games;
  } catch (e) {
    console.error("[OddsAPI] MLB live odds error:", e.message);
    if (cached) return cached.data;
    return [];
  }
}

// ── Odds sanity guard ─────────────────────────────────────────────────────────
// Best-price line shopping keeps the HIGHEST price across books. That means a
// single stale, suspended, or errored book quote (e.g. a +3300 MLB moneyline or
// a +640 total) would win "best price" and get recorded as our pick — poisoning
// edge, ROI, and CLV all at once. These bands are deliberately wide: they pass
// every real MLB price and only reject clearly-broken outliers. A rejected quote
// is simply skipped, so the best price from the remaining good books still wins.
function plausibleMlOdds(price) {
  // Real MLB moneylines / run lines never reach these extremes.
  return price != null && price < 600 && price > -600;
}
function plausibleTotalOdds(price) {
  // Real MLB total prices sit near even money; reject anything wild.
  return price != null && price < 300 && price > -400;
}
// Real MLB game totals sit in a tight band. A "totals" market that returns a
// LADDER of alternate lines (1.5, 2.5 … 15.5) was letting junk rungs like
// "Over 1.5 @ +105" get stamped onto a real price — the price looked sane, but
// nothing guarded the LINE. Reject any line outside the real game-total range.
const MLB_TOTAL_LINE_MIN = 5.5;
const MLB_TOTAL_LINE_MAX = 13.5;
function plausibleTotalLine(point) {
  return typeof point === "number" && point >= MLB_TOTAL_LINE_MIN && point <= MLB_TOTAL_LINE_MAX;
}

function parseMainOddsEvent(ev) {
  const h2h = { away: null, home: null, awayBook: null, homeBook: null };
  const totals = { line: null, over: null, under: null, overBook: null, underBook: null };
  // Run line (spreads). MLB run line is ~always ±1.5. We capture the best price
  // for the away and home sides AT the 1.5 line (away point +/-1.5, home point -/+1.5).
  const spreads = { awayLine: null, away: null, awayBook: null, homeLine: null, home: null, homeBook: null };

  // Collect every totals quote across books first, so we can pick the consensus
  // line and then the best price AT that line (keeps over/under on the same number).
  const totalsQuotes = []; // { line, over, overBook, under, underBook }

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS_MAIN.includes(bm.key)) continue;
    for (const m of bm.markets || []) {
      if (m.key === "h2h") {
        const awayOutcome = m.outcomes?.find(o => o.name === ev.away_team);
        const homeOutcome = m.outcomes?.find(o => o.name === ev.home_team);
        if (awayOutcome && plausibleMlOdds(awayOutcome.price) && (h2h.away == null || awayOutcome.price > h2h.away)) {
          h2h.away = awayOutcome.price;
          h2h.awayBook = bm.title;
        }
        if (homeOutcome && plausibleMlOdds(homeOutcome.price) && (h2h.home == null || homeOutcome.price > h2h.home)) {
          h2h.home = homeOutcome.price;
          h2h.homeBook = bm.title;
        }
      } else if (m.key === "totals" && m.outcomes?.length >= 2) {
        // A book may return a LADDER of total lines as separate outcomes, not just
        // the main line. Group outcomes by their point, pair Over & Under AT THE
        // SAME line, and only accept lines in the real game-total range. This kills
        // junk rungs (e.g. Over 1.5) and prevents a line from one rung being paired
        // with a price from another. Downstream, the consensus line across books
        // still resolves to the true main line.
        const byPoint = new Map();
        for (const o of m.outcomes || []) {
          if (o.point == null || !plausibleTotalLine(o.point)) continue;
          const slot = byPoint.get(o.point) || {};
          if (o.name === "Over") slot.over = o.price;
          else if (o.name === "Under") slot.under = o.price;
          byPoint.set(o.point, slot);
        }
        for (const [point, slot] of byPoint) {
          if (slot.over != null && slot.under != null
              && plausibleTotalOdds(slot.over) && plausibleTotalOdds(slot.under)) {
            totalsQuotes.push({
              line: point,
              over: slot.over, overBook: bm.title,
              under: slot.under, underBook: bm.title,
            });
          }
        }
      } else if (m.key === "spreads" && m.outcomes?.length >= 2) {
        // Run line: take the standard ±1.5 outcomes for each team, best price.
        const awayOutcome = m.outcomes.find(o => o.name === ev.away_team && Math.abs(o.point) === 1.5);
        const homeOutcome = m.outcomes.find(o => o.name === ev.home_team && Math.abs(o.point) === 1.5);
        if (awayOutcome && plausibleMlOdds(awayOutcome.price) && (spreads.away == null || awayOutcome.price > spreads.away)) {
          spreads.away = awayOutcome.price;
          spreads.awayLine = awayOutcome.point;
          spreads.awayBook = bm.title;
        }
        if (homeOutcome && plausibleMlOdds(homeOutcome.price) && (spreads.home == null || homeOutcome.price > spreads.home)) {
          spreads.home = homeOutcome.price;
          spreads.homeLine = homeOutcome.point;
          spreads.homeBook = bm.title;
        }
      }
    }
  }

  // Pick the consensus (most common) totals line, then the best over & best under
  // offered AT that line. This shops for price the way moneyline does, but keeps
  // both sides anchored to one line (avoids comparing the model to mismatched lines).
  if (totalsQuotes.length > 0) {
    const lineCounts = {};
    for (const q of totalsQuotes) lineCounts[q.line] = (lineCounts[q.line] || 0) + 1;
    const consensusLine = Number(
      Object.entries(lineCounts).sort((a, b) => b[1] - a[1])[0][0]
    );
    totals.line = consensusLine;
    for (const q of totalsQuotes) {
      if (q.line !== consensusLine) continue;
      if (totals.over == null || q.over > totals.over) { totals.over = q.over; totals.overBook = q.overBook; }
      if (totals.under == null || q.under > totals.under) { totals.under = q.under; totals.underBook = q.underBook; }
    }
  }

  return {
    eventId: ev.id,
    commenceTime: ev.commence_time,
    homeTeam: ev.home_team,
    awayTeam: ev.away_team,
    h2h,
    totals,
    spreads,
  };
}

// ── MLB Player HR Props ───────────────────────────────────────────────────────

async function getMLBHRPropsForEvent(eventId) {
  const cacheKey = `mlb_hr_${eventId}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) {
    console.log(`[OddsAPI] HR cached for ${eventId}: ${cached.data.length} props`);
    return cached.data;
  }
  try {
    const data = await oddsGet(`/sports/baseball_mlb/events/${eventId}/odds`, {
      regions: "us",
      markets: "batter_home_runs",
      oddsFormat: "american",
    });

    const bookmakerCount = data?.bookmakers?.length ?? 0;
    const bmKeys = (data?.bookmakers || []).map(b => b.key);
    console.log(`[OddsAPI-HR] Event ${eventId}: ${bookmakerCount} bookmakers: ${JSON.stringify(bmKeys)}`);

    const props = parseHRProps(data);
    console.log(`[OddsAPI-HR] Parsed ${props.length} HR props from event ${eventId}`);

    cache.set(cacheKey, { data: props, fetchedAt: Date.now() });
    return props;
  } catch (e) {
    console.error(`[OddsAPI] HR props error for ${eventId}:`, e.message);
    if (cached) return cached.data;
    return [];
  }
}

function parseHRProps(ev) {
  // Only accept the "to hit a HR" line (point = 0.5 means at least 1 HR)
  // Other lines like 1.5 are "at least 2 HRs" which is a different (much harder) bet
  const playerMap = new Map();

  for (const bm of ev.bookmakers || []) {
    if (!PREFERRED_BOOKS_HR.includes(bm.key)) continue;
    for (const m of bm.markets || []) {
      if (m.key !== "batter_home_runs") continue;
      for (const o of m.outcomes || []) {
        // Only "Over" outcomes (the "Yes, will hit a HR" side)
        if (o.name !== "Over") continue;
        // Only the standard 0.5 line (at least 1 HR)
        // Skip 1.5, 2.5 lines — those are different bets
        const line = o.point ?? 0.5;
        if (line !== 0.5) continue;

        const player = o.description;
        if (!player) continue;

        // Keep best (highest) odds across books
        const current = playerMap.get(player);
        if (!current || o.price > current.price) {
          playerMap.set(player, {
            player,
            price: o.price,
            book: bm.title,
            line,
          });
        }
      }
    }
  }
  return Array.from(playerMap.values());
}

// ── MLB Pitcher Strikeout Props ───────────────────────────────────────────────
// Two-sided market (Over/Under a line), so unlike HR props we can de-vig cleanly.
async function getMLBStrikeoutPropsForEvent(eventId) {
  const cacheKey = `mlb_k_${eventId}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) return cached.data;
  try {
    const data = await oddsGet(`/sports/baseball_mlb/events/${eventId}/odds`, {
      regions: "us",
      markets: "pitcher_strikeouts",
      oddsFormat: "american",
    });
    const props = parseStrikeoutProps(data);
    console.log(`[OddsAPI-K] Parsed ${props.length} strikeout props from event ${eventId}`);
    cache.set(cacheKey, { data: props, fetchedAt: Date.now() });
    return props;
  } catch (e) {
    console.error(`[OddsAPI] K props error for ${eventId}:`, e.message);
    if (cached) return cached.data;
    return [];
  }
}

// Per pitcher, keep the FIRST book that posts BOTH Over and Under at the same line
// (a same-book pair is required to de-vig). Returns { player, line, overOdds, underOdds, book }.
function parseStrikeoutProps(ev) {
  const out = new Map(); // player -> pair
  for (const bm of (ev.bookmakers || [])) {
    for (const m of (bm.markets || [])) {
      if (m.key !== "pitcher_strikeouts") continue;
      const byPlayer = new Map(); // player -> { line, over, under }
      for (const o of (m.outcomes || [])) {
        const player = o.description;
        if (!player || o.point == null || o.price == null) continue;
        const side = (o.name || "").toLowerCase();
        const rec = byPlayer.get(player) || { line: o.point };
        if (side === "over") rec.over = o.price;
        else if (side === "under") rec.under = o.price;
        rec.line = o.point;
        byPlayer.set(player, rec);
      }
      for (const [player, rec] of byPlayer) {
        if (rec.over == null || rec.under == null) continue;
        if (out.has(player)) continue; // first book wins
        out.set(player, { player, line: rec.line, overOdds: rec.over, underOdds: rec.under, book: bm.title });
      }
    }
  }
  return Array.from(out.values());
}

async function getMLBStrikeoutPropsForAllEvents(eventIds, maxEvents = 5) {
  const targets = eventIds.slice(0, maxEvents);
  const results = {};
  for (const id of targets) {
    results[id] = await getMLBStrikeoutPropsForEvent(id);
  }
  return results;
}

async function getMLBHRPropsForAllEvents(eventIds, maxEvents = 5) {
  const targets = eventIds.slice(0, maxEvents);
  const results = {};
  for (const id of targets) {
    results[id] = await getMLBHRPropsForEvent(id);
  }
  return results;
}

// ── MLB Batter Hits Props ─────────────────────────────────────────────────────
// Two-sided; standard 0.5 line ("1+ hits"). Filter to 0.5 to avoid mixing alt lines.
async function getMLBHitsPropsForEvent(eventId) {
  const cacheKey = `mlb_hits_${eventId}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) return cached.data;
  try {
    const data = await oddsGet(`/sports/baseball_mlb/events/${eventId}/odds`, {
      regions: "us",
      markets: "batter_hits",
      oddsFormat: "american",
    });
    const props = parseHitsProps(data);
    console.log(`[OddsAPI-Hits] Parsed ${props.length} hits props from event ${eventId}`);
    cache.set(cacheKey, { data: props, fetchedAt: Date.now() });
    return props;
  } catch (e) {
    console.error(`[OddsAPI] Hits props error for ${eventId}:`, e.message);
    if (cached) return cached.data;
    return [];
  }
}

function parseHitsProps(ev) {
  const out = new Map();
  for (const bm of (ev.bookmakers || [])) {
    for (const m of (bm.markets || [])) {
      if (m.key !== "batter_hits") continue;
      const byPlayer = new Map();
      for (const o of (m.outcomes || [])) {
        if (o.point !== 0.5) continue; // standard "1+ hits" line only
        const player = o.description;
        if (!player || o.price == null) continue;
        const side = (o.name || "").toLowerCase();
        const rec = byPlayer.get(player) || { line: 0.5 };
        if (side === "over") rec.over = o.price;
        else if (side === "under") rec.under = o.price;
        byPlayer.set(player, rec);
      }
      for (const [player, rec] of byPlayer) {
        if (rec.over == null || rec.under == null) continue;
        if (out.has(player)) continue; // first book wins
        out.set(player, { player, line: 0.5, overOdds: rec.over, underOdds: rec.under, book: bm.title });
      }
    }
  }
  return Array.from(out.values());
}

async function getMLBHitsPropsForAllEvents(eventIds, maxEvents = 5) {
  const targets = eventIds.slice(0, maxEvents);
  const results = {};
  for (const id of targets) {
    results[id] = await getMLBHitsPropsForEvent(id);
  }
  return results;
}

// ── Convert American odds to implied probability ──────────────────────────────

function americanToImpliedProb(american) {
  if (american == null) return null;
  if (american >= 100) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

// ── Cache management ──────────────────────────────────────────────────────────

function clearOddsCache() {
  const size = cache.size;
  cache.clear();
  console.log(`[OddsAPI] Cleared cache (${size} entries)`);
}

function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

// DEBUG (read-only): returns the RAW totals-market outcomes per book for the MLB
// slate, exactly as the Odds API returns them (unparsed). Lets us confirm whether
// the "totals" market is a single main line or a ladder of alternate lines (which
// would explain junk lines like 1.5 / 15.5 leaking into picks). `filter` matches
// the matchup text (e.g. "LAD") or an Odds-API event id; omit to dump the slate.
// Costs ~2 Odds API credits per call — run on demand, not on a schedule.
async function getRawTotalsDebug(filter) {
  const data = await oddsGet("/sports/baseball_mlb/odds", {
    regions: "us",
    markets: "h2h,totals,spreads",
    oddsFormat: "american",
    dateFormat: "iso",
  });
  const f = filter ? String(filter).toLowerCase() : null;
  const out = [];
  for (const ev of data || []) {
    const matchup = `${ev.away_team} @ ${ev.home_team}`;
    if (f && !(matchup.toLowerCase().includes(f) || ev.id === filter)) continue;
    const books = [];
    for (const bm of ev.bookmakers || []) {
      const tot = (bm.markets || []).find(m => m.key === "totals");
      if (!tot) continue;
      books.push({
        book: bm.key,
        outcomeCount: (tot.outcomes || []).length,
        outcomes: (tot.outcomes || []).map(o => ({ name: o.name, point: o.point, price: o.price })),
      });
    }
    out.push({ eventId: ev.id, matchup, commenceTime: ev.commence_time, books });
  }
  return { ok: true, events: out.length, data: out };
}

// ── READ-ONLY coverage + cost probe (for the line-shopping page feasibility) ──
// Answers the two questions that decide whether a multi-book odds page is a $7
// feature or a budget-buster: (1) which bookmakers does THIS key actually return
// (the line-shopping inventory), and (2) what does one all-books pull COST in
// Odds API credits. The Odds API bills regions × markets per call and returns the
// exact cost of the call in the `x-requests-last` header. Makes ONE live call
// (so it costs a few credits to run). Widen coverage with regions=us,us2,uk,eu —
// each region adds cost. Writes nothing.
async function probeOddsCoverage({ regions = "us", markets = "h2h,totals", sport = "baseball_mlb" } = {}) {
  if (!ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured" };
  try {
    const res = await axios.get(`${ODDS_BASE}/sports/${sport}/odds`, {
      params: { apiKey: ODDS_API_KEY, regions, markets, oddsFormat: "american" },
      timeout: 15000,
    });
    const games = res.data || [];
    const hdr = res.headers || {};
    const creditsLast = hdr["x-requests-last"] != null ? Number(hdr["x-requests-last"]) : null;
    const creditsRemaining = hdr["x-requests-remaining"] != null ? Number(hdr["x-requests-remaining"]) : null;
    const creditsUsed = hdr["x-requests-used"] != null ? Number(hdr["x-requests-used"]) : null;

    // Distinct bookmakers across all games = the line-shopping inventory.
    const bookMap = {};
    for (const g of games) {
      for (const bm of g.bookmakers || []) {
        if (!bookMap[bm.key]) bookMap[bm.key] = bm.title || bm.key;
      }
    }
    const books = Object.entries(bookMap)
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    // Sample: first game's per-book prices, so we can see the shape we'd render.
    let sample = null;
    if (games[0]) {
      const g0 = games[0];
      sample = {
        game: `${g0.away_team} @ ${g0.home_team}`,
        commence: g0.commence_time,
        perBook: (g0.bookmakers || []).map(bm => {
          const h2h = (bm.markets || []).find(m => m.key === "h2h");
          const tot = (bm.markets || []).find(m => m.key === "totals");
          return {
            book: bm.title || bm.key,
            h2h: h2h ? h2h.outcomes.map(o => `${o.name} ${o.price}`).join(" / ") : null,
            total: tot ? tot.outcomes.map(o => `${o.name} ${o.point} (${o.price})`).join(" / ") : null,
          };
        }),
      };
    }

    const perRefresh = creditsLast != null ? creditsLast
      : regions.split(",").length * markets.split(",").length;
    const costModel = {
      creditsPerRefresh: perRefresh,
      howBillingWorks: "Odds API bills (regions × markets) credits per call; x-requests-last is the exact cost of THIS call.",
      estDailyAt_every5min: perRefresh * 288,
      estDailyAt_every15min: perRefresh * 96,
      estDailyAt_every30min: perRefresh * 48,
      estMonthlyAt_every5min: perRefresh * 288 * 30,
      estMonthlyAt_every15min: perRefresh * 96 * 30,
      note: "Refresh-on-view + caching is far cheaper than a fixed interval — the page only costs credits when someone loads it past the cache window. Use this + creditsRemaining to judge headroom on the current plan.",
    };

    return {
      ok: true,
      sport, regions, markets,
      games: games.length,
      bookCount: books.length,
      books,
      credits: { thisCall: creditsLast, remaining: creditsRemaining, used: creditsUsed },
      costModel,
      sample,
      note: "READ-ONLY. 'books' = every bookmaker your key returned for these regions = your line-shopping inventory. Widen via ?regions=us,us2,uk,eu (each region adds credits). Add markets via ?markets=h2h,totals,spreads.",
    };
  } catch (e) {
    const status = e.response?.status;
    const remaining = e.response?.headers?.["x-requests-remaining"];
    return {
      ok: false,
      error: e.message,
      httpStatus: status,
      creditsRemaining: remaining != null ? Number(remaining) : undefined,
      hint: status === 401 ? "401 = bad/missing ODDS_API_KEY"
        : status === 422 ? "422 = a regions/markets value isn't allowed on this plan (try regions=us, markets=h2h,totals)"
        : undefined,
    };
  }
}

module.exports = {
  getMLBMainOdds,
  getMLBLiveOdds,
  getMLBHRPropsForEvent,
  getMLBHRPropsForAllEvents,
  getMLBStrikeoutPropsForEvent,
  getMLBStrikeoutPropsForAllEvents,
  getMLBHitsPropsForEvent,
  getMLBHitsPropsForAllEvents,
  americanToImpliedProb,
  getRawTotalsDebug,
  probeOddsCoverage,
  clearOddsCache,
  getCacheStats,
};
