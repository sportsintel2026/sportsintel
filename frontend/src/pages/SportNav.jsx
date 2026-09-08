// SportNav.jsx — shared mobile-first product navigation. WIZEPICKS-SPORTNAV-2026-06-26-ICONCHIPS
//
// One global nav, mounted once in App.jsx at every product-page width:
//   <SportTabsHeader/>  — rendered ABOVE the routes: a faithful clone of each
//                         page's existing header (Georgia wordmark, green OPEN
//                         badge, bell→/settings account icon) with the SECTION
//                         tabs added under it. Sticky, exactly like .hd was.
//   <SportBar/> (default) — rendered BELOW the routes: the bottom SPORT bar that
//                           drives the app via the ?sport= URL.
//
// It supplies the approved shared shell. Page-local legacy header, navigation,
// and sidebar chrome is removed from active product render paths.
//
// Sport rule (honest to what each sport has today):
//   MLB / NBA / NFL / CFB -> that sport's board on Home (/home?sport=KEY)
//   NHL                   -> /nhl-games
// News is a placeholder tab now; the feed wires into /news later.

import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// WZ-NAV-NEWS-PERF-SWAP-2026-06-26 :: News now sits before Performance (tab positions swapped)
const SECTIONS = [
  { key: "edges", lb: "Edges",       to: "/home",        match: ["/home", "/dashboard"] },
  { key: "props", lb: "Props",       to: "/props",       match: ["/props"] },
  { key: "games", lb: "Matchups",       to: "/games",       match: ["/games", "/nfl-games", "/cfb-games", "/nba-games", "/nhl-games"] },
  { key: "mkt",   lb: "Market",      to: "/market-read", match: ["/odds", "/consensus", "/market-read"] },
  { key: "news",  lb: "News",        to: "/news",        match: ["/news"] },
];

const SPORTS = [
  { key: "mlb", lb: "MLB", status: "LIVE" },
  { key: "nfl", lb: "NFL", status: "TRAIN" },
  { key: "cfb", lb: "CFB", status: "TRAIN" },
  { key: "nba", lb: "NBA", status: "SOON" },
  { key: "nhl", lb: "NHL", status: "SOON" },
  { key: "ufc", lb: "UFC", status: "NEW" }, // WZ-UFC-NAV-2026-07-09 :: additive; UFC only
];

// WZ-UFC-NAV-2026-07-09 :: UFC's own section set (v1: just the card). Record turns on when
// there are graded fights to show. Does NOT touch any other sport's SECTIONS above.
const UFC_SECTIONS = [
  { key: "edges", lb: "Edges", to: "/ufc", match: ["/ufc"] },
  { key: "record", lb: "Record", to: "/ufc-record", match: ["/ufc-record"] }, // WZ-UFC-RECORD-2026-07-09
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
  ufc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.2 4.5 5.5 8v7.3l3.2 4.2h6.6l3.2-4.2V8l-2.7-3.5z" />
      <path d="M8.6 8.4h6.8M8.6 15.6h6.8M8.6 8.4v7.2M15.4 8.4v7.2" />
    </svg>
  ),
};

// Games is the one section whose page differs per sport: each sport has its own
// live-scores route. Every other section is one shared page that reads ?sport=.
const GAMES_ROUTE = { mlb: "/games", nfl: "/nfl-games", cfb: "/cfb-games", nba: "/nba-games", nhl: "/nhl-games" };

// resolve the destination path for a section under a given sport
function routeFor(section, sport) {
  // WZ-UFC-RECORD-2026-07-09 :: within UFC, honor the section's own /ufc* path (Edges -> /ufc,
  // Record -> /ufc-record). Coming FROM a non-UFC section (bottom bar), section.to isn't a /ufc
  // path, so we land on the UFC card (/ufc) by default.
  if (sport === "ufc") return String(section.to || "").startsWith("/ufc") ? section.to : "/ufc";
  if (section.key === "games") return GAMES_ROUTE[sport] || "/games";
  return section.to;
}

const HIDE_ON = ["/", "/login", "/signup", "/pricing", "/terms", "/privacy", "/reset-password", "/nfl-picks", "/college-football-picks", "/mlb-picks", "/best-bets-today"];

function useShell() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const tap = () => {};
    document.addEventListener("touchstart", tap, { passive: true }); // iOS: enable :active press feedback
    return () => { document.removeEventListener("touchstart", tap); };
  }, []);
  const visible = !HIDE_ON.includes(pathname);
  return { visible, pathname, search };
}

const sectionOn = (s, pathname) =>
  s.match.some((p) => pathname === p || pathname.startsWith(p + "/"));

// resolveSport :: WZ-SPORTNAV-GAMEROUTE-2026-07-16
// ONE source of truth for "which sport is active", shared by the bottom sport
// bar AND the top section tabs. Reads ?sport= first, then falls back to the
// pathname so routes that carry no query string - the /game/<sport>/:id detail
// pages - still light up their real sport instead of defaulting to MLB.
function resolveSport(pathname, params) {
  let s = (params.get("sport") || "mlb").toLowerCase();
  if (pathname.startsWith("/nhl-games") || pathname.startsWith("/game/nhl")) s = "nhl";
  else if (pathname.startsWith("/nfl-games") || pathname.startsWith("/game/nfl")) s = "nfl";
  else if (pathname.startsWith("/cfb-games") || pathname.startsWith("/game/cfb")) s = "cfb";
  else if (pathname.startsWith("/nba") || pathname.startsWith("/game/nba")) s = "nba";
  else if (pathname.startsWith("/ufc")) s = "ufc"; // WZ-UFC-NAV-2026-07-09
  else if (pathname.startsWith("/game/mlb")) s = "mlb";
  return s;
}

// ---- top header: brand row (clone of .hd) + section tabs ----
export function SportTabsHeader() {
  const navigate = useNavigate();
  const { visible, pathname, search } = useShell();
  if (!visible) return null;

  const params = new URLSearchParams(search);
  // WZ-UFC-NAV-2026-07-09 :: UFC shows only its own section tab(s). Every other sport is untouched.
  const isUFC = pathname.startsWith("/ufc") || (params.get("sport") || "").toLowerCase() === "ufc";
  const sectionsToShow = isUFC ? UFC_SECTIONS : SECTIONS;
  const goSection = (s) => {
    if (sectionOn(s, pathname)) return;
    const sport = resolveSport(pathname, params); // WZ-SPORTNAV-GAMEROUTE-2026-07-16
    const to = routeFor(s, sport);
    navigate(to + (sport !== "mlb" ? `?sport=${sport}` : ""));
  };

  return (
    <>
      <style>{CSS}</style>
      <header className="wpnav-hd">
        <div className="wpnav-hr">
          {/* WZ-WIZEPLAYS-BRAND-2026-07-11 :: this shared header shows WizePlays only on the WizePlays page (/expert-picks); every other page keeps WizePicks. */}
          <div className="wpnav-bd">Wize<i>{pathname === "/expert-picks" ? "Plays" : "Picks"}</i></div>
          <span className="wpnav-op"><span className="dot" />LIVE</span>
          <div className="wpnav-spacer" />
          <div className="wpnav-ib" onClick={() => navigate("/settings")} aria-label="Account">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
          </div>
        </div>
        <nav className="wpnav-tabs" aria-label="Sections">
          {sectionsToShow.map((s) => {
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
  const curSport = resolveSport(pathname, params); // WZ-SPORTNAV-GAMEROUTE-2026-07-16

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
            <span className="wpnav-spi" aria-hidden="true">{SPORT_ICON[sp.key]}</span>
            <span className="wpnav-spl">{sp.lb}</span>
          </button>
        );
      })}
    </nav>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap'); /* WZ-SPORTBAR-OSWALD-2026-06-26 :: heavier text-only sport labels */
/* UNIFIED-NAV-FOCUS-TABS-2026-06-26b :: focus tabs (scale/fade) + bigger tabs, sport status dots; scope line removed */
/* HIDE-LEGACY-WPBN-2026-06-26 :: hide old BottomNav (.wpbn) on mobile; sport bar is the nav */
@media (max-width:1023px){
  html,body,#root{max-width:100%;overflow-x:clip}
  .hd{display:none!important}
  .nav{display:none!important}
  .wpbn{display:none!important}
  .demobar{display:none!important}
  .app{min-height:calc(100vh - 70px)!important;min-height:calc(100dvh - 70px)!important;padding-bottom:calc(60px + env(safe-area-inset-bottom))!important}
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
/* TAB-FULLWORD-SWIPE-2026-06-26 :: keep full "Performance" label + roomy 12px padding; row scrolls (overflow-x:auto) so off-screen tabs are reachable by a sideways swipe — chosen over shortening any label */
.wpnav-tab{flex:0 0 auto;appearance:none;background:none;border:0;cursor:pointer;position:relative;
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13.5px;font-weight:600;letter-spacing:.5px;color:#EDF1F4; /* WZ-TOPTABS-BRIGHT2-2026-07-07 :: inactive section tabs near-white */
  padding:9px 12px 13px;white-space:nowrap;text-transform:uppercase;
  transform-origin:center bottom;opacity:1;transform:scale(.9);
  transition:opacity .3s cubic-bezier(.4,0,.2,1),transform .3s cubic-bezier(.4,0,.2,1),color .3s ease}
.wpnav-tab.on{color:#C9A86A;opacity:1;transform:scale(1.16)}
.wpnav-tab.on::after{content:"";position:absolute;left:9px;right:9px;bottom:0;height:2px;background:#C9A86A;border-radius:2px 2px 0 0;transform-origin:left center;animation:wpnavbar .32s cubic-bezier(.4,0,.2,1)}
@keyframes wpnavbar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* ===== bottom sport bar (icon chips) ===== */
/* SPORTBAR-WEIGHT-BUMP-2026-06-26 :: icons 23->26, label 12->13.5, padding/gap up */
.wpnav-sport{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:460px;display:flex;gap:4px;z-index:50;
  padding:5px 8px calc(5px + env(safe-area-inset-bottom)); /* WZ-SPORTBAR-COMPACT-2026-06-26 :: tighter bottom sport bar */
  background:linear-gradient(180deg,#0c0f13,#070809);border-top:1px solid rgba(255,255,255,.07)}
.wpnav-sp{flex:1;min-width:0;appearance:none;background:none;cursor:pointer;position:relative;
  display:flex;align-items:center;justify-content:center;
  padding:9px 2px;border:1px solid transparent;border-radius:12px;color:#E4E8EC;transition:background .15s ease,color .15s ease}
.wpnav-sp.on{border-color:#C9A86A;background:linear-gradient(180deg,#e7cf9a,#C9A86A);color:#0A0B0D;box-shadow:0 4px 16px rgba(201,168,106,.28)} /* WZ-SPORTBAR-GOLDPILL-2026-07-07 :: Option A gold pill on the selected sport */
.wpnav-sp .wpnav-spl{position:relative;font-family:'Oswald',sans-serif;font-weight:700;font-size:19px;letter-spacing:.4px;line-height:1;color:inherit}
@media(max-width:350px){.wpnav-sport{gap:2px;padding-left:4px;padding-right:4px}.wpnav-sp{padding-left:1px;padding-right:1px}.wpnav-sp .wpnav-spl{font-size:16px}.wpnav-tab{font-size:12px;padding-left:10px;padding-right:10px}.wpnav-bd{font-size:20px}}
/* WZ-SPORTBAR-GOLDPILL-2026-07-07 :: status dots removed -- every sport treated the same; only the selected sport is marked (gold pill) */
/* Approved mobile-first shell — one live header/navigation implementation at every width. */
html,body,#root{max-width:100%;overflow-x:clip;background:#090a0c}
.wpnav-hd{width:100%;max-width:none;padding:13px max(14px,calc((100vw - 860px)/2)) 0;background:rgba(9,10,12,.97);border-bottom:1px solid #23231f;backdrop-filter:blur(14px)}
.wpnav-hd,.wpnav-hd *{box-sizing:border-box}
.wpnav-hr{min-height:34px;gap:9px}.wpnav-bd{font-size:25px;letter-spacing:-.7px;color:#f5f1e9}.wpnav-bd i{color:#d3ae6b}
.wpnav-op{font-size:8px;letter-spacing:.8px;color:#45d89c;border-color:rgba(69,216,156,.32);background:rgba(69,216,156,.08);padding:4px 8px}
.wpnav-ib{width:31px;height:31px;border-color:#292a27;border-radius:50%;background:#111215;color:#aaa59b}
.wpnav-tabs{padding-top:8px}.wpnav-tab{font-size:10px;letter-spacing:1px;color:#777871;padding:10px 13px 12px;transform:none;transition:color .18s ease}.wpnav-tab.on{color:#e2bd77;transform:none}.wpnav-tab.on::after{left:12px;right:12px;background:#d3ae6b}
.wpnav-sport{width:min(100%,760px);max-width:none;gap:0;padding:5px 8px calc(5px + env(safe-area-inset-bottom));background:rgba(9,10,12,.985);border:1px solid #272721;border-bottom:0;border-radius:15px 15px 0 0;box-shadow:0 -12px 32px rgba(0,0,0,.42)}
.wpnav-sp{display:flex;flex-direction:column;gap:3px;padding:7px 2px 6px;border:0;border-radius:0;color:#7d7e78}.wpnav-sp.on{border-color:transparent;background:transparent;color:#d6b46f;box-shadow:none}.wpnav-sp.on::before{content:"";position:absolute;left:25%;right:25%;top:-5px;height:2px;border-radius:2px;background:#d6b46f}.wpnav-spi{display:block;width:23px;height:23px}.wpnav-spi svg{display:block;width:100%;height:100%}.wpnav-sp .wpnav-spl{font:700 8px/1 'IBM Plex Mono',monospace;letter-spacing:.55px}
@media(max-width:767px){.wpnav-hd{padding-left:14px;padding-right:14px}.wpnav-bd{font-size:23px}.wpnav-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:0;overflow:visible}.wpnav-tab{min-width:0;font-size:8px;letter-spacing:.55px;padding:10px 1px 12px}.wpnav-tab.on::after{left:8px;right:8px}.wpnav-sport{width:100%;border-left:0;border-right:0;border-radius:0;padding-left:5px;padding-right:5px}.wpnav-sp{padding-left:1px;padding-right:1px}.wpnav-spi{width:21px;height:21px}.app,.wp-product-page{padding-bottom:calc(66px + env(safe-area-inset-bottom))!important}}
@media(max-width:350px){.wpnav-tab{font-size:7.2px;letter-spacing:.35px}.wpnav-spi{width:19px;height:19px}.wpnav-sp .wpnav-spl{font-size:7px}.wpnav-bd{font-size:21px}}
`;
