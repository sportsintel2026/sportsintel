import { Link } from "react-router-dom";

// Launch gate for the Quick Picks teaser. Flip to false to hide it from the homepage.
const SHOW_QUICKPICKS_TEASER = true;

export default function LandingPage() {
  // The depth — what actually powers the model
  const MODEL_INPUTS = [
    { icon: "📊", title: "Model Projections", desc: "Win probabilities and projected scoring built from real performance data, not gut feel" },
    { icon: "⚔️", title: "Matchup History", desc: "Head-to-head history that shows how the people involved have actually performed against each other" },
    { icon: "📈", title: "Recent Form", desc: "Who's hot and who's cold right now — because season averages hide what's happening lately" },
    { icon: "💰", title: "Live Market Lines", desc: "Real sportsbook odds from major books, compared head-to-head with our model" },
  ];

  const OUTPUTS = [
    { label: "Moneyline edges", desc: "Where our win probability disagrees with the market" },
    { label: "Totals O/U edges", desc: "Projected runs vs the posted over/under line" },
    { label: "Player props", desc: "Per-player probabilities built from matchup history, recent form, and situational context" },
  ];

  const COMPETITORS = [
    { name: "Picks Sites", price: "$20–$100+/mo", desc: "Sell you picks. No data, no reasoning.", highlight: false },
    { name: "Line-Shopping / Odds Tools", price: "$50–$200+/mo", desc: "Multi-book odds screens — and that's all.", highlight: false },
    { name: "ESPN+", price: "$10.99/mo", desc: "Scores only. No model, no edges.", highlight: false },
    { name: "WizePicks", price: "$7/mo", desc: "A real model, the data behind every number, AND every book's price in one screen.", highlight: true },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif", fontSize: 14 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .btn-red{background:#ef4444;color:#fff;border:none;border-radius:8px;padding:13px 28px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;text-decoration:none;display:inline-block}
        .btn-red:hover{background:#dc2626;transform:translateY(-1px);box-shadow:0 6px 20px #ef444435}
        .btn-outline{background:transparent;color:#94a3b8;border:1px solid #1e2235;border-radius:8px;padding:11px 22px;font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;text-decoration:none;display:inline-block}
        .btn-outline:hover{border-color:#334155;color:#e2e8f0}
        .card{background:#0a0a14;border:1px solid #1a1a2e;border-radius:12px;transition:all .2s}
        .card:hover{border-color:#252535;transform:translateY(-2px)}
        a{text-decoration:none}
      `}</style>

      {/* Nav */}
      <nav style={{ padding: "0 20px", background: "#080810", borderBottom: "1px solid #0f0f1a", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1D9E75", display: "inline-block", boxShadow: "0 0 6px #1D9E75", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.01em" }}>Wize<span style={{ color: "#1D9E75" }}>Picks</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link to="/pricing" style={{ fontSize: 13, color: "#64748b", padding: "6px 12px" }}>Pricing</Link>
            <Link to="/login" className="btn-outline" style={{ padding: "7px 16px", fontSize: 13 }}>Sign In</Link>
            <Link to="/signup" className="btn-red" style={{ padding: "7px 16px", fontSize: 13 }}>Sign Up Free</Link>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 20px" }}>

        {/* Hero — lead with the model depth */}
        <div style={{ padding: "64px 0 56px", animation: "fadeIn .6s ease" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#ef444415", border: "1px solid #ef444430", borderRadius: 20, padding: "5px 14px", marginBottom: 22, fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.06em" }}>
            🔥 A REAL MODEL, NOT JUST PICKS
          </div>
          <h1 style={{ fontSize: "clamp(32px,6vw,56px)", fontWeight: 900, color: "#fff", lineHeight: 1.08, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Your edge on<br />
            <span style={{ color: "#ef4444" }}>every game.</span>
          </h1>
          <p style={{ fontSize: 17, color: "#e2e8f0", maxWidth: 560, marginBottom: 12, lineHeight: 1.7, fontWeight: 700 }}>
            Model projections. Live odds. Every major sportsbook.
          </p>
          <p style={{ fontSize: 15, color: "#94a3b8", maxWidth: 520, marginBottom: 32, lineHeight: 1.8 }}>
            Find where our model disagrees with the market — and make smarter bets.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link to="/signup" className="btn-red" style={{ fontSize: 15, padding: "14px 32px" }}>Sign Up Free →</Link>
            <Link to="/pricing" className="btn-outline">See what's included</Link>
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 14 }}>No credit card required · Free account gets you started</div>

        </div>

        {/* Live Odds — line shopping (moved up: lead with the value) */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ marginBottom: 8, fontSize: 11, color: "#1D9E75", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>💲 Live Odds · every book, one screen</div>
          <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff", marginBottom: 8 }}>Shop every book. Take the best price. Every time.</h2>
          <p style={{ fontSize: 14, color: "#94a3b8", maxWidth: 580, marginBottom: 16, lineHeight: 1.8 }}>
            The same bet pays differently at different sportsbooks. We put <strong style={{ color: "#e2e8f0" }}>every major US book side by side</strong>, best price highlighted — so you always grab the better number, a real edge that has nothing to do with luck. And when one book hangs a line out of step with the rest, you'll see it sitting there.
          </p>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 580, marginBottom: 24, lineHeight: 1.8 }}>
            Other sites lock this behind a steep monthly fee. With us it's just part of the room.
          </p>
          <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: 18, maxWidth: 520 }}>
            <div style={{ fontSize: 10, color: "#475569", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Same bet · four books</div>
            {[["BetMGM", "−130", false], ["Caesars", "−128", false], ["DraftKings", "−125", false], ["FanDuel", "−120", true]].map(([book, price, best], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: i ? "1px solid #12121f" : "none" }}>
                <span style={{ fontSize: 13, color: best ? "#fff" : "#64748b", fontWeight: best ? 700 : 500 }}>{book}</span>
                <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", fontWeight: best ? 800 : 500, color: best ? "#1D9E75" : "#64748b", background: best ? "rgba(29,158,117,0.10)" : "transparent", borderRadius: 4, padding: best ? "2px 8px" : "2px 0" }}>{price}{best ? "  ✓ best" : ""}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 12, lineHeight: 1.7 }}>
              Same side, four prices. <strong style={{ color: "#1D9E75" }}>−120 pays more than −130</strong> on the identical bet. That difference, on every wager, compounds into real money.
            </div>
          </div>
        </div>

        {/* Don't bet blind — the pitch */}
        <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />
        <div style={{ marginBottom: 64, background: "linear-gradient(180deg, #0c1410 0%, #0a0a14 100%)", border: "1px solid #1D9E7530", borderRadius: 16, padding: "32px 26px" }}>
          <h2 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 900, color: "#fff", marginBottom: 16, letterSpacing: "-0.01em" }}>Don't bet blind.</h2>
          <p style={{ fontSize: 15, color: "#cbd5e1", maxWidth: 600, marginBottom: 14, lineHeight: 1.8 }}>
            Everyone wants winners. Smart bettors want winners <em style={{ color: "#fff", fontStyle: "normal", fontWeight: 700 }}>at the best price</em> — because price matters too.
          </p>
          <p style={{ fontSize: 14, color: "#94a3b8", maxWidth: 600, marginBottom: 14, lineHeight: 1.8 }}>
            We don't sell locks. We don't chase trends. We break down the full market, show you the reasoning behind every number, and put every book's price side by side so you can take the best one.
          </p>
          <p style={{ fontSize: 14, color: "#94a3b8", maxWidth: 600, marginBottom: 20, lineHeight: 1.8 }}>
            What you're really getting isn't a "🔥 LOCK OF THE DAY" with no explanation. It's the data, the matchup, and the market — so you decide with information instead of hope.
          </p>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#1D9E75", letterSpacing: "-0.01em" }}>Bet smarter. Bet Wize.</div>
        </div>

        <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />

        {/* Comparison */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Compare</div>
            <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff" }}>Why <span style={{ color: "#1D9E75" }}>WizePicks</span> is different</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {COMPETITORS.map((c, i) => (
              <div key={i} style={{ background: c.highlight ? "#ef44440a" : "#0a0a14", border: `1px solid ${c.highlight ? "#ef444430" : "#1a1a2e"}`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.highlight ? "#fff" : "#64748b", marginBottom: 3 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: c.highlight ? "#94a3b8" : "#334155" }}>{c.desc}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: c.highlight ? "#ef4444" : "#334155" }}>{c.price}</div>
                  {c.highlight && <div style={{ fontSize: 10, color: "#22c55e", fontWeight: 700, marginTop: 2 }}>BEST VALUE ✓</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {SHOW_QUICKPICKS_TEASER && (
          <>
            <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />
            <div style={{ marginBottom: 56 }}>
              <div style={{ marginBottom: 8, fontSize: 11, color: "#1D9E75", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>New · Subscriber feature</div>
              <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff", marginBottom: 8 }}>🎲 Quick Picks — straight bets & parlays, built for you</h2>
              <p style={{ fontSize: 14, color: "#64748b", maxWidth: 560, marginBottom: 24, lineHeight: 1.8 }}>
                Members get more than the board. Our Quick Picks feature generates a ready-to-play straight bet <em>and</em> a parlay every day — built automatically from the model's best edges across MLB and NBA. No digging required.
              </p>
              <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 16, padding: 24, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: "1 1 300px" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Straight bets and parlays, done for you</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, maxWidth: 400 }}>Subscribe and the model hands you a daily single pick and a small parlay, pulled from its top value edges. Pick a sport or mix them — the fastest way to get a model-backed play. Members only.</div>
                </div>
                <Link to="/signup" className="btn-red" style={{ fontSize: 14, padding: "13px 28px", whiteSpace: "nowrap" }}>Sign up to unlock →</Link>
              </div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 12 }}>Model-built, not guaranteed. For entertainment. 21+. Bet responsibly.</div>
            </div>
          </>
        )}

        <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />

        {/* The model inputs — the depth */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ marginBottom: 8, fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>What goes into every number</div>
          <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff", marginBottom: 8 }}>The model sees what box scores miss</h2>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 560, marginBottom: 28, lineHeight: 1.8 }}>
            Anyone can show you a season stat line. We fold the context that actually moves games into every projection:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
            {MODEL_INPUTS.map((f, i) => (
              <div key={i} className="card" style={{ padding: 18 }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 5 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />

        {/* What you get out — the outputs */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ marginBottom: 8, fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>What you see</div>
          <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff", marginBottom: 28 }}>Three kinds of edges, every day</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 28 }}>
            {OUTPUTS.map((o, i) => (
              <div key={i} style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: "#ef4444", marginBottom: 8 }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{o.label}</div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>{o.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
              <strong style={{ color: "#e2e8f0" }}>Click into any game</strong> for the full breakdown — model win probability vs the market, projected scoring vs the line, the key matchups, and <strong style={{ color: "#e2e8f0" }}>head-to-head history</strong> showing how the people involved have actually performed against each other.
            </div>
          </div>
        </div>

        {/* Responsible play note — also helps with payment processor trust */}
        <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "16px 18px", marginBottom: 56, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
          WizePicks provides <strong style={{ color: "#64748b" }}>sports data and statistical analysis for informational purposes only</strong>. We are not a sportsbook and do not accept wagers. There is no such thing as a guaranteed pick. Please bet responsibly and within your means. If gambling is a problem for you, call 1-800-GAMBLER.
        </div>

        {/* Final CTA */}
        <div style={{ background: "linear-gradient(135deg,#0f0f1f,#0a0a14)", border: "1px solid #ef444430", borderRadius: 16, padding: "48px 32px", textAlign: "center", marginBottom: 64 }}>
          <h2 style={{ fontSize: "clamp(22px,4vw,36px)", fontWeight: 800, color: "#fff", marginBottom: 12 }}>
            Start with a free account
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 420, margin: "0 auto 28px", lineHeight: 1.8 }}>
            See today's games, the model, and a preview of the edges. Upgrade to all-access for $7/month whenever you're ready.
          </p>
          <Link to="/signup" className="btn-red" style={{ fontSize: 15, padding: "14px 36px" }}>
            Sign Up Free →
          </Link>
          <div style={{ fontSize: 11, color: "#334155", marginTop: 12 }}>No credit card required · Upgrade anytime · Cancel anytime</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #0f0f1a", padding: "20px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1e2235" }}>WizePicks</span>
          <div style={{ display: "flex", gap: 16 }}>
            <Link to="/pricing" style={{ fontSize: 12, color: "#334155" }}>Pricing</Link>
            <Link to="/login" style={{ fontSize: 12, color: "#334155" }}>Sign In</Link>
            <Link to="/signup" style={{ fontSize: 12, color: "#334155" }}>Sign Up</Link>
          </div>
          <span style={{ fontSize: 11, color: "#1e2235" }}>© 2026 WizePicks</span>
        </div>
      </div>
    </div>
  );
}
