// researchScores.js :: WZ-RESEARCH-SCORES-2026-07-28
// Research-only final-score backfill for research_mlb_closing. Fills final_home / final_away /
// mlb_game_pk on rows the line backfill already wrote, by matching each stored game to that
// date's MLB StatsAPI schedule.
//
// NOT a production path: nothing customer-facing reads or writes research_mlb_closing, and this
// module is driven solely by a low-frequency cron in server.js. It is completely inert unless
// RESEARCH_SCORES_ENABLED === 'true' (checked FIRST, before any network or DB call).
//
// LOOP: StatsAPI is free and unmetered, so a run scores as many CONSECUTIVE dates as it can —
// enough to CLOSE the gap behind the line backfill, not merely match its pace. The line cursor
// (research_backfill_state) is read ONCE at the start; the loop stops when it catches the line
// cursor, passes 2025-10-01, hits the 60-date cap, or hits the 60s wall-clock budget. The scores
// cursor (research_scores_state, id=1) is advanced after EACH date — never once at the end — so a
// crash mid-loop never loses completed dates. A date with no unscored rows is skipped without any
// StatsAPI call. A module-level re-entrancy guard prevents a slow run from overlapping the next
// cron fire. A missing state row refuses to run rather than invent a start date.

const { createClient } = require("@supabase/supabase-js");
const { getScheduleForDate } = require("./mlbStatsApi");
// MUST reuse the ONE shared folder (WZ-NAMEFOLD) — no second hand-rolled normalizer. See PR #29.
const { foldStrokes } = require("./nameFold");

const RANGE_END = "2025-10-01";
const MAX_DATES = 60;             // hard cap on dates scored per run
const MAX_MS = 60 * 1000;         // wall-clock budget per run, so a slow run can't overlap the next fire

// Re-entrancy guard: one run at a time. Cleared in finally so a thrown error can't wedge it true.
let _running = false;

function addDaysUTC(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// Team-name match key: shared stroke folding, then lowercase, then strip everything non-alphanumeric.
function normTeam(name) {
  return foldStrokes(String(name || "")).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function runScoreBatch() {
  // Gate FIRST — before any network or DB call. Inert unless explicitly enabled.
  if (process.env.RESEARCH_SCORES_ENABLED !== "true") return { skipped: "disabled" };

  // Re-entrancy: if a run is already in progress, skip this fire rather than overlap it.
  if (_running) { console.log("[scores] already running, skipping"); return { skipped: "already-running" }; }
  _running = true;
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Score cursor: research_scores_state (id=1). Missing row → refuse to run (no invented start).
    const { data: st, error: stErr } = await supabase
      .from("research_scores_state").select("last_processed_date").eq("id", 1).limit(1);
    if (stErr) throw new Error(`scores cursor read failed: ${stErr.message}`);
    let cursor = st && st[0] && st[0].last_processed_date ? String(st[0].last_processed_date).slice(0, 10) : null;
    if (!cursor) {
      console.error("[scores] research_scores_state row (id=1) is missing — refusing to invent a start date. Seed it first.");
      return { error: "state row missing" };
    }

    // Line cursor read ONCE: scores may only cover dates the line backfill has already reached.
    const { data: ls, error: lsErr } = await supabase
      .from("research_backfill_state").select("last_processed_date").eq("id", 1).limit(1);
    if (lsErr) throw new Error(`line cursor read failed: ${lsErr.message}`);
    const lineLast = ls && ls[0] && ls[0].last_processed_date ? String(ls[0].last_processed_date).slice(0, 10) : null;
    if (!lineLast) {
      console.error("[scores] research_backfill_state row (id=1) is missing — cannot gate on the line backfill; holding.");
      return { error: "line state row missing" };
    }

    const startedAt = Date.now();
    let processed = 0, totalMatched = 0, totalUnmatched = 0, totalUpdated = 0;
    let exitReason;
    while (true) {
      const target = addDaysUTC(cursor, 1);
      if (target > lineLast) { console.log("[scores] caught up to line backfill"); exitReason = "caught-up"; break; }
      if (target > RANGE_END) { console.log(`[scores] score backfill complete — cursor ${target} is past ${RANGE_END}; nothing to do.`); exitReason = "complete"; break; }
      if (processed >= MAX_DATES) { console.log(`[scores] stopping — ${MAX_DATES}-date cap reached this run.`); exitReason = "cap"; break; }
      if (Date.now() - startedAt >= MAX_MS) { console.log(`[scores] stopping — ${MAX_MS / 1000}s time budget reached this run.`); exitReason = "time"; break; }

      // Distinct games still needing scores for this date (final_home IS NULL). Read the table FIRST
      // so an empty date (offseason, already scored) costs NO StatsAPI call. Many rows per game
      // (book × snapshot), so dedupe by odds_game_id; a generous limit covers a full slate's rows.
      const { data: rows, error: selErr } = await supabase
        .from("research_mlb_closing")
        .select("odds_game_id, home_team, away_team")
        .eq("game_date", target)
        .is("final_home", null)
        .limit(5000);
      if (selErr) throw new Error(`table read failed for ${target}: ${selErr.message}`);
      const games = new Map();
      for (const r of rows || []) if (!games.has(r.odds_game_id)) games.set(r.odds_game_id, { home: r.home_team, away: r.away_team });

      if (games.size === 0) {
        console.log(`[scores] date=${target} gamesInTable=0 skipped (no unscored rows)`);
      } else {
        // StatsAPI schedule for the date (free, no key). Keep only games in a FINAL state with scores.
        let schedule = [];
        try { schedule = await getScheduleForDate(target); }
        catch (e) { throw new Error(`schedule fetch failed for ${target}: ${e && e.message ? e.message : e}`); }
        const finalGames = (schedule || []).filter(
          (g) => g && g.status === "final" && g.homeScore != null && g.awayScore != null
        );
        // Lookup keyed by the UNORDERED normalized team pair, so odds/StatsAPI home-away orientation
        // differences still match; orientation is resolved per game when assigning scores.
        const byPair = new Map();
        for (const g of finalGames) {
          const hn = normTeam(g.home), an = normTeam(g.away);
          if (!hn || !an) continue;
          byPair.set([hn, an].sort().join("::"), {
            gamePk: g.id, home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore, hn,
          });
        }
        const candidates = finalGames.map((g) => `${g.away} @ ${g.home}`).join("; ");

        let matched = 0, unmatched = 0, updated = 0;
        for (const [oddsId, g] of games) {
          const ohn = normTeam(g.home), oan = normTeam(g.away);
          const m = ohn && oan ? byPair.get([ohn, oan].sort().join("::")) : null;
          if (!m) {
            unmatched++;
            // Never truncate the names — this line is the diagnostic for which normalization failed.
            console.log(`[scores] NOMATCH date=${target} odds="${g.away} @ ${g.home}" candidates="${candidates}"`);
            continue;
          }
          // Assign scores to the ODDS row's home/away, honoring orientation.
          const oddsHomeIsStatHome = ohn === m.hn;
          const finalHome = oddsHomeIsStatHome ? m.homeScore : m.awayScore;
          const finalAway = oddsHomeIsStatHome ? m.awayScore : m.homeScore;
          const { data: upd, error: updErr } = await supabase
            .from("research_mlb_closing")
            .update({ final_home: finalHome, final_away: finalAway, mlb_game_pk: Number(m.gamePk) })
            .eq("odds_game_id", oddsId)
            .eq("game_date", target)
            .select("id");
          if (updErr) throw new Error(`score update failed for ${target}: ${updErr.message}`);
          matched++;
          updated += Array.isArray(upd) ? upd.length : 0;
        }
        console.log(`[scores] date=${target} gamesInTable=${games.size} matched=${matched} unmatched=${unmatched} updated=${updated}`);
        totalMatched += matched; totalUnmatched += unmatched; totalUpdated += updated;
      }

      // Advance the cursor after THIS date (rows or none) BEFORE moving on — crash-safe.
      const { error: advErr } = await supabase
        .from("research_scores_state")
        .update({ last_processed_date: target, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (advErr) throw new Error(`scores cursor advance failed for ${target}: ${advErr.message}`);
      cursor = target;
      processed++;
    }

    return { processed, matched: totalMatched, unmatched: totalUnmatched, updated: totalUpdated, exitReason };
  } finally {
    _running = false;
  }
}

module.exports = { runScoreBatch };
