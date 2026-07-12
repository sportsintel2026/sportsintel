// UFC.jsx :: WZ-UFC-PAGE-2026-07-09 / WZ-UFC-ODDS-2026-07-09 / WZ-UFC-CITO-2026-07-09 / WZ-UFC-CARDV2-2026-07-09
// UFC/MMA card page. Reads /api/ufc/card (next PPV only, Main Card / Prelims). Card layout
// (Option 1, approved): face-off up top with the MODEL'S PICK in GOLD (gold headshot + gold name),
// then a clear PICK BAR below -- win% ring next to "OUR PICK: [fighter] [odds]" -- so there is no
// ambiguity about who we picked or whose win% the ring is. Color rule: GOLD = our pick everywhere;
// GREEN = the edge / value only. Fights with no posted odds show a plain "ODDS PENDING" bar.
// No top banner (removed by request).

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { subscriptionApi } from "../lib/api";
import TerminalShell from "./TerminalShell";
// WZ-UFC-DESKTOP-2026-07-11 :: UFC card gains a desktop layout inside the shared Vault shell; mobile untouched.

const API_BASE = import.meta.env.VITE_API_URL || "";

const CSS = `
.ufc-wrap{min-height:100vh;background:#0A0B0D;color:#ECEFF2;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:0 0 96px}
.ufc-in{max-width:480px;margin:0 auto;padding:14px 12px 0}

.ufc-evt{margin:2px 4px 0;padding:15px 16px 14px;border:1px solid rgba(255,255,255,.06);border-radius:16px;background:radial-gradient(120% 100% at 100% 0,rgba(201,168,106,.11),transparent 55%),#0C0D10}
.ufc-evt .k{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;color:#C9A86A;text-transform:uppercase}
.ufc-evt .k.live{color:#3FCB91}
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

/* WZ-UFC-STATUS-2026-07-11 :: fight-status badge + FINAL (won/lost/push) states */
.ufc-head .ufc-sp{flex:1}
.ufc-st{font-family:'IBM Plex Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.6px;padding:2px 8px;border-radius:999px;white-space:nowrap}
.ufc-st.await{color:#C9A86A;border:1px solid rgba(201,168,106,.42)}
.ufc-st.fin{color:#C9A86A;border:1px solid rgba(201,168,106,.32);background:rgba(201,168,106,.08)}
.ufc-av.won{border-color:#3FCB91;box-shadow:0 0 0 3px rgba(63,203,145,.16)}
.ufc-av.dim{filter:grayscale(.7) brightness(.62);border-color:rgba(255,255,255,.08)}
.ufc-nm .fn.win{color:#3FCB91}
.ufc-nm .fn.dim{color:#5B646C}
.ufc-pb.win{background:rgba(63,203,145,.07);border-color:rgba(63,203,145,.30)}
.ufc-pb.loss{background:rgba(226,101,92,.06);border-color:rgba(226,101,92,.28)}
.ufc-pb.push{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.08)}
.ufc-res{font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.6px;padding:4px 10px;border-radius:6px}
.ufc-res.w{color:#3FCB91;background:rgba(63,203,145,.12);border:1px solid rgba(63,203,145,.32)}
.ufc-res.l{color:#E2655C;background:rgba(226,101,92,.12);border:1px solid rgba(226,101,92,.30)}
.ufc-res.p{color:#99A2AA;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10)}

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

.ufc-reclink{margin-top:11px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.5px;color:#C9A86A;border:1px solid rgba(201,168,106,.3);border-radius:8px;padding:6px 12px;cursor:pointer}
.ufc-reclink:hover{background:rgba(201,168,106,.08)}
@media (min-width:1024px){
  .ufc-wrap{background:transparent;padding:0 0 40px}
  .ufc-in{max-width:none;margin:0;padding:20px 26px 0}
  .ufc-evt{max-width:none}
  .ufc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;margin:0}
}
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

function Avatar({ src, name, isPick, won, dim }) {
  const [err, setErr] = useState(false);
  return (
    <div className={"ufc-av" + (isPick ? " pick" : "") + (won ? " won" : "") + (dim ? " dim" : "")}>
      {src && !err ? <img src={src} alt="" onError={() => setErr(true)} /> : <span>{initials(name)}</span>}
    </div>
  );
}

function Bout({ b, main }) {
  const hasPick = b && b.winPct != null;
  // WZ-UFC-STATUS-2026-07-11 :: fight status from data we already have.
  // result (win/loss/push) once the grader settles -> FINAL. lineClosed with no result yet
  // (book pulled the line, Cito hasn't posted the winner) -> AWAITING RESULT. Live line -> upcoming.
  const res = b && b.result;
  const isFinal = res === "win" || res === "loss" || res === "push";
  const awaiting = !isFinal && !!(b && b.lineClosed);
  // winner corner derived from result relative to our pick (win = our corner won; loss = the other)
  let winnerCorner = null;
  if (res === "win") winnerCorner = b.pickCorner;
  else if (res === "loss") winnerCorner = b.pickCorner === "red" ? "blue" : "red";
  const redWon = isFinal && winnerCorner === "red";
  const blueWon = isFinal && winnerCorner === "blue";
  const redDim = isFinal && res !== "push" && !redWon;
  const blueDim = isFinal && res !== "push" && !blueWon;
  const redPick = hasPick && b.pickCorner === "red";
  const bluePick = hasPick && b.pickCorner === "blue";
  const dash = hasPick ? Math.round((b.winPct / 100) * 104) : 0;
  const value = !!(b && b.value);
  const ringCol = res === "win" ? "#3FCB91" : res === "loss" ? "#E2655C" : "#C9A86A";
  const resChip = res === "win" ? ["w", "WON"] : res === "loss" ? ["l", "LOST"] : res === "push" ? ["p", "PUSH"] : null;
  return (
    <div className={"ufc-b" + (main ? " main" : "") + (isFinal ? " final " + res : "")}>
      <div className="ufc-head">
        {b.weightClass ? <span className="ufc-wc">{b.weightClass}</span> : null}
        {b.titleBout ? <span className="ufc-title">TITLE</span> : null}
        <span className="ufc-sp" />
        {isFinal ? <span className="ufc-st fin">FINAL</span>
          : awaiting ? <span className="ufc-st await">AWAITING RESULT</span>
          : null}
      </div>

      <div className="ufc-fo">
        <div className="ufc-side">
          <Avatar src={b.red && b.red.headshot} name={b.red && b.red.name} isPick={!isFinal && redPick} won={redWon} dim={redDim} />
          <div className="ufc-nm">
            <div className={"fn" + (redWon ? " win" : (!isFinal && redPick) ? " pick" : "") + (redDim ? " dim" : "")}>{b.red ? b.red.name : "TBD"}</div>
            {b.red && b.red.record ? <div className="rec">{b.red.record}</div> : null}
          </div>
        </div>
        <div className="ufc-vs">VS</div>
        <div className="ufc-side b">
          <Avatar src={b.blue && b.blue.headshot} name={b.blue && b.blue.name} isPick={!isFinal && bluePick} won={blueWon} dim={blueDim} />
          <div className="ufc-nm">
            <div className={"fn" + (blueWon ? " win" : (!isFinal && bluePick) ? " pick" : "") + (blueDim ? " dim" : "")}>{b.blue ? b.blue.name : "TBD"}</div>
            {b.blue && b.blue.record ? <div className="rec">{b.blue.record}</div> : null}
          </div>
        </div>
      </div>

      {hasPick ? (
        <div className={"ufc-pb" + (isFinal ? " " + res : value ? " val" : "")}>
          <div className="ufc-ring">
            <svg width="40" height="40">
              <circle cx="20" cy="20" r="16.5" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="4" />
              <circle cx="20" cy="20" r="16.5" fill="none" stroke={ringCol} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${dash} 104`} />
            </svg>
            <div className="pc"><span className="pct">{b.winPct}%</span><span className="pl">WIN</span></div>
          </div>
          <div className="ufc-pbmid">
            <div className="lbl">Our Pick</div>
            <div className="who">{b.pick}{b.odds != null ? <span className="od">{fmtOdds(b.odds)}</span> : null}</div>
          </div>
          <div className="ufc-pbright">
            {resChip ? <span className={"ufc-res " + resChip[0]}>{resChip[1]}</span> : (
              <>
                {value ? <span className="ufc-vbadge">+VALUE</span> : null}
                {b.edgePct != null ? <span className={"ufc-edge" + (b.edgePct < 0 ? " neg" : "")}>{b.edgePct > 0 ? "+" : ""}{b.edgePct}% edge</span> : null}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="ufc-pb pending"><span className="pnd">ODDS PENDING &mdash; no line posted yet</span></div>
      )}

      {b.methodLean && b.methodLean.lean && b.methodLean.lean !== "EVEN" && !isFinal ? (
        <div className="ufc-lean">
          <span className="tag">READ</span>
          <span className="txt">{b.methodLean.label}</span>
          {b.methodLean.note ? <span className="sub">{b.methodLean.note}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function UFCPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

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
    <TerminalShell active="/ufc" plan={plan} navigate={navigate}>
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
              <div className={"k" + (event && event.live ? " live" : "")}>{event && event.live ? "Live" : "Next Event"}</div>
              <div className="n">{event ? event.name : "UFC Fight Card"}</div>
              {event && (event.dateLabel || event.venue) ? (
                <div className="m">{[event.dateLabel, event.venue, event.city].filter(Boolean).join(" \u00b7 ")}</div>
              ) : null}
              <div className="ufc-reclink" onClick={() => navigate("/ufc-record")}>View record &rarr;</div>
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
    </TerminalShell>
  );
}
