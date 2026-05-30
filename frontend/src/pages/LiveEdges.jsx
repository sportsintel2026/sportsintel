// LiveEdges.jsx — in-game win probability + live moneyline edge
//
// Polls /api/live/mlb every 60s. Shows each in-progress game with our live win
// probability (win-expectancy engine + current-pitcher nudge), the game state
// (inning/outs/bases), and the live moneyline edge vs the de-vigged book line.

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { liveApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function LiveEdgesPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const d = await liveApi.getMLB();
      setData(d);
    } catch (_) { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // 60s poll
    return () => clearInterval(t);
  }, [load]);

  const games = data?.games || [];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        .desktop-sidebar{display:block}
        .mobile-only{display:none}
        @media (max-width:768px){
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important;max-width:100vw!important;overflow-x:hidden!important}
          .mobile-only{display:flex!important}
          .le-content{padding:16px 14px 60px!important;max-width:100vw!important}
        }
      `}</style>

      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(p) => { setDrawerOpen(false); navigate(p); }} />
          </div>
        </>
      )}
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="le-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 80px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "pulse 2s infinite" }} />
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Live edges</h1>
          </div>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>
            In-game win probability vs the live market · updates every 60s
          </p>

          <div style={{ background: "#13110a", border: "1px solid #3a2f10", borderLeft: "3px solid #d4a017", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#d4b85a", lineHeight: 1.6 }}>
            <strong>Experimental.</strong> Live win probability comes from a win-expectancy model
            (score, inning, outs, baserunners, current pitcher). It updates fast and can be wrong —
            treat it as a signal, not a guarantee. Live lines move quickly.
          </div>

          {loading && !data && <Loader />}
          {!loading && games.length === 0 && <Empty />}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {games.map((g) => <LiveGameCard key={g.gameId} g={g} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveGameCard({ g }) {
  const bestEdge = Math.max(Math.abs(g.awayEdge ?? 0), Math.abs(g.homeEdge ?? 0), Math.abs(g.overEdge ?? 0), Math.abs(g.underEdge ?? 0));
  const hasEdge = bestEdge >= 0.03; // 3%+ worth highlighting
  return (
    <div style={{ background: "#0f1419", border: `1px solid ${hasEdge ? "#22c55e44" : "#1f2937"}`, borderRadius: 12, padding: 18, animation: "fadeIn .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", letterSpacing: "0.05em" }}>
            {g.half === "bottom" ? "BOT" : "TOP"} {g.inning} · {g.outs} OUT
          </span>
          <BaseDiamond baseState={g.baseState} />
        </div>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{g.awayAbbr} {g.awayScore} – {g.homeScore} {g.homeAbbr}</span>
      </div>

      {/* MONEYLINE */}
      <SectionLabel>💰 Moneyline</SectionLabel>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <TeamLine side="AWAY" abbr={g.awayAbbr} winProb={g.awayWinProb} odds={g.awayOdds} edge={g.awayEdge} />
        <TeamLine side="HOME" abbr={g.homeAbbr} winProb={g.homeWinProb} odds={g.homeOdds} edge={g.homeEdge} />
      </div>

      {/* OVER / UNDER */}
      {g.totalLine != null && (
        <>
          <SectionLabel>📊 Total {g.totalLine} · proj {g.projectedTotal}</SectionLabel>
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <TeamLine side="OVER" abbr={`O ${g.totalLine}`} winProb={g.overProb} odds={g.overOdds} edge={g.overEdge} />
            <TeamLine side="UNDER" abbr={`U ${g.totalLine}`} winProb={g.underProb} odds={g.underOdds} edge={g.underEdge} />
          </div>
        </>
      )}

      {/* RUN LINE (probability only for now) */}
      {(g.homeRunLineProb != null || g.awayRunLineProb != null) && (
        <>
          <SectionLabel>📐 Run line ±1.5 · model probability</SectionLabel>
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <TeamLine side={`${g.awayAbbr} -1.5`} abbr={`${g.awayAbbr} -1.5`} winProb={g.awayRunLineProb} odds={null} edge={null} />
            <TeamLine side={`${g.homeAbbr} -1.5`} abbr={`${g.homeAbbr} -1.5`} winProb={g.homeRunLineProb} odds={null} edge={null} />
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>{children}</div>;
}

function TeamLine({ side, abbr, score, winProb, odds, edge }) {
  const edgePos = edge != null && edge > 0;
  const showEdge = edge != null;
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{side}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 10 }}>
        {abbr} {odds != null ? <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>· {odds > 0 ? `+${odds}` : odds}</span> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>Our prob</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#22c55e" }}>{winProb != null ? `${Math.round(winProb * 100)}%` : "—"}</span>
      </div>
      {showEdge && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Edge</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: edgePos ? "#22c55e" : "#ef4444" }}>
            {edgePos ? "+" : ""}{(edge * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

// Simple base-occupancy diamond. baseState bits: 1=1st, 2=2nd, 4=3rd.
function BaseDiamond({ baseState }) {
  const on = (bit) => (baseState & bit) ? "#d4a017" : "#1f2937";
  const sq = (bg) => ({ width: 7, height: 7, background: bg, transform: "rotate(45deg)", borderRadius: 1 });
  return (
    <span style={{ display: "inline-grid", gridTemplateColumns: "repeat(3,9px)", gridTemplateRows: "repeat(3,9px)", marginLeft: 4 }}>
      <span /><span style={sq(on(2))} /><span />
      <span style={sq(on(4))} /><span /><span style={sq(on(1))} />
      <span /><span /><span />
    </span>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 80 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading live games…</div>
    </div>
  );
}

function Empty() {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚾</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No games in progress</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>Live win probabilities and edges appear here while games are being played.</div>
    </div>
  );
}
