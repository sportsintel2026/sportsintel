// Player Card route — enrichment data for the expand-on-tap batting card under
// each prop player in the Props board. READ-ONLY and isolated (its own router) so
// a bug here can never destabilize the main edges feed — same pattern as Market Read.
//
// v3: hand-vs-hand splits + tonight's matchup (pitcher + hand → which split applies)
// + measured factors (barrel%/xwOBA/recent L15) + park factor + model-vs-market
// history + batted-ball pull/spray (Savant custom leaderboard, columns confirmed via
// the probe below). All sourced directly from the same feeds the HR model uses — the
// card never reaches into the model's internals, so it can't drift or destabilize it.
const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const {
  getBatterHandednessSplits, getBatterHand, getScheduleForDate, getPitcherHand,
  getEasternDate, getBatterRecentStats, normPlayerName,
} = require("../services/mlbStatsApi");
const { getBatterBarrels, getBatterExpectedStats, getPitcherWhiffStats, parseCsvLine, SAVANT_BASE } = require("../services/savantApi");
const { getWeatherForVenue } = require("../services/weatherApi");

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SAV = SAVANT_BASE || "https://baseballsavant.mlb.com";
const THIN_AB = 40;     // below this, a vs-hand split is too small a sample to trust
const THIN_BB_PA = 50;  // below this, batted-ball direction % are too noisy to show as firm

function shapeSplit(s) {
  if (!s) return null;
  const ab = s.atBats ?? null;
  return {
    avg: s.avg ?? null, obp: s.obp ?? null, slg: s.slg ?? null, ops: s.ops ?? null,
    ab, hr: s.homeRuns ?? null, thin: ab != null ? ab < THIN_AB : true,
  };
}

function impliedFromOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

function barrelTier(rate) {
  if (rate == null) return null;
  if (rate >= 0.16) return "elite";
  if (rate >= 0.11) return "strong";
  if (rate >= 0.08) return "above avg";
  if (rate >= 0.05) return "average";
  return "low";
}

// ── BATTED-BALL DIRECTION (pull/straight/oppo) ────────────────────────────────
// Savant custom leaderboard, columns confirmed via /probe-batted-ball:
// player_id, pa, pull_percent, straightaway_percent, opposite_percent (PERCENT units).
// min=1 = all batters (gate low-PA as thin); fetched once/day and cached like barrels.
const BB_URL = (y) =>
  `${SAV}/leaderboard/custom?year=${y}&type=batter&filter=&min=1&selections=pa,pull_percent,straightaway_percent,opposite_percent&sort=pull_percent&sortDir=desc&csv=true`;
let _bbCache = { date: null, map: null };
async function getBattedBallMap() {
  const today = getEasternDate(0);
  if (_bbCache.map && _bbCache.date === today) return _bbCache.map;
  const y = new Date().getFullYear();
  try {
    const res = await axios.get(BB_URL(y), {
      timeout: 15000, responseType: "text", transformResponse: (x) => x, validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,text/plain,*/*" },
    });
    const body = typeof res.data === "string" ? res.data : "";
    const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2 || /^\s*<(!doctype|html)/i.test(body)) return null;
    const cols = parseCsvLine(lines[0]).map((c) => c.trim());
    const iId = cols.indexOf("player_id"), iPa = cols.indexOf("pa"),
      iPull = cols.indexOf("pull_percent"), iStr = cols.indexOf("straightaway_percent"),
      iOppo = cols.indexOf("opposite_percent");
    if (iId < 0 || iPull < 0) return null;
    const map = new Map();
    for (let r = 1; r < lines.length; r++) {
      const f = parseCsvLine(lines[r]);
      const id = parseInt(f[iId], 10);
      if (!Number.isFinite(id)) continue;
      const pull = parseFloat(f[iPull]);
      if (!Number.isFinite(pull)) continue;
      map.set(id, {
        pullPct: pull,
        straightPct: iStr >= 0 ? (parseFloat(f[iStr]) || null) : null,
        oppoPct: iOppo >= 0 ? (parseFloat(f[iOppo]) || null) : null,
        pa: iPa >= 0 ? (parseInt(f[iPa], 10) || null) : null,
      });
    }
    if (map.size > 0) { _bbCache = { date: today, map }; return map; }
    return null;
  } catch (_) { return null; }
}

async function findGame(gameId) {
  if (!gameId) return null;
  for (const off of [0, 1, -1]) {
    try {
      const sched = await getScheduleForDate(getEasternDate(off));
      const g = (sched || []).find((x) => String(x.id) === String(gameId));
      if (g) return g;
    } catch (_) { /* keep trying */ }
  }
  return null;
}

async function resolveMatchup(game, teamAbbr) {
  if (!game) return null;
  const t = String(teamAbbr || "").toUpperCase();
  let oppProbable = null, opponent = null;
  if (t && t === String(game.awayAbbr || "").toUpperCase()) {
    oppProbable = game.homeProbable; opponent = game.homeAbbr;
  } else if (t && t === String(game.homeAbbr || "").toUpperCase()) {
    oppProbable = game.awayProbable; opponent = game.awayAbbr;
  }
  let pitcherHand = null;
  if (oppProbable?.id) { try { pitcherHand = await getPitcherHand(oppProbable.id); } catch (_) {} }
  let weather = null;
  if (game.venue) { try { weather = await getWeatherForVenue(game.venue, game.startTimeUTC || null); } catch (_) {} }
  return {
    gameId: String(game.id),
    opponent: opponent || null,
    pitcher: oppProbable?.name || null,
    pitcherHand: pitcherHand || null,
    appliesSplit: pitcherHand === "L" ? "vsLHP" : pitcherHand === "R" ? "vsRHP" : null,
    parkHRFactor: game.parkHRFactor ?? null,
    parkRunFactor: game.parkRunFactor ?? null,
    venue: game.venue || null,
    weather,
  };
}

// GET /api/player-card/mlb/:playerId?gameId=&team=&name=
router.get("/mlb/:playerId", async (req, res) => {
  const playerId = String(req.params.playerId || "").trim();
  if (!/^\d+$/.test(playerId)) {
    return res.status(400).json({ ok: false, error: "playerId must be a numeric MLBAM id" });
  }
  const idNum = Number(playerId);
  const { gameId, team, name } = req.query;

  try {
    const [splits, bats, recent, barrelMap, xMap, bbMap, whiffMap, game] = await Promise.all([
      getBatterHandednessSplits(playerId).catch(() => null),
      getBatterHand(playerId).catch(() => null),
      getBatterRecentStats(playerId, 15).catch(() => null),
      getBatterBarrels().catch(() => null),
      getBatterExpectedStats().catch(() => null),
      getBattedBallMap().catch(() => null),
      getPitcherWhiffStats().catch(() => null),
      findGame(gameId),
    ]);

    const matchup = game ? await resolveMatchup(game, team) : null;
    const bx = barrelMap ? barrelMap.get(idNum) : null;
    const xs = xMap ? xMap.get(idNum) : null;
    const bb = bbMap ? bbMap.get(idNum) : null;
    const pw = whiffMap ? whiffMap.get(idNum) : null;

    const barrelPct = bx?.barrelRate ?? null;
    const xwoba = xs?.xwOBA ?? null;

    let platoonAdvantage = null;
    if (matchup?.pitcherHand && bats) {
      platoonAdvantage =
        bats === "S" ||
        (bats === "L" && matchup.pitcherHand === "R") ||
        (bats === "R" && matchup.pitcherHand === "L");
    }

    let modelVsMarket = [];
    if (name) {
      try {
        const supabase = db();
        const { data } = await supabase
          .from("model_predictions")
          .select("game_date,model_prob,odds,result,selection")
          .eq("league", "mlb").eq("market", "hr_prop")
          .ilike("selection", String(name))
          .order("game_date", { ascending: false })
          .limit(40);
        const want = normPlayerName(String(name));
        modelVsMarket = (data || [])
          .filter((r) => normPlayerName(r.selection || "") === want)
          .slice(0, 10)
          .map((r) => ({
            date: r.game_date,
            modelProb: r.model_prob ?? null,
            marketImplied: impliedFromOdds(r.odds),
            homered: r.result === "pending" ? null : r.result === "win",
          }))
          .reverse();
      } catch (_) { modelVsMarket = []; }
    }

    res.json({
      ok: true,
      player: {
        id: idNum,
        bats: bats || null,
        headshot: `https://midfield.mlbstatic.com/v1/people/${playerId}/spots/120`,
      },
      matchup: matchup ? { ...matchup, platoonAdvantage } : null,
      splits: splits
        ? { season: new Date().getFullYear(), vsLHP: shapeSplit(splits.vsLHP), vsRHP: shapeSplit(splits.vsRHP) }
        : null,
      factors: {
        measured: {
          barrelPct,
          barrelTier: barrelTier(barrelPct),
          xwoba,
          xba: xs?.xBA ?? null,
          xslg: xs?.xSLG ?? null,
          recent15: recent
            ? { games: recent.days, hr: recent.homeRuns ?? null, avg: recent.avg ?? null, slg: recent.slg ?? null, ab: recent.atBats ?? null }
            : null,
        },
        park: matchup?.parkHRFactor != null ? { factor: matchup.parkHRFactor, runFactor: matchup.parkRunFactor ?? null, venue: matchup.venue } : null,
        weather: matchup?.weather || null,
        platoonAdvantage,
      },
      modelVsMarket,
      battedBall: bb
        ? { pullPct: bb.pullPct, straightPct: bb.straightPct, oppoPct: bb.oppoPct, pa: bb.pa, thin: (bb.pa ?? 0) < THIN_BB_PA }
        : null,
      pitcher: pw
        ? { kPct: pw.kPct, whiffPct: pw.whiffPct, bbPct: pw.bbPct, swingPct: pw.swingPct }
        : null,
      dataHealth: {
        splits: !!splits,
        savant: barrelPct != null || xwoba != null,
        gamelog: !!recent,
        matchup: !!matchup,
        history: modelVsMarket.length,
        battedBall: !!bb,
      },
    });
  } catch (e) {
    console.error("[player-card] mlb error:", e.message);
    res.status(500).json({ ok: false, error: "Failed to load player card" });
  }
});

// ── PULL / SPRAY PROBE (kept as a diagnostic) ─────────────────────────────────
const BB_URL_CANDIDATES = (y) => ([
  `${SAV}/leaderboard/custom?year=${y}&type=batter&filter=&min=q&selections=pa,pull_percent,straightaway_percent,opposite_percent&sort=pull_percent&sortDir=desc&csv=true`,
  `${SAV}/leaderboard/custom?year=${y}&type=batter&filter=&min=1&selections=pa,pull_percent,straightaway_percent,opposite_percent&sort=pull_percent&sortDir=desc&csv=true`,
]);
const BB_TARGET_COLS = ["player_id", "pa", "pull_percent", "straightaway_percent", "opposite_percent"];
async function probeBattedBall(year) {
  const y = year || new Date().getFullYear();
  const attempts = [];
  for (const url of BB_URL_CANDIDATES(y)) {
    try {
      const res = await axios.get(url, {
        timeout: 15000, responseType: "text", transformResponse: (x) => x, validateStatus: () => true,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,text/plain,*/*" },
      });
      const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
      const isHtml = /^\s*<(!doctype|html)/i.test(body);
      const looksCsv = !isHtml && lines.length > 1 && /,/.test(lines[0]);
      const cols = looksCsv ? parseCsvLine(lines[0]).map((c) => c.trim()) : [];
      const hasColumns = {};
      for (const t of BB_TARGET_COLS) hasColumns[t] = cols.includes(t);
      attempts.push({ url, httpStatus: res.status, byteLength: body.length, dataLineCount: lines.length, looksCsv, headerLine: looksCsv ? lines[0] : null, firstDataRow: looksCsv ? lines[1] : null, hasColumns });
    } catch (e) { attempts.push({ url, error: e.message }); }
  }
  const usable = attempts.filter((a) => a.looksCsv && a.hasColumns && a.hasColumns.player_id && a.hasColumns.pull_percent);
  return { ok: usable.length > 0, year: y, usableUrls: usable.map((u) => u.url), attempts };
}
router.get("/probe-batted-ball", async (req, res) => {
  try {
    res.json(await probeBattedBall(req.query.year ? Number(req.query.year) : undefined));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── EXTENDED BATTED-BALL PROBE (read-only; confirm columns before wiring Wave 2) ─
// Savant's /leaderboard/custom returns ONLY the selected columns, so we must confirm
// which extra selection keys it accepts (and their exact header names) before adding
// them to the live BB_URL. Hit once, paste columnsPresent + headerLine.
router.get("/probe-bb-extended", async (req, res) => {
  const y = new Date().getFullYear();
  const SELS = "pa,pull_percent,straightaway_percent,opposite_percent,hard_hit_percent,groundballs_percent,flyballs_percent,linedrives_percent,popups_percent";
  const url = `${SAV}/leaderboard/custom?year=${y}&type=batter&filter=&min=q&selections=${SELS}&sort=pa&sortDir=desc&csv=true`;
  try {
    const r = await axios.get(url, {
      timeout: 15000, responseType: "text", transformResponse: (x) => x, validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WizePicks/1.0)", Accept: "text/csv,text/plain,*/*" },
    });
    const body = typeof r.data === "string" ? r.data : "";
    const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
    const looksCsv = lines.length > 1 && !/^\s*<(!doctype|html)/i.test(body);
    const cols = looksCsv ? parseCsvLine(lines[0]).map((c) => c.trim()) : [];
    const present = {};
    SELS.split(",").forEach((w) => { present[w] = cols.includes(w); });
    res.json({
      ok: looksCsv, httpStatus: r.status,
      headerLine: looksCsv ? lines[0] : body.slice(0, 220),
      firstDataRow: looksCsv ? lines[1] : null,
      columnsPresent: present, allColumns: cols, requestedUrl: url,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
