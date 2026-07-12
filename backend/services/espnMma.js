// espnMma.js :: WZ-UFC-ESPN-2026-07-11
// Faster UFC results source. Cito is our primary feed but posts winnerFighterSlug slowly (it
// waits on official commission confirmation, often 30-90 min after the finish). ESPN's public
// MMA scoreboard usually shows a winner within minutes, so the grader uses this as a FALLBACK
// to settle a bout when Cito's winner is still null. Read-only, no API key.
//
// SAFETY: settling from ESPN is name-matched, so it is deliberately CONSERVATIVE -- a bout is
// only settled from ESPN when BOTH fighters match the SAME completed ESPN fight (by name or
// slug, accent- and suffix-normalized) AND ESPN marks a clear winner. Anything ambiguous stays
// pending for Cito. A wrong grade is far worse than a slow one.

const axios = require("axios");

const ESPN_UFC_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";

// strip accents + common suffixes + non-alphanumerics, lowercase -> stable match key
function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // Benoît -> Benoit
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Fetch ESPN's current UFC scoreboard -> finished fights as
// [{ a, b, winner, completed }] with NORMALIZED names (winner = normalized name or null).
// Fail-safe: returns [] on any error.
async function getEspnUfcResults() {
  try {
    const res = await axios.get(ESPN_UFC_SCOREBOARD, { timeout: 12000 });
    const events = res.data && Array.isArray(res.data.events) ? res.data.events : [];
    const out = [];
    for (const ev of events) {
      const comps = Array.isArray(ev.competitions) ? ev.competitions : [];
      for (const cp of comps) {
        const type = (cp.status && cp.status.type) || {};
        const completed = !!(type.completed || type.state === "post");
        const cptrs = Array.isArray(cp.competitors) ? cp.competitors : [];
        if (cptrs.length < 2) continue;
        const nameOf = (c) =>
          (c.athlete && (c.athlete.displayName || c.athlete.fullName || c.athlete.shortName)) ||
          c.displayName || c.name || "";
        const an = nameOf(cptrs[0]), bn = nameOf(cptrs[1]);
        if (!an || !bn) continue;
        let winner = null;
        if (completed) {
          const wc = cptrs.find((c) => c.winner === true);
          if (wc) winner = normName(nameOf(wc));
        }
        out.push({ a: normName(an), b: normName(bn), winner, completed });
      }
    }
    return out;
  } catch (e) {
    console.error("[ESPN MMA] results fetch failed:", e.message);
    return [];
  }
}

// Resolve a winner corner for a Cito bout from ESPN results. Returns { corner, name } or null.
// Conservative: requires BOTH fighters of the bout to match the SAME completed ESPN fight, and
// the ESPN winner to match one of them. Matches on fighterName, profile name, AND the slug
// (some Cito display names are nicknames -- e.g. "King Green", whose slug is "bobby-green").
function espnWinnerCorner(bout, espnResults) {
  if (!bout || !Array.isArray(espnResults) || !espnResults.length) return null;
  const list = Array.isArray(bout.fighters) ? bout.fighters : [];
  const red = list.find((f) => String(f.corner || "").toLowerCase() === "red");
  const blue = list.find((f) => String(f.corner || "").toLowerCase() === "blue");
  if (!red || !blue) return null;
  const cand = (f) => {
    const s = new Set();
    if (f.fighterName) s.add(normName(f.fighterName));
    if (f.profile && f.profile.name) s.add(normName(f.profile.name));
    if (f.fighterSlug) s.add(normName(String(f.fighterSlug).replace(/-/g, " ")));
    s.delete("");
    return s;
  };
  const rc = cand(red), bc = cand(blue);
  if (!rc.size || !bc.size) return null;
  const hits = (set, cands) => { for (const n of cands) if (set.has(n)) return true; return false; };
  for (const f of espnResults) {
    if (!f.completed || !f.winner) continue;
    const fset = new Set([f.a, f.b]);
    if (hits(fset, rc) && hits(fset, bc)) {
      if (rc.has(f.winner)) return { corner: "red", name: red.fighterName || (red.profile && red.profile.name) || null };
      if (bc.has(f.winner)) return { corner: "blue", name: blue.fighterName || (blue.profile && blue.profile.name) || null };
      return null; // fight matched but the winner didn't resolve -> stay pending for Cito
    }
  }
  return null;
}

module.exports = { getEspnUfcResults, espnWinnerCorner, normName };
