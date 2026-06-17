// Prediction tracker — snapshots model predictions and grades them after games finish.
//
// recordPredictions(result)  → MLB: inserts one row per game+market+selection per day.
// recordNbaPropPredictions(proj, gameIso) → NBA: snapshots flagged prop edges pre-game.
// gradeFinishedGames()  → cron: grades pending MLB (team scores) and NBA (player gamelog).

const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate, getGameHRHitters, getGamePitcherStrikeouts, getGameBatterHits, getGameBatterTotalBases, getLinescore, getGameStatusAndScore, normPlayerName } = require("./mlbStatsApi");
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

// Shift a 'YYYY-MM-DD' date by N days. Anchored at noon UTC so no DST/tz edge
// can roll the day. Used to look an NBA game up across its neighboring ESPN
// filing dates (ESPN can file a game under a date ±1 from the one we stored).
function shiftYmd(dateStr, deltaDays) {
  if (!dateStr) return dateStr;
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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
  if (pick.market === "run_line") {
    // Run line closing price comes from the spreads market (±1.5). Same side mapping
    // as moneyline; the ±1.5 line is captured at pick time and rarely moves off 1.5.
    const away = ev.spreads?.away, home = ev.spreads?.home;
    if (away == null || home == null) return null;
    return pick.selection === "away"
      ? { thisOdds: away, oppOdds: home }
      : { thisOdds: home, oppOdds: away };
  }
  return null; // props not tracked for CLV yet
}

// NBA closing price for a pick's side, from the matchOdds/extractLines shape
// ({ home:{ml,spread}, away:{ml,spread}, total:{overPrice,underPrice} }). NBA has
// a spread market the MLB helper above doesn't handle.
function nbaClosingOddsForPick(pick, lines) {
  if (!lines) return null;
  if (pick.market === "moneyline") {
    const thisOdds = pick.selection === "home" ? lines.home?.ml : lines.away?.ml;
    const oppOdds = pick.selection === "home" ? lines.away?.ml : lines.home?.ml;
    if (thisOdds == null || oppOdds == null) return null;
    return { thisOdds, oppOdds };
  }
  if (pick.market === "spread") {
    const thisSp = pick.selection === "home" ? lines.home?.spread : lines.away?.spread;
    const oppSp = pick.selection === "home" ? lines.away?.spread : lines.home?.spread;
    if (!thisSp || !oppSp || thisSp.price == null || oppSp.price == null) return null;
    return { thisOdds: thisSp.price, oppOdds: oppSp.price };
  }
  if (pick.market === "total") {
    if (!lines.total) return null;
    const thisOdds = pick.selection === "over" ? lines.total.overPrice : lines.total.underPrice;
    const oppOdds = pick.selection === "over" ? lines.total.underPrice : lines.total.overPrice;
    if (thisOdds == null || oppOdds == null) return null;
    return { thisOdds, oppOdds };
  }
  return null;
}

// Capture closing lines for MLB ML/totals picks whose game is about to start.
// RATCHET design: on every cron tick within the pre-game window we re-read the
// price and OVERWRITE the stored closing line when it changed, so the LAST
// pre-game price before first pitch wins. We re-attempt every tick (no
// "already has a line" filter) over a 90-min window (~3 ticks/game), so a single
// missed/failed tick self-heals on the next one — this is the fix for the ~50%
// capture coverage the old single-shot 35-min design produced. Reading after the
// game is live would capture a contaminated in-play price, so the status gate
// below still excludes live/final; once first pitch passes the last pre-game
// value is frozen.
async function captureClosingLines() {
  const supabase = db();

  // Pending MLB ML/totals/run-line picks (re-checked every tick — NO closing-line
  // filter, so we can ratchet toward the true close as the line moves).
  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("league", "mlb")
    .in("market", ["moneyline", "total", "run_line"])
    .eq("result", "pending");

  if (error) { console.error("[CLV] fetch error:", error.message); return 0; }
  if (!pending || pending.length === 0) { console.log("[CLV] no picks awaiting closing line"); return 0; }

  // A game qualifies whenever it is still pre-game ("scheduled") and first pitch
  // is within the next ~90 minutes. The status gate excludes live/final (their
  // book price reflects in-play action, not the close). The 90-min window means
  // ~3 cron ticks land per game, and because we overwrite on each tick (below),
  // the last pre-game price wins and a missed tick is recovered next tick.
  const dates = [...new Set(pending.map(p => p.game_date))];
  const CLOSING_WINDOW_MS = 120 * 60 * 1000;
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

  // One FRESH odds fetch (bypass the 30-min cache) so the captured price is the
  // true current line, not an up-to-30-min-stale cached one. ~3 credits, and only
  // when games are actually in the closing window (we returned above otherwise).
  let oddsEvents = [];
  try { oddsEvents = await getMLBMainOdds({ forceFresh: true }); }
  catch (e) { console.error("[CLV] odds fetch failed:", e.message); return 0; }

  let captured = 0;
  // Miss instrumentation: when coverage is < 100%, these counters name the cause
  // (in Railway logs) instead of leaving us to guess — noOddsEvent = pick's game
  // didn't match an odds event; noClosingPrice = matched but no usable price.
  const miss = { noOddsEvent: 0, noClosingPrice: 0, byMarket: {} };
  const tallyMiss = (kind, market) => {
    miss[kind]++;
    miss.byMarket[market] = (miss.byMarket[market] || 0) + 1;
  };
  for (const pick of toCapture) {
    const names = gameNames[String(pick.game_id)];
    const ev = matchPickToOddsEvent(names, oddsEvents);
    if (!ev) { tallyMiss("noOddsEvent", pick.market); continue; }
    const closing = closingOddsForPick(pick, ev);
    if (!closing) { tallyMiss("noClosingPrice", pick.market); continue; }

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

    // RATCHET: skip the write if the price is unchanged from what we already
    // stored — keeps the last pre-game price as the close without churning rows.
    if (pick.closing_odds != null && pick.closing_odds === closing.thisOdds) continue;

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

  console.log(`[CLV] captured closing lines for ${captured}/${toCapture.length} picks`
    + ` | misses: noOddsEvent=${miss.noOddsEvent} noClosingPrice=${miss.noClosingPrice} byMarket=${JSON.stringify(miss.byMarket)}`);
  return captured;
}

// NBA counterpart to captureClosingLines. Same idea — grab the closing price in
// the ~35-min pre-tip window and compute CLV — but NBA has its own schedule
// source (ESPN scoreboard), its own odds fetch (fetchNbaOdds), and a spread
// market. Kept separate so the MLB path is untouched.
async function captureNbaClosingLines() {
  const supabase = db();
  const { fetchNbaOdds, matchOdds } = require("./nbaService");

  const { data: pending, error } = await supabase
    .from("model_predictions")
    .select("*")
    .eq("league", "nba")
    .in("market", ["moneyline", "spread", "total"])
    .eq("result", "pending");

  if (error) { console.error("[CLV][NBA] fetch error:", error.message); return 0; }
  if (!pending || pending.length === 0) { console.log("[CLV][NBA] no picks awaiting closing line"); return 0; }

  // ESPN can file a game under a neighboring date, and a pre-game pick's stored
  // date may drift by a day; games are keyed by unique id below, so widening the
  // fetch window to ±1 only ever helps us find the right game.
  const baseDates = [...new Set(pending.map(p => p.game_date))];
  const dates = [...new Set(baseDates.flatMap(d => [shiftYmd(d, -1), d, shiftYmd(d, 1)]))];
  const CLOSING_WINDOW_MS = 90 * 60 * 1000; // ratchet window: ~3 ticks/tip, last pre-game price wins
  const now = Date.now();
  const gamesById = {};
  const closingWindowGameIds = new Set();
  for (const date of dates) {
    try {
      const board = await fetchScoreboard(date);
      const games = Array.isArray(board) ? board : (board && board.games) || [];
      for (const g of games) {
        gamesById[String(g.gameId)] = { home: g.home, away: g.away, date: g.date };
        if (g.state !== "pre" || !g.date) continue;
        const msToStart = new Date(g.date).getTime() - now;
        if (msToStart > 0 && msToStart <= CLOSING_WINDOW_MS) {
          closingWindowGameIds.add(String(g.gameId));
        }
      }
    } catch (e) { console.error(`[CLV][NBA] scoreboard ${date} failed:`, e.message); }
  }

  const toCapture = pending.filter(p => closingWindowGameIds.has(String(p.game_id)));
  if (toCapture.length === 0) { console.log("[CLV][NBA] no games in pre-game closing window"); return 0; }

  let oddsEvents = [];
  try { oddsEvents = await fetchNbaOdds(); }
  catch (e) { console.error("[CLV][NBA] odds fetch failed:", e.message); return 0; }
  if (!oddsEvents || oddsEvents.length === 0) { console.log("[CLV][NBA] no odds events available"); return 0; }

  let captured = 0;
  for (const pick of toCapture) {
    const g = gamesById[String(pick.game_id)];
    if (!g || !g.home || !g.away) continue;
    const lines = matchOdds({ home: g.home, away: g.away, date: g.date }, oddsEvents);
    const closing = nbaClosingOddsForPick(pick, lines);
    if (!closing) continue;

    const pickImplied = americanToImpliedProb(pick.odds);
    const closeImplied = americanToImpliedProb(closing.thisOdds);
    const clv = (pickImplied != null && closeImplied != null)
      ? round4(closeImplied - pickImplied)
      : null;

    // RATCHET: only overwrite when the price changed (last pre-game price wins).
    if (pick.closing_odds != null && pick.closing_odds === closing.thisOdds) continue;

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

  console.log(`[CLV][NBA] captured closing lines for ${captured}/${toCapture.length} picks`);
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
  const fatigueById = {};
  const shadowById = {};
  for (const g of result.games) {
    statusById[g.id] = g.status;
    const b = g.totals && g.totals.breakdown;
    if (b && b.fatigueAdj != null) {
      const a = (b.awayBullpenFatigue && b.awayBullpenFatigue.level) || "?";
      const h = (b.homeBullpenFatigue && b.homeBullpenFatigue.level) || "?";
      fatigueById[g.id] = `away=${a},home=${h},adj=${b.fatigueAdj}`;
    }
    if (g.totals && g.totals.shadow != null) shadowById[g.id] = g.totals.shadow;
  }

  // Moneyline — record ONLY the side the model likes (positive edge). The two
  // sides are mirror images, so recording the negative side logs a pick we'd
  // never make and dilutes the record toward 50% / -vig.
  for (const e of result.moneylineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (e.edge == null || e.edge <= 0) continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "moneyline", selection: e.side,
      description: `${e.teamAbbr} ML`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: null,
    });
  }

  // Totals — positive-edge side only (the over/under sides mirror each other).
  for (const e of result.totalsEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (e.edge == null || e.edge <= 0) continue;
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "total", selection: e.side,
      description: `${e.side === "over" ? "Over" : "Under"} ${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: e.line,
      bullpen_fatigue: fatigueById[e.gameId] || null,
      shadow_total: shadowById[e.gameId] ?? null,
    });
  }

  // Run line (±1.5) — positive-edge side only (the two sides mirror each other).
  for (const e of result.runLineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (e.edge == null || e.edge <= 0) continue;
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

  // Strikeout props (two-sided; selection encodes the side so grading knows it)
  for (const e of result.kPropEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    const side = (e.side || "over").toUpperCase();
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.game, market: "player_strikeouts",
      selection: `${e.player}:${side}`,
      description: `${e.player} ${side === "OVER" ? "Over" : "Under"} ${e.line} K`,
      model_prob: e.kProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: e.line,
    });
  }

  // Hits props (two-sided; selection encodes the side)
  for (const e of result.hitsPropEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    const side = (e.side || "over").toUpperCase();
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.game, market: "player_hits",
      selection: `${e.player}:${side}`,
      description: `${e.player} ${side === "OVER" ? "Over" : "Under"} ${e.line} H`,
      model_prob: e.hitsProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, line: e.line,
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

// ── RECORD (Total Bases SHADOW) ─────────────────────────────────────────────────
// Persists shadow TB projections so they accumulate per slate and can be graded
// later. Log-only model: these rows never price a pick anywhere. selection is
// "{playerId}:OVER" so it's unique per player and carries the id for grading.
// Idempotent via the (game_id, market, selection, game_date) unique constraint —
// safe to call repeatedly for the same slate.
async function recordTotalBasesShadow(tbShadow, gameIso) {
  if (!Array.isArray(tbShadow) || tbShadow.length === 0) return;
  const supabase = db();
  // gameIso is already an ET "YYYY-MM-DD" slate date (same value recordPredictions uses raw).
  // Do NOT re-run it through etDate(): a bare date string parses as UTC midnight, which rolls
  // back a day in Eastern, stamping rows on the wrong date so the grader (which groups by date
  // and fetches that date's schedule) never matches the game_id and leaves every row pending. (fixed 2026-06-16)
  const gameDate = gameIso || getEasternDate(0);
  const rows = [];
  for (const p of tbShadow) {
    if (!p.playerId || p.line == null || p.overProb == null) continue;
    rows.push({
      game_id: String(p.gameId), game_date: gameDate, league: "mlb",
      matchup: p.game, market: "player_total_bases_shadow",
      selection: `${p.player}:OVER`,
      description: `${p.player} total_bases OVER ${p.line} (expTB ${p.expTB})`,
      model_prob: p.overProb, odds: -110,
      edge: p.edgeOverShadow ?? null, confidence: p.overProb, line: p.line,
    });
  }
  if (rows.length === 0) return;
  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) console.error("[Tracker] TB-shadow record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} TB-shadow projections for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] TB-shadow record exception:", e.message);
  }
}
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
  const rows = [];

  for (const p of predictions) {
    // Pre-game only, and only trustworthy data (the model flags suspect inputs).
    if (p.state !== "pre") continue;
    if (p.dataQuality && !(p.dataQuality === "ok" || p.dataQuality === "offense-only")) continue;
    const pr = p.predictions || {};
    const gid = String(p.gameId);
    // Date the pick by the GAME's own start time (Eastern), not the wall-clock when
    // this cron ran — mirrors the prop path (recordNbaPropPredictions). Stamping the
    // record-time date was the root cause of stranded NBA picks: a game's row could
    // land on the wrong day (here, days before tip), and grading + CLV — which look
    // the game up by date — never found it. Falls back to today only if the game
    // carries no start time.
    const gameDate = etDate(p.date) || getEasternDate(0);

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
    else console.log(`[Tracker] Snapshotted ${rows.length} NBA team picks for ${[...new Set(rows.map(r => r.game_date))].join(", ")} (dups ignored)`);
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

// Same matching as resolveHR but for the pitcher-strikeouts map (value = K count).
function resolveK(kMap, playerName) {
  const target = normPlayerName(playerName);
  if (!target) return { found: false, k: null };
  if (kMap.has(target)) return { found: true, k: kMap.get(target) };
  const parts = target.split(" ");
  if (parts.length >= 2) {
    const firstInitial = parts[0][0];
    const last = parts[parts.length - 1];
    const matches = [];
    for (const [name, k] of kMap.entries()) {
      const np = name.split(" ");
      if (np.length >= 2 && np[np.length - 1] === last && np[0][0] === firstInitial) matches.push(k);
    }
    if (matches.length === 1) return { found: true, k: matches[0] };
  }
  return { found: false, k: null };
}

// Generic name->value resolver for box-score stat maps (used for hits).
function resolvePlayerStat(statMap, playerName) {
  const target = normPlayerName(playerName);
  if (!target) return { found: false, value: null };
  if (statMap.has(target)) return { found: true, value: statMap.get(target) };
  const parts = target.split(" ");
  if (parts.length >= 2) {
    const firstInitial = parts[0][0];
    const last = parts[parts.length - 1];
    const matches = [];
    for (const [name, v] of statMap.entries()) {
      const np = name.split(" ");
      if (np.length >= 2 && np[np.length - 1] === last && np[0][0] === firstInitial) matches.push(v);
    }
    if (matches.length === 1) return { found: true, value: matches[0] };
  }
  return { found: false, value: null };
}

// MLB grading — moneyline/totals from the schedule score; HR props from the
// official boxscore (one fetch per game, cached for this run).
async function gradeMlb(supabase, pending) {
  if (!pending.length) return 0;

  const byDate = {};
  for (const p of pending) (byDate[p.game_date] ||= []).push(p);

  let graded = 0;
  const hrCache = new Map(); // game_id -> { ok, hr }
  const kCache = new Map(); // game_id -> { ok, ks }
  const hitsCache = new Map(); // game_id -> { ok, hits }
  const tbCache = new Map(); // game_id -> { ok, tb }
  const scoreCache = new Map(); // game_id -> { awayScore, homeScore } | null (linescore fallback)
  const statusCache = new Map(); // game_id -> authoritative feed status+score

  for (const [date, preds] of Object.entries(byDate)) {
    let schedule;
    try { schedule = await getScheduleForDate(date); }
    catch (e) { console.error(`[Tracker] schedule fetch failed for ${date}:`, e.message); continue; }

    const gameById = {};
    for (const g of schedule) gameById[g.id] = g;

    for (const p of preds) {
      const g = gameById[p.game_id];
      if (!g) continue; // not on this date's schedule

      // Do NOT trust the schedule's status for grading. It can mislabel a
      // postponed/suspended game as "final" (abstractState Final on a no-action
      // game), which previously graded picks against an empty preview box. Fast
      // path: a clean schedule final WITH a score is trusted as-is. Otherwise we
      // consult the AUTHORITATIVE feed (one read per game, cached) and decide.
      const schedClean = g.status === "final" && g.awayScore != null && g.homeScore != null;
      if (!schedClean) {
        if (!statusCache.has(p.game_id)) {
          statusCache.set(p.game_id, await getGameStatusAndScore(p.game_id));
        }
        const auth = statusCache.get(p.game_id);
        if (!auth || !auth.ok) continue; // feed unreadable → retry next run

        if (auth.abstractGameState === "Final") {
          // Genuinely final, but guard against an empty/anomalous feed: never grade
          // against a game with no runs AND no batter stats.
          if (auth.homeRuns == null && auth.awayRuns == null && auth.battersWithStats === 0) continue;
          if (auth.homeRuns != null) g.homeScore = auth.homeRuns; // adopt authoritative score
          if (auth.awayRuns != null) g.awayScore = auth.awayRuns;
        } else {
          // Not final. If the slate date has already passed and the game never
          // became a real final (postponed / cancelled / never started), it's a
          // no-action → void (push) so it can't rot as pending or grade later
          // against the wrong game. In-progress/suspended or future games stay
          // pending and will grade when they truly finalize.
          const past = p.game_date < getEasternDate(0);
          const ds = auth.detailedState || "";
          if (past && (auth.abstractGameState === "Preview" || ds === "Postponed" || ds === "Cancelled")) {
            const { error: vErr } = await supabase
              .from("model_predictions")
              .update({ result: "push", actual_value: null, graded_at: new Date().toISOString() })
              .eq("id", p.id);
            if (!vErr) graded++;
          }
          continue;
        }
      }

      let outcome;
      if (p.market === "player_strikeouts") {
        // Per-pitcher Ks from the official boxscore; cache one fetch per game.
        if (!kCache.has(p.game_id)) {
          kCache.set(p.game_id, await getGamePitcherStrikeouts(p.game_id));
        }
        const box = kCache.get(p.game_id);
        if (!box || !box.ok) continue;                 // couldn't read → retry later
        const ci = p.selection.lastIndexOf(":");
        const pname = ci >= 0 ? p.selection.slice(0, ci) : p.selection;
        const side = (ci >= 0 ? p.selection.slice(ci + 1) : "OVER").toUpperCase();
        const { found, k } = resolveK(box.ks, pname);
        if (!found) continue;                          // pitcher not located → never false-loss
        if (p.line != null && k === p.line) outcome = { result: "push", actual: k };
        else {
          const over = k > (p.line ?? 0);
          const win = side === "OVER" ? over : !over;
          outcome = { result: win ? "win" : "loss", actual: k };
        }
      } else if (p.market === "player_hits") {
        if (!hitsCache.has(p.game_id)) {
          hitsCache.set(p.game_id, await getGameBatterHits(p.game_id));
        }
        const box = hitsCache.get(p.game_id);
        if (!box || !box.ok) continue;                 // couldn't read → retry later
        const ci = p.selection.lastIndexOf(":");
        const pname = ci >= 0 ? p.selection.slice(0, ci) : p.selection;
        const side = (ci >= 0 ? p.selection.slice(ci + 1) : "OVER").toUpperCase();
        const { found, value } = resolvePlayerStat(box.hits, pname);
        if (!found) continue;                          // batter not located → never false-loss
        if (p.line != null && value === p.line) outcome = { result: "push", actual: value };
        else {
          const over = value > (p.line ?? 0);
          const win = side === "OVER" ? over : !over;
          outcome = { result: win ? "win" : "loss", actual: value };
        }
      } else if (p.market === "player_total_bases_shadow") {
        if (!tbCache.has(p.game_id)) {
          tbCache.set(p.game_id, await getGameBatterTotalBases(p.game_id));
        }
        const box = tbCache.get(p.game_id);
        if (!box || !box.ok) continue;                 // couldn't read → retry later
        const ci = p.selection.lastIndexOf(":");
        const pname = ci >= 0 ? p.selection.slice(0, ci) : p.selection;
        const side = (ci >= 0 ? p.selection.slice(ci + 1) : "OVER").toUpperCase();
        const { found, value } = resolvePlayerStat(box.tb, pname);
        if (!found) continue;                          // batter not located → never false-loss
        if (p.line != null && value === p.line) outcome = { result: "push", actual: value };
        else {
          const over = value > (p.line ?? 0);
          const win = side === "OVER" ? over : !over;
          outcome = { result: win ? "win" : "loss", actual: value };
        }
      } else if (p.market === "hr_prop") {
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
        // Team markets (moneyline/run_line/total) settle off the final score.
        // Prefer the schedule; if it's missing (seen on 823539), fall back to the
        // linescore. If neither has a score, leave pending — a truly unsettleable
        // final (suspended/no-score feed) is handled by voiding, not grading.
        if (g.awayScore == null || g.homeScore == null) {
          if (!scoreCache.has(p.game_id)) {
            let ls = null;
            try { ls = await getLinescore(p.game_id); } catch (_) { ls = null; }
            const as = ls && ls.teams && ls.teams.away ? ls.teams.away.runs : null;
            const hs = ls && ls.teams && ls.teams.home ? ls.teams.home.runs : null;
            scoreCache.set(p.game_id, (as != null && hs != null) ? { awayScore: as, homeScore: hs } : null);
          }
          const fixed = scoreCache.get(p.game_id);
          if (!fixed) continue;          // no score anywhere → leave pending (void separately)
          g.awayScore = fixed.awayScore;
          g.homeScore = fixed.homeScore;
        }
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
    const boardFor = async (date) => {
      if (sbCache[date] !== undefined) return sbCache[date];
      try { sbCache[date] = await fetchScoreboard(date); }
      catch (e) { sbCache[date] = null; } // transient → try again next run
      return sbCache[date];
    };
    for (const p of teamRows) {
      // ESPN files a game under its own date, which can differ by up to a day from
      // the date we stored (UTC-vs-Eastern bucketing for night games). Find the game
      // by its UNIQUE id across the stored date and ±1 — a date-stamp drift can no
      // longer strand a finished game as pending, and matching by id means we can
      // never grade the wrong game.
      let g = null;
      for (const d of [p.game_date, shiftYmd(p.game_date, -1), shiftYmd(p.game_date, 1)]) {
        const games = await boardFor(d);
        g = (games || []).find(x => String(x.gameId) === String(p.game_id));
        if (g) break;
      }
      if (!g || g.state !== "post") continue; // not found / not final yet → stay pending
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

// ── Odds tick snapshots ───────────────────────────────────────────────────────
// Saves a snapshot of every MLB ML/total price each run so the Home line-movement
// chart and real Market Movers have intraday history. Cache-respecting fetch
// (no forceFresh) → shares the 30-min odds cache, ~no extra API credits. Runs on
// its own cron (independent of pending picks), so it captures all day.
async function captureOddsTicks() {
  const supabase = db();
  let oddsEvents = [];
  try { oddsEvents = await getMLBMainOdds(); }
  catch (e) { console.error("[Ticks] odds fetch failed:", e.message); return 0; }
  if (!oddsEvents || !oddsEvents.length) { console.log("[Ticks] no odds events"); return 0; }
  const now = new Date().toISOString();
  const rows = [];
  for (const ev of oddsEvents) {
    const away = ev.awayTeam, home = ev.homeTeam;
    if (!away || !home) continue;
    // Only snapshot PRE-GAME prices. The main odds feed can still return a game that
    // is already underway, with wild in-play moneylines (a lopsided game late shows
    // things like +475/-460). Because ticks are keyed by team name over a 20h window,
    // those in-play prices then pollute the NEXT same-matchup game's "open" (the 2nd/
    // 3rd game of a series), producing fake giant line moves in Market Movers. Skip
    // any event that has already started so only true pre-game movement is recorded.
    if (ev.commenceTime && new Date(ev.commenceTime).getTime() <= Date.now()) continue;
    const base = { captured_at: now, away_team: away, home_team: home };
    if (ev.h2h && ev.h2h.away != null)   rows.push({ ...base, market: "ml",    side: "away",  line: null,                 odds: ev.h2h.away });
    if (ev.h2h && ev.h2h.home != null)   rows.push({ ...base, market: "ml",    side: "home",  line: null,                 odds: ev.h2h.home });
    if (ev.totals && ev.totals.over != null)  rows.push({ ...base, market: "total", side: "over",  line: ev.totals.line ?? null, odds: ev.totals.over });
    if (ev.totals && ev.totals.under != null) rows.push({ ...base, market: "total", side: "under", line: ev.totals.line ?? null, odds: ev.totals.under });
    // Per-book moneyline snapshots so we can later show "N books moved toward X".
    // Stored in the SAME table (no schema change): market="mlbook", side encodes
    // the book + side as "away@DraftKings". Harmless to existing readers, which
    // filter on market="ml"/"total" only. Accumulates history starting now.
    if (Array.isArray(ev.h2hQuotes)) {
      for (const q of ev.h2hQuotes) {
        if (!q || !q.book) continue;
        if (q.away != null) rows.push({ ...base, market: "mlbook", side: `away@${q.book}`, line: null, odds: q.away });
        if (q.home != null) rows.push({ ...base, market: "mlbook", side: `home@${q.book}`, line: null, odds: q.home });
      }
    }
  }
  if (!rows.length) return 0;
  const { error } = await supabase.from("odds_ticks").insert(rows);
  if (error) { console.error("[Ticks] insert failed:", error.message); return 0; }
  // Keep ~4 days of history so the table stays small.
  try { await supabase.from("odds_ticks").delete().lt("captured_at", new Date(Date.now() - 4 * 864e5).toISOString()); } catch (_) {}
  console.log(`[Ticks] saved ${rows.length} odds snapshots`);
  return rows.length;
}

module.exports = { recordPredictions, recordTotalBasesShadow, recordNbaPropPredictions, recordNbaTeamPredictions, gradeFinishedGames, gradeNbaProp, captureClosingLines, captureNbaClosingLines, captureOddsTicks };
