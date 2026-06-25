// MobileShell.jsx — sport-first mobile container. MOBILESHELL-PERF-2026-06-25
//
// Wired at /m (test) and ready for /home + /dashboard once App.jsx points those
// routes here. Renders SportShell (new bottom sport bar + top tabs) and mounts
// your EXISTING page components unchanged based on the active tab.
//
// HOW IT WORKS (and why it's safe):
//   - It renders SportShell (the new bottom sport bar + top tabs).
//   - Inside, it mounts your EXISTING page components unchanged (Home, Props,
//     Games, Performance, OddsPage) based on the active tab.
//   - Each of those pages renders its OWN fixed bottom nav (class `.nav`). We hide
//     only that, with a scoped, mobile-only CSS rule, so SportShell's bottom bar is
//     the single nav. Nothing inside the pages is edited — their files are untouched.
//   - Desktop (>=1024px): SportShell returns children with no chrome, so /home and
//     /dashboard still render HomeDesktop exactly as before.
//
// MLB is wired; other sports show a "being wired" placeholder for now.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SportShell from "./SportShell";
import HomePage from "./Home";
import PropsPage from "./Props";
import GamesPage from "./Games";
import OddsPage from "./OddsPage";
import PerformancePage from "./Performance";

// MLB section -> existing page component (map from our agreed blueprint).
const MLB = {
  Edges: HomePage,            // your full dashboard, untouched
  Props: PropsPage,           // Props.jsx, untouched
  Games: GamesPage,           // Games.jsx, untouched
  Performance: PerformancePage, // Performance.jsx, untouched
  Market: OddsPage,           // OddsPage.jsx (Odds/Consensus), untouched
  Movers: OddsPage,           // OddsPage.jsx (Movers view), untouched
};

export default function MobileShell() {
  const navigate = useNavigate();
  const [sport, setSport] = useState("mlb");
  const [section, setSection] = useState("Edges");

  let content;
  if (sport === "mlb") {
    const Comp = MLB[section];
    content = Comp ? (
      <Comp />
    ) : (
      <Placeholder label={`MLB · ${section}`} note="This tab is being wired in next." />
    );
  } else {
    content = (
      <Placeholder
        label={sport.toUpperCase()}
        note="This sport is being wired in. MLB is live now."
      />
    );
  }

  return (
    <SportShell
      sport={sport}
      section={section}
      onSport={setSport}
      onSection={setSection}
      navigate={navigate}
    >
      <style>{EMBED_CSS}</style>
      <div className="wpembed">{content}</div>
    </SportShell>
  );
}

function Placeholder({ label, note }) {
  return (
    <div className="wpembed-ph">
      <div className="phl">{label}</div>
      <div className="phn">{note}</div>
    </div>
  );
}

const EMBED_CSS = `
@media (max-width:1023px){
  .wpembed .nav{display:none!important}
  .wpembed .demobar{display:none!important}
}
.wpembed-ph{padding:90px 24px;text-align:center;font-family:'Barlow Condensed',sans-serif}
.wpembed-ph .phl{font-weight:800;font-size:25px;color:#EAF0F2;letter-spacing:.3px}
.wpembed-ph .phn{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;color:#8B98A3;margin-top:9px}
`;
