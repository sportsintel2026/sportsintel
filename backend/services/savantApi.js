// Baseball Savant (Statcast) data pipe.
//
// WHY THIS EXISTS: the MLB StatsAPI Statcast endpoint returns null for batters
// (confirmed empirically via the hits probe — statcastPresent:false for everyone),
// so xBA / xwOBA / barrel rate must come from Baseball Savant's public CSV
// leaderboards instead. Savant keys players by MLBAM player_id — the SAME id our
// roster lookup already uses (batter.id) — so the join is clean. We fetch ONCE per
// day and cache (never per-batter), to stay light on Savant.
//
// STATUS: step 1 = raw probe only (probeExpectedStats). It fetches and reports
// exactly what Savant returns WITHOUT parsing, so we can confirm reachability and
// the real column layout before writing a parser or wiring anything into the model.

const axios = require("axios");

const SAVANT_BASE = "https://baseballsavant.mlb.com";

// Expected-stats leaderboard — gives est_ba (xBA) and est_woba (xwOBA) per batter.
function expectedStatsUrl(year) {
  return `${SAVANT_BASE}/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=1&csv=true`;
}

// Raw probe: fetch the CSV and report what comes back, WITHOUT parsing. Reports the
// HTTP status (even on error), content type, header row, and one data row so we can
// see the exact columns before trusting any parser. Never throws.
async function probeExpectedStats(year) {
  const y = year || new Date().getFullYear();
  const url = expectedStatsUrl(y);
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      responseType: "text",
      transformResponse: (x) => x, // keep the raw text, don't let axios JSON-parse
      validateStatus: () => true, // don't throw on non-2xx — we want to SEE the status
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
    return {
      ok: res.status >= 200 && res.status < 300,
      url,
      httpStatus: res.status,
      contentType: (res.headers && res.headers["content-type"]) || null,
      byteLength: body.length,
      dataLineCount: lines.length,
      headerLine: lines[0] || null,
      firstDataRow: lines[1] || null,
      secondDataRow: lines[2] || null,
      looksLikeHtml: /^\s*<(!doctype|html)/i.test(body),
    };
  } catch (e) {
    return { ok: false, url, error: e.message };
  }
}

module.exports = { probeExpectedStats, expectedStatsUrl, SAVANT_BASE };
