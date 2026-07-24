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

**Work on a branch and open a PR. Never commit straight to `main`.** Vercel builds a preview URL on the PR; Master G reviews the working site on his phone and merges. He is not proofreading JavaScript — give him something he can look at.

Before any PR: `node --check` every file touched, run the relevant self-test, and read `git diff --numstat` for unexpected deletions.

---

## THE MONEY PROBLEM — the live, open surgery

**At the prices actually paid, the published board loses money.** MLB moneyline is live at roughly −2.1% real ROI on n=96.

### Root cause (verified in code, 2026-07-22)

1. **The selection quantity never subtracts the vig.** `edgesModel.js:1169` defines edge as `modelProb − devigTwoWay(...)`. Customers bet the *posted* price, not the de-vigged one. The gap is `a·(S−1)/S` — **2.25 pts at −130, 2.38 pts at −110, but only ~1.15 pts at +150.** Every threshold in the product (`rateConfidence` 0.005/0.025/0.05, `MIN_PROP_EDGE`, `HITS_MIN_EDGE`) sits on this inflated number. A `LOW` pick is −EV by construction.

2. **The overstatement is larger on favorites than dogs**, so the metric systematically flatters the expensive side.

3. **The 55% floor is a price filter in disguise.** `edgesModel.js:1614-1623` sets the ranking win% to `0.55·raw + 0.45·fair`, so `win% − edge == fair market price`. With edge at 0.005–0.05, the gate is ~90% the market's own price. A pick published at the 55% floor sits at roughly −135, where break-even is 57.5% — **its own printed win probability is below its break-even.**

### The correct calculation

```
b  = payout(posted)
BE = 1/(1+b)
p̂  = σ( logit(fair) + γ·(logit(raw) − logit(fair)) )
EV = p̂·b − (1−p̂)
```

Implemented in **`backend/services/priceMath.js`** (pure, dependency-free, `node backend/services/priceMath.js` runs 13 self-tests). Use it. Do not re-derive price math inline anywhere.

**`W_MODEL = 0.55` was chosen, never measured.** γ is the fraction of the model's disagreement with the market that is real. Fit it with `fitShrinkage()` before proposing any selection rule.

---

## MEASUREMENT — read this before quoting any performance number

**Outcome ROI cannot settle the arguments this project is having.**

| Question | Bets needed at 95% |
|---|---|
| Resolve a 2-point ROI difference | ~7,500 |
| Resolve a half-point CLV difference | ~62 |

Current published moneyline n=96. **Every outcome-based ROI read in this project is under-powered by two orders of magnitude**, including the −2.1% above and the tempting +1.6% on the unpublished population. Treat them as directional, never as verdicts.

**CLV is the only instrument with power at this sample size.** Use it.

### Known instrument bug — fix before trusting any CLV number

`predictionTracker.js:267` computes `pinnacle_clv` as de-vigged Pinnacle close **minus our vigged taken price**. Mismatched units. Biased low by 2.2–2.4 pts. The reported `−1.31%` mean corrects to roughly **+0.9%**, and the 23.4% beat-rate is a shifted distribution, not a verdict. Any conclusion resting on Pinnacle CLV — including the totals-divisor proof-of-fix target — needs re-reading.

The US-book `clv` at line 236 is sound (vigged on both sides, cancels).

**Blocker:** the opposing price at pick time is not stored. Only `closing_opp_odds` exists. Adding `opp_odds` at write time is a one-column fix that unblocks correct CLV, exact per-row break-even, and de-vig auditing permanently. `pinnacleClvBiasEstimate()` approximates a retroactive correction until then.

---

## ORDER OF WORK

1. **Fit γ against CLV, not outcomes.** Regress stored `pinnacle_fair_prob` on the model's raw prob and the opening fair prob. This is the measurement that tells us whether the model has an edge at all, and it is readable at n=96.
2. **Fix `pinnacle_clv`.** Then re-read every CLV-based conclusion.
3. **Add `opp_odds` at write time.**
4. **Only then touch the board** — move the gate from `blendedProb ≥ 0.55` to `EV ≥ margin` at the posted price, validated out-of-sample on CLV.

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
