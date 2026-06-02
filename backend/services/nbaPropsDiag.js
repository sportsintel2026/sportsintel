/**
 * services/nbaPropsDiag.js — TEMP diagnostic: does The Odds API return 3PT-made
 * (player_threes) prop lines for a given NBA game? One event call (~1 credit),
 * reports what markets come back and a sample of the threes data. Safe to delete
 * after we've confirmed. Reuses the SAME source/path as nbaProps.js.
 */
const { getNbaMatchup } = require('./nbaMatchup');

const SPORT = 'basketball_nba';
const BASE = `https://api.the-odds-api.com/v4/sports/${SPORT}`;
const KEY = process.env.ODDS_API_KEY;
// probe several plausible threes market keys at once so we learn the right name
const PROBE_MARKETS = 'player_points,player_threes,player_three_pointers_made';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const nickname = (name) => { const p = (name || '').trim().split(/\s+/); return norm(p[p.length - 1]); };

function matchEvent(events, homeName, awayName) {
  const h = norm(homeName), a = norm(awayName);
  let ev = events.find((e) => norm(e.home_team) === h && norm(e.away_team) === a);
  if (ev) return ev;
  ev = events.find((e) => { const eh = norm(e.home_team), ea = norm(e.away_team); return (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea)); });
  if (ev) return ev;
  const hn = nickname(homeName), an = nickname(awayName);
  return events.find((e) => nickname(e.home_team) === hn && nickname(e.away_team) === an) || null;
}

async function diagThrees(gameId) {
  if (!KEY) return { available: false, note: 'No odds API key configured.' };
  const m = await getNbaMatchup(gameId);
  const homeName = m.home && m.home.displayName;
  const awayName = m.away && m.away.displayName;

  const evRes = await fetch(`${BASE}/events?apiKey=${KEY}`);
  if (!evRes.ok) return { available: false, note: 'odds events ' + evRes.status };
  const events = await evRes.json();
  const ev = matchEvent(events, homeName, awayName);
  if (!ev) return { available: false, note: 'No matching Odds API event (props may not be posted yet).', home: homeName, away: awayName };

  const url = `${BASE}/events/${ev.id}/odds?regions=us&markets=${PROBE_MARKETS}&oddsFormat=american&apiKey=${KEY}`;
  const r = await fetch(url);
  if (!r.ok) return { available: false, note: 'odds event-odds ' + r.status, eventId: ev.id };
  const eventOdds = await r.json();

  // report which markets each bookmaker returned, and a small threes sample
  const bookmakers = (eventOdds.bookmakers || []).map((bm) => ({
    book: bm.title || bm.key,
    marketKeys: (bm.markets || []).map((mk) => mk.key),
  }));
  // collect any market that looks like threes, across books
  let threesSample = [];
  let threesKeyFound = null;
  for (const bm of eventOdds.bookmakers || []) {
    for (const mk of bm.markets || []) {
      if (mk.key.includes('three') || mk.key === 'player_threes') {
        threesKeyFound = mk.key;
        threesSample = (mk.outcomes || []).slice(0, 6).map((o) => ({ player: o.description, side: o.name, line: o.point, price: o.price }));
        break;
      }
    }
    if (threesKeyFound) break;
  }

  return {
    note: 'TEMP threes diagnostic. threesKeyFound tells us the real market key; threesSample shows real lines.',
    home: homeName, away: awayName, eventId: ev.id,
    probedMarkets: PROBE_MARKETS,
    bookmakers,
    threesKeyFound,
    threesSampleCount: threesSample.length,
    threesSample,
  };
}

module.exports = { diagThrees };
