// Automatic settlement for structured WizePlays. Game bets use the existing
// ESPN scoreboard bridge; NFL and MLB props use the same official box-score
// sources as their active model trackers. Only result fields are enriched.

const { createClient } = require("@supabase/supabase-js");
const { getFinalScoreByMatchup } = require("./liveScores");
const { extractBoxscorePlayerStats, fetchFinals, fetchSummary } = require("./nflPropsActuals");
const { matchGame } = require("./nflPropsGrader");
const { gradeCustomerPick } = require("./nflPropsTracker");
const {
  getGameStatusAndScore,
  getGameHRHitters,
  getGamePitcherStrikeouts,
  getGameBatterHits,
  normPlayerName,
} = require("./mlbStatsApi");
const { payout } = require("./priceMath");

const GAME_LEAGUES = new Set(["mlb", "nba", "nfl", "ncaafb", "cfb"]);
const NFL_PROP_CATEGORIES = new Set(["pass_yds", "pass_tds", "rush_yds", "rec_yds", "receptions", "anytime_td"]);
const MLB_PROP_CATEGORIES = new Set(["home_run", "pitcher_strikeouts", "hits"]);

function supa() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function isPending(result) {
  const value = String(result == null ? "" : result).trim().toLowerCase();
  return value === "" || value === "pending";
}

function sinceDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function eventDate(pick, rowDate) {
  return String(pick?.gameDate || rowDate || "").slice(0, 10);
}

function scoreboardLeague(sport) {
  return String(sport || "").toLowerCase() === "ncaafb" ? "cfb" : String(sport || "").toLowerCase();
}

function settle(pick, scores) {
  const market = String(pick.market || "moneyline").toLowerCase();
  const selection = String(pick.selection || "").toLowerCase();
  const { away, home } = scores;
  if (market === "moneyline") {
    if (away === home) return "push";
    if (selection === "away") return away > home ? "win" : "loss";
    if (selection === "home") return home > away ? "win" : "loss";
    return null;
  }
  if (market === "spread" || market === "run_line") {
    const line = Number(pick.line);
    if (!Number.isFinite(line) || !["away", "home"].includes(selection)) return null;
    const margin = selection === "away" ? away - home : home - away;
    const graded = margin + line;
    return graded === 0 ? "push" : graded > 0 ? "win" : "loss";
  }
  if (market === "total") {
    const line = Number(pick.line);
    if (!Number.isFinite(line)) return null;
    const total = away + home;
    if (total === line) return "push";
    if (selection === "over") return total > line ? "win" : "loss";
    if (selection === "under") return total < line ? "win" : "loss";
  }
  return null;
}

function pnlFor(result, odds, units = 1) {
  const risk = Number.isFinite(Number(units)) && Number(units) > 0 ? Number(units) : 1;
  if (result === "loss") return -risk;
  if (result === "push" || result === "void") return 0;
  if (result !== "win") return null;
  const profit = payout(Number(odds));
  return Number.isFinite(profit) ? Math.round(profit * risk * 1e6) / 1e6 : null;
}

function propCategorySupported(pick) {
  const sport = String(pick?.sport || "").toLowerCase();
  const category = String(pick?.propCategory || "").toLowerCase();
  return sport === "nfl" ? NFL_PROP_CATEGORIES.has(category)
    : sport === "mlb" ? MLB_PROP_CATEGORIES.has(category)
      : false;
}

function isPropPick(pick) {
  return pick?.kind === "prop";
}

function isGradeable(pick) {
  if (!pick || pick.type !== "straight" || !pick.gameId || !isPending(pick.result)) return false;
  if (isPropPick(pick)) {
    return Boolean(pick.playerId && pick.playerName && pick.selection && propCategorySupported(pick));
  }
  return GAME_LEAGUES.has(String(pick.sport || "").toLowerCase()) && Boolean(pick.market && pick.selection);
}

function skipReason(pick) {
  if (!pick || typeof pick !== "object") return "malformed pick entry";
  if (!isPending(pick.result) || isGradeable(pick)) return null;
  if (pick.type !== "straight") return `type is "${pick.type || "(none)"}"`;
  if (!pick.gameId) return "missing structured game identity";
  if (isPropPick(pick)) {
    if (!pick.playerId || !pick.playerName) return "missing exact player identity";
    if (!propCategorySupported(pick)) return `prop category "${pick.propCategory || "(none)"}" has no automatic official-stat grader`;
    if (!pick.selection) return "missing prop side/outcome";
  }
  const sport = String(pick.sport || "").toLowerCase();
  if (!GAME_LEAGUES.has(sport)) return `sport "${pick.sport || "(none)"}" is not automatically gradeable`;
  if (!pick.market) return "missing market";
  if (!pick.selection) return "missing selection";
  return "not gradeable";
}

function gradeMlbPropActual(pick, box) {
  if (!box?.ok) return null;
  const player = normPlayerName(pick.playerName);
  const side = String(pick.selection || "").toLowerCase();
  let actual = null;
  if (pick.propCategory === "home_run") actual = box.hr?.get(player);
  else if (pick.propCategory === "pitcher_strikeouts") actual = box.ks?.get(player);
  else if (pick.propCategory === "hits") actual = box.hits?.get(player);
  if (actual == null) return { result: "void", finalStat: null, resultSource: "mlb-official-boxscore" };
  if (pick.propCategory === "home_run") {
    return { result: actual >= 1 ? "win" : "loss", finalStat: actual, resultSource: "mlb-official-boxscore" };
  }
  const line = Number(pick.line);
  if (!Number.isFinite(line) || !["over", "under"].includes(side)) return null;
  if (actual === line) return { result: "push", finalStat: actual, resultSource: "mlb-official-boxscore" };
  const won = side === "over" ? actual > line : actual < line;
  return { result: won ? "win" : "loss", finalStat: actual, resultSource: "mlb-official-boxscore" };
}

async function gradeExpertPicks({ dryRun = true, days = 14, client = supa() } = {}) {
  const since = sinceDate(days);
  const { data: rows, error } = await client.from("expert_picks").select("date, picks").gte("date", since).order("date", { ascending: false });
  if (error) throw new Error("load expert_picks: " + error.message);

  const decisions = [];
  const nflBoards = new Map();
  const nflBoxes = new Map();
  const mlbStatus = new Map();
  const mlbBoxes = new Map();
  let checked = 0, graded = 0, rowsChanged = 0, rowsWritten = 0;

  const nflBoard = async (date) => {
    if (!nflBoards.has(date)) {
      try { nflBoards.set(date, await fetchFinals(date.replace(/-/g, ""))); }
      catch (_) { nflBoards.set(date, null); }
    }
    return nflBoards.get(date);
  };
  const nflBox = async (eventId) => {
    if (!nflBoxes.has(eventId)) {
      try { nflBoxes.set(eventId, extractBoxscorePlayerStats(await fetchSummary(eventId))); }
      catch (_) { nflBoxes.set(eventId, null); }
    }
    return nflBoxes.get(eventId);
  };
  const mlbBox = async (pick) => {
    const id = String(pick.gameId);
    const key = `${id}:${pick.propCategory}`;
    if (!mlbBoxes.has(key)) {
      let value;
      if (pick.propCategory === "home_run") value = await getGameHRHitters(id);
      else if (pick.propCategory === "pitcher_strikeouts") value = await getGamePitcherStrikeouts(id);
      else value = await getGameBatterHits(id);
      mlbBoxes.set(key, value);
    }
    return mlbBoxes.get(key);
  };

  for (const row of rows || []) {
    let picks;
    try { picks = JSON.parse(row.picks || "[]"); } catch (_) { continue; }
    if (!Array.isArray(picks)) continue;
    let changed = false;

    for (const pick of picks) {
      if (!isGradeable(pick)) {
        const reason = skipReason(pick);
        if (reason) decisions.push({ date: row.date, pick: pick?.pick, status: "skipped", reason });
        continue;
      }
      checked++;
      let outcome = null;
      const date = eventDate(pick, row.date);
      try {
        if (isPropPick(pick) && String(pick.sport).toLowerCase() === "nfl") {
          const board = await nflBoard(date);
          const game = matchGame(pick.game, board || []);
          if (!game || !game.final) {
            decisions.push({ date, pick: pick.pick, status: "not-final-yet" });
            continue;
          }
          const actuals = await nflBox(game.eventId);
          if (!actuals) continue;
          const gradedProp = gradeCustomerPick({
            player_id: pick.playerId,
            category: pick.propCategory,
            side: pick.selection,
            line: pick.line,
            odds: pick.odds,
          }, actuals);
          outcome = {
            result: String(gradedProp.result).toLowerCase(),
            finalStat: gradedProp.final_stat,
            resultSource: "espn-game-summary",
          };
        } else if (isPropPick(pick) && String(pick.sport).toLowerCase() === "mlb") {
          const id = String(pick.gameId);
          if (!mlbStatus.has(id)) mlbStatus.set(id, await getGameStatusAndScore(id));
          const status = mlbStatus.get(id);
          if (!status?.ok || status.abstractGameState !== "Final") {
            decisions.push({ date, pick: pick.pick, status: "not-final-yet" });
            continue;
          }
          outcome = gradeMlbPropActual(pick, await mlbBox(pick));
        } else {
          const scores = await getFinalScoreByMatchup(
            scoreboardLeague(pick.sport), date, pick.awayAbbr || pick.away || "", pick.homeAbbr || pick.home || ""
          );
          if (!scores) {
            decisions.push({ date, pick: pick.pick, status: "not-final-yet" });
            continue;
          }
          const result = settle(pick, scores);
          if (result) outcome = { result, finalStat: `${scores.away}-${scores.home}`, resultSource: "espn-scoreboard" };
        }
      } catch (gradeError) {
        decisions.push({ date, pick: pick.pick, status: "lookup-failed", error: gradeError.message });
        continue;
      }
      if (!outcome?.result) {
        decisions.push({ date, pick: pick.pick, status: "could-not-settle" });
        continue;
      }
      const unitPnl = pnlFor(outcome.result, pick.odds, pick.units);
      decisions.push({ date, pick: pick.pick, result: outcome.result, finalStat: outcome.finalStat, unitPnl, status: dryRun ? "WOULD-SET" : "SET" });
      graded++;
      if (!dryRun) {
        pick.result = outcome.result;
        pick.finalStat = outcome.finalStat;
        pick.unitPnl = unitPnl;
        pick.resultSource = outcome.resultSource;
        pick.gradedAt = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) {
      rowsChanged++;
      const { error: updateError } = await client.from("expert_picks").update({ picks: JSON.stringify(picks) }).eq("date", row.date);
      if (updateError) decisions.push({ date: row.date, status: "write-failed", error: updateError.message });
      else rowsWritten++;
    }
  }

  const note = dryRun
    ? `DRY RUN — nothing written. Found ${graded} pending pick(s) on finished games that WOULD be graded.`
    : `Wrote ${graded} graded result(s) across ${rowsWritten} day(s).`;
  return { dryRun, since, checked, graded, rowsChanged, rowsWritten, note, decisions };
}

module.exports = {
  gradeExpertPicks,
  _test: {
    GAME_LEAGUES,
    NFL_PROP_CATEGORIES,
    MLB_PROP_CATEGORIES,
    eventDate,
    gradeMlbPropActual,
    isGradeable,
    isPending,
    pnlFor,
    scoreboardLeague,
    settle,
    skipReason,
  },
};
