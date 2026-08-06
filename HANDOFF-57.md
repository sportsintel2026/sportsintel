# HANDOFF-57

**Session: 2026-08-05 late → 2026-08-06 early. `main` started at `61d55b2`, ends at `d2d1e13`.**
**3 PRs merged (#71–#73). Zero SQL. Zero migrations. One customer-facing string changed — and it
changed from a claim into a fact.**

**Full session diff, `61d55b2` → `d2d1e13`:**
```
299   0  HANDOFF-56.md                        (doc)
  7   2  backend/routes/edges.js
 89  12  backend/services/cfbDataSource.js
  6   0  backend/services/cfbEdges.js
```
Code only, excluding the doc: **102 added, 14 deleted, 3 files.**

**This document supersedes HANDOFF-56.** Everything 56 carried that is still open is reproduced
here. Read `CLAUDE.md` first regardless — it supersedes any handoff it contradicts.

---

## 0. 🔴 THE HEADLINE: THE CFB BOARD CAN NO LONGER CLAIM SRS IT DIDN'T APPLY

HANDOFF-56 §4 and §7 item 5 named this and it is now **CLOSED**, three weeks before Week 0.

The board's customer disclaimer said "(SRS strength-of-schedule applied)" as a hardcoded literal at
`edges.js:2103`. It printed whether or not the adjustment happened. Underneath, `cfbDataSource.js`
reported `sosApplied: true` as a hardcoded literal in two places, and a failed ESPN schedule fetch
left `games[id] = []` → that team took `sos = 0`, a perfectly average schedule, while all ~135
others took a real one — **and it dragged the league re-centering pass at the same time.**

Now: the SoS layer is **all-or-nothing**, the flag is real, and the disclaimer reads off the flag.

### ⚠ CFB CANNOT COPY NFL'S FAILURE POLICY LITERALLY — this is the one design trap here

`nflDataSource.applyNflSrs` declines if any rated team's opponents aren't themselves rated
(`nflDataSource.js:381–382`). **CFB credits unrated FCS opponents at `CFB_FCS_LEVEL` by design**, so
that gate would decline on nearly every real slate. The CFB gate is therefore narrower and correct:
**every rated team must come back with at least one completed game.** `MIN_GAMES_FOR_RATING = 4`
guarantees a rated team played ≥4, so an empty schedule is always a fetch failure, never a
legitimate early-season state. `ratedIds.length === 0` already returns market-only.

---

## 1. What shipped

| PR | Token | What it does | HEAD after |
|----|-------|--------------|------------|
| #71 | — | `HANDOFF-56.md` into the repo root, doc only | `a3f29bc` |
| #72 | `WZ-CFBSOSHONEST-2026-08-05` | CFB SoS all-or-nothing + bounded retry + honest disclaimer | `52d1819` |
| #73 | `WZ-CFBSOSMETA-2026-08-06` | wire the retry counters through to `ratingsMeta` | `d2d1e13` |

### #72 — three things in one cycle

**1. All-or-nothing.** `sosMissing` / `sosApplied` / `sosSkippedReason` computed right after the
crawl. The SRS fixpoint is gated on the loop header (`for (let k = 0; sosApplied && ...)`) so it
does not run at all on decline, plus a non-finite guard after it. On decline every team falls back
to its own `preSosRating` — the schedule-blind value already computed for audit — and the top-level
`note` swaps to a string that says SoS was NOT applied and why. SoS parameters (`movCap`,
`srsIters`, `fcsLevel`, `sosWeight`) are now emitted only when a run actually happened, mirroring
`nflDataSource.buildTeamRatings:510–512`.

**⛔ DELETED, not guarded: `const sos = g.length ? ... : 0;`** That zero WAS the bug. With the gate
in front of it the branch is unreachable, and per §5 of HANDOFF-56 the superseded mechanism goes.

**2. Bounded retry.** There was **no retry anywhere in `cfbDataSource.js`** (`grep -ci
retry|backoff|sleep` → 0) and `espnGet` is single-shot with an 8s abort. Because all-or-nothing
makes ONE flake cost the whole league a 6h cache window, `espnGetSchedule` wraps only the schedule
fetch: 3 attempts, 250ms / 750ms backoff, and a **league-wide 20s wall-clock budget** so a total
ESPN outage cannot stretch the request unboundedly. Past the budget every remaining team is
single-shot and the layer declines. **A 4xx that is not 429 fails through immediately** — that is
ESPN saying "no such thing"; retrying it only burns budget other teams need.

**3. Honest disclaimer.** `edges.js:2103` now uses `slate?.ratingsMeta?.sosApplied`, byte-identical
in shape to the NFL disclaimer. The stale NFL comment claiming CFB hardcodes its clause was
corrected in the same cycle.

### #73 — instrumentation that reached nothing

#72 added `sosFetch: { retries, recovered }` to the ratings object. `cfbEdges.js:253` builds
`ratingsMeta` from a **hand-picked field list**, and I did not add it there — so the counters
existed and surfaced nowhere. #73 is one field. The decline REASON needs no field: the decline
branch of `buildTeamRatings` already embeds it in `note`, which `ratingsMeta` passes through.

---

## 2. What was proven, and what was NOT

**Proven before shipping:**
- **Success-path equivalence.** Old fixpoint (with the ternary) vs new (without), 500 random slates
  where every team has a non-empty schedule: **31,188 ratings compared, 0 mismatches.** When SoS
  applies, ratings are identical to before. The live board confirms it — same 25 edges, same
  numbers, before and after.
- **Retry behaviour**, 7 known-answer cases against the helper **extracted from the edited file by
  command**: clean fetch, one timeout then success, two 503s then success, 404 fails fast, 429
  exhausts attempts, past-budget single shot, exhausted-rethrows-last. 7/7.
- **The ruler was tested** (`CLAUDE.md`: TEST THE RULER). Mutating `sosRetryable` to retry
  everything made the 404 case FAIL, 6/7, exit 1. A suite that cannot fail proves nothing.

**NOT proven, and a future session must not assume otherwise:**
- **`buildTeamRatings` has never run end-to-end against a real ESPN failure.** The decline path's
  logic is tested; the decline itself has never fired in production.
- **The two test harnesses live nowhere.** They were run in the chat sandbox and are NOT in the
  repo. Rebuild them if needed.
- **The flake rate is one sample, not a rate.** See §3.

---

## 3. First live readings — new information we did not have this morning

From `/api/edges/cfb`, `computedAt 2026-08-06T07:32:35Z` (54s after the #73 merge):

- **`sosFetch: { retries: 0, recovered: 0 }`** across 136 rated teams. One clean crawl. **The
  counters RESET on every ratings rebuild (6h TTL), so each read is one crawl, not a running
  total.** Do not quote this as a failure rate. If `recovered` is ever > 0, that is a flake the
  retry ate which would previously have silently zeroed one team's SoS.
- **`rated: 136`, `fbsListed: 146`.** Note HANDOFF-56 §4 says "138 FBS teams in 2026" and CFBD
  returned 137 SP+ rows for 2025. Three different counts from three different sources. Nobody has
  reconciled them. **Do not treat any one of them as authoritative without checking.**
- **Neutral join is ALREADY resolving**, three weeks ahead of the §7 checkpoint:
  `neutral: { dates: 7, boardGames: 95, resolved: 25, neutral: 1, unresolved: 2, ambiguous: 0,
  boardErrors: 0 }`, and TCU/UNC carries `neutralSite: true` — Dublin, correct. HANDOFF-56 warned
  `resolved: 0` was expected until Week 0; that warning is now moot for Week 1. **Rio is NOT in this
  window** (Week 1 = Aug 29–Sep 5; Week 0 = Aug 27), so `neutral: 1` here is right, not a miss. The
  `neutral: 2` expectation still applies to the Week 0 slate.
- `teamMatch.coverage: 56`, `edgeCount: 25`, all three markets unbenched.

---

## 4. 🔴 MY OWN FAILURE MODE THIS SESSION — READ THIS

**Twice I told Master G to open an endpoint without reading what that endpoint actually returns.**
Both cost a round trip and one of them wasted his time on a payload that was silent by construction.

1. **`/api/edges/cfb` for `sosFetch`** — the field was not in `ratingsMeta` because I never wired it
   there. My own omission, and I sent him to look for it anyway.
2. **`/api/edges/cfbratings`** — `edges.js:1700` hand-picks seven fields and `:1699` maps each team
   to eight. It emits **no** `sosApplied`, **no** `sosFetch`. That payload cannot answer this
   question and never could.

**THE RULE:** an endpoint's response shape is CODE. Read the route's projection before telling
anyone to open it. "The service returns X" is not the same as "the route emits X."

**Related, and worth stating separately:** I also asserted that `/api/edges/cfb` could not confirm
the deploy. It could — via `computedAt` against the merge timestamp and the Railway deploy time.
The answer was already in front of us and I reached for new endpoints instead of the timestamps I
already had.

**A UI note that cost two exchanges:** I flagged greyed placeholder text in the Claude Code composer
as a live unsent draft. HANDOFF-56 §8 correctly warns about unsent follow-ups, but **placeholder
text and a real draft look nearly identical in a screenshot.** Say "that looks like placeholder —
click into it to check" rather than raising it as a hazard.

---

## 5. Deploy verification — the method that worked, since there is no version endpoint

**There is NO endpoint that reports a build SHA.** `/api/health` (`server.js:160`) returns only
`{status, timestamp}`. Railway's UI shows a **deployment ID** (`7a517ede`), which is **not a git
object** — `git cat-file -t` on it fails.

What DOES work, and should be the standing method until a version endpoint exists:

| | merge (PDT) | Railway | first response after |
|---|---|---|---|
| #72 `52d1819` | 00:15:25 | `7a517ede` Active 00:15, logs 00:16:56–00:17:27 | `computedAt` 00:17:29 |
| #73 `d2d1e13` | 00:31:41 | — | `computedAt` 00:32:35, `sosFetch` present |

Compare `git log -1 --format=%cI` on the merge against Railway's deploy time and the response's
`computedAt`. A NEW FIELD appearing in the payload is the strongest marker — #73 gave us one, which
is why #73 also settled #72.

**Worth building sometime: add the Railway git SHA to `/api/health`.** Every deploy confirmation in
this session was inference from clocks. One field would make it a fact. Not urgent, not started.

---

## 6. Still open — football (carried from HANDOFF-56 §4, minus the one we closed)

- ~~CFB `sosApplied` hardcode~~ — **CLOSED by #72/#73.**
- **138 FBS teams in 2026** — North Dakota State and Sacramento State promoted. Neither has a 2025
  FBS rating in ESPN group 80, so both resolve unrated, and **as opponents they credit
  `CFB_FCS_LEVEL = -28`**, badly wrong for NDSU and distorting SRS for everyone who plays them. Both
  still appear in `teamMatch.unmatchedNames` on the live board. **Not fixed.**
- **CFBD ships a `nationalAverages` aggregate row inside the SP+ team list.**
  `cfbRatingBacktest.isTeamRow` drops it; any new consumer must too.
- **CFBD → ESPN name join is 61.3% (84 of 137).** Only matters if a future build needs it — the SP+
  swap is dead.
- **`/api/edges/fbseasonprobe` and `/api/edges/cfbdprobe` are TEMPORARY** and marked so in code.
  `fbseasonprobe` dies with the pinned date tables and the Labor-Day formula when the boundary is
  derived from ESPN's `types/2.startDate` (NFL `2026-09-09T07:00Z`, CFB `2026-08-22T07:00Z`).
  ⚠ **ESPN's CFB `startDate` Aug 22 is administrative, NOT first kickoff — Week 0 is Aug 27. Never
  reuse it as a "first game" signal.**
- **NFL SoS live (#57), NOT calibrated.** Zero NFL games have graded against these ratings.
  Shadow-grade in September.
- **`edges.js` carries 18 TEMP DIAGNOSTIC blocks and 13 probe/preview/backtest routes**, plus
  `getTeamPitchingStats` imported at `edgesModel.js:10` and never called, and `oddsDiag` on the
  public UFC card. **Carry as a named cleanup PR; do not let it keep growing.**
- **`backtest.js:183` still reports `current: { CFB_SIGMA: 16.0, CFB_TOTAL_SIGMA: 13.0 }`.** Live
  values are **15.5 / 16.0** — stale AND transposed. **NOT FIXED. Fix it before using that route.**

---

## 7. Standing rules — unchanged from HANDOFF-56 §5

**"When something new is built on top of something old, the old one gets DELETED in the same
cycle."** This session's 14 deletions were all intentional removals of superseded code, stated
exactly and enumerated by command before delivery. `CLAUDE.md` does NOT contain "Additive-only"
(grep 0); its nearest rule is "BUILD, DON'T JUST SUBTRACT," which does not conflict. The
additive-only rule lives in the HANDOFF chain and **§5 of 56 / this section override it.**

---

## 8. Order of work — unchanged, and still gating everything

From `CLAUDE.md`, none of steps 2–4 started:

1. **Fit γ — the gate on everything else.** γ = **−0.1433**, n=91, se 0.0856, CI [−0.311, +0.024],
   **NOT significant**, r² = 0.031. Resolution needs **n ≈ 125**, accruing +3.4/day → **~2026-08-14**.
   **⛔ NO SELECTION RULE gets proposed until this clears** — including anything about the CFB board
   weight, however tempting HANDOFF-56 §0 makes it.
2. **Fix `pinnacle_clv`** — `predictionTracker.js:267`, de-vigged Pinnacle close minus our VIGGED
   taken price. Biased low 2.2–2.4 pts. Reported −1.31% corrects to ~**+0.9%**.
3. **Add `opp_odds` at write time** — one column, unblocks correct CLV permanently.
4. **Only then touch the board.**

---

## 9. NEXT — dated

1. **~2026-08-14 — the γ re-fit.** Highest-value read on the board; governs MLB and football alike.
2. **~2026-08-15 — `totalslinebias` re-read**, windowed post-`2026-08-03 22:30 UTC` (the #60 cutoff).
3. **Week of 2026-08-24 — the Week 0 neutral read.** Dublin AND Rio must come back `neutral: 2` on
   the Week 0 slate. Week 1 already returns `neutral: 1` correctly (§3), so the matcher works — this
   is now a narrower check than HANDOFF-56 framed it.
4. **2026-08-27 — CFB Week 0.** **2026-09-09 — NFL Week 1.**
5. **NDSU / Sacramento State `CFB_FCS_LEVEL = −28` — INVESTIGATED 2026-08-06, DO NOT BUILD.**
   HANDOFF-56 §4 called this badly wrong and §9 of this document originally repeated that. Checked
   against the code and it is overstated. Three findings:
   (a) **`fbsIds` is SEASON-SCOPED** — `seasons/${season}/types/2/groups/80/teams`. The seed is 2025
   and both teams WERE FCS in 2025, so the −28 credit is the intended behaviour for that season, not
   a misclassification. The only error is granularity: NDSU is elite FCS credited at average FCS.
   (b) **The 2026 side is already handled.** `cfbEdges.js:121` has an explicit
   `// new-to-FBS team: no prior to blend` branch — once either clears `MIN_GAMES_FOR_RATING = 4` in
   the 2026 build they enter the table on their own. Until then their games run `market-only`, which
   is honest. Self-heals ~late September.
   (c) **Magnitude:** one misrated opponent in ~12 shifts a team by `SOS_WEIGHT × Δ/12 = 0.067Δ`,
   then `× RATING_REGRESSION 0.72` → `0.048Δ`. At Δ ≈ 20 that is **~1.0 rating point**, ~2.5 win-%
   raw, ~0.75 after `CFB_W_MODEL = 0.30`, landing on the **~2 FBS teams** they played in 2025.
   Inside a rating layer HANDOFF-56 §0 measured at **50.0% ATS over 2,210 games**. Not worth a cycle.
   **If a future session revisits this, it needs a measurement first** — nobody knows NDSU's
   FBS-equivalent rating, and picking one is a parameter tune without data.
6. **Fix `backtest.js:183`** stale/transposed sigma literal.
7. **Rewrite the additive-only rule in `CLAUDE.md`** (§7).
8. **Cleanup PR** for the accumulated temp diagnostics (§6).
9. Standing, unchanged: conviction is anti-predictive and customer-facing (HANDOFF-55 §6); NBA
   edge-sort bug at `edgesNba.js:152–154`; the landing page still claims NBA is live with 4 markets;
   WNBA paid-for and unbuilt; **PR #3 must never be merged.**

---

## 10. Working agreements — additions from this session

- **Read a route's projection before telling anyone to open it.** The service returning a field does
  not mean the route emits it. Violated twice tonight (§4).
- **When instrumentation is added, wire it to a surface in the SAME cycle.** #72 shipped counters
  that reached nothing; #73 existed only to finish #72.
- **Confirm deploys by timestamp** — merge `%cI` vs Railway deploy time vs response `computedAt` —
  until `/api/health` carries a SHA (§5). Railway's ID is not a commit.
- **Verify PR branch bytes off `raw.githubusercontent.com` before reporting a pass**, and re-verify
  against `main` after the merge. Done for #72 and #73; both byte-identical to the approved build.
- Carried from 56 and honoured this session: extract insert blocks from `git diff` **by command**;
  run every grep gate before publishing it; deliver prompts **INLINE**, never as an attachment;
  always give Master G the clickable PR link as a bare URL on its own line.
- Address him as **Master G**. Never mention the time, never suggest rest.
