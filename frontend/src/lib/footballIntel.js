function edgeForGame(feed, gameId) {
  const all = [
    ...(feed.moneylineEdges || []).map((row) => ({ ...row, market: "Moneyline" })),
    ...(feed.spreadEdges || []).map((row) => ({ ...row, market: "Spread" })),
    ...(feed.totalsEdges || []).map((row) => ({ ...row, market: "Total" })),
  ].filter((row) => String(row.gameId) === String(gameId) && Number.isFinite(Number(row.edge)) && Number(row.edge) >= 1);
  return all.sort((a, b) => (Number(b.modelProb) || 0) - (Number(a.modelProb) || 0))[0] || null;
}

function marketSummary(marketRead) {
  if (!marketRead) return null;
  if (marketRead.win?.favTeam) return `${marketRead.win.favTeam} · ${marketRead.win.tier || "market lean"}`;
  if (marketRead.cover?.favTeam) return `${marketRead.cover.favTeam} ${marketRead.cover.favLine ?? ""}`.trim();
  if (marketRead.total?.favSide) return `${marketRead.total.favSide} ${marketRead.total.line ?? ""}`.trim();
  return null;
}

export function buildFootballIntel(feed, sport) {
  if (sport !== "nfl" && sport !== "cfb") return [];
  return (feed?.games || []).map((game) => {
    const gameId = String(game.eventId ?? game.id ?? game.gameId ?? "");
    const matchupTeams = String(game.matchup || "").split(/\s+@\s+|\s+vs\.?\s+/i);
    const awayTeam = game.awayTeam || matchupTeams[0] || null;
    const homeTeam = game.homeTeam || matchupTeams[1] || null;
    const edge = edgeForGame(feed || {}, gameId);
    const quality = edge?.dataQuality || game.dataQuality || "unknown";
    const marketOnly = quality === "market-only" || edge?.isModelEdge === false;
    const marketRead = feed?.marketByGame?.[gameId]?.marketRead || game.marketRead || null;
    const weather = game.weather && (game.weather.summary || game.weather.condition || game.weather.tempF != null)
      ? (game.weather.summary || game.weather.condition || `${Math.round(game.weather.tempF)}°F${game.weather.windMph ? ` · ${game.weather.windMph} mph` : ""}`)
      : null;
    const availability = game.qbStatus || game.availability || game.injuryStatus || null;
    const mover = (feed?.marketMovers || []).find((row) => row.matchup === game.matchup) || null;
    const lineMovement = mover && mover.open != null && mover.now != null
      ? `${String(mover.side || "").toUpperCase()} ${String(mover.market || "").toUpperCase()}${mover.line != null ? ` ${Number(mover.line) > 0 ? "+" : ""}${mover.line}` : ""} · ${mover.open} → ${mover.now}`
      : null;
    const modelMargin = game.moneyline?.modelMargin;
    const matchupEdge = !marketOnly && modelMargin != null
      ? `${game.homeTeam || "Home"} projected margin ${Number(modelMargin) > 0 ? "+" : ""}${Number(modelMargin).toFixed(1)}`
      : null;
    return {
      gameId,
      matchup: game.matchup || `${awayTeam || "Away"} @ ${homeTeam || "Home"}`,
      awayTeam,
      homeTeam,
      teamIdentity: game.teamIdentity || null,
      commenceTime: game.commenceTime || null,
      dataQuality: quality,
      marketOnly,
      modelSignal: marketOnly || !edge || edge.modelProb == null || edge.edge == null ? null : {
        pick: edge.teamAbbr || (edge.side === "over" ? `Over ${edge.line}` : edge.side === "under" ? `Under ${edge.line}` : edge.side),
        market: edge.market,
        probability: edge.modelProb,
        edge: edge.edge,
      },
      marketLean: marketSummary(marketRead),
      lineMovement,
      matchupEdge,
      recentForm: game.recentForm || null,
      venue: game.neutralSite === true ? "Neutral-site adjustment verified" : "No neutral-site adjustment applied",
      weather,
      availability,
    };
  });
}
