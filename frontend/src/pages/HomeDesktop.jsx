// WizePicks — DESKTOP TERMINAL. Renders only at >=1024px (HomePage decides);
// mobile keeps its own layout untouched. Reads the same data HomePage already
// fetched (passed as props) — no extra API calls. All figures are real: edges,
// modelProb, conviction from /api/edges; weather/pitchers ride along on games.
import { useState, useEffect, useRef } from "react";

// ---- self-contained helpers (kept local so this file stands alone) ----
const ESPN_ALIAS = { az: "ari" };
const ESPN = (ab, lg = "mlb") => { const a = String(ab || "").toLowerCase(); const slug = lg === "mlb" ? (ESPN_ALIAS[a] || a) : a; return `https://a.espncdn.com/i/teamlogos/${lg}/500/${slug}.png`; };
const formatOdds = (a) => { if (a == null || isNaN(a)) return "—"; const n = Math.round(Number(a)); return n > 0 ? `+${n}` : `${n}`; };
const isTotal = (e) => e.side === "over" || e.side === "under";
const shortTeam = (t) => { const m = String(t).match(/[A-Z]{2,3}/); return m ? m[0] : String(t).slice(0, 3).toUpperCase(); };
const edgeLabel = (e) => isTotal(e) ? `${e.side === "over" ? "Over" : "Under"} ${e.line}` : (e.line != null ? `${e.teamAbbr || shortTeam(e.matchup)} ${e.line > 0 ? "+" : ""}${e.line}` : `${e.teamAbbr || shortTeam(e.matchup)} ML`);
const sideOf = (e) => e.side === "over" ? "ov" : e.side === "under" ? "un" : "ml";
const sideTag = (e) => { const s = sideOf(e); return `<span class="side ${s}">${s === "ov" ? "OVER" : s === "un" ? "UNDER" : "PICK"}</span>`; };
function oneSidePerGame(arr) { const g = new Map(); for (const e of arr || []) { const p = g.get(e.gameId); if (!p || (e.edge ?? -Infinity) > (p.edge ?? -Infinity)) g.set(e.gameId, e); } return [...g.values()]; }
const convClass = (c) => c === "HIGH" ? "high" : c === "MEDIUM" ? "med" : "low";
// MLB edge is a fraction (→ %); NBA ML already a %, NBA spread/totals are points.
function fmtEdge(e, sport) { const v = e.edge ?? 0; const s = v >= 0 ? "+" : ""; if (sport !== "nba") return `${s}${(v * 100).toFixed(1)}%`; if (isTotal(e) || e.line != null) return `${s}${v.toFixed(1)}`; return `${s}${v.toFixed(1)}%`; }
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
        <div className="lk">🔒</div>
        <div className="lt">{title}</div>
        <div className="ls">{sub}</div>
        <button onClick={() => navigate("/pricing")}>Unlock All-Access →</button>
      </div>
    </div>
  );
}

export default function HomeDesktop(props) {
  const { edges, games = [], movers = [], live = [], abbrById = {}, topProps = [], hero, hasFull, planLoaded = true, lineSeries = {},
    wpRecord, navigate, plan = {}, sport = "mlb", setSport, marketsLive, anyLive } = props;
  const lg = sport === "nba" ? "nba" : "mlb";
  const [market, setMarket] = useState("ml");
  const [sortKey, setSortKey] = useState("edge");
  const [sortDir, setSortDir] = useState(-1);
  const [si, setSi] = useState(0);
  const [clock, setClock] = useState("");

  useEffect(() => { const t = setInterval(() => { const d = new Date(); const h = ((d.getHours() + 24) % 12) || 12; setClock(`${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }).slice(0, 0)}ET`); }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (topProps.length < 2) return; const t = setInterval(() => setSi((x) => (x + 1) % Math.min(topProps.length, 6)), 3600); return () => clearInterval(t); }, [topProps.length]);

  const e = edges || {};
  const arrFor = (m) => m === "ml" ? e.moneylineEdges : m === "spread" ? e.spreadEdges : e.totalsEdges;
  let rows = oneSidePerGame(arrFor(market) || []).filter((x) => sport === "mlb" ? (x.edge ?? 0) > 0 : (x.edge ?? 0) >= 1);
  rows = [...rows].sort((a, b) => {
    if (sortKey === "model") return ((a.modelProb || 0) - (b.modelProb || 0)) * sortDir;
    if (sortKey === "conv") return ((a.convictionScore || 0) - (b.convictionScore || 0)) * sortDir;
    return ((a.edge ?? 0) - (b.edge ?? 0)) * sortDir;
  });
  const allPos = [...(e.moneylineEdges || []), ...(e.totalsEdges || []), ...(e.spreadEdges || [])].filter((x) => (x.edge ?? 0) > 0);
  const edgeCount = allPos.length;
  const bestEdge = hero ? fmtEdge(hero, sport) : (rows[0] ? fmtEdge(rows[0], sport) : "—");
  const liveStrip = (live || []);
  const wx = games.filter((g) => g.weather && sport === "mlb");
  const pt = games.filter((g) => g.pitchers && (g.pitchers.away || g.pitchers.home) && sport === "mlb");
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
    ["📊", "Dashboard", "/home", true],
    ["💹", "Market Price", "/odds"],
    ["🎯", "Edge Board", "/home"],
    ["⚾", "Props", "/props"],
    ["TRACK", null],
    ["📈", "Performance", "/performance"],
    ["⭐", "WizePlays", "/expert-picks"],
    ["🎰", "Wize Spin", "/daily-card"],
    ["SCORES", null],
    ["🟢", "Live & Final", "/games"],
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
            <div className="d">{hasFull ? "Your plan is active — every edge unlocked." : "Every edge, prop & live play — $7/mo."}</div>
            <button onClick={() => navigate(hasFull ? "/settings" : "/pricing")}>{hasFull ? "Manage plan" : "Unlock — $7/mo"}</button>
          </div>
        </nav>

        <div className="content">
          <div className="maintop">
            <div><h1>Today's Board</h1><div className="sub">{games.length} games · {sport.toUpperCase()} · model live</div></div>
            <div className="sportbar">
              {[["⚾", "MLB", "mlb"], ["🏀", "NBA", "nba"]].map(([ic, lb, k]) => (
                <div key={k} className={"sp" + (sport === k ? " on" : "")} onClick={() => setSport && setSport(k)}><span className="d" />{ic} {lb}</div>
              ))}
            </div>
          </div>

          {/* INDEX ROW */}
          <div className="indices">
            <div className="idx teal"><div className="k">Edges Today</div><div className="v num">{edgeCount}</div><div className="chg">{market.toUpperCase()} board · {rows.length} shown</div></div>
            <div className="idx green"><div className="k">Best Edge</div>
              {!planLoaded ? <><div className="v num">…</div><div className="chg">loading</div></>
                : hasFull ? <><div className="v num">{bestEdge}</div><div className="chg">{hero ? `${edgeLabel(hero)} · ${hero.conviction || ""}` : "top of the board"}</div></>
                : <><div className="v num lockv">🔒</div><div className="chg">All-Access</div></>}
            </div>
            <div className="idx amber"><div className="k">Live Now</div><div className="v num">{liveStrip.length}</div><div className="chg">{anyLive ? "in-game models running" : "no games live"}</div></div>
            <div className="idx purple"><div className="k">WizePlays · Tracked</div>
              <div className="v num">{units != null ? `${units >= 0 ? "+" : ""}${units.toFixed(1)}u` : wl}</div>
              <div className="chg">{winPct != null ? `${winPct}% · ${wl}` : "record on the board"}</div>
            </div>
          </div>

          {/* EDGE BOARD */}
          <div className="panel">
            <div className="phead"><div className="t">🎯 Edge Board</div>
              <div className="seg">{[["ml", "Moneyline"], ["totals", "Totals"], ...(sport === "nba" ? [["spread", "Spread"]] : [])].map(([m, lb]) => (
                <b key={m} className={market === m ? "on" : ""} onClick={() => setMarket(m)}>{lb}</b>))}</div>
              <div className="right"><span className="ldot" />click a column to sort</div>
            </div>
            {!planLoaded
              ? <div className="empty">Loading the board…</div>
              : !hasFull
              ? <Lock title="Edges are an All-Access feature" sub={<>Every edge across the slate, ranked by conviction. <b>$7/mo</b></>} navigate={navigate} />
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
                        const ab = abbrById[x.gameId] || {}; const a = ab.a || x.teamAbbr || shortTeam(x.matchup); const h = ab.h || "";
                        const ep = edgePct(x, sport); const pos = ep >= 0;
                        return (
                          <tr key={x.gameId + x.side + i} className="click" onClick={() => navigate(`/game/${lg}/${x.gameId}`)}>
                            <td><div className="matchup"><span className="logos"><TLogo ab={a} lg={lg} />{h && <TLogo ab={h} lg={lg} />}</span>
                              <span className="mu"><span className="mua">{a}{h ? <span className="at"> @ </span> : ""}{h}</span></span></div></td>
                            <td><div className="pick" dangerouslySetInnerHTML={{ __html: sideTag(x) + edgeLabel(x) }} /></td>
                            <td className="model-p">{x.modelProb != null ? `${Math.round(x.modelProb * 100)}%` : "—"}</td>
                            <td className="book">{formatOdds(x.odds)}{x.book ? <><br /><span className="bk">{x.book}</span></> : ""}</td>
                            <td className="c">{(() => { const s = lineSeries[x.gameId + x.side]; return s && s.length > 1 ? <span dangerouslySetInnerHTML={{ __html: miniSpark(s) }} /> : <span className="nomove">—</span>; })()}</td>
                            <td className="edge-cell"><div className={"edge-v " + (pos ? "up" : "dn")}>{fmtEdge(x, sport)}</div><div className="edge-bar"><i style={{ width: Math.min(100, Math.abs(ep) * 12 + 8) + "%" }} /></div></td>
                            <td className="c"><span className={"conv " + convClass(x.conviction)}>{(x.conviction || "—")}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
          </div>

          {/* WEATHER FACTOR */}
          {wx.length > 0 && (
            <div className="panel">
              <div className="phead"><div className="t">🌬️ Weather Factor</div><div className="right">first-pitch forecast → run environment</div></div>
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
                          ? <><td className="c"><span className="dome">roof closed</span></td><td><span className="dome">no wind</span></td><td className="c"><span className="sky">🏟️</span></td></>
                          : <><td className="c"><span className={"temp " + tC}>{w.tempF != null ? `${w.tempF}°` : "—"}</span></td>
                            <td><span className={"wind " + wc}><span className="war">{wAr}</span>{w.windMph != null ? `${w.windMph} mph` : "calm"}</span></td>
                            <td className="c"><span className="sky">{w.isRaining ? "🌧️" : "☀️"}</span></td></>}
                        <td className="c">{rf != null ? <span className={"rf " + rfc}>{rf.toFixed(2)}×</span> : "—"}</td>
                        <td className="wsum">{w.summary || w.conditions || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* STARTING PITCHERS */}
          {pt.length > 0 && (
            <div className="panel">
              <div className="phead"><div className="t">⚾ Starting Pitchers</div><div className="right">ERA · K/9 · WHIP</div></div>
              <table className="tbl">
                <thead><tr><th>Matchup</th><th>Away Starter</th><th>Home Starter</th></tr></thead>
                <tbody>
                  {pt.map((g, i) => {
                    const a = g.awayAbbr || shortTeam(g.away); const h = g.homeAbbr || shortTeam(g.home);
                    const sp = (p) => { if (!p) return <span className="tbd">TBD</span>; const s = p.stats || {}; return (
                      <div className="spc"><div className="spn">{p.name || "TBD"}{p.hand ? <span className="hd">{p.hand}HP</span> : ""}</div>
                        <div className="sps">{s.era != null && <span>ERA <b>{s.era.toFixed(2)}</b></span>}{s.strikeoutsPer9 != null && <span>K/9 <b>{s.strikeoutsPer9.toFixed(1)}</b></span>}{s.whip != null && <span>WHIP <b>{s.whip.toFixed(2)}</b></span>}</div></div>
                    ); };
                    return (
                      <tr key={g.id || i}>
                        <td><div className="matchup"><span className="logos"><TLogo ab={a} /><TLogo ab={h} /></span><span className="mu"><span className="mua">{a}<span className="at"> @ </span>{h}</span></span></div></td>
                        <td>{sp(g.pitchers?.away)}</td><td>{sp(g.pitchers?.home)}</td>
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
              <div className="phead"><div className="t">🟢 Live</div><div className="right"><span className="ldot" />{liveStrip.length} now</div></div>
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
            <div className="phead"><div className="t">⚡ Market Movers</div></div>
            {!planLoaded
              ? <div className="empty">Loading…</div>
              : !hasFull
              ? <Lock title="Movers locked" sub={<><b>$7/mo</b></>} navigate={navigate} />
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

          <div className="panel">
            <div className="phead"><div className="t">✨ Prop Spotlight</div></div>
            {!planLoaded
              ? <div className="empty">Loading…</div>
              : !hasFull
              ? <Lock title="Props locked" sub={<><b>$7/mo</b></>} navigate={navigate} />
              : topProps.length === 0
                ? <div className="empty">Props fill in closer to first pitch.</div>
                : (() => { const s = topProps[si % topProps.length]; return (
                  <div className="spot" onClick={() => navigate("/props")}>
                    <div className="who"><span className="ph">{s.id ? <img src={`https://midfield.mlbstatic.com/v1/people/${s.id}/spots/120`} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : "🧢"}</span>
                      <div><div className="nm">{s.name}</div><div className="mk">{s.game || s.team} · {s.market}</div></div></div>
                    <div className="sline"><div className="pl">{s.betSide}</div><div className="od">{formatOdds(s.odds)}</div></div>
                    <div className="dots">{topProps.slice(0, 6).map((_, i) => <i key={i} className={i === (si % topProps.length) ? "on" : ""} />)}</div>
                  </div>
                ); })()}
          </div>
        </aside>
      </div>
    </div>
  );
}

const TCSS = `
.wpterm{--ink:#06080d;--panel:#0b0e16;--line:#1a2030;--line2:#232c3d;--teal:#1D9E75;--up:#2bd47d;--dn:#ff5247;--model:#9b7bff;--amber:#f3b94f;--cold:#5aa9ff;--tx:#e8edf4;--mut:#6b7888;--mut2:#485364;--mono:'IBM Plex Mono',ui-monospace,monospace;--disp:'Barlow Condensed',sans-serif;
  position:fixed;inset:0;background:var(--ink);color:var(--tx);font-family:'Inter',system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr;overflow:hidden;
  background-image:radial-gradient(1200px 600px at 80% -10%,rgba(155,123,255,.06),transparent 60%),radial-gradient(900px 500px at 0% 110%,rgba(29,158,117,.06),transparent 55%)}
.wpterm .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.wpterm .status{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;height:52px;padding:0 18px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#0a0d15,#080a11)}
.wpterm .brand{display:flex;align-items:center;gap:9px}
.wpterm .logo{font-family:var(--disp);font-weight:800;font-size:23px}.wpterm .logo .b{color:var(--dn)}
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
.wpterm .avatar{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#1b2740,#0e1422);border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#9fb0c4;cursor:pointer}
.wpterm .body{display:grid;grid-template-columns:210px minmax(0,1fr) clamp(300px,22vw,360px);height:100%;min-height:0}
.wpterm .nav{border-right:1px solid var(--line);background:#080a11;display:flex;flex-direction:column;padding:12px 10px;gap:3px;overflow:auto}
.wpterm .nav .grp{font-size:9.5px;font-weight:800;letter-spacing:1.4px;color:var(--mut2);padding:12px 10px 5px}
.wpterm .nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:#aeb9c8;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;position:relative}
.wpterm .nav a .i{width:17px;text-align:center;font-size:14px}
.wpterm .nav a:hover{background:#0e1320;color:#fff}
.wpterm .nav a.on{background:linear-gradient(90deg,rgba(29,158,117,.16),rgba(29,158,117,.04));color:#fff;border-color:rgba(29,158,117,.28)}
.wpterm .nav a.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--teal)}
.wpterm .nav .spacer{flex:1}
.wpterm .nav .upsell{margin:8px 4px 4px;border:1px solid rgba(155,123,255,.3);border-radius:11px;background:linear-gradient(180deg,rgba(155,123,255,.1),rgba(155,123,255,.02));padding:12px}
.wpterm .nav .upsell .h{font-family:var(--disp);font-weight:800;font-size:16px;color:#cdbcff}
.wpterm .nav .upsell .d{font-size:10.5px;color:var(--mut);margin:4px 0 9px;line-height:1.4}
.wpterm .nav .upsell button{width:100%;border:0;border-radius:8px;background:var(--teal);color:#04130d;font-weight:800;font-size:12px;padding:8px;cursor:pointer;font-family:inherit}
.wpterm .content{overflow:auto;padding:15px 18px 30px;display:flex;flex-direction:column;gap:13px;min-width:0}
.wpterm .content::-webkit-scrollbar,.wpterm .nav::-webkit-scrollbar,.wpterm .strip::-webkit-scrollbar,.wpterm .mvstrip::-webkit-scrollbar{width:9px;height:8px}
.wpterm .content::-webkit-scrollbar-thumb,.wpterm .nav::-webkit-scrollbar-thumb,.wpterm .strip::-webkit-scrollbar-thumb,.wpterm .mvstrip::-webkit-scrollbar-thumb{background:#1a2233;border-radius:6px}
.wpterm .maintop{display:flex;align-items:flex-end;justify-content:space-between}
.wpterm .maintop h1{font-family:var(--disp);font-weight:800;font-size:26px}
.wpterm .maintop .sub{font-size:12px;color:var(--mut);margin-top:1px}
.wpterm .sportbar{display:flex;gap:5px}
.wpterm .sportbar .sp{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--mut);padding:7px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer}
.wpterm .sportbar .sp.on{color:#fff;border-color:var(--line2);background:#111726}.wpterm .sportbar .sp.on .d{background:var(--up)}
.wpterm .sportbar .sp .d{width:6px;height:6px;border-radius:50%;background:var(--mut2)}
.wpterm .indices{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}
.wpterm .idx{border:1px solid var(--line);border-radius:13px;background:linear-gradient(180deg,var(--panel),#080b12);padding:12px 14px}
.wpterm .idx .k{font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--mut);text-transform:uppercase}
.wpterm .idx .v{font-family:var(--disp);font-weight:800;font-size:29px;line-height:1.05;margin-top:4px}
.wpterm .idx .v.lockv{font-size:22px}
.wpterm .idx .chg{font-family:var(--mono);font-size:11px;font-weight:600;margin-top:3px;color:var(--mut)}
.wpterm .idx.teal .v{color:#7af0c4}.wpterm .idx.purple .v{color:#c3b1ff}.wpterm .idx.amber .v{color:#ffd584}.wpterm .idx.green .v{color:#7af0c4}
.wpterm .panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.wpterm .phead{display:flex;align-items:center;gap:12px;padding:11px 15px;border-bottom:1px solid var(--line)}
.wpterm .phead .t{font-family:var(--disp);font-weight:800;font-size:15.5px;letter-spacing:.4px;display:flex;align-items:center;gap:8px}
.wpterm .phead .seg{display:flex;gap:2px;background:#080b12;border:1px solid var(--line);border-radius:9px;padding:3px;margin-left:6px}
.wpterm .phead .seg b{font-size:11.5px;font-weight:700;color:var(--mut);padding:5px 12px;border-radius:6px;cursor:pointer}
.wpterm .phead .seg b.on{background:#16203a;color:#fff;box-shadow:inset 0 0 0 1px rgba(155,123,255,.35)}
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
.wpterm .tbl thead th{font-size:10px;font-weight:800;letter-spacing:.6px;color:var(--mut);text-transform:uppercase;text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);background:#0a0d15;white-space:nowrap}
.wpterm .tbl thead th.r{text-align:right}.wpterm .tbl thead th.c{text-align:center}
.wpterm .tbl thead th.sortable{cursor:pointer;user-select:none}.wpterm .tbl thead th.sortable:hover{color:#aeb9c8}
.wpterm .tbl thead th .ca{font-family:var(--mono);font-size:9px;color:var(--teal);margin-left:3px}
.wpterm .tbl tbody tr{border-bottom:1px solid #11151f}.wpterm .tbl tbody tr:last-child{border-bottom:0}
.wpterm .tbl tbody tr.click{cursor:pointer;transition:background .12s}
.wpterm .tbl tbody tr.click:hover{background:linear-gradient(90deg,rgba(29,158,117,.08),transparent)}
.wpterm .tbl tbody tr.click:hover td:first-child{box-shadow:inset 3px 0 0 var(--teal)}
.wpterm .tbl td{padding:10px 14px;font-size:13px;vertical-align:middle}.wpterm .tbl td.c{text-align:center}.wpterm .tbl td.r{text-align:right}
.wpterm .matchup{display:flex;align-items:center;gap:9px}
.wpterm .logos{display:flex;align-items:center}.wpterm .logos .tlogo:last-child{margin-left:-7px}
.wpterm .mua{font-family:var(--disp);font-weight:700;font-size:15px}.wpterm .mua .at{color:var(--mut2)}
.wpterm .pick{font-family:var(--disp);font-weight:700;font-size:15px}
.wpterm .pick .side{font-size:10px;font-weight:800;border-radius:4px;padding:1px 5px;margin-right:6px;font-family:'Inter',sans-serif}
.wpterm .side.ov{color:var(--up);background:rgba(43,212,125,.12)}.wpterm .side.un{color:var(--dn);background:rgba(255,82,71,.12)}.wpterm .side.ml{color:var(--model);background:rgba(155,123,255,.14)}
.wpterm .model-p{font-family:var(--mono);font-size:12.5px;color:#c3b1ff;text-align:right}
.wpterm .book-p{font-family:var(--mono);font-size:12.5px;color:var(--mut);text-align:right}
.wpterm .spark-mini{width:54px;height:20px;vertical-align:middle}
.wpterm .nomove{color:var(--mut2);font-family:var(--mono);font-size:12px}
.wpterm .book{font-size:12px;color:#c4cdd9;font-family:var(--mono);text-align:center}.wpterm .book .bk{font-size:10px;color:var(--mut);font-family:'Inter'}
.wpterm .edge-cell{text-align:right;white-space:nowrap}
.wpterm .edge-v{font-family:var(--mono);font-size:14px;font-weight:600}.wpterm .edge-v.up{color:var(--up)}.wpterm .edge-v.dn{color:var(--dn)}
.wpterm .edge-bar{height:3px;border-radius:2px;background:#161c28;margin-top:5px;overflow:hidden}.wpterm .edge-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--teal),var(--up))}
.wpterm .conv{font-size:10px;font-weight:800;letter-spacing:.3px;border-radius:5px;padding:3px 7px;white-space:nowrap}
.wpterm .conv.high{color:var(--amber);background:rgba(243,185,79,.12);border:1px solid rgba(243,185,79,.25)}
.wpterm .conv.med{color:#8fd9c2;background:rgba(43,212,125,.08);border:1px solid rgba(43,212,125,.2)}
.wpterm .conv.low{color:var(--mut);background:rgba(130,145,154,.08);border:1px solid var(--line)}
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
.wpterm .spot .ph{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#2a3550,#0c1018);border:2px solid rgba(155,123,255,.5);overflow:hidden;position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:20px}
.wpterm .spot .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top}
.wpterm .spot .nm{font-weight:800;font-size:14px}.wpterm .spot .mk{font-size:10.5px;color:var(--mut);font-family:var(--mono);margin-top:2px}
.wpterm .spot .sline{display:flex;align-items:center;justify-content:space-between;margin-top:11px;border:1px solid rgba(155,123,255,.25);background:rgba(155,123,255,.06);border-radius:9px;padding:9px 11px}
.wpterm .spot .pl{font-size:12px;font-weight:700;color:#cdbcff}.wpterm .spot .od{font-family:var(--mono);font-size:13px;color:#c3b1ff}
.wpterm .spot .dots{display:flex;gap:5px;justify-content:center;margin-top:10px}.wpterm .spot .dots i{width:5px;height:5px;border-radius:50%;background:#222c3d}.wpterm .spot .dots i.on{width:15px;border-radius:3px;background:var(--model)}
.wpterm .lockwrap{position:relative;min-height:180px}
.wpterm .lockblur{position:absolute;inset:0;background:repeating-linear-gradient(0deg,#0c1018 0 38px,#0a0d14 38px 39px);opacity:.5;filter:blur(2px)}
.wpterm .lockcard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:22px;background:radial-gradient(circle at 50% 40%,rgba(8,10,16,.4),rgba(6,9,11,.9))}
.wpterm .lockcard .lk{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:21px;background:rgba(155,123,255,.14);border:1px solid rgba(155,123,255,.4);margin-bottom:12px}
.wpterm .lockcard .lt{font-size:16px;font-weight:800;color:#fff;margin-bottom:5px}
.wpterm .lockcard .ls{font-size:12px;color:#9aa6b2;line-height:1.5;max-width:300px;margin-bottom:14px}.wpterm .lockcard .ls b{color:var(--up);font-weight:800}
.wpterm .lockcard button{background:var(--teal);color:#04130d;border:0;font-weight:800;font-size:13px;padding:11px 22px;border-radius:11px;cursor:pointer;font-family:inherit}
.wpterm .footnote{font-size:10.5px;color:var(--mut2);text-align:center;padding:6px}
.wpterm .rail{border-left:1px solid var(--line);background:#080a11;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:13px}
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
`;
