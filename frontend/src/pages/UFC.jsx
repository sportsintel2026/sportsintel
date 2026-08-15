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
// WZ-UFC-WHY-2026-07-27 :: session cache so an opened bout fetches its AI (B) read at most once.
// Same pattern as the MLB board's AI_READ_CACHE in Home.jsx.
const AI_READ_CACHE = new Map();

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

/* WZ-UFC-WHY-2026-07-27 */
const WHY_CSS = `
.ufc-strip{margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;user-select:none}
.ufc-strip .s{font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;letter-spacing:1.6px;color:#7A838B;text-transform:uppercase}
.ufc-strip .cv{font-size:11px;color:#7A838B;transition:transform .22s ease;line-height:1}
.ufc-b.wopen .ufc-strip .cv{transform:rotate(180deg)}
.ufc-b.wopen .ufc-strip .s{color:#C9A86A}
.ufc-panel{max-height:0;overflow:hidden;transition:max-height .32s ease}
.ufc-b.wopen .ufc-panel{max-height:1200px}
.ufc-panel .pad{padding-top:11px}
.ufc-ft{display:flex;align-items:baseline;gap:6px;margin-bottom:9px}
.ufc-ft .k{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:1.3px;color:#5B646C;text-transform:uppercase}
.ufc-ft .dir{flex:1;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:7.5px;color:#4E565D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ufc-ft .dir b{color:#C9A86A;font-weight:600}
.ufc-fr{display:flex;align-items:center;gap:7px;padding:3.5px 0}
.ufc-fr .fn2{flex:0 0 58px;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#99A2AA;text-transform:uppercase;letter-spacing:.3px}
.ufc-fr .fd{flex:0 0 58px;font-family:'IBM Plex Mono',monospace;font-size:8.5px;color:#5B646C;white-space:nowrap;overflow:hidden}
.ufc-fr .fv{flex:0 0 34px;text-align:right;font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600}
.ufc-fr .fv.f1{color:#C9A86A}
.ufc-fr .fv.f0{color:#7A838B}
.ufc-bar{flex:1;height:6px;position:relative;background:rgba(255,255,255,.04);border-radius:2px;min-width:44px}
.ufc-bar:before{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,.15)}
.ufc-bar i{position:absolute;top:0;bottom:0;border-radius:2px;min-width:2px}
.ufc-bar i.l{right:50%}
.ufc-bar i.r{left:50%}
.ufc-bar i.f1{background:#C9A86A}
.ufc-bar i.f0{background:#6E7681}
.ufc-ft .dir .pk{color:#C9A86A;font-weight:600}
.ufc-fr .fv.nil{color:#4E565D;font-weight:400}
.ufc-tilt{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:9px;border-top:1px dashed rgba(255,255,255,.09)}
.ufc-tilt .k{flex:1;font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.3px;color:#99A2AA;text-transform:uppercase;line-height:1.4}
.ufc-tilt .k em{display:block;font-style:normal;color:#5B646C;font-size:8px;text-transform:none;letter-spacing:0;margin-top:2px}
.ufc-tilt .v{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:#C9A86A;white-space:nowrap;text-align:right}
.ufc-tilt .v.f0{color:#7A838B}
.ufc-tilt .v small{display:block;color:#5B646C;font-weight:400;font-size:8px;margin-top:2px}
.ufc-nofac{padding:10px 11px;border-radius:9px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#7A838B;line-height:1.6}
.ufc-read{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}
.ufc-read .rl{display:flex;align-items:center;gap:6px;margin-bottom:5px}
.ufc-read .rl .k{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:1.3px;color:#5B646C;text-transform:uppercase}
.ufc-read .rl .src{font-family:'IBM Plex Mono',monospace;font-size:7px;letter-spacing:.4px;border-radius:3px;padding:1px 4px;border:1px solid rgba(255,255,255,.14);color:#6E7681}
.ufc-read .tx{font-family:'IBM Plex Mono',monospace;font-size:10.5px;line-height:1.65;color:#ECEFF2}
.ufc-read .tx.det{color:#99A2AA}
`;

// WZ-UFC-WHY-2026-07-27 :: the deterministic "A" read, built from the factor list itself.
// No network, no API key, cannot fail -- this is the floor the panel always has, and it is what
// gets handed to /api/ai-read as baseRead so the AI enriches real numbers instead of inventing any.
// WZ-UFC-POINTS-2026-07-28 :: takes percentage points, not the model's raw log-odds. Anything that
// cannot reach 0.1 renders as a dot rather than a fake "+0.0" that reads like a broken value -- the
// factor was considered and moved nothing, and saying so plainly is better than printing a zero.
function pts(v) {
  if (v == null || !Number.isFinite(v)) return "";
  if (Math.abs(v) < 0.05) return "\u00b7";
  return (v > 0 ? "+" : "\u2212") + Math.abs(v).toFixed(1);
}
function buildAread(b) {
  const fs = Array.isArray(b.factors) ? b.factors : [];
  if (!fs.length) return null;
  const pickRed = b.pickCorner === "red";
  const forNm = (pickRed ? b.red : b.blue) || {};
  const agNm = (pickRed ? b.blue : b.red) || {};
  const sorted = fs.slice().sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const favours = (f) => (f.favors === "red") === pickRed;
  const forL = sorted.filter(favours).map((f) => f.name);
  const agL = sorted.filter((f) => !favours(f)).map((f) => f.name);
  const list = (a) => a.length > 2 ? a.slice(0, 2).join(", ") + " and " + a[2] : a.join(" and ");
  const parts = [];
  const vb = (a) => a.length === 1 ? " favours " : " favour ";
  if (forL.length) parts.push(list(forL) + vb(forL) + (forNm.name || "our pick"));
  if (agL.length) parts.push(list(agL) + vb(agL) + (agNm.name || "the other corner"));
  let out = parts.join("; ") + ".";
  if (fs.length < 5) out = "Thin read \u2014 only " + fs.length + " of 10 factors had data on both men. " + out;
  if (b.winPct != null && b.marketWinPct != null) {
    out += " Model " + b.winPct + "% against a market price of " + b.marketWinPct + "%.";
  }
  return out;
}

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
  // WZ-UFC-WHY-2026-07-27 :: expandable "why this pick" panel. Closed by default; the B read is
  // only fetched once the panel is actually opened, so a 12-bout card costs zero AI calls on load.
  const [wopen, setWopen] = useState(false);
  const [aiRead, setAiRead] = useState(null);
  const aRead = b ? buildAread(b) : null;
  useEffect(() => {
    if (!wopen || !b || !aRead) return;
    const sig = "ufc|" + (b.id || "") + "|" + (b.pick || "") + "|" + aRead;
    if (AI_READ_CACHE.has(sig)) { setAiRead(AI_READ_CACHE.get(sig)); return; }
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/ai-read`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sig, sport: "ufc", pick: b.pick,
            matchup: (b.red && b.red.name ? b.red.name : "TBD") + " vs " + (b.blue && b.blue.name ? b.blue.name : "TBD"),
            odds: b.odds, model: b.winPct, market_pct: b.marketWinPct, edge: b.edgePct, baseRead: aRead,
          }),
        });
        const j = await r.json();
        if (!dead && j && j.read) { AI_READ_CACHE.set(sig, j.read); setAiRead(j.read); }
      } catch (_) { /* fail-safe: the deterministic A read stays on screen */ }
    })();
    return () => { dead = true; };
  }, [wopen, b, aRead]);
  // WZ-UFC-STATUS-2026-07-11 :: fight status from data we already have.
  // result (win/loss/push) once the grader settles -> FINAL. lineClosed with no result yet
  // (book pulled the line, Cito hasn't posted the winner) -> AWAITING RESULT. Live line -> upcoming.
  const res = b && b.result;
  // WZ-UFC-BOUTRESULT-2026-08-01 :: a fight is over when CITO says it is, not only when we happen to
  // hold a graded pick on it. Everything below used to hang off `res`, so a bout with no banked
  // pick could never render as finished -- four Belgrade prelims sat in "ODDS PENDING" hours after
  // ESPN had them final because their lines posted after we stopped recording that event. The API
  // now sends the bout's own outcome, so read that first and fall back to our pick as before.
  const boutDone = !!(b && b.boutFinished);
  const isFinal = res === "win" || res === "loss" || res === "push" || boutDone;
  const awaiting = !isFinal && !!(b && b.lineClosed);
  // winner corner derived from result relative to our pick (win = our corner won; loss = the other)
  let winnerCorner = null;
  if (res === "win") winnerCorner = b.pickCorner;
  else if (res === "loss") winnerCorner = b.pickCorner === "red" ? "blue" : "red";
  // WZ-UFC-BOUTRESULT-2026-08-01 :: no pick to derive from -> take the corner Cito reports.
  if (!winnerCorner && b && b.boutWinnerCorner) winnerCorner = b.boutWinnerCorner;
  const redWon = isFinal && winnerCorner === "red";
  const blueWon = isFinal && winnerCorner === "blue";
  const redDim = isFinal && res !== "push" && !!winnerCorner && !redWon;
  const blueDim = isFinal && res !== "push" && !!winnerCorner && !blueWon;
  const redPick = hasPick && b.pickCorner === "red";
  const bluePick = hasPick && b.pickCorner === "blue";
  const dash = hasPick ? Math.round((b.winPct / 100) * 104) : 0;
  const value = !!(b && b.value);
  const ringCol = res === "win" ? "#3FCB91" : res === "loss" ? "#E2655C" : "#C9A86A";
  const resChip = res === "win" ? ["w", "WON"] : res === "loss" ? ["l", "LOST"] : res === "push" ? ["p", "PUSH"] : null;
  // WZ-UFC-WHY-2026-07-27 :: corner names for the panel's direction labels
  const pickName = (b.pickCorner === "red" ? (b.red && b.red.name) : (b.blue && b.blue.name)) || "our pick";
  const otherName = (b.pickCorner === "red" ? (b.blue && b.blue.name) : (b.red && b.red.name)) || "opponent";
  return (
    <div className={"ufc-b" + (main ? " main" : "") + (isFinal ? " final " + res : "") + (wopen ? " wopen" : "")}>
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
        <div className="ufc-pb pending"><span className="pnd">{boutDone ? "NO PICK \u2014 this fight was not priced" : "ODDS PENDING"}</span></div>
      )}

      {b.methodLean && b.methodLean.lean && b.methodLean.lean !== "EVEN" && !isFinal ? (
        <div className="ufc-lean">
          <span className="tag">READ</span>
          <span className="txt">{b.methodLean.label}</span>
          {b.methodLean.note ? <span className="sub">{b.methodLean.note}</span> : null}
        </div>
      ) : null}

      {/* WZ-UFC-WHY-2026-07-27 :: the strip only exists when there is a pick to explain. Bouts with
          no posted line get nothing, so the affordance never opens onto an empty box. */}
      {hasPick ? (
        <>
          <div className="ufc-strip" onClick={() => setWopen((v) => !v)}>
            <span className="s">Why this pick</span><span className="cv">{"\u2304"}</span>
          </div>
          <div className="ufc-panel"><div className="pad">{whyBody(b, aRead, aiRead, pickName, otherName)}</div></div>
        </>
      ) : null}
    </div>
  );
}

// WZ-UFC-WHY-2026-07-27 :: panel body. Factors are sorted biggest-first and the bar is scaled to the
// largest magnitude in THIS bout, because the spread is extreme -- age routinely lands at its 0.22 cap
// while grappling sits near 0.003. The signed value is printed alongside every bar for exactly that
// reason: at a 15:1 ratio a linear bar alone renders eight of nine rows as visually zero.
function whyBody(b, aRead, aiRead, pickName, otherName) {
  const fs = Array.isArray(b.factors) ? b.factors : [];
  if (!fs.length) {
    return (
      <div className="ufc-nofac">
        No factor breakdown for this bout. The pick was locked before the line closed and is shown
        from the banked record, so the model{"\u2019"}s per-factor working isn{"\u2019"}t available.
      </div>
    );
  }
  const pickRed = b.pickCorner === "red";
  // WZ-UFC-AXIS-2026-07-28 :: the axis follows the CARD, not the pick: red corner left, blue corner
  // right, matching the fighter row directly above and the model's own detail strings ("34 vs 40"
  // is red then blue). It was originally oriented pick-on-the-right, which mirrored the panel
  // against the photos -- a gold bar running right under a red-corner pick pointed at the fighter
  // on the RIGHT of the card, who was the opponent. Direction now comes from the corner; colour
  // still comes from whether the factor favours our pick. Those were one CSS class before, which
  // is what forced the two to disagree.
  const redName = (b.red && b.red.name) || "Red";
  const blueName = (b.blue && b.blue.name) || "Blue";
  // WZ-UFC-POINTS-2026-07-28 :: read points where the backend supplies them; fall back to the raw
  // log-odds x100 only for a response cached before PR #26, so an old payload still renders.
  const val = (f) => (f.points != null && Number.isFinite(f.points)) ? f.points : f.delta * 100;
  const net = (b.netPoints != null && Number.isFinite(b.netPoints)) ? b.netPoints
            : (b.totalTilt != null ? b.totalTilt * 100 : null);
  const favours = (f) => (f.favors === "red") === pickRed;
  const sorted = fs.slice().sort((x, y) => Math.abs(val(y)) - Math.abs(val(x)));
  const maxAbs = Math.abs(val(sorted[0])) || 1;
  const tiltForPick = net != null ? ((net > 0) === pickRed) : null;
  return (
    <>
      <div className="ufc-ft">
        <span className="k">Model factors</span>
        <span className="dir">{"\u25c2"} <span className={pickRed ? "pk" : ""}>{redName}</span> {"\u00b7"} <span className={pickRed ? "" : "pk"}>{blueName}</span> {"\u25b8"}</span>
      </div>
      {sorted.map((f, i) => {
        const good = favours(f);
        const toRed = f.favors === "red";
        const v = val(f);
        const w = Math.max(2, (Math.abs(v) / maxAbs) * 50);
        const nil = Math.abs(v) < 0.05;
        return (
          <div className="ufc-fr" key={f.name + i}>
            <span className="fn2">{f.name}</span>
            <span className="fd">{f.detail || ""}</span>
            <span className="ufc-bar"><i className={(toRed ? "l" : "r") + " " + (good ? "f1" : "f0")} style={{ width: w + "%" }} /></span>
            <span className={"fv " + (nil ? "nil" : good ? "f1" : "f0")}>{pts(v)}</span>
          </div>
        );
      })}
      {net != null ? (
        <div className="ufc-tilt">
          {/* WZ-UFC-POINTS-2026-07-28 :: the magnitude here IS edgePct, so this line and the edge
              badge on the card are finally the same number in the same unit. Labelled "net effect"
              rather than a total on purpose: the mapping is non-linear, so the rows above do not
              sum to it exactly and must not be presented as if they do. */}
          <span className="k">Net effect<em>this is the edge shown above</em></span>
          <span className={"v" + (tiltForPick ? "" : " f0")}>
            {pts(Math.abs(net) < 0.05 ? 0 : net)} pts {tiltForPick ? pickName : otherName}
            <small>{b.usedFactors || fs.length} of 10 factors had data</small>
          </span>
        </div>
      ) : null}
      <div className="ufc-read">
        <div className="rl"><span className="k">Read</span><span className="src">{aiRead ? "AI" : "MODEL"}</span></div>
        <div className={"tx" + (aiRead ? "" : " det")}>{aiRead || aRead}</div>
      </div>
    </>
  );
}

export default function UFCPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [planLoaded, setPlanLoaded] = useState(false);
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite"; // WZ-UFC-LOCK-2026-07-13
  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}).finally(() => setPlanLoaded(true)); }, []);

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

  // WZ-UFC-LOCK-2026-07-13 :: free tier gated (keeps nav shell)
  if (planLoaded && !hasFull) return (
    <TerminalShell active="/ufc" plan={plan} navigate={navigate}>
      <div style={{padding:"44px 18px",minHeight:"58vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{maxWidth:340,width:"100%",border:"1px solid rgba(201,168,106,.3)",borderRadius:14,background:"linear-gradient(180deg,#14110a,#06090b)",padding:"28px 22px",textAlign:"center"}}>
          <div style={{width:40,height:40,borderRadius:"50%",border:"1px solid rgba(201,168,106,.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 13px",color:"#C9A86A",fontSize:18}}>{"\uD83D\uDD12"}</div>
          <div style={{fontWeight:800,color:"#fff",fontSize:17,marginBottom:8}}>The UFC fight model is All-Access</div>
          <div style={{fontSize:12.5,color:"#99A2AA",lineHeight:1.55,maxWidth:280,margin:"0 auto 16px"}}>Every fight, every method lean, graded against the result. <b style={{color:"#C9A86A"}}>From $7/wk</b></div>
          <div onClick={()=>navigate("/pricing")} style={{display:"inline-block",background:"#1D9E75",color:"#04130d",fontWeight:800,fontSize:13,padding:"11px 20px",borderRadius:10,cursor:"pointer"}}>Unlock All-Access {"\u203a"}</div>
        </div>
      </div>
    </TerminalShell>
  );

  return (
    <TerminalShell active="/ufc" plan={plan} navigate={navigate}>
    <div className="ufc-wrap">
      <style>{CSS + WHY_CSS}</style>
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
