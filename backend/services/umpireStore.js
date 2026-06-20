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

module.exports = { logUmpireGame, backfillUmpireGames };
