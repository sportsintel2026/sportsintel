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

const CITO_BASE = "https://api.citoapi.com/api/v1";
const CITO_API_KEY = process.env.CITO_API_KEY;
const EVENTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h -- the upcoming-events list changes slowly
const BOUTS_TTL_MS = 3 * 60 * 60 * 1000;  // 3h -- a card's bouts change slowly once announced

const eventsCache = { at: 0, data: null };
const boutsCache = new Map(); // slug -> { at, data }

async function citoGet(path) {
  if (!CITO_API_KEY) return null;
  try {
    const res = await axios.get(`${CITO_BASE}${path}`, {
      headers: { "x-api-key": CITO_API_KEY },
      timeout: 12000,
    });
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
async function getEventBouts(slug, opts) {
  if (!slug) return [];
  const fresh = !!(opts && opts.fresh);
  const now = Date.now();
  const hit = boutsCache.get(slug);
  if (!fresh && hit && now - hit.at < BOUTS_TTL_MS) return hit.data;
  const data = await citoGet(`/ufc/events/${encodeURIComponent(slug)}/bouts`);
  if (data == null) return hit ? hit.data : []; // keep stale on failure
  boutsCache.set(slug, { at: now, data });
  return data;
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
    const res = await axios.get(`${CITO_BASE}/ufc/fighters/${encodeURIComponent(slug)}`, {
      headers: { "x-api-key": CITO_API_KEY },
      timeout: 12000,
    });
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
