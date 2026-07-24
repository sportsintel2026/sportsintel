// gammafit.js
// WZ-GAMMAFIT-2026-07-23 :: READ-ONLY. Mounted at /api/gammafit. No admin gate.
//
// THE QUESTION THIS ANSWERS
// -------------------------
// edgesModel blends the model toward the market at a FIXED weight, W_MODEL = 0.55.
// That number was chosen, never measured. This probe measures it.
//
//   blended = W·raw + (1−W)·fair        (edgesModel.js:1617)
//   edge    = W·(raw − fair)            (blendedEdge, edgesModel.js:1240)
//
// so on every stored row:
//
//   fair = model_prob − edge            ← the market's own de-vigged opinion
//   raw  = fair + edge / W              ← the model's un-anchored opinion
//
// γ ("gamma") is the fraction of the model's DISAGREEMENT with the market that
// reality subsequently confirms:
//
//   P(win) = σ( logit(fair) + γ · (logit(raw) − logit(fair)) )
//
//   γ ≈ 1   the model's disagreement is fully vindicated — trust it, W is too low
//   γ ≈ 0.55 W is correctly set
//   γ ≈ 0   the model adds nothing the market didn't already know; every "edge"
//           on the board is a repackaged book price
//   γ < 0   the model is a CONTRARIAN indicator — the disagreement is worse than
//           useless and the board is systematically betting the wrong side
//
// γ is what killed the edge selector on 2026-07-20 (in-sample top-50 by edge went
// 68%; frozen and pointed at unseen games it went 51.7%). Nobody measured it. It is
// step 1 before any selection rule is proposed.
//
// FIT TWICE, ON PURPOSE
// ---------------------
// (A) vs OUTCOMES — ground truth, but nearly unreadable at n≈96. Resolving a
//     2-point ROI difference needs ~7,500 bets.
// (B) vs the PINNACLE CLOSING FAIR PRICE — roughly 100x the statistical power,
//     because a closing price is a low-variance estimate of true probability
//     while a win/loss is a single coin flip. ~62 picks resolve half a point.
//
// If (A) and (B) disagree in SIGN, believe (B) and say so — that is the whole
// reason CLV exists as a metric.
//
// TEST THE RULER BEFORE TRUSTING THE MEASUREMENT
// ----------------------------------------------
// Three of five probes shipped on 2026-07-20 had bugs. This one validates its own
// reconstruction before it reports anything: `reconstruction.vigTaxPts` must come
// back in a plausible half-vig range (~1.0–3.0 points). If it doesn't, the
// fair = model_prob − edge identity does not hold on these rows and EVERY number
// below is void. That check is reported first, deliberately.

const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── math ─────────────────────────────────────────────────────────────────────
const EPS = 1e-6;
const clamp01 = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => Math.log(clamp01(p) / (1 - clamp01(p)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const impliedProb = (a) => (a == null || !Number.isFinite(a) || a === 0 ? null : a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const unitProfit = (a) => (a == null || !Number.isFinite(a) || a === 0 ? null : a > 0 ? a / 100 : 100 / Math.abs(a));
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** OLS of y on x with intercept. Used for the CLV fit. */
function ols(pairs) {
  const n = pairs.length;
  if (n < 3) return { gamma: null, alpha: null, n, se: null, note: "n too small" };
  const sx = pairs.reduce((s, p) => s + p.x, 0);
  const sy = pairs.reduce((s, p) => s + p.y, 0);
  const sxx = pairs.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pairs.reduce((s, p) => s + p.x * p.y, 0);
  const den = n * sxx - sx * sx;
  if (!(Math.abs(den) > 1e-12)) return { gamma: null, alpha: null, n, se: null, note: "no variation in disagreement" };
  const gamma = (n * sxy - sx * sy) / den;
  const alpha = (sy - gamma * sx) / n;
  const rss = pairs.reduce((s, p) => s + Math.pow(p.y - (alpha + gamma * p.x), 2), 0);
  const sigma2 = rss / Math.max(1, n - 2);
  const se = Math.sqrt((sigma2 * n) / den);
  return { gamma, alpha, n, se, ci95: [gamma - 1.96 * se, gamma + 1.96 * se] };
}

/** Offset logistic regression: P = σ(logit(fair) + γ·x). One free parameter.
 *  Newton-Raphson; this is the statistically correct fit for a binary target. */
function offsetLogit(pairs) {
  const n = pairs.length;
  if (n < 10) return { gamma: null, n, se: null, note: "n too small" };
  let g = 0;
  for (let iter = 0; iter < 60; iter++) {
    let score = 0, info = 0;
    for (const p of pairs) {
      const eta = p.offset + g * p.x;
      const mu = sigmoid(eta);
      score += p.x * (p.y - mu);
      info += p.x * p.x * mu * (1 - mu);
    }
    if (!(info > 1e-12)) return { gamma: null, n, se: null, note: "no variation in disagreement" };
    const step = score / info;
    g += step;
    if (Math.abs(step) < 1e-9) break;
    if (!Number.isFinite(g) || Math.abs(g) > 50) return { gamma: null, n, se: null, note: "did not converge" };
  }
  let info = 0;
  for (const p of pairs) {
    const mu = sigmoid(p.offset + g * p.x);
    info += p.x * p.x * mu * (1 - mu);
  }
  const se = info > 0 ? 1 / Math.sqrt(info) : null;
  return { gamma: g, n, se, ci95: se == null ? null : [g - 1.96 * se, g + 1.96 * se] };
}

/** Realized units at real posted prices. */
function scoreRows(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const w = rows.filter(r => r.won).length;
  const units = rows.reduce((s, r) => s + (r.won ? r.profit : -1), 0);
  const be = mean(rows.map(r => 1 / (1 + r.profit)));
  return {
    n, wins: w, losses: n - w,
    winPct: r2((w / n) * 100),
    breakEvenPct: r2(be * 100),
    realRoiPct: r2((units / n) * 100),
  };
}

router.get("/", async (req, res) => {
  try {
    const supabase = db();
    const league = req.query.league || "mlb";
    const market = req.query.market || "moneyline";
    const W = Number(req.query.w) || 0.55; // W_MODEL in edgesModel.js
    const BAND = Number(req.query.band) || 0.55; // the publish floor
    const PAGE = 1000;

    // ── pull graded history ──────────────────────────────────────────────────
    const raw = [];
    let from = 0;
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.from("model_predictions")
        .select("game_id, game_date, model_prob, edge, odds, result, selection, pinnacle_fair_prob, pinnacle_closing_odds, closing_odds, closing_opp_odds")
        .eq("league", league).eq("market", market)
        .in("result", ["win", "loss"])
        .order("game_date", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      raw.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    if (!raw.length) {
      return res.json({ token: "WZ-GAMMAFIT-2026-07-23", league, market, note: "no graded rows" });
    }

    // ── reconstruct fair + raw, and CHECK the reconstruction ─────────────────
    const rows = [];
    let skippedNoEdge = 0, skippedNoOdds = 0, skippedOutOfRange = 0;
    const vigTax = [];

    for (const r of raw) {
      const mp = r.model_prob == null ? null : Number(r.model_prob);
      const ed = r.edge == null ? null : Number(r.edge);
      if (mp == null || ed == null || !Number.isFinite(mp) || !Number.isFinite(ed)) { skippedNoEdge++; continue; }
      const profit = unitProfit(Number(r.odds));
      const be = impliedProb(Number(r.odds));
      if (profit == null || be == null) { skippedNoOdds++; continue; }

      const fair = mp - ed;                 // the market's de-vigged opinion
      const model = fair + ed / W;          // the model's un-anchored opinion
      if (!(fair > 0 && fair < 1) || !(model > 0 && model < 1)) { skippedOutOfRange++; continue; }

      // THE RULER CHECK: break-even minus fair should be a plausible half-vig.
      vigTax.push((be - fair) * 100);

      rows.push({
        date: String(r.game_date).slice(0, 10),
        fair, model, blended: mp, edge: ed,
        odds: Number(r.odds), profit, breakEven: be,
        won: r.result === "win",
        published: mp >= BAND,
        pinFair: r.pinnacle_fair_prob == null ? null : Number(r.pinnacle_fair_prob),
        x: logit(model) - logit(fair), // the disagreement, in log-odds
      });
    }

    if (!rows.length) {
      return res.json({ token: "WZ-GAMMAFIT-2026-07-23", league, market, note: "no reconstructable rows", skippedNoEdge, skippedNoOdds, skippedOutOfRange });
    }

    const taxMean = mean(vigTax);
    const taxSorted = vigTax.slice().sort((a, b) => a - b);
    const taxMed = taxSorted[Math.floor(taxSorted.length / 2)];
    const reconstructionOk = taxMean > 0.5 && taxMean < 4.0;

    const reconstruction = {
      wModelAssumed: W,
      rowsUsable: rows.length,
      skippedNoEdge, skippedNoOdds, skippedOutOfRange,
      // If this identity holds, break-even sits ABOVE fair by roughly half the vig.
      vigTaxPtsMean: r2(taxMean),
      vigTaxPtsMedian: r2(taxMed),
      ok: reconstructionOk,
      meaning: reconstructionOk
        ? "fair = model_prob - edge holds. vigTaxPts is how many probability points the board's `edge` metric overstates true edge vs break-even. Everything below is readable."
        : "IDENTITY DOES NOT HOLD on these rows — W may differ for this market, or edge is stored on a different basis. TREAT EVERY NUMBER BELOW AS VOID.",
    };

    // ── (A) γ vs OUTCOMES ────────────────────────────────────────────────────
    const outPairs = rows.map(r => ({ x: r.x, offset: logit(r.fair), y: r.won ? 1 : 0 }));
    const gammaVsOutcome = offsetLogit(outPairs);

    // ── (B) γ vs the PINNACLE CLOSING FAIR PRICE ─────────────────────────────
    const clvRows = rows.filter(r => r.pinFair != null && r.pinFair > 0 && r.pinFair < 1);
    const clvPairs = clvRows.map(r => ({ x: r.x, y: logit(r.pinFair) - logit(r.fair) }));
    const gammaVsClose = ols(clvPairs);

    // ── OUT-OF-SAMPLE: fit on the early 60%, score the late 40% at real prices ──
    const cut = Math.floor(rows.length * 0.6);
    const early = rows.slice(0, cut);
    const late = rows.slice(cut);
    let oos = { note: "not enough rows to split" };
    if (early.length >= 20 && late.length >= 20) {
      const fitEarly = offsetLogit(early.map(r => ({ x: r.x, offset: logit(r.fair), y: r.won ? 1 : 0 })));
      const gHat = fitEarly.gamma;
      if (gHat != null) {
        const priced = late.map(r => {
          const p = sigmoid(logit(r.fair) + gHat * r.x);
          return { ...r, pHat: p, ev: p * r.profit - (1 - p) };
        });
        const plus = priced.filter(r => r.ev > 0);
        const minus = priced.filter(r => r.ev <= 0);
        const pubPlus = priced.filter(r => r.published && r.ev > 0);
        const pubMinus = priced.filter(r => r.published && r.ev <= 0);
        oos = {
          gammaFitOnEarly: r3(gHat),
          earlyN: early.length, lateN: late.length,
          cutDate: late.length ? late[0].date : null,
          // Does an EV>0 filter, formed WITHOUT seeing these games, actually pay?
          lateEvPositive: scoreRows(plus),
          lateEvNegative: scoreRows(minus),
          // And within what the board actually published:
          publishedEvPositive: scoreRows(pubPlus),
          publishedEvNegative: scoreRows(pubMinus),
        };
      }
    }

    // ── EV AUDIT of what the board published, under the fitted γ ─────────────
    const gUse = gammaVsOutcome.gamma != null ? gammaVsOutcome.gamma : W;
    const published = rows.filter(r => r.published);
    const pubPriced = published.map(r => {
      const p = sigmoid(logit(r.fair) + gUse * r.x);
      return { ...r, ev: p * r.profit - (1 - p) };
    });
    const negEv = pubPriced.filter(r => r.ev <= 0);

    const evAudit = {
      gammaUsed: r3(gUse),
      publishedN: published.length,
      publishedNegativeEv: negEv.length,
      publishedNegativeEvPct: published.length ? r2((negEv.length / published.length) * 100) : null,
      publishedAll: scoreRows(published),
      // The arithmetic claim, checked against the data: at the publish floor the
      // board's own stated win prob sits BELOW the price it must beat.
      medianPublishedBreakEvenPct: published.length
        ? r2(published.map(r => r.breakEven).sort((a, b) => a - b)[Math.floor(published.length / 2)] * 100)
        : null,
      medianPublishedClaimPct: published.length
        ? r2(published.map(r => r.blended).sort((a, b) => a - b)[Math.floor(published.length / 2)] * 100)
        : null,
    };

    // ── VERDICT — honest about power ─────────────────────────────────────────
    const verdict = [];
    if (!reconstructionOk) {
      verdict.push("VOID: the fair = model_prob - edge identity failed. Fix the reconstruction before reading anything else.");
    } else {
      const gc = gammaVsClose.gamma, gcSe = gammaVsClose.se;
      const go = gammaVsOutcome.gamma, goSe = gammaVsOutcome.se;
      if (gc != null && gcSe != null) {
        const sig = Math.abs(gc) > 1.96 * gcSe;
        verdict.push(`CLV fit (n=${gammaVsClose.n}): gamma=${r3(gc)} +/- ${r3(1.96 * gcSe)}. ${sig ? (gc > 0 ? "SIGNIFICANT and POSITIVE — the sharp close moves toward the model. Real information." : "SIGNIFICANT and NEGATIVE — the model is a contrarian indicator. Every edge on the board is inverted.") : "NOT distinguishable from zero. The model's disagreement is not confirmed by the sharp close."}`);
      } else {
        verdict.push("CLV fit unavailable — pinnacle_fair_prob is null on these rows. This is the high-power test and it is the one to get working.");
      }
      if (go != null && goSe != null) {
        const sig = Math.abs(go) > 1.96 * goSe;
        verdict.push(`Outcome fit (n=${gammaVsOutcome.n}): gamma=${r3(go)} +/- ${r3(1.96 * goSe)}. ${sig ? "Significant." : "NOT significant — expected at this sample size; do not read a verdict into it either way."}`);
      }
      if (gc != null && go != null && Math.sign(gc) !== Math.sign(go)) {
        verdict.push("The two fits DISAGREE IN SIGN. Believe the CLV fit; the outcome fit has ~100x less power at these sample sizes.");
      }
      verdict.push(`W_MODEL is set to ${W}. ${gc != null ? `The CLV fit says the honest weight is ~${r3(gc)}.` : ""} A W above the true gamma means every published edge is overstated by the difference.`);
    }

    res.json({
      token: "WZ-GAMMAFIT-2026-07-23",
      league, market, publishFloor: BAND,
      reconstruction,
      gammaVsClose: { ...gammaVsClose, gamma: r3(gammaVsClose.gamma), alpha: r3(gammaVsClose.alpha), se: r3(gammaVsClose.se), ci95: gammaVsClose.ci95 ? gammaVsClose.ci95.map(r3) : null },
      gammaVsOutcome: { ...gammaVsOutcome, gamma: r3(gammaVsOutcome.gamma), se: r3(gammaVsOutcome.se), ci95: gammaVsOutcome.ci95 ? gammaVsOutcome.ci95.map(r3) : null },
      oos,
      evAudit,
      verdict,
    });
  } catch (e) {
    console.error("[gammafit] error:", e.message);
    res.status(500).json({ token: "WZ-GAMMAFIT-2026-07-23", error: e.message });
  }
});

module.exports = router;
