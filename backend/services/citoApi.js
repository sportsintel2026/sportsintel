// citoApi.js :: WZ-CITO-2026-07-09
// Thin wrapper around the Cito UFC API (api.citoapi.com). Gives the UFC page a REAL,
// UFC-only card with structure the odds feed can't provide: event names, PPV vs Fight
// Night, Main Card / Prelims (cardSection), weight classes, fighter records, and headshots.
// Reads CITO_API_KEY (Railway env). Long cache (events/cards change slowly) to stay well
// under the 500-calls/month free tier. Fail-safe: every call returns [] / null on any error
// so the route can fall back to the odds-only card and never break.
//
// Endpoints used (confirmed from live responses):
//   GET /api/v1/ufc/events/upcoming            -> { data:[{ slug,title,shortTitle,startsAt,
//                                                    venue,city,locationText,imageUrl,
//                                                    eventDateLabel, dataAvailability:{bouts} }] }
//   GET /api/v1/ufc/events/{slug}/bouts         -> { data:[{ cardSection,cardSectionOrder,
//                                                    cardPosition,boutOrder,weightClass,
//                                                    titleBout,status,odds:{red,blue},
//                                                    fighters:[{ fighterName,corner,imageUrl,
//                                                      profile:{ recordText,record,headshotUrl,
//                                                        division,nickname,country,flag } }] }] }

const axios = require("axios");

// WZ-CITO-THROTTLE-2026-07-10 :: ROOT FIX for the Cito 429s. buildCitoCard() fired ~50 calls
// at once on cold start (events + bouts + 4 fighter calls x ~13 bouts via Promise.all), tripping
// Cito's rate/burst limit -> 429 -> empty card -> odds-only fallback, and repeated tripping put
// us in a lockout. Fix = SELF-CORRECTING throttle: one request at a time through a queue with a
// minimum gap that AUTO-WIDENS whenever Cito answers 429 (honoring Retry-After) and eases back
// down when calls succeed. No hard-coded limit to guess -- it tunes itself to Cito's real cap.
// All Cito calls route through citoAxios().
// Paid Basic/Starter cap is 30 calls/min -> 2000ms/call. Floor at 2100ms (~28/min) for margin so
// we sit UNDER the cap from the first call and never thrash into a 429. WZ-CITO-30PM-2026-07-10
const GAP_MIN_MS = 2100;    // floor: ~28 req/min, safely under the 30/min paid cap
const GAP_MAX_MS = 12000;   // ceiling so we never stall forever
const MAX_RETRIES_429 = 4;  // per request, before giving up to the fallback
let _gapMs = 2100;          // current adaptive gap (starts at the safe floor)
let _cQueue = Promise.resolve();
let _cLast = 0;

function _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// serialize + pace: never two Cito calls at once, always >= _gapMs apart
function _paced(fn) {
  const run = async () => {
    const wait = _cLast + _gapMs - Date.now();
    if (wait > 0) await _sleep(wait);
    _cLast = Date.now();
    return fn();
  };
  _cQueue = _cQueue.then(run, run);
  return _cQueue;
}

// GET with adaptive 429 back-off. Returns an axios-style response ({status,data}) or throws on
// network error. On 429: widen the global gap, wait (Retry-After if given, else exponential),
// and retry. On success: gently relax the gap back toward the floor.
async function citoAxios(url) {
  let attempt = 0;
  while (true) {
    const res = await _paced(() =>
      axios.get(url, {
        headers: { "x-api-key": CITO_API_KEY },
        timeout: 12000,
        validateStatus: () => true, // don't throw on 429 -- we handle it
      })
    );
    if (res.status !== 429) {
      if (res.status >= 200 && res.status < 300) {
        _gapMs = Math.max(GAP_MIN_MS, Math.round(_gapMs * 0.9)); // healthy -> ease off
      }
      return res;
    }
    // 429: back off and retry
    attempt++;
    if (attempt > MAX_RETRIES_429) return res; // give up -> caller falls back
    const ra = Number(res.headers && (res.headers["retry-after"] || res.headers["Retry-After"]));
    const backoff = Number.isFinite(ra) && ra > 0
      ? Math.min(ra * 1000, 30000)
      : Math.min(GAP_MAX_MS, 800 * Math.pow(2, attempt - 1)); // 800,1600,3200,4000...
    _gapMs = Math.min(GAP_MAX_MS, Math.max(_gapMs * 1.8, 1200)); // widen future pacing
    console.error(`[Cito] 429 on ${url} -- backing off ${backoff}ms, gap now ${_gapMs}ms (try ${attempt})`);
    await _sleep(backoff);
  }
}

const CITO_BASE = "https://api.citoapi.com/api/v1";
const CITO_API_KEY = process.env.CITO_API_KEY;
const EVENTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h -- the upcoming-events list changes slowly
const BOUTS_TTL_MS = 3 * 60 * 60 * 1000;  // 3h -- a card's bouts change slowly once announced

const eventsCache = { at: 0, data: null };
const boutsCache = new Map(); // slug -> { at, data }

async function citoGet(path) {
  if (!CITO_API_KEY) return null;
  try {
    const res = await citoAxios(`${CITO_BASE}${path}`);
    if (res.status < 200 || res.status >= 300) {
      console.error(`[Cito] GET ${path} -> HTTP ${res.status}`);
      return null; // 429-after-retries or other error -> caller falls back / keeps stale
    }
    return res.data && Array.isArray(res.data.data) ? res.data.data : [];
  } catch (e) {
    console.error(`[Cito] GET ${path} failed:`, e.message);
    return null; // null = hard failure; caller falls back
  }
}

// A numbered "UFC ###" event is a pay-per-view; "ufc-fight-night-*" etc. are not.
function isPPV(slug) {
  return /^ufc-\d+\b/.test(String(slug || "").toLowerCase());
}

async function getUpcomingEvents() {
  const now = Date.now();
  if (eventsCache.data && now - eventsCache.at < EVENTS_TTL_MS) return eventsCache.data;
  const data = await citoGet("/ufc/events/upcoming");
  if (data == null) return eventsCache.data || []; // keep stale on failure
  eventsCache.at = now;
  eventsCache.data = data;
  return data;
}

// WZ-UFC-GRADE-FRESH-2026-07-09 :: pass { fresh:true } to bypass the 3h cache. The
// grader needs this: right after a fight, winnerFighterSlug fills in, but a cached copy
// from up to 3h earlier still shows it null. Fresh forces a live read (and refreshes the
// cache for the card too). Default callers pass nothing -> unchanged cached behavior.
// WZ-UFC-DUPEBOUT-2026-07-27 :: Cito returns the SAME fight twice on completed events -- once
// under a numeric bout id ("12961", cardPosition "Main Card 1") and once under a 16-char hex id
// ("9009ec7b91f2be14", cardPosition "Main Card"). /diag returned 24 records for 12 fights on
// ufc-fight-night-july-25-2026. Upcoming events have not shown it, but if one ever does, every
// fight on the customer-facing card renders twice.
// Collapsed here, at the single choke point all consumers share (card build, record cron, grader,
// diag, probe), so they can never disagree about how many bouts an event has.
// Identity = the unordered pair of fighter slugs, which is unique within a single event. A record
// missing either slug is NEVER collapsed: an empty identity must not merge unrelated bouts.
// All-numeric ids win ties, because every row already banked in ufc_picks uses that family --
// preferring the hex id would turn previously banked picks into orphans overnight.
function dedupeBouts(list, slug) {
  if (!Array.isArray(list)) return [];
  if (list.length < 2) return list;
  const idOf = (b) => String(b && b.id != null ? b.id : "");
  const isNumericId = (b) => /^\d+$/.test(idOf(b));
  const identity = (b) => {
    const fs = Array.isArray(b && b.fighters) ? b.fighters : [];
    const slugs = fs
      .map((f) => String((f && (f.fighterSlug || (f.profile && f.profile.slug))) || "").trim().toLowerCase())
      .filter(Boolean);
    return slugs.length === 2 ? slugs.slice().sort().join("::") : "";
  };
  const out = [];
  const seenAt = new Map();
  for (const b of list) {
    const key = identity(b);
    if (!key) { out.push(b); continue; }
    const prev = seenAt.get(key);
    if (prev === undefined) { seenAt.set(key, out.length); out.push(b); continue; }
    if (!isNumericId(out[prev]) && isNumericId(b)) out[prev] = b;
  }
  if (out.length !== list.length) {
    console.log(`[Cito] dedupeBouts: ${slug} returned ${list.length} bout record(s) for ${out.length} distinct fight(s) -- collapsed ${list.length - out.length}.`);
  }
  return out;
}

async function getEventBouts(slug, opts) {
  if (!slug) return [];
  const fresh = !!(opts && opts.fresh);
  const now = Date.now();
  const hit = boutsCache.get(slug);
  if (!fresh && hit && now - hit.at < BOUTS_TTL_MS) return hit.data;
  const data = await citoGet(`/ufc/events/${encodeURIComponent(slug)}/bouts`);
  if (data == null) return hit ? hit.data : []; // keep stale on failure
  const deduped = dedupeBouts(data, slug); // WZ-UFC-DUPEBOUT-2026-07-27
  boutsCache.set(slug, { at: now, data: deduped });
  return deduped;
}

// WZ-UFC-MODEL-2026-07-09 :: full fighter profile (age, reach, height, stance, record with
// method splits, recent fight history) for the edge model. Static-ish data -> cache 24h so we
// almost never re-fetch a fighter (keeps us far under the 500-calls/month free tier). Returns
// the profile OBJECT (not the {data:[]} list) or null. Fail-safe.
const fighterCache = new Map(); // slug -> { at, data }
const FIGHTER_TTL_MS = 24 * 60 * 60 * 1000;
async function getFighter(slug) {
  if (!slug) return null;
  const now = Date.now();
  const hit = fighterCache.get(slug);
  if (hit && now - hit.at < FIGHTER_TTL_MS) return hit.data;
  if (!CITO_API_KEY) return hit ? hit.data : null;
  try {
    const res = await citoAxios(`${CITO_BASE}/ufc/fighters/${encodeURIComponent(slug)}`);
    if (res.status < 200 || res.status >= 300) { return hit ? hit.data : null; }
    // endpoint may return {data:{...}} or the object directly
    const body = res.data;
    const prof = body && body.data ? body.data : body;
    fighterCache.set(slug, { at: now, data: prof || null });
    return prof || null;
  } catch (e) {
    console.error(`[Cito] getFighter ${slug} failed:`, e.message);
    return hit ? hit.data : null;
  }
}

// Find the next upcoming PPV whose bouts are available. Falls back to the soonest PPV,
// then the soonest event of any kind, so we always return something if events exist.
async function getNextPPVEvent() {
  const events = await getUpcomingEvents();
  if (!events.length) return null;
  const byDate = (a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0);
  const ppvWithBouts = events
    .filter((e) => isPPV(e.slug) && e.dataAvailability && e.dataAvailability.bouts === "available")
    .sort(byDate);
  if (ppvWithBouts.length) return ppvWithBouts[0];
  const anyPPV = events.filter((e) => isPPV(e.slug)).sort(byDate);
  if (anyPPV.length) return anyPPV[0];
  return events.slice().sort(byDate)[0] || null;
}

// WZ-UFC-FIGHTS-2026-07-09 :: a fighter's bout history (GET /ufc/fighters/{slug}/fights) -- powers
// the layoff (ring-rust) and recent-form model factors. Each row: { outcome:"win"/"loss"/null,
// opponent:{...}, event:{ startsAt, eventDate }, bout:{ status:"completed"/"confirmed", method,
// isCancelled } }. Cached 24h (history changes only when a fighter fights) to keep us well under
// the Cito free tier -- one fetch per fighter per day. Returns [] on any error (model then treats
// layoff/form as neutral). NOTE: history is not reliably ordered and can contain a duplicate/
// future-dated row, so the model sorts by date and filters to completed past bouts itself.
const fightsCache = new Map(); // slug -> { at, data }
const FIGHTS_TTL_MS = 24 * 60 * 60 * 1000;
async function getFighterFights(slug) {
  if (!slug) return [];
  const now = Date.now();
  const hit = fightsCache.get(slug);
  if (hit && now - hit.at < FIGHTS_TTL_MS) return hit.data;
  const data = await citoGet(`/ufc/fighters/${encodeURIComponent(slug)}/fights`);
  if (data == null) return hit ? hit.data : []; // keep stale on failure
  fightsCache.set(slug, { at: now, data });
  return data;
}

module.exports = {
  isPPV,
  getUpcomingEvents,
  getEventBouts,
  getFighter,
  getFighterFights,
  getNextPPVEvent,
};
