# HANDOFF-60

**Session: 2026-08-13 afternoon → 2026-08-15 morning. 4 PRs merged (#86–#89).**
**One live constant changed (`TOTAL_SD` 4.0 → 6.0). Zero SQL. Zero migrations.**
**Nothing customer-facing moved. Totals remains benched.**

**This document supersedes HANDOFF-59.** Everything 59 carried that is still open is
reproduced here. Read `CLAUDE.md` first regardless.

⚠ **HANDOFF-59 was written 2026-08-08 and was five days stale when this session opened.**
Check the date before trusting any dated trigger in a handoff.

---

## 0. 🔴 THE HEADLINE: THE TOTALS OVERCLAIM IS A TOO-STEEP SIGMOID, AND THE CONSTANT WAS EYEBALLED

Totals has been benched since 2026-07-17. The July 18 projection rebuild was believed to
have fixed it. **It did not.** The rebuilt model still overclaims, and this session found
why, in the model rather than in the guard.

The published totals probability:

```
overProb = W_MODEL·rawOver + (1 − W_MODEL)·fairOver
         = 0.55·model + 0.45·market

rawOver  = sigmoid((projTotal − TOTAL_MEAN_TO_MEDIAN − line) / TOTAL_SD)
           TOTAL_MEAN_TO_MEDIAN = 0.50,  TOTAL_SD = 4.0  (pre-#89)
```

**Both `W_MODEL = 0.55` and `TOTAL_SD = 4.0` were set in generic "Update edgesModel.js"
commits (`11f8ee5`, `3ddca03`) with no measurement and no rationale.** The `TOTAL_SD`
comment literally read *"~4.0 is closer"*. Neither constant had ever been measured.

### The calibration curve — the gap GROWS with confidence

Full window (`/calibprobe`, ≥ 2026-07-02, mixes pre+post rebuild):

| bin | n | claimed | actual | gap |
|---|---|---|---|---|
| 0.45–0.50 | 56 | 49.1 | 50.0 | **−0.9** |
| 0.50–0.55 | 333 | 52.2 | 46.5 | +5.7 |
| 0.55–0.60 | 98 | 56.8 | 52.0 | +4.8 |
| 0.60+ | 26 | 62.3 | 50.0 | **+12.3** |

Post-rebuild only (≥ 2026-07-18, via `/totalresetprobe` `bins`):

| bin | n | claimed | actual | gap |
|---|---|---|---|---|
| 0.50–0.55 | 228 | 52.2 | 46.5 | +5.7 |
| 0.55–0.60 | 53 | 56.8 | 52.8 | +3.9 |
| 0.60–0.65 | 3 | 60.6 | 33.3 | +27.3 |
| 0.65–0.70 | 0 | — | — | — |

At the bottom of the range the model is honest (49.1 claimed / 50.0 actual). At the top it
claims 62.3% and delivers a coin flip. **That monotonic shape is the signature of a
too-steep sigmoid — `TOTAL_SD` too small — not a flat directional bias.** A directional bias
would show a constant gap across bins.

### The grid — `TOTAL_SD` measured for the first time

`/api/performance/totalresetprobe?since=2026-07-18` `grid`, post-07-18 rows, at `W_MODEL = 0.55`:

| TOTAL_SD | n | claimed | actual | gap |
|---|---|---|---|---|
| 4.0 | 38 | 57.1 | 52.6 | +4.5 |
| 5.0 | 22 | 56.8 | 59.1 | −2.3 |
| **6.0** | **16** | **56.1** | **56.3** | **−0.1** |
| 7.0 | 8 | 55.9 | 37.5 | +18.4 (n=8, noise) |

**6.0 flattens the gap to −0.1.** Shipped in #89.

### Why `W_MODEL` was NOT changed

At SD 4.0: W 0.45 → gap −2.2 (n 22); W 0.35 → −3.9 (n 15); W 0.25 → −4.2 (n 5);
W 0.15 → n 1. It moves, but overshoots into *under*claiming and n collapses fast.

**`W_MODEL = 0.00` (pure-market baseline) returned all nulls at every SD.** No rows survive
the ≥0.55 band when the model term is stripped entirely — the de-vigged market alone never
produces a confident total. So the "does the model beat the price" test **could not be
answered** from this grid. It is still open.

### ⚠ The grid's identity check did NOT cleanly pass — read this before trusting the numbers

`gridMeta`: `eligibleN 238`, `skippedNoOppOdds 84`, `skippedBadBackout 0`.

The `(0.55, 4.0)` identity cell reads **n 38, gap 4.5**. The direct measurement
(`windows.rebuilt.cumulative`) reads **n 56, gap 5.2**. The 18-row difference is the
`opp_odds`-null rows, which drop out of every recompute.

**84 of 238 rows (35%) are excluded from the entire grid, non-randomly** — they are rows
where the opposing price was never captured. `TOTAL_SD = 6.0` is measured on n=16 out of a
biased subset. It is *better evidence than the eyeball it replaced*, and that is the whole
justification. It is not a validated value. **Re-run the grid once post-#89 rows accumulate.**

---

## 1. What shipped

| PR | Token | What it does | Del |
|----|-------|--------------|-----|
| #86 | `WZ-TOTALRESETPROBE-2026-08-08` | read-only probe: core `total` calibration windowed to arbitrary cutoff | 0 |
| #87 | `WZ-TOTALRESETPROBE-ORDER-2026-08-08` | route-ordering fix — probe was unreachable | 90 (relocation) |
| #88 | `WZ-TOTALPROBE-GRID-2026-08-08` | adds `bins` + `W_MODEL × TOTAL_SD` grid to the probe | 1 |
| #89 | `WZ-TOTALSD-2026-08-13` | **`TOTAL_SD` 4.0 → 6.0** + comment corrections | 7 |

**#86** — `GET /api/performance/totalresetprobe?since=YYYY-MM-DD`. Exact replica of
`calibrationGuard.js:152–239` for `market=total`: settled only, `model_prob ≥ 0.55`,
Kish-effN half-life 10d. Returns `windows.rebuilt` (the `?since` window) and
`windows.current` (the live 07-02 window) side by side, plus `publishedClearAtSince`.
SELECT-only, verified zero writes, `RESETS`/`isBenched`/`_released` untouched.

**#87** — the probe was registered at `performance.js:2530`, but `router.get("/:league", …)`
sits at **`2202`**. Express matches in registration order, so `/:league` bound
`:league = "totalresetprobe"` and returned
`{"error":"Unknown league","supported":["mlb","nba","nfl","cfb"]}`. Pure relocation: probe
moved to 2211, `/:league` to 2293. `+91/−90` (90 relocated lines + 1 blank separator).

**#88** — adds per-bin curve and the 6×4 constant grid. Recompute backs `fairOver` out of
stored `odds`+`opp_odds` and `rawOver` out of stored `model_prob` at the live
`W_MODEL = 0.55`, then re-blends at new W and re-scales the sigmoid at new SD. Ruler-tested
two ways: back-out exact, and the `(0.55, 4.0)` cell reproduces a direct ≥0.55 read on
synthetic rows (identity match). `devigTwoWay = a/(a+b)`, standard implied-from-american.

**#89** — the only live change. `edgesModel.js:1690` (now :1688) `TOTAL_SD = 4.0 → 6.0`,
with the measurement written into the comment. Old *"~4.0 is closer"* deleted.
`+4/−6` edgesModel.js, `+3/−1` performance.js. All gates passed, bytes verified off
`raw.githubusercontent.com`, SHA-256 match.

### 🔴 `LIVE_DIVISOR` IS NOW A DELIBERATE DIVERGENCE — DO NOT "FIX" IT

There are **three** hardcoded `4.0` sigmoid divisors. Only one was changed.

| location | what it is | state |
|---|---|---|
| `edgesModel.js:1688` | `TOTAL_SD` — the live model | **6.0** ✅ changed |
| `performance.js:701` | `LIVE_DIVISOR` — read-only totals-scatter diagnostic | **stays 4.0** |
| `performance.js:2300` | `SD0` — grid back-out anchor (`logit(raw)·(4/SD)`) | **stays 4.0, never change** |

`LIVE_DIVISOR` previously carried the comment *"must mirror TOTAL_SD in edgesModel.js
line ~1649"*. That comment is now **deleted and replaced**, because it was false and would
read as a deploy bug to the next person.

It stays at 4.0 deliberately: it grades **mostly historical rows that were priced at SD 4.0**.
Moving it to 6.0 makes it *more* wrong for the data it analyzes. It is also already an
approximation — it omits the `TOTAL_MEAN_TO_MEDIAN = 0.50` shift the live model applies.
Revisit only when post-6.0 rows dominate its population.

`SD0` is the **historical pricing anchor**. The back-out inverts what past rows were priced
at. If it moves, every grid figure ever produced becomes meaningless.

---

## 2. Live readings (2026-08-13, `/api/performance/guard`, lastRun 21:30Z)

- **`markets.total` (published, RESETS 07-02):** `benched: true, manual: true`,
  n 124, claimed 58, actual 51.6, **gap 6.4**; recent effN 64, claimed 57.4, actual 52.3,
  **gap 5.1**.
- **`shadowWatch.total`** (`total_shadow`, since 2026-07-18): n **67**, needN 80,
  claimed 56.5, actual ~55, **gap 1.4**, `released: false`.
- **Probe, rebuilt window (since 07-18):** cumulative n 56, claimed 57.0, actual 51.8,
  **gap 5.2**; recent effN 44, claimed 57.1, actual 52.7, **gap 4.4**.
  `publishedClearAtSince: false`.
- **`markets.run_line`:** `benched: false, manual: false`, n 319, claimed 61.7, actual 59.2,
  gap 2.5. Shadow n 340, gap −0.9, `released: true`.
- **Gamma** (`/api/gammafit?league=mlb&market=moneyline`):
  `gammaVsClose` γ −0.198, α −0.011, n 281, se 0.035, CI [−0.267, −0.13], **significant**.
  `gammaVsOutcome` γ −0.026, n 842, se 0.233, CI [−0.483, 0.431], not significant.
  `published.n` 191, `effectiveVigPts.n` 842, `publishFloor` 0.55, `wAssumed` 0.55.
  ⚠ **None of these is the γ = −0.1433, n=91, se 0.0856 that HANDOFF-59 §7 tracked.** That
  figure came from a different computation than this endpoint's default. Nobody has
  reproduced it. Do not treat the endpoint default as "the γ we've been waiting on."

### 🔴 The bench is held by TWO independent gates and both are honest

`cleared = shadowClear && publishedClear` (`calibrationGuard.js:278`).

- `shadowClear = n ≥ 80 && gap < 4` → **false** (n 67 < 80; gap 1.4 already under 4)
- `publishedClear` (`:274–277`) → **false** (gap 6.4 and 5.1, both ≥ GAP_UNBENCH 4)

**`RESETS.total` windows the PUBLISHED leg only.** The shadow leg is windowed independently
by `SHADOW_WATCH.total.since = "2026-07-18"`. **Changing `RESETS.total` therefore releases
nothing** while shadow n < 80. Correcting an earlier claim in this session — see §5.

`RESETS = { moneyline: "2026-07-08", total: "2026-07-02", run_line: "2026-07-02" }`
`MIN_N = 40`, `GAP_UNBENCH = 4`, `HALF_LIFE_DAYS = 10`,
`MANUAL_BENCH = new Set(["run_line", "total"])`.

### ⚠ `RESETS.total` still points 16 days BEFORE the rebuild — decide, don't drift

The published leg grades the **pre-rebuild model**. Re-windowing it to 2026-07-18 is the
*correct* change and would improve the reported gap from 6.4 to ~5.2 — but it is still over
threshold, so it fixes the measurement without releasing anything. Do it as a **decision**,
not as part of a cleanup pass, and re-verify shadow n at the time.

---

## 3. 🔴 THE NFL BOARD FALSE ALARM — THE RENDER-PATH MAP IS WRONG AND STILL UNRESOLVED

**This is the most important open item in this document.**

On 2026-08-13 (NFL preseason Week 1, 16 games), `/api/edges/nfl` returned:

```
moneylineEdges 0, totalsEdges 0, spreadEdges 0, runLineEdges 0
edges 41, games 16
boardHorizon: { published: true, reason: null, horizonDays: 7,
                nextGameISO: "2026-08-13T23:00:00.000Z", daysOut: 0.1 }
phase: { selected: "preseason", available: ["preseason","regular"] },
preseason: true, provisional: true, calibrated: false
```

Claude Code traced **every** mobile football pick-render path — Hero (`Home.jsx:665`),
WizeBoard (`:707`), tomorrow preview (`:712/717`, MLB-only at `:481`), LIVE EDGES (`:730`),
Market Movers (`:512`), Market Pulse KPIs (`:385`) — plus the desktop layout
(`HomeDesktop`, `oneSidePerGame(arrFor(market))`, `games.map(mkRow)` MLB-gated at `:187`).
**Every one reads the empty per-market ranked arrays.** Two fresh curls 20 minutes apart
confirmed all four arrays at 0. Conclusion: board renders `"No winners on the board yet."`

**Master G's phone showed the full board.** Screenshot: EDGES tab, NFL, Preseason,
hero *"TONIGHT'S BEST NUMBER / Over 37.5 / DET @ CIN / 69.4% MODEL TO WIN / +19.0% EDGE /
LOCK"*, then *"TONIGHT'S CARD — 16 winners · Thursday, August 13"* with ranked rows #2–#16
(TEN@SF SF +6 67% +16.8%, DAL@SEA over 39.5 66% +16.1%, … JAX@NO JAX ML 54% +7.4%),
`WIZEPLAYS CURATED` strip at the bottom.

**The board was live and correct. The trace was wrong.**

The rendered values match the `games[]` table exactly (DET@CIN over 37.5, 69.4%, edge 19).
So the mobile board **is** consuming `games[]` or the flat `edges[]` through a path that two
separate enumerations failed to find.

**Nobody currently knows how the mobile NFL board gets its data.** That is dangerous: any
future board work will be built on a map that has been proven false. Before touching
`Home.jsx` for football, **find the real path.** Do not trust §3's own list of render paths;
it is the list that was wrong.

Also unexplained: the backend's two adjacent loops over the same `allGames` produce
41 rows (`edges.js:1851`, pushes on `m.value && m.edge != null && !isBenched`) and 0 rows
(`edges.js:1889`, pushes on `sp.edge != null && sp.fair`) when the games satisfy both
conditions. Under `main`'s code that is impossible — suggesting production may not be
running `main`. **There is still no git SHA on `/api/health`** (HANDOFF-59 item 12), so this
cannot be checked. That item is now blocking, not cosmetic.

### Recorder — confirmed correct, no action

`recordNFLPredictions(slate)` → `recordFootballPredictions(slate, "nfl")`
(`predictionTracker.js:1264`). **Mirrors the board, does NOT edge-gate.** Side derived from
win/cover/over probability exactly as `WZ-WINNERSFIRST` does. The old `value === true`
(edge ≥ EDGE_ML) gate was removed in #68; in-code note at `:1140`.

Three filters sit between board and record, none an edge filter:
1. `dataQuality !== "rated"` (`:1104`) — coverage gate
2. imminence window (`:1107`) — `daysOut > FOOTBALL_IMMINENT_DAYS (7) || daysOut < 0`, the
   same horizon the board publishes on since #76
3. per-market presence guards (`:1142/1160/1181`) — must have a book price/line

---

## 4. 🔴 RECONSTRUCTION DEFECT — 23.9% OF PUBLISHED ROWS, STILL UNFIXED

`GET /api/gammafit?league=mlb&market={moneyline|run_line}`, field
`perMarket.{market}.reconstruction` (`WZ-DEVIG-IDENTITY` check: `fair = model_prob − edge`
must de-vig to a physically valid market; `overround out of range` = invalid):

| market | checked | inconsistent | rate | published? |
|---|---|---|---|---|
| moneyline | 842 | 189 | 22.4% | yes (`describeMoneyline`) |
| run_line | 847 | 215 | 25.4% | yes (`describeRunLine`) |
| total | 1049 | 226 | 21.5% | no — benched |

**Published (moneyline + run_line): 404 / 1689 = 23.9%.**

Every sampled failure is **negative overround** — the printed market % sits *above* the
price's break-even. Worked example: run_line 2026-06-02, +170, printed fair 0.559 against a
break-even of 0.370 (overround −33.7%).

Both read-writers share the derivation `Math.round((prob − edge) * 100)`:
- `describeMoneyline` (`edgesModel.js:1455-1456`) fed by `mlMarket` (`:1791`)
- `describeRunLine` (`:1486`, `:1918-1919`)

**`edge` is load-bearing in three places:** the printed `+X% EDGE` pill, the board's
`filter(edge >= 1)` inclusion gate, and `sortBoard`. On ~24% of rows the number shown is
wrong, the decision to show it was made with a wrong number, and its rank was set by a wrong
number.

Two hypotheses, not yet distinguished:
- **(a)** `edge` is genuinely miscomputed on those rows.
- **(b)** `edge` is computed against a *different reference* than the identity assumes —
  stale price, different book, pre-adjustment line — in which case `edge` may be defensible
  and only the printed market % is wrong.

Work the example backward: if the model had that side at ~60%, true disagreement with +170
is ~23 points; stored `edge` was ~4. **The ten-row hand check (stored `model_prob`, `edge`,
`line`, `price` → de-vig directly from the price → compare) has not been run.** It is the
cheapest way to separate (a) from (b).

⚠ Two honesty caveats carried from the measurement: these are historical rates over the
stored `model_predictions` population, not a today-only cut; and invalid ≠ null — the string
still prints a plausible-looking number, so the customer sees a wrong figure, not a blank.

**The gammafit verdict itself carries this as a blocker:** *reconstruction INCONSISTENT on
189/842 rows — fair = model_prob − edge does not de-vig to a valid market there. Fix before
trusting gamma below.*

---

## 5. My own failure modes this session — the log is long

**(a) The board. Three rounds of asserting a false thing over the operator's direct
testimony.** I took an empty API field as an empty screen, told Master G the board would be
blank for paying subscribers, built an entire A/B/C decision framework and a
recorder-asymmetry alarm on top of it, and kept re-litigating the API response after he had
told me twice the board was live. It took a screenshot to stop me.
**This is verbatim the HANDOFF-59 §5 error — reading the producer, not the consumer — which
I had read aloud in full at the top of this same session.** Reciting the rule is not
following it.
**The rule, restated with teeth: when live observation and a trace disagree, the observation
wins immediately and the trace is the thing under investigation.**

**(b) I conflated `total_shadow` with the published confident-band market.** Shadow read gap
1.4; I quoted it as proof the July rebuild had worked and told him totals was ready to ship.
They are **different markets** — shadow is fixed-side full-slate, published is the ≥0.55
confident band. HANDOFF-59 §"Key learnings" states this explicitly: *shadow leg and
published leg measure different markets — do not treat them as equivalent.*

**(c) I claimed re-windowing `RESETS.total` could silently auto-release totals.** False.
`RESETS` windows the published leg only; the shadow leg is independently windowed and gates
`cleared` regardless. I raised a false alarm and made a correct hygiene fix look dangerous.

**(d) I quoted the "MODEL IN TRAINING" banner as live.** It was removed 2026-08-03 at Master
G's direction (`WZ-NOBANNER`, PR #63). Caught by Claude Code, not by me.

**(e) I had the date wrong by five days** at session open (thought 08-08, was 08-13), which
silently moved every dated trigger.

**(f) I handed a terminal `curl` command to an operator who works in a browser — twice.** It
went into a Google search box. Master G does not use a shell. **Give bare URLs on their own
line, always.**

---

## 6. Claude Code — what worked

Every good outcome this session came from it **refusing to assert something it had not
measured**:

1. **Would not fabricate the 07-18 numbers.** Could not reach the rows (`SUPABASE_SERVICE_KEY`
   is Railway-only) and would not put the key in a URL. Built the probe instead and said so
   plainly.
2. **Would not assert a "current n" for gamma** that matched the handoff's tracked figure,
   because it could not reproduce that specific computation. Reported only what it measured.
3. **Stopped on `TOTAL_SD` per the prompt's own stop condition** when it found a second
   hardcoded `4.0` (`LIVE_DIVISOR`) and a third that must never move (`SD0`). Had it edited
   all three, the grid's back-out anchor would have been destroyed silently.
4. **Found `opp_odds` was already implemented** (commit `99631a9`, `WZ-HANDOFF44-2026-07-24`)
   — `edges.js:691/715` set `oppOdds` on `totalsEdges`, `predictionTracker.js:602` writes
   `opp_odds: e.oppOdds ?? null`. The 84 nulls are historical rows written before 07-24 plus
   genuinely one-sided books. **Item removed from the list — it was closed three weeks ago
   and the handoff never caught up.**
5. **Built an identity self-check into the grid** (`gridMeta.identityCheck`) so the grid
   could be disbelieved on its own evidence.

Process notes: "CREATE THE BRANCH FIRST" continues to work — zero branch-order slips.
`gh` is still not installed; PRs are created via the GitHub API with a keychain token.

---

## 7. NEXT — what Master G wants worked

### 1. 🥊 UFC — tonight's fight card (2026-08-15). TOP PRIORITY.
Nothing was done on UFC this session. Starting facts carried forward:
- Cito API, key in Railway env vars only — **never in code or plaintext, never in a URL**.
  Basic plan, commercial use permitted.
- `oddsDiag` is currently exposed on the **public UFC card** — cleanup item, and it is
  customer-visible.
- Verify the card is live and correct **before** the fights start. Same discipline as the
  NFL check: confirm what renders on **mobile**, not just what the API returns.

### 2. NFL and CFB recalibration
Both football models need a recalibration pass. Context:
- NFL is `calibrated: false` with `provisional: true` and `ratingsSeed` = 2025 SRS-seeded
  ratings. Preseason Week 1 has now been graded — first real NFL rows exist.
- CFB Week 0 is **2026-08-27**; NFL Week 1 is **2026-09-09**. Calibration work should land
  before those, not after.
- `backtest.js:183` reports `CFB_SIGMA 16.0 / CFB_TOTAL_SIGMA 13.0`; live is **15.5 / 16.0**
  — stale **and** transposed. Fix before any CFB calibration read, or the read is garbage.
- The `TOTAL_SD` method in §0 is directly transferable: build the grid, measure the constant,
  replace the eyeball. Check whether the football sigmas were ever measured or also typed.

---

## 8. Order of work — revised

The old order (γ first) is superseded. **γ is fit on `edge`, and `edge` is wrong on ~24% of
rows**, so waiting for sample size only buys precision on a bad number.

1. **Reconstruction defect (§4).** Run the ten-row hand check. Separate hypothesis (a) from
   (b). This gates everything below it.
2. **`pinnacle_clv` bias** — `predictionTracker.js:267`, biased low 2.2–2.4 pts. Note the CLV
   gamma is now *significantly negative* (−0.198, n 281) — **but it is computed on the biased
   field, so it is not yet evidence of anything.**
3. **γ re-fit** — and first, reproduce or retire the tracked γ = −0.1433 / n=91 / se 0.0856
   figure. Nobody knows what computation produced it.
4. ⛔ **NO SELECTION RULE CHANGES until 1–3 clear.** Two independent reasons now.

---

## 9. Open list

**Totals**
- Re-run the grid once post-#89 rows accumulate — current `TOTAL_SD = 6.0` rests on n=16 with
  35% of rows excluded for missing `opp_odds`.
- Decide `RESETS.total` 07-02 → 07-18 deliberately (§2). Releases nothing while shadow n<80.
- Shadow n 67 → 80. ⚠ **Those 67 rows were collected at SD 4.0.** Post-#89 rows are a
  differently-shaped model; consider whether the counter should reset.
- `W_MODEL = 0.55` still unmeasured — the W=0.00 pure-market test returned all nulls and
  remains unanswered.

**Blocking / infrastructure**
- **Find the real mobile football render path (§3).** The current map is proven wrong.
- **Add the Railway git SHA to `/api/health`** — now blocking, not cosmetic (§3).
- `backtest.js:183` — stale and transposed sigmas.

**Carried from HANDOFF-59, still open**
- Football empty-state message — `boardHorizon` carries `reason`/`nextGameISO`/`daysOut`,
  no frontend reads it. Pattern to copy: MLB All-Star block, `Home.jsx:32-45`.
- Cleanup PR — TEMP DIAGNOSTIC blocks and probe routes in `edges.js`;
  `getTeamPitchingStats` imported at `edgesModel.js:10`, never called; `oddsDiag` on the
  public UFC card. **Plus the two probes added this session** (`/totalresetprobe`) once the
  totals work closes.
- Rewrite the additive-only rule in `CLAUDE.md` (superseded by the 2026-08-03 build rule).
- **Add `LIVE_DIVISOR`'s deliberate 4.0 divergence and `SD0`'s anchor role to `CLAUDE.md`**
  so a cleanup pass does not "correct" them.
- Run line — 78–78, 50.0%, −12.98u, ROI −8.3% on n=156. Calibrated but unprofitable after
  vig. Not decisive (break-even ~52.4%, SE ~4pts). **Do not bench on this alone; do not
  defend it either.**
- Week 0 neutral read **2026-08-24** — Dublin AND Rio must return `neutral: 2`.
- NBA edge-sort bug `edgesNba.js:152–154`; landing page still claims NBA live with 4 markets;
  WNBA feed paid and unbuilt.
- NDSU / Sacramento State `CFB_FCS_LEVEL` — **DO NOT BUILD** (HANDOFF-57 §9 item 5).
- Conviction is anti-predictive and customer-facing (HANDOFF-55 §6).
- **`wz-handoff59-2026-08-08` branch, +230/−0, unmerged, contents unknown.** Asked about
  three times this session, never answered. Do not merge it blind.
- **PR #3 must never be merged.**

**Closed this session**
- ~~`opp_odds` at write time~~ — already implemented in `99631a9` (2026-07-24). §6 item 4.

---

## 10. Working agreements

- **Live observation beats a trace.** When the operator says the screen shows X and a trace
  says otherwise, the trace is what is under investigation. §5(a).
- **Trace the CONSUMER, not just the producer** — and verify the trace found *every*
  consumer. §3, §5(a).
- **Shadow leg ≠ published leg.** Different markets. Never quote one as evidence about the
  other. §5(b).
- **Gate on what replaced the old code, not on what was removed.** HANDOFF-59 §4.
- **Validators: check exit codes, prove with a negative control.**
- **"CREATE THE BRANCH FIRST" in every Claude Code prompt.**
- **Never hand Master G a shell command.** Bare URLs on their own line, always — including
  every PR link. §5(f).
- **When something new replaces something old, the old gets DELETED in the same cycle.**
  Deletion counts stated exactly. (2026-08-03 rule.)
- **State deletions exactly and enumerate them.** #86 was 0; #87 was 90 (relocation);
  #88 was 1; #89 was 7.
- **Verify PR branch bytes off `raw.githubusercontent.com` before reporting a pass**, and
  re-verify against `main` after merge.
- **Deploy order:** SQL/migrations → backend leaf files → frontend importers → `App.jsx` last.
- **Frontend deploys via Vercel** (hard refresh required; branch previews cannot load
  production data — verify on production). **Backend deploys via Railway.**
  ⚠ **A Vercel "Ready" comment on a PR says nothing about whether Railway deployed.** §3.
- **Never eyeball a constant.** If a value cannot be traced to a measurement, it is a bug
  waiting to be found. Two of them cost this product a market for four weeks.
- Address him as **Master G**. Never mention the time, never suggest rest.
