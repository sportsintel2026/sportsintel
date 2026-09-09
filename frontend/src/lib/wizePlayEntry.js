const NUMBER = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value) => String(value == null ? "" : value).trim();

export const validAmericanOdds = (value) => {
  const odds = NUMBER(value);
  return odds != null && Number.isInteger(odds) && (odds <= -100 || odds >= 100);
};

export const WIZEPLAY_PROP_MARKETS = Object.freeze({
  nfl: Object.freeze([
    ["pass_yds", "Passing Yards"],
    ["pass_tds", "Passing Touchdowns"],
    ["rush_yds", "Rushing Yards"],
    ["rec_yds", "Receiving Yards"],
    ["receptions", "Receptions"],
    ["anytime_td", "Anytime Touchdown"],
  ]),
  ncaafb: Object.freeze([]),
  mlb: Object.freeze([
    ["home_run", "Home Run"],
    ["pitcher_strikeouts", "Pitcher Strikeouts"],
    ["hits", "Hits"],
  ]),
});

export function normalizeGameRows(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.games || []);
  const parseMatchup = (matchup, index) => text(matchup).split(/@|vs/i).map((part) => part.trim()).filter(Boolean)[index] || "";
  const name = (game, side, index) => {
    for (const value of [game?.[`${side}Abbr`], game?.[side], game?.[`${side}Team`]]) {
      if (text(value) && text(value) !== "?") return text(value);
    }
    return parseMatchup(game?.matchup, index);
  };
  return rows.map((raw) => {
    const away = name(raw, "away", 0);
    const home = name(raw, "home", 1);
    const commenceTime = raw?.commenceTime || raw?.startTimeUTC || raw?.gameDate || null;
    const shownTime = raw?.time || (commenceTime
      ? new Date(commenceTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "");
    return {
      raw,
      gameId: text(raw?.id || raw?.gameId || raw?.gamePk || raw?.eventId),
      gameDate: text(raw?.eventDate || raw?.gameDate || commenceTime).slice(0, 10) || null,
      commenceTime,
      awayAbbr: away,
      homeAbbr: home,
      label: `${away} @ ${home}${shownTime ? ` · ${shownTime}` : ""}`,
    };
  }).filter((game) => game.gameId && game.awayAbbr && game.homeAbbr);
}

function quote(price, book, line = null) {
  const normalizedPrice = NUMBER(price);
  const normalizedBook = text(book);
  if (!validAmericanOdds(normalizedPrice) || !normalizedBook) return null;
  return { odds: normalizedPrice, book: normalizedBook, line: NUMBER(line), verified: true };
}

export function gameOddsQuote(game, market, selection) {
  const raw = game?.raw || game || {};
  const best = raw?.oddsGrid?.best || {};
  if (market === "moneyline") {
    const grid = best[selection === "home" ? "homeML" : "awayML"];
    if (grid) return quote(grid.price, grid.book);
    const ml = raw.moneyline || {};
    const sidePrice = selection === "home" ? (ml.homeOdds ?? ml.book?.home) : (ml.awayOdds ?? ml.book?.away);
    const sideBook = selection === "home"
      ? (ml.homeBook ?? raw.marketBooks?.moneyline?.homeBook)
      : (ml.awayBook ?? raw.marketBooks?.moneyline?.awayBook);
    return quote(sidePrice, sideBook);
  }
  if (market === "total") {
    const grid = best[selection === "under" ? "under" : "over"];
    if (grid) return quote(grid.price, grid.book, raw.oddsGrid?.consensusTotalLine);
    const total = raw.totals || raw.total || {};
    const sidePrice = selection === "under" ? (total.underOdds ?? total.book?.under) : (total.overOdds ?? total.book?.over);
    const sideBook = selection === "under"
      ? (total.underBook ?? raw.marketBooks?.total?.underBook)
      : (total.overBook ?? raw.marketBooks?.total?.overBook);
    return quote(sidePrice, sideBook, total.line);
  }
  if (market === "spread" || market === "run_line") {
    const grid = best[selection === "home" ? "homeSpread" : "awaySpread"];
    if (grid) return quote(grid.price, grid.book, grid.line);
    const spread = market === "run_line" ? (raw.runLine || {}) : (raw.spread || {});
    const fallbackLine = NUMBER(spread.line);
    const sidePrice = selection === "home" ? (spread.homeOdds ?? spread.book?.home) : (spread.awayOdds ?? spread.book?.away);
    const sideLine = selection === "home"
      ? (spread.homeLine ?? spread.book?.homeLine ?? (fallbackLine == null ? null : -Math.abs(fallbackLine)))
      : (spread.awayLine ?? spread.book?.awayLine ?? (fallbackLine == null ? null : Math.abs(fallbackLine)));
    const sideBook = selection === "home"
      ? (spread.homeBook ?? raw.marketBooks?.spread?.homeBook)
      : (spread.awayBook ?? raw.marketBooks?.spread?.awayBook);
    return quote(sidePrice, sideBook, sideLine);
  }
  return null;
}

function consensusLine(quotes, preferredLine) {
  const counts = new Map();
  for (const item of quotes) {
    const line = NUMBER(item.line);
    if (line == null) continue;
    counts.set(line, (counts.get(line) || 0) + 1);
  }
  const preferred = NUMBER(preferredLine);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === preferred ? -1 : b[0] === preferred ? 1 : a[0] - b[0]))[0]?.[0] ?? preferred;
}

export function propOddsQuote(prop, side) {
  if (!prop) return null;
  const normalizedSide = String(side || "").toLowerCase();
  if (prop.market === "anytime_td" || prop.market === "home_run") {
    const offers = (Array.isArray(prop.quotes) && prop.quotes.length ? prop.quotes : [{
      book: prop.book,
      price: prop.overOdds ?? prop.odds,
    }]).map((item) => quote(item.price ?? item.overOdds, item.book, null)).filter(Boolean);
    return offers.sort((a, b) => b.odds - a.odds)[0] || null;
  }
  const sourceQuotes = Array.isArray(prop.quotes) && prop.quotes.length ? prop.quotes : [{
    book: prop.book,
    line: prop.line,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
  }];
  const line = consensusLine(sourceQuotes, prop.line);
  const offers = sourceQuotes
    .filter((item) => NUMBER(item.line) === line)
    .map((item) => quote(normalizedSide === "under" ? item.underOdds : item.overOdds, item.book, line))
    .filter(Boolean)
    .sort((a, b) => b.odds - a.odds);
  return offers[0] || null;
}

function mlbPropRows(payload) {
  const rows = [];
  for (const item of payload?.hrPropEdges || []) rows.push({
    sport: "mlb", eventId: text(item.gameId), eventDate: payload?.date || null, matchup: item.game,
    player: item.player, playerId: text(item.playerId), team: item.team, market: "home_run",
    line: null, overOdds: NUMBER(item.odds), underOdds: null, book: item.book,
    quotes: [{ book: item.book, price: NUMBER(item.odds) }], projection: item.hrProb ?? null, modelEdge: item.edge ?? null,
  });
  for (const [arrayName, market] of [["kPropEdges", "pitcher_strikeouts"], ["hitsPropEdges", "hits"]]) {
    for (const item of payload?.[arrayName] || []) {
      const picked = String(item.side || "over").toLowerCase();
      rows.push({
        sport: "mlb", eventId: text(item.gameId), eventDate: payload?.date || null, matchup: item.game,
        player: item.player, playerId: text(item.playerId), team: item.team, market, line: NUMBER(item.line),
        overOdds: picked === "over" ? NUMBER(item.odds) : NUMBER(item.oppOdds),
        underOdds: picked === "under" ? NUMBER(item.odds) : NUMBER(item.oppOdds),
        book: item.book,
        quotes: [{
          book: item.book, line: NUMBER(item.line),
          overOdds: picked === "over" ? NUMBER(item.odds) : NUMBER(item.oppOdds),
          underOdds: picked === "under" ? NUMBER(item.odds) : NUMBER(item.oppOdds),
        }],
        projection: market === "pitcher_strikeouts" ? item.expectedKs : null,
        modelEdge: item.edge ?? null,
      });
    }
  }
  return rows;
}

export function propRowsForSport(sport, payload) {
  if (sport === "nfl") return (payload?.props || []).filter((item) => WIZEPLAY_PROP_MARKETS.nfl.some(([market]) => market === item.market));
  if (sport === "mlb") return mlbPropRows(payload);
  return [];
}

export function propSides(prop) {
  if (!prop) return [];
  if (prop.market === "anytime_td" || prop.market === "home_run") return [["yes", prop.market === "home_run" ? "Home Run" : "Anytime TD"]];
  const sides = [];
  if (propOddsQuote(prop, "over")) sides.push(["over", "Over"]);
  if (propOddsQuote(prop, "under")) sides.push(["under", "Under"]);
  return sides;
}

export function entryKey(pick) {
  if (pick?.kind === "prop") {
    return ["prop", pick.sport, pick.gameId, pick.playerId, pick.propCategory, pick.selection, pick.line ?? "none"].map(text).join(":").toLowerCase();
  }
  return ["game", pick?.sport, pick?.gameId, pick?.market, pick?.selection, pick?.line ?? "none"].map(text).join(":").toLowerCase();
}

export function propPickText(prop, side, line) {
  const player = text(prop?.player);
  if (prop?.market === "anytime_td") return `${player} Anytime TD`;
  if (prop?.market === "home_run") return `${player} to hit a Home Run`;
  const label = Object.values(WIZEPLAY_PROP_MARKETS).flat().find(([key]) => key === prop?.market)?.[1] || prop?.market;
  return `${player} ${String(side || "").toUpperCase()} ${line} ${label}`;
}

export const _test = { NUMBER, consensusLine };
