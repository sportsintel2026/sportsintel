// LiveScores.jsx — shared live scores view for MLB and NBA.
// Splits games into Live / Upcoming / Final with a blinking LIVE dot, refreshes
// every 30s, and lets you tap a game to expand its box score (innings/quarters
// line score + player stat lines). Driven by a `league` prop ("mlb" | "nba").

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi, scoresApi } from "../lib/api";
import Sidebar from "./Sidebar";

const LEAGUE_META = {
  mlb: { icon: "⚾", title: "MLB Games", periodLabel: "Inn" },
  nba: { icon: "🏀", title: "NBA Games", periodLabel: "Qtr" },
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
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
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
            Live scores & box scores · <span style={{ color: "#ef4444", fontWeight: 600 }}>tap a game</span> for innings & player stats
          </p>

          {loading && <Loader />}
          {!loading && error && <ErrorState onRetry={() => load(true)} />}
          {!loading && !error && total === 0 && <EmptyState icon={meta.icon} />}
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

function GameCard({ g, league, meta }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const isLive = g.bucket === "live";
  const isFinal = g.bucket === "final";

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && (isLive || isFinal)) {
      setLoadingDetail(true);
      try { setDetail(await scoresApi.getGameDetail(league, g.id)); }
      catch (e) { /* leave detail null; card still shows score */ }
      setLoadingDetail(false);
    }
  };

  return (
    <div className="game-card" onClick={toggle} style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 14 }}>
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
        </div>
      </div>

      {expanded && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 14, borderTop: "1px solid #1f2937", paddingTop: 14, cursor: "default" }}>
          {(!isLive && !isFinal) ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Box score appears once the game starts. {g.venue ? `Venue: ${g.venue}.` : ""}
            </div>
          ) : loadingDetail ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>Loading box score…</div>
          ) : detail ? (
            <Detail detail={detail} meta={meta} />
          ) : (
            <div style={{ fontSize: 12, color: "#6b7280" }}>Box score not available yet.</div>
          )}
        </div>
      )}

      {/* Always-available link to the full matchup/analysis page */}
      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #131820", display: "flex", justifyContent: "flex-end", cursor: "default" }}>
        <button
          onClick={() => navigate(`/game/${league}/${g.id}`)}
          style={{ background: "none", border: "1px solid #1f2937", borderRadius: 6, color: "#ef4444", fontSize: 11, fontWeight: 700, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}
        >
          Full matchup & analysis →
        </button>
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

function Detail({ detail, meta }) {
  const ls = detail.lineScore || [];
  const players = detail.players || [];
  const maxPeriods = Math.max(0, ...ls.map((r) => r.periods.length));

  // group players by team, drop DNPs to keep it readable
  const teams = {};
  for (const p of players) {
    if (p.didNotPlay) continue;
    (teams[p.team] ||= []).push(p);
  }
  // choose a compact set of stat columns to show
  const COLS = {
    nba: ["MIN", "PTS", "REB", "AST"],
    mlb: ["AB", "R", "H", "RBI"],
  };
  const wanted = COLS[detail.league] || [];

  return (
    <div>
      {/* line score */}
      {ls.length > 0 && maxPeriods > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ color: "#6b7280" }}>
                <th style={{ textAlign: "left", padding: "4px 8px", fontSize: 10 }}></th>
                {Array.from({ length: maxPeriods }).map((_, i) => (
                  <th key={i} style={{ textAlign: "center", padding: "4px 8px", fontSize: 10 }}>{i + 1}</th>
                ))}
                <th style={{ textAlign: "center", padding: "4px 8px", fontSize: 10, color: "#e4e7eb" }}>T</th>
              </tr>
            </thead>
            <tbody>
              {ls.map((r, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #131820" }}>
                  <td style={{ padding: "4px 8px", fontWeight: 700 }}>{r.abbrev}</td>
                  {Array.from({ length: maxPeriods }).map((_, i) => (
                    <td key={i} style={{ textAlign: "center", padding: "4px 8px", color: "#9ca3af" }}>{r.periods[i] != null ? r.periods[i] : ""}</td>
                  ))}
                  <td style={{ textAlign: "center", padding: "4px 8px", fontWeight: 800 }}>{r.total != null ? r.total : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* player stats per team */}
      {Object.keys(teams).map((teamAbbrev) => {
        const roster = teams[teamAbbrev];
        // figure out which of the wanted columns actually exist in the data
        const cols = wanted.filter((c) => roster[0] && roster[0].stats[c] !== undefined);
        const showCols = cols.length ? cols : (roster[0]?.columns || []).slice(0, 4);
        return (
          <div key={teamAbbrev} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 6 }}>{teamAbbrev}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr style={{ color: "#6b7280", borderBottom: "1px solid #1f2937" }}>
                    <th style={{ textAlign: "left", padding: "4px 6px", fontSize: 10 }}>Player</th>
                    {showCols.map((c) => <th key={c} style={{ textAlign: "right", padding: "4px 6px", fontSize: 10 }}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #131820" }}>
                      <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                        {p.shortName} {p.starter && <span style={{ color: "#22c55e", fontSize: 9 }}>•</span>} <span style={{ color: "#6b7280", fontSize: 10 }}>{p.position}</span>
                      </td>
                      {showCols.map((c) => <td key={c} style={{ textAlign: "right", padding: "4px 6px", color: "#e4e7eb", fontVariantNumeric: "tabular-nums" }}>{p.stats[c] ?? ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
function EmptyState({ icon }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>No games scheduled</div>
      <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Check back when the next slate is posted.</div>
    </div>
  );
}
