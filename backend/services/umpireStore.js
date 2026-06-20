// Umpire-games store.
//
// Upserts one row per FINISHED game into Supabase `umpire_games`, derived purely
// from MLB feeds (boxscore + linescore) via getGameUmpireAndTotals — no odds
// dependency, no new data sources. closing_total / went_over stay null here; they
// come from our captured closing totals and are filled separately, going forward.
//
// Keyed on game_pk, so every write is an idempotent upsert: re-running a backfill
// range (or overlapping ranges) never duplicates rows and is always safe to retry.

const { createClient } = require("@supabase/supabase-js");
const { getScheduleForDate, getGameUmpireAndTotals } = require("./mlbStatsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Log a single finished game. Returns {logged} or {skipped}. We skip when the
// umpire hasn't been posted yet (game not truly final / officials missing) so we
// never write a half-populated row.
async function logUmpireGame(gamePk, gameDate) {
  const row = await getGameUmpireAndTotals(String(gamePk));
  if (!row || !row.umpire) return { gamePk: String(gamePk), logged: false, skipped: "no umpire" };
  const rec = {
    game_pk: String(gamePk),
    game_date: gameDate,
    hp_umpire: row.umpire,
    total_k: row.totalK,
    total_bb: row.totalBB,
    total_runs: row.totalRuns,
    first_inning_runs: row.firstInningRuns,
    nrfi: row.nrfi,
  };
  const { error } = await db().from("umpire_games").upsert(rec, { onConflict: "game_pk" });
  if (error) throw new Error(error.message);
  return { gamePk: String(gamePk), umpire: row.umpire, logged: true };
}

// Backfill a date range (inclusive, ET calendar dates). Processes whole days; stops
// after a day once `cap` games have been processed and returns resumeFrom so the
// caller can continue (a long full-season range would otherwise exceed the request
// timeout). Because writes are idempotent, re-hitting from=resumeFrom is harmless.
async function backfillUmpireGames(fromDate, toDate, cap = 150) {
  const end = new Date(toDate + "T00:00:00Z");
  let processed = 0, logged = 0, skipped = 0;
  const perDate = [];
  let d = new Date(fromDate + "T00:00:00Z");
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    let sched = null;
    try { sched = await getScheduleForDate(date); } catch (_) {}
    const finals = (sched || []).filter((g) => /final/i.test(g.status || ""));
    let dayLogged = 0;
    for (const g of finals) {
      try {
        const r = await logUmpireGame(g.id, date);
        if (r.logged) { logged++; dayLogged++; } else skipped++;
      } catch (_) { skipped++; }
      processed++;
    }
    perDate.push({ date, finals: finals.length, logged: dayLogged });
    if (processed >= cap) {
      const next = new Date(d); next.setUTCDate(next.getUTCDate() + 1);
      return {
        fromDate, toDate, logged, skipped, processed,
        done: false, resumeFrom: next.toISOString().slice(0, 10), perDate,
      };
    }
  }
  return { fromDate, toDate, logged, skipped, processed, done: true, perDate };
}

// ── Aggregation (Step 4) ──────────────────────────────────────────────────────
// Reads umpire_games and computes per-ump tendencies vs the league average. The
// table is small (~a season of games), so we pull and aggregate in JS — simple and
// flexible. kIndex is the strikeout-environment proxy: 1.00 = league average,
// >1.03 leans wide-zone/strikeout-friendly, <0.97 leans tight/hitter-friendly.
function _aggregate(rows) {
  const n = rows.length || 1;
  const sum = (f) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  const leagueAvg = {
    games: rows.length,
    kPerGame: +(sum("total_k") / n).toFixed(2),
    bbPerGame: +(sum("total_bb") / n).toFixed(2),
    runsPerGame: +(sum("total_runs") / n).toFixed(2),
    nrfiPct: +((100 * rows.filter((r) => r.nrfi === true).length) / n).toFixed(1),
  };

  const byUmp = new Map();
  for (const r of rows) {
    if (!r.hp_umpire) continue;
    if (!byUmp.has(r.hp_umpire)) byUmp.set(r.hp_umpire, []);
    byUmp.get(r.hp_umpire).push(r);
  }

  const umpires = [];
  for (const [name, gs] of byUmp) {
    const g = gs.length;
    const avg = (f) => gs.reduce((a, r) => a + (Number(r[f]) || 0), 0) / g;
    const kpg = avg("total_k");
    const ov = gs.filter((r) => r.went_over === true || r.went_over === false);
    umpires.push({
      name,
      games: g,
      thin: g < 10, // flag small samples; still returned, just not yet reliable
      kPerGame: +kpg.toFixed(2),
      kIndex: +(kpg / (leagueAvg.kPerGame || 1)).toFixed(3),
      bbPerGame: +avg("total_bb").toFixed(2),
      runsPerGame: +avg("total_runs").toFixed(2),
      nrfiPct: +((100 * gs.filter((r) => r.nrfi === true).length) / g).toFixed(1),
      overPct: ov.length ? +((100 * ov.filter((r) => r.went_over === true).length) / ov.length).toFixed(1) : null,
      overSample: ov.length,
    });
  }
  return { leagueAvg, umpires };
}

let _rowCache = { at: 0, rows: null };
async function _allRows() {
  // Tendencies move slowly (~15 new rows/day from the nightly logger), so a short
  // in-memory cache keeps the by-name lookup (hit on every game-detail load) from
  // re-reading the whole table each time.
  if (_rowCache.rows && Date.now() - _rowCache.at < 10 * 60 * 1000) return _rowCache.rows;
  const { data, error } = await db()
    .from("umpire_games")
    .select("hp_umpire,total_k,total_bb,total_runs,nrfi,went_over")
    .not("hp_umpire", "is", null);
  if (error) throw new Error(error.message);
  _rowCache = { at: Date.now(), rows: data || [] };
  return _rowCache.rows;
}

// Full board, sorted by strikeout environment (kIndex) descending.
async function getUmpireTendencies({ minGames = 1 } = {}) {
  const { leagueAvg, umpires } = _aggregate(await _allRows());
  umpires.sort((a, b) => b.kIndex - a.kIndex);
  return { leagueAvg, count: umpires.length, umpires: umpires.filter((u) => u.games >= minGames) };
}

// Normalize a name for cross-source matching: strip accents, drop periods/hyphens/
// apostrophes, lowercase, collapse spaces. Lets ESPN's "D.J. Reyburn" / "Alfonso
// Márquez" match our StatsAPI rows regardless of punctuation or diacritics.
function _normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\-']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// One umpire by name. Exact normalized match first, then a last-name + first-initial
// fallback for any remaining spelling drift between feeds. Returns league avg too.
async function getUmpireByName(name) {
  const wantRaw = String(name || "").trim();
  if (!wantRaw) return null;
  const { leagueAvg, umpires } = _aggregate(await _allRows());
  const want = _normName(wantRaw);
  let u = umpires.find((x) => _normName(x.name) === want) || null;
  if (!u) {
    const wp = want.split(" ");
    const wLast = wp[wp.length - 1], wInit = (wp[0] || "")[0] || "";
    u = umpires.find((x) => {
      const xp = _normName(x.name).split(" ");
      return xp[xp.length - 1] === wLast && (xp[0] || "")[0] === wInit;
    }) || null;
  }
  return { leagueAvg, umpire: u };
}

// Display-shaped tendency for the game page's HOME PLATE UMPIRE block. Returns
// { name, games, favor, runs, k, bb } when the ump is in the table, or just { name }
// if not yet (e.g. a call-up). null only when no name is given. Never throws.
async function getUmpireDisplay(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  let res = null;
  try { res = await getUmpireByName(raw); } catch (_) { res = null; }
  const u = res && res.umpire, la = res && res.leagueAvg;
  if (!u) return { name: raw };
  const runsDiff = (la && u.runsPerGame != null) ? (u.runsPerGame - la.runsPerGame) : null;
  return {
    name: u.name,
    games: u.games,
    favor: u.kIndex >= 1.04 ? "strikeouts" : u.kIndex <= 0.96 ? "hitters" : null,
    runs: runsDiff != null ? (runsDiff >= 0 ? "+" : "") + runsDiff.toFixed(1) : null,
    k: u.kPerGame != null ? u.kPerGame.toFixed(1) : null,
    bb: u.bbPerGame != null ? u.bbPerGame.toFixed(1) : null,
  };
}

module.exports = { logUmpireGame, backfillUmpireGames, getUmpireTendencies, getUmpireByName, getUmpireDisplay };
