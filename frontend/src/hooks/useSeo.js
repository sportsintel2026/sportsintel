// WZ-SEO-ROUTEMETA-2026-08-17 :: zero-dependency per-route metadata.
// Sets document.title and upserts the single <meta name="description"> and
// <link rel="canonical"> that already live in index.html (SEO step 2). This is a
// client-only Vite SPA; Googlebot renders JS, so per-route title/description/canonical
// are picked up on render. The global Open Graph / Twitter tags from step 2 are NOT
// touched here. On unmount the step-2 baseline is restored, so these tags never leak
// onto a route that sets none of its own (e.g. an authenticated page).
import { useEffect } from "react";

const ORIGIN = "https://www.wizepicks.com";
// Baseline mirrors index.html exactly (step 2), em-dash and all, so restoring it on
// unmount reproduces the step-2 head byte-for-byte.
const BASE_TITLE = "WizePicks — Your Edge on Every Game";
const BASE_DESC = "WizePicks — Live scores, H2H records, player stats, and weather analysis for MLB, NBA, and NFL.";
const BASE_CANONICAL = ORIGIN + "/";

function upsertMeta(name, content) {
  if (content == null) return;
  let el = document.head.querySelector('meta[name="' + name + '"]');
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  if (href == null) return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// path: canonical path beginning with "/" (e.g. "/pricing"). The three fields are
// independent; any omitted field is simply left unchanged while mounted.
export function useSeo({ title, description, path } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) upsertMeta("description", description);
    if (path != null) upsertCanonical(ORIGIN + path);
    return () => {
      document.title = BASE_TITLE;
      upsertMeta("description", BASE_DESC);
      upsertCanonical(BASE_CANONICAL);
    };
  }, [title, description, path]);
}

export default useSeo;
