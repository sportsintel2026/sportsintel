// gammafit.js
// WZ-GAMMAFIT-2026-07-24 :: READ-ONLY. Mounted at /api/gammafit. No admin gate.
// SUPERSEDES WZ-GAMMAFIT-2026-07-23.
//
// WHAT THE FIRST VERSION GOT WRONG — keep this note
// -------------------------------------------------
// v1 gated everything on `vigTaxPts ≈ 2.2`, asserting that the board's `edge`
// (model_prob − de-vigged fair) overstated true edge vs break-even by roughly half
// the book's vig. It measured 0.00 and voided its own output.
//
// The gate was wrong, not the data. `edges.js:663` takes `ml.homeOdds`/`ml.awayOdds`,
// which are BEST-OF-BOOKS prices — the best number for each side, possibly from
// different books. Shopping both sides compresses the overround from ~4.5% toward 0%,
// so `devigTwoWay` has almost nothing left to remove and `fair ≈ breakEven`. The
// board's `edge` was ALREADY an EV measure against the real price. Price shopping had
// solved that problem before anyone named it.
//
// The lesson is why this file exists: a validation gate must test an IDENTITY, not a
// THESIS. v1 encoded a belief as a check, and when the belief failed it declared the
// data void.
//
// WHAT IS ACTUALLY BEING MEASURED
// -------------------------------
//   fair = model_prob − edge          ← arithmetic identity, cannot fail
//   raw  = fair + edge / W            ← depends on W_MODEL being 0.55
//
//   γ:  P(win) = σ( logit(fair) + γ · (logit(raw) − logit(fair)) )
//
// γ is the fraction of the model's disagreement with the market that reality
// confirms. γ ≤ 0 means the fundamentals subtract value: the further the model
// strays from the price, the worse it does.
//
// ROBUSTNESS: changing W rescales raw's log-odds distance from fair roughly
// linearly, which rescales γ by roughly the same factor. **The SIGN of γ is
// invariant to W.** A negative γ therefore cannot be an artifact of guessing W
// wrong. `gammaWSweep` demonstrates that rather than asserting it.
//
// FOUR OUTPUTS, ORDERED BY HOW MUCH THEY DEPEND ON ASSUMPTIONS
// ------------------------------------------------------------
// 1. `calibration`    — claimed vs actual win rate by bucket. Depends on NOTHING but
//                       model_prob and result. Trust this first; it localises the
//                       overclaim to a probability range.
// 2. `published`      — realised ROI at real posted prices. Odds + result only.
// 3. `marketBaseline` — what selecting on the MARKET's probability alone would have
//                       returned. The null model the product must beat to exist.
// 4. `gammaVsClose` / `gammaVsOutcome` — depend on the reconstruction and on W.

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const EPS = 1e-6;
const clamp01 = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => Math.log(clamp01(p) / (1 - clamp01(p)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const impliedProb = (a) => (a == null || !Number.isFinite(a) || a === 0 ? null : a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const unitProfit = (a) => (a == null || !Number.isFinite(a) || a === 0 ? null : a > 0 ? a / 100 : 100 / Math.abs(a));
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** OLS with intercept. */
function ols(pairs) {
  const n = pairs.length;
  if (n < 5) return { gamma: null, alpha: null, n, se: null, note: "n too small" };
  const sx = pairs.reduce((s, p) => s + p.x, 0);
  const sy = pairs.reduce((s, p) => s + p.y, 0);
  const sxx = pairs.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pairs.reduce((s, p) => s + p.x * p.y, 0);
  const den = n * sxx - sx * sx;
  if (!(Math.abs(den) > 1e-12)) return { gamma: null, alpha: null, n, se: null, note: "no variation" };
  const gamma = (n * sxy - sx * sy) / den;
  const alpha = (sy - gamma * sx) / n;
  const rss = pairs.reduce((s, p) => s + Math.pow(p.y - (alpha + gamma * p.x), 2), 0);
  const se = Math.sqrt((rss / Math.max(1, n - 2)) * n / den);
  return { gamma, alpha, n, se, ci95: [gamma - 1.96 * se, gamma + 1.96 * se], significant: Math.abs(gamma) > 1.96 * se };
}

/** Offset logistic regression: P = σ(offset + γ·x). Newton-Raphson. */
function offsetLogit(pairs) {
  const n = pairs.length;
  if (n < 10) return { gamma: null, n, se: null, note: "n too small" };
  let g = 0;
  for (let i = 0; i < 60; i++) {
    let score = 0, info = 0;
    for (const p of pairs) {
      const mu = sigmoid(p.offset + g * p.x);
      score += p.x * (p.y - mu);
      info += p.x * p.x * mu * (1 - mu);
    }
    if (!(info > 1e-12)) return { gamma: null, n, se: null, note: "no variation" };
    const step = score / info;
    g += step;
    if (Math.abs(step) < 1e-9) break;
    if (!Number.isFinite(g) || Math.abs(g) > 50) return { gamma: null, n, se: null, note: "did not converge" };
  }
  let info = 0;
  for (const p of pairs) { const mu = sigmoid(p.offset + g * p.x); info += p.x * p.x * mu * (1 - mu); }
  const se = info > 0 ? 1 / Math.sqrt(info) : null;
  return { gamma: g, n, se, ci95: se == null ? null : [g - 1.96 * se, g + 1.96 * se], significant: se != null && Math.abs(g) > 1.96 * se };
}

/** Realised units at real posted prices. Depends on odds + result only. */
function scoreRows(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const w = rows.filter(r => r.won).length;
  const units = rows.reduce((s, r) => s + (r.won ? r.profit : -1), 0);
  return {
    n, wins: w, losses: n - w,
    winPct: r2((w / n) * 100),
    breakEvenPct: r2(mean(rows.map(r => 1 / (1 + r.profit))) * 100),
    realRoiPct: r2((units / n) * 100),
  };
}

async function analyseMarket(supabase, league, market, W, BAND) {
  const PAGE = 1000;
  const raw = [];
  let from = 0;
  for (let i = 0; i < 40; i++) {
    const { data, error } = await supabase.from("model_predictions")
      .select("game_id, game_date, model_prob, edge, odds, result, pinnacle_fair_prob")
      .eq("league", league).eq("market", market)
      .in("result", ["win", "loss"])
      .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    raw.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (!raw.length) return { market, note: "no graded rows" };

  const rows = [];
  let skipped = 0;
  const effVig = [];
  for (const r of raw) {
    const mp = r.model_prob == null ? null : Number(r.model_prob);
    const ed = r.edge == null ? null : Number(r.edge);
    const profit = unitProfit(Number(r.odds));
    const be = impliedProb(Number(r.odds));
    if (mp == null || !Number.isFinite(mp) || profit == null || be == null) { skipped++; continue; }
    const hasEdge = ed != null && Number.isFinite(ed);
    const fair = hasEdge ? mp - ed : null;
    const model = fair != null && fair > 0 && fair < 1 ? fair + ed / W : null;
    if (fair != null) effVig.push((be - fair) * 100);
    rows.push({
      date: String(r.game_date).slice(0, 10),
      claimed: mp, edge: hasEdge ? ed : null, fair, model,
      odds: Number(r.odds), profit, breakEven: be,
      won: r.result === "win",
      published: mp >= BAND,
      pinFair: r.pinnacle_fair_prob == null ? null : Number(r.pinnacle_fair_prob),
    });
  }
  if (!rows.length) return { market, note: "no usable rows", skipped };

  // ── 1. CALIBRATION — assumption-free ──────────────────────────────────────
  const calibration = [];
  for (let lo = 0.30; lo < 0.80; lo += 0.05) {
    const hi = lo + 0.05;
    const sel = rows.filter(r => r.claimed >= lo && r.claimed < hi);
    if (sel.length < 8) continue;
    const claimed = mean(sel.map(r => r.claimed));
    const actual = sel.filter(r => r.won).length / sel.length;
    calibration.push({
      bucket: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}`,
      n: sel.length,
      claimedPct: r2(claimed * 100),
      actualPct: r2(actual * 100),
      gapPts: r2((actual - claimed) * 100),
      realRoiPct: scoreRows(sel).realRoiPct,
    });
  }

  // ── 2. WHAT THE BOARD PUBLISHED ───────────────────────────────────────────
  const published = rows.filter(r => r.published);

  // ── 3. MARKET-ONLY BASELINE — the null model ──────────────────────────────
  const withFair = rows.filter(r => r.fair != null);
  const marketPicked = withFair.filter(r => r.fair >= BAND);
  const modelPicked = withFair.filter(r => r.claimed >= BAND);

  // ── 4. γ, with a W sweep ──────────────────────────────────────────────────
  const usable = rows.filter(r => r.fair != null && r.model != null && r.model > 0 && r.model < 1);
  const clvRows = usable.filter(r => r.pinFair != null && r.pinFair > 0 && r.pinFair < 1);

  const gammaVsOutcome = offsetLogit(usable.map(r => ({ x: logit(r.model) - logit(r.fair), offset: logit(r.fair), y: r.won ? 1 : 0 })));
  const gammaVsClose = ols(clvRows.map(r => ({ x: logit(r.model) - logit(r.fair), y: logit(r.pinFair) - logit(r.fair) })));

  const gammaWSweep = [];
  for (const w of [0.30, 0.45, 0.55, 0.70, 0.90]) {
    const pts = clvRows.map(r => {
      const m = r.fair + r.edge / w;
      if (!(m > 0 && m < 1)) return null;
      return { x: logit(m) - logit(r.fair), y: logit(r.pinFair) - logit(r.fair) };
    }).filter(Boolean);
    const f = ols(pts);
    gammaWSweep.push({ w, gamma: r3(f.gamma), se: r3(f.se), n: f.n, significant: f.significant ?? null });
  }
  const signs = gammaWSweep.map(s => (s.gamma == null ? null : Math.sign(s.gamma))).filter(s => s != null);
  const gammaSignStableAcrossW = signs.length > 1 ? signs.every(s => s === signs[0]) : null;

  return {
    market,
    rows: rows.length, skipped,
    effectiveVigPts: { mean: r2(mean(effVig)), median: r2(median(effVig)), n: effVig.length,
      note: "breakEven minus fair. Near zero means best-of-books shopping already stripped the vig and `edge` is effectively an EV measure." },
    calibration,
    published: scoreRows(published),
    medianPublishedClaimPct: published.length ? r2(median(published.map(r => r.claimed)) * 100) : null,
    medianPublishedBreakEvenPct: published.length ? r2(median(published.map(r => r.breakEven)) * 100) : null,
    marketBaseline: {
      note: "Same floor, selecting on the MARKET's probability instead of the model's. The model must beat this to justify existing.",
      modelSelected: scoreRows(modelPicked),
      marketSelected: scoreRows(marketPicked),
    },
    gammaVsClose: { ...gammaVsClose, gamma: r3(gammaVsClose.gamma), alpha: r3(gammaVsClose.alpha), se: r3(gammaVsClose.se), ci95: gammaVsClose.ci95 ? gammaVsClose.ci95.map(r3) : null },
    gammaVsOutcome: { ...gammaVsOutcome, gamma: r3(gammaVsOutcome.gamma), se: r3(gammaVsOutcome.se), ci95: gammaVsOutcome.ci95 ? gammaVsOutcome.ci95.map(r3) : null },
    gammaWSweep,
    gammaSignStableAcrossW,
  };
}

router.get("/", async (req, res) => {
  try {
    const supabase = db();
    const league = req.query.league || "mlb";
    const W = Number(req.query.w) || 0.55;
    const BAND = Number(req.query.band) || 0.55;
    const requested = req.query.market || "all";
    const markets = requested === "all" ? ["moneyline", "total", "run_line"] : [requested];

    const perMarket = {};
    for (const m of markets) {
      try { perMarket[m] = await analyseMarket(supabase, league, m, W, BAND); }
      catch (e) { perMarket[m] = { market: m, error: e.message }; }
    }

    const verdict = [];
    for (const m of markets) {
      const d = perMarket[m];
      if (!d || d.note || d.error) { verdict.push(`${m}: ${d?.note || d?.error || "no data"}`); continue; }
      const gc = d.gammaVsClose || {};
      if (gc.gamma != null && gc.significant) {
        verdict.push(gc.gamma < 0
          ? `${m}: gamma ${gc.gamma} [${gc.ci95[0]}, ${gc.ci95[1]}] n=${gc.n} — SIGNIFICANTLY NEGATIVE. The sharp close moves AGAINST the model's disagreement. The fundamentals are subtracting value on this market.`
          : `${m}: gamma ${gc.gamma} [${gc.ci95[0]}, ${gc.ci95[1]}] n=${gc.n} — significantly POSITIVE. Real information; W_MODEL could rise toward it.`);
      } else if (gc.gamma != null) {
        verdict.push(`${m}: gamma ${gc.gamma} not distinguishable from zero (n=${gc.n}). Disagreement unconfirmed either way.`);
      } else {
        verdict.push(`${m}: no CLV rows — pinnacle_fair_prob is null. This is the high-power test; populating it matters more than any board change.`);
      }
      if (d.gammaSignStableAcrossW === false) verdict.push(`${m}: WARNING — gamma sign flips across W. Sign AND magnitude unresolved.`);
      const mb = d.marketBaseline || {};
      if (mb.modelSelected?.n && mb.marketSelected?.n) {
        verdict.push(`${m}: model-selected ${mb.modelSelected.realRoiPct}% ROI (n=${mb.modelSelected.n}) vs market-selected ${mb.marketSelected.realRoiPct}% (n=${mb.marketSelected.n}).`);
      }
      const worst = (d.calibration || []).filter(b => b.gapPts != null).sort((a, b) => a.gapPts - b.gapPts)[0];
      if (worst) verdict.push(`${m}: worst calibration bucket ${worst.bucket} — claimed ${worst.claimedPct}%, delivered ${worst.actualPct}% (${worst.gapPts} pts, n=${worst.n}).`);
    }
    verdict.push("Calibration and published ROI depend on nothing but model_prob, odds and result — trust those first. gamma depends on the reconstruction and on W; gammaWSweep shows whether its sign survives W being wrong.");

    res.json({ token: "WZ-GAMMAFIT-2026-07-24", league, publishFloor: BAND, wAssumed: W, perMarket, verdict });
  } catch (e) {
    console.error("[gammafit] error:", e.message);
    res.status(500).json({ token: "WZ-GAMMAFIT-2026-07-24", error: e.message });
  }
});

module.exports = router;
