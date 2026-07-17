// backend/services/teamKey.js
// WZ-TEAMKEY-SSOT-2026-07-17 :: canonical team identity for reconciling the SAME game across
// feeds that DON'T share game ids (ESPN scoreboard, MLB StatsAPI, the odds feed). Every place
// that links two feeds by team should key on teamKey()/matchupKey() from HERE instead of rolling
// its own last-word-nickname match — which collides ("Red Sox"/"White Sox" both -> "sox") and
// drifts file to file. This is the shared, collision-safe replacement.
//
// SCOPE: MLB is fully tabled (the live sport). Other leagues fall back to a safe generic key
// (last-word nickname / uppercased abbr) so their behavior is UNCHANGED until we table them.
// Adopt this one caller at a time and verify on a live slate before the next (grading paths last).

const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const lastWord = (s) => clean(s).split(" ").pop() || "";

// Canonical MLB table: canonical abbr -> every representation we might receive from any feed.
//   abbrs: all abbreviation variants across feeds (ESPN / StatsAPI / odds).
//   nicks: full nickname phrase(s), may be two words ("red sox", "blue jays").
//   city : city/market phrase(s).
const MLB = [
  ["ARI", { abbrs: ["ARI", "AZ"],  nicks: ["diamondbacks", "dbacks"], city: ["arizona"] }],
  ["ATL", { abbrs: ["ATL"],        nicks: ["braves"],      city: ["atlanta"] }],
  ["BAL", { abbrs: ["BAL"],        nicks: ["orioles"],     city: ["baltimore"] }],
  ["BOS", { abbrs: ["BOS"],        nicks: ["red sox"],     city: ["boston"] }],
  ["CHC", { abbrs: ["CHC", "CUB"], nicks: ["cubs"],        city: ["chicago cubs"] }],
  ["CWS", { abbrs: ["CWS", "CHW"], nicks: ["white sox"],   city: ["chicago white sox"] }],
  ["CIN", { abbrs: ["CIN"],        nicks: ["reds"],        city: ["cincinnati"] }],
  ["CLE", { abbrs: ["CLE"],        nicks: ["guardians", "indians"], city: ["cleveland"] }],
  ["COL", { abbrs: ["COL"],        nicks: ["rockies"],     city: ["colorado"] }],
  ["DET", { abbrs: ["DET"],        nicks: ["tigers"],      city: ["detroit"] }],
  ["HOU", { abbrs: ["HOU"],        nicks: ["astros"],      city: ["houston"] }],
  ["KC",  { abbrs: ["KC", "KCR"],  nicks: ["royals"],      city: ["kansas city"] }],
  ["LAA", { abbrs: ["LAA", "ANA"], nicks: ["angels"],      city: ["los angeles angels", "anaheim"] }],
  ["LAD", { abbrs: ["LAD"],        nicks: ["dodgers"],     city: ["los angeles dodgers"] }],
  ["MIA", { abbrs: ["MIA", "FLA"], nicks: ["marlins"],     city: ["miami"] }],
  ["MIL", { abbrs: ["MIL"],        nicks: ["brewers"],     city: ["milwaukee"] }],
  ["MIN", { abbrs: ["MIN"],        nicks: ["twins"],       city: ["minnesota"] }],
  ["NYM", { abbrs: ["NYM"],        nicks: ["mets"],        city: ["new york mets"] }],
  ["NYY", { abbrs: ["NYY"],        nicks: ["yankees"],     city: ["new york yankees"] }],
  ["OAK", { abbrs: ["OAK", "ATH"], nicks: ["athletics"],   city: ["oakland"] }],
  ["PHI", { abbrs: ["PHI"],        nicks: ["phillies"],    city: ["philadelphia"] }],
  ["PIT", { abbrs: ["PIT"],        nicks: ["pirates"],     city: ["pittsburgh"] }],
  ["SD",  { abbrs: ["SD", "SDP"],  nicks: ["padres"],      city: ["san diego"] }],
  ["SEA", { abbrs: ["SEA"],        nicks: ["mariners"],    city: ["seattle"] }],
  ["SF",  { abbrs: ["SF", "SFG"],  nicks: ["giants"],      city: ["san francisco"] }],
  ["STL", { abbrs: ["STL"],        nicks: ["cardinals"],   city: ["st louis", "saint louis"] }],
  ["TB",  { abbrs: ["TB", "TBR"],  nicks: ["rays"],        city: ["tampa bay", "tampa"] }],
  ["TEX", { abbrs: ["TEX"],        nicks: ["rangers"],     city: ["texas"] }],
  ["TOR", { abbrs: ["TOR"],        nicks: ["blue jays"],   city: ["toronto"] }],
  ["WSH", { abbrs: ["WSH", "WAS", "WSN"], nicks: ["nationals"], city: ["washington"] }],
];

// Build a representation -> canonical-abbr index. Also index each nickname's LAST word
// (e.g. "jays" for "blue jays") ONLY when that word is unique across the league — so unique
// tails resolve, but ambiguous ones ("sox" -> Red or White) are deliberately left unmatched
// rather than mis-matched.
function buildIndex(table) {
  const idx = new Map();
  const put = (k, v) => { const c = clean(k); if (c) idx.set(c, v); };
  const tailCount = new Map();
  for (const [, rep] of table) {
    for (const n of rep.nicks || []) { const t = lastWord(n); tailCount.set(t, (tailCount.get(t) || 0) + 1); }
  }
  for (const [canon, rep] of table) {
    put(canon, canon);
    for (const a of rep.abbrs || []) put(a, canon);
    for (const n of rep.nicks || []) {
      put(n, canon);
      const t = lastWord(n);
      if ((tailCount.get(t) || 0) === 1) put(t, canon); // unique tail only
    }
    for (const c of rep.city || []) {
      put(c, canon);
      for (const n of rep.nicks || []) put(c + " " + n, canon); // "boston red sox"
    }
  }
  return idx;
}
const LEAGUE_IDX = { mlb: buildIndex(MLB) };

// Resolve any team representation (full name, city+nick, nickname, or abbr) to a stable
// canonical token. MLB is tabled; untabled leagues fall back to last-word nickname (the old
// behavior) so nothing changes for them. Never throws.
function teamKey(input, league = "mlb") {
  const idx = LEAGUE_IDX[String(league || "").toLowerCase()];
  const s = clean(input);
  if (!s) return "";
  if (idx) {
    if (idx.has(s)) return idx.get(s);                       // whole string
    const w = s.split(" ");
    if (w.length >= 2) { const two = w.slice(-2).join(" "); if (idx.has(two)) return idx.get(two); } // trailing 2 words
    const one = w[w.length - 1];
    if (idx.has(one)) return idx.get(one);                   // last word (if known/unique)
    if (w.length === 1) return one.toUpperCase();            // an abbr we don't know -> stable as-is
  }
  return lastWord(s); // generic fallback for untabled leagues
}

// Canonical abbreviation (resolves cross-feed splits like CHW->CWS, AZ->ARI, ATH->OAK).
function canonAbbr(input, league = "mlb") {
  const k = teamKey(input, league);
  return k ? k.toUpperCase() : "";
}

// Raw last-word nickname (kept for callers that specifically want it).
const nick = (s) => lastWord(s);

// "AWAY|HOME" canonical key. Pass startTime to append an hour bucket so DOUBLEHEADERS
// (same matchup twice in one day) get distinct keys instead of colliding.
function matchupKey(away, home, startTime, league = "mlb") {
  const base = `${teamKey(away, league)}|${teamKey(home, league)}`;
  if (!startTime) return base;
  const t = Date.parse(startTime);
  return isNaN(t) ? base : `${base}|${new Date(t).toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

module.exports = { teamKey, canonAbbr, nick, matchupKey };
