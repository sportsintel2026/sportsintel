import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "../lib/api";

export default function LandingPage() {
  const [picks, setPicks] = useState([]);

  useEffect(() => {
    const loadPicks = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data } = await supabase
          .from("daily_picks")
          .select("*")
          .eq("date", today)
          .maybeSingle();
        if (data?.picks) setPicks(JSON.parse(data.picks));
      } catch (e) {}
    };
    loadPicks();
  }, []);

  // The depth — what actually powers the model
  const MODEL_INPUTS = [
    { icon: "📊", title: "Model Projections", desc: "Win probabilities and projected scoring built from real performance data, not gut feel" },
    { icon: "⚔️", title: "Matchup History", desc: "Head-to-head history that shows how the people involved have actually performed against each other" },
    { icon: "📈", title: "Recent Form", desc: "Who's hot and who's cold right now — because season averages hide what's happening lately" },
    { icon: "🌤", title: "Situational Factors", desc: "Conditions, venue, and context that the raw stat line leaves out but that quietly move games" },
    { icon: "🎯", title: "Key Performer Profiles", desc: "The rate stats that actually predict outcomes for the players who decide games" },
    { icon: "💰", title: "Live Market Lines", desc: "Real sportsbook odds from major books, compared head-to-head with our model" },
  ];

  const OUTPUTS = [
    { label: "Moneyline edges", desc: "Where our win probability disagrees with the market" },
    { label: "Total run edges", desc: "Projected runs vs the posted over/under line" },
    { label: "Player props", desc: "Per-player probabilities built from matchup history, recent form, and situational context" },
  ];

  const COMPETITORS = [
    { name: "Picks Sites", price: "$20–$100+/mo", desc: "Sell you picks. No data, no reasoning.", highlight: false },
    { name: "ESPN+", price: "$10.99/mo", desc: "Scores only. No model, no edges.", highlight: false },
    { name: "Edge the Lines", price: "$7/mo", desc: "A real model + the data behind every number.", highlight: true },
  ];

  // Sample cards for the blurred "look inside" preview — fake but realistic data,
  // so nothing real leaks and it renders even when no games are live.
  const PREVIEW_ML = [
    { matchup: "DET @ CWS", team: "CWS ML", odds: "+110", model: "52%", edge: "+6.2%", conf: "HIGH" },
    { matchup: "NYY @ ATH", team: "ATH ML", odds: "+128", model: "48%", edge: "+5.3%", conf: "MEDIUM" },
    { matchup: "MIL @ HOU", team: "HOU ML", odds: "-105", model: "54%", edge: "+3.8%", conf: "MEDIUM" },
  ];
  const PREVIEW_TOTALS = [
    { matchup: "ATL @ CIN", side: "Over 9.5", odds: "-110", proj: "10.9", edge: "+8.1%" },
    { matchup: "MIN @ PIT", side: "Over 8.5", odds: "-118", proj: "9.4", edge: "+7.0%" },
    { matchup: "LAA @ TB", side: "Over 7", odds: "-110", proj: "8.1", edge: "+5.7%" },
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
        .preview-blur{filter:blur(5px);-webkit-filter:blur(5px);user-select:none;pointer-events:none}
        @media (max-width:680px){.preview-grid{grid-template-columns:1fr!important}}
      `}</style>

      {/* Nav */}
      <nav style={{ padding: "0 20px", background: "#080810", borderBottom: "1px solid #0f0f1a", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 30 30" aria-hidden="true" style={{ flexShrink: 0 }}>
              <line x1="4" y1="21" x2="11" y2="21" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" />
              <line x1="13" y1="15" x2="20" y2="15" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" />
              <line x1="22" y1="9" x2="26" y2="9" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "0.01em" }}>Edge<span style={{ color: "#1D9E75" }}>the</span>Lines</span>
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
          <p style={{ fontSize: 16, color: "#94a3b8", maxWidth: 540, marginBottom: 14, lineHeight: 1.8 }}>
            Edge the Lines runs a research-grade model that folds in <strong style={{ color: "#e2e8f0" }}>live conditions, matchup history, recent form, and situational factors</strong> — then compares it against real sportsbook lines to surface where the market is wrong.
          </p>
          <p style={{ fontSize: 15, color: "#64748b", maxWidth: 520, marginBottom: 32, lineHeight: 1.8 }}>
            You don't buy picks here. You get the <strong style={{ color: "#e2e8f0" }}>same depth of data the pros use</strong> to make your own — for <strong style={{ color: "#ef4444" }}>$7/month</strong>.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Link to="/signup" className="btn-red" style={{ fontSize: 15, padding: "14px 32px" }}>Sign Up Free →</Link>
            <Link to="/pricing" className="btn-outline">See what's included</Link>
          </div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 14 }}>No credit card required · Free account gets you started</div>

        </div>

        {/* ── A LOOK INSIDE — blurred product preview ──────────────────────────── */}
        <div style={{ marginBottom: 56 }}>
          <div style={{ marginBottom: 8, fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>A look inside</div>
          <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff", marginBottom: 8 }}>This is what you'll see every day</h2>
          <p style={{ fontSize: 14, color: "#64748b", maxWidth: 560, marginBottom: 24, lineHeight: 1.8 }}>
            Real edges, ranked by how far our model disagrees with the market. Here's a peek — sign up free to see today's live board.
          </p>

          <div style={{ position: "relative", border: "1px solid #1a1a2e", borderRadius: 16, overflow: "hidden", background: "#0a0a14" }}>
            {/* The blurred mock board */}
            <div className="preview-blur" aria-hidden="true" style={{ padding: 18 }}>
              <div className="preview-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* Moneyline column */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em" }}>💰 TOP MONEYLINE EDGES</span>
                    <span style={{ fontSize: 10, color: "#475569" }}>10 found</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {PREVIEW_ML.map((g, i) => (
                      <div key={i} style={{ background: "#08081a", border: "1px solid #1a1a2e", borderRadius: 8, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{g.team}</div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{g.matchup} · {g.odds} · {g.model} model</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e" }}>{g.edge}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Totals column */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em" }}>📊 TOP TOTALS EDGES</span>
                    <span style={{ fontSize: 10, color: "#475569" }}>10 found</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {PREVIEW_TOTALS.map((g, i) => (
                      <div key={i} style={{ background: "#08081a", border: "1px solid #1a1a2e", borderRadius: 8, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{g.side}</div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{g.matchup} · {g.odds} · proj {g.proj}</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#22c55e" }}>{g.edge}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* analysis strip */}
              <div style={{ marginTop: 14, background: "#08081a", border: "1px solid #1a1a2e", borderRadius: 8, padding: "12px 14px", display: "flex", gap: 18, flexWrap: "wrap" }}>
                <div><div style={{ fontSize: 10, color: "#475569" }}>MODEL WIN %</div><div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0" }}>54.2%</div></div>
                <div><div style={{ fontSize: 10, color: "#475569" }}>MARKET IMPLIED</div><div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0" }}>48.0%</div></div>
                <div><div style={{ fontSize: 10, color: "#475569" }}>PROJECTED RUNS</div><div style={{ fontSize: 15, fontWeight: 800, color: "#e2e8f0" }}>9.4</div></div>
                <div><div style={{ fontSize: 10, color: "#475569" }}>BEAT THE CLOSE</div><div style={{ fontSize: 15, fontWeight: 800, color: "#22c55e" }}>🎯 tracked</div></div>
              </div>
            </div>

            {/* Frosted overlay + CTA */}
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, background: "radial-gradient(circle at center, #08081070 0%, #080810b0 100%)" }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>🔒</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Today's full board is one click away</div>
              <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 360, marginBottom: 18, lineHeight: 1.7 }}>
                Sign up free to see every edge, ranked and updated all day — plus the full breakdown behind each number.
              </div>
              <Link to="/signup" className="btn-red" style={{ fontSize: 14, padding: "12px 28px" }}>Sign up free to see today's edges →</Link>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 12 }}>No credit card required</div>
            </div>
          </div>
        </div>

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

        {/* Daily picks preview (only if picks exist) */}
        {picks.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />
            <div style={{ marginBottom: 64 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>🎯 Editorial best bets</div>
                  <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff" }}>Today's analyst picks</h2>
                </div>
                <Link to="/signup" style={{ fontSize: 12, color: "#475569", border: "1px solid #1a1a2e", borderRadius: 8, padding: "6px 14px" }}>Full analysis inside →</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {picks.map((p, i) => (
                  <div key={i} style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: 18, position: "relative", overflow: "hidden" }}>
                    {i > 0 && (
                      <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(8px)", background: "#08081085", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12 }}>
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 18, marginBottom: 6 }}>🔒</div>
                          <Link to="/signup" style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>Sign up to unlock →</Link>
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#475569", marginBottom: 5, fontWeight: 500 }}>
                          {p.league === "MLB" ? "⚾" : p.league === "NBA" ? "🏀" : p.league === "NFL" ? "🏈" : p.league === "NHL" ? "🏒" : p.league === "Soccer" ? "⚽" : p.league === "MMA" ? "🥊" : "⛳"} {p.league} · {p.game}
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 5 }}>
                          {p.pick} <span style={{ fontSize: 13, color: "#64748b", fontWeight: 400 }}>{p.odds}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>{p.analysis}</div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <span style={{ background: p.confidence === "HIGH" ? "#22c55e15" : p.confidence === "MEDIUM" ? "#f59e0b15" : "#ef444415", border: `1px solid ${p.confidence === "HIGH" ? "#22c55e30" : p.confidence === "MEDIUM" ? "#f59e0b30" : "#ef444430"}`, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, color: p.confidence === "HIGH" ? "#22c55e" : p.confidence === "MEDIUM" ? "#f59e0b" : "#ef4444" }}>
                          {p.confidence}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ borderTop: "1px solid #0f0f1a", marginBottom: 56 }} />

        {/* Comparison */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Compare</div>
            <h2 style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 800, color: "#fff" }}>Why Edge<span style={{ color: "#1D9E75" }}> the </span>Lines is different</h2>
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

        {/* Responsible play note — also helps with payment processor trust */}
        <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "16px 18px", marginBottom: 56, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
          Edge the Lines provides <strong style={{ color: "#64748b" }}>sports data and statistical analysis for informational purposes only</strong>. We are not a sportsbook and do not accept wagers. There is no such thing as a guaranteed pick. Please bet responsibly and within your means. If gambling is a problem for you, call 1-800-GAMBLER.
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
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1e2235" }}>Edge<span style={{ color: "#1D9E75" }}> the </span>Lines</span>
          <div style={{ display: "flex", gap: 16 }}>
            <Link to="/pricing" style={{ fontSize: 12, color: "#334155" }}>Pricing</Link>
            <Link to="/login" style={{ fontSize: 12, color: "#334155" }}>Sign In</Link>
            <Link to="/signup" style={{ fontSize: 12, color: "#334155" }}>Sign Up</Link>
          </div>
          <span style={{ fontSize: 11, color: "#1e2235" }}>© 2026 Edge the Lines</span>
        </div>
      </div>
    </div>
  );
}
