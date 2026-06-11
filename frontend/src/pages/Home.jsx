// WizePicks Home hub — live front door. Reads the existing /api/edges/mlb feed (no new Odds cost).
// Honest live: the LIVE pulse reflects real game state; odds flash on real change; the line-movement
// chart shows the real points we have today and fills into a full intraday curve once tick storage lands.
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";

const T = "#33e991"; // teal-bright

function formatOdds(a) {
  if (a == null || isNaN(a)) return "—";
  const n = Math.round(Number(a));
  return n > 0 ? `+${n}` : `${n}`;
}
function impliedFromAmerican(a) {
  if (a == null || isNaN(a)) return null;
  const n = Number(a);
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}
const ESPN = (ab) => `https://a.espncdn.com/i/teamlogos/mlb/500/${String(ab || "").toLowerCase()}.png`;
const HEAD = (id) => `https://midfield.mlbstatic.com/v1/people/${id}/spots/120`;
// pull two team tokens out of a matchup string like "TEX @ KC" or "Rangers @ Royals"
function teams(matchup) {
  if (!matchup) return ["", ""];
  const parts = String(matchup).split(/@|vs|·/i).map((s) => s.trim()).filter(Boolean);
  return [parts[0] || "", parts[1] || ""];
}
function shortTeam(t) {
  const m = String(t).match(/[A-Z]{2,3}/);
  return m ? m[0] : String(t).slice(0, 3).toUpperCase();
}
function oneSidePerGame(arr) {
  const byGame = new Map();
  for (const e of arr || []) {
    const prev = byGame.get(e.gameId);
    if (!prev || (e.edge ?? -Infinity) > (prev.edge ?? -Infinity)) byGame.set(e.gameId, e);
  }
  return [...byGame.values()];
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [edges, setEdges] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [openEdge, setOpenEdge] = useState(-1);
  const [board, setBoard] = useState("ml"); // ml | totals
  const [propTab, setPropTab] = useState("hr"); // hr | hits | ks
  const prevOdds = useRef({});
  const [flash, setFlash] = useState({});

  const hasFullAccess = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const data = await edgesApi.getMLB();
      // flash any moneyline/total edge whose odds changed since last poll
      const f = {};
      [...(data.moneylineEdges || []), ...(data.totalsEdges || [])].forEach((e) => {
        const k = e.gameId + e.side;
        if (prevOdds.current[k] != null && prevOdds.current[k] !== e.odds) f[k] = e.odds > prevOdds.current[k] ? "up" : "dn";
        prevOdds.current[k] = e.odds;
      });
      setFlash(f);
      setEdges(data);
    } catch (e) { /* keep last good */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 45000); return () => clearInterval(id); }, [load]);

  if (loading && !edges) return <Shell><div style={{ padding: 40, textAlign: "center", color: "#7d8c95" }}>Loading the board…</div></Shell>;
  const e = edges || {};
  const games = e.games || [];
  const anyLive = games.some((g) => g.status === "live");
  const allDone = games.length > 0 && games.every((g) => g.status === "final");
  const marketsLive = !allDone; // pulse while there's an open slate; calm when everything's final

  // hero = your existing top-play selection (conviction-gated, positive edge), honest
  const pool = [...(e.moneylineEdges || []), ...(e.totalsEdges || [])]
    .filter((x) => x.convictionScore != null && (x.conviction === "HIGH" || x.conviction === "MEDIUM") && (x.edge ?? 0) > 0);
  pool.sort((a, b) => (b.convictionScore - a.convictionScore) || ((b.edge ?? 0) - (a.edge ?? 0)));
  const hero = pool[0] || null;

  const boardEdges = (board === "ml" ? e.moneylineEdges : e.totalsEdges) || [];
  const top4 = oneSidePerGame(boardEdges).filter((x) => (x.edge ?? 0) > 0).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0)).slice(0, 4);

  const propList = (propTab === "hr" ? e.hrPropEdges : propTab === "hits" ? e.hitsPropEdges : e.kPropEdges) || [];
  const props = propList.slice(0, 6);

  const upcoming = games.filter((g) => g.status !== "final").slice(0, 6);
  const parks = games.filter((g) => g.parkRunFactor != null).slice(0, 8);

  return (
    <Shell>
      <style>{CSS}</style>
      <div className="wp">
        {/* TOP BAR */}
        <div className="top">
          <div className="logo"><span className="a">Wize</span><span className="b">Picks</span></div>
          <span className={"pill" + (marketsLive ? " on" : " off")}><span className="dot" /> {anyLive ? "LIVE" : marketsLive ? "OPEN" : "CLOSED"}</span>
          <div className="mk"><span className={"dot" + (marketsLive ? "" : " grey")} /><span className="l">MARKETS {marketsLive ? "LIVE" : "CLOSED"}</span></div>
          <div className="bell" onClick={() => navigate("/settings")}>🔔</div>
        </div>

        {/* SPORT TABS */}
        <div className="tabs">
          {[["⚾", "MLB", 1], ["🏀", "NBA", 0], ["🏒", "NHL", 0], ["🏈", "NFL", 0], ["🏉", "CFB", 0]].map(([ic, lb, on]) => (
            <div key={lb} className={"tab" + (on ? " on" : "")} onClick={() => lb !== "MLB" && navigate("/dashboard")}><span>{ic}</span>{lb}</div>
          ))}
        </div>

        {/* HERO */}
        {hero ? <Hero hero={hero} navigate={navigate} /> : <div className="hero empty">No qualifying edge on the board right now — check back closer to first pitch.</div>}

        {/* EDGE BOARD */}
        <section>
          <div className="sh"><div className="l">📊 TODAY'S EDGE BOARD</div>
            <div className="seg">
              <b className={board === "ml" ? "on" : ""} onClick={() => setBoard("ml")}>ML</b>
              <b className={board === "totals" ? "on" : ""} onClick={() => setBoard("totals")}>Totals</b>
            </div></div>
          <div className="eg">
            {top4.length === 0 && <div className="muted">No positive edges in this market yet.</div>}
            {top4.map((x, i) => {
              const [aw, hm] = teams(x.matchup); const ab = shortTeam(x.side || hm || aw);
              const k = x.gameId + x.side;
              return (
                <div key={k} className={"ec" + (openEdge === i ? " on" : "")} onClick={() => setOpenEdge(openEdge === i ? -1 : i)}>
                  <div className="r1"><Logo ab={ab} cls="lg" /><div><div className="nm">{x.side}</div><div className="vs">{x.matchup}</div></div></div>
                  <div className={"pc" + (flash[k] ? " fl-" + flash[k] : "")}>{x.edge > 0 ? "+" : ""}{Number(x.edge).toFixed(1)}%</div>
                  <div className="md">{Math.round((x.modelProb || 0) * 100)}% model · {formatOdds(x.odds)}</div>
                  <div className="tap">Why ▾</div>
                </div>
              );
            })}
          </div>
          {openEdge > -1 && top4[openEdge] && <WhyDrawer edge={top4[openEdge]} navigate={navigate} />}
        </section>

        {/* MARKET MOVERS — live odds now; upgrades to true 15-min moves when tick storage lands */}
        <section>
          <div className="sh"><div className="l">⚡ MARKET MOVERS <span className="s">{anyLive ? "live odds" : "since open"}</span></div></div>
          <div className="rw">
            {[...(e.moneylineEdges || []), ...(e.totalsEdges || [])].slice(0, 6).map((x) => {
              const k = x.gameId + x.side;
              return (
                <div key={k} className={"mv" + (flash[k] ? " fl-" + flash[k] : "")}>
                  <div className="k">{shortTeam(x.side)} {x.market === "total" || x.line ? "TOT" : "ML"}</div>
                  <div className="v">{formatOdds(x.odds)}</div>
                  <div className="md2">{Math.round((x.modelProb || 0) * 100)}% model</div>
                </div>
              );
            })}
          </div>
          <div className="note">Live prices now. Full “last 15 min” moves switch on once tick history starts saving.</div>
        </section>

        {/* PROPS RADAR */}
        <section>
          <div className="sh"><div className="l">🎯 PROPS RADAR</div>
            <div className="seg p">
              <b className={propTab === "hr" ? "on" : ""} onClick={() => setPropTab("hr")}>HR</b>
              <b className={propTab === "hits" ? "on" : ""} onClick={() => setPropTab("hits")}>Hits</b>
              <b className={propTab === "ks" ? "on" : ""} onClick={() => setPropTab("ks")}>Ks</b>
            </div></div>
          <div className="rw">
            {props.length === 0 && <div className="muted">Prop board fills in closer to first pitch.</div>}
            {props.map((p, i) => <PropCard key={(p.player || "") + i} p={p} tab={propTab} rank={i + 1} />)}
          </div>
          {propTab === "hr" && <div className="pn">HR = chance to homer, ranked by model probability. Not a tracked +EV play (the HR market is efficient). Hits is the proven prop.</div>}
        </section>

        {/* PARK FACTORS — real, from the feed */}
        {parks.length > 0 && (
          <section>
            <div className="sh"><div className="l">🏟️ PARK FACTORS TODAY</div></div>
            <div className="rw">{parks.map((g, i) => <ParkCard key={i} g={g} />)}</div>
          </section>
        )}

        {/* PROMOS */}
        <section>
          <div className="tw">
            <div className="pr g" onClick={() => navigate("/expert-picks")}>
              <div className="h">⭐ WIZEPLAYS <span className="new">NEW</span></div>
              <div className="d">Handpicked by our analysts after extra review. Every play tracked.</div>
              <div className="cta">View WizePlays →</div>
            </div>
            <div className="pr pp" onClick={() => navigate("/daily-card")}>
              <div className="h">🎰 WIZE SPIN <span className="new">NEW</span></div>
              <div className="wh" />
              <div className="d">Need a play fast? Spin for model-qualified plays.</div>
              <div className="cta">Spin the wheel →</div>
            </div>
          </div>
        </section>

        {/* UPCOMING */}
        {upcoming.length > 0 && (
          <section>
            <div className="sh"><div className="l">🗓️ UPCOMING GAMES</div><span className="s2" onClick={() => navigate("/games")}>View all →</span></div>
            <div className="rw">
              {upcoming.map((g, i) => {
                const aw = g.away || g.awayAbbr || g.pitchers?.away?.team || "";
                const hm = g.home || g.homeAbbr || g.pitchers?.home?.team || "";
                return (
                  <div key={i} className="gm" onClick={() => g.gameId && navigate(`/game/mlb/${g.gameId}`)}>
                    <div className="m"><Logo ab={shortTeam(aw)} cls="glg" /> {shortTeam(aw)} <span className="x">v</span> <Logo ab={shortTeam(hm)} cls="glg" /> {shortTeam(hm)}</div>
                    <div className="me"><span>{g.time || "—"}</span></div>
                    <div className="me"><span>{g.totals?.projected != null ? `O/U ${g.totals.projected}` : ""}</span></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* BOTTOM NAV */}
      <nav className="nav">
        <a className="on"><span className="i">🏠</span>Home</a>
        <a onClick={() => navigate("/dashboard")}><span className="i">⚡</span>Edges</a>
        <a onClick={() => navigate("/games")}><span className="i">🗓️</span>Games</a>
        <a onClick={() => navigate("/dashboard")}><span className="i">⚾</span>Props</a>
        <a onClick={() => navigate("/performance")}><span className="i">📈</span>Trends</a>
        <a onClick={() => navigate("/settings")}><span className="i">👤</span>Account</a>
      </nav>
    </Shell>
  );
}

function Hero({ hero, navigate }) {
  const [aw, hm] = teams(hero.matchup);
  const modelPct = Math.round((hero.modelProb || 0) * 100);
  const mktPct = Math.round((impliedFromAmerican(hero.odds) || 0) * 100);
  const label = hero.line != null ? `${hero.side} ${hero.line}` : hero.side;
  return (
    <div className="hero" onClick={() => hero.gameId && navigate(`/game/mlb/${hero.gameId}`)}>
      <div className="hh"><div className="eb">🔥 BEST EDGE RIGHT NOW</div><span className="hot">🔥 HOT</span></div>
      <div className="htop">
        <div className="hL">
          <div className="pk">{label}</div>
          <div className="pg">{hero.matchup}{mktPct ? ` · model ${modelPct}% vs mkt ${mktPct}%` : ""}</div>
          <div className="ch">
            <div className="cc"><div className="k">ODDS</div><div className="v">{formatOdds(hero.odds)}</div></div>
            <div className="cc"><div className="k">STARTS</div><div className="v">{hero.time || "—"}</div></div>
          </div>
        </div>
        <div className="ebx"><div className="b">{hero.edge > 0 ? "+" : ""}{Number(hero.edge).toFixed(1)}%</div><div className="k">EDGE</div></div>
      </div>
      <div className="cn">Line-movement chart goes live here once tick history starts saving — the model already prices within a hair of the close, so this is the real story to watch.</div>
      <div className="hf">⚡ Tap for the full matchup breakdown ›</div>
    </div>
  );
}

function WhyDrawer({ edge, navigate }) {
  const modelPct = Math.round((edge.modelProb || 0) * 100);
  const mktPct = Math.round((impliedFromAmerican(edge.odds) || 0) * 100);
  const rows = [
    ["Model probability", "neu", `${modelPct}%`],
    ["Market implied", "neu", `${mktPct}%`],
    ["Edge vs market", (edge.edge ?? 0) > 0 ? "pos" : "neg", `${edge.edge > 0 ? "+" : ""}${Number(edge.edge).toFixed(1)}%`],
    ["Conviction", "neu", edge.conviction || "—"],
  ];
  return (
    <div className="di">
      <h4><span className="g">{edge.side} {edge.edge > 0 ? "+" : ""}{Number(edge.edge).toFixed(1)}%</span> · why the model leans here</h4>
      {rows.map((r, i) => <div key={i} className="f"><span className="n">{r[0]}</span><span className={"v " + r[1]}>{r[2]}</span></div>)}
      <div className="full" onClick={() => edge.gameId && navigate(`/game/mlb/${edge.gameId}`)}>See full matchup breakdown →</div>
    </div>
  );
}

function PropCard({ p, tab, rank }) {
  const prob = tab === "hr" ? p.hrProb : tab === "hits" ? p.hitsProb : p.modelProb;
  const pct = Math.round((prob || 0) * 100);
  const id = p.playerId || p.mlbamId || p.id;
  return (
    <div className="pc2">
      <div className="rk">{rank}</div>
      <div className="hd">
        <div className="av">{id ? <img src={HEAD(id)} alt="" onError={(ev) => { ev.target.style.display = "none"; }} /> : null}🧢</div>
        <div><div className="nm">{p.player || "—"}</div><div className="mu">{p.game || ""}</div></div>
      </div>
      <div className="cn2"><div className="n">{pct}%</div><div className="l">{tab === "hr" ? "CHANCE TO HOMER" : tab === "hits" ? "1+ HIT PROB" : "OVER PROB"}</div></div>
      <div className="br"><i style={{ width: Math.min(100, pct * 3) + "%" }} /></div>
      <div className="lc"><span className="l">{tab === "hr" ? "O 0.5 HR" : tab === "hits" ? "O 0.5 Hits" : "Strikeouts"}</span><span className="o">{formatOdds(p.odds)}</span></div>
    </div>
  );
}

function ParkCard({ g }) {
  const f = g.parkRunFactor; const w = g.weather || {};
  const hot = f > 1.05, cold = f < 0.95;
  const tag = hot ? ["🔥 HITTER FRIENDLY", "h"] : cold ? ["❄️ PITCHER FRIENDLY", "p"] : ["⚖️ NEUTRAL", "n"];
  const pct = Math.round((f - 1) * 100);
  const wx = w.indoor ? "🏟️ Indoor" : `${w.tempF != null ? w.tempF + "°" : ""}${w.windMph ? " ⚡ " + w.windMph + "mph " + (w.windEffect || "") : ""}`;
  return (
    <div className={"pkc" + (hot ? " hot" : "")}>
      <div className="n">{g.venue || g.park || (g.home || "") + " park"}</div>
      <div className="c">{g.home || ""}</div>
      <span className={"tg " + tag[1]}>{tag[0]}</span>
      <div className="bs"><div className="b"><div className="k">RUN FACTOR</div><div className={"v " + (hot ? "u" : cold ? "dn2" : "")}>{pct > 0 ? "+" : ""}{pct}%</div></div></div>
      <div className="wx">{wx}</div>
    </div>
  );
}

function Logo({ ab, cls }) {
  const [bad, setBad] = useState(false);
  if (bad || !ab) return <span className={cls + " lgf"}>{String(ab || "?").slice(0, 3)}</span>;
  return <img className={cls} src={ESPN(ab)} alt="" onError={() => setBad(true)} />;
}

function Shell({ children }) {
  return <div style={{ minHeight: "100vh", background: "#06090b", color: "#f0f5f3", fontFamily: "'Inter',system-ui,sans-serif" }}>{children}</div>;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.wp{max-width:480px;margin:0 auto;padding-bottom:74px}
.cond,.logo,.pk,.nm,.pc,.b,.n,.k.cond{font-family:'Barlow Condensed',sans-serif}
.top{display:flex;align-items:center;gap:8px;padding:12px 14px 9px}
.logo{font-weight:800;font-size:24px}.logo .a{color:#fff}.logo .b{color:#ff5d4d}
.pill{display:inline-flex;align-items:center;gap:5px;border:1px solid #1c2730;border-radius:999px;padding:4px 9px;font-size:10px;font-weight:800;letter-spacing:.4px;color:#d2ebe2}
.pill.off{color:#7d8c95}
.dot{width:6px;height:6px;border-radius:50%;background:#33e991;animation:pl 1.8s infinite}
.dot.grey{background:#3a4650;animation:none}
@keyframes pl{0%{box-shadow:0 0 0 0 rgba(51,233,145,.55)}70%{box-shadow:0 0 0 6px rgba(51,233,145,0)}100%{box-shadow:0 0 0 0 rgba(51,233,145,0)}}
.mk{flex:1;display:flex;align-items:center;gap:6px;justify-content:center;border:1px solid #1c2730;border-radius:999px;padding:4px 10px}
.mk .l{font-size:10px;font-weight:800;color:#d2ebe2}
.bell{font-size:17px}
.tabs{display:flex;justify-content:space-between;padding:0 14px;border-bottom:1px solid #0e151a}
.tab{display:flex;align-items:center;gap:5px;padding:9px 3px;font-weight:700;font-size:13px;color:#86949d;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab.on{color:#fff;border-bottom-color:#ff5d4d}
section{padding:0 13px;margin-top:13px}
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
.sh .l{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;letter-spacing:.4px;color:#dbe4e2}
.sh .l .s{font-family:'Inter';font-size:10px;color:#86949d;font-weight:600;margin-left:4px}
.sh .s2{font-size:11px;color:#86949d;font-weight:600}
.seg{display:flex;gap:2px;background:#0a0f13;border:1px solid #161f27;border-radius:9px;padding:2px}
.seg b{color:#86949d;font-weight:800;font-size:11px;padding:4px 10px;border-radius:6px}
.seg b.on{background:#141d24;color:#fff;box-shadow:inset 0 0 0 1px #ff5d4d}
.seg.p b.on{box-shadow:inset 0 0 0 1px #9b7bff}
.muted,.note,.pn{color:#56636d;font-size:11px;font-weight:600}
.note,.pn{margin-top:7px;line-height:1.35}
.hero{border:1px solid rgba(243,185,79,.32);border-radius:18px;background:linear-gradient(180deg,#14110a,#0a0f13);overflow:hidden;margin:13px}
.hero.empty{padding:18px;color:#86949d;font-size:13px;font-weight:600}
.hh{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 2px}
.eb{font-size:11px;font-weight:800;letter-spacing:.4px;color:#f3b94f}
.hot{border:1px solid rgba(243,185,79,.35);border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;color:#f3b94f;background:rgba(243,185,79,.08)}
.htop{display:flex;gap:11px;padding:6px 14px 2px;align-items:center}
.hL{flex:1;min-width:0}
.pk{font-weight:800;font-size:34px;line-height:.9;color:#fff}
.pg{font-size:12px;color:#86949d;font-weight:600;margin-top:4px}
.ch{display:flex;gap:7px;margin-top:10px}
.cc{border:1px solid #161f27;border-radius:10px;padding:6px 9px;flex:1}
.cc .k{font-size:9px;color:#86949d;font-weight:800}.cc .v{font-size:13px;font-weight:700;margin-top:1px}
.ebx{flex:0 0 86px;border:1px solid rgba(51,233,145,.42);border-radius:14px;background:rgba(51,233,145,.07);padding:12px 6px;text-align:center;box-shadow:0 0 22px rgba(51,233,145,.1)}
.ebx .b{font-weight:800;font-size:28px;color:#33e991;line-height:1}.ebx .k{font-size:9px;color:#8fd9c2;font-weight:800;margin-top:2px}
.cn{font-size:9.5px;color:#56636d;font-weight:600;margin:6px 14px 0;line-height:1.35}
.hf{display:flex;align-items:center;gap:6px;border-top:1px solid rgba(243,185,79,.14);margin-top:9px;padding:10px 14px;color:#f3b94f;font-size:11.5px;font-weight:600}
.eg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.ec{border:1px solid #161f27;border-radius:13px;background:#0c1116;padding:9px 7px}
.ec.on{border-color:rgba(51,233,145,.5);background:#0f161c}
.ec .r1{display:flex;align-items:center;gap:4px}
.ec .nm{font-weight:800;font-size:14px;line-height:.9}.ec .vs{font-size:8px;color:#86949d;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec .pc{font-weight:800;font-size:22px;color:#33e991;line-height:1;margin-top:6px;transition:color .3s}
.ec .pc.fl-up{color:#33e991}.ec .pc.fl-dn{color:#ff5a5a}
.ec .md{font-size:8.5px;color:#86949d;font-weight:600;margin-top:1px}
.ec .tap{font-size:8px;color:#56636d;font-weight:700;margin-top:6px}.ec.on .tap{color:#33e991}
.lg{width:22px;height:22px;border-radius:50%;object-fit:contain}
.lgf{display:flex;align-items:center;justify-content:center;background:#1c2730;font-weight:800;font-size:8px;color:#fff;border-radius:50%}
.glg{width:18px;height:18px;object-fit:contain;vertical-align:middle}
.di{border:1px solid #161f27;border-radius:13px;background:#0c1116;padding:11px 13px;margin-top:8px}
.di h4{margin:0 0 7px;font-size:12px;font-weight:800;color:#dbe4e2}.di h4 .g{color:#33e991;font-family:'Barlow Condensed';font-size:14px}
.di .f{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #1c2730;font-size:11px}.di .f:last-child{border:0}
.di .f .n{color:#86949d;font-weight:600}.di .f .v{font-weight:700}.v.pos{color:#33e991}.v.neg{color:#ff5a5a}.v.neu{color:#c2cdd2}
.di .full{margin-top:9px;font-size:11px;font-weight:800;color:#9fe0c8}
.rw{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}.rw::-webkit-scrollbar{display:none}
.mv{flex:0 0 110px;border:1px solid #161f27;border-radius:12px;background:#0c1116;padding:9px 11px}
.mv .k{font-family:'Barlow Condensed';font-weight:800;font-size:13px}.mv .v{font-size:14px;font-weight:700;margin-top:4px;transition:color .3s}
.mv.fl-up .v{color:#33e991}.mv.fl-dn .v{color:#ff5a5a}.mv .md2{font-size:9px;color:#86949d;font-weight:600;margin-top:2px}
.pc2{flex:0 0 224px;border:1px solid #161f27;border-radius:14px;background:linear-gradient(180deg,#110d1d,#0a0f13);padding:11px 12px;position:relative}
.pc2 .rk{position:absolute;top:0;left:0;width:28px;height:28px;border-radius:14px 0 14px 0;background:rgba(155,123,255,.18);display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:800;font-size:14px;color:#b9a6ff}
.pc2 .hd{display:flex;align-items:center;gap:9px;margin-left:22px}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(180deg,#26344f,#1a2335);display:flex;align-items:flex-end;justify-content:center;font-size:23px;position:relative;overflow:hidden;flex:0 0 auto}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pc2 .nm{font-weight:700;font-size:14px;line-height:1.05}.pc2 .mu{font-size:10px;color:#86949d;margin-top:1px}
.cn2{text-align:center;margin:8px 0 3px}.cn2 .n{font-family:'Barlow Condensed';font-weight:800;font-size:31px;color:#33e991;line-height:1}.cn2 .l{font-size:9px;color:#8fd9c2;font-weight:800}
.br{height:4px;border-radius:3px;background:#19222a;overflow:hidden;margin:7px 0 9px}.br i{display:block;height:100%;background:linear-gradient(90deg,#1D9E75,#33e991)}
.lc{display:flex;justify-content:space-between;align-items:center;border:1px solid rgba(155,123,255,.25);border-radius:9px;background:rgba(155,123,255,.07);padding:6px 11px}
.lc .l{font-weight:800;font-size:12px;color:#cbbcff}.lc .o{font-weight:800;font-size:12px;color:#fff}
.pkc{flex:0 0 160px;border:1px solid #161f27;border-radius:13px;background:#0c1116;padding:10px 11px}
.pkc.hot{border-color:rgba(243,185,79,.3);background:linear-gradient(180deg,#12170d,#0a0f13)}
.pkc .n{font-weight:700;font-size:13px}.pkc .c{font-size:10px;color:#86949d;font-weight:600}
.pkc .tg{display:inline-flex;font-size:9px;font-weight:800;margin:7px 0 8px;padding:2px 7px;border-radius:6px}
.tg.h{color:#f3b94f;background:rgba(243,185,79,.1)}.tg.p{color:#5fb8ff;background:rgba(95,184,255,.1)}.tg.n{color:#86949d;background:rgba(130,145,154,.08)}
.bs .k{font-size:9px;color:#86949d;font-weight:800}.bs .v{font-family:'Barlow Condensed';font-weight:800;font-size:18px}.v.u{color:#33e991}.v.dn2{color:#5fb8ff}
.wx{margin-top:7px;font-size:10px;color:#c0c9cd;font-weight:600}
.tw{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.pr{border-radius:14px;padding:12px;border:1px solid #161f27;position:relative;min-height:108px}
.pr.g{border-color:rgba(243,185,79,.3);background:linear-gradient(180deg,#14110a,#0a0f13)}
.pr.pp{border-color:rgba(155,123,255,.3);background:linear-gradient(180deg,#110d20,#0a0f13)}
.pr .h{font-weight:800;font-size:12.5px}.new{font-size:8px;font-weight:800;border-radius:4px;padding:1px 4px;letter-spacing:.4px}
.pr.g .new{background:#f3b94f;color:#1a1405}.pr.pp .new{background:#9b7bff;color:#0d0820}
.pr .d{font-size:10.5px;color:#86949d;margin:8px 0;line-height:1.4}
.pr .cta{font-size:12px;font-weight:800;color:#f3b94f}.pr.pp .cta{color:#bba6ff}
.wh{width:54px;height:54px;border-radius:50%;position:absolute;top:32px;right:11px;background:radial-gradient(circle,#2f2363,#110d20 72%);border:2px solid #4a3d86;animation:spin 7s linear infinite}
.wh::before{content:"";position:absolute;inset:6px;border-radius:50%;border:1px dashed #6a58c0;opacity:.7}
.pr.pp .d{max-width:58%}
@keyframes spin{to{transform:rotate(360deg)}}
.gm{flex:0 0 130px;border:1px solid #161f27;border-radius:12px;background:#0c1116;padding:9px 11px}
.gm .m{font-family:'Barlow Condensed';font-weight:800;font-size:14px;display:flex;align-items:center;gap:4px}.gm .m .x{color:#86949d}
.gm .me{font-size:9px;color:#86949d;font-weight:600;margin-top:5px}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:flex;justify-content:space-around;padding:7px 4px calc(7px + env(safe-area-inset-bottom));background:rgba(7,10,13,.95);backdrop-filter:blur(14px);border-top:1px solid #161f27}
.nav a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:9px;font-weight:600;color:#86949d}.nav a.on{color:#ff5d4d}.nav .i{font-size:18px}
`;
