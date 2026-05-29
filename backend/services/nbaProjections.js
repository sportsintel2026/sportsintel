// nbaProjections.js
// Stage 2: per-player prop projections + conservative edge detection.
//
// Philosophy: props markets are sharp. We do NOT flag "season avg vs line" (noise trap).
// We project from a recency-weighted blend, then DOUBLE-GATE any edge behind
// minutes stability + recent hit-rate agreement, so we surface FEW, defensible edges.
// Everything is labelled experimental.

const CFG = {
  recentWindow: 7,        // games counted as "recent form" (newest-first)
  recentWeight: 0.6,      // blend: 0.6 recent + 0.4 season
  minGames: 8,            // need a real sample before projecting
  minMinutes: 22,         // recent minutes floor; below this = low confidence
  minutesDriftMax: 8,     // recent vs season minutes drift cap (rotation change guard)
  hitAgree: 0.6,          // recent games must agree with the side >=60% of the time
  threshold: { points: 3.0, rebounds: 1.6, assists: 1.6 }, // min edge to flag
  excludePreseason: true, // drop preseason / all-star / exhibition games (noisy, short minutes)
  // "Suspect line" guard: when the book's line sits far from the player's own
  // season norm, the book almost certainly knows something the model can't see
  // (injury, minutes restriction, questionable status). Such lines are NEVER
  // flagged as edges — they're held aside as suspect instead.
  suspectLowRatio: 0.6,   // line below 60% of season avg  -> suspect
  suspectHighRatio: 1.7,  // line above 170% of season avg -> suspect
};

const STAT_KEYS = ["points", "rebounds", "assists"];

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round = (n, d = 1) => Number(n.toFixed(d));

// Preseason / all-star / exhibition games are short-minute and noisy — exclude them.
// Matches "Preseason", "2025 Preseason", "All-Star", "All Star", "Exhibition".
// Does NOT match "Regular Season" or "Postseason" (playoffs are kept).
const isPreseason = st => /pre[\s.-]?season|all[\s.-]?star|exhibition/i.test(st || "");

// Project one stat for one player from their parsed gamelog (newest-first).
function projectStat(games, key, line, cfg = CFG) {
  const played = games
    .filter(g => g.minutes > 0 && !(cfg.excludePreseason && isPreseason(g.seasonType)))
    .map(g => ({ minutes: g.minutes, val: g[key] }));
  const n = played.length;
  if (n < cfg.minGames) return { stat: key, line, eligible: false, flagged: false, reason: `only ${n} games`, experimental: true };
  if (!(line > 0)) return { stat: key, line, eligible: false, flagged: false, reason: "no line", experimental: true };

  const recent = played.slice(0, cfg.recentWindow);
  const recentMean = mean(recent.map(x => x.val));
  const seasonMean = mean(played.map(x => x.val));
  const projection = cfg.recentWeight * recentMean + (1 - cfg.recentWeight) * seasonMean;

  const recentMin = mean(recent.map(x => x.minutes));
  const seasonMin = mean(played.map(x => x.minutes));
  const minutesStable = recentMin >= cfg.minMinutes && Math.abs(recentMin - seasonMin) <= cfg.minutesDriftMax;

  const edge = projection - line;
  const side = edge >= 0 ? "OVER" : "UNDER";
  const overRate = recent.filter(x => x.val > line).length / recent.length;
  const hitAgrees = side === "OVER" ? overRate >= cfg.hitAgree : (1 - overRate) >= cfg.hitAgree;

  // Is the line wildly out of step with the player's own season history?
  const suspect = seasonMean > 0 &&
    (line < cfg.suspectLowRatio * seasonMean || line > cfg.suspectHighRatio * seasonMean);

  // Passes the math/stability gates? (used for both real edges and held-suspects)
  const wouldFlag = Math.abs(edge) >= cfg.threshold[key] && minutesStable && hitAgrees;
  const flagged = wouldFlag && !suspect; // a suspect line is never a real edge

  return {
    stat: key, line,
    projection: round(projection), edge: round(edge), side,
    recentMean: round(recentMean), seasonMean: round(seasonMean),
    recentMinutes: round(recentMin), minutesStable,
    overRate: round(overRate, 2), games: n,
    eligible: true, flagged, suspect, wouldFlag,
    ...(suspect ? { suspectReason: "line far from season norm — likely injury/role news the model can't see" } : {}),
    experimental: true,
  };
}

// Project all three markets for a player given their lines {points:{line},rebounds:{line},assists:{line}}.
function projectPlayer(games, lines, cfg = CFG) {
  const out = {};
  for (const key of STAT_KEYS) {
    const line = lines && lines[key] && Number(lines[key].line);
    out[key] = projectStat(games, key, line || 0, cfg);
  }
  return out;
}

// Tie Stage 1 prop lines to gamelogs.
// `players`: Stage 1 output [{ name, points:{line,over,under}, rebounds:{...}, assists:{...} }]
// `resolveAthleteId(name) -> id|null` and `getGamelog(id) -> parsed games[]` are injected,
//   so the name->ESPN-id concern stays isolated (and verifiable on its own).
async function buildPropProjections(players, resolveAthleteId, getGamelog, cfg = CFG) {
  const results = [];
  const edges = [];
  const suspects = [];
  for (const p of players || []) {
    const id = await resolveAthleteId(p.name);
    if (!id) { results.push({ name: p.name, eligible: false, reason: "no athlete id" }); continue; }
    let games;
    try { games = await getGamelog(id); }
    catch (e) { results.push({ name: p.name, eligible: false, reason: `gamelog fetch failed` }); continue; }
    const proj = projectPlayer(games, p, cfg);
    results.push({ name: p.name, athleteId: id, markets: proj });
    for (const key of STAT_KEYS) {
      if (proj[key].flagged) edges.push({ name: p.name, ...proj[key] });
      else if (proj[key].suspect && proj[key].wouldFlag) suspects.push({ name: p.name, ...proj[key] });
    }
  }
  // Strongest first.
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  suspects.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  return { experimental: true, generatedAt: new Date().toISOString(), players: results, edges, suspects };
}

module.exports = { projectStat, projectPlayer, buildPropProjections, CFG, STAT_KEYS };
