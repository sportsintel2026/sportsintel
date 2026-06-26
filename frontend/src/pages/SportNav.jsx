// SportNav.jsx — sport-first mobile navigation. WIZEPICKS-SPORTNAV-2026-06-26-ICONCHIPS
//
// One global nav, mounted once in App.jsx, mobile-only:
//   <SportTabsHeader/>  — rendered ABOVE the routes: a faithful clone of each
//                         page's existing header (Georgia wordmark, green OPEN
//                         badge, bell→/settings account icon) with the SECTION
//                         tabs added under it. Sticky, exactly like .hd was.
//   <SportBar/> (default) — rendered BELOW the routes: the bottom SPORT bar that
//                           drives the app via the ?sport= URL.
//
// It changes the navigation model only. Each page's body, cards, skin and
// spacing are untouched; on mobile we hide each page's own .hd (its chrome is
// now supplied here) and its old bottom .nav. Desktop (>=1024px) renders nothing
// and injects nothing — desktop is left exactly as it was.
//
// Sport rule (honest to what each sport has today):
//   MLB / NBA / NFL / CFB -> that sport's board on Home (/home?sport=KEY)
//   NHL                   -> /nhl-games
// News is a placeholder tab now; the feed wires into /news later.

import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const SECTIONS = [
  { key: "edges", lb: "Edges",       to: "/home",        match: ["/home", "/dashboard"] },
  { key: "props", lb: "Props",       to: "/props",       match: ["/props"] },
  { key: "games", lb: "Games",       to: "/games",       match: ["/games", "/nfl-games", "/cfb-games", "/nba-games", "/nhl-games"] },
  { key: "mkt",   lb: "Market",      to: "/odds",        match: ["/odds", "/consensus", "/market-read"] },
  { key: "perf",  lb: "Performance", to: "/performance", match: ["/performance", "/clv"] },
  { key: "news",  lb: "News",        to: "/news",        match: ["/news"] },
];

const SPORTS = [
  { key: "mlb", lb: "MLB", status: "LIVE" },
  { key: "nfl", lb: "NFL", status: "TRAIN" },
  { key: "cfb", lb: "CFB", status: "TRAIN" },
  { key: "nba", lb: "NBA", status: "SOON" },
  { key: "nhl", lb: "NHL", status: "SOON" },
];

const FB = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="12" rx="9" ry="5.4" transform="rotate(-32 12 12)" />
    <path d="M9.2 14.8 14.8 9.2" />
    <path d="M10.7 13.3l1.1 1.1M12.3 11.7l1.1 1.1" />
  </svg>
);
const SPORT_ICON = {
  mlb: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.7 5.4c2.5 2.3 2.5 10.9 0 13.2" />
      <path d="M17.3 5.4c-2.5 2.3-2.5 10.9 0 13.2" />
    </svg>
  ),
  nfl: FB,
  cfb: FB,
  nba: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
      <path d="M6 6c2.6 2.4 2.6 9.6 0 12M18 6c-2.6 2.4-2.6 9.6 0 12" />
    </svg>
  ),
  nhl: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="8.6" rx="7" ry="2.8" />
      <path d="M5 8.6v6.2M19 8.6v6.2" />
      <path d="M5 14.8c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8" />
    </svg>
  ),
};

// Games is the one section whose page differs per sport: each sport has its own
// live-scores route. Every other section is one shared page that reads ?sport=.
const GAMES_ROUTE = { mlb: "/games", nfl: "/nfl-games", cfb: "/cfb-games", nba: "/nba-games", nhl: "/nhl-games" };

// resolve the destination path for a section under a given sport
function routeFor(section, sport) {
  if (section.key === "games") return GAMES_ROUTE[sport] || "/games";
  return section.to;
}

const HIDE_ON = ["/", "/login", "/signup", "/pricing", "/terms", "/privacy", "/reset-password"];

function useShell() {
  const { pathname, search } = useLocation();
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 1024
  );
  useEffect(() => {
    const on = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", on);
    const tap = () => {};
    document.addEventListener("touchstart", tap, { passive: true }); // iOS: enable :active press feedback
    return () => { window.removeEventListener("resize", on); document.removeEventListener("touchstart", tap); };
  }, []);
  const visible = isMobile && !HIDE_ON.includes(pathname);
  return { visible, pathname, search };
}

const sectionOn = (s, pathname) =>
  s.match.some((p) => pathname === p || pathname.startsWith(p + "/"));

// ---- top header: brand row (clone of .hd) + section tabs ----
export function SportTabsHeader() {
  const navigate = useNavigate();
  const { visible, pathname, search } = useShell();
  if (!visible) return null;

  const params = new URLSearchParams(search);
  const goSection = (s) => {
    if (sectionOn(s, pathname)) return;
    const sport = (params.get("sport") || "mlb").toLowerCase();
    const to = routeFor(s, sport);
    navigate(to + (sport !== "mlb" ? `?sport=${sport}` : ""));
  };

  return (
    <>
      <style>{CSS}</style>
      <header className="wpnav-hd">
        <div className="wpnav-hr">
          <div className="wpnav-bd">Wize<i>Picks</i></div>
          <span className="wpnav-op"><span className="dot" />OPEN</span>
          <div className="wpnav-spacer" />
          <div className="wpnav-ib" onClick={() => navigate("/settings")} aria-label="Account">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          </div>
        </div>
        <nav className="wpnav-tabs" aria-label="Sections">
          {SECTIONS.map((s) => {
            const on = sectionOn(s, pathname);
            return (
              <button
                key={s.key}
                type="button"
                className={"wpnav-tab" + (on ? " on" : "")}
                onClick={() => goSection(s)}
                aria-current={on ? "page" : undefined}
              >
                {s.lb}
              </button>
            );
          })}
        </nav>
      </header>
    </>
  );
}

// ---- bottom sport bar ----
export default function SportBar() {
  const navigate = useNavigate();
  const { visible, pathname, search } = useShell();
  if (!visible) return null;

  const params = new URLSearchParams(search);
  let curSport = (params.get("sport") || "mlb").toLowerCase();
  if (pathname.startsWith("/nhl-games")) curSport = "nhl";
  else if (pathname.startsWith("/nba")) curSport = "nba";
  else if (pathname.startsWith("/nfl-games")) curSport = "nfl";
  else if (pathname.startsWith("/cfb-games")) curSport = "cfb";

  const pickSport = (key) => {
    if (key === curSport) return;
    const cur = SECTIONS.find((s) => sectionOn(s, pathname));
    const to = cur ? routeFor(cur, key) : "/home";
    navigate(to + (key !== "mlb" ? `?sport=${key}` : ""));
  };

  return (
    <nav className="wpnav-sport" aria-label="Sport">
      {SPORTS.map((sp) => {
        const on = sp.key === curSport;
        return (
          <button
            key={sp.key}
            type="button"
            className={"wpnav-sp" + (on ? " on" : "")}
            onClick={() => pickSport(sp.key)}
            aria-current={on ? "true" : undefined}
          >
            <span className="wpnav-ic">
              {SPORT_ICON[sp.key]}
              <i className={"wpnav-dot " + (sp.status === "LIVE" ? "live" : sp.status === "TRAIN" ? "train" : "soon")} />
            </span>
            <span className="wpnav-spl">{sp.lb}</span>
          </button>
        );
      })}
    </nav>
  );
}

const CSS = `
/* UNIFIED-NAV-FOCUS-TABS-2026-06-26b :: focus tabs (scale/fade) + bigger tabs, sport status dots; scope line removed */
/* HIDE-LEGACY-WPBN-2026-06-26 :: hide old BottomNav (.wpbn) on mobile; sport bar is the nav */
@media (max-width:1023px){
  .hd{display:none!important}
  .nav{display:none!important}
  .wpbn{display:none!important}
  .demobar{display:none!important}
  .app{min-height:calc(100vh - 84px)!important;min-height:calc(100dvh - 84px)!important;padding-bottom:calc(74px + env(safe-area-inset-bottom))!important}
}
/* ===== top header (clone of .hd) + section tabs ===== */
.wpnav-hd{position:sticky;top:0;z-index:40;max-width:460px;margin:0 auto;background:#0b0d11;padding:11px 4px 0; /* EDGE-4PX-2026-06-26 */
  font-family:'Inter',system-ui,sans-serif}
.wpnav-hr{display:flex;align-items:center;gap:8px}
.wpnav-bd{font-family:Georgia,'Times New Roman',serif;font-weight:600;font-size:22px;letter-spacing:-.2px;color:#ECEFF2}
.wpnav-bd i{font-style:normal;color:#C9A86A;font-weight:600}
.wpnav-op{display:inline-flex;align-items:center;gap:5px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9px;font-weight:700;
  color:#3FCB91;border:1px solid rgba(63,203,145,.34);background:rgba(63,203,145,.1);border-radius:999px;padding:3px 8px}
.wpnav-op .dot{width:6px;height:6px;border-radius:50%;background:#3FCB91;display:inline-block}
.wpnav-spacer{flex:1}
.wpnav-ib{width:30px;height:30px;border:1px solid rgba(255,255,255,.12);border-radius:8px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;background:#14171B;color:#99A2AA}
.wpnav-tabs{display:flex;gap:2px;padding:7px 0 0;overflow-x:auto;scrollbar-width:none}
.wpnav-tabs::-webkit-scrollbar{display:none}
/* TAB-FIT-RESPONSIVE-2026-06-26 :: side padding scales with screen (clamp 4-8px) so big phones (Pro Max) stay roomy while small phones tighten just enough to fit all six tabs; letter-spacing restored to .5 */
.wpnav-tab{flex:0 0 auto;appearance:none;background:none;border:0;cursor:pointer;position:relative;
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13.5px;font-weight:600;letter-spacing:.5px;color:#99A2AA;
  padding:9px clamp(4px, 7.5vw - 24px, 8px) 13px;white-space:nowrap;text-transform:uppercase;
  transform-origin:center bottom;opacity:.5;transform:scale(.78);
  transition:opacity .3s cubic-bezier(.4,0,.2,1),transform .3s cubic-bezier(.4,0,.2,1),color .3s ease}
.wpnav-tab.on{color:#C9A86A;opacity:1;transform:scale(1.16)}
.wpnav-tab.on::after{content:"";position:absolute;left:6px;right:6px;bottom:0;height:2px;background:#C9A86A;border-radius:2px 2px 0 0;transform-origin:left center;animation:wpnavbar .32s cubic-bezier(.4,0,.2,1)}
@keyframes wpnavbar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* ===== bottom sport bar (icon chips) ===== */
/* SPORTBAR-WEIGHT-BUMP-2026-06-26 :: icons 23->26, label 12->13.5, padding/gap up */
.wpnav-sport{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:460px;display:flex;gap:4px;z-index:50;
  padding:7px 8px calc(7px + env(safe-area-inset-bottom));
  background:linear-gradient(180deg,#0c0f13,#070809);border-top:1px solid rgba(255,255,255,.07)}
.wpnav-sp{flex:1;min-width:0;appearance:none;background:none;cursor:pointer;position:relative;
  display:flex;flex-direction:column;align-items:center;gap:5px;
  padding:8px 2px;border:1px solid transparent;border-radius:15px;color:#8A929A}
.wpnav-sp.on{border-color:rgba(201,168,106,.45);background:rgba(201,168,106,.08);color:#C9A86A}
.wpnav-ic{position:relative;width:26px;height:26px}
.wpnav-ic svg{width:26px;height:26px;display:block}
.wpnav-sp .wpnav-spl{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13.5px;letter-spacing:.6px;line-height:1;color:inherit}
.wpnav-dot{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;border:1.5px solid #0b0d11}
.wpnav-dot.live{background:#3FCB91}
.wpnav-dot.train{background:#D9A441}
.wpnav-dot.soon{background:transparent;border-color:#3a4148}
`;
