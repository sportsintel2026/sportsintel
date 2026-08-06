# HANDOFF-56

**Session: 2026-08-03, evening. `main` started at `504fe6f`, ends at `61d55b2`.**
**5 PRs merged (#66–#70). Zero SQL. Zero migrations. Nothing a paying customer sees changed.**

**Full day's diff, `504fe6f` → `61d55b2`:**
```
165   2  backend/routes/edges.js
 57  18  backend/services/predictionTracker.js
 47   0  backend/services/nflEdges.js
 29   3  backend/services/cfbEdges.js
134   0  backend/services/footballVenue.js      (new)
130   0  backend/services/cfbdApi.js            (new)
190   0  backend/services/cfbRatingBacktest.js  (new)
```

**This document supersedes HANDOFF-55.** Everything 55 carried that is still open is
reproduced here. Read `CLAUDE.md` first regardless — it supersedes any handoff it
contradicts.

---

## 0. 🔴 THE HEADLINE: CFB HAS NO EDGE, AND NOW WE HAVE PROOF

**Measured on 2,210 games across three seasons of real CFBD closing lines
(`/api/edges/cfbratingbacktest`, ratings from year Y predicting year Y+1):**

| system | MAE vs actual margin | ATS |
|---|---|---|
| SP+ | 14.629 | **50.0%** |
| SRS (control) | 14.229 | **49.6%** |
| **closing line** | **12.039** | — |

**ATS standard error = 1.1 points.** Per-season: 49.9%, 47.2%, 53.0% — swinging ±3
around 50 with a per-season SE of ~1.9. No trend.

Three conclusions, in order of importance:

1. **A last-season team rating is worth NOTHING against a CFB closing line.** Both
   systems are a coin flip. This is not a "our SRS is bad" result — it is a "the market
   has already priced last season" result.
2. **The market beats both by 2.2 points of MAE.** Any rating layer whose error is
   ~14 has no business overriding a line whose error is ~12.
3. **`CFB_W_MODEL = 0.30` weights the model's own opinion at 30% — and that opinion is
   the coin flip above.** The CFB board is, honestly described, market-anchored. Say so
   internally; do not let a future session rediscover this as a surprise.

### ⛔ THE SP+ SWAP IS DEAD — DO NOT REOPEN IT

The plan was to replace the ESPN 2025 points-differential SRS with CFBD SP+. **SP+ lost
on MAE in all three pairs and the ATS gap (0.4) is a third of one SE.** It is not better.
Killed for one evening's work instead of a season of quiet bleed.

⚠ Two related facts that read like a reason to retry, and are not:
- **CFBD has NO 2026 preseason SP+ in the API.** `/ratings/sp?year=2026` returns an
  empty array (verified live, `ok:true`, `count:0`). Connelly publishes preseason SP+ on
  ESPN in March; it is not in this feed. 2025 returns 137 rows.
- SP+ ratings ARE in the right units — spread min −36.6 / max +32.4 / mean 0.7, points vs
  average, directly comparable to `cfbModel.ratingMargin`. **The units were never the
  problem. The predictiveness was.**

### What we got that IS permanent

**`cfbRatingBacktest.js` + `/api/edges/cfbratingbacktest` is a reusable harness.** Any CFB
rating idea can now be graded against five seasons of closing lines in minutes, before it
touches the board. That did not exist this morning. It is what turned "SP+ is obviously
better" from a plausible story into a measured no.

**Its ruler was tested before it was trusted** (`CLAUDE.md`: TEST THE RULER). Against a
rigged dataset with a known answer, a RANDOM rating scores **49.9%** ATS on a sharp line
and a truth rating beats it. An instrument that cannot fail that test cannot be trusted to
pass this one. Two defects were caught this way and both are fixed:
- eligibility keyed by game CONTENT collapsed repeated matchups in a `Set`, undercounting
  `scoredGames` while still scoring every duplicate → now keyed by ROW INDEX;
- the first "noise" control read 55% because truth and noise were drawn from consecutive
  values of the same weak LCG. The engine was fine; the TEST was wrong.

---

## 1. What shipped

| PR | Token | What it fixes | HEAD after |
|----|-------|---------------|------------|
| #66 | `WZ-FBCAL-2026-08-03` | NFL/CFB season-boundary dates + derived `preseason` flag | `212621e` |
| #67 | `WZ-FBNEUTRAL-2026-08-03` | Neutral-site join, both leagues; dead `ev.neutralSite` deleted | `87e9aca` |
| #68 | `WZ-FBRECORD-MATCHES-BOARD-2026-08-03` | Football recorder now mirrors the board | `ebd4208` |
| #69 | `WZ-CFBD-2026-08-03` | CFBD client + `/cfbdprobe` | `4e0fa22` |
| #70 | `WZ-CFBDBACKTEST-2026-08-03` | Rating-system backtest harness | `61d55b2` |

### #66 — the calendar, and it was about to cost Week 1

`nflRegularSeasonStart` computed "Labor Day Monday + 3 = Thursday". Correct for 2025
(Sept 4). **2026 opens WEDNESDAY Sept 9** (Patriots at Seahawks, Super Bowl LX rematch),
so the formula returned Sept 10 and tagged the season opener `"preseason"`.

Chain: `nflPhaseFor` → `runNFLSlate` defaults to the earliest phase with upcoming games
→ **filters events to that phase**. From ~Aug 30 to Sept 9 the board would have shown
**one game** and hidden the whole Week 1 slate — and `recordFootballPredictions` runs on
that same filtered slate with a 7-day imminence gate, so **the Week 1 shadow rows would
have been lost too.**

CFB's boundary was Aug 20; 2026 Week 0 is **Aug 27**. Both years are now pinned
explicitly with the old formula retained as the fallback for unpinned years.

The two hardcoded `preseason: true` literals now derive from `slate?.phase?.selected`.

### #67 — neutral site was dead in both leagues

`grep -c neutralSite`: `nflEdges` **0**, `cfbEdges` **2**, `oddsApi` **0**. CFB read
`ev.neutralSite` off an odds event that never carries the field — permanently false. NFL
never read it at all. Meanwhile both ESPN data layers already parse
`neutralSite: !!comp.neutralSite`. **The data was in the repo and simply not joined.**

Every neutral game took a phantom full HFA — 3.0 pts CFB, 2.5 NFL. At `CFB_SIGMA` 15.5
that is ~7.5 probability points on the raw model, on Dublin, Rio, Atlanta, Nashville,
Lambeau and the NFL international slate.

`footballVenue.js` does the join once for both leagues. It **mirrors
`predictionTracker.gradeFootball`** rather than inventing a second matcher: `matchupKey`,
CFB fallback on `cfbSchoolKey`, collision-guarded.

⚠ **Three states, not two: `true` / `false` / `null`.** Only an explicit `true` from ESPN
zeroes the HFA. `null` = unknown → flag left unset → today's behaviour. Unknown degrades
to the status quo, never to a guess. ESPN down on every date → every game `null`, board
unchanged. Verified.

### #68 — the recorder was booking 5% of the board

Identical in shape to `WZ-ML-RECORD-MATCHES-BOARD-2026-07-19`, which cost MLB ~91% of its
board. The football board publishes every rated game ranked by win%; the recorder wrote a
core row only on `value === true`, i.e. `edge >= EDGE_ML 0.03` at `W_MODEL 0.30` — **a
10.0 probability-point disagreement with the sharp market**, which is 3.3 pts of margin at
a pick'em and 5.7 at a big favourite.

`pick`/`pickTeam` are ALSO gated on `value` inside the models, so dropping the gate alone
would have left the side null. **The side is now derived in the recorder the way the board
derives it, from win probability.** Verified identical at every half-point 0–100: 603/603.

**KEPT deliberately:** the `dataQuality !== "rated"` skip. An unrated game is the market
echoed back, not a pick — a coverage gate, not an edge filter. The `*_shadow` rig still
covers the full slate including unrated games.

---

## 2. Corrections to prior documents — apply these

- **`CLAUDE.md`'s "CFB disclaimer trap at `edges.js:1998`" is CLOSED.** `edges.js:2103`
  already derives the phase correctly. Only the SRS clause remains hardcoded (§4).
- **HANDOFF-55 §8's line numbers were stale.** Both `preseason: true` literals are now
  gone entirely (#66).
- **`predictionTracker.js`'s "NFL totals echo the market, so nothing logs" was stale.**
  `nflEdges` feeds `ctx.projPoints` via `projPointsFor` — NFL totals have had a real
  opinion since `WZ-NFLTOTALS-2026-07-05`. Comment corrected in #68.
- **`backtest.js:183` still reports `current: { CFB_SIGMA: 16.0, CFB_TOTAL_SIGMA: 13.0 }`.**
  Live values are **15.5 / 16.0** — stale AND transposed. A future session reading that
  report will apply the wrong recommendation. **NOT FIXED. Fix it before using that route.**

---

## 3. 🔴 MY OWN FAILURE MODE THIS SESSION — READ THIS

**Three times I published a gate number or a code block I had not extracted from the
thing I actually verified.** Claude Code caught all three and halted correctly each time.
Each cost a full round trip.

1. **#67 first attempt** — I referenced an attached file instead of pasting the code
   inline. `CLAUDE.md` says deliver prompts INLINE as copy-paste text. Claude Code
   correctly refused to fabricate the file.
2. **#67 second attempt** — my insert block omitted a blank line that the `numstat` I
   published was counting. Gate 2 mismatched by exactly 1 on both files. The base already
   contained that separator blank, so the fix was un-shippable as written and 23/24 was
   the correct number.
3. **#68** — I wrote gate 7 as `grep -c 'dataQuality !== "rated"' -> 1` and **never ran
   it**. My own comment quotes the phrase, `grep -c` counts lines, so 2 was correct.

**THE RULE THAT PREVENTS ALL THREE:** cut every insert block out of `git diff` **by
command** and read the gate numbers from that same diff. Same bytes, one step, nothing to
drift between them. Retyping is what loses whitespace. And **any grep gate on a phrase
that also appears in prose must be run first**, or scoped with `grep -v '^\s*//'`.

**#70 used the extraction method and passed all seven gates first try.**

---

## 4. Still open — football

- ⚠ **CFB `sosApplied: true` is HARDCODED, 2 occurrences in `cfbDataSource.js`.** NFL's
  `applyNflSrs` is all-or-nothing and reports honestly; the comment at `edges.js:1969`
  says so explicitly. If one CFB team's schedule fetch fails, `games[id] = []` → that team
  silently gets `sos = 0` while the rest get full SoS — the internally-inconsistent state
  NFL's failure policy exists to prevent — and the customer disclaimer still claims
  "(SRS strength-of-schedule applied)". `sosGames` is emitted per team but nothing gates
  on it. **Not fixed.**
- **138 FBS teams in 2026** — North Dakota State and Sacramento State promoted. Neither
  has a 2025 FBS rating in ESPN group 80, so both resolve unrated, and **as opponents they
  credit `CFB_FCS_LEVEL = -28`**, which is badly wrong for NDSU and distorts SRS for
  everyone who plays them.
- **CFBD ships a `nationalAverages` aggregate row inside the SP+ team list.** Anything
  consuming that payload blind will rate it as a school. `cfbRatingBacktest.isTeamRow`
  drops it; any new consumer must too.
- **CFBD → ESPN name join is 61.3% (84 of 137).** Every unmatched name is the bare school
  without a mascot (`Alabama`, `Notre Dame`, `Penn State`, `NC State`) plus oddities
  (`Hawai'i`, `San José State`, `UL Monroe`, `App State`, `Ole Miss`). `cfbSchoolKey`
  already strips mascots and is already collision-guarded in `gradeFootball` and
  `footballVenue`. **Only matters if a future build needs the join — the SP+ swap is dead,
  so nothing needs it today.**
- **`/api/edges/fbseasonprobe` and `/api/edges/cfbdprobe` are TEMPORARY** and marked so in
  code. `fbseasonprobe` should be deleted together with the pinned date tables and the old
  Labor-Day formula when the boundary is derived from ESPN's `types/2.startDate`
  (verified live: NFL `2026-09-09T07:00Z`, CFB `2026-08-22T07:00Z`). ⚠ **ESPN's CFB
  `startDate` is Aug 22, which is NOT the first kickoff — Week 0 is Aug 27.** It is an
  administrative boundary. Harmless for our use (it only gates when the ratings crawl
  starts) but **never reuse it as a "first game" signal.**
- **NFL SoS live (#57), NOT calibrated.** Zero NFL games have graded against these
  ratings. Shadow-grade in September.
- **`edges.js` now carries 18 TEMP DIAGNOSTIC / read-only-probe blocks and 13 probe/preview/backtest routes**, several
  from cycles that closed weeks ago. Plus `getTeamPitchingStats` imported at
  `edgesModel.js:10` and never called, and `oddsDiag` on the public UFC card. **Carry this
  as a named cleanup PR; do not let it keep growing.**

---

## 5. Standing rule change — set by Master G 2026-08-03

**"When something new is built on top of something old, the old one gets DELETED in the
same cycle."** This SUPERSEDES the additive-only default that `CLAUDE.md` and every prior
handoff state as a hard rule.

- No dead fallbacks. No superseded code sitting next to its replacement. One mechanism per
  job.
- Deletion counts are still gated and still stated exactly. **The gate becomes "exactly N
  deletions, and here is every one of them" instead of "zero."** That form is what caught
  the two `preseason: true` lines and the three dead `ev.neutralSite` reads cleanly.
- `git show <sha>:<file>` remains the restore path, so the rule costs nothing in safety.
- ⚠ **WHERE THE OLD RULE ACTUALLY LIVES — I got this wrong once already, so it is stated
  precisely:** `CLAUDE.md` does NOT contain the phrase "Additive-only" (grep returns 0). Its
  nearest rule is **"BUILD, DON'T JUST SUBTRACT"** under HARD RULES, which does not conflict
  with the new rule and needs no change. The additive-only rule lives in the **HANDOFF
  chain** — HANDOFF-55 §14 states it as a working agreement. This document replaces it. If a
  future session finds "Additive-only" in a handoff, **§5 here overrides it.**

---

## 6. Order of work — unchanged, and still gating everything

From `CLAUDE.md`, none of steps 2–4 started:

1. **Fit γ — the gate on everything else.** Clean re-fit gave γ = **−0.1433**, n=91,
   se 0.0856, CI [−0.311, +0.024] — **NOT significant**, r² = 0.031. Resolution needs
   **n ≈ 125**, accruing +3.4/day → **~2026-08-14**.
   **⛔ NO SELECTION RULE gets proposed until this clears.** That includes anything about
   the CFB board weight, however tempting §0 makes it.
2. **Fix `pinnacle_clv`** — `predictionTracker.js:267`, de-vigged Pinnacle close minus our
   VIGGED taken price. Biased low 2.2–2.4 pts. Reported −1.31% corrects to ~**+0.9%**.
3. **Add `opp_odds` at write time** — one column, unblocks correct CLV permanently.
4. **Only then touch the board.**

---

## 7. NEXT — dated

1. **~2026-08-14 — the γ re-fit.** Highest-value read on the board and it governs MLB and
   football alike. Nothing about selection moves before it.
2. **~2026-08-15 — `totalslinebias` re-read**, windowed post-2026-08-03-22:30-UTC (the
   #60 cutoff). Same week as #1.
3. **Week of 2026-08-24 — the FIRST REAL NEUTRAL-SITE READ.** `ratingsMeta.neutral` will
   show `resolved: 0` until CFB Week 0 enters ESPN's scoreboard window; **that is correct,
   not a failure.** When Week 0 lands, Dublin and Rio must come back `neutral: 2`. If they
   do not, the matcher needs an alias — and finding that out three days early is the whole
   point of the coverage counter.
4. **2026-08-27 — CFB Week 0.** 2026-09-09 — NFL Week 1.
5. **Fix the CFB `sosApplied` hardcode** (§4) before the season, or stop claiming SRS in
   the customer disclaimer.
6. **Fix `backtest.js:183`** stale/transposed sigma literal.
7. **Rewrite the additive-only rule in `CLAUDE.md`** (§5).
8. **Cleanup PR** for the accumulated temp diagnostics (§4).
9. Standing from HANDOFF-55, unchanged: conviction is anti-predictive and customer-facing
   (§6 of 55); NBA edge-sort bug at `edgesNba.js:152–154`; the landing page still claims
   NBA is live with 4 markets; WNBA paid-for and unbuilt; PR **#3 must never be merged**.

---

## 8. Working agreements — additions from this session

- **Extract, never retype.** Every insert block in a Claude Code prompt comes out of
  `git diff` by command, and the gate numbers come from that same diff.
- **Run every grep gate before publishing it**, especially any phrase that also appears in
  a comment. `grep -c` counts LINES.
- **Deliver prompts INLINE as copy-paste text**, never as an attachment. This was violated
  twice tonight and cost two round trips both times.
- **Always give Master G the clickable PR link as a bare URL on its own line.** Same for
  any endpoint he is asked to open.
- **Watch the Claude Code input box.** Three times tonight an unsent, unanchored follow-up
  sat there — including `Merge #64, #65, #66, #67 into main` (three already merged) and
  `wire SP+ into cfbModel if it wins` (which the data then said it did not).
- **A read-only probe shipped WITH the fix is the right pattern when the answer cannot be
  known from this side of the network** (#64's precedent, used again by #66 and #69). Mark
  such routes TEMPORARY in the code comment and schedule the deletion.
- Address him as **Master G**. Never mention the time, never suggest rest.
