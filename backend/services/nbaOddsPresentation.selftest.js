const assert = require("assert");
const { _internal } = require("./nbaService");

const event = {
  away_team: "Boston Celtics",
  home_team: "Los Angeles Lakers",
  bookmakers: [
    { title: "Book A", markets: [
      { key: "h2h", outcomes: [{ name: "Boston Celtics", price: 105 }, { name: "Los Angeles Lakers", price: -125 }] },
      { key: "spreads", outcomes: [{ name: "Boston Celtics", point: 2.5, price: -110 }, { name: "Los Angeles Lakers", point: -2.5, price: -110 }] },
      { key: "totals", outcomes: [{ name: "Over", point: 224.5, price: -108 }, { name: "Under", point: 224.5, price: -112 }] },
    ] },
    { title: "Book B", markets: [
      { key: "h2h", outcomes: [{ name: "Boston Celtics", price: 110 }, { name: "Los Angeles Lakers", price: -120 }] },
      { key: "spreads", outcomes: [{ name: "Boston Celtics", point: 2.5, price: -105 }, { name: "Los Angeles Lakers", point: -2.5, price: -115 }] },
      { key: "totals", outcomes: [{ name: "Over", point: 224.5, price: -115 }, { name: "Under", point: 224.5, price: -105 }] },
    ] },
  ],
};

const grid = _internal.extractOddsGrid(event);
assert.equal(grid.books.length, 2);
assert.deepEqual(grid.books[0], {
  book: "Book A", awayML: 105, homeML: -125,
  awaySpread: 2.5, awaySpreadPrice: -110,
  homeSpread: -2.5, homeSpreadPrice: -110,
  totalLine: 224.5, over: -108, under: -112,
});
assert.deepEqual(grid.best.awayML, { price: 110, book: "Book B" });
assert.deepEqual(grid.best.homeML, { price: -120, book: "Book B" });
assert.deepEqual(grid.best.awaySpread, { price: -105, book: "Book B", line: 2.5 });
assert.deepEqual(grid.best.homeSpread, { price: -110, book: "Book A", line: -2.5 });
assert.deepEqual(grid.best.over, { price: -108, book: "Book A" });
assert.deepEqual(grid.best.under, { price: -105, book: "Book B" });

for (const row of grid.books) {
  assert.ok(row.book);
  assert.equal(row.awaySpread, -row.homeSpread);
}

console.log("nba odds presentation self-test: PASS");
