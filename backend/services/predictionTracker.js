// Prediction tracker — snapshots model predictions and grades them after games finish.
//
// recordPredictions(result)  → MLB: inserts one row per game+market+selection per day.
// recordNbaPropPredictions(proj, gameIso) → NBA: snapshots flagged prop edges pre-game.
// gradeFinishedGames()  → cron: grades pending MLB (team scores) and NBA (player gamelog).

const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate, getGameHRHitters, normPlayerName } = require("./mlbStatsApi");
const { fetchGamelog } = require("./nbaGamelog");
const { fetchScoreboard } = require("./nbaDataSource");
const { getMLBMainOdds } = require("./oddsApi");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ISO timestamp -> Eastern calendar date "YYYY-MM-DD" (dependency-free).
function etDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  catch { return null; }
}

// ── CLV (Closing Line Value) ────────────────────────────────────────────────
// The closing line is the price right before a game starts — the market's
// sharpest number. If our picks consistently got a BETTER price than the close,
// that's the strongest evidence of real edge (sharper than win rate, shows up
// fast). We capture the closing line in the final window BEFORE first pitch (the
// last pre-game price the market shows), then compute CLV against the price we
// recorded at pick time. We deliberately do NOT wait for the game to go live —
// reading after first pitch grabs an in-play price, not the close. Prices are
// compared raw (not de-vigged): since we compare our same side at both moments,
// the book's vig is present in both and largely cancels.

// American odds -> implied probability (same formula as oddsApi).
function americanToImpliedProb(a) {
  if (a == null) return null;
  if (a >= 100) return 100 / (a + 100);
  return Math.abs(a) / (Math.abs(a) + 100);
}

// Given a pending pick row + the matching odds event, return the closing price
// for the pick's side and the opposite side. Mirrors how recordPredictions read
// odds, so pick-time and closing prices are apples-to-apples.
function closingOddsForPick(pick, ev) {
  if (!ev) return null;
  if (pick.market === "moneyline") {
    const away = ev.h2h?.away, home = ev.h2h?.home;
    if (away == null || home == null) return null;
    return pick.selection === "away"
      ? { thisOdds: away, oppOdds: home }
      : { thisOdds: home, oppOdds: away };
  }
  if (pick.market === "total") {
    const over = ev.totals?.over, under = ev.totals?.under;
    if (over == null || under == null) return null;
    // Only meaningful if the closing line matches the line we bet.
    if (ev.totals?.line != null && pick.line != null && ev.totals.line !== pick.line) {
      // Line moved off our number — still record, CLV captures the price move.
    }
    return pick.selection === "over"
      ? { thisOdds: over, oppOdds: under }
      : { thisOdds: under, oppOdds: over };
  }
  return null; // props not tracked for CLV yet
}

// Capture closing lines for MLB ML/totals picks whose game is about to start
// (within the pre-game window, not yet underway) and that don't yet have a
// closing line. Reading just before first pitch gives the true closing price;
// reading after the game is live would capture a contaminated in-play line.
// One odds fetch total. If we miss a game's pre-game window, it simply gets no
// CLV — an honest gap is better than a fake closing line.
async function captureClosingLines() {
  const supabase = db();

  // Pending MLB ML/totals picks without a closing line yet.
  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("league", "mlb")
    .in("market", ["moneyline", "total"])
    .is("closing_odds", null)
    .eq("result", "pending");

  if (error) { console.error("[CLV] fetch error:", error.message); return 0; }
  if (!pending || pending.length === 0) { console.log("[CLV] no picks awaiting closing line"); return 0; }

  // Which games are in their pre-game closing window? A game qualifies when it
  // has NOT started yet (status "scheduled") and first pitch is within the next
  // ~35 minutes. The grading cron runs every 30 min, so a 35-min window
  // guarantees at least one tick lands just before first pitch — capturing the
  // genuine closing line. Games already live/final are intentionally excluded:
  // their book price now reflects in-play action, not the close.
  const dates = [...new Set(pending.map(p => p.game_date))];
  const CLOSING_WINDOW_MS = 35 * 60 * 1000;
  const now = Date.now();
  const closingWindowGameIds = new Set();
  const gameNames = {};
  for (const date of dates) {
    try {
      const schedule = await getScheduleForDate(date);
      for (const g of schedule) {
        gameNames[String(g.id)] = { away: g.away, home: g.home };
        if (g.status !== "scheduled" || !g.startTimeUTC) continue;
        const msToStart = new Date(g.startTimeUTC).getTime() - now;
        if (msToStart > 0 && msToStart <= CLOSING_WINDOW_MS) {
          closingWindowGameIds.add(String(g.id));
        }
      }
    } catch (e) { console.error(`[CLV] schedule ${date} failed:`, e.message); }
  }

  const toCapture = pending.filter(p => closingWindowGameIds.has(String(p.game_id)));
  if (toCapture.length === 0) { console.log("[CLV] no games in pre-game closing window"); return 0; }

  // One odds fetch for all of today's games (2 credits).
  let oddsEvents = [];
  try { oddsEvents = await getMLBMainOdds(); }
  catch (e) { console.error("[CLV] odds fetch failed:", e.message); return 0; }

  let captured = 0;
  for (const pick of toCapture) {
    const names = gameNames[String(pick.game_id)];
    const ev = matchPickToOddsEvent(names, oddsEvents);
    const closing = closingOddsForPick(pick, ev);
    if (!closing) continue;

    // CLV = how much our SIDE's price improved from pick time to close.
    // We compare the implied probability of our side's price at each moment.
    // (Comparing the same side at both moments means the book's vig is present
    // in both and largely cancels — so raw implied probs are fine and clean here.)
    // A closing implied prob HIGHER than our pick implied prob means the price
    // shortened in our favor after we bet → we beat the close → positive CLV.
    const pickImplied = americanToImpliedProb(pick.odds);
    const closeImplied = americanToImpliedProb(closing.thisOdds);
    const clv = (pickImplied != null && closeImplied != null)
      ? round4(closeImplied - pickImplied)
      : null;

    const { error: upErr } = await supabase
      .from("model_predictions")
      .update({
        closing_odds: closing.thisOdds,
        closing_opp_odds: closing.oppOdds,
        clv,
        beat_close: clv != null ? clv > 0 : null,
        closing_captured_at: new Date().toISOString(),
      })
      .eq("id", pick.id);
    if (!upErr) captured++;
  }

  console.log(`[CLV] captured closing lines for ${captured}/${toCapture.length} picks`);
  return captured;
}

// Match a game (by full team names from the schedule) to an odds event.
// Uses the same normalize-and-contains approach edges.js uses to match odds.
function normalizeTeamName(name) {
  if (!name) return "";
  return name.toLowerCase()
    .replace(/^(los angeles|new york|san francisco|san diego|st\.? louis|tampa bay|chicago|kansas city|washington|cleveland|cincinnati|colorado|arizona|atlanta|baltimore|boston|detroit|houston|miami|milwaukee|minnesota|oakland|philadelphia|pittsburgh|seattle|texas|toronto)\s+/i, "")
    .trim();
}
function matchPickToOddsEvent(names, oddsEvents) {
  if (!names) return null;
  const awayN = normalizeTeamName(names.away);
  const homeN = normalizeTeamName(names.home);
  for (const ev of oddsEvents) {
    const evAwayN = normalizeTeamName(ev.awayTeam);
    const evHomeN = normalizeTeamName(ev.homeTeam);
    if ((awayN === evAwayN && homeN === evHomeN) ||
        ((awayN.includes(evAwayN) || evAwayN.includes(awayN)) &&
         (homeN.includes(evHomeN) || evHomeN.includes(homeN)))) {
      return ev;
    }
  }
  return null;
}

function round4(n) { return Math.round(n * 10000) / 10000; }

// ── RECORD (MLB) ────────────────────────────────────────────────────────────────
// Snapshots every edge the model surfaced today. Only records games that are
// NOT yet final (we want pre-game predictions, not post-hoc).
async function recordPredictions(result) {
  if (!result || !Array.isArray(result.games)) return;
  const supabase = db();
  const gameDate = result.date || getEasternDate(0);
  const rows = [];

  // Build a quick lookup of game status by id (skip finals)
  const statusById = {};
  for (const g of result.games) statusById[g.id] = g.status;

  // Moneyline — record both sides when an edge exists
  for (const e of result.moneylineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "moneyline", selection: e.side,
      description: `${e.teamAbbr} ML`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: null,
    });
  }

  // Totals
  for (const e of result.totalsEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "total", selection: e.side,
      description: `${e.side === "over" ? "Over" : "Under"} ${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: e.line,
    });
  }

  // Run line (±1.5)
  for (const e of result.runLineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "run_line", selection: e.side,
      description: `${e.teamAbbr} ${e.line > 0 ? "+" : ""}${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: e.line,
    });
  }

  // HR props
  for (const e of result.hrPropEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.game, market: "hr_prop", selection: e.player,
      description: `${e.player} HR`,
      model_prob: e.hrProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: null,
    });
  }

  if (rows.length === 0) return;

  // Defensive: drop any row missing a game_id (shouldn't happen, but the DB
  // not-null constraint will reject the whole batch if even one is null).
  const validRows = rows.filter(r => r.game_id);
  const dropped = rows.length - validRows.length;
  if (dropped > 0) {
    console.warn(`[Tracker] Dropped ${dropped} rows missing game_id`);
  }
  if (validRows.length === 0) return;

  try {
    // upsert with ignoreDuplicates: the unique constraint (game_id, market,
    // selection, game_date) means re-runs during the day are no-ops.
    const { error } = await supabase
      .from("model_predictions")
      .upsert(validRows, {
        onConflict: "game_id,market,selection,game_date",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("[Tracker] record error:", error.message);
    } else {
      console.log(`[Tracker] Snapshotted ${validRows.length} predictions for ${gameDate} (dups ignored)`);
    }
  } catch (e) {
    console.error("[Tracker] record exception:", e.message);
  }
}

// ── RECORD (NBA player props) ───────────────────────────────────────────────────
// `proj` is the output of getNbaPropProjections. We record only FLAGGED edges
// (the model's actual picks) — suspects are deliberately excluded.
// selection encodes "athleteId:SIDE" so it's unique per player/stat/side AND
// carries the athlete id we need at grading time (no schema change needed).
async function recordNbaPropPredictions(proj, gameIso) {
  if (!proj || proj.available === false || !Array.isArray(proj.players)) return;
  const supabase = db();
  const gameDate = etDate(gameIso) || getEasternDate(0);
  const matchup = `${proj.away} @ ${proj.home}`;
  const rows = [];

  for (const pl of proj.players) {
    if (!pl.athleteId || !pl.markets) continue;
    for (const stat of ["points", "rebounds", "assists"]) {
      const mk = pl.markets[stat];
      if (!mk || !mk.flagged) continue; // picks only
      // Probability proxy: how often the recent window landed on our side.
      const overRate = typeof mk.overRate === "number" ? mk.overRate : 0.5;
      const prob = mk.side === "OVER" ? overRate : 1 - overRate;
      rows.push({
        game_id: String(proj.gameId), game_date: gameDate, league: "nba",
        matchup, market: `player_${stat}`,
        selection: `${pl.athleteId}:${mk.side}`,
        description: `${pl.name} ${stat} ${mk.side} ${mk.line}`,
        model_prob: prob, odds: -110, edge: mk.edge, confidence: prob, line: mk.line,
      });
    }
  }

  if (rows.length === 0) return;

  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, {
        onConflict: "game_id,market,selection,game_date",
        ignoreDuplicates: true,
      });
    if (error) console.error("[Tracker] nba record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} NBA prop picks for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] nba record exception:", e.message);
  }
}

// ── RECORD (NBA team markets: ML / spread / total) ──────────────────────────────
// Snapshots PRE-GAME NBA team-market edges so Quick Picks can use them. The NBA
// model emits its spread/total edges in POINTS (not probabilities), so here we
// convert all three markets to the same currency as everything else — a
// probability edge vs the de-vigged market (same method as the MLB run line):
//   margin/total -> cover/over probability via a normal model, de-vig the two
//   prices to a fair prob, then edge = model prob - fair prob.
// `predictions` is the array from generateNbaPredictions. Pre-game only.
const NBA_MARGIN_SD = 12; // matches the NBA model's margin SD
const NBA_TOTAL_SD = 15;  // NBA game totals swing more than margins (tunable)
function nbaNormalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function round3(n) { return n == null ? null : Math.round(n * 1000) / 1000; }
function amProb(a) { if (a == null || !isFinite(a)) return null; return a < 0 ? -a / (-a + 100) : 100 / (a + 100); }
function devig(thisOdds, otherOdds) {
  const a = amProb(thisOdds), b = amProb(otherOdds);
  if (a == null || b == null || a + b <= 0) return null;
  return a / (a + b);
}
function nbaConfidence(edge) {
  if (edge >= 0.05) return "HIGH";
  if (edge >= 0.025) return "MEDIUM";
  if (edge >= 0.005) return "LOW";
  return "LOW";
}
const NBA_W = 0.55; // match the NBA model's 55/45 blend

async function recordNbaTeamPredictions(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return;
  const supabase = db();
  const gameDate = getEasternDate(0);
  const rows = [];

  for (const p of predictions) {
    // Pre-game only, and only trustworthy data (the model flags suspect inputs).
    if (p.state !== "pre") continue;
    if (p.dataQuality && !(p.dataQuality === "ok" || p.dataQuality === "offense-only")) continue;
    const pr = p.predictions || {};
    const gid = String(p.gameId);

    // Moneyline (already a probability edge from the model)
    const ml = pr.moneyline;
    if (ml && ml.book && ml.book.home != null && ml.book.away != null && ml.fair) {
      const fairHome = devig(ml.book.home, ml.book.away);
      if (fairHome != null) {
        const blendHome = NBA_W * (ml.homeWinProb / 100) + (1 - NBA_W) * fairHome;
        const eHome = blendHome - fairHome;
        const eAway = (1 - blendHome) - (1 - fairHome);
        const home = eHome >= eAway;
        const edge = Math.max(eHome, eAway);
        if (edge > 0) rows.push({
          game_id: gid, game_date: gameDate, league: "nba", matchup: p.matchup,
          market: "moneyline", selection: home ? "home" : "away",
          description: `${home ? p.home : p.away} ML`,
          model_prob: round3(home ? blendHome : 1 - blendHome),
          odds: home ? ml.book.home : ml.book.away,
          edge: round3(edge), confidence: nbaConfidence(edge), line: null,
        });
      }
    }

    // Spread (convert projected margin -> cover probability)
    const sp = pr.spread;
    if (sp && sp.line != null && sp.book && sp.book.homePrice != null && sp.book.awayPrice != null && sp.projectedMargin != null) {
      const fairHome = devig(sp.book.homePrice, sp.book.awayPrice);
      if (fairHome != null) {
        const homeCover = nbaNormalCDF((sp.projectedMargin + sp.line) / NBA_MARGIN_SD);
        const blendHome = NBA_W * homeCover + (1 - NBA_W) * fairHome;
        const eHome = blendHome - fairHome;
        const eAway = (1 - blendHome) - (1 - fairHome);
        const home = eHome >= eAway;
        const edge = Math.max(eHome, eAway);
        const line = home ? sp.line : -sp.line;
        if (edge > 0) rows.push({
          game_id: gid, game_date: gameDate, league: "nba", matchup: p.matchup,
          market: "spread", selection: home ? "home" : "away",
          description: `${home ? p.home : p.away} ${line > 0 ? "+" : ""}${line}`,
          model_prob: round3(home ? blendHome : 1 - blendHome),
          odds: home ? sp.book.homePrice : sp.book.awayPrice,
          edge: round3(edge), confidence: nbaConfidence(edge), line,
        });
      }
    }

    // Total (convert projected total -> over probability)
    const tot = pr.total;
    if (tot && tot.line != null && tot.book && tot.book.over != null && tot.book.under != null && tot.projectedTotal != null) {
      const fairOver = devig(tot.book.over, tot.book.under);
      if (fairOver != null) {
        const overP = nbaNormalCDF((tot.projectedTotal - tot.line) / NBA_TOTAL_SD);
        const blendOver = NBA_W * overP + (1 - NBA_W) * fairOver;
        const eOver = blendOver - fairOver;
        const eUnder = (1 - blendOver) - (1 - fairOver);
        const over = eOver >= eUnder;
        const edge = Math.max(eOver, eUnder);
        if (edge > 0) rows.push({
          game_id: gid, game_date: gameDate, league: "nba", matchup: p.matchup,
          market: "total", selection: over ? "over" : "under",
          description: `${over ? "Over" : "Under"} ${tot.line}`,
          model_prob: round3(over ? blendOver : 1 - blendOver),
          odds: over ? tot.book.over : tot.book.under,
          edge: round3(edge), confidence: nbaConfidence(edge), line: tot.line,
        });
      }
    }
  }

  if (rows.length === 0) return;
  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) console.error("[Tracker] nba team record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} NBA team picks for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] nba team record exception:", e.message);
  }
}

// ── GRADE ─────────────────────────────────────────────────────────────────────
// Finds pending predictions for finished games and marks them. MLB is graded
// from team scores via the schedule; NBA props from each player's gamelog.
async function gradeFinishedGames() {
  const supabase = db();

  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("result", "pending");

  if (error) { console.error("[Tracker] grade fetch error:", error.message); return; }
  const pendingRows = pending || [];

  const nbaPending = pendingRows.filter(p => p.league === "nba");
  const mlbPending = pendingRows.filter(p => p.league !== "nba");

  // Backfill: HR props were previously stamped "push" (no-action) because grading
  // couldn't read per-player HRs. Now that it can, re-grade recent ones. They flip
  // to win/loss and leave this set, so after the first pass it self-empties.
  const backfillCutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data: hrPush } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("league", "mlb")
    .eq("market", "hr_prop")
    .eq("result", "push")
    .gte("game_date", backfillCutoff);
  if (hrPush && hrPush.length) {
    mlbPending.push(...hrPush);
    console.log(`[Tracker] Re-grading ${hrPush.length} previously no-actioned HR props`);
  }

  let graded = 0;
  graded += await gradeMlb(supabase, mlbPending);
  graded += await gradeNba(supabase, nbaPending);

  console.log(`[Tracker] Graded ${graded} predictions`);
  return graded;
}

// Resolve a pick's player name against the game's HR map. Exact normalized match
// first; then a UNIQUE last-name + first-initial fallback (handles "Jr."/accents)
// without risking same-last-name collisions. found:false => leave ungraded.
function resolveHR(hrMap, playerName) {
  const target = normPlayerName(playerName);
  if (!target) return { found: false, hr: null };
  if (hrMap.has(target)) return { found: true, hr: hrMap.get(target) };
  const parts = target.split(" ");
  if (parts.length >= 2) {
    const firstInitial = parts[0][0];
    const last = parts[parts.length - 1];
    const matches = [];
    for (const [name, hr] of hrMap.entries()) {
      const np = name.split(" ");
      if (np.length >= 2 && np[np.length - 1] === last && np[0][0] === firstInitial) matches.push(hr);
    }
    if (matches.length === 1) return { found: true, hr: matches[0] };
  }
  return { found: false, hr: null };
}

// MLB grading — moneyline/totals from the schedule score; HR props from the
// official boxscore (one fetch per game, cached for this run).
async function gradeMlb(supabase, pending) {
  if (!pending.length) return 0;

  const byDate = {};
  for (const p of pending) (byDate[p.game_date] ||= []).push(p);

  let graded = 0;
  const hrCache = new Map(); // game_id -> { ok, hr }

  for (const [date, preds] of Object.entries(byDate)) {
    let schedule;
    try { schedule = await getScheduleForDate(date); }
    catch (e) { console.error(`[Tracker] schedule fetch failed for ${date}:`, e.message); continue; }

    const gameById = {};
    for (const g of schedule) gameById[g.id] = g;

    for (const p of preds) {
      const g = gameById[p.game_id];
      if (!g || g.status !== "final") continue;
      if (g.awayScore == null || g.homeScore == null) continue;

      let outcome;
      if (p.market === "hr_prop") {
        // Box score holds per-player HRs. Fetch once per game, cache for this run.
        if (!hrCache.has(p.game_id)) {
          hrCache.set(p.game_id, await getGameHRHitters(p.game_id));
        }
        const box = hrCache.get(p.game_id);
        if (!box || !box.ok) continue;                 // couldn't read → leave pending, retry later
        const { found, hr } = resolveHR(box.hr, p.selection);
        if (!found) continue;                          // player not located → never false-loss
        outcome = { result: hr >= 1 ? "win" : "loss", actual: hr };
      } else {
        outcome = gradeOne(p, g);
      }
      if (!outcome) continue;

      const { error: upErr } = await supabase
        .from("model_predictions")
        .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) graded++;
    }
  }
  return graded;
}

// NBA prop grading — pull each player's gamelog once, read the stat for the game.
async function gradeNba(supabase, pending) {
  if (!pending.length) return 0;
  let graded = 0;

  const TEAM = new Set(["moneyline", "spread", "total"]);
  const teamRows = pending.filter(p => TEAM.has(p.market));
  const propRows = pending.filter(p => !TEAM.has(p.market));

  // ── Team markets: grade from final scores (ESPN scoreboard) ──────────────────
  if (teamRows.length) {
    const sbCache = {}; // date -> games (one scoreboard fetch per date per run)
    for (const p of teamRows) {
      let games = sbCache[p.game_date];
      if (!games) {
        try { games = await fetchScoreboard(p.game_date); sbCache[p.game_date] = games; }
        catch (e) { continue; } // try again next run
      }
      const g = (games || []).find(x => String(x.gameId) === String(p.game_id));
      if (!g || g.state !== "post") continue; // not final yet → stay pending
      const hs = g.home?.score, as = g.away?.score;
      if (hs == null || as == null) continue;

      const outcome = gradeNbaTeam(p, hs, as);
      if (!outcome) continue;
      const { error: upErr } = await supabase
        .from("model_predictions")
        .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) graded++;
    }
  }

  // ── Player props: grade from each player's gamelog (existing path) ───────────
  const logCache = {}; // athleteId -> parsed games (one fetch per athlete per run)
  for (const p of propRows) {
    const [athleteId, side] = String(p.selection || "").split(":");
    if (!athleteId || !side) continue;

    let games = logCache[athleteId];
    if (!games) {
      try { games = await fetchGamelog(athleteId); logCache[athleteId] = games; }
      catch (e) { continue; } // try again next run
    }

    const g = games.find(x => String(x.eventId) === String(p.game_id));
    if (!g || !(g.minutes > 0)) continue; // not played yet (or DNP) → stay pending

    const outcome = gradeNbaProp(p, g, side);
    if (!outcome) continue;

    const { error: upErr } = await supabase
      .from("model_predictions")
      .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!upErr) graded++;
  }
  return graded;
}

// Grades an NBA team-market pick (moneyline / spread / total) from final scores.
// Mirrors the MLB logic; half-point lines never push, whole-number lines can.
function gradeNbaTeam(p, homeScore, awayScore) {
  const margin = homeScore - awayScore; // + = home won
  const total = homeScore + awayScore;
  if (p.market === "moneyline") {
    if (margin === 0) return { result: "push", actual: margin };
    const homeWon = margin > 0;
    const win = p.selection === "home" ? homeWon : !homeWon;
    return { result: win ? "win" : "loss", actual: margin };
  }
  if (p.market === "spread") {
    if (p.line == null) return null;
    const sideMargin = p.selection === "home" ? margin : -margin;
    const cover = sideMargin + p.line; // line is that side's signed spread
    if (cover === 0) return { result: "push", actual: margin };
    return { result: cover > 0 ? "win" : "loss", actual: margin };
  }
  if (p.market === "total") {
    if (p.line == null) return null;
    if (total === p.line) return { result: "push", actual: total };
    const over = total > p.line;
    const win = p.selection === "over" ? over : !over;
    return { result: win ? "win" : "loss", actual: total };
  }
  return null;
}

// PURE: grade one NBA prop row against the player's finished game line.
function gradeNbaProp(p, game, side) {
  const stat = String(p.market || "").replace("player_", ""); // points|rebounds|assists
  const actual = game[stat];
  if (actual == null) return null;
  if (p.line == null) return null;
  if (actual === p.line) return { result: "push", actual };
  const won = side === "OVER" ? actual > p.line : actual < p.line;
  return { result: won ? "win" : "loss", actual };
}

// Decide win/loss/push for a single MLB prediction given the final game
function gradeOne(p, g) {
  const total = g.awayScore + g.homeScore;
  const awayWon = g.awayScore > g.homeScore;

  if (p.market === "moneyline") {
    const pickedAway = p.selection === "away";
    const won = pickedAway ? awayWon : !awayWon;
    return { result: won ? "win" : "loss", actual: awayWon ? 0 : 1 };
  }

  if (p.market === "total") {
    if (p.line == null) return null;
    if (total === p.line) return { result: "push", actual: total };
    const wentOver = total > p.line;
    const won = p.selection === "over" ? wentOver : !wentOver;
    return { result: won ? "win" : "loss", actual: total };
  }

  if (p.market === "run_line") {
    if (p.line == null) return null;
    const homeMargin = g.homeScore - g.awayScore;
    const sideMargin = p.selection === "home" ? homeMargin : -homeMargin;
    const covered = (sideMargin + p.line) > 0; // line is that side's ±1.5 (no push)
    return { result: covered ? "win" : "loss", actual: homeMargin };
  }

  if (p.market === "hr_prop") {
    return null; // graded separately in gradeMlb via the boxscore (needs per-player HRs)
  }

  return null;
}

module.exports = { recordPredictions, recordNbaPropPredictions, recordNbaTeamPredictions, gradeFinishedGames, gradeNbaProp, captureClosingLines };
