// researchBullpen.js :: WZ-RESEARCH-BULLPEN-2026-07-29
// Research-only bullpen-fatigue feature for research_mlb_closing's scored games. For each
// (team_id, game_date) it records how hard that team's BULLPEN worked the PRIOR day(s) -- the
// fatigue a tired pen carries into a game -- so it can be tested against the totals residual
// (actual_total - closing_line).
//
// NOT a production path: nothing customer-facing imports this module or reads its table. It
// READS research_mlb_closing (SELECT only, to learn which scored games exist) and WRITES only
// research_bullpen_state. It never touches model_predictions or any customer table. Inert
// unless RESEARCH_BULLPEN_ENABLED === 'true', checked FIRST before any network or DB call.
//
// SOURCE (MLB StatsAPI, free, no key): to minimise calls we do NOT pull one boxscore per game
// (~13k). Per team-season we enumerate the fullSeason roster once, then pull each pitcher's
// SEASON gameLog once -- every appearance (date, inningsPitched, numberOfPitches, gamesStarted,
// team) in a single response. Relief appearances (gamesStarted !== 1) are attributed to the team
// the pitcher threw for THAT game (split.team.id), so mid-season trades land on the right side.
//
// BATCH: one run processes up to MAX_TEAM_SEASONS team-seasons (or until MAX_MS elapses),
// skipping any team-season already present in research_bullpen_state. Idempotent -- the upsert is
// ON CONFLICT (team_id, game_date) DO NOTHING, so a re-run (or crash-and-retry) is safe.

const { createClient } = require("@supabase/supabase-js");

const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const SEASON_START = 2020;
const SEASON_END = 2025;
const MAX_TEAM_SEASONS = 3;          // team-seasons per run (keeps a run well under the cron gap)
const MAX_MS = 55 * 1000;            // wall-clock budget per run
const REQUEST_TIMEOUT_MS = 15000;

// StatsAPI is keyless; plain GET + short timeout. Returns parsed JSON or throws.
async function mlbGet(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MLB_BASE}${path}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`StatsAPI ${res.status} for ${path}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// "4.2" (4 innings + 2 outs) -> outs. "0.1" -> 1, "1.0" -> 3, "" -> 0.
function ipToOuts(ip) {
  const s = String(ip == null ? "" : ip);
  const dot = s.indexOf(".");
  const whole = parseInt(dot < 0 ? s : s.slice(0, dot), 10) || 0;
  const frac = dot < 0 ? 0 : (parseInt(s.slice(dot + 1), 10) || 0);
  return whole * 3 + frac;
}

function addDaysUTC(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

// One batch. Returns a small summary object.
async function runBullpenBatch() {
  // Gate FIRST -- before any network or DB call. Inert unless explicitly enabled.
  if (process.env.RESEARCH_BULLPEN_ENABLED !== "true") return { skipped: "disabled" };

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const startedAt = Date.now();

  // Name<->id bridge (30 clubs). team_id is season-stable and is what roster/gameLog use.
  // Cleveland is queried under BOTH its historical and current names (both -> id 114).
  const teamsResp = await mlbGet(`/teams?sportId=1`);
  const idToName = {};
  for (const t of (teamsResp.teams || [])) if (t && t.id) idToName[t.id] = t.name;
  const teamIds = Object.keys(idToName).map(Number).sort((a, b) => a - b);
  const candidateNames = (teamId) =>
    teamId === 114 ? ["Cleveland Guardians", "Cleveland Indians"] : [idToName[teamId]];

  const glCache = new Map();   // "personId|season" -> splits[] (within-run dedup)
  let processed = 0, rowsWritten = 0;
  const doneList = [];

  outer:
  for (let season = SEASON_START; season <= SEASON_END; season++) {
    for (const teamId of teamIds) {
      if (processed >= MAX_TEAM_SEASONS || Date.now() - startedAt >= MAX_MS) break outer;

      // Idempotent resume: skip a team-season already backfilled.
      const { count, error: cErr } = await supabase
        .from("research_bullpen_state")
        .select("id", { head: true, count: "exact" })
        .eq("team_id", teamId).eq("season", season);
      if (cErr) throw new Error(`state existence check failed: ${cErr.message}`);
      if (count && count > 0) continue;

      // Target game_dates: SCORED research_mlb_closing games for this team-season (READ ONLY).
      const names = candidateNames(teamId);
      const lo = `${season}-01-01`, hi = `${season}-12-31`;
      const dates = new Set();
      for (const side of ["home_team", "away_team"]) {
        const { data, error } = await supabase
          .from("research_mlb_closing")
          .select("game_date")
          .not("final_home", "is", null)
          .in(side, names)
          .gte("game_date", lo).lte("game_date", hi);
        if (error) throw new Error(`research_mlb_closing read failed: ${error.message}`);
        for (const r of (data || [])) dates.add(String(r.game_date).slice(0, 10));
      }
      if (dates.size === 0) continue; // team-season not represented in the dataset

      // Roster -> pitcher personIds for this team-season.
      let roster;
      try { roster = await mlbGet(`/teams/${teamId}/roster?season=${season}&rosterType=fullSeason`); }
      catch (e) { console.error(`[bullpen] roster failed ${teamId}/${season}: ${e.message}`); continue; }
      const pitcherIds = (roster.roster || [])
        .filter((p) => p && p.position && (p.position.code === "1" || p.position.type === "Pitcher"))
        .map((p) => p.person && p.person.id).filter(Boolean);

      // Per-date usage for THIS team. `appeared` = every pitcher who threw that day in ANY role
      // (so a prior-day STARTER is correctly not counted as a rested arm). `relievers` = relief
      // appearances only (gamesStarted !== 1), attributed by each gameLog split's own team.id so
      // traded pitchers land on the right side.
      const byDate = new Map(); // date -> { appeared:Set, relievers:Set, outs, pitches }
      for (const pid of pitcherIds) {
        const ck = pid + "|" + season;
        let splits = glCache.get(ck);
        if (!splits) {
          try {
            const gl = await mlbGet(`/people/${pid}/stats?stats=gameLog&group=pitching&season=${season}`);
            splits = (gl.stats && gl.stats[0] && gl.stats[0].splits) || [];
          } catch (e) { console.error(`[bullpen] gameLog failed ${pid}/${season}: ${e.message}`); splits = []; }
          glCache.set(ck, splits);
        }
        for (const s of splits) {
          if (!s) continue;
          const splitTeamId = s.team && s.team.id ? s.team.id : teamId; // fallback: roster team
          if (splitTeamId !== teamId) continue;                         // correct side of a trade
          const date = String(s.date || "").slice(0, 10);
          if (!date) continue;
          let e = byDate.get(date);
          if (!e) { e = { appeared: new Set(), relievers: new Set(), outs: 0, pitches: 0 }; byDate.set(date, e); }
          e.appeared.add(pid);
          const st = s.stat || {};
          if (Number(st.gamesStarted) === 1) continue;                  // exclude the starter -- bullpen only
          e.relievers.add(pid);
          e.outs += ipToOuts(st.inningsPitched);
          e.pitches += Number(st.numberOfPitches) || 0;
        }
      }

      // One row per target game_date: PRIOR-day (D-1) usage + back-to-back (D-1 ∩ D-2) + rested arms.
      const EMPTY = { appeared: new Set(), relievers: new Set(), outs: 0, pitches: 0 };
      const rows = [];
      for (const D of dates) {
        const d1 = byDate.get(addDaysUTC(D, -1)) || EMPTY;
        const d2 = byDate.get(addDaysUTC(D, -2)) || EMPTY;
        let b2b = 0; for (const pid of d1.relievers) if (d2.relievers.has(pid)) b2b++;
        // rested = roster pitchers who threw on NEITHER prior day (in any role) -- what's LEFT in
        // the pen. Derived from the fullSeason roster, so it over-counts season-long arms not
        // actually available on this date (traded/DFA'd/not-yet-called-up) -- a coarse proxy.
        let rested = 0; for (const pid of pitcherIds) if (!d1.appeared.has(pid) && !d2.appeared.has(pid)) rested++;
        rows.push({
          team_id: teamId, team_name: idToName[teamId], game_date: D, season,
          prior_date: addDaysUTC(D, -1),
          relievers_used: d1.relievers.size,
          reliever_innings: Math.round((d1.outs / 3) * 10) / 10,
          reliever_pitches: d1.pitches,
          b2b_relievers: b2b,
          rested_relievers: rested,
        });
      }

      const { data: ins, error: upErr } = await supabase
        .from("research_bullpen_state")
        .upsert(rows, { onConflict: "team_id,game_date", ignoreDuplicates: true })
        .select("id");
      if (upErr) throw new Error(`bullpen upsert failed ${teamId}/${season}: ${upErr.message}`);
      const wrote = Array.isArray(ins) ? ins.length : 0;
      rowsWritten += wrote;
      console.log(`[bullpen] team=${teamId} (${idToName[teamId]}) season=${season} games=${dates.size} pitchers=${pitcherIds.length} rowsInserted=${wrote}`);
      doneList.push(`${teamId}:${season}`);
      processed++;
    }
  }

  return { processed, rowsWritten, teamSeasons: doneList };
}

module.exports = { runBullpenBatch };
