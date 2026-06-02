// nbaInjuryImpact.js — NBA v0.2 injury weighting (Option A: conservative haircut)
// --------------------------------------------------------------------------
// Computes how many projected points a team loses to its INJURED ('Out') players.
//
// HONEST SCOPE / why it's a "haircut", not a true bench-replacement model:
//   ESPN tells us WHO is out and gives every player's gamelog, but it does NOT
//   tell us WHO replaces an injured player or how the minutes redistribute. So a
//   true "star minus exact replacement" number isn't computable from this data.
//   Instead we subtract a DISCOUNTED share of each Out player's own scoring: the
//   team loses the star's points but a bench player recovers SOME, so the net
//   loss is roughly REPLACEMENT_LOSS_SHARE of their PPG. Directionally correct
//   (a 25-PPG star out hurts far more than a 6-PPG reserve) without pretending to
//   know a replacement we can't identify.
//
// SAFETY:
//   - Only 'Out' players count. 'Day-To-Day'/'Questionable' often play, so
//     subtracting them would make the projection WORSE — they're left alone.
//   - Total haircut is CAPPED so a bad feed or a pile of minor names can't tank
//     a projection.
//   - Any player we can't resolve name->id, or whose gamelog fails, is simply
//     skipped (no haircut) — safe partial behavior, never a wrong guess.
//   - Master switch INJURY_IMPACT_ENABLED = false reverts to no adjustment.
//
// Requires Node 18+ (global fetch). CommonJS.
// --------------------------------------------------------------------------

const { fetchGamelog } = require('./nbaGamelog');

const ROSTER = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'; // /{teamId}/roster

const INJURY_IMPACT_ENABLED = true;
// Net share of an Out player's PPG the team actually loses (bench recovers the rest).
const REPLACEMENT_LOSS_SHARE = 0.60;
// Hard cap on total points subtracted from one team (guards against bad feeds).
const MAX_TEAM_HAIRCUT = 12;
// Recent games to average for a player's scoring (recent form > full season).
const RECENT_GAMES = 10;
// Minimum games before we trust a player's PPG enough to subtract it.
const MIN_GAMES = 3;

const _rosterCache = new Map(); // teamId -> { t, athletes }
const _logCache = new Map();    // athleteId -> { t, ppg }
const ROSTER_TTL = 6 * 60 * 60 * 1000;
const LOG_TTL = 30 * 60 * 1000;

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const lastName = (s) => { const p = (s || '').trim().split(/\s+/); return norm(p[p.length - 1]); };

function parseRoster(json) {
  const out = [];
  for (const entry of (json && json.athletes) || []) {
    if (entry && Array.isArray(entry.items)) out.push(...entry.items);
    else if (entry && (entry.id || entry.displayName)) out.push(entry);
  }
  return out;
}

// teamId -> { full:{normName:id}, lastUnique:{lastName:id} }
async function getRosterMap(teamId) {
  if (!teamId) return null;
  const c = _rosterCache.get(teamId);
  if (c && Date.now() - c.t < ROSTER_TTL) return c.map;
  let athletes = [];
  try {
    const rr = await fetch(`${ROSTER}/${teamId}/roster`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (rr.ok) athletes = parseRoster(await rr.json());
  } catch (_) { return null; }
  const full = {};
  const lastCount = {};
  const lastMap = {};
  for (const ath of athletes) {
    const name = ath && (ath.displayName || ath.fullName);
    if (!ath || !ath.id || !name) continue;
    full[norm(name)] = String(ath.id);
    const ln = lastName(name);
    lastCount[ln] = (lastCount[ln] || 0) + 1;
    lastMap[ln] = String(ath.id);
  }
  const lastUnique = {};
  for (const ln in lastCount) if (lastCount[ln] === 1) lastUnique[ln] = lastMap[ln];
  const map = { full, lastUnique };
  _rosterCache.set(teamId, { t: Date.now(), map });
  return map;
}

function resolveId(map, name) {
  if (!map) return null;
  return map.full[norm(name)] || map.lastUnique[lastName(name)] || null;
}

// Average points over the player's most recent games (regular season + playoffs).
async function getRecentPPG(athleteId) {
  const c = _logCache.get(athleteId);
  if (c && Date.now() - c.t < LOG_TTL) return c.ppg;
  let ppg = null;
  try {
    const games = await fetchGamelog(athleteId);
    if (Array.isArray(games) && games.length >= MIN_GAMES) {
      const recent = games.slice(0, RECENT_GAMES);
      const pts = recent.reduce((s, g) => s + (g.points || 0), 0);
      ppg = pts / recent.length;
    }
  } catch (_) { ppg = null; }
  _logCache.set(athleteId, { t: Date.now(), ppg });
  return ppg;
}

// Is this injury status one where the player will NOT play? Only 'out' counts.
function isOut(status) {
  const s = (status || '').toLowerCase();
  return s.includes('out');
}

// Main entry: given a team's injury list [{athlete|name, status}] and its ESPN
// teamId, return { haircut, details } where haircut is the points to SUBTRACT
// from the team's projection. Returns 0 on any failure (safe).
async function computeInjuryHaircut(injuries, teamId) {
  if (!INJURY_IMPACT_ENABLED || !Array.isArray(injuries) || injuries.length === 0 || !teamId) {
    return { haircut: 0, details: [] };
  }
  const outNames = injuries
    .filter((i) => isOut(i.status))
    .map((i) => i.athlete || i.name)
    .filter(Boolean);
  if (outNames.length === 0) return { haircut: 0, details: [] };

  const map = await getRosterMap(teamId);
  if (!map) return { haircut: 0, details: [] };

  const details = [];
  let raw = 0;
  for (const name of outNames) {
    const id = resolveId(map, name);
    if (!id) { details.push({ name, resolved: false }); continue; }
    const ppg = await getRecentPPG(id);
    if (ppg == null) { details.push({ name, id, resolved: true, ppg: null }); continue; }
    const loss = ppg * REPLACEMENT_LOSS_SHARE;
    raw += loss;
    details.push({ name, id, resolved: true, ppg: Math.round(ppg * 10) / 10, loss: Math.round(loss * 10) / 10 });
  }
  const haircut = Math.min(raw, MAX_TEAM_HAIRCUT);
  return { haircut: Math.round(haircut * 10) / 10, details };
}

module.exports = {
  computeInjuryHaircut,
  INJURY_IMPACT_ENABLED,
  REPLACEMENT_LOSS_SHARE,
  MAX_TEAM_HAIRCUT,
  // exported for testing
  resolveId,
  getRosterMap,
  getRecentPPG,
  isOut,
};
