// SportShell.jsx — sport-first mobile shell. SPORTSHELL-PERF-2026-06-25
//
// Wired into the live mobile app via MobileShell (test route /m, and the real
// /home + /dashboard once App.jsx points to MobileShell). Deploying this file
// alone only affects MobileShell's tab list.
//
// MOBILE ONLY. Renders the shell at <1024px; at >=1024px it returns children
// with NO shell, leaving the existing desktop layout byte-for-byte untouched
// (desktop gets its own makeover later).
//
// The shell is pure chrome: bottom bar = sport, top tabs = section, optional
// live ticker. The page content the parent passes as `children` is rendered
// untouched in the middle — same cards, same board, same skin, just relocated.
//
// Usage:
//   <SportShell sport="mlb" section="Edges" onSport={fn} onSection={fn}
//               navigate={navigate} plan={plan} scores={liveScores}>
//     {pageContent}
//   </SportShell>

import { useState, useEffect } from "react";

const SPORTS = [
  { id: "mlb", lb: "MLB", status: "live" },
  { id: "nfl", lb: "NFL", status: "training" },
  { id: "cfb", lb: "CFB", status: "training" },
  { id: "nba", lb: "NBA", status: "live" },
  { id: "nhl", lb: "NHL", status: "soon" },
];

const SECTIONS = ["Edges", "Props", "Games", "Performance", "Market", "Movers"];

export default function SportShell({
  sport = "mlb",
  section = "Edges",
  onSport,
  onSection,
  navigate,
  plan = {},
  scores = [],
  children,
}) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 1024
  );
  useEffect(() => {
    const on = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Desktop: no shell — existing desktop layout renders untouched.
  if (!isMobile) return children;

  const cur = SPORTS.find((s) => s.id === sport) || SPORTS[0];
  const go = (fn, val) => {
    if (typeof fn === "function") fn(val);
  };

  // Ticker tape content (duplicated for a seamless loop). Renders only if scores exist.
  const tape = (scores || []).map((s, i) => {
    const aw = s.win === "a" ? "win" : "";
    const hw = s.win === "h" ? "win" : "";
    const right = s.final
      ? '<span class="fin">FINAL</span>'
      : `<span class="stt">${s.status || ""}</span>`;
    return (
      `<span class="tkitem"><span class="tm ${aw}">${s.a}</span>` +
      `<span class="sc ${aw}">${s.sa}</span><span class="dsh">–</span>` +
      `<span class="sc ${hw}">${s.sh}</span><span class="tm ${hw}">${s.h}</span>${right}</span>`
    );
  });
  const tapeHTML = tape.length ? tape.join("") + tape.join("") : "";

  return (
    <div className="wpss">
      <style>{SHELL_CSS}</style>

      {/* ===== HEADER ===== */}
      <div className="wpss-top">
        <div className="wpss-brand">
          <div className="wpss-bwrap">
            <div
              className="wpss-logo"
              onClick={() => go(navigate, "/home")}
              style={{ cursor: "pointer" }}
            >
              Wize<span className="b">Picks</span>
            </div>
            <span className="wpss-chip">{cur.lb}</span>
          </div>
          <div className="wpss-av" onClick={() => go(navigate, "/settings")}>
            {(plan.email || "G").slice(0, 1).toUpperCase()}
          </div>
        </div>

        {/* live ticker (only if scores provided) */}
        {tapeHTML && (
          <div className="wpss-ticker">
            <div className="tklive">
              <span className="tkdot" />LIVE
            </div>
            <div className="tktape">
              <div
                className="tkrun"
                dangerouslySetInnerHTML={{ __html: tapeHTML }}
              />
            </div>
          </div>
        )}

        {/* section tabs */}
        <div className="wpss-tabs">
          {SECTIONS.map((t) => (
            <div
              key={t}
              className={"wpss-tab" + (t === section ? " on" : "")}
              onClick={() => go(onSection, t)}
            >
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* ===== PAGE CONTENT (untouched) ===== */}
      <div className="wpss-content">{children}</div>

      {/* ===== BOTTOM SPORT BAR ===== */}
      <nav className="wpss-bot">
        {SPORTS.map((s) => (
          <div
            key={s.id}
            className={"wpss-sp" + (s.id === sport ? " on" : "")}
            onClick={() => go(onSport, s.id)}
          >
            {s.status === "live" && <span className="wpss-ld" />}
            <span className="ico">{s.lb}</span>
            <span className="st">
              {s.status === "live" ? "LIVE" : s.status === "training" ? "TRAIN" : "SOON"}
            </span>
          </div>
        ))}
      </nav>
    </div>
  );
}

const SHELL_CSS = `
.wpss{--ink:#0A0B0D;--panel:#14171B;--panel2:#1B2025;--line:#23282f;--line2:#2c333b;
  --gold:#C9A86A;--teal:#3FCB91;--tealhi:#46E0A9;--neg:#E2655C;--tx:#EAF0F2;--mut:#8B98A3;--mut2:#5b6670;
  --mono:'IBM Plex Mono',ui-monospace,monospace;--disp:'Barlow Condensed',sans-serif;
  position:relative;min-height:100vh;width:100%;background:var(--ink);color:var(--tx);
  font-family:'Inter',system-ui,sans-serif;display:flex;flex-direction:column}

.wpss-top{position:sticky;top:0;z-index:20;background:linear-gradient(180deg,#0c0f13,#0a0b0d);border-bottom:1px solid var(--line)}
.wpss-brand{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 9px}
.wpss-bwrap{display:flex;align-items:center}
.wpss-logo{font-family:var(--disp);font-weight:800;font-size:18px}
.wpss-logo .b{color:var(--teal)}
.wpss-chip{font-family:var(--disp);font-weight:800;font-size:12.5px;letter-spacing:.6px;color:var(--gold);border:1px solid var(--gold);border-radius:7px;padding:2px 9px;margin-left:9px}
.wpss-av{width:29px;height:29px;border-radius:8px;background:linear-gradient(135deg,#1d2734,#11161c);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#9fb0c4;cursor:pointer}

.wpss-ticker{display:flex;align-items:stretch;height:30px;background:#08090c;border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden}
.wpss-ticker .tklive{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:0 11px;background:linear-gradient(90deg,rgba(226,101,92,.16),transparent);font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--neg);border-right:1px solid var(--line)}
.wpss-ticker .tkdot{width:6px;height:6px;border-radius:50%;background:var(--neg);animation:wpsspulse 1.5s infinite}
@keyframes wpsspulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}
.wpss-ticker .tktape{flex:1 1 auto;overflow:hidden;position:relative;display:flex;align-items:center;-webkit-mask-image:linear-gradient(90deg,transparent,#000 18px,#000 calc(100% - 18px),transparent)}
.wpss-ticker .tkrun{display:inline-flex;align-items:center;white-space:nowrap;animation:wpssscroll 34s linear infinite;will-change:transform}
.wpss-ticker .tktape:hover .tkrun{animation-play-state:paused}
@keyframes wpssscroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.wpss-ticker .tkitem{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;padding:0 14px;border-right:1px solid #161a1f}
.wpss-ticker .tm{color:var(--mut)}.wpss-ticker .sc{color:var(--tx);font-weight:700}.wpss-ticker .win{color:var(--tealhi)}
.wpss-ticker .dsh{color:var(--mut2)}.wpss-ticker .stt{color:var(--mut2);font-size:8.5px;letter-spacing:.5px}
.wpss-ticker .fin{color:var(--mut2);font-size:8px;letter-spacing:1px;border:1px solid var(--line2);border-radius:3px;padding:1px 4px}

.wpss-tabs{display:flex;gap:2px;padding:5px 11px 0;overflow-x:auto;scrollbar-width:none}
.wpss-tabs::-webkit-scrollbar{display:none}
.wpss-tab{flex:0 0 auto;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--mut);padding:9px 12px;cursor:pointer;white-space:nowrap;text-transform:uppercase;position:relative}
.wpss-tab:hover{color:var(--tx)}
.wpss-tab.on{color:var(--gold)}
.wpss-tab.on::after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;background:var(--gold);border-radius:2px 2px 0 0}

.wpss-content{flex:1 1 auto;min-width:0;padding-bottom:70px}

.wpss-bot{position:fixed;left:0;right:0;bottom:0;height:64px;background:linear-gradient(180deg,#0c0f13,#070809);border-top:1px solid var(--line);display:flex;z-index:40}
.wpss-bot::before{content:"";position:absolute;left:0;right:0;top:-1px;height:2px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.5}
.wpss-sp{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;position:relative}
.wpss-sp .ico{font-family:var(--disp);font-weight:800;font-size:14px;letter-spacing:.5px;color:var(--mut2)}
.wpss-sp .st{font-family:var(--mono);font-size:7px;letter-spacing:.5px;color:var(--mut2)}
.wpss-sp.on .ico,.wpss-sp.on .st{color:var(--gold)}
.wpss-sp.on{background:color-mix(in srgb,var(--gold) 12%,transparent)}
.wpss-sp.on::before{content:"";position:absolute;top:-1px;left:20%;right:20%;height:3px;background:var(--gold);border-radius:0 0 3px 3px}
.wpss-sp .wpss-ld{width:5px;height:5px;border-radius:50%;background:var(--gold);position:absolute;top:11px;right:50%;margin-right:-14px}
`;
