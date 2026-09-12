// CFB closing enrichment. This module never fetches provider data: the hourly CFB
// tick job passes in the US and Pinnacle payloads it already obtained.

const { matchupKey } = require("./teamKey");

const CFB_MARKETS = [
  "moneyline", "spread", "total",
  "moneyline_shadow", "spread_shadow", "total_shadow",
];
const PINNACLE_TIME_TOLERANCE_MS = 15 * 60 * 1000;

function round4(n) {
  return n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10000) / 10000;
}

function implied(a) {
  if (a == null || !Number.isFinite(Number(a))) return null;
  const n = Number(a);
  return n >= 100 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function fair(thisOdds, otherOdds) {
  const a = implied(thisOdds), b = implied(otherOdds);
  return a != null && b != null && a + b > 0 ? round4(a / (a + b)) : null;
}

function beatFlag(v) {
  return v == null ? null : (v > 0 ? true : (v < 0 ? false : null));
}

function baseMarket(market) {
  return String(market || "").replace(/_shadow$/, "");
}

function closingQuote(pick, event) {
  if (!pick || !event) return null;
  const market = baseMarket(pick.market);
  if (market === "moneyline") {
    if (event.h2h?.home == null || event.h2h?.away == null) return null;
    return pick.selection === "away"
      ? { thisOdds: event.h2h.away, oppOdds: event.h2h.home }
      : { thisOdds: event.h2h.home, oppOdds: event.h2h.away };
  }
  if (market === "spread") {
    const selectedLine = pick.selection === "away" ? event.spreads?.awayLine : event.spreads?.homeLine;
    if (selectedLine == null || pick.line == null || Number(selectedLine) !== Number(pick.line)) return null;
    if (event.spreads?.home == null || event.spreads?.away == null) return null;
    return pick.selection === "away"
      ? { thisOdds: event.spreads.away, oppOdds: event.spreads.home }
      : { thisOdds: event.spreads.home, oppOdds: event.spreads.away };
  }
  if (market === "total") {
    if (event.totals?.line == null || pick.line == null || Number(event.totals.line) !== Number(pick.line)) return null;
    if (event.totals?.over == null || event.totals?.under == null) return null;
    return pick.selection === "under"
      ? { thisOdds: event.totals.under, oppOdds: event.totals.over }
      : { thisOdds: event.totals.over, oppOdds: event.totals.under };
  }
  return null;
}

function matchPinnacleEvent(usEvent, pinnacleEvents) {
  if (!usEvent?.awayTeam || !usEvent?.homeTeam || !usEvent?.commenceTime) return null;
  const targetKey = matchupKey(usEvent.awayTeam, usEvent.homeTeam, null, "cfb");
  const targetTime = Date.parse(usEvent.commenceTime);
  if (!targetKey || !Number.isFinite(targetTime)) return null;
  const matches = (pinnacleEvents || []).filter((event) => {
    const key = matchupKey(event?.awayTeam, event?.homeTeam, null, "cfb");
    const time = Date.parse(event?.commenceTime);
    return key === targetKey && Number.isFinite(time)
      && Math.abs(time - targetTime) <= PINNACLE_TIME_TOLERANCE_MS;
  });
  return matches.length === 1 ? matches[0] : null;
}

function buildClosingUpdate(pick, usEvent, pinnacleEvents, capturedAt) {
  const capturedMs = Date.parse(capturedAt);
  const kickoffMs = Date.parse(usEvent?.commenceTime);
  if (!Number.isFinite(capturedMs) || !Number.isFinite(kickoffMs) || capturedMs >= kickoffMs) return null;
  const oldMs = pick?.closing_captured_at ? Date.parse(pick.closing_captured_at) : null;
  if (Number.isFinite(oldMs) && capturedMs <= oldMs) return null;

  const update = {};
  const us = closingQuote(pick, usEvent);
  if (us) {
    const pickImplied = implied(pick.odds);
    const closeImplied = implied(us.thisOdds);
    const clv = pickImplied != null && closeImplied != null ? round4(closeImplied - pickImplied) : null;
    update.closing_odds = us.thisOdds;
    update.closing_opp_odds = us.oppOdds;
    update.clv = clv;
    update.beat_close = beatFlag(clv);
  }

  const pinnacleEvent = matchPinnacleEvent(usEvent, pinnacleEvents);
  const pin = pinnacleEvent ? closingQuote(pick, pinnacleEvent) : null;
  if (pin && pick.opp_odds != null) {
    const pinFair = fair(pin.thisOdds, pin.oppOdds);
    const pickFair = pick.market_fair_prob != null && Number.isFinite(Number(pick.market_fair_prob))
      ? Number(pick.market_fair_prob)
      : null;
    const pinClv = pinFair != null && pickFair != null ? round4(pinFair - pickFair) : null;
    update.pinnacle_closing_odds = pin.thisOdds;
    update.pinnacle_fair_prob = pinFair;
    update.pinnacle_clv = pinClv;
    update.pinnacle_beat_close = beatFlag(pinClv);
  }

  if (!Object.keys(update).length) return null;
  update.closing_captured_at = new Date(capturedMs).toISOString();
  return update;
}

async function enrichCfbPredictionClosing(supabase, {
  usEvents = [], pinnacleEvents = [], capturedAt = new Date().toISOString(),
} = {}) {
  const stats = { pending: 0, updated: 0, skipped: 0, errors: 0 };
  const { data, error } = await supabase
    .from("model_predictions")
    .select("id,game_id,market,selection,line,odds,opp_odds,market_fair_prob,result,closing_captured_at")
    .eq("league", "cfb")
    .in("market", CFB_MARKETS)
    .eq("result", "pending");
  if (error) throw new Error(error.message);
  const pending = data || [];
  stats.pending = pending.length;

  const byId = new Map((usEvents || []).map((event) => [String(event.eventId), event]));
  for (const pick of pending) {
    const usEvent = byId.get(String(pick.game_id));
    const update = buildClosingUpdate(pick, usEvent, pinnacleEvents, capturedAt);
    if (!update) { stats.skipped++; continue; }
    let query = supabase
      .from("model_predictions")
      .update(update)
      .eq("id", pick.id)
      .eq("result", "pending");
    query = pick.closing_captured_at == null
      ? query.is("closing_captured_at", null)
      : query.eq("closing_captured_at", pick.closing_captured_at);
    const { error: updateError } = await query;
    if (updateError) stats.errors++;
    else stats.updated++;
  }
  return stats;
}

module.exports = {
  enrichCfbPredictionClosing,
  _internal: {
    CFB_MARKETS,
    PINNACLE_TIME_TOLERANCE_MS,
    implied,
    fair,
    baseMarket,
    closingQuote,
    matchPinnacleEvent,
    buildClosingUpdate,
  },
};
