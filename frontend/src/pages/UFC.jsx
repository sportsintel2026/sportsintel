// UFC.jsx :: WZ-UFC-PAGE-2026-07-09 / WZ-UFC-ODDS-2026-07-09
// Self-contained UFC/MMA card page (the "Edges" view for UFC). Reads /api/ufc/card and renders
// the upcoming fights on the WizePicks Terminal skin. When the Odds API is wired, each fight
// shows a market-anchored PICK (the favorite) + a de-vigged WIN% ring; the picked fighter is
// highlighted in gold. EDGE stays "pending" until a real fighter model is added (edge = beating
// the market, which a market-anchored pick can't claim). If odds are missing, it degrades to the
// schedule with a PENDING pick. Additive: brand-new page, scoped `ufc-` classes, no global CSS.

import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const CSS = `
.ufc-wrap{min-height:100vh;background:#0A0B0D;color:#ECEFF2;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:0 0 96px}
.ufc-in{max-width:480px;margin:0 auto;padding:14px 12px 0}

.ufc-note{display:flex;align-items:flex-start;gap:8px;margin:2px 4px 0;padding:10px 12px;border:1px solid rgba(201,168,106,.28);background:rgba(201,168,106,.06);border-radius:10px;font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.3px;color:#C9A86A;line-height:1.5}
.ufc-note.live{border-color:rgba(63,203,145,.28);background:rgba(63,203,145,.06);color:#3FCB91}
.ufc-note b{color:#ECEFF2}

.ufc-evt{margin:12px 4px 0;padding:15px 16px 14px;border:1px solid rgba(255,255,255,.06);border-radius:16px;background:radial-gradient(120% 100% at 100% 0,rgba(201,168,106,.11),transparent 55%),#0C0D10}
.ufc-evt .k{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;color:#C9A86A;text-transform:uppercase}
.ufc-evt .n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:28px;line-height:1;margin-top:5px;letter-spacing:.5px}
.ufc-evt .m{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#99A2AA;margin-top:6px}

.ufc-tier{display:flex;align-items:center;gap:9px;margin:20px 8px 9px}
.ufc-tier .t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;letter-spacing:1.3px;color:#ECEFF2;text-transform:uppercase}
.ufc-tier .l{flex:1;height:1px;background:rgba(255,255,255,.12)}
.ufc-tier .c{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C}

.ufc-grid{margin:0 4px;background:#0C0D10;border-radius:14px;overflow:hidden}
.ufc-f{display:flex;align-items:center;gap:11px;padding:14px;border-top:1px solid rgba(255,255,255,.06)}
.ufc-f:first-child{border-top:none}
.ufc-corners{flex:1;min-width:0}
.ufc-row1{display:flex;align-items:center;gap:8px}
.ufc-fa,.ufc-fb{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#99A2AA}
.ufc-fa.pick,.ufc-fb.pick{color:#C9A86A}
.ufc-vs{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;flex:0 0 auto;padding:0 1px}
.ufc-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.ufc-dot.r{background:#E2655C}.ufc-dot.b{background:#5DA9E8}
.ufc-sub{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;margin-top:5px;letter-spacing:.2px}
.ufc-sub b{color:#99A2AA}

.ufc-ring{flex:0 0 44px;width:44px;height:44px;position:relative}
.ufc-ring svg{transform:rotate(-90deg)}
.ufc-ring .pc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ufc-ring .pct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;color:#ECEFF2;line-height:1}
.ufc-ring .pl{font-family:'IBM Plex Mono',monospace;font-size:5.5px;letter-spacing:.5px;color:#C9A86A;margin-top:1px}

.ufc-pend{flex:0 0 auto;text-align:right}
.ufc-pend .l{font-family:'IBM Plex Mono',monospace;font-size:7px;letter-spacing:.5px;color:#5B646C;text-transform:uppercase}
.ufc-pend .v{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:12px;color:#99A2AA;line-height:1.1;margin-top:2px}

.ufc-state{margin:40px 12px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5B646C;line-height:1.9}
.ufc-state .big{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:#99A2AA;letter-spacing:1px;display:block;margin-bottom:6px}
.ufc-retry{margin-top:14px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#C9A86A;border:1px solid rgba(201,168,106,.4);border-radius:8px;padding:8px 16px;cursor:pointer;background:none}
.ufc-skel{height:70px;margin:0 4px;border-top:1px solid rgba(255,255,255,.06);background:linear-gradient(90deg,#0C0D10,#14171B,#0C0D10);background-size:200% 100%;animation:ufcsh 1.3s linear infinite}
@keyframes ufcsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
`;

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
      " \u00b7 " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch (_) { return ""; }
}
function fmtOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "+" + n : "" + n;
}

export default function UFCPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/ufc/card`);
      if (!res.ok) throw new Error("status " + res.status);
      setData(await res.json());
    } catch (e) {
      console.error("Failed to load UFC card:", e);
      setError(true); setData(null);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const fights = (data && Array.isArray(data.fights)) ? data.fights : [];
  const picksLive = !!(data && data.picksLive);
  const first = fights[0] || null;
  const eventMeta = first ? [fmtWhen(first.time), first.venue, first.city].filter(Boolean).join(" \u00b7 ") : "";

  return (
    <div className="ufc-wrap">
      <style>{CSS}</style>
      <div className="ufc-in">

        {picksLive ? (
          <div className="ufc-note live">
            <span>&#9679;</span>
            <span><b>Market winners live.</b> Pick &amp; win% come from the de-vigged moneyline. Edge (beating the price) turns on once the fighter model is wired.</span>
          </div>
        ) : (
          <div className="ufc-note">
            <span>&#9679;</span>
            <span><b>Model pending.</b> Live fight card below. Win%, picks &amp; edges turn on once fighter odds and the model are wired &mdash; no fake numbers until then.</span>
          </div>
        )}

        {loading && (
          <>
            <div className="ufc-evt"><div className="k">Next Event</div><div className="n">Loading Card&hellip;</div></div>
            <div className="ufc-tier"><span className="t">Upcoming</span><span className="l"></span></div>
            <div className="ufc-grid"><div className="ufc-skel"></div><div className="ufc-skel"></div><div className="ufc-skel"></div></div>
          </>
        )}

        {!loading && error && (
          <div className="ufc-state">
            <span className="big">Couldn&rsquo;t Load</span>
            The UFC card didn&rsquo;t load.
            <br /><button className="ufc-retry" onClick={load}>Try again</button>
          </div>
        )}

        {!loading && !error && fights.length === 0 && (
          <div className="ufc-state">
            <span className="big">No Card Scheduled</span>
            There&rsquo;s no upcoming UFC card right now.<br />Check back when the next event is announced.
          </div>
        )}

        {!loading && !error && fights.length > 0 && (
          <>
            <div className="ufc-evt">
              <div className="k">Next Event</div>
              <div className="n">UFC Fight Card</div>
              {eventMeta && <div className="m">{eventMeta}</div>}
            </div>

            <div className="ufc-tier"><span className="t">Upcoming</span><span className="l"></span><span className="c">{fights.length} FIGHTS</span></div>

            <div className="ufc-grid">
              {fights.map((f, i) => {
                const hasPick = f && f.winPct != null;
                const aPick = hasPick && f.pickCorner === "A";
                const bPick = hasPick && f.pickCorner === "B";
                const dash = hasPick ? Math.round((f.winPct / 100) * 104) : 0;
                return (
                  <div className="ufc-f" key={f.id || i}>
                    <div className="ufc-corners">
                      <div className="ufc-row1">
                        <span className="ufc-dot r"></span>
                        <span className={"ufc-fa" + (aPick ? " pick" : "")}>{f.fighterA}</span>
                        <span className="ufc-vs">VS</span>
                        <span className={"ufc-fb" + (bPick ? " pick" : "")}>{f.fighterB}</span>
                        <span className="ufc-dot b"></span>
                      </div>
                      <div className="ufc-sub">
                        {hasPick
                          ? <>Pick: <b>{f.pick}</b>{f.odds != null ? " " + fmtOdds(f.odds) : ""} &middot; {[fmtWhen(f.time)].filter(Boolean).join("")}</>
                          : ([fmtWhen(f.time), f.venue].filter(Boolean).join(" \u00b7 ") || "Time TBA")}
                      </div>
                    </div>
                    {hasPick ? (
                      <div className="ufc-ring">
                        <svg width="44" height="44">
                          <circle cx="22" cy="22" r="16.5" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="4" />
                          <circle cx="22" cy="22" r="16.5" fill="none" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${dash} 104`} />
                        </svg>
                        <div className="pc"><span className="pct">{f.winPct}%</span><span className="pl">WIN</span></div>
                      </div>
                    ) : (
                      <div className="ufc-pend"><div className="l">Pick</div><div className="v">PENDING</div></div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
