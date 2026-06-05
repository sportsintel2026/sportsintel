import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

const LEAGUES = [
  { id: "mlb", label: "MLB", icon: "⚾", live: true },
  { id: "nba", label: "NBA", icon: "🏀", live: true },
  { id: "nhl", label: "NHL", icon: "🏒", live: false },
  { id: "nfl", label: "NFL", icon: "🏈", live: false },
  { id: "ncaafb", label: "CFB", icon: "🏟️", live: false },
  { id: "ncaamb", label: "CBB", icon: "🎓", live: false },
];

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [league, setLeague] = useState("mlb");
  const [edges, setEdges] = useState(null);
  const [edgesLoading, setEdgesLoading] = useState(true);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const loadEdges = useCallback(async () => {
    if (league !== "mlb") { setEdges(null); setEdgesLoading(false); return; }
    setEdgesLoading(true);
    try { const data = await edgesApi.getMLB(); setEdges(data); }
    catch (e) { console.error("Failed to load edges:", e); setEdges(null); }
    setEdgesLoading(false);
  }, [league]);
  useEffect(() => { loadEdges(); }, [loadEdges]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .edge-row{transition:background .15s,transform .15s;cursor:pointer}
        .edge-row:hover{background:#131820!important;transform:translateX(2px)}
        .game-row{transition:background .15s;cursor:pointer}
        .game-row:hover{background:#131820}
        .tab-btn{transition:all .15s;cursor:pointer}
        .tab-btn:hover{color:#fff}
        .section-header{transition:color .15s;cursor:pointer}
        .section-header:hover{color:#fff!important}
        .hamburger-btn{display:none}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important;padding-top:0!important}
          .hamburger-btn{display:flex!important}
          .mobile-only{display:flex!important}
          .edge-grid-2{grid-template-columns:1fr!important}
          .hr-prop-row{grid-template-columns:1fr!important;gap:8px!important}
          .hr-prop-stats{display:flex!important;flex-wrap:wrap!important;gap:12px!important;justify-content:space-between!important}
          .games-table-wrap{margin:0 -14px!important}
          .games-table{font-size:11px!important}
          .games-table th,.games-table td{padding:6px 4px!important}
          .league-tabs-inner{padding:0 12px!important}
          .dashboard-content{padding:16px 14px 60px!important}
          h1{font-size:22px!important}
        }
      `}</style>

      {/* Desktop sidebar — fixed left */}
      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      {/* Mobile drawer — slides in from left when opened */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(path) => { setDrawerOpen(false); navigate(path); }} />
          </div>
        </>
      )}

      {/* Mobile top bar — only shows on mobile */}
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} className="hamburger-btn" style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer", display: "none", alignItems: "center" }}>
          ☰
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#ef4444" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <LeagueTabs league={league} setLeague={setLeague} navigate={navigate} />
        <div className="dashboard-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px 60px" }}>
          {league === "mlb" ? (
            <MLBDashboard edges={edges} loading={edgesLoading} hasFullAccess={hasFullAccess} navigate={navigate} onRefresh={loadEdges} />
          ) : league === "nba" ? (
            <NBADashboard hasFullAccess={hasFullAccess} navigate={navigate} />
          ) : (
            <ComingSoon league={LEAGUES.find(l => l.id === league)} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
}

function LeagueTabs({ league, setLeague, navigate }) {
  return (
    <div style={{ background: "#0a0e14", borderBottom: "1px solid #1a1f28", position: "sticky", top: 0, zIndex: 39 }}>
      <div className="league-tabs-inner" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", gap: 4, overflowX: "auto" }}>
        {LEAGUES.map(l => {
          const active = league === l.id;
          return (
            <button key={l.id} className="tab-btn" onClick={() => (l.path ? navigate(l.path) : setLeague(l.id))} style={{ background: "none", border: "none", padding: "14px 14px", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#fff" : "#6b7280", borderBottom: `2px solid ${active ? "#ef4444" : "transparent"}`, marginBottom: -1, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{l.icon}</span>
              <span>{l.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MLBDashboard({ edges, loading, hasFullAccess, navigate, onRefresh }) {
  if (loading) return <Loader />;
  if (!edges) return <ErrorState onRetry={onRefresh} />;
  // Use the date the BACKEND actually served (it rolls over to tomorrow once all
  // of today's games are final), not the browser's "now". Parse YYYY-MM-DD as a
  // local date so the weekday is correct.
  const rolled = !!edges.rolledToNextDay;
  let weekday = "";
  try {
    const [y, mo, d] = String(edges.date).split("-").map(Number);
    weekday = new Date(y, mo - 1, d).toLocaleDateString("en-US", { weekday: "long" });
  } catch (_) {
    weekday = new Date().toLocaleDateString("en-US", { weekday: "long" });
  }
  const heading = rolled ? "Next up" : "Today's edges";
  const gameCount = edges.games?.length || 0;

  // Detect the "all of today's games are already in progress / finished" case.
  // When that happens the PRE-GAME edge lists are empty (correctly) because the
  // model's pre-game edges only apply before first pitch — the live edges have
  // moved onto each game's page. Without a note, the empty panels read like the
  // product is broken, so we show a friendly signpost pointing to the live games.
  const games = edges.games || [];
  const liveCount = games.filter((g) => g.status === "live").length;
  const scheduledCount = games.filter((g) => g.status === "scheduled" || (g.status !== "live" && g.status !== "final")).length;
  const pregameEdgeCount =
    (edges.moneylineEdges?.length || 0) +
    (edges.totalsEdges?.length || 0) +
    (edges.hrPropEdges?.length || 0) +
    (edges.kPropEdges?.length || 0) +
    (edges.hitsPropEdges?.length || 0);
  // Only show when: there ARE games, at least one is live, none are still
  // waiting to start, and there are no pre-game edges left to show.
  const allGamesUnderway =
    gameCount > 0 && liveCount > 0 && scheduledCount === 0 && pregameEdgeCount === 0;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{heading} · {weekday}</h1>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {gameCount} games · {edges.cached ? "Cached" : "Updated"} {new Date(edges.computedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
        Model projections vs sportsbook lines · weather, batter vs pitcher history, recent form. <span style={{ color: "#ef4444", fontWeight: 600 }}>Click any game</span> for deep analysis.
      </p>

      {allGamesUnderway && (
        <div style={{ background: "linear-gradient(180deg,#1a1410 0%,#0f1419 100%)", border: "1px solid #ef444433", borderLeft: "3px solid #ef4444", borderRadius: 10, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#e4e7eb", marginBottom: 2 }}>
                All of today's games are now in progress
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>
                Pre-game edges have closed — live in-game edges are now on each game's page. Tap a live game to see them.
              </div>
            </div>
          </div>
          <button onClick={() => navigate("/games")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            View live games →
          </button>
        </div>
      )}
      <TopPlays edges={edges} hasFullAccess={hasFullAccess} navigate={navigate} />
      <div className="edge-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, gridAutoRows: "1fr" }}>
        <EdgePanel title="Top moneyline edges" icon="💰" edges={edges.moneylineEdges || []} renderRow={(e) => <MoneylineRow edge={e} key={e.gameId + e.side} navigate={navigate} />} emptyText="No edges found in current slate" hasFullAccess={hasFullAccess} navigate={navigate} />
        <EdgePanel title="Top totals edges" icon="📊" edges={edges.totalsEdges || []} renderRow={(e) => <TotalsRow edge={e} key={e.gameId + e.side} navigate={navigate} />} emptyText="No edges found in current slate" hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <EdgePanel title="Top home run props" icon="💣" edges={edges.hrPropEdges || []} renderRow={(e) => <HRPropRow edge={e} key={e.player + e.game} />} emptyText="HR prop data updates closer to first pitch" hasFullAccess={hasFullAccess} navigate={navigate} wide />
      </div>
      <div style={{ marginBottom: 8, fontSize: 11, color: "#a8915c", display: "flex", alignItems: "center", gap: 6, lineHeight: 1.5 }}>
        ⚠️ Experimental — strikeout & hits projections are v1 and still being calibrated. Treat as directional, not proven.
      </div>
      <div className="edge-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, gridAutoRows: "1fr" }}>
        <EdgePanel title="Pitcher strikeouts" icon="🔥" edges={edges.kPropEdges || []} renderRow={(e) => <KPropRow edge={e} key={e.player + e.game} />} emptyText="K prop data updates closer to first pitch" hasFullAccess={hasFullAccess} navigate={navigate} wide />
        <EdgePanel title="Batter hits" icon="🏏" edges={edges.hitsPropEdges || []} renderRow={(e) => <HitsPropRow edge={e} key={e.player + e.game} />} emptyText="Hits prop data updates closer to first pitch" hasFullAccess={hasFullAccess} navigate={navigate} wide />
      </div>

      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e4e7eb", marginBottom: 2 }}>⚾ Want to see all today's games?</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{gameCount} games · live scores, matchups, weather & more</div>
        </div>
        <button onClick={() => navigate("/games")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          View MLB Games →
        </button>
      </div>
    </div>
  );
}

// Top Plays: the day's best edges, ranked by CONVICTION (not raw edge size, which
// surfaces noise). Pools moneyline + totals, keeps only HIGH/MEDIUM conviction with
// a positive edge, sorts by conviction score. Honest empty state when nothing
// stands out — we do NOT manufacture a "top pick" on a sharp board.
function topPlayLabel(e) {
  if (e.side === "over" || e.side === "under") return `${e.side === "over" ? "Over" : "Under"} ${e.line ?? ""}`.trim();
  return `${e.teamAbbr} ML`;
}
function TopPlayRow({ edge, navigate }) {
  return (
    <div className="edge-row" onClick={() => navigate(`/game/mlb/${edge.gameId}`)} style={{ padding: 12, background: "#0a0e14", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <ConfidenceBadge conf={edge.conviction} />
          {edge.convictionScore != null && <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{edge.convictionScore}</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e4e7eb" }}>{topPlayLabel(edge)}</div>
            <div style={{ fontSize: 11, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{edge.matchup} · {formatOdds(edge.odds)}</div>
          </div>
        </div>
        <EdgeBadge edge={edge.edge} />
      </div>
      {edge.reason && <div style={{ fontSize: 11.5, color: "#cbd5e1", lineHeight: 1.5, marginTop: 8 }}>{edge.reason}</div>}
      {edge.trust && <div style={{ fontSize: 10.5, color: "#6b7280", lineHeight: 1.45, marginTop: 4 }}>{edge.trust}</div>}
    </div>
  );
}
function TopPlays({ edges, hasFullAccess, navigate }) {
  const pool = [...(edges.moneylineEdges || []), ...(edges.totalsEdges || [])]
    .filter((e) => e.convictionScore != null && (e.conviction === "HIGH" || e.conviction === "MEDIUM") && (e.edge ?? 0) > 0);
  pool.sort((a, b) => (b.convictionScore - a.convictionScore) || ((b.edge ?? 0) - (a.edge ?? 0)));
  const top = pool.slice(0, 5);
  const titleRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e4e7eb" }}>🎯 Top plays today</div>
      <span style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.04em" }}>ranked by conviction</span>
    </div>
  );
  if (top.length === 0) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 18, marginBottom: 16 }}>
        {titleRow}
        <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.55 }}>
          No high-conviction plays on today's board — the model isn't seeing a standout worth highlighting. That's normal when the market is sharp. You can still browse every edge below, or check back closer to first pitch as lines and data firm up.
        </div>
      </div>
    );
  }
  const visible = hasFullAccess ? top : top.slice(0, 1);
  const hidden = hasFullAccess ? [] : top.slice(1);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #22c55e30", borderRadius: 10, padding: 18, marginBottom: 16 }}>
      {titleRow}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((e) => <TopPlayRow edge={e} key={"top" + e.gameId + e.side} navigate={navigate} />)}
      </div>
      {hidden.length > 0 && (
        <div style={{ position: "relative", marginTop: 6 }}>
          <div style={{ filter: "blur(4px)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {hidden.map((e) => <TopPlayRow edge={e} key={"toph" + e.gameId + e.side} navigate={navigate} />)}
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🔒 Unlock all top plays — $7/mo</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 10.5, color: "#6b7280", lineHeight: 1.5 }}>
        The model's highest-conviction edges today, ranked by how much supporting data backs each. Conviction reflects data quality and agreement — not a guarantee. Even strong plays lose; bet responsibly.
      </div>
    </div>
  );
}
function EdgePanel({ title, icon, edges, renderRow, emptyText, hasFullAccess, navigate, wide }) {
  const visible = hasFullAccess ? edges : edges.slice(0, 1);
  const hidden = hasFullAccess ? [] : edges.slice(1, 5);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#9ca3af", fontWeight: 500 }}>{icon} {title.toUpperCase()}</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{edges.length} found</span>
      </div>
      {edges.length === 0 ? (
        <div style={{ color: "#4b5563", fontSize: 12, textAlign: "center", padding: "16px 0" }}>{emptyText}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visible.map(renderRow)}
          {hidden.length > 0 && (
            <div style={{ position: "relative", marginTop: 4 }}>
              <div style={{ filter: "blur(4px)", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {hidden.map(renderRow)}
              </div>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🔒 Unlock all edges — $7/mo</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 3, background: "#ef444415", color: "#ef4444", border: "1px solid #ef444440", letterSpacing: "0.05em", marginLeft: 6 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
      LIVE
    </span>
  );
}

// Neutral "market may be overrating this side" tag. NOT a bet recommendation —
// it surfaces the gap between the sharp market price and our model so the user
// can apply their own read (e.g. fading a public/streak-inflated favorite).
// Shows only when the backend attached an `inflation` flag to this edge.
function InflationTag({ inflation }) {
  if (!inflation || !inflation.inflated) return null;
  const gapPct = inflation.gap != null ? Math.round(inflation.gap * 100) : null;
  const title = inflation.note
    || "Market rates this side higher than our model — possible public/streak inflation.";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 700,
        padding: "2px 6px", borderRadius: 3, background: "#f5970015", color: "#fbbf24",
        border: "1px solid #f5970040", letterSpacing: "0.04em", marginLeft: 6, cursor: "help",
        whiteSpace: "nowrap",
      }}
    >
      ⚠ MARKET HIGH{gapPct != null ? ` +${gapPct}%` : ""}
    </span>
  );
}

function MoneylineRow({ edge, navigate }) {
  const isLive = edge.status === "live";
  return (
    <div className="edge-row" onClick={() => navigate(`/game/mlb/${edge.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 3 }}>
          {edge.teamAbbr} ML
          {isLive && <LiveBadge />}
          <InflationTag inflation={edge.inflation} />
        </div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.matchup} · {formatOdds(edge.odds)} {isLive && edge.inning ? `· ${edge.inning}` : edge.time && `· ${edge.time}`}
        </div>
      </div>
      <div style={{ textAlign: "right", marginLeft: 10 }}>
        <EdgeBadge edge={edge.edge} />
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{Math.round(edge.modelProb * 100)}% model</div>
      </div>
    </div>
  );
}

function TotalsRow({ edge, navigate }) {
  const isLive = edge.status === "live";
  return (
    <div className="edge-row" onClick={() => navigate(`/game/mlb/${edge.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 3 }}>
          {edge.side === "over" ? "Over" : "Under"} {edge.line}
          {isLive && <LiveBadge />}
          <InflationTag inflation={edge.inflation} />
        </div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.matchup} · {formatOdds(edge.odds)} {isLive && edge.inning ? `· ${edge.inning}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", marginLeft: 10 }}>
        <EdgeBadge edge={edge.edge} />
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>proj {edge.projected}</div>
      </div>
    </div>
  );
}

function KPropRow({ edge }) {
  const sideLabel = edge.side === "under" ? "Under" : "Over";
  const detail = [
    edge.opponent ? `vs ${edge.opponent}` : null,
    edge.pitcherK9 != null ? `${edge.pitcherK9} K/9` : null,
    edge.expectedKs != null ? `proj ${edge.expectedKs}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="edge-row hr-prop-row" style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.player} <span style={{ color: "#9ca3af", fontWeight: 500 }}>{sideLabel} {edge.line} K</span></div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edge.team}{detail ? ` · ${detail}` : ""}</div>
      </div>
      <div className="hr-prop-stats" style={{ display: "contents" }}>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{formatOdds(edge.odds)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{Math.round(edge.kProb * 100)}% model</div>
        <EdgeBadge edge={edge.edge} />
        <ConfidenceBadge conf={edge.confidence} />
      </div>
    </div>
  );
}

function HitsPropRow({ edge }) {
  const lineLabel = edge.line === 0.5
    ? (edge.side === "under" ? "Under 0.5 H (0 hits)" : "Over 0.5 H (1+ hits)")
    : `${edge.side === "under" ? "Under" : "Over"} ${edge.line} H`;
  const avgText = edge.battingAvg != null ? `${edge.battingAvg.toFixed(3).replace(/^0/, ".")} AVG` : null;
  return (
    <div className="edge-row hr-prop-row" style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.player} <span style={{ color: "#9ca3af", fontWeight: 500 }}>{lineLabel}</span></div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edge.team} · facing {edge.opposingPitcher || "TBD"}{avgText ? ` · ${avgText}` : ""}</div>
      </div>
      <div className="hr-prop-stats" style={{ display: "contents" }}>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{formatOdds(edge.odds)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{Math.round(edge.hitsProb * 100)}% model</div>
        <EdgeBadge edge={edge.edge} />
        <ConfidenceBadge conf={edge.confidence} />
      </div>
    </div>
  );
}

function HRPropRow({ edge }) {
  const bvpText = edge.bvp && edge.bvp.atBats > 0
    ? `Career vs starter: ${edge.bvp.hits}/${edge.bvp.atBats}${edge.bvp.hr > 0 ? `, ${edge.bvp.hr} HR` : ""}`
    : null;
  const recentText = edge.recent15
    ? `Last 15d: ${(edge.recent15.avg * 1000).toFixed(0).replace(/^0/, ".")}${edge.recent15.hr > 0 ? `, ${edge.recent15.hr} HR` : ""}`
    : null;
  const detailLine = [recentText, bvpText].filter(Boolean).join(" · ");

  return (
    <div className="edge-row hr-prop-row" style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.player}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.team} · facing {edge.opposingPitcher || "TBD"}
        </div>
        {detailLine && (
          <div style={{ fontSize: 10, color: "#22c55e", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {detailLine}
          </div>
        )}
      </div>
      <div className="hr-prop-stats" style={{ display: "contents" }}>
        <div style={{ fontSize: 11, color: "#9ca3af" }}><span style={{ display: "none" }} className="mobile-only-label">Odds: </span>{formatOdds(edge.odds)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{Math.round(edge.hrProb * 100)}% model</div>
        <EdgeBadge edge={edge.edge} />
        <ConfidenceBadge conf={edge.confidence} />
      </div>
    </div>
  );
}

function GamesSection({ title, titleColor, games, navigate, defaultOpen, showLiveBadge, showFinalScore }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div className="section-header" onClick={() => setIsOpen(!isOpen)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOpen ? 12 : 0 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: titleColor, fontWeight: 700 }}>
          {title} {showLiveBadge && <span style={{ marginLeft: 4 }}>· {games.length} game{games.length === 1 ? "" : "s"}</span>}
          {!showLiveBadge && <span style={{ marginLeft: 4, color: "#6b7280" }}>· {games.length} game{games.length === 1 ? "" : "s"}</span>}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{isOpen ? "▲ hide" : "▼ show"}</span>
      </div>
      {isOpen && (
        <div className="games-table-wrap" style={{ overflowX: "auto" }}>
          <table className="games-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1f2937", color: "#6b7280" }}>
                <th style={th()}>Game</th>
                <th style={th()}>{showFinalScore ? "Final" : "Status"}</th>
                <th style={th()}>Pitchers</th>
                <th style={th("center")}>Wx</th>
                <th style={th("right")}>Model</th>
                <th style={th("right")}>Total</th>
                <th style={th("right")}>Park</th>
                <th style={th("right")}></th>
              </tr>
            </thead>
            <tbody>
              {games.map(g => (
                <tr key={g.id} className="game-row" onClick={() => navigate(`/game/mlb/${g.id}`)} style={{ borderBottom: "1px solid #131820" }}>
                  <td style={td()}>{g.awayAbbr} @ {g.homeAbbr}</td>
                  <td style={td()}>
                    {g.status === "live" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
                        <span style={{ color: "#ef4444", fontWeight: 700, fontSize: 11 }}>LIVE</span>
                        {g.awayScore != null && <span style={{ color: "#9ca3af", fontSize: 11 }}>{g.awayScore}-{g.homeScore}</span>}
                      </div>
                    )}
                    {g.status === "final" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        <span style={{ color: "#22c55e", fontWeight: 700, fontSize: 11 }}>FINAL</span>
                        {g.awayScore != null && <span style={{ color: "#e4e7eb", fontSize: 11, fontWeight: 600 }}>{g.awayScore}-{g.homeScore}</span>}
                      </div>
                    )}
                    {g.status !== "live" && g.status !== "final" && <span style={{ color: "#9ca3af" }}>{g.time}</span>}
                  </td>
                  <td style={td()}>
                    <div style={{ color: "#9ca3af", whiteSpace: "nowrap" }}>{g.pitchers?.away?.name || "TBD"}</div>
                    <div style={{ color: "#9ca3af", whiteSpace: "nowrap" }}>{g.pitchers?.home?.name || "TBD"}</div>
                  </td>
                  <td style={td("center")}><WeatherIndicator weather={g.weather} /></td>
                  <td style={td("right")}>
                    {g.moneyline?.awayWinProb != null ? `${Math.round(g.moneyline.awayWinProb * 100)}/${Math.round(g.moneyline.homeWinProb * 100)}` : "—"}
                  </td>
                  <td style={td("right")}>{g.totals?.projected ?? "—"}</td>
                  <td style={td("right")}>
                    <span style={{ color: g.parkRunFactor > 1.05 ? "#22c55e" : g.parkRunFactor < 0.95 ? "#ef4444" : "#9ca3af" }}>
                      {g.parkRunFactor?.toFixed(2)}
                    </span>
                  </td>
                  <td style={td("right")}><span style={{ color: "#ef4444", fontSize: 14 }}>→</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WeatherIndicator({ weather }) {
  if (!weather) return <span style={{ color: "#4b5563", fontSize: 11 }}>—</span>;
  if (weather.indoor) return <span title="Indoor stadium" style={{ fontSize: 14 }}>🏟️</span>;
  const icons = [];
  let tooltip = `${weather.tempF}°F`;
  if (weather.windEffect === "out") { icons.push("💨↗"); tooltip += ` · Wind OUT ${weather.windMph}mph (favors hitters)`; }
  else if (weather.windEffect === "in") { icons.push("💨↙"); tooltip += ` · Wind IN ${weather.windMph}mph (favors pitchers)`; }
  else if (weather.windEffect === "cross") { icons.push("💨"); tooltip += ` · Cross wind ${weather.windMph}mph`; }
  if (weather.tempEffect === "hot") { icons.push("🔥"); tooltip += " · Warm air carries"; }
  else if (weather.tempEffect === "cold") { icons.push("🥶"); tooltip += " · Cold air dense"; }
  if (weather.isRaining) { icons.push("🌧️"); tooltip += " · Rain"; }
  if (icons.length === 0) return <span title={tooltip} style={{ fontSize: 11, color: "#6b7280" }}>{weather.tempF}°</span>;
  return <span title={tooltip} style={{ fontSize: 13, cursor: "help" }}>{icons.join(" ")}</span>;
}

function th(align = "left") {
  return { padding: "8px 6px", textAlign: align, fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function td(align = "left") {
  return { padding: "10px 6px", textAlign: align, color: "#e4e7eb", fontSize: 12 };
}

function EdgeBadge({ edge }) {
  if (edge == null) return <span style={{ fontSize: 11, color: "#6b7280" }}>—</span>;
  const positive = edge > 0;
  const color = positive ? "#22c55e" : "#ef4444";
  const sign = positive ? "+" : "";
  return <span style={{ fontSize: 14, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{sign}{(edge * 100).toFixed(1)}%</span>;
}

function ConfidenceBadge({ conf }) {
  const colors = {
    HIGH: { bg: "#22c55e15", fg: "#22c55e", border: "#22c55e30" },
    MEDIUM: { bg: "#f59e0b15", fg: "#f59e0b", border: "#f59e0b30" },
    LOW: { bg: "#1f2937", fg: "#9ca3af", border: "#374151" },
    NEUTRAL: { bg: "#1f2937", fg: "#6b7280", border: "#374151" },
  };
  const c = colors[conf] || colors.NEUTRAL;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 4, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, letterSpacing: "0.05em" }}>{conf?.slice(0, 3) || "—"}</span>;
}

function formatOdds(american) {
  if (american == null) return "—";
  return american > 0 ? `+${american}` : `${american}`;
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Running model on today's slate...</div>
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6 }}>This can take ~10 seconds the first time</div>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load edges</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>The model service might be warming up. Try again in a moment.</div>
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
    </div>
  );
}

function NBADashboard({ hasFullAccess, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const base = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
      const res = await fetch(`${base}/api/nba/predictions`);
      if (!res.ok) throw new Error("bad status");
      setData(await res.json());
    } catch (e) { console.error("Failed to load NBA edges:", e); setError(true); setData(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader />;
  if (error) return <ErrorState onRetry={load} />;

  // only resolved matchups with usable data
  const games = (data?.predictions || []).filter(
    (g) => !(g.home || "").includes("/") && !(g.away || "").includes("/") && g.dataQuality !== "insufficient"
  );

  const mlEdges = [];
  const totalEdges = [];
  for (const g of games) {
    const matchup = `${nbaAbbr(g.away)} @ ${nbaAbbr(g.home)}`;
    const time = nbaTime(g.date);
    const ml = g.predictions?.moneyline;
    if (ml?.value) {
      const pickHome = ml.pick === "home";
      mlEdges.push({
        gameId: g.gameId, matchup, time,
        teamAbbr: nbaAbbr(ml.pickTeam),
        odds: pickHome ? ml.book?.home : ml.book?.away,
        edgePct: ml.edge,
        modelPct: Math.round(pickHome ? ml.homeWinProb : ml.awayWinProb),
        inflation: ml.inflation || null,
      });
    }
    const to = g.predictions?.total;
    if (to?.value) {
      totalEdges.push({
        gameId: g.gameId, matchup,
        side: to.pick, line: to.line,
        edgePts: to.edge, projected: to.projectedTotal,
      });
    }
  }
  mlEdges.sort((a, b) => b.edgePct - a.edgePct);
  totalEdges.sort((a, b) => b.edgePts - a.edgePts);

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>🏀 NBA Playoff edges</h1>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{games.length} game{games.length === 1 ? "" : "s"}</span>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
        Model projections vs sportsbook lines · <span style={{ color: "#ef4444", fontWeight: 600 }}>click any edge</span> for the full matchup.
      </p>

      <div className="edge-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, gridAutoRows: "1fr" }}>
        <EdgePanel title="Top moneyline edges" icon="💰" edges={mlEdges} renderRow={(e) => <NBAMoneylineRow edge={e} key={e.gameId} navigate={navigate} />} emptyText="No moneyline edges in the current slate" hasFullAccess={hasFullAccess} navigate={navigate} />
        <EdgePanel title="Top totals edges" icon="📊" edges={totalEdges} renderRow={(e) => <NBATotalRow edge={e} key={e.gameId} navigate={navigate} />} emptyText="No totals edges — books are sharp here" hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>

      <NBAPropsSection games={games} hasFullAccess={hasFullAccess} navigate={navigate} />

      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e4e7eb", marginBottom: 2 }}>🏀 Want to see every NBA game?</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>Full slate with projections, win %, and matchup detail</div>
        </div>
        <button onClick={() => navigate("/nba")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          View NBA Playoffs →
        </button>
      </div>
    </div>
  );
}

// ── NBA player props (points / rebounds / assists) ──────────────────────────────
// Pulls projections for each game in the slate from /api/nba/props/:gameId/projections,
// collects the model's flagged prop edges and the held-back "suspect" picks.
function NBAPropsSection({ games, hasFullAccess, navigate }) {
  const [edges, setEdges] = useState(null);
  const [suspects, setSuspects] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const base = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
        const slate = (games || []).slice(0, 6); // cap fetches; playoff slates are small
        const results = await Promise.all(
          slate.map((g) =>
            fetch(`${base}/api/nba/props/${g.gameId}/projections`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        const allEdges = [];
        const allSuspects = [];
        const allRows = [];
        for (const r of results) {
          if (!r || !r.available) continue;
          const matchup = `${nbaAbbr(r.away)} @ ${nbaAbbr(r.home)}`;
          for (const e of r.edges || []) allEdges.push({ ...e, matchup, gameId: r.gameId });
          for (const s of r.suspects || []) allSuspects.push({ ...s, matchup, gameId: r.gameId });
          for (const p of r.players || []) {
            if (!p.markets) continue; // skip out/unresolved players
            const team = p.side === "home" ? nbaAbbr(r.home) : p.side === "away" ? nbaAbbr(r.away) : null;
            const teamLogo = (r.teamLogos && p.side) ? (r.teamLogos[p.side] || null) : null;
            allRows.push({ name: p.name, matchup, team, teamLogo, gameId: r.gameId, injuryStatus: p.injuryStatus || null, markets: p.markets });
          }
        }
        allEdges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
        allSuspects.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
        // biggest projection-vs-line gap (any market) first
        const gap = (row) => Math.max(...["points", "rebounds", "assists", "threes"].map((k) => Math.abs(row.markets[k]?.edge ?? 0)));
        allRows.sort((a, b) => gap(b) - gap(a));
        if (!cancelled) { setEdges(allEdges); setSuspects(allSuspects); setRows(allRows); }
      } catch (e) {
        if (!cancelled) { setEdges([]); setSuspects([]); setRows([]); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [games]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🎯 Player props</h2>
        <span style={{ fontSize: 11, color: "#6b7280" }}>points · rebounds · assists · 3PT</span>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>
        Model projection vs the book line. Out / injured players are removed automatically;
        questionable players are held back below.
      </p>

      {loading ? (
        <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 28, textAlign: "center", color: "#6b7280", fontSize: 12 }}>
          <div style={{ width: 22, height: 22, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 10px" }} />
          Loading player props…
        </div>
      ) : (
        <>
          <EdgePanel
            title="Top player prop edges"
            icon="🎯"
            edges={edges || []}
            renderRow={(e) => <NBAPropRow edge={e} key={e.gameId + e.name + e.stat} navigate={navigate} />}
            emptyText="No prop edges cleared the guardrails in this slate"
            hasFullAccess={hasFullAccess}
            navigate={navigate}
            wide
          />
          {suspects.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <NBASuspectPanel suspects={suspects} />
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <NBAAllPropsTable rows={rows} hasFullAccess={hasFullAccess} navigate={navigate} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NBAPropRow({ edge, navigate }) {
  const sideColor = edge.side === "OVER" ? "#22c55e" : "#ef4444";
  const edgeText = `${edge.edge > 0 ? "+" : ""}${Number(edge.edge).toFixed(1)}`;
  return (
    <div className="edge-row hr-prop-row" onClick={() => navigate(`/game/nba/${edge.gameId}`)} style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.name}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edge.matchup}</div>
      </div>
      <div className="hr-prop-stats" style={{ display: "contents" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "capitalize" }}>{edge.stat}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: sideColor }}>{edge.side} {edge.line}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>proj {edge.projection}</div>
        <span style={{ fontSize: 14, fontWeight: 600, color: sideColor, fontVariantNumeric: "tabular-nums" }}>{edgeText}</span>
      </div>
    </div>
  );
}

// Full table: every projected player, all three markets, projection vs line.
function NBAAllPropsTable({ rows, hasFullAccess, navigate }) {
  const [open, setOpen] = useState(true);
  const visible = hasFullAccess ? rows : rows.slice(0, 6);
  const lockedCount = hasFullAccess ? 0 : Math.max(0, rows.length - visible.length);

  // Group visible players by team. If team info is missing (one group), fall
  // back to a flat list so the table never looks broken.
  const groups = [];
  const idx = new Map();
  for (const r of visible) {
    const key = r.team || "—";
    let g = idx.get(key);
    if (!g) { g = { team: key, rows: [] }; idx.set(key, g); groups.push(g); }
    g.rows.push(r);
  }
  const grouped = groups.length > 1;
  const renderRow = (r, i) => (
    <tr key={(r.team || "") + r.gameId + r.name + i} className="game-row" onClick={() => navigate(`/game/nba/${r.gameId}`)} style={{ borderBottom: "1px solid #1a212c", background: i % 2 === 1 ? "#0b1118" : "transparent", cursor: "pointer" }}>
      <td style={{ ...td(), padding: "13px 8px" }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
        <div style={{ fontSize: 10, color: "#5b6472", marginTop: 1 }}>
          {r.matchup}{r.injuryStatus ? ` · ${r.injuryStatus}` : ""}
        </div>
      </td>
      <td style={{ ...td("right"), padding: "13px 8px" }}><StatCell m={r.markets.points} /></td>
      <td style={{ ...td("right"), padding: "13px 8px" }}><StatCell m={r.markets.rebounds} /></td>
      <td style={{ ...td("right"), padding: "13px 8px" }}><StatCell m={r.markets.assists} /></td>
      <td style={{ ...td("right"), padding: "13px 8px" }}><StatCell m={r.markets.threes} /></td>
    </tr>
  );

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div className="section-header" onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 6 : 0 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#9ca3af", fontWeight: 600 }}>📋 ALL PLAYER PROJECTIONS · {rows.length}</span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{open ? "▲ hide" : "▼ show"}</span>
      </div>
      {open && (
        <>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 }}>
            Each stat shows our <strong style={{ color: "#e4e7eb" }}>projection</strong> and how far it sits from the book's <strong style={{ color: "#e4e7eb" }}>line</strong>:
            {" "}<span style={{ color: "#22c55e", fontWeight: 700 }}>▲ over</span> /{" "}
            <span style={{ color: "#ef4444", fontWeight: 700 }}>▼ under</span>, with the gap (e.g. <span style={{ color: "#22c55e", fontWeight: 700 }}>▲ 2.5</span> = we project 2.5 above the line).
            {" "}A <strong style={{ color: "#e4e7eb" }}>highlighted pill</strong> = flagged edge · <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#f59700", verticalAlign: "middle" }} /> = line looks off (likely news).
          </div>
          <div className="games-table-wrap" style={{ overflowX: "auto" }}>
            <table className="games-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1f2937", color: "#6b7280" }}>
                  <th style={th()}>Player</th>
                  <th style={th("right")}>Points</th>
                  <th style={th("right")}>Rebounds</th>
                  <th style={th("right")}>Assists</th>
                  <th style={th("right")}>3PT Made</th>
                </tr>
              </thead>
              <tbody>
                {grouped
                  ? groups.flatMap((g) => {
                      const logo = (g.rows.find((r) => r.teamLogo) || {}).teamLogo || null;
                      return [
                      <tr key={"hdr-" + g.team}>
                        <td colSpan={5} style={{ padding: "14px 10px 10px", background: "#11181f", borderTop: "2px solid #ef4444", borderBottom: "1px solid #1f2937" }}>
                          {logo
                            ? <img src={logo} alt="" width="22" height="22" style={{ verticalAlign: "middle", marginRight: 9, objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            : <span style={{ display: "inline-block", width: 4, height: 14, background: "#ef4444", borderRadius: 2, verticalAlign: "middle", marginRight: 9 }} />}
                          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.3, color: "#ffffff", verticalAlign: "middle" }}>{g.team}</span>
                          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 9, verticalAlign: "middle" }}>{g.rows.length} player{g.rows.length === 1 ? "" : "s"}</span>
                        </td>
                      </tr>,
                      ...g.rows.map((r, i) => renderRow(r, i)),
                    ];
                    })
                  : visible.map((r, i) => renderRow(r, i))}
              </tbody>
            </table>
          </div>
          {lockedCount > 0 && (
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                🔒 Unlock {lockedCount} more player{lockedCount === 1 ? "" : "s"} — $7/mo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One stat cell: projection prominent, line muted, a LIGHT lean indicator.
// Baseline cells stay calm (arrow + gap, no heavy pill) so the eye isn't flooded;
// only a FLAGGED edge gets the strong treatment (bold color + subtle pill) so the
// rare real edges actually stand out instead of 64 identical loud pills.
function StatCell({ m }) {
  if (!m || !m.eligible || m.line == null || m.projection == null) {
    return <span style={{ color: "#374151", fontSize: 13 }}>—</span>;
  }
  const isOver = m.side === "OVER";
  const color = isOver ? "#22c55e" : "#ef4444";
  const gap = Math.abs(m.edge).toFixed(1);
  const arrow = isOver ? "▲" : "▼";
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2, lineHeight: 1.15 }}>
      <span style={{ fontSize: 14, fontWeight: m.flagged ? 700 : 600, color: m.flagged ? color : "#e4e7eb", fontVariantNumeric: "tabular-nums" }}>
        {m.projection}{m.suspect ? <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#f59700", marginLeft: 5, verticalAlign: "middle" }} /> : null}
      </span>
      <span style={{ fontSize: 10, color: "#5b6472", fontVariantNumeric: "tabular-nums" }}>vs {m.line}</span>
      {m.flagged ? (
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color, background: `${color}1a`, border: `1px solid ${color}40`, borderRadius: 4, padding: "2px 6px", marginTop: 1 }}>
          {arrow} {m.side} {gap}
        </span>
      ) : (
        <span style={{ fontSize: 10, fontWeight: 600, color, fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
          {arrow} {gap}
        </span>
      )}
    </div>
  );
}

function NBASuspectPanel({ suspects }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderLeft: "3px solid #f59700", borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#fbbf24", fontWeight: 600 }}>⚠️ HELD BACK · LIKELY NEWS OR INJURY</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{suspects.length} flagged</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {suspects.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {s.name} · <span style={{ textTransform: "capitalize", color: "#9ca3af" }}>{s.stat}</span>{" "}
                <span style={{ color: s.side === "OVER" ? "#22c55e" : "#ef4444" }}>{s.side} {s.line}</span>
              </div>
              <div style={{ fontSize: 10, color: "#a8915c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.suspectReason || "suspect line"}</div>
            </div>
            <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{s.matchup}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NBAMoneylineRow({ edge, navigate }) {
  return (
    <div className="edge-row" onClick={() => navigate(`/game/nba/${edge.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 3 }}>
          {edge.teamAbbr} ML
          <InflationTag inflation={edge.inflation} />
        </div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.matchup} · {formatOdds(edge.odds)}{edge.time ? ` · ${edge.time}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", marginLeft: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>+{edge.edgePct.toFixed(1)}%</span>
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{edge.modelPct}% model</div>
      </div>
    </div>
  );
}

function NBATotalRow({ edge, navigate }) {
  return (
    <div className="edge-row" onClick={() => navigate(`/game/nba/${edge.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{edge.side === "over" ? "Over" : "Under"} {edge.line}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edge.matchup}</div>
      </div>
      <div style={{ textAlign: "right", marginLeft: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>{edge.edgePts.toFixed(1)} pts</span>
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>proj {edge.projected}</div>
      </div>
    </div>
  );
}

function nbaAbbr(full) {
  if (!full) return "—";
  const parts = full.split(" ");
  return parts[parts.length - 1];
}
function nbaTime(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function ComingSoon({ league, navigate }) {
  const GAMES_PATH = { nhl: "/nhl-games", nfl: "/nfl-games", ncaafb: "/cfb-games" };
  const path = GAMES_PATH[league?.id];
  return (
    <div style={{ textAlign: "center", padding: 80, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{league?.icon}</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{league?.label} edges — coming soon</h2>
      <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 460, margin: "0 auto 20px", lineHeight: 1.7 }}>
        {path
          ? `We're not publishing ${league?.label} model edges yet. Live scores and the full schedule are available now.`
          : `We're not publishing ${league?.label} edges yet. Check back in season.`}
      </p>
      {path && (
        <button onClick={() => navigate(path)} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
          View {league?.label} schedule →
        </button>
      )}
    </div>
  );
}
