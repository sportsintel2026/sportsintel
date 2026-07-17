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

// Thresholds. Confident band = model_prob >= 0.55 (the featured/shown side).
const MIN_N = 40;       // require a real settled sample before auto-benching
const GAP_BENCH = 8;    // auto-bench when claimed - actual >= 8 pts
const GAP_UNBENCH = 4;  // hysteresis: only auto-unbench once the gap recovers below 4 pts

let _status = {};       // { market: { benched, gapPts, n, claimedPct, actualPct, updatedAt } }
let _lastError = null;
let _lastRun = null;

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
        .in("market", CORE)
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

    for (const m of CORE) {
      const s = _status[m];
      if (s.benched && !MANUAL_BENCH.has(m)) {
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
function isBenched(market) {
  if (MANUAL_BENCH.has(market)) return true;
  const s = _status[market];
  return !!(s && s.benched);
}

function getStatus() {
  const out = {};
  for (const m of CORE) {
    const s = _status[m] || {};
    out[m] = {
      benched: isBenched(m),
      manual: MANUAL_BENCH.has(m),
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
    lastRun: _lastRun,
    lastError: _lastError,
  };
}

module.exports = { refreshGuard, isBenched, getStatus };
