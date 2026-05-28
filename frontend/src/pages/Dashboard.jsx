import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, supabase } from "../lib/api";
import Sidebar from "./Sidebar";

const LEAGUES = [
  { id: "mlb", label: "MLB", icon: "⚾", live: true },
  { id: "nba", label: "NBA", icon: "🏀", live: false },
  { id: "nhl", label: "NHL", icon: "🏒", live: false },
  { id: "nfl", label: "NFL", icon: "🏈", live: false },
  { id: "soccer", label: "Soccer", icon: "⚽", live: false },
  { id: "golf", label: "Golf", icon: "⛳", live: false },
];

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [league, setLeague] = useState("mlb");
  const [edges, setEdges] = useState(null);
  const [edgesLoading, setEdgesLoading] = useState(true);
  const [picks, setPicks] = useState([]);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    const loadPicks = async () => {
      try {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const { data } = await supabase.from("daily_picks").select("*").eq("date", today).maybeSingle();
        if (data?.picks) setPicks(JSON.parse(data.picks));
      } catch (e) {}
    };
    loadPicks();
  }, []);

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
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <LeagueTabs league={league} setLeague={setLeague} />
        <div className="dashboard-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px 60px" }}>
          {league === "mlb" ? (
            <MLBDashboard edges={edges} loading={edgesLoading} picks={picks} hasFullAccess={hasFullAccess} navigate={navigate} onRefresh={loadEdges} />
          ) : (
            <ComingSoon league={LEAGUES.find(l => l.id === league)} />
          )}
        </div>
      </div>
    </div>
  );
}

function LeagueTabs({ league, setLeague }) {
  return (
    <div style={{ background: "#0a0e14", borderBottom: "1px solid #1a1f28", position: "sticky", top: 0, zIndex: 39 }}>
      <div className="league-tabs-inner" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", gap: 4, overflowX: "auto" }}>
        {LEAGUES.map(l => {
          const active = league === l.id;
          return (
            <button key={l.id} className="tab-btn" onClick={() => setLeague(l.id)} style={{ background: "none", border: "none", padding: "14px 14px", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#fff" : "#6b7280", borderBottom: `2px solid ${active ? "#ef4444" : "transparent"}`, marginBottom: -1, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{l.icon}</span>
              <span>{l.label}</span>
              {!l.live && <span style={{ fontSize: 9, color: "#4b5563", marginLeft: 2 }}>· Soon</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MLBDashboard({ edges, loading, picks, hasFullAccess, navigate, onRefresh }) {
  if (loading) return <Loader />;
  if (!edges) return <ErrorState onRetry={onRefresh} />;
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const gameCount = edges.games?.length || 0;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Today's edges · {date.split(",")[0]}</h1>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {gameCount} games · {edges.cached ? "Cached" : "Updated"} {new Date(edges.computedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
        Model projections vs sportsbook lines · weather, batter vs pitcher history, recent form. <span style={{ color: "#ef4444", fontWeight: 600 }}>Click any game</span> for deep analysis.
      </p>
      <div style={{ background: "#1a1410", border: "1px solid #f5970022", borderLeft: "3px solid #f59700", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#fbbf24" }}>
        <strong>Model v0.3 · Research-grade.</strong> <span style={{ color: "#a8915c" }}>Pre-game model — live games show in-game odds. Use as one input among many, not gospel.</span>
      </div>
      {picks.length > 0 && <EditorialBestBets picks={picks} hasFullAccess={hasFullAccess} navigate={navigate} />}
      <div className="edge-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, gridAutoRows: "1fr" }}>
        <EdgePanel title="Top moneyline edges" icon="💰" edges={edges.moneylineEdges || []} renderRow={(e) => <MoneylineRow edge={e} key={e.gameId + e.side} navigate={navigate} />} emptyText="No edges found in current slate" hasFullAccess={hasFullAccess} navigate={navigate} />
        <EdgePanel title="Top totals edges" icon="📊" edges={edges.totalsEdges || []} renderRow={(e) => <TotalsRow edge={e} key={e.gameId + e.side} navigate={navigate} />} emptyText="No edges found in current slate" hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <EdgePanel title="Top home run props" icon="💣" edges={edges.hrPropEdges || []} renderRow={(e) => <HRPropRow edge={e} key={e.player + e.game} />} emptyText="HR prop data updates closer to first pitch" hasFullAccess={hasFullAccess} navigate={navigate} wide />
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

function EditorialBestBets({ picks, hasFullAccess, navigate }) {
  return (
    <div style={{ background: "linear-gradient(180deg,#1a1410 0%,#0f1419 100%)", border: "1px solid #ef444433", borderLeft: "3px solid #ef4444", borderRadius: 8, padding: "16px 20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#ef4444", fontWeight: 600 }}>🎯 TODAY'S BEST BETS · EDITORIAL</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{picks.length} pick{picks.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(picks.length, 3)}, 1fr)`, gap: 12 }}>
        {picks.map((p, i) => {
          const locked = !hasFullAccess && i > 0;
          return (
            <div key={i} style={{ position: "relative", background: "#0f1419", borderRadius: 6, padding: 12, border: "1px solid #1f2937", overflow: "hidden" }}>
              {locked && (
                <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(8px)", background: "#0a0e1499", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🔒 Unlock — $7/mo</button>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <ConfidenceBadge conf={p.confidence} />
                <span style={{ fontSize: 11, color: "#6b7280" }}>{p.league}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{p.pick}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>{p.game} · {p.odds}</div>
              <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>{p.analysis}</div>
            </div>
          );
        })}
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

function MoneylineRow({ edge, navigate }) {
  const isLive = edge.status === "live";
  return (
    <div className="edge-row" onClick={() => navigate(`/game/mlb/${edge.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center" }}>
          {edge.teamAbbr} ML
          {isLive && <LiveBadge />}
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
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: "flex", alignItems: "center" }}>
          {edge.side === "over" ? "Over" : "Under"} {edge.line}
          {isLive && <LiveBadge />}
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

function HRPropRow({ edge }) {
  const bvpText = edge.bvp && edge.bvp.atBats > 0
    ? `BvP: ${edge.bvp.hits}/${edge.bvp.atBats}${edge.bvp.hr > 0 ? `, ${edge.bvp.hr} HR` : ""}`
    : null;
  const recentText = edge.recent15
    ? `L15: ${(edge.recent15.avg * 1000).toFixed(0).replace(/^0/, ".")}${edge.recent15.hr > 0 ? `, ${edge.recent15.hr} HR` : ""}`
    : null;
  const detailLine = [bvpText, recentText].filter(Boolean).join(" · ");

  return (
    <div className="edge-row hr-prop-row" style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.player}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.team} · vs {edge.opposingPitcher || "TBD"}
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

function ComingSoon({ league }) {
  return (
    <div style={{ textAlign: "center", padding: 80, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{league?.icon}</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{league?.label} analytics — coming soon</h2>
      <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 440, margin: "0 auto", lineHeight: 1.7 }}>
        We're focused on building the best MLB betting intelligence first. {league?.label} edges, projections, and props will roll out once MLB is proven.
      </p>
    </div>
  );
}
