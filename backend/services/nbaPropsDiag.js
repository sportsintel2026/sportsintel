/**
 * services/nbaPropsDiag.js — TEMP diagnostic: which 3PT-made market key (if any)
 * does The Odds API accept for a given NBA game? Probes candidate keys ONE AT A
 * TIME (a bad key 422s only its own call, not the batch), then reports which key
 * returned data + a sample. Reuses the SAME source/path as nbaProps.js.
 * ~1 credit per valid market that returns. Safe to delete after we confirm.
 */
const { getNbaMatchup } = require('./nbaMatchup');

const SPORT = 'basketball_nba';
const BASE = `https://api.the-odds-api.com/v4/sports/${SPORT}`;
const KEY = process.env.ODDS_API_KEY;

// every plausible name The Odds API might use for "threes made", tried separately
const CANDIDATE_KEYS = [
  'player_threes',
  'player_three_pointers_made',
  'player_threes_made',
  'player_three_points_made',
  'player_3_pointers_made',
];

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

async function probeKey(eventId, key) {
  const url = `${BASE}/events/${eventId}/odds?regions=us&markets=${key}&oddsFormat=american&apiKey=${KEY}`;
  const r = await fetch(url);
  if (!r.ok) return { key, ok: false, status: r.status };
  const j = await r.json();
  let sample = [];
  let count = 0;
  for (const bm of j.bookmakers || []) {
    for (const mk of bm.markets || []) {
      if (mk.key === key) {
        count += (mk.outcomes || []).length;
        if (sample.length === 0) sample = (mk.outcomes || []).slice(0, 6).map((o) => ({ player: o.description, side: o.name, line: o.point, price: o.price }));
      }
    }
  }
  return { key, ok: true, outcomeCount: count, sample };
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
  if (!ev) return { available: false, note: 'No matching Odds API event.', home: homeName, away: awayName };

  // First confirm the event has ANY props at all by probing a KNOWN-good key.
  const baseline = await probeKey(ev.id, 'player_points');

  const results = [];
  for (const key of CANDIDATE_KEYS) {
    try {
      results.push(await probeKey(ev.id, key));
    } catch (e) {
      results.push({ key, ok: false, error: String(e.message || e) });
    }
  }
  const working = results.find((r) => r.ok && r.outcomeCount > 0) || null;

  return {
    note: 'TEMP threes diagnostic v2 (one key at a time). working = the real 3PT market key, if any.',
    home: homeName, away: awayName, eventId: ev.id,
    pointsBaseline: { ok: baseline.ok, status: baseline.status, outcomeCount: baseline.outcomeCount },
    candidateResults: results,
    working,
  };
}

module.exports = { diagThrees };
