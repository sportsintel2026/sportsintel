// backend/services/footballMargin.js
// WZ-FBALL-KEYNUM-2026-07-17 :: key-number-aware margin distribution for football spread cover.
//
// Football final margins are NOT smoothly distributed — they spike hard on 3 and 7 (field goal /
// touchdown), with secondary clusters at 4, 6, 10, 14. A plain Normal (what nflModel/cfbModel used)
// misprices any spread sitting on or near those numbers and assigns ~zero push mass exactly where
// real pushes pile up. That's the football version of the MLB run-line "one-run mass" trap the old
// run-line fell into by smearing a bell curve over ±1-run games.
//
// This builds a DISCRETE margin PMF = a Normal envelope centered on the model's projected margin,
// times a KEY-NUMBER COMB (the football scoring lattice), then derives cover / push / loss probs
// from it. The comb weights were fit so the projection-neutral marginal reproduces published NFL and
// CFB victory-margin frequencies (see footballMargin.selftest). KEY_STRENGTH is a reversible dial:
// 1.0 = full physical weighting (default), 0 = comb off (a discrete Normal that still handles the
// integer-margin pushes a continuous Normal misses). Shared by NFL and CFB per the playbook so the
// margin->cover transform is calibrated once (on CFB's faster-filling data) and carried to NFL.

// Unnormalized standard-normal density (envelope shape only; the PMF is normalized below).
const _npdf = (z) => Math.exp(-0.5 * z * z);

// Multiplicative EXCESS weight at each ABSOLUTE key margin (weight = envelope * (1 + bump*strength)).
// Absolute margin -> bump. Fit to empirical victory-margin frequencies (NFL 3~9.7% / 7~6.6%; CFB is
// flatter — more blowouts and 2-pt conversions spread the mass, so its 3/7 spikes are milder).
const KEY = {
  // NFL comb CALIBRATED to real closing-line-vs-result data (nflverse, 2010-2025 regular season,
  // WZ-FBALL-BACKTEST-2026-07-17). Fit so push@k (mu=k) matches the ACTUAL push rate on a k-point
  // spread: 3=9.0%, 7=6.3%, 10=9.5% (10 is a major key — two-score margin), 6=3.6%, 4=1.6% (a dead
  // number), etc. Replaced the earlier published-estimate comb, which underweighted 10 badly.
  nfl: { 1: -0.38, 2: -0.07, 3: 2.99, 4: -0.29, 5: -0.52, 6: 0.57, 7: 1.73, 10: 3.02 },
  // CFB comb CALIBRATED to real closing-line-vs-result data (CollegeFootballData, 2020-2024 FBS,
  // 3,475 games, WZ-CFB-BACKTEST-2026-07-17). Fit so push@k matches ACTUAL push rates: 7=7.5%,
  // 3=5.8%, 10/14=4.8%. Note the college quirk — 7 pushes MORE than 3 (more games decided by exactly
  // a TD), the reverse of the NFL; the old estimate-based comb had that backwards.
  cfb: { 3: 2.12, 4: 0.34, 6: -0.9, 7: 2.99, 10: 1.51, 14: 1.44, 17: 1.23, 21: 1.06 },
};

// Default margin SDs (physical priors from the playbook). Callers pass sigma explicitly; these are
// the fallbacks and the values the selftest calibrates against.
const SIGMA = { nfl: 13.0, cfb: 15.5 }; // real margin-vs-spread residual SDs (WZ-FBALL-BACKTEST / WZ-CFB-BACKTEST-2026-07-17)

// Discrete PMF over integer home margins (home − away), centered on `mu`, spread `sigma`, with the
// league's key-number comb scaled by `strength`. Returns a Map<integerMargin, probability>.
function marginPMF(mu, sigma, league = "nfl", strength = 1) {
  const keys = KEY[league] || {};
  const s = sigma > 0 ? sigma : (SIGMA[league] || 13.5);
  const lo = Math.floor(mu - 6 * s), hi = Math.ceil(mu + 6 * s);
  const out = new Map();
  let Z = 0;
  for (let m = lo; m <= hi; m++) {
    const w = _npdf((m - mu) / s) * (1 + (keys[Math.abs(m)] || 0) * strength);
    out.set(m, w);
    Z += w;
  }
  if (Z > 0) for (const [m, w] of out) out.set(m, w / Z);
  return out;
}

// Spread cover for the HOME side of a signed home line (e.g. homeLine -3.5 → home favored by 3.5).
// Home COVERS when actual home margin M > -homeLine; M == -homeLine is a PUSH (only possible on a
// whole-number line); otherwise a LOSS. Returns raw {cover, push, loss} plus `homeCoverProb`, the
// two-way (push-excluded) cover probability — directly comparable to a de-vigged book spread price.
function spreadCover(mu, sigma, homeLine, league = "nfl", strength = 1) {
  const pmf = marginPMF(mu, sigma, league, strength);
  const thr = -homeLine;
  let cover = 0, push = 0, loss = 0;
  for (const [m, p] of pmf) {
    if (m > thr) cover += p;
    else if (m === thr) push += p;
    else loss += p;
  }
  const decisive = cover + loss;
  const homeCoverProb = decisive > 0 ? cover / decisive : 0.5;
  return { cover, push, loss, homeCoverProb };
}

// Win probability (home margin > 0) from the same distribution, ties split 50/50. Optional — the
// models keep their moneyline anchor; exposed for consistency / future use.
function winProb(mu, sigma, league = "nfl", strength = 1) {
  const pmf = marginPMF(mu, sigma, league, strength);
  let win = 0, tie = 0;
  for (const [m, p] of pmf) { if (m > 0) win += p; else if (m === 0) tie += p; }
  return win + 0.5 * tie;
}

module.exports = { marginPMF, spreadCover, winProb, KEY, SIGMA };
