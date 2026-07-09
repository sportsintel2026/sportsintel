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

async function getEventBouts(slug) {
  if (!slug) return [];
  const now = Date.now();
  const hit = boutsCache.get(slug);
  if (hit && now - hit.at < BOUTS_TTL_MS) return hit.data;
  const data = await citoGet(`/ufc/events/${encodeURIComponent(slug)}/bouts`);
  if (data == null) return hit ? hit.data : []; // keep stale on failure
  boutsCache.set(slug, { at: now, data });
  return data;
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

module.exports = {
  isPPV,
  getUpcomingEvents,
  getEventBouts,
  getNextPPVEvent,
};
