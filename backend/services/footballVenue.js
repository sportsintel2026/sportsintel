/**
 * footballVenue.js — WizePicks shared NEUTRAL-SITE resolver for NFL and CFB.
 * WZ-FBNEUTRAL-2026-08-03
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * The model applies home-field advantage in points (NFL_HFA_POINTS 2.5,
 * CFB_HFA_POINTS 3.0) to the nominal home team on every game. Both models already
 * honour `ctx.neutralSite` and zero the HFA when it is set — but nothing ever set it:
 *
 *   - The Odds API events carry no venue/neutral field at all (`neutralSite` appeared
 *     ZERO times in oddsApi.js), so cfbEdges' `!!ev.neutralSite` read was always false.
 *     Dead code reading a field that never existed. Deleted in this change.
 *   - nflEdges never even attempted it.
 *
 * So every neutral game was priced with a full home edge that does not exist. That is
 * ~2.5 pts (NFL international games) and ~3.0 pts (CFB Week 0 in Dublin and Rio, plus
 * the neutral-site Week 1 kickoff games in Atlanta, Nashville and Green Bay). At
 * CFB_SIGMA 15.5 a phantom 3.0 pts is ~7.5 probability points on the raw model.
 *
 * ── THE SOURCE ────────────────────────────────────────────────────────────────
 * ESPN's scoreboard already carries it and both data layers already parse it:
 * `neutralSite: !!comp.neutralSite` in nflDataSource.js and cfbDataSource.js. The data
 * was in the repo the whole time and simply was not joined to the odds path. This
 * module does that join — one place, both leagues, so NFL and CFB cannot drift apart.
 *
 * ── THE MATCHER ───────────────────────────────────────────────────────────────
 * Odds events and ESPN games come from two vendors with two ID spaces, so names are all
 * we have. That problem is already solved in predictionTracker.gradeFootball, and this
 * MIRRORS it rather than inventing a second matcher:
 *   matchupKey(away, home, null, league)  — canonical "AWAY|HOME", alias-resolved
 *   CFB fallback on cfbSchoolKey (school minus mascot), COLLISION-GUARDED: a school
 *   token claimed by two games resolves to null and is refused, never guessed
 *   (both Miamis collapse to "miami" by design).
 * startTime is deliberately not passed to matchupKey, for the same reason the grader
 * omits it: the two feeds' start times disagree by minutes, which would break the key
 * rather than sharpen it. The +/-1 day window covers ESPN's filing-date drift.
 *
 * ── FAILURE POLICY ────────────────────────────────────────────────────────────
 * This must never take the board down and must never invent a venue.
 *   - A board fetch that throws contributes nothing; other dates still resolve.
 *   - An unmatched game returns null = UNKNOWN, and callers leave neutralSite unset,
 *     which is exactly today's behaviour. Unknown degrades to the status quo, never to
 *     a guess in either direction.
 *   - Coverage is reported in `meta` so "we resolved 0 of 60" is visible instead of
 *     looking identical to "no game was neutral".
 *
 * CommonJS. No new dependency.
 */

const { matchupKey, cfbSchoolKey } = require("./teamKey");

// ISO timestamp -> Eastern calendar date "YYYY-MM-DD". Mirrors predictionTracker.etDate.
function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch { return null; }
}

// Shift a 'YYYY-MM-DD' by N days, anchored at noon UTC so no DST edge rolls the day.
// Mirrors predictionTracker.shiftYmd.
function shiftYmd(dateStr, deltaDays) {
  if (!dateStr) return dateStr;
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a neutral-site lookup over the dates a slate spans.
 *
 * @param {Function} fetchBoard  nflDataSource.fetchScoreboard | cfbDataSource.fetchScoreboard
 * @param {String}   league      "nfl" | "cfb"
 * @param {Array}    events      parsed odds events (need .commenceTime/.homeTeam/.awayTeam)
 * @returns {{ isNeutral: Function, meta: Object }}
 */
async function buildNeutralIndex({ fetchBoard, league, events }) {
  const isCfb = String(league || "").toLowerCase() === "cfb";
  const meta = { league, dates: 0, boardGames: 0, resolved: 0, neutral: 0, unresolved: 0, ambiguous: 0, boardErrors: 0 };

  // Collect every ET date the slate touches, plus one day either side (ESPN files a
  // game under a date that can sit +/-1 from the odds feed's).
  const dates = new Set();
  for (const ev of events || []) {
    const d = etDate(ev && ev.commenceTime);
    if (!d) continue;
    dates.add(shiftYmd(d, -1));
    dates.add(d);
    dates.add(shiftYmd(d, 1));
  }

  const byKey = new Map();
  const bySchool = new Map();
  for (const date of dates) {
    let games = null;
    try { games = await fetchBoard(date); }
    catch (_) { meta.boardErrors++; continue; }   // transient -> this date contributes nothing
    meta.dates++;
    for (const x of games || []) {
      if (!x || !x.home || !x.away) continue;
      meta.boardGames++;
      const k = matchupKey(x.away.displayName, x.home.displayName, null, league);
      if (k && k !== "|" && !byKey.has(k)) byKey.set(k, x);
      if (isCfb) {
        const sk = `${cfbSchoolKey(x.away.displayName)}|${cfbSchoolKey(x.home.displayName)}`;
        if (sk !== "|") {
          if (bySchool.has(sk)) { if (bySchool.get(sk) !== x) bySchool.set(sk, null); } // collision -> refuse
          else bySchool.set(sk, x);
        }
      }
    }
  }

  // Returns true | false | null(unknown). Callers must treat null as "leave unset".
  function isNeutral(awayName, homeName) {
    const k = matchupKey(awayName, homeName, null, league);
    let g = (k && k !== "|") ? (byKey.get(k) || null) : null;
    if (!g && isCfb) {
      const sk = `${cfbSchoolKey(awayName)}|${cfbSchoolKey(homeName)}`;
      if (sk !== "|" && bySchool.has(sk)) {
        const cand = bySchool.get(sk);
        if (cand) g = cand;
        else { meta.ambiguous++; meta.unresolved++; return null; }  // shared-campus name -> refuse to guess
      }
    }
    if (!g) { meta.unresolved++; return null; }
    meta.resolved++;
    if (g.neutralSite === true) { meta.neutral++; return true; }
    return false;
  }

  return { isNeutral, meta };
}

module.exports = { buildNeutralIndex, _internal: { etDate, shiftYmd } };
