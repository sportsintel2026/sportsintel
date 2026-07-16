// WizePicks — DESKTOP TERMINAL. Renders only at >=1024px (HomePage decides);
// mobile keeps its own layout untouched. Reads the same data HomePage already
// fetched (passed as props) — no extra API calls. All figures are real: edges,
// modelProb, conviction from /api/edges; weather/pitchers ride along on games.
// HOMEDESKTOP-PREMIUM-DARK-RESKIN-2026-06-23
// FIX-CLV-DESKTOP-OBJECT-2026-06-24
import { useState, useEffect, useRef } from "react";
import { scoresApi } from "../lib/api"; // WZ-NBA-RECORDS-2026-07-11 :: real ESPN standings for the NBA board

// ---- self-contained helpers (kept local so this file stands alone) ----
const ESPN_ALIAS = { az: "ari" };
const ESPN = (ab, lg = "mlb") => { const a = String(ab || "").toLowerCase(); const slug = lg === "mlb" ? (ESPN_ALIAS[a] || a) : a; return `https://a.espncdn.com/i/teamlogos/${lg}/500/${slug}.png`; };
const formatOdds = (a) => { if (a == null || isNaN(a)) return "—"; const n = Math.round(Number(a)); return n > 0 ? `+${n}` : `${n}`; };
const isTotal = (e) => e.side === "over" || e.side === "under";
const shortTeam = (t) => { const m = String(t).match(/[A-Z]{2,3}/); return m ? m[0] : String(t).slice(0, 3).toUpperCase(); };
const wpAbbr = (pk) => { const f = String((pk && pk.pick) || "").trim().split(/\s+/)[0]; if (/^[A-Za-z]{2,4}$/.test(f)) return f.toUpperCase(); const g = String((pk && pk.game) || "").trim().split(/\s+/)[0]; return /^[A-Za-z]{2,4}$/.test(g) ? g.toUpperCase() : ""; };
// WZ-DESKTOP-VAULT-FIX2-2026-07-11 :: line-move uses amCents (matches movers rail); props above weather; props lead with HR.
const amCents = (o) => { if (o == null || isNaN(o)) return null; const n = Number(o); return n >= 100 ? n - 100 : n <= -100 ? n + 100 : 0; };
const edgeLabel = (e) => isTotal(e) ? `${e.side === "over" ? "Over" : "Under"} ${e.line}` : (e.line != null ? `${e.teamAbbr || shortTeam(e.matchup)} ${e.line > 0 ? "+" : ""}${e.line}` : `${e.teamAbbr || shortTeam(e.matchup)} ML`);
const sideOf = (e) => e.side === "over" ? "ov" : e.side === "under" ? "un" : "ml";
const sideTag = (e) => { const s = sideOf(e); return `<span class="side ${s}">${s === "ov" ? "OVER" : s === "un" ? "UNDER" : "PICK"}</span>`; };
function oneSidePerGame(arr) { const g = new Map(); for (const e of arr || []) { const p = g.get(e.gameId); if (!p || (e.edge ?? -Infinity) > (p.edge ?? -Infinity)) g.set(e.gameId, e); } return [...g.values()]; }
const convClass = (c) => c === "HIGH" ? "high" : c === "MEDIUM" ? "med" : "low";
const DTIERS = ["NEUTRAL", "LOW", "MEDIUM", "HIGH"];
const dTierBump = (c, dir) => { const i = DTIERS.indexOf(String(c || "").toUpperCase()); if (i < 0) return c; return DTIERS[Math.max(0, Math.min(DTIERS.length - 1, i + dir))]; };
// MLB edge is a fraction (→ %); NBA ML already a %, NBA spread/totals are points.
function fmtEdge(e, sport) { const v = e.edge ?? 0; const s = v >= 0 ? "+" : ""; if (sport === "mlb") return `${s}${(v * 100).toFixed(1)}%`; /* WZ-DESKTOP-FBALL-EDGEFIX-2026-07-11 :: NFL/CFB edges are already % (like NBA ML) — do not x100 */ if (sport === "nba") { if (isTotal(e) || e.line != null) return `${s}${v.toFixed(1)}`; return `${s}${v.toFixed(1)}%`; } return `${s}${v.toFixed(1)}%`; }
function edgePct(e, sport) { const v = e.edge ?? 0; return sport !== "nba" ? v * 100 : v; }
function sparkPath(vals, w, h, pad = 2) { const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1; return vals.map((v, i) => { const x = pad + i * ((w - 2 * pad) / (vals.length - 1)); const y = h - pad - ((v - min) / rng) * (h - 2 * pad); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" "); }
function miniSpark(vals) { const w = 54, h = 20, up = vals[vals.length - 1] >= vals[0], col = up ? "#2bd47d" : "#ff5247"; return `<svg class="spark-mini" viewBox="0 0 ${w} ${h}"><path d="${sparkPath(vals, w, h)}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

function TLogo({ ab, lg = "mlb" }) {
  const [bad, setBad] = useState(false);
  if (bad || !ab) return <span className="tlogo fb">{String(ab || "?").slice(0, 3)}</span>;
  return <span className="tlogo"><img src={ESPN(ab, lg)} alt="" onError={() => setBad(true)} /></span>;
}

function Lock({ title, sub, navigate }) {
  return (
    <div className="lockwrap">
      <div className="lockblur"></div>
      <div className="lockcard">
        <div className="lk"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <div className="lt">{title}</div>
        <div className="ls">{sub}</div>
        <button onClick={() => navigate("/pricing")}>Unlock All-Access →</button>
      </div>
    </div>
  );
}

export default function HomeDesktop(props) {
  // WZ-WINNERS-REMOVED-2026-07-05 :: Winners lens removed — Edge Board is the sole board.

  const { edges, games = [], movers = [], live = [], abbrById = {}, topProps = [], propList = [], propsByType = {}, hero, hasFull, planLoaded = true, lineSeries = {}, moveByPick = {},
    wpRecord, navigate, plan = {}, sport = "mlb", setSport, marketsLive, anyLive, marketRead = [], perf = null, wpToday = [], sharpRows = [], intelGroups = [] } = props;
  const lg = sport === "mlb" ? "mlb" : sport; // WZ-DESKTOP-FBALL-2026-07-11 :: NFL/CFB render in-board
  // Real tracked-record stats for the index cards (high-conviction ROI, honest beat-close CLV).
  const perfStats = (() => { const d = perf; if (!d) return null;
    const hi = d.byConfidence && d.byConfidence.HIGH ? d.byConfidence.HIGH : null;
    const roi = (hi && hi.roi != null) ? hi.roi : (d.roi != null ? d.roi : null);
    const roiLbl = (hi && hi.roi != null) ? "high-conv" : "all picks";
    let w = 0, l = 0; if (d.byConfidence) { for (const k in d.byConfidence) { const b = d.byConfidence[k]; if (b) { w += b.wins || 0; l += b.losses || 0; } } }
    const winRate = (w + l) > 0 ? (w / (w + l) * 100) : null;
    const graded = d.n != null ? d.n : ((w + l) || null);
    // CLV can arrive as an object (e.g. { value, n } or per-range); pull the real
    // number the same way the mobile board does, else show "—". Never render raw.
    const rng = (d.ranges && (d.ranges.Season || d.ranges[Object.keys(d.ranges)[0]])) || null;
    const clvNum = (rng && typeof rng.clv === "number") ? rng.clv : (typeof d.clv === "number" ? d.clv : null);
    return { roi, roiLbl, winRate, graded, clv: clvNum };
  })();
  const [market, setMarket] = useState("ml"); // WZ-WINNERS-V2-2026-07-04 :: Edge Board leads
  const [nbaStd, setNbaStd] = useState([]);
  useEffect(() => {
    if (sport !== "nba") { setNbaStd([]); return; }
    let dead = false;
    scoresApi.getStandings("nba").then((m) => {
      if (dead || !m) return;
      const seen = new Set(); const out = [];
      for (const v of Object.values(m)) { if (v && v.abbrev && !seen.has(v.abbrev)) { seen.add(v.abbrev); out.push(v); } }
      out.sort((a, b) => { const w = (r) => parseInt(String((r && r.record) || "0-0").split("-")[0], 10) || 0; return w(b) - w(a); });
      setNbaStd(out);
    }).catch(() => {});
    return () => { dead = true; };
  }, [sport]);
  const [propTab, setPropTab] = useState("hr");
  const [propSort, setPropSort] = useState({ key: "edge", dir: -1 });
  const [sortKey, setSortKey] = useState("edge");
  const [sortDir, setSortDir] = useState(-1);
  const [si, setSi] = useState(0);
  const [clock, setClock] = useState("");

  useEffect(() => { const t = setInterval(() => { const d = new Date(); const h = ((d.getHours() + 24) % 12) || 12; setClock(`${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }).slice(0, 0)}ET`); }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (topProps.length < 2) return; const t = setInterval(() => setSi((x) => (x + 1) % Math.min(topProps.length, 6)), 3600); return () => clearInterval(t); }, [topProps.length]);

  const e = edges || {};
  const arrFor = (m) => m === "ml" ? e.moneylineEdges : m === "spread" ? e.spreadEdges : e.totalsEdges;
  // Build one row per GAME from the game's own moneyline/totals so the board shows the whole slate,
  // not just the handful the backend pre-flagged. NBA still uses its edges feed.
  const mkRow = (g) => {
    const A = g.awayAbbr || shortTeam(g.away || ""); const H = g.homeAbbr || shortTeam(g.home || "");
    const base = { gameId: g.id, _a: A, _h: H, matchup: `${A} @ ${H}` };
    if (market === "totals") {
      const t = g.totals || {}; if (t.line == null && t.overOdds == null) return null;
      const ov = { side: "over", edge: t.overEdge, odds: t.overOdds, book: t.overBook, modelProb: t.overProb, conviction: t.overConfidence, convictionScore: t.overConfidenceScore, line: t.line };
      const un = { side: "under", edge: t.underEdge, odds: t.underOdds, book: t.underBook, modelProb: t.underProb, conviction: t.underConfidence, convictionScore: t.underConfidenceScore, line: t.line };
      const best = ((ov.edge ?? -9) >= (un.edge ?? -9)) ? ov : un;
      return { ...base, ...best };
    }
    const m = g.moneyline || {}; if (m.awayOdds == null && m.homeOdds == null) return null;
    const aw = { side: "away", edge: m.awayEdge, odds: m.awayOdds, book: m.awayBook, modelProb: m.awayWinProb, conviction: m.awayConfidence, convictionScore: m.awayConfidenceScore, teamAbbr: A, line: null };
    const hm = { side: "home", edge: m.homeEdge, odds: m.homeOdds, book: m.homeBook, modelProb: m.homeWinProb, conviction: m.homeConfidence, convictionScore: m.homeConfidenceScore, teamAbbr: H, line: null };
    const best = ((aw.edge ?? -9) >= (hm.edge ?? -9)) ? aw : hm;
    return { ...base, ...best };
  };
  let rows = sport === "mlb"
    ? games.map(mkRow).filter(Boolean)
    : oneSidePerGame(arrFor(market) || []).filter((x) => x.edge != null);
  // Movement guardrail: nudge each row's conviction one tier based on its line move
  // (computed in Home.jsx, passed as moveByPick). Bounded; flag explains it.
  rows = rows.map((x) => { const mv = moveByPick[x.gameId + x.side]; const dir = mv?.dir || 0; return dir ? { ...x, _moveDir: dir, _moveFlag: mv.flag, _convAdj: dTierBump(x.conviction, dir) } : { ...x, _moveDir: 0, _moveFlag: null, _convAdj: x.conviction }; });
  rows = [...rows].sort((a, b) => {
    if (sortKey === "model") return ((a.modelProb || 0) - (b.modelProb || 0)) * sortDir;
    if (sortKey === "conv") { const r = { HIGH: 3, MEDIUM: 2, LOW: 1 }; return (((r[a._convAdj] || a.convictionScore || 0)) - ((r[b._convAdj] || b.convictionScore || 0))) * sortDir; }
    return ((a.edge ?? -9) - (b.edge ?? -9)) * sortDir;
  });
  const allPos = [...(e.moneylineEdges || []), ...(e.totalsEdges || []), ...(e.spreadEdges || [])].filter((x) => (x.edge ?? 0) > 0);
  const edgeCount = allPos.length;
  const bestEdge = hero ? fmtEdge(hero, sport) : (rows[0] ? fmtEdge(rows[0], sport) : "—");
  const liveStrip = (live || []);
  const wx = games.filter((g) => g.weather && sport === "mlb");
  const pt = games.filter((g) => g.pitchers && (g.pitchers.away || g.pitchers.home) && sport === "mlb");
  const mp = games.filter((g) => g.moneyline && (g.moneyline.awayOdds != null || g.moneyline.homeOdds != null));
  const propActive = propsByType[propTab] || [];
  let propRows = [...propActive].sort((a, b) => {
    if (propSort.key === "model") return ((a.prob || 0) - (b.prob || 0)) * propSort.dir;
    if (propSort.key === "odds") return ((Number(a.odds) || 0) - (Number(b.odds) || 0)) * propSort.dir;
    return ((a.edge ?? -9) - (b.edge ?? -9)) * propSort.dir;
  });
  const setPS = (k) => setPropSort((s) => s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: -1 });
  const pcaret = (k) => propSort.key === k ? (propSort.dir < 0 ? " ▾" : " ▴") : "";
  const wl = wpRecord ? `${wpRecord.wins}-${wpRecord.losses}${wpRecord.pushes ? `-${wpRecord.pushes}` : ""}` : "—";
  const winPct = wpRecord && (wpRecord.wins + wpRecord.losses) > 0 ? Math.round((wpRecord.wins / (wpRecord.wins + wpRecord.losses)) * 100) : null;
  const units = wpRecord ? wpRecord.units : null;

  const setSort = (k) => { if (sortKey === k) setSortDir((d) => -d); else { setSortKey(k); setSortDir(-1); } };
  const caret = (k) => sortKey === k ? <span className="ca">{sortDir < 0 ? "▼" : "▲"}</span> : null;

  // ticker tape from real edges
  const tape = allPos.slice(0, 12).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  const tapeHtml = tape.map((p) => { const up = (p.edge ?? 0) >= 0; return `<span class="tk"><span class="s">${edgeLabel(p)}</span><span class="v ${up ? "up" : "dn"}">${fmtEdge(p, sport)}</span><span class="${up ? "up" : "dn"}">${up ? "▲" : "▼"}</span></span><span class="tdot"></span>`; }).join("");

  const NAV = [
    ["BOARD", null],
    ["", "Edges", "/home", true],
    ["", "Market Price", "/odds"],
    ["", "Market Read", "/market-read"],
    ["", "Props", "/props"],
    ["TRACK", null],
    ["", "WizePlays", "/expert-picks"],
    ["", "Wize Spin", "/daily-card"],
    ["SCORES", null],
    ["", "Matchups & Scores", "/games"],
  ];

  return (
    <div className="wpterm">
      <style>{TCSS}</style>
      <div className="status">
        <div className="brand"><div className="logo">Wize<span className="b">Picks</span></div><div className="tag">TERMINAL</div></div>
        <div className="tape"><div className="tape-track" dangerouslySetInnerHTML={{ __html: tapeHtml + tapeHtml }} /></div>
        <div className="sright">
          <span className={"mkt" + (marketsLive ? "" : " off")}><span className="ldot" /> MARKETS {marketsLive ? "LIVE" : "CLOSED"}</span>
          <span className="clock">{clock || "—"}</span>
          <div className="avatar" onClick={() => navigate("/settings")}>{(plan.email || "R").slice(0, 1).toUpperCase()}</div>
        </div>
      </div>

      <div className="body">
        <nav className="nav">
          {NAV.map((it, i) => it[1] === null
            ? <div key={i} className="grp">{it[0]}</div>
            : <a key={i} className={it[3] ? "on" : ""} onClick={() => navigate(it[2])}><span className="i">{it[0]}</span>{it[1]}</a>)}
          <div className="spacer" />
          <div className="upsell">
            <div className="h">{hasFull ? "All-Access" : "Go All-Access"}</div>
            <div className="d">{hasFull ? "Your plan is active — every edge unlocked." : "Every edge, prop & live play — from $7/wk."}</div>
            <button onClick={() => navigate(hasFull ? "/settings" : "/pricing")}>{hasFull ? "Manage plan" : "Unlock — from $7/wk"}</button>
          </div>
        </nav>

        <div className="content">
          <div className="maintop">
            <div><h1>Today's Board</h1><div className="sub">{sport === "mlb" ? games.length : rows.length} {sport === "mlb" ? "games" : "edges"} · {sport.toUpperCase()} · {sport === "nhl" ? "season opens — model arrives with games" : (sport === "nfl" || sport === "cfb") ? "market live · model preview" : "model live"}</div></div>
            <div className="sportbar">
              {[["MLB", "mlb"], ["NBA", "nba"], ["NFL", "nfl"], ["NHL", "nhl"], ["CFB", "cfb"], ["UFC", "ufc"]].map(([lb, k]) => (
                <div key={k} className={"sp" + (sport === k ? " on" : "")} onClick={() => (k === "ufc") ? navigate("/ufc") : (setSport && setSport(k))} /* WZ-DESKTOP-NHL-INBOARD-2026-07-11 :: all sports switch in-board; only UFC navigates */><span className="d" />{lb}{k === "ufc" ? <span className="spnew">NEW</span> : null}</div>
              ))}
            </div>
          </div>

          {sport === "nhl" ? (
            <div className="provbar">NHL board opens at the season &mdash; the model posts edges here from day one. Live scores are under Matchups &amp; Scores.</div>
          ) : null}

          {(sport === "nfl" || sport === "cfb") ? (
            <div className="provbar">{sport.toUpperCase()} preview &mdash; book prices are live, but the model behind these edges is uncalibrated (2025 seed). Treat edges as directional until the season calibrates.</div>
          ) : null}

          {/* INDEX ROW */}
                    <div className="indices">
            {/* WZ-EDGES-WIZEPLAYS-KPI-2026-07-10 :: desktop index row leads with the real WizePlays record (wl/winPct/units from wpRecord). */}
            <div className="idx lead"><div className="k">WizePlays</div><div className="v num">{wl}</div><div className="chg">{wpRecord && (wpRecord.wins+wpRecord.losses+wpRecord.pushes)>0 ? "W-L-P · all graded" : "tracking"}</div></div>
            <div className="idx green"><div className="k">Win Rate</div><div className="v num">{winPct != null ? `${winPct}%` : "—"}</div><div className="chg">{wpRecord ? `${wpRecord.wins+wpRecord.losses+wpRecord.pushes} graded` : "tracking"}</div></div>
            <div className="idx teal"><div className="k">Units</div><div className="v num">{units != null ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}u` : "—"}</div><div className="chg">all plays</div></div>
            <div className="idx purple"><div className="k">Edges Live</div><div className="v num">{edgeCount}</div><div className="chg">{market.toUpperCase()} board · {rows.length} shown</div></div>
          </div>

          {/* WZ-DESKTOP-TOPPLAY-2026-07-15 :: featured Top Play at the top of the board column, per-sport
              aware, SAME 2% floor + pick'em logic as mobile. Calibrated (mlb): >=2% = TOP PLAY, <2% = PICK'EM.
              Provisional (nfl/cfb): MODEL PREVIEW, directional (uncalibrated). NHL/off-season or no edge yet:
              coming-soon. Gated to All-Access like the rest of the picks. Vault-styled (no mobile glow). */}
          {(() => {
            if (!hasFull) return (
              <div className="panel topplay tp-muted">
                <Lock title={"Today\u2019s top play is All-Access"} sub={<>The model{"\u2019"}s #1 edge, every day. <b>From $7/wk</b></>} navigate={navigate} />
              </div>
            );
            const prov = sport === "nfl" || sport === "cfb";
            if (!hero) return (
              <div className="panel topplay tp-muted">
                <div className="phead"><div className="t"><span className="tp-dot" />TOP PLAY</div></div>
                <div className="tp-empty">{sport === "nhl" ? "NHL board opens at the season \u2014 the model posts its top play here from day one." : sport === "nba" ? "NBA board goes live at tip-off." : "No play yet \u2014 the top edge posts as tonight\u2019s lines drop."}</div>
              </div>
            );
            const prv = edgePct(hero, sport);
            const noEdge = !prov && !(prv >= 2);
            const ser = lineSeries[hero.gameId + hero.side];
            let lm = null; if (ser && ser.length >= 2) { const a0 = amCents(ser[0]), a1 = amCents(ser[ser.length - 1]); if (a0 != null && a1 != null) lm = Math.round(a1 - a0); }
            const model = hero.modelProb != null ? Math.round(hero.modelProb * 100) : null;
            const conv = String(hero._convAdj || hero.conviction || "").toUpperCase();
            const heroGame = abbrById[hero.gameId] ? `${abbrById[hero.gameId].a} @ ${abbrById[hero.gameId].h}` : (hero.matchup || "");
            const play = !prov && !noEdge;
            const eyebrow = prov ? "MODEL PREVIEW \u00b7 DIRECTIONAL" : noEdge ? "PICK\u2019EM \u00b7 NO EDGE" : "TOP PLAY";
            const rightNote = prov ? "uncalibrated \u00b7 directional" : noEdge ? "coin flip \u00b7 not a play" : "highest edge on the board";
            return (
              <div className={"panel topplay " + (play ? "tp-play" : "tp-muted")}>
                <div className="phead"><div className="t"><span className="tp-dot" />{eyebrow}</div><div className="right">{rightNote}</div></div>
                <div className="tp-body">
                  <div><div className="tp-pick">{edgeLabel(hero)}</div><div className="tp-match">{heroGame}</div></div>
                  <div className="tp-win"><div className="tp-pct">{model != null ? model + "%" : "\u2014"}</div><div className="tp-k">MODEL TO WIN</div></div>
                </div>
                <div className="tp-stats">
                  <div className="tp-cell"><div className="v">{noEdge ? "NO EDGE" : fmtEdge(hero, sport)}</div><div className="k">{prov ? "MODEL LEAN" : "VALUE"}</div></div>
                  <div className="tp-cell"><div className="v">{hero.odds != null ? formatOdds(hero.odds) : "\u2014"}</div><div className="k">ODDS</div></div>
                  <div className="tp-cell"><div className="v">{noEdge ? "COIN FLIP" : (conv || "\u2014")}</div><div className="k">{noEdge ? "MODEL READ" : "CONVICTION"}</div></div>
                  <div className="tp-cell"><div className={"v " + (lm == null ? "" : lm > 0 ? "up" : "dn")}>{lm == null ? "flat" : (lm > 0 ? "\u25B2 " : "\u25BC ") + Math.abs(lm) + "\u00A2"}</div><div className="k">LINE MOVE</div></div>
                </div>
                {sport === "mlb" && hero.gameId ? <div className="tp-foot" onClick={() => navigate(`/game/mlb/${hero.gameId}`)}>Full matchup breakdown &rarr;</div> : null}
              </div>
            );
          })()}

          {/* WZ-DESKTOP-WIZEPLAYS-PANEL-2026-07-11 :: record always visible; today's curated picks gated to All-Access (matches mobile). Reads wpToday (added prop) + wpRecord. */}
          <div className="panel wpsec">
            <div className="phead"><div className="t">WizePlays</div><span className="wpbadge">CURATED</span><span className="wplock">PICKS · ALL-ACCESS</span><div className="right" onClick={() => navigate("/expert-picks")} style={{ cursor: "pointer" }}>record always visible · picks unlock with All-Access &rarr;</div></div>
            <div className="wprec">
              <div className="wprl"><span className="wpk">Record</span><span className="wpv">{wl}</span></div>
              <div className="wprl"><span className="wpk">Units</span><span className={"wpv " + (units != null && units >= 0 ? "up" : units != null ? "dn" : "")}>{units != null ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}u` : "\u2014"}</span></div>
              <div className="wprl"><span className="wpk">Win rate</span><span className="wpv">{winPct != null ? `${winPct}%` : "\u2014"}</span></div>
            </div>
            {!hasFull
              ? <Lock title="WizePlays picks are All-Access" sub={<>Every curated play, every day &mdash; losses included. <b>From $7/wk</b></>} navigate={navigate} />
              : wpToday.length > 0
                ? wpToday.map((pk, i) => (
                    <div className="wprow" key={i} onClick={() => navigate("/expert-picks")}>
                      <span className="wplogo">{wpAbbr(pk) || "\u2022"}</span>
                      <div className="wpmid"><div className="wpp">{pk.pick}</div>{pk.game && <div className="wpg">{pk.game}</div>}</div>
                      {pk.odds != null && <div className="wpo">{formatOdds(pk.odds)}</div>}
                    </div>))
                : <div className="empty">No active WizePlays right now &mdash; curated plays post before first pitch.</div>}
          </div>

          {sport === "nba" && nbaStd.length > 0 ? (
            <div className="panel nbarec">
              <div className="phead"><div className="t">NBA · Team Records</div><div className="right">standings · board goes live at tip-off</div></div>
              <table>
                <thead><tr><th>Team</th><th className="c">Record</th><th className="c">Streak</th><th className="c">Last 10</th></tr></thead>
                <tbody>
                  {nbaStd.map((t, i) => (
                    <tr key={i}>
                      <td><span className="teamab">{t.abbrev}</span></td>
                      <td className="c num">{t.record || "\u2014"}</td>
                      <td className="c"><span className={"strk " + ((t.streakValue || 0) >= 0 ? "up" : "dn")}>{t.streak || "\u2014"}</span></td>
                      <td className="c num">{t.lastTen || "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* EDGE BOARD */}
          <div className="panel">
            <div className="phead"><div className="t">Edge Board</div>
              <div className="seg">{[["ml", "Moneyline"], ["totals", "Totals"], ...(sport !== "mlb" ? [["spread", "Spread"]] : [])].map(([m, lb]) => (
                <b key={m} className={market === m ? "on" : ""} onClick={() => setMarket(m)}>{lb}</b>))}</div>
              <div className="right"><span className="ldot" />click a column to sort</div>
            </div>
            {!planLoaded
              ? <div className="empty">Loading the board…</div>
              : !hasFull
              ? <Lock title="Edges are an All-Access feature" sub={<>Every edge across the slate, ranked by conviction. <b>From $7/wk</b></>} navigate={navigate} />
              : rows.length === 0
                ? <div className="empty">No {market === "ml" ? "moneyline" : market === "spread" ? "spread" : "totals"} edges on the board yet — fills in closer to first pitch.</div>
                : (
                  <table className="tbl">
                    <thead><tr>
                      <th>Matchup</th><th>Model Pick</th>
                      <th className="r sortable" onClick={() => setSort("model")}>Model %{caret("model")}</th>
                      <th className="c">Best Book</th>
                      <th className="c">Line Move</th>
                      <th className="r sortable" onClick={() => setSort("edge")}>Edge{caret("edge")}</th>
                      <th className="c sortable" onClick={() => setSort("conv")}>Conviction{caret("conv")}</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((x, i) => {
                        const ab = abbrById[x.gameId] || {}; const a = x._a || ab.a || x.teamAbbr || shortTeam(x.matchup); const h = x._h || ab.h || "";
                        const ep = edgePct(x, sport); const pos = ep >= 0; const hasE = x.edge != null;
                        return (
                          <tr key={x.gameId + x.side + i} className="click" onClick={() => navigate(`/game/${lg}/${x.gameId}`)}>
                            <td><div className="matchup"><span className="logos"><TLogo ab={a} lg={lg} />{h && <TLogo ab={h} lg={lg} />}</span>
                              <span className="mu"><span className="mua">{a}{h ? <span className="at"> @ </span> : ""}{h}</span></span></div></td>
                            <td><div className="pick" dangerouslySetInnerHTML={{ __html: sideTag(x) + edgeLabel(x) }} /></td>
                            <td className="model-p">{x.modelProb != null ? `${Math.round(x.modelProb * 100)}%` : "—"}</td>
                            <td className="book">{formatOdds(x.odds)}{x.book ? <><br /><span className="bk">{x.book}</span></> : ""}</td>
                            <td className="c">{(() => { const s = lineSeries[x.gameId + x.side]; if (!s || s.length < 2) return <span className="mvflat">flat</span>; const a0 = amCents(s[0]), a1 = amCents(s[s.length - 1]); if (a0 == null || a1 == null) return <span className="mvflat">flat</span>; const d = Math.round(a1 - a0); if (d === 0) return <span className="mvflat">flat</span>; const up = d > 0; return <span className={"mvchip " + (up ? "up" : "dn")}>{(up ? "\u25B2 " : "\u25BC ") + Math.abs(d) + "\u00A2"}</span>; })()}</td>
                            <td className="edge-cell">{hasE ? <><div className={"edge-v " + (pos ? "up" : "dn")}>{fmtEdge(x, sport)}</div><div className="edge-bar"><i style={{ width: Math.min(100, Math.abs(ep) * 12 + 8) + "%" }} /></div></> : <span className="nomove">no edge</span>}</td>
                            <td className="c"><span className={"conv " + convClass(x._convAdj || x.conviction)}>{(x._convAdj || x.conviction || "—")}{x._moveDir > 0 ? " ↑" : x._moveDir < 0 ? " ↓" : ""}</span>{x._moveFlag === "against" && <div className="dmove against"> moving against</div>}{x._moveFlag === "toward" && <div className="dmove toward">↘ money in</div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
          </div>

          {/* MARKET READ — what the books are collectively saying (win market) */}
          {sport === "mlb" && Array.isArray(marketRead) && marketRead.filter(g => g.win).length > 0 && (
            <div className="panel">
              <div className="phead"><div className="t">Market Read</div><div className="right" onClick={() => navigate("/market-read")} style={{ cursor: "pointer" }}>who the books lean · all markets →</div></div>
              {!hasFull
                ? <Lock title="Market Read is an All-Access feature" sub={<>See what every book is saying on every game. <b>From $7/wk</b></>} navigate={navigate} />
                : (
                  <table className="tbl mrtbl">
                    <thead><tr><th>Matchup</th><th>Market read</th><th className="c">Win %</th><th className="c">Confidence</th><th className="c">Model</th></tr></thead>
                    <tbody>
                      {marketRead.filter(g => g.win).map((g, i) => {
                        const w = g.win;
                        const td = w.tier === "Strong" ? "#1D9E75" : w.tier === "Soft" ? "#f3b94f" : "#ff5247";
                        const verb = w.tier === "Split" ? "split on" : w.favProb >= 70 ? "heavily on" : w.tier === "Strong" ? "confident in" : "leaning";
                        return (
                          <tr key={g.gameId || i} className="click" onClick={() => navigate("/market-read")}>
                            <td className="mu">{g.awayAbbr} <span className="at">@</span> {g.homeAbbr}</td>
                            <td className="mread">{w.tier === "Split" ? <>Books can’t agree on the <b>{w.favTeam}</b></> : <>Market {verb} the <b>{w.favTeam}</b></>}</td>
                            <td className="c num">{w.favProb}%</td>
                            <td className="c"><span className="mrtag" style={{ color: td }}><span className="dot" style={{ background: td }} />{w.tier}</span></td>
                            <td className="c">{w.model ? (w.model.agrees ? <span className="magree">✓</span> : <span className="mdiff"></span>) : <span className="mnone">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
            </div>
          )}

          {/* WZ-SHARP-EDGE-DESKTOP-2026-07-14 :: model-vs-Pinnacle disagreements as a Vault table, sibling to Market Read. MLB-gated; reads the same sharpRows the mobile card derives. */}
          {sport === "mlb" && Array.isArray(sharpRows) && sharpRows.length > 0 && (
            <div className="panel">
              <div className="phead">
                <div className="t"><span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--teal)", boxShadow: "0 0 8px rgba(63,203,145,.6)" }} />Sharp Edge</div>
                <div className="right">model vs Pinnacle · the sharpest book</div>
              </div>
              <table className="tbl">
                <thead><tr><th>Matchup</th><th>Model favors</th><th className="c">Model %</th><th className="c">Pinnacle %</th><th className="r">Edge (pp)</th></tr></thead>
                <tbody>
                  {sharpRows.map((r, i) => {
                    const nick = (t) => { const w = String(t || "").trim().split(/\s+/); return w[w.length - 1] || String(t || ""); };
                    const parts = String(r.game || "").split(" @ ");
                    const away = (parts[0] || "").trim(), home = (parts[1] || "").trim();
                    const modelHigh = (r.deltaAwayPP || 0) > 0; // >0 => model rates HOME higher than Pinnacle
                    const favTeam = modelHigh ? home : away;
                    const modelPct = modelHigh ? (r.modelAnchor && r.modelAnchor.fairHomePct) : (r.modelAnchor && r.modelAnchor.fairAwayPct);
                    const pinPct = modelHigh ? (r.pinnacle && r.pinnacle.fairHomePct) : (r.pinnacle && r.pinnacle.fairAwayPct);
                    const gap = Math.abs(r.deltaAwayPP || 0);
                    return (
                      <tr key={i}>
                        <td className="mua">{nick(away)} <span className="at">@</span> {nick(home)}</td>
                        <td><b style={{ color: "var(--tx)" }}>{nick(favTeam)}</b> <span style={{ color: "var(--mut)", fontSize: 11 }}>ML</span></td>
                        <td className="c num" style={{ color: "var(--model)", fontWeight: 600 }}>{modelPct != null ? modelPct + "%" : "-"}</td>
                        <td className="c num" style={{ color: "var(--goldsoft)", fontWeight: 600 }}>{pinPct != null ? pinPct + "%" : "-"}</td>
                        <td className="r num" style={{ color: "var(--up)", fontWeight: 600 }}>+{gap.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "var(--mut2)", padding: "9px 15px", borderTop: "1px solid var(--line)", fontStyle: "italic" }}>Where our model most disagrees with Pinnacle's de-vigged line. Read-only, not bet advice.</div>
            </div>
          )}

          {/* WZ-GAMEINTEL-DESKTOP-2026-07-15 :: GAME INTEL as a Vault panel, sibling to Sharp Edge.
              Same per-game clusters + OUR READ angles as mobile, computed once in Home.jsx and passed
              down as intelGroups. MLB/NFL/CFB, scoped to the active sport; UFC keeps its own. */}
          {(sport === "mlb" || sport === "nfl" || sport === "cfb") && Array.isArray(intelGroups) && intelGroups.length > 0 && (
            <div className="panel">
              <div className="phead">
                <div className="t"><span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", boxShadow: "0 0 8px rgba(201,168,106,.55)" }} />Game Intel</div>
                <div className="right">what changes the bet</div>
              </div>
              <div style={{ padding: "6px 0 8px" }}>
                {intelGroups.map((grp, gi) => (
                  <div key={gi} style={{ padding: "12px 15px 2px", borderTop: gi ? "1px solid var(--line)" : "none" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".6px", color: "var(--mut2)", textTransform: "uppercase", marginBottom: 8 }}>{grp.gl}</div>
                    {grp.items.map((it, i) => (
                      <div key={i} style={{ padding: "0 0 11px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: it.c, boxShadow: `0 0 8px ${it.c}66`, flex: "0 0 auto" }} />
                          <span style={{ fontFamily: "var(--disp)", fontWeight: 800, fontSize: 10.5, letterSpacing: ".5px", color: "var(--amber)", textTransform: "uppercase", flex: "0 0 auto" }}>{it.tag}</span>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.tx}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--mut)", marginTop: 5, paddingLeft: 17, lineHeight: 1.4 }}>{it.rd}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PLAYER PROPS */}
          <div className="panel">
            <div className="phead">
              <div className="t">Player Props</div>
              <div className="ptabs">
                {[["hr", "Home Runs"], ["hits", "Hits"], ["ks", "Strikeouts"]].map(([k, lb]) => (
                  <button key={k} className={"ptab" + (propTab === k ? " on" : "")} onClick={() => setPropTab(k)}>{lb}</button>
                ))}
              </div>
            </div>
            {!planLoaded
              ? <div className="empty">Loading…</div>
              : !hasFull
              ? <Lock title="Player props are an All-Access feature" sub={<>Model probabilities on every batter &amp; pitcher prop. <b>From $7/wk</b></>} navigate={navigate} />
              : propRows.length === 0
              ? <div className="empty">No {propTab === "hr" ? "home run" : propTab === "ks" ? "strikeout" : "hits"} props posted yet — they fill in closer to first pitch.</div>
              : <>
                {propTab === "hr" && <div className="pnote">Home run props are longshots — ranked by model chance to homer, not +EV. Bet small.</div>}
                <table className="tbl">
                  <thead><tr>
                    <th>Player</th><th>Matchup</th><th>Prop</th>
                    <th className="r sortable" onClick={() => setPS("model")}>{propTab === "hr" ? "To Homer" : "Model %"}{pcaret("model")}</th>
                    <th className="r sortable" onClick={() => setPS("odds")}>Odds{pcaret("odds")}</th>
                    {propTab !== "hr" && <th className="r sortable" onClick={() => setPS("edge")}>Edge{pcaret("edge")}</th>}
                  </tr></thead>
                  <tbody>
                    {propRows.map((p, i) => {
                      const over = !p.side || /over|^o/i.test(String(p.side));
                      const ev = sport === "mlb" ? (p.edge ?? 0) * 100 : (p.edge ?? 0);
                      return (
                        <tr key={p.k || i} className="click" onClick={() => navigate("/props")}>
                          <td><div className="pp"><span className="pph">{p.id ? <img src={`https://midfield.mlbstatic.com/v1/people/${p.id}/spots/120`} alt="" onError={(ev2) => { ev2.currentTarget.style.display = "none"; }} /> : ""}</span><span className="ppn">{p.name}</span></div></td>
                          <td className="dim">{p.game || p.team || "—"}</td>
                          <td><span className={"ptag " + (over ? "ov" : "un")}>{p.betSide || p.market}</span></td>
                          <td className="model-p">{p.prob != null ? `${Math.round(p.prob * 100)}%` : "—"}</td>
                          <td className="book">{formatOdds(p.odds)}</td>
                          {propTab !== "hr" && <td className="edge-cell"><div className={"edge-v " + (ev >= 0 ? "up" : "dn")}>{ev >= 0 ? "+" : ""}{ev.toFixed(1)}%</div><div className="edge-bar"><i style={{ width: Math.min(100, Math.abs(ev) * 12 + 8) + "%" }} /></div></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>}
          </div>

          {/* WEATHER FACTOR */}
          {wx.length > 0 && (
            <div className="panel">
              <div className="phead"><div className="t">Weather Factor</div><div className="right">first-pitch forecast → run environment</div></div>
              <table className="tbl">
                <thead><tr><th>Matchup</th><th className="c">Temp</th><th>Wind</th><th className="c">Sky</th><th className="c">Park RF</th><th>Model Read</th></tr></thead>
                <tbody>
                  {wx.map((g, i) => {
                    const w = g.weather; const a = g.awayAbbr || shortTeam(g.away); const h = g.homeAbbr || shortTeam(g.home);
                    const tC = w.tempEffect === "hot" ? "hot" : w.tempEffect === "cold" ? "cold" : "mild";
                    const wc = w.windEffect === "out" ? "out" : w.windEffect === "in" ? "in" : "cross";
                    const wAr = w.windEffect === "out" ? "↗" : w.windEffect === "in" ? "↘" : "→";
                    const rf = g.parkRunFactor; const rfc = rf > 1.01 ? "up" : rf < 0.99 ? "dn" : "";
                    return (
                      <tr key={g.id || i}>
                        <td><div className="matchup"><span className="logos"><TLogo ab={a} /><TLogo ab={h} /></span><span className="mu"><span className="mua">{a}<span className="at"> @ </span>{h}</span></span></div></td>
                        {w.indoor
                          ? <><td className="c"><span className="dome">roof closed</span></td><td><span className="dome">no wind</span></td><td className="c"><span className="sky"></span></td></>
                          : <><td className="c"><span className={"temp " + tC}>{w.tempF != null ? `${w.tempF}°` : "—"}</span></td>
                            <td><span className={"wind " + wc}><span className="war">{wAr}</span>{w.windMph != null ? `${w.windMph} mph` : "calm"}</span></td>
                            <td className="c"><span className="sky">{w.isRaining ? "Rain" : "Clear"}</span></td></>}
                        <td className="c">{rf != null ? <span className={"rf " + rfc}>{rf.toFixed(2)}×</span> : "—"}</td>
                        <td className="wsum">{w.summary || w.conditions || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="footnote">Sample of the desktop terminal · all figures live from your models. Mobile layout unchanged.</div>
        </div>

        {/* RIGHT RAIL — live, movers, spotlight, conviction mix */}
        <aside className="rail">
          {liveStrip.length > 0 && (
            <div className="panel">
              <div className="phead"><div className="t">Live</div><div className="right"><span className="ldot" />{liveStrip.length} now</div></div>
              <div className="rlive">
                {liveStrip.map((g, i) => {
                  const info = abbrById[g.gameId] || {}; const a = info.a || shortTeam(g.away || ""); const h = info.h || shortTeam(g.home || "");
                  const half = g.half || g.topBottom || ""; const inn = g.inning != null ? `${half} ${g.inning}${g.outs != null ? ` · ${g.outs}o` : ""}` : (g.statusDetail || "Live");
                  return (
                    <div key={g.gameId || i} className="rlg" onClick={() => navigate(hasFull && g.gameId ? `/game/mlb/${g.gameId}` : "/pricing")}>
                      <div className="rlgh"><span className="lst"><span className="rd" />LIVE</span><span className="linn">{inn}</span></div>
                      <div className="ltm"><div className="ln"><TLogo ab={a} />{a}</div><div className="lsc">{g.awayScore != null ? g.awayScore : "·"}</div></div>
                      <div className="ltm"><div className="ln"><TLogo ab={h} />{h}</div><div className="lsc">{g.homeScore != null ? g.homeScore : "·"}</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="phead"><div className="t">Market Movers</div></div>
            {!planLoaded
              ? <div className="empty">Loading…</div>
              : !hasFull
              ? <Lock title="Movers locked" sub={<><b>From $7/wk</b></>} navigate={navigate} />
              : movers.filter((m) => m._delta != null).length === 0
                ? <div className="empty">Line moves fill in as books post.</div>
                : <div className="rmv">
                  {movers.filter((m) => m._delta != null).slice(0, 7).map((m, i) => { const up = m._delta > 0; return (
                    <div key={i} className={"rmvr " + (up ? "up" : "dn")}>
                      <div className="mar">{up ? "▲" : "▼"}</div>
                      <div className="minfo"><div className="ml">{edgeLabel(m)}</div><div className="mg">{m.matchup || ""}</div></div>
                      <div className="mchg"><div className="mpx">{formatOdds(m._now)}</div><div className="md">{up ? "+" : "−"}{Math.abs(m._delta)}¢</div></div>
                    </div>
                  ); })}
                </div>}
          </div>

          <div className="panel grow">
            <div className="phead"><div className="t">Market Price</div><div className="right">best price</div></div>
            {mp.length === 0
              ? <div className="empty">Prices fill in as books post.</div>
              : <div className="mplist">
                {mp.map((g, i) => {
                  const a = g.awayAbbr || shortTeam(g.away); const h = g.homeAbbr || shortTeam(g.home);
                  const ml = g.moneyline || {}; const to = g.totals || {};
                  return (
                    <div key={g.id || i} className="mprow" onClick={() => navigate("/odds")}>
                      <div className="mptop"><span className="mpteams"><TLogo ab={a} /><TLogo ab={h} /><span className="mpmu">{a} <span className="at">@</span> {h}</span></span>
                        {to.line != null && <span className="mptot">O/U {to.line}</span>}</div>
                      <div className="mpprices">
                        <span className="mpp"><span className="lbl">{a}</span><span className="num">{ml.awayOdds != null ? formatOdds(ml.awayOdds) : "—"}</span></span>
                        <span className="mpp"><span className="lbl">{h}</span><span className="num">{ml.homeOdds != null ? formatOdds(ml.homeOdds) : "—"}</span></span>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

const TCSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Manrope:wght@400;500;600;700;800&display=swap');
.wpterm{--ink:#101013;--panel:#17171B;--line:rgba(201,168,106,.14);--line2:rgba(255,255,255,.06);--teal:#3FCB91;--up:#46E0A9;--dn:#E2655C;--model:#C08BFF;--amber:#C9A86A;--goldsoft:#D8BE8C;--goldbg:rgba(201,168,106,.10);--goldln:rgba(201,168,106,.30);--cold:#7FB6E6;--tx:#EDEBE6;--mut:#9A958A;--mut2:#6A6459;--mono:'IBM Plex Mono',ui-monospace,monospace;--disp:'Fraunces',Georgia,serif;--serif:'Fraunces',Georgia,serif;
  position:relative;min-height:100vh;width:100%;background:radial-gradient(130% 70% at 50% -8%,rgba(201,168,106,.06),transparent 55%),var(--ink);color:var(--tx);font-family:'Manrope',system-ui,sans-serif;display:flex;flex-direction:column}
.wpterm .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.wpterm .status{position:sticky;top:0;z-index:30;flex:0 0 52px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;height:52px;padding:0 18px;border-bottom:1px solid var(--line);background:#0E1013}
.wpterm .brand{display:flex;align-items:center;gap:9px}
.wpterm .logo{font-family:var(--serif);font-weight:600;font-size:23px;letter-spacing:-.3px}.wpterm .logo .b{color:var(--amber)}
.wpterm .tag{font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--mut);border:1px solid var(--line2);border-radius:4px;padding:2px 6px}
.wpterm .tape{overflow:hidden;position:relative;height:100%;display:flex;align-items:center;border-left:1px solid var(--line);border-right:1px solid var(--line)}
.wpterm .tape::before,.wpterm .tape::after{content:"";position:absolute;top:0;bottom:0;width:46px;z-index:2;pointer-events:none}
.wpterm .tape::before{left:0;background:linear-gradient(90deg,#090b12,transparent)}.wpterm .tape::after{right:0;background:linear-gradient(270deg,#090b12,transparent)}
.wpterm .tape-track{display:flex;gap:28px;white-space:nowrap;animation:wptape 40s linear infinite;padding-left:28px}
.wpterm .tape:hover .tape-track{animation-play-state:paused}
@keyframes wptape{to{transform:translateX(-50%)}}
.wpterm .tk{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600}
.wpterm .tk .s{font-family:var(--disp);font-weight:700;font-size:14px;color:#cfd7e2}.wpterm .tk .v{font-family:var(--mono);font-size:12px}
.wpterm .tk .up,.wpterm .up{color:var(--up)}.wpterm .tk .dn,.wpterm .dn{color:var(--dn)}.wpterm .tdot{width:4px;height:4px;border-radius:50%;background:var(--mut2)}
.wpterm .sright{display:flex;align-items:center;gap:13px}
.wpterm .mkt{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.4px;color:#bfe7d6;border:1px solid rgba(43,212,125,.3);background:rgba(43,212,125,.07);border-radius:999px;padding:5px 11px}
.wpterm .mkt.off{color:var(--mut);border-color:var(--line2);background:transparent}
.wpterm .ldot{width:7px;height:7px;border-radius:50%;background:var(--up);animation:wppulse 1.8s infinite}
.wpterm .mkt.off .ldot{background:var(--mut2);animation:none}
@keyframes wppulse{0%{box-shadow:0 0 0 0 rgba(43,212,125,.5)}70%{box-shadow:0 0 0 7px rgba(43,212,125,0)}100%{box-shadow:0 0 0 0 rgba(43,212,125,0)}}
.wpterm .clock{font-family:var(--mono);font-size:12px;color:var(--mut)}
.wpterm .avatar{width:30px;height:30px;border-radius:8px;background:#1B2025;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:var(--mut);cursor:pointer}
.wpterm .body{flex:1 0 auto;display:grid;grid-template-columns:clamp(176px,11vw,210px) minmax(0,1fr) clamp(286px,22vw,360px);align-items:start}
.wpterm .nav{position:sticky;top:52px;align-self:start;height:calc(100vh - 52px);border-right:1px solid var(--line);background:#080a11;display:flex;flex-direction:column;padding:12px 10px;gap:3px;overflow:auto}
.wpterm .nav .grp{font-size:9.5px;font-weight:800;letter-spacing:1.4px;color:var(--mut2);padding:12px 10px 5px}
.wpterm .nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:#aeb9c8;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;position:relative}
.wpterm .nav a .i{width:17px;text-align:center;font-size:14px}
.wpterm .nav a:hover{background:#0e1320;color:#fff}
.wpterm .nav a.on{background:rgba(201,168,106,.1);color:var(--tx);border-color:rgba(201,168,106,.32)}
.wpterm .nav a.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--teal)}
.wpterm .nav .spacer{flex:1}
.wpterm .nav .upsell{margin:8px 4px 4px;border:1px solid rgba(201,168,106,.28);border-radius:11px;background:rgba(201,168,106,.05);padding:12px}
.wpterm .nav .upsell .h{font-family:var(--disp);font-weight:800;font-size:16px;color:#cdbcff}
.wpterm .nav .upsell .d{font-size:10.5px;color:var(--mut);margin:4px 0 9px;line-height:1.4}
.wpterm .nav .upsell button{width:100%;border:0;border-radius:8px;background:var(--teal);color:#04130d;font-weight:800;font-size:12px;padding:8px;cursor:pointer;font-family:inherit}
.wpterm .content{padding:clamp(11px,0.95vw,15px) clamp(12px,1.2vw,18px) 40px;display:flex;flex-direction:column;gap:clamp(10px,0.9vw,13px);min-width:0}
.wpterm .content::-webkit-scrollbar,.wpterm .nav::-webkit-scrollbar,.wpterm .strip::-webkit-scrollbar,.wpterm .mvstrip::-webkit-scrollbar{width:9px;height:8px}
.wpterm .content::-webkit-scrollbar-thumb,.wpterm .nav::-webkit-scrollbar-thumb,.wpterm .strip::-webkit-scrollbar-thumb,.wpterm .mvstrip::-webkit-scrollbar-thumb{background:#1a2233;border-radius:6px}
.wpterm .maintop{display:flex;align-items:flex-end;justify-content:space-between}
.wpterm .maintop h1{font-family:var(--disp);font-weight:800;font-size:clamp(20px,1.7vw,26px)}
.wpterm .maintop .sub{font-size:12px;color:var(--mut);margin-top:1px}
.wpterm .sportbar{display:flex;gap:5px}
.wpterm .sportbar .sp{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--mut);padding:7px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer}
.wpterm .sportbar .sp.on{color:#fff;border-color:var(--line2);background:#111726}.wpterm .sportbar .sp.on .d{background:var(--up)}
.wpterm .sportbar .sp .d{width:6px;height:6px;border-radius:50%;background:var(--mut2)}
.wpterm .indices{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}
.wpterm .idx{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:12px 14px}
.wpterm .idx .k{font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--mut);text-transform:uppercase}
.wpterm .idx .v{font-family:var(--mono);font-weight:600;font-size:clamp(20px,1.8vw,27px);line-height:1.05;margin-top:5px}
.wpterm .idx .v.lockv{font-size:22px}
.wpterm .idx .chg{font-family:var(--mono);font-size:11px;font-weight:600;margin-top:3px;color:var(--mut)}
.wpterm .idx.teal .v{color:var(--up)}.wpterm .idx.green .v{color:var(--tx)}.wpterm .idx.amber .v{color:var(--amber)}.wpterm .idx.purple .v{color:var(--tx)}
.wpterm .panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.wpterm .topplay{margin-top:14px}
.wpterm .topplay.tp-play{border-color:var(--goldln);background:linear-gradient(180deg,var(--goldbg),var(--panel))}
.wpterm .topplay .phead .t .tp-dot{width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 8px rgba(201,168,106,.55);display:inline-block}
.wpterm .topplay.tp-muted .phead .t{color:var(--mut)}
.wpterm .topplay.tp-muted .phead .t .tp-dot{background:var(--mut2);box-shadow:none}
.wpterm .tp-body{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:16px 18px 8px}
.wpterm .tp-pick{font-family:var(--disp);font-weight:800;font-size:clamp(20px,2vw,30px);color:var(--tx);line-height:1.05}
.wpterm .tp-match{font-family:var(--mono);font-size:12px;color:var(--mut);margin-top:6px;letter-spacing:.3px}
.wpterm .tp-win{text-align:right;flex:0 0 auto}
.wpterm .tp-pct{font-family:var(--disp);font-weight:800;font-size:clamp(26px,2.6vw,40px);color:var(--amber);line-height:1}
.wpterm .topplay.tp-muted .tp-pct{color:var(--mut)}
.wpterm .tp-win .tp-k{font-family:var(--mono);font-size:9px;letter-spacing:1px;color:var(--mut2);margin-top:3px}
.wpterm .tp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border-top:1px solid var(--line);margin-top:10px}
.wpterm .tp-cell{background:var(--panel);padding:11px 14px;text-align:center}
.wpterm .tp-cell .v{font-family:var(--mono);font-size:14px;font-weight:600;color:var(--tx)}
.wpterm .tp-cell .v.up{color:var(--up)}.wpterm .tp-cell .v.dn{color:var(--dn)}
.wpterm .tp-cell .k{font-family:var(--mono);font-size:9px;letter-spacing:.8px;color:var(--mut2);margin-top:4px}
.wpterm .tp-foot{padding:10px 18px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:var(--amber);cursor:pointer;text-align:right}
.wpterm .tp-empty{padding:22px 18px;font-family:var(--mono);font-size:12.5px;color:var(--mut);text-align:center;line-height:1.5}
.wpterm .phead{display:flex;align-items:center;gap:12px;padding:11px 15px;border-bottom:1px solid var(--line)}
.wpterm .phead .t{font-family:var(--disp);font-weight:800;font-size:clamp(13px,1vw,15.5px);letter-spacing:.4px;display:flex;align-items:center;gap:8px}
.wpterm .phead .seg{display:flex;gap:2px;background:#080b12;border:1px solid var(--line);border-radius:9px;padding:3px;margin-left:6px}
.wpterm .phead .seg b{font-size:11.5px;font-weight:700;color:var(--mut);padding:5px 12px;border-radius:6px;cursor:pointer}
.wpterm .phead .seg b.on{background:#16203a;color:#fff;box-shadow:inset 0 0 0 1px rgba(38,116,176,.35)}
.wpterm .phead .right{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mut)}
.wpterm .phead .right .ldot{width:6px;height:6px}
.wpterm .empty{padding:22px 16px;color:var(--mut);font-size:12.5px}
.wpterm .strip{display:flex;overflow-x:auto}
.wpterm .lgc{flex:0 0 230px;border-right:1px solid #11151f;padding:11px 14px;cursor:pointer}
.wpterm .lgc:hover{background:rgba(255,255,255,.02)}
.wpterm .lgtop{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.wpterm .lst{display:flex;align-items:center;gap:5px;font-size:9.5px;font-weight:800;letter-spacing:.4px;color:#ff8a8a}
.wpterm .rd{width:6px;height:6px;border-radius:50%;background:var(--dn);animation:wppulse 1.4s infinite}
.wpterm .linn{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.wpterm .ltm{display:flex;align-items:center;justify-content:space-between;padding:2px 0}
.wpterm .ln{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600}
.wpterm .lsc{font-family:var(--mono);font-size:16px;font-weight:600}
.wpterm .llock{font-size:9.5px;color:#7d8b96;font-weight:700;margin-top:7px;padding-top:6px;border-top:1px solid #1e2730}
.wpterm .tlogo{width:22px;height:22px;border-radius:50%;background:#0c111c;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden}
.wpterm .tlogo img{width:18px;height:18px;object-fit:contain}
.wpterm .tlogo.fb{font-family:var(--disp);font-weight:700;font-size:9px;color:#8fa0b3}
.wpterm .tbl{width:100%;border-collapse:collapse}
.wpterm .tbl thead th{font-size:10px;font-weight:800;letter-spacing:.6px;color:var(--mut);text-transform:uppercase;text-align:left;padding:9px clamp(8px,0.95vw,14px);border-bottom:1px solid var(--line);background:#0a0d15;white-space:nowrap}
.wpterm .tbl thead th.r{text-align:right}.wpterm .tbl thead th.c{text-align:center}
.wpterm .tbl thead th.sortable{cursor:pointer;user-select:none}.wpterm .tbl thead th.sortable:hover{color:#aeb9c8}
.wpterm .tbl thead th .ca{font-family:var(--mono);font-size:9px;color:var(--teal);margin-left:3px}
.wpterm .tbl tbody tr{border-bottom:1px solid #11151f}.wpterm .tbl tbody tr:last-child{border-bottom:0}
.wpterm .tbl tbody tr.click{cursor:pointer;transition:background .12s}
.wpterm .tbl tbody tr.click:hover{background:rgba(63,203,145,.06)}
.wpterm .tbl tbody tr.click:hover td:first-child{box-shadow:inset 3px 0 0 var(--teal)}
.wpterm .tbl td{padding:10px clamp(8px,0.95vw,14px);font-size:clamp(11.5px,0.78vw,13px);vertical-align:middle}.wpterm .tbl td.c{text-align:center}.wpterm .tbl td.r{text-align:right}
.wpterm .matchup{display:flex;align-items:center;gap:9px}
.wpterm .logos{display:flex;align-items:center}.wpterm .logos .tlogo:last-child{margin-left:-7px}
.wpterm .mua{font-family:var(--disp);font-weight:700;font-size:15px}.wpterm .mua .at{color:var(--mut2)}
.wpterm .pick{font-family:var(--disp);font-weight:700;font-size:15px}
.wpterm .pick .side{font-size:10px;font-weight:800;border-radius:4px;padding:1px 5px;margin-right:6px;font-family:'Inter',sans-serif}
.wpterm .side.ov{color:var(--up);background:rgba(43,212,125,.12)}.wpterm .side.un{color:var(--dn);background:rgba(255,82,71,.12)}.wpterm .side.ml{color:var(--model);background:rgba(38,116,176,.14)}
.wpterm .model-p{font-family:var(--mono);font-size:12.5px;color:#5fd6a0;text-align:right}
.wpterm .book-p{font-family:var(--mono);font-size:12.5px;color:var(--mut);text-align:right}
.wpterm .spark-mini{width:54px;height:20px;vertical-align:middle}
.wpterm .nomove{color:var(--mut2);font-family:var(--mono);font-size:12px}
.wpterm .mpx2{display:flex;flex-direction:column;align-items:center;gap:1px}.wpterm .mpx2 .o{font-family:var(--mono);font-size:12.5px;color:#c4cdd9}.wpterm .mpx2 .bk{font-size:9px;color:var(--mut);font-family:var(--ui)}
.wpterm .tln{font-family:var(--mono);font-size:13px;color:#e8edf4;font-weight:600}
.wpterm .plist{display:flex;flex-direction:column}
.wpterm .prow{display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid #11151f;cursor:pointer}.wpterm .prow:last-child{border-bottom:0}.wpterm .prow:hover{background:rgba(255,255,255,.02)}
.wpterm .pph{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#2a3550,#0c1018);border:1.5px solid rgba(38,116,176,.45);overflow:hidden;position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px}
.wpterm .pph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
.wpterm .pinfo{flex:1;min-width:0;display:flex;flex-direction:column}.wpterm .pnm{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .pmk{font-size:10px;color:var(--mut);font-family:var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .pod{font-family:var(--mono);font-size:12.5px;color:#5fd6a0;font-weight:600;flex:0 0 auto}
.wpterm .rail .panel.grow{flex:1 1 auto;min-height:160px;display:flex;flex-direction:column}
.wpterm .rail .panel.grow .plist,.wpterm .rail .panel.grow .mplist{overflow:auto;min-height:0;flex:1 1 auto}
/* prop tabs */
.wpterm .ptabs{display:flex;gap:4px}
.wpterm .ptab{font-family:var(--ui);font-size:11px;font-weight:700;letter-spacing:.3px;color:var(--mut);background:transparent;border:1px solid var(--line2);border-radius:6px;padding:4px 10px;cursor:pointer}
.wpterm .ptab:hover{color:var(--tx);border-color:#36425a}
.wpterm .ptab.on{color:#06241a;background:var(--up);border-color:var(--up)}
.wpterm .pnote{font-size:11.5px;color:#f3b94f;background:rgba(243,185,79,.07);border-bottom:1px solid var(--line);padding:8px 14px}
/* player cell */
.wpterm .pp{display:flex;align-items:center;gap:9px}
.wpterm .pph{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#2a3550,#0c1018);border:1.5px solid rgba(38,116,176,.4);overflow:hidden;position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px}
.wpterm .pph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
.wpterm .ppn{font-weight:700;font-size:13px;white-space:nowrap}
.wpterm td.dim{color:var(--mut);font-family:var(--mono);font-size:12px}
.wpterm .ptag{font-family:var(--mono);font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:5px;white-space:nowrap}
.wpterm .ptag.ov{color:#bff3da;background:rgba(43,212,125,.12);border:1px solid rgba(43,212,125,.3)}
.wpterm .ptag.un{color:#ffd3cf;background:rgba(255,82,71,.1);border:1px solid rgba(255,82,71,.3)}
/* rail market price */
.wpterm .mplist{display:flex;flex-direction:column}
.wpterm .mprow{padding:9px 12px;border-bottom:1px solid #11151f;cursor:pointer}.wpterm .mprow:hover{background:rgba(255,255,255,.02)}
.wpterm .mptop{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.wpterm .mpteams{display:flex;align-items:center;gap:5px}.wpterm .mpteams .tlogo{width:18px;height:18px}
.wpterm .mpmu{font-size:11.5px;font-weight:700;margin-left:3px}.wpterm .mpmu .at{color:var(--mut2)}
.wpterm .mptot{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.wpterm .mpprices{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.wpterm .mpp{display:flex;align-items:center;justify-content:space-between;background:#0a0e16;border:1px solid var(--line);border-radius:6px;padding:5px 8px}
.wpterm .mpp .lbl{font-size:10px;color:var(--mut);font-weight:700}.wpterm .mpp .num{font-family:var(--mono);font-size:12px;color:#c4cdd9}
/* responsive — auto-fit screen sizes */
/* fluid clamp() handles sizing smoothly; these only reflow layout */
@media (max-width:1320px){ .wpterm .indices{grid-template-columns:repeat(2,1fr)} }
@media (max-width:1080px){
  .wpterm .nav{display:none}
  .wpterm .body{grid-template-columns:1fr}
  .wpterm .indices{grid-template-columns:repeat(4,1fr)}
  .wpterm .rail{position:static;height:auto;overflow:visible;border-left:0;border-top:1px solid var(--line);width:100%}
  .wpterm .rail .panel.grow{flex:none;min-height:0}
}
@media (max-width:680px){ .wpterm .indices{grid-template-columns:repeat(2,1fr)} }
.wpterm .book{font-size:12px;color:#c4cdd9;font-family:var(--mono);text-align:center}.wpterm .book .bk{font-size:10px;color:var(--mut);font-family:'Inter'}
.wpterm .edge-cell{text-align:right;white-space:nowrap}
.wpterm .edge-v{font-family:var(--mono);font-size:14px;font-weight:600}.wpterm .edge-v.up{color:var(--up)}.wpterm .edge-v.dn{color:var(--dn)}
.wpterm .edge-bar{height:3px;border-radius:2px;background:var(--ink);margin-top:5px;overflow:hidden}.wpterm .edge-bar i{display:block;height:100%;background:var(--teal)}
.wpterm .conv{font-size:10px;font-weight:800;letter-spacing:.3px;border-radius:5px;padding:3px 7px;white-space:nowrap}
.wpterm .conv.high{color:var(--amber);background:rgba(243,185,79,.12);border:1px solid rgba(243,185,79,.25)}
.wpterm .conv.med{color:#8fd9c2;background:rgba(43,212,125,.08);border:1px solid rgba(43,212,125,.2)}
.wpterm .conv.low{color:var(--mut);background:rgba(130,145,154,.08);border:1px solid var(--line)}
.wpterm .dmove{font-size:9px;font-weight:700;margin-top:3px;white-space:nowrap}
.wpterm .dmove.against{color:#ff7a6c}
.wpterm .dmove.toward{color:#33e991}
.wpterm .temp{font-family:var(--mono);font-size:13px;font-weight:600}.wpterm .temp.hot{color:#ffb454}.wpterm .temp.cold{color:var(--cold)}.wpterm .temp.mild{color:#c4cdd9}
.wpterm .wind{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:12px;color:#c4cdd9}.wpterm .wind .war{font-size:13px}.wpterm .wind.out .war{color:var(--up)}.wpterm .wind.in .war{color:var(--dn)}
.wpterm .sky{font-size:15px}.wpterm .dome{font-size:11px;color:var(--mut);font-style:italic;font-family:var(--mono)}
.wpterm .rf{font-family:var(--mono);font-size:12.5px}.wpterm .rf.up{color:var(--up)}.wpterm .rf.dn{color:#ff8a8a}
.wpterm .wsum{font-size:11.5px;color:#aeb9c8;max-width:340px}
.wpterm .spc .spn{font-weight:700;font-size:13px}.wpterm .spc .spn .hd{font-family:var(--mono);font-size:10px;color:var(--mut);margin-left:5px}
.wpterm .spc .sps{display:flex;gap:12px;font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:2px}.wpterm .spc .sps b{color:#c4cdd9;font-weight:600}
.wpterm .tbd{color:var(--mut2);font-style:italic;font-size:12px}
.wpterm .botrow{display:grid;grid-template-columns:1fr 330px;gap:13px}
.wpterm .mvstrip{display:flex;overflow-x:auto}
.wpterm .mvc{flex:0 0 200px;display:flex;align-items:center;gap:11px;padding:11px 14px;border-right:1px solid #11151f}
.wpterm .mar{font-family:var(--mono);font-weight:700;font-size:14px;width:14px;text-align:center}
.wpterm .mvc.up .mar{color:var(--up)}.wpterm .mvc.dn .mar{color:var(--dn)}
.wpterm .minfo{flex:1;min-width:0}.wpterm .ml{font-family:var(--disp);font-weight:700;font-size:14px}.wpterm .mg{font-size:10px;color:var(--mut);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpterm .mchg{text-align:right}.wpterm .mpx{font-family:var(--mono);font-size:12px;color:#c4cdd9}.wpterm .md{font-family:var(--mono);font-size:11px;font-weight:600}
.wpterm .mvc.up .md{color:var(--up)}.wpterm .mvc.dn .md{color:var(--dn)}
.wpterm .spot{padding:13px;cursor:pointer}
.wpterm .spot .who{display:flex;align-items:center;gap:11px}
.wpterm .spot .ph{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#2a3550,#0c1018);border:2px solid rgba(38,116,176,.5);overflow:hidden;position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:20px}
.wpterm .spot .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
.wpterm .spot .nm{font-weight:800;font-size:14px}.wpterm .spot .mk{font-size:10.5px;color:var(--mut);font-family:var(--mono);margin-top:2px}
.wpterm .spot .sline{display:flex;align-items:center;justify-content:space-between;margin-top:11px;border:1px solid rgba(38,116,176,.25);background:rgba(38,116,176,.06);border-radius:9px;padding:9px 11px}
.wpterm .spot .pl{font-size:12px;font-weight:700;color:#cdbcff}.wpterm .spot .od{font-family:var(--mono);font-size:13px;color:#c3b1ff}
.wpterm .spot .dots{display:flex;gap:5px;justify-content:center;margin-top:10px}.wpterm .spot .dots i{width:5px;height:5px;border-radius:50%;background:#222c3d}.wpterm .spot .dots i.on{width:15px;border-radius:3px;background:var(--model)}
.wpterm .lockwrap{position:relative;min-height:180px}
.wpterm .lockblur{position:absolute;inset:0;background:repeating-linear-gradient(0deg,#0c1018 0 38px,#0a0d14 38px 39px);opacity:.5;filter:blur(2px)}
.wpterm .lockcard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px;background:radial-gradient(circle at 50% 40%,rgba(8,10,16,.4),rgba(6,9,11,.9))}
.wpterm .lockcard .lk{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:21px;background:rgba(38,116,176,.14);border:1px solid rgba(38,116,176,.4);margin-bottom:12px}
.wpterm .lockcard .lt{font-size:16px;font-weight:800;color:#fff;margin-bottom:5px}
.wpterm .lockcard .ls{font-size:12px;color:#9aa6b2;line-height:1.5;max-width:300px;margin-bottom:14px}.wpterm .lockcard .ls b{color:var(--up);font-weight:800}
.wpterm .lockcard button{background:var(--teal);color:#04130d;border:0;font-weight:800;font-size:13px;padding:11px 22px;border-radius:11px;cursor:pointer;font-family:inherit}
.wpterm .footnote{font-size:10.5px;color:var(--mut2);text-align:center;padding:6px}
.wpterm .rail{position:sticky;top:52px;align-self:start;height:calc(100vh - 52px);border-left:1px solid var(--line);background:#080a11;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:13px}
.wpterm .rail::-webkit-scrollbar{width:8px}.wpterm .rail::-webkit-scrollbar-thumb{background:#1a2233;border-radius:6px}
.wpterm .rlive .rlg{padding:9px 12px;border-bottom:1px solid #11151f;cursor:pointer}
.wpterm .rlive .rlg:last-child{border-bottom:0}.wpterm .rlive .rlg:hover{background:rgba(255,255,255,.02)}
.wpterm .rlgh{display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}
.wpterm .rmv .rmvr{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid #11151f}
.wpterm .rmv .rmvr:last-child{border-bottom:0}
.wpterm .cmix{padding:13px}
.wpterm .cbar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#0a0d14;border:1px solid var(--line)}
.wpterm .cbar i{display:block}.wpterm .cbar .ch{background:var(--amber)}.wpterm .cbar .cm{background:var(--up)}.wpterm .cbar .cl{background:var(--mut2)}
.wpterm .cleg{display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:var(--mut)}
.wpterm .cleg span{display:inline-flex;align-items:center;gap:5px}.wpterm .cleg b{color:#c4cdd9;font-weight:700}
.wpterm .cleg i{width:8px;height:8px;border-radius:2px}.wpterm .cleg .dh{background:var(--amber)}.wpterm .cleg .dm{background:var(--up)}.wpterm .cleg .dl{background:var(--mut2)}
.wpterm .mrtbl .mread{font-size:13px;color:#cfd7e2}.wpterm .mrtbl .mread b{color:#5fd6a0;font-weight:800}
.wpterm .mrtbl .mu{font-family:var(--disp);font-weight:700;font-size:14px}.wpterm .mrtbl .mu .at{color:var(--mut2)}
.wpterm .mrtag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800}.wpterm .mrtag .dot{width:8px;height:8px;border-radius:50%}
.wpterm .mrtbl .magree{color:var(--up);font-weight:800}.wpterm .mrtbl .mdiff{color:var(--amber);font-weight:800}.wpterm .mrtbl .mnone{color:var(--mut2)}

.wpterm .wpsec .wpbadge{font-family:var(--mono);font-size:9px;letter-spacing:1px;color:var(--amber);border:1px solid var(--goldln);border-radius:5px;padding:2px 7px;margin-left:-2px}
.wpterm .wpsec .wplock{font-family:var(--mono);font-size:8.5px;letter-spacing:.8px;color:var(--goldsoft);background:var(--goldbg);border:1px solid var(--goldln);border-radius:5px;padding:2px 7px}
.wpterm .wprec{display:flex;gap:26px;padding:13px 16px;border-bottom:1px solid var(--line2);background:rgba(201,168,106,.03)}
.wpterm .wprl{display:flex;flex-direction:column;gap:3px}
.wpterm .wpk{font-size:9.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--mut)}
.wpterm .wpv{font-family:var(--serif);font-weight:700;font-size:19px;color:var(--amber);letter-spacing:-.3px}
.wpterm .wpv.up{color:var(--up)}.wpterm .wpv.dn{color:var(--dn)}
.wpterm .wprow{display:flex;align-items:center;gap:11px;padding:11px 16px;border-bottom:1px solid var(--line2);cursor:pointer}
.wpterm .wprow:last-child{border-bottom:0}.wpterm .wprow:hover{background:rgba(201,168,106,.03)}
.wpterm .wplogo{width:24px;height:24px;flex:0 0 auto;border-radius:6px;background:#232019;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--goldsoft)}
.wpterm .wpmid{flex:1;min-width:0}.wpterm .wpp{font-weight:700;font-size:13.5px}.wpterm .wpg{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:2px}
.wpterm .wpo{font-family:var(--mono);font-size:13px;color:#c4cdd9}
.wpterm .mvchip{font-family:var(--mono);font-size:11px;font-weight:700;border-radius:5px;padding:3px 8px}
.wpterm .mvchip.up{color:var(--up);background:rgba(70,224,169,.09)}.wpterm .mvchip.dn{color:var(--dn);background:rgba(226,101,92,.1)}
.wpterm .mvflat{font-family:var(--mono);font-size:11px;color:var(--mut2)}
.wpterm .sportbar .spnew{margin-left:5px;font-family:var(--mono);font-size:7.5px;font-weight:700;letter-spacing:.5px;color:#1a1206;background:var(--amber);border-radius:4px;padding:1px 4px;vertical-align:middle}

.wpterm .tk .s{font-family:'Manrope',system-ui,sans-serif}
.wpterm .mrtbl .mu{font-family:'Manrope',system-ui,sans-serif}
.wpterm .rmv .ml{font-family:'Manrope',system-ui,sans-serif}
.wpterm .idx{position:relative}
.wpterm .idx::before{content:"";position:absolute;left:14px;right:14px;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--goldln),transparent)}
.wpterm .idx.lead{border-color:var(--goldln)}
.wpterm .idx.lead .v{font-family:var(--serif);color:var(--amber);font-weight:700;letter-spacing:-.3px}
/* WZ-DESKTOP-VAULT-FIX-2026-07-11 */

.wpterm .provbar{margin-top:6px;padding:9px 13px;border:1px solid rgba(201,168,106,.28);background:linear-gradient(180deg,rgba(201,168,106,.06),transparent);border-radius:11px;font-family:var(--mono);font-size:11px;line-height:1.45;color:var(--goldsoft)}

.wpterm .nbarec table{width:100%;border-collapse:collapse}
.wpterm .nbarec th{font-family:var(--mono);font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--mut);text-align:left;padding:9px 14px;border-bottom:1px solid var(--line)}
.wpterm .nbarec th.c{text-align:center}
.wpterm .nbarec td{padding:10px 14px;border-bottom:1px solid var(--line2);font-size:13px}
.wpterm .nbarec tr:last-child td{border-bottom:0}
.wpterm .nbarec td.c{text-align:center}
.wpterm .nbarec .teamab{font-weight:700}
.wpterm .nbarec .num{font-family:var(--mono);color:var(--tx)}
.wpterm .nbarec .strk.up{color:var(--up)}
.wpterm .nbarec .strk.dn{color:var(--dn)}
`;
