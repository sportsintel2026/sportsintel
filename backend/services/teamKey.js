// backend/services/teamKey.js
// WZ-TEAMKEY-SSOT-2026-07-17 :: canonical team identity for reconciling the SAME game across
// feeds that DON'T share game ids (ESPN scoreboard, MLB StatsAPI, the odds feed, rating sources).
// Every place that links two feeds by team should key on teamKey()/matchupKey() from HERE instead
// of rolling its own last-word-nickname match — which collides ("Red Sox"/"White Sox" both -> "sox")
// and drifts file to file. Shared, collision-safe replacement.
//
// WZ-TEAMKEY-LEAGUES-2026-07-17 :: MLB / NFL / NBA / NHL are TABLED (fixed rosters) -> canonical
// token is the team abbreviation. CFB is 130+ schools with real ambiguity (Miami FL vs Miami OH),
// so it does NOT get a hand-typed table; instead it mirrors the live-verified resolver already in
// cfbEdges.js (diacritic-fold + schoolKey(strip mascot) + a tiny verified alias map) -> canonical
// token is the SCHOOL key. Any untabled league falls back to last-word nickname (unchanged behavior).
// Adopt this one caller at a time and verify on a live slate before the next (grading paths last).

const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const lastWord = (s) => clean(s).split(" ").pop() || "";

// ── Tabled leagues: canonical abbr -> every representation we might receive from any feed ──
//    abbrs: all abbreviation variants across feeds. nicks: full nickname phrase(s). city: market phrase(s).
//    For teams sharing a market (NY/LA), the city entry is the FULL "city nickname" (never bare) so it
//    can't collide; the buildIndex collision-guard also auto-drops any key that maps to two teams.
const TABLES = {
  mlb: [
    ["ARI",{abbrs:["ARI","AZ"],nicks:["diamondbacks","dbacks"],city:["arizona"]}],
    ["ATL",{abbrs:["ATL"],nicks:["braves"],city:["atlanta"]}],
    ["BAL",{abbrs:["BAL"],nicks:["orioles"],city:["baltimore"]}],
    ["BOS",{abbrs:["BOS"],nicks:["red sox"],city:["boston"]}],
    ["CHC",{abbrs:["CHC","CUB"],nicks:["cubs"],city:["chicago cubs"]}],
    ["CWS",{abbrs:["CWS","CHW"],nicks:["white sox"],city:["chicago white sox"]}],
    ["CIN",{abbrs:["CIN"],nicks:["reds"],city:["cincinnati"]}],
    ["CLE",{abbrs:["CLE"],nicks:["guardians","indians"],city:["cleveland"]}],
    ["COL",{abbrs:["COL"],nicks:["rockies"],city:["colorado"]}],
    ["DET",{abbrs:["DET"],nicks:["tigers"],city:["detroit"]}],
    ["HOU",{abbrs:["HOU"],nicks:["astros"],city:["houston"]}],
    ["KC",{abbrs:["KC","KCR"],nicks:["royals"],city:["kansas city"]}],
    ["LAA",{abbrs:["LAA","ANA"],nicks:["angels"],city:["los angeles angels","anaheim"]}],
    ["LAD",{abbrs:["LAD"],nicks:["dodgers"],city:["los angeles dodgers"]}],
    ["MIA",{abbrs:["MIA","FLA"],nicks:["marlins"],city:["miami"]}],
    ["MIL",{abbrs:["MIL"],nicks:["brewers"],city:["milwaukee"]}],
    ["MIN",{abbrs:["MIN"],nicks:["twins"],city:["minnesota"]}],
    ["NYM",{abbrs:["NYM"],nicks:["mets"],city:["new york mets"]}],
    ["NYY",{abbrs:["NYY"],nicks:["yankees"],city:["new york yankees"]}],
    ["OAK",{abbrs:["OAK","ATH"],nicks:["athletics"],city:["oakland"]}],
    ["PHI",{abbrs:["PHI"],nicks:["phillies"],city:["philadelphia"]}],
    ["PIT",{abbrs:["PIT"],nicks:["pirates"],city:["pittsburgh"]}],
    ["SD",{abbrs:["SD","SDP"],nicks:["padres"],city:["san diego"]}],
    ["SEA",{abbrs:["SEA"],nicks:["mariners"],city:["seattle"]}],
    ["SF",{abbrs:["SF","SFG"],nicks:["giants"],city:["san francisco"]}],
    ["STL",{abbrs:["STL"],nicks:["cardinals"],city:["st louis","saint louis"]}],
    ["TB",{abbrs:["TB","TBR"],nicks:["rays"],city:["tampa bay","tampa"]}],
    ["TEX",{abbrs:["TEX"],nicks:["rangers"],city:["texas"]}],
    ["TOR",{abbrs:["TOR"],nicks:["blue jays"],city:["toronto"]}],
    ["WSH",{abbrs:["WSH","WAS","WSN"],nicks:["nationals"],city:["washington"]}],
  ],
  nfl: [
    ["ARI",{abbrs:["ARI"],nicks:["cardinals"],city:["arizona"]}],
    ["ATL",{abbrs:["ATL"],nicks:["falcons"],city:["atlanta"]}],
    ["BAL",{abbrs:["BAL"],nicks:["ravens"],city:["baltimore"]}],
    ["BUF",{abbrs:["BUF"],nicks:["bills"],city:["buffalo"]}],
    ["CAR",{abbrs:["CAR"],nicks:["panthers"],city:["carolina"]}],
    ["CHI",{abbrs:["CHI"],nicks:["bears"],city:["chicago"]}],
    ["CIN",{abbrs:["CIN"],nicks:["bengals"],city:["cincinnati"]}],
    ["CLE",{abbrs:["CLE"],nicks:["browns"],city:["cleveland"]}],
    ["DAL",{abbrs:["DAL"],nicks:["cowboys"],city:["dallas"]}],
    ["DEN",{abbrs:["DEN"],nicks:["broncos"],city:["denver"]}],
    ["DET",{abbrs:["DET"],nicks:["lions"],city:["detroit"]}],
    ["GB",{abbrs:["GB","GNB"],nicks:["packers"],city:["green bay"]}],
    ["HOU",{abbrs:["HOU"],nicks:["texans"],city:["houston"]}],
    ["IND",{abbrs:["IND"],nicks:["colts"],city:["indianapolis"]}],
    ["JAX",{abbrs:["JAX","JAC"],nicks:["jaguars"],city:["jacksonville"]}],
    ["KC",{abbrs:["KC","KAN"],nicks:["chiefs"],city:["kansas city"]}],
    ["LV",{abbrs:["LV","LVR"],nicks:["raiders"],city:["las vegas"]}],
    ["LAC",{abbrs:["LAC"],nicks:["chargers"],city:["los angeles chargers"]}],
    ["LAR",{abbrs:["LAR"],nicks:["rams"],city:["los angeles rams"]}],
    ["MIA",{abbrs:["MIA"],nicks:["dolphins"],city:["miami"]}],
    ["MIN",{abbrs:["MIN"],nicks:["vikings"],city:["minnesota"]}],
    ["NE",{abbrs:["NE","NWE"],nicks:["patriots"],city:["new england"]}],
    ["NO",{abbrs:["NO","NOR"],nicks:["saints"],city:["new orleans"]}],
    ["NYG",{abbrs:["NYG"],nicks:["giants"],city:["new york giants"]}],
    ["NYJ",{abbrs:["NYJ"],nicks:["jets"],city:["new york jets"]}],
    ["PHI",{abbrs:["PHI"],nicks:["eagles"],city:["philadelphia"]}],
    ["PIT",{abbrs:["PIT"],nicks:["steelers"],city:["pittsburgh"]}],
    ["SF",{abbrs:["SF","SFO"],nicks:["49ers"],city:["san francisco"]}],
    ["SEA",{abbrs:["SEA"],nicks:["seahawks"],city:["seattle"]}],
    ["TB",{abbrs:["TB","TAM"],nicks:["buccaneers","bucs"],city:["tampa bay"]}],
    ["TEN",{abbrs:["TEN"],nicks:["titans"],city:["tennessee"]}],
    ["WSH",{abbrs:["WSH","WAS"],nicks:["commanders"],city:["washington"]}],
  ],
  nba: [
    ["ATL",{abbrs:["ATL"],nicks:["hawks"],city:["atlanta"]}],
    ["BOS",{abbrs:["BOS"],nicks:["celtics"],city:["boston"]}],
    ["BKN",{abbrs:["BKN","BRK"],nicks:["nets"],city:["brooklyn"]}],
    ["CHA",{abbrs:["CHA","CHO"],nicks:["hornets"],city:["charlotte"]}],
    ["CHI",{abbrs:["CHI"],nicks:["bulls"],city:["chicago"]}],
    ["CLE",{abbrs:["CLE"],nicks:["cavaliers","cavs"],city:["cleveland"]}],
    ["DAL",{abbrs:["DAL"],nicks:["mavericks","mavs"],city:["dallas"]}],
    ["DEN",{abbrs:["DEN"],nicks:["nuggets"],city:["denver"]}],
    ["DET",{abbrs:["DET"],nicks:["pistons"],city:["detroit"]}],
    ["GSW",{abbrs:["GSW","GS"],nicks:["warriors"],city:["golden state"]}],
    ["HOU",{abbrs:["HOU"],nicks:["rockets"],city:["houston"]}],
    ["IND",{abbrs:["IND"],nicks:["pacers"],city:["indiana"]}],
    ["LAC",{abbrs:["LAC"],nicks:["clippers"],city:["los angeles clippers"]}],
    ["LAL",{abbrs:["LAL"],nicks:["lakers"],city:["los angeles lakers"]}],
    ["MEM",{abbrs:["MEM"],nicks:["grizzlies"],city:["memphis"]}],
    ["MIA",{abbrs:["MIA"],nicks:["heat"],city:["miami"]}],
    ["MIL",{abbrs:["MIL"],nicks:["bucks"],city:["milwaukee"]}],
    ["MIN",{abbrs:["MIN"],nicks:["timberwolves","wolves"],city:["minnesota"]}],
    ["NOP",{abbrs:["NOP","NO","NOR"],nicks:["pelicans"],city:["new orleans"]}],
    ["NYK",{abbrs:["NYK","NY"],nicks:["knicks"],city:["new york knicks"]}],
    ["OKC",{abbrs:["OKC"],nicks:["thunder"],city:["oklahoma city"]}],
    ["ORL",{abbrs:["ORL"],nicks:["magic"],city:["orlando"]}],
    ["PHI",{abbrs:["PHI"],nicks:["76ers","sixers"],city:["philadelphia"]}],
    ["PHX",{abbrs:["PHX","PHO"],nicks:["suns"],city:["phoenix"]}],
    ["POR",{abbrs:["POR"],nicks:["trail blazers","blazers"],city:["portland"]}],
    ["SAC",{abbrs:["SAC"],nicks:["kings"],city:["sacramento"]}],
    ["SAS",{abbrs:["SAS","SA"],nicks:["spurs"],city:["san antonio"]}],
    ["TOR",{abbrs:["TOR"],nicks:["raptors"],city:["toronto"]}],
    ["UTA",{abbrs:["UTA","UTAH"],nicks:["jazz"],city:["utah"]}],
    ["WAS",{abbrs:["WAS","WSH"],nicks:["wizards"],city:["washington"]}],
  ],
  nhl: [
    ["ANA",{abbrs:["ANA"],nicks:["ducks"],city:["anaheim"]}],
    ["BOS",{abbrs:["BOS"],nicks:["bruins"],city:["boston"]}],
    ["BUF",{abbrs:["BUF"],nicks:["sabres"],city:["buffalo"]}],
    ["CGY",{abbrs:["CGY","CAL"],nicks:["flames"],city:["calgary"]}],
    ["CAR",{abbrs:["CAR"],nicks:["hurricanes","canes"],city:["carolina"]}],
    ["CHI",{abbrs:["CHI"],nicks:["blackhawks"],city:["chicago"]}],
    ["COL",{abbrs:["COL"],nicks:["avalanche","avs"],city:["colorado"]}],
    ["CBJ",{abbrs:["CBJ"],nicks:["blue jackets"],city:["columbus"]}],
    ["DAL",{abbrs:["DAL"],nicks:["stars"],city:["dallas"]}],
    ["DET",{abbrs:["DET"],nicks:["red wings"],city:["detroit"]}],
    ["EDM",{abbrs:["EDM"],nicks:["oilers"],city:["edmonton"]}],
    ["FLA",{abbrs:["FLA"],nicks:["panthers"],city:["florida"]}],
    ["LAK",{abbrs:["LAK"],nicks:["kings"],city:["los angeles kings"]}],
    ["MIN",{abbrs:["MIN"],nicks:["wild"],city:["minnesota"]}],
    ["MTL",{abbrs:["MTL","MON"],nicks:["canadiens","habs"],city:["montreal"]}],
    ["NSH",{abbrs:["NSH","NAS"],nicks:["predators","preds"],city:["nashville"]}],
    ["NJD",{abbrs:["NJD","NJ"],nicks:["devils"],city:["new jersey"]}],
    ["NYI",{abbrs:["NYI"],nicks:["islanders"],city:["new york islanders"]}],
    ["NYR",{abbrs:["NYR"],nicks:["rangers"],city:["new york rangers"]}],
    ["OTT",{abbrs:["OTT"],nicks:["senators","sens"],city:["ottawa"]}],
    ["PHI",{abbrs:["PHI"],nicks:["flyers"],city:["philadelphia"]}],
    ["PIT",{abbrs:["PIT"],nicks:["penguins","pens"],city:["pittsburgh"]}],
    ["SJS",{abbrs:["SJS","SJ"],nicks:["sharks"],city:["san jose"]}],
    ["SEA",{abbrs:["SEA"],nicks:["kraken"],city:["seattle"]}],
    ["STL",{abbrs:["STL"],nicks:["blues"],city:["st louis"]}],
    ["TBL",{abbrs:["TBL","TB"],nicks:["lightning"],city:["tampa bay"]}],
    ["TOR",{abbrs:["TOR"],nicks:["maple leafs","leafs"],city:["toronto"]}],
    ["VAN",{abbrs:["VAN"],nicks:["canucks"],city:["vancouver"]}],
    ["VGK",{abbrs:["VGK","VEG"],nicks:["golden knights"],city:["vegas","las vegas"]}],
    ["WSH",{abbrs:["WSH","WAS"],nicks:["capitals","caps"],city:["washington"]}],
    ["WPG",{abbrs:["WPG","WIN"],nicks:["jets"],city:["winnipeg"]}],
    ["UTA",{abbrs:["UTA"],nicks:["mammoth","hockey club"],city:["utah"]}],
  ],
};

// Build a representation -> canonical index with a COLLISION GUARD: any key that would map to
// two different teams is dropped (so ambiguous tokens like "sox" or a shared bare city resolve
// to nothing rather than the wrong team). Indexes: canonical, abbr variants, full nicknames,
// nickname tails, cities, and "city nickname" combos.
function buildIndex(table) {
  const idx = new Map();
  const dead = new Set();
  const put = (raw, canon) => {
    const k = clean(raw);
    if (!k || dead.has(k)) return;
    if (idx.has(k)) { if (idx.get(k) !== canon) { idx.delete(k); dead.add(k); } }
    else idx.set(k, canon);
  };
  for (const [canon, rep] of table) {
    put(canon, canon);
    for (const a of rep.abbrs || []) put(a, canon);
    for (const n of rep.nicks || []) { put(n, canon); put(lastWord(n), canon); }
    for (const c of rep.city || []) { put(c, canon); for (const n of rep.nicks || []) put(c + " " + n, canon); }
  }
  return idx;
}
const LEAGUE_IDX = {};
for (const lg of Object.keys(TABLES)) LEAGUE_IDX[lg] = buildIndex(TABLES[lg]);

// ── CFB: mirror the live-verified resolver in cfbEdges.js (school-key, not a hand table) ──
// normName folds diacritics + deletes apostrophes + &->and; schoolKey drops the mascot; a tiny
// verified alias map fixes genuine odds<->ESPN mismatches. Canonical CFB token = the school key.
function cfbNorm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019\u2018`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function schoolKey(normalized) {
  const parts = normalized.split(" ");
  return parts.length > 1 ? parts.slice(0, -1).join(" ") : normalized;
}
// odds-name -> espn-name aliases (both normalized). Carried verbatim from cfbEdges.js (verified
// against the live /cfbratings dump 2026-06-22, not guessed). Extend only from real live misses.
const CFB_ALIASES = {
  "umass minutemen": "massachusetts minutemen",
  "sam houston state bearkats": "sam houston bearkats",
};
// CFB canonical token = the alias-resolved FULL normalized name (UNAMBIGUOUS: "miami hurricanes"
// != "miami redhawks"). This is safe to match on directly. cfbSchoolKey() below is the separate
// FUZZY fallback (school minus mascot) that CFB consumers opt into AFTER an exact-name miss — it is
// intentionally ambiguous for shared-campus schools (both Miamis -> "miami"), so callers must apply
// their own collision handling exactly as cfbEdges.js does (bySchool collision -> null).
function cfbKey(input) {
  const n = cfbNorm(input);
  if (!n) return "";
  return CFB_ALIASES[n] || n;
}
// Fuzzy CFB fallback: school portion (mascot dropped). Ambiguous for Miami FL/OH by design.
function cfbSchoolKey(input) {
  const n = cfbNorm(input);
  if (!n) return "";
  return schoolKey(CFB_ALIASES[n] || n);
}

// ── public API ──

// Resolve any team representation to a stable canonical token for its league.
//   tabled leagues (mlb/nfl/nba/nhl) -> team abbreviation ("BOS")
//   cfb -> alias-resolved full normalized name ("miami hurricanes") — unambiguous
//   anything else -> last-word nickname (unchanged legacy behavior)
// Never throws.
function teamKey(input, league = "mlb") {
  const lg = String(league || "").toLowerCase();
  if (lg === "cfb" || lg === "ncaafb") return cfbKey(input);
  const idx = LEAGUE_IDX[lg];
  const s = clean(input);
  if (!s) return "";
  if (idx) {
    if (idx.has(s)) return idx.get(s);
    const w = s.split(" ");
    if (w.length >= 2) { const two = w.slice(-2).join(" "); if (idx.has(two)) return idx.get(two); }
    const one = w[w.length - 1];
    if (idx.has(one)) return idx.get(one);
    if (w.length === 1) return one.toUpperCase();
  }
  return lastWord(s);
}

// Canonical abbreviation for tabled leagues (resolves cross-feed splits: CHW->CWS, AZ->ARI,
// JAX/JAC, GS/GSW, TB/TBL, etc.). For CFB this returns the uppercased school key (usable as a
// key, though not a true abbr) — CFB callers should prefer teamKey().
function canonAbbr(input, league = "mlb") {
  const k = teamKey(input, league);
  return k ? k.toUpperCase() : "";
}

// Raw last-word nickname (kept for callers that specifically want it).
const nick = (s) => lastWord(s);

// "AWAY|HOME" canonical key. Pass startTime to append an hour bucket so doubleheaders / split
// same-matchup games get distinct keys instead of colliding.
function matchupKey(away, home, startTime, league = "mlb") {
  const base = `${teamKey(away, league)}|${teamKey(home, league)}`;
  if (!startTime) return base;
  const t = Date.parse(startTime);
  return isNaN(t) ? base : `${base}|${new Date(t).toISOString().slice(0, 13)}`;
}

module.exports = { teamKey, canonAbbr, nick, matchupKey, cfbSchoolKey, cfbNorm, schoolKey, CFB_ALIASES };
