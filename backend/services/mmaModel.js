// mmaModel.js :: WZ-UFC-MODEL-2026-07-09
// Market-anchored MMA edge model. It does NOT try to out-think the sharp line from scratch --
// it STARTS from the de-vigged market probability and applies small, CAPPED tilts from the
// fight factors a good handicapper reads: age, reach, layoff (ring rust), finishing ability,
// experience, and recent form. The total tilt is capped (+/-0.42 logit ~= +/-9%) so the model
// can never wildly diverge from the market -- it only nudges. edge = model - market; a positive
// edge on our pick means the model thinks the book is a little light on that side.
//
// IMPORTANT (honesty): this is a v1 model. It is UNVALIDATED for MMA until it grades against
// real cards (the ufc_picks recorder captures every pick for exactly this). The route records
// model_win% + edge so we can prove or disprove it over the coming events. Caps keep it safe in
// the meantime. Factor parsing is defensive across likely Cito field names; any field we can't
// read contributes 0 (neutral), so a thin profile degrades gracefully to near-market.

function logit(p) { const q = Math.min(0.995, Math.max(0.005, p)); return Math.log(q / (1 - q)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---- defensive field extraction (works across common UFC profile shapes) ---
function getAge(p) {
  if (!p) return null;
  const direct = toNum(p.age);
  if (direct != null && direct > 15 && direct < 60) return direct;
  const dob = p.dateOfBirth || p.dob || p.birthDate || p.birthdate || p.born;
  if (dob) { const d = new Date(dob); if (!isNaN(d.getTime())) return (Date.now() - d.getTime()) / (365.25 * 864e5); }
  return null;
}
function getReach(p) { // unit-agnostic: only the DIFFERENCE between the two fighters is used
  if (!p) return null;
  return toNum(p.reach != null ? p.reach : (p.reachInches != null ? p.reachInches : (p.reachCm != null ? p.reachCm : (p.measurements && p.measurements.reach))));
}
function getFightsArray(p) {
  if (!p) return [];
  const a = p.fights || p.recentFights || p.fightHistory || p.results || p.bouts;
  return Array.isArray(a) ? a : [];
}
function getLayoffDays(p) {
  const arr = getFightsArray(p);
  let last = null;
  if (arr.length) {
    const d = arr[0].date || arr[0].eventDate || arr[0].fightDate;
    if (d) { const dd = new Date(d); if (!isNaN(dd.getTime())) last = dd; }
  }
  if (!last && p && p.lastFightDate) { const dd = new Date(p.lastFightDate); if (!isNaN(dd.getTime())) last = dd; }
  if (!last) return null;
  return (Date.now() - last.getTime()) / 864e5;
}
function getRecord(p) {
  const r = (p && (p.record || p)) || {};
  const w = toNum(r.wins), l = toNum(r.losses), d = toNum(r.draws);
  return { wins: w || 0, losses: l || 0, draws: d || 0, has: w != null && l != null };
}
function getFinishRate(p) {
  if (!p) return null;
  const rec = p.record || {};
  const w = getRecord(p).wins;
  const ko = toNum(rec.winsByKnockout != null ? rec.winsByKnockout : (rec.ko != null ? rec.ko : (p.wins && (p.wins["ko/tko"] != null ? p.wins["ko/tko"] : p.wins.ko))));
  const sub = toNum(rec.winsBySubmission != null ? rec.winsBySubmission : (rec.sub != null ? rec.sub : (p.wins && p.wins.submissions)));
  if (w > 0 && (ko != null || sub != null)) return ((ko || 0) + (sub || 0)) / w;
  return null;
}
function getRecentForm(p) { // fraction of last <=3 fights won, minus 0.5 (so streak=+, skid=-)
  const arr = getFightsArray(p).slice(0, 3);
  if (!arr.length) return null;
  let wins = 0, counted = 0;
  for (const f of arr) {
    const res = String(f.result || f.outcome || "").toLowerCase();
    if (res.includes("win") || res === "w") { wins++; counted++; }
    else if (res.includes("loss") || res === "l") { counted++; }
  }
  if (!counted) return null;
  return wins / counted - 0.5;
}

// ---- the model -------------------------------------------------------------
// Returns { modelRed, edgeRed, factors:[{name, delta, detail}], usedFactors }
// pMktRed = de-vigged market win probability for the RED corner.
function scoreBout(redProfile, blueProfile, pMktRed) {
  if (pMktRed == null || !Number.isFinite(pMktRed)) return null;
  const factors = [];
  let used = 0;
  const add = (name, delta, detail) => {
    if (delta && Number.isFinite(delta)) { factors.push({ name, delta, detail }); used++; }
  };

  // 1) AGE -- decline curve. Younger edge; extra penalty for being old (esp > 35).
  const ageR = getAge(redProfile), ageB = getAge(blueProfile);
  if (ageR != null && ageB != null) {
    let d = clamp((ageB - ageR) * 0.02, -0.18, 0.18);         // younger red -> +
    const pen = (a) => (a > 38 ? -0.10 : a > 35 ? -0.05 : a > 33 ? -0.02 : 0);
    d += clamp(pen(ageR) - pen(ageB), -0.14, 0.14);
    add("age", clamp(d, -0.22, 0.22), `R ${Math.round(ageR)} vs B ${Math.round(ageB)}`);
  }

  // 2) REACH -- longer reach small edge (unit-agnostic difference).
  const rR = getReach(redProfile), rB = getReach(blueProfile);
  if (rR != null && rB != null) add("reach", clamp((rR - rB) * 0.010, -0.10, 0.10), `${rR} vs ${rB}`);

  // 3) LAYOFF / ring rust -- penalty for long inactivity vs opponent.
  const loR = getLayoffDays(redProfile), loB = getLayoffDays(blueProfile);
  if (loR != null && loB != null) {
    const rust = (days) => (days > 730 ? -0.12 : days > 540 ? -0.08 : days > 365 ? -0.04 : 0);
    add("layoff", clamp(rust(loR) - rust(loB), -0.14, 0.14), `${Math.round(loR)}d vs ${Math.round(loB)}d`);
  }

  // 4) FINISHING -- higher KO+sub rate, slight edge (finishers close the show).
  const fR = getFinishRate(redProfile), fB = getFinishRate(blueProfile);
  if (fR != null && fB != null) add("finishing", clamp((fR - fB) * 0.16, -0.08, 0.08), `${Math.round(fR * 100)}% vs ${Math.round(fB * 100)}%`);

  // 5) EXPERIENCE -- seasoned vs green (diminishing; capped small).
  const recR = getRecord(redProfile), recB = getRecord(blueProfile);
  if (recR.has && recB.has) {
    const expR = Math.log1p(recR.wins + recR.losses + recR.draws);
    const expB = Math.log1p(recB.wins + recB.losses + recB.draws);
    add("experience", clamp((expR - expB) * 0.05, -0.08, 0.08), `${recR.wins + recR.losses} vs ${recB.wins + recB.losses} fights`);
  }

  // 6) RECENT FORM -- win streak vs skid over last 3.
  const formR = getRecentForm(redProfile), formB = getRecentForm(blueProfile);
  if (formR != null && formB != null) add("form", clamp((formR - formB) * 0.20, -0.10, 0.10), null);

  let total = factors.reduce((s, f) => s + f.delta, 0);
  total = clamp(total, -0.42, 0.42); // hard cap: model only nudges the market

  const modelRed = sigmoid(logit(pMktRed) + total);
  return {
    modelRed,
    edgeRed: modelRed - pMktRed,
    totalTilt: total,
    factors,
    usedFactors: used,
  };
}

module.exports = { scoreBout };
