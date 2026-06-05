import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
export default function PerformancePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [league, setLeague] = useState("mlb");
  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setError(false); setData(null);
    fetch(`${API_BASE}/api/performance/${league}`)
      .then(r => { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [league]);
  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
          .perf-grid{grid-template-columns:1fr!important}
          .perf-content{padding:16px 14px 60px!important}
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
        <div className="perf-content" style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>📈 Model Performance</h1>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#9ca3af" }}>
            How the model's edges have actually performed · each sport tracked separately
          </p>
          <SportTabs league={league} setLeague={setLeague} />
          {loading && <Loader />}
          {error && !loading && <ErrorState />}
          {!loading && !error && data && <PerfBody data={data} league={league} />}
        </div>
      </div>
    </div>
  );
}
const SPORTS = [
  { key: "mlb", label: "MLB", icon: "⚾" },
  { key: "nba", label: "NBA", icon: "🏀" },
  { key: "nfl", label: "NFL", icon: "🏈" },
  { key: "cfb", label: "CFB", icon: "🎓" },
];
function SportTabs({ league, setLeague }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
      {SPORTS.map(s => {
        const active = s.key === league;
        return (
          <button key={s.key} onClick={() => setLeague(s.key)} style={{ display: "flex", alignItems: "center", gap: 6, background: active ? "#ef4444" : "#0f1419", color: active ? "#fff" : "#9ca3af", border: `1px solid ${active ? "#ef4444" : "#1f2937"}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>
            <span>{s.icon}</span>{s.label}
          </button>
        );
      })}
    </div>
  );
}
function PerfBody({ data, league }) {
  const graded = data.totalGraded || 0;
  const pending = data.pendingCount || 0;
  const full = data.fullSample || null;
  const excluded = data.filter?.excludedCount || 0;
  if (graded === 0) {
    return (
      <div>
        <ClvCard clv={data.clv} />
        <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Building the track record</div>
          <p style={{ fontSize: 13, color: "#9ca3af", maxWidth: 420, margin: "0 auto", lineHeight: 1.7 }}>
            The model is recording its predictions now. Once today's games finish, results start posting here.
            {pending > 0 && ` ${pending} prediction${pending === 1 ? "" : "s"} currently tracking.`}
          </p>
          <div style={{ marginTop: 20, fontSize: 11, color: "#6b7280" }}>
            A meaningful sample takes a few weeks. Every day adds data.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div>
      {/* Disclaimer */}
      <div style={{ background: "#1a1410", border: "1px solid #f5970022", borderLeft: "3px solid #f59700", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#fbbf24" }}>
        <strong>Qualified picks.</strong> <span style={{ color: "#a8915c" }}>
          Showing the model's {graded} graded higher-conviction play{graded === 1 ? "" : "s"}
          {(excluded > 0 || pending > 0)
            ? ` (${excluded > 0 ? `${excluded} low-conviction set aside` : ""}${excluded > 0 && pending > 0 ? "; " : ""}${pending > 0 ? `${pending} more still pending` : ""})`
            : ""}
          {full && full.overall && full.overall.total
            ? ` · full sample: ${full.overall.wins}-${full.overall.losses}, ${full.overall.winPct}% win`
            : ""}. Small samples are noisy — a few weeks of data is where this gets meaningful.
        </span>
      </div>
      {graded > 0 && graded < 25 && (
        <div style={{ background: "#1a1410", border: "1px solid #f5970022", borderRadius: 6, padding: "8px 12px", marginBottom: 16, fontSize: 11.5, color: "#fbbf24" }}>
          ⚠️ Very early sample ({graded} graded pick{graded === 1 ? "" : "s"}) — treat these as noise, not a track record yet.
        </div>
      )}
      {/* CLV — led as the most reliable signal of edge */}
      <ClvCard clv={data.clv} />
      {/* Overall record — ROI demoted + contextualized, shown below CLV */}
      <OverallCard o={data.overall} />
      {/* By market */}
      <SectionTitle>By market</SectionTitle>
      <div className="perf-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        {Object.entries(data.byMarket || {}).map(([market, b]) => (
          <StatCard key={market} label={marketLabel(market)} b={b} />
        ))}
      </div>
      {/* Props — its OWN table; never part of the core record or CLV */}
      <SectionTitle>{league === "mlb" ? "🔥 Home run props" : "🎯 Player props"}</SectionTitle>
      <PropsCard p={data.props || data.hrProps} league={league} />
      {/* By confidence */}
      <SectionTitle>By confidence tier</SectionTitle>
      <div className="perf-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {["HIGH", "MEDIUM", "LOW", "NEUTRAL"]
          .filter(c => data.byConfidence?.[c])
          .map(c => <StatCard key={c} label={c} b={data.byConfidence[c]} accent={confColor(c)} />)}
      </div>
    </div>
  );
}
function ClvCard({ clv }) {
  // No CLV data yet (closing lines accumulate going forward only).
  if (!clv || !clv.sample) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 10 }}>🎯 Closing line value (CLV)</div>
        <p style={{ fontSize: 12.5, color: "#9ca3af", lineHeight: 1.7, margin: 0 }}>
          CLV measures whether our picks got a better price than the market's closing line — the single strongest
          indicator of a real edge. It's collecting now and will appear here once games with tracked picks have started.
        </p>
      </div>
    );
  }
  const positive = clv.avgClvPct >= 0;
  return (
    <div style={{ background: "linear-gradient(180deg,#0f1419,#0a0e14)", border: "1px solid #22c55e33", borderLeft: "3px solid #22c55e", borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>🎯 Closing line value (CLV)</div>
      <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 600, marginBottom: 16 }}>Our most reliable early signal of edge</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
        <Metric
          label="Beat the close"
          value={`${clv.beatClosePct}%`}
          color={clv.beatClosePct >= 50 ? "#22c55e" : "#e4e7eb"}
        />
        <Metric
          label="Avg CLV"
          value={`${positive ? "+" : ""}${clv.avgClvPct}%`}
          color={positive ? "#22c55e" : "#ef4444"}
        />
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        Across {clv.sample} qualified pick{clv.sample === 1 ? "" : "s"} with a captured closing line. CLV is how much
        better our price was than the market's close — consistently positive CLV is the best early sign of genuine edge,
        even before win/loss results stabilize. Small samples are still noisy.
      </div>
    </div>
  );
}
function OverallCard({ o }) {
  if (!o || o.total === 0) return null;
  const profit = o.units >= 0;
  // When the win rate sits below the -110 break-even line yet ROI is still
  // positive, it's because the model's winners skew toward plus-money underdogs
  // (a +150 winner pays more than a -150 winner costs). Surface that so the
  // pairing doesn't read as a contradiction to a sharp eye.
  const belowBreakeven = o.winPct != null && o.winPct < 52.4;
  const showUnderdogNote = belowBreakeven && profit;
  return (
    <div style={{ background: "linear-gradient(180deg,#0f1419,#0a0e14)", border: "1px solid #1f2937", borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", marginBottom: 16 }}>Overall record</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
        <Metric label="Record" value={`${o.wins}-${o.losses}`} />
        <Metric label="Win %" value={o.winPct != null ? `${o.winPct}%` : "—"} color={o.winPct >= 52.4 ? "#22c55e" : "#e4e7eb"} />
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>ROI</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: profit ? "#22c55e" : "#ef4444", lineHeight: 1 }}>{o.roi != null ? `${profit ? "+" : ""}${o.roi}%` : "—"}</div>
          <div style={{ fontSize: 9.5, color: "#a8915c", marginTop: 5, fontWeight: 600, letterSpacing: "0.02em" }}>early sample · expect regression</div>
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        Win % above ~52.4% is the break-even line for standard -110 odds. ROI assumes 1 unit per play
        {showUnderdogNote ? " — it reads positive despite a sub-break-even win rate because the model's winners skew toward plus-money underdogs, which pay out more than they cost" : ""}.
        {o.total != null ? ` Over ${o.total} play${o.total === 1 ? "" : "s"}, ROI is still volatile — closing-line value above is the steadier read on real edge.` : ""}
      </div>
    </div>
  );
}
function StatCard({ label, b, accent }) {
  if (!b || b.total === 0) return null;
  const profit = b.units >= 0;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent || "#e4e7eb", marginBottom: 12 }}>{label}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>Record</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{b.wins}-{b.losses}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>Win %</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: b.winPct >= 52.4 ? "#22c55e" : "#e4e7eb" }}>{b.winPct != null ? `${b.winPct}%` : "—"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#6b7280" }}>ROI</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: profit ? "#22c55e" : "#ef4444" }}>{b.roi != null ? `${profit ? "+" : ""}${b.roi}%` : "—"}</span>
      </div>
    </div>
  );
}
function PropsCard({ p, league }) {
  if (!p || !p.picks) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 20, marginBottom: 24, fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
        Tracking the model's {(p && p.label ? p.label.toLowerCase() : "prop")} picks. Hit rate and ROI post here once props have been graded.
      </div>
    );
  }
  const profit = p.roi >= 0;
  const fmtOdds = p.avgOdds == null ? "—" : (p.avgOdds > 0 ? `+${p.avgOdds}` : `${p.avgOdds}`);
  const isMlb = league === "mlb";
  const labelLc = (p.label || "prop").toLowerCase();
  return (
    <div style={{ background: "linear-gradient(180deg,#1a1410,#0f1419)", border: "1px solid #f5970033", borderLeft: "3px solid #f59700", borderRadius: 12, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
        <Metric label="Hit rate" value={`${p.hitRatePct}%`} color="#fbbf24" />
        <Metric label="Hit / Missed" value={`${p.hits}-${p.misses}`} />
        <div>
          <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>ROI</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: profit ? "#22c55e" : "#ef4444", lineHeight: 1 }}>{`${profit ? "+" : ""}${p.roi}%`}</div>
          <div style={{ fontSize: 9.5, color: "#a8915c", marginTop: 5, fontWeight: 600 }}>avg odds {fmtOdds}</div>
        </div>
      </div>
      {p.byMarket && Object.keys(p.byMarket).length >= 2 && (
        <div style={{ marginTop: 18, borderTop: "1px solid #f5970022", paddingTop: 14 }}>
          <div style={{ fontSize: 10, color: "#a8915c", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>By prop type</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 8, fontSize: 9.5, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, paddingBottom: 6 }}>
            <span>Stat</span><span style={{ textAlign: "right" }}>Hit / Miss</span><span style={{ textAlign: "right" }}>Hit %</span><span style={{ textAlign: "right" }}>ROI</span>
          </div>
          {Object.entries(p.byMarket).map(([mkt, b]) => {
            const bp = b.roi >= 0;
            return (
              <div key={mkt} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 8, alignItems: "center", padding: "7px 0", borderTop: "1px solid #ffffff08", fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{marketLabel(mkt)}</span>
                <span style={{ textAlign: "right", color: "#9ca3af" }}>{b.hits}-{b.misses}</span>
                <span style={{ textAlign: "right", color: "#fbbf24", fontWeight: 600 }}>{b.hitRatePct}%</span>
                <span style={{ textAlign: "right", color: bp ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{`${bp ? "+" : ""}${b.roi}%`}</span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 14, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        Across {p.picks} graded {labelLc} pick{p.picks === 1 ? "" : "s"}.
        {isMlb
          ? " Home-run props are longshots, so a low hit rate is normal — at plus-money odds, hitting even a fraction can be profitable. ROI is the truer measure than hit rate."
          : " Props are longshots — ROI is the truer measure than hit rate."}
        {" Small samples are noisy."}
        {p.byMarket && Object.keys(p.byMarket).length >= 2 ? " Each stat type is a tiny sample on its own — the per-type rows are directional at best until volume builds." : ""}
      </div>
    </div>
  );
}
function Metric({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || "#e4e7eb", lineHeight: 1 }}>{value}</div>
    </div>
  );
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>{children}</div>;
}
function marketLabel(m) {
  const map = {
    moneyline: "Moneyline", total: "Totals", run_line: "Run line", spread: "Spread",
    hr_prop: "HR props", player_points: "Points", player_rebounds: "Rebounds",
    player_assists: "Assists", player_threes: "3PT made", player_props: "Player props",
  };
  return map[m] || m;
}
function confColor(c) {
  return c === "HIGH" ? "#22c55e" : c === "MEDIUM" ? "#f59e0b" : "#9ca3af";
}
function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 30, height: 30, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading track record...</div>
    </div>
  );
}
function ErrorState() {
  return (
    <div style={{ textAlign: "center", padding: 48, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10 }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Couldn't load performance</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>The tracker may still be warming up. Check back shortly.</div>
    </div>
  );
}
