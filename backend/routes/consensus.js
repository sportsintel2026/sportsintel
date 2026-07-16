// routes/consensus.js — READ-ONLY consensus endpoint.
//
//   GET /api/consensus/mlb
//
// Surfaces where TWO INDEPENDENT signals agree:
//   1. the model's edges (moneyline / total / run_line on today's board), and
//   2. the owner's hand-entered Best Bets (expert_picks).
// A "consensus" play is a STRICT apples-to-apples match: same game, same market,
// same side, and (for total/run_line) the SAME line.
//
// WHY THIS IS A DIAGNOSTIC FIRST, NOT UI YET:
//   The two systems key games by DIFFERENT id namespaces (Best Bets use ESPN
//   event ids; the model uses MLB StatsAPI ids), so a match can only be made on
//   sport + teams + market + side + line. That team-alignment must be verified on
//   real data before we trust it. So this endpoint returns not just the matches
//   but a per-Best-Bet diagnostic ("why this did / didn't match") plus the raw
//   strings it compared, so we can confirm the matcher is correct, then build the
//   "Best Bets" headline panel on top of it.
//
// SAFETY: read-only. Writes nothing. Reads the model's ALREADY-CACHED edges over
// localhost (no recompute, so no Odds API credits) and reads expert_picks. If the
// edges cache is cold this will trigger one recompute — open the edges board first
// to warm it. The response carries `modelEdgesCached` so you can see which it was.
//
// Mount in server.js (with the other routes):
//   const consensusRoutes = require("./routes/consensus");
//   app.use("/api/consensus", consensusRoutes);

const express = require("express");
const router = express.Router();
const { gateModelData } = require("../middleware/accessGate"); // WZ-LOCK-ROUND2-2026-07-15
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// ── Team name normalization ───────────────────────────────────────────────────
// Maps any distinctive token (abbr, nickname, unambiguous city) -> canonical abbr.
// Nicknames are preferred because cities like "chicago"/"new york"/"los angeles"
// are shared by two clubs and are therefore unsafe on their own.
const TEAM_TOKENS = {
  diamondbacks: "ARI", dbacks: "ARI", "d-backs": "ARI", arizona: "ARI", ari: "ARI", az: "ARI",
  braves: "ATL", atlanta: "ATL", atl: "ATL",
  orioles: "BAL", baltimore: "BAL", bal: "BAL",
  "red sox": "BOS", redsox: "BOS", boston: "BOS", bos: "BOS",
  cubs: "CHC", chc: "CHC",
  "white sox": "CWS", whitesox: "CWS", cws: "CWS", chw: "CWS",
  reds: "CIN", cincinnati: "CIN", cin: "CIN",
  guardians: "CLE", cleveland: "CLE", cle: "CLE",
  rockies: "COL", colorado: "COL", col: "COL",
  tigers: "DET", detroit: "DET", det: "DET",
  astros: "HOU", houston: "HOU", hou: "HOU",
  royals: "KC", "kansas city": "KC", kc: "KC", kcr: "KC",
  angels: "LAA", laa: "LAA",
  dodgers: "LAD", lad: "LAD",
  marlins: "MIA", miami: "MIA", mia: "MIA",
  brewers: "MIL", milwaukee: "MIL", mil: "MIL",
  twins: "MIN", minnesota: "MIN", min: "MIN",
  mets: "NYM", nym: "NYM",
  yankees: "NYY", nyy: "NYY",
  athletics: "ATH", "a's": "ATH", oakland: "ATH", ath: "ATH", oak: "ATH",
  phillies: "PHI", philadelphia: "PHI", phi: "PHI",
  pirates: "PIT", pittsburgh: "PIT", pit: "PIT",
  padres: "SD", "san diego": "SD", sd: "SD", sdp: "SD",
  giants: "SF", "san francisco": "SF", sf: "SF", sfg: "SF",
  mariners: "SEA", seattle: "SEA", sea: "SEA",
  cardinals: "STL", "st. louis": "STL", "st louis": "STL", stl: "STL",
  rays: "TB", "tampa bay": "TB", tb: "TB", tbr: "TB",
  rangers: "TEX", texas: "TEX", tex: "TEX",
  "blue jays": "TOR", bluejays: "TOR", toronto: "TOR", tor: "TOR",
  nationals: "WSH", nats: "WSH", washington: "WSH", wsh: "WSH", was: "WSH",
};

// Sorted longest-first so multi-word tokens ("red sox") win over short ones ("sox"/"red").
const TOKEN_KEYS = Object.keys(TEAM_TOKENS).sort((a, b) => b.length - a.length);

// Return the SET of canonical team abbrs referenced by an arbitrary string
// (a matchup like "PIT @ ATL" or a Best Bet's free-form `game` field).
function teamsInString(s) {
  const found = new Set();
  if (!s) return found;
  let hay = ` ${String(s).toLowerCase()} `;
  for (const tok of TOKEN_KEYS) {
    // word-ish boundary match; consume so "chicago cubs" doesn't also fire "chicago" for CWS
    const re = new RegExp(`(^|[^a-z])${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(hay)) {
      found.add(TEAM_TOKENS[tok]);
      hay = hay.replace(re, " ");
    }
  }
  return found;
}

function sameGame(aStr, bStr) {
  const a = teamsInString(aStr), b = teamsInString(bStr);
  if (a.size !== 2 || b.size !== 2) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

// ── Market / side normalization ───────────────────────────────────────────────
function normMarket(m) {
  const x = String(m || "").toLowerCase().replace(/[\s_-]/g, "");
  if (x === "moneyline" || x === "ml" || x === "h2h") return "moneyline";
  if (x === "total" || x === "totals" || x === "ou" || x === "overunder") return "total";
  if (x === "runline" || x === "spread" || x === "rl") return "run_line";
  return x; // anything else (props, etc.) won't match a team-market edge
}
function normSide(s) {
  const x = String(s || "").toLowerCase().trim();
  if (x === "away" || x === "home" || x === "over" || x === "under") return x;
  return x;
}
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Build the model's pick list from the edges payload ─────────────────────────
function modelPicksFromEdges(edges) {
  const out = [];
  for (const e of edges.moneylineEdges || []) {
    out.push({ market: "moneyline", side: normSide(e.side), line: null, matchup: e.matchup || e.fullMatchup,
      teams: teamsInString(e.fullMatchup || e.matchup), edge: e.edge, confidence: e.confidence, odds: e.odds,
      display: `${e.teamAbbr || e.team} ML` });
  }
  for (const e of edges.totalsEdges || []) {
    out.push({ market: "total", side: normSide(e.side), line: numOrNull(e.line), matchup: e.matchup || e.fullMatchup,
      teams: teamsInString(e.fullMatchup || e.matchup), edge: e.edge, confidence: e.confidence, odds: e.odds,
      display: `${e.side} ${e.line}` });
  }
  for (const e of edges.runLineEdges || []) {
    out.push({ market: "run_line", side: normSide(e.side), line: numOrNull(e.line), matchup: e.matchup || e.fullMatchup,
      teams: teamsInString(e.fullMatchup || e.matchup), edge: e.edge, confidence: e.confidence, odds: e.odds,
      display: `${e.teamAbbr || e.team} ${e.line}` });
  }
  return out;
}

// Does this model pick match this Best Bet? (STRICT: same game, market, side, line)
function isMatch(mp, bb) {
  if (mp.market !== bb.market) return false;
  if (mp.side !== bb.side) return false;
  if (bb.market === "total" || bb.market === "run_line") {
    if (mp.line == null || bb.line == null || mp.line !== bb.line) return false;
  }
  return sameGame(mp.matchup, bb.gameStr);
}

// Explain why a Best Bet didn't match anything (best-effort, for verification).
function reason(bb, modelPicks) {
  const sameG = modelPicks.filter(mp => sameGame(mp.matchup, bb.gameStr));
  if (bb.teams.size !== 2) return "could-not-read-2-teams-from-Best-Bet-game-field";
  if (sameG.length === 0) return "model-has-no-surfaced-edge-for-this-game";
  const sameGM = sameG.filter(mp => mp.market === bb.market);
  if (sameGM.length === 0) return `model-has-no-${bb.market}-edge-for-this-game`;
  const sameSide = sameGM.filter(mp => mp.side === bb.side);
  if (sameSide.length === 0) return "model-favors-the-OPPOSITE-side";
  if (bb.market === "total" || bb.market === "run_line") return "same-side-but-DIFFERENT-line";
  return "no-match-unknown";
}

router.get("/mlb", gateModelData, async (req, res) => {
  try {
    // 1) Model edges — read the cached board over localhost (no recompute).
    const port = process.env.PORT || 4000;
    let edges;
    let modelEdgesCached = null;
    try {
      const r = await axios.get(`http://127.0.0.1:${port}/api/edges/mlb`, { timeout: 25000 });
      edges = r.data;
      modelEdgesCached = !!edges.cached;
    } catch (e) {
      return res.status(502).json({ error: "could not read model edges", details: e.message });
    }
    const slateDate = edges.date;
    const modelPicks = modelPicksFromEdges(edges);

    // 2) Best Bets — read expert_picks for the same slate date (read-only).
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "Supabase env not set" });
    }
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: rows, error } = await sb
      .from("expert_picks")
      .select("date, picks")
      .eq("date", slateDate);
    if (error) return res.status(500).json({ error: "load expert_picks: " + error.message });

    const bestBets = [];
    for (const row of rows || []) {
      let picks;
      try { picks = JSON.parse(row.picks || "[]"); } catch (_) { continue; }
      if (!Array.isArray(picks)) continue;
      for (const p of picks) {
        if (!p) continue;
        if (p.type && p.type !== "straight") continue;            // skip parlays
        if (String(p.sport || "").toLowerCase() !== "mlb") continue;
        const market = normMarket(p.market);
        if (!["moneyline", "total", "run_line"].includes(market)) continue; // team markets only
        const gameStr = p.game || "";
        bestBets.push({
          market,
          side: normSide(p.selection),
          line: numOrNull(p.line),
          gameStr,
          teams: teamsInString(gameStr),
          odds: p.odds ?? null,
          analysis: p.analysis || null,
          display: p.pick || `${gameStr} — ${p.market} ${p.selection}`,
        });
      }
    }

    // 3) Match.
    const consensus = [];
    const unmatched = [];
    for (const bb of bestBets) {
      const hit = modelPicks.find(mp => isMatch(mp, bb));
      if (hit) {
        consensus.push({
          game: hit.matchup,
          market: bb.market,
          side: bb.side,
          line: bb.line,
          bestBet: { display: bb.display, odds: bb.odds, analysis: bb.analysis },
          model: { display: hit.display, edge: hit.edge, confidence: hit.confidence, odds: hit.odds },
        });
      } else {
        unmatched.push({
          bestBet: bb.display,
          market: bb.market, side: bb.side, line: bb.line,
          gameStrRaw: bb.gameStr,
          teamsRead: [...bb.teams],
          why: reason(bb, modelPicks),
        });
      }
    }

    res.json({
      date: slateDate,
      modelEdgesCached,
      counts: {
        modelEdges: modelPicks.length,
        bestBetsTeamMarket: bestBets.length,
        consensus: consensus.length,
        unmatched: unmatched.length,
      },
      consensus,
      unmatched,
      // Echo the model board's pick list so we can eyeball the strings being matched.
      modelEdgePicks: modelPicks.map(m => ({ game: m.matchup, market: m.market, side: m.side, line: m.line, teamsRead: [...m.teams], edge: m.edge })),
      note: "READ-ONLY. 'consensus' = Best Bet and a surfaced model edge agree on the SAME game+market+side+line. 'unmatched' lists every team-market Best Bet that did NOT match, with the reason — use it to confirm team-name matching is correct before we build the UI panel.",
    });
  } catch (err) {
    console.error("[consensus] error:", err);
    res.status(500).json({ error: "consensus failed", details: err.message });
  }
});

module.exports = router;
