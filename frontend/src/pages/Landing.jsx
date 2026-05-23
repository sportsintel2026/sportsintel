import { Link } from "react-router-dom";

const features = [
  { icon: "⚡", title: "Live Scores", desc: "Real-time scores across MLB, NBA & NFL updated every 5 minutes during games." },
  { icon: "📊", title: "Deep Stats", desc: "Box scores, player stats, and performance breakdowns for every game." },
  { icon: "⚔️", title: "Head-to-Head History", desc: "All-time and recent matchup records between any two teams going back decades." },
  { icon: "🎯", title: "Player vs. Opponent", desc: "Career stats for every player against today's opponent — know who's hot." },
  { icon: "🌤", title: "Weather Analysis", desc: "Real-time conditions with game-impact analysis per ballpark." },
  { icon: "🏆", title: "Playoff Tracker", desc: "Full playoff bracket, series records, and win probability for every game." },
];

const plans = [
  { name: "Free", price: "$0", color: "#475569", features: ["Live scores", "Basic standings", "Today's schedule"] },
  { name: "Pro", price: "$4.99", per: "/mo", color: "#ef4444", popular: true, features: ["Everything in Free", "H2H records", "Player vs opponent stats", "Weather impact analysis", "Box scores"] },
  { name: "Elite", price: "$9.99", per: "/mo", color: "#f59e0b", features: ["Everything in Pro", "All leagues", "Betting line data", "Push notifications", "No ads"] },
];

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
      `}</style>

      {/* Nav */}
      <nav style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 10px #22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 22, fontWeight: 900, letterSpacing: "0.08em" }}>SPORTSINTEL</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/pricing" style={{ color: "#94a3b8", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>Pricing</Link>
          <Link to="/login" style={{ color: "#94a3b8", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>Sign In</Link>
          <Link to="/signup" style={{ background: "#ef4444", color: "#fff", textDecoration: "none", padding: "8px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700 }}>Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: "center", padding: "80px 24px 60px", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#ef444420", border: "1px solid #ef444440", borderRadius: 20, padding: "6px 16px", marginBottom: 28, fontSize: 12, color: "#ef4444", fontWeight: 600, letterSpacing: "0.06em" }}>
          🔴 LIVE · MAY 22, 2026 · 15 MLB GAMES TODAY
        </div>
        <h1 style={{ fontFamily: "'Barlow Condensed'", fontSize: "clamp(42px,8vw,80px)", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.01em", marginBottom: 24, color: "#fff" }}>
          YOUR EDGE ON<br />
          <span style={{ color: "#ef4444" }}>EVERY GAME</span>
        </h1>
        <p style={{ fontSize: "clamp(16px,2.5vw,20px)", color: "#64748b", lineHeight: 1.7, marginBottom: 40, maxWidth: 560, margin: "0 auto 40px" }}>
          Live scores, deep stats, H2H history, player matchup data, and weather analysis — all in one place.
        </p>
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/signup" style={{ background: "#ef4444", color: "#fff", textDecoration: "none", padding: "14px 36px", borderRadius: 10, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em" }}>
            Start Free →
          </Link>
          <Link to="/pricing" style={{ background: "transparent", color: "#94a3b8", textDecoration: "none", padding: "14px 36px", borderRadius: 10, fontSize: 16, fontWeight: 600, border: "1px solid #1e2235" }}>
            See Plans
          </Link>
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: "#334155" }}>No credit card required · Free forever plan available</p>
      </div>

      {/* League badges */}
      <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: "0 24px 60px", flexWrap: "wrap" }}>
        {[["⚾","MLB","15 games today"],["🏀","NBA","Playoffs live"],["🏈","NFL","Season Sep '26"]].map(([icon,label,sub])=>(
          <div key={label} style={{ background: "#0d0d1a", border: "1px solid #1e2235", borderRadius: 12, padding: "14px 24px", textAlign: "center", minWidth: 120 }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{label}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 80px" }}>
        <h2 style={{ textAlign: "center", fontFamily: "'Barlow Condensed'", fontSize: 40, fontWeight: 900, color: "#fff", marginBottom: 48, letterSpacing: "0.02em" }}>
          EVERYTHING YOU NEED
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
          {features.map(f => (
            <div key={f.title} style={{ background: "#0d0d1a", border: "1px solid #1e2235", borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing preview */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 80px" }}>
        <h2 style={{ textAlign: "center", fontFamily: "'Barlow Condensed'", fontSize: 40, fontWeight: 900, color: "#fff", marginBottom: 12, letterSpacing: "0.02em" }}>SIMPLE PRICING</h2>
        <p style={{ textAlign: "center", color: "#64748b", marginBottom: 48, fontSize: 15 }}>Start free. Upgrade when you're ready.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
          {plans.map(p => (
            <div key={p.name} style={{ background: p.popular ? "#0f0f1f" : "#0d0d1a", border: `1px solid ${p.popular ? p.color + "60" : "#1e2235"}`, borderRadius: 16, padding: 28, position: "relative" }}>
              {p.popular && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: p.color, color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 14px", borderRadius: 20, letterSpacing: "0.08em" }}>MOST POPULAR</div>}
              <div style={{ fontSize: 14, fontWeight: 600, color: p.color, marginBottom: 8, letterSpacing: "0.06em" }}>{p.name.toUpperCase()}</div>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 44, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                {p.price}<span style={{ fontSize: 18, color: "#64748b" }}>{p.per}</span>
              </div>
              <div style={{ marginTop: 20, marginBottom: 24 }}>
                {p.features.map(f => (
                  <div key={f} style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: p.color }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <Link to="/signup" style={{ display: "block", textAlign: "center", background: p.popular ? p.color : "transparent", color: p.popular ? "#fff" : "#94a3b8", border: `1px solid ${p.popular ? p.color : "#1e2235"}`, textDecoration: "none", padding: "10px", borderRadius: 8, fontSize: 14, fontWeight: 700 }}>
                {p.name === "Free" ? "Get Started" : `Subscribe to ${p.name}`}
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #1e2235", padding: "32px 24px", textAlign: "center", color: "#334155", fontSize: 13 }}>
        <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 18, fontWeight: 800, color: "#475569", marginBottom: 8 }}>SPORTSINTEL</div>
        © 2026 SportsIntel. All rights reserved.
      </div>
    </div>
  );
}
