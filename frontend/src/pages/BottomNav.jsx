// BottomNav.jsx — shared mobile bottom navigation, used on every page so the app
// has ONE consistent menu. Renders only on mobile (<=768px); desktop keeps the
// left Sidebar. Pass `desktop` (e.g. <BottomNav desktop/>) on new pages that have NO
// sidebar (Home/Props) so the bar also shows full-width on desktop. Also hides the
// legacy mobile hamburger header (.mobile-only) so
// there's no second menu, and pads the page so content clears the fixed bar.
import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { label: "Dashboard",   icon: "🏠", path: "/home",        match: (p) => p === "/" || p === "/home" },
  { label: "Games",       icon: "🗓️", path: "/games",       match: (p) => p.includes("games") },
  { label: "Props",       icon: "🔥", path: "/props",       match: (p) => p === "/props" },
  { label: "Market",      icon: "💹", path: "/odds",        match: (p) => p === "/odds" },
  { label: "Performance", icon: "📈", path: "/performance", match: (p) => p === "/performance" },
  { label: "Account",     icon: "👤", path: "/settings",    match: (p) => p === "/settings" },
];

export default function BottomNav({ desktop = false }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <style>{`
        .wpbn{display:none}
        .wpbn .dbars{display:block}
        .wpbn .dbars rect{height:5px;y:17px;animation:eqbar 1.1s ease-in-out infinite}
        .wpbn .dbars .db1{fill:#2DBE7A;animation-delay:0s}
        .wpbn .dbars .db2{fill:#ff5d4d;animation-delay:.18s}
        .wpbn .dbars .db3{fill:#2DBE7A;animation-delay:.36s}
        .wpbn .dbars .db4{fill:#ff5d4d;animation-delay:.54s}
        @keyframes eqbar{0%,100%{height:5px;y:17px}50%{height:17px;y:5px}}
        @media (max-width: 768px){
          .mobile-only{display:none!important}
          .main-content{padding-bottom:76px!important}
          .wpbn{position:fixed;bottom:0;left:0;right:0;z-index:60;display:flex;justify-content:space-around;
            padding:6px 4px calc(6px + env(safe-area-inset-bottom));background:rgba(0,0,0,.96);
            backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid #161e26}
          .wpbn a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:8.5px;font-weight:600;
            color:#8a99a2;font-family:'Inter',system-ui,-apple-system,sans-serif;cursor:pointer;flex:1;min-width:0;
            -webkit-tap-highlight-color:transparent}
          .wpbn a.on{color:#ff5d4d}
          .wpbn .i{font-size:17px;line-height:1}
        }
        ${desktop ? `@media (min-width: 769px){
          .wpbn{position:fixed;bottom:0;left:0;right:0;z-index:60;display:flex;justify-content:center;gap:48px;
            padding:10px 4px;background:rgba(0,0,0,.96);
            backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid #161e26}
          .wpbn a{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;font-weight:600;
            color:#8a99a2;font-family:'Inter',system-ui,-apple-system,sans-serif;cursor:pointer}
          .wpbn a:hover{color:#cdd6da}
          .wpbn a.on{color:#ff5d4d}
          .wpbn .i{font-size:20px;line-height:1}
        }` : ""}
      `}</style>
      <nav className="wpbn">
        {TABS.map((t) => (
          <a key={t.label} className={t.match(pathname) ? "on" : ""} onClick={() => navigate(t.path)}>
            <span className="i">{t.label === "Dashboard"
              ? (<svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect className="db1" x="2" y="17" width="4" height="5" rx="1"/><rect className="db2" x="7.3" y="17" width="4" height="5" rx="1"/><rect className="db3" x="12.6" y="17" width="4" height="5" rx="1"/><rect className="db4" x="18" y="17" width="4" height="5" rx="1"/></svg>)
              : t.icon}</span>{t.label}
          </a>
        ))}
      </nav>
    </>
  );
}
