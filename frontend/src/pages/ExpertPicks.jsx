import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi, supabase } from "../lib/api";
import Sidebar from "./Sidebar";
import TerminalShell from "./TerminalShell";
import BottomNav from "./BottomNav";

// WZ-WIZEPLAYS-PAGE-REDESIGN-2026-07-11 :: standalone WizePlays page rebuilt to
// match the Edge-board WizePlays card exactly — gold serif W mark, real ESPN team
// logos, hairline pick rows, one clean record header. Data/logic unchanged: same
// expert_picks fetch, same honest computeRecord (nothing shown until graded), same
// access gate for non-subscribers, same parlay calculator + empty/loading states.

const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
const SERIF = "'Fraunces',Georgia,'Times New Roman',serif";

// The six sports the picks can be tagged with. Keyed by the short id we store
// on each pick/leg; label + icon are for display. Matches the league style used
// across the rest of the app.
const SPORTS = {
  mlb:    { label: "MLB", icon: "⚾" },
  nba:    { label: "NBA", icon: "🏀" },
  nfl:    { label: "NFL", icon: "🏈" },
  nhl:    { label: "NHL", icon: "🏒" },
  ncaafb: { label: "CFB", icon: "🏟️" },
  ncaamb: { label: "CBB", icon: "🎓" },
};

function sportTag(id) {
  const s = SPORTS[id];
  if (!s) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: "#1f2937", color: "#9ca3af", border: "1px solid #374151", letterSpacing: "0.04em" }}>
      <span style={{ fontSize: 11 }}>{s.icon}</span>{s.label}
    </span>
  );
}

// ── Team logo (same source + look as the Edge-board WizePlays card) ──────────
// Neutral slate crest with the real ESPN logo on top; falls back to the abbr if
// the image 404s, so a missing logo never breaks the row.
const SLUGM = { CWS: "chw", CHW: "chw" };
const ESPN_ALIAS = { az: "ari" }; // ESPN files the D-backs under "ari"
const LGSLUG = { mlb: "mlb", nba: "nba", nfl: "nfl", nhl: "nhl", ncaafb: "college-football", ncaamb: "mens-college-basketball" };
function shortTeam(t) { const m = String(t).match(/[A-Z]{2,3}/); return m ? m[0] : String(t).slice(0, 3).toUpperCase(); }
// Pull a team abbr from a curated pick for its logo ("LAD ML" -> LAD).
const wpAbbr = (pk) => {
  const f = String((pk && pk.pick) || "").trim().split(/\s+/)[0];
  if (/^[A-Za-z]{2,4}$/.test(f)) return f.toUpperCase();
  const g = String((pk && pk.game) || "").trim().split(/\s+/)[0];
  return /^[A-Za-z]{2,4}$/.test(g) ? g.toUpperCase() : "";
};
function TeamCrest({ ab, size = 36, lg = "mlb" }) {
  const [bad, setBad] = useState(false);
  const up = String(ab || "").toUpperCase();
  const low = String(ab || "").toLowerCase();
  const slug = SLUGM[up] || ESPN_ALIAS[low] || low;
  const box = { width: size, height: size, flex: "0 0 auto", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "radial-gradient(circle at 50% 32%, #3a4653aa, #0c1018 82%)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)" };
  if (bad || !ab) return <span style={box}><span style={{ fontWeight: 800, fontSize: Math.round(size * 0.3), color: "#cbd3da" }}>{String(ab || "?").slice(0, 3)}</span></span>;
  return <span style={box}><img src={`https://a.espncdn.com/i/teamlogos/${lg}/500/${slug}.png`} alt="" onError={() => setBad(true)} style={{ width: Math.round(size * 0.74), height: Math.round(size * 0.74), objectFit: "contain" }} /></span>;
}

// ── American odds helpers ───────────────────────────────────────────────────
function americanToDecimal(odds) {
  const n = Number(odds);
  if (!n || Number.isNaN(n)) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}
function formatOdds(american) {
  const n = Number(american);
  if (n == null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}
// Combined decimal odds for a parlay = product of each leg's decimal odds.
function parlayDecimal(legs) {
  if (!legs || legs.length === 0) return null;
  let d = 1;
  for (const leg of legs) {
    const dec = americanToDecimal(leg.odds);
    if (dec == null) return null;
    d *= dec;
  }
  return d;
}

export default function ExpertPicksPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [rows, setRows] = useState([]);        // all expert_picks rows (newest first)
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("expert_picks")
          .select("*")
          .order("date", { ascending: false });
        const parsed = (data || []).map((r) => {
          let picks = [];
          try { picks = r.picks ? JSON.parse(r.picks) : []; } catch (_) { picks = []; }
          return { date: r.date, picks };
        });
        setRows(parsed);
      } catch (_) {
        // Table may not exist yet, or no rows — show the empty state, never crash.
        setRows([]);
      }
      setLoading(false);
    })();
  }, []);

  // Today's row (America/New_York, same as the Dashboard uses for daily_picks).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayRow = rows.find((r) => r.date === today);
  const todayPicks = todayRow?.picks || [];
  const straights = todayPicks.filter((p) => p.type !== "parlay");
  const parlays = todayPicks.filter((p) => p.type === "parlay");

  // Honest record across ALL graded picks (result === "win" | "loss" | "push").
  // Grading is the tracker (built separately) — until picks are graded these
  // stay zero and we DON'T show a record, so nothing is ever fabricated.
  const record = computeRecord(rows);

  return (
    <TerminalShell active="/expert-picks" plan={plan} navigate={navigate}>
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800;900&display=swap');
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

        @media (min-width: 1024px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
        }
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important;padding-top:0!important}
          .hamburger-btn{display:flex!important}
          .mobile-only{display:flex!important}
          .ep-content{padding:16px 14px 60px!important}
          h1{font-size:30px!important}
        }
      `}</style>

      {/* Desktop sidebar — fixed left */}
      <BottomNav />
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
        <div className="ep-content" style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 60px" }}>
          <div onClick={() => navigate(-1)} style={{ color: "#6b7280", fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, userSelect: "none" }}>← Back</div>

          {/* Page title — WizePicks trademark treatment: gold second word, serif. */}
          <div style={{ marginBottom: 12 }}>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 33, fontWeight: 600, letterSpacing: "-0.02em" }}>Wize<span style={{ color: "#C9A86A" }}>Plays</span></h1>
          </div>

          {/* WizePlays header + honest record — the Edge-board card, page-sized. */}
          <WizeHero record={record} />

          {/* What WizePlays is (unchanged copy, lighter styling) */}
          <div style={{ fontSize: 12.5, color: "#9ca3af", lineHeight: 1.55, margin: "0 0 12px" }}>
            <p style={{ margin: "0 0 8px" }}>Handpicked by our analysts — a fresh slate of plays every day, across MLB, NBA, NFL, NHL &amp; college.</p>
            <p style={{ margin: 0, color: "#e4e7eb", fontWeight: 600 }}>Every play is tracked — wins <em style={{ fontStyle: "normal" }}>and</em> losses — with complete transparency. Nothing hidden, nothing fabricated.</p>
          </div>

          {/* Posting-time note */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 22px", fontSize: 12, color: "#6b7280" }}>
            <span style={{ fontSize: 13 }}>🕒</span>
            <span>New picks are posted <strong style={{ color: "#9ca3af" }}>2–3 hours before</strong> the first games of the day.</span>
          </div>

          {loading ? (
            <Loader />
          ) : !hasFullAccess ? (
            <LockedTeaser record={record} navigate={navigate} />
          ) : todayPicks.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ animation: "fadeIn .3s ease" }}>
              {parlays.length > 0 && (
                <Section title="Parlays" count={parlays.length}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {parlays.map((p, i) => <ParlayCard key={i} parlay={p} />)}
                  </div>
                </Section>
              )}
              {straights.length > 0 && (
                <Section title="Straight bets" count={straights.length}>
                  <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 14, overflow: "hidden" }}>
                    {straights.map((p, i) => <StraightRow key={i} pick={p} first={i === 0} />)}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* Responsible-gambling footer, consistent with the rest of the app */}
          <div style={{ marginTop: 36, paddingTop: 18, borderTop: "1px solid #1a1f28", fontSize: 11, color: "#4b5563", lineHeight: 1.6 }}>
            WizePicks provides informational sports analysis, not betting advice, and is not a sportsbook.
            For entertainment purposes only. If you or someone you know has a gambling problem, call 1-800-GAMBLER.
          </div>
        </div>
      </div>
    </div>
    </TerminalShell>
  );
}

// ── WizePlays header card — gold W mark + CURATED + honest record ────────────
// Mirrors the Edge-board card. The record strip only renders once picks are
// graded (graded > 0); before that we show the honest "building" line, never a
// fabricated number.
function WizeHero({ record }) {
  const graded = record.wins + record.losses;
  const has = graded > 0;
  const winPct = has ? Math.round((record.wins / graded) * 100) : 0;
  const recStr = `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""}`;
  const unitsColor = record.units >= 0 ? "#22c55e" : "#ef4444";
  const unitsStr = `${record.units >= 0 ? "+" : ""}${record.units.toFixed(2)}u`;
  return (
    <div style={{ position: "relative", border: "1px solid rgba(201,168,106,0.40)", borderRadius: 14, background: "#0f1419", overflow: "hidden", marginBottom: 16 }}>
      <div style={{ position: "absolute", top: 0, left: 16, right: 16, height: 1, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)", opacity: 0.5 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 14px" }}>
        {/* the existing WizePlays logo mark: gold-fill serif W */}
        <div style={{ width: 52, height: 52, flex: "0 0 auto", borderRadius: 13, background: "linear-gradient(180deg,#d8b878,#b98f45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#161007", fontFamily: SERIF, fontWeight: 700, fontSize: 28, boxShadow: "0 6px 16px rgba(201,168,106,0.28),inset 0 1px 0 rgba(255,255,255,0.40)" }}>W</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.10em" }}>WIZEPLAYS</span>
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: "#E4C88A", background: "rgba(201,168,106,0.12)", border: "1px solid rgba(201,168,106,0.35)", borderRadius: 6, padding: "2px 7px" }}>CURATED</span>
          </div>
          <div style={{ fontSize: 12.5, color: "#9ca3af", marginTop: 4 }}>Hand-picked after extra review.</div>
        </div>
      </div>
      {has ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", borderTop: "1px solid #1f2937" }}>
          <HeroStat k="RECORD" v={recStr} />
          <HeroStat k="WIN RATE" v={`${winPct}%`} />
          <HeroStat k="UNITS" v={unitsStr} color={unitsColor} last />
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #1f2937", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15 }}>📈</span>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>Building our verified track record — full results post here as picks settle.</span>
        </div>
      )}
    </div>
  );
}

function HeroStat({ k, v, color, last }) {
  return (
    <div style={{ padding: "13px 14px", borderRight: last ? "none" : "1px solid #1f2937" }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", color: "#6b7280", marginBottom: 6 }}>{k}</div>
      <div style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em", whiteSpace: "nowrap", color: color || "#e4e7eb", fontVariantNumeric: "tabular-nums" }}>{v}</div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: "0.02em" }}>{title}</h2>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#6b7280" }}>{count} {count === 1 ? "pick" : "picks"}</span>
      </div>
      {children}
    </div>
  );
}

// ── Straight bet row (Edge-board style: crest · pick/matchup · odds) ─────────
function StraightRow({ pick, first }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 16px", borderTop: first ? "none" : "1px solid rgba(255,255,255,0.055)" }}>
      <TeamCrest ab={wpAbbr(pick)} lg={LGSLUG[pick.sport] || "mlb"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pick.pick}</div>
        {pick.game && <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#6b7280", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pick.game}</div>}
        {pick.analysis && <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5, marginTop: 6 }}>{pick.analysis}</div>}
      </div>
      {pick.odds != null && <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{formatOdds(pick.odds)}</div>}
      <ResultBadge result={pick.result} />
    </div>
  );
}

// ── Parlay card with live payout calculator ─────────────────────────────────
function ParlayCard({ parlay }) {
  const legs = parlay.legs || [];
  // Prefer the stored combined odds; fall back to computing from the legs.
  const computedDec = parlayDecimal(legs);
  const combinedAmerican =
    parlay.combinedOdds != null && !Number.isNaN(Number(parlay.combinedOdds))
      ? Number(parlay.combinedOdds)
      : (computedDec ? decimalToAmerican(computedDec) : null);
  const decimal = americanToDecimal(combinedAmerican) || computedDec;

  const [stake, setStake] = useState(10);
  const stakeNum = Number(stake) || 0;
  const payout = decimal ? stakeNum * decimal : 0;
  const profit = payout - stakeNum;

  return (
    <div style={{ background: "linear-gradient(180deg,#1a1410 0%,#0f1419 100%)", border: "1px solid #ef444433", borderLeft: "3px solid #ef4444", borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, letterSpacing: 1, color: "#ef4444", fontWeight: 700 }}>
            {legs.length}-LEG PARLAY
          </span>
          <ResultBadge result={parlay.result} />
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>
          {formatOdds(combinedAmerican)}
        </span>
      </div>

      {/* Legs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {legs.map((leg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", background: "#0a0e14", borderRadius: 6, border: "1px solid #1f2937" }}>
            <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: "50%", background: "#ef444415", border: "1px solid #ef444440", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#ef4444" }}>{i + 1}</div>
            {sportTag(leg.sport)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leg.pick}</div>
              {leg.game && <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{leg.game}</div>}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e4e7eb", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatOdds(leg.odds)}</span>
          </div>
        ))}
      </div>

      {parlay.analysis && (
        <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5, marginBottom: 14 }}>{parlay.analysis}</div>
      )}

      {/* Live payout calculator */}
      <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 5 }}>YOUR BET</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16, color: "#6b7280", fontWeight: 700 }}>$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                style={{ width: 90, background: "#0f1419", border: "1px solid #2a3340", borderRadius: 6, color: "#e4e7eb", fontSize: 16, fontWeight: 700, padding: "8px 10px", fontFamily: "inherit", outline: "none" }}
              />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 5 }}>TO WIN</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>
              ${profit.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
              ${payout.toFixed(2)} total payout
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Normalize result values: the auto-grader writes "win"/"loss"/"push", but older
// manual grades may be stored as "won"/"lost". Fold them so every graded pick shows.
function normRes(r) { const s = String(r == null ? "" : r).trim().toLowerCase(); return s === "won" ? "win" : s === "lost" ? "loss" : s; }

function ResultBadge({ result }) {
  if (!result) return null;
  const map = {
    win:  { fg: "#22c55e", bg: "#22c55e15", border: "#22c55e30", text: "WON" },
    loss: { fg: "#ef4444", bg: "#ef444415", border: "#ef444430", text: "LOST" },
    push: { fg: "#9ca3af", bg: "#1f2937",   border: "#374151",   text: "PUSH" },
  };
  const c = map[normRes(result)];
  if (!c) return null;
  return (
    <span style={{ fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 4, background: c.bg, color: c.fg, border: `1px solid ${c.border}`, letterSpacing: "0.06em", flex: "0 0 auto" }}>
      {c.text}
    </span>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 56 }}>
      <div style={{ width: 30, height: 30, border: "3px solid #1f2937", borderTopColor: "#C9A86A", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 12px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading WizePlays…</div>
    </div>
  );
}

// ── Locked teaser (one clean gate, no per-pick blur, no $7 buttons inline) ──
function LockedTeaser({ record, navigate }) {
  const graded = record.wins + record.losses;
  const hook = graded > 0
    ? `${record.wins}-${record.losses} on tracked picks · ${record.units >= 0 ? "+" : ""}${record.units.toFixed(2)} units`
    : "Daily WizePlays — parlays & straight bets across MLB, NBA, NFL, NHL & college";
  return (
    <div style={{ position: "relative", background: "linear-gradient(180deg,#1a1410 0%,#0f1419 100%)", border: "1px solid #ef444433", borderLeft: "3px solid #ef4444", borderRadius: 10, padding: "40px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 38, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Subscribe to see WizePlays</div>
      <div style={{ fontSize: 13, color: "#9ca3af", maxWidth: 460, margin: "0 auto 22px", lineHeight: 1.6 }}>
        {hook}. Full parlay breakdowns, straight bets, and an honest, fully-tracked record.
      </div>
      <button onClick={() => navigate("/pricing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        Subscribe — $7/mo
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🗓️</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No picks posted yet today</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>New WizePlays drop here daily. Check back soon.</div>
    </div>
  );
}

// Tally a full, honest record across every graded pick in every row.
// A pick counts only once it has result === "win" | "loss" | "push".
// Units: straight bets risk 1u (win pays decimal-1; loss = -1u). Parlays the same.
function computeRecord(rows) {
  let wins = 0, losses = 0, pushes = 0, units = 0, parlayWins = 0, parlayTotal = 0;
  for (const r of rows) {
    for (const p of r.picks || []) {
      const res = normRes(p.result);
      if (p.type === "parlay") {
        if (res === "win" || res === "loss" || res === "push") parlayTotal += 1;
        if (res === "win") parlayWins += 1;
      }
      if (res === "win") {
        wins += 1;
        let dec;
        if (p.type === "parlay") {
          const cd = parlayDecimal(p.legs);
          dec = (p.combinedOdds != null ? americanToDecimal(p.combinedOdds) : null) || cd;
        } else {
          dec = americanToDecimal(p.odds);
        }
        units += dec ? dec - 1 : 0;
      } else if (res === "loss") {
        losses += 1;
        units -= 1;
      } else if (res === "push") {
        pushes += 1;
      }
    }
  }
  return { wins, losses, pushes, units, parlayWins, parlayTotal };
}
