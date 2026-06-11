// NBADetail.jsx — NBA single-game matchup page (model v0.1)
//
// Mirrors the MLB GameDetail layout/styling. Pulls two backend endpoints:
//   /api/nba/predictions      -> finds this game's model projection + edges
//   /api/nba/matchup/:gameId  -> team stats, player leaders, injuries, series
//
// Reached from the NBA list (rows link to /game/nba/:gameId).

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi, scoresApi } from "../lib/api";
import { BoxScore } from "./LiveScores";
import Sidebar from "./Sidebar";

const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";

export default function NBADetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [prediction, setPrediction] = useState(null);
  const [matchup, setMatchup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    Promise.all([
      fetch(`${API_BASE}/api/nba/predictions`).then(r => r.ok ? r.json() : { predictions: [] }).catch(() => ({ predictions: [] })),
      fetch(`${API_BASE}/api/nba/matchup/${gameId}`).then(r => { if (!r.ok) throw new Error("matchup"); return r.json(); }),
    ])
      .then(([preds, m]) => {
        if (cancelled) return;
        const p = (preds.predictions || []).find(x => String(x.gameId) === String(gameId)) || null;
        setPrediction(p);
        setMatchup(m);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [gameId]);

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
          .main-content{margin-left:0!important;max-width:100vw!important;overflow-x:hidden!important}
          .mobile-only{display:flex!important}
          .gd-content{padding:16px 14px 60px!important;max-width:100vw!important}
          h1{font-size:24px!important}
          .two-col{grid-template-columns:1fr!important}
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
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#ef4444" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="gd-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 80px" }}>
          <Link to="/nba" className="back-btn" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
            ← Back to NBA Playoffs
          </Link>

          {loading && <Loader />}
          {!loading && error && <ErrorState />}
          {!loading && !error && matchup && <Detail matchup={matchup} prediction={prediction} gameId={gameId} />}
        </div>
      </div>
    </div>
  );
}

function Detail({ matchup, prediction, gameId }) {
  const m = matchup;
  const best = bestEdge(prediction);
  const [isLive, setIsLive] = useState(false);

  const analysisCards = (
    <>
      <TeamComparison m={m} />
      <NbaSeriesCard series={m.series} h2h={m.headToHead} />
      <NbaTeamForm awayAbbr={m.away?.abbr} homeAbbr={m.home?.abbr} awayName={m.away?.displayName} homeName={m.home?.displayName} />
      <LeadersCard m={m} />
      <InjuriesCard m={m} />
    </>
  );
  const bettingCards = (
    <>
      {best && <BestEdgeCard best={best} />}
      <WinProbCard m={m} prediction={prediction} />
      {prediction?.predictions?.total && <TotalsCard prediction={prediction} />}
    </>
  );
  const modelNote = (
    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
      Model v0.1 · ratings/pace from ESPN season data. Player figures are season averages.
      Injuries shown but not yet weighted into the line (v0.2).
    </div>
  );

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <Header m={m} />
      <NbaLiveHeader gameId={gameId} onLiveState={setIsLive} />

      {isLive ? (
        /* LIVE: only the scoreboard/box updates in-game for NBA — collapse all pre-game model + analysis below it. */
        <>
          <CollapsibleSection title="Pre-game model & analysis" subtitle="edges, matchup, form, leaders">
            <GroupLabel>Betting</GroupLabel>
            {bettingCards}
            <GroupLabel>Matchup</GroupLabel>
            {analysisCards}
          </CollapsibleSection>
          {modelNote}
        </>
      ) : (
        /* Upcoming / final: matchup-first, fully expanded. */
        <>
          <GroupLabel>Matchup</GroupLabel>
          {analysisCards}

          <GroupLabel>Betting</GroupLabel>
          {bettingCards}

          <GroupLabel>Details</GroupLabel>
          {modelNote}
        </>
      )}
    </div>
  );
}

// Live/final scoreboard + box score. For NBA the detail gameId IS the ESPN id,
// so we can fetch the box score directly (no scores-feed matching dance like MLB).
function NbaLiveHeader({ gameId, onLiveState }) {
  const [box, setBox] = useState(null);
  const [scoreLine, setScoreLine] = useState(null); // {state, statusDetail, away, home} from scores feed
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const pull = async () => {
      try {
        // scores feed gives the live scoreboard line (score + status)
        const scores = await scoresApi.getScores("nba");
        const all = [...(scores.live || []), ...(scores.upcoming || []), ...(scores.final || [])];
        const match = all.find(g => String(g.id) === String(gameId) || String(g.detailId) === String(gameId));
        if (!cancelled) setScoreLine(match || null);

        // box score (direct fetch — gameId is the ESPN id for NBA)
        if (match && (match.bucket === "live" || match.bucket === "final")) {
          const detail = await scoresApi.getGameDetail("nba", gameId);
          if (!cancelled) setBox(detail);
          if (match.bucket === "live" && !cancelled) timer = setTimeout(pull, 30000);
        }
      } catch (_) { /* leave empty; page still renders the rest */ }
      finally { if (!cancelled) setLoading(false); }
    };
    pull();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameId]);

  // Report live state up to the parent so it can collapse pre-game content on live games.
  useEffect(() => {
    if (onLiveState) onLiveState(scoreLine?.bucket === "live");
  }, [scoreLine, onLiveState]);

  if (loading) return null;
  if (!scoreLine) return null; // not in scores feed → show nothing (rest of page unchanged)

  const isLive = scoreLine.bucket === "live";
  const isFinal = scoreLine.bucket === "final";
  const showScores = isLive || isFinal;

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 20, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showScores ? 14 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isLive && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 2s infinite" }} />}
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: isLive ? "#ef4444" : "#9ca3af", textTransform: "uppercase" }}>
            {isLive ? "LIVE" : isFinal ? "FINAL" : "UPCOMING"}{scoreLine.statusDetail ? ` · ${scoreLine.statusDetail}` : ""}
          </span>
        </div>
        {isLive && <span style={{ fontSize: 11, color: "#6b7280" }}>updates automatically</span>}
      </div>

      {showScores && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12, marginBottom: box ? 18 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {scoreLine.away?.logo && <img src={scoreLine.away.logo} alt="" style={{ width: 30, height: 30 }} />}
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{scoreLine.away?.abbrev}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{scoreLine.away?.name}</div>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {scoreLine.away?.score ?? 0} <span style={{ color: "#4b5563", fontWeight: 400 }}>–</span> {scoreLine.home?.score ?? 0}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{scoreLine.home?.abbrev}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{scoreLine.home?.name}</div>
            </div>
            {scoreLine.home?.logo && <img src={scoreLine.home.logo} alt="" style={{ width: 30, height: 30 }} />}
          </div>
        </div>
      )}

      {box && <BoxScore detail={box} />}
    </div>
  );
}

// Team form: record / streak / last 10 for both teams, + playoff series line.
// NBA abbreviations match ESPN standings directly (no AZ/ARI-style alias needed).
function NbaTeamForm({ awayAbbr, homeAbbr, awayName, homeName }) {
  const [standings, setStandings] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    scoresApi.getStandings("nba")
      .then(d => { if (!cancelled) setStandings(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;
  const a = standings ? standings[String(awayAbbr).toUpperCase()] : null;
  const h = standings ? standings[String(homeAbbr).toUpperCase()] : null;
  if (standings && !a && !h) return null;

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>📈 Team form</div>

      {/* series record now lives in the merged Series card — removed here to de-dupe */}

      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <NbaFormCard abbr={awayAbbr} name={awayName} side="AWAY" form={a} loading={!standings} />
        <NbaFormCard abbr={homeAbbr} name={homeName} side="HOME" form={h} loading={!standings} />
      </div>
    </div>
  );
}

function NbaFormCard({ abbr, name, side, form, loading }) {
  const streakColor = (s) => {
    if (!s) return "#9ca3af";
    return s.startsWith("W") ? "#22c55e" : s.startsWith("L") ? "#ef4444" : "#9ca3af";
  };
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>{side}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{abbr} <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>{name}</span></div>
      {loading ? (
        <div style={{ fontSize: 12, color: "#6b7280" }}>Loading form…</div>
      ) : !form ? (
        <div style={{ fontSize: 12, color: "#6b7280" }}>No form data</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <NbaFormStat label="Record" value={form.record || "—"} color="#e4e7eb" />
          <NbaFormStat label="Streak" value={form.streak || "—"} color={streakColor(form.streak)} />
          <NbaFormStat label="Last 10" value={form.lastTen || "—"} color="#e4e7eb" />
        </div>
      )}
    </div>
  );
}

function NbaFormStat({ label, value, color }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1a1f28", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function Header({ m }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        🏀 NBA{m.statusDetail ? ` · ${m.statusDetail}` : ""}
        {m.gameNote && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 3, background: "#ef444415", color: "#ef4444", border: "1px solid #ef444440" }}>{m.gameNote}</span>}
      </div>
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
        <span style={{ color: "#e4e7eb" }}>{m.away?.displayName}</span>
        <span style={{ color: "#4b5563", margin: "0 12px", fontWeight: 400 }}>@</span>
        <span style={{ color: "#e4e7eb" }}>{m.home?.displayName}</span>
      </h1>
      {m.venue && <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>📍 {m.venue}</div>}
    </div>
  );
}

function BestEdgeCard({ best }) {
  const positive = best.edge > 0;
  return (
    <div style={{ background: positive ? "linear-gradient(180deg,#0a1f15 0%,#0f1419 100%)" : "linear-gradient(180deg,#1f0a0a 0%,#0f1419 100%)", border: `1px solid ${positive ? "#22c55e44" : "#ef444444"}`, borderLeft: `4px solid ${positive ? "#22c55e" : "#ef4444"}`, borderRadius: 10, padding: "20px 24px", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: positive ? "#22c55e" : "#ef4444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>🎯 Biggest model edge</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{best.label}</div>
          {best.sub && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{best.sub}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444", lineHeight: 1 }}>
            {positive ? "+" : ""}{best.edge.toFixed(1)}{best.unit}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamComparison({ m }) {
  const a = m.away?.seasonStats, h = m.home?.seasonStats;
  if (!a && !h) return null;
  const rows = [
    ["PPG", a?.ppg, h?.ppg, "high"],
    ["Opp PPG", a?.papg, h?.papg, "low"],
    ["FG%", a?.fgPct, h?.fgPct, "high"],
    ["3P%", a?.threePct, h?.threePct, "high"],
    ["Rebounds", a?.reb, h?.reb, "high"],
    ["Assists", a?.ast, h?.ast, "high"],
  ];
  return (
    <div style={card()}>
      <SectionLabel>📊 Team comparison · season averages</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <TeamTag team={m.away} align="left" />
        <div />
        <TeamTag team={m.home} align="right" />
      </div>
      {rows.map(([label, av, hv, better]) => {
        const aBetter = av != null && hv != null && (better === "high" ? av > hv : av < hv);
        const hBetter = av != null && hv != null && (better === "high" ? hv > av : hv < av);
        return (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #131820" }}>
            <div style={{ textAlign: "left", fontSize: 15, fontWeight: 700, color: aBetter ? "#22c55e" : "#e4e7eb" }}>{fmt(av)}</div>
            <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</div>
            <div style={{ textAlign: "right", fontSize: 15, fontWeight: 700, color: hBetter ? "#22c55e" : "#e4e7eb" }}>{fmt(hv)}</div>
          </div>
        );
      })}
      {(m.away?.record || m.home?.record) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #131820" }}>
          <div style={{ textAlign: "left", fontSize: 13, color: "#9ca3af" }}>{m.away?.record || "—"}</div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>Record</div>
          <div style={{ textAlign: "right", fontSize: 13, color: "#9ca3af" }}>{m.home?.record || "—"}</div>
        </div>
      )}
    </div>
  );
}

function TeamTag({ team, align }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
      {align === "left" && team?.logo && <img src={team.logo} alt="" style={{ width: 26, height: 26 }} />}
      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{team?.abbr}</span>
      {align === "right" && team?.logo && <img src={team.logo} alt="" style={{ width: 26, height: 26 }} />}
    </div>
  );
}

function WinProbCard({ m, prediction }) {
  const ml = prediction?.predictions?.moneyline;
  const haveModel = ml?.homeWinProb != null;
  // Book's no-vig implied probability — the market's true read once the
  // sportsbook's margin is stripped out. This is the honest yardstick for an
  // edge (our model vs the price you'd actually bet), not another forecaster.
  const fair = noVigPair(m.odds?.awayML, m.odds?.homeML);
  const haveBook = fair != null;
  if (!haveModel && !haveBook && !m.odds) return null;
  return (
    <div style={card()}>
      <SectionLabel>💰 Win probability · model vs market</SectionLabel>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ProbBox
          side="Away" abbr={m.away?.abbr}
          model={haveModel ? ml.awayWinProb : null}
          book={fair ? fair.away : null}
          ml={m.odds?.awayML}
        />
        <ProbBox
          side="Home" abbr={m.home?.abbr}
          model={haveModel ? ml.homeWinProb : null}
          book={fair ? fair.home : null}
          ml={m.odds?.homeML}
        />
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
        "Book" is the sportsbook's implied probability with its margin removed (no-vig) — the market's true read. An edge is our model disagreeing with that, not with another forecaster.
      </div>
    </div>
  );
}

// No-vig implied win probabilities (%) from the two American moneyline prices.
// Strips the book's margin so model-vs-book is apples to apples.
function noVigPair(awayML, homeML) {
  const imp = (o) => (o == null ? null : o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  const a = imp(awayML), h = imp(homeML);
  if (a == null || h == null) return null;
  const s = a + h;
  if (!(s > 0)) return null;
  return { away: (a / s) * 100, home: (h / s) * 100 };
}

function ProbBox({ side, abbr, model, book, ml }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{side.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{abbr}{ml != null ? ` · ${fmtOdds(ml)}` : ""}</div>
      <Line label="Our model" value={model != null ? `${Math.round(model)}%` : "—"} accent="#22c55e" />
      <Line label="Book (no-vig)" value={book != null ? `${Math.round(book)}%` : "—"} accent="#9ca3af" />
    </div>
  );
}

function Line({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{value}</span>
    </div>
  );
}

function TotalsCard({ prediction }) {
  const t = prediction.predictions.total;
  const line = t.line, proj = t.projectedTotal;
  return (
    <div style={card()}>
      <SectionLabel>📊 Total points</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <BigStat label="Sportsbook" value={line ?? "—"} color="#9ca3af" />
        <BigStat label="Model" value={proj ?? "—"} color="#22c55e" />
        <BigStat label="Diff" value={line != null && proj != null ? (proj - line).toFixed(1) : "—"} color="#e4e7eb" />
      </div>
    </div>
  );
}

function LeadersCard({ m }) {
  const hasAny = (m.away?.leaders?.length || 0) + (m.home?.leaders?.length || 0) > 0;
  if (!hasAny) return null;
  return (
    <div style={card()}>
      <SectionLabel>⭐ Team leaders · season</SectionLabel>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <LeaderColumn team={m.away} />
        <LeaderColumn team={m.home} />
      </div>
    </div>
  );
}

function LeaderColumn({ team }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", background: "#0f1419", display: "flex", alignItems: "center", gap: 8 }}>
        {team?.logo && <img src={team.logo} alt="" style={{ width: 20, height: 20 }} />}
        <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700 }}>{team?.displayName}</span>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {(team?.leaders || []).map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {p.headshot
              ? <img src={p.headshot} alt="" style={{ width: 32, height: 32, borderRadius: "50%", background: "#1f2937", objectFit: "cover" }} />
              : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1f2937" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "#6b7280" }}>{p.position}{p.summary ? ` · ${p.summary}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e", lineHeight: 1 }}>{p.value}</div>
              <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.05em" }}>{p.label || p.category}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InjuriesCard({ m }) {
  const a = m.away?.injuries || [], h = m.home?.injuries || [];
  if (a.length === 0 && h.length === 0) return null;
  return (
    <div style={card()}>
      <SectionLabel>🩹 Injury report</SectionLabel>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <InjuryColumn team={m.away} list={a} />
        <InjuryColumn team={m.home} list={h} />
      </div>
    </div>
  );
}

function InjuryColumn({ team, list }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 10 }}>{team?.abbr}</div>
      {list.length === 0 ? (
        <div style={{ fontSize: 11, color: "#4b5563" }}>No injuries reported</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#e4e7eb" }}>{p.name}</span>
              <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, whiteSpace: "nowrap" }}>{p.status}{p.detail ? ` · ${p.detail}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Merged series card: the playoff/current series status (when present) plus the
// season head-to-head with recent meetings and per-game winners. One card so the
// series info isn't duplicated across the page.
function NbaSeriesCard({ series, h2h }) {
  if (!series?.summary && !h2h) return null;
  return (
    <div style={card()}>
      <SectionLabel>🏆 Series</SectionLabel>
      {series?.summary && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e4e7eb", marginBottom: h2h ? 12 : 0 }}>
          {series.summary}
          {series.title && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>{series.title}</span>}
        </div>
      )}
      {h2h && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#9ca3af", marginBottom: 2 }}>{h2h.summary}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: h2h.recent && h2h.recent.length ? 12 : 0 }}>
            {h2h.played} game{h2h.played === 1 ? "" : "s"} played this season
          </div>
          {h2h.recent && h2h.recent.length > 0 && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Recent meetings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {h2h.recent.map((mtg, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", padding: "8px 10px", background: "#0a0e14", borderRadius: 4 }}>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtMeetingDate(mtg.date)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e4e7eb", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{mtg.away} {mtg.score} {mtg.home}</div>
                    <div style={{ fontSize: 11, color: "#22c55e", textAlign: "right" }}>{mtg.winner ? `${mtg.winner} won` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- helpers / shared bits ----

function bestEdge(prediction) {
  if (!prediction?.predictions) return null;
  const { moneyline: ml, spread: sp, total: to } = prediction.predictions;
  const cands = [];
  if (ml?.value && ml.edge != null) cands.push({ edge: ml.edge, unit: "%", label: `${ml.pickTeam} Moneyline`, sub: ml.book?.home != null ? `book ${fmtOdds(ml.pickTeam === prediction.home ? ml.book.home : ml.book.away)}` : null });
  if (sp?.value && sp.edge != null) {
    // Surface the model's projected margin so the points edge reads at a glance:
    // model has <fav> by X, the line asks Y → the gap is the edge on the pick.
    const m = sp.projectedMargin ?? 0;
    const favNick = String((m >= 0 ? prediction.home : prediction.away) || "").split(" ").pop();
    const byPts = Math.abs(m).toFixed(1).replace(/\.0$/, "");
    const lineMag = sp.line != null ? Math.abs(sp.line) : null;
    cands.push({
      edge: sp.edge,
      unit: " pts",
      label: `${sp.pickTeam} ${fmtSigned(sp.pickLine)}`,
      sub: lineMag != null ? `model: ${favNick} by ${byPts} · line ${lineMag}` : `model: ${favNick} by ${byPts}`,
    });
  }
  if (to?.value && to.edge != null) cands.push({ edge: to.edge, unit: " pts", label: `${(to.pick || "").toUpperCase()} ${to.line}`, sub: `model projects ${to.projectedTotal}` });
  if (cands.length === 0) return null;
  return cands.reduce((a, b) => (Math.abs(a.edge) > Math.abs(b.edge) ? a : b));
}

function card() {
  return { background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 };
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>{children}</div>;
}
// Faint uppercase group label (Matchup / Betting / Details) for page hierarchy.
function GroupLabel({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#4b5563", fontWeight: 600, textTransform: "uppercase", margin: "20px 4px 8px" }}>{children}</div>;
}
// Tappable collapsible section. On LIVE games, tucks the pre-game model + analysis
// away below the live scoreboard (the only part that updates in-game for NBA).
function CollapsibleSection({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 18, marginTop: 10 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: "13px 16px", cursor: "pointer", userSelect: "none" }}
      >
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e4e7eb" }}>📋 {title}</span>
          {subtitle && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 8 }}>{subtitle}</span>}
        </div>
        <span style={{ fontSize: 12, color: "#9ca3af", whiteSpace: "nowrap" }}>{open ? "Hide ▾" : "Show ▸"}</span>
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
// Format an ISO date (YYYY-MM-DD) as M/D/YYYY, no leading zeros.
function fmtMeetingDate(d) {
  if (!d) return "";
  const [y, mo, da] = String(d).split("-");
  if (!y || !mo || !da) return d;
  return `${Number(mo)}/${Number(da)}/${y}`;
}
function BigStat({ label, value, color }) {
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
function fmt(v) { return v == null ? "—" : v; }
function fmtSigned(n) { if (n == null) return ""; return n > 0 ? `+${n}` : `${n}`; }
function fmtOdds(n) { if (n == null) return "—"; return n > 0 ? `+${n}` : `${n}`; }

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 80 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading matchup...</div>
    </div>
  );
}
function ErrorState() {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load this matchup</div>
      <Link to="/nba" style={{ fontSize: 12, color: "#ef4444", textDecoration: "none", fontWeight: 700 }}>← Back to NBA Playoffs</Link>
    </div>
  );
}
