// services/expertPicksGrader.js — auto-grade Expert Picks STRAIGHT BETS that were
// entered with the structured fields (gameId + market + selection) added in the
// admin "AUTO-GRADE" block. Reads final scores from the SAME scores feed the
// admin game-picker used (liveScores / ESPN, looked up by the stored ESPN event
// id), settles win/loss/push, and writes `result` back into the pick JSON of the
// expert_picks row. Parlays and free-text (un-linked) picks are left untouched.
//
// SAFETY (this is why it's safe to run repeatedly or trigger manually):
//   - only ever touches a STRAIGHT bet that is MLB or NBA,
//   - that has a gameId + market + selection,
//   - that currently has NO result (still pending), and
//   - whose game is FINAL.
//   It never changes a pick that's already graded, and a finished game's result
//   never changes — so the grader is idempotent. The worst a stray run can do is
//   settle a pending pick of a finished game to its true result (which is the goal).

const { createClient } = require("@supabase/supabase-js");
const { getGameDetail, getFinalScoreByMatchup } = require("./liveScores");

const GRADEABLE_LEAGUES = new Set(["mlb", "nba"]);

function supa() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// A pick counts as "pending" (ungraded) if its result is empty/null/"pending".
function isPending(result) {
  const r = String(result == null ? "" : result).trim().toLowerCase();
  return r === "" || r === "pending";
}

// YYYY-MM-DD for N days ago — a lower bound so we only scan recent rows.
function sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Pull the two final scores out of a getGameDetail() result.
// Returns { away, home } numbers, or null if the game isn't final / no score yet.
function finalScores(detail) {
  if (!detail || detail.bucket !== "final") return null;
  const ls = detail.lineScore || [];
  const away = ls.find((c) => c.homeAway === "away");
  const home = ls.find((c) => c.homeAway === "home");
  if (!away || !home || away.total == null || home.total == null) return null;
  return { away: Number(away.total), home: Number(home.total) };
}

// Decide win/loss/push for one structured straight bet given final scores.
// Returns "win" | "loss" | "push" | null (null = can't grade this one).
function settle(pick, scores) {
  const market = String(pick.market || "moneyline").toLowerCase();
  const sel = String(pick.selection || "").toLowerCase();
  const { away, home } = scores;

  if (market === "moneyline") {
    if (away === home) return "push"; // ties don't happen in MLB/NBA; be safe
    const awayWon = away > home;
    if (sel === "away") return awayWon ? "win" : "loss";
    if (sel === "home") return awayWon ? "loss" : "win";
    return null;
  }

  if (market === "total") {
    const line = Number(pick.line);
    if (!Number.isFinite(line)) return null; // total with no line — can't grade
    const combined = away + home;
    if (combined === line) return "push";
    const wentOver = combined > line;
    if (sel === "over") return wentOver ? "win" : "loss";
    if (sel === "under") return wentOver ? "loss" : "win";
    return null;
  }

  return null; // unknown market (e.g. spread) — leave for manual grading
}

// Is this a structured, gradeable, still-pending straight bet?
function isGradeable(pick) {
  return !!(
    pick &&
    pick.type === "straight" &&
    GRADEABLE_LEAGUES.has(String(pick.sport || "").toLowerCase()) &&
    pick.gameId &&
    pick.market &&
    pick.selection &&
    isPending(pick.result)
  );
}

// Main entry. { dryRun: true } (default) reads + reports but writes NOTHING.
// { dryRun: false } writes settled results back into expert_picks.
async function gradeExpertPicks({ dryRun = true, days = 14 } = {}) {
  const supabase = supa();
  const since = sinceDate(days);

  const { data: rows, error } = await supabase
    .from("expert_picks")
    .select("date, picks")
    .gte("date", since)
    .order("date", { ascending: false });
  if (error) throw new Error("load expert_picks: " + error.message);

  const decisions = [];
  let checked = 0, graded = 0, rowsChanged = 0, rowsWritten = 0;

  for (const row of rows || []) {
    let picks;
    try { picks = JSON.parse(row.picks || "[]"); } catch (_) { continue; }
    if (!Array.isArray(picks)) continue;

    let changed = false;

    for (const pick of picks) {
      if (!isGradeable(pick)) continue;
      checked++;

      // The stored gameId is the Odds-API edges id, which ESPN's id-keyed lookup
      // can't resolve — so bridge to the final by the pick's date + team matchup
      // (stable across feeds). Falls back through abbr → full-name as available.
      let scores;
      try {
        scores = await getFinalScoreByMatchup(
          String(pick.sport).toLowerCase(),
          row.date,
          pick.awayAbbr || pick.away || "",
          pick.homeAbbr || pick.home || ""
        );
      } catch (e) {
        decisions.push({ date: row.date, pick: pick.pick, status: "lookup-failed", error: e.message });
        continue;
      }

      if (!scores) {
        decisions.push({ date: row.date, pick: pick.pick, status: "not-final-yet" });
        continue;
      }

      const result = settle(pick, scores);
      if (!result) {
        decisions.push({ date: row.date, pick: pick.pick, status: "could-not-settle", score: `${scores.away}-${scores.home}` });
        continue;
      }

      decisions.push({
        date: row.date,
        pick: pick.pick,
        game: pick.game,
        market: pick.market,
        selection: pick.selection,
        line: pick.line != null ? pick.line : null,
        finalScore: `away ${scores.away} – home ${scores.home}`,
        result,
        status: dryRun ? "WOULD-SET" : "SET",
      });
      graded++;
      if (!dryRun) pick.result = result;
      changed = true;
    }

    if (changed) {
      rowsChanged++;
      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("expert_picks")
          .update({ picks: JSON.stringify(picks) })
          .eq("date", row.date);
        if (upErr) decisions.push({ date: row.date, status: "write-failed", error: upErr.message });
        else rowsWritten++;
      }
    }
  }

  const note = dryRun
    ? `DRY RUN — nothing written. Found ${graded} pending pick(s) on finished games that WOULD be graded.`
    : `Wrote ${graded} graded result(s) across ${rowsWritten} day(s).`;

  return { dryRun, since, checked, graded, rowsChanged, rowsWritten, note, decisions };
}

module.exports = { gradeExpertPicks };
