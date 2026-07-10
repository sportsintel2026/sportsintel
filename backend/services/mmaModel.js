// mmaModel.js :: WZ-UFC-MODEL-2026-07-09 / WZ-UFC-STYLE-2026-07-09
// Market-anchored MMA edge model. Starts from the de-vigged market probability and applies
// small, CAPPED tilts from real fight factors, then edge = model - market. The cap (+/-0.42
// logit ~= +/-9%) keeps the model a scalpel, not a wrecking ball -- it nudges the sharp line,
// never overrides it. Every factor is individually capped too, so no single read dominates.
//
// FACTORS (all read from Cito's fighter profile; any field we can't read = neutral):
//   age        - decline curve, penalty past ~35
//   reach      - reach advantage (unit-agnostic difference)
//   striking   - output x accuracy vs opponent's strike DEFENSE, minus damage absorbed
//   grappling  - realistic takedown success (TD avg x accuracy) vs opponent's takedown DEFENSE,
//                plus submission threat and ground tendency  --> this is the striker-vs-grappler
//                clash: a grappler only gets the edge if the opponent can't stop the takedown
//   cardio     - gas tank: avg fight time + decision-win rate, minus damage taken (faders bleed)
//   finishing  - KO+sub rate (finishers close the show)
//   experience - seasoned vs green (diminishing, capped small)
//
// HONESTY: v1, UNVALIDATED for MMA until it grades against real cards. The ufc_picks recorder
// captures model_win% + edge on every pick so we can prove/disprove it starting this weekend.
// Caps keep it safe in the meantime.

function logit(p) { const q = Math.min(0.995, Math.max(0.005, p)); return Math.log(q / (1 - q)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---- field extraction (matches Cito fighter-profile shape) -----------------
function getAge(p) {
  if (!p) return null;
  const a = toNum(p.age);
  if (a != null && a > 15 && a < 60) return a;
  const dob = p.birthDate || p.dateOfBirth || p.dob;
  if (dob) { const d = new Date(dob); if (!isNaN(d.getTime())) return (Date.now() - d.getTime()) / (365.25 * 864e5); }
  return null;
}
function getReach(p) { return p ? toNum(p.reachInches != null ? p.reachInches : p.reach) : null; }
function getRecord(p) {
  const r = (p && (p.record || p)) || {};
  const w = toNum(r.wins != null ? r.wins : p && p.recordWins);
  const l = toNum(r.losses != null ? r.losses : p && p.recordLosses);
  const d = toNum(r.draws != null ? r.draws : p && p.recordDraws);
  return { wins: w || 0, losses: l || 0, draws: d || 0, has: w != null && l != null };
}
// pull the stats block and normalize the numbers we use
function getStats(p) {
  const s = (p && p.stats) || {};
  const pos = s.sigStrikesByPosition || {};
  const wbm = s.winsByMethod || {};
  const pct = (o) => (o && o.percent != null ? toNum(o.percent) : null);
  return {
    strLpm: toNum(s.sigStrikesLandedPerMin),
    strApm: toNum(s.sigStrikesAbsorbedPerMin),
    strAcc: toNum(s.strikingAccuracy),
    strDef: toNum(s.sigStrikeDefense),
    tdAvg: toNum(s.takedownAvgPer15Min),
    tdAcc: toNum(s.takedownAccuracy),
    tdDef: toNum(s.takedownDefense),
    subAvg: toNum(s.submissionAvgPer15Min),
    kdAvg: toNum(s.knockdownAvg),
    avgTime: toNum(s.averageFightTimeSeconds),
    groundPct: pct(pos.ground),
    standPct: pct(pos.standing),
    decPct: pct(wbm.dec),
    koPct: pct(wbm["ko-tko"] || wbm.ko),
    subPct: pct(wbm.sub),
  };
}
function finishRate(st) {
  if (st.koPct == null && st.subPct == null) return null;
  return (st.koPct || 0) + (st.subPct || 0);
}

// striking output score of `a` against defender `b`
function strikeScore(a, b) {
  if (a.strLpm == null || a.strAcc == null) return null;
  const def = b.strDef != null ? b.strDef : 0.5;
  const offense = a.strLpm * a.strAcc * (1 - def);
  const damage = (a.strApm != null ? a.strApm : 3) * 0.30;
  return offense - damage;
}
// grappling control score of `a` against defender `b` (TD defense-adjusted) + sub/ground
function grapScore(a, b) {
  if (a.tdAvg == null && a.subAvg == null) return null;
  const tddOpp = b.tdDef != null ? b.tdDef : 0.6;
  const td = (a.tdAvg || 0) * (a.tdAcc != null ? a.tdAcc : 0.4) * (1 - tddOpp);
  const sub = (a.subAvg || 0) * 0.5;
  const ground = (a.groundPct != null ? a.groundPct : 0) * 0.4;
  return td + sub + ground;
}
function cardioScore(st) {
  let s = 0, any = false;
  if (st.avgTime != null) { s += (st.avgTime / 600 - 1) * 0.5; any = true; }   // longer avg = tank
  if (st.decPct != null) { s += st.decPct * 0.5; any = true; }                 // decision-heavy = paces
  if (st.strApm != null) { s -= (st.strApm - 3) * 0.05; any = true; }          // damage taken = fades
  return any ? s : null;
}

// ---- the model -------------------------------------------------------------
function scoreBout(redProfile, blueProfile, pMktRed) {
  if (pMktRed == null || !Number.isFinite(pMktRed)) return null;
  const factors = [];
  let used = 0;
  const add = (name, delta, detail) => {
    if (delta && Number.isFinite(delta)) { factors.push({ name, delta, detail }); used++; }
  };
  const R = getStats(redProfile), B = getStats(blueProfile);

  // 1) AGE
  const ageR = getAge(redProfile), ageB = getAge(blueProfile);
  if (ageR != null && ageB != null) {
    let d = clamp((ageB - ageR) * 0.02, -0.18, 0.18);
    const pen = (a) => (a > 38 ? -0.10 : a > 35 ? -0.05 : a > 33 ? -0.02 : 0);
    d += clamp(pen(ageR) - pen(ageB), -0.14, 0.14);
    add("age", clamp(d, -0.22, 0.22), `${Math.round(ageR)} vs ${Math.round(ageB)}`);
  }

  // 2) REACH
  const rR = getReach(redProfile), rB = getReach(blueProfile);
  if (rR != null && rB != null) add("reach", clamp((rR - rB) * 0.010, -0.08, 0.08), `${rR}" vs ${rB}"`);

  // 3) STRIKING (output vs opponent defense, minus damage)
  const sR = strikeScore(R, B), sB = strikeScore(B, R);
  if (sR != null && sB != null) add("striking", clamp((sR - sB) * 0.045, -0.11, 0.11), null);

  // 4) GRAPPLING (takedown success vs opponent TDD -- the striker-vs-grappler clash)
  const gR = grapScore(R, B), gB = grapScore(B, R);
  if (gR != null && gB != null) add("grappling", clamp((gR - gB) * 0.055, -0.11, 0.11), null);

  // 5) CARDIO (gas tank)
  const cR = cardioScore(R), cB = cardioScore(B);
  if (cR != null && cB != null) add("cardio", clamp((cR - cB) * 0.12, -0.08, 0.08), null);

  // 6) FINISHING
  const fR = finishRate(R), fB = finishRate(B);
  if (fR != null && fB != null) add("finishing", clamp((fR - fB) * 0.10, -0.06, 0.06), null);

  // 7) EXPERIENCE
  const recR = getRecord(redProfile), recB = getRecord(blueProfile);
  if (recR.has && recB.has) {
    const eR = Math.log1p(recR.wins + recR.losses + recR.draws);
    const eB = Math.log1p(recB.wins + recB.losses + recB.draws);
    add("experience", clamp((eR - eB) * 0.05, -0.07, 0.07), `${recR.wins + recR.losses} vs ${recB.wins + recB.losses}`);
  }

  let total = factors.reduce((s, f) => s + f.delta, 0);
  total = clamp(total, -0.42, 0.42); // hard cap: model only nudges the market

  const modelRed = sigmoid(logit(pMktRed) + total);
  return { modelRed, edgeRed: modelRed - pMktRed, totalTilt: total, factors, usedFactors: used };
}

// WZ-UFC-METHOD-2026-07-09 :: method LEAN -- an info-only read of how a fight is most likely to
// end (KO/TKO, submission, or decision), from both fighters' win-method splits plus pace/durability.
// NOT a priced bet: The Odds API doesn't price MMA method markets, so there's no line to beat -- we
// never attach an edge or a +VALUE tag to this. It's a handicapping read, shown neutral/gold; green
// (edge/value) stays reserved for real market-beating picks. Any missing data => no lean (null).
function methodLean(redProfile, blueProfile) {
  const R = getStats(redProfile), B = getStats(blueProfile);
  const rHas = R.koPct != null || R.subPct != null || R.decPct != null;
  const bHas = B.koPct != null || B.subPct != null || B.decPct != null;
  if (!rHas || !bHas) return null;

  const ko  = ((R.koPct  || 0) + (B.koPct  || 0)) / 2;
  const sub = ((R.subPct || 0) + (B.subPct || 0)) / 2;
  const dec = ((R.decPct || 0) + (B.decPct || 0)) / 2;
  const finish = ko + sub;

  // pace/durability nudge: a long average fight time on both sides leans the read toward the
  // scorecards; a short one leans it toward an early finish. avgTime is in seconds.
  let decBias = 0;
  if (R.avgTime != null && B.avgTime != null) {
    const avg = (R.avgTime + B.avgTime) / 2;
    decBias = clamp((avg - 600) / 900, -0.15, 0.20);
  }
  const decScore = dec + decBias;

  const SEP = 0.08; // need a clear gap to call a lean, else "competitive / no strong lean"
  if (finish - decScore > SEP) {
    if (ko - sub > 0.05) return { lean: "KO",     label: "Leans KO/TKO",     note: "both tend to finish standing" };
    if (sub - ko > 0.05) return { lean: "SUB",    label: "Leans submission", note: "grappling-heavy finishers" };
    return { lean: "FINISH", label: "Leans finish", note: "high finish rate on both sides" };
  }
  if (decScore - finish > SEP) {
    return { lean: "DEC", label: "Leans decision", note: "durable, distance-going styles" };
  }
  return { lean: "EVEN", label: "No strong lean", note: "could end either way" };
}

module.exports = { scoreBout, methodLean };
