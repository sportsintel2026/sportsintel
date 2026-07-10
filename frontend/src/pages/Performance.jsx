// PERFORMANCE-PREMIUM-DARK-RESKIN-2026-06-23
// PERFORMANCE-RECENT-REMOVED-2026-06-23
// WZ-PERF-WINFIRST-2026-07-06 :: win-rate-first layout. Win rate is the hero (record beside it,
// range-aware win-rate curve beneath); ROI / Units / CLV kept VISIBLE but secondary. By-Conviction
// and By-Market now lead with win rate (ROI kept as the smaller figure). CLV reframed as the honesty
// check. Display/order only -- every number comes from fields the backend already returns; the new
// win-rate chart reads the range-aware winSeries added to /api/performance. No model or grading change.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
const RNGS = ["7D", "30D", "Season", "All"];
const TIER_ORDER = [["HIGH", "HIGH"], ["MEDIUM", "MED"], ["LOW", "LOW"], ["NEUTRAL", "NEUTRAL"]];
const MKT_NAME = {
  moneyline:"Moneyline", total:"Totals", run_line:"Run Line", spread:"Spread",
  hr_prop:"HR Props", player_hits:"Hits Props", player_strikeouts:"K Props",
  player_points:"Points Props", player_rebounds:"Rebounds Props", player_assists:"Assists Props",
  player_threes:"3PT Props", player_props:"Player Props",
};
const prettyMkt = (k) => MKT_NAME[k] || String(k||"").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const winPct = (w, l) => ((w+l) > 0 ? Math.round((w/(w+l))*1000)/10 : 0);

// Range-aware cumulative win-rate curve. 50% (coin flip) is always kept in view as the reference
// floor; the line runs green when it ends above 50, red below.
function WinRateChart({ series }) {
  const W = 320, H = 120;
  const s = (series && series.length) ? series : [];
  if (s.length < 2) return <div className="chartempty">Win-rate trend appears once a few picks are graded in this window.</div>;
  // WZ-WINRATE-ZOOM-2026-07-08 :: fit the axis to where the line actually LIVES. The first
  // handful of picks swing the cumulative rate wildly (1 pick = 0% or 100%), and the old
  // domain [min(50,...all), max(50,...all)] let those outliers blow the scale out to ~30-100%,
  // crushing the real, stable line into a flat worm. We now fit the domain to the SETTLED
  // portion (past a short warmup), always keep 50% in view, pad a touch, then clamp the early
  // outliers to the domain so they ride the edge instead of exploding the scale. Full data
  // still drawn; nothing is hidden -- the axis just stops being dominated by a 3-pick sample.
  const warm = Math.min(25, Math.floor(s.length * 0.05));
  const stable = s.slice(warm).length >= 3 ? s.slice(warm) : s;
  let lo = Math.min(50, ...stable), hi = Math.max(50, ...stable);
  const pad = Math.max(2, (hi - lo) * 0.18); lo -= pad; hi += pad;
  const rng = (hi - lo) || 1; const clampV = (v) => Math.max(lo, Math.min(hi, v));
  const X = (i) => (s.length>1 ? i/(s.length-1) : 0) * W, Y = (v) => H - 6 - ((clampV(v) - lo) / rng) * (H - 14);
  const ln = s.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const ar = ln + `L${W} ${H} L0 ${H} Z`;
  const fiftyY = Y(50); const end = s[s.length-1]; const col = end>=50 ? "var(--green)" : "var(--neg)";
  return (
    <div className="chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="120" preserveAspectRatio="none">
        <defs><linearGradient id="wrg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".26"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
        <line x1="0" y1={fiftyY.toFixed(1)} x2={W} y2={fiftyY.toFixed(1)} stroke="#2a3640" strokeWidth="1" strokeDasharray="3 3"/>
        <path d={ar} fill="url(#wrg)"/>
        <path d={ln} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
      </svg>
    </div>
  );
}

// Compact hero sparkline of the same win-rate curve.
function MiniSpark({ series }) {
  const W = 300, H = 40;
  const s = (series && series.length) ? series : [];
  if (s.length < 2) return null;
  // WZ-MINISPARK-ZOOM-2026-07-08 :: same axis fit as the main WinRateChart so the two match --
  // fit the domain to the settled portion (past a short warmup), keep 50% in view, pad, and
  // clamp early small-sample outliers so they can't flatten the line into a squiggle.
  const warm = Math.min(25, Math.floor(s.length * 0.05));
  const stable = s.slice(warm).length >= 3 ? s.slice(warm) : s;
  let lo = Math.min(50, ...stable), hi = Math.max(50, ...stable);
  const pad = Math.max(2, (hi - lo) * 0.18); lo -= pad; hi += pad;
  const rng = (hi - lo) || 1; const clampV = (v) => Math.max(lo, Math.min(hi, v));
  const X = (i) => (i/(s.length-1)) * W, Y = (v) => H - 4 - ((clampV(v) - lo) / rng) * (H - 10);
  const ln = s.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const end = s[s.length-1]; const col = end>=50 ? "var(--green)" : "var(--neg)";
  return <svg className="mspk" viewBox={`0 0 ${W} ${H}`} width="100%" height="40" preserveAspectRatio="none"><path d={ln} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>;
}

export default function PerformancePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const [league, setLeague] = useState("mlb");
  const [range, setRange] = useState("Season");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // WZ-PERF-ADMIN-ONLY-2026-07-10 :: Performance is admin-only now (pulled from subscriber nav).
  // Load the plan; if the viewer isn't an admin, bounce to the dashboard -- this blocks
  // direct-URL access too, not just the hidden nav link.
  useEffect(() => {
    let done = false;
    subscriptionApi.getMyPlan()
      .then(p => { if (done) return; setPlan(p || { tier:"free", isAdmin:false }); if (!p || p.isAdmin !== true) navigate("/dashboard", { replace: true }); })
      .catch(() => { if (!done) navigate("/dashboard", { replace: true }); });
    return () => { done = true; };
  }, [navigate]);
  useEffect(() => {
    let c = false;
    setLoading(true); setError(false); setData(null);
    fetch(`${API_BASE}/api/performance/${league}`)
      .then(r => { if(!r.ok) throw new Error("bad"); return r.json(); })
      .then(d => { if(!c){ setData(d); setLoading(false); } })
      .catch(() => { if(!c){ setError(true); setLoading(false); } });
    return () => { c = true; };
  }, [league]);

  const D = data || {};
  const d = (D.ranges && D.ranges[range]) || null;
  const tiers = TIER_ORDER.map(([k,lbl]) => { const b = D.byConfidence?.[k]; return b ? { lbl, w:b.wins, l:b.losses, roi:b.roi ?? 0 } : null; }).filter(Boolean);
  const markets = [
    // WZ-PROPS-DARK-2026-07-10 :: core markets only. Props are graded behind the scenes but
    // never shown as a record (no win rate / ROI / CLV), so no prop rows are appended here.
    ...Object.entries(D.byMarket || {}).map(([k,b]) => ({ nm:prettyMkt(k), w:b.wins, l:b.losses, roi:b.roi ?? 0 })),
  ];

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd">
        <div className="hrow">
          <div className="logo">Wize<span className="w">Picks</span></div>
          <span className="open">{"\u25cf"} OPEN</span>
          <div className="sp"/>
          <div className="ibtn" onClick={()=>navigate("/settings")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
        </div>
        <div className="sports">
          <b className={league==="mlb"?"on":""} onClick={()=>setLeague("mlb")}><span className="dot"/>MLB</b>
          <b className={league==="nba"?"on":""} onClick={()=>setLeague("nba")}><span className="dot"/>NBA</b>
        </div>
      </div>

      <div className="ranges">{RNGS.map(r=><b key={r} className={r===range?"on":""} onClick={()=>setRange(r)}>{r}</b>)}</div>

      <div id="wrap">
        {loading ? <div className="estate"><div className="et">Loading record...</div><div className="es">Pulling every graded pick.</div></div>
        : error ? <div className="estate"><div className="et">Couldn't load performance</div><div className="es">Try again in a moment.</div></div>
        : !d ? <div className="estate"><div className="et">No tracked record yet</div><div className="es">Graded picks for {league.toUpperCase()} will appear here.</div></div>
        : <>
          <div className="hero">
            <div className="herotop"><div className="herok">WIN RATE</div><div className="herorec">{range} {"\u00b7"} qualified plays</div></div>
            <div className="herobig">
              <div className="herov">{winPct(d.w,d.l)}<span className="pct">%</span></div>
              <div className="recbadge">{d.w}{"\u2013"}{d.l}<small>{"\u2013"}{d.p}</small></div>
            </div>
            <div className="herosub">{d.n} SETTLED PICKS {"\u00b7"} W{"\u2013"}L{"\u2013"}PUSH</div>
            <div className="spark"><MiniSpark series={d.winSeries}/></div>
          </div>

          <div className="kpis3">
            <div className="kpi"><div className="k">ROI</div><div className={"v "+(d.roi>=0?"g":"r")}>{d.roi>=0?"+":""}{d.roi}%</div><div className="sub">1u flat</div></div>
            <div className="kpi"><div className="k">UNITS</div><div className={"v "+(d.units>=0?"g":"r")}>{d.units>=0?"+":""}{d.units}u</div><div className="sub">cumulative</div></div>
            <div className="kpi"><div className="k">CLV</div><div className={"v "+(d.clv>=0?"g":"")}>{d.clv>=0?"+":""}{d.clv}%</div><div className="sub">beat {d.bc}%</div></div>
          </div>

          <div className="blk"><div className="bl">WIN RATE OVER TIME <span className="bx">{range} {"\u00b7"} cumulative</span></div>
            <WinRateChart series={d.winSeries}/>
            <div className="clvnote" style={{marginTop:8}}>Dashed line = 50% (a coin flip). Holding above it is the model picking winners at better than chance.</div>
          </div>

          {tiers.length>0 && <div className="blk"><div className="bl">BY CONVICTION <span className="bx">{range} {"\u00b7"} win rate</span></div>
            {tiers.map((t,i)=>{ const wr=winPct(t.w,t.l); const bw=Math.max(2,Math.min(100,wr)); return (
              <div className="dbar" key={i}>
                <div className="nm"><div className="n">{t.lbl}</div><div className="r">{t.w}{"\u2013"}{t.l}</div></div>
                <div className="track"><div className="z"/><div className="f" style={{width:bw+"%"}}/></div>
                <div className="v">{wr}%</div>
              </div>); })}
          </div>}

          {markets.length>0 && <div className="blk"><div className="bl">BY MARKET <span className="bx">{range} {"\u00b7"} win rate {"\u00b7"} roi</span></div>
            {markets.map((m,i)=>{ const wr=winPct(m.w,m.l); const pos=m.roi>=0; return (
              <div className="mrow" key={i}><div style={{flex:1}}><div className="mn">{m.nm}</div><div className="mr">{m.w}{"\u2013"}{m.l}</div></div><div className="mwin">{wr}%</div><div className={"mroi "+(pos?"pos":"neg")}>{pos?"+":""}{m.roi}%</div></div>); })}
          </div>}

          <div className="blk"><div className="bl">CLOSING LINE VALUE <span className="bx">secondary {"\u00b7"} is the edge real?</span></div>
            <div className="clvgrid">
              <div className="c"><div className="k">AVG CLV</div><div className={"v "+(d.clv>=0?"g":"")}>{d.clv>=0?"+":""}{d.clv}%</div></div>
              <div className="c"><div className="k">BEAT CLOSE</div><div className="v">{d.bc}%</div></div>
              <div className="c"><div className="k">PICKS</div><div className="v">{d.n}</div></div>
            </div>
            <div className="clvnote">Win rate is the headline. CLV stays as the honesty check: over a large sample it separates a real edge from variance, independent of short-term wins and losses.</div>
          </div>

          <div className="disc">All results are model picks graded at settled prices, 1-unit flat. Past performance does not guarantee future results. Bet responsibly.</div>
        </>}
      </div>

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate("/props")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a className="on"><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
  );
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#0A0B0D;--panel:#14171B;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);--gold:#C9A86A;--green:#3FCB91;--neg:#E2655C;--red:#E2655C;--steel:#2A6F97;--blue:#5DA9E8;--mut:#99A2AA;--mut2:#5B646C;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;--serif:Georgia,'Times New Roman',serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative;padding-bottom:96px}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--serif);font-weight:600;font-size:22px;letter-spacing:-.2px;color:var(--tx)}.logo .w{color:var(--gold)}
.open{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(63,203,145,.34);background:rgba(63,203,145,.1);border-radius:999px;padding:3px 8px}
.sp{flex:1}.ibtn{width:30px;height:30px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.sports{display:flex;gap:6px;padding:0 0 11px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.sports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sports b.on{color:var(--tx);border-color:rgba(63,203,145,.4);background:rgba(63,203,145,.12)}
.sports b .dot{width:6px;height:6px;border-radius:50%;background:#2a3640}.sports b.on .dot{background:var(--green)}
.ranges{display:flex;gap:7px;padding:11px 14px 2px}
.ranges b{flex:0 0 auto;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:8px;padding:6px 13px;cursor:pointer}
.ranges b.on{color:#06090b;background:var(--gold);border-color:var(--gold);font-weight:700}

.hero{margin:12px 14px 0;border:1px solid rgba(201,168,106,.28);border-radius:16px;background:linear-gradient(160deg,#1a1c18,#14171B 60%);padding:16px 16px 14px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;right:-40px;top:-40px;width:160px;height:160px;background:radial-gradient(circle,rgba(201,168,106,.14),transparent 70%);pointer-events:none}
.herotop{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.herok{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:1px;color:var(--gold)}
.herorec{font-family:var(--mono);font-size:10px;color:var(--mut)}
.herobig{display:flex;align-items:flex-end;gap:14px;position:relative;z-index:1}
.herov{font-family:var(--disp);font-weight:800;font-size:64px;line-height:.92;color:#fff;margin-top:6px}
.herov .pct{font-size:32px;color:var(--gold);margin-left:2px}
.recbadge{font-family:var(--disp);font-weight:800;font-size:26px;color:#dbe4e2;padding-bottom:8px}
.recbadge small{font-size:15px;color:var(--mut)}
.herosub{font-family:var(--mono);font-size:9.5px;color:var(--mut2);margin-top:8px;position:relative;z-index:1}
.spark{margin-top:10px;position:relative;z-index:1}.mspk{display:block}

.kpis3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;padding:10px 14px 0}
.kpi{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:11px 10px}
.kpi .k{font-family:var(--mono);font-size:8.5px;color:var(--mut);font-weight:600;letter-spacing:.3px}
.kpi .v{font-family:var(--disp);font-weight:800;font-size:23px;color:#fff;margin-top:3px;line-height:1}.kpi .v.g{color:var(--green)}.kpi .v.r{color:var(--neg)}
.kpi .sub{font-family:var(--mono);font-size:8px;color:var(--mut2);margin-top:3px}

.blk{margin:14px 14px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:13px}
.bl{font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:.7px;color:var(--mut);margin-bottom:11px;display:flex;align-items:center;justify-content:space-between}
.bl .bx{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:0;font-weight:500}
.chartwrap{position:relative}
.chartempty{font-family:var(--mono);font-size:10px;color:var(--mut2);padding:24px 4px;text-align:center;line-height:1.5}
.dbar{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}.dbar:first-of-type{border-top:none}
.dbar .nm{width:82px;flex:0 0 auto}.dbar .nm .n{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2}.dbar .nm .r{font-family:var(--mono);font-size:8.5px;color:var(--mut2);margin-top:1px}
.dbar .track{flex:1;height:20px;position:relative;background:#0e1620;border-radius:5px;border:1px solid var(--line);overflow:hidden}
.dbar .track .z{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#39454f;z-index:1}
.dbar .track .f{position:absolute;top:1px;bottom:1px;left:1px;border-radius:3px;background:var(--green)}
.dbar .v{width:52px;text-align:right;font-family:var(--disp);font-weight:800;font-size:16px;flex:0 0 auto;color:#fff}
.mrow{display:flex;align-items:center;gap:9px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}.mrow:first-of-type{border-top:none}
.mrow .mn{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2}.mrow .mr{font-family:var(--mono);font-size:9px;color:var(--mut)}
.mrow .mwin{font-family:var(--disp);font-weight:800;font-size:16px;width:56px;text-align:right;flex:0 0 auto;color:#fff}
.mrow .mroi{font-family:var(--mono);font-size:10px;width:50px;text-align:right;flex:0 0 auto}.mroi.pos{color:var(--green)}.mroi.neg{color:var(--neg)}
.clvgrid{display:flex;gap:9px}.clvgrid .c{flex:1;text-align:center;border:1px solid var(--line);border-radius:10px;padding:11px 6px}.clvgrid .c .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}.clvgrid .c .v{font-family:var(--disp);font-weight:800;font-size:22px;color:#cfe2f5;margin-top:3px}.clvgrid .c .v.g{color:var(--green)}
.clvnote{font-family:var(--ui);font-size:10.5px;color:var(--mut);margin-top:10px;line-height:1.5}
.disc{font-family:var(--ui);font-size:10px;color:var(--mut2);margin:14px 14px 0;line-height:1.5;text-align:center}
.estate{margin:40px 14px;border:1px dashed var(--line2);border-radius:14px;padding:36px 18px;text-align:center}.estate .et{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfd7e2}.estate .es{font-size:12px;color:var(--mut);margin-top:6px;font-family:var(--mono)}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}.nav a .dbars rect{fill:var(--mut2)}
`;
