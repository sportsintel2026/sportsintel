// OddsPage.jsx — the "Odds Shop" line-shopping page.
//
// Shows EVERY US book's moneyline + total price per game, side by side, with the
// best available price in each market highlighted. The point: let CLV-minded
// subscribers shop for the best number themselves — the honest, $7 alternative to
// the expensive odds-screen tools. Read-only; data from /api/odds/mlb (90s cache,
// refresh-on-view). Best price = highest American number on each side; over/under
// "best" is judged only among books on the consensus total line.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { oddsApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

const fmtOdds = (p) => (p == null ? "—" : p > 0 ? `+${p}` : `${p}`);
const nick = (name) => {
  const parts = String(name || "").trim().split(" ");
  return parts.length > 1 ? parts[parts.length - 1] : (name || "");
};
const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
};

function BestCell({ price, isBest, note }) {
  return (
    <td style={{
      padding: "8px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums",
      fontSize: 13, fontWeight: isBest ? 800 : 500,
      color: isBest ? "#1D9E75" : "#cbd2da",
      background: isBest ? "rgba(29,158,117,0.10)" : "transparent",
      borderRadius: isBest ? 4 : 0, whiteSpace: "nowrap",
    }}>
      {fmtOdds(price)}
      {note ? <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 500 }}> {note}</span> : null}
    </td>
  );
}

function GameCard({ game }) {
  const cl = game.consensusTotalLine;
  const best = game.best || {};
  const thStyle = { padding: "8px 10px", fontSize: 10, letterSpacing: "0.04em", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" };

  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 16, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e4e7eb" }}>{game.away} <span style={{ color: "#6b7280", fontWeight: 500 }}>@</span> {game.home}</div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>{fmtTime(game.commenceTime)}{cl != null ? ` · Total ${cl}` : ""}</div>
      </div>

      {/* Best-price callout — the quick line-shop answer */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", margin: "6px 0 12px", fontSize: 11, color: "#9ca3af" }}>
        {best.awayML && <span><strong style={{ color: "#1D9E75" }}>{nick(game.away)} {fmtOdds(best.awayML.price)}</strong> @ {best.awayML.book}</span>}
        {best.homeML && <span><strong style={{ color: "#1D9E75" }}>{nick(game.home)} {fmtOdds(best.homeML.price)}</strong> @ {best.homeML.book}</span>}
        {best.over && <span><strong style={{ color: "#1D9E75" }}>O{cl} {fmtOdds(best.over.price)}</strong> @ {best.over.book}</span>}
        {best.under && <span><strong style={{ color: "#1D9E75" }}>U{cl} {fmtOdds(best.under.price)}</strong> @ {best.under.book}</span>}
      </div>

      {/* Full book-by-book table (scrolls horizontally on small screens) */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1f2937" }}>
              <th style={{ ...thStyle, textAlign: "left" }}>Book</th>
              <th style={thStyle}>{nick(game.away)} ML</th>
              <th style={thStyle}>{nick(game.home)} ML</th>
              <th style={thStyle}>Over{cl != null ? ` ${cl}` : ""}</th>
              <th style={thStyle}>Under{cl != null ? ` ${cl}` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {game.books.map((b, i) => {
              const onLine = cl != null && b.totalLine === cl;
              const lineNote = (b.totalLine != null && cl != null && b.totalLine !== cl) ? `@${b.totalLine}` : null;
              return (
                <tr key={i} style={{ borderBottom: i < game.books.length - 1 ? "1px solid #141a22" : "none" }}>
                  <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#e4e7eb", whiteSpace: "nowrap" }}>{b.book}</td>
                  <BestCell price={b.awayML} isBest={b.awayML != null && best.awayML && b.awayML === best.awayML.price} />
                  <BestCell price={b.homeML} isBest={b.homeML != null && best.homeML && b.homeML === best.homeML.price} />
                  <BestCell price={b.over} isBest={onLine && best.over && b.over === best.over.price} note={lineNote} />
                  <BestCell price={b.under} isBest={onLine && best.under && b.under === best.under.price} note={lineNote} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OddsPage() {
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
        const res = await oddsApi.getMLB();
        setData(res);
      } catch (_) {
        setData(null);
      }
      setLoading(false);
    })();
  }, []);

  const games = (data && Array.isArray(data.games)) ? data.games : [];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:#1f2937;border-radius:3px}
        .hamburger-btn{display:none}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important;padding-top:0!important}
          .hamburger-btn{display:flex!important}
          .mobile-only{display:flex!important}
          .od-content{padding:16px 14px 60px!important}
          h1{font-size:22px!important}
        }
      `}</style>

      <BottomNav />
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
        <button onClick={() => setDrawerOpen(true)} className="hamburger-btn" style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer", display: "none", alignItems: "center" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#1D9E75" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="od-content" style={{ maxWidth: 860, margin: "0 auto", padding: "24px 24px 60px" }}>
          <div onClick={() => navigate(-1)} style={{ color: "#6b7280", fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, userSelect: "none" }}>← Back</div>
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>💹 Market Price</h1>
          </div>
          <p style={{ margin: "0 0 22px", fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
            Every major US book's price, side by side — so you can grab the <strong style={{ color: "#cbd2da" }}>best number</strong> before you bet.
            The <span style={{ color: "#1D9E75", fontWeight: 700 }}>highlighted</span> price is the best available in each market. Shopping the best line is the simplest edge there is.
          </p>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <div style={{ width: 26, height: 26, border: "3px solid #1f2937", borderTopColor: "#1D9E75", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
            </div>
          ) : !hasFullAccess ? (
            <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 28, textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e4e7eb", marginBottom: 8 }}>🔒 Market Price is an All-Access feature</div>
              <p style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6, maxWidth: 460, margin: "0 auto 18px" }}>
                Compare every US sportsbook's line in one place and always bet the best price — the kind of tool other sites charge a fortune for.
              </p>
              <button onClick={() => navigate("/pricing")} style={{ background: "#1D9E75", color: "#fff", border: "none", borderRadius: 6, padding: "10px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Get All-Access — $7/mo
              </button>
            </div>
          ) : games.length === 0 ? (
            <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 28, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              No games with odds right now. Check back closer to game day.
            </div>
          ) : (
            <>
              {data?.updatedAt && (
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
                  {games.length} game{games.length === 1 ? "" : "s"} · prices update every ~90 seconds
                </div>
              )}
              {games.map((g) => <GameCard key={g.id} game={g} />)}
              <p style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.6, marginTop: 18 }}>
                Odds move fast and vary by location — always confirm the price in your sportsbook before betting. WizePicks is an analytics tool, not a sportsbook.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
