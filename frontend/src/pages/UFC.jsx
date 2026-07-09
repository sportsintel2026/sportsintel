// UFC.jsx :: WZ-UFC-PAGE-2026-07-09 / WZ-UFC-ODDS-2026-07-09 / WZ-UFC-CITO-2026-07-09
// UFC/MMA card page (the "Edges" view for UFC). Reads /api/ufc/card, which returns the next
// PPV event only, split into Main Card / Prelims, with weight classes, title badges, fighter
// records + headshots (Cito), and a de-vigged market pick + win% ring (odds). Fighters render
// as a face-off (red corner vs blue corner); the model's pick is highlighted gold. EDGE stays
// "pending" until a fighter model beats the market. Self-contained scoped `ufc-` styles.

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
.ufc-tier .t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;letter-spacing:1.4px;color:#ECEFF2;text-transform:uppercase}
.ufc-tier .l{flex:1;height:1px;background:rgba(255,255,255,.12)}
.ufc-tier .c{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C}

.ufc-grid{margin:0 4px;background:#0C0D10;border-radius:14px;overflow:hidden}
.ufc-b{padding:12px 12px 13px;border-top:1px solid rgba(255,255,255,.06)}
.ufc-b:first-child{border-top:none}
.ufc-b.main{background:linear-gradient(90deg,rgba(201,168,106,.06),transparent 70%)}
.ufc-btop{display:flex;align-items:center;gap:8px}
.ufc-side{flex:1;min-width:0;display:flex;align-items:center;gap:9px}
.ufc-side.r{flex-direction:row}
.ufc-side.b{flex-direction:row-reverse;text-align:right}
.ufc-av{width:44px;height:44px;border-radius:50%;flex:0 0 44px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#1B2025;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;color:#99A2AA}
.ufc-av img{width:100%;height:100%;object-fit:cover;object-position:top}
.ufc-av.r{border:2px solid #E2655C}.ufc-av.b{border:2px solid #5DA9E8}
.ufc-nm{min-width:0}
.ufc-nm .fn{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;letter-spacing:.2px;line-height:1.0;color:#ECEFF2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ufc-nm .fn.pick{color:#C9A86A}
.ufc-nm .rec{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;margin-top:2px}
.ufc-mid{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:0 2px}
.ufc-ring{width:42px;height:42px;position:relative}
.ufc-ring svg{transform:rotate(-90deg)}
.ufc-ring .pc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ufc-ring .pct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:13px;color:#ECEFF2;line-height:1}
.ufc-ring .pl{font-family:'IBM Plex Mono',monospace;font-size:5px;letter-spacing:.4px;color:#C9A86A}
.ufc-vs{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:13px;color:#5B646C;letter-spacing:1px}
.ufc-bbot{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:8px;padding-left:2px}
.ufc-wc{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.4px;color:#99A2AA;text-transform:uppercase}
.ufc-badge{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:.4px;border-radius:4px;padding:1px 5px}
.ufc-badge.title{color:#C9A86A;border:1px solid rgba(201,168,106,.5);background:rgba(201,168,106,.08)}
.ufc-badge.pick{color:#3FCB91;border:1px solid rgba(63,203,145,.4);background:rgba(63,203,145,.07)}
.ufc-badge.value{color:#C9A86A;border:1px solid rgba(201,168,106,.55);background:rgba(201,168,106,.12)}
.ufc-bbot .edge{font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;color:#3FCB91;flex:0 0 auto}
.ufc-bbot .edge.neg{color:#5B646C}
.ufc-bbot .odds{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C}

.ufc-state{margin:40px 12px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5B646C;line-height:1.9}
.ufc-state .big{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:#99A2AA;letter-spacing:1px;display:block;margin-bottom:6px}
.ufc-retry{margin-top:14px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#C9A86A;border:1px solid rgba(201,168,106,.4);border-radius:8px;padding:8px 16px;cursor:pointer;background:none}
.ufc-skel{height:74px;margin:0 4px;border-top:1px solid rgba(255,255,255,.06);background:linear-gradient(90deg,#0C0D10,#14171B,#0C0D10);background-size:200% 100%;animation:ufcsh 1.3s linear infinite}
@keyframes ufcsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
`;

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/);
  const last = parts[parts.length - 1] || "";
  return (last.slice(0, 2) || "--").toUpperCase();
}
function fmtOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "+" + n : "" + n;
}

function Avatar({ src, name, corner }) {
  const [err, setErr] = useState(false);
  return (
    <div className={"ufc-av " + corner}>
      {src && !err
        ? <img src={src} alt="" onError={() => setErr(true)} />
        : <span>{initials(name)}</span>}
    </div>
  );
}

function Bout({ b, main }) {
  const hasPick = b && b.winPct != null;
  const redPick = hasPick && b.pickCorner === "red";
  const bluePick = hasPick && b.pickCorner === "blue";
  const dash = hasPick ? Math.round((b.winPct / 100) * 104) : 0;
  return (
    <div className={"ufc-b" + (main ? " main" : "")}>
      <div className="ufc-btop">
        <div className="ufc-side r">
          <Avatar src={b.red && b.red.headshot} name={b.red && b.red.name} corner="r" />
          <div className="ufc-nm">
            <div className={"fn" + (redPick ? " pick" : "")}>{b.red ? b.red.name : "TBD"}</div>
            {b.red && b.red.record ? <div className="rec">{b.red.record}</div> : null}
          </div>
        </div>
        <div className="ufc-mid">
          {hasPick ? (
            <div className="ufc-ring">
              <svg width="42" height="42">
                <circle cx="21" cy="21" r="16.5" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="4" />
                <circle cx="21" cy="21" r="16.5" fill="none" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${dash} 104`} />
              </svg>
              <div className="pc"><span className="pct">{b.winPct}%</span><span className="pl">WIN</span></div>
            </div>
          ) : (
            <span className="ufc-vs">VS</span>
          )}
        </div>
        <div className="ufc-side b">
          <Avatar src={b.blue && b.blue.headshot} name={b.blue && b.blue.name} corner="b" />
          <div className="ufc-nm">
            <div className={"fn" + (bluePick ? " pick" : "")}>{b.blue ? b.blue.name : "TBD"}</div>
            {b.blue && b.blue.record ? <div className="rec">{b.blue.record}</div> : null}
          </div>
        </div>
      </div>
      <div className="ufc-bbot">
        {b.weightClass ? <span className="ufc-wc">{b.weightClass}</span> : null}
        {b.titleBout ? <span className="ufc-badge title">TITLE</span> : null}
        {b.value ? <span className="ufc-badge value">+VALUE</span> : null}
        {hasPick ? <span className="ufc-badge pick">PICK: {b.pick}{b.odds != null ? " " + fmtOdds(b.odds) : ""}</span> : null}
        {hasPick && b.edgePct != null && b.edgePct !== 0
          ? <span className={"edge" + (b.edgePct < 0 ? " neg" : "")}>{b.edgePct > 0 ? "+" : ""}{b.edgePct}% edge</span>
          : null}
      </div>
    </div>
  );
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

  const event = data && data.event;
  const mainCard = (data && Array.isArray(data.mainCard)) ? data.mainCard : [];
  const prelims = (data && Array.isArray(data.prelims)) ? data.prelims : [];
  const total = mainCard.length + prelims.length;
  const picksLive = !!(data && data.picksLive);

  return (
    <div className="ufc-wrap">
      <style>{CSS}</style>
      <div className="ufc-in">

        {picksLive ? (
          <div className="ufc-note live">
            <span>&#9679;</span>
            <span><b>Model picks live.</b> Win% is our fighter model; <b>+VALUE</b> flags where the model beats the market price. Model is new &mdash; it grades live starting this card.</span>
          </div>
        ) : (
          <div className="ufc-note">
            <span>&#9679;</span>
            <span><b>Odds pending.</b> The card is live below. Picks &amp; win% light up when the sportsbooks post moneylines (usually the week of the fight).</span>
          </div>
        )}

        {loading && (
          <>
            <div className="ufc-evt"><div className="k">Next Event</div><div className="n">Loading Card&hellip;</div></div>
            <div className="ufc-tier"><span className="t">Main Card</span><span className="l"></span></div>
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

        {!loading && !error && total === 0 && (
          <div className="ufc-state">
            <span className="big">No Card Scheduled</span>
            There&rsquo;s no upcoming UFC pay-per-view right now.<br />Check back when the next card is announced.
          </div>
        )}

        {!loading && !error && total > 0 && (
          <>
            <div className="ufc-evt">
              <div className="k">Next Event</div>
              <div className="n">{event ? event.name : "UFC Fight Card"}</div>
              {event && (event.dateLabel || event.venue) ? (
                <div className="m">{[event.dateLabel, event.venue, event.city].filter(Boolean).join(" \u00b7 ")}</div>
              ) : null}
            </div>

            {mainCard.length > 0 && (
              <>
                <div className="ufc-tier"><span className="t">Main Card</span><span className="l"></span><span className="c">{mainCard.length} FIGHTS</span></div>
                <div className="ufc-grid">
                  {mainCard.map((b, i) => <Bout key={b.id || "m" + i} b={b} main />)}
                </div>
              </>
            )}

            {prelims.length > 0 && (
              <>
                <div className="ufc-tier"><span className="t">{mainCard.length > 0 ? "Prelims" : "Upcoming"}</span><span className="l"></span><span className="c">{prelims.length} FIGHTS</span></div>
                <div className="ufc-grid">
                  {prelims.map((b, i) => <Bout key={b.id || "p" + i} b={b} />)}
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
