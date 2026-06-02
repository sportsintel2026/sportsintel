import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";

function formatOdds(a) {
  if (a == null) return "—";
  return a > 0 ? `+${a}` : `${a}`;
}
function pct(x) { return x != null ? `${(x * 100).toFixed(1)}%` : "—"; }
function signedPct(x) { return x != null ? `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—"; }

const RESULT_STYLE = {
  win: { label: "WON", color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "#22c55e44" },
  loss: { label: "LOST", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "#ef444444" },
  pending: { label: "PENDING", color: "#9ca3af", bg: "#0a0e14", border: "#1f2937" },
};
function ResultBadge({ result }) {
  const s = RESULT_STYLE[result] || RESULT_STYLE.pending;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 5, padding: "2px 7px" }}>{s.label}</span>
  );
}

export default function DailyCardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [card, setCard] = useState(null);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setError(false);
    Promise.all([
      fetch(`${API_BASE}/api/daily-card`).then(r => { if (!r.ok) throw new Error("bad"); return r.json(); }),
      fetch(`${API_BASE}/api/daily-card/record`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([c, rec]) => { setCard(c); setRecord(rec); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

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
          .dc-content{padding:16px 14px 60px!important}
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
        <div className="dc-content" style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>🎲 Today's Card</h1>
          <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
            One model-built pick and parlay, locked once a day. Pulled only from the model's value edges — never random.
          </p>
          {loading && <Loader />}
          {error && !loading && <ErrorState />}
          {!loading && !error && !hasFullAccess && <LockedState navigate={navigate} record={record} />}
          {!loading && !error && hasFullAccess && card && (
            <CardBody card={card} record={record} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
}

function CardBody({ card, record, navigate }) {
  if (card.notReady || (!card.single && !card.parlay)) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Today's card isn't ready yet</div>
        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.5 }}>The model locks the card once the day's lines and value edges are in. Check back a little later — it usually posts once the slate firms up.</div>
      </div>
    );
  }
  return (
    <>
      {record && <RecordStrip record={record} />}
      {card.single && <SinglePick single={card.single} result={card.single_result} navigate={navigate} />}
      {card.parlay && <ParlayCard parlay={card.parlay} result={card.parlay_result} navigate={navigate} />}
      <div style={{ marginTop: 16, fontSize: 11, color: "#6b7280", lineHeight: 1.6, textAlign: "center" }}>
        Every leg comes from the model's value edges — never random. Parlays multiply variance, so size them small. For entertainment; bet responsibly. 21+. 1-800-GAMBLER.
      </div>
    </>
  );
}

function SinglePick({ single, result, navigate }) {
  const go = () => single.gameId && navigate(`/game/mlb/${single.gameId}`);
  return (
    <div onClick={go} style={{ background: "#0f1419", border: "1px solid #22c55e30", borderRadius: 12, padding: 18, marginBottom: 12, cursor: single.gameId ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "#1D9E75", fontWeight: 700, textTransform: "uppercase" }}>★ Pick of the day</span>
        <ResultBadge result={result} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>{single.description} <span style={{ color: "#9ca3af", fontWeight: 700 }}>{formatOdds(single.odds)}</span></div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{single.matchup}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#22c55e" }}>{signedPct(single.edge)}</div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>edge</div>
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a1f28", fontSize: 11, color: "#6b7280" }}>
        Model: <span style={{ color: "#e4e7eb", fontWeight: 600 }}>{pct(single.modelProb)}</span> · {single.confidence} confidence
      </div>
    </div>
  );
}

function ParlayCard({ parlay, result, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>🎟️ Model parlay · {(parlay.legs || []).length} legs</span>
        <ResultBadge result={result} />
      </div>
      {(parlay.legs || []).map((leg, i) => (
        <div key={i} onClick={() => leg.gameId && navigate(`/game/mlb/${leg.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < parlay.legs.length - 1 ? "1px solid #1a1f28" : "none", cursor: leg.gameId ? "pointer" : "default" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{leg.description} <span style={{ color: "#9ca3af", fontWeight: 600 }}>{formatOdds(leg.odds)}</span></div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{leg.matchup}</div>
          </div>
          <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>{signedPct(leg.edge)}</span>
        </div>
      ))}
      <div style={{ background: parlay.edge > 0 ? "#0a1f15" : "#0a0e14", border: `1px solid ${parlay.edge > 0 ? "#22c55e30" : "#1f2937"}`, borderRadius: 10, padding: 14, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>PARLAY PAYS</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: parlay.edge > 0 ? "#22c55e" : "#e4e7eb" }}>{formatOdds(parlay.bookOdds)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Model fair value</span>
          <span style={{ fontSize: 12, color: "#e4e7eb", fontWeight: 700 }}>
            {formatOdds(parlay.fairOdds)}
            <span style={{ color: parlay.edge > 0 ? "#22c55e" : "#9ca3af", fontWeight: 600 }}> · {parlay.edge > 0 ? `+EV ${signedPct(parlay.edge)}` : "no value vs the book"}</span>
          </span>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>
        "Pays" is the book's payout; "fair value" is what the model thinks it's truly worth. When the payout beats fair value, the parlay carries a model edge — but it still wins less than half the time. High variance by nature.
      </div>
    </div>
  );
}

function RecordStrip({ record }) {
  const s = record.single || {};
  const p = record.parlay || {};
  const box = (title, r, note) => (
    <div style={{ flex: 1, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{title}</div>
      {r.settled > 0 ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{r.wins}-{r.losses}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: r.roi > 0 ? "#22c55e" : r.roi < 0 ? "#ef4444" : "#9ca3af" }}>
            {r.roi != null ? `${r.roi > 0 ? "+" : ""}${(r.roi * 100).toFixed(1)}% ROI` : ""}
          </div>
          {note && <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>{note}</div>}
        </>
      ) : (
        <div style={{ fontSize: 12, color: "#6b7280" }}>No settled cards yet</div>
      )}
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
      {box("Pick of the day", s)}
      {box("Model parlay", p, "high variance")}
    </div>
  );
}

function LockedState({ navigate, record }) {
  const s = record?.single;
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center" }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🎲</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Unlock Today's Card</div>
      <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6, marginBottom: 18, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
        Every day the model locks one value pick and a small parlay — pulled only from its best edges, with the honest fair-vs-book math shown. Subscribers get it daily.
      </div>
      {s && s.settled > 0 && s.roi != null && (
        <div style={{ display: "inline-block", background: "#0a1f15", border: "1px solid #22c55e30", borderRadius: 8, padding: "8px 14px", marginBottom: 18 }}>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Pick of the day so far: </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{s.wins}-{s.losses}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: s.roi > 0 ? "#22c55e" : "#ef4444" }}> · {s.roi > 0 ? "+" : ""}{(s.roi * 100).toFixed(1)}% ROI</span>
        </div>
      )}
      <div>
        <button onClick={() => navigate("/pricing")} style={{ background: "#1D9E75", border: "none", borderRadius: 10, padding: "12px 28px", color: "#04342C", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          Subscribe to unlock
        </button>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid #1e2235", borderTopColor: "#1D9E75", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ color: "#6b7280", fontSize: 13 }}>Loading today's card...</div>
    </div>
  );
}
function ErrorState() {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
      Couldn't load today's card right now. Please try again in a moment.
    </div>
  );
}
