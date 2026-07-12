// espnMma.js :: WZ-UFC-ESPN-2026-07-11 / WZ-UFC-ESPN-NAMEMATCH-2026-07-12
// Faster UFC results source. Cito is our primary feed but posts winnerFighterSlug slowly (it
// waits on official commission confirmation, often 30-90 min after the finish). ESPN's public
// MMA scoreboard usually shows a winner within minutes, so the grader uses this as a FALLBACK
// to settle a bout when Cito's winner is still null. Read-only, no API key.
//
// SAFETY: settling from ESPN is name-matched, so it is deliberately CONSERVATIVE -- a bout is
// only settled from ESPN when BOTH fighters match the SAME completed ESPN fight (to DISTINCT
// competitors) AND ESPN marks a clear winner. Anything ambiguous stays pending for Cito. A wrong
// grade is far worse than a slow one.
//
// WZ-UFC-ESPN-NAMEMATCH-2026-07-12: added a second, still-conservative match tier for abbreviated
// FIRST names (ESPN wrote "Zach Reese" where Cito has "Zachary Reese"). Tier requires the LAST
// name to be identical and the FIRST names to be prefix-compatible (>=3 chars). It runs only
// UNDER the exact tier and still inside the both-corners-distinct + clear-winner guard, so a bout
// where ESPN shows a DIFFERENT opponent (a late replacement -- e.g. Cito's Basharat-vs-Ewing when
// ESPN has Basharat-vs-Garza) still cannot false-settle: the swapped fighter matches neither tier.

const axios = require("axios");

const ESPN_UFC_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";

// strip accents + common suffixes + non-alphanumerics, lowercase -> stable GLUED match key
function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // Benoît -> Benoit
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// accent-stripped, lowercased, suffix-dropped WORD TOKENS -> ["zachary","reese"] (for fuzzy tier)
function nameTokens(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !/^(jr|sr|ii|iii|iv)$/.test(t));
}

// Conservative "same fighter" on tokens: identical LAST name AND prefix-compatible FIRST name
// (equal, or the shorter is a >=3-char prefix of the longer -> Zach/Zachary, Mike/Michael). Any
// difference in last name, or a first-name that is not a clean prefix, is NOT a match. Requires at
// least two tokens on each side so single-token/mononym inputs never fuzzy-match.
function tokensSameFighter(t1, t2) {
  if (!Array.isArray(t1) || !Array.isArray(t2) || t1.length < 2 || t2.length < 2) return false;
  if (t1[t1.length - 1] !== t2[t2.length - 1]) return false; // last names must be identical
  const f1 = t1[0], f2 = t2[0];
  if (f1 === f2) return true;
  const short = f1.length <= f2.length ? f1 : f2;
  const long = f1.length <= f2.length ? f2 : f1;
  return short.length >= 3 && long.startsWith(short);
}

// Fetch ESPN's current UFC scoreboard -> finished fights as
// [{ a, b, winner, completed, aTok, bTok, winnerTok }] with NORMALIZED names.
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
        const anRaw = nameOf(cptrs[0]), bnRaw = nameOf(cptrs[1]);
        if (!anRaw || !bnRaw) continue;
        let winner = null, winnerTok = null;
        if (completed) {
          const wc = cptrs.find((c) => c.winner === true);
          if (wc) { const wRaw = nameOf(wc); winner = normName(wRaw); winnerTok = nameTokens(wRaw); }
        }
        out.push({
          a: normName(anRaw), b: normName(bnRaw), winner, completed,
          aTok: nameTokens(anRaw), bTok: nameTokens(bnRaw), winnerTok,
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[ESPN MMA] results fetch failed:", e.message);
    return [];
  }
}

// Resolve a winner corner for a Cito bout from ESPN results. Returns { corner, name } or null.
// Conservative: requires BOTH fighters of the bout to match the SAME completed ESPN fight (to
// DISTINCT competitors), and the ESPN winner to match one of them. Matches on fighterName, profile
// name, AND slug (some Cito display names are nicknames -- e.g. "King Green", slug "bobby-green"),
// via an exact GLUED key first, then a conservative abbreviated-first-name token tier.
function espnWinnerCorner(bout, espnResults) {
  if (!bout || !Array.isArray(espnResults) || !espnResults.length) return null;
  const list = Array.isArray(bout.fighters) ? bout.fighters : [];
  const red = list.find((f) => String(f.corner || "").toLowerCase() === "red");
  const blue = list.find((f) => String(f.corner || "").toLowerCase() === "blue");
  if (!red || !blue) return null;

  // GLUED candidate keys (exact tier) per corner.
  const glued = (f) => {
    const s = new Set();
    if (f.fighterName) s.add(normName(f.fighterName));
    if (f.profile && f.profile.name) s.add(normName(f.profile.name));
    if (f.fighterSlug) s.add(normName(String(f.fighterSlug).replace(/-/g, " ")));
    s.delete("");
    return s;
  };
  // TOKEN candidate lists (fuzzy tier) per corner.
  const toks = (f) => {
    const arr = [];
    if (f.fighterName) arr.push(nameTokens(f.fighterName));
    if (f.profile && f.profile.name) arr.push(nameTokens(f.profile.name));
    if (f.fighterSlug) arr.push(nameTokens(String(f.fighterSlug).replace(/-/g, " ")));
    return arr.filter((t) => t.length);
  };

  const rg = glued(red), bg = glued(blue);
  const rt = toks(red), bt = toks(blue);
  if (!rg.size && !rt.length) return null;
  if (!bg.size && !bt.length) return null;

  // Does a corner match a single ESPN competitor (by its glued key + token list)?
  const cornerMatches = (cGlued, cToks, espnGlued, espnTok) => {
    if (cGlued.has(espnGlued)) return true;                       // exact tier
    for (const ct of cToks) if (tokensSameFighter(ct, espnTok)) return true; // fuzzy tier
    return false;
  };

  for (const f of espnResults) {
    if (!f.completed || !f.winner) continue;
    const redA = cornerMatches(rg, rt, f.a, f.aTok), redB = cornerMatches(rg, rt, f.b, f.bTok);
    const blueA = cornerMatches(bg, bt, f.a, f.aTok), blueB = cornerMatches(bg, bt, f.b, f.bTok);
    // Both corners must match this fight, mapped to DISTINCT competitors.
    const distinctMatch = (redA && blueB) || (redB && blueA);
    if (!distinctMatch) continue;
    const winnerIsRed = cornerMatches(rg, rt, f.winner, f.winnerTok);
    const winnerIsBlue = cornerMatches(bg, bt, f.winner, f.winnerTok);
    if (winnerIsRed && !winnerIsBlue) return { corner: "red", name: red.fighterName || (red.profile && red.profile.name) || null };
    if (winnerIsBlue && !winnerIsRed) return { corner: "blue", name: blue.fighterName || (blue.profile && blue.profile.name) || null };
    return null; // fight matched but winner didn't resolve cleanly -> stay pending for Cito
  }
  return null;
}

module.exports = { getEspnUfcResults, espnWinnerCorner, normName, nameTokens, tokensSameFighter };
