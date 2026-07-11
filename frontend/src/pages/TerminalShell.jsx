// TerminalShell.jsx — the shared desktop "terminal" chrome (top status bar + left
// nav rail) so every page matches the home dashboard instead of the old Sidebar.
//
// DESKTOP ONLY. Renders the shell at >=1024px; below that it returns the page's
// own children with NO shell, so the existing mobile layout is byte-for-byte
// untouched. The home page (HomeDesktop) keeps its own richer shell with the live
// ticker + market status; this is the lighter shared version for sub-pages.
//
// Usage: wrap a page's desktop content:
//   <TerminalShell active="/props" plan={plan} navigate={navigate}>
//     ...desktop page content...
//   </TerminalShell>
// `active` is the route to highlight in the nav. On mobile, just renders children.

import { useState, useEffect } from "react";

// WZ-TERMSHELL-VAULT-2026-07-11 :: shared shell reskinned to Vault (gold/Fraunces/Manrope); desktop-only, mobile untouched.
const NAV = [
  ["BOARD", null],
  ["▤", "Edges", "/home"],
  ["◰", "Market Price", "/odds"],
  ["◎", "Market Read", "/market-read"],
  ["◈", "Props", "/props"],
  ["TRACK", null],
  ["✦", "WizePlays", "/expert-picks"],
  ["↻", "Wize Spin", "/daily-card"],
  ["◫", "Consensus", "/consensus"],
  ["◷", "CLV", "/clv"],
  ["SCORES", null],
  ["▦", "Games & Scores", "/games"],
];

export default function TerminalShell({ active, plan = {}, navigate, children }) {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.innerWidth >= 1024
  );
  useEffect(() => {
    const on = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Mobile / tablet: no shell at all — page renders its own existing layout.
  if (!isDesktop) return children;

  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";

  return (
    <div className="wptsh">
      <style>{SHELL_CSS}</style>
      <div className="status">
        <div className="brand" onClick={() => navigate("/home")} style={{ cursor: "pointer" }}>
          <div className="logo">Wize<span className="b">Picks</span></div>
          <div className="tag">TERMINAL</div>
        </div>
        <div className="sright">
          <div className="avatar" onClick={() => navigate("/settings")}>
            {(plan.email || "R").slice(0, 1).toUpperCase()}
          </div>
        </div>
      </div>

      <div className="body">
        <nav className="nav">
          {NAV.map((it, i) =>
            it[1] === null ? (
              <div key={i} className="grp">{it[0]}</div>
            ) : (
              <a
                key={i}
                className={it[2] === active ? "on" : ""}
                onClick={() => navigate(it[2])}
              >
                <span className="i">{it[0]}</span>
                {it[1]}
              </a>
            )
          )}
          <div className="spacer" />
          <div className="upsell">
            <div className="h">{hasFull ? "All-Access" : "Go All-Access"}</div>
            <div className="d">
              {hasFull
                ? "Your plan is active — every edge unlocked."
                : "Every edge, prop & live play — $7/mo."}
            </div>
            <button onClick={() => navigate(hasFull ? "/settings" : "/pricing")}>
              {hasFull ? "Manage plan" : "Unlock — $7/mo"}
            </button>
          </div>
        </nav>

        <div className="content">{children}</div>
      </div>
    </div>
  );
}

const SHELL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Manrope:wght@400;500;600;700;800&display=swap');
.wptsh{--ink:#101013;--panel:#17171B;--line:rgba(201,168,106,.14);--line2:rgba(255,255,255,.06);--teal:#3FCB91;--up:#46E0A9;--dn:#E2655C;--model:#9b7bff;--amber:#C9A86A;--goldsoft:#D8BE8C;--goldbg:rgba(201,168,106,.10);--goldln:rgba(201,168,106,.30);--tx:#EDEBE6;--mut:#9A958A;--mut2:#6A6459;--mono:'IBM Plex Mono',ui-monospace,monospace;--disp:'Fraunces',Georgia,serif;
  position:relative;min-height:100vh;width:100%;background:radial-gradient(130% 70% at 50% -8%,rgba(201,168,106,.06),transparent 55%),var(--ink);color:var(--tx);font-family:'Manrope',system-ui,sans-serif;display:flex;flex-direction:column}
.wptsh .status{position:sticky;top:0;z-index:30;flex:0 0 52px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;height:52px;padding:0 18px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#151318,#0f0f12)}
.wptsh .brand{display:flex;align-items:center;gap:9px}
.wptsh .logo{font-family:var(--disp);font-weight:800;font-size:23px}.wptsh .logo .b{color:var(--amber)}
.wptsh .tag{font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--mut);border:1px solid var(--line2);border-radius:4px;padding:2px 6px}
.wptsh .sright{grid-column:3;display:flex;align-items:center;gap:13px}
.wptsh .avatar{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#1b2740,#0e1422);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#9fb0c4;cursor:pointer}
.wptsh .body{flex:1 0 auto;display:grid;grid-template-columns:clamp(176px,11vw,210px) minmax(0,1fr);align-items:start}
.wptsh .nav{position:sticky;top:52px;align-self:start;height:calc(100vh - 52px);border-right:1px solid var(--line);background:linear-gradient(180deg,#0f0e0c,#0c0c0e);display:flex;flex-direction:column;padding:12px 10px;gap:3px;overflow:auto}
.wptsh .nav .grp{font-size:9.5px;font-weight:800;letter-spacing:1.4px;color:var(--mut2);padding:12px 10px 5px}
.wptsh .nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:#aeb9c8;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;position:relative}
.wptsh .nav a .i{width:17px;text-align:center;font-size:14px}
.wptsh .nav a:hover{background:rgba(201,168,106,.05);color:#fff}
.wptsh .nav a.on{background:linear-gradient(90deg,rgba(201,168,106,.12),transparent);color:#fff;border-color:var(--goldln)}
.wptsh .nav a.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--amber)}
.wptsh .nav .spacer{flex:1}
.wptsh .nav .upsell{margin:8px 4px 4px;border:1px solid var(--goldln);border-radius:11px;background:linear-gradient(180deg,rgba(201,168,106,.07),transparent);padding:12px}
.wptsh .nav .upsell .h{font-family:var(--disp);font-weight:700;font-size:16px;color:var(--goldsoft)}
.wptsh .nav .upsell .d{font-size:10.5px;color:var(--mut);margin:4px 0 9px;line-height:1.4}
.wptsh .nav .upsell button{width:100%;border:0;border-radius:8px;background:var(--amber);color:#1a1206;font-weight:800;font-size:12px;padding:8px;cursor:pointer;font-family:inherit}
.wptsh .content{min-width:0;min-height:calc(100vh - 52px)}
.wptsh .nav::-webkit-scrollbar{width:9px}
.wptsh .nav::-webkit-scrollbar-thumb{background:#26221a;border-radius:8px}
`;
