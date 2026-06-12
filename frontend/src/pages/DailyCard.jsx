import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

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
  const [howOpen, setHowOpen] = useState(false);
  const [scope, setScope] = useState("mix");

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setError(false);
    Promise.all([
      fetch(`${API_BASE}/api/daily-card?scope=${scope}`).then(r => { if (!r.ok) throw new Error("bad"); return r.json(); }),
      fetch(`${API_BASE}/api/daily-card/record?scope=${scope}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([c, rec]) => { setCard(c); setRecord(rec); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [scope]);

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
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#ef4444" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>
      <div className="main-content" style={{ marginLeft: 200 }}>
        <div className="dc-content" style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>🎰 Quick Spin</h1>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#9ca3af" }}>
            One model-built pick and parlay, locked once a day. Pulled only from the model's value edges — never random.
          </p>
          <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
            <p style={{ margin: "0 0 10px" }}>Short on time? Give the wheel a spin to surface the model's value plays instantly.</p>
            <p style={{ margin: "0 0 10px" }}>Built for convenience and a little fun — not a replacement for the full WizePicks research process.</p>
            <p style={{ margin: 0, color: "#e4e7eb", fontWeight: 700 }}>
              The real edge still lives in{" "}
              <span onClick={() => navigate("/dashboard")} style={{ color: "#1D9E75", cursor: "pointer" }}>Today's Edges →</span>
            </p>
          </div>
          <HowToUse open={howOpen} onToggle={() => setHowOpen(o => !o)} />
          <ScopeTabs scope={scope} onChange={setScope} />
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

function ScopeTabs({ scope, onChange }) {
  const tabs = [
    { id: "mix", label: "🎲 Mix" },
    { id: "mlb", label: "⚾ MLB" },
    { id: "nba", label: "🏀 NBA" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#0f1419", border: "1px solid #1f2937", borderRadius: 10, padding: 4 }}>
      {tabs.map(t => {
        const active = scope === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{ flex: 1, background: active ? "#1D9E75" : "transparent", border: "none", borderRadius: 7, padding: "8px 6px", color: active ? "#04342C" : "#9ca3af", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", transition: "background .12s" }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function HowToUse({ open, onToggle }) {
  const row = (label, text) => (
    <div style={{ marginBottom: 10 }}>
      <span style={{ color: "#1D9E75", fontWeight: 700 }}>{label}</span>
      <span style={{ color: "#9ca3af" }}> — {text}</span>
    </div>
  );
  return (
    <div style={{ border: "1px solid #1f2937", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1419", border: "none", padding: "12px 16px", color: "#e4e7eb", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
      >
        <span>How to use Quick Spin</span>
        <span style={{ color: "#6b7280", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: "14px 16px", background: "#0a0e14", borderTop: "1px solid #1f2937", fontSize: 12.5, lineHeight: 1.5 }}>
          {row("What it is", "one value pick and one small parlay, chosen by the model from today's best edges and locked once a day. It refreshes tomorrow — there's no re-rolling.")}
          {row("The single", "the model's highest-conviction value play of the day. The cleanest starting point if you only want one bet.")}
          {row("The parlay", "a few value legs combined. \"Pays\" is the book's payout; \"fair value\" is what the model thinks it's truly worth. When the payout beats fair value, there's a model edge — but parlays still win less than half the time, so keep stakes small.")}
          {row("How to use it", "tap any pick to open the full game breakdown and see the reasoning, then shop for the best price at your book. Treat it as a study tool and a starting point — not a guarantee.")}
          {row("Track record", "the strip up top shows how the picks have actually done (W-L and ROI). The single is the number to judge it by; the parlay is high-variance by nature.")}
          <div style={{ marginTop: 4, color: "#6b7280", fontSize: 11 }}>For entertainment. Bet responsibly. 21+. 1-800-GAMBLER.</div>
        </div>
      )}
    </div>
  );
}

function CardBody({ card, record, navigate }) {
  const storageKey = `wp_quickpick_spin_${card.scope || "mix"}_${card.game_date}`;
  // The free spin is once a day. We persist whether it's been used + the bonus
  // play it landed on, so a reload shows the bonus statically (no re-spin).
  const [used, setUsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const [bonus, setBonus] = useState(() => {
    try { const s = localStorage.getItem(`${storageKey}_play`); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [fetching, setFetching] = useState(false); // waiting on the bonus play
  const [spinning, setSpinning] = useState(false);  // reels in motion
  const [pending, setPending] = useState(null);     // bonus play being spun toward
  const [spinDone, setSpinDone] = useState(0);       // reels that have pinned
  const [spinMsg, setSpinMsg] = useState("");

  // When every reel of the bonus play has pinned, reveal it.
  useEffect(() => {
    if (!spinning || !pending) return;
    const targets = (pending.single ? 1 : 0) + (pending.parlay ? 1 : 0);
    if (targets > 0 && spinDone >= targets) { setSpinning(false); setBonus(pending); }
  }, [spinDone, spinning, pending]);
  // Safety net: never leave the user stuck on spinning reels.
  useEffect(() => {
    if (!spinning) return;
    const t = setTimeout(() => { setSpinning(false); if (pending) setBonus(pending); }, 8500);
    return () => clearTimeout(t);
  }, [spinning, pending]);

  const markSpin = () => setSpinDone(n => n + 1);

  const doSpin = () => {
    if (used || fetching || spinning) return;
    setFetching(true); setSpinMsg("");
    fetch(`${API_BASE}/api/daily-card/alternate-play?scope=${card.scope || "mix"}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setFetching(false);
        if (d && (d.single || d.parlay)) {
          setUsed(true);
          try { localStorage.setItem(storageKey, "1"); localStorage.setItem(`${storageKey}_play`, JSON.stringify(d)); } catch {}
          setSpinDone(0);
          setPending(d);
          setSpinning(true); // reels play; bonus reveals when they pin
        } else if (d && d.allStarted) {
          setSpinMsg("Every game's already started — no bonus play left today.");
        } else {
          setSpinMsg("Couldn't find a bonus play right now — try again in a bit.");
        }
      })
      .catch(() => { setFetching(false); setSpinMsg("Couldn't load a bonus play — try again in a bit."); });
  };

  if (card.allStarted) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🏟️</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Today's games have all started</div>
        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.5 }}>Quick Spin only locks a play while a game's line is still open — once first pitch is thrown, the price isn't one you could actually bet. The board's done for today; fresh picks post tomorrow when the next slate's lines open.</div>
      </div>
    );
  }

  if (card.notReady || (!card.single && !card.parlay)) {
    return (
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Quick Spin isn't ready yet</div>
        <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.5 }}>The model locks the picks once the day's lines and value edges are in. Check back a little later — they usually post once the slate firms up.</div>
      </div>
    );
  }
  return (
    <>
      {record && <RecordStrip record={record} />}
      {card.single && <SinglePick single={card.single} result={card.single_result} navigate={navigate} />}
      {card.parlay && <ParlayCard parlay={card.parlay} result={card.parlay_result} navigate={navigate} />}

      {/* The one free spin: pull it to spin a fresh bonus single + parlay. */}
      {!used && !spinning && (
        <button onClick={doSpin} disabled={fetching} style={{ width: "100%", marginTop: 12, background: "transparent", border: "1px solid #1D9E75", borderRadius: 10, padding: "12px", color: "#1D9E75", fontSize: 14, fontWeight: 800, cursor: fetching ? "default" : "pointer", fontFamily: "inherit", opacity: fetching ? 0.6 : 1 }}>
          {fetching ? "Loading your spin…" : "🎰 Pull your free spin (1 today)"}
        </button>
      )}

      {spinning && pending && (
        <div style={{ marginTop: 12 }}>
          {pending.single && <Reel title="🎰 Bonus pick" finalLabel={`${pending.single.description} ${formatOdds(pending.single.odds)}`} accent="#3a4250" onDone={markSpin} />}
          {pending.parlay && <ParlayReel parlay={pending.parlay} onDone={markSpin} />}
        </div>
      )}

      {bonus && !spinning && (
        <div style={{ marginTop: 12 }}>
          {bonus.single && <AltPick pick={bonus.single} navigate={navigate} />}
          {bonus.parlay && <BonusParlay parlay={bonus.parlay} navigate={navigate} />}
        </div>
      )}

      {spinMsg && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280", textAlign: "center" }}>{spinMsg}</div>
      )}
      {used && !spinning && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280", textAlign: "center" }}>
          That's your free spin for today — fresh picks tomorrow.
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: "#6b7280", lineHeight: 1.6, textAlign: "center" }}>
        The tracked Pick of the Day and parlay are above. Your free spin is a bonus play — a different single and parlay, just for you, never part of the tracked record. Every leg is a model value edge — never random. Parlays multiply variance, so size them small. For entertainment; bet responsibly. 21+. 1-800-GAMBLER.
      </div>
    </>
  );
}

// The personal re-roll result (Option A): a different value pick shown only to
// this subscriber. Marked "not tracked" because it never enters the graded
// shared record — that stays the official Pick of the Day.
// ── Slot-reel reveal ──────────────────────────────────────────────────────────
// Theater only: each strip blurs through decoy rows, decelerates, and PINS onto
// the pick the model already chose. The landing row is always the real pick —
// nothing here is random or selected by the spin.
const REEL_ABBRS = ["LAD", "NYY", "HOU", "ATL", "SD", "BOS", "PHI", "SEA", "TB", "CHC", "MIL", "TEX", "BAL", "ARI", "NYM", "SF", "MIN", "CLE"];
const REEL_MKTS = ["ML", "Over", "Under", "ML", "Over"];
function reelDecoys(n = 14) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = REEL_ABBRS[Math.floor(Math.random() * REEL_ABBRS.length)];
    const m = REEL_MKTS[Math.floor(Math.random() * REEL_MKTS.length)];
    out.push(`${a} ${m}`);
  }
  return out;
}

// One spinning strip that pins onto finalLabel. `delay` staggers multi-strip
// (parlay) reveals so the legs lock in one after another, slot-machine style.
function ReelStrip({ finalLabel, delay = 0, onDone }) {
  const ROW_H = 52;
  const LEAD = 46, TRAIL = 4;            // long lead so it can blur-spin a while
  const SPIN_MS = 3000, LAND_MS = 1700;  // ~4.7s of motion, well over the 4s floor
  const [leadDecoys] = useState(() => reelDecoys(LEAD));   // frozen so they don't reshuffle
  const [trailDecoys] = useState(() => reelDecoys(TRAIL)); // sit just past the win row to cover the bounce
  const rows = [...leadDecoys, finalLabel, ...trailDecoys];
  const finalIdx = LEAD;                 // index of the real pick (the win line)
  const target = -finalIdx * ROW_H;
  const mid = -(finalIdx - 6) * ROW_H;   // end of the fast phase, 6 rows shy of the win
  const [y, setY] = useState(0);
  const [trans, setTrans] = useState("none");
  const [phase, setPhase] = useState("idle"); // idle → spin → land → done

  useEffect(() => {
    const start = 60 + delay;
    const t1 = setTimeout(() => { setPhase("spin"); setTrans(`transform ${SPIN_MS}ms linear`); setY(mid); }, start);
    // back-ease overshoots just past the win line then settles — the slot "snap".
    const t2 = setTimeout(() => { setPhase("land"); setTrans(`transform ${LAND_MS}ms cubic-bezier(0.18,1.4,0.4,1)`); setY(target); }, start + SPIN_MS);
    const t3 = setTimeout(() => { setPhase("done"); onDone && onDone(); }, start + SPIN_MS + LAND_MS + 40);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []); // run once per mount

  const motionBlur = phase === "spin";
  const landed = phase === "done";
  return (
    <div style={{ position: "relative", height: ROW_H, overflow: "hidden", borderRadius: 8, background: "#07090d",
      border: landed ? "1px solid #f5c51899" : "1px solid #1a1f28",
      boxShadow: landed ? "0 0 16px #f5c51840, inset 0 0 18px #000000aa" : "inset 0 0 18px #000000aa",
      transition: "border-color .45s, box-shadow .45s", marginBottom: 6 }}>
      <div style={{ transform: `translateY(${y}px)`, transition: trans, filter: motionBlur ? "blur(1.2px)" : "none", willChange: "transform" }}>
        {rows.map((label, i) => {
          const isFinal = i === finalIdx;
          return (
            <div key={i} style={{ height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: isFinal ? 18 : 15, fontWeight: 800,
              color: isFinal ? "#fff" : "#3a4250",
              textShadow: isFinal && landed ? "0 0 11px #f5c518aa" : "none",
              transition: "text-shadow .45s" }}>
              {label}
            </div>
          );
        })}
      </div>
      {/* center win-line glint */}
      <div style={{ position: "absolute", top: "50%", left: 8, right: 8, height: 1, transform: "translateY(-50%)", background: landed ? "#f5c51855" : "#ffffff10", transition: "background .45s", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 13, background: "linear-gradient(#07090d,transparent)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 13, background: "linear-gradient(transparent,#07090d)", pointerEvents: "none" }} />
    </div>
  );
}

// Single-pick reel (Pick of the Day / alternate): card chrome + one strip.
function Reel({ title, finalLabel, accent = "#1D9E75", onDone }) {
  const [landed, setLanded] = useState(false);
  return (
    <div style={{ background: "#0f1419", border: `1px solid ${accent}30`, borderRadius: 12, padding: 18, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: accent, fontWeight: 700, textTransform: "uppercase" }}>{title}</span>
        <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 700, letterSpacing: "0.08em" }}>{landed ? "LOCKED IN" : "SCANNING EDGES…"}</span>
      </div>
      <ReelStrip finalLabel={finalLabel} onDone={() => { setLanded(true); onDone && onDone(); }} />
    </div>
  );
}

// Parlay reel: one strip per leg, staggered so the legs pin one after another.
function ParlayReel({ parlay, onDone }) {
  const legs = parlay.legs || [];
  const [done, setDone] = useState(0);
  const allDone = legs.length > 0 && done >= legs.length;
  useEffect(() => { if (allDone) onDone && onDone(); }, [allDone]);
  return (
    <div style={{ background: "#0f1419", border: "1px solid #ef444430", borderRadius: 12, padding: 18, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "#ef4444", fontWeight: 700, textTransform: "uppercase" }}>🎰 Model parlay · {legs.length} legs</span>
        <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 700, letterSpacing: "0.08em" }}>{allDone ? "LOCKED IN" : "SCANNING EDGES…"}</span>
      </div>
      {legs.map((l, i) => (
        <ReelStrip key={i} finalLabel={`${l.description} ${formatOdds(l.odds)}`} delay={i * 400} onDone={() => setDone(d => d + 1)} />
      ))}
    </div>
  );
}

function AltPick({ pick, navigate }) {
  const go = () => pick.gameId && navigate(`/game/${pick.league || "mlb"}/${pick.gameId}`);
  return (
    <div onClick={go} style={{ background: "#0f1419", border: "1px dashed #3a4250", borderRadius: 12, padding: 18, marginTop: 12, cursor: pick.gameId ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>🎲 Your alternate pick</span>
        <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 700, border: "1px solid #1f2937", borderRadius: 5, padding: "2px 7px" }}>NOT TRACKED</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>{pick.description} <span style={{ color: "#9ca3af", fontWeight: 700 }}>{formatOdds(pick.odds)}</span></div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{pick.matchup}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#22c55e" }}>{signedPct(pick.edge)}</div>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>edge</div>
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a1f28", fontSize: 11, color: "#6b7280" }}>
        Model: <span style={{ color: "#e4e7eb", fontWeight: 600 }}>{pct(pick.modelProb)}</span> · {pick.confidence} confidence · just for you, not part of the tracked record
      </div>
    </div>
  );
}

function SinglePick({ single, result, navigate }) {
  const go = () => single.gameId && navigate(`/game/${single.league || "mlb"}/${single.gameId}`);
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
        <div key={i} onClick={() => leg.gameId && navigate(`/game/${leg.league || "mlb"}/${leg.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < parlay.legs.length - 1 ? "1px solid #1a1f28" : "none", cursor: leg.gameId ? "pointer" : "default" }}>
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

// The free-spin bonus parlay: same layout as the tracked parlay but clearly
// marked NOT TRACKED — it never enters the graded record.
function BonusParlay({ parlay, navigate }) {
  return (
    <div style={{ background: "#0f1419", border: "1px dashed #3a4250", borderRadius: 12, padding: 18, marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>🎰 Bonus parlay · {(parlay.legs || []).length} legs</span>
        <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 700, border: "1px solid #1f2937", borderRadius: 5, padding: "2px 7px" }}>NOT TRACKED</span>
      </div>
      {(parlay.legs || []).map((leg, i) => (
        <div key={i} onClick={() => leg.gameId && navigate(`/game/${leg.league || "mlb"}/${leg.gameId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < parlay.legs.length - 1 ? "1px solid #1a1f28" : "none", cursor: leg.gameId ? "pointer" : "default" }}>
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
        Just for you — not part of the tracked record. Parlays are high variance by nature, so size them small.
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
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Unlock Quick Spin</div>
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
      <div style={{ color: "#6b7280", fontSize: 13 }}>Loading quick spin...</div>
    </div>
  );
}
function ErrorState() {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 12, padding: 28, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
      Couldn't load quick spin right now. Please try again in a moment.
    </div>
  );
}
