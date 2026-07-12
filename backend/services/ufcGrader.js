// ufcGrader.js :: WZ-UFC-GRADE-2026-07-09
// Grades recorded UFC picks (Supabase table ufc_picks) once fights are decided, turning
// captured picks into a real, honest record AND validating the market-anchored MMA model.
//
// HOW IT SETTLES: Cito fills bouts[].winnerFighterSlug after a fight. We match that slug to
// the bout's red/blue corner, compare to the pick's stored corner -> win / loss. A concluded
// bout with no winner (draw / no-contest / cancelled, detected by status) -> push (no action).
// A bout not yet decided is left pending.
//
// BUDGET-SAFE (Cito free tier = 500 req/month): we force-fetch a card's bouts ONLY for events
// that have STARTED (startsAt <= now) or have already dropped off the upcoming list. A future
// event whose picks are legitimately still pending costs ZERO per-event calls -- between
// events this whole job is one cached upcoming-events read and nothing more.
//
// FAIL-SAFE + IDEMPOTENT: only flips pending -> win/loss/push, so re-runs are cheap no-ops and
// any error is logged and swallowed so the cron can never crash the server.

const { createClient } = require("@supabase/supabase-js");
const { getUpcomingEvents, getEventBouts } = require("./citoApi");
const { getEspnUfcResults, espnWinnerCorner } = require("./espnMma"); // WZ-UFC-ESPN-2026-07-11

let _sb = null;
function sb() {
  if (_sb) return _sb;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

// Terminal bout statuses that mean "the fight is over" even with no winner (draw / no-contest /
// cancelled) -> settle as push. Kept permissive; any UNKNOWN status is logged (not force-graded)
// so we can tighten this once real events grade out (first real data: UFC 329).
const TERMINAL_RE = /(final|complete|decision|ended|closed|result|draw|no.?contest|cancel|void)/i;

// Match Cito's winnerFighterSlug to a corner + name on the bout.
function winnerOf(bout) {
  const slug = bout && bout.winnerFighterSlug;
  if (!slug) return null;
  const list = Array.isArray(bout.fighters) ? bout.fighters : [];
  const w = list.find(
    (f) => String(f.fighterSlug || (f.profile && f.profile.slug) || "") === String(slug)
  );
  if (!w) return null;
  return {
    corner: String(w.corner || "").toLowerCase(),
    name: w.fighterName || (w.profile && w.profile.name) || null,
  };
}

async function gradeUFCPicks() {
  const c = sb();
  if (!c) return { skipped: "no-supabase" };

  // 1) Pending picks (cheap Supabase read; touches no external API).
  const { data: pending, error } = await c
    .from("ufc_picks")
    .select("bout_id,event_slug,pick_corner")
    .eq("result", "pending");
  if (error) {
    console.error("[UFC grade] pending fetch failed:", error.message);
    return { error: error.message };
  }
  if (!pending || !pending.length) return { graded: 0, pending: 0 };

  // 2) Which events are gradable? Started (startsAt <= now) or already dropped off upcoming.
  //    getUpcomingEvents is cached (6h) and shared with the card, so this adds ~no calls.
  const now = Date.now();
  let upcoming = [];
  try { upcoming = await getUpcomingEvents(); } catch (_) { upcoming = []; }
  const startsBySlug = new Map();
  for (const e of upcoming || []) {
    startsBySlug.set(e.slug, e.startsAt ? new Date(e.startsAt).getTime() : null);
  }

  const pendingSlugs = [...new Set(pending.map((r) => r.event_slug).filter(Boolean))];
  const gradableSlugs = pendingSlugs.filter((slug) => {
    if (!startsBySlug.has(slug)) return true;   // gone from upcoming -> already happened
    const t = startsBySlug.get(slug);
    return t == null || t <= now;               // started (or unknown start) -> grade
  });
  if (!gradableSlugs.length) {
    return { graded: 0, pending: pending.length, waiting: pendingSlugs.length };
  }

  const pendingByBout = new Map(pending.map((r) => [String(r.bout_id), r]));

  // WZ-UFC-ESPN-2026-07-11 :: faster winner source. ESPN posts results well ahead of Cito;
  // fetch once and use it only as a fallback below when Cito's winnerFighterSlug is still null.
  let espnResults = [];
  try { espnResults = await getEspnUfcResults(); } catch (_) { espnResults = []; }

  let graded = 0, pushed = 0, stillPending = 0;
  for (const slug of gradableSlugs) {
    let bouts = [];
    try { bouts = await getEventBouts(slug, { fresh: true }); } catch (_) { bouts = []; }
    if (!Array.isArray(bouts) || !bouts.length) continue;

    for (const bout of bouts) {
      const row = pendingByBout.get(String(bout.id));
      if (!row) continue; // not one of our pending picks (or already graded)

      // Cito first; if it hasn't posted a winner yet, fall back to ESPN (WZ-UFC-ESPN-2026-07-11).
      let win = winnerOf(bout);
      let winSource = win ? "cito" : null;
      if (!win) { const ew = espnWinnerCorner(bout, espnResults); if (ew) { win = ew; winSource = "espn"; } }
      const nowIso = new Date().toISOString();

      if (win && win.corner) {
        const result =
          win.corner === String(row.pick_corner || "").toLowerCase() ? "win" : "loss";
        await c
          .from("ufc_picks")
          .update({ result, winner_name: win.name || null, graded_at: nowIso, updated_at: nowIso })
          .eq("bout_id", String(bout.id));
        if (winSource === "espn") console.log(`[UFC grade] bout ${bout.id} settled from ESPN (winner=${win.name || "?"})`);
        graded++;
      } else if (TERMINAL_RE.test(String(bout.status || ""))) {
        // Concluded with no winner -> draw / no-contest / cancelled = push (no action).
        await c
          .from("ufc_picks")
          .update({ result: "push", winner_name: null, graded_at: nowIso, updated_at: nowIso })
          .eq("bout_id", String(bout.id));
        pushed++;
      } else {
        stillPending++; // not decided yet (earlier on the card) or an unrecognized status
        if (bout.status) {
          console.log(`[UFC grade] bout ${bout.id} not settled (status="${bout.status}")`);
        }
      }
    }
  }

  console.log(
    `[UFC grade] ${graded} win/loss, ${pushed} push, ${stillPending} still pending across ${gradableSlugs.length} event(s)`
  );
  return { graded, pushed, stillPending, events: gradableSlugs.length };
}

module.exports = { gradeUFCPicks };
