// Performance route — serves the model's tracked record, per sport (league).
//
// GET /api/performance/:league   (league = mlb | nba | nfl | cfb)
//   → win/loss/ROI by market and confidence tier, a CLV summary, and a SEPARATE
//     props table. Props NEVER count toward the core record or CLV — they live in
//     their own table, measured by hit-rate / ROI (plus-money longshots).
//
// "Qualified picks": the model publishes every edge it finds, but its low-conviction
// (NEUTRAL / LOW) plays are noise and drag the record down. The headline record
// reflects only QUALIFIED picks (confidence in QUALIFYING_TIERS). The FULL record
// is returned alongside it, so nothing is hidden.
const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

// --- per-sport market config -------------------------------------------------
// core  = team markets that count toward the overall record + CLV
// props = prop markets shown in their OWN table (hit-rate / ROI), never in core
// clv   = markets eligible for a captured closing line; a market with none simply
//         yields clv = null (honest "not captured yet" state for new sports)
const LEAGUE_CONFIG = {
  mlb: { core: ["moneyline", "total", "run_line"], props: ["hr_prop", "player_strikeouts", "player_hits"], clv: ["moneyline", "total"], propsLabel: "Player props" },
  nba: { core: ["moneyline", "spread", "total"], props: ["player_points", "player_rebounds", "player_assists", "player_threes"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  nfl: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
  cfb: { core: ["moneyline", "spread", "total"], props: ["player_props"], clv: ["moneyline", "spread", "total"], propsLabel: "Player props" },
};

// --- selection rule (tune here) ---------------------------------------------
const QUALIFYING_TIERS = ["HIGH", "MEDIUM"];
function isQualified(r) {
  const conf = (r.confidence || "NEUTRAL").toUpperCase();
  return QUALIFYING_TIERS.includes(conf);
}
// ----------------------------------------------------------------------------

// --- per-market track-record resets -----------------------------------------
// A market's published record only counts graded picks on/after this date,
// because the model for that market was materially rebuilt and older picks no
// longer reflect it. NON-DESTRUCTIVE: the old rows stay in the DB, they're just
// not counted on the page (reversible — remove the entry to count them again).
// The cutoff date is also returned to the page so it can show an honest
// "tracking reset on <date>" note rather than silently dropping a record.
const MARKET_RESET = {
  hr_prop: "2026-06-07",     // bumped 6/6→6/7: HR power factor revived onto Savant xwOBA today (was ISO fallback), so count the new model from a clean slate
  player_hits: "2026-06-07", // hits model rebuilt today onto xBA + binomial + market anchor; earlier picks were the broken season-AVG model
};
function afterReset(r) {
  const cut = MARKET_RESET[r.market];
  return !cut || (r.game_date && r.game_date >= cut);
}
// ----------------------------------------------------------------------------

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}
// American odds → profit on a 1-unit win (for ROI). -110 → 0.909, +150 → 1.5
function unitProfit(odds) {
  if (odds == null) return 1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}
// Average odds must be computed in DECIMAL space — linearly averaging American
// odds is meaningless when picks straddle the +/- line (e.g. -110 and +110
// "average" to 0). Convert → average decimals → convert back to American.
function americanToDecimal(o) {
  if (o == null) return null;
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
function decimalToAmerican(d) {
  if (d == null || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

router.get("/:league", async (req, res) => {
  const league = String(req.params.league || "").toLowerCase();
  const cfg = LEAGUE_CONFIG[league];
  if (!cfg) {
    return res.status(400).json({ error: "Unknown league", league, supported: Object.keys(LEAGUE_CONFIG) });
  }
  try {
    const supabase = db();
    // Fetch ALL graded rows by paging. Supabase caps a single select at 1000 rows;
    // once MLB passed ~1000 graded win/loss rows, an unpaginated query silently
    // returned only the OLDEST 1000 and dropped the NEWEST — hiding recent grades,
    // including every newly added strikeout/hits pick (the most recent rows). Page
    // through in 1000-row chunks ordered by id so nothing is lost.
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("model_predictions")
        .select("market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds")
        .eq("league", league)
        .in("result", ["win", "loss"]) // graded, decisive only (skip pending/push)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }

    // Props are kept entirely out of the core record and CLV — own table only.
    const coreRows = rows.filter(r => cfg.core.includes(r.market));
    const propRows = rows.filter(r => cfg.props.includes(r.market) && afterReset(r));

    // Qualified set drives the headline; full set kept for transparency.
    const qualifiedRows = coreRows.filter(isQualified);

    const build = (set) => {
      const buckets = { overall: blank(), byMarket: {}, byConfidence: {} };
      for (const r of set) {
        const won = r.result === "win";
        const profit = won ? unitProfit(r.odds) : -1;
        tally(buckets.overall, won, profit);
        buckets.byMarket[r.market] ||= blank();
        tally(buckets.byMarket[r.market], won, profit);
        const conf = (r.confidence || "NEUTRAL").toUpperCase();
        buckets.byConfidence[conf] ||= blank();
        tally(buckets.byConfidence[conf], won, profit);
      }
      finalize(buckets.overall);
      for (const k of Object.keys(buckets.byMarket)) finalize(buckets.byMarket[k]);
      for (const k of Object.keys(buckets.byConfidence)) finalize(buckets.byConfidence[k]);
      return buckets;
    };

    const qualified = build(qualifiedRows);
    const full = build(coreRows);

    // pending (core markets for THIS league only — matches the headline record)
    const { count: pendingCount } = await supabase
      .from("model_predictions")
      .select("id", { count: "exact", head: true })
      .eq("league", league)
      .eq("result", "pending")
      .in("market", cfg.core);

    // ── CLV summary (core markets with a captured closing line) ───────────────
    // A sport with no captured closing lines simply returns clv = null.
    const { data: clvData } = await supabase
      .from("model_predictions")
      .select("confidence, clv, beat_close, game_date, pinnacle_clv, pinnacle_beat_close")
      .eq("league", league)
      .in("market", cfg.clv)
      .not("clv", "is", null);
    const clvRows = (clvData || []).filter(isQualified);
    let clvSummary = null;
    if (clvRows.length > 0) {
      // Report beat / tied / worse separately. A flat best-of-books price (clv === 0)
      // is a TIE, not a loss — folding ties into "didn't beat" mechanically depresses
      // the beat rate below 50%, so we split them out and report the decisive rate too.
      const beat = clvRows.filter(r => Number(r.clv) > 0).length;
      const worse = clvRows.filter(r => Number(r.clv) < 0).length;
      const tied = clvRows.length - beat - worse;
      const decisive = beat + worse;
      const avgClv = clvRows.reduce((s, r) => s + (Number(r.clv) || 0), 0) / clvRows.length;
      clvSummary = {
        sample: clvRows.length,
        beat, tied, worse,
        beatClose: beat,
        beatClosePct: Math.round((beat / clvRows.length) * 1000) / 10,
        beatDecisivePct: decisive ? Math.round((beat / decisive) * 1000) / 10 : null,
        avgClvPct: Math.round(avgClv * 10000) / 100,
      };

      // SHARP CLV vs Pinnacle — the benchmark that actually validates edge (de-vigged
      // close from the lowest-vig book vs the price we took). Null until enough picks
      // have been captured in the final-30-min window post-deploy.
      const pinRows = clvRows.filter(r => r.pinnacle_clv != null);
      if (pinRows.length > 0) {
        const pBeat = pinRows.filter(r => Number(r.pinnacle_clv) > 0).length;
        const pWorse = pinRows.filter(r => Number(r.pinnacle_clv) < 0).length;
        const pTied = pinRows.length - pBeat - pWorse;
        const pDecisive = pBeat + pWorse;
        const pAvg = pinRows.reduce((s, r) => s + (Number(r.pinnacle_clv) || 0), 0) / pinRows.length;
        clvSummary.pinnacle = {
          sample: pinRows.length,
          beat: pBeat, tied: pTied, worse: pWorse,
          beatClosePct: Math.round((pBeat / pinRows.length) * 1000) / 10,
          beatDecisivePct: pDecisive ? Math.round((pBeat / pDecisive) * 1000) / 10 : null,
          avgClvPct: Math.round(pAvg * 10000) / 100,
        };
      }
    }

    // ── Range windows — headline KPIs + cumulative units curve + CLV per window ─
    // BY CONVICTION (byConfidence) and BY MARKET (byMarket) stay season-level
    // above. The headline KPIs, the units-over-time curve, and the CLV grid are
    // range-aware here: 7D / 30D / Season / All, each computed from the qualified
    // rows + qualified CLV rows inside that date window. The series is cumulative
    // 1-unit-flat P/L in chronological order — the real proof curve, not synthetic.
    const daysAgoIso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const SEASON_START = { mlb: "2026-03-01", nba: "2025-10-01", nfl: "2025-09-01", cfb: "2025-08-01" }[league] || "2000-01-01";
    const WINDOWS = [["7D", daysAgoIso(7)], ["30D", daysAgoIso(30)], ["Season", SEASON_START], ["All", "0000-00-00"]];
    const inWindow = (gd, cut) => cut === "0000-00-00" || (gd && gd >= cut);
    const rangeStats = (cut) => {
      const set = qualifiedRows.filter(r => inWindow(r.game_date, cut));
      const sorted = [...set].sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      // WZ-WINRATE-CURVE-2026-07-06 :: build a range-aware cumulative WIN RATE curve alongside the
      // units curve, so the Performance win-rate chart redraws per window (7D/30D/Season/All) just
      // like the units chart already does. winSeries[k] = win% after the first k+1 graded picks in
      // this window. Additive: new field only; nothing existing changes.
      let cum = 0, wins = 0, losses = 0; const series = [0]; const winSeries = [];
      for (const r of sorted) { const won = r.result === "win"; const p = won ? unitProfit(r.odds) : -1; cum += p; if (won) wins++; else losses++; series.push(Math.round(cum * 100) / 100); winSeries.push(Math.round((wins / (wins + losses)) * 1000) / 10); }
      const total = wins + losses;
      const cwin = clvRows.filter(r => inWindow(r.game_date, cut));
      const beat = cwin.filter(r => r.beat_close === true).length;
      const avgClv = cwin.length ? cwin.reduce((s, r) => s + (Number(r.clv) || 0), 0) / cwin.length : null;
      return {
        roi: total ? Math.round((cum / total) * 1000) / 10 : 0,
        units: Math.round(cum * 100) / 100,
        w: wins, l: losses, p: 0,
        clv: avgClv == null ? 0 : Math.round(avgClv * 10000) / 100,
        bc: cwin.length ? Math.round((beat / cwin.length) * 1000) / 10 : 0,
        n: total,
        series: series.length > 1 ? series : [0, 0],
        winSeries,
      };
    };
    const ranges = {};
    for (const [name, cut] of WINDOWS) ranges[name] = rangeStats(cut);

    // ── Home stat-card sparklines — compact cumulative curves ─────────────────
    // ROI% and win% accrue over the qualified set; CLV% over the captured-close
    // set, all within the season window. A short warmup is skipped so the first
    // 1–2 picks (±100% noise) don't dominate the axis. Real cumulative paths,
    // downsampled to ≤24 points; short/absent curves return [] (card shows none).
    const downsample = (arr, k = 24) => {
      if (!arr || arr.length <= k) return arr || [];
      const out = [], step = (arr.length - 1) / (k - 1);
      for (let i = 0; i < k; i++) out.push(arr[Math.round(i * step)]);
      return out;
    };
    const roiCurve = [], winCurve = [], clvCurve = [];
    {
      const set = qualifiedRows
        .filter(r => inWindow(r.game_date, SEASON_START))
        .sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      let sc = 0, sw = 0, sl = 0; const WARM = 10;
      for (const r of set) {
        const won = r.result === "win"; sc += won ? unitProfit(r.odds) : -1; if (won) sw++; else sl++;
        const tot = sw + sl;
        if (tot >= WARM) { roiCurve.push(Math.round((sc / tot) * 1000) / 10); winCurve.push(Math.round((sw / tot) * 1000) / 10); }
      }
    }
    {
      const set = clvRows
        .filter(r => inWindow(r.game_date, SEASON_START))
        .sort((a, b) => String(a.game_date || "").localeCompare(String(b.game_date || "")));
      let cc = 0; const WARM = 5;
      set.forEach((r, i) => { cc += Number(r.clv) || 0; if (i + 1 >= WARM) clvCurve.push(Math.round((cc / (i + 1)) * 10000) / 100); });
    }
    const spark = { roi: downsample(roiCurve), win: downsample(winCurve), clv: downsample(clvCurve) };

    // ── Recent graded picks (core + props), newest first, with a readable label ─
    let recent = [];
    try {
      const sel = "market, confidence, result, odds, edge, game_date, clv, beat_close, closing_odds, matchup, selection, line";
      const { data: recRows, error: recErr } = await supabase
        .from("model_predictions")
        .select(sel)
        .eq("league", league)
        .in("market", [...cfg.core, ...cfg.props])
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(60);
      if (recErr) { console.warn("[performance] recent query failed:", recErr.message); }
      const elig = (recRows || []).filter(r => cfg.core.includes(r.market) ? isQualified(r) : afterReset(r));
      recent = elig.slice(0, 20).map(r => {
        const won = r.result === "win";
        return {
          date: r.game_date,
          pick: pickLabel(r),
          result: won ? "W" : "L",
          edge: r.edge != null ? Math.round(Number(r.edge) * 1000) / 10 : null,
          units: won ? Math.round(unitProfit(r.odds) * 100) / 100 : -1,
          clvPct: r.clv != null ? Math.round(Number(r.clv) * 10000) / 100 : null,
          clvCents: (r.odds != null && r.closing_odds != null) ? clvCents(r.odds, r.closing_odds) : null,
        };
      });
    } catch (_) { recent = []; }

    // ── Props table (SEPARATE; hit-rate + ROI; never in core record or CLV) ───
    // Overall props summary PLUS a per-stat breakdown (points / rebounds /
    // assists / 3PT for NBA; a single HR-props entry for MLB). Each stat type
    // becomes its own sub-row on the page.
    let props = null;
    if (propRows.length > 0) {
      props = { label: cfg.propsLabel, ...propSummary(propRows), byMarket: {} };
      const byMkt = {};
      for (const r of propRows) { (byMkt[r.market] ||= []).push(r); }
      for (const mkt of Object.keys(byMkt)) props.byMarket[mkt] = propSummary(byMkt[mkt]);
    }

    res.json({
      league,
      // Headline = qualified picks (what we stand behind).
      ...qualified,
      totalGraded: qualifiedRows.length,
      // Range-aware headline KPIs + cumulative units curve + CLV grid.
      ranges,
      // Compact cumulative curves (roi/win/clv) for the Home stat-card sparklines.
      spark,
      // Newest graded picks (core + props) for the Recent Results list.
      recent,
      // Full sample kept visible so nothing is hidden.
      fullSample: { ...full, totalGraded: rows.length },
      clv: clvSummary,
      props,
      // Reset cutoffs (per market) so the page can show "tracking reset on <date>".
      propResets: MARKET_RESET,
      // Back-compat: the existing MLB page reads `hrProps`. Keep it for mlb until
      // the page is updated to the generic `props` field.
      hrProps: league === "mlb" ? props : undefined,
      filter: {
        qualifyingTiers: QUALIFYING_TIERS,
        excludedCount: rows.length - qualifiedRows.length,
      },
      pendingCount: pendingCount || 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Performance] error:", err.message);
    res.status(500).json({ error: "Failed to load performance", details: err.message });
  }
});

function blank() { return { wins: 0, losses: 0, units: 0 }; }
function tally(b, won, profit) {
  if (won) b.wins++; else b.losses++;
  b.units += profit;
}
// CLV in cents: our price vs the closing price on the same side. Positive = we
// locked in a better number than the market closed at.
function clvCents(our, close) {
  const toCents = (o) => { const n = Number(o); if (!n || isNaN(n)) return null; return n >= 100 ? n - 100 : n <= -100 ? n + 100 : 0; };
  const a = toCents(our), b = toCents(close);
  if (a == null || b == null) return null;
  return Math.round(a - b);
}
// Derive a team label from "AWAY @ HOME" matchup + a side ("away"/"home").
function teamFromMatchup(matchup, side) {
  const parts = String(matchup || "").split(/\s+(?:@|vs|at)\s+/i);
  if (parts.length === 2) return (String(side).toLowerCase() === "home" ? parts[1] : parts[0]).trim();
  return String(side).toLowerCase() === "home" ? "Home" : "Away";
}
// Human-readable pick label for Recent Results. model_predictions stores the
// side INSIDE `selection`: "away"/"home" for ML/RL, "over"/"under" for totals,
// the player name for HR props, and "Player:side" for hits/K props.
function pickLabel(r) {
  const mu = r.matchup || "", sel = String(r.selection || ""), line = r.line, m = r.market;
  const sign = (x) => (Number(x) > 0 ? "+" : "") + x;
  if (m === "moneyline") return `${teamFromMatchup(mu, sel)} ML`;
  if (m === "run_line" || m === "spread") return `${teamFromMatchup(mu, sel)} ${line != null ? sign(line) : ""}`.trim();
  if (m === "total") return `${sel === "under" ? "Under" : "Over"}${line != null ? " " + line : ""}${mu ? " " + mu : ""}`.trim();
  if (m === "hr_prop") return `${sel} Over ${line != null ? line : "0.5"} HR`.trim();
  if (m === "player_hits" || m === "player_strikeouts") {
    const [player, side] = sel.split(":");
    const ou = String(side || "").toLowerCase() === "under" ? "Under" : "Over";
    const unit = m === "player_hits" ? "Hits" : "K";
    return `${player || sel} ${ou} ${line != null ? line : ""} ${unit}`.trim();
  }
  return `${sel || mu || "Pick"}${line != null ? " " + line : ""}`.trim();
}
function finalize(b) {
  const total = b.wins + b.losses;
  b.total = total;
  b.winPct = total > 0 ? Math.round((b.wins / total) * 1000) / 10 : null;
  b.roi = total > 0 ? Math.round((b.units / total) * 1000) / 10 : null; // % ROI per unit
  b.units = Math.round(b.units * 100) / 100;
}
// Hit-rate / ROI summary for a set of prop rows (used for the props table and
// each per-stat sub-row). Props are graded by hit-rate + ROI, never win/loss record.
function propSummary(rows) {
  let wins = 0, units = 0, decSum = 0, decN = 0;
  for (const r of rows) {
    const won = r.result === "win";
    if (won) wins++;
    units += won ? unitProfit(r.odds) : -1;
    if (r.odds != null) { const d = americanToDecimal(Number(r.odds)); if (d) { decSum += d; decN++; } }
  }
  const n = rows.length;
  return {
    picks: n,
    hits: wins,
    misses: n - wins,
    hitRatePct: Math.round((wins / n) * 1000) / 10,
    roi: Math.round((units / n) * 1000) / 10,
    avgOdds: decN ? decimalToAmerican(decSum / decN) : null,
  };
}
module.exports = router;
