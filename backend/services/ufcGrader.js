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
const { getEspnUfcResults, espnWinnerCorner, normName } = require("./espnMma"); // WZ-UFC-ESPN-2026-07-11 / WZ-UFC-REGRADE-BYNAME-2026-08-01

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
// WZ-UFC-PUSHNARROW-2026-08-01 :: TERMINAL_RE answers "is this fight over", and it was ALSO being
// used to answer "did this fight end with nobody winning". Those are not the same question.
// "final"/"complete"/"decision"/"ended"/"closed"/"result" all mean the fight HAPPENED and Cito has
// simply not filled winnerFighterSlug in yet -- treating them as no-winner settles a real result as
// a push. Bout 12882 (Todorovic vs Valentin) settled push at 07-31 08:00, a full DAY before the
// fight, and the customer saw PUSH on a bout Valentin won. Only this narrow set genuinely means
// nobody won; everything else stays pending until a winner appears.
const NO_WINNER_RE = /(draw|no.?contest|cancel|void|scratch)/i;

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

// WZ-UFC-ORPHAN-2026-07-27 :: the grader used to iterate Cito's bouts and look up our pending
// rows, so a pending pick whose bout Cito no longer lists was never visited -- no grade, no log,
// no counter, forever. On 07-20 a scratched fight (bout 12897, Dulatov vs Turman, July 25) left
// exactly one such row; it pinned the customer-facing UFC card to a finished event for two days
// and the grader never said a word about it across ~100 runs.
// This does NOT auto-settle orphans -- absence could be a transient Cito response, and silently
// pushing a live pick would corrupt the record. It only makes them impossible to miss.
let _lastReport = null;
function finish(r) { _lastReport = { at: new Date().toISOString(), ...r }; return r; }
function getLastGradeReport() { return _lastReport; }

async function gradeUFCPicks() {
  const c = sb();
  if (!c) return finish({ skipped: "no-supabase" });

  // 1) Pending picks (cheap Supabase read; touches no external API).
  const { data: pending, error } = await c
    .from("ufc_picks")
    .select("bout_id,event_slug,pick_corner,cito_winner_at,espn_winner_at,source_conflict") // WZ-UFC-SRCLAG-2026-08-01
    .eq("result", "pending");
  if (error) {
    console.error("[UFC grade] pending fetch failed:", error.message);
    return finish({ error: error.message });
  }
  if (!pending || !pending.length) return finish({ graded: 0, pending: 0, orphans: [], emptyEvents: [] });

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
    return finish({ graded: 0, pending: pending.length, waiting: pendingSlugs.length, orphans: [], emptyEvents: [] });
  }

  const pendingByBout = new Map(pending.map((r) => [String(r.bout_id), r]));

  // WZ-UFC-ESPN-2026-07-11 :: faster winner source. ESPN posts results well ahead of Cito;
  // fetch once and use it only as a fallback below when Cito's winnerFighterSlug is still null.
  let espnResults = [];
  try { espnResults = await getEspnUfcResults(); } catch (_) { espnResults = []; }

  // WZ-UFC-REGRADE-2026-08-01 :: a grade used to be written once and never revisited. ESPN posts
  // results ahead of Cito and is sometimes WRONG, and it corrects itself later -- on the 08-01
  // Belgrade card it reported Bogdan Grad as the loser, we wrote "loss" from that, ESPN fixed it,
  // and our badge stayed wrong while the card highlighted Grad as the winner off live Cito data.
  // A customer saw our record contradict our own card. Fix: re-check recently graded rows against
  // Cito and correct disagreements. Cito ONLY -- ESPN is the source that was wrong, so it never
  // gets to overwrite a grade, only to make a first call on a row nothing else has settled.
  // Scoped to the events already being fetched this run and to the last 7 days, so it adds zero
  // Cito calls and cannot rewrite settled history.
  let gradedRows = [];
  try {
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: gr } = await c
      .from("ufc_picks")
      .select("bout_id,event_slug,pick,pick_corner,result,winner_name,cito_winner_at,espn_winner_at,source_conflict") // WZ-UFC-SRCLAG-2026-08-01 / WZ-UFC-REGRADE-BYNAME-2026-08-01
      .in("event_slug", gradableSlugs)
      .in("result", ["win", "loss", "push"]) // WZ-UFC-PUSHNARROW-2026-08-01 :: a wrongly-settled push must be correctable too
      .gte("graded_at", sinceIso);
    gradedRows = Array.isArray(gr) ? gr : [];
  } catch (_) { gradedRows = []; }
  const gradedByBout = new Map(gradedRows.map((r) => [String(r.bout_id), r]));

  let graded = 0, pushed = 0, stillPending = 0, corrected = 0, conflicts = 0;
  const orphans = [];      // WZ-UFC-ORPHAN-2026-07-27 :: pending picks Cito no longer lists
  const emptyEvents = [];  // WZ-UFC-ORPHAN-2026-07-27 :: events Cito returned no bouts for
  for (const slug of gradableSlugs) {
    let bouts = [];
    try { bouts = await getEventBouts(slug, { fresh: true }); } catch (_) { bouts = []; }
    const slugPending = pending.filter((r) => r.event_slug === slug);
    if (!Array.isArray(bouts) || !bouts.length) {
      // WZ-UFC-ORPHAN-2026-07-27 :: this `continue` used to be silent. An event Cito returns
      // nothing for can never grade ANY of its picks, which is worth shouting about.
      emptyEvents.push({ slug, pending: slugPending.length });
      console.error(`[UFC grade] ORPHAN EVENT: ${slug} has ${slugPending.length} pending pick(s) but Cito returned 0 bouts -- none of them can grade.`);
      continue;
    }
    // WZ-UFC-ORPHAN-2026-07-27 :: pending rows for this event that Cito does not list at all.
    // These are unreachable by the bout loop below no matter how many times the cron fires.
    const seenIds = new Set(bouts.map((b) => String(b.id)));
    const missing = slugPending.filter((r) => !seenIds.has(String(r.bout_id)));
    if (missing.length) {
      for (const r of missing) orphans.push({ slug, bout_id: String(r.bout_id) });
      console.error(
        `[UFC grade] ORPHAN: ${missing.length} pending pick(s) for ${slug} are absent from Cito's ${bouts.length} bout(s) and can NEVER grade: ` +
        missing.map((r) => String(r.bout_id)).join(", ")
      );
    }

    for (const bout of bouts) {
      const row = pendingByBout.get(String(bout.id));

      // WZ-UFC-SRCLAG-2026-08-01 :: measure the feeds instead of arguing about them. Every pass,
      // stamp the FIRST time each source has a winner for this bout. The gap between the two is
      // Cito's lag against ESPN, per fight, in writing -- which is the thing actually worth taking
      // to them, and the thing that decides whether Cito should stay the primary grading source.
      // Runs on pending AND recently-graded rows so the slower feed still gets timed after we have
      // already settled from the faster one. Stamps once and never overwrites, so it records first
      // sighting, not latest. Resolution is the cron interval (30 min); a two-hour lag reads as
      // four passes, which is enough to make the case.
      const lagRow = row || gradedByBout.get(String(bout.id));
      if (lagRow) {
        const cwObs = winnerOf(bout);
        const ewObs = espnWinnerCorner(bout, espnResults);
        const stamp = new Date().toISOString();
        const patch = {};
        if (cwObs && cwObs.corner && !lagRow.cito_winner_at) patch.cito_winner_at = stamp;
        if (ewObs && ewObs.corner && !lagRow.espn_winner_at) patch.espn_winner_at = stamp;
        if (cwObs && ewObs && cwObs.corner && ewObs.corner && cwObs.corner !== ewObs.corner && !lagRow.source_conflict) {
          patch.source_conflict = true;
          conflicts++;
          console.error(
            `[UFC lag] SOURCE CONFLICT bout ${bout.id} (${lagRow.event_slug}): Cito says ` +
            `${cwObs.name || "?"} (${cwObs.corner}), ESPN says ${ewObs.name || "?"} (${ewObs.corner}). ` +
            `One fight, one winner -- a feed is wrong. Do not grade this from either until it is resolved.`
          );
        }
        if (Object.keys(patch).length) {
          try { await c.from("ufc_picks").update(patch).eq("bout_id", String(bout.id)); } catch (_) {}
        }
      }

      if (!row) {
        // WZ-UFC-REGRADE-2026-08-01 :: already graded. Ask Cito whether that grade still holds.
        const g = gradedByBout.get(String(bout.id));
        if (g) {
          const citoWin = winnerOf(bout); // Cito only, deliberately: no ESPN fallback here
          if (citoWin && citoWin.corner) {
            // WZ-UFC-REGRADE-BYNAME-2026-08-01 :: compare NAMES, not corners. Corner is a third
            // column that has to agree with the pick, and on legacy rows it does not -- bout 12906
            // (Grad) stores pick "Bogdan Grad" with the opposite pick_corner. Comparing corners
            // inverted a correct grade: Cito had Grad winning, we had Grad as the pick, and the
            // pass wrote "loss" and then rewrote it every cycle after it was fixed by hand. The
            // pick name against the winner name answers the question directly and cannot be
            // inverted by a bad corner. Corner remains the fallback for when either name is missing.
            const pickN = normName(g.pick || "");
            const winN = normName(citoWin.name || "");
            const should = (pickN && winN)
              ? (pickN === winN ? "win" : "loss")
              : (citoWin.corner === String(g.pick_corner || "").toLowerCase() ? "win" : "loss");
            if (should !== g.result) {
              const fixIso = new Date().toISOString();
              await c
                .from("ufc_picks")
                .update({ result: should, winner_name: citoWin.name || null, graded_at: fixIso, updated_at: fixIso })
                .eq("bout_id", String(bout.id));
              corrected++;
              console.error(
                `[UFC grade] CORRECTED bout ${bout.id} (${g.event_slug}): ${g.result} -> ${should}. ` +
                `Cito winner is ${citoWin.name || "?"}; we had recorded ${g.winner_name || "?"}. ` +
                `The original grade came from a source that has since changed its answer.`
              );
            }
          }
        }
        continue; // not one of our pending picks
      }

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
          .update({ result, winner_name: win.name || null, settled_by: winSource, graded_at: nowIso, updated_at: nowIso }) // WZ-UFC-SRCLAG-2026-08-01 :: which feed actually settled it
          .eq("bout_id", String(bout.id));
        if (winSource === "espn") console.log(`[UFC grade] bout ${bout.id} settled from ESPN (winner=${win.name || "?"})`);
        graded++;
      } else if (NO_WINNER_RE.test(String(bout.status || ""))) { // WZ-UFC-PUSHNARROW-2026-08-01
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
    `[UFC grade] ${graded} win/loss, ${pushed} push, ${corrected} CORRECTED, ${stillPending} still pending, ${orphans.length} ORPHANED across ${gradableSlugs.length} event(s)`
  );
  return finish({ graded, pushed, corrected, conflicts, stillPending, events: gradableSlugs.length, orphans, emptyEvents });
}

module.exports = { gradeUFCPicks, getLastGradeReport }; // WZ-UFC-ORPHAN-2026-07-27
