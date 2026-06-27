// WZ-NEWS-FEED-2026-06-26 :: blended news feed (ESPN JSON + RotoWire RSS), per-league.
// Read-only. No DB. ESPN gives headlines/recaps/video + images + game tagging;
// RotoWire gives the player/injury wire. MLB wire items get a best-effort headshot
// via the free MLB Stats API name map (fail-safe: any miss -> null -> UI fallback).
// Endpoint: GET /api/news/:league   league in {mlb,nfl,cfb}
const express = require("express");
const router = express.Router();
const axios = require("axios");

// ── league config ──────────────────────────────────────────────────────────
const LEAGUES = {
  mlb: { espn: "baseball/mlb",            roto: "MLB", headshots: true  },
  nfl: { espn: "football/nfl",            roto: "NFL", headshots: false },
  cfb: { espn: "football/college-football", roto: "CFB", headshots: false },
};

// ── in-memory cache (per league) + coalescing, matching edges.js house style ──
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — news moves fast but protect the feeds
const cache = {};        // league -> { items, at }
const inflight = {};     // league -> Promise (request coalescing)

// ── small helpers ────────────────────────────────────────────────────────────
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

// ── ESPN: headlines / recaps / video, with images + game tagging ───────────────
async function fetchEspn(league) {
  const cfg = LEAGUES[league];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${cfg.espn}/news?limit=30`;
  const { data } = await axios.get(url, { timeout: 9000, headers: { "User-Agent": "Mozilla/5.0" } });
  const arts = Array.isArray(data?.articles) ? data.articles : [];
  return arts.map((a) => {
    const tRaw = (a.type || "").toLowerCase();
    let type = "headline";
    if (tRaw === "media") type = "video";
    else if (tRaw === "recap") type = "recap";
    else if (tRaw === "preview") type = "headline";
    // pick a usable image: prefer a real photo over auto "stitcher" graphics
    let image = null;
    const imgs = Array.isArray(a.images) ? a.images : [];
    const real = imgs.find((i) => i.url && i.type !== "stitcher" && (i.width || 0) >= 300);
    image = (real || imgs.find((i) => i.url) || {}).url || null;
    // game chip from a tagged event category ("Away @ Home")
    let game = null;
    const ev = (a.categories || []).find((c) => c.type === "event" && c.description);
    if (ev) {
      const m = ev.description.match(/^(.+?)\s+@\s+(.+)$/);
      game = m ? `${abbr(m[1])} @ ${abbr(m[2])}` : null;
    }
    const link = a?.links?.web?.href || a?.links?.mobile?.href || "";
    return {
      id: `espn-${a.id}`,
      source: "espn",
      type,
      headline: decodeEntities(a.headline || ""),
      summary: decodeEntities(a.description || ""),
      image,
      link,
      published: a.published || a.lastModified || null,
      game,
      playerName: null, headshot: null, status: null,
    };
  }).filter((x) => x.headline && x.link);
}

// crude team-name -> abbev for the game chip (full names from ESPN event desc)
function abbr(team = "") {
  const t = team.trim();
  const last = t.split(" ").pop();
  const map = {
    Dodgers:"LAD",Rockies:"COL",Astros:"HOU",Rangers:"TEX",Marlins:"MIA","Jays":"TOR","Blue":"TOR",
    Yankees:"NYY",Mets:"NYM",Cubs:"CHC","Sox":"BOS",Braves:"ATL",Padres:"SD",Giants:"SF",Phillies:"PHI",
    Guardians:"CLE",Tigers:"DET",Twins:"MIN",Royals:"KC",Brewers:"MIL",Cardinals:"STL",Pirates:"PIT",
    Reds:"CIN",Nationals:"WSH",Orioles:"BAL",Rays:"TB",Angels:"LAA",Athletics:"ATH",Mariners:"SEA",
    Diamondbacks:"AZ",
  };
  return map[last] || last.slice(0, 3).toUpperCase();
}

// ── RotoWire: the player / injury wire (RSS 2.0) ───────────────────────────────
async function fetchRoto(league) {
  const cfg = LEAGUES[league];
  const url = `https://www.rotowire.com/rss/news.php?sport=${cfg.roto}`;
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
    const desc = pick("description");
    const link = pick("link");
    const pub = pick("pubDate");
    if (!title) continue;
    const blob = `${title} ${desc}`.toLowerCase();
    let status = "note";
    if (/injur|il\b|day-to-day|strain|sprain|contusion|fracture|surgery|concussion|placed on|out (for|indefinitely)|sidelined|hamstring|oblique|elbow|shoulder|knee/.test(blob)) status = "injury";
    else if (/lineup|returns?|activated|reinstated|starting|recalled|back (in|from)/.test(blob)) status = "lineup";
    const playerName = extractPlayer(title);
    items.push({
      id: `roto-${(link || title).slice(-60)}`,
      source: "rotowire",
      type: "wire",
      headline: title,
      summary: desc,
      image: null,
      link,
      published: pub ? new Date(pub).toISOString() : null,
      game: null,
      playerName,
      headshot: null, // filled by resolveHeadshots() for MLB
      status,
    });
  }
  return items;
}

// RotoWire titles usually lead with the player's name. Grab the name-ish prefix.
function extractPlayer(title = "") {
  let t = title.split(/[:\u2013\u2014\-]/)[0].trim(); // before colon/dash
  const words = t.split(/\s+/).slice(0, 3);
  // keep leading capitalized tokens (a name), stop at a lowercase verb
  const keep = [];
  for (const w of words) {
    if (/^[A-Z][A-Za-z.'\u00C0-\u017F]+$/.test(w)) keep.push(w);
    else break;
  }
  return keep.length >= 2 ? keep.join(" ") : (keep[0] || "");
}

// ── MLB headshots: best-effort name -> MLBAM id via free Stats API (cached 24h) ─
let mlbMap = null, mlbMapAt = 0;
const MLB_MAP_TTL = 24 * 60 * 60 * 1000;
async function getMlbNameMap() {
  if (mlbMap && (Date.now() - mlbMapAt) < MLB_MAP_TTL) return mlbMap;
  try {
    const yr = new Date().getFullYear();
    const { data } = await axios.get(
      `https://statsapi.mlb.com/api/v1/sports/1/players`, { params: { season: yr }, timeout: 9000 });
    const map = new Map();
    for (const p of data?.people || []) {
      if (p.fullName && p.id) map.set(norm(p.fullName), p.id);
    }
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
    if (id) it.headshot =
      `https://midfield.mlbstatic.com/v1/people/${id}/spots/120`;
  }
}

// ── build + cache ──────────────────────────────────────────────────────────────
async function buildFeed(league) {
  const [espn, roto] = await Promise.allSettled([fetchEspn(league), fetchRoto(league)]);
  let items = [];
  if (espn.status === "fulfilled") items = items.concat(espn.value);
  else console.error(`[News] ESPN ${league} failed:`, espn.reason?.message);
  if (roto.status === "fulfilled") items = items.concat(roto.value);
  else console.error(`[News] RotoWire ${league} failed:`, roto.reason?.message);

  if (LEAGUES[league].headshots) {
    try { await resolveHeadshots(items); } catch (e) { console.error("[News] headshots:", e.message); }
  }
  items.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  items = items.slice(0, 40).map((x) => ({ ...x, timeAgo: timeAgo(x.published) }));
  return items;
}

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
