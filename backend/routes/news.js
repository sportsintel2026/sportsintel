// WZ-NEWS-FEED-2026-06-26 :: blended news feed (ESPN JSON + RotoWire RSS), per-league.
// Read-only. No DB. ESPN gives headlines/recaps/video + images + game tagging;
// RotoWire gives the player/injury wire. MLB wire items get a best-effort headshot
// via the free MLB Stats API name map. Team abbreviations for game chips come from
// ESPN's own teams endpoint (cached) so they're always correct (no last-word guessing).
// All external calls fail-safe: any miss degrades gracefully, never 500s the whole feed.
// Endpoint: GET /api/news/:league   league in {mlb,nfl,cfb}
const express = require("express");
const router = express.Router();
const axios = require("axios");

const LEAGUES = {
  mlb: { espn: "baseball/mlb",              roto: "MLB", headshots: true  },
  nfl: { espn: "football/nfl",              roto: "NFL", headshots: false },
  cfb: { espn: "football/college-football", roto: "CFB", headshots: false },
  nba: { espn: "basketball/nba",            roto: "NBA", headshots: false },
  nhl: { espn: "hockey/nhl",                roto: "NHL", headshots: false },
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — fast-moving, but protect the feeds
const cache = {};
const inflight = {};

// ── helpers ────────────────────────────────────────────────────────────────
function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}
function cleanUrl(u = "") { return u.replace(/([^:])\/{2,}/g, "$1/").trim(); }
function timeAgo(d) {
  const t = new Date(d).getTime();
  if (!t) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
function norm(name = "") {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── team abbreviations from ESPN teams endpoint (cached 24h, per league) ───────
const abbrMaps = {};     // league -> { map:Map, at:number }
const ABBR_TTL = 24 * 60 * 60 * 1000;
async function getAbbrMap(league) {
  const cur = abbrMaps[league];
  if (cur && (Date.now() - cur.at) < ABBR_TTL) return cur.map;
  const map = new Map();
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${LEAGUES[league].espn}/teams?limit=1000`;
    const { data } = await axios.get(url, { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0" } });
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    for (const t of teams) {
      const tm = t.team || {};
      const ab = tm.abbreviation || tm.shortDisplayName || "";
      if (!ab) continue;
      for (const key of [tm.displayName, tm.name, tm.shortDisplayName, tm.location]) {
        if (key) map.set(norm(key), ab);
      }
    }
    abbrMaps[league] = { map, at: Date.now() };
  } catch (e) {
    console.error(`[News] abbr map ${league} failed:`, e.message);
    if (!abbrMaps[league]) abbrMaps[league] = { map, at: Date.now() };
  }
  return map;
}
function shortFallback(team = "") {
  const t = team.trim();
  if (!t) return "";
  const w = t.split(/\s+/);
  return (w.length > 1 ? w.map((x) => x[0]).join("") : t.slice(0, 4)).toUpperCase().slice(0, 4);
}
// edge cases ESPN abbreviates oddly (e.g. the relocated Athletics, whose event
// strings have appeared as bare "Athletics"). Substring catch = bulletproof.
const ABBR_OVERRIDE = { "athletics": "ATH", "oakland athletics": "ATH" };
function resolveAbbr(name, abbrMap) {
  const k = norm(name);
  if (ABBR_OVERRIDE[k]) return ABBR_OVERRIDE[k];
  if (k.includes("athletics")) return "ATH";
  return abbrMap.get(k) || shortFallback(name);
}
function gameChip(eventDesc, abbrMap) {
  if (!eventDesc) return null;
  const m = eventDesc.match(/^(.+?)\s+@\s+(.+)$/);
  if (!m) return null;
  return `${resolveAbbr(m[1], abbrMap)} @ ${resolveAbbr(m[2], abbrMap)}`;
}

// ── ESPN: headlines / recaps / video, with images + (raw) game desc ────────────
async function fetchEspn(league) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${LEAGUES[league].espn}/news?limit=30`;
  const { data } = await axios.get(url, { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0" } });
  const arts = Array.isArray(data?.articles) ? data.articles : [];
  return arts.map((a) => {
    const tRaw = (a.type || "").toLowerCase();
    let type = "headline";
    if (tRaw === "media") type = "video";
    else if (tRaw === "recap") type = "recap";
    const imgs = Array.isArray(a.images) ? a.images : [];
    const real = imgs.find((i) => i.url && i.type !== "stitcher" && (i.width || 0) >= 300);
    const image = (real || imgs.find((i) => i.url) || {}).url || null;
    const ev = (a.categories || []).find((c) => c.type === "event" && c.description);
    return {
      id: `espn-${a.id}`,
      source: "espn",
      type,
      headline: decodeEntities(a.headline || ""),
      summary: decodeEntities(a.description || ""),
      image,
      link: cleanUrl(a?.links?.web?.href || a?.links?.mobile?.href || ""),
      published: a.published || a.lastModified || null,
      _gameDesc: ev ? ev.description : null,
      game: null,
      playerName: null, headshot: null, status: null,
    };
  }).filter((x) => x.headline && x.link);
}

// ── RotoWire: player / injury wire (RSS 2.0) ───────────────────────────────────
function stripRotoBoiler(s = "") {
  return s.replace(/\s*Visit RotoWire\.com.*$/is, "").replace(/\s+/g, " ").trim();
}
async function fetchRoto(league) {
  const url = `https://www.rotowire.com/rss/news.php?sport=${LEAGUES[league].roto}`;
  const { data } = await axios.get(url, { timeout: 9000, responseType: "text",
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml,application/xml,text/xml" } });
  const xml = typeof data === "string" ? data : String(data);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 30) {
    const blk = m[1];
    const pick = (tag) => {
      const r = blk.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return r ? decodeEntities(r[1]) : "";
    };
    const title = pick("title");
    if (!title) continue;
    const desc = stripRotoBoiler(pick("description"));
    const link = cleanUrl(pick("link"));
    const pub = pick("pubDate");
    const blob = `${title} ${desc}`.toLowerCase();
    let status = "note";
    if (/injur|\bil\b|day-to-day|strain|sprain|contusion|fractur|surgery|concussion|placed on|out (for|indefinitely)|sidelined|rehab|hamstring|oblique|elbow|shoulder|knee/.test(blob)) status = "injury";
    else if (/lineup|returns?|activated|reinstated|recalled|back (in|from)/.test(blob)) status = "lineup";
    const slug = (link.split("/").filter(Boolean).pop() || title).slice(0, 64);
    items.push({
      id: `roto-${slug}`,
      source: "rotowire",
      type: "wire",
      headline: title,
      summary: desc,
      image: null,
      link,
      published: pub ? new Date(pub).toISOString() : null,
      game: null,
      playerName: extractPlayer(title),
      headshot: null,
      status,
    });
  }
  return items;
}
function extractPlayer(title = "") {
  const t = title.split(/[:\u2013\u2014\-]/)[0].trim();
  const words = t.split(/\s+/).slice(0, 3);
  const keep = [];
  for (const w of words) {
    if (/^[A-Z][A-Za-z.'\u00C0-\u017F]+$/.test(w)) keep.push(w);
    else break;
  }
  return keep.length >= 2 ? keep.join(" ") : (keep[0] || "");
}

// ── MLB headshots: name -> MLBAM id via free Stats API (cached 24h) ─────────────
let mlbMap = null, mlbMapAt = 0;
const MLB_MAP_TTL = 24 * 60 * 60 * 1000;
async function getMlbNameMap() {
  if (mlbMap && (Date.now() - mlbMapAt) < MLB_MAP_TTL) return mlbMap;
  try {
    const yr = new Date().getFullYear();
    const { data } = await axios.get(`https://statsapi.mlb.com/api/v1/sports/1/players`,
      { params: { season: yr }, timeout: 9000 });
    const map = new Map();
    for (const p of data?.people || []) if (p.fullName && p.id) map.set(norm(p.fullName), p.id);
    mlbMap = map; mlbMapAt = Date.now();
  } catch (e) {
    console.error("[News] MLB name map failed:", e.message);
    if (!mlbMap) mlbMap = new Map();
  }
  return mlbMap;
}
async function resolveHeadshots(items) {
  const map = await getMlbNameMap();
  for (const it of items) {
    if (it.source !== "rotowire" || !it.playerName) continue;
    const id = map.get(norm(it.playerName));
    if (id) it.headshot = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_240,q_auto:best/v1/people/${id}/headshot/67/current`;
  }
}

function headshotUrl(id) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_240,q_auto:best/v1/people/${id}/headshot/67/current`;
}

// ── league-wide injury report (MLB) — 40-man roster status, enriched w/ RotoWire ──
let mlbTeams = null, mlbTeamsAt = 0;
async function getMlbTeams() {
  if (mlbTeams && (Date.now() - mlbTeamsAt) < 24 * 60 * 60 * 1000) return mlbTeams;
  try {
    const yr = new Date().getFullYear();
    const { data } = await axios.get("https://statsapi.mlb.com/api/v1/teams",
      { params: { sportId: 1, season: yr }, timeout: 9000 });
    mlbTeams = (data?.teams || []).filter((t) => t.active !== false)
      .map((t) => ({ id: t.id, name: t.name, abbr: t.abbreviation }));
    mlbTeamsAt = Date.now();
  } catch (e) { console.error("[News] MLB teams failed:", e.message); if (!mlbTeams) mlbTeams = []; }
  return mlbTeams;
}
function ilBadge(desc = "", code = "") {
  const m = (desc || "").match(/(\d+)\s*-?\s*day/i);
  if (m) return `${m[1]}-Day IL`;
  if (/60/.test(code)) return "60-Day IL";
  if (/restricted/i.test(desc)) return "Restricted";
  return "IL";
}
const injCache = {};
const INJ_TTL = 20 * 60 * 1000;
async function buildMlbInjuries() {
  const teams = await getMlbTeams();
  const rosters = await Promise.allSettled(teams.map((t) =>
    axios.get(`https://statsapi.mlb.com/api/v1/teams/${t.id}/roster`,
      { params: { rosterType: "40Man" }, timeout: 9000 })
      .then((r) => ({ team: t, roster: r.data?.roster || [] }))));
  // RotoWire notes for the "what happened / when's he back" detail
  const notes = new Map();
  try {
    const r = await fetchRoto("mlb");
    for (const it of r) if (it.playerName) notes.set(norm(it.playerName), it);
  } catch (_) {}
  const out = [];
  for (const res of rosters) {
    if (res.status !== "fulfilled") continue;
    const { team, roster } = res.value;
    for (const p of roster) {
      const code = p.status?.code || "";
      const desc = p.status?.description || "";
      const isIL = /^d/i.test(code) || /injured|\bil\b|disabled list/i.test(desc);
      if (!isIL) continue;
      const name = p.person?.fullName || "";
      const pid = p.person?.id;
      const note = notes.get(norm(name));
      out.push({
        id: `inj-${pid || name}`,
        source: "mlb",
        type: "injury",
        playerName: name,
        team: team.name,
        teamAbbr: team.abbr,
        position: p.position?.abbreviation || "",
        status: ilBadge(desc, code),
        note: note ? note.summary : null,
        noteHeadline: note ? note.headline : null,
        published: note ? note.published : null,
        headshot: pid ? headshotUrl(pid) : null,
        link: note ? note.link : null,
      });
    }
  }
  out.sort((a, b) => a.team.localeCompare(b.team) || a.playerName.localeCompare(b.playerName));
  return out;
}

// ── league-wide injury report (NFL) — ESPN site roster, injuries resolved inline ──
let nflTeams = null, nflTeamsAt = 0;
async function getNflTeams() {
  if (nflTeams && (Date.now() - nflTeamsAt) < 24 * 60 * 60 * 1000) return nflTeams;
  try {
    const { data } = await axios.get(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=1000",
      { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0" } });
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    nflTeams = teams.map((t) => t.team || {}).filter((t) => t.id)
      .map((t) => ({ id: t.id, name: t.displayName || t.name, abbr: t.abbreviation || "" }));
    nflTeamsAt = Date.now();
  } catch (e) { console.error("[News] NFL teams failed:", e.message); if (!nflTeams) nflTeams = []; }
  return nflTeams;
}
// NFL uses named statuses (not IL-day counts) -> severity class + short label
function nflSev(status = "") {
  const s = status.toLowerCase();
  if (/reserve|\bir\b/.test(s)) return { sev: "ir", label: "IR" };
  if (/pup|physically unable/.test(s)) return { sev: "ir", label: "PUP" };
  if (/\bout\b/.test(s)) return { sev: "out", label: "Out" };
  if (/doubtful/.test(s)) return { sev: "doubtful", label: "Doubtful" };
  if (/questionable/.test(s)) return { sev: "questionable", label: "Questionable" };
  if (/day.?to.?day/.test(s)) return { sev: "dtd", label: "Day-To-Day" };
  return { sev: "questionable", label: status || "Injured" };
}
async function buildNflInjuries() {
  const teams = await getNflTeams();
  const rosters = await Promise.allSettled(teams.map((t) =>
    axios.get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t.id}?enable=roster`,
      { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0" } })
      .then((r) => ({ team: t, athletes: r.data?.team?.athletes || [] }))));
  const out = [];
  for (const res of rosters) {
    if (res.status !== "fulfilled") continue;
    const { team, athletes } = res.value;
    for (const a of athletes) {
      const inj = Array.isArray(a.injuries) ? a.injuries[0] : null;
      if (!inj) continue;
      const raw = inj.status || inj.type?.description || "";
      if (!raw || /^active$/i.test(raw) || /suspension/i.test(raw)) continue;
      const { sev, label } = nflSev(raw);
      const d = inj.details || {};
      const bodyPart = [d.type, d.detail].filter(Boolean).join(" · ") || null;
      // ESPN sometimes returns the bare status word as the comment — useless, drop it
      let note = inj.shortComment || inj.longComment || null;
      if (note && /^(questionable|out|doubtful|injured reserve|ir|day.?to.?day|active|probable)$/i.test(note.trim())) note = null;
      // ESPN uses ~Feb 15 of the following year as an "out for the season" placeholder
      let returnDate = d.returnDate || null;
      if (returnDate && returnDate >= `${new Date().getFullYear() + 1}-01-01`) returnDate = null;
      out.push({
        id: `nflinj-${a.id}`,
        source: "nfl",
        type: "injury",
        playerName: a.fullName || a.displayName || "",
        team: team.name,
        teamAbbr: team.abbr,
        position: a.position?.abbreviation || "",
        status: label,
        sev,
        bodyPart,
        returnDate,
        note,
        headshot: a.headshot?.href || null,
        link: (a.links || []).find((l) => (l.rel || []).includes("news"))?.href
          || (a.links || []).find((l) => (l.rel || []).includes("playercard"))?.href || null,
      });
    }
  }
  out.sort((a, b) => a.team.localeCompare(b.team) || a.playerName.localeCompare(b.playerName));
  return out;
}

// ── build + cache ──────────────────────────────────────────────────────────────
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    // collapse same-story ESPN duplicates by a normalized headline prefix; wire items always kept
    if (it.source === "espn") {
      const key = norm(it.headline).split(" ").slice(0, 5).join(" ");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
    }
    out.push(it);
  }
  return out;
}
async function buildFeed(league) {
  const [espnR, rotoR, abbrMap] = await Promise.all([
    Promise.allSettled([fetchEspn(league)]).then((r) => r[0]),
    Promise.allSettled([fetchRoto(league)]).then((r) => r[0]),
    getAbbrMap(league),
  ]);
  let items = [];
  if (espnR.status === "fulfilled") {
    for (const it of espnR.value) { it.game = gameChip(it._gameDesc, abbrMap); delete it._gameDesc; }
    items = items.concat(espnR.value);
  } else console.error(`[News] ESPN ${league} failed:`, espnR.reason?.message);
  if (rotoR.status === "fulfilled") items = items.concat(rotoR.value);
  else console.error(`[News] RotoWire ${league} failed:`, rotoR.reason?.message);

  if (LEAGUES[league].headshots) {
    try { await resolveHeadshots(items); } catch (e) { console.error("[News] headshots:", e.message); }
  }
  items.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  items = dedupe(items).slice(0, 40).map((x) => ({ ...x, timeAgo: timeAgo(x.published) }));
  return items;
}

router.get("/:league/injuries", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  const builder = league === "mlb" ? buildMlbInjuries : league === "nfl" ? buildNflInjuries : null;
  if (!builder) return res.json({ league, items: [], note: "no injury report for this league yet" });
  const c = injCache[league];
  if (c && (Date.now() - c.at) < INJ_TTL) {
    return res.json({ league, count: c.items.length, items: c.items, updatedAt: new Date(c.at).toISOString(), cached: true });
  }
  try {
    const items = await builder();
    injCache[league] = { items, at: Date.now() };
    res.json({ league, count: items.length, items, updatedAt: new Date().toISOString(), cached: false });
  } catch (err) {
    console.error("[News] injuries error:", err.message);
    if (injCache[league]) return res.json({ league, items: injCache[league].items, stale: true });
    res.status(500).json({ error: "failed to build injuries" });
  }
});

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  if (!LEAGUES[league]) return res.status(400).json({ error: "unsupported league", supported: Object.keys(LEAGUES) });

  const c = cache[league];
  if (c && (Date.now() - c.at) < CACHE_TTL_MS) {
    return res.json({ league, items: c.items, updatedAt: new Date(c.at).toISOString(), cached: true });
  }
  if (inflight[league]) {
    try { await inflight[league]; } catch (_) {}
    const c2 = cache[league];
    if (c2) return res.json({ league, items: c2.items, updatedAt: new Date(c2.at).toISOString(), cached: true, coalesced: true });
  }
  try {
    inflight[league] = buildFeed(league);
    const items = await inflight[league];
    cache[league] = { items, at: Date.now() };
    res.json({ league, items, updatedAt: new Date().toISOString(), cached: false });
  } catch (err) {
    console.error(`[News] build ${league} error:`, err.message);
    if (cache[league]) return res.json({ league, items: cache[league].items, stale: true });
    res.status(500).json({ error: "failed to build news feed" });
  } finally {
    delete inflight[league];
  }
});

module.exports = router;
