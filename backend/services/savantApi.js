// Baseball Savant (Statcast) data pipe.
//
// WHY THIS EXISTS: the MLB StatsAPI Statcast endpoint returns null for batters
// (confirmed empirically — statcastPresent:false for everyone), so xBA / xwOBA must
// come from Baseball Savant's public CSV leaderboard instead. Savant keys players by
// MLBAM player_id — the SAME id our roster lookup uses (batter.id) — so the join is
// clean. We fetch ONCE per day and cache (never per-batter).
//
// Confirmed live (2026-06-06): the expected_statistics CSV returns HTTP 200,
// text/csv, ~541 batters, columns incl. player_id, ba, est_ba (xBA), est_woba (xwOBA).

const axios = require("axios");

const SAVANT_BASE = "https://baseballsavant.mlb.com";

function expectedStatsUrl(year) {
  return `${SAVANT_BASE}/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=1&csv=true`;
}

// Quote-aware CSV line parser — Savant's first column is "Last, First" with a comma
// INSIDE the quotes, so a naive split breaks. Verified against real Savant rows.
function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Parse the expected-stats CSV text into a Map: playerId(Number) -> { xBA, xwOBA, ba, pa }.
// Header-indexed (robust to column reordering). Pure function — unit-testable offline.
function parseExpectedStatsCsv(text) {
  const map = new Map();
  if (!text || typeof text !== "string") return map;
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return map;
  const cols = parseCsvLine(lines[0]).map((c) => c.trim());
  const iId = cols.indexOf("player_id");
  const iXba = cols.indexOf("est_ba");
  const iXwoba = cols.indexOf("est_woba");
  const iBa = cols.indexOf("ba");
  const iPa = cols.indexOf("pa");
  if (iId < 0 || iXba < 0) return map; // wrong shape — bail rather than mis-map
  for (let r = 1; r < lines.length; r++) {
    const f = parseCsvLine(lines[r]);
    const id = parseInt(f[iId], 10);
    const xBA = parseFloat(f[iXba]);
    if (!Number.isFinite(id) || !Number.isFinite(xBA)) continue;
    map.set(id, {
      xBA,
      xwOBA: iXwoba >= 0 ? (parseFloat(f[iXwoba]) || null) : null,
      ba: iBa >= 0 ? (parseFloat(f[iBa]) || null) : null,
      pa: iPa >= 0 ? (parseInt(f[iPa], 10) || null) : null,
    });
  }
  return map;
}

// Cached daily fetch. Returns the parsed Map (or null on failure — callers must
// fall back gracefully so a Savant outage never breaks the model).
let _cache = { date: null, map: null };
async function getBatterExpectedStats(year) {
  const y = year || new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  if (_cache.map && _cache.date === today) return _cache.map;
  try {
    const res = await axios.get(expectedStatsUrl(y), {
      timeout: 15000,
      responseType: "text",
      transformResponse: (x) => x,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,*/*" },
    });
    const map = parseExpectedStatsCsv(typeof res.data === "string" ? res.data : "");
    if (map.size > 0) { _cache = { date: today, map }; return map; }
    return null;
  } catch (e) {
    return null;
  }
}

// ── BARREL RATE (separate Savant leaderboard) ─────────────────────────────────
// xBA/xwOBA come from the expected_statistics leaderboard above. Barrel rate lives
// on a DIFFERENT leaderboard (exit velocity & barrels). We don't yet know the exact
// slug / min param / column names for the CSV export, so probeBarrels tries several
// candidate URLs in one shot and reports what each returns — one Railway run reveals
// the working endpoint AND the real header so we can build the parser with no guessing.
const BARREL_URL_CANDIDATES = (year) => ([
  `${SAVANT_BASE}/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=1&csv=true`,
  `${SAVANT_BASE}/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=q&csv=true`,
  `${SAVANT_BASE}/leaderboard/exit_velocity_barrels?type=batter&year=${year}&position=&team=&min=1&csv=true`,
  `${SAVANT_BASE}/leaderboard/exit_velocity_barrels?type=batter&year=${year}&min=q&csv=true`,
]);

async function probeBarrels(year) {
  const y = year || new Date().getFullYear();
  const urls = BARREL_URL_CANDIDATES(y);
  const attempts = [];
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        responseType: "text",
        transformResponse: (x) => x,
        validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,text/plain,*/*" },
      });
      const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
      const isHtml = /^\s*<(!doctype|html)/i.test(body);
      const looksCsv = !isHtml && lines.length > 1 && /,/.test(lines[0]);
      attempts.push({
        url, httpStatus: res.status,
        contentType: (res.headers && res.headers["content-type"]) || null,
        byteLength: body.length, dataLineCount: lines.length,
        looksCsv, looksLikeHtml: isHtml,
        headerLine: looksCsv ? lines[0] : (isHtml ? "(html page)" : (lines[0] || null)),
        firstDataRow: looksCsv ? lines[1] : null,
      });
      if (looksCsv) break; // found a working CSV endpoint — stop here
    } catch (e) {
      attempts.push({ url, error: e.message });
    }
  }
  const winner = attempts.find((a) => a.looksCsv) || null;
  return { ok: !!winner, year: y, winningUrl: winner ? winner.url : null, attempts };
}

// Raw probe: report what Savant returns WITHOUT parsing (used to confirm reachability
// and the real column layout). Never throws.
async function probeExpectedStats(year) {
  const y = year || new Date().getFullYear();
  const url = expectedStatsUrl(y);
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      responseType: "text",
      transformResponse: (x) => x,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,text/plain,*/*" },
    });
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
    return {
      ok: res.status >= 200 && res.status < 300,
      url, httpStatus: res.status,
      contentType: (res.headers && res.headers["content-type"]) || null,
      byteLength: body.length, dataLineCount: lines.length,
      headerLine: lines[0] || null, firstDataRow: lines[1] || null,
      looksLikeHtml: /^\s*<(!doctype|html)/i.test(body),
    };
  } catch (e) {
    return { ok: false, url, error: e.message };
  }
}

module.exports = {
  getBatterExpectedStats, parseExpectedStatsCsv, parseCsvLine,
  probeExpectedStats, expectedStatsUrl, SAVANT_BASE,
  probeBarrels,
};
