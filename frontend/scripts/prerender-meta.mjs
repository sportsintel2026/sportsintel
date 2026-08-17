// WZ-SEO-PRERENDER-2026-08-17 :: build-time per-route metadata prerender.
//
// Runs after `vite build`. Copies the built dist/index.html shell into one static HTML file
// per public/indexable marketing route, swapping ONLY <title>, <meta name="description">, and
// <link rel="canonical"> to that route's values. The body stays the empty <div id="root">
// shell referencing the same hashed JS/CSS, so React boots exactly as before -- this injects
// route-correct metadata into the INITIAL server-delivered HTML so crawlers that do not execute
// JavaScript can see it. It renders no component and snapshots no DOM (no headless browser),
// so design, the age gate, auth, routing, and premium behavior are untouched.
//
// The title/description/canonical below MUST stay in sync with the useSeo() values in the page
// components (SEO step 3), so the static HTML equals what the client renders. Open Graph /
// Twitter tags (step 2) are intentionally left untouched and stay global. robots.txt and
// sitemap.xml are not touched. Any expected tag that cannot be found is a hard error, so a
// change to the built head format fails the build loudly instead of shipping wrong metadata.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

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
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceOnce(html, re, replacement, label, file) {
  if (!re.test(html)) {
    throw new Error(`prerender: could not find ${label} in built dist/index.html (head format changed?) while writing ${file}`);
  }
  return html.replace(re, () => replacement);
}

const shell = await readFile(join(DIST, "index.html"), "utf8");

for (const r of ROUTES) {
  let html = shell;
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`, "<title>", r.out);
  html = replaceOnce(html, /<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(r.description)}" />`, "description meta", r.out);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${esc(r.canonical)}" />`, "canonical link", r.out);
  const outPath = join(DIST, r.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.log(`prerender: wrote ${r.out}`);
}
console.log(`prerender: done, ${ROUTES.length} route file(s).`);
