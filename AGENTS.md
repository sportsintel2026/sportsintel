# WizePicks Agent Guide

This file is the current operating guide for coding agents working in this repository. Read it before making changes. Also read `CLAUDE.md` and the newest applicable `HANDOFF-*.md`, but verify their claims against current code and Git history because several documents contain historical or superseded information.

## Production baseline

- WizePicks production baseline: `44a83a2b9fcc9e80f791ddf9254cbf6ea605578f` (`44a83a2`).
- At the time this guide was created, local `main`, GitHub `main`, the latest recorded Vercel production deployment, and the active Railway production deployment all corresponded to that commit.
- `main` is production. A merge to `main` can trigger both Vercel and Railway deployments.
- Never treat a provider timestamp, a successful build badge, or a response that merely looks current as proof of the deployed commit. Verify the provider's source SHA when deployment identity matters.

## What WizePicks is

WizePicks is a paid sports-analytics application. It is not a sportsbook and does not accept wagers. It provides model-generated picks, manually curated WizePlays, odds and market analysis, live scores, matchup data, player information, weather, news, performance tracking, and educational content.

Real customers use and pay for the product. Changes to displayed probabilities, edges, picks, records, prices, access, grading, or deployment behavior can directly affect customers and the credibility of the service.

## Repository layout

- `frontend/`: React 18 single-page application built with Vite.
- `backend/`: Node.js and Express API, models, integrations, recording, grading, and scheduled jobs.
- `sql/`: selected database and research SQL, but not a complete production migration history.
- `docs/`: older launch documentation. Treat it as historical until confirmed against current code.
- `README.md`, `CLAUDE.md`, and `HANDOFF-*.md`: product and engineering context. Later handoffs may supersede earlier statements.

## Frontend architecture

- React Router defines public, authenticated, sport-specific, game-detail, account, and administrative pages in `frontend/src/App.jsx`.
- Supabase Auth is used directly by the browser. `frontend/src/lib/api.js` creates the Supabase client and attaches the current access token to backend API requests.
- The backend base URL comes from `VITE_API_URL`, with the Railway production URL as a fallback.
- Public pages include the landing page, pricing, authentication, legal and trust pages, and sports-betting education articles.
- Product pages include edge boards, live scores, games, props, market odds, consensus, performance, WizePlays, UFC, player/game detail, and settings.
- Access is enforced partly in the UI and partly by backend response gates. UI locking alone is never sufficient protection.
- Mobile and desktop presentations use different render paths in important areas. Trace and test both consumers before assuming a shared data producer produces identical behavior.
- Styling is largely component-local and inline. Several core page files are very large; avoid unrelated formatting or mechanical rewrites.
- Vercel builds the `frontend/` project. `frontend/vercel.json` rewrites application routes to `index.html`.
- Build-time metadata prerendering is handled by `frontend/scripts/prerender-meta.mjs`.

## Backend architecture

- `backend/server.js` starts one Express process and mounts the public, paid, administrative, diagnostic, research, and webhook routes.
- The backend is both an HTTP API and a scheduler. `node-cron` jobs refresh sports data, capture odds and closing lines, record predictions, grade results, warm caches, run calibration guards, and perform optional research backfills.
- `backend/routes/` contains HTTP controllers and a substantial number of diagnostic and research endpoints.
- `backend/services/` contains external API clients, sport models, price math, prediction recording, grading, calibration, and research services.
- Core pick history is stored in the Supabase `model_predictions` table. Other referenced tables include subscriptions, profiles, game caches, closing lines, odds ticks, expert picks, daily cards, UFC picks, umpire data, sharp-edge snapshots, and research state/data tables.
- The checked-in `backend/schema.sql` is an early partial schema, not a complete representation of production. Do not assume a clean database can be reconstructed from it.
- Some provider and database failures intentionally degrade to cached, empty, provisional, or market-only output. Confirm the actual error path before calling an empty board a model result.
- The backend's current health endpoint confirms availability but does not report the deployed Git SHA or the health of every job/provider.

## Authentication, database, and payments

### Supabase

- Supabase provides PostgreSQL storage and user authentication.
- The frontend uses the public Supabase URL and anonymous key.
- The backend uses the service-role key for trusted database work and token validation.
- User profiles and subscriptions determine customer and administrator access.
- Access rules currently exist in multiple middleware paths. Some check active subscription status while another model-data gate primarily checks tier. Do not change, consolidate, or reinterpret these rules without explicit approval and focused tests.

### Stripe

- Stripe provides subscription checkout, billing-portal sessions, webhook-driven subscription updates, and administrator subscription statistics.
- Current and legacy price IDs remain supported so existing subscriptions continue to work.
- Stripe webhook verification depends on the raw request body and must remain mounted before the general JSON parser.
- Pricing, product tiers, price identifiers, billing intervals, trial behavior, cancellation behavior, webhook behavior, and subscription access must not change without explicit approval.

## Deployment architecture

### GitHub

- Repository: `github.com/sportsintel2026/sportsintel`.
- `main` is the production branch.
- Major work must begin on a dedicated branch. Never commit feature or repair work directly to `main`.
- Do not push, open or merge a pull request, tag a release, or alter repository settings unless the user explicitly authorizes that action.

### Vercel

- Vercel hosts the React/Vite frontend from `frontend/` and serves the WizePicks production domain.
- Production deployments are associated with `main`.
- Vercel branch previews cannot reliably test data-driven behavior because the backend CORS allowlist accepts exact approved origins, not arbitrary preview domains.
- A successful Vercel preview proves that the frontend built; it does not prove that authenticated or API-driven production behavior works.

### Railway

- Railway hosts the Node/Express backend from `backend/`.
- Railway production is connected to the same GitHub repository.
- Repository history contains deployment records for more than one Railway project/environment. Confirm the active service associated with `sportsintel-production.up.railway.app` before drawing deployment conclusions.
- There is no committed Railway configuration file that fully describes the provider dashboard. Root directory, branch, variables, scaling, and deployment settings must be verified in Railway when relevant.

## Sports data and external providers

The current code references these primary providers:

- ESPN public APIs: schedules, scores, standings, rosters, statistics, news, injuries, and MMA results.
- The Odds API: sportsbook prices, line shopping, props, and Pinnacle/sharp reference data.
- MLB StatsAPI and Baseball Savant: MLB schedules, lineups, player and pitcher statistics, Statcast-style inputs, and results.
- Open-Meteo: venue weather.
- Cito: UFC events, bouts, fighter data, and results.
- CollegeFootballData: CFB ratings and research/calibration support.
- Sportradar: legacy/general game-cache integration still present in the repository.
- Anthropic: optional AI-generated game reads, controlled by environment configuration.
- Healthchecks.io: heartbeat monitoring for selected scheduled jobs.

External API responses can change shape, lag, omit games, or rate-limit requests. Preserve honest fallbacks and never fabricate missing data.

## Sports and feature maturity

### Most mature

- MLB has the deepest production pipeline: games, lineups, pitchers, weather, model edges, moneyline, totals, run line, several player-prop markets, odds history, closing-line capture, recording, grading, calibration, and performance reporting.
- UFC has a connected card, odds, model, factor, recording, grading, and public-record pipeline, though cleanup and continued validation remain necessary.
- Authentication, paid access, Stripe billing, public marketing, SEO pages, and basic live-score infrastructure are operating production features.

### Functional but provisional or still being validated

- NFL and CFB have boards, ratings, odds, line movement, recording, grading, shadow ledgers, and calibration tools. Treat model claims as provisional where the code says so and validate them with in-season data.
- NBA has schedules, predictions, matchup analysis, injuries, props services, and live modeling, but its product claims and ranking behavior require further verification.
- NHL has live-data scaffolding and seasonal UI behavior but is less developed as a modeled betting product.

### Incomplete or absent

- WNBA has no complete implementation despite historical notes that the odds account may expose or bill for the feed.
- Some sport/section combinations intentionally render "coming soon."
- Football empty-state metadata exists in the backend but is not fully explained by the frontend.

## Known technical problems and risks

- Documentation drift: the README, launch guide, `CLAUDE.md`, and handoff files contain outdated or contradictory provider, pricing, model, schema, and backlog statements. Verify current code before relying on documentation.
- Database reproducibility: there is no complete ordered migration history for the production Supabase schema.
- Deployment identity: the running Railway health response does not expose a Git SHA. Provider source metadata is required for exact verification.
- Scheduled work shares the web process. Restarts, multiple instances, or provider outages can cause missed, delayed, or duplicate work unless jobs are idempotent and monitored.
- Broad exception guards favor uptime but may leave a process or dataset stale after serious failures.
- Temporary public diagnostic and research routes have accumulated. Some can expose internal modeling detail or consume metered APIs.
- Core files such as `Home.jsx`, `edgesModel.js`, `performance.js`, `edges.js`, and `predictionTracker.js` are large and carry multiple responsibilities.
- Access-control behavior is split across frontend checks and several backend middlewares.
- A historical MLB reconstruction defect affects a meaningful subset of older rows and has blocked trustworthy model-weight analysis.
- Totals calibration and its diagnostic mirrors have been active work. An unmerged branch may contain a diagnostic-only correction; never merge it without reviewing it against current `main`.
- Run-line profitability has been weak in historical reads even when calibration appeared acceptable. Calibration and profitability are different questions.
- NBA sorting/coverage and customer-facing claims require verification before expansion.
- The UFC card still includes diagnostic output that was intended to be temporary.
- Vercel preview deployments cannot validate production API behavior under the current CORS policy.
- Backend dependencies are not locked by a committed backend lockfile, and automated test scripts are limited.

## Model, odds, recording, and grading safety

- Never silently change a model calculation, coefficient, threshold, divisor, blend, probability transform, market mapping, selection rule, ranking rule, or fallback.
- Never change betting/model logic, grading logic, pricing, subscriptions, or production infrastructure without explicit user approval.
- Use real posted prices for ROI, break-even, expected value, and settlement analysis. Never assume every wager is `-110`.
- Do not rank or filter by a new quantity merely because it looks predictive in the same sample used to invent it. Separate fitting, validation, shadow recording, and publication.
- Test the measuring instrument before trusting its output. Identity checks need negative controls where practical.
- Preserve the distinction between raw model probability, market fair probability, blended/displayed probability, edge, expected value, published picks, and shadow rows.
- A shadow result is not evidence about a published market unless the populations and selection paths are demonstrably the same.
- Keep board selection and prediction recording aligned. Confirm that what customers see is what gets recorded and graded.
- Do not rewrite historical grades or results without explicit approval, a documented reason, and a reversible audit plan.
- Do not publish a new sport or market merely because an endpoint returns data. Require honest labeling, recording from day one, grading, and an agreed validation plan.

## Secrets and sensitive information

- Never expose, print, commit, paste into URLs, include in screenshots, or write to logs any API key, service-role key, Stripe secret, webhook secret, admin token, database URL, authentication token, or customer data.
- Refer to environment-variable names only unless the user explicitly provides and authorizes handling a value.
- Never place `ADMIN_TOKEN` or any other secret in a browser query string. Use an approved secure header or provider console when an authorized administrative check is necessary.
- Do not add `.env` files to Git. Confirm staged changes contain no secrets before every commit.
- This repository is public. Treat every committed byte as publicly visible forever.

## Required development workflow

1. Begin major work from an up-to-date `main` on a dedicated branch.
2. Confirm the branch name and baseline commit before editing.
3. Read the complete affected path: producer, route projection, client, and every relevant mobile/desktop consumer.
4. Make the smallest root-cause change that fulfills the approved scope. Preserve unrelated user changes.
5. Do not mix cleanup, product behavior, model changes, schema changes, and infrastructure changes unless the user explicitly approves the combined scope.
6. Run syntax checks, relevant self-tests, focused tests, and a production-like frontend build where dependencies are available.
7. Review the full diff and deletion counts. Investigate unexpected deletions or generated files.
8. For data/model changes, verify units, identities, population definitions, date windows, posted prices, null behavior, and negative controls.
9. For UI changes, test authenticated and anonymous behavior, paid and free behavior, mobile and desktop render paths, loading, empty, error, live, and completed-game states as applicable.
10. For database changes, provide an ordered migration and compatibility plan before application code depends on the new schema.
11. Do not commit, push, open a pull request, merge, or deploy until explicitly authorized.
12. Before an authorized deployment, identify the exact commit, affected service, required variables/migrations, rollback path, and post-deployment checks.
13. After deployment, verify the provider source SHA and live behavior. A green build alone is not enough.

## Production protection rules

- Treat `main`, Vercel production, Railway production, Supabase production, and Stripe production as protected systems.
- Read-only inspection does not authorize writes, triggers, backfills, cache clearing, manual grading, subscription changes, or provider configuration changes.
- Never run a manual grading, recording, research backfill, cache deletion, or paid-API probe against production without explicit approval.
- Never merge an old or unknown branch solely because its name sounds relevant. Review its complete diff and ancestry first.
- Never deploy from an unverified branch or commit.
- Never modify Vercel, Railway, Supabase, Stripe, GitHub, DNS, CORS, domains, scaling, environment variables, or scheduled jobs without explicit approval.
- Never change pricing, subscriptions, customer access, grading logic, betting/model logic, public performance claims, or production infrastructure without explicit approval.
- If production identity cannot be proven, stop and request the provider's active source SHA rather than guessing from clocks or page appearance.

## Definition of ready for review

A change is ready for review only when its scope is explicit, the branch and baseline are known, relevant tests pass, the full diff has been inspected, secrets are absent, customer-visible effects are stated plainly, model/data assumptions are documented, and deployment and rollback requirements are understood. Review readiness is not deployment authorization.
