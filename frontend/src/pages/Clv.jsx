// Clv.jsx — "Beat the Close": the closing-line-value explainer.
// Built to serve (and convert) CLV-minded bettors: what CLV is, why it's the only
// edge that lasts, how to read odds, and how to use the Odds Shop to capture it.
// Honest throughout — CLV is framed as a long-run signal, not a per-bet guarantee,
// and we point to our own openly-tracked CLV on Performance. House inline-style.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import TerminalShell from "./TerminalShell";

export default function ClvPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  return (
    <TerminalShell active="/clv" plan={plan} navigate={navigate}>
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
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
          .main-content{margin-left:0!important}
          .hamburger-btn{display:flex!important}
          .mobile-only{display:flex!important}
          .clv-content{padding:16px 14px 60px!important}
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
        <button onClick={() => setDrawerOpen(true)} className="hamburger-btn" style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer", display: "none", alignItems: "center" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#1D9E75" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="clv-content" style={{ maxWidth: 760, margin: "0 auto", padding: "24px 24px 60px" }}>
          <button onClick={() => navigate("/dashboard")} style={{ background: "transparent", border: "1px solid #1f2937", color: "#9ca3af", fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 8, cursor: "pointer", marginBottom: 20, fontFamily: "inherit" }}>← Back to Edges</button>
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em" }}>Beat the Close</h1>
          </div>
          <p style={{ margin: "0 0 22px", fontSize: 14, color: "#9ca3af", lineHeight: 1.7, maxWidth: 620 }}>
            The single most important idea in serious betting — and the one casual bettors never hear.
            If you only learn one thing here, learn this.
          </p>

          <Card accent="#1D9E75">
            <Eyebrow>What is the closing line?</Eyebrow>
            <P>
              The <B>closing line</B> is the final price on a game right before it starts. By then every
              injury, lineup, weather report, and dollar of sharp money has been baked in — so the close is
              the market's <B>sharpest, most-accurate number</B> of the whole cycle.
            </P>
            <P style={{ marginBottom: 0 }}>
              That makes it the perfect yardstick. Whatever price <i>you</i> got, you can compare it to where
              the market closed and ask one question: <B>did I get a better number than the final, sharpest price?</B>
            </P>
          </Card>

          <Card accent="#1D9E75">
            <Eyebrow>What is CLV — and why it's the only edge that lasts</Eyebrow>
            <P>
              <B>Closing-line value (CLV)</B> is how much better your price was than the close. Bet the
              Yankees at <B>−110</B> and they close at <B>−130</B>? You beat the close — positive CLV. You
              locked a price the rest of the market would kill for by game time.
            </P>
            <P>
              Here's why it matters more than your win/loss record: any night, anyone can win or lose on
              luck. A <B>week of green tells you almost nothing.</B> But if you <i>consistently</i> beat the
              closing number, you were getting value the market only recognized later — and that shows up
              long before the wins do. <B>CLV is the leading indicator; results are the lagging one.</B>
            </P>
            <P style={{ marginBottom: 0 }}>
              Sharp bettors obsess over CLV for exactly this reason. It's the cleanest signal that a bet was
              <i> good</i>, independent of whether it happened to <i>win.</i>
            </P>
          </Card>

          <Card>
            <Eyebrow>How to read the price (American odds)</Eyebrow>
            <Term term="Minus numbers (−120)" tint="#1D9E75">
              How much you risk to win $100. <B>−120 risks $120 to win $100.</B> A <i>smaller</i> minus
              (−110) is a better price than a bigger one (−130).
            </Term>
            <Term term="Plus numbers (+110)" tint="#1D9E75">
              How much you win on a $100 risk. <B>+110 wins $110 on $100.</B> A <i>bigger</i> plus (+120) is
              better than a smaller one (+105).
            </Term>
            <Term term="The only rule you need" tint="#1D9E75" last>
              For the side you want, the <B>higher number is always the better price</B> — more positive, or
              less negative. Same bet, better payout, zero extra risk.
            </Term>
          </Card>

          <Card accent="#1D9E75">
            <Eyebrow>How to actually capture CLV</Eyebrow>
            <Step n="1" title="Shop every book for the best price">
              The same bet pays differently across sportsbooks. Taking the best available number <i>is</i>
              getting a head start on the close. Our <B>💹 Market Price</B> page puts every major US book side by
              side and highlights the best price, so you grab it without hunting.
            </Step>
            <Step n="2" title="Spot the book that's out of step">
              When one book hangs a line a notch off the rest, that's a better number sitting in the open.
              Seeing all the books at once makes those stand out.
            </Step>
            <Step n="3" title="Move before the market does" last>
              Prices drift toward the close as money comes in. If you have a read and the number is good
              <i> now</i>, waiting often costs you the price. A good number today can be gone by first pitch.
            </Step>
          </Card>

          <Card>
            <Eyebrow>How WizePicks helps — honestly</Eyebrow>
            <P>
              We give you the tools to chase CLV: the <B>Market Price</B> page for the best price on every game, the
              full data and reasoning behind each number, and matchup context so you can move early with
              conviction.
            </P>
            <P style={{ marginBottom: 0 }}>
              And we hold <i>ourselves</i> to the same standard. On <B>Performance</B> we lead with our own
              closing-line value — including the misses — because if a service only ever shows you green,
              you should be suspicious. CLV is a <B>long-run signal, not a promise on any single bet.</B>
              No one beats the close every time. The goal is to do it more often than not, and to be honest
              about the score.
            </P>
          </Card>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => navigate("/odds")} style={{ background: "#1D9E75", color: "#fff", border: "none", borderRadius: 6, padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Open Market Price →
            </button>
            <button onClick={() => navigate("/performance")} style={{ background: "transparent", color: "#9ca3af", border: "1px solid #1f2937", borderRadius: 6, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              See our tracked CLV
            </button>
          </div>

          <p style={{ fontSize: 12, color: "#6b7280", textAlign: "center", marginTop: 28, lineHeight: 1.6 }}>
            WizePicks is an analytics tool, not a sportsbook. Odds vary by location — always confirm the
            price in your book before betting. Bet responsibly; if gambling is a problem, call 1-800-GAMBLER.
          </p>
        </div>
      </div>
    </div>
    </TerminalShell>
  );
}

/* ---- small presentational helpers (house style, matches Guide) ---- */
function Card({ children, accent }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderLeft: accent ? `3px solid ${accent}` : "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 18 }}>
      {children}
    </div>
  );
}
function Eyebrow({ children, tint }) {
  return <div style={{ fontSize: 11, letterSpacing: "0.1em", color: tint || "#1D9E75", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>{children}</div>;
}
function P({ children, style }) {
  return <p style={{ margin: "0 0 14px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.65, ...style }}>{children}</p>;
}
function B({ children }) {
  return <span style={{ color: "#f3f4f6", fontWeight: 700 }}>{children}</span>;
}
function Term({ term, children, tint, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tint || "#e4e7eb", marginBottom: 3 }}>{term}</div>
      <div style={{ fontSize: 13.5, color: "#9ca3af", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
function Step({ n, title, children, last }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: last ? 0 : 14 }}>
      <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#1D9E7522", border: "1px solid #1D9E7555", color: "#1D9E75", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{n}</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e4e7eb", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "#9ca3af", lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}
