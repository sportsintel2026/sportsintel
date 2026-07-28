// researchBackfill.js :: WZ-RESEARCH-BACKFILL-2026-07-28
// Research-only historical MLB closing-line backfill into research_mlb_closing.
//
// NOT a production path: nothing that serves a customer imports this module, and no
// production code reads research_mlb_closing. It is driven solely by a low-frequency cron
// in server.js and is completely inert unless RESEARCH_BACKFILL_ENABLED === 'true'.
//
// It pulls The Odds API HISTORICAL endpoint, which bills ~10 credits per market per region
// per call, so it is hard-capped: at most MAX_CALLS Odds API calls per run, exactly ONE
// game_date per run, and it aborts the batch the instant x-requests-remaining drops below
// MIN_CREDITS. The enabled flag is checked FIRST — before any network or DB call — so a
// deploy with the flag unset does nothing at all.
//
// CURSOR: a single-row state table research_backfill_state (id=1) holds last_processed_date.
// Each run processes last_processed_date + 1 day, then advances the cursor to that date
// UNCONDITIONALLY — whether or not the date yielded rows — so offseason days, rainouts, and
// coverage gaps move forward instead of stalling (which a max(game_date) cursor could not).
// The one exception is a credit-floor abort: that date is only partially written, so the
// cursor is left unchanged and the date is retried next run. If the state row is missing the
// batch refuses to run rather than invent a start date.

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// Read the key EXACTLY as oddsApi.js does: module-level, straight from env, never logged.
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_BASE = "https://api.the-odds-api.com/v4";

const RANGE_END = "2025-10-01";
const MAX_CALLS = 12;                 // hard cap on Odds API calls per run
const MIN_CREDITS = 100000;           // abort the batch if x-requests-remaining drops below this
const SNAPSHOT_COUNT = 11;            // hourly snapshots 16:00Z .. 02:00Z next day
const SNAPSHOT_START_HOUR_UTC = 16;

function addDaysUTC(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// ET calendar date of an instant — a 7pm ET game stays on its ET day, not the next UTC day.
function etDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// The 11 hourly snapshot instants for a processing date: D 16:00Z through D+1 02:00Z.
function snapshotTimes(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d, SNAPSHOT_START_HOUR_UTC, 0, 0);
  const out = [];
  for (let i = 0; i < SNAPSHOT_COUNT; i++) out.push(new Date(base + i * 3600000));
  return out;
}

function isoZ(dt) { return dt.toISOString().slice(0, 19) + "Z"; }

// Extract insertable rows from one historical snapshot response, for the window (T, T+1h].
function rowsFromSnapshot(payload, T) {
  const snapshotTs = payload && payload.timestamp;    // top-level `timestamp`, NOT next_timestamp
  const games = payload && Array.isArray(payload.data) ? payload.data : [];
  const lo = T.getTime();
  const hi = lo + 3600000;                             // (T, T+1h]
  const rows = [];
  for (const g of games) {
    if (!g || !g.id || !g.commence_time || !g.home_team || !g.away_team) continue;
    if (/League/.test(g.home_team) || /League/.test(g.away_team)) continue; // All-Star exhibitions
    const ct = Date.parse(g.commence_time);
    if (!(ct > lo && ct <= hi)) continue;              // only games commencing in this window
    const books = Array.isArray(g.bookmakers) ? g.bookmakers : [];
    if (!books.length) continue;                        // skip games with no bookmakers
    const gameDate = etDate(g.commence_time);
    for (const b of books) {
      if (!b || !b.key) continue;
      const totals = Array.isArray(b.markets) ? b.markets.find((mk) => mk && mk.key === "totals") : null;
      if (!totals || !Array.isArray(totals.outcomes)) continue; // no totals market
      const over = totals.outcomes.find((o) => o && o.name === "Over");
      const under = totals.outcomes.find((o) => o && o.name === "Under");
      const point = over && over.point != null ? over.point
                  : under && under.point != null ? under.point : null;
      if (point == null) continue;                      // missing point → skip this bookmaker
      rows.push({
        odds_game_id: String(g.id),
        commence_time: g.commence_time,
        game_date: gameDate,
        home_team: g.home_team,
        away_team: g.away_team,
        snapshot_ts: snapshotTs,
        bookmaker: b.key,
        total_line: point,
        over_price: over && over.price != null ? over.price : null,
        under_price: under && under.price != null ? under.price : null,
        // final_home / final_away / mlb_game_pk intentionally left NULL (backfilled later).
      });
    }
  }
  return rows;
}

// One batch: process a single game_date, then stop. Returns a small summary object.
async function runBackfillBatch() {
  // Gate FIRST — before any network or DB call. Inert unless explicitly enabled.
  if (process.env.RESEARCH_BACKFILL_ENABLED !== "true") return { skipped: "disabled" };
  if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY not configured");

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Cursor: single-row state table (research_backfill_state, id=1) holds last_processed_date.
  // Target = that date + 1 day. Missing row → refuse to run (do not invent a start date).
  const { data: state, error: cursorErr } = await supabase
    .from("research_backfill_state")
    .select("last_processed_date")
    .eq("id", 1)
    .limit(1);
  if (cursorErr) throw new Error(`cursor read failed: ${cursorErr.message}`);
  const lastProcessed = state && state[0] && state[0].last_processed_date
    ? String(state[0].last_processed_date).slice(0, 10) : null;
  if (!lastProcessed) {
    console.error("[research] research_backfill_state row (id=1) is missing — refusing to invent a start date. Seed it first.");
    return { error: "state row missing" };
  }
  const processDate = addDaysUTC(lastProcessed, 1);

  if (processDate > RANGE_END) {
    console.log(`[research] backfill complete — cursor ${processDate} is past ${RANGE_END}; nothing to do.`);
    return { done: true, processDate };
  }

  const times = snapshotTimes(processDate);
  const rows = [];
  let calls = 0;
  let creditsRemaining = null;
  let stoppedForCredits = false;

  for (const T of times) {
    if (calls >= MAX_CALLS) break;                      // hard call cap
    calls++;
    try {
      const res = await axios.get(`${ODDS_BASE}/historical/sports/baseball_mlb/odds`, {
        params: {
          apiKey: ODDS_API_KEY, regions: "us", markets: "totals",
          oddsFormat: "american", date: isoZ(T),
        },
        timeout: 15000,
      });
      const rem = res.headers["x-requests-remaining"];
      if (rem != null) creditsRemaining = Number(rem);
      for (const r of rowsFromSnapshot(res.data, T)) rows.push(r);
    } catch (e) {
      // Never log the request URL — it carries the key. Status/message only.
      const status = e && e.response && e.response.status;
      console.error(`[research] snapshot ${isoZ(T)} failed${status ? ` (HTTP ${status})` : ""}: ${e && e.message ? e.message : e}`);
    }
    // Read remaining credits after every call; abort the batch immediately if it runs low.
    if (creditsRemaining != null && creditsRemaining < MIN_CREDITS) {
      stoppedForCredits = true;
      console.warn(`[research] STOP: x-requests-remaining ${creditsRemaining} < ${MIN_CREDITS}; aborting batch after ${calls} call(s).`);
      break;
    }
  }

  let inserted = 0;
  if (rows.length) {
    const { data, error } = await supabase
      .from("research_mlb_closing")
      .upsert(rows, { onConflict: "odds_game_id,bookmaker,snapshot_ts", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`insert failed: ${error.message}`);
    inserted = Array.isArray(data) ? data.length : 0;
  }

  // Advance the cursor UNLESS the batch aborted on the credit floor — a credit-floor abort leaves
  // this date only partially written, so we hold the cursor and retry it next run. Otherwise
  // advance UNCONDITIONALLY: a zero-row date (offseason, rainout, coverage gap) still moves forward.
  // That is the whole point of the state table.
  let advanced = false;
  if (!stoppedForCredits) {
    const { error: advErr } = await supabase
      .from("research_backfill_state")
      .update({ last_processed_date: processDate, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (advErr) throw new Error(`cursor advance failed: ${advErr.message}`);
    advanced = true;
  }

  console.log(`[research] date=${processDate} calls=${calls} rowsInserted=${inserted} creditsRemaining=${creditsRemaining != null ? creditsRemaining : "n/a"} cursorAdvanced=${advanced}${stoppedForCredits ? " (stopped: low credits — cursor held)" : ""}`);
  return { processDate, calls, inserted, creditsRemaining, stoppedForCredits, advanced };
}

module.exports = { runBackfillBatch };
