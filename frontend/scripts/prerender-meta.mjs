// WZ-SEO-PRERENDER-2026-08-17 :: build-time per-route metadata prerender.
//
// Runs after `vite build`. Copies the built dist/index.html shell into one static HTML file
// per public/indexable marketing route, swapping <title>, <meta name="description">, and
// <link rel="canonical"> to that route's values. Search-entry routes also receive a small,
// route-specific static body and JSON-LD so non-JavaScript crawlers do not see an empty SPA shell.
// React replaces that initial root body with the live current-slate component when it boots.
// This puts route-correct metadata into the initial server-delivered HTML so crawlers that do not
// execute JavaScript can see it. The script snapshots no DOM and uses no headless browser,
// so design, the age gate, auth, routing, and premium behavior are untouched.
//
// The title/description/canonical below MUST stay in sync with the useSeo() values in the page
// components (SEO step 3), so the static HTML equals what the client renders. Open Graph /
// Twitter tags (step 2) are intentionally left untouched and stay global. Any expected tag that
// cannot be found is a hard error, so a
// change to the built head format fails the build loudly instead of shipping wrong metadata.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SEARCH_ENTRY_LIST } from "../src/lib/searchEntryConfig.js";
import {
  buildCurrentSeoPages,
  seoMatchupPath,
  splitSeoMatchup,
  SEO_PHASE2_LIST,
} from "../src/lib/seoPhase2Config.js";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SPORTS = ["nfl", "cfb", "mlb"];
const PUBLIC_API = String(process.env.SEO_PUBLIC_API_URL || process.env.VITE_API_URL || "https://sportsintel-production.up.railway.app").replace(/\/$/, "");
const FIXTURE_DIR = process.env.SEO_FEED_FIXTURE_DIR || null;

async function loadCurrentFeed(sport) {
  try {
    if (FIXTURE_DIR) return JSON.parse(await readFile(join(FIXTURE_DIR, `${sport}.json`), "utf8"));
    const response = await fetch(`${PUBLIC_API}/api/edges/${sport}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`prerender: excluding current ${sport} pages (${error.message})`);
    return null;
  }
}

const currentFeeds = Object.fromEntries(await Promise.all(SPORTS.map(async (sport) => [sport, await loadCurrentFeed(sport)])));
const buildNow = process.env.SEO_PRERENDER_NOW ? new Date(process.env.SEO_PRERENDER_NOW) : new Date();
const currentSeoPages = buildCurrentSeoPages(currentFeeds, buildNow);

// out: path within dist/. "index.html" is "/"; "pricing/index.html" is served by Vercel at
// "/pricing" (directory index), taking precedence over the SPA rewrite -- same mechanism that
// serves the step-1 robots.txt/sitemap.xml as real files.
const ROUTES = [
  {
    out: "index.html",
    title: "WizePicks — Your Edge on Every Game",
    description: "WizePicks — Live scores, H2H records, player stats, and weather analysis for MLB, NBA, and NFL.",
    canonical: "https://www.wizepicks.com/",
  },
  {
    out: "pricing/index.html",
    title: "Pricing — WizePicks",
    description: "WizePicks membership plans and pricing — model-driven picks, edges, and sports-betting analytics for MLB, NFL, CFB, NBA, NHL, and UFC.",
    canonical: "https://www.wizepicks.com/pricing",
  },
  {
    out: "signup/index.html",
    title: "Sign Up — WizePicks",
    description: "Create your WizePicks account for model edges, daily picks, and sports-betting analytics across MLB, NFL, CFB, NBA, NHL, and UFC.",
    canonical: "https://www.wizepicks.com/signup",
  },
  {
    out: "terms/index.html",
    title: "Terms of Service — WizePicks",
    description: "WizePicks Terms of Service. WizePicks is an informational sports-analytics service, not a sportsbook.",
    canonical: "https://www.wizepicks.com/terms",
  },
  {
    out: "privacy/index.html",
    title: "Privacy Policy — WizePicks",
    description: "WizePicks Privacy Policy — how WizePicks collects, uses, and protects your information.",
    canonical: "https://www.wizepicks.com/privacy",
  },
  {
    out: "about/index.html",
    title: "About WizePicks — Sharp Sports-Betting Analytics",
    description: "WizePicks is a sports-betting analytics and information service (not a sportsbook) for adults 21+, with model-driven edges and tools across MLB, NFL, CFB, NBA, NHL, and UFC.",
    canonical: "https://www.wizepicks.com/about",
  },
  {
    out: "how-it-works/index.html",
    title: "How WizePicks Works — Model, Plays & Tools",
    description: "How WizePicks turns data into a vig-free fair price and surfaces only the bets with a real edge — the model's number, handpicked plays, and the tools to check the work yourself.",
    canonical: "https://www.wizepicks.com/how-it-works",
  },
  {
    out: "what-is-closing-line-value/index.html",
    title: "What Is Closing Line Value (CLV)? — WizePicks",
    description: "Closing line value (CLV) measures whether you bet at a better price than the market's closing line. Plain-English definition, moneyline and spread examples, and why sharp bettors track it.",
    canonical: "https://www.wizepicks.com/what-is-closing-line-value",
  },
  {
    out: "how-to-read-moneyline-odds/index.html",
    title: "How to Read Moneyline Odds — WizePicks",
    description: "Moneyline odds explained: what +150 and -150 mean, how to calculate profit, payout, break-even and implied probability, plus favorites vs. underdogs, vig, line moves, and beginner mistakes.",
    canonical: "https://www.wizepicks.com/how-to-read-moneyline-odds",
  },
  {
    out: "implied-probability-sports-betting/index.html",
    title: "Implied Probability in Sports Betting — WizePicks",
    description: "Implied probability explained: convert American odds to a percentage, see worked examples, and learn how implied probability differs from true win probability, break-even, expected value, and vig.",
    canonical: "https://www.wizepicks.com/implied-probability-sports-betting",
  },
  {
    out: "how-point-spreads-work/index.html",
    title: "How Point Spreads Work in Sports Betting — WizePicks",
    description: "Point spreads explained: what -6.5 and +6.5 mean, covering the spread, pushes and the hook, spread odds and vig, run lines and puck lines, plus worked examples and common mistakes.",
    canonical: "https://www.wizepicks.com/how-point-spreads-work",
  },
  {
    out: "over-under-betting/index.html",
    title: "What Is Over/Under (Totals) Betting? — WizePicks",
    description: "Over/under (totals) betting explained: what the total means, betting the Over vs the Under, pushes, odds and vig, worked examples in the NFL, NBA and MLB, line moves, and common mistakes.",
    canonical: "https://www.wizepicks.com/over-under-betting",
  },
  {
    out: "expected-value-betting/index.html",
    title: "Expected Value (EV) in Sports Betting — WizePicks",
    description: "Expected value (EV) betting explained: what +EV and -EV mean, the EV formula, worked examples with real odds, why a +EV bet can still lose, EV vs implied probability and closing line value, and why EV matters over a large sample.",
    canonical: "https://www.wizepicks.com/expected-value-betting",
  },
  {
    out: "bankroll-management/index.html",
    title: "Sports Betting Bankroll Management & Unit Sizing — WizePicks",
    description: "Sports betting bankroll management and unit sizing explained: what a bankroll and a unit are, percentage-based sizing, flat vs variable staking, variance and drawdowns, and why bankroll management protects you but never creates an edge.",
    canonical: "https://www.wizepicks.com/bankroll-management",
  },
  {
    out: "what-is-a-parlay/index.html",
    title: "What Is a Parlay? Parlay Betting & Odds Explained — WizePicks",
    description: "Parlay betting explained: what a parlay and a leg are, why every leg must win, how parlay odds and payouts are created, worked American-odds examples, pushes and voids, and why parlays carry more risk and house edge.",
    canonical: "https://www.wizepicks.com/what-is-a-parlay",
  },
  {
    out: "odds-formats-explained/index.html",
    title: "American vs. Decimal vs. Fractional Odds Explained — WizePicks",
    description: "Betting odds formats explained: American, decimal, and fractional odds, how to convert between them with worked examples, how each shows implied probability, and which format is used where.",
    canonical: "https://www.wizepicks.com/odds-formats-explained",
  },
  {
    out: "sports-betting-for-beginners/index.html",
    title: "Sports Betting for Beginners: How to Bet on Sports — WizePicks",
    description: "A beginner's guide to sports betting: how odds work, the main bet types (moneyline, spread, totals, parlays), reading odds as probability, the vig, finding value over picking winners, bankroll basics, and betting responsibly.",
    canonical: "https://www.wizepicks.com/sports-betting-for-beginners",
  },
  ...SEARCH_ENTRY_LIST.map((page) => ({
    out: `${page.path.slice(1)}/index.html`,
    title: page.title,
    description: page.description,
    canonical: `https://www.wizepicks.com${page.path}`,
    staticBody: page,
  })),
  ...SEO_PHASE2_LIST.map((page) => ({
    out: `${page.path.slice(1)}/index.html`,
    title: page.title,
    description: page.description,
    canonical: `https://www.wizepicks.com${page.path}`,
    staticPhase2: page,
  })),
  ...currentSeoPages.map((page) => ({
    out: `${page.path.slice(1)}/index.html`,
    title: page.title,
    description: page.description,
    canonical: `https://www.wizepicks.com${page.path}`,
    staticPhase2: page,
  })),
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceOnce(html, re, replacement, label, file) {
  if (!re.test(html)) {
    throw new Error(`prerender: could not find ${label} in built dist/index.html (head format changed?) while writing ${file}`);
  }
  return html.replace(re, () => replacement);
}

function staticSearchBody(page) {
  const siblingLinks = SEARCH_ENTRY_LIST
    .map((item) => `<a href="${esc(item.path)}">${esc(item.h1)}</a>`)
    .join(" · ");
  return `<main data-search-entry-static="${esc(page.key)}"><header><a href="/">WizePicks</a></header><article><p>${esc(page.eyebrow)}</p><h1>${esc(page.h1)}</h1><p>${esc(page.lead)}</p><h2>Current WizePicks slate</h2><p>Live event dates, matchup summaries, and public-safe market context load from the active WizePicks data feed. Protected probabilities and picks remain subject to the existing access policy.</p><h2>How WizePicks evaluates the board</h2><p>${esc(page.explainer)}</p><p><a href="/signup">Unlock the member board</a> · <a href="/#perf">Performance history</a> · <a href="/how-it-works">How WizePicks works</a></p><nav aria-label="WizePicks sport hubs">${siblingLinks}</nav></article></main>`;
}

function staticSearchSchema(page) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `https://www.wizepicks.com${page.path}#page`, url: `https://www.wizepicks.com${page.path}`, name: page.title, description: page.description, isPartOf: { "@id": "https://www.wizepicks.com/#website" }, about: { "@type": "Thing", name: page.h1 } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "WizePicks", item: "https://www.wizepicks.com/" },
        { "@type": "ListItem", position: 2, name: page.h1, item: `https://www.wizepicks.com${page.path}` },
      ] },
    ],
  }).replace(/</g, "\\u003c");
}

function staticPhase2Body(page) {
  const hub = `<a href="${esc(page.hub)}">${esc(page.hubLabel)}</a>`;
  const shared = `<p>${hub} · <a href="/best-bets-today">Best bets today</a> · <a href="/performance/${page.sport === "cfb" ? "college-football" : page.sport}">Performance</a> · <a href="/signup">Unlock the member board</a></p>`;
  if (page.kind === "matchup") {
    return `<main data-seo-phase2-static="matchup"><header><a href="/">WizePicks</a></header><article><p>${esc(page.sport.toUpperCase())} MATCHUP</p><h1>${esc(page.h1)}</h1><p>${esc(page.description)}</p><h2>${esc(page.away)} at ${esc(page.home)}</h2><p>Event date: ${esc(page.date)}. Review the matchup, scheduled start time, sportsbook sources, and live market context. Qualified picks and exact probabilities remain protected by the existing WizePicks access policy.</p><h2>WizePicks verdict</h2><p>The active feed labels this matchup as a qualified pick, a pass for insufficient edge, or market-only when independent rated inputs are unavailable. The live result loads without exposing protected model data to public crawlers.</p>${shared}</article></main>`;
  }
  if (page.kind === "performance") {
    return `<main data-seo-phase2-static="performance"><header><a href="/">WizePicks</a></header><article><p>AUTHORITATIVE GRADED RESULTS</p><h1>${esc(page.h1)}</h1><p>${esc(page.description)}</p><h2>Recorded model performance</h2><p>The live page reads the public aggregate performance endpoint backed by decisive graded results in the active prediction ledger. It reports wins, losses, units, ROI, and market-level results without inventing records. MLB monetary reporting excludes rows without trustworthy entry prices from ROI while retaining valid win/loss outcomes.</p><h2>Transparent methodology</h2><p>Results use the current sport-specific reset and publication methodology. Past performance does not guarantee future results.</p>${shared}</article></main>`;
  }
  const games = (page.games || []).map((game) => {
    const teams = splitSeoMatchup(game);
    const path = seoMatchupPath(page.sport, game, page.date);
    return path && teams.away && teams.home ? `<li><a href="${esc(path)}">${esc(teams.away)} at ${esc(teams.home)}</a></li>` : "";
  }).join("");
  return `<main data-seo-phase2-static="slate"><header><a href="/">WizePicks</a></header><article><p>${esc(page.label)}</p><h1>${esc(page.h1)}</h1><p>${esc(page.description)}</p><h2>Current ${esc(page.sport.toUpperCase())} slate</h2><p>This focused ${page.sport === "mlb" ? "daily" : "weekly"} page lists real matchups, event times, sportsbook context, and public-safe WizePicks verdicts from the active production feed. Protected picks and probabilities retain their existing access rules.</p>${games ? `<ul>${games}</ul>` : ""}<h2>No thin archives</h2><p>WizePicks indexes only useful current period pages with real event coverage rather than generating empty or duplicate archives.</p>${shared}</article></main>`;
}

function staticPhase2Schema(page) {
  const primary = page.kind === "matchup"
    ? { "@type": "SportsEvent", "@id": `https://www.wizepicks.com${page.path}#event`, url: `https://www.wizepicks.com${page.path}`, name: `${page.away} at ${page.home}`, startDate: page.startDate, eventStatus: "https://schema.org/EventScheduled", competitor: [{ "@type": "SportsTeam", name: page.away }, { "@type": "SportsTeam", name: page.home }] }
    : { "@type": "CollectionPage", "@id": `https://www.wizepicks.com${page.path}#page`, url: `https://www.wizepicks.com${page.path}`, name: page.title, description: page.description };
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [primary, { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "WizePicks", item: "https://www.wizepicks.com/" },
      { "@type": "ListItem", position: 2, name: page.hubLabel, item: `https://www.wizepicks.com${page.hub}` },
      { "@type": "ListItem", position: 3, name: page.h1, item: `https://www.wizepicks.com${page.path}` },
    ] }],
  }).replace(/</g, "\\u003c");
}

async function writeCurrentSitemap(pages) {
  const sitemapPath = join(DIST, "sitemap.xml");
  const sitemapSource = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));
  let xml = await readFile(sitemapSource, "utf8");
  const additions = pages
    .filter((page) => !xml.includes(`<loc>https://www.wizepicks.com${page.path}</loc>`))
    .map((page) => `  <url>\n    <loc>https://www.wizepicks.com${esc(page.path)}</loc>\n  </url>`)
    .join("\n");
  if (additions) {
    if (!xml.includes("</urlset>")) throw new Error("prerender: sitemap.xml is missing </urlset>");
    xml = xml.replace("</urlset>", `${additions}\n</urlset>`);
  }
  await writeFile(sitemapPath, xml, "utf8");
  console.log(`prerender: sitemap includes ${pages.length} current rolling/matchup page(s).`);
}

const shell = await readFile(join(DIST, "index.html"), "utf8");

for (const r of ROUTES) {
  let html = shell;
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`, "<title>", r.out);
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(r.description)}" />`, "description meta", r.out);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${esc(r.canonical)}" />`, "canonical link", r.out);
  if (r.staticBody) {
    html = replaceOnce(html, /<div id="root"><\/div>/, `<div id="root">${staticSearchBody(r.staticBody)}</div>`, "root shell", r.out);
    html = replaceOnce(html, /<\/head>/, `<script id="wize-search-entry-jsonld" type="application/ld+json">${staticSearchSchema(r.staticBody)}</script>\n  </head>`, "head close", r.out);
  }
  if (r.staticPhase2) {
    html = replaceOnce(html, /<div id="root"><\/div>/, `<div id="root">${staticPhase2Body(r.staticPhase2)}</div>`, "root shell", r.out);
    html = replaceOnce(html, /<\/head>/, `<script id="wize-seo-phase2-jsonld" type="application/ld+json">${staticPhase2Schema(r.staticPhase2)}</script>\n  </head>`, "head close", r.out);
  }
  const outPath = join(DIST, r.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.log(`prerender: wrote ${r.out}`);
}
await writeCurrentSitemap(currentSeoPages);
console.log(`prerender: done, ${ROUTES.length} route file(s).`);
