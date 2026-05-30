import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, scoresApi } from "../lib/api";
import { BoxScore } from "./LiveScores";
import Sidebar from "./Sidebar";

export default function GameDetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [allEdges, setAllEdges] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

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
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .back-btn{transition:color .15s;cursor:pointer}
        .back-btn:hover{color:#fff!important}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
          .gd-content{padding:16px 14px 60px!important}
          h1{font-size:24px!important}
          .bvp-grid{grid-template-columns:1fr!important}
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

      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="gd-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 80px" }}>
          <Link to="/games" className="back-btn" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
            ← Back to MLB Games
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
      <LiveScoreHeader gameId={game.id} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} league="mlb" />
      {isLive && <LiveWarningBanner />}
      {isFinal && <FinalBanner game={game} />}
      {bestEdge && !isFinal && <BestEdgeCard edge={bestEdge} game={game} hasFullAccess={hasFullAccess} navigate={navigate} />}
      {game.weather && <WeatherCard weather={game.weather} />}
      <PitcherMatchup awayPitcher={awayP} homePitcher={homeP} hasFullAccess={hasFullAccess} navigate={navigate} />
      <BatterVsPitcherSection gameId={game.id} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} hasFullAccess={hasFullAccess} navigate={navigate} />
      <WinProbabilityCard awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} awayProb={ml.awayWinProb} homeProb={ml.homeWinProb} awayOdds={ml.awayOdds} homeOdds={ml.homeOdds} awayEdge={ml.awayEdge} homeEdge={ml.homeEdge} hasFullAccess={hasFullAccess} navigate={navigate} />
      <TotalsCard totals={totals} hasFullAccess={hasFullAccess} navigate={navigate} />
      <ContextCard game={game} />
      {hrProps.length > 0 && <HRPropsCard hrProps={hrProps} hasFullAccess={hasFullAccess} navigate={navigate} />}
    </div>
  );
}

// Live/final scoreboard + box score, shown at the top of the detail page.
// Finds this game in the scores feed by detailId (== backend gameId), then fetches
// the box score by the matched game's ESPN id. Refreshes every 30s while live.
// Renders nothing if the game isn't in the scores feed (page unchanged).
function LiveScoreHeader({ gameId, awayAbbr, homeAbbr, league = "mlb" }) {
  const [match, setMatch] = useState(null);   // game object from scores feed
  const [box, setBox] = useState(null);       // box score detail
  const [boxLoading, setBoxLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const pull = async () => {
      try {
        const data = await scoresApi.getScores(league);
        const all = [...(data.live || []), ...(data.final || [])];
        const m = all.find((g) => String(g.detailId) === String(gameId));
        if (!cancelled) setMatch(m || null);
      } catch (_) {
        if (!cancelled) setMatch(null);
      }
    };
    pull();
    timer = setInterval(pull, 30000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [gameId, league]);

  // Once we know the matched game's ESPN id, fetch its box score (and refresh while live).
  useEffect(() => {
    if (!match) { setBox(null); return; }
    let cancelled = false;
    let timer = null;
    const pullBox = async () => {
      try {
        if (!box) setBoxLoading(true);
        const d = await scoresApi.getGameDetail(league, match.id);
        if (!cancelled) setBox(d);
      } catch (_) {
        /* keep scoreboard even if box fails */
      }
      if (!cancelled) setBoxLoading(false);
    };
    pullBox();
    if (match.bucket === "live") timer = setInterval(pullBox, 30000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [match, league]);

  if (!match) return null; // not in scores feed → show nothing (page unchanged)

  const isLiveNow = match.bucket === "live";
  const a = match.away || {};
  const h = match.home || {};
  const accent = isLiveNow ? "#ef4444" : "#22c55e";

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: "16px 20px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {isLiveNow && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />}
        <span style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: "0.06em" }}>{isLiveNow ? "LIVE" : "FINAL"}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>· {match.statusDetail || ""}</span>
        {isLiveNow && <span style={{ marginLeft: "auto", fontSize: 10, color: "#6b7280" }}>updates automatically</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <ScoreRow abbr={a.abbrev || awayAbbr} name={a.name} score={a.score} />
        <div style={{ fontSize: 12, color: "#4b5563", fontWeight: 700 }}>@</div>
        <ScoreRow abbr={h.abbrev || homeAbbr} name={h.name} score={h.score} alignRight />
      </div>

      {/* Box score (innings/quarters line + player stats) — same component as the games list */}
      <div style={{ marginTop: 16, borderTop: "1px solid #1f2937", paddingTop: 14 }}>
        {box ? <BoxScore detail={box} /> : boxLoading ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>Loading box score…</div>
        ) : (
          <div style={{ fontSize: 12, color: "#6b7280" }}>Box score not available yet.</div>
        )}
      </div>
    </div>
  );
}

function ScoreRow({ abbr, name, score, alignRight }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, justifyContent: alignRight ? "flex-end" : "flex-start" }}>
      {!alignRight && <span style={{ fontSize: 30, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "center" }}>{score != null ? score : "—"}</span>}
      <div style={{ textAlign: alignRight ? "right" : "left" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e4e7eb" }}>{abbr}</div>
        {name && <div style={{ fontSize: 11, color: "#6b7280" }}>{name}</div>}
      </div>
      {alignRight && <span style={{ fontSize: 30, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "center" }}>{score != null ? score : "—"}</span>}
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
            Odds shown are <strong>live in-game odds</strong>, which move quickly. Our model is calibrated for pre-game lines.
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
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e4e7eb" }}>
            {game.awayAbbr} {game.awayScore} — {game.homeScore} {game.homeAbbr}
          </div>
        )}
      </div>
    </div>
  );
}

function BatterVsPitcherSection({ gameId, awayAbbr, homeAbbr, hasFullAccess, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const base = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
    fetch(`${base}/api/matchups/mlb/${gameId}`)
      .then(r => { if (!r.ok) throw new Error("bad response"); return r.json(); })
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [gameId]);

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18, position: "relative" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
        ⚔️ Batter vs Pitcher · Career history
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 16 }}>
        Hitters with career at-bats against today's opposing starter
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ width: 26, height: 26, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 12, color: "#6b7280" }}>Loading matchup history...</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ textAlign: "center", padding: 24, fontSize: 12, color: "#6b7280" }}>
          Couldn't load matchup history right now.
        </div>
      )}

      {!loading && !error && data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, position: "relative" }} className="bvp-grid">
          <BvPTable
            teamAbbr={awayAbbr}
            pitcherName={data.homePitcher?.name}
            batters={data.awayBattersVsHomePitcher || []}
          />
          <BvPTable
            teamAbbr={homeAbbr}
            pitcherName={data.awayPitcher?.name}
            batters={data.homeBattersVsAwayPitcher || []}
          />
          {!hasFullAccess && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,20,0.92)", backdropFilter: "blur(6px)", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 12, textAlign: "center" }}>
                See how every hitter has fared vs today's starter
              </div>
              <button onClick={() => navigate("/pricing")} style={ctaBtnStyle}>🔒 Unlock batter vs pitcher — $7/mo</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BvPTable({ teamAbbr, pitcherName, batters }) {
  if (!batters || batters.length === 0) {
    return (
      <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 10 }}>
          {teamAbbr} vs {pitcherName || "TBD"}
        </div>
        <div style={{ fontSize: 11, color: "#4b5563", textAlign: "center", padding: 20 }}>
          No hitters have faced this pitcher before
        </div>
      </div>
    );
  }

  const totals = batters.reduce((a, b) => ({
    pa: a.pa + (b.plateAppearances || 0),
    h: a.h + (b.hits || 0),
    hr: a.hr + (b.homeRuns || 0),
    ab: a.ab + (b.atBats || 0),
  }), { pa: 0, h: 0, hr: 0, ab: 0 });
  const teamAvg = totals.ab > 0 ? totals.h / totals.ab : null;

  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", background: "#0f1419" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700 }}>
          {teamAbbr} vs {pitcherName || "TBD"}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ color: "#6b7280" }}>
            <th style={bvpTh("left")}>Batter</th>
            <th style={bvpTh("right")}>PA</th>
            <th style={bvpTh("right")}>H</th>
            <th style={bvpTh("right")}>AVG</th>
            <th style={bvpTh("right")}>HR</th>
          </tr>
        </thead>
        <tbody>
          {batters.map((b, i) => {
            const notable = b.homeRuns > 0 || (b.atBats >= 10 && b.avg > 0.300);
            const avgColor = b.avg > 0.300 ? "#22c55e" : b.avg < 0.150 ? "#ef4444" : "#e4e7eb";
            return (
              <tr key={i} style={{ borderTop: "1px solid #131820", background: notable ? "#0f1419" : "transparent" }}>
                <td style={{ ...bvpTd("left"), maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {notable && <span style={{ color: "#22c55e", marginRight: 4 }}>⭐</span>}
                  {b.batterName}
                </td>
                <td style={bvpTd("right", "#9ca3af")}>{b.plateAppearances}</td>
                <td style={bvpTd("right", "#e4e7eb")}>{b.hits}</td>
                <td style={bvpTd("right", avgColor)}>{b.avg != null ? b.avg.toFixed(3).replace(/^0/, "") : "—"}</td>
                <td style={bvpTd("right", b.homeRuns > 0 ? "#22c55e" : "#9ca3af")}>{b.homeRuns}</td>
              </tr>
            );
          })}
          {totals.pa > 0 && (
            <tr style={{ borderTop: "2px solid #1f2937", background: "#0a0e14" }}>
              <td style={{ ...bvpTd("left", "#9ca3af"), fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>Total</td>
              <td style={bvpTd("right", "#e4e7eb")}>{totals.pa}</td>
              <td style={bvpTd("right", "#e4e7eb")}>{totals.h}</td>
              <td style={bvpTd("right", "#e4e7eb")}>{teamAvg != null ? teamAvg.toFixed(3).replace(/^0/, "") : "—"}</td>
              <td style={bvpTd("right", totals.hr > 0 ? "#22c55e" : "#9ca3af")}>{totals.hr}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function bvpTh(align) {
  return { padding: "6px 8px", textAlign: align, fontWeight: 500, fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function bvpTd(align, color = "#e4e7eb") {
  return { padding: "6px 8px", textAlign: align, color, fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" };
}

function GameHeader({ game, isLive, isFinal }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        ⚾ MLB · {game.time}
        {isLive && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 3, background: "#ef444415", color: "#ef4444", border: "1px solid #ef444440" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.5s infinite" }} />
            LIVE {game.inning ? `· ${game.inning}` : ""}
          </span>
        )}
        {isFinal && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 3, background: "#22c55e15", color: "#22c55e", border: "1px solid #22c55e40" }}>FINAL</span>}
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
  return (
    <div style={{ background: positive ? "linear-gradient(180deg,#0a1f15 0%,#0f1419 100%)" : "linear-gradient(180deg,#1f0a0a 0%,#0f1419 100%)", border: `1px solid ${positive ? "#22c55e44" : "#ef444444"}`, borderLeft: `4px solid ${positive ? "#22c55e" : "#ef4444"}`, borderRadius: 10, padding: "20px 24px", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: positive ? "#22c55e" : "#ef4444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>🎯 Biggest model edge</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{desc}</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{formatOdds(edge.odds)} {edge.type === "TOTAL" && edge.projected != null && `· proj ${edge.projected}`}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", lineHeight: 1 }}>
            {positive ? "+" : ""}{(edge.edge * 100).toFixed(1)}%
          </div>
          <ConfidenceBadge conf={edge.confidence} />
        </div>
      </div>
    </div>
  );
}

function PitcherMatchup({ awayPitcher, homePitcher, hasFullAccess, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>⚾ Starting pitcher matchup</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <PitcherCard pitcher={awayPitcher} label="AWAY" hasFullAccess={hasFullAccess} navigate={navigate} />
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
      </div>
    );
  }
  const stats = pitcher.stats;
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{pitcher.name}</div>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
          <StatBlock label="ERA" value={stats.era?.toFixed(2)} />
          <StatBlock label="WHIP" value={stats.whip?.toFixed(2)} />
          <StatBlock label="K/9" value={stats.strikeoutsPer9?.toFixed(1)} />
          <StatBlock label="HR/9" value={stats.homeRunsPer9?.toFixed(2)} />
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1a1f28", borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e4e7eb", marginTop: 2 }}>{value ?? "—"}</div>
    </div>
  );
}

function WinProbabilityCard({ awayAbbr, homeAbbr, awayProb, homeProb, awayOdds, homeOdds, awayEdge, homeEdge }) {
  if (awayProb == null && homeProb == null) return null;
  const awayPct = Math.round((awayProb ?? 0) * 100);
  const homePct = Math.round((homeProb ?? 0) * 100);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>💰 Moneyline · model vs market</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MLBox abbr={awayAbbr} prob={awayProb} odds={awayOdds} edge={awayEdge} side="Away" />
        <MLBox abbr={homeAbbr} prob={homeProb} odds={homeOdds} edge={homeEdge} side="Home" />
      </div>
    </div>
  );
}

function MLBox({ abbr, prob, odds, edge, side }) {
  const positive = edge != null && edge > 0;
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${positive ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{side.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{abbr} ML · {formatOdds(odds)}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Model: <span style={{ color: "#22c55e", fontWeight: 600 }}>{prob != null ? Math.round(prob * 100) : "—"}%</span></div>
      {edge != null && (
        <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444" }}>
          {positive ? "+" : ""}{(edge * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function TotalsCard({ totals }) {
  if (totals.line == null && totals.projected == null) return null;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>📊 Total runs</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <BigStat label="Sportsbook" value={totals.line ?? "—"} color="#9ca3af" />
        <BigStat label="Model" value={totals.projected ?? "—"} color="#22c55e" />
        <BigStat label="Diff" value={totals.line != null && totals.projected != null ? `${(totals.projected - totals.line).toFixed(1)}` : "—"} color="#e4e7eb" />
      </div>
    </div>
  );
}

function BigStat({ label, value, color }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

function ContextCard({ game }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>🏟️ Park factors</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FactorCard label="Runs" factor={game.parkRunFactor || 1} />
        <FactorCard label="HRs" factor={game.parkHRFactor || 1} />
      </div>
    </div>
  );
}

function FactorCard({ label, factor }) {
  const delta = (factor - 1) * 100;
  const color = delta > 5 ? "#22c55e" : delta < -5 ? "#ef4444" : "#9ca3af";
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{delta > 0 ? "+" : ""}{delta.toFixed(0)}%</div>
    </div>
  );
}

function HRPropsCard({ hrProps, hasFullAccess, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>💣 Home run props</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {hrProps.slice(0, hasFullAccess ? 10 : 1).map((p, i) => (
          <HRPropCard key={i} prop={p} />
        ))}
        {!hasFullAccess && hrProps.length > 1 && (
          <div style={{ marginTop: 4, padding: 16, background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>{hrProps.length - 1} more HR props</div>
            <button onClick={() => navigate("/pricing")} style={ctaBtnStyle}>🔒 Unlock all</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HRPropCard({ prop }) {
  const positive = prop.edge > 0;
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${prop.confidence === "HIGH" ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{prop.player}</div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{prop.team} · vs {prop.opposingPitcher || "TBD"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444" }}>
            {positive ? "+" : ""}{(prop.edge * 100).toFixed(1)}%
          </div>
          <ConfidenceBadge conf={prop.confidence} />
        </div>
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
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, marginTop: 6, display: "inline-block" }}>{conf || "—"}</span>;
}

function formatOdds(american) {
  if (american == null) return "—";
  return american > 0 ? `+${american}` : `${american}`;
}

const ctaBtnStyle = { background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

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
      <Link to="/games" style={{ fontSize: 12, color: "#ef4444", textDecoration: "none", fontWeight: 700 }}>← Back to MLB Games</Link>
    </div>
  );
}

function NotFound({ gameId }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Game not found</div>
      <Link to="/games" style={{ fontSize: 12, color: "#ef4444", textDecoration: "none", fontWeight: 700 }}>← Back to MLB Games</Link>
    </div>
  );
}
