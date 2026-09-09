// Shadow-only NFL Anytime TD scorer/value shortlist.
//
// Internal ordering is deliberately a relative, descriptive index — not a
// touchdown probability, fair price, edge, expected value, or calibrated pick.
// Customer output contains only exact-identity players whose independent scorer
// strength stands above the consensus market order, with factual reasons and the
// best independently-applied market price.

const RANKING_VERSION = "nfl-anytime-td-role-value-v3-2026-09-08";
const TABLE = "nfl_anytime_td_rankings_shadow";
const DISPLAY_PER_GAME = 3;

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 3) {
  const number = finite(value);
  if (number == null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function americanToImplied(price) {
  const value = finite(price);
  if (value == null || value === 0) return null;
  return value < 0 ? Math.abs(value) / (Math.abs(value) + 100) : 100 / (value + 100);
}

function median(values) {
  const sorted = (values || []).map(finite).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quoteMarketImplied(quote) {
  const yes = americanToImplied(quote?.price);
  if (yes == null) return null;
  const no = americanToImplied(quote?.counterPrice);
  return no == null || yes + no <= 0 ? yes : yes / (yes + no);
}

function percentile(value, population) {
  const target = finite(value);
  const values = (population || []).map(finite).filter((item) => item != null);
  if (target == null || values.length === 0) return null;
  if (values.length === 1) return 0.5;
  const lower = values.filter((item) => item < target).length;
  const equal = values.filter((item) => item === target).length;
  return (lower + (equal - 1) / 2) / (values.length - 1);
}

function impliedPoints(context, side) {
  const total = finite(context?.totalLine);
  const homeSpread = finite(context?.homeSpreadLine);
  if (total == null || homeSpread == null) return null;
  return side === "home" ? (total - homeSpread) / 2 : (total + homeSpread) / 2;
}

function bestQuote(prop) {
  const quotes = Array.isArray(prop?.quotes) ? prop.quotes : [];
  const normalized = quotes
    .filter((quote) => quote?.book && finite(quote.price) != null)
    .map((quote) => ({
      book: String(quote.book),
      price: finite(quote.price),
      counterPrice: finite(quote.counterPrice),
      priceMode: quote.priceMode === "yes-no" ? "yes-no" : "over-only",
    }))
    .sort((a, b) => b.price - a.price);
  if (!normalized.length && prop?.book && finite(prop?.overOdds) != null) {
    normalized.push({
      book: String(prop.book), price: finite(prop.overOdds),
      counterPrice: finite(prop.underOdds),
      priceMode: prop.priceMode === "yes-no" ? "yes-no" : "over-only",
    });
  }
  return {
    quote: normalized[0] || null,
    quotes: normalized,
    consensusImplied: median(normalized.map(quoteMarketImplied)),
  };
}

function buildAnytimeTdRankings({ candidates = [], contextByEvent = {}, predictionAt = new Date().toISOString() } = {}) {
  const prepared = [];
  for (const entry of candidates) {
    const prop = entry?.prop || {};
    const baseline = entry?.baseline || {};
    const context = contextByEvent[String(prop.eventId)] || null;
    const side = prop.team && context?.home?.teamId && String(prop.teamId) === String(context.home.teamId)
      ? "home"
      : prop.team && context?.away?.teamId && String(prop.teamId) === String(context.away.teamId)
        ? "away" : null;
    const teamContext = side ? context?.[side] : null;
    const games = finite(baseline.gamesPlayed);
    const carries = finite(baseline.rushAtt);
    const targets = finite(baseline.targets);
    const rushTds = finite(baseline.rushTds);
    const recTds = finite(baseline.recTds);
    const teamImpliedPoints = side ? impliedPoints(context, side) : null;
    const teamProjectedPoints = finite(teamContext?.projectedPoints);
    const sourceSeason = finite(context?.sourceSeason);
    const eventDate = prop.eventDate || null;
    const commenceTime = prop.commenceTime || context?.commenceTime || null;
    const { quote, quotes, consensusImplied } = bestQuote(prop);
    if (prop.market !== "anytime_td" || !prop.playerId || !side || !quote || !(games > 0)
        || !eventDate || !commenceTime || !prop.player || !prop.team || !prop.opponent || !prop.matchup
        || !["QB", "RB", "WR", "TE"].includes(prop.position)
        || [sourceSeason, carries, targets, rushTds, recTds, teamImpliedPoints, teamProjectedPoints, consensusImplied]
          .some((value) => value == null)
        || entry?.availability?.unavailable === true) continue;
    prepared.push({
      eventId: String(prop.eventId), eventDate, commenceTime,
      predictionAt, quoteCapturedAt: prop.quoteCapturedAt || predictionAt,
      playerId: String(prop.playerId), player: prop.player, headshot: prop.headshot || null,
      team: prop.team, teamId: String(prop.teamId), opponent: prop.opponent,
      position: prop.position || null, side, matchup: prop.matchup,
      sourceSeason, gamesPlayed: games,
      carries, targets, rushTds, recTds,
      opportunityPerGame: (carries + targets) / games,
      scoringTdsPerGame: (rushTds + recTds) / games,
      teamImpliedPoints,
      teamProjectedPoints,
      teamOffensePointsPerGame: finite(teamContext?.offensePointsPerGame),
      opponentDefensePointsAllowedPerGame: finite(teamContext?.opponentDefensePointsAllowedPerGame),
      availability: entry?.availability || null,
      bestBook: quote.book, bestPrice: quote.price,
      marketConsensusImplied: consensusImplied,
      marketQuoteCount: quotes.length,
      allBookQuotes: quotes,
    });
  }

  const distinctTeamValues = (field) => {
    const seen = new Map();
    for (const item of prepared) seen.set(`${item.eventId}:${item.teamId}`, item[field]);
    return [...seen.values()];
  };
  const impliedPopulation = distinctTeamValues("teamImpliedPoints");
  const projectedPopulation = distinctTeamValues("teamProjectedPoints");

  for (const item of prepared) {
    const teammates = prepared.filter((other) => other.eventId === item.eventId && other.teamId === item.teamId);
    const components = {
      teamMarketEnvironment: percentile(item.teamImpliedPoints, impliedPopulation),
      teamScoringContext: percentile(item.teamProjectedPoints, projectedPopulation),
      priorScoringRole: percentile(item.scoringTdsPerGame, teammates.map((other) => other.scoringTdsPerGame)),
      priorOpportunityRole: percentile(item.opportunityPerGame, teammates.map((other) => other.opportunityPerGame)),
    };
    components.teamScoringOpportunity = (components.teamMarketEnvironment + components.teamScoringContext) / 2;
    item.components = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value, 4)]));
    item.candidateScore = round((components.teamScoringOpportunity
      + components.priorScoringRole + components.priorOpportunityRole) * (100 / 3), 1);
  }

  const rankGroup = (group, field, target) => {
    const ordered = [...group].sort((a, b) => (finite(b[field]) ?? -Infinity) - (finite(a[field]) ?? -Infinity)
      || String(a.player).localeCompare(String(b.player)));
    ordered.forEach((item, index) => { item[target] = index + 1; });
  };
  for (const eventId of new Set(prepared.map((item) => item.eventId))) {
    const game = prepared.filter((item) => item.eventId === eventId);
    rankGroup(game, "candidateScore", "gameRank");
    rankGroup(game, "marketConsensusImplied", "marketRank");
    for (const teamId of new Set(game.map((item) => item.teamId))) {
      rankGroup(game.filter((item) => item.teamId === teamId), "candidateScore", "teamRank");
    }
    for (const item of game) item.marketRankDisagreement = item.marketRank - item.gameRank;

    // MLB's active HR board establishes the useful pattern: estimate likelihood
    // independently, then use price as a separate value layer. This TD version has
    // no calibrated probability, so qualification is entirely relative and frozen:
    //   • scorer strength must be strictly above the matchup median;
    //   • the player must be a top-two role profile on his own team; and
    //   • WizePicks' scorer order must place him ahead of the consensus market order.
    // No player or team is forced. The cap only limits a genuinely qualifying group.
    const strengthMedian = median(game.map((item) => item.candidateScore));
    const selected = new Set(game
      .filter((item) => item.candidateScore > strengthMedian
        && item.teamRank <= 2
        && item.marketRankDisagreement > 0)
      .sort((a, b) => b.marketRankDisagreement - a.marketRankDisagreement
        || b.candidateScore - a.candidateScore
        || b.bestPrice - a.bestPrice)
      .slice(0, DISPLAY_PER_GAME));
    for (const item of game) item.selectedForDisplay = selected.has(item);
  }
  for (const item of prepared) {
    item.reasons = [
      `${item.teamImpliedPoints.toFixed(1)} implied team points; ${item.teamProjectedPoints.toFixed(1)} offense/defense projection`,
      `${item.rushTds + item.recTds} TDs in ${item.gamesPlayed} games; ${item.opportunityPerGame.toFixed(1)} carries + targets per game`,
      "Role-based scorer strength sits ahead of consensus market pricing",
    ];
  }

  return prepared.sort((a, b) => a.eventDate?.localeCompare(b.eventDate || "")
    || String(a.commenceTime).localeCompare(String(b.commenceTime))
    || a.gameRank - b.gameRank);
}

function rankingRow(item) {
  return {
    event_id: item.eventId, event_date: item.eventDate, commence_at: item.commenceTime,
    prediction_at: item.predictionAt, quote_captured_at: item.quoteCapturedAt,
    player_id: item.playerId, player_name: item.player, team_id: item.teamId,
    team_name: item.team, opponent_name: item.opponent, player_position: item.position,
    home_away: item.side, matchup: item.matchup, source_season: item.sourceSeason,
    games_played: item.gamesPlayed, carries: item.carries, targets: item.targets,
    rushing_tds: item.rushTds, receiving_tds: item.recTds,
    opportunity_per_game: round(item.opportunityPerGame), scoring_tds_per_game: round(item.scoringTdsPerGame),
    team_implied_points: round(item.teamImpliedPoints), team_projected_points: round(item.teamProjectedPoints),
    team_offense_ppg: round(item.teamOffensePointsPerGame),
    opponent_defense_pa_per_game: round(item.opponentDefensePointsAllowedPerGame),
    availability: item.availability, score_components: item.components,
    candidate_score: item.candidateScore, game_rank: item.gameRank, team_rank: item.teamRank,
    market_consensus_implied: round(item.marketConsensusImplied, 6),
    market_quote_count: item.marketQuoteCount,
    market_rank: item.marketRank, market_rank_disagreement: item.marketRankDisagreement,
    selected_for_display: item.selectedForDisplay,
    best_book: item.bestBook, best_price: item.bestPrice, all_book_quotes: item.allBookQuotes,
    ranking_version: RANKING_VERSION, result_status: "pending",
  };
}

function toCustomerAnytimeTdSelection(item) {
  if (!item?.selectedForDisplay) return null;
  return {
    eventId: item.eventId,
    eventDate: item.eventDate,
    commenceTime: item.commenceTime,
    playerId: item.playerId,
    player: item.player,
    headshot: item.headshot,
    team: item.team,
    teamId: item.teamId,
    opponent: item.opponent,
    position: item.position,
    matchup: item.matchup,
    bestBook: item.bestBook,
    bestPrice: item.bestPrice,
    reasons: [...item.reasons],
    availabilityStatus: item.availability?.status || null,
  };
}

async function persistAnytimeTdRankings(supabase, rankings) {
  const rows = (rankings || []).map(rankingRow);
  if (!rows.length) return { recorded: 0 };
  const { error } = await supabase.from(TABLE)
    .upsert(rows, { onConflict: "event_id,player_id,ranking_version", ignoreDuplicates: true });
  if (error) return { recorded: 0, error: error.message };
  return { recorded: rows.length };
}

module.exports = {
  RANKING_VERSION,
  TABLE,
  buildAnytimeTdRankings,
  persistAnytimeTdRankings,
  rankingRow,
  toCustomerAnytimeTdSelection,
  _internal: { americanToImplied, median, quoteMarketImplied, percentile, impliedPoints, bestQuote, DISPLAY_PER_GAME },
};
