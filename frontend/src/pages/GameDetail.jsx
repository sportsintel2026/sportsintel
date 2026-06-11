import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, scoresApi, liveApi } from "../lib/api";
import { BoxScore } from "./LiveScores";
import Sidebar from "./Sidebar";
// last word of a team name, lowercased — used to match an ESPN game to a model
// game when the backend didn't attach a detailId (same idea the backend uses).
const nick = (s) => String(s || "").trim().split(/\s+/).pop().toLowerCase();
export default function GameDetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [allEdges, setAllEdges] = useState(null);
  const [scoresGame, setScoresGame] = useState(null); // matched game from the scores feed
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;
  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  // Load BOTH feeds: the model edges (for full analysis) and the scores feed
  // (so we can resolve a game even when it has no model detailId yet).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [edges, scores] = await Promise.all([
          edgesApi.getMLB().catch(() => null),
          scoresApi.getScores("mlb").catch(() => null),
        ]);
        if (cancelled) return;
        setAllEdges(edges);
        const all = scores ? [...(scores.live || []), ...(scores.upcoming || []), ...(scores.final || [])] : [];
        const sg = all.find(
          (g) => String(g.detailId) === String(gameId) || String(g.id) === String(gameId)
        ) || null;
        setScoresGame(sg);
        setLoading(false);
      } catch (e) {
        console.error(e);
        if (!cancelled) { setError("Could not load game data"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [gameId]);
  // Resolve the MODEL game: first by id, then (if we arrived via an ESPN id)
  // by matching the scores game's team nicknames against the edges feed.
  let game = allEdges?.games?.find((g) => String(g.id) === String(gameId));
  if (!game && scoresGame && allEdges?.games) {
    const key = `${nick(scoresGame.away?.name)}|${nick(scoresGame.home?.name)}`;
    game = allEdges.games.find((g) => `${nick(g.away)}|${nick(g.home)}` === key);
  }
  const gameHRProps = (allEdges?.hrPropEdges || []).filter(
    p => p.game === `${game?.awayAbbr} @ ${game?.homeAbbr}`
  );
  // ESPN id for scores-based widgets (box score, team form series lookup).
  const scoresId = scoresGame?.id || null;
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
          .bvp-grid{grid-template-columns:1fr!important}
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
          <Link to="/games" className="back-btn" style={{ color: "#6b7280", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            ← Back to MLB Games
          </Link>
          {loading && <Loader />}
          {error && <ErrorState />}
          {/* Neither feed knows this game → not found. */}
          {!loading && !error && !game && !scoresGame && <NotFound gameId={gameId} />}
          {/* Model has the game → full analysis (works for upcoming, live, or final). */}
          {!loading && !error && game && (
            <GameDetail game={game} scoresId={scoresId} hrProps={gameHRProps} hasFullAccess={hasFullAccess} navigate={navigate} />
          )}
          {/* No model game yet, but it's in the scores feed → clean pre-game page. */}
          {!loading && !error && !game && scoresGame && (
            <PreGameDetail scoresGame={scoresGame} />
          )}
        </div>
      </div>
    </div>
  );
}
// Pre-game page shown when the model hasn't posted this game yet, but it's on
// the schedule. Matchup header + scheduled time/venue + team form, plus a note
// that the full model breakdown posts closer to first pitch.
function PreGameDetail({ scoresGame }) {
  const a = scoresGame.away || {};
  const h = scoresGame.home || {};
  let when = "";
  try {
    when = scoresGame.startTime
      ? new Date(scoresGame.startTime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : (scoresGame.statusDetail || "");
  } catch (_) { when = scoresGame.statusDetail || ""; }
  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8 }}>
          ⚾ MLB · {when}
        </div>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          <span style={{ color: "#e4e7eb" }}>{a.name || a.abbrev}</span>
          <span style={{ color: "#4b5563", margin: "0 12px", fontWeight: 400 }}>@</span>
          <span style={{ color: "#e4e7eb" }}>{h.name || h.abbrev}</span>
        </h1>
        {scoresGame.venue && <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>📍 {scoresGame.venue}</div>}
        {scoresGame.seriesSummary && <div style={{ marginTop: 4, fontSize: 12, color: "#9ca3af" }}>{scoresGame.seriesSummary}</div>}
      </div>

      {/* ── MATCHUP ── (sparse here — full matchup cards arrive once the model posts) */}
      <GroupLabel>Matchup</GroupLabel>
      <TeamForm gameId={scoresGame.id} awayAbbr={a.abbrev} homeAbbr={h.abbrev} awayName={a.name} homeName={h.name} league="mlb" />

      {/* ── DETAILS ── */}
      <GroupLabel>Details</GroupLabel>
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderLeft: "3px solid #ef4444", borderRadius: 10, padding: "16px 20px", marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e4e7eb", marginBottom: 4 }}>🔍 Full model breakdown posts closer to first pitch</div>
        <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5 }}>
          Model edges, projected total, starting-pitcher matchup, and batter-vs-pitcher history appear here once today's slate is finalized — usually a few hours before the game.
        </div>
      </div>
    </div>
  );
}
function GameDetail({ game, scoresId, hrProps, hasFullAccess, navigate }) {
  const ml = game.moneyline || {};
  const totals = game.totals || {};
  const rl = game.runLine || {};
  const awayP = game.pitchers?.away;
  const homeP = game.pitchers?.home;
  const isLive = game.status === "live";
  const isFinal = game.status === "final";
  // Scores-feed widgets resolve their game by detailId OR id; prefer the ESPN id
  // when we have it (covers games whose backend detailId is missing).
  const scoresLookupId = scoresId || game.id;
  const candidates = [
    { type: "ML", side: "away", team: game.awayAbbr, prob: ml.awayWinProb, odds: ml.awayOdds, book: ml.awayBook, edge: ml.awayEdge, confidence: ml.awayConfidence },
    { type: "ML", side: "home", team: game.homeAbbr, prob: ml.homeWinProb, odds: ml.homeOdds, book: ml.homeBook, edge: ml.homeEdge, confidence: ml.homeConfidence },
    { type: "TOTAL", side: "over", line: totals.line, prob: totals.overProb, odds: totals.overOdds, book: totals.overBook, edge: totals.overEdge, confidence: totals.overConfidence, projected: totals.projected },
    { type: "TOTAL", side: "under", line: totals.line, prob: totals.underProb, odds: totals.underOdds, book: totals.underBook, edge: totals.underEdge, confidence: totals.underConfidence, projected: totals.projected },
    { type: "RL", side: "away", team: game.awayAbbr, line: rl.awayLine, prob: rl.awayCoverProb, odds: rl.awayOdds, book: rl.awayBook, edge: rl.awayEdge, confidence: rl.awayConfidence },
    { type: "RL", side: "home", team: game.homeAbbr, line: rl.homeLine, prob: rl.homeCoverProb, odds: rl.homeOdds, book: rl.homeBook, edge: rl.homeEdge, confidence: rl.homeConfidence },
  ].filter(c => c.edge != null);
  const bestEdge = candidates.length > 0 ? candidates.reduce((a, b) => (a.edge > b.edge ? a : b)) : null;
  // Pre-game analysis cards (matchup + supporting detail). Shared between the
  // expanded pre-game layout and the collapsed live-game section.
  const matchupCards = (
    <>
      <PitcherMatchup awayPitcher={awayP} homePitcher={homeP} hasFullAccess={hasFullAccess} navigate={navigate} />
      <HeadToHeadSection gameId={game.id} />
      <TeamForm gameId={scoresLookupId} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} awayName={game.away} homeName={game.home} league="mlb" />
      <BatterVsPitcherSection gameId={game.id} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} hasFullAccess={hasFullAccess} navigate={navigate} />
      <LineupBadge lineups={game.lineups} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} />
      <BattingOrderCard lineups={game.lineups} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} />
    </>
  );
  const detailCards = (
    <>
      {game.weather && <WeatherCard weather={game.weather} />}
      <ContextCard game={game} />
      {hrProps.length > 0 && <HRPropsCard hrProps={hrProps} hasFullAccess={hasFullAccess} navigate={navigate} />}
    </>
  );
  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <GameHeader game={game} isLive={isLive} isFinal={isFinal} />
      {/* Scoreboard + box score on top (only renders for live/final games). */}
      <LiveScoreHeader gameId={scoresLookupId} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} league="mlb" />

      {/* Pre-game model breakdown — shown for all states. Live in-game edges now live on the Home page. */}
      <GroupLabel>Matchup</GroupLabel>
      {matchupCards}

      {/* BETTING — pre-game model (win prob / totals / run line). */}
      <GroupLabel>Betting</GroupLabel>
      {bestEdge && <BestEdgeCard edge={bestEdge} game={game} hasFullAccess={hasFullAccess} navigate={navigate} />}
      <WinProbabilityCard awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} awayProb={ml.awayWinProb} homeProb={ml.homeWinProb} awayOdds={ml.awayOdds} homeOdds={ml.homeOdds} awayBook={ml.awayBook} homeBook={ml.homeBook} awayEdge={ml.awayEdge} homeEdge={ml.homeEdge} hasFullAccess={hasFullAccess} navigate={navigate} />
      <TotalsCard totals={totals} hasFullAccess={hasFullAccess} navigate={navigate} />
      <RunLineCard rl={rl} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} />

      <GroupLabel>Details</GroupLabel>
      {detailCards}
    </div>
  );
}
// Faint uppercase group label that introduces a section of the page
// (Matchup / Betting / Details) so the long detail page has clear hierarchy.
function GroupLabel({ children }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#4b5563", fontWeight: 600, textTransform: "uppercase", margin: "20px 4px 8px" }}>
      {children}
    </div>
  );
}
// Tappable collapsible section. Used on LIVE games to tuck the pre-game
// analysis (matchup, form, lineups…) away below the score + live edges.
function CollapsibleSection({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 10, marginTop: 10 }}>
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
// Format an ISO date (YYYY-MM-DD) as M/D/YYYY for display, no leading zeros.
function fmtMeetingDate(d) {
  if (!d) return "";
  const [y, mo, da] = String(d).split("-");
  if (!y || !mo || !da) return d;
  return `${Number(mo)}/${Number(da)}/${y}`;
}
// Season head-to-head: the series record between the two teams + recent
// meetings with scores. Fetched lazily from /api/matchups/mlb/:gameId/h2h.
// Hides itself until loaded, and stays hidden if the teams haven't met yet.
function HeadToHeadSection({ gameId }) {
  const [h2h, setH2h] = useState(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
    fetch(`${base}/api/matchups/mlb/${gameId}/h2h`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setH2h(d && d.headToHead ? d.headToHead : null); setDone(true); } })
      .catch(() => { if (!cancelled) setDone(true); });
    return () => { cancelled = true; };
  }, [gameId]);

  if (!done || !h2h || h2h.played === 0) return null;

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>
        🆚 Season series · {h2h.season}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#e4e7eb", marginBottom: 2 }}>{h2h.summary}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: h2h.recent && h2h.recent.length ? 14 : 0 }}>
        {h2h.played} game{h2h.played === 1 ? "" : "s"} played this season
      </div>
      {h2h.recent && h2h.recent.length > 0 && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Recent meetings</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {h2h.recent.map((m, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", padding: "8px 10px", background: "#0a0e14", borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtMeetingDate(m.date)}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e4e7eb", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{m.away} {m.score} {m.home}</div>
                <div style={{ fontSize: 11, color: "#22c55e", textAlign: "right" }}>{m.winner ? `${m.winner} won` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// Team form: current streak, last 10 games, record + run differential for both
// teams. Pulled from the standings feed and matched by team abbreviation.
function TeamForm({ gameId, awayAbbr, homeAbbr, awayName, homeName, league = "mlb" }) {
  const [standings, setStandings] = useState(null);
  const [failed, setFailed] = useState(false);
  const [series, setSeries] = useState(null);
  const [umpire, setUmpire] = useState(null);
  useEffect(() => {
    let cancelled = false;
    scoresApi.getStandings(league)
      .then((d) => { if (!cancelled) setStandings(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [league]);
  // Resolve this game in the scores feed (to get its ESPN id), then fetch its
  // detail for the current series record ("ATL leads series 1-0").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const scores = await scoresApi.getScores(league);
        const all = [...(scores.live || []), ...(scores.upcoming || []), ...(scores.final || [])];
        const m = all.find((g) => String(g.detailId) === String(gameId) || String(g.id) === String(gameId));
        if (!m) return;
        const detail = await scoresApi.getGameDetail(league, m.id);
        if (!cancelled && detail && detail.series && detail.series.summary) setSeries(detail.series);
        if (!cancelled && detail && detail.umpire) setUmpire(detail.umpire);
      } catch (_) { /* no series → just don't show it */ }
    })();
    return () => { cancelled = true; };
  }, [gameId, league]);
  if (failed) return null;          // quietly hide if standings unavailable
  // MLB/ESPN use different abbreviations for some teams. Try the given abbrev
  // and its known aliases so the standings lookup matches.
  const ALIASES = {
    AZ: ["ARI"], ARI: ["AZ"],
    CHW: ["CWS"], CWS: ["CHW"],
    WSH: ["WAS"], WAS: ["WSH"],
    SD: ["SDP"], SDP: ["SD"],
    SF: ["SFG"], SFG: ["SF"],
    TB: ["TBR"], TBR: ["TB"],
    KC: ["KCR"], KCR: ["KC"],
  };
  const lookup = (abbr) => {
    if (!standings || !abbr) return null;
    const up = String(abbr).toUpperCase();
    if (standings[up]) return standings[up];
    for (const alt of ALIASES[up] || []) {
      if (standings[alt]) return standings[alt];
    }
    return null;
  };
  const a = lookup(awayAbbr);
  const h = lookup(homeAbbr);
  if (standings && !a && !h && !series && !umpire) return null; // nothing to show
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>📈 Team form</div>
      {/* series record now lives in the merged Series card (HeadToHeadSection) above — removed here to de-dupe */}
      {/* home plate umpire (name only) */}
      {umpire && (
        <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🧑‍⚖️</span>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Home plate umpire:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e4e7eb" }}>{umpire}</span>
        </div>
      )}
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormCard abbr={awayAbbr} name={awayName} side="AWAY" form={a} loading={!standings} />
        <FormCard abbr={homeAbbr} name={homeName} side="HOME" form={h} loading={!standings} />
      </div>
    </div>
  );
}
function FormCard({ abbr, name, side, form, loading }) {
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
          <FormStat label="Record" value={form.record || "—"} color="#e4e7eb" />
          <FormStat label="Streak" value={form.streak || "—"} color={streakColor(form.streak)} />
          <FormStat label="Last 10" value={form.lastTen || "—"} color="#e4e7eb" />
        </div>
      )}
    </div>
  );
}
function FormStat({ label, value, color }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1a1f28", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}
// Live/final scoreboard + box score, shown at the top of the detail page.
// Finds this game in the scores feed by detailId OR id, then fetches the box
// score by the matched game's ESPN id. Refreshes every 30s while live.
// Renders nothing if the game isn't live/final in the scores feed (page unchanged).
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
        const m = all.find((g) => String(g.detailId) === String(gameId) || String(g.id) === String(gameId));
        if (!cancelled) setMatch(m || null);
      } catch (_) {
        if (!cancelled) setMatch(null);
      }
    };
    pull();
    timer = setInterval(pull, 10000);
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
    if (match.bucket === "live") timer = setInterval(pullBox, 10000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [match, league]);
  if (!match) return null; // not live/final in scores feed → show nothing (page unchanged)
  const isLiveNow = match.bucket === "live";
  const a = match.away || {};
  const h = match.home || {};
  // Logos from the scores feed (the ones already showing on the score card),
  // keyed by every abbrev they might appear under, to pass into the box score.
  const teamLogos = {};
  if (a.logo) { if (a.abbrev) teamLogos[a.abbrev] = a.logo; if (awayAbbr) teamLogos[awayAbbr] = a.logo; }
  if (h.logo) { if (h.abbrev) teamLogos[h.abbrev] = h.logo; if (homeAbbr) teamLogos[homeAbbr] = h.logo; }
  const accent = isLiveNow ? "#ef4444" : "#22c55e";
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: "13px 15px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {isLiveNow && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />}
        <span style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: "0.06em" }}>{isLiveNow ? "LIVE" : "FINAL"}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>· {match.statusDetail || ""}</span>
        {isLiveNow && <span style={{ marginLeft: "auto", fontSize: 10, color: "#6b7280" }}>updates automatically</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <ScoreRow abbr={a.abbrev || awayAbbr} name={a.name} score={a.score} logo={a.logo} />
        <div style={{ fontSize: 12, color: "#4b5563", fontWeight: 700 }}>@</div>
        <ScoreRow abbr={h.abbrev || homeAbbr} name={h.name} score={h.score} logo={h.logo} alignRight />
      </div>
      {/* Box score (innings/quarters line + player stats) — same component as the games list */}
      <div style={{ marginTop: 12, borderTop: "1px solid #1f2937", paddingTop: 12 }}>
        {box ? <BoxScore detail={box} logos={teamLogos} /> : boxLoading ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>Loading box score…</div>
        ) : (
          <div style={{ fontSize: 12, color: "#6b7280" }}>Box score not available yet.</div>
        )}
      </div>
    </div>
  );
}
function ScoreRow({ abbr, name, score, logo, alignRight }) {
  const scoreEl = <span style={{ fontSize: 30, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "center" }}>{score != null ? score : "—"}</span>;
  const logoEl = logo ? <img src={logo} alt="" width="34" height="34" style={{ objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null;
  const teamEl = (
    <div style={{ textAlign: alignRight ? "right" : "left" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e4e7eb" }}>{abbr}</div>
      {name && <div style={{ fontSize: 11, color: "#6b7280" }}>{name}</div>}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, justifyContent: alignRight ? "flex-end" : "flex-start" }}>
      {!alignRight && scoreEl}
      {!alignRight && logoEl}
      {teamEl}
      {alignRight && logoEl}
      {alignRight && scoreEl}
    </div>
  );
}
function LiveWarningBanner() {
  return (
    <div style={{ background: "#1a1410", border: "1px solid #f5970033", borderLeft: "3px solid #f59700", borderRadius: 6, padding: "12px 16px", marginBottom: 10 }}>
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
    <div style={{ background: "#0a1f15", border: "1px solid #22c55e30", borderLeft: "3px solid #22c55e", borderRadius: 6, padding: "12px 16px", marginBottom: 10 }}>
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
                <td style={{ ...bvpTd("left"), maxWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {notable && <span style={{ color: "#22c55e", marginRight: 4 }}>⭐</span>}
                    {b.batterName}
                    {b.season && (b.season.avg != null || b.season.homeRuns != null) && (
                      <span style={{ fontSize: 9.5, color: "#6b7280", fontWeight: 500, marginLeft: 6 }}>
                        {b.season.avg != null ? b.season.avg.toFixed(3).replace(/^0/, "") : "—"}·{b.season.homeRuns ?? 0}HR·{b.season.ops != null ? b.season.ops.toFixed(3).replace(/^0/, "") : "—"}
                      </span>
                    )}
                  </div>
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
  return { padding: "5px 8px", textAlign: align, fontWeight: 500, fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function bvpTd(align, color = "#e4e7eb") {
  return { padding: "5px 8px", textAlign: align, color, fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" };
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
    <div style={{ background: "#0f1419", border: `1px solid ${borderColor}`, borderRadius: 10, padding: 20, marginBottom: 10 }}>
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
  const desc = edge.type === "ML" ? `${edge.team} Moneyline`
    : edge.type === "RL" ? `${edge.team} ${edge.line > 0 ? "+" : ""}${edge.line}`
    : `${edge.side === "over" ? "Over" : "Under"} ${edge.line}`;
  return (
    <div style={{ background: positive ? "linear-gradient(180deg,#0a1f15 0%,#0f1419 100%)" : "linear-gradient(180deg,#1f0a0a 0%,#0f1419 100%)", border: `1px solid ${positive ? "#22c55e44" : "#ef444444"}`, borderLeft: `4px solid ${positive ? "#22c55e" : "#ef4444"}`, borderRadius: 10, padding: "20px 24px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: positive ? "#22c55e" : "#ef4444", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>🎯 Biggest model edge</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{desc}</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{formatOdds(edge.odds)}{edge.book ? ` · best at ${edge.book}` : ""} {edge.type === "TOTAL" && edge.projected != null && `· proj ${edge.projected}`}</div>
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
// Small honesty badge: shows whether the model's offense input is based on a
// CONFIRMED lineup (today's posted card), a PROJECTED lineup (last game's, used
// as a proxy before today's posts), or season team stats (no lineup resolved).
// Live in-game edges (moneyline + over/under + run line) for a game in progress.
// Fetches the live win-expectancy model and pulls out THIS game. Refreshes 60s.
function LiveEdgeCards({ gameId, awayAbbr, homeAbbr }) {
  const [g, setG] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false, timer = null;
    const pull = async () => {
      try {
        const d = await liveApi.getMLB();
        const match = (d.games || []).find(x => String(x.gameId) === String(gameId));
        if (!cancelled) { setG(match || null); setLoaded(true); }
      } catch (_) { if (!cancelled) setLoaded(true); }
      if (!cancelled) timer = setTimeout(pull, 60000);
    };
    pull();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameId]);
  if (!loaded) return null;
  if (!g) return null; // not in the live feed yet — show nothing rather than stale data
  const row = (label, prob, odds, edge) => {
    const edgePos = edge != null && edge > 0;
    return (
      <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          {label}{odds != null ? <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}> · {odds > 0 ? `+${odds}` : odds}</span> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Our prob</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#22c55e" }}>{prob != null ? `${Math.round(prob * 100)}%` : "—"}</span>
        </div>
        {edge != null && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>Edge</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: edgePos ? "#22c55e" : "#ef4444" }}>{edgePos ? "+" : ""}{(edge * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    );
  };
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>🔴 Live edges · {g.half === "bottom" ? "Bot" : "Top"} {g.inning}, {g.outs} out</div>
      <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>💰 Moneyline</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {row(awayAbbr, g.awayWinProb, g.awayOdds, g.awayEdge)}
        {row(homeAbbr, g.homeWinProb, g.homeOdds, g.homeEdge)}
      </div>
      {g.totalLine != null && (
        <>
          <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>📊 Total {g.totalLine} · proj {g.projectedTotal}</div>
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            {row(`Over ${g.totalLine}`, g.overProb, g.overOdds, g.overEdge)}
            {row(`Under ${g.totalLine}`, g.underProb, g.underOdds, g.underEdge)}
          </div>
        </>
      )}
      {(g.homeRunLineProb != null || g.awayRunLineProb != null) && (
        <>
          <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>📐 Run line ±1.5</div>
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {row(`${awayAbbr} ${fmtLine(g.rlLine != null ? -g.rlLine : 1.5)}`, g.awayRLCoverProb ?? g.awayRunLineProb, g.awayRLOdds, g.awayRLEdge)}
            {row(`${homeAbbr} ${fmtLine(g.rlLine ?? -1.5)}`, g.homeRLCoverProb ?? g.homeRunLineProb, g.homeRLOdds, g.homeRLEdge)}
          </div>
        </>
      )}
    </div>
  );
}
function LineupBadge({ lineups, awayAbbr, homeAbbr }) {
  if (!lineups) return null;
  const tag = (side, abbr) => {
    const src = side?.source || "none";
    if (src === "confirmed") return { text: `${abbr}: ✓ Confirmed lineup`, color: "#22c55e", bg: "#0a1f15", border: "#22c55e44" };
    if (src === "recent") return { text: `${abbr}: Projected lineup`, color: "#9ca3af", bg: "#0a0e14", border: "#1f2937" };
    return { text: `${abbr}: Season averages`, color: "#6b7280", bg: "#0a0e14", border: "#1f2937" };
  };
  const a = tag(lineups.away, awayAbbr);
  const h = tag(lineups.home, homeAbbr);
  const anyConfirmed = lineups.away?.source === "confirmed" || lineups.home?.source === "confirmed";
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 16, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>📋 Lineup status</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[a, h].map((t, i) => (
          <div key={i} style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, color: t.color }}>
            {t.text}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
        {anyConfirmed
          ? "Model offense reflects today's posted lineup. Confirmed lineups usually post a few hours before first pitch."
          : "Today's lineup isn't posted yet — model uses the most recent lineup (or season averages) until the official card drops, then it sharpens automatically."}
      </div>
    </div>
  );
}
// Shows each team's batting order 1-9 (name + position). Order numbers are green
// when today's card is confirmed, gray when it's the last-game projection.
function BattingOrderCard({ lineups, awayAbbr, homeAbbr }) {
  if (!lineups) return null;
  const aOrder = lineups.away?.order || [];
  const hOrder = lineups.home?.order || [];
  if (aOrder.length === 0 && hOrder.length === 0) return null;
  const chip = (src) => {
    if (src === "confirmed") return { label: "CONFIRMED", color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "#22c55e44" };
    if (src === "recent") return { label: "PROJECTED · LAST GAME", color: "#9ca3af", bg: "#0a0e14", border: "#1f2937" };
    return { label: "SEASON AVG", color: "#6b7280", bg: "#0a0e14", border: "#1f2937" };
  };
  const col = (abbr, order, src) => {
    const c = chip(src);
    const accent = src === "confirmed" ? "#22c55e" : "#9ca3af";
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #1f2937" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{abbr}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: c.color, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, padding: "1px 5px" }}>{c.label}</span>
        </div>
        {order.length === 0
          ? <div style={{ fontSize: 12, color: "#6b7280", padding: "6px 0" }}>Not posted yet</div>
          : order.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 0", borderBottom: i < order.length - 1 ? "1px solid #14181f" : "none" }}>
              <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", background: `${accent}1f`, color: accent, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                <span style={{ fontSize: 12.5, color: "#e4e7eb", fontWeight: 600 }}>{p.name}</span>
                {p.season && (p.season.avg != null || p.season.homeRuns != null) && (
                  <span style={{ fontSize: 9.5, color: "#6b7280", fontWeight: 500, marginLeft: 6 }}>
                    {p.season.avg != null ? p.season.avg.toFixed(3).replace(/^0/, "") : "—"}·{p.season.homeRuns ?? 0}HR·{p.season.ops != null ? p.season.ops.toFixed(3).replace(/^0/, "") : "—"}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700 }}>{p.pos}</span>
            </div>
          ))}
      </div>
    );
  };
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 16, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>Batting order</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {col(awayAbbr, aOrder, lineups.away?.source)}
        {col(homeAbbr, hOrder, lineups.home?.source)}
      </div>
    </div>
  );
}
// Per-stat comparison metadata. lowerBetter=true → smaller value wins (ERA etc.);
// false → bigger value wins (K/9, IP). Only the four RATE stats count toward the
// verdict — raw H/BB/IP scale with innings, so a workhorse would unfairly "lose"
// H/BB just for pitching more. We still color all seven for at-a-glance reading.
const PITCHER_STAT_DEFS = [
  { key: "era",  lowerBetter: true,  get: (s) => s?.era },
  { key: "whip", lowerBetter: true,  get: (s) => s?.whip },
  { key: "k9",   lowerBetter: false, get: (s) => s?.strikeoutsPer9 },
  { key: "hr9",  lowerBetter: true,  get: (s) => s?.homeRunsPer9 },
  { key: "ip",   lowerBetter: false, get: (s) => s?.inningsPitched },
  { key: "h",    lowerBetter: true,  get: (s) => s?.hits },
  { key: "bb",   lowerBetter: true,  get: (s) => s?.walks },
];
const VERDICT_KEYS = ["era", "whip", "k9", "hr9"];
// Returns per-stat status maps for each side ("win"|"lose"|"tie"|null) plus the
// rate-stat win counts used for the verdict line. null status = can't compare
// (a side is missing that stat) → left neutral.
function comparePitchers(awayStats, homeStats) {
  const away = {}, home = {};
  let awayWins = 0, homeWins = 0;
  for (const def of PITCHER_STAT_DEFS) {
    const av = def.get(awayStats);
    const hv = def.get(homeStats);
    if (av == null || hv == null) { away[def.key] = null; home[def.key] = null; continue; }
    if (av === hv) { away[def.key] = "tie"; home[def.key] = "tie"; continue; }
    const awayBetter = def.lowerBetter ? av < hv : av > hv;
    away[def.key] = awayBetter ? "win" : "lose";
    home[def.key] = awayBetter ? "lose" : "win";
    if (VERDICT_KEYS.includes(def.key)) { if (awayBetter) awayWins++; else homeWins++; }
  }
  return { away, home, awayWins, homeWins };
}
function PitcherMatchup({ awayPitcher, homePitcher, hasFullAccess, navigate }) {
  // Compare only when both starters have season stats; otherwise no coloring/verdict.
  const cmp = (awayPitcher?.stats && homePitcher?.stats)
    ? comparePitchers(awayPitcher.stats, homePitcher.stats)
    : null;
  const total = cmp ? cmp.awayWins + cmp.homeWins : 0;
  let verdict = null;
  if (cmp && total > 0) {
    if (cmp.awayWins > cmp.homeWins) verdict = { text: `${awayPitcher.name} has the edge by the numbers`, detail: `${cmp.awayWins} of ${total} key categories`, color: "#22c55e" };
    else if (cmp.homeWins > cmp.awayWins) verdict = { text: `${homePitcher.name} has the edge by the numbers`, detail: `${cmp.homeWins} of ${total} key categories`, color: "#22c55e" };
    else verdict = { text: "Even matchup by the numbers", detail: `${cmp.awayWins} key categories each`, color: "#9ca3af" };
  }
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>⚾ Starting pitcher matchup</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <PitcherCard pitcher={awayPitcher} label="AWAY" compare={cmp?.away} hasFullAccess={hasFullAccess} navigate={navigate} />
        <PitcherCard pitcher={homePitcher} label="HOME" compare={cmp?.home} hasFullAccess={hasFullAccess} navigate={navigate} />
      </div>
      {verdict && (
        <div style={{ marginTop: 14, background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: verdict.color }}>🎯 {verdict.text}</span>
          <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>· {verdict.detail}</span>
        </div>
      )}
      {verdict && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#4b5563", textAlign: "center", lineHeight: 1.5 }}>
          Green = better, red = worse. Verdict is based on season ERA, WHIP, K/9 and HR/9 — a stat comparison, not the full model projection.
        </div>
      )}
    </div>
  );
}
function PitcherCard({ pitcher, label, compare, hasFullAccess, navigate }) {
  const [imgOk, setImgOk] = useState(true);
  if (!pitcher) {
    return (
      <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16, textAlign: "center" }}>
        <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>{label}</div>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#0f1419", border: "1px solid #1f2937", margin: "6px auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚾</div>
        <div style={{ fontSize: 14, color: "#4b5563" }}>TBD</div>
      </div>
    );
  }
  const stats = pitcher.stats;
  const photo = pitcher.id ? `https://midfield.mlbstatic.com/v1/people/${pitcher.id}/spots/120` : null;
  const record = stats && (stats.wins != null || stats.losses != null)
    ? `${stats.wins ?? 0}-${stats.losses ?? 0}` : null;
  return (
    <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 600 }}>{label}</div>
      {/* headshot on top (ESPN game-card style) — compact */}
      <div style={{ width: 40, height: 40, margin: "0 auto 6px", borderRadius: "50%", overflow: "hidden", background: "#0f1419", border: "2px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {photo && imgOk ? (
          <img
            src={photo}
            alt={pitcher.name}
            width={40}
            height={40}
            style={{ objectFit: "cover", objectPosition: "top center" }}
            onError={() => setImgOk(false)}
          />
        ) : (
          <span style={{ fontSize: 16 }}>⚾</span>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{pitcher.name}</div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12, marginTop: 2 }}>
        {pitcher.hand ? `${pitcher.hand}HP` : ""}{pitcher.hand && record ? " · " : ""}{record ? `${record}` : ""}
      </div>
      {stats && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, textAlign: "left" }}>
            <StatBlock label="ERA" value={stats.era?.toFixed(2)} status={compare?.era} />
            <StatBlock label="WHIP" value={stats.whip?.toFixed(2)} status={compare?.whip} />
            <StatBlock label="K/9" value={stats.strikeoutsPer9?.toFixed(1)} status={compare?.k9} />
            <StatBlock label="HR/9" value={stats.homeRunsPer9?.toFixed(2)} status={compare?.hr9} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12, textAlign: "left", marginTop: 8 }}>
            <StatBlock label="IP" value={stats.inningsPitched != null ? stats.inningsPitched : "—"} status={compare?.ip} />
            <StatBlock label="H" value={stats.hits != null ? stats.hits : "—"} status={compare?.h} />
            <StatBlock label="BB" value={stats.walks != null ? stats.walks : "—"} status={compare?.bb} />
            <StatBlock label="SO" value={stats.strikeouts != null ? stats.strikeouts : "—"} />
            <StatBlock label="HR" value={stats.homeRuns != null ? stats.homeRuns : "—"} />
          </div>
        </>
      )}
    </div>
  );
}
function StatBlock({ label, value, status }) {
  const valueColor = status === "win" ? "#22c55e" : status === "lose" ? "#ef4444" : "#e4e7eb";
  const borderColor = status === "win" ? "#22c55e44" : status === "lose" ? "#ef444444" : "#1a1f28";
  return (
    <div style={{ background: "#0f1419", border: `1px solid ${borderColor}`, borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: valueColor, marginTop: 2 }}>{value ?? "—"}</div>
    </div>
  );
}
function WinProbabilityCard({ awayAbbr, homeAbbr, awayProb, homeProb, awayOdds, homeOdds, awayBook, homeBook, awayEdge, homeEdge }) {
  if (awayProb == null && homeProb == null) return null;
  const awayPct = Math.round((awayProb ?? 0) * 100);
  const homePct = Math.round((homeProb ?? 0) * 100);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>💰 Moneyline · model vs market</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <MLBox abbr={awayAbbr} prob={awayProb} odds={awayOdds} book={awayBook} edge={awayEdge} side="Away" />
        <MLBox abbr={homeAbbr} prob={homeProb} odds={homeOdds} book={homeBook} edge={homeEdge} side="Home" />
      </div>
    </div>
  );
}
function MLBox({ abbr, prob, odds, book, edge, side }) {
  const positive = edge != null && edge > 0;
  // Market % is derived from the model prob and the edge the backend already
  // computed (edge = model − market), so model / market / edge always stay
  // internally consistent: model − market reads back to the edge shown.
  const marketPct = (prob != null && edge != null) ? Math.round((prob - edge) * 100) : null;
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${positive ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>{side.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{abbr} ML · {formatOdds(odds)}</div>
      {book && <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 600, marginBottom: 6 }}>best at {book}</div>}
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Model: <span style={{ color: "#22c55e", fontWeight: 600 }}>{prob != null ? Math.round(prob * 100) : "—"}%</span></div>
      {marketPct != null && (
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Market: <span style={{ color: "#9ca3af", fontWeight: 600 }}>{marketPct}%</span></div>
      )}
      {edge != null && (
        <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color: positive ? "#22c55e" : "#ef4444" }}>
          {positive ? "+" : ""}{(edge * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
function RunLineCard({ rl, awayAbbr, homeAbbr }) {
  if (!rl || rl.awayEdge == null || rl.homeEdge == null) return null;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>📐 Run line · ±1.5</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <RLBox abbr={awayAbbr} line={rl.awayLine} odds={rl.awayOdds} book={rl.awayBook} prob={rl.awayCoverProb} edge={rl.awayEdge} />
        <RLBox abbr={homeAbbr} line={rl.homeLine} odds={rl.homeOdds} book={rl.homeBook} prob={rl.homeCoverProb} edge={rl.homeEdge} />
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>Derived from the moneyline projection — the same lean expressed at a spread price, with more variance.</div>
    </div>
  );
}
function RLBox({ abbr, line, odds, book, prob, edge }) {
  const positive = edge != null && edge > 0;
  const fmtLine = line != null ? (line > 0 ? `+${line}` : `${line}`) : "";
  return (
    <div style={{ background: "#0a0e14", border: `1px solid ${positive ? "#22c55e30" : "#1f2937"}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{abbr} {fmtLine} · {formatOdds(odds)}</div>
      {book && <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 600, marginBottom: 6 }}>best at {book}</div>}
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Cover: <span style={{ color: "#22c55e", fontWeight: 600 }}>{prob != null ? Math.round(prob * 100) : "—"}%</span></div>
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
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
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
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>🏟️ Park factors</div>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 10 }}>
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
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{prop.team} · facing {prop.opposingPitcher || "TBD"}</div>
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
function fmtLine(n) {
  if (n == null) return "";
  return n > 0 ? `+${n}` : `${n}`;
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
