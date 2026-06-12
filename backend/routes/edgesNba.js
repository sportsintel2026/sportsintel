// edgesNba.js — GET /api/edges/nba
// Adapter that re-shapes the NBA model's per-game predictions into the SAME flattened
// edge payload Home eats from /api/edges/mlb (games[], moneylineEdges[], totalsEdges[],
// + spreadEdges[] as a bonus market MLB doesn't have). No new modeling: the NBA model
// already computes edge%, picks, fair prob, odds and an inflation flag. What this adds:
//   1) FLATTEN  game.predictions.{moneyline,spread,total} → one ranked row per market.
//   2) CONVICTION — the NBA model has no HIGH/MEDIUM/LOW tiers, so we derive them here,
//      conservatively: suspect data → never above LOW; totals (a sharp market) cap at
//      MEDIUM; a market-inflation flag on OUR pick drops a tier. Edge size is secondary.
//   3) ABBRS — the model returns full team names; we map nickname → standard abbr.
// Mounted at /api/edges/nba (before the /api/edges MLB router) in server.js.
const express = require("express");
const router = express.Router();
const { generateNbaPredictions } = require("../services/nbaService");

// nickname (last word of displayName) → standard abbreviation
const NBA_ABBR = {
  hawks: "ATL", celtics: "BOS", nets: "BKN", hornets: "CHA", bulls: "CHI",
  cavaliers: "CLE", mavericks: "DAL", nuggets: "DEN", pistons: "DET", warriors: "GSW",
  rockets: "HOU", pacers: "IND", clippers: "LAC", lakers: "LAL", grizzlies: "MEM",
  heat: "MIA", bucks: "MIL", timberwolves: "MIN", pelicans: "NOP", knicks: "NYK",
  thunder: "OKC", magic: "ORL", "76ers": "PHI", suns: "PHX", "trail blazers": "POR",
  blazers: "POR", kings: "SAC", spurs: "SAS", raptors: "TOR", jazz: "UTA", wizards: "WAS",
};
function abbrOf(displayName) {
  if (!displayName) return "—";
  const nick = String(displayName).trim().split(/\s+/).pop().toLowerCase();
  return NBA_ABBR[nick] || nick.slice(0, 3).toUpperCase();
}

// Conviction tiers — deliberately conservative for a young (v0.2.1) NBA model.
// trustworthy = ratings loaded AND projection not flagged suspect.
function deriveConviction({ edgePts, market, trustworthy, inflatedOnPick }) {
  let level; // 1 = LOW, 2 = MEDIUM, 3 = HIGH
  if (!trustworthy) {
    level = 1; // suspect data can never be more than a weak lean
  } else if (market === "ml") {
    level = edgePts >= 4 ? 3 : edgePts >= 2 ? 2 : 1;
  } else if (market === "spread") {
    level = edgePts >= 3 ? 3 : edgePts >= 2 ? 2 : 1;
  } else { // totals: books are very sharp + v0.x points model has wide error → cap at MEDIUM
    level = edgePts >= 9 ? 2 : 1;
  }
  if (inflatedOnPick && level > 1) level -= 1; // market disagrees with our fundamentals → temper
  const conviction = level === 3 ? "HIGH" : level === 2 ? "MEDIUM" : "LOW";
  const convictionScore = Math.min(99, Math.round((level - 1) * 30 + Math.min(edgePts, 10) * 3));
  return { conviction, convictionScore };
}

const pct1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function buildNbaEdgesPayload(predictions) {
  const games = [];
  const moneylineEdges = [];
  const totalsEdges = [];
  const spreadEdges = [];

  for (const g of predictions || []) {
    if (!g || g.pending) continue;
    const p = g.predictions || {};
    const ml = p.moneyline || {};
    const sp = p.spread || {};
    const tot = p.total || {};
    const awayAbbr = abbrOf(g.away);
    const homeAbbr = abbrOf(g.home);
    const matchup = `${awayAbbr} @ ${homeAbbr}`;
    const fullMatchup = `${g.away} @ ${g.home}`;
    const trustworthy = !!g.ratingsLoaded && g.dataQuality !== "suspect";

    games.push({
      id: g.gameId,
      away: g.away, home: g.home,
      awayAbbr, homeAbbr,
      status: g.state, state: g.state,
      time: g.date, matchup, fullMatchup,
      neutralSite: !!g.neutralSite,
      totals: { projected: tot.projectedTotal ?? null },
      dataQuality: g.dataQuality,
    });

    // ---- moneyline: pick the favored side (larger model-vs-fair edge), show its lean ----
    if (ml.fair && ml.book && ml.fair.home != null && ml.fair.away != null) {
      const edgeHome = (ml.homeWinProb ?? 0) - (ml.fair.home ?? 0); // already in % points
      const edgeAway = (ml.awayWinProb ?? 0) - (ml.fair.away ?? 0);
      const pickHome = edgeHome >= edgeAway;
      const edgePts = pct1(pickHome ? edgeHome : edgeAway);
      if (edgePts != null && edgePts > 0) {
        const side = pickHome ? "home" : "away";
        const inflatedOnPick = !!(ml.inflation && ml.inflation.inflated && ml.inflation.side === side);
        const { conviction, convictionScore } = deriveConviction({ edgePts, market: "ml", trustworthy, inflatedOnPick });
        const modelProb = (pickHome ? ml.homeWinProb : ml.awayWinProb) / 100; // 0–1 like MLB
        const fairProb = pickHome ? ml.fair.home : ml.fair.away;
        moneylineEdges.push({
          gameId: g.gameId, matchup, fullMatchup, side,
          team: pickHome ? g.home : g.away,
          teamAbbr: pickHome ? homeAbbr : awayAbbr,
          modelProb,
          odds: pickHome ? ml.book.home : ml.book.away,
          edge: edgePts,
          conviction, convictionScore,
          reason: `Model gives ${pickHome ? homeAbbr : awayAbbr} a ${Math.round(pickHome ? ml.homeWinProb : ml.awayWinProb)}% chance vs the market's ${Math.round(fairProb)}%.`,
          inflation: inflatedOnPick ? ml.inflation : null,
          time: g.date, status: g.state,
        });
      }
    }

    // ---- totals: show the lean for any game that has a line ----
    if (tot.line != null && tot.projectedTotal != null) {
      const over = tot.projectedTotal >= tot.line;
      const edgePts = pct1(Math.abs(tot.projectedTotal - tot.line));
      const { conviction, convictionScore } = deriveConviction({ edgePts, market: "total", trustworthy, inflatedOnPick: false });
      totalsEdges.push({
        gameId: g.gameId, matchup, fullMatchup,
        side: over ? "over" : "under",
        line: tot.line,
        projected: tot.projectedTotal,
        odds: tot.book ? (over ? tot.book.over : tot.book.under) : null,
        modelProb: null, // NBA totals model is a points projection, not a calibrated prob
        edge: edgePts,
        conviction, convictionScore,
        reason: `Model projects ${tot.projectedTotal} vs the ${tot.line} line.`,
        inflation: null,
        time: g.date, status: g.state,
      });
    }

    // ---- spread: bonus market (MLB's run line is always empty) ----
    if (sp.line != null && sp.projectedMargin != null && sp.book) {
      const cover = sp.projectedMargin + sp.line; // sp.line = home spread point
      const pickHome = cover >= 0;
      const edgePts = pct1(Math.abs(cover));
      const { conviction, convictionScore } = deriveConviction({ edgePts, market: "spread", trustworthy, inflatedOnPick: false });
      spreadEdges.push({
        gameId: g.gameId, matchup, fullMatchup,
        side: pickHome ? "home" : "away",
        team: pickHome ? g.home : g.away,
        teamAbbr: pickHome ? homeAbbr : awayAbbr,
        line: pickHome ? sp.line : -sp.line,
        odds: pickHome ? sp.book.homePrice : sp.book.awayPrice,
        edge: edgePts,
        conviction, convictionScore,
        reason: `Model projects a ${Math.abs(sp.projectedMargin)}-pt ${sp.projectedMargin >= 0 ? "home" : "away"} margin vs the ${sp.line} spread.`,
        inflation: null,
        time: g.date, status: g.state,
      });
    }
  }

  moneylineEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
  spreadEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
  totalsEdges.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

  return {
    league: "nba",
    generatedAt: new Date().toISOString(),
    games,
    moneylineEdges,
    totalsEdges,
    spreadEdges,
    // present-but-empty so Home's MLB-shaped readers never hit undefined:
    runLineEdges: [],
    hrPropEdges: [],
    hitsPropEdges: [],
    kPropEdges: [],
  };
}

// GET /api/edges/nba  (?date=YYYY-MM-DD optional)
router.get("/", async (req, res) => {
  try {
    const opts = req.query.date ? { date: req.query.date } : {};
    const predictions = await generateNbaPredictions(opts);
    res.json(buildNbaEdgesPayload(predictions));
  } catch (err) {
    console.error("[edges/nba] failed:", err.message);
    res.status(500).json({ ok: false, error: "Failed to build NBA edges" });
  }
});

module.exports = router;
module.exports.buildNbaEdgesPayload = buildNbaEdgesPayload; // exported for local sanity checks
