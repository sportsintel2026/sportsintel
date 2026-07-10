// UFC.jsx :: WZ-UFC-PAGE-2026-07-09 / WZ-UFC-ODDS-2026-07-09 / WZ-UFC-CITO-2026-07-09 / WZ-UFC-CARDV2-2026-07-09
// UFC/MMA card page. Reads /api/ufc/card (next PPV only, Main Card / Prelims). Card layout
// (Option 1, approved): face-off up top with the MODEL'S PICK in GOLD (gold headshot + gold name),
// then a clear PICK BAR below -- win% ring next to "OUR PICK: [fighter] [odds]" -- so there is no
// ambiguity about who we picked or whose win% the ring is. Color rule: GOLD = our pick everywhere;
// GREEN = the edge / value only. Fights with no posted odds show a plain "ODDS PENDING" bar.
// No top banner (removed by request).

import { useState, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const CSS = `
.ufc-wrap{min-height:100vh;background:#0A0B0D;color:#ECEFF2;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:0 0 96px}
.ufc-in{max-width:480px;margin:0 auto;padding:14px 12px 0}

.ufc-evt{margin:2px 4px 0;padding:15px 16px 14px;border:1px solid rgba(255,255,255,.06);border-radius:16px;background:radial-gradient(120% 100% at 100% 0,rgba(201,168,106,.11),transparent 55%),#0C0D10}
.ufc-evt .k{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;color:#C9A86A;text-transform:uppercase}
.ufc-evt .n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:28px;line-height:1;margin-top:5px;letter-spacing:.5px}
.ufc-evt .m{font-family:'IBM Plex Mono',monospace;font-size:10px;color:#99A2AA;margin-top:6px}

.ufc-tier{display:flex;align-items:center;gap:9px;margin:20px 8px 9px}
.ufc-tier .t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;letter-spacing:1.4px;color:#ECEFF2;text-transform:uppercase}
.ufc-tier .l{flex:1;height:1px;background:rgba(255,255,255,.12)}
.ufc-tier .c{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C}

.ufc-grid{margin:0 4px;display:flex;flex-direction:column;gap:10px}
.ufc-b{background:#0C0D10;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px}
.ufc-b.main{border-color:rgba(201,168,106,.16)}

.ufc-head{display:flex;align-items:center;gap:7px;margin-bottom:10px}
.ufc-wc{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.6px;color:#99A2AA;text-transform:uppercase}
.ufc-title{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:.5px;color:#C9A86A;border:1px solid rgba(201,168,106,.5);background:rgba(201,168,106,.09);border-radius:4px;padding:1px 5px}

.ufc-fo{display:flex;align-items:center;gap:8px}
.ufc-side{flex:1;min-width:0;display:flex;align-items:center;gap:9px}
.ufc-side.b{flex-direction:row-reverse;text-align:right}
.ufc-av{width:46px;height:46px;border-radius:50%;flex:0 0 46px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#1B2025;border:2px solid rgba(255,255,255,.14);font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;color:#99A2AA}
.ufc-av img{width:100%;height:100%;object-fit:cover;object-position:top}
.ufc-av.pick{border-color:#C9A86A;box-shadow:0 0 0 3px rgba(201,168,106,.14)}
.ufc-nm{min-width:0}
.ufc-nm .fn{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;letter-spacing:.2px;line-height:1.0;color:#8B939B;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ufc-nm .fn.pick{color:#C9A86A}
.ufc-nm .rec{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;margin-top:3px}
.ufc-vs{flex:0 0 auto;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:13px;color:#5B646C;letter-spacing:1px;padding:0 2px}

/* pick bar -- GOLD pick, GREEN edge/value */
.ufc-pb{display:flex;align-items:center;gap:10px;margin-top:11px;padding:8px 11px;border-radius:10px;background:rgba(201,168,106,.05);border:1px solid rgba(201,168,106,.16)}
.ufc-pb.val{background:rgba(63,203,145,.07);border-color:rgba(63,203,145,.28)}
.ufc-pb.pending{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.07);justify-content:center}
.ufc-ring{flex:0 0 40px;width:40px;height:40px;position:relative}
.ufc-ring svg{transform:rotate(-90deg)}
.ufc-ring .pc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ufc-ring .pct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:13px;color:#ECEFF2;line-height:1}
.ufc-ring .pl{font-family:'IBM Plex Mono',monospace;font-size:5px;letter-spacing:.4px;color:#C9A86A}
.ufc-pbmid{flex:1;min-width:0}
.ufc-pbmid .lbl{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:1px;color:#5B646C;text-transform:uppercase}
.ufc-pbmid .who{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;color:#C9A86A;letter-spacing:.2px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ufc-pbmid .who .od{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#99A2AA;margin-left:5px}
.ufc-pbright{flex:0 0 auto;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.ufc-vbadge{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.4px;color:#3FCB91;border:1px solid rgba(63,203,145,.5);background:rgba(63,203,145,.12);border-radius:4px;padding:1px 5px}
.ufc-edge{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:#3FCB91}
.ufc-edge.neg{color:#5B646C}
.ufc-pb.pending .pnd{font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.5px;color:#5B646C}

/* WZ-UFC-METHOD-2026-07-09 :: method LEAN -- info-only handicapping read. Neutral/gold, never green
   (green is reserved for market-beating edge/value). "READ" tag makes clear it is not a priced bet. */
.ufc-lean{display:flex;align-items:center;gap:8px;margin-top:8px;padding:6px 10px;border-radius:9px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)}
.ufc-lean .tag{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:1px;color:#C9A86A;border:1px solid rgba(201,168,106,.4);border-radius:4px;padding:1px 5px;flex:0 0 auto}
.ufc-lean .txt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13.5px;letter-spacing:.3px;color:#ECEFF2;flex:0 0 auto}
.ufc-lean .sub{font-family:'IBM Plex Mono',monospace;font-size:8.5px;color:#5B646C;margin-left:auto;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.ufc-state{margin:40px 12px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5B646C;line-height:1.9}
.ufc-state .big{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:#99A2AA;letter-spacing:1px;display:block;margin-bottom:6px}
.ufc-retry{margin-top:14px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#C9A86A;border:1px solid rgba(201,168,106,.4);border-radius:8px;padding:8px 16px;cursor:pointer;background:none}
.ufc-skel{height:120px;margin:0 4px 10px;border-radius:14px;background:linear-gradient(90deg,#0C0D10,#14171B,#0C0D10);background-size:200% 100%;animation:ufcsh 1.3s linear infinite}
@keyframes ufcsh{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* WZ-UFC-CARDV4-2026-07-09 :: Clean Confidence fight card. Red corner left, blue right; GOLD = our
   pick. A single calm gold bar fills to the pick's model win% -- how strong the pick is, at a glance.
   Larger headshots per request. Sits inside the existing .ufc-grid. */
.kc-card{border:1px solid rgba(255,255,255,.07);border-radius:14px;background:#0C0D10;padding:13px 14px 14px}
.kc-card.main{border-color:rgba(201,168,106,.16)}
.kc-top{display:flex;align-items:center;gap:7px;margin-bottom:13px}
.kc-wc{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:1px;color:#99A2AA;text-transform:uppercase}
.kc-title{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:.5px;color:#C9A86A;border:1px solid rgba(201,168,106,.5);border-radius:4px;padding:1px 5px}
.kc-sp{flex:1}
.kc-read{font-family:'IBM Plex Mono',monospace;font-size:8px;color:#8b939b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}
.kc-read i{font-style:normal;color:#5B646C;font-weight:700;letter-spacing:.5px;margin-right:5px}
.kc-names{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.kc-side{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.kc-side.b{flex-direction:row-reverse;text-align:right}
.kc-av{width:46px;height:46px;border-radius:50%;flex:0 0 46px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#1B2025;border:2px solid rgba(255,255,255,.14);font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;color:#99A2AA}
.kc-av img{width:100%;height:100%;object-fit:cover;object-position:top}
.kc-side.red .kc-av{border-color:rgba(224,107,98,.5)}
.kc-side.blue .kc-av{border-color:rgba(91,141,239,.5)}
.kc-side.pick .kc-av{border-color:#C9A86A;box-shadow:0 0 0 3px rgba(201,168,106,.15)}
.kc-nm{min-width:0;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:18px;line-height:1;letter-spacing:.2px;color:#8b939b;overflow:hidden;text-overflow:ellipsis}
.kc-side.pick .kc-nm{color:#C9A86A}
.kc-nm .od{display:block;font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:500;color:#5B646C;margin-top:3px}
.kc-conf{margin-bottom:12px}
.kc-track{position:relative;height:6px;border-radius:4px;background:#14171B;overflow:hidden}
.kc-fill{position:absolute;top:0;left:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#e7cf9a,#C9A86A);transition:width .5s cubic-bezier(.4,0,.2,1)}
.kc-scale{display:flex;justify-content:space-between;margin-top:5px}
.kc-scale span{font-family:'IBM Plex Mono',monospace;font-size:7.5px;color:#5B646C;text-transform:uppercase;letter-spacing:.5px}
.kc-foot{display:flex;align-items:center;gap:8px}
.kc-pick{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.5px;color:#5B646C;text-transform:uppercase}
.kc-pick b{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;color:#C9A86A;letter-spacing:.3px;margin-left:6px;text-transform:none}
.kc-badge{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.3px;color:#3FCB91;border:1px solid rgba(63,203,145,.5);background:rgba(63,203,145,.12);border-radius:4px;padding:2px 6px}
.kc-edge{font-family:'IBM Plex Mono',monospace;font-size:9.5px;font-weight:600;color:#3FCB91}
.kc-edge.flat{color:#5B646C}
.kc-pending{font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.5px;color:#5B646C;text-align:center;padding:11px;border:1px dashed rgba(255,255,255,.07);border-radius:8px}
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

function Avatar({ src, name, isPick, cls }) {
  const [err, setErr] = useState(false);
  return (
    <div className={(cls || "ufc-av") + (isPick ? " pick" : "")}>
      {src && !err ? <img src={src} alt="" onError={() => setErr(true)} /> : <span>{initials(name)}</span>}
    </div>
  );
}

function Bout({ b, main }) {
  const hasPick = b && b.winPct != null;
  const redPick = hasPick && b.pickCorner === "red";
  const bluePick = hasPick && b.pickCorner === "blue";
  const value = !!(b && b.value);
  const lean = b.methodLean && b.methodLean.lean && b.methodLean.lean !== "EVEN" ? b.methodLean : null;
  return (
    <div className={"kc-card" + (main ? " main" : "")}>
      <div className="kc-top">
        {b.weightClass ? <span className="kc-wc">{b.weightClass}</span> : null}
        {b.titleBout ? <span className="kc-title">TITLE</span> : null}
        <span className="kc-sp" />
        {lean ? <span className="kc-read"><i>READ</i>{lean.label}</span> : null}
      </div>

      <div className="kc-names">
        <div className={"kc-side red" + (redPick ? " pick" : "")}>
          <Avatar cls="kc-av" src={b.red && b.red.headshot} name={b.red && b.red.name} isPick={redPick} />
          <div className="kc-nm">{b.red ? b.red.name : "TBD"}
            {b.red && b.red.odds != null ? <span className="od">{fmtOdds(b.red.odds)}</span> : null}
          </div>
        </div>
        <div className={"kc-side blue b" + (bluePick ? " pick" : "")}>
          <Avatar cls="kc-av" src={b.blue && b.blue.headshot} name={b.blue && b.blue.name} isPick={bluePick} />
          <div className="kc-nm">{b.blue ? b.blue.name : "TBD"}
            {b.blue && b.blue.odds != null ? <span className="od">{fmtOdds(b.blue.odds)}</span> : null}
          </div>
        </div>
      </div>

      {hasPick ? (
        <>
          <div className="kc-conf">
            <div className="kc-track"><div className="kc-fill" style={{ width: b.winPct + "%" }} /></div>
            <div className="kc-scale"><span>even</span><span>strong</span></div>
          </div>
          <div className="kc-foot">
            <span className="kc-pick">Pick<b>{b.pick} {b.winPct}%</b></span>
            <span className="kc-sp" />
            {value ? <span className="kc-badge">+VALUE</span> : null}
            {b.edgePct != null ? <span className={"kc-edge" + (value ? "" : " flat")}>{b.edgePct > 0 ? "+" : ""}{b.edgePct}% edge</span> : null}
          </div>
        </>
      ) : (
        <div className="kc-pending">ODDS PENDING &mdash; no line posted yet</div>
      )}
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

  return (
    <div className="ufc-wrap">
      <style>{CSS}</style>
      <div className="ufc-in">

        {loading && (
          <>
            <div className="ufc-evt"><div className="k">Next Event</div><div className="n">Loading Card&hellip;</div></div>
            <div className="ufc-tier"><span className="t">Main Card</span><span className="l"></span></div>
            <div className="ufc-grid"><div className="ufc-skel"></div><div className="ufc-skel"></div></div>
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
                <div className="ufc-grid">{mainCard.map((b, i) => <Bout key={b.id || "m" + i} b={b} main />)}</div>
              </>
            )}

            {prelims.length > 0 && (
              <>
                <div className="ufc-tier"><span className="t">{mainCard.length > 0 ? "Prelims" : "Upcoming"}</span><span className="l"></span><span className="c">{prelims.length} FIGHTS</span></div>
                <div className="ufc-grid">{prelims.map((b, i) => <Bout key={b.id || "p" + i} b={b} />)}</div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
