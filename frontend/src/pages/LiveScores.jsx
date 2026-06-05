// LiveScores.jsx — shared live scores view for MLB and NBA.
// Splits games into Live / Upcoming / Final with a blinking LIVE dot, refreshes
// every 30s. Tapping a game opens its full matchup page (scoreboard + box score
// + analysis all in one). Driven by a `league` prop ("mlb" | "nba").

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi, scoresApi } from "../lib/api";
import Sidebar from "./Sidebar";

const LEAGUE_META = {
  mlb: { icon: "⚾", title: "MLB Games", periodLabel: "Inn" },
  nba: { icon: "🏀", title: "NBA Games", periodLabel: "Qtr" },
  nfl: { icon: "🏈", title: "NFL Games", periodLabel: "Qtr" },
  cfb: { icon: "🏟️", title: "College Football", periodLabel: "Qtr" },
  nhl: { icon: "🏒", title: "NHL Games", periodLabel: "Per" },
};

export default function LiveScoresPage({ league = "mlb" }) {
  const meta = LEAGUE_META[league] || LEAGUE_META.mlb;
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const timer = useRef(null);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const load = useCallback(async (showSpinner) => {
    if (showSpinner) setLoading(true);
    setError(false);
    try {
      const d = await scoresApi.getScores(league);
      setData(d);
      setRefreshedAt(new Date());
    } catch (e) {
      console.error("Failed to load scores:", e);
      if (showSpinner) setError(true);
    }
    if (showSpinner) setLoading(false);
  }, [league]);

  // initial load + 30s auto-refresh (silent)
  useEffect(() => {
    load(true);
    timer.current = setInterval(() => load(false), 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  const live = data?.live || [];
  const upcoming = data?.upcoming || [];
  const final = data?.final || [];
  const total = live.length + upcoming.length + final.length;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .game-card{transition:background .15s,border-color .15s;cursor:pointer}
        .game-card:hover{background:#131820;border-color:#2a3340}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
          .scores-content{padding:16px 14px 60px!important}
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
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#ef4444" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="scores-content" style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>{meta.icon} {meta.title}</h1>
            {refreshedAt && (
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                Updated {refreshedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · auto-refreshes
              </span>
            )}
          </div>
          <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
            Live scores · <span style={{ color: "#ef4444", fontWeight: 600 }}>tap a game</span> for the box score & full analysis
          </p>

          {loading && <Loader />}
          {!loading && error && <ErrorState onRetry={() => load(true)} />}
          {!loading && !error && total === 0 && <EmptyState icon={meta.icon} league={league} />}
          {!loading && !error && total > 0 && (
            <>
              {live.length > 0 && (
                <Section title="LIVE NOW" color="#ef4444" count={live.length} defaultOpen liveDot>
                  {live.map((g) => <GameCard key={g.id} g={g} league={league} meta={meta} />)}
                </Section>
              )}
              {upcoming.length > 0 && (
                <Section title="UPCOMING" color="#9ca3af" count={upcoming.length} defaultOpen>
                  {upcoming.map((g) => <GameCard key={g.id} g={g} league={league} meta={meta} />)}
                </Section>
              )}
              {final.length > 0 && (
                <Section title="FINAL" color="#22c55e" count={final.length} defaultOpen={live.length === 0}>
                  {final.map((g) => <GameCard key={g.id} g={g} league={league} meta={meta} />)}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, color, count, defaultOpen, liveDot, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 18 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
        {liveDot && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />}
        <span style={{ fontSize: 12, letterSpacing: 1.2, color, fontWeight: 800 }}>{title}</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>· {count}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>}
    </div>
  );
}

// Tapping a card opens the full matchup page. We navigate by the backend model
// id (detailId) when we have it, otherwise fall back to ESPN's own game id so
// the card is always clickable — the detail page knows how to resolve either.
function GameCard({ g, league, meta }) {
  const navigate = useNavigate();
  const isLive = g.bucket === "live";
  const isFinal = g.bucket === "final";
  const rawId = g.detailId || g.id;
  // Detail pages exist for MLB/NBA; NFL detail arrives with the model step, so
  // don't make NFL cards navigate to a route that isn't wired yet.
  const HAS_DETAIL = { mlb: true, nba: true };
  const target = rawId && HAS_DETAIL[league] ? `/game/${league}/${rawId}` : null;

  return (
    <div
      className="game-card"
      onClick={() => { if (target) navigate(target); }}
      style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 14, cursor: target ? "pointer" : "default" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <TeamLine t={g.away} showScore={isLive || isFinal} />
          <TeamLine t={g.home} showScore={isLive || isFinal} />
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {isLive && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />
              <span style={{ color: "#ef4444", fontWeight: 800, fontSize: 11, letterSpacing: 0.5 }}>LIVE</span>
            </div>
          )}
          <div style={{ fontSize: 12, color: isFinal ? "#22c55e" : isLive ? "#e4e7eb" : "#9ca3af", fontWeight: isFinal ? 700 : 500 }}>
            {isFinal ? "FINAL" : g.statusDetail || "—"}
          </div>
          {g.seriesSummary && <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{g.seriesSummary}</div>}
          {!isLive && !isFinal && g.venue && <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, maxWidth: 160, whiteSpace: "normal" }}>{g.venue}</div>}
          {target && <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 6 }}>View game →</div>}
        </div>
      </div>
    </div>
  );
}

function TeamLine({ t, showScore }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      {t.logo && <img src={t.logo} alt="" width={20} height={20} style={{ objectFit: "contain" }} />}
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t.abbrev}</span>
      <span style={{ fontSize: 11, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
      {t.record && <span style={{ fontSize: 10, color: "#4b5563" }}>({t.record})</span>}
      {showScore && <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{t.score != null ? t.score : "—"}</span>}
    </div>
  );
}

// Box score (innings/quarters line score + player stat lines). Exported so the
// full matchup page (GameDetail) can render the exact same component.
export function BoxScore({ detail, logos }) {
  const ls = detail.lineScore || [];
  const players = detail.players || [];
  const maxPeriods = Math.max(0, ...ls.map((r) => r.periods.length));

  // Convention: away team on TOP, home on BOTTOM. The feed sometimes delivers
  // these home-first, so we order them ourselves using the away team's abbrev
  // when we can resolve it from the detail payload. If we CAN'T identify the
  // away team (unknown data shape), we leave the original order untouched —
  // worst case is "no change", never a wrong sort.
  // Convention: away team on TOP, home on BOTTOM. Every line-score row carries
  // the feed's own homeAway flag, so order by that directly — reliable no matter
  // what shape the detail payload is. (Fallbacks: if a feed omits homeAway, match
  // the away abbrev; if even that's unknown, leave the order untouched — worst
  // case is "no change", never a wrong sort.)
  const awayAbbrev = (
    detail.away?.abbrev ||
    detail.away?.abbreviation ||
    detail.awayAbbrev ||
    detail.awayTeam?.abbrev ||
    null
  );
  const hasHomeAway = ls.some((r) => r.homeAway === "away" || r.homeAway === "home");
  const orderedLs = hasHomeAway
    ? [...ls].sort((a, b) => (a.homeAway === "away" ? 0 : 1) - (b.homeAway === "away" ? 0 : 1))
    : awayAbbrev
      ? [...ls].sort((a, b) => (a.abbrev === awayAbbrev ? 0 : 1) - (b.abbrev === awayAbbrev ? 0 : 1))
      : ls;

  const teams = {};
  for (const p of players) {
    if (p.didNotPlay) continue;
    (teams[p.team] ||= []).push(p);
  }
  // Team logos for the box score (abbrev -> logo URL), gathered from whatever
  // the detail payload provides; falls back to no logo if absent.
  const logoByAbbrev = {};
  for (const t of [detail.away, detail.home, detail.awayTeam, detail.homeTeam]) {
    const ab = t && (t.abbrev || t.abbreviation);
    if (ab && t.logo) logoByAbbrev[ab] = t.logo;
  }
  for (const r of ls) { if (r && r.abbrev && r.logo) logoByAbbrev[r.abbrev] = r.logo; }
  if (logos) for (const k in logos) { if (logos[k]) logoByAbbrev[k] = logos[k]; } // known-good logos passed from the score card
  const teamLogo = (ab) => logoByAbbrev[ab] || null;
  const COLS = {
    nba: ["MIN", "PTS", "REB", "AST"],
    mlb: ["AB", "R", "H", "RBI"],
  };
  const wanted = COLS[detail.league] || [];

  const cellNum = { textAlign: "center", padding: "8px 10px", color: "#cbd5e1", fontSize: 14, fontWeight: 400, fontVariantNumeric: "tabular-nums" };
  const headCell = { textAlign: "center", padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#ffffff", letterSpacing: "0.06em", textTransform: "uppercase" };

  return (
    <div>
      {/* line score (innings / quarters) */}
      {ls.length > 0 && maxPeriods > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
            {detail.league === "nba" ? "Quarters" : "Innings"}
          </div>
          <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%", minWidth: 320 }}>
            <thead>
              <tr style={{ background: "#0a0e14" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>Team</th>
                {Array.from({ length: maxPeriods }).map((_, i) => (
                  <th key={i} style={{ textAlign: "center", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#fff" }}>{i + 1}</th>
                ))}
                <th style={{ textAlign: "center", padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#fff", borderLeft: "1px solid #3a4757" }}>T</th>
              </tr>
            </thead>
            <tbody>
              {orderedLs.map((r, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #4b5563" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 800, color: "#fff", fontSize: 14 }}>
                    {teamLogo(r.abbrev) && <img src={teamLogo(r.abbrev)} alt="" width="18" height="18" style={{ objectFit: "contain", verticalAlign: "middle", marginRight: 7 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    <span style={{ verticalAlign: "middle" }}>{r.abbrev}</span>
                  </td>
                  {Array.from({ length: maxPeriods }).map((_, i) => (
                    <td key={i} style={{ textAlign: "center", padding: "8px 10px", color: "#cbd5e1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{r.periods[i] != null ? r.periods[i] : "·"}</td>
                  ))}
                  <td style={{ textAlign: "center", padding: "8px 10px", color: "#fff", fontWeight: 700, fontSize: 16, borderLeft: "1px solid #3a4757", fontVariantNumeric: "tabular-nums" }}>{r.total != null ? r.total : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* player stats per team */}
      {Object.keys(teams).map((teamAbbrev) => {
        const roster = teams[teamAbbrev];

        // split batters vs pitchers by position (SP/RP/P = pitcher)
        const isPitcher = (p) => {
          const pos = String(p.position || "").toUpperCase();
          return pos === "SP" || pos === "RP" || pos === "P";
        };
        const batters = roster.filter((p) => !isPitcher(p));
        const pitchers = roster.filter(isPitcher);

        // batter columns: prefer our compact set, fall back to whatever exists
        const BAT = wanted.filter((c) => batters[0] && batters[0].stats[c] !== undefined);
        const batCols = BAT.length ? BAT : (batters[0]?.columns || []).slice(0, 4);

        // pitcher columns: standard pitching line, only those present
        const PIT_WANT = detail.league === "mlb" ? ["IP", "H", "R", "ER", "BB", "K", "ERA"] : [];
        const pitCols = PIT_WANT.filter((c) => pitchers[0] && pitchers[0].stats[c] !== undefined);

        // green highlight for productive batting lines (2+ H or 1+ RBI)
        const bigLine = (p) => {
          const h = parseInt(p.stats.H, 10);
          const rbi = parseInt(p.stats.RBI, 10);
          return (Number.isFinite(h) && h >= 2) || (Number.isFinite(rbi) && rbi >= 1);
        };

        const batterRows = batters.map((p, i) => {
          const hot = bigLine(p);
          return (
            <tr key={`b${i}`} style={{ borderTop: "1px solid #4b5563" }}>
              <td style={{ padding: "7px 10px", whiteSpace: "nowrap", color: "#e4e7eb", fontWeight: 600 }}>
                {p.shortName} {p.starter && <span style={{ color: "#22c55e", fontSize: 10 }}>•</span>} <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 500 }}>{p.position}</span>
              </td>
              {batCols.map((c) => {
                const greenCol = hot && (c === "H" || c === "RBI") && p.stats[c] && parseInt(p.stats[c], 10) > 0;
                return <td key={c} style={{ ...cellNum, color: greenCol ? "#22c55e" : "#cbd5e1", fontWeight: greenCol ? 700 : 400 }}>{p.stats[c] ?? ""}</td>;
              })}
            </tr>
          );
        });

        const pitcherRows = pitchers.map((p, i) => (
          <tr key={`p${i}`} style={{ borderTop: "1px solid #4b5563" }}>
            <td style={{ padding: "7px 10px", whiteSpace: "nowrap", color: "#e4e7eb", fontWeight: 600 }}>
              {p.shortName} <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 500 }}>{p.position}</span>
            </td>
            {pitCols.map((c) => <td key={c} style={cellNum}>{p.stats[c] ?? ""}</td>)}
          </tr>
        ));

        return (
          <div key={teamAbbrev} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #2a3340" }}>
              {teamLogo(teamAbbrev) && <img src={teamLogo(teamAbbrev)} alt="" width="22" height="22" style={{ objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>{teamAbbrev}</span>
            </div>

            {/* Batters */}
            <div style={{ overflowX: "auto", marginBottom: pitchers.length ? 12 : 0 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%", minWidth: 320 }}>
                <thead>
                  <tr style={{ background: "#0a0e14" }}>
                    <th style={{ ...headCell, textAlign: "left" }}>Batters</th>
                    {batCols.map((c) => <th key={c} style={headCell}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>{batterRows}</tbody>
              </table>
            </div>

            {/* Pitchers — their own columns (IP H R ER BB K ERA) */}
            {pitchers.length > 0 && pitCols.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%", minWidth: 320 }}>
                  <thead>
                    <tr style={{ background: "#0a0e14" }}>
                      <th style={{ ...headCell, textAlign: "left", color: "#9ca3af" }}>Pitchers</th>
                      {pitCols.map((c) => <th key={c} style={headCell}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>{pitcherRows}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {ls.length === 0 && players.length === 0 && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>No box score data available for this game yet.</div>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading scores…</div>
    </div>
  );
}
function ErrorState({ onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load scores</div>
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 8 }}>Retry</button>
    </div>
  );
}
function EmptyState({ icon, league }) {
  const offSeason = getOffSeason(league);
  if (offSeason) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Off season</div>
        <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>{offSeason}</div>
      </div>
    );
  }
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>No games scheduled today</div>
      <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Check back when the next slate is posted.</div>
    </div>
  );
}

// Returns an off-season message if `league` is out of season right now, else null.
// Season windows are approximate (regular season + postseason):
//   MLB: late March → end of October   → off-season Nov 1 – ~Mar 20
//   NBA: mid-October → mid/late June    → off-season ~Jun 25 – mid-Oct
function getOffSeason(league) {
  const now = new Date();
  const m = now.getMonth(); // 0=Jan … 11=Dec
  const d = now.getDate();
  const lg = (league || "").toLowerCase();
  if (lg === "mlb") {
    // Off-season: Nov, Dec, Jan, Feb, and March before ~the 20th
    const off = m === 10 || m === 11 || m === 0 || m === 1 || (m === 2 && d < 20);
    return off ? "MLB returns in late March for Opening Day." : null;
  }
  if (lg === "nba") {
    // Off-season: late June (after ~the 25th) through mid-October (before ~the 18th)
    const off = (m === 5 && d > 25) || m === 6 || m === 7 || m === 8 || (m === 9 && d < 18);
    return off ? "The NBA returns in October for the new season." : null;
  }
  if (lg === "nfl") {
    // Season: early Sept → early Feb (Super Bowl). Off-season ~mid-Feb through August.
    const off = (m === 1 && d > 12) || (m >= 2 && m <= 7) || (m === 8 && d < 4);
    return off ? "The NFL returns in September for the new season." : null;
  }
  if (lg === "cfb") {
    // Season: late Aug → mid-Jan (CFP championship). Off-season ~late Jan through late Aug.
    const off = (m === 0 && d > 22) || (m >= 1 && m <= 6) || (m === 7 && d < 23);
    return off ? "College football returns in late August." : null;
  }
  if (lg === "nhl") {
    // Season: Oct → mid-June (Stanley Cup Final). Off-season ~late June through early Oct.
    const off = (m === 5 && d > 26) || m === 6 || m === 7 || (m === 8 && d < 4);
    return off ? "The NHL returns in October for the new season." : null;
  }
  return null;
}
