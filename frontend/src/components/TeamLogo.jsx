import { useMemo, useState } from "react";

const MLB_BY_NAME = {
  diamondbacks: "ari", braves: "atl", orioles: "bal", "red sox": "bos", cubs: "chc", "white sox": "chw",
  reds: "cin", guardians: "cle", rockies: "col", tigers: "det", astros: "hou", royals: "kc", angels: "laa",
  dodgers: "lad", marlins: "mia", brewers: "mil", twins: "min", mets: "nym", yankees: "nyy", athletics: "oak",
  phillies: "phi", pirates: "pit", padres: "sd", mariners: "sea", giants: "sf", cardinals: "stl", rays: "tb",
  rangers: "tex", "blue jays": "tor", nationals: "wsh",
};

const NFL_BY_NAME = {
  "arizona cardinals": "ari", "atlanta falcons": "atl", "baltimore ravens": "bal", "buffalo bills": "buf",
  "carolina panthers": "car", "chicago bears": "chi", "cincinnati bengals": "cin", "cleveland browns": "cle",
  "dallas cowboys": "dal", "denver broncos": "den", "detroit lions": "det", "green bay packers": "gb",
  "houston texans": "hou", "indianapolis colts": "ind", "jacksonville jaguars": "jax", "kansas city chiefs": "kc",
  "las vegas raiders": "lv", "los angeles chargers": "lac", "los angeles rams": "lar", "miami dolphins": "mia",
  "minnesota vikings": "min", "new england patriots": "ne", "new orleans saints": "no", "new york giants": "nyg",
  "new york jets": "nyj", "philadelphia eagles": "phi", "pittsburgh steelers": "pit", "san francisco 49ers": "sf",
  "seattle seahawks": "sea", "tampa bay buccaneers": "tb", "tennessee titans": "ten", "washington commanders": "wsh",
};

const DISPLAY_BY_ABBR = {
  mlb: {
    ari: "Arizona Diamondbacks", atl: "Atlanta Braves", bal: "Baltimore Orioles", bos: "Boston Red Sox", chc: "Chicago Cubs",
    chw: "Chicago White Sox", cws: "Chicago White Sox", cin: "Cincinnati Reds", cle: "Cleveland Guardians", col: "Colorado Rockies",
    det: "Detroit Tigers", hou: "Houston Astros", kc: "Kansas City Royals", kcr: "Kansas City Royals", laa: "Los Angeles Angels",
    lad: "Los Angeles Dodgers", mia: "Miami Marlins", mil: "Milwaukee Brewers", min: "Minnesota Twins", nym: "New York Mets",
    nyy: "New York Yankees", oak: "Oakland Athletics", ath: "Athletics", phi: "Philadelphia Phillies", pit: "Pittsburgh Pirates",
    sd: "San Diego Padres", sdp: "San Diego Padres", sea: "Seattle Mariners", sf: "San Francisco Giants", sfg: "San Francisco Giants",
    stl: "St. Louis Cardinals", tb: "Tampa Bay Rays", tbr: "Tampa Bay Rays", tex: "Texas Rangers", tor: "Toronto Blue Jays",
    wsh: "Washington Nationals", was: "Washington Nationals",
  },
  nba: {
    atl: "Atlanta Hawks", bos: "Boston Celtics", bkn: "Brooklyn Nets", cha: "Charlotte Hornets", chi: "Chicago Bulls",
    cle: "Cleveland Cavaliers", dal: "Dallas Mavericks", den: "Denver Nuggets", det: "Detroit Pistons", gsw: "Golden State Warriors",
    hou: "Houston Rockets", ind: "Indiana Pacers", lac: "Los Angeles Clippers", lal: "Los Angeles Lakers", mem: "Memphis Grizzlies",
    mia: "Miami Heat", mil: "Milwaukee Bucks", min: "Minnesota Timberwolves", nop: "New Orleans Pelicans", nyk: "New York Knicks",
    okc: "Oklahoma City Thunder", orl: "Orlando Magic", phi: "Philadelphia 76ers", phx: "Phoenix Suns", por: "Portland Trail Blazers",
    sac: "Sacramento Kings", sas: "San Antonio Spurs", tor: "Toronto Raptors", uta: "Utah Jazz", was: "Washington Wizards",
  },
  nhl: {
    ana: "Anaheim Ducks", bos: "Boston Bruins", buf: "Buffalo Sabres", car: "Carolina Hurricanes", cbj: "Columbus Blue Jackets",
    cgy: "Calgary Flames", chi: "Chicago Blackhawks", col: "Colorado Avalanche", dal: "Dallas Stars", det: "Detroit Red Wings",
    edm: "Edmonton Oilers", fla: "Florida Panthers", lak: "Los Angeles Kings", min: "Minnesota Wild", mtl: "Montreal Canadiens",
    njd: "New Jersey Devils", nsh: "Nashville Predators", nyi: "New York Islanders", nyr: "New York Rangers", ott: "Ottawa Senators",
    phi: "Philadelphia Flyers", pit: "Pittsburgh Penguins", sea: "Seattle Kraken", sj: "San Jose Sharks", stl: "St. Louis Blues",
    tbl: "Tampa Bay Lightning", tor: "Toronto Maple Leafs", uta: "Utah Mammoth", van: "Vancouver Canucks", vgk: "Vegas Golden Knights",
    wpg: "Winnipeg Jets", wsh: "Washington Capitals",
  },
};

// ESPN college-football slugs are not uniformly derivable from display names.
// Unknown schools keep the fixed-size fallback instead of showing a wrong crest.
const CFB_BY_NAME = {
  "akron zips": "2006",
  "wake forest demon deacons": "154",
  "uab blazers": "5",
  "illinois fighting illini": "356",
  "umass minutemen": "113",
  "rutgers scarlet knights": "164",
  "colorado buffaloes": "38",
  "georgia tech yellow jackets": "59",
  "arkansas state red wolves": "2032",
  "washington state cougars": "265",
  "coastal carolina chanticleers": "324",
  "northern illinois huskies": "2459",
};

const ESPN_LEAGUE = { cfb: "ncaa", nfl: "nfl", mlb: "mlb", nba: "nba", nhl: "nhl" };
const NORMALIZE_ABBR = { mlb: { az: "ari", cws: "chw", kcr: "kc", sdp: "sd", sfg: "sf", tbr: "tb", was: "wsh" } };

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugFromName(team, sport) {
  const name = normalized(team);
  const table = sport === "cfb" ? CFB_BY_NAME : sport === "nfl" ? NFL_BY_NAME : sport === "mlb" ? MLB_BY_NAME : null;
  if (!table) return null;
  if (table[name]) return table[name];
  for (const [key, slug] of Object.entries(table)) if (name.includes(key)) return slug;
  return null;
}

export function verifiedTeamLogoUrl({ sport, team, abbr }) {
  const league = ESPN_LEAGUE[sport];
  if (!league) return null;
  let slug = slugFromName(team, sport);
  if (!slug && sport !== "cfb") slug = normalized(abbr);
  if (!slug) return null;
  slug = NORMALIZE_ABBR[sport]?.[slug] || slug;
  return `https://a.espncdn.com/i/teamlogos/${league}/500/${slug}.png`;
}

export function displayTeamName({ sport, team, abbr }) {
  const raw = String(team || "").trim();
  if (raw && (raw.includes(" ") || raw.length > 4)) return raw;
  const initial = normalized(abbr || raw);
  const key = NORMALIZE_ABBR[sport]?.[initial] || initial;
  if (sport === "nfl") {
    const found = Object.entries(NFL_BY_NAME).find(([, slug]) => slug === key);
    if (found) return found[0].replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return DISPLAY_BY_ABBR[sport]?.[key] || raw || String(abbr || "Team");
}

function fallbackText(team, abbr) {
  if (abbr) return String(abbr).slice(0, 4).toUpperCase();
  return String(team || "?").split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
}

export default function TeamLogo({ sport, team, abbr, className = "", color = "#55606b" }) {
  const src = useMemo(() => verifiedTeamLogoUrl({ sport, team, abbr }), [sport, team, abbr]);
  const [failedSrc, setFailedSrc] = useState(null);
  const failed = !src || failedSrc === src;
  return <span className={`team-logo${failed ? " team-logo--fallback" : " team-logo--verified"}${className ? ` ${className}` : ""}`} style={{ "--team-logo-color": color }}>
    <span className="team-logo__fallback" aria-hidden="true">{fallbackText(team, abbr)}</span>
    {!failed && <img className="team-logo__image" src={src} alt={`${team || abbr || "Team"} logo`} onError={() => setFailedSrc(src)} />}
  </span>;
}

export const TEAM_LOGO_CSS = `
.team-logo{--team-logo-color:#55606b;position:relative;display:grid;place-items:center;flex:0 0 auto;width:34px;height:34px;overflow:hidden}.team-logo__fallback{grid-area:1/1;color:#fff;font:800 8px/1 "IBM Plex Mono",monospace}.team-logo--fallback{border:1px solid color-mix(in srgb,var(--team-logo-color) 72%,white 8%);border-radius:50%;background:radial-gradient(circle at 35% 28%,color-mix(in srgb,var(--team-logo-color) 65%,white 8%),#0b0c0e 78%);box-shadow:inset 0 0 0 2px #0a0c0d}.team-logo--verified{border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.085),rgba(255,255,255,.035) 72%);padding:2px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}.team-logo__image{grid-area:1/1;z-index:1;display:block;width:100%;height:100%;object-fit:contain;object-position:center;filter:drop-shadow(0 0 1px rgba(255,255,255,.24)) drop-shadow(0 1px 1px rgba(0,0,0,.52))}
`;
