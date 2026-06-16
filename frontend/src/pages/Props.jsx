// Props.jsx — the full player-props board, now sport-aware.
// SPORT selector (Games-page pill style) switches the feed + category tabs:
//   MLB → HR / Hits / Ks  (from /api/edges/mlb)
//   NBA → Points / Rebounds / Assists / Threes (from /api/edges/nba/props — EXPERIMENTAL projections)
// MLB rendering is unchanged. NBA props are projections (proj vs line), shown with an
// experimental disclaimer — sharp markets, flagged edges are rare and informational.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, playerCardApi } from "../lib/api";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import TerminalShell from "./TerminalShell";

const TEAMCOL = { ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#C4CED4",CHW:"#C4CED4",CIN:"#C6011F",CLE:"#E31937",COL:"#5A4F9C",DET:"#FA4616",HOU:"#EB6E1F",KC:"#3E7DC4",KCR:"#3E7DC4",LAA:"#BA0021",LAD:"#3E7DC4",LOS:"#3E7DC4",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#D31145",NYM:"#FF5910",NYY:"#3A4F73",OAK:"#EFB21E",ATH:"#EFB21E",PHI:"#E81828",PIT:"#FDB827",SD:"#FFC425",SDP:"#FFC425",SEA:"#1B9A8E",SF:"#FD5A1E",SFG:"#FD5A1E",STL:"#C41E3A",TB:"#8FBCE6",TBR:"#8FBCE6",TEX:"#3E66B0",TOR:"#1D6FE0",WSH:"#E0263B",WAS:"#E0263B",
  // NBA
  NBA_BOS:"#007A33" };
const NBACOL = { ATL:"#E03A3E",BOS:"#007A33",BKN:"#777",CHA:"#1D1160",CHI:"#CE1141",CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",MIA:"#98002E",MIL:"#00471B",MIN:"#236192",NOP:"#85714D",NYK:"#006BB6",OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#E56020",POR:"#E03A3E",SAC:"#5A2D81",SAS:"#9AA7AE",TOR:"#CE1141",UTA:"#3E2680",WAS:"#002B5C" };
const teamCol = (ab) => TEAMCOL[String(ab || "").toUpperCase()] || "#3a4a57";
const nbaCol = (ab) => NBACOL[String(ab || "").toUpperCase()] || "#3a4a57";
const shortTeam = (t) => { const m = String(t).match(/[A-Z]{2,3}/); return m ? m[0] : String(t).slice(0, 3).toUpperCase(); };
const formatOdds = (o) => { if (o == null || o === "") return "—"; const n = Number(o); return n > 0 ? `+${n}` : `${n}`; };

const SPORT_TABS = [["mlb","MLB","⚾"],["nba","NBA","🏀"],["nfl","NFL","🏈"],["cfb","CFB","🏟️"],["nhl","NHL","🏒"]];
const MLB_CATS = [["hr","HR","💣"],["hits","Hits","🏏"],["ks","Ks","🔥"],["tb","TB","💥"],["doubles","2B","↔️"],["triples","3B","🚀"]];
const NBA_CATS = [["points","Points","🟠"],["rebounds","Rebounds","🛟"],["assists","Assists","🎯"],["threes","Threes","🎲"]];
const HAS_PROPS = { mlb:true, nba:true }; // sports with a prop model wired
const NBA_MK = { points:"PTS", rebounds:"REB", assists:"AST", threes:"3PM" };

export default function PropsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";
  const [sport, setSport] = useState("mlb");
  const [tab, setTab] = useState("hr");
  const [mlb, setMlb] = useState(null);
  const [nba, setNba] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    let on = true; setLoading(true);
    if (sport === "mlb") {
      edgesApi.getMLB().then((d) => { if (on) { setMlb(d || {}); setLoading(false); } }).catch(() => { if (on) { setMlb({}); setLoading(false); } });
    } else if (sport === "nba") {
      edgesApi.getNBAProps().then((d) => { if (on) { setNba(d || {}); setLoading(false); } }).catch(() => { if (on) { setNba({}); setLoading(false); } });
    } else { setLoading(false); }
    return () => { on = false; };
  }, [sport]);

  const cats = sport === "mlb" ? MLB_CATS : sport === "nba" ? NBA_CATS : [];
  const hasProps = !!HAS_PROPS[sport];

  // resolve the active list for the current sport+tab
  let list = [];
  if (sport === "mlb") {
    const e = mlb || {};
    if (tab === "tb" || tab === "doubles" || tab === "triples") {
      const src = tab === "tb" ? (e.tbPropEdges || []) : tab === "doubles" ? (e.doublesPropEdges || []) : (e.triplesPropEdges || []);
      list = [...src].sort((a, b) => (b.overProb || 0) - (a.overProb || 0));
    } else {
      list = tab === "hr" ? (e.hrPropEdges || []) : tab === "hits" ? (e.hitsPropEdges || []) : (e.kPropEdges || []);
      list = [...list].sort((a, b) => tab === "hr" ? ((b.hrProb || 0) - (a.hrProb || 0)) : ((b.edge || 0) - (a.edge || 0)));
    }
  } else if (sport === "nba") {
    const e = nba || {};
    list = tab === "points" ? (e.pointsProps || []) : tab === "rebounds" ? (e.reboundsProps || []) : tab === "assists" ? (e.assistsProps || []) : (e.threesProps || []);
    // already sorted by |edge| server-side
  }

  const catCount = (id) => {
    if (sport === "mlb") {
      const e = mlb || {};
      if (id === "tb") return (e.tbPropEdges || []).length || "";
      if (id === "doubles") return (e.doublesPropEdges || []).length || "";
      if (id === "triples") return (e.triplesPropEdges || []).length || "";
      return (id === "hr" ? (e.hrPropEdges || []) : id === "hits" ? (e.hitsPropEdges || []) : (e.kPropEdges || [])).length || "";
    }
    if (sport === "nba") { const e = nba || {}; return (id === "points" ? (e.pointsProps || []) : id === "rebounds" ? (e.reboundsProps || []) : id === "assists" ? (e.assistsProps || []) : (e.threesProps || [])).length || ""; }
    return "";
  };

  const emptyLabel = sport === "mlb"
    ? (tab === "hr" ? "home run" : tab === "hits" ? "hits" : tab === "ks" ? "strikeout" : tab === "tb" ? "total bases" : tab === "doubles" ? "doubles" : tab === "triples" ? "triples" : "")
    : (NBA_MK[tab] ? NBA_MK[tab].toLowerCase() : "");

  return (
    <TerminalShell active="/props" plan={plan} navigate={navigate}>
    <div style={{ minHeight: "100vh", background: "#000", color: "#f2f6f4", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{CSS}</style>
      <BottomNav />
      <div className="ppsb"><Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} /></div>
      <div className="ppwrap">
        <div onClick={() => navigate(-1)} style={{ color: "#6b7280", fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, userSelect: "none" }}>← Back</div>
        <div className="pphead">
          <div className="pptitle"><span className="b">Player</span> Props</div>
          <div className="ppsub">{sport === "mlb" && mlb?.rolledToNextDay ? <><b style={{ color: "#ff7a6c" }}>Tomorrow's board</b> — </> : ""}Every prop the model flags with an edge — the full board, not just the top picks.</div>
        </div>

        {/* SPORT SELECTOR — same pill style as the Games page */}
        <div className="ppsports">
          {SPORT_TABS.map(([id, lb, ic]) => (
            <button key={id} className={"ppsport" + (sport === id ? " on" : "")} onClick={() => { setSport(id); setTab(id === "mlb" ? "hr" : "points"); }}>
              <span className="ic">{ic}</span>{lb}
            </button>
          ))}
        </div>

        {!hasProps ? (
          <div className="ppmuted" style={{ padding: "44px 8px" }}>Player props aren’t available for {sport.toUpperCase()} yet — they come online as each sport’s model does.</div>
        ) : (<>
          <div className="pptabs">
            {cats.map(([id, lb, ic]) => (
              <button key={id} className={"pptab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
                <span className="ic">{ic}</span>{lb}
                <span className="ct">{catCount(id)}</span>
              </button>
            ))}
          </div>

          {hasFull && sport === "mlb" && tab === "hr" && !loading && (
            <div className="ppwarn">⚠️ Longshots — not guaranteed. Even the top names homer only about 1 game in 5. These are ranked by the model's chance to homer (a speculative lottery-ticket bet), <b>not</b> a tracked +EV play. Bet small, if at all.</div>
          )}
          {hasFull && sport === "nba" && !loading && (
            <div className="ppwarn">⚠️ Experimental projections. Prop markets are sharp, so flagged edges are rare and <b>informational, not betting advice</b>. Shown as the model's projection vs the book line.</div>
          )}

          {loading
            ? <div className="ppmuted">Loading the board…</div>
            : !hasFull
              ? <PropsLock navigate={navigate} />
              : list.length === 0
              ? <div className="ppmuted">No {emptyLabel} props on the board yet{sport === "nba" ? " — projections need ≥8 recent games per player and fill in closer to tip" : " — fills in closer to first pitch"}.</div>
              : <div className="pplist">{list.map((p, i) => sport === "nba"
                  ? <NbaPropRow key={(p.player || "") + i} p={p} market={tab} rank={i + 1} navigate={navigate} />
                  : <PropRow key={(p.player || "") + i} p={p} type={tab} rank={i + 1} navigate={navigate} />)}</div>}

          {hasFull && <div className="ppnote">{sport === "nba"
            ? "NBA props are experimental projections (model vs line), not tracked +EV plays. Flagged means the model's lean cleared its stability + hit-rate gates."
            : (tab === "tb" || tab === "doubles" || tab === "triples")
              ? "Experimental boards — ranked by the model's chance to clear the line. Uncalibrated and not yet graded; shown to preview the model, not as betting advice."
            : tab === "hr"
              ? "HR props are ranked by the model's chance to homer. The HR market is efficient — these are options to consider, not tracked +EV plays."
              : "Sorted by model edge — the % is the model's price vs the book's. These clear our positive-EV bar."}</div>}
        </>)}
      </div>
    </div>
    </TerminalShell>
  );
}

// ---- Free-tier lock: blurred board + unlock card ----
function PropsLock({ navigate }) {
  const sk = (w, h) => ({ background: "#1f2937", borderRadius: 5, width: w, height: h });
  return (
    <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
      <div className="pplist" style={{ filter: "blur(7px)", opacity: 0.5, pointerEvents: "none", userSelect: "none" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pprow">
            <div className="rkn" style={{ color: "transparent" }}>{i + 1}</div>
            <div className="ppav" style={{ background: "#1f2937", boxShadow: "none" }} />
            <div className="ppinfo">
              <div style={{ ...sk("60%", 12), marginBottom: 6 }} />
              <div style={{ ...sk("40%", 9), marginBottom: 6 }} />
              <div style={sk("50%", 10)} />
            </div>
            <div className="ppright">
              <div style={{ ...sk(42, 22), marginLeft: "auto" }} />
              <div style={{ ...sk(30, 8), marginTop: 6, marginLeft: "auto" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 20, background: "radial-gradient(circle at 50% 35%, rgba(0,0,0,.45), rgba(0,0,0,.9))" }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "rgba(155,123,255,.14)", border: "1px solid rgba(155,123,255,.4)", marginBottom: 13 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 5 }}>The full prop board is locked</div>
        <div style={{ fontSize: 12, color: "#9aa6b2", lineHeight: 1.5, maxWidth: 270, marginBottom: 15 }}>Every flagged prop — HR, hits, K, points, rebounds, assists &amp; threes — across every game. <b style={{ color: "#33e991" }}>$7/mo</b> · cancel anytime.</div>
        <button onClick={() => navigate("/pricing")} style={{ background: "#1D9E75", color: "#04130d", border: "none", fontWeight: 800, fontSize: 14, padding: "12px 22px", borderRadius: 11, cursor: "pointer", fontFamily: "inherit" }}>Unlock All-Access →</button>
      </div>
    </div>
  );
}

// ---- MLB prop row (unchanged behavior) ----
// format a rate stat the baseball way: .947 / 1.203 (strip a leading zero, keep 1.xxx)
function fmt3(v) {
  if (v == null || v === "") return "—";
  const f = Number(v).toFixed(3);
  return f.startsWith("0.") ? f.slice(1) : f;
}

// one hand-split panel (vs LHP / vs RHP). `active` highlights the side that applies
// tonight — unused in v1 (no pitcher hand yet), wired in a later phase.
function SplitCard({ label, s, active }) {
  if (!s) {
    return (
      <div className={"hcsp" + (active ? " act" : "")}>
        <div className="hcvh">{label}</div>
        <div className="hcmut" style={{ marginTop: 8 }}>no data</div>
      </div>
    );
  }
  return (
    <div className={"hcsp" + (active ? " act" : "")}>
      {active && <span className="hctag">TONIGHT</span>}
      <div className="hcvh">{label}</div>
      <div className="hcops">{fmt3(s.ops)}</div>
      <div className="hcopsl">OPS</div>
      <div className="hcr">
        <div><div className="hcv">{fmt3(s.avg)}</div><div className="hcl">AVG</div></div>
        <div><div className="hcv">{fmt3(s.slg)}</div><div className="hcl">SLG</div></div>
        <div><div className="hcv hchr">{s.hr ?? "—"}</div><div className="hcl">HR</div></div>
        <div><div className="hcv">{s.ab ?? "—"}</div><div className="hcl">AB</div></div>
      </div>
      {s.thin && <div className="hcthin">small sample</div>}
    </div>
  );
}

// the expand-on-tap batting card (v1: hand-vs-hand splits). More sections land here
// next: model factors (barrel%/xwOBA/recent), model-vs-market, pull profile.
function HrCard({ card, loading }) {
  if (loading) return <div className="hrcard"><div className="hcmut">Loading batting card…</div></div>;
  if (!card || card.ok === false || !card.splits)
    return <div className="hrcard"><div className="hcmut">Batting card unavailable for this player.</div></div>;
  const s = card.splits;
  const bats = card.player?.bats;
  return (
    <div className="hrcard">
      <div className="hcsec">
        <div className="hctitle"><span className="hcdot"></span>Hand vs Hand · {s.season}{bats ? ` · bats ${bats}` : ""}</div>
        <div className="hcsplits">
          <SplitCard label="vs LHP" s={s.vsLHP} />
          <SplitCard label="vs RHP" s={s.vsRHP} />
        </div>
      </div>
      <div className="hcdisc">A <span className="hcb">Wize</span>Picks read — a lean, not a guarantee. More coming: model factors &amp; pull profile.</div>
    </div>
  );
}

function PropRow({ p, type, rank, navigate }) {
  const isHR = type === "hr";
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);

  const onTap = () => {
    // HR rows expand the batting card; every other prop type keeps the old behavior
    // (tap → game detail).
    if (!isHR) { if (p.gameId) navigate(`/game/mlb/${p.gameId}`); return; }
    const next = !open;
    setOpen(next);
    if (next && card == null && p.playerId) {
      setCardLoading(true);
      playerCardApi.getMLB(p.playerId)
        .then((d) => setCard(d || { ok: false }))
        .catch(() => setCard({ ok: false }))
        .finally(() => setCardLoading(false));
    }
  };

  let pct, lbl, line, edgeBadge = null;
  if (type === "hr") {
    pct = Math.round((p.hrProb || 0) * 100); lbl = "to homer"; line = `O 0.5 HR · ${formatOdds(p.odds)}`;
  } else if (type === "hits") {
    pct = Math.round((p.hitsProb || 0) * 100); lbl = "hit prob";
    const needH = Math.floor(p.line) + 1;
    line = p.side === "over"
      ? `${needH}+ Hits · ${formatOdds(p.odds)}`
      : (p.line <= 0.5 ? `0 Hits · ${formatOdds(p.odds)}` : `Under ${p.line} Hits · ${formatOdds(p.odds)}`);
    if ((p.edge ?? 0) > 0) edgeBadge = `+${(p.edge * 100).toFixed(1)}%`;
  } else if (type === "tb" || type === "doubles" || type === "triples") {
    pct = Math.round((p.overProb || 0) * 100);
    lbl = type === "tb" ? "to clear" : type === "doubles" ? "2B chance" : "3B chance";
    const unit = type === "tb" ? "TB" : type === "doubles" ? "2B" : "3B";
    const needN = Math.floor(p.line) + 1;
    line = p.line <= 0.5 ? `${needN}+ ${unit} · ${formatOdds(p.odds)}` : `O ${p.line} ${unit} · ${formatOdds(p.odds)}`;
    // No edge badge — these boards are ranked by likelihood, not priced edges.
  } else {
    pct = Math.round((p.kProb || 0) * 100); lbl = "K prob";
    line = `${p.side === "over" ? "O" : "U"} ${p.line} Ks · ${formatOdds(p.odds)}`;
    if ((p.edge ?? 0) > 0) edgeBadge = `+${(p.edge * 100).toFixed(1)}%`;
  }
  const ab = shortTeam(p.team || p.game || ""); const col = teamCol(ab);
  return (
    <div className={"pprowwrap" + (isHR && open ? " open" : "")}>
      <div className={"pprow" + (isHR ? " tappable" : "") + (isHR && open ? " rowopen" : "")} onClick={onTap}>
        <div className="rkn">{rank}</div>
        <div className="ppav" style={{ background: `linear-gradient(180deg, ${col}, #0c1018 88%)`, boxShadow: `0 0 0 2px ${col}88` }}>
          {p.playerId
            ? <img src={`https://midfield.mlbstatic.com/v1/people/${p.playerId}/spots/120`} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
            : (type === "ks" ? "⚾" : "🧢")}
        </div>
        <div className="ppinfo">
          <div className="ppname">{p.player || "—"}</div>
          <div className="ppgame">{p.game || p.team || ""}</div>
          <div className="ppline">{line}</div>
        </div>
        <div className="ppright">
          <div className="pppct">{pct}<span className="pc">%</span></div>
          <div className="pplbl">{lbl}</div>
          {edgeBadge && <div className="ppedge">{edgeBadge} EDGE</div>}
        </div>
        {isHR && <div className="ppchev">{open ? "▴" : "▾"}</div>}
      </div>
      {isHR && open && <HrCard card={card} loading={cardLoading} />}
    </div>
  );
}

// ---- NBA prop row: matches the MLB card — big projection number + label + edge badge ----
function NbaPropRow({ p, market, rank, navigate }) {
  const ab = shortTeam(p.teamAbbr || p.game || ""); const col = nbaCol(ab);
  const over = p.side === "OVER";
  const sideCol = over ? "#33e991" : "#ff5d52";
  const e = p.edge ?? 0;
  return (
    <div className="pprow" onClick={() => p.gameId && navigate(`/game/nba/${p.gameId}`)}>
      <div className="rkn">{rank}</div>
      <div className="ppav" style={{ background: `linear-gradient(180deg, ${col}, #0c1018 88%)`, boxShadow: `0 0 0 2px ${col}88` }}>
        {p.athleteId
          ? <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${p.athleteId}.png`} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
          : "🏀"}
      </div>
      <div className="ppinfo">
        <div className="ppname">{p.player || "—"}</div>
        <div className="ppgame">{p.game || p.teamAbbr || ""}</div>
        <div className="ppline">{over ? "Over" : "Under"} {p.line} {NBA_MK[market]}</div>
      </div>
      <div className="ppright">
        <div className="pppct" style={{ color: sideCol }}>{p.projection}</div>
        <div className="pplbl">proj {NBA_MK[market]}</div>
        <div className="ppedge" style={{ color: sideCol, background: over ? "rgba(51,233,145,.12)" : "rgba(255,93,82,.12)" }}>{over ? "▲" : "▼"} {e >= 0 ? "+" : ""}{e}{p.flagged ? " ⚑" : ""}</div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.ppwrap{max-width:560px;margin:0 auto;padding:18px 14px 90px}
.pphead{margin-bottom:14px}
.pptitle{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:30px;line-height:1;letter-spacing:-.01em}.pptitle .b{color:#ff5d4d}
.ppsub{font-size:12px;color:#8a99a2;font-weight:500;margin-top:6px;line-height:1.4}
.ppsports{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;margin-bottom:14px}
.ppsports::-webkit-scrollbar{display:none}
.ppsport{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;cursor:pointer;white-space:nowrap;
  font-size:13px;font-weight:700;font-family:inherit;border:1px solid #1f2937;background:#0e131b;color:#9ca3af}
.ppsport.on{border-color:#ef4444;background:rgba(239,68,68,.12);color:#fff}
.ppsport .ic{font-size:15px}
.pptabs{display:flex;gap:8px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
.pptabs::-webkit-scrollbar{display:none}
.pptab{flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 8px;border-radius:10px;cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:800;white-space:nowrap;border:1px solid #1a212b;background:#0b0f14;color:#9aa7b0}
.pptab.on{border-color:#ff5d4d;background:rgba(255,93,77,.1);color:#fff}
.pptab .ic{font-size:14px}.pptab .ct{font-size:10px;font-weight:700;color:#6b7681}.pptab.on .ct{color:#ffb3aa}
.pplist{display:flex;flex-direction:column;gap:8px}
.pprow{display:flex;align-items:center;gap:11px;border:1px solid #161d24;border-radius:12px;background:linear-gradient(180deg,#0c1117,#080b0f);padding:10px 12px;cursor:pointer;position:relative}
.rkn{position:absolute;top:6px;left:8px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:10px;color:#3f4a55}
.ppav{width:46px;height:46px;border-radius:50%;display:flex;align-items:flex-end;justify-content:center;font-size:20px;flex:0 0 auto;position:relative;overflow:hidden;margin-left:6px}
.ppav img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ppinfo{flex:1;min-width:0}
.ppname{font-weight:800;font-size:14px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppgame{font-size:10.5px;color:#8a99a2;font-weight:600;margin-top:1px}
.ppline{font-size:11px;color:#b6c0c7;font-weight:600;margin-top:4px}
.ppright{text-align:right;flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end}
.pppct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:26px;color:#33e991;line-height:1}.pppct .pc{font-size:15px;margin-left:1px}
.pplbl{font-size:8.5px;color:#7d8a93;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-top:1px}
.ppedge{margin-top:5px;font-size:9px;font-weight:800;color:#33e991;background:rgba(51,233,145,.12);border-radius:5px;padding:2px 6px;white-space:nowrap}
.ppwarn{border:1px solid rgba(243,185,79,.32);background:rgba(243,185,79,.08);border-radius:10px;padding:10px 12px;font-size:11px;color:#f3c66b;font-weight:600;line-height:1.45;margin-bottom:12px}.ppwarn b{color:#ffd98a}
.pprowwrap{display:block}
.pprow.tappable{cursor:pointer}
.ppchev{position:absolute;top:10px;right:11px;color:#33e991;font-size:11px;pointer-events:none}
.pprow.rowopen{border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent}
.hrcard{border:1px solid #161d24;border-top:1px dashed #20303a;border-radius:0 0 12px 12px;background:linear-gradient(180deg,#0b1016,#070a0e);padding:2px 12px 12px;margin-top:-1px}
.hcsec{padding:13px 0 4px}
.hctitle{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:#8a99a2;margin-bottom:10px;display:flex;align-items:center;gap:7px}
.hcdot{width:6px;height:6px;border-radius:50%;background:#33e991;display:inline-block}
.hcsplits{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.hcsp{position:relative;background:#0d1218;border:1px solid #18212a;border-radius:11px;padding:11px 12px}
.hcsp.act{border-color:rgba(51,233,145,.5);background:linear-gradient(180deg,rgba(51,233,145,.06),#0d1218)}
.hctag{position:absolute;top:-8px;right:10px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:9px;letter-spacing:.08em;background:#ff7a6c;color:#1a0c08;padding:2px 7px;border-radius:5px}
.hcvh{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:12px;letter-spacing:.06em;color:#8a99a2}
.hcsp.act .hcvh{color:#7cf0a8}
.hcops{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:28px;line-height:1;margin:6px 0 1px}
.hcopsl{font-size:9.5px;color:#6a7882;letter-spacing:.1em;text-transform:uppercase}
.hcr{display:flex;justify-content:space-between;gap:4px;margin-top:9px}
.hcr>div{flex:1;text-align:center}
.hcv{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px}
.hcl{font-size:9px;color:#6a7882;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}
.hchr{color:#ffd98a}
.hcthin{font-size:9.5px;color:#6a7882;font-style:italic;margin-top:8px}
.hcmut{color:#7d8a93;font-size:12px;padding:14px 4px;text-align:center}
.hcdisc{font-size:10px;color:#6a7882;text-align:center;margin-top:12px;padding:0 6px}
.hcb{color:#33e991;font-weight:800}
.ppmuted{color:#6b7681;font-size:13px;font-weight:600;padding:24px 4px;text-align:center}
.ppnote{font-size:10.5px;color:#54616b;font-weight:600;margin-top:14px;line-height:1.4}
.ppsb{display:none}
/* ---- TABLET (769-1023): old left sidebar shell ---- */
@media (min-width:769px) and (max-width:1023px){
  .ppsb{display:block}
  .ppwrap{margin-left:200px;max-width:none;padding:30px 30px 60px}
  .pptitle{font-size:40px}
  .ppsports,.pptabs{max-width:760px}
  .pplist{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
  .pprowwrap.open{grid-column:1/-1}
}
/* ---- DESKTOP (>=1024): TerminalShell provides the nav; drop the 200px margin ---- */
@media (min-width:1024px){
  .ppsb{display:none}
  .ppwrap{margin-left:0;max-width:none;padding:30px 34px 60px}
  .pptitle{font-size:40px}
  .pplist{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
}
`;
