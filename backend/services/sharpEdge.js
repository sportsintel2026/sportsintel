/*
 * sharpEdge.js — WizePicks model-vs-Pinnacle snapshot pipeline (Phase 1.5).
 *
 * WZ-SHARP-EDGE-2026-07-14 :: Replaces the temp per-user /api/pinnacle-probe live hit.
 * The Sharp Edge card used to make every MLB page load call getPinnacleAnchorComparison
 * live (~2 Odds API credits PER USER, per load, on a public read-only route). Instead we
 * compute the comparison ONCE on a cron and APPEND a timestamped snapshot to the
 * sharp_edge_snapshots table; the card reads the latest snapshot. Cost drops from
 * per-user to ~2 credits per refresh interval, the public temp route goes away, and the
 * table accumulates history (trend-ready) so a future model-vs-Pinnacle-over-time view
 * is just a read on top — no re-plumb.
 *
 * Own table, own concern: never touches the MLB edge/props pipeline. Fail-safe throughout —
 * a failure here just leaves the card on its normal empty state, never a crash.
 */
const { getPinnacleAnchorComparison } = require("./oddsApi");
const { createClient } = require("@supabase/supabase-js");

function sharpDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Compute the comparison and append one timestamped snapshot. Stores ONLY comparable rows
// (both a Pinnacle line and a model anchor => a real deltaAwayPP), which are the only rows
// the card uses and the only ones meaningful for gap trends. Returns rows written.
async function captureSharpEdgeSnapshot(sport = "baseball_mlb") {
  let cmp;
  try {
    cmp = await getPinnacleAnchorComparison({ sport, regions: "us,eu" });
  } catch (e) {
    console.error("[SharpEdge] compare failed:", e.message);
    return 0;
  }
  if (!cmp || !cmp.ok || !Array.isArray(cmp.rows)) {
    console.log("[SharpEdge] no comparison result");
    return 0;
  }

  const now = new Date().toISOString();
  const rows = cmp.rows
    .filter(r => r && r.deltaAwayPP != null && r.pinnacle && r.modelAnchor)
    .map(r => ({
      captured_at: now,
      sport,
      game: r.game,
      commence: r.commence || null,
      delta_away_pp: r.deltaAwayPP,
      pin_fair_away_pct: r.pinnacle.fairAwayPct,
      pin_fair_home_pct: r.pinnacle.fairHomePct,
      pin_raw: r.pinnacle.raw || null,
      model_fair_away_pct: r.modelAnchor.fairAwayPct,
      model_fair_home_pct: r.modelAnchor.fairHomePct,
      model_best_line: r.modelAnchor.bestLine || null,
      model_books: r.modelAnchor.books || [],
    }));

  if (!rows.length) {
    console.log("[SharpEdge] no comparable rows this run (empty slate or no Pinnacle)");
    return 0;
  }

  const supabase = sharpDb();
  const { error } = await supabase.from("sharp_edge_snapshots").insert(rows);
  if (error) {
    console.error("[SharpEdge] insert failed (table may not exist yet):", error.message);
    return 0;
  }
  // Retain ~30 days of history — trend-ready but bounded. Best-effort.
  try {
    await supabase.from("sharp_edge_snapshots")
      .delete().lt("captured_at", new Date(Date.now() - 30 * 864e5).toISOString());
  } catch (_) {}
  console.log(`[SharpEdge] snapshot saved ${rows.length} rows`);
  return rows.length;
}

// Serve the LATEST snapshot, reconstructed to the exact shape the Sharp Edge card consumes
// (game / pinnacle{raw,fairAwayPct,fairHomePct} / modelAnchor{bestLine,fairAwayPct,fairHomePct,books}
// / deltaAwayPP). Two-step: newest captured_at for this sport, then all rows at that timestamp.
// Fail-safe: any error returns an empty rows array so the card shows its normal empty state.
async function getLatestSharpEdge(sport = "baseball_mlb") {
  const supabase = sharpDb();
  try {
    const { data: latest, error: e1 } = await supabase
      .from("sharp_edge_snapshots")
      .select("captured_at")
      .eq("sport", sport)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (e1 || !latest || !latest.length) return { ok: true, rows: [], capturedAt: null };

    const capturedAt = latest[0].captured_at;
    const { data, error } = await supabase
      .from("sharp_edge_snapshots")
      .select("*")
      .eq("sport", sport)
      .eq("captured_at", capturedAt);
    if (error || !data) return { ok: true, rows: [], capturedAt };

    const rows = data.map(d => ({
      game: d.game,
      commence: d.commence,
      pinnacle: {
        raw: d.pin_raw,
        fairAwayPct: d.pin_fair_away_pct,
        fairHomePct: d.pin_fair_home_pct,
      },
      modelAnchor: {
        bestLine: d.model_best_line,
        fairAwayPct: d.model_fair_away_pct,
        fairHomePct: d.model_fair_home_pct,
        books: d.model_books || [],
      },
      deltaAwayPP: d.delta_away_pp,
    }));
    return { ok: true, rows, capturedAt };
  } catch (e) {
    console.error("[SharpEdge] read failed:", e.message);
    return { ok: true, rows: [], capturedAt: null };
  }
}

module.exports = { captureSharpEdgeSnapshot, getLatestSharpEdge };
