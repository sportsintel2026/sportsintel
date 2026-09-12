const assert = require("assert");
const { enrichCfbPredictionClosing, _internal } = require("./cfbClosing");

const capturedAt = "2026-09-01T22:00:00.000Z";
const usEvent = {
  eventId: "event-1", commenceTime: "2026-09-01T23:00:00.000Z",
  awayTeam: "Memphis Tigers", homeTeam: "UNLV Rebels",
  h2h: { away: +150, home: -165 },
  spreads: { awayLine: 3.5, away: -110, homeLine: -3.5, home: -110 },
  totals: { line: 52.5, over: -105, under: -115 },
};
const pin = {
  commenceTime: "2026-09-01T23:05:00.000Z",
  awayTeam: "Memphis Tigers", homeTeam: "UNLV Rebels",
  h2h: { away: +145, home: -160 },
  spreads: { awayLine: 3.5, away: -108, homeLine: -3.5, home: -112 },
  totals: { line: 52.5, over: -110, under: -110 },
};
const pick = {
  id: 1, game_id: "event-1", market: "moneyline", selection: "home",
  line: null, odds: -150, opp_odds: +140, market_fair_prob: 0.5844,
  closing_captured_at: null,
};

{
  const update = _internal.buildClosingUpdate(pick, usEvent, [pin], capturedAt);
  assert.strictEqual(update.closing_odds, -165);
  assert.strictEqual(update.closing_opp_odds, +150);
  assert.strictEqual(update.pinnacle_closing_odds, -160);
  assert.strictEqual(update.closing_captured_at, capturedAt);
  assert.strictEqual(typeof update.clv, "number");
  assert.strictEqual(typeof update.pinnacle_clv, "number");
}

// At/after kickoff and older snapshots can never replace a valid pre-kick snapshot.
assert.strictEqual(_internal.buildClosingUpdate(pick, usEvent, [pin], usEvent.commenceTime), null);
assert.strictEqual(_internal.buildClosingUpdate({ ...pick, closing_captured_at: "2026-09-01T22:30:00.000Z" }, usEvent, [pin], capturedAt), null);

// Spread/total prices are comparable only at the exact entry line.
assert.strictEqual(_internal.closingQuote({ ...pick, market: "spread", selection: "home", line: -4.5 }, usEvent), null);
assert.strictEqual(_internal.closingQuote({ ...pick, market: "total", selection: "over", line: 51.5 }, usEvent), null);
assert.deepStrictEqual(
  _internal.closingQuote({ ...pick, market: "spread_shadow", selection: "home", line: -3.5 }, usEvent),
  { thisOdds: -110, oppOdds: -110 }
);

// Canonical teams + tight commencement tolerance; ambiguous/colliding candidates are refused.
assert.strictEqual(_internal.matchPinnacleEvent(usEvent, [pin]), pin);
assert.strictEqual(_internal.matchPinnacleEvent(usEvent, [pin, { ...pin }]), null);
assert.strictEqual(_internal.matchPinnacleEvent(usEvent, [{ ...pin, commenceTime: "2026-09-01T23:16:00.000Z" }]), null);
const ambiguousUpdate = _internal.buildClosingUpdate(pick, usEvent, [pin, { ...pin }], capturedAt);
assert.strictEqual(Object.prototype.hasOwnProperty.call(ambiguousUpdate, "pinnacle_closing_odds"), false);
assert.strictEqual(ambiguousUpdate.closing_odds, -165); // exact-id US close remains safe

function fakeSupabase(pending) {
  const updates = [];
  return {
    updates,
    from() {
      const query = {
        mode: null, values: null,
        select() { this.mode = "select"; return this; },
        update(values) { this.mode = "update"; this.values = values; updates.push(values); return this; },
        eq() { return this; }, in() { return this; }, is() { return this; },
        then(resolve) {
          resolve(this.mode === "select" ? { data: pending, error: null } : { data: null, error: null });
        },
      };
      return query;
    },
  };
}

(async () => {
  // Enrichment indexes US events only by the provider event id; a canonical-name
  // lookalike with a different id cannot update the ledger row.
  const missing = fakeSupabase([pick]);
  const missStats = await enrichCfbPredictionClosing(missing, {
    usEvents: [{ ...usEvent, eventId: "different-id" }], pinnacleEvents: [pin], capturedAt,
  });
  assert.strictEqual(missStats.updated, 0);
  assert.strictEqual(missing.updates.length, 0);

  const matched = fakeSupabase([pick]);
  const hitStats = await enrichCfbPredictionClosing(matched, {
    usEvents: [usEvent], pinnacleEvents: [pin], capturedAt,
  });
  assert.strictEqual(hitStats.updated, 1);
  assert.strictEqual(matched.updates.length, 1);
  assert.strictEqual(matched.updates[0].closing_captured_at, capturedAt);
  console.log("cfbClosing self-test: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
