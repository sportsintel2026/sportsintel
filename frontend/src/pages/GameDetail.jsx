import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function GameDetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [allEdges, setAllEdges] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => {
    subscriptionApi.getMyPlan().then(setPlan).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    edgesApi.getMLB()
      .then(data => { setAllEdges(data); setLoading(false); })
      .catch(e => { console.error(e); setError("Could not load game data"); setLoading(false); });
  }, [gameId]);

  const game = allEdges?.games?.find(g => String(g.id) === String(gameId));
  const gameHRProps = (allEdges?.hrPropEdges || []).filter(
    p => p.game === `${game?.awayAbbr} @ ${game?.homeAbbr}`
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .back-btn{transition:color .15s;cursor:pointer}
        .back-btn:hover{color:#fff!important}
        @media (max-width: 768px) {
          .sidebar-container { display: none !important; }
          .main-content { margin-left: 0 !important; }
        }
      `}</style>

      <div className="sidebar-container">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 80px" }}>
          <Link to="/dashboard" className="back-btn" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
            ← Back to all edges
          </Link>

          {loading && <Loader />}
          {error && <ErrorState />}
          {!loading && !error && !game && <NotFound gameId={gameId} />}
          {!loading && !error && game && (
            <GameDetail game={game} hrProps={gameHRProps} hasFullAccess={hasFullAccess} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
}

function GameDetail({ game, hrProps, hasFullAccess, navigate }) {
  const ml = game.moneyline || {};
  const totals = game.totals || {};
  const awayP = game.pitchers?.away;
  const homeP = game.pitchers?.home;
  const isLive = game.status === "live";
  const isFinal = game.status === "final";

  const candidates = [
    { type: "ML", side: "away", team: game.awayAbbr, prob: ml.awayWinProb, odds: ml.awayOdds, edge: ml.awayEdge, confidence: ml.awayConfidence },
    { type: "ML", side: "home", team: game.homeAbbr, prob: ml.homeWinProb, odds: ml.homeOdds, edge: ml.homeEdge, confidence: ml.homeConfidence },
    { type: "TOTAL", side: "over", line: totals.line, prob: totals.overProb, odds: totals.overOdds, edge: totals.overEdge, confidence: totals.overConfidence, projected: totals.projected },
    { type: "TOTAL", side: "under", line: totals.line, prob: totals.underProb, odds: totals.underOdds, edge: totals.underEdge, confidence: totals.underConfidence, projected: totals.projected },
  ].filter(c => c.edge != null);

  const bestEdge = candidates.length > 0 ? candidates.reduce((a, b) => (a.edge > b.edge ? a : b)) : null;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <GameHeader game={game} isLive={isLive} isFinal={isFinal} />
      {isLive && <LiveWarningBanner />}
      {isFinal && <FinalBanner game={game} />}
      {bestEdge && !isFinal && <BestEdgeCard edge={bestEdge} game={game} hasFullAccess={hasFullAccess} navigate={navigate} />}
      {game.weather && <WeatherCard weather={game.weather} />}
      <PitcherMatchup awayPitcher={awayP} homePitcher={homeP} hasFullAccess={hasFullAccess} navigate={navigate} />
      <WinProbabilityCard awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} awayProb={ml.awayWinProb} homeProb={ml.homeWinProb} awayOdds={ml.awayOdds} homeOdds={ml.homeOdds} awayEdge={ml.awayEdge} homeEdge={ml.homeEdge} hasFullAccess={hasFullAccess} navigate={navigate} />
      <TotalsCard totals={totals} hasFullAccess={hasFullAccess} navigate={navigate} />
      <ContextCard game={game} />
      {hrProps.length > 0 && <HRPropsCard hrProps={hrProps} hasFullAccess={hasFullAccess} navigate={navigate} />}
    </div>
  );
}

function LiveWarningBanner() {
  return (
    <div style={{ background: "#1a1410", border: "1px solid #f5970033", borderLeft: "3px solid #f59700", borderRadius: 6, padding: "12px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <div>
          <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700, marginBottom: 2 }}>This game is in progress</div>
          <div style={{ fontSize: 11, color: "#a8915c", lineHeight: 1.5 }}>
            Odds shown are <strong>live in-game odds</strong>, which move quickly. Our model is calibrated for pre-game lines and edge calculations may be less accurate during live play.
          </div>
        </div>
      </div>
    </div>
  );
}

function FinalBanner({ game }) {
  return (
    <div style={{ background: "#0a1f15", border: "1px solid #22c55e30", borderLeft: "3px solid #22c55e", borderRadius: 6, padding: "12px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, color: "#22c55e", fontWeight: 700 }}>Final</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>This game has ended</div>
          </div>
        </div>
        {game.awayScore != null && (
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e4e7eb", fontVariantNumeric: "tabular-nums" }}>
            {game.awayAbbr} {game.awayScore} — {game.homeScore} {game.homeAbbr}
          </div>
        )}
      </div>
    </div>
  );
}

function GameHeader({ game, isLive, isFinal }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        ⚾ MLB · {game.time}
        {isLive && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 3, background: "#ef444415", color: "#ef4444", border: "1px solid #ef444440", letterSpacing: "0.05em" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
            LIVE {game.inning ? `· ${game.inning}` : ""}
          </span>
        )}
        {isFinal && (
          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 3, background: "#22c55e15", color: "#22c55e", border: "1px solid #22c55e40", letterSpacing: "0.05em" }}>
            FINAL
          </span>
        )}
      </div>
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
        <span style={{ color: "#e4e7eb" }}>{game.away}</span>
        <span style={{ color: "#4b5563", margin: "0 12px", fontWeight: 400 }}>@</span>
        <span style={{ color: "#e4e7eb" }}>{game.home}</span>
      </h1>
      <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>📍 {game.venue}</div>
    </div>
  );
}

function WeatherCard({ weather }) {
  if (weather.indoor) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 18, marginBottom: 18, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 30 }}>🏟️</div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>Game conditions</div>
          <div style={{ fontSize: 14, color: "#e4e7eb", fontWeight: 600 }}>Indoor stadium</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Weather doesn't affect play in domes</div>
        </div>
      </div>
    );
  }

  const hitterFavored = weather.windEffect === "out" || weather.tempEffect === "hot";
  const pitcherFavored = weather.windEffect === "in" || weather.tempEffect === "cold";
  const borderColor = hitterFavored ? "#22c55e44" : pitcherFavored ? "#ef444444" : "#1f2937";
  const accentColor = hitterFavored ? "#22c55e" : pitcherFavored ? "#ef4444" : "#9ca3af";

  return (
    <div style={{ background: "#0f1419", border: `1px solid ${borderColor}`, borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 14 }}>🌤️ Game conditions</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <WeatherStat icon="🌡️" label="Temperature" value={`${weather.tempF}°F`} color={weather.tempEffect === "hot" ? "#22c55e" : weather.tempEffect === "cold" ? "#ef4444" : "#e4e7eb"} subtitle={weather.tempEffect === "hot" ? "Warm air carries" : weather.tempEffect === "cold" ? "Cold air dense" : null} />
        <WeatherStat icon={weather.windEffect === "out" ? "💨↗" : weather.windEffect === "in" ? "💨↙" : "💨"} label="Wind" value={weather.windMph != null ? `${weather.windMph} mph` : "—"} color={weather.windEffect === "out" ? "#22c55e" : weather.windEffect === "in" ? "#ef4444" : "#e4e7eb"} subtitle={weather.windEffect === "out" ? "Favors hitters" : weather.windEffect === "in" ? "Favors pitchers" : weather.windEffect === "cross" ? "Cross wind" : "Calm"} />
        <WeatherStat icon={weather.isRaining ? "🌧️" : "☁️"} label="Conditions" value={weather.conditions || "—"} color="#e4e7eb" subtitle={weather.isRaining ? "Rain expected" : null} />
      </div>
      <div style={{ marginTop: 14, padding: 12, background: "#0a0e14", borderRadius: 6, fontSize: 12, color: accentColor }}>{weather.summary}</div>
    </div>
  );
}

function WeatherStat({ icon, label, value, color, subtitle }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function BestEdgeCard({ edge, game, hasFullAccess, navigate }) {
  const positive = edge.edge > 0;
  const desc = edge.type === "ML" ? `${edge.team} Moneyline` : `${edge.side === "over" ? "Over" : "Under"} ${edge.line}`;

  const reasons = [];
  if (edge.type === "ML") {
    if (edge.side === "home" && game.parkRunFactor > 1.05) reasons.push("Home park favors offense");
    if (edge.side === "home") reasons.push("Home field advantage (+4%)");
    const isMl = edge.team === game.awayAbbr ? game.pitchers?.away : game.pitchers?.home;
    if (isMl?.stats?.era && isMl.stats.era < 3.5) reasons.push(`Strong pitcher (${isMl.stats.era} ERA)`);
  } else {
    if (edge.side === "over" && game.parkRunFactor > 1.05) reasons.push(`${game.venue} plays as +${Math.round((game.parkRunFactor - 1) * 100)}% runs`);
    if (edge.side === "under" && game.parkRunFactor < 0.95) reasons.push(`${game.venue} suppresses scoring`);
    if (edge.projected != null) reasons.push(`Model projects ${edge.projected} runs vs ${edge.line} line`);
    if (game.weather && !game.weather.indoor) {
      if (edge.side === "over" && game.weather.windEffect === "out") reasons.push(`Wind blowing out ${game.weather.windMph}mph favors hitters`);
      if (edge.side === "under" && game.weather.windEffect === "in") reasons.push(`Wind blowing in ${game.weather.windMph}mph favors pitchers`);
      if (edge.side === "over" && game.weather.tempEffect === "hot") reasons.push(`${game.weather.tempF}°F — warm air carries the ball`);
    }
  }

  return (
    <div style={{ background: positive ? "linear-gradient(180deg,#0a1f15 0%,#0f1419 100%)" : "linear-gradient(180deg,#1f0a0a 0%,#0f1419 100%)", border: `1px solid ${positive ? "#22c55e44" : "#ef444444"}`, borderLeft: `4px solid ${positive ? "#22c55e" : "#ef4444"}`, borderRadius: 10, padding: "20px 24px", marginBottom: 18, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: positive ? "#22c55e" : "#ef4444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>🎯 Biggest model edge</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{desc}</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{formatOdds(edge.odds)} {edge.type === "TOTAL" && edge.projected != null && `· proj ${edge.projected}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {positive ? "+" : ""}{(edge.edge * 100).toFixed(1)}%
          </div>
          <ConfidenceBadge conf={edge.confidence} />
        </div>
      </div>

      {edge.prob != null && <ProbabilityBar modelProb={edge.prob} impliedProb={americanToImplied(edge.odds)} locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />}

      {reasons.length > 0 && hasFullAccess && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1f2937" }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>Why our model likes this</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {reasons.map((r, i) => (
              <li key={i} style={{ fontSize: 12, color: "#9ca3af", paddingLeft: 16, position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: positive ? "#22c55e" : "#ef4444" }}>✓</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasFullAccess && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1f2937", textAlign: "center" }}>
          <button onClick={() => navigate("/pricing")} style={ctaBtnStyle}>🔒 Unlock model reasoning — $7/mo</button>
        </div>
      )}
    </div>
  );
}

function ProbabilityBar({ modelProb, impliedProb, locked, onUnlock }) {
  const modelPct = Math.round(modelProb * 100);
  const impliedPct = impliedProb != null ? Math.round(impliedProb * 100) : null;
  return (
    <div style={{ marginTop: 14, padding: 14, background: "#0a0e14", borderRadius: 8, border: "1px solid #1f2937", position: "relative" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Our model</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e", lineHeight: 1 }}>{modelPct}%</div>
          <Bar pct={modelPct} color="#22c55e" />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>Sportsbook implies</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#9ca3af", lineHeight: 1 }}>{impliedPct != null ? `${impliedPct}%` : "—"}</div>
          <Bar pct={impliedPct || 0} color="#6b7280" />
        </div>
      </div>
      {locked && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,14,20,0.85)", backdropFilter: "blur(6px)", borderRadius: 8 }}>
          <button onClick={onUnlock} style={ctaBtnStyle}>🔒 See model breakdown</button>
        </div>
      )}
    </div>
  );
}

function Bar({ pct, color }) {
  return (
    <div style={{ marginTop: 8, height: 6, background: "#1f2937", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width .6s ease" }} />
    </div>
  );
}

function PitcherMatchup({ awayPitcher, homePitcher, hasFullAccess, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>⚾ Starting pitcher matchup</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "start" }}>
        <PitcherCard pitcher={awayPitcher} label="AWAY" hasFullAccess={hasFullAccess} navigate={navigate} />
        <div style={{ fontSize: 18, color: "#4b5563", fontWeight: 600, marginTop: 30 }}>vs</div>
        <PitcherCard pitcher={homePitcher} label="HOME" hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>
      {hasFullAccess && (awayPitcher?.recentStarts?.length > 0 || homePitcher?.recentStarts?.length > 0) && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #1f2937" }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 10 }}>📈 Last 3 starts</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <RecentStartsTable starts={awayPitcher?.recentStarts || []} />
            <RecentStartsTable starts={homePitcher?.recentStarts || []} />
          </div>
        </div>
      )}
    </div>
  );
}

function RecentStartsTable({ starts }) {
  if (!starts || starts.length === 0) return <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", padding: 12 }}>No recent starts</div>;
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 6, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#0f1419", color: "#6b7280" }}>
            <th style={tableHeaderStyle("left")}>Date</th>
            <th style={tableHeaderStyle("left")}>Opp</th>
            <th style={tableHeaderStyle("right")}>IP</th>
            <th style={tableHeaderStyle("right")}>ER</th>
            <th style={tableHeaderStyle("right")}>K</th>
            <th style={tableHeaderStyle("right")}>BB</th>
            <th style={tableHeaderStyle("center")}>W/L</th>
          </tr>
        </thead>
        <tbody>
          {starts.map((s, i) => {
            const resultColor = s.result === "W" ? "#22c55e" : s.result === "L" ? "#ef4444" : "#6b7280";
            const erColor = s.er === 0 ? "#22c55e" : s.er >= 4 ? "#ef4444" : "#e4e7eb";
            return (
              <tr key={i} style={{ borderTop: i > 0 ? "1px solid #131820" : "none" }}>
                <td style={tableCellStyle("left")}>{formatStartDate(s.date)}</td>
                <td style={tableCellStyle("left", "#9ca3af")}>{abbrevTeam(s.opponent)}</td>
                <td style={tableCellStyle("right", "#e4e7eb", true)}>{s.ip}</td>
                <td style={tableCellStyle("right", erColor, true)}>{s.er}</td>
                <td style={tableCellStyle("right", "#e4e7eb", true)}>{s.k}</td>
                <td style={tableCellStyle("right", "#9ca3af", true)}>{s.bb}</td>
                <td style={tableCellStyle("center", resultColor, true)}>{s.result}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tableHeaderStyle(align) {
  return { padding: "6px 8px", textAlign: align, fontWeight: 500, fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function tableCellStyle(align, color = "#e4e7eb", bold = false) {
  return { padding: "6px 8px", textAlign: align, color, fontSize: 11, fontWeight: bold ? 600 : 400, fontVariantNumeric: "tabular-nums" };
}

function formatStartDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function abbrevTeam(name) {
  if (!name) return "—";
  const map = {
    "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Athletics": "ATH", "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS", "Cincinnati Reds": "CIN",
    "Cleveland Guardians": "CLE", "Colorado Rockies": "COL", "Detroit Tigers": "DET", "Houston Astros": "HOU",
    "Kansas City Royals": "KC", "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
    "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM", "New York Yankees": "NYY",
    "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
    "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
    "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH",
  };
  return map[name] || name.slice(0, 3).toUpperCase();
}

function PitcherCard({ pitcher, label, hasFullAccess, navigate }) {
  if (!pitcher) {
    return (
      <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16, textAlign: "center" }}>
        <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: "#4b5563" }}>TBD</div>
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>Pitcher not yet announced</div>
      </div>
    );
  }

  const stats = pitcher.stats;
  const eraGood = stats?.era != null && stats.era < 3.5;
  const eraBad = stats?.era != null && stats.era > 4.5;

  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16, position: "relative" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{pitcher.name}</div>
      {stats ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
          <StatBlock label="ERA" value={stats.era?.toFixed(2)} highlight={eraGood ? "#22c55e" : eraBad ? "#ef4444" : null} />
          <StatBlock label="WHIP" value={stats.whip?.toFixed(2)} />
          <StatBlock label="K/9" value={stats.strikeoutsPer9?.toFixed(1)} highlight={stats.strikeoutsPer9 > 9 ? "#22c55e" : null} />
          <StatBlock label="BB/9" value={stats.walksPer9?.toFixed(1)} highlight={stats.walksPer9 < 2.5 ? "#22c55e" : stats.walksPer9 > 4 ? "#ef4444" : null} />
          <StatBlock label="HR/9" value={stats.homeRunsPer9?.toFixed(2)} highlight={stats.homeRunsPer9 < 1.0 ? "#22c55e" : stats.homeRunsPer9 > 1.5 ? "#ef4444" : null} />
          <StatBlock label="Record" value={`${stats.wins}-${stats.losses}`} />
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#6b7280" }}>Season stats unavailable</div>
      )}
      {!hasFullAccess && stats && (
        <div style={{ marginTop: 12, fontSize: 10, color: "#6b7280", textAlign: "center" }}>
          <button onClick={() => navigate("/pricing")} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700 }}>
            🔒 Unlock recent starts + advanced metrics
          </button>
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, value, highlight }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1a1f28", borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: highlight || "#e4e7eb", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value ?? "—"}</div>
    </div>
  );
}

function WinProbabilityCard({ awayAbbr, homeAbbr, awayProb, homeProb, awayOdds, homeOdds, awayEdge, homeEdge, hasFullAccess, navigate }) {
  if (awayProb == null && homeProb == null) return null;
  const awayPct = Math.round((awayProb ?? 0) * 100);
  const homePct = Math.round((homeProb ?? 0) * 100);

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18, position: "relative" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>💰 Moneyline · model vs market</div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: "#e4e7eb" }}>{awayAbbr} <span style={{ color: "#22c55e" }}>{awayPct}%</span></span>
          <span style={{ color: "#e4e7eb" }}><span style={{ color: "#22c55e" }}>{homePct}%</span> {homeAbbr}</span>
        </div>
        <div style={{ height: 14, borderRadius: 7, background: "#1f2937", overflow: "hidden", display: "flex", position: "relative" }}>
          <div style={{ width: `${awayPct}%`, background: "linear-gradient(90deg,#3b82f6,#2563eb)", transition: "width .6s ease" }} />
          <div style={{ width: `${homePct}%`, background: "linear-gradient(90deg,#ef4444,#dc2626)", transition: "width .6s ease" }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MLBox abbr={awayAbbr} prob={awayProb} odds={awayOdds} edge={awayEdge} side="Away" locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
        <MLBox abbr={homeAbbr} prob={homeProb} odds={homeOdds} edge={homeEdge} side="Home" locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
      </div>
    </div>
  );
}

function MLBox({ abbr, prob, odds, edge, side, locked, onUnlock }) {
  const implied = americanToImplied(odds);
  const positive = edge != null && edge > 0;
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${positive && !locked ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14, position: "relative" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{side.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{abbr} ML · {formatOdds(odds)}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Model: <span style={{ color: "#22c55e", fontWeight: 600 }}>{prob != null ? Math.round(prob * 100) : "—"}%</span></div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>Market: <span style={{ color: "#9ca3af", fontWeight: 600 }}>{implied != null ? Math.round(implied * 100) : "—"}%</span></div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1f2937" }}>
        {edge != null ? (
          <div style={{ fontSize: 20, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", fontVariantNumeric: "tabular-nums" }}>
            {positive ? "+" : ""}{(edge * 100).toFixed(1)}% edge
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#4b5563" }}>No odds available</div>
        )}
      </div>
      {locked && edge != null && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,20,0.85)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
          <button onClick={onUnlock} style={{ ...ctaBtnStyle, padding: "6px 12px", fontSize: 11 }}>🔒 Unlock</button>
        </div>
      )}
    </div>
  );
}

function TotalsCard({ totals, hasFullAccess, navigate }) {
  if (totals.line == null && totals.projected == null) return null;
  const delta = totals.projected != null && totals.line != null ? totals.projected - totals.line : null;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>📊 Total runs · model vs market</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <BigStat label="Sportsbook line" value={totals.line ?? "—"} color="#9ca3af" />
        <BigStat label="Model projects" value={totals.projected ?? "—"} color="#22c55e" />
        <BigStat label="Difference" value={delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "—"} color={delta > 0 ? "#22c55e" : delta < 0 ? "#ef4444" : "#9ca3af"} />
      </div>
      {totals.breakdown && hasFullAccess && (
        <div style={{ marginTop: 14, padding: 12, background: "#0a0e14", borderRadius: 6, border: "1px solid #1f2937" }}>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Model breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, fontSize: 11 }}>
            <BreakdownItem label="Base offense" value={totals.breakdown.base} />
            <BreakdownItem label="Pitcher adj" value={totals.breakdown.pitcherAdj} signed />
            <BreakdownItem label="Park adj" value={totals.breakdown.parkAdj} signed />
            <BreakdownItem label="Weather adj" value={totals.breakdown.weatherAdj} signed highlight />
          </div>
        </div>
      )}
      {(totals.overEdge != null || totals.underEdge != null) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <TotalSideBox side="OVER" line={totals.line} prob={totals.overProb} odds={totals.overOdds} edge={totals.overEdge} locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
          <TotalSideBox side="UNDER" line={totals.line} prob={totals.underProb} odds={totals.underOdds} edge={totals.underEdge} locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
        </div>
      )}
    </div>
  );
}

function BreakdownItem({ label, value, signed, highlight }) {
  if (value == null) return null;
  const isAdj = signed && value !== 0;
  const color = highlight && value !== 0 ? (value > 0 ? "#22c55e" : "#ef4444") : isAdj ? (value > 0 ? "#22c55e" : "#ef4444") : "#e4e7eb";
  const sign = isAdj && value > 0 ? "+" : "";
  return (
    <div style={{ background: "#0f1419", borderRadius: 4, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{sign}{value.toFixed(2)}</div>
    </div>
  );
}

function BigStat({ label, value, color }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function TotalSideBox({ side, line, prob, odds, edge, locked, onUnlock }) {
  const positive = edge != null && edge > 0;
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${positive && !locked ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14, position: "relative" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{side} {line} · {formatOdds(odds)}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Model: <span style={{ color: "#22c55e", fontWeight: 600 }}>{prob != null ? Math.round(prob * 100) : "—"}%</span></div>
      {edge != null && (
        <div style={{ fontSize: 18, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", fontVariantNumeric: "tabular-nums" }}>
          {positive ? "+" : ""}{(edge * 100).toFixed(1)}% edge
        </div>
      )}
      {locked && edge != null && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,20,0.85)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
          <button onClick={onUnlock} style={{ ...ctaBtnStyle, padding: "6px 12px", fontSize: 11 }}>🔒 Unlock</button>
        </div>
      )}
    </div>
  );
}

function ContextCard({ game }) {
  const runFactor = game.parkRunFactor || 1.0;
  const hrFactor = game.parkHRFactor || 1.0;
  const runDelta = (runFactor - 1) * 100;
  const hrDelta = (hrFactor - 1) * 100;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>🏟️ Park & context</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FactorCard icon="📊" label="Run environment" venue={game.venue} factor={runFactor} delta={runDelta} />
        <FactorCard icon="💣" label="Home run factor" venue={game.venue} factor={hrFactor} delta={hrDelta} />
      </div>
    </div>
  );
}

function FactorCard({ icon, label, venue, factor, delta }) {
  const friendly = delta > 5;
  const suppressive = delta < -5;
  const color = friendly ? "#22c55e" : suppressive ? "#ef4444" : "#9ca3af";
  const labelText = friendly ? "Hitter friendly" : suppressive ? "Pitcher friendly" : "Neutral";
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{labelText}</div>
      <div style={{ marginTop: 8, height: 4, background: "#1f2937", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#374151" }} />
        <div style={{ position: "absolute", height: "100%", left: delta >= 0 ? "50%" : `${50 + delta / 2}%`, width: `${Math.min(Math.abs(delta) / 2, 50)}%`, background: color, transition: "width .6s ease, left .6s ease" }} />
      </div>
    </div>
  );
}

function HRPropsCard({ hrProps, hasFullAccess, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>💣 Home run props · BvP + recent form</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {hrProps.slice(0, hasFullAccess ? 10 : 1).map((p, i) => (
          <HRPropCard key={i} prop={p} hasFullAccess={hasFullAccess} />
        ))}
        {!hasFullAccess && hrProps.length > 1 && (
          <div style={{ marginTop: 4, padding: 16, background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>{hrProps.length - 1} more HR prop edge{hrProps.length - 1 === 1 ? "" : "s"} for this game</div>
            <button onClick={() => navigate("/pricing")} style={ctaBtnStyle}>🔒 Unlock all HR props</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HRPropCard({ prop, hasFullAccess }) {
  const positive = prop.edge > 0;
  const borderColor = prop.confidence === "HIGH" ? "#22c55e30" : prop.confidence === "MEDIUM" ? "#f59e0b30" : "#1f2937";

  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${borderColor}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{prop.player}</div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            {prop.team} · vs <span style={{ color: "#e4e7eb" }}>{prop.opposingPitcher || "TBD"}</span>
            {prop.opposingPitcherHR9 != null && <span style={{ color: "#6b7280" }}> ({prop.opposingPitcherHR9.toFixed(2)} HR/9)</span>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {positive ? "+" : ""}{(prop.edge * 100).toFixed(1)}%
          </div>
          <ConfidenceBadge conf={prop.confidence} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr auto", gap: 12, padding: "10px 12px", background: "#0f1419", borderRadius: 6, marginBottom: 10, fontSize: 11 }}>
        <div>
          <div style={{ color: "#6b7280", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Odds</div>
          <div style={{ color: "#e4e7eb", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{formatOdds(prop.odds)}</div>
          <div style={{ color: "#4b5563", fontSize: 9, marginTop: 2 }}>{prop.book || ""}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Model %</div>
          <div style={{ color: "#22c55e", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{Math.round(prop.hrProb * 100)}%</div>
        </div>
        <div>
          <div style={{ color: "#6b7280", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Market %</div>
          <div style={{ color: "#9ca3af", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{Math.round(americanToImplied(prop.odds) * 100)}%</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#6b7280", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Park</div>
          <div style={{ color: prop.parkHRFactor > 1.05 ? "#22c55e" : prop.parkHRFactor < 0.95 ? "#ef4444" : "#9ca3af", fontWeight: 600, fontSize: 13, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {prop.parkHRFactor?.toFixed(2)}
          </div>
        </div>
      </div>

      {hasFullAccess && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <DataPanel
            title="Season"
            stats={[
              { label: "HR", value: prop.batterStats?.hr ?? "—" },
              { label: "ISO", value: prop.batterStats?.iso != null ? prop.batterStats.iso.toFixed(3) : "—" },
              { label: "SLG", value: prop.batterStats?.slg?.toFixed(3) ?? "—" },
            ]}
          />
          <DataPanel
            title="Last 15"
            highlight={prop.recent15?.hr > 1 || prop.recent15?.ops > 0.900}
            stats={[
              { label: "AB", value: prop.recent15?.atBats ?? "—" },
              { label: "AVG", value: prop.recent15?.avg != null ? prop.recent15.avg.toFixed(3) : "—" },
              { label: "HR", value: prop.recent15?.hr ?? "—" },
            ]}
            emptyText={!prop.recent15 ? "Not enough recent data" : null}
          />
          <DataPanel
            title="vs Pitcher (career)"
            highlight={prop.bvp?.hr > 0 || (prop.bvp?.atBats >= 10 && prop.bvp?.avg > 0.300)}
            stats={prop.bvp ? [
              { label: "AB", value: prop.bvp.atBats },
              { label: "AVG", value: prop.bvp.avg != null ? prop.bvp.avg.toFixed(3) : "—" },
              { label: "HR", value: prop.bvp.hr },
            ] : null}
            emptyText="No career history vs this pitcher"
          />
        </div>
      )}

      {prop.weatherEffect && prop.weatherEffect !== "calm" && hasFullAccess && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: prop.weatherEffect === "out" ? "#0a1f15" : prop.weatherEffect === "in" ? "#1f0a0a" : "#0f1419", border: `1px solid ${prop.weatherEffect === "out" ? "#22c55e30" : prop.weatherEffect === "in" ? "#ef444430" : "#1f2937"}`, borderRadius: 6, fontSize: 11, color: prop.weatherEffect === "out" ? "#22c55e" : prop.weatherEffect === "in" ? "#ef4444" : "#9ca3af" }}>
          {prop.weatherEffect === "out" && "💨↗ Wind blowing OUT — favors HR"}
          {prop.weatherEffect === "in" && "💨↙ Wind blowing IN — suppresses HR"}
          {prop.weatherEffect === "cross" && "💨 Cross wind — neutral HR impact"}
        </div>
      )}
    </div>
  );
}

function DataPanel({ title, stats, emptyText, highlight }) {
  return (
    <div style={{ background: "#0f1419", border: `1px solid ${highlight ? "#22c55e30" : "#1a1f28"}`, borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 9, color: highlight ? "#22c55e" : "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {stats ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#6b7280", letterSpacing: "0.05em", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e4e7eb", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: "#4b5563", textAlign: "center", padding: "8px 0" }}>{emptyText}</div>
      )}
    </div>
  );
}

function ConfidenceBadge({ conf }) {
  const colors = {
    HIGH: { bg: "#22c55e15", fg: "#22c55e", border: "#22c55e30" },
    MEDIUM: { bg: "#f59e0b15", fg: "#f59e0b", border: "#f59e0b30" },
    LOW: { bg: "#1f2937", fg: "#9ca3af", border: "#374151" },
    NEUTRAL: { bg: "#1f2937", fg: "#6b7280", border: "#374151" },
  };
  const c = colors[conf] || colors.NEUTRAL;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, letterSpacing: "0.05em", display: "inline-block", marginTop: 6 }}>
      {conf || "—"}
    </span>
  );
}

function formatOdds(american) {
  if (american == null) return "—";
  return american > 0 ? `+${american}` : `${american}`;
}

function americanToImplied(american) {
  if (american == null) return null;
  if (american >= 100) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

const ctaBtnStyle = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 80 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading game analysis...</div>
    </div>
  );
}

function ErrorState() {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load this game</div>
      <Link to="/dashboard" style={{ fontSize: 12, color: "#ef4444", textDecoration: "none", fontWeight: 700 }}>← Back to dashboard</Link>
    </div>
  );
}

function NotFound({ gameId }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Game not found</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>Game ID {gameId} isn't in today's slate. It may have ended or been postponed.</div>
      <Link to="/dashboard" style={{ fontSize: 12, color: "#ef4444", textDecoration: "none", fontWeight: 700 }}>← Back to dashboard</Link>
    </div>
  );
}
