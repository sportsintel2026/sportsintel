// ============================================================================
// WizePicks model guardrail self-test
// ----------------------------------------------------------------------------
// WHAT THIS IS: a fast "smoke detector" for the edges model. It does NOT prove
// the model is perfectly accurate — it proves the three SAFETY guardrails we
// built are still working, so a future edit can't silently undo them.
//
// It checks:
//   1. THIN-SAMPLE REGRESSION — a pitcher with almost no innings (e.g. the real
//      KC@CIN case: Lyon Richardson, 0.2 IP, 13.50 ERA) gets pulled toward league
//      average instead of being trusted as batting practice.
//   2. A FULL-SEASON pitcher is LEFT ALONE (the fix must not touch real samples).
//   3. MARKET BLEND — a wild model edge gets trimmed toward the market line.
//   4. AGREE-WITH-MARKET — when model = market, the edge is ~0 (no fake edge).
//   5. SANITY CAP — an absurd edge (>30%) is dropped to null.
//   6. DE-VIG — the two fair probabilities of a market sum to 1.
//
// HOW TO RUN (from the backend folder, or wherever edgesModel.js lives):
//   node services/edgesModel.selftest.js
// (adjust the path in require() below if needed)
//
// READ THE RESULT:
//   "ALL GUARDRAILS PASS ✓"  → safe; the protections we built are intact.
//   "GUARDRAILS FAILED ✗"    → a recent change broke a protection. Do NOT deploy
//                              until it's fixed (or revert to the last good commit).
// ============================================================================

const path = require("path");
// edgesModel.js sits next to this file.
const model = require("./edgesModel.js");

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ FAILED: ${label}`);
    if (detail) console.log(`      ${detail}`);
  }
}

// Helpers for tolerant numeric comparison.
const approx = (a, b, tol = 0.01) => a != null && b != null && Math.abs(a - b) <= tol;
const between = (x, lo, hi) => x != null && x >= lo && x <= hi;

console.log("\n=== WizePicks model guardrail self-test ===\n");

// ── 1. Thin-sample regression: the real Richardson case ──────────────────────
console.log("1) Thin-sample regression (the KC@CIN / Lyon Richardson bug):");
{
  const richardson = {
    inningsPitched: 0.2, era: 13.50, whip: 1.50,
    strikeoutsPer9: 13.5, walksPer9: 0, homeRunsPer9: 13.50,
  };
  const r = model.regressThinSample(richardson);
  check("0.2-IP pitcher's 13.50 ERA is pulled toward league average (now < 6)",
        r && r.era != null && r.era < 6,
        `got era=${r && r.era}`);
  check("0.2-IP pitcher's 13.50 HR9 is pulled toward league average (now < 3)",
        r && r.homeRunsPer9 != null && r.homeRunsPer9 < 3,
        `got hr9=${r && r.homeRunsPer9}`);
  check("regression result stays in a sane band (era between 3 and 6)",
        between(r && r.era, 3, 6),
        `got era=${r && r.era}`);
}

// ── 2. A real full-season pitcher must be LEFT ALONE ─────────────────────────
console.log("\n2) Full-sample pitcher is left untouched (fix must not harm real data):");
{
  const established = {
    inningsPitched: 120, era: 3.20, whip: 1.05,
    strikeoutsPer9: 10.1, walksPer9: 2.2, homeRunsPer9: 0.9,
  };
  const r = model.regressThinSample(established);
  check("120-IP pitcher's ERA is unchanged (3.20 stays 3.20)",
        r && approx(r.era, 3.20),
        `got era=${r && r.era}`);
  check("120-IP pitcher's HR9 is unchanged (0.9 stays 0.9)",
        r && approx(r.homeRunsPer9, 0.9),
        `got hr9=${r && r.homeRunsPer9}`);
}

// ── 3. Market blend trims a wild model edge toward the market ────────────────
console.log("\n3) Market blend trims an over-confident model edge:");
{
  // model says 52% on a +150 underdog; other side -170. de-vig fair ~38.8%.
  const old = model.calculateEdgeDevig(0.52, 150, -170);
  const blended = model.blendedEdge(0.52, 150, -170);
  check("blended edge is smaller in magnitude than the raw edge",
        old != null && blended != null && Math.abs(blended) < Math.abs(old),
        `raw=${old}, blended=${blended}`);
  check("blended edge is still positive (didn't flip the side)",
        blended != null && blended > 0,
        `blended=${blended}`);
}

// ── 4. Agreeing with the market produces ~no edge ────────────────────────────
console.log("\n4) Agreeing with the market yields ~0 edge (no manufactured edge):");
{
  // -110/-110 market de-vigs to 50%. Model also ~50% → edge ~0.
  const blended = model.blendedEdge(0.50, -110, -110);
  check("model = market (50% vs 50%) gives an edge within ±1.5%",
        blended != null && Math.abs(blended) <= 0.015,
        `blended=${blended}`);
}

// ── 5. Sanity cap drops absurd edges ─────────────────────────────────────────
console.log("\n5) Sanity cap drops implausible edges:");
{
  check("an edge of +0.69 (69%) is dropped to null",
        model.sanitizeEdge(0.69) === null);
  check("an edge of -0.45 (-45%) is dropped to null",
        model.sanitizeEdge(-0.45) === null);
  check("a normal +0.08 (8%) edge is kept",
        model.sanitizeEdge(0.08) === 0.08);
  check("NaN/garbage is dropped to null",
        model.sanitizeEdge(NaN) === null);
}

// ── 6. De-vig sanity: fair probabilities sum to 1 ────────────────────────────
console.log("\n6) De-vig produces fair probabilities that sum to 1:");
{
  const a = model.devigTwoWay(-130, 115); // over -130
  const b = model.devigTwoWay(115, -130); // under +115
  check("the two de-vigged sides sum to ~1.0",
        a != null && b != null && approx(a + b, 1.0, 0.001),
        `over=${a}, under=${b}, sum=${a != null && b != null ? (a + b).toFixed(4) : "n/a"}`);
  check("the more expensive side (-130) is the higher probability",
        a != null && b != null && a > b,
        `over(-130)=${a}, under(+115)=${b}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n-------------------------------------------");
if (failures === 0) {
  console.log(`ALL GUARDRAILS PASS ✓   (${checks} checks)`);
  console.log("Safe to deploy — the thin-sample regression, market blend, and");
  console.log("sanity cap are all intact.");
  process.exit(0);
} else {
  console.log(`GUARDRAILS FAILED ✗   (${failures} of ${checks} checks failed)`);
  console.log("A recent change broke a protection we built. Do NOT deploy until");
  console.log("this is fixed, or revert to the last good commit on GitHub.");
  process.exit(1);
}
