import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, supabase } from "../lib/api";

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
  const [plan, setPlan] = useState({ tier: "free" });
  const [menuOpen, setMenuOpen] = useState(false);
  const isPro = plan.tier === "pro" || plan.tier === "elite";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  // Load editorial picks from daily_picks
  useEffect(() => {
    const loadPicks = async () => {
      try {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const { data } = await supabase.from("daily_picks").select("*").eq("date", today).single();
        if (data?.picks) setPicks(JSON.parse(data.picks));
      } catch (e) {}
    };
    loadPicks();
  }, []);

  // Load edges for MLB only
  const loadEdges = useCallback(async () => {
    if (league !== "mlb") {
      setEdges(null);
      setEdgesLoading(false);
      return;
    }
    setEdgesLoading(true);
    try {
      const data = await edgesApi.getMLB();
      setEdges(data);
    } catch (e) {
      console.error("Failed to load edges:", e);
      setEdges(null);
    }
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
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .edge-row{transition:background .15s}
        .edge-row:hover{background:#0f1419!important}
        .tab-btn{transition:all .15s;cursor:pointer}
        .tab-btn:hover{color:#fff}
      `}</style>

      {/* HEADER */}
      <Header user={user} plan={plan} signOut={signOut} navigate={navigate} menuOpen={menuOpen} setMenuOpen={setMenuOpen} isPro={isPro} />

      {/* LEAGUE TABS */}
      <LeagueTabs league={league} setLeague={setLeague} />

      {menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }} />}

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 60px" }}>
        {league === "mlb" ? (
          <MLBDashboard
            edges={edges}
            loading={edgesLoading}
            picks={picks}
            isPro={isPro}
            navigate={navigate}
            onRefresh={loadEdges}
          />
        ) : (
          <ComingSoon league={LEAGUES.find(l => l.id === league)} />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function Header({ user, plan, signOut, navigate, menuOpen, setMenuOpen, isPro }) {
  return (
    <div style={{ background: "#0a0e14", borderBottom: "1px solid #1a1f28", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Sports<span style={{ color: "#ef4444" }}>intel</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 10, padding: "4px 10px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.06em",
            background: isPro ? "#22c55e15" : "#1c2128",
            color: isPro ? "#22c55e" : "#6b7280",
            border: `1px solid ${isPro ? "#22c55e30" : "#1f2937"}`,
          }}>
            {isPro ? "SUBSCRIBED" : "FREE"}
          </span>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(135deg,#ef4444,#dc2626)",
                border: "none", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              }}>
              {user?.email?.[0]?.toUpperCase() || "U"}
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: 40, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 8, minWidth: 220, zIndex: 200, boxShadow: "0 12px 40px #00000080" }}>
                <div style={{ padding: "8px 12px", fontSize: 11, color: "#6b7280", borderBottom: "1px solid #1a1f28", marginBottom: 6 }}>{user?.email}</div>
                {!isPro && (
                  <button onClick={() => { navigate("/pricing"); setMenuOpen(false); }}
                    style={{ width: "100%", textAlign: "left", background: "#ef444412", border: "1px solid #ef444430", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#ef4444", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 6 }}>
                    ⚡ Subscribe — $7/mo
                  </button>
                )}
                <MenuButton onClick={() => { navigate("/admin"); setMenuOpen(false); }}>🎯 Manage Picks</MenuButton>
                <MenuButton onClick={() => { signOut(); navigate("/"); }}>↩ Sign Out</MenuButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuButton({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", textAlign: "left", background: "none", border: "none",
      padding: "8px 12px", fontSize: 12, color: "#9ca3af", cursor: "pointer", fontFamily: "inherit", borderRadius: 6,
    }}>{children}</button>
  );
}

function LeagueTabs({ league, setLeague }) {
  return (
    <div style={{ background: "#0a0e14", borderBottom: "1px solid #1a1f28" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px", display: "flex", gap: 4, overflowX: "auto" }}>
        {LEAGUES.map(l => {
          const active = league === l.id;
          return (
            <button
              key={l.id}
              className="tab-btn"
              onClick={() => setLeague(l.id)}
              style={{
                background: "none", border: "none", padding: "12px 14px",
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? "#fff" : "#6b7280",
                borderBottom: `2px solid ${active ? "#ef4444" : "transparent"}`,
                marginBottom: -1, cursor: "pointer", fontFamily: "inherit",
                whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
              }}>
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

// ──────────────────────────────────────────────────────────────────────────────

function MLBDashboard({ edges, loading, picks, isPro, navigate, onRefresh }) {
  if (loading) return <Loader />;
  if (!edges) return <ErrorState onRetry={onRefresh} />;

  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const gameCount = edges.games?.length || 0;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      {/* TITLE */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Today's edges · {date.split(",")[0]}</h1>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {gameCount} games · {edges.cached ? "Cached" : "Updated"} {new Date(edges.computedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
        Model projections vs sportsbook lines. Sorted by edge.
      </p>

      {/* MODEL BETA NOTICE */}
      <div style={{ background: "#1a1410", border: "1px solid #f5970022", borderLeft: "3px solid #f59700", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#fbbf24" }}>
        <strong>Model v0.1 · Research-grade.</strong> <span style={{ color: "#a8915c" }}>Projections are based on season-to-date stats and public park factors. No model beats the market — use as one input among many, not gospel.</span>
      </div>

      {/* EDITORIAL BEST BETS */}
      {picks.length > 0 && (
        <EditorialBestBets picks={picks} isPro={isPro} navigate={navigate} />
      )}

      {/* TWO COLUMN: MONEYLINE + TOTALS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, gridAutoRows: "1fr" }}>
        <EdgePanel
          title="Top moneyline edges"
          icon="💰"
          edges={edges.moneylineEdges || []}
          renderRow={(e) => <MoneylineRow edge={e} key={e.gameId + e.side} />}
          emptyText="No edges found in current slate"
          isPro={isPro}
          navigate={navigate}
        />
        <EdgePanel
          title="Top totals edges"
          icon="📊"
          edges={edges.totalsEdges || []}
          renderRow={(e) => <TotalsRow edge={e} key={e.gameId + e.side} />}
          emptyText="No edges found in current slate"
          isPro={isPro}
          navigate={navigate}
        />
      </div>

      {/* HR PROPS */}
      <div style={{ marginBottom: 16 }}>
        <EdgePanel
          title="Top home run props"
          icon="💣"
          edges={edges.hrPropEdges || []}
          renderRow={(e) => <HRPropRow edge={e} key={e.player + e.game} />}
          emptyText="HR prop data updates closer to first pitch"
          isPro={isPro}
          navigate={navigate}
          wide
        />
      </div>

      {/* ALL GAMES TABLE */}
      <AllGamesTable games={edges.games || []} isPro={isPro} navigate={navigate} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function EditorialBestBets({ picks, isPro, navigate }) {
  return (
    <div style={{
      background: "linear-gradient(180deg,#1a1410 0%,#0f1419 100%)",
      border: "1px solid #ef444433", borderLeft: "3px solid #ef4444",
      borderRadius: 8, padding: "16px 20px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#ef4444", fontWeight: 600 }}>🎯 TODAY'S BEST BETS · EDITORIAL</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{picks.length} pick{picks.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(picks.length, 3)}, 1fr)`, gap: 12 }}>
        {picks.map((p, i) => {
          const locked = !isPro && i > 0;
          return (
            <div key={i} style={{
              position: "relative", background: "#0f1419", borderRadius: 6,
              padding: 12, border: "1px solid #1f2937", overflow: "hidden",
            }}>
              {locked && (
                <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(8px)", background: "#0a0e1499", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    🔒 Unlock — $7/mo
                  </button>
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

function EdgePanel({ title, icon, edges, renderRow, emptyText, isPro, navigate, wide }) {
  // Free users see top 1, blurred for rest
  const visible = isPro ? edges : edges.slice(0, 1);
  const hidden = isPro ? [] : edges.slice(1, 5);
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
                <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  🔒 Unlock all edges — $7/mo
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MoneylineRow({ edge }) {
  return (
    <div className="edge-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{edge.teamAbbr} ML</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.matchup} · {formatOdds(edge.odds)} {edge.time && `· ${edge.time}`}
        </div>
      </div>
      <div style={{ textAlign: "right", marginLeft: 10 }}>
        <EdgeBadge edge={edge.edge} />
        <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>{Math.round(edge.modelProb * 100)}% model</div>
      </div>
    </div>
  );
}

function TotalsRow({ edge }) {
  return (
    <div className="edge-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "#0a0e14", borderRadius: 4 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{edge.side === "over" ? "Over" : "Under"} {edge.line}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.matchup} · {formatOdds(edge.odds)}
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
  return (
    <div className="edge-row" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", gap: 10, padding: 10, background: "#0a0e14", borderRadius: 4, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{edge.player}</div>
        <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {edge.team} · vs {edge.opposingPitcher || "TBD"}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>{formatOdds(edge.odds)}</div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>{Math.round(edge.hrProb * 100)}% model</div>
      <EdgeBadge edge={edge.edge} />
      <ConfidenceBadge conf={edge.confidence} />
    </div>
  );
}

function AllGamesTable({ games, isPro, navigate }) {
  if (games.length === 0) return null;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: "#9ca3af", fontWeight: 500 }}>📋 ALL GAMES · MODEL PROJECTIONS</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{games.length} games</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937", color: "#6b7280" }}>
              <th style={th()}>Game</th>
              <th style={th()}>Time</th>
              <th style={th()}>Pitchers</th>
              <th style={th("right")}>Model</th>
              <th style={th("right")}>Total</th>
              <th style={th("right")}>Park</th>
            </tr>
          </thead>
          <tbody>
            {games.map(g => (
              <tr key={g.id} style={{ borderBottom: "1px solid #131820" }}>
                <td style={td()}>{g.awayAbbr} @ {g.homeAbbr}</td>
                <td style={td()}>{g.time}</td>
                <td style={td()}>
                  <div style={{ color: "#9ca3af" }}>{g.pitchers?.away?.name || "TBD"}</div>
                  <div style={{ color: "#9ca3af" }}>{g.pitchers?.home?.name || "TBD"}</div>
                </td>
                <td style={td("right")}>
                  {g.moneyline?.awayWinProb != null
                    ? `${Math.round(g.moneyline.awayWinProb * 100)}% / ${Math.round(g.moneyline.homeWinProb * 100)}%`
                    : "—"}
                </td>
                <td style={td("right")}>{g.totals?.projected ?? "—"}</td>
                <td style={td("right")}>
                  <span style={{ color: g.parkRunFactor > 1.05 ? "#22c55e" : g.parkRunFactor < 0.95 ? "#ef4444" : "#9ca3af" }}>
                    {g.parkRunFactor?.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function th(align = "left") {
  return { padding: "8px 6px", textAlign: align, fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase" };
}
function td(align = "left") {
  return { padding: "10px 6px", textAlign: align, color: "#e4e7eb", fontSize: 12 };
}

// ──────────────────────────────────────────────────────────────────────────────

function EdgeBadge({ edge }) {
  if (edge == null) return <span style={{ fontSize: 11, color: "#6b7280" }}>—</span>;
  const positive = edge > 0;
  const color = positive ? "#22c55e" : "#ef4444";
  const sign = positive ? "+" : "";
  return (
    <span style={{ fontSize: 14, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>
      {sign}{(edge * 100).toFixed(1)}%
    </span>
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
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`, letterSpacing: "0.05em",
    }}>
      {conf?.slice(0, 3) || "—"}
    </span>
  );
}

function formatOdds(american) {
  if (american == null) return "—";
  return american > 0 ? `+${american}` : `${american}`;
}

// ──────────────────────────────────────────────────────────────────────────────

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
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
        Retry
      </button>
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
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 16 }}>
        Your $7/mo subscription will include {league?.label} when it launches — no upgrade required.
      </p>
    </div>
  );
}
