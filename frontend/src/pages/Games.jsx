import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function GamesPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [edges, setEdges] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const loadEdges = useCallback(async () => {
    setLoading(true);
    try { const data = await edgesApi.getMLB(); setEdges(data); }
    catch (e) { console.error("Failed to load games:", e); setEdges(null); }
    setLoading(false);
  }, []);
  useEffect(() => { loadEdges(); }, [loadEdges]);

  const allGames = edges?.games || [];
  const liveGames = allGames.filter(g => g.status === "live");
  const upcomingGames = allGames.filter(g => g.status !== "live" && g.status !== "final");
  const finalGames = allGames.filter(g => g.status === "final");

  return (
    <div style={{ minHeight: "100vh", background: "#0c1d31", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .game-row{transition:background .15s;cursor:pointer}
        .game-row:hover{background:#131820}
        .section-header{transition:color .15s;cursor:pointer}
        .section-header:hover{color:#fff!important}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
          .games-table-wrap{margin:0 -14px!important}
          .games-table{font-size:11px!important}
          .games-table th,.games-table td{padding:6px 4px!important}
          .games-content{padding:16px 14px 60px!important}
          h1{font-size:24px!important}
        }
      `}</style>

      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(path) => { setDrawerOpen(false); navigate(path); }} />
          </div>
        </>
      )}

      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0c1d31", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="games-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>MLB Games</h1>
          <p style={{ margin: "0 0 28px", fontSize: 13, color: "#9ca3af" }}>
            Today's slate · <span style={{ color: "#ef4444", fontWeight: 600 }}>tap any game</span> for full analysis
          </p>

          {loading && <Loader />}
          {!loading && !edges && <ErrorState onRetry={loadEdges} />}
          {!loading && edges && (
            <>
              {liveGames.length > 0 && <GamesSection title="LIVE NOW" titleColor="#ef4444" games={liveGames} navigate={navigate} defaultOpen showLiveBadge />}
              {upcomingGames.length > 0 && <GamesSection title="UPCOMING" titleColor="#9ca3af" games={upcomingGames} navigate={navigate} defaultOpen />}
              {finalGames.length > 0 && <GamesSection title="FINAL" titleColor="#6b7280" games={finalGames} navigate={navigate} defaultOpen={false} showFinalScore />}
              {allGames.length === 0 && (
                <div style={{ background: "#13273c", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
                  
                  <div style={{ fontSize: 16, fontWeight: 700 }}>No games scheduled today</div>
                  <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Check back tomorrow for the next slate.</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GamesSection({ title, titleColor, games, navigate, defaultOpen, showLiveBadge, showFinalScore }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#13273c", border: "1px solid #1f2937", borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div className="section-header" onClick={() => setIsOpen(!isOpen)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOpen ? 12 : 0 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: titleColor, fontWeight: 700 }}>
          {title} <span style={{ marginLeft: 4, color: "#6b7280" }}>· {games.length} game{games.length === 1 ? "" : "s"}</span>
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
  if (weather.indoor) return <span title="Indoor stadium" style={{ fontSize: 10, fontWeight: 700, color: "#7d8a93", letterSpacing: ".04em" }}>DOME</span>;
  const icons = [];
  let tooltip = `${weather.tempF}°F`;
  if (weather.windEffect === "out") { icons.push("Wind out"); tooltip += ` · Wind OUT ${weather.windMph}mph (favors hitters)`; }
  else if (weather.windEffect === "in") { icons.push("Wind in"); tooltip += ` · Wind IN ${weather.windMph}mph (favors pitchers)`; }
  else if (weather.windEffect === "cross") { icons.push("Cross wind"); tooltip += ` · Cross wind ${weather.windMph}mph`; }
  if (weather.tempEffect === "hot") { icons.push("Warm"); tooltip += " · Warm air carries"; }
  else if (weather.tempEffect === "cold") { icons.push("Cold"); tooltip += " · Cold air dense"; }
  if (weather.isRaining) { icons.push("Rain"); tooltip += " · Rain"; }
  if (icons.length === 0) return <span title={tooltip} style={{ fontSize: 11, color: "#6b7280" }}>{weather.tempF}°</span>;
  return <span title={tooltip} style={{ fontSize: 13, cursor: "help" }}>{icons.join(" ")}</span>;
}

function th(align = "left") {
  return { padding: "8px 6px", textAlign: align, fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function td(align = "left") {
  return { padding: "10px 6px", textAlign: align, color: "#e4e7eb", fontSize: 12 };
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading today's games...</div>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#13273c", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}></div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load games</div>
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 8 }}>Retry</button>
    </div>
  );
}
