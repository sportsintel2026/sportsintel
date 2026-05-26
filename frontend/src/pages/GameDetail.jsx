import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";

export default function GameDetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [allEdges, setAllEdges] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [menuOpen, setMenuOpen] = useState(false);

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
      .then(data => {
        setAllEdges(data);
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setError("Could not load game data");
        setLoading(false);
      });
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
      `}</style>

      <Header user={user} plan={plan} signOut={signOut} navigate={navigate} menuOpen={menuOpen} setMenuOpen={setMenuOpen} isAdmin={isAdmin} hasFullAccess={hasFullAccess} />

      {menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 80px" }}>
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
  );
}

function Header({ user, plan, signOut, navigate, menuOpen, setMenuOpen, isAdmin, hasFullAccess }) {
  let badge;
  if (isAdmin) badge = { text: "ADMIN", bg: "#a855f715", fg: "#a855f7", border: "#a855f730" };
  else if (hasFullAccess) badge = { text: "SUBSCRIBED", bg: "#22c55e15", fg: "#22c55e", border: "#22c55e30" };
  else badge = { text: "FREE", bg: "#1c2128", fg: "#6b7280", border: "#1f2937" };

  return (
    <div style={{ background: "#0a0e14", borderBottom: "1px solid #1a1f28", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <Link to="/dashboard" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 17, fontWeight: 800, color: "#e4e7eb", letterSpacing: "-0.01em" }}>
            Sports<span style={{ color: "#ef4444" }}>intel</span>
          </span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, padding: "4px 10px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.06em", background: badge.bg, color: badge.fg, border: `1px solid ${badge.border}` }}>{badge.text}</span>
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen(o => !o)} style={{ width: 32, height: 32, borderRadius: "50%", background: isAdmin ? "linear-gradient(135deg,#a855f7,#7e22ce)" : "linear-gradient(135deg,#ef4444,#dc2626)", border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
              {user?.email?.[0]?.toUpperCase() || "U"}
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: 40, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 8, minWidth: 220, zIndex: 200, boxShadow: "0 12px 40px #00000080" }}>
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#6b7280", borderBottom: "1px solid #1a1f28", marginBottom: 6 }}>
                  {user?.email}
                  {isAdmin && <div style={{ marginTop: 4, fontSize: 10, color: "#a855f7", fontWeight: 700, letterSpacing: "0.05em" }}>OWNER ACCOUNT</div>}
                </div>
                {!hasFullAccess && (
                  <button onClick={() => { navigate("/pricing"); setMenuOpen(false); }} style={{ width: "100%", textAlign: "left", background: "#ef444412", border: "1px solid #ef444430", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#ef4444", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 6 }}>
                    ⚡ Subscribe — $7/mo
                  </button>
                )}
                <button onClick={() => { navigate("/dashboard"); setMenuOpen(false); }} style={menuBtnStyle}>📊 Dashboard</button>
                <button onClick={() => { signOut(); navigate("/"); }} style={menuBtnStyle}>↩ Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const menuBtnStyle = { width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 12px", fontSize: 12, color: "#9ca3af", cursor: "pointer", fontFamily: "inherit", borderRadius: 6 };

function GameDetail({ game, hrProps, hasFullAccess, navigate }) {
  const ml = game.moneyline || {};
  const totals = game.totals || {};
  const awayP = game.pitchers?.away;
  const homeP = game.pitchers?.home;

  const candidates = [
    { type: "ML", side: "away", team: game.awayAbbr, prob: ml.awayWinProb, odds: ml.awayOdds, edge: ml.awayEdge, confidence: ml.awayConfidence },
    { type: "ML", side: "home", team: game.homeAbbr, prob: ml.homeWinProb, odds: ml.homeOdds, edge: ml.homeEdge, confidence: ml.homeConfidence },
    { type: "TOTAL", side: "over", line: totals.line, prob: totals.overProb, odds: totals.overOdds, edge: totals.overEdge, confidence: totals.overConfidence, projected: totals.projected },
    { type: "TOTAL", side: "under", line: totals.line, prob: totals.underProb, odds: totals.underOdds, edge: totals.underEdge, confidence: totals.underConfidence, projected: totals.projected },
  ].filter(c => c.edge != null);

  const bestEdge = candidates.length > 0 ? candidates.reduce((a, b) => (a.edge > b.edge ? a : b)) : null;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <GameHeader game={game} />
      {bestEdge && <BestEdgeCard edge={bestEdge} game={game} hasFullAccess={hasFullAccess} navigate={navigate} />}
      <PitcherMatchup awayPitcher={awayP} homePitcher={homeP} hasFullAccess={hasFullAccess} navigate={navigate} />
      <WinProbabilityCard awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} awayProb={ml.awayWinProb} homeProb={ml.homeWinProb} awayOdds={ml.awayOdds} homeOdds={ml.homeOdds} awayEdge={ml.awayEdge} homeEdge={ml.homeEdge} hasFullAccess={hasFullAccess} navigate={navigate} />
      <TotalsCard totals={totals} hasFullAccess={hasFullAccess} navigate={navigate} />
      <ContextCard game={game} />
      {hrProps.length > 0 && <HRPropsCard hrProps={hrProps} hasFullAccess={hasFullAccess} navigate={navigate} />}
    </div>
  );
}

function GameHeader({ game }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
        ⚾ MLB · {game.time}
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
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>
        ⚾ Starting pitcher matchup
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "start" }}>
        <PitcherCard pitcher={awayPitcher} label="AWAY" hasFullAccess={hasFullAccess} navigate={navigate} />
        <div style={{ fontSize: 18, color: "#4b5563", fontWeight: 600, marginTop: 30 }}>vs</div>
        <PitcherCard pitcher={homePitcher} label="HOME" hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>
    </div>
  );
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
            🔒 Unlock advanced metrics
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
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>
        💰 Moneyline · model vs market
      </div>
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
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>
        📊 Total runs · model vs market
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <BigStat label="Sportsbook line" value={totals.line ?? "—"} color="#9ca3af" />
        <BigStat label="Model projects" value={totals.projected ?? "—"} color="#22c55e" />
        <BigStat label="Difference" value={delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "—"} color={delta > 0 ? "#22c55e" : delta < 0 ? "#ef4444" : "#9ca3af"} />
      </div>
      {(totals.overEdge != null || totals.underEdge != null) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <TotalSideBox side="OVER" line={totals.line} prob={totals.overProb} odds={totals.overOdds} edge={totals.overEdge} locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
          <TotalSideBox side="UNDER" line={totals.line} prob={totals.underProb} odds={totals.underOdds} edge={totals.underEdge} locked={!hasFullAccess} onUnlock={() => navigate("/pricing")} />
        </div>
      )}
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
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>
        🏟️ Park & context
      </div>
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
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>
        💣 Home run props for this game
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hrProps.slice(0, hasFullAccess ? 10 : 1).map((p, i) => (
          <HRPropRow key={i} prop={p} />
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

function HRPropRow({ prop }) {
  const positive = prop.edge > 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 6, alignItems: "center", border: "1px solid #1f2937" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{prop.player}</div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>vs {prop.opposingPitcher || "TBD"}</div>
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>{formatOdds(prop.odds)}</div>
      <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "right" }}>{Math.round(prop.hrProb * 100)}%</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: positive ? "#22c55e" : "#ef4444", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {positive ? "+" : ""}{(prop.edge * 100).toFixed(1)}%
      </div>
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
      {conf || "—"} CONFIDENCE
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
