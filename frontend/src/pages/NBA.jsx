// NBA.jsx — NBA Playoffs predictions page (model v0.1: ML / spread / total)
//
// Reads the backend /api/nba/predictions endpoint and renders upcoming-game
// projections vs. the book line. Mirrors the styling of the MLB Games page.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function NBAPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/nba/predictions`);
      if (!res.ok) throw new Error("status " + res.status);
      setData(await res.json());
    } catch (e) {
      console.error("Failed to load NBA predictions:", e);
      setError(true); setData(null);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const games = data?.predictions || [];

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
        .game-row{transition:background .15s}
        .game-row:hover{background:#131820}
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

      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="games-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>🏀 NBA Playoffs</h1>
          <p style={{ margin: "0 0 28px", fontSize: 13, color: "#9ca3af" }}>
            Model v0.1 · projections vs. the book line · <span style={{ color: "#ef4444", fontWeight: 600 }}>value picks flagged</span>
          </p>

          {loading && <Loader />}
          {!loading && error && <ErrorState onRetry={load} />}
          {!loading && !error && games.length === 0 && <EmptyState />}
          {!loading && !error && games.length > 0 && <NBATable games={games} />}
        </div>
      </div>
    </div>
  );
}

function NBATable({ games }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div className="games-table-wrap" style={{ overflowX: "auto" }}>
        <table className="games-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937", color: "#6b7280" }}>
              <th style={th()}>Game</th>
              <th style={th()}>Tip</th>
              <th style={th("right")}>Win % (A/H)</th>
              <th style={th("right")}>Proj. Margin</th>
              <th style={th("right")}>Spread</th>
              <th style={th("right")}>Proj. Total</th>
              <th style={th("right")}>Total</th>
              <th style={th()}>Value pick</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const ml = g.predictions?.moneyline || {};
              const sp = g.predictions?.spread || {};
              const to = g.predictions?.total || {};
              const picks = [];
              if (ml.value && ml.pickTeam) picks.push(`${abbrevName(ml.pickTeam)} ML`);
              if (sp.value && sp.pickTeam) picks.push(`${abbrevName(sp.pickTeam)} ${fmtLine(sp.pickLine)}`);
              if (to.value && to.pick) picks.push(`${to.pick.toUpperCase()} ${to.line}`);
              const flagged = picks.length > 0;
              return (
                <tr key={g.gameId} className="game-row" style={{ borderBottom: "1px solid #131820" }}>
                  <td style={td()}>{abbrevName(g.away)} @ {abbrevName(g.home)}{g.neutralSite ? " (N)" : ""}</td>
                  <td style={{ ...td(), color: "#9ca3af" }}>{fmtTip(g.date)}</td>
                  <td style={td("right")}>{ml.awayWinProb != null ? `${Math.round(ml.awayWinProb)}/${Math.round(ml.homeWinProb)}` : "—"}</td>
                  <td style={td("right")}>{fmtMargin(sp.projectedMargin, g.home)}</td>
                  <td style={td("right")}>{sp.line != null ? `${g.home.split(" ").slice(-1)} ${fmtLine(sp.line)}` : "—"}</td>
                  <td style={td("right")}>{to.projectedTotal ?? "—"}</td>
                  <td style={td("right")}>{to.line ?? "—"}</td>
                  <td style={td()}>
                    {flagged
                      ? <span style={{ color: "#22c55e", fontWeight: 700 }}>{picks.join(" · ")}</span>
                      : <DataTag q={g.dataQuality} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 12, lineHeight: 1.5 }}>
        Win % = away/home. Proj. Margin is the model's expected home margin. Picks shown only when the
        edge clears threshold. "(N)" = neutral site. Ratings/pace from ESPN; injuries not yet weighted (v0.2).
      </div>
    </div>
  );
}

function DataTag({ q }) {
  if (!q || q === "ok") return <span style={{ color: "#6b7280" }}>—</span>;
  const map = {
    "offense-only": { c: "#f59e0b", t: "offense-only" },
    suspect: { c: "#ef4444", t: "suspect data" },
    insufficient: { c: "#ef4444", t: "no data" },
  };
  const m = map[q] || { c: "#6b7280", t: q };
  return <span style={{ color: m.c, fontSize: 10, fontWeight: 700 }}>⚠ {m.t}</span>;
}

function EmptyState() {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🏀</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>No upcoming NBA games</div>
      <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>
        Predictions appear once the next game is posted with betting lines.
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading NBA predictions...</div>
    </div>
  );
}

function ErrorState({ onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load NBA predictions</div>
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 8 }}>Retry</button>
    </div>
  );
}

function abbrevName(full) {
  if (!full) return "—";
  // last word is the team nickname (e.g. "Oklahoma City Thunder" -> "Thunder")
  const parts = full.split(" ");
  return parts[parts.length - 1];
}
function fmtLine(n) {
  if (n == null) return "";
  return n > 0 ? `+${n}` : `${n}`;
}
function fmtMargin(m, home) {
  if (m == null) return "—";
  const side = m >= 0 ? home : home; // sign indicates home margin
  const nick = home ? home.split(" ").slice(-1) : "HOME";
  return `${nick} ${m >= 0 ? "+" : ""}${m}`;
}
function fmtTip(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch { return dateStr; }
}
function th(align = "left") {
  return { padding: "8px 6px", textAlign: align, fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function td(align = "left") {
  return { padding: "10px 6px", textAlign: align, color: "#e4e7eb", fontSize: 12 };
}
