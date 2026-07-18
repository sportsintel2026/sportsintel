// services/calibrationGuard.js -- WZ-CALIB-GUARD-2026-07-17
// Standing calibration guard. It reads the SAME graded model_predictions the calibprobe reads,
// measures claimed-vs-actual win% in each MLB market's CONFIDENT bands (model_prob >= 0.55 -- the
// side the board actually features), and AUTO-BENCHES any market that is both well-sampled and
// meaningfully overconfident. edges.js calls isBenched(market) to empty a benched market from BOTH
// the shown board and the graded record (board == record). This exists so an overconfident market
// can never again sit parked and silently bleed until a manual nightly audit happens to catch it.
//
// This is a bleed-stopper, not a model fix: a benched market stays off until it is actually
// rebuilt/recalibrated. Fail-safe: on any error the previous status is kept (never auto-unbenches
// on a transient failure).
const { createClient } = require("@supabase/supabase-js");

const CORE = ["moneyline", "total", "run_line"];

// Mirrors performance.js afterCoreReset -- each market's model reset cutoff. Keep in sync if a
// reset moves. Calibration is measured only on picks on/after the market's reset (current model).
const RESETS = { moneyline: "2026-07-08", total: "2026-07-02", run_line: "2026-07-02" };

// MANUAL benches: markets we KNOW are broken and hold off regardless of the live gap, until they
// are rebuilt. run_line: calibration audit 2026-07-17 -- the confident 0.55+ range hit exactly 50%
// on n=94 while the board claimed 58-63%. Off until the run-line model rebuild lands.
const MANUAL_BENCH = new Set(["run_line"]);

// WZ-RL-SHADOW-WATCH-2026-07-17 :: for MANUAL benches, watch the REBUILT model's *_shadow rows and
// auto-RELEASE the market once the rebuilt model proves calibrated on a real sample. `since` = the
// rebuild go-live date (only shadow rows on/after it carry the rebuilt model's numbers). minN +
// gapUnbench = the release gate. Once released, the published guard above governs it normally
// (re-benches it if it later drifts). This gives the shadow TEETH: it triggers the un-bench itself
// instead of sitting parked until a human happens to check.
const SHADOW_WATCH = {
  run_line: { market: "run_line_shadow", since: "2026-07-17", minN: 80, gapUnbench: 4 },
};
const SHADOW_MARKETS = Object.values(SHADOW_WATCH).map((c) => c.market);

// Thresholds. Confident band = model_prob >= 0.55 (the featured/shown side).
const MIN_N = 40;       // require a real settled sample before auto-benching
const GAP_BENCH = 8;    // auto-bench when claimed - actual >= 8 pts
const GAP_UNBENCH = 4;  // hysteresis: only auto-unbench once the gap recovers below 4 pts

let _status = {};       // { market: { benched, gapPts, n, claimedPct, actualPct, updatedAt } }
let _lastError = null;
let _lastRun = null;
let _shadowStatus = {};      // { market: { n, claimedPct, actualPct, gapPts, needN, needGapUnder, released } }
const _released = new Set(); // manual markets released by shadow-watch (self-heals on reboot from live shadow data)

// WZ-FBALL-BENCH-2026-07-17 :: football (NFL/CFB) is SHOWN BY DEFAULT and market-anchored (see the
// launch dial in nflModel/cfbModel — picks hug the sharp line while the model is young). This section
// is a DRIFT CATCHER, not a blackout: it watches each league×market's full-slate *_shadow rows and
// auto-benches ONLY a market that actually goes bad (well-sampled AND claimed-vs-actual gap past the
// threshold), then un-benches on recovery (hysteresis) — exactly how the MLB core markets behave.
const FOOTBALL_LEAGUES = ["nfl", "cfb"];
const FOOTBALL_MARKETS = ["moneyline", "spread", "total"];
const FB_SHADOW = { moneyline: "moneyline_shadow", spread: "spread_shadow", total: "total_shadow" };
const fbKey = (league, market) => `${league}:${market}`;
const FB_MIN_N = 40;        // need a real settled confident-side sample before benching a market
const FB_GAP_BENCH = 8;     // auto-bench when claimed - actual >= 8 pts (drift)
const FB_GAP_UNBENCH = 4;   // hysteresis: un-bench once the gap recovers below 4 pts
let _fbStatus = {};         // { "nfl:spread": { benched, gapPts, n, claimedPct, actualPct } }

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function refreshGuard() {
  const supabase = db();
  if (!supabase) { _lastError = "no supabase client (SUPABASE_URL/SUPABASE_SERVICE_KEY unset)"; return _status; }
  try {
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, model_prob, result, game_date")
        .eq("league", "mlb")
        .in("market", [...CORE, ...SHADOW_MARKETS])
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    const agg = {};
    for (const m of CORE) agg[m] = { n: 0, wins: 0, probSum: 0 };
    for (const r of rows) {
      if (r.result !== "win" && r.result !== "loss") continue;                 // settled only
      if (r.model_prob == null || Number(r.model_prob) < 0.55) continue;       // confident/featured band
      const reset = RESETS[r.market];
      if (reset && r.game_date && String(r.game_date).slice(0, 10) < reset) continue; // since reset
      const a = agg[r.market];
      if (!a) continue;
      a.n++;
      if (r.result === "win") a.wins++;
      a.probSum += Number(r.model_prob);
    }

    const next = {};
    for (const m of CORE) {
      const a = agg[m];
      const claimed = a.n ? (a.probSum / a.n) * 100 : null;
      const actual = a.n ? (a.wins / a.n) * 100 : null;
      const gap = (claimed != null && actual != null) ? Math.round((claimed - actual) * 10) / 10 : null;
      const wasBenched = _status[m] ? _status[m].benched === true : false;
      let benched = wasBenched;
      if (a.n >= MIN_N && gap != null) {
        if (gap >= GAP_BENCH) benched = true;
        else if (gap < GAP_UNBENCH) benched = false;   // hysteresis: recover only when clearly fixed
      }
      next[m] = {
        benched,
        gapPts: gap,
        n: a.n,
        claimedPct: claimed != null ? Math.round(claimed * 10) / 10 : null,
        actualPct: actual != null ? Math.round(actual * 10) / 10 : null,
        updatedAt: new Date().toISOString(),
      };
    }
    _status = next;
    _lastError = null;
    _lastRun = new Date().toISOString();

    // WZ-RL-SHADOW-WATCH-2026-07-17 :: measure the rebuilt model on its shadow rows (manual markets),
    // confident side (>=0.55), since the rebuild date, and release once well-sampled AND calibrated.
    const shadowNext = {};
    for (const m of Object.keys(SHADOW_WATCH)) {
      const cfg = SHADOW_WATCH[m];
      let n = 0, hit = 0, claimSum = 0;
      for (const r of rows) {
        if (r.market !== cfg.market) continue;
        if (r.result !== "win" && r.result !== "loss") continue;
        if (r.model_prob == null) continue;
        if (cfg.since && r.game_date && String(r.game_date).slice(0, 10) < cfg.since) continue; // rebuilt model only
        const mp = Number(r.model_prob);
        const confP = Math.max(mp, 1 - mp);              // featured side's cover prob (shadow logs the home side)
        if (confP < 0.55) continue;                      // confident/featured band only
        const covered = mp >= 0.5 ? (r.result === "win") : (r.result === "loss");
        n++; claimSum += confP; if (covered) hit++;
      }
      const claimed = n ? (claimSum / n) * 100 : null;
      const actual = n ? (hit / n) * 100 : null;
      const gap = (claimed != null && actual != null) ? Math.round((claimed - actual) * 10) / 10 : null;
      const cleared = n >= cfg.minN && gap != null && gap < cfg.gapUnbench;
      if (cleared && !_released.has(m)) {
        _released.add(m);
        console.warn(`[CALIB-GUARD] ${m} RELEASED from manual bench by shadow-watch (n=${n}, gap ${gap}pts, claimed ${claimed.toFixed(1)}% vs actual ${actual.toFixed(1)}%) -- now governed by the live published guard.`);
      }
      shadowNext[m] = {
        shadowMarket: cfg.market, sinceRebuild: cfg.since, n,
        claimedPct: claimed != null ? Math.round(claimed * 10) / 10 : null,
        actualPct: actual != null ? Math.round(actual * 10) / 10 : null,
        gapPts: gap, needN: cfg.minN, needGapUnder: cfg.gapUnbench, released: _released.has(m),
      };
    }
    _shadowStatus = shadowNext;

    // WZ-FBALL-BENCH-2026-07-17 :: football drift catcher. Separate query (nfl/cfb, own *_shadow
    // markets) so it never touches the MLB aggregation. Each league×market is SHOWN unless it's
    // well-sampled AND drifting; then it auto-benches until it recovers. Confident side only.
    try {
      const fbRows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("model_predictions")
          .select("league, market, model_prob, result")
          .in("league", FOOTBALL_LEAGUES)
          .in("market", Object.values(FB_SHADOW))
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const b = data || [];
        fbRows.push(...b);
        if (b.length < PAGE) break;
      }
      const fbAgg = {};
      for (const l of FOOTBALL_LEAGUES) for (const m of FOOTBALL_MARKETS) fbAgg[fbKey(l, m)] = { n: 0, hit: 0, claimSum: 0 };
      for (const r of fbRows) {
        if (r.result !== "win" && r.result !== "loss") continue;
        if (r.model_prob == null) continue;
        const base = String(r.market).replace(/_shadow$/, "");
        const a = fbAgg[fbKey(r.league, base)];
        if (!a) continue;
        const mp = Number(r.model_prob), confP = Math.max(mp, 1 - mp);
        if (confP < 0.55) continue;                     // confident/featured band only
        const covered = mp >= 0.5 ? (r.result === "win") : (r.result === "loss");
        a.n++; a.claimSum += confP; if (covered) a.hit++;
      }
      const fbNext = {};
      for (const k of Object.keys(fbAgg)) {
        const a = fbAgg[k];
        const claimed = a.n ? (a.claimSum / a.n) * 100 : null;
        const actual = a.n ? (a.hit / a.n) * 100 : null;
        const gap = (claimed != null && actual != null) ? Math.round((claimed - actual) * 10) / 10 : null;
        const wasBenched = _fbStatus[k] ? _fbStatus[k].benched === true : false; // default SHOWN
        let benched = wasBenched;
        if (a.n >= FB_MIN_N && gap != null) {
          if (gap >= FB_GAP_BENCH) benched = true;
          else if (gap < FB_GAP_UNBENCH) benched = false;
        }
        if (benched && !wasBenched) console.warn(`[CALIB-GUARD] football ${k} AUTO-BENCHED (gap ${gap}pts, n=${a.n}, claimed ${claimed.toFixed(1)}% vs actual ${actual.toFixed(1)}%) — drifting, held off the board until it recovers.`);
        fbNext[k] = { benched, gapPts: gap, n: a.n, claimedPct: claimed != null ? Math.round(claimed * 10) / 10 : null, actualPct: actual != null ? Math.round(actual * 10) / 10 : null };
      }
      _fbStatus = fbNext;
    } catch (e) {
      console.error("[CALIB-GUARD] football refresh failed:", e.message); // keep previous football status on error
    }

    for (const m of CORE) {
      const s = _status[m];
      if (s.benched && (!MANUAL_BENCH.has(m) || _released.has(m))) {
        console.warn(`[CALIB-GUARD] ${m} AUTO-BENCHED (gap ${s.gapPts}pts, n=${s.n}, claimed ${s.claimedPct}% vs actual ${s.actualPct}%)`);
      }
    }
    return _status;
  } catch (e) {
    _lastError = e.message;
    console.error("[CALIB-GUARD] refresh failed:", e.message);
    return _status; // keep previous status on error -- never auto-unbench on a transient failure
  }
}

// The single source of truth for whether a market is benched (manual OR auto).
function isBenched(market, league) {
  // WZ-FBALL-BENCH-2026-07-17 :: football is namespaced league:market and SHOWN by default — benched
  // only if the drift catcher flagged it. The MLB path (no league arg) is unchanged.
  if (league && FOOTBALL_LEAGUES.includes(league)) {
    const s = _fbStatus[fbKey(league, market)];
    return !!(s && s.benched);
  }
  if (MANUAL_BENCH.has(market) && !_released.has(market)) return true; // WZ-RL-SHADOW-WATCH: released markets fall through to the live guard
  const s = _status[market];
  return !!(s && s.benched);
}

function getStatus() {
  const out = {};
  for (const m of CORE) {
    const s = _status[m] || {};
    out[m] = {
      benched: isBenched(m),
      manual: MANUAL_BENCH.has(m) && !_released.has(m),
      gapPts: s.gapPts ?? null,
      n: s.n ?? 0,
      claimedPct: s.claimedPct ?? null,
      actualPct: s.actualPct ?? null,
    };
  }
  return {
    token: "WZ-CALIB-GUARD-2026-07-17",
    markets: out,
    thresholds: { confidentBand: ">=0.55", MIN_N, GAP_BENCH, GAP_UNBENCH },
    shadowWatch: _shadowStatus, // WZ-RL-SHADOW-WATCH-2026-07-17 :: rebuilt-model progress toward auto-release
    football: _fbStatus,        // WZ-FBALL-BENCH-2026-07-17 :: per league:market drift status (benched only if drifting)
    lastRun: _lastRun,
    lastError: _lastError,
  };
}

module.exports = { refreshGuard, isBenched, getStatus };
