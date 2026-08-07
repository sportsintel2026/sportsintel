# HANDOFF-58

**Session: 2026-08-06 evening. `main` started at `5767255`, ends at `1e50f53`.**
**3 PRs merged (#76–#78). Zero SQL. Zero migrations. Two customer-visible changes, both
verified on production rather than on report.**

**Full session diff, `5767255` → `1e50f53`:**
```
  6   0  backend/routes/edges.js
 32   2  backend/routes/performance.js
 27   6  backend/services/cfbEdges.js
 33   8  backend/services/nflEdges.js
 10   5  backend/services/predictionTracker.js
 28  12  frontend/src/pages/Home.jsx
 25  15  frontend/src/pages/HomeDesktop.jsx
```
**161 added, 48 deleted, 7 files.**

**This document supersedes HANDOFF-57.** Everything 57 carried that is still open is reproduced
here. Read `CLAUDE.md` first regardless — it supersedes any handoff it contradicts.

---

## 0. 🔴 THE HEADLINE: THE BOARD AND THE RECORDER NOW SHARE ONE HORIZON

The Hall of Fame game (2026-08-06, Carolina 33 Arizona 30) was the last NFL game in the feed.
When it finished, The Odds API's preseason key went `active:false`, the preseason side of the
merged feed emptied, `availablePhases` collapsed to `["regular"]`, and **the board fell through to
regular season and published 16 games from Sept 10–15 — 34 to 39 days out — under a header reading
"Thursday, August 6."**

`recordFootballPredictions` drops anything past `FOOTBALL_IMMINENT_DAYS = 7`. So the board showed
**16 NFL edges and the recorder logged 0**. CFB had the identical defect: an Aug 29 slate ~22 days
out, **25 edges, 0 logged**.

That is the same board/recorder split `WZ-FBRECORD-MATCHES-BOARD-2026-08-03` (#68) closed — arriving
from the opposite direction. #68 fixed the recorder covering *less* than the board; this was the
board covering *more* than the recorder could reach.

**Now: the recorder owns the number and the board reads it.** `FOOTBALL_IMMINENT_DAYS` is exported
from `predictionTracker.js` and imported by both slate builders. A slate whose first game sits
beyond the horizon publishes nothing and says why.

---

## 1. What shipped

| PR | Token | What it does | HEAD after |
|----|-------|--------------|------------|
| #76 | `WZ-FBHORIZON-2026-08-06` | board horizon = recorder horizon, both leagues | `4ad0eab` |
| #77 | `WZ-FBRECORD-STRIP-2026-08-06` | NFL/CFB show the model's own graded record | `b6adf10` |
| #78 | `WZ-FBCALIB-PHASE-2026-08-06` | football calibration splits preseason from regular | `1e50f53` |

### #76 — the horizon gate
`FOOTBALL_IMMINENT_DAYS` (renamed from `NFL_IMMINENT_DAYS`; it always governed CFB too via
`recordCFBPredictions`, so the prefix was a lie) is now exported and consumed by `runNFLSlate` and
`runCFBSlate`. New `boardHorizon` field on both slates and both routes:
`{ published, reason, horizonDays, nextGameISO, daysOut }`.

**⛔ DELETED:** the `upcoming.length ? upcoming : times` fallback in **both** edges services. That
fallback anchored the window to a PAST game so the board would never look empty. A board showing
finished games is worse than a board that reports it has none.

**Two bugs the tests caught before shipping — both would have shipped silently:**
- A slate anchored 6 days out still reached **13 days** on its far edge, publishing a tail the
  recorder drops. Fixed by clamping `windowEnd` to `now + horizon`.
- A game **exactly** 7.0 days out reported `published: true` over an **empty** board — the clamp put
  `windowEnd` on the anchor instant and the filter is `t < windowEnd`, so the anchor excluded
  itself. Fixed with `Math.max(anchor + 1, ...)`. The comment in the code explains this; do not
  "simplify" it away.

**Verified live after deploy:** NFL `published:false, daysOut:33.8, nextGameISO 2026-09-10`;
CFB `published:false, daysOut:22.4, nextGameISO 2026-08-29`. Both `games: []`.

### #77 — the model's record on the football boards (customer-visible)
NFL and CFB Edges now show **the model's own graded record** — W–L, win rate, units — from
`/api/performance/<sport>`. Mobile `.kpis` strip and desktop index row.

- **MLB deliberately keeps WizePlays.** Its model record was replaced after the earlier numbers
  problem; swapping MLB back would undo that decision. Do not "unify" these.
- **NO MINIMUM SAMPLE, at Master G's explicit direction.** The record starts the day it starts. The
  strip prints "`<n>` graded" under the percentage so it always discloses its own thinness. The only
  guard is `total > 0` — an ungraded league renders nothing rather than a fabricated 0-0.
- **⛔ DELETED:** the `perfStats` block in **both** frontend files. It computed roi/roiLbl/clv and
  was rendered nowhere in either — dead since written. `modelRec` replaces it and is on screen.
- Football rows carry **null confidence**; `isQualified()` maps null → `"NEUTRAL"`, which is in
  `QUALIFYING_TIERS`, so they count. Verified against `performance.js` before building — this was
  the one thing that could have made the strip render 0-0 forever.

### #78 — calibration splits by season phase
`/api/performance/fbcalib` pooled preseason and regular-season rows. By the Sept 9 opener that pool
would have held **~45 preseason rows** (3 markets × ~49 preseason games) — past `MIN_N` 40 — so the
first NFL calibration read would have described **preseason before a regular-season snap was
played**.

Now: `phase` defaults to `regular`; `?phase=preseason` reads preseason alone; `?phase=all` restores
pooling explicitly. `phaseCounts` is always the **unfiltered** census, so the default hides nothing.
Phase comes from `nflPhaseFor` — the same function the board uses — so calibration and board can
never disagree about what preseason is. **CFB has no preseason at all** (`cfbEdges.js:273` hardcodes
`phase: "regular"`), so every CFB row is regular by construction.

**Verified live:** `phase:"regular", phaseCounts:{preseason:3, regular:0}, rowsScanned:3, rowsUsed:0`.

---

## 2. 🔴 THE PRESEASON QUESTION — settle this before re-litigating it

Master G pushed back on excluding preseason, correctly: preseason is not information-free. The
distinction that resolves it:

- **Preseason OUTCOMES** (who won, by how much) are a weak proxy for regular-season strength.
  Starters play a quarter; the fourth quarter is decided by players who will be cut.
- **Preseason INFORMATION** (who won the QB job, who got hurt, how the O-line held) is genuinely
  valuable, and the market prices it.

**The deciding fact: our model has no channel to receive the informative part.**
`nflDataSource.js:459` builds a rating from `gp`, `pf`, `pa` — games played, points for, points
against. There is no injury feed, no depth chart, no snap counts, no roster data anywhere in it. It
sees only the scoreboard, which is the least informative part of preseason.

**And the split does not discard preseason — it makes "is preseason predictive?" ANSWERABLE.**
Pooled, the two are indistinguishable in the data and the question can never be asked. Separated,
preseason calibration can be read on its own and compared. If it turns out predictive, that is a
finding worth acting on.

**Ratings are untouched by preseason regardless:** `nflEdges.js:165` returns the 2025 prior-only
seed until `regStart`, so `blend.blendedTeams` is 0 and no preseason result moves any rating.
Nothing in this stack auto-tunes; every parameter change goes through measurement and Master G.

---

## 3. Live readings — new information from tonight

- **NFL model record: 3–0.** Hall of Fame game, all three core markets correct (Carolina ML,
  Carolina spread, over). The two `*_shadow` "loss" rows are the **fixed-side mirrors** by
  construction (always home for ML/spread, always over for totals) — they are the same calls
  inverted, not second opinions. Do not read them as misses.
- **The Odds API `americanfootball_nfl_preseason` key is `active:false` right now.** Confirmed by
  hitting `/v4/sports?all=true` with the real key. Our fetch runs clean every 30 min and gets an
  empty list because there is nothing behind it. **Nothing on our side is broken.** The key was
  active while the HOF game was live and flipped off after it finished.
- **The Preseason tab is data-driven and returns on its own.** `Home.jsx:634` filters
  `[["preseason",…],["regular",…]]` on `phaseAvail`, which comes straight from the API's
  `phase.available`. Nothing was deleted; there is nothing to rebuild. It reappears the moment a
  preseason game is in the feed. Expect that ~**Aug 9–10** when books post the Aug 13 slate.

---

## 4. 🔴 FAILURE MODES — three, all recurring

**(a) Claude Code applied edits before creating the branch — THREE TIMES tonight** (#76, #77, and
narrowly avoided on #78). Twice the commit landed on the previous session's branch and had to be
cherry-picked to a clean one; nothing was ever pushed wrong, and the full gate suite was re-run each
time. **Put "CREATE THE BRANCH FIRST, before editing" in every prompt.** #78 included that line and
the slip did not recur.

**(b) Grep gates tripped on my own comments — TWICE.** HANDOFF-56 §3 warns about exactly this and it
still happened, because the new comments QUOTE the deleted code they replace. Both were caught
because the gates were run before publishing.
**RULE: any grep gate on a phrase that also appears in prose must be scoped with
`grep -v '^\s*//'`, and the prompt must SAY SO** so Claude Code doesn't treat a comment hit as a
failure. Also: `for (const r of rows) {` appears **15 times** in `performance.js` — a gate counting
it is meaningless. Scope gates to something unique.

**(c) I sent Master G to endpoints without reading their projection — TWICE (carried from
HANDOFF-57 §4, and it recurred).** Also: I ran `esbuild --loader=jsx` on a file path, which errors,
then piped it through `tail` and printed "JSX OK" — **a false pass in my own gate.** Caught before it
reached a prompt, but only just.
**RULE: check EXIT CODES, never piped stdout. And prove the checker can fail** — I now run a
negative control (feed it broken input, confirm it rejects) before trusting any validator.

---

## 5. Standing rules — unchanged

**Build new → delete old, same cycle** (HANDOFF-56 §5). This session's 48 deletions were all
intentional removals of superseded code, enumerated by command before delivery.
**Test the ruler** — every test suite this session was mutated on purpose to confirm it fails when
the code is wrong. #76: 6/6 pass, 5/6 with the clamp removed. Validators get a negative control.
**Extract, never retype** — insert blocks cut from `git diff` by command; gate numbers read from
that same diff.
**Prompts inline, never as an attachment. Clickable PR link as a bare URL on its own line.**

---

## 6. Order of work — unchanged, still gating everything

1. **Fit γ — the gate on everything else.** γ = **−0.1433**, n=91, se 0.0856, CI [−0.311, +0.024],
   **NOT significant**, r² = 0.031. Needs **n ≈ 125** at +3.4/day → **~2026-08-14**.
   **⛔ NO SELECTION RULE until this clears.**
2. **Fix `pinnacle_clv`** — `predictionTracker.js:267`, de-vigged close vs our VIGGED taken price.
   Biased low 2.2–2.4 pts; reported −1.31% corrects to ~**+0.9%**.
3. **Add `opp_odds` at write time.**
4. **Only then touch the board.**

---

## 7. NEXT — dated

1. **~2026-08-09/10 — preseason lines post.** Both football boards refill on their own; the
   Preseason tab returns without a deploy. **Verify** the NFL board publishes the Aug 13 slate and
   that `boardHorizon.published` flips to `true`.
2. **~2026-08-14 — the γ re-fit.** Highest-value read on the board.
3. **~2026-08-15 — `totalslinebias` re-read**, windowed post-`2026-08-03 22:30 UTC`.
4. **Week of 2026-08-24 — Week 0 neutral read.** Dublin AND Rio must return `neutral: 2`. Week 1
   already returns `neutral: 1` correctly, so the matcher works; this is a narrow check.
5. **2026-08-27 CFB Week 0. 2026-09-09 NFL Week 1.**
6. **The football empty-state message is NOT built.** `boardHorizon` carries `reason`,
   `nextGameISO` and `daysOut`, and **no frontend reads it** — an empty board currently shows the
   user nothing. Pattern to copy: the MLB All-Star-break block at `Home.jsx:32-45`. Deferred
   deliberately because preseason lines land in days; revisit if the gap recurs.
7. **Fix `backtest.js:183`** — reports `CFB_SIGMA 16.0 / CFB_TOTAL_SIGMA 13.0`; live is **15.5 /
   16.0**. Stale AND transposed. Still not fixed.
8. **Rewrite the additive-only rule in `CLAUDE.md`** (§5).
9. **Cleanup PR** — `edges.js` carries 18 TEMP DIAGNOSTIC blocks and 13 probe routes;
   `getTeamPitchingStats` imported at `edgesModel.js:10` and never called; `oddsDiag` on the public
   UFC card.
10. **NDSU / Sacramento State `CFB_FCS_LEVEL`** — investigated 2026-08-06, **DO NOT BUILD**. See
    HANDOFF-57 §9 item 5 for the full finding: `fbsIds` is season-scoped, the 2026 side self-heals
    via `cfbEdges.js:121`, and the magnitude is ~1.0 rating point on ~2 teams inside a rating layer
    measured at **50.0% ATS over 2,210 games**.
11. **Add the Railway git SHA to `/api/health`.** Every deploy confirmation is currently inference
    from clocks (merge `%cI` vs Railway deploy time vs response `computedAt`). One field makes it a
    fact. Not started.
12. Standing, unchanged: conviction is anti-predictive and customer-facing (HANDOFF-55 §6); NBA
    edge-sort bug at `edgesNba.js:152–154`; the landing page still claims NBA is live with 4
    markets; WNBA paid-for and unbuilt; **PR #3 must never be merged.**

---

## 8. Working agreements — additions

- **"CREATE THE BRANCH FIRST" goes in every Claude Code prompt.** §4(a).
- **Scope grep gates with `grep -v '^\s*//'` and say so in the prompt** when the phrase appears in
  the new comments. §4(b).
- **Validators are checked by exit code and proven with a negative control.** §4(c).
- **Read a route's projection before telling anyone to open it.** The service returning a field does
  not mean the route emits it.
- **Frontend deploys via Vercel, not Railway** — slower than Railway, and a hard refresh is required.
  A Vercel branch preview cannot load production data; verify on production after merge.
- **Confirm deploys by timestamp** until `/api/health` carries a SHA.
- **Verify PR branch bytes off `raw.githubusercontent.com` before reporting a pass**, and re-verify
  against `main` after the merge. Done for all three PRs; all byte-identical.
- **UI work: mock first**, phone-width standalone HTML with numbered options, Master G selects by
  number. Followed for #77.
- Address him as **Master G**. Never mention the time, never suggest rest.
