const MARKET_DEFINITIONS = Object.freeze({
  pass_yds: { family: "passing", label: "Passing Yards" },
  pass_tds: { family: "touchdowns", label: "Passing Touchdowns" },
  interceptions: { family: "passing", label: "Interceptions" },
  pass_attempts: { family: "passing", label: "Pass Attempts" },
  completions: { family: "passing", label: "Completions" },
  rush_yds: { family: "rushing", label: "Rushing Yards" },
  rush_attempts: { family: "rushing", label: "Rush Attempts" },
  longest_rush: { family: "rushing", label: "Longest Rush" },
  rec_yds: { family: "receiving", label: "Receiving Yards" },
  receptions: { family: "receiving", label: "Receptions" },
  longest_reception: { family: "receiving", label: "Longest Reception" },
  anytime_td: { family: "touchdowns", label: "Anytime Touchdown" },
  rush_tds: { family: "touchdowns", label: "Rushing Touchdowns" },
  rec_tds: { family: "touchdowns", label: "Receiving Touchdowns" },
  touchdowns_2_plus: { family: "touchdowns", label: "2+ Touchdowns" },
  touchdowns_3_plus: { family: "touchdowns", label: "3+ Touchdowns" },
  first_td: { family: "touchdowns", label: "First Touchdown" },
  last_td: { family: "touchdowns", label: "Last Touchdown" },
});

const FAMILY_DEFINITIONS = Object.freeze([
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "touchdowns", label: "Touchdowns" },
]);

function marketKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function footballPropMarket(value) {
  const key = marketKey(value);
  return MARKET_DEFINITIONS[key] ? { key, ...MARKET_DEFINITIONS[key] } : null;
}

export function availableFootballPropFamilies({ props = [], supportedMarkets = [] } = {}) {
  const markets = new Set();
  for (const value of supportedMarkets) if (footballPropMarket(value)) markets.add(marketKey(value));
  for (const prop of props) if (footballPropMarket(prop?.market)) markets.add(marketKey(prop.market));
  if (markets.size === 0) return [];
  const families = [{ key: "all", label: "All" }];
  for (const family of FAMILY_DEFINITIONS) {
    const familyMarkets = [...markets].filter((market) => (MARKET_DEFINITIONS[market]?.family || "other") === family.key);
    if (familyMarkets.length) families.push(family);
  }
  return families;
}

export function filterFootballProps(props, family) {
  const key = String(family || "all").toLowerCase();
  return (props || []).filter((prop) => {
    const market = footballPropMarket(prop?.market);
    if (!market) return false;
    return key === "all" || market.family === key;
  });
}
