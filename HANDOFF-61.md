# HANDOFF-61

**Session:** 2026-08-15 (UFC 330 fight night)
**Predecessor:** HANDOFF-60
**Read `CLAUDE.md` first regardless. Verify every claim in this document against live bytes before acting on it.**

---

## 0. One-line summary

The UFC main event was unpriced on a title fight night and is fixed; three read-only windows of the UFC record now exist, and they show that **positive `edge_pct` did not survive out-of-sample while the `is_value` flag did** — on 12 rows, which is not enough to act on yet.

---

## 1. What shipped

All three merged and re-verified byte-identical against `main` by SHA-256 after merge.

| PR | Branch | What | Post-merge SHA-256 |
|---|---|---|---|
| #91 | `wz-ufcjoin-mainevent-2026-08-15` | UFC odds name-join mirror fix + false pending-string fix | `ufc.js` `b7d803d1…c6fc1` · `UFC.jsx` `8c89b255…82149` |
| #92 | `wz-ufcedgesplit-2026-08-15` | New read-only `/api/ufcsplit` — settled UFC record split by sign of `edge_pct` | `ufcSplit.js` `d8fe7d9e…d4166` · `server.js` `5b0b5550…4f2705` |
| #93 | `wz-ufcsplit-window-2026-08-15` | `graded_before` / `graded_after` windowing on `/api/ufcsplit` | `ufcSplit.js` `a11ed58c…056e5` |

**PR #90 (handoff PR) was opened and NOT merged during this session.** Status unverified at write time — check it.

### 1.1 The main-event join defect (#91)

`GET /api/ufc/card` returned bout `12910` — Makhachev vs Ian Machado Garry, welterweight title, **the main event** — with `pick: null`, `winPct: null`, `odds: null`, on the day of the card.

It was **not** missing odds. The book had both men priced. Root cause, traced not assumed:

- The book posts him **short**: `"ian garry"`. `oddsDiag.mapSample` contained `"ian garry"` and `"iangarry"` and did **not** contain `"ian machado garry"`.
- Cito holds him **long**: `"ian machado garry"`.
- `nameAliases` (`backend/routes/ufc.js:70`) widens the **book** side by dropping *leading* tokens (`t.slice(-2)`), so a long book name can reach a short one. `lookupOdds` (`:196`) tried only name, slug, and both de-spaced forms — **it never dropped a middle token**. When the book name is the short one, no path existed.
- `WZ-UFCALIAS-2026-08-03` fixed one direction and left the mirror image open.

Fix: a separate `reducedMap` inside `getOddsMap` indexing real keys under `first + " " + last`, with the same drop-if-contested discipline as `aliasClaims`, consulted **last** in `lookupOdds`. `reducedMap` is a property on the returned map, never an entry in it, so no real key is shadowed and all three `getOddsMap` callers keep working.

**Live proof after deploy:** bout `12910` returned Makhachev **−330** / Machado Garry **+280**, pick Makhachev, 73% model vs 74% market. `oddsDiag.unresolved` went from two entries to **empty**. All 12 bouts priced.

### 1.2 The false customer-facing string (#91)

`frontend/src/pages/UFC.jsx:323` printed **"ODDS PENDING — no line posted yet"** on the main event while the line sat in our own odds map, and would have flipped post-fight to **"NO PICK — no line was posted before this fight"**, writing the false claim into the permanent record.

Both strings assert a fact about **the book**. The code only knows a fact about **our pipeline**. Same class as the CFB "vs preseason lines" hardcode in `CLAUDE.md`. Replaced with `"ODDS PENDING"` (no causal clause) and `"NO PICK — this fight was not priced"`, which are true regardless of whose side failed.

---

## 2. What was measured — three windows

`/api/ufcsplit`. SELECT-only. ROI at the **real posted price** via `priceMath.payout`; there is no `-110` anywhere in the file (grepped, zero occurrences). Pushes excluded from win rate and ROI and counted separately. Both window bounds exclusive.

### 2.1 Clean baseline — `?graded_before=2026-08-16T01:00:04.692Z`

41 settled rows · 4 events (`ufc-329`, `ufc-fight-night-july-25-2026`, `ufc-fight-night-august-01-2026`, `ufc-fight-night-august-08-2026`) · `graded_at` 2026-07-12 → 2026-08-09. **Zero UFC 330 rows.**

| Bucket | n | W-L-P | Win % | ROI % | Units | Mean edge | Mean break-even | Mean model EV units |
|---|---|---|---|---|---|---|---|---|
| Positive | 25 | 22-2-1 | 91.7 | +25.4 | +6.09 | +3.32 | 73.83 | 0.00 |
| Negative | 12 | 10-2-0 | 83.3 | +15.7 | +1.89 | −1.17 | 72.66 | −0.07 |
| Zero | 4 | 3-1-0 | 75.0 | +12.0 | +0.48 | 0 | 68.05 | −0.04 |
| `is_value` true | 10 | 9-1-0 | 90.0 | **+30.7** | +3.07 | +5.20 | **69.35** | **+0.02** |

### 2.2 UFC 330 alone, out-of-sample — `?graded_after=2026-08-15T12:00:00Z`

12 settled rows · 1 event (`ufc-330`) · `graded_at` 2026-08-16 01:00:04 → 04:30:31. Full card. **Card went 6-6, net −3.53 units.**

| Bucket | n | W-L-P | Win % | ROI % | Units | Mean edge | Mean break-even | Mean model EV units |
|---|---|---|---|---|---|---|---|---|
| Positive | 9 | 3-6-0 | 33.3 | **−52.0** | −4.68 | +2.22 | 70.70 | −0.01 |
| Negative | 3 | 3-0-0 | 100 | +38.3 | +1.15 | −2.00 | 72.59 | −0.06 |
| Zero | 0 | — | null | null | 0 | null | null | null |
| `is_value` true | 2 | 2-0-0 | 100 | **+59.1** | +1.18 | +4.50 | **64.61** | **+0.03** |

### 2.3 Contaminated read — SUPERSEDED, DO NOT CITE

An unfiltered read taken 2026-08-15 ~21:27 PT returned `settledN: 52` with `gradedAtMax: 2026-08-16T03:30:22.411Z` and `ufc-330` in `eventSlugs` — baseline **plus 11 of 12** UFC 330 rows, mixed. Its figures (positive n=34 · 75.8% · +4.3%; negative n=14 · 85.7% · +19.5%; `is_value` n=12 · 91.7% · +35.4%) are neither the baseline nor the out-of-sample read and must not be quoted as either.

Internal consistency check that confirms the windowing works: 41 baseline + 11 partial-330 = 52, and the 12th 330 row graded at 04:30:31, after that read was taken.

---

## 3. What this means

**Positive `edge_pct` is an in-sample artifact.** 22-2 in the baseline, **3-6** out-of-sample. Same shape as the top-50-by-edge result already recorded in `CLAUDE.md` — 68% looking backward, 51.7% frozen. A 91.7% win rate on picks with a mean break-even of 73.83 was never going to repeat; that is heavy favorites holding, not edge being captured.

**`meanModelEvUnits` is the tell.** By the model's own arithmetic the positive bucket has **0.00** EV at the price paid in the baseline and **−0.01** out-of-sample. Negative bucket: −0.07 and −0.06. Zero bucket: −0.04. Every bucket except one is at or below zero EV in **both** windows. The realized profit in the baseline was favorites holding.

**`is_value` is the only signal that survived.** 9-1 (+30.7%) baseline, 2-0 (+59.1%) out-of-sample, **11-1 across both**. It is the only bucket with **positive** `meanModelEvUnits` in both windows (+0.02, +0.03), and it runs at a materially cheaper mean break-even (69.35, 64.61) than positive-edge (73.83, 70.70).

**Sharpest single observation:** `is_value` rows are a **subset** of positive-edge rows. On UFC 330, split the positive bucket by the value flag and it is **2-0 for value-flagged, 1-6 for the rest**. Same bucket, same night. The flag separated the winners from the losers inside the exact set the edge sign called good.

**The limit, stated plainly:** `is_value` is **12 rows total** across both windows. Eleven wins, one loss. That is not enough to change selection on, and the negative bucket's 3-0 on UFC 330 is noise that does **not** confirm the baseline's +15.7%. What the evidence does support is dropping the assumption that positive `edge_pct` is the quality signal.

**No selection change was made and none should be made off this read.** Per HANDOFF-60 §8 the reconstruction defect and `pinnacle_clv` bias still gate everything, and γ is fit on `edge`.

---

## 4. Verified corrections to standing documents

Checked against live bytes this session, not inherited.

- **`CLAUDE.md:151` and `:161`** still list `opp_odds` as a blocker and as ORDER OF WORK step 3. It **shipped 2026-07-24 in `99631a9`**. Stale.
- **`CLAUDE.md:169`** states `TOTAL_SD = 4.0` at `edgesModel.js:1649`. Live value is **6.0** at **`:1688`** (PR #89). Stale.
- **`LIVE_DIVISOR` and `SD0` appear nowhere in `CLAUDE.md`** — grep returns zero. A cleanup pass would "correct" them and destroy the grid's back-out anchor. The warning still needs writing.
- **The "additive-only rule" HANDOFF-60 says to rewrite is not in `CLAUDE.md`.** Nearest is line 34, *BUILD, DON'T JUST SUBTRACT*, which concerns recommendations, not code, and does not conflict with the 2026-08-03 delete-the-old rule. That open item needs **restating, not executing**.
- **`CLAUDE.md` ORDER OF WORK (γ first) is superseded** by HANDOFF-60 §8.
- **`backtest.js:183`** reports `current: { CFB_SIGMA: 16.0, CFB_TOTAL_SIGMA: 13.0 }`. Live values in `cfbModel.js` are **`CFB_SIGMA = 15.5`** (`:27`) and **`CFB_TOTAL_SIGMA = 16.0`** (`:35`). **Stale AND transposed** — HANDOFF-60 was right on both counts. Any CFB calibration read taken before this is fixed is garbage. Both constants are already exported at `cfbModel.js:273`; the root fix is to import, not retype.

---

## 5. Open, carried forward

Priority order unchanged from HANDOFF-60 §8 except where noted.

1. **Reconstruction defect on ~404 published MLB rows (~23.9%)** — blocks `pinnacle_clv` fix and γ re-fit.
2. **`pinnacle_clv` bias at predicted values** — queued behind 1.
3. **γ re-fit** — queued behind 1 and 2; gates all selection rule changes.
4. **Totals overclaim root cause** — ≥0.55 confident band, gap ~5.2 vs `GAP_UNBENCH` 4. Totals still manually benched.
5. **`backtest.js:183` CFB sigma** — dated: must land before CFB Week 0, **2026-08-27**.

New this session:

6. **`oddsDiag` on the public UFC card** (`ufc.js:524`) — the in-code comment says delete once the join is settled. The join is now settled. It leaks nothing sensitive (fighter names and normalized keys only) and it was the instrument that diagnosed tonight's failure. **Safe to remove now; was correctly kept through the card.**
7. **`/api/health` returns no git SHA** (`server.js:158`) — still cannot confirm production is running `main`. HANDOFF-60 §3 blocking item, unresolved.
8. **`getOddsMap` caches an empty map for the full TTL** on the `!ODDS_API_KEY` early return. Pre-existing, not introduced by #91.
9. **`is_value` needs sample.** Re-run both windows after each UFC card and watch the count. This is a standing measurement, not a code change.

Unchanged backlog: WNBA (feed paid, zero implementation), temporary diagnostic route cleanup, NDSU/Sacramento State FBS promotion, desktop sidebar unification (three implementations), CFB `sosApplied` hardcode.

Dated triggers: first neutral-site read **2026-08-24** · CFB Week 0 **2026-08-27** · NFL Week 1 **2026-09-09**.

---

## 6. Claude's error log — this session

1. **Handed over a URL verified in code, not against a live response.** `/api/ufc/card` was traced and confirmed to exist, and I reported it as ready. It hung for tens of seconds on a cold cache (three sequential 12s outbound calls) and Master G hit a blank tab. *Route exists ≠ route answers.* Producer verified, consumer not.
2. **Designed a baseline instrument with no way to specify its own window.** I called for the edge-sign split to be taken "before the card grades" and built it with **no time bound at all**, relying on when the read happened to be run. It was run at ~21:27 PT, after UFC 330 had begun grading, and came back contaminated. The out-of-sample test was lost and cost PR #93 to recover retroactively. The bound belonged in the original prompt. **A measurement that depends on when someone clicks is not a measurement.**
3. **Described a fix instead of delivering the requested prompt**, then had the prompt fail to render, costing two resends and Master G's time on a fight-night deadline. When the deliverable is a prompt, the prompt is the whole response.

Errors documented in HANDOFF-60 that did **not** recur: no claim made without checking data first; deletion counts taken from `git diff --numstat` and **corrected my estimates in both directions** (I said 0 for `ufc.js`, real was 2; I said 2 for `UFC.jsx`, real was 1); branch bytes verified off `raw.githubusercontent.com` before every pass and `main` re-verified by SHA after every merge.

---

## 7. Next action

**`backtest.js:183`** — stale and transposed CFB sigmas, verified live this session, gated on CFB Week 0 on **2026-08-27**. Root fix is to import the already-exported constants from `cfbModel.js:273`, not to retype corrected literals. Everything above it in the priority list is blocked behind the reconstruction defect, which is unchanged from HANDOFF-60.
