# HANDOFF-59

**Session: 2026-08-07 evening → 2026-08-08 early. `main` started at `3f0fbe2`, ends at `007de7d`.**
**5 PRs merged (#80–#84). Zero SQL. Zero migrations. All five are customer-visible on the mobile
Edges board. Every one verified on `main` after merge, not on report.**

**Full session diff, `3f0fbe2` → `007de7d`:**
```
  4   0  backend/routes/edges.js
 24   0  backend/services/edgesModel.js
 55  14  frontend/src/pages/Home.jsx
```
**83 added, 14 deleted, 3 files.**

**This document supersedes HANDOFF-58.** Everything 58 carried that is still open is reproduced
here. Read `CLAUDE.md` first regardless.

---

## 0. 🔴 THE HEADLINE: THE BOARD HAD TWO RANKINGS AND SHOWED BOTH

The mobile Edges hero and the list beneath it were selected by **different rules**, so the screen
could — and did — contradict itself in front of paying subscribers.

Observed live 2026-08-06: the hero read **"TOP PLAY" over SF ML at 50.5%** while the list directly
below it led with **SD +1.5 at 66%**. The thing labelled "top" was the weakest number on screen.

The two pipelines:
- **Hero (old):** `wvItems` — moneyline ONLY, filtered `modelProb >= 0.50`, sorted by **edge**. Any
  coin flip with a positive edge could be crowned.
- **List:** `boardItems` = `bestPerGame(boardSrc.map(toBoard))` — one row per game, sorted
  **model% desc, then edge**, rendered by the `BoardCardCompact` / `BoardRow` map.

**Now: `heroItems = boardItems.length ? [boardItems[0]] : []`.** The hero is literally row one of
the list the user scrolls. They cannot disagree, by construction.

### ⚠ THE TRAP THAT COST A ROUND TRIP — do not repeat it
PR #80 first pointed the hero at **`pool[0]`** (line ~281). `pool` is a THIRD pipeline, sorted by
**conviction tier → conviction score → edge**. It is what the DESKTOP board uses and what
`topHeroes` reads. Pointing the mobile hero at it removed the coin-flip case but did **not**
guarantee the hero matched the list — they still agreed only by coincidence. PR #81 corrected it to
`boardItems[0]`.
**There are three ranked collections in `Home.jsx`: `pool`, `boardItems`, and `heroItems`. Before
touching any of them, trace which one the render map at the `ufboard top` line actually consumes.**

---

## 1. What shipped

| PR | Token | What it does | HEAD after |
|----|-------|--------------|------------|
| #80 | `WZ-HERORANK-2026-08-07` | hero off the edge-sorted ML pool; eyebrow made honest | `a14d5f4` |
| #81 | `WZ-HEROMIRROR-2026-08-07` | hero = `boardItems[0]`, the list's actual row one | `be21dd0` |
| #82 | `WZ-BOARDROWS-2026-08-07` | list starts at #2, rank numerals, inline read line | `cd5efed` |
| #83 | `WZ-BOARDCOPY-2026-08-07` | "EDGE" everywhere; band reads TONIGHT'S CARD | `357624a` |
| #84 | `WZ-RLREASON-2026-08-08` | run-line reads written in the backend | `007de7d` |

**#80** deleted `wvItems` / `wvKeys` / `evItems` (their only consumer was `heroItems`; leaving them
would keep a second contradicting ranking alive) and collapsed the eyebrow to
`TONIGHT'S / TOMORROW'S BEST NUMBER`. Single card, no swipe.

**#82** three changes: `boardItems.slice(1)` so the hero's play is not printed twice; a rank numeral
(`i+2`, because the list is sliced); and the read's **first line shown inline** instead of hiding
entirely behind the `WHY THIS PICK` tap.
⚠ **`className="ufboard top"` appears on THREE lines** — the board (`boardItems.map`), the tomorrow
preview (`previewItems.map`), and the "No winners on the board yet" empty state. The prompt claimed
one. Claude Code checked, anchored on the full `boardItems.map` line, and left the other two alone.
Had it trusted the prompt, **tomorrow's preview would have silently lost a row.**

**#83** text only: hero pill said `+0.6% VALUE` while list rows said `+0.9% EDGE` — same quantity,
two words, one screen. Now EDGE everywhere. Band renamed `TopPicks` → `TONIGHT'S CARD` (two-tone
`.bhwize` preserved: TONIGHT'S white, CARD gold).

**#84** — the only backend change. See §2.

---

## 2. Run-line reads — and the thing that must be said with them

`reason` was written in exactly THREE places in `edges.js`: moneyline (~676), totals over (~705),
totals under (~729). **Run line had none**, so every run-line row fell back to the bare
`WHY THIS PICK` label with nothing behind it. On a run-line-heavy MLB card that is most of the board,
which is why the redesign "looked like nothing changed" on first inspection.

`describeRunLine` now sits beside `describeMoneyline` in `edgesModel.js`. It is **deliberately
narrower**: `describeMoneyline` cites ERA and OPS because the ML model consumes them; the run-line
model has no starter/bats channel, so the read states only cover %, the market's implied %, the
line, and the price. Market % uses the SAME derivation as moneyline (`mlMarket`, ~1771):
**model − edge**. Purely additive — **0 deletions across both files**.

### 🔴 RUN LINE IS THE WEAKEST MARKET ON THE BOARD
Recorded here because #84 makes it more persuasive without making it more correct.
- `calibrationGuard` **manually benched** run line on 2026-07-17: its confident 0.55+ range hit
  **exactly 50% on n=94** while the board claimed 58–63%.
- It was later **released** (`shadowWatch.run_line`, n=274, gapPts −1.1) and is live now.
- Season record: **78–78, 50.0%, −12.98u, ROI −8.3%** on n=156.
- **Calibration is not edge.** Run line is honest about its probabilities and still loses to the
  vig. Nothing in the guard will ever catch that, because catching it is not what the guard is for.
- 78–78 at n=156 is **not decisive** (break-even ~52.4%, SE ~4 pts). It is losing but not yet
  distinguishable from noise. **Do not bench on this alone; do not defend it either.**

---

## 3. Live readings

- **MLB season (n=583):** 309–274, 53.0%, **−15.73u, ROI −2.7%**.
  By market: **moneyline 129–85, 60.3%, +14.23u, +6.6%** — carrying the entire product.
  Total 102–111, 47.9%, −16.98u, −8.0%. Run line 78–78, 50.0%, −12.98u, −8.3%.
  Last 7D: 58–32, **+13.7% ROI**, +12.31u on n=90. 30D: −2.1%.
- **Totals: `benched: true, manual: true`** — the guard CANNOT auto-release it. ⚠ But
  `shadowWatch.total` reads **n=53 against needN 80, gapPts 5.6 against needGapUnder 4**. If both
  conditions clear, a zero-signal market returns to the customer board. **Re-check before n=80.**
- **Pinnacle CLV reads −0.65%** (`beatClosePct 35.0`) — the known biased-low bug at
  `predictionTracker.js:267`. True figure materially better. Still not fixed.
- **NFL model record 3–0** from the Hall of Fame game (all three core markets correct). The two
  `*_shadow` "loss" rows are **fixed-side mirrors by construction** — same calls inverted, not
  second opinions. Do not read them as misses.

---

## 4. 🔴 THE GREP-GATE TRAP — THREE TIMES IN ONE SESSION

Every one of #80, #82 and #83's predecessors tripped a gate that was **mis-specified by me, not
broken in the code**. In each case the new comment QUOTES the identifier being removed, so an
unscoped `grep -c` counts the prose.

- #80: `grep -c '_wv'` → 1, expected 0. The hit was the comment explaining `_wv` was gone.
- #82: `ufrank` / `ufwhy` → 3 each, expected 2. Third hit was my own CSS comment naming both.
- ⚠ **`grep -v '^\s*//'` DOES NOT SAVE YOU** — those comments were `{/* */}` JSX and `/* */` CSS
  blocks, not `//` lines.

**THE RULE, and it is not "scope harder":**
> **Gate on the thing that REPLACED the old code, never on the thing that was removed.**
> `grep -c 'const heroItems = boardItems' → 1` is unambiguous. `grep -c 'toBoard(hero)' → 0` is
> only safe because no comment mentions it.

Also: **`for (const r of rows) {` appears 15 times in `performance.js`.** A gate counting a generic
line is meaningless. Anchor on something unique to the block.

---

## 5. My own failure mode this session

**I built #80 on an assumption I did not trace.** I read `hero = pool[0]` at line 281 and assumed
`pool` fed the visible list. It does not — line ~699 renders `boardItems`. The PR shipped, was
merged, and #81 existed only to correct it. This is the same shape as HANDOFF-58 §4(c): reading a
service and not reading what actually consumes it.
**The rule I am now held to: trace the consumer, not just the producer, before writing a prompt.**

Also caught and fixed before shipping: I ran `esbuild --loader=jsx` on a file path (which errors),
piped it through `tail`, and printed "JSX OK" — **a false pass in my own gate.** Check exit codes.
Every validator this session was proven with a negative control (feed it broken input, confirm
non-zero) before being trusted.

---

## 6. Claude Code — what worked

Three catches that prevented real damage, all from it verifying a claim in my prompt rather than
trusting it:
1. The **three `ufboard top` lines** (§1) — would have broken tomorrow's preview.
2. **`d.why` existence** confirmed (`why: x.reason` in `toBoard`, passed as `baseRead`) before
   shipping a strip that depends on it.
3. **`describeRunLine` rendered on five inputs** — dog/favorite lines, missing line, null cover,
   missing price — confirming the text is grammatical and degrades to the old label rather than
   printing `undefined` on a customer's screen.

Process: **"CREATE THE BRANCH FIRST" in every prompt works.** The branch-order slip that recurred
three times in HANDOFF-58 did not recur once it was stated explicitly.

⚠ **GitHub merge box is invisible when signed out.** A Safari tab lost its session and the PR page
simply had no merge button — it reads as a broken PR. Bottom of the page will say "Sign in to
comment". Check that before diagnosing anything else.

---

## 7. Order of work — unchanged, still gating everything

1. **Fit γ.** −0.1433, n=91, se 0.0856, CI [−0.311, +0.024], **not significant**, r² 0.031.
   Needs n≈125 → **~2026-08-14**. ⛔ **NO SELECTION RULE until it clears.**
2. **Fix `pinnacle_clv`** — `predictionTracker.js:267`. Biased low 2.2–2.4 pts.
3. **Add `opp_odds` at write time.**
4. **Only then touch the board.** (This session touched presentation only; no selection logic moved.)

---

## 8. NEXT — dated

1. **~2026-08-09/10 — preseason lines post.** Both football boards refill on their own; the
   Preseason tab returns without a deploy (it is driven by `phase.available`, `Home.jsx:634`).
   Verify `boardHorizon.published` flips to `true`.
2. **~2026-08-14 — the γ re-fit.**
3. **~2026-08-15 — `totalslinebias` re-read**, windowed post-`2026-08-03 22:30 UTC`.
4. **Before `shadowWatch.total` hits n=80 — re-check the totals auto-release risk** (§3). This is the
   only open item that can change what customers see with nobody deciding to.
5. **Week of 2026-08-24 — Week 0 neutral read.** Dublin AND Rio must return `neutral: 2`.
6. **2026-08-27 CFB Week 0. 2026-09-09 NFL Week 1.**
7. **Football empty-state message — NOT built.** `boardHorizon` carries `reason`, `nextGameISO`,
   `daysOut` and **no frontend reads it**; an empty football board currently shows nothing at all.
   Pattern to copy: the MLB All-Star-break block at `Home.jsx:32-45`.
8. **Fix `backtest.js:183`** — reports `CFB_SIGMA 16.0 / CFB_TOTAL_SIGMA 13.0`; live is **15.5 /
   16.0**. Stale AND transposed.
9. **Rewrite the additive-only rule in `CLAUDE.md`.**
10. **Cleanup PR** — 18 TEMP DIAGNOSTIC blocks and 13 probe routes in `edges.js`;
    `getTeamPitchingStats` imported at `edgesModel.js:10` and never called; `oddsDiag` on the public
    UFC card.
11. **NDSU / Sacramento State `CFB_FCS_LEVEL`** — investigated 2026-08-06, **DO NOT BUILD**
    (HANDOFF-57 §9 item 5).
12. **Add the Railway git SHA to `/api/health`.** Every deploy confirmation is still inference from
    clocks. Railway's UI shows a **deployment ID, not a commit** — `git cat-file -t` on it fails.
13. Standing: conviction is anti-predictive and customer-facing (HANDOFF-55 §6); NBA edge-sort bug
    `edgesNba.js:152–154`; landing page still claims NBA live with 4 markets; WNBA paid and unbuilt;
    **PR #3 must never be merged.**

---

## 9. Working agreements

- **Gate on what replaced the old code, not on what was removed.** §4.
- **Trace the CONSUMER, not just the producer**, before writing a prompt. §5.
- **Validators: check exit codes, prove with a negative control.**
- **"CREATE THE BRANCH FIRST" in every Claude Code prompt.**
- **UI work: mock first** — phone-width standalone HTML, numbered options, Master G picks by number.
  Followed for the board redesign; three rounds before any code.
- **Frontend deploys via Vercel** (slower than Railway, hard refresh required, and a **branch preview
  cannot load production data** — verify on production). **Backend deploys via Railway.**
- **Verify PR branch bytes off `raw.githubusercontent.com` before reporting a pass**, and re-verify
  against `main` after the merge. Done for all five PRs; all byte-identical.
- **State deletions exactly and enumerate them.** #84 was 0; #82 was 5; #80 was 7.
- Address him as **Master G**. Never mention the time, never suggest rest.
