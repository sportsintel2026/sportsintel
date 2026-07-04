// WZ-NFLPROPSACTUALS-2026-07-05
// nflPropsActuals.js  —  WizePicks NFL box-score ACTUALS (Phase 3, B-3a).
//
// The grader needs each player's REAL stat in a finished game to score the shadow
// rows. The athlete gamelog endpoint 404'd, so the source is the game box score
// (summary endpoint). This module holds the reusable box-score extractor the grader
// will call, plus a read-only probe to confirm the shape against a REAL completed
// 2025 game before the grader trusts it ("wired != flowing").
//
//   extractBoxscoreActuals(summaryJson)  PURE — maps normalized player name ->
//       { pass_yds, rush_yds, receptions, rec_yds }. Matches stat COLUMNS BY LABEL
//       (finds the "YDS"/"REC" column), not by assumed position, so a column-order
//       change can't silently corrupt a value.
//   probeActuals({date})  LIVE — scoreboard for a date -> first FINAL game ->
//       summary -> reports the raw category labels + a sample athlete row AND runs
//       the extractor on a few players, so the shape is confirmed end to end.
//
// Isolated module (own axios). CommonJS, Node 18+. Reuses the shadow logger's
// normalizeName so grader match logic is identical to the logger's.

const axios = require("axios");
const { normalizeName } = require("./nflPropsShadow");

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const TIMEOUT_MS = 9000;

function num(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}
async function espnGet(url) {
  const res = await axios.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": UA, Accept: "application/json" } });
  return res.data;
}

// ── PURE: extract per-player actuals from a game summary/box score ────────────────
// ESPN box score: summary.boxscore.players = [ { team, statistics: [
//   { name:"passing",   labels:[...,"YDS",...], athletes:[{ athlete:{displayName}, stats:[...] }] },
//   { name:"rushing",   labels:[...,"YDS",...], athletes:[...] },
//   { name:"receiving", labels:["REC",...,"YDS",...], athletes:[...] } ] } ]
// We resolve each value by finding its LABEL's index, never a hard-coded position.
function valueByLabel(labels, stats, label) {
  const i = (labels || []).findIndex((l) => String(l).toUpperCase() === label);
  return i >= 0 ? num((stats || [])[i]) : null;
}

function extractBoxscoreActuals(summaryJson) {
  const byPlayer = {}; // normName -> { name, pass_yds, rush_yds, receptions, rec_yds }
  const teams = (summaryJson && summaryJson.boxscore && summaryJson.boxscore.players) || [];
  const ensure = (name) => {
    const k = normalizeName(name);
    if (!byPlayer[k]) byPlayer[k] = { name, pass_yds: null, rush_yds: null, receptions: null, rec_yds: null };
    return byPlayer[k];
  };
  for (const t of teams) {
    for (const cat of t.statistics || []) {
      const catName = String(cat.name || "").toLowerCase();
      const labels = cat.labels || cat.names || [];
      for (const a of cat.athletes || []) {
        const nm = a.athlete && (a.athlete.displayName || a.athlete.fullName);
        if (!nm) continue;
        const stats = a.stats || [];
        const rec = ensure(nm);
        if (catName === "passing") rec.pass_yds = valueByLabel(labels, stats, "YDS");
        else if (catName === "rushing") rec.rush_yds = valueByLabel(labels, stats, "YDS");
        else if (catName === "receiving") {
          rec.receptions = valueByLabel(labels, stats, "REC");
          rec.rec_yds = valueByLabel(labels, stats, "YDS");
        }
      }
    }
  }
  return byPlayer;
}

// ── LIVE: scoreboard for a date -> finished games ────────────────────────────────
async function fetchFinals(dateYYYYMMDD) {
  const data = await espnGet(`${ESPN_SITE}/scoreboard?dates=${dateYYYYMMDD}`);
  const events = (data && data.events) || [];
  return events.map((e) => {
    const comp = (e.competitions && e.competitions[0]) || {};
    const status = (e.status && e.status.type) || (comp.status && comp.status.type) || {};
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === "home");
    const away = cs.find((c) => c.homeAway === "away");
    return {
      eventId: e.id,
      name: e.name || e.shortName,
      final: !!status.completed,
      state: status.state,
      home: home && home.team && home.team.displayName,
      away: away && away.team && away.team.displayName,
    };
  });
}

async function fetchSummary(eventId) {
  return espnGet(`${ESPN_SITE}/summary?event=${eventId}`);
}

// ── LIVE: probe — confirm the box-score shape + run the extractor ─────────────────
async function probeActuals({ date = "20251207" } = {}) {
  const out = { date };
  let finals = [];
  try {
    const games = await fetchFinals(date);
    finals = games.filter((g) => g.final);
    out.scoreboard = { total: games.length, finals: finals.length, sample: games.slice(0, 4) };
  } catch (e) {
    out.scoreboard = { ok: false, error: e.message };
    return out;
  }
  if (finals.length === 0) {
    out.note = "No FINAL games on this date. Try another with ?date=YYYYMMDD (a 2025 regular-season Sunday, e.g. 20251214).";
    return out;
  }

  const target = finals[0];
  try {
    const summary = await fetchSummary(target.eventId);
    const teams = (summary.boxscore && summary.boxscore.players) || [];
    // raw shape: category labels + one sample athlete row per category
    const rawShape = teams.slice(0, 1).map((t) => ({
      team: t.team && t.team.displayName,
      categories: (t.statistics || []).map((c) => ({
        name: c.name,
        labels: c.labels || c.names || [],
        sampleAthlete: (c.athletes && c.athletes[0])
          ? { name: c.athletes[0].athlete && c.athletes[0].athlete.displayName, stats: c.athletes[0].stats }
          : null,
      })),
    }));
    const extracted = extractBoxscoreActuals(summary);
    const names = Object.keys(extracted);
    // surface a few players who have real values, to confirm the extractor mapped correctly
    const sampleExtract = names
      .map((k) => extracted[k])
      .filter((p) => p.pass_yds != null || p.rush_yds != null || p.receptions != null)
      .slice(0, 8);
    out.game = `${target.away} @ ${target.home}`;
    out.rawShape = rawShape;
    out.extractedPlayerCount = names.length;
    out.sampleExtract = sampleExtract;
    out.note = "Confirm rawShape.labels line up with sampleExtract values. If a stat is null where it should have a number, the label for that column differs and the extractor needs that label added.";
  } catch (e) {
    out.summary = { ok: false, eventId: target.eventId, error: e.message };
  }
  return out;
}

module.exports = {
  extractBoxscoreActuals,
  valueByLabel,
  fetchFinals,
  fetchSummary,
  probeActuals,
};
