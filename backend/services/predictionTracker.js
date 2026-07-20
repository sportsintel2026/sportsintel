// Prediction tracker — snapshots model predictions and grades them after games finish.
//
// recordPredictions(result)  → MLB: inserts one row per game+market+selection per day.
// recordNbaPropPredictions(proj, gameIso) → NBA: snapshots flagged prop edges pre-game.
// gradeFinishedGames()  → cron: grades pending MLB (team scores) and NBA (player gamelog).

const { createClient } = require("@supabase/supabase-js");
const { getEasternDate, getScheduleForDate, getGameHRHitters, getGamePitcherStrikeouts, getGameBatterHits, getGameBatterTotalBases, getLinescore, getGameStatusAndScore, normPlayerName } = require("./mlbStatsApi");
const { fetchGamelog } = require("./nbaGamelog");
const { fetchScoreboard } = require("./nbaDataSource");
const { fetchScoreboard: fetchNflScoreboard } = require("./nflDataSource");
const { fetchScoreboard: fetchCfbScoreboard } = require("./cfbDataSource"); // WZ-FBALL-CFB-SHADOW-2026-07-17
const { getMLBMainOdds, getMLBPinnacleClose } = require("./oddsApi");
const { teamKey } = require("./teamKey"); // WZ-TEAMKEY-SSOT-2026-07-17
// WZ-CAL-MIRROR-2026-07-02 :: winProbCalibration import removed — calibration now applies
// LIVE in edgesModel; this file just records the already-calibrated values it receives.

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
    // RLCLV-FLIP-GUARD-2026-06-24
    // Run line closing price comes from the spreads market (±1.5). The ±1.5 line's
    // SIGN can flip between pick time and close: a marginal home dog (+1.5) often
    // gets bet up to a favorite (-1.5) by first pitch. When that happens, our team's
    // closing price is now on the OPPOSITE side of the spread from the bet we made,
    // so comparing them is two different bets and yields a garbage CLV (e.g. our
    // +1.5 dog price -245 vs the closing -1.5 fav price +180 → a phantom -35% CLV).
    // Guard: only record run-line CLV when the closing line for OUR side has the
    // SAME sign as the line we bet. If it flipped, return null (honest "no comparable
    // close") instead of a corrupted number. (Falls through unguarded when the
    // closing line sign is unavailable, preserving prior behavior.)
    const away = ev.spreads?.away, home = ev.spreads?.home;
    if (away == null || home == null) return null;
    const ourCloseLine = pick.selection === "away" ? ev.spreads?.awayLine : ev.spreads?.homeLine;
    if (pick.line != null && ourCloseLine != null
        && Math.sign(pick.line) !== Math.sign(ourCloseLine)) {
      return null; // favorite/dog flipped off our side — not a comparable close
    }
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
  // Pinnacle (sharp CLV) fires only in the FINAL 30 min before first pitch — the truest
  // "close", and gating it this tight keeps the extra eu-region credits minimal (Pinnacle
  // gets pulled a couple times per game instead of every tick across the 120-min window).
  const PIN_WINDOW_MS = 30 * 60 * 1000;
  const now = Date.now();
  const closingWindowGameIds = new Set();
  const pinWindowGameIds = new Set();
  const gameNames = {};
  for (const date of dates) {
    try {
      const schedule = await getScheduleForDate(date);
      for (const g of schedule) {
        gameNames[String(g.id)] = { away: g.away, home: g.home, date };
        if (g.status !== "scheduled" || !g.startTimeUTC) continue;
        const msToStart = new Date(g.startTimeUTC).getTime() - now;
        if (msToStart > 0 && msToStart <= CLOSING_WINDOW_MS) {
          closingWindowGameIds.add(String(g.id));
        }
        if (msToStart > 0 && msToStart <= PIN_WINDOW_MS) {
          pinWindowGameIds.add(String(g.id));
        }
      }
    } catch (e) { console.error(`[CLV] schedule ${date} failed:`, e.message); }
  }

  const toCapture = pending.filter(p => closingWindowGameIds.has(String(p.game_id)));
  // WZ-CLOSINGLINES-2026-07-05 :: proceed if ANY scheduled game is in the pre-pitch
  // window (not only our picks), so the closing_lines ledger below captures the full
  // slate. The pick-CLV loop still only processes toCapture, so CLV is unchanged.
  if (closingWindowGameIds.size === 0) { console.log("[CLV] no games in pre-game closing window"); return 0; }

  // One FRESH odds fetch (bypass the 30-min cache) so the captured price is the
  // true current line, not an up-to-30-min-stale cached one. ~3 credits, and only
  // when games are actually in the closing window (we returned above otherwise).
  let oddsEvents = [];
  try { oddsEvents = await getMLBMainOdds({ forceFresh: true }); }
  catch (e) { console.error("[CLV] odds fetch failed:", e.message); return 0; }

  // Pinnacle (sharp) close — only when a game is in the final 30-min window, and never
  // allowed to break the US capture: a failure here just leaves pinnacle_* null. ~2 eu
  // credits, fired sparingly. This is the benchmark that actually validates edge.
  let pinEvents = [];
  if (pinWindowGameIds.size > 0 && toCapture.length > 0) {
    try { pinEvents = await getMLBPinnacleClose({ forceFresh: true }); }
    catch (e) { console.error("[CLV] Pinnacle close fetch failed:", e.message); pinEvents = []; }
  }

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

    // Build the update incrementally so US and Pinnacle CLV write independently —
    // a pick can get its sharp CLV even on a tick where the US best price didn't move.
    const upd = {};

    // US best-of-books CLV — RATCHET: only (re)write when the price changed, keeping
    // the last pre-game best price as the close without churning rows.
    if (!(pick.closing_odds != null && pick.closing_odds === closing.thisOdds)) {
      upd.closing_odds = closing.thisOdds;
      upd.closing_opp_odds = closing.oppOdds;
      upd.clv = clv;
      upd.beat_close = beatFlag(clv);
      upd.closing_captured_at = new Date().toISOString();
    }

    // SHARP CLV vs Pinnacle's de-vigged close (only for games in the tight window).
    // De-vig Pinnacle's two-sided price to a fair no-vig probability for our side, then
    // CLV = fairProb − our taken price's implied prob. Positive = we got a longer price
    // than the sharpest book's fair line → genuinely beat the close. Guarded end-to-end.
    if (pinEvents.length && pinWindowGameIds.has(String(pick.game_id)) && pickImplied != null) {
      const pinEv = matchPickToOddsEvent(names, pinEvents);
      const pc = pinEv ? closingOddsForPick(pick, pinEv) : null;
      if (pc && pc.thisOdds != null && pc.oppOdds != null) {
        const ti = americanToImpliedProb(pc.thisOdds);
        const oi = americanToImpliedProb(pc.oppOdds);
        const pinFair = (ti != null && oi != null && ti + oi > 0) ? round4(ti / (ti + oi)) : null;
        if (pinFair != null
            && !(pick.pinnacle_closing_odds != null && pick.pinnacle_closing_odds === pc.thisOdds)) {
          const pinClv = round4(pinFair - pickImplied);
          upd.pinnacle_closing_odds = pc.thisOdds;
          upd.pinnacle_fair_prob = pinFair;
          upd.pinnacle_clv = pinClv;
          upd.pinnacle_beat_close = beatFlag(pinClv);
        }
      }
    }

    if (Object.keys(upd).length === 0) continue; // nothing new this tick
    const { error: upErr } = await supabase
      .from("model_predictions")
      .update(upd)
      .eq("id", pick.id);
    if (!upErr) captured++;
  }

  // WZ-CLOSINGLINES-2026-07-05 :: permanent closing-line ledger for EVERY in-window
  // game (not just our picks), so price-based reads (favorite bands, juiced totals) can
  // be backtested against true league-wide base rates. Reuses the oddsEvents fetch above
  // (no extra credits). Ratchet: upsert overwrites each tick so the last pre-pitch price
  // wins. Fully isolated in try/catch — a failure here can NEVER affect CLV/grading.
  try {
    const clRows = [];
    for (const gid of closingWindowGameIds) {
      const nm = gameNames[gid];
      if (!nm || !nm.date) continue;
      const ev = matchPickToOddsEvent({ away: nm.away, home: nm.home }, oddsEvents);
      if (!ev) continue;
      const aML = ev.h2h ? ev.h2h.away : null;
      const hML = ev.h2h ? ev.h2h.home : null;
      const tLine = ev.totals ? ev.totals.line : null;
      const oO = ev.totals ? ev.totals.over : null;
      const uO = ev.totals ? ev.totals.under : null;
      if (aML == null && hML == null && oO == null && uO == null) continue;
      const fav = (aML != null && hML != null) ? (aML < hML ? nm.away : nm.home) : null;
      clRows.push({
        game_date: nm.date, game_id: gid,
        away_team: nm.away, home_team: nm.home,
        away_ml: aML, home_ml: hML, favorite: fav,
        total_line: tLine, over_odds: oO, under_odds: uO,
        captured_at: new Date().toISOString(),
      });
    }
    if (clRows.length) {
      const { error: clErr } = await supabase
        .from("closing_lines")
        .upsert(clRows, { onConflict: "game_date,game_id" });
      if (clErr) console.error("[ClosingLines] upsert failed:", clErr.message);
      else console.log(`[ClosingLines] captured ${clRows.length} game closing lines`);
    }
  } catch (e) { console.error("[ClosingLines] capture error:", e.message); }

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
  // WZ-TEAMKEY-SSOT-2026-07-17 :: This feeds CLV / prediction tracking, so a wrong odds↔game match
  // corrupts a tracked pick's closing line. Canonical, collision-safe pass FIRST, across ALL events:
  // both teams must resolve to a canonical MLB key AND agree. This subsumes the city-strip and adds
  // abbreviation/relocation names the list misses (e.g. "Athletics" vs "Oakland Athletics"). The
  // original normalize + exact/contains logic stays below as a fallback, reached only when canonical
  // finds nothing, so anything that matched before still matches — this only ADDS correct matches.
  const aK = teamKey(names.away, "mlb"), hK = teamKey(names.home, "mlb");
  if (aK && hK) {
    for (const ev of oddsEvents) {
      if (teamKey(ev.awayTeam, "mlb") === aK && teamKey(ev.homeTeam, "mlb") === hK) return ev;
    }
  }
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
// Tie-aware beat flag: >0 = beat, <0 = worse, exactly 0 (flat price, no movement) = a
// TIE, stored as null rather than false so ties never masquerade as losses in the column.
function beatFlag(v) { return v == null ? null : (v > 0 ? true : (v < 0 ? false : null)); }

// ── RECORD (MLB) ────────────────────────────────────────────────────────────────
// Snapshots every edge the model surfaced today. Only records games that are
// NOT yet final (we want pre-game predictions, not post-hoc).
// WZ-BENCH-STAMP-2026-07-18 :: lazy require so a load error here can never break recording.
function benchedNow(market) {
  try { return require("./calibrationGuard").isBenched(market, "mlb") === true; }
  catch (e) { return false; }
}

async function recordPredictions(result) {
  if (!result || !Array.isArray(result.games)) return;
  const supabase = db();
  const gameDate = result.date || getEasternDate(0);
  const rows = [];

  // WZ-ONE-SIDE-PER-GAME-2026-07-18 :: ONE recorded pick per game per core market per day.
  // The unique key is (game_id, market, selection, game_date) -- and "over"/"under" are DIFFERENT
  // selections, so BOTH sides of the same game could persist. Nobody ever chose both: the recorder
  // re-runs all day, and when the line moves, the morning snapshot books the over while the
  // afternoon books the under. The pair is then locked to a guaranteed win+loss -- a structural
  // -4.5% (the vig) every time it happens, with zero model skill involved. Observed 2026-07-17:
  // Over/Under 12 CIN@COL, Over/Under 8.5 CWS@TOR, Over/Under 8.5 TB@BOS -- 3 pairs in one slate.
  // (Best-of-books pricing makes it worse: the best over at book A and the best under at book B
  // can BOTH show a positive edge that exists at no single book -- a pricing artifact, not value.)
  // Fix: first pick per game+market wins for the day; any later opposite side is skipped. Applies
  // to core markets only -- the *_shadow recorders deliberately log a FIXED side every game and
  // are untouched, so calibration measurement keeps its full sample.
  const CORE_ONE_SIDE = ["moneyline", "total", "run_line"];
  const takenGameMarket = new Set();
  try {
    const { data: existingCore } = await supabase
      .from("model_predictions")
      .select("game_id, market")
      .eq("league", "mlb")
      .eq("game_date", gameDate)
      .in("market", CORE_ONE_SIDE);
    for (const r of existingCore || []) takenGameMarket.add(`${String(r.game_id)}|${r.market}`);
  } catch (e) {
    console.error("[Tracker] one-side pre-check failed (recording continues):", e.message);
  }
  // Returns true (and claims the slot) if this game+market has NOT been recorded yet today.
  const claimSide = (gameId, market) => {
    const k = `${String(gameId)}|${market}`;
    if (takenGameMarket.has(k)) return false;
    takenGameMarket.add(k);
    return true;
  };

  // Build a quick lookup of game status by id (skip finals)
  const statusById = {};
  const fatigueById = {};
  const shadowById = {};
  const breakdownById = {};
  for (const g of result.games) {
    statusById[g.id] = g.status;
    const b = g.totals && g.totals.breakdown;
    if (b && b.fatigueAdj != null) {
      const a = (b.awayBullpenFatigue && b.awayBullpenFatigue.level) || "?";
      const h = (b.homeBullpenFatigue && b.homeBullpenFatigue.level) || "?";
      fatigueById[g.id] = `away=${a},home=${h},adj=${b.fatigueAdj}`;
    }
    if (g.totals && g.totals.shadow != null) shadowById[g.id] = g.totals.shadow;
    // FACTOR-ATTRIBUTION (read-only instrumentation): persist each model
    // adjustment so we can later measure which factor actually predicts. These
    // are the same numbers already shown in the totals breakdown, just retained
    // per-pick for grading instead of thrown away after the console log.
    if (b) {
      breakdownById[g.id] = {
        base: b.base ?? null,
        pitcher_adj: b.pitcherAdj ?? null,
        ace_adj: b.aceAdj ?? null,
        park_adj: b.parkAdj ?? null,
        weather_adj: b.weatherAdj ?? null,
        bullpen_adj: b.bullpenAdj ?? null,
        fatigue_adj: b.fatigueAdj ?? null,
      };
    }
  }

  // Moneyline — record EVERY side the board published. The recorder is a ledger of what
  // subscribers were actually shown; it does not get its own selection rule.
  //
  // WZ-ML-RECORD-MATCHES-BOARD-2026-07-19 :: THIS LOOP USED TO DROP ~91% OF THE BOARD.
  // It carried `if (e.edge == null || e.edge <= 0) continue;` — a positive-edge gate left over
  // from the pre-WZ-WINNERS regime, when moneyline picks were chosen BY edge. WZ-WINNERS-2026-07-07
  // changed the board to "MONEYLINE = WINNERS": the side with the higher win probability, kept when
  // it clears WINNER_MIN 0.55 in routes/edges.js, ranked by win%, with NO edge gate and no dog cap
  // (a winner that is also underpriced merely carries the isValue "+VALUE" flag). The board moved.
  // This recorder did not. Measured 2026-07-19 on 2026-07-08..now: 22 games had a side clearing the
  // floor; core `moneyline` holds 7 rows, and only 2 of them matched a qualifying game. Everything
  // else was a published pick that was never written down.
  //
  // Two harms, and the second is worse than the missing volume:
  //   1. The ledger disagreed with the board. Subscribers saw 22 picks; the record booked 2.
  //   2. `edge > 0` means model_prob exceeded the market-implied price, so the surviving sample was
  //      systematically the model's MOST OPTIMISTIC rows -- precisely the population most prone to
  //      overclaiming. calibrationGuard was grading moneyline on that biased 9% and calling it the
  //      market. At ~0.6 rows/day it also could never reach MIN_N 40, so the one core market still
  //      live on the board was the one the guard could not govern. This restores ~2 rows/day.
  //
  // The gate's ORIGINAL purpose is already covered twice over and does not need this line:
  // moneyline probabilities sum to 1, so both sides can never clear a 0.55 floor, and claimSide
  // below enforces one row per game+market per day. Mirror-side dilution is structurally impossible
  // here. (Totals and run_line keep their edge gates -- those boards genuinely ARE edge-selected,
  // so their recorders already mirror them. This change is moneyline-only.)
  // REVERT: restore `if (e.edge == null || e.edge <= 0) continue;` as the second line of this loop.
  for (const e of result.moneylineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (!claimSide(e.gameId, "moneyline")) continue; // WZ-ONE-SIDE-PER-GAME-2026-07-18
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "moneyline", selection: e.side,
      description: `${e.teamAbbr} ML`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      // WZ-CAL-MIRROR-2026-07-02 :: the calibration went LIVE this deploy — model_prob and
      // edge above ARE the calibrated values (applied in edgesModel). These columns now
      // mirror them for query continuity; re-applying the haircut here would double-cut.
      // Raw pre-cal values are recoverable via the curve's inverse in winProbCalibration.
      model_prob_cal: e.modelProb ?? null,
      cal_edge: e.edge ?? null,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: null,
      benched_at_pick: benchedNow("moneyline"), // WZ-BENCH-STAMP-2026-07-18
    });
  }

  // Totals — positive-edge side only (the over/under sides mirror each other).
  for (const e of result.totalsEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (e.edge == null || e.edge <= 0) continue;
    if (!claimSide(e.gameId, "total")) continue; // WZ-ONE-SIDE-PER-GAME-2026-07-18
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "total", selection: e.side,
      description: `${e.side === "over" ? "Over" : "Under"} ${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: e.line,
      benched_at_pick: benchedNow("total"), // WZ-BENCH-STAMP-2026-07-18
      bullpen_fatigue: fatigueById[e.gameId] || null,
      shadow_total: shadowById[e.gameId] ?? null,
      ...(breakdownById[e.gameId] || {}),
    });
  }

  // Run line (±1.5) — positive-edge side only (the two sides mirror each other).
  for (const e of result.runLineEdges || []) {
    if (statusById[e.gameId] === "final") continue;
    if (e.edge == null || e.edge <= 0) continue;
    if (!claimSide(e.gameId, "run_line")) continue; // WZ-ONE-SIDE-PER-GAME-2026-07-18
    rows.push({
      game_id: e.gameId, game_date: gameDate, league: "mlb",
      matchup: e.matchup, market: "run_line", selection: e.side,
      description: `${e.teamAbbr} ${e.line > 0 ? "+" : ""}${e.line}`,
      model_prob: e.modelProb, odds: e.odds, edge: e.edge,
      confidence: e.confidence, conviction: e.conviction ?? null, conviction_score: e.convictionScore ?? null, line: e.line,
      benched_at_pick: benchedNow("run_line"), // WZ-BENCH-STAMP-2026-07-18
    });
  }

  // WZ-SLATE-SHADOW-2026-07-10 :: full-slate shadow recorder (measurement only).
  // The published board is heavily filtered (winners-first + edge>0 + bandcuts),
  // so the graded record accumulates far too slowly to calibrate the model
  // (moneyline: ~1-2 published picks/day vs ~15 evaluated games/day). This block
  // records ONE fixed-side row per game per core market for EVERY scheduled game,
  // regardless of edge sign or any board filter, into DISTINCT *_shadow markets:
  //   moneyline_shadow (home side) / total_shadow (over side) / run_line_shadow (home side)
  // Fixed sides remove selection bias (the complement side is just 1 - p). Rows
  // grade via the normal cron (gradeOne strips the _shadow suffix) but are
  // STRUCTURALLY excluded from the published record, CLV, and the board:
  // performance.js counts only exact core market names, and nothing renders
  // *_shadow. Same proven idiom as the K/hits/TB shadows. Dup-safe via the same
  // (game_id, market, selection, game_date) upsert -- first pre-game snapshot wins.
  // HARDENING: every shadow row REQUIRES a posted price (odds != null) and a
  // non-null confidence, because one null hitting a DB not-null constraint would
  // reject the WHOLE batch and silently kill CORE recording too (same failure
  // mode the game_id filter below defends against). A game with no posted line
  // is skipped -- honestly unmeasurable for ROI anyway.
  let shadowPushed = 0;
  for (const g of result.games) {
    if (g.status !== "scheduled") continue; // pre-game snapshots only (mirrors the board's isPreGame gate)
    const abbrs = `${g.awayAbbr || "?"} @ ${g.homeAbbr || "?"}`;
    if (g.moneyline && g.moneyline.homeWinProb != null && g.moneyline.homeOdds != null) {
      rows.push({
        game_id: g.id, game_date: gameDate, league: "mlb",
        matchup: abbrs, market: "moneyline_shadow", selection: "home",
        description: `SHADOW ${g.homeAbbr || "home"} ML (full slate)`,
        model_prob: g.moneyline.homeWinProb, odds: g.moneyline.homeOdds,
        edge: g.moneyline.homeEdge ?? null, confidence: g.moneyline.homeConfidence ?? "NEUTRAL", line: null,
      });
      shadowPushed++;
    }
    if (g.totals && g.totals.overProb != null && g.totals.line != null && g.totals.overOdds != null) {
      rows.push({
        game_id: g.id, game_date: gameDate, league: "mlb",
        matchup: abbrs, market: "total_shadow", selection: "over",
        description: `SHADOW Over ${g.totals.line} (full slate)`,
        model_prob: g.totals.overProb, odds: g.totals.overOdds,
        edge: g.totals.overEdge ?? null, confidence: g.totals.overConfidence ?? "NEUTRAL", line: g.totals.line,
        projected: g.totals.projected ?? null, // WZ-TOTALSPROJ-2026-07-17 :: store the model projection so /totalsbias can measure over-lean = mean(projected - actual_value)
      });
      shadowPushed++;
    }
    if (g.runLine && g.runLine.homeCoverProb != null && g.runLine.homeLine != null && g.runLine.homeOdds != null) {
      rows.push({
        game_id: g.id, game_date: gameDate, league: "mlb",
        matchup: abbrs, market: "run_line_shadow", selection: "home",
        description: `SHADOW ${g.homeAbbr || "home"} ${g.runLine.homeLine > 0 ? "+" : ""}${g.runLine.homeLine} (full slate)`,
        model_prob: g.runLine.homeCoverProb, odds: g.runLine.homeOdds,
        edge: g.runLine.homeEdge ?? null, confidence: g.runLine.homeConfidence ?? "NEUTRAL", line: g.runLine.homeLine,
      });
      shadowPushed++;
    }
  }
  if (shadowPushed > 0) console.log(`[Tracker] SLATE-SHADOW queued ${shadowPushed} full-slate shadow rows for ${gameDate}`);
  else console.warn(`[Tracker] SLATE-SHADOW queued 0 rows for ${gameDate} (no scheduled games with odds in this tick)`);

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

// Pitcher strikeout projection SHADOW recorder (log-only, mirrors recordTotalBasesShadow).
// Snapshots EVERY probable starter's K projection (from calculateStrikeoutShadow) so the
// strikeout overprojection can be measured against graded actuals. Stores the projection
// components — expected_ks (operative lambda), proj_ip, k_rate, pitcher_k9 — alongside the
// usual fields. Graded later by the player_strikeouts_shadow branch vs actual Ks AND IP.
// Market string is distinct (player_strikeouts_shadow) so it never touches live K picks.
// Batter hits projection SHADOW recorder (log-only, mirrors recordStrikeoutShadow).
// WZ-HITSSHADOW-REC-2026-07-02 :: snapshots EVERY evaluated batter's hits projection
// (from calculateHitsPropEdges' shadowSink) — pre-filter, RAW un-haircut prob — so the
// confirmed hits overconfidence (claims ~0.62 cashing 0.43, last-14d gap -0.098) can be
// decomposed at the source vs graded actuals. Column reuse (K-shadow pattern, zero
// migration): model_prob = RAW anchored over prob (measures the un-calibrated model);
// expected_ks = expected HITS (perAB x expAB); proj_ip = expected AT-BATS; k_rate =
// per-AB hit rate. Grader fills actual_value (hits) and actual_ip (actual ABs), so the
// bias splits into innings... er, at-bats vs rate, exactly like Ks-vs-IP did.
// Market string is distinct (player_hits_shadow) so it never touches live hits picks.
async function recordHitsShadow(hitsShadow, gameIso) {
  if (!Array.isArray(hitsShadow) || hitsShadow.length === 0) return;
  const supabase = db();
  const gameDate = gameIso || getEasternDate(0);
  const rows = [];
  for (const p of hitsShadow) {
    if (!p.playerId || p.line == null || p.overProbRaw == null) continue;
    const expHits = (p.perAB != null && p.expAB != null) ? Math.round(p.perAB * p.expAB * 100) / 100 : null;
    rows.push({
      game_id: String(p.gameId), game_date: gameDate, league: "mlb",
      matchup: p.game, market: "player_hits_shadow",
      selection: `${p.player}:OVER`,
      description: `${p.player} hits shadow (perAB ${p.perAB}, expAB ${p.expAB}, order ${p.battingOrder ?? "?"}, avg ${p.seasonAvg ?? "?"}, xBA ${p.xBA ?? "?"})`,
      model_prob: p.overProbRaw, odds: -110,
      edge: null, confidence: p.overProbRaw, line: p.line,
      expected_ks: expHits,
      proj_ip: p.expAB ?? null,
      k_rate: p.perAB ?? null,
    });
  }
  if (rows.length === 0) return;
  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) console.error("[Tracker] hits-shadow record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} hits-shadow projections for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] hits-shadow record exception:", e.message);
  }
}

async function recordStrikeoutShadow(kShadow, gameIso) {
  if (!Array.isArray(kShadow) || kShadow.length === 0) return;
  const supabase = db();
  // gameIso is already an ET "YYYY-MM-DD" slate date — same handling as recordTotalBasesShadow
  // (do NOT re-parse through etDate(); a bare date string rolls back a day in Eastern).
  const gameDate = gameIso || getEasternDate(0);
  const rows = [];
  for (const p of kShadow) {
    if (!p.playerId || p.expectedKs == null) continue;
    rows.push({
      game_id: String(p.gameId), game_date: gameDate, league: "mlb",
      matchup: p.game, market: "player_strikeouts_shadow",
      selection: `${p.player}:OVER`,
      description: `${p.player} K shadow (expK ${p.expectedKs}, projIP ${p.projIP}, K9 ${p.pitcherK9})`,
      model_prob: p.overProb ?? null, odds: -110,
      edge: null, confidence: p.overProb ?? null, line: p.line ?? null,
      expected_ks: p.expectedKs ?? null,
      proj_ip: p.projIP ?? null,
      k_rate: p.kRate ?? null,
      pitcher_k9: p.pitcherK9 ?? null,
    });
  }
  if (rows.length === 0) return;
  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) console.error("[Tracker] K-shadow record error:", error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} K-shadow projections for ${gameDate} (dups ignored)`);
  } catch (e) {
    console.error("[Tracker] K-shadow record exception:", e.message);
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

// NFL model-pick SHADOW recorder (Phase-2 F5 calibration harness). Logs the model's
// actual picks (the positive-edge `value:true` side) for ML/spread/total to
// model_predictions as league:"nfl" so they auto-grade once games go final, building
// a graded track record to calibrate against. Two deliberate gates:
//   • IMMINENCE — only games kicking off within NFL_IMMINENT_DAYS are logged. Off-
//     season / far-future Week-1 lines are 60+ days out, so this is a NO-OP until the
//     season is near; that prevents logging stale far-future picks (the pick is then
//     always snapshotted against ratings current at ~game week, not months stale).
//   • RATED — only games whose model actually ran on ratings (dataQuality "rated").
// Consumes the runNFLSlate() output (slate.games), mirroring how the /api/edges/nfl
// route flattens per-game model output. Idempotent (game_id+market+selection+date).
// NOTE: NFL has no conviction tiering yet, so confidence/conviction are null — the
// calibration read groups by edge bucket. Grading matches by team-name+date (the
// Odds-API event id ≠ ESPN scoreboard id), so the matchup string is load-bearing.
const NFL_IMMINENT_DAYS = 7;
// WZ-FBALL-CFB-SHADOW-2026-07-17 :: generalized over league ("nfl"|"cfb") — NFL and CFB record
// identically (same predictGame output shape), so one implementation serves both; thin per-league
// wrappers below preserve the existing call sites. Consumes runNFLSlate()/runCFBSlate() output.
async function recordFootballPredictions(slate, league = "nfl") {
  if (!slate || !Array.isArray(slate.games) || slate.games.length === 0) return;
  const supabase = db();
  const now = Date.now();
  const rows = [];
  for (const g of slate.games) {
    if (g.dataQuality !== "rated") continue;            // model didn't run on ratings → skip
    if (!g.commenceTime) continue;
    const daysOut = (new Date(g.commenceTime).getTime() - now) / 864e5;
    if (daysOut > NFL_IMMINENT_DAYS || daysOut < 0) continue; // not within the pre-game window
    const gameDate = etDate(g.commenceTime) || getEasternDate(0);
    const matchup = g.matchup;

    // Moneyline — log only the side the model flags as value (positive edge).
    const ml = g.moneyline;
    if (ml && ml.value === true && (ml.pick === "home" || ml.pick === "away") && ml.book) {
      const home = ml.pick === "home";
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "moneyline", selection: ml.pick,
        description: `${ml.pickTeam || (home ? g.homeTeam : g.awayTeam)} ML`,
        model_prob: round3((home ? ml.homeWinProb : ml.awayWinProb) / 100),
        odds: home ? ml.book.home : ml.book.away,
        edge: round3((ml.edge || 0) / 100),
        confidence: null, conviction: null, conviction_score: null, line: null,
      });
    }

    // Spread — line is that side's signed number (home line as-is, away line negated).
    const sp = g.spread;
    if (sp && sp.value === true && (sp.pick === "home" || sp.pick === "away") && sp.book && sp.line != null) {
      const home = sp.pick === "home";
      const line = home ? sp.line : -sp.line;
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "spread", selection: sp.pick,
        description: `${sp.pickTeam || (home ? g.homeTeam : g.awayTeam)} ${line > 0 ? "+" : ""}${line}`,
        model_prob: round3((home ? sp.homeCoverProb : (100 - sp.homeCoverProb)) / 100),
        odds: home ? sp.book.home : sp.book.away,
        edge: round3((sp.edge || 0) / 100),
        confidence: null, conviction: null, conviction_score: null, line,
      });
    }

    // Total — only logs if the model flags value (NFL totals echo the market today,
    // so value is false and nothing logs; kept so it activates for free once a real
    // points model lands).
    const tot = g.total;
    if (tot && tot.value === true && (tot.pick === "over" || tot.pick === "under") && tot.book && tot.line != null) {
      const over = tot.pick === "over";
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "total", selection: tot.pick,
        description: `${over ? "Over" : "Under"} ${tot.line}`,
        model_prob: round3((over ? tot.overProb : (100 - tot.overProb)) / 100),
        odds: over ? tot.book.over : tot.book.under,
        edge: round3((tot.edge || 0) / 100),
        confidence: null, conviction: null, conviction_score: null, line: tot.line,
      });
    }
  }

  // WZ-FBALL-SLATE-SHADOW-2026-07-17 :: FULL-SLATE shadow recorder — the calibration rig. The filtered
  // block above only logs value===true picks, which is ~nothing while the model mirrors the market, so
  // it can never accumulate a gradeable sample (the exact MLB trap that cost months). This logs ONE
  // fixed-side row per game per market for EVERY game with a posted price — regardless of edge, value,
  // or dataQuality — into DISTINCT *_shadow markets (moneyline_shadow home / spread_shadow home /
  // total_shadow over). It stores the model internals the playbook wants (projected_margin, raw_win_prob,
  // projected total) so calibration can measure claimed-vs-actual the moment ratings land, and captures
  // the market baseline + preseason sample now. Fixed sides remove selection bias (the other side is
  // 1 - p). Rows grade via gradeNFL (which strips the _shadow suffix) and are STRUCTURALLY excluded from
  // the published record (performance counts only exact core market names). Dup-safe via the same
  // (game_id, market, selection, game_date) upsert — first pre-game snapshot wins. Every row REQUIRES a
  // posted price so a single null can't reject the whole batch (same hardening as the MLB slate shadow).
  for (const g of slate.games) {
    if (!g.commenceTime) continue;
    const daysOut = (new Date(g.commenceTime).getTime() - now) / 864e5;
    if (daysOut > NFL_IMMINENT_DAYS || daysOut < 0) continue; // pre-game snapshots only
    const gameDate = etDate(g.commenceTime) || getEasternDate(0);
    const matchup = g.matchup;
    const ml = g.moneyline, sp = g.spread, tot = g.total;
    const margin = (ml && ml.modelMargin != null) ? ml.modelMargin : null; // model's projected home margin
    if (ml && ml.homeWinProb != null && ml.book && ml.book.home != null) {
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "moneyline_shadow", selection: "home",
        description: `SHADOW ${g.homeTeam || "home"} ML (full slate)`,
        model_prob: round3(ml.homeWinProb / 100), odds: ml.book.home,
        edge: round3((ml.edge || 0) / 100), confidence: null, conviction: null, conviction_score: null, line: null,
        raw_win_prob: (ml.modelHomeWinProb != null) ? round3(ml.modelHomeWinProb / 100) : null,
        projected_margin: margin,
      });
    }
    if (sp && sp.homeCoverProb != null && sp.line != null && sp.book && sp.book.home != null) {
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "spread_shadow", selection: "home",
        description: `SHADOW ${g.homeTeam || "home"} ${sp.line > 0 ? "+" : ""}${sp.line} (full slate)`,
        model_prob: round3(sp.homeCoverProb / 100), odds: sp.book.home,
        edge: round3((sp.edge || 0) / 100), confidence: null, conviction: null, conviction_score: null, line: sp.line,
        projected_margin: margin,
      });
    }
    if (tot && tot.overProb != null && tot.line != null && tot.book && tot.book.over != null) {
      rows.push({
        game_id: String(g.eventId), game_date: gameDate, league, matchup,
        market: "total_shadow", selection: "over",
        description: `SHADOW Over ${tot.line} (full slate)`,
        model_prob: round3(tot.overProb / 100), odds: tot.book.over,
        edge: round3((tot.edge || 0) / 100), confidence: null, conviction: null, conviction_score: null, line: tot.line,
        projected: (tot.projTotal != null) ? tot.projTotal : null,
      });
    }
  }

  if (rows.length === 0) return;
  try {
    const { error } = await supabase
      .from("model_predictions")
      .upsert(rows, { onConflict: "game_id,market,selection,game_date", ignoreDuplicates: true });
    if (error) console.error(`[Tracker] ${league} record error:`, error.message);
    else console.log(`[Tracker] Snapshotted ${rows.length} ${league.toUpperCase()} model picks for ${[...new Set(rows.map(r => r.game_date))].join(", ")} (dups ignored)`);
  } catch (e) {
    console.error(`[Tracker] ${league} record exception:`, e.message);
  }
}
// WZ-FBALL-CFB-SHADOW-2026-07-17 :: per-league wrappers. NFL preserves the existing call site exactly.
async function recordNFLPredictions(slate) { return recordFootballPredictions(slate, "nfl"); }
async function recordCFBPredictions(slate) { return recordFootballPredictions(slate, "cfb"); }

// ── GRADE ─────────────────────────────────────────────────────────────────────
// Finds pending predictions for finished games and marks them. MLB is graded
// from team scores via the schedule; NBA props from each player's gamelog.
async function gradeFinishedGames() {
  const supabase = db();

  // WZ-GRADE-PAGINATE-2026-07-19 :: THE PENDING FETCH WAS CAPPED AT 1,000 ROWS.
  // This was `.select("*").eq("result","pending")` with no .range(), so Supabase returned at most
  // its default 1,000 rows. Every row past that cap was invisible to this function -- and because
  // an unordered PostgREST read tends to come back in a stable internal order, it was the SAME rows
  // that stayed invisible on every single run. That is a starvation bug, not a slow queue: a row
  // beyond the cap is never graded, no matter how many times the cron fires. It is the leading
  // explanation for the >7-day pending row (queue item 5) and it is the same failure family as the
  // /totalsbias cursor that never advanced.
  //
  // .range() is only correct with a deterministic ORDER BY -- without one, rows can shift between
  // pages and get skipped or double-read. Ordering by the table's own composite unique key
  // (game_date, game_id, market, selection -- the onConflict target used by every upsert in this
  // file) makes paging total and stable. game_date ascending also means the OLDEST pending rows are
  // read first, so anything that has been starved gets seen before anything fresh.
  //
  // MAX_PAGES is a runaway guard only. Hitting it means something is badly wrong upstream (grading
  // is failing to flip rows out of pending, so the backlog grows without bound); it is loud on
  // purpose rather than silently truncating the way the old code did.
  const PAGE = 1000;
  const MAX_PAGES = 50;
  async function fetchAllPaged(build, label) {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await build()
        .order("game_date", { ascending: true })
        .order("game_id", { ascending: true })
        .order("market", { ascending: true })
        .order("selection", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) { console.error(`[Tracker] ${label} fetch error:`, error.message); return null; }
      const batch = data || [];
      out.push(...batch);
      if (batch.length < PAGE) return out;
      if (page === MAX_PAGES - 1) {
        console.error(`[Tracker] ${label} fetch hit MAX_PAGES (${MAX_PAGES * PAGE} rows) -- backlog is not draining, rows are being left ungraded.`);
      }
    }
    return out;
  }

  const pendingRows = await fetchAllPaged(
    () => supabase.from("model_predictions").select("*").eq("result", "pending"),
    "grade"
  );
  if (pendingRows == null) return; // fetch failed; preserve the original early-return behaviour

  const nbaPending = pendingRows.filter(p => p.league === "nba");
  const nflPending = pendingRows.filter(p => p.league === "nfl");
  const cfbPending = pendingRows.filter(p => p.league === "cfb"); // WZ-FBALL-CFB-SHADOW-2026-07-17
  const mlbPending = pendingRows.filter(p => p.league !== "nba" && p.league !== "nfl" && p.league !== "cfb");

  // Backfill: HR props were previously stamped "push" (no-action) because grading
  // couldn't read per-player HRs. Now that it can, re-grade recent ones. They flip
  // to win/loss and leave this set, so after the first pass it self-empties.
  const backfillCutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  // WZ-GRADE-PAGINATE-2026-07-19 :: same 1,000-row cap applied here. This one is bounded to 30 days
  // so it is far less likely to overflow, but it is the identical defect in the identical function
  // and leaving it would be a bandage.
  const hrPush = await fetchAllPaged(
    () => supabase
      .from("model_predictions")
      .select("*")
      .eq("league", "mlb")
      .eq("market", "hr_prop")
      .eq("result", "push")
      .gte("game_date", backfillCutoff),
    "HR backfill"
  );
  if (hrPush && hrPush.length) {
    mlbPending.push(...hrPush);
    console.log(`[Tracker] Re-grading ${hrPush.length} previously no-actioned HR props`);
  }

  let graded = 0;
  graded += await gradeMlb(supabase, mlbPending);
  graded += await gradeNba(supabase, nbaPending);
  graded += await gradeNFL(supabase, nflPending);
  graded += await gradeCFB(supabase, cfbPending); // WZ-FBALL-CFB-SHADOW-2026-07-17

  // WZ-CLOSINGLINE-RESULTS-2026-07-06 :: stamp final score + winner into the league-wide
  // closing_lines ledger so base-rate backtests (does a -175 fav actually win? do juiced overs
  // hit?) can run once volume accumulates. Fully isolated -- wrapped so a failure here can NEVER
  // affect grading or CLV.
  try { await backfillClosingLineResults(supabase); } catch (e) { console.error("[ClosingLines] result backfill error:", e.message); }

  console.log(`[Tracker] Graded ${graded} predictions`);
  return graded;
}

// WZ-CLOSINGLINE-RESULTS-2026-07-06 :: backfill final score + winner into closing_lines rows that
// don't have an outcome yet. League-wide (every captured game, not just our picks), so the ledger
// can power true base rates. Resolves scores the SAME way grading does: trust a clean schedule
// final, else consult the authoritative feed; a past game that never finaled (postponed/cancelled)
// is marked 'void' so it stops retrying and is excluded from base rates. MLB StatsAPI only -- no
// Odds API credits. Idempotent: only touches rows where winner IS NULL; bounded to the last 45 days.
async function backfillClosingLineResults(supabase) {
  const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  const today = getEasternDate(0);
  const { data: rows, error } = await supabase
    .from("closing_lines")
    .select("game_date, game_id, away_team, home_team")
    .is("winner", null)
    .gte("game_date", since)
    .lte("game_date", today);
  if (error) { console.error("[ClosingLines] backfill fetch error:", error.message); return; }
  if (!rows || !rows.length) return;

  const byDate = {};
  for (const r of rows) (byDate[r.game_date] ||= []).push(r);

  const updates = [];
  for (const [date, dateRows] of Object.entries(byDate)) {
    let schedule;
    try { schedule = await getScheduleForDate(date); }
    catch (e) { console.error(`[ClosingLines] schedule fetch failed for ${date}:`, e.message); continue; }
    const gameById = {};
    for (const g of schedule) gameById[g.id] = g;

    for (const r of dateRows) {
      const g = gameById[r.game_id];
      let aS = null, hS = null;
      if (g && g.status === "final" && g.awayScore != null && g.homeScore != null) {
        aS = g.awayScore; hS = g.homeScore;
      } else {
        let auth = null;
        try { auth = await getGameStatusAndScore(r.game_id); } catch (_) { auth = null; }
        if (!auth || !auth.ok) continue; // feed unreadable -> retry next run
        if (auth.abstractGameState === "Final" && auth.awayRuns != null && auth.homeRuns != null) {
          aS = auth.awayRuns; hS = auth.homeRuns;
        } else {
          const past = r.game_date < today;
          const ds = auth.detailedState || "";
          if (past && (auth.abstractGameState === "Preview" || ds === "Postponed" || ds === "Cancelled")) {
            updates.push({ game_date: r.game_date, game_id: r.game_id, winner: "void" });
          }
          continue; // in-progress / suspended / future -> leave pending, retry next run
        }
      }
      if (aS == null || hS == null) continue;
      const winner = aS > hS ? r.away_team : hS > aS ? r.home_team : "push";
      updates.push({ game_date: r.game_date, game_id: r.game_id, final_away: aS, final_home: hS, winner });
    }
  }

  if (updates.length) {
    const { error: upErr } = await supabase
      .from("closing_lines")
      .upsert(updates, { onConflict: "game_date,game_id" });
    if (upErr) console.error("[ClosingLines] backfill upsert failed:", upErr.message);
    else console.log(`[ClosingLines] backfilled results for ${updates.length} games`);
  }
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
      if (p.market === "player_strikeouts" || p.market === "player_strikeouts_shadow") {
        // Per-pitcher Ks (and IP) from the official boxscore; cache one fetch per game.
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
        // Actual IP (true decimal) for the same pitcher, via the parallel ips map. resolveK
        // is a generic name→number matcher, so it resolves IP with identical matching to Ks.
        const ipRes = box.ips ? resolveK(box.ips, pname) : { k: null };
        const actualIp = ipRes && ipRes.k != null ? ipRes.k : null;
        if (p.line != null && k === p.line) outcome = { result: "push", actual: k, actualIp };
        else {
          const over = k > (p.line ?? 0);
          const win = side === "OVER" ? over : !over;
          outcome = { result: win ? "win" : "loss", actual: k, actualIp };
        }
      } else if (p.market === "player_hits" || p.market === "player_hits_shadow") {
        // WZ-HITSSHADOW-REC-2026-07-02 :: shadow grades identically to live hits picks
        // (same boxscore read, same matcher). actual_ip carries the batter's actual
        // AT-BATS (the K shadow's IP pattern) so the shadow decomposes AB vs rate.
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
        const abRes = box.abs ? resolvePlayerStat(box.abs, pname) : { found: false, value: null };
        const actualIp = abRes && abRes.found && abRes.value != null ? abRes.value : null;
        if (p.line != null && value === p.line) outcome = { result: "push", actual: value, actualIp };
        else {
          const over = value > (p.line ?? 0);
          const win = side === "OVER" ? over : !over;
          outcome = { result: win ? "win" : "loss", actual: value, actualIp };
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

      const upd = { result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() };
      if (outcome.actualIp != null) upd.actual_ip = outcome.actualIp;
      const { error: upErr } = await supabase
        .from("model_predictions")
        .update(upd)
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
// NFL grading — team markets only (ML/spread/total), settled off ESPN final scores.
// Unlike NBA, the stored game_id is the Odds-API event id, which does NOT match the
// ESPN scoreboard id, so we match by TEAM NAME + DATE (±1 for UTC/ET bucketing).
// Reuses the pure gradeNbaTeam outcome logic (market-agnostic team grading).
// WZ-FBALL-CFB-SHADOW-2026-07-17 :: generalized over the scoreboard source. NFL and CFB grade
// identically (same board shape: home/away.displayName, state, score); only the fetcher differs.
async function gradeFootball(supabase, pending, fetchBoard) {
  if (!pending.length) return 0;
  let graded = 0;
  const TEAM = new Set(["moneyline", "spread", "total"]);
  const normTeam = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const sbCache = {};
  const boardFor = async (date) => {
    if (sbCache[date] !== undefined) return sbCache[date];
    try { sbCache[date] = await fetchBoard(date); }
    catch (e) { sbCache[date] = null; } // transient → retry next run
    return sbCache[date];
  };
  for (const p of pending) {
    const baseMarket = String(p.market || "").replace(/_shadow$/, ""); // WZ-FBALL-SLATE-SHADOW-2026-07-17 :: grade the full-slate *_shadow rows too
    if (!TEAM.has(baseMarket)) continue;
    const parts = String(p.matchup || "").split(" @ ");
    if (parts.length !== 2) continue;            // need "Away @ Home" to match by name
    const awayN = normTeam(parts[0]), homeN = normTeam(parts[1]);
    if (!awayN || !homeN) continue;
    let g = null;
    for (const d of [p.game_date, shiftYmd(p.game_date, -1), shiftYmd(p.game_date, 1)]) {
      const games = await boardFor(d);
      g = (games || []).find(x => x.home && x.away &&
        normTeam(x.home.displayName) === homeN && normTeam(x.away.displayName) === awayN);
      if (g) break;
    }
    if (!g || g.state !== "post") continue;       // not found / not final → stay pending
    const hs = g.home?.score, as = g.away?.score;
    if (hs == null || as == null) continue;
    const outcome = gradeNbaTeam({ ...p, market: baseMarket }, hs, as); // pure team-market grader, reused (base market so *_shadow settles)
    if (!outcome) continue;
    const { error: upErr } = await supabase
      .from("model_predictions")
      .update({ result: outcome.result, actual_value: outcome.actual, graded_at: new Date().toISOString() })
      .eq("id", p.id);
    if (!upErr) graded++;
  }
  return graded;
}
// WZ-FBALL-CFB-SHADOW-2026-07-17 :: per-league grader wrappers (each strips _shadow via gradeFootball).
async function gradeNFL(supabase, pending) { return gradeFootball(supabase, pending, fetchNflScoreboard); }
async function gradeCFB(supabase, pending) { return gradeFootball(supabase, pending, fetchCfbScoreboard); }

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
  // WZ-SLATE-SHADOW-2026-07-10 :: *_shadow team markets grade identically to
  // their real market -- strip the suffix and re-dispatch. Rows stay distinct
  // in the DB (market string is unchanged there); only grading logic is shared.
  if (typeof p.market === "string" && p.market.endsWith("_shadow")) {
    return gradeOne({ ...p, market: p.market.slice(0, -7) }, g);
  }
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
  // WZ-PINN-TICKS-2026-07-13 :: also snapshot Pinnacle (the sharp book) into the SAME odds_ticks
  // table as market="mlbook", side="away@Pinnacle"/"home@Pinnacle", so intraday sharp-book movement
  // accrues alongside the soft books -> enables reverse-line-movement / sharp-side detection later.
  // Cache-respecting (shares the CLV pinnacle-close cache) -> ~no extra API credits. Pre-game only,
  // same team-name keying and in-play skip as the soft-book snapshots above. Fail-safe: a Pinnacle
  // hiccup never blocks the soft-book ticks from saving.
  try {
    const pinEvents = await getMLBPinnacleClose();
    for (const ev of (pinEvents || [])) {
      const pa = ev.awayTeam, ph = ev.homeTeam;
      if (!pa || !ph) continue;
      if (ev.commenceTime && new Date(ev.commenceTime).getTime() <= Date.now()) continue;
      const pbase = { captured_at: now, away_team: pa, home_team: ph };
      if (ev.h2h && ev.h2h.away != null) rows.push({ ...pbase, market: "mlbook", side: "away@Pinnacle", line: null, odds: ev.h2h.away });
      if (ev.h2h && ev.h2h.home != null) rows.push({ ...pbase, market: "mlbook", side: "home@Pinnacle", line: null, odds: ev.h2h.home });
    }
  } catch (e) { console.error("[Ticks] pinnacle snapshot skipped:", e.message); }

  if (!rows.length) return 0;
  const { error } = await supabase.from("odds_ticks").insert(rows);
  if (error) { console.error("[Ticks] insert failed:", error.message); return 0; }
  // Keep ~4 days of history so the table stays small.
  try { await supabase.from("odds_ticks").delete().lt("captured_at", new Date(Date.now() - 4 * 864e5).toISOString()); } catch (_) {}
  console.log(`[Ticks] saved ${rows.length} odds snapshots`);
  return rows.length;
}

// Retire DNP / scratched prop picks as no-action (push). A finished-game prop whose
// player never recorded a plate appearance (or a pitcher who never took the mound) can
// NEVER grade — the official box simply has no row for them. gradeFinishedGames()
// deliberately leaves these pending (it refuses to false-loss a missing player), so
// without this sweep they pile up as "stuck pending" forever. This is the SINGLE source
// of that logic, called by BOTH the hourly grading cron and the manual /api/grade-now
// ?void_unmatched=1 endpoint — so a newly-added prop market can never again be covered
// in one place but not the other (that gap is what stranded the TB-shadow rows).
//
// Conservative + idempotent: only voids when the game is FINAL, the box read SUCCEEDS,
// and the player is provably absent. Unreadable boxes are left pending to retry; any
// player who is present grades normally and is never touched. Covers every recorded
// prop market — extend PROP here (one place) when a new prop market starts recording.
const VOID_PROP_MARKETS = new Set(["hr_prop", "player_strikeouts", "player_strikeouts_shadow", "player_hits", "player_hits_shadow", "player_total_bases_shadow"]); // WZ-HITSSHADOW-REC-2026-07-02

async function voidUnmatchedProps() {
  const supabase = db();

  const { data: pendingAll, error } = await supabase
    .from("model_predictions")
    .select("id,league,market,selection,game_id,game_date,result")
    .eq("result", "pending");
  if (error) { console.error("[VoidSweep] fetch failed:", error.message); return { finalPropsChecked: 0, voided: 0, details: [] }; }

  const props = (pendingAll || []).filter(p => p.league !== "nba" && VOID_PROP_MARKETS.has(p.market));
  if (!props.length) return { finalPropsChecked: 0, voided: 0, details: [] };

  const byDate = {};
  for (const p of props) (byDate[p.game_date] ||= []).push(p);

  const schedCache = {};
  const boxCache = new Map();
  let voided = 0, finalChecked = 0;
  const details = [];

  for (const [date, preds] of Object.entries(byDate)) {
    if (!schedCache[date]) {
      try { const sgs = await getScheduleForDate(date); const m = {}; for (const g of sgs) m[String(g.id)] = g; schedCache[date] = m; }
      catch { schedCache[date] = {}; }
    }
    const sched = schedCache[date];
    for (const p of preds) {
      const g = sched[String(p.game_id)];
      if (!g || g.status !== "final") continue;        // only final games
      finalChecked++;

      const key = `${p.market}:${p.game_id}`;
      let box;
      if (boxCache.has(key)) box = boxCache.get(key);
      else {
        try {
          // WZ-VOID-KSHADOW-2026-07-19 :: player_strikeouts_shadow had NO branch here and fell
          // through to getGameHRHitters() -- the home-run box. This did not fail loudly; it failed
          // by SUCCEEDING WRONGLY, which is why it survived. getGameHRHitters() adds an entry for
          // any player carrying a `stats.batting` object, and MLB boxscores hand pitchers one too
          // (usually empty), so a pitcher lands in the HR map with a value of 0. resolvePlayerStat()
          // reports found=true on mere PRESENCE in the map, whatever the value. So the sweep looked
          // up a K-shadow pitcher, "found" him among the home-run hitters, hit `if (found) continue`
          // -- read as "this will grade normally, don't void it" -- and walked away. Meanwhile the
          // real grading path (line ~1461, which has always handled `player_strikeouts` and
          // `player_strikeouts_shadow` together) looked in the pitcher-K box, where a scratched or
          // never-used starter has no line at all, and left the row pending. Deadlock: the sweep
          // deferred to grading, grading could not act, and nothing ever moved the row.
          // Observed 2026-07-19: one row stuck 15 days -- Kumar Rocker OVER, DET @ TEX 2026-07-04,
          // game 822882 confirmed Final in the schedule with doubleHeader "N", so every other gate
          // in this sweep passed. The hits and total-bases shadows each got a branch when they were
          // added; this one did not. Routing it to the pitcher-K box means a pitcher who never threw
          // is genuinely absent -> found=false -> voided as a no-action push, via the correct path.
          if (p.market === "player_strikeouts" || p.market === "player_strikeouts_shadow") box = await getGamePitcherStrikeouts(p.game_id);
          else if (p.market === "player_hits" || p.market === "player_hits_shadow") box = await getGameBatterHits(p.game_id);
          else if (p.market === "player_total_bases_shadow") box = await getGameBatterTotalBases(p.game_id);
          else box = await getGameHRHitters(p.game_id);
        } catch { box = { ok: false }; }
        boxCache.set(key, box);
      }
      if (!box || !box.ok) continue;                    // unreadable → leave pending, retry later

      const map = box.hits || box.ks || box.tb || box.hr;
      const ci = p.selection.lastIndexOf(":");
      const pname = (p.market === "hr_prop") ? p.selection : (ci >= 0 ? p.selection.slice(0, ci) : p.selection);
      const found = (p.market === "hr_prop") ? resolveHR(map, pname).found : resolvePlayerStat(map, pname).found;
      if (found) continue;                              // would grade normally → don't void

      const { error: upErr } = await supabase
        .from("model_predictions")
        .update({ result: "push", actual_value: null, graded_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) { voided++; details.push({ market: p.market, game_id: String(p.game_id), selection: p.selection }); }
    }
  }
  return { finalPropsChecked: finalChecked, voided, details };
}

module.exports = { recordPredictions, recordTotalBasesShadow, recordStrikeoutShadow, recordHitsShadow, recordNbaPropPredictions, recordNbaTeamPredictions, recordNFLPredictions, recordCFBPredictions, gradeFinishedGames, gradeNbaProp, captureClosingLines, captureNbaClosingLines, captureOddsTicks, voidUnmatchedProps };
