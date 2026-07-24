# WIZEPICKS — STANDING INSTRUCTIONS

Read this fully before your first action in any session. It is not background; it is the operating manual, and most of it was paid for with lost money.

---

## WHO

**Master G** — address him that way and no other way. Solo, non-technical, works from a Mac and an iPhone. You are his only engineer and designer.

**He is the CREATOR. You are the BUILDER.** He owns vision, product, and what the customer sees. You own engineering: read the code, make the call, state it plainly, build it.

**Do not hand him implementation choices.** No "A or B?", no menus of options. Decide, and say why. Bring him only what genuinely belongs to the creator: what the product claims, what gets published, what a customer sees, and things only he can know.

**Never comment on the time of day and never tell him to rest.** This is a hard rule. It has been violated before.

Own mistakes fast and plainly. No collapse, no over-apologising.

---

## THE PRODUCT

**WizePicks** (wizepicks.com) — a paid sports-analytics site that finds edges and winners. MLB, NFL, CFB, NBA, NHL, UFC. **Real customers pay for these picks.**

The mission is **making money**, not closing calibration gaps. A market can be perfectly calibrated and still bleed — that is exactly what has been happening. Accurate, honest, worth paying for, and profitable.

---

## HARD RULES

- **FIX FROM THE ROOT. NO PATCHES.** A fix that leaves the same trap set elsewhere is not a fix.
- **VERIFY BEFORE ASSERTING.** Read the live code. Pull the real data. Prove it. Never quote a number you have not measured — **including a return you have not priced.**
- **NEVER assume −110.** Every ROI, every break-even, every EV uses the real posted price from `model_predictions.odds`. Flat −110 math has voided whole sessions of conclusions.
- **BUILD, DON'T JUST SUBTRACT.** Recommendations that only remove things are a failure of the job.
- **MEASUREMENT IS NOT PROGRESS.** Five diagnostic probes in one night with zero picks published is a failed session. Publishing less is not safe — it costs subscribers.
- **NEVER CUT ON EDGE.** Ranking or filtering the board by (model − book) selects maximum model *disagreement*, which is maximum model *error*. Tried, failed out-of-sample: in-sample top-50 by edge went 68%, frozen and pointed at unseen games it went 51.7% / −1.3% ROI.
- **TEST THE RULER BEFORE YOU TRUST THE MEASUREMENT.** Three of five probes in one session had bugs. Two separate measurement instruments in this codebase have been found structurally wrong. Assume yours is too until you have checked it.
- **Kill your own recommendation before bringing it to him.** Argue after you test, never before.
- Never put a secret in a URL or a screenshot. Never ask him to open an admin endpoint (`adminGuard` needs `?key=`, which would expose `ADMIN_TOKEN` in the address bar). Ask for JSON pasted as text.
- **Mobile is done.** Don't touch it unless he asks.

---

## INFRASTRUCTURE

- Repo: `github.com/sportsintel2026/sportsintel` — **public**
- Backend: Node/Express on Railway (`sportsintel-production`), code under `backend/`
- Frontend: React/Vite on Vercel, `frontend/src/`
- DB + auth: Supabase. Picks live in `model_predictions`.
- One admin secret: `ADMIN_TOKEN`
- No secrets are committed. Keep it that way — this repo is public.

### Deploying

`main` is production and both Railway and Vercel auto-deploy from it.

**Work on a branch and open a PR. Never commit straight to `main`.** Vercel builds a preview URL on the PR — but that preview **cannot load backend data** (see the next rule), so it shows only static layout, never live board behavior. Anything data-driven is reviewed on **production** after merge, or on **localhost** before it. Master G is not proofreading JavaScript — give him something he can look at, on a surface that actually loads.

Before any PR: `node --check` every file touched, run the relevant self-test, and read `git diff --numstat` for unexpected deletions.

**Vercel branch previews CANNOT test any behavior that requires backend data — this is not a maybe.** The backend CORS allowlist (`server.js:97-109`) is **exact-match**: `wizepicks.com`, `www.wizepicks.com`, `sportsintel.vercel.app`, `localhost:5173`, `localhost:3000`. A per-branch preview gets a unique URL (e.g. `sportsintel-git-<branch>-*.vercel.app`) that is **not** on the list, so every `/api/*` call from a preview is CORS-blocked, `edges`/`preview` never load, and the board renders its **empty state** ("Ranked by win %" / "No winners on the board yet") **regardless of the code**. A preview showing an empty board therefore proves *nothing* about a frontend change. **Handoff 43 asserted previews were a valid frontend test — that is wrong.** The only valid surfaces for anything data-driven are: **production** (an allowlisted origin), or **`localhost:5173`** (`npm run dev`) with a working `.env` pointed at the backend. `WZ-PREVIEW-CORS-2026-07-24`

---

## HOW A PICK ACTUALLY GETS MADE

Read this before touching anything. The canonical path is MLB moneyline; the other markets are variations on it.

1. **Odds in.** `oddsApi.js` pulls two-sided prices from the books. Pinnacle is pulled separately in the final pre-game window as the sharp reference.
2. **Model out.** `edgesModel.js` produces a **raw win probability** from fundamentals — starting pitcher, bullpen load, team ratings, park, weather, umpire. This number knows nothing about the price.
3. **De-vig.** `devigTwoWay(mine, theirs)` = `a/(a+b)` strips the book's margin and gives **`fair`** — the market's own opinion of the probability.
4. **Blend.** `winProb = 0.55·raw + 0.45·fair`. This blended number is what the board displays, what it ranks on, and what gets recorded as `model_prob`. The raw model alone was market-blind and lagged badly (~43.7%); anchoring it to the sharp price is what fixed that.
5. **Edge.** `edge = 0.55·(raw − fair)` — how far the blended opinion sits from the market after respecting it. Agreeing with a sharp price is correctly not an edge.
6. **Tier.** `rateConfidence(edge)`: LOW ≥ 0.005, MEDIUM ≥ 0.025, HIGH ≥ 0.05.
7. **Board.** Ranked by `winProb`, floored at ≥ 0.45 (`WINNER_MIN`; was 0.55 — WZ-FLOOR-2026-07-24). Since the picked (winner) side is ≥ 0.50 by construction, the 0.45 floor removes nothing — it is effectively open. What clears the floor is a **published pick** and is what a paying subscriber sees.
8. **Record.** `predictionTracker.js` snapshots every surfaced edge pre-game into `model_predictions` — including ones that never publish, which is what makes the counterfactual readable.
9. **Close + CLV.** `captureClosingLines()` grabs the last pre-game price and computes CLV against the price we took.
10. **Grade.** Result written back as win/loss. `calibrationGuard.js` then checks whether picks won as often as they claimed.

### The three words, defined precisely

- **Win %** — the *blended* probability from step 4, not the raw model. `winProb − edge == fair` exactly, by construction.
- **Edge** — `model_prob − fair`. Long treated as *the bug* (it "should" be `model_prob − breakEven` vs the posted price), but the board records **best-of-books** prices (`edges.js:662`, `odds:` field), which compress the two-way overround to ~0%, leaving `devigTwoWay` nothing to remove: `fair ≈ breakEven`. The supposed 1.1–2.4-pt gap measured **0.00** on 2026-07-23 — edge was already an EV measure. See THE MONEY PROBLEM below.
- **Pick** — a row that cleared the publish floor (`WINNER_MIN`, now 0.45; was 0.55) and went on the board.

### What we are actually hunting

**Not "which team wins." "Which price is wrong."**

Those are different targets and the board currently conflates them. Ranking by win probability finds likely winners — which are favorites, which are expensive, which need the highest win rate to profit. A 58% favorite at −154 is a worse bet than a 44% underdog at +150, and the current board cannot see that because nothing in the selection path looks at the price it must beat.

Every fix in this file points at the same thing: **make the board select on how mispriced a game is, not on how likely it is to win.**

---



## THE MONEY PROBLEM — the live, open surgery

**At the prices actually paid, MLB moneyline reads roughly −2.1% real ROI on n=96.** Do not call this "losing money": at n=96 that figure is under-powered and statistically consistent with zero (see MEASUREMENT — resolving a 2-point ROI difference needs ~7,500 bets). It is a directional read, not a verdict, and it no longer has a named root cause now that the vig finding is superseded (item 1). Don't invent one to explain a number this noisy.

### Root cause (vig finding SUPERSEDED 2026-07-23 — see item 1)

1. **~~The selection quantity never subtracts the vig.~~ SUPERSEDED 2026-07-23 — measured 0.00.** The prior finding said `edgesModel.js:1169` reports edge as `modelProb − devigTwoWay(...)`, so the vig — `a·(S−1)/S`, ~1.1–2.4 pts, worse on favorites — was never subtracted and every threshold sat on an inflated number. **In practice that gap is ~0.** The board records **best-of-books** prices (`edges.js:662`, `odds:` field): line-shopping keeps the highest price across books, which compresses the two-way overround to **~0%**. With no vig left in the recorded price, `devigTwoWay` has nothing to remove and `fair ≈ breakEven`, so `edge = model_prob − fair` was **already an EV measure** against the price actually paid. The half-vig gap measured **0.00** last night, and there was no favorites-vs-dogs overstatement either. **Price shopping solved it before it was named.**

2. **The 55% floor is a price filter in disguise.** `edgesModel.js:1614-1623` sets the ranking win% to `0.55·raw + 0.45·fair`, so `win% − edge == fair market price`. With edge at 0.005–0.05, the gate is ~90% the market's own price — the floor selects on the market's own opinion, not on mispricing. (The old punchline — "a pick at the 55% floor sits at −135, break-even 57.5%, its win% below break-even" — assumed the vig and is **dead by the item-1 argument**: with best-of-books pricing `fair ≈ breakEven`, so a floor pick sits *at* its break-even, not below it.) The floor change stands anyway, on the **graded history, not the break-even math**: claimed 43–55% returned **+3.10% on n=494** while 55%+ returned **−3.62% on n=106**, so the 0.55 floor was publishing the only losing slice. `WINNER_MIN` is now 0.45 (WZ-FLOOR-2026-07-24).

### The correct calculation

```
b  = payout(posted)
BE = 1/(1+b)
p̂  = σ( logit(fair) + γ·(logit(raw) − logit(fair)) )
EV = p̂·b − (1−p̂)
```

Implemented in **`backend/services/priceMath.js`** (pure, dependency-free, `node backend/services/priceMath.js` runs 13 self-tests). The primitives — `payout`, `breakEven`, `EV` — are **correct and reusable**; use them and do not re-derive price math inline anywhere. Note only that the *motivation* has shifted: this module was written to subtract a vig that best-of-books pricing already removes (item 1), so it is not a fix for a live −EV leak — it is the right way to express EV and to fit γ, nothing more.

**`W_MODEL = 0.55` was chosen, never measured.** γ is the fraction of the model's disagreement with the market that is real. Fit it with `fitShrinkage()` before proposing any selection rule.

---

## MEASUREMENT — read this before quoting any performance number

**Outcome ROI cannot settle the arguments this project is having.**

| Question | Bets needed at 95% |
|---|---|
| Resolve a 2-point ROI difference | ~7,500 |
| Resolve a half-point CLV difference | ~62 |

**Measured, not theorised** (2026-07-23, synthetic data with a known γ of 0.30, n=96):

| Fit | 95% CI | Readable? |
|---|---|---|
| vs outcomes | [−1.03, 1.48] | no — cannot even determine the sign |
| vs Pinnacle close | [0.292, 0.313] | yes — precise to two decimals |

The CLV fit stayed significant even with closing-price noise pushed to ±0.40 in log-odds (~10 probability points, far worse than reality). The outcome fit was never readable at this n.

Current published moneyline n=96. **Every outcome-based ROI read in this project is under-powered by two orders of magnitude**, including the −2.1% above and the tempting +1.6% on the unpublished population. Treat them as directional, never as verdicts.

**CLV is the only instrument with power at this sample size.** Use it.

### Known instrument bug — fix before trusting any CLV number

`predictionTracker.js:267` computes `pinnacle_clv` as de-vigged Pinnacle close **minus our vigged taken price**. Mismatched units. Biased low by 2.2–2.4 pts. The reported `−1.31%` mean corrects to roughly **+0.9%**, and the 23.4% beat-rate is a shifted distribution, not a verdict. Any conclusion resting on Pinnacle CLV — including the totals-divisor proof-of-fix target — needs re-reading.

The US-book `clv` at line 236 is sound (vigged on both sides, cancels).

**Blocker:** the opposing price at pick time is not stored. Only `closing_opp_odds` exists. Adding `opp_odds` at write time is a one-column fix that unblocks correct CLV, exact per-row break-even, and de-vig auditing permanently. `pinnacleClvBiasEstimate()` approximates a retroactive correction until then.

---

## ORDER OF WORK

1. **Fit γ — BUILT, awaiting a read.** `backend/routes/gammafit.js`, mounted at `/api/gammafit`, read-only, no admin gate. Takes `?league=` and `?market=`. It reconstructs `fair` and `raw` from stored fields and **validates that reconstruction with a de-vig IDENTITY check** (`devigConsistent`, WZ-DEVIG-IDENTITY-2026-07-24: `fair = model_prob − edge` must round-trip to a physically valid vigged market — the two de-vigged sides sum to 1, re-vig recovers the posted price, and the implied overround sits in [0, 20%]; reported per market as `reconstruction`, self-tested via `node backend/routes/gammafit.js`). This holds at **any vig level including exactly 0** — which is the point: best-of-books pricing drives the effective vig to ~0, and v1's `vigTaxPts ≈ 2.2` *thesis* gate wrongly voided exactly that valid data. It then fits γ against both outcomes and the Pinnacle close, runs a 60/40 out-of-sample split priced at real odds, and audits how much of the published board was −EV.

   The first read of this endpoint is the gate on everything else. Do not propose a selection rule before it.
2. **Fix `pinnacle_clv`.** Then re-read every CLV-based conclusion.
3. **Add `opp_odds` at write time.**
4. **Only then touch the board** — move the gate from the raw probability floor (`blendedProb ≥ 0.45`, was 0.55, and effectively open per HOW A PICK step 7) to `EV ≥ margin` at the posted price, validated out-of-sample on CLV.

Steps 1–3 change nothing a customer sees. Nothing reaches a subscriber on a backtest alone.

### Also open

- **WNBA** — in season, `basketball_wnba` already active on the odds account and paying for a feed that returns nothing. No WNBA code exists anywhere (`grep -i wnba` returns zero; the nine NBA service files are scaffold, not a head start). Real build: ratings, team matching, recorder, grader. Ships provisional and market-anchored, recording from day one.
- **Totals divisor** — `TOTAL_SD = 4.0` at `edgesModel.js:1649` is a function-local const (not `TOTAL_SD_DIVISOR`). Gated on `empiricalScale.fitted` at n≥100. Fixes over-claiming, **not** profitability, and may publish fewer picks.
- **CFB disclaimer trap** — `backend/routes/edges.js:1998` hardcodes "vs preseason lines". Becomes a false customer-facing claim when real lines post in late August. One-line root fix.
- **Repo hygiene** — there is no `.gitignore` and 4,639 `node_modules` files are tracked. That is the 102 MB.

---

## THE PLAN

MLB was calibrated reactively and it cost months of quiet bleed. **Nothing else launches that way again.** Every new sport ships provisional, market-anchored, labeled honestly, recording from day one, released by the guard and CLV as it earns trust.

**And note the gap this exposes:** the calibration guard measures whether picks win as often as they claim. It has never measured whether they make money at the price paid. A market can pass the guard perfectly and bleed. That is why moneyline is live and losing.
