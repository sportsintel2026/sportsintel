// Consensus.jsx — the "agreement" page.
//
// Surfaces the rare, high-signal spots where TWO INDEPENDENT reads land on the
// SAME play: the owner's hand-picked Best Bets and the algorithmic model edges.
// Strict match (same game + market + side + line) computed read-only by the
// backend at /api/consensus/mlb. This page only DISPLAYS — it never creates,
// changes, or grades a Best Bet or a model pick; both keep their own records.
//
// Deliberately minimal: just the play + a badge that both signals agree.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { consensusApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import TerminalShell from "./TerminalShell";

// "TB @ MIA" -> { away: "TB", home: "MIA" }
function teamsFromGame(game) {
  const parts = String(game || "").split(/\s*@\s*/);
  return { away: (parts[0] || "").trim(), home: (parts[1] || "").trim() };
}

// Clean, readable label for a consensus play.
function formatPlay(c) {
  const { away, home } = teamsFromGame(c.game);
  if (c.market === "moneyline") return `${c.side === "home" ? home : away} ML`;
  if (c.market === "total") return `${c.side === "over" ? "Over" : "Under"} ${c.line}`;
  if (c.market === "run_line") {
    const team = c.side === "home" ? home : away;
    const n = Number(c.line);
    return `${team} ${Number.isFinite(n) && n > 0 ? "+" : ""}${c.line}`;
  }
  return (c.model && c.model.display) || `${c.side} ${c.line ?? ""}`.trim();
}

const MARKET_LABEL = { moneyline: "Moneyline", total: "Total", run_line: "Run Line" };

export default function ConsensusPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await consensusApi.getMLB();
        setData(res);
      } catch (_) {
        setData(null); // never crash; show empty state
      }
      setLoading(false);
    })();
  }, []);

  const consensus = (data && Array.isArray(data.consensus)) ? data.consensus : [];

  return (
    <TerminalShell active="/consensus" plan={plan} navigate={navigate}>
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
        .hamburger-btn{display:none}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
         (min-width: 1024px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
        }

        @media (min-width: 1024px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
        }
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important;padding-top:0!important}
          .hamburger-btn{display:flex!important}
          .mobile-only{display:flex!important}
          .cs-content{padding:16px 14px 60px!important}
          h1{font-size:22px!important}
        }
      `}</style>

      {/* Desktop sidebar */}
      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(path) => { setDrawerOpen(false); navigate(path); }} />
          </div>
        </>
      )}

      {/* Mobile top bar */}
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} className="hamburger-btn" style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer", display: "none", alignItems: "center" }}>
          ☰
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#1D9E75" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="cs-content" style={{ maxWidth: 760, margin: "0 auto", padding: "24px 24px 60px" }}>
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>🤝 Consensus</h1>
          </div>
          <p style={{ margin: "0 0 22px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
            Where both signals agree — a hand-picked <strong style={{ color: "#cbd2da" }}>Best Bet</strong> and an
            independent <strong style={{ color: "#cbd2da" }}>model edge</strong> landing on the exact same play.
            Two reads, one conclusion.
          </p>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <div style={{ width: 26, height: 26, border: "3px solid #1f2937", borderTopColor: "#1D9E75", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
            </div>
          ) : !hasFullAccess ? (
            <div style={{ background: "#11161f", border: "1px solid #1a1f28", borderRadius: 12, padding: "32px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Consensus is part of All-Access</div>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: "#9ca3af" }}>
                See where the model and the hand-picked Best Bets agree.
              </p>
              <button
                onClick={() => navigate("/pricing")}
                style={{ background: "#1D9E75", color: "#04130d", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                View plans
              </button>
            </div>
          ) : consensus.length === 0 ? (
            <div style={{ background: "#11161f", border: "1px solid #1a1f28", borderRadius: 12, padding: "40px 24px", textAlign: "center", animation: "fadeIn .3s ease-out" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🗓️</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No consensus plays right now</div>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
                The model and today's Best Bets don't overlap on the current slate.
                When a Best Bet matches a model edge, it shows up here.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {consensus.map((c, i) => (
                <div
                  key={`${c.game}-${c.market}-${c.side}-${i}`}
                  style={{ background: "#11161f", border: "1px solid #1a3a2e", borderRadius: 12, padding: "16px 18px", animation: "fadeIn .3s ease-out", animationDelay: `${i * 0.03}s`, animationFillMode: "both" }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.04em", marginBottom: 3 }}>
                        {c.game} · {MARKET_LABEL[c.market] || c.market}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
                        {formatPlay(c)}
                      </div>
                    </div>
                    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: "rgba(29,158,117,0.12)", color: "#1D9E75", border: "1px solid rgba(29,158,117,0.35)", whiteSpace: "nowrap" }}>
                      ✓ Model + Best Bets agree
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && hasFullAccess && (
            <p style={{ margin: "20px 2px 0", fontSize: 11, color: "#4b5563", lineHeight: 1.6 }}>
              Read-only. The model and Best Bets are independent and each keeps its own record;
              this page only highlights where they coincide. Informational analysis, not betting advice.
            </p>
          )}
        </div>
      </div>
    </div>
    </TerminalShell>
  );
}
