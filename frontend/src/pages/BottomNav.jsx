// BottomNav.jsx — shared mobile bottom navigation, used on every page so the app
// has ONE consistent menu. Renders only on mobile (<=768px); desktop keeps the
// left Sidebar. Pass `desktop` (e.g. <BottomNav desktop/>) on new pages that have NO
// sidebar (Home/Props) so the bar also shows full-width on desktop. Also hides the
// legacy mobile hamburger header (.mobile-only) so
// there's no second menu, and pads the page so content clears the fixed bar.
import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { label: "Home",        icon: "🏠", path: "/home",        match: (p) => p === "/" || p === "/home" },
  { label: "Games",       icon: "🗓️", path: "/games",       match: (p) => p.includes("games") },
  { label: "Props",       icon: "⚾", path: "/props",       match: (p) => p === "/props" },
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
        .wpback{display:none}
        @media (max-width: 768px){
          .mobile-only{display:none!important}
          .wpback{position:fixed;top:10px;left:10px;z-index:55;display:flex;align-items:center;gap:5px;
            padding:7px 12px;border-radius:20px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);
            -webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);color:#cdd6da;
            font-size:12px;font-weight:600;font-family:'Inter',system-ui,-apple-system,sans-serif;
            cursor:pointer;-webkit-tap-highlight-color:transparent}
          .wpback:active{transform:scale(.96)}
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
      <button className="wpback" onClick={() => navigate(-1)} aria-label="Go back">← Back</button>
      <nav className="wpbn">
        {TABS.map((t) => (
          <a key={t.label} className={t.match(pathname) ? "on" : ""} onClick={() => navigate(t.path)}>
            <span className="i">{t.icon}</span>{t.label}
          </a>
        ))}
      </nav>
    </>
  );
}
