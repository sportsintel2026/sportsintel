// PROPS-TB-BOARD-WIRED-2026-06-23
// PROPS-PREMIUM-DARK-RESKIN-2026-06-23
// PROPS-PLAYERCARD-GREEN-2026-06-23
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, playerCardApi } from "../lib/api";

const TEAMCOL = {
  ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#27251F",CHW:"#27251F",
  CIN:"#C6011F",CLE:"#00385D",COL:"#33006F",DET:"#0C2340",HOU:"#EB6E1F",KC:"#004687",LAA:"#BA0021",
  LAD:"#005A9C",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#002B5C",NYM:"#FF5910",NYY:"#0C2340",OAK:"#003831",
  ATH:"#003831",PHI:"#E81828",PIT:"#FDB827",SD:"#2F241D",SF:"#FD5A1E",SEA:"#0C2C56",STL:"#C41E3A",
  TB:"#092C5C",TEX:"#003278",TOR:"#134A8E",WSH:"#AB0003",WAS:"#AB0003"
};
const teamCol = (ab) => TEAMCOL[String(ab||"").toUpperCase()] || "#3a4a57";
const shortTeam = (t) => { const m = String(t||"").match(/[A-Z]{2,3}/); return m ? m[0] : String(t||"").slice(0,3).toUpperCase(); };
const formatOdds = (o) => o==null||o==="" ? "—" : (Number(o)>0 ? "+"+Number(o) : ""+Number(o));
const initialsOf = (name) => { const parts = String(name||"").trim().split(/\s+/); const s = parts.map(w=>w[0]).join("").slice(0,2); return s || String(name||"").slice(0,2); };
const pctOf = (x) => x==null ? null : (x<=1 ? Math.round(x*100) : Math.round(x));

function Avatar({ pid, initials, color, cls }) {
  const [err, setErr] = useState(false);
  const src = pid ? `https://midfield.mlbstatic.com/v1/people/${pid}/spots/120` : null;
  return (
    <div className={cls} style={{ background:`radial-gradient(circle at 50% 28%, ${color}, #0c1018 82%)`, boxShadow:`inset 0 0 0 2px ${color}` }}>
      {src && !err
        ? <img src={src} alt="" onError={()=>setErr(true)} style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"50%" }}/>
        : initials}
    </div>
  );
}

export default function PropsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";
  const [mlb, setMlb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mfilter, setMfilter] = useState("All");
  const [sortBy, setSortBy] = useState("edge");
  const [selProp, setSelProp] = useState(null);
  const [card, setCard] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);
  useEffect(() => {
    let c = false;
    const load = async () => { try { const d = await edgesApi.getMLB(); if(!c) setMlb(d); } catch(e){} if(!c) setLoading(false); };
    load(); const id = setInterval(load, 60000);
    return () => { c = true; clearInterval(id); };
  }, []);

  const openP = (p) => {
    setSelProp(p); setCard(null); setCardLoading(true);
    playerCardApi.getMLB(p.id, { gameId: p.gameId, team: p.teamRaw, name: p.pl[0] })
      .then(d => setCard(d)).catch(()=>setCard(null)).finally(()=>setCardLoading(false));
  };
  const closeP = () => { setSelProp(null); setCard(null); };

  const M = mlb || {};
  const convOf = (p) => {
    const c = String(p.conviction||"").toLowerCase();
    if (c.startsWith("high")) return "high"; if (c.startsWith("med")) return "med"; if (c) return "low";
    const e = (p.edge||0)*100; return e>=4 ? "high" : e>=2 ? "med" : "low";
  };
  const lineOf = (p, unit) => {
    // Feed prop edges carry p.side ("under"/"over"); p.betSide was never present here,
    // so the old default of "O" mislabeled every model under (e.g. a K under as "6+ Ks").
    const sideStr = String(p.side || p.betSide || "").toLowerCase();
    const isUnder = sideStr.startsWith("u");
    // WZ-PROP-UNDER-NOX-2026-06-26 :: "Under 0.5 X" isn't a real betting line — show "No X" (zero of the stat). Higher under lines keep their number.
    if (isUnder) { const ln = Number(p.line ?? 0.5); return ln === 0.5 ? `No ${unit}` : `Under ${p.line} ${unit}`; }
    // Over X.5 → (X+1)+   e.g. Over 0.5 Hits → "1+ Hits", Over 5.5 Ks → "6+ Ks"
    const n = p.line == null ? 1 : Math.ceil(Number(p.line));
    if (unit === "HR" && n === 1) return "Anytime HR";
    return `${n}+ ${unit}`;
  };
  const toP = (p, mk, unit) => ({
    pl: [ p.player || p.name || "—", initialsOf(p.player||p.name||""), teamCol(shortTeam(p.team||p.game||"")) ],
    g: p.game || p.team || "", pos: p.pos || p.position || "",
    line: lineOf(p, unit), odds: formatOdds(p.odds), edge: (p.edge||0)*100,
    mk, conv: convOf(p),
    model: p.modelProb!=null ? Math.round(p.modelProb*100) : null,
    mkt: p.marketProb!=null ? Math.round(p.marketProb*100) : (p.impliedProb!=null ? Math.round(p.impliedProb*100) : null),
    gameId: p.gameId, id: p.playerId || p.id, teamRaw: p.team, pid: p.playerId
  });
  // Total Bases: a CALIBRATED likelihood board (overProb is the validated signal — see
  // TB calibration, n=501). Unlike HR/Hits/K it is not edge-filtered or conviction-tiered,
  // so it's surfaced honestly: model probability is the headline (lk:true), with the
  // model-vs-market edge shown only when present. Pre-ranked by overProb from the backend.
  const toTB = (p) => ({
    pl: [ p.player || "—", initialsOf(p.player||""), teamCol(shortTeam(p.team||p.game||"")) ],
    g: p.game || p.team || "", pos: "",
    line: lineOf({ line: p.line }, "TB"), odds: formatOdds(p.odds),
    edge: p.edgeOverShadow!=null ? p.edgeOverShadow*100 : null,
    mk: "TB", conv: "", lk: true,
    model: p.overProb!=null ? Math.round(p.overProb*100) : null,
    mkt: p.marketFairOver!=null ? Math.round(p.marketFairOver*100) : null,
    gameId: p.gameId, id: p.playerId, teamRaw: p.team, pid: p.playerId,
    expTB: p.expTB ?? null,
  });
  const allProps = [
    ...(M.hrPropEdges||[]).map(p => toP(p,"HR","HR")),
    ...(M.hitsPropEdges||[]).map(p => toP(p,"HITS","Hits")),
    ...((M.kPropEdges||M.ksPropEdges||[])).map(p => toP(p,"K","Ks")),
    ...(M.tbPropEdges||[]).map(toTB),
  ];
  const FILT = ["All","HR","Hits","K","TB"];
  const fmap = { HR:"HR", Hits:"HITS", K:"K", TB:"TB" };
  let list = mfilter==="All" ? allProps : allProps.filter(p => p.mk === fmap[mfilter]);
  const rank = { high:3, med:2, low:1 };
  // Null-safe sort. TB rows (lk) carry no validated edge/tier, so they rank by model prob
  // and sit below the edge-filtered picks; never let a null edge produce NaN ordering.
  const sortKey = (p) => p.lk
    ? -1000 + (p.model ?? 0)
    : (sortBy==="edge" ? (p.edge ?? 0) : (rank[p.conv]||0)*1000 + (p.edge ?? 0));
  // Only surface POSITIVE-edge picks. TB rows (lk:true) are model-probability, not
  // edge-gated, so they're exempt; everything else must beat the market (edge > 0).
  list = list.filter(p => p.lk || (p.edge!=null && p.edge > 0));
  list = [...list].sort((a,b) => sortKey(b) - sortKey(a));
  const edged = list.filter(p => !p.lk && p.edge!=null);
  const avg = (edged.reduce((s,p)=>s+p.edge,0)/Math.max(edged.length,1)).toFixed(1);

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
          {[["MLB","mlb"],["NBA","nba"],["NHL","nhl"],["NFL","nfl"],["CFB","cfb"]].map(([lb,key])=>(
            <b key={key} className={key==="mlb"?"on":""} onClick={()=>{ if(key==="nba")navigate("/nba"); else if(key!=="mlb")navigate(`/${key}-games`); }}><span className="dot"/>{lb}</b>
          ))}
        </div>
      </div>

      {!hasFull ? <Gate navigate={navigate}/> : <>
        <div className="chips">{FILT.map(f=><b key={f} className={f===mfilter?"on":""} onClick={()=>setMfilter(f)}>{f}</b>)}</div>
        <div className="bar">
          <span>{list.length} props · {mfilter==="TB" ? "ranked by model probability" : `avg edge +${avg}%`}</span>
          <span className="sort"><b className={sortBy==="edge"?"on":""} onClick={()=>setSortBy("edge")}>Edge</b><b className={sortBy==="conv"?"on":""} onClick={()=>setSortBy("conv")}>Conviction</b></span>
        </div>
        <div id="wrap">
          {loading ? <div className="plist">{[0,1,2,3,4,5].map(i=>(
              <div key={i} className="skrow">
                <div className="sk skav"/>
                <div className="skb">
                  <div className="sk" style={{width:(56-i*4)+"%",height:13}}/>
                  <div className="sk" style={{width:(34-i*2)+"%",height:8,marginTop:6}}/>
                </div>
                <div className="sk" style={{width:40,height:20}}/>
              </div>))}</div>
            : list.length ? <div className="plist">{list.map((p,i)=><PropRow key={i} p={p} onOpen={openP}/>)}</div>
            : <div className="estate"><div className="et">No {mfilter} props</div><div className="es">Try another market.</div></div>}
        </div>
      </>}

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a className="on"><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>

      {selProp && <PlayerSheet p={selProp} card={card} loading={cardLoading} onClose={closeP}/>}
    </div>
  );
}

function PropRow({ p, onOpen }) {
  return (
    <div className="prow" onClick={()=>onOpen(p)}>
      <div className={"rail "+(p.conv||(p.lk?"lk":""))}/>
      <Avatar pid={p.pid} initials={p.pl[1]} color={p.pl[2]} cls="av"/>
      <div className="pinfo">
        <div className="pn">{p.pl[0]}</div>
        <div className="pmu">{p.g}{p.pos ? " · "+p.pos : ""}</div>
        <div className="pline">{p.line}<span className="od">{p.odds}</span></div>
      </div>
      <div className="pr">
        {p.lk
          ? <><div className="ped">{p.model!=null?p.model+"%":"\u2014"}</div><div className="plb">MODEL</div></>
          : <><div className={"ped "+((p.edge??0)>=0?"":"neg")}>{((p.edge??0)>=0?"+":"")+(p.edge??0).toFixed(1)}%</div><div className="plb">EDGE</div></>}
        <div className={"ptag "+p.mk}>{p.mk}</div>
      </div>
    </div>
  );
}

function MMbar({ model, mkt }) {
  if (model==null) return null;
  return <><div className="mmlab"><span>model <b>{model}%</b></span><span>market {mkt ?? "—"}%</span></div>
    <div className="mmbar"><div className="fill" style={{width:model+"%"}}/>{mkt!=null && <div className="mk" style={{left:mkt+"%"}}/>}</div></>;
}
function Tile({ k, v, cls }) { return <div className="stile"><div className="k">{k}</div><div className={"v "+(cls||"")}>{v ?? "—"}</div></div>; }

function QCBar({ label, val, txt, lo, hi, lg }) {
  if (val==null) return null;
  const clamp=(x)=>Math.max(2,Math.min(100,x));
  const pct=clamp(((val-lo)/(hi-lo))*100);
  const lgPct=Math.max(0,Math.min(100,((lg-lo)/(hi-lo))*100));
  const good = pct>=lgPct;
  return (
    <div className="qcrow">
      <div className="qclab">{label}</div>
      <div className="qctrack">
        <div className="qcfill" style={{width:pct+"%",background:good?"#3FCB91":"#5da9e8"}}/>
        <div className="qctick" style={{left:lgPct+"%"}}/>
      </div>
      <div className="qcval">{txt}</div>
    </div>
  );
}
function SprayField({ bats, pull, straight, oppo, wind }) {
  const isR = String(bats||"").toUpperCase() !== "L"; // default to RHB orientation when unknown
  const R = 122, hx = 110, hy = 152, ri = 40;
  const pt = (d, r) => [hx + r*Math.sin(d*Math.PI/180), hy - r*Math.cos(d*Math.PI/180)];
  const f = (n) => Number(n).toFixed(1);
  const xy = (d, r) => { const [x,y] = pt(d,r); return `${f(x)},${f(y)}`; };
  const wedge = (a, b, r=R) => `M${hx},${hy} L${xy(a,r)} A${r},${r} 0 0 1 ${xy(b,r)} Z`;
  const mx = Math.max(pull||0, straight||0, oppo||0, 1);
  const op = (v) => (0.16 + 0.62*((v||0)/mx)).toFixed(2);
  const left  = isR ? { l:"PULL", v:pull, c:"#3FCB91" } : { l:"OPPO", v:oppo, c:"#5da9e8" };
  const right = isR ? { l:"OPPO", v:oppo, c:"#5da9e8" } : { l:"PULL", v:pull, c:"#3FCB91" };
  const ctr   = { l:"CTR", v:straight, c:"#8b97a4" };
  const pullSec = isR ? [-45,-15] : [15,45];
  const lp = (d) => pt(d, R*0.62);
  const [lx,ly] = lp(-30), [cx,cy] = lp(0), [rx,ry] = lp(30);
  const Txt = (x, y, z) => (<g key={z.l}><text x={f(x)} y={f(y)} fontSize="12.5" fontWeight="700" fill="#eaf1ee">{z.v!=null?z.v+"%":"—"}</text><text x={f(x)} y={f(y+11)} fontSize="7.5" fill="#aeb9c8">{z.l}</text></g>);
  const home=[hx,hy], b1=pt(45,ri), b2=pt(0,ri*1.42), b3=pt(-45,ri);
  const diamond = `M${xy(0,0)} L${f(b1[0])},${f(b1[1])} L${f(b2[0])},${f(b2[1])} L${f(b3[0])},${f(b3[1])} Z`;
  const Base = ({p}) => <rect x={f(p[0]-2.1)} y={f(p[1]-2.1)} width="4.2" height="4.2" fill="#e8eef5" transform={`rotate(45 ${f(p[0])} ${f(p[1])})`}/>;
  const we = wind && !wind.indoor ? wind.windEffect : null;
  let windEl = null;
  if (we==="out" || we==="in") {
    const col = we==="out" ? "#3FCB91" : "#ff7a6c";
    const yTop=hy-116, yBot=hy-84;
    windEl = we==="out"
      ? <g opacity="0.95"><line x1={hx} y1={yBot} x2={hx} y2={yTop+5} stroke={col} strokeWidth="2.6" strokeLinecap="round"/><polygon points={`${hx-4.5},${yTop+6} ${hx+4.5},${yTop+6} ${hx},${yTop-1}`} fill={col}/></g>
      : <g opacity="0.95"><line x1={hx} y1={yTop} x2={hx} y2={yBot-5} stroke={col} strokeWidth="2.6" strokeLinecap="round"/><polygon points={`${hx-4.5},${yBot-6} ${hx+4.5},${yBot-6} ${hx},${yBot+1}`} fill={col}/></g>;
  } else if (we==="cross") {
    windEl = <g opacity="0.9"><line x1={hx-28} y1={hy-100} x2={hx+24} y2={hy-100} stroke="#f0b24a" strokeWidth="2.4" strokeLinecap="round"/><polygon points={`${hx+24},${hy-104.5} ${hx+24},${hy-95.5} ${hx+31},${hy-100}`} fill="#f0b24a"/></g>;
  }
  return (
    <svg viewBox="0 0 220 166" xmlns="http://www.w3.org/2000/svg">
      <path d={wedge(-45,45)} fill="#0e2417"/>
      <path d={wedge(-45,-15)} fill={left.c} opacity={op(left.v)}/>
      <path d={wedge(-15,15)} fill={ctr.c} opacity={op(ctr.v)}/>
      <path d={wedge(15,45)} fill={right.c} opacity={op(right.v)}/>
      <path d={wedge(pullSec[0],pullSec[1])} fill="none" stroke="#3FCB91" strokeWidth="1.3" opacity="0.7"/>
      <path d={`M${xy(-45,R)} A${R},${R} 0 0 1 ${xy(45,R)}`} stroke="#3f5340" strokeWidth="2.2" fill="none"/>
      <path d={`M${xy(-45,R-6)} A${R-6},${R-6} 0 0 1 ${xy(45,R-6)}`} stroke="#26331f" strokeWidth="3" fill="none" opacity="0.5"/>
      <path d={`M${hx},${hy} L${xy(-45,R)} M${hx},${hy} L${xy(45,R)}`} stroke="#cdd7c8" strokeWidth="1.2" fill="none" opacity="0.5"/>
      <line x1={f(pt(-45,R)[0])} y1={f(pt(-45,R)[1])} x2={f(pt(-45,R)[0])} y2={f(pt(-45,R)[1]-12)} stroke="#f3b94f" strokeWidth="1.6"/>
      <line x1={f(pt(45,R)[0])} y1={f(pt(45,R)[1])} x2={f(pt(45,R)[0])} y2={f(pt(45,R)[1]-12)} stroke="#f3b94f" strokeWidth="1.6"/>
      <g fontFamily="'IBM Plex Mono',monospace" fontSize="8" fill="#9aa6b2" textAnchor="middle"><text x={f(pt(-37,R*0.88)[0])} y={f(pt(-37,R*0.88)[1])}>LF</text><text x={f(pt(37,R*0.88)[0])} y={f(pt(37,R*0.88)[1])}>RF</text></g>
      <path d={diamond} fill="#3a2c1d" stroke="#5a4631" strokeWidth="1"/>
      <circle cx={hx} cy={f(hy-ri*0.6)} r="3.2" fill="#4a3826"/>
      <Base p={home}/><Base p={b1}/><Base p={b2}/><Base p={b3}/>
      {windEl}
      <g fontFamily="'IBM Plex Mono',monospace" textAnchor="middle">{Txt(lx,ly,left)}{Txt(cx,cy,ctr)}{Txt(rx,ry,right)}</g>
    </svg>
  );
}
function PlayerSheet({ p, card, loading, onClose }) {
  const c = card || {};
  const isK = p.mk === "K";
  const bats = c.player?.bats || c.bats || "";
  const sR = c.splits?.vsRHP || {}, sL = c.splits?.vsLHP || {};
  const slash = (s) => [s.avg, s.obp, s.slg].map(x => x==null ? "—" : (typeof x==="number" ? (x<1?x.toFixed(3).replace(/^0/,""):x) : x)).join(" / ");
  const fmt3 = (x) => x==null ? "—" : (typeof x==="number" ? (x<1?x.toFixed(3).replace(/^0/,""):x.toFixed(3)) : x);
  const opsOf = (s) => s?.ops!=null ? s.ops : (s?.obp!=null&&s?.slg!=null ? s.obp+s.slg : null);
  const bb = c.battedBall || {};
  const pull = pctOf(bb.pullPct), straight = pctOf(bb.straightPct), oppo = pctOf(bb.oppoPct);
  const haveBB = pull!=null && straight!=null && oppo!=null;
  const lean = haveBB ? (pull>=straight && pull>=oppo ? ["Heavy Pull","pull-side power is the HR signal"]
              : oppo>=pull && oppo>=straight ? ["Oppo","uses the whole field"] : ["Spray","balanced batted-ball spread"]) : null;
  const gb = pctOf(bb.gbPct), ld = pctOf(bb.ldPct), fb = pctOf(bb.fbPct), pu = pctOf(bb.puPct);
  const haveType = gb!=null && fb!=null && ld!=null;
  const typeRead = haveType ? (
      fb>=32 ? ["Fly-ball","elevates the ball — the HR-friendly profile"]
    : gb>=48 ? ["Ground-ball","keeps it down — caps HR upside"]
    : ld>=25 ? ["Line-drive","squares it up — hits over pop"]
    : ["Balanced","even batted-ball mix"]) : null;
  const meas = c.factors?.measured || {};
  const pit = c.pitcher || {};
  const recent = meas.recent15 || {};
  const recentHR = recent.hr ?? null;
  const park = c.factors?.park || {};
  const wx = c.factors?.weather || {};
  const pctFac = (v) => v==null ? "—" : (v>1?"+":"")+Math.round((v-1)*100)+"%";
  const windSpray = (() => {
    if (!wx || wx.indoor || !wx.windEffect || wx.windEffect==="calm") return null;
    const dom = (pull>=straight&&pull>=oppo) ? "pull" : (oppo>=pull&&oppo>=straight) ? "oppo" : "center";
    const mph = wx.windMph!=null ? `${wx.windMph} mph` : "";
    if (wx.windEffect==="out") return { cls:"wout", arrow:"\u2191", text:`Wind OUT ${mph} — carries fly balls${dom==="pull"?", aids pull-side power":""}` };
    if (wx.windEffect==="in")  return { cls:"win",  arrow:"\u2193", text:`Wind IN ${mph} — knocks down fly balls` };
    return { cls:"", arrow:"\u2192", text:`Cross wind ${mph}` };
  })();
  const oppP = c.matchup?.opposingPitcher || c.matchup?.pitcher || null;
  const pHandRaw = c.matchup?.pitcherHand || null;
  const pHand = pHandRaw==="L" ? "LHP" : pHandRaw==="R" ? "RHP" : null;
  const platoon = !!c.factors?.platoonAdvantage;
  const hist = c.modelVsMarket || [];
  const f = c.factors || {};
  const toHomer = p.model!=null ? Math.round(p.model<=1?p.model*100:p.model) : null;
  const mktPct = p.mkt!=null ? Math.round(p.mkt<=1?p.mkt*100:p.mkt) : null;
  const barrelV = meas.barrelPct!=null ? (meas.barrelPct<=1?meas.barrelPct*100:meas.barrelPct) : null;
  const bTier = meas.barrelTier || (barrelV!=null ? (barrelV>=16?"elite":barrelV>=11?"strong":barrelV>=8?"above avg":"average") : null);
  const xwTier = meas.xwoba!=null ? (meas.xwoba>=0.36?"elite":meas.xwoba>=0.34?"strong":meas.xwoba>=0.32?"above avg":"average") : null;
  const parkPct = park.factor!=null ? Math.round((Number(park.factor)-1)*100) : null;
  const cg = hist.slice(-8);
  const mP = (g)=>{ const m=g.modelProb ?? g.model ?? g.modelPct ?? g.modelHrPct; return m!=null?(m<=1?m*100:m):null; };
  const kP = (g)=>{ const k=g.marketImplied ?? g.market ?? g.marketPct; return k!=null?(k<=1?k*100:k):null; };
  const cmax = Math.max(1, ...cg.flatMap(g=>[mP(g)||0, kP(g)||0]))*1.18;
  const barFrac = (v)=> v==null?0:Math.max(6,Math.min(100,Math.round(v/cmax*100)));
  const tcls = (t)=> t==="elite"||t==="strong" ? "g" : "";
  const splitOrder = pHandRaw==="L" ? [["LHP",sL,true],["RHP",sR,false]]
                   : pHandRaw==="R" ? [["RHP",sR,true],["LHP",sL,false]]
                   : [["RHP",sR,false],["LHP",sL,false]];
  const whyParts = [];
  if (meas.barrelPct!=null) whyParts.push(`${typeof meas.barrelPct==="number"?(meas.barrelPct*100).toFixed(1):meas.barrelPct}% barrel rate`);
  if (haveBB && pull>=45) whyParts.push(`${pull}% pull rate`);
  if (f.platoonAdvantage) whyParts.push("a platoon edge tonight");
  if (isK && pit.kPct!=null) whyParts.push(`a ${(pit.kPct*100).toFixed(0)}% strikeout rate`);
  if (isK && pit.whiffPct!=null) whyParts.push(`${(pit.whiffPct*100).toFixed(0)}% whiff rate`);
  if (!isK && park.factor) whyParts.push(`a ${park.factor} HR park`);
  const why = c.factors?.why || c.why || p.reason
    || (whyParts.length ? `Model sees value vs the price — ${whyParts.slice(0,3).join(", ")}.` : "Model projects more value than the posted price implies.");

  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:60}}/>
      <div className="sheet show" style={{zIndex:61}}>
        <div className="shead"><div className="x" onClick={onClose}>{"\u2039"}</div><div><div className="t">{p.pl[0]}</div><div className="ts">{p.g} · {p.line}</div></div></div>
        <div className="sbody">
          {loading && <div className="dblk"><div className="estate" style={{padding:16}}><div className="es">Loading player card…</div></div></div>}

          {isK ? (
            <>
              <div className="dblk"><div className="recline">
                <Avatar pid={p.pid} initials={p.pl[1]} color={p.pl[2]} cls="av2"/>
                <div className="rl"><div className="bet">{p.line}</div><div className="sub">{shortTeam(p.teamRaw||p.g)} · best <b>{p.odds}</b></div></div>
                <div className="edg"><div className={"e "+((p.edge!=null&&p.edge<0)?"neg":"")}>{p.edge!=null?`${p.edge>=0?"+":""}${p.edge.toFixed(1)}%`:(p.model!=null?p.model+"%":"\u2014")}</div><div className="c">{p.conv?p.conv.toUpperCase()+" CONV":"MODEL"}</div></div>
              </div><MMbar model={p.model} mkt={p.mkt}/></div>
              <div className="dblk"><div className="bl">PITCHING <span className="bx">season rates</span></div>
                <div className="stiles">
                  <Tile k="K%" v={pit.kPct!=null?(pit.kPct*100).toFixed(1)+"%":null} cls="g"/>
                  <Tile k="WHIFF%" v={pit.whiffPct!=null?(pit.whiffPct*100).toFixed(1)+"%":null} cls="gold"/>
                  <Tile k="BB%" v={pit.bbPct!=null?(pit.bbPct*100).toFixed(1)+"%":null}/>
                  <Tile k="SWING%" v={pit.swingPct!=null?(pit.swingPct*100).toFixed(1)+"%":null}/>
                </div>
              </div>
              <div className="dblk"><div className="bl">PARK &amp; WEATHER{!wx.indoor && wx.forecastAtGameTime ? <span className="bx">at first pitch</span> : null}</div><div className="ctx">
                <span className="ch">HR <b>{pctFac(park.factor)}</b></span>
                {park.runFactor!=null && <span className="ch">Runs <b>{pctFac(park.runFactor)}</b></span>}
                {wx.indoor ? <span className="ch">Dome · roof closed</span> : <>
                  {wx.tempF!=null && <span className="ch">{wx.tempF}°F{wx.tempEffect&&wx.tempEffect!=="neutral"?` · ${wx.tempEffect}`:""}</span>}
                  {wx.windLabel && <span className={"ch "+(wx.windEffect==="out"?"wout":wx.windEffect==="in"?"win":"")}>{wx.windLabel}</span>}
                  {(wx.conditions||wx.isRaining) && <span className="ch">{wx.conditions||""}{wx.isRaining?" · rain":""}</span>}
                </>}
              </div></div>
              <div className="dblk"><div className="why"><span className="wl">WHY THE EDGE</span>{why}</div></div>
            </>
          ) : (
            <>
              <div className="dblk"><div className="hpHead">
                <Avatar pid={p.pid} initials={p.pl[1]} color={p.pl[2]} cls="hpAv"/>
                <div className="hpInfo"><div className="hpName">{p.pl[0]}</div><div className="hpMu">{p.g}</div><div className="hpLn">{p.line} · best <b>{p.odds}</b></div></div>
                <div className="hpTo"><div className="v">{toHomer!=null?toHomer:"—"}<small>%</small></div><div className="l">TO HOMER</div></div>
              </div></div>

              {oppP && <div className="hpTvs"><div className="l">Tonight vs <b>{oppP}</b></div><div className="hpBdg">{pHand && <span className="hpHand">{pHand}</span>}{platoon && <span className="hpPlat">{"\u25b2"} platoon edge</span>}</div></div>}

              <div className="hpSl">HAND VS HAND{bats?` · BATS ${bats}`:""}</div>
              <div className="hpHvh">
                {splitOrder.map(([lbl,s,on],i)=>(
                  <div key={i} className={"hpHv"+(on?" on":"")}>
                    {on && <div className="hpTn">TONIGHT</div>}
                    <div className="hpHl">vs {lbl}</div>
                    <div className="hpOps">{fmt3(opsOf(s))}</div><div className="hpOpl">OPS</div>
                    <div className="hpG4r">
                      <div className="hpG4"><div className="n">{fmt3(s.avg)}</div><div className="k">AVG</div></div>
                      <div className="hpG4"><div className="n">{fmt3(s.slg)}</div><div className="k">SLG</div></div>
                      <div className="hpG4"><div className="n hr">{s.hr??"—"}</div><div className="k">HR</div></div>
                      <div className="hpG4"><div className="n">{s.ab??"—"}</div><div className="k">AB</div></div>
                    </div>
                  </div>
                ))}
              </div>

              {cg.length>0 && (
                <>
                  <div className="hpSl">MODEL % VS MARKET %</div>
                  <div className="hpChart">
                    <div className="hpChd"><div className="t">Model HR% vs market implied · last {cg.length}</div><div className="r"><span className="m">{toHomer!=null?toHomer+"%":"—"}</span> <span className="x">vs</span> <span className="k">{mktPct!=null?mktPct+"%":"—"}</span></div></div>
                    <div className="hpCwrap">{cg.map((g,i)=>{ const m=mP(g),k=kP(g); return (
                      <div key={i} className="hpCol"><div className={"hpBar"+((m!=null&&k!=null&&m<k)?" under":"")} style={{height:barFrac(m)+"%"}}/>{k!=null&&<div className="hpMkt" style={{bottom:barFrac(k)+"%"}}/>}</div>
                    );})}</div>
                    <div className="hpDots">{cg.map((g,i)=><div key={i} className="hpDot"><i className={g.homered?"y":"n"}/></div>)}</div>
                    <div className="hpLeg"><span><i/>model %</span><span><i className="ln"/>market %</span><span><i className="rnd"/>homered</span></div>
                    <div className="hpCap">Bars above the blue line = model sees more value than the price.</div>
                  </div>
                </>
              )}

              <div className="hpSl">WHAT THE MODEL SEES</div>
              <div className="hpWms">
                <div className="hpWs"><div className="hpWt"><span className="k">Barrel %</span>{bTier&&<span className={"hpBd "+tcls(bTier)}>{bTier}</span>}</div><div className="hpWv">{barrelV!=null?barrelV.toFixed(1)+"%":"—"}</div><div className="hpPbar"><i style={{width:Math.min(100,(barrelV||0)/20*100)+"%"}}/></div></div>
                <div className="hpWs"><div className="hpWt"><span className="k">xwOBA</span>{xwTier&&<span className={"hpBd "+tcls(xwTier)}>{xwTier}</span>}</div><div className="hpWv">{fmt3(meas.xwoba)}</div><div className="hpPbar"><i style={{width:Math.min(100,(meas.xwoba||0)/0.45*100)+"%"}}/></div></div>
                <div className="hpWs"><div className="hpWt"><span className="k">Recent · L15</span></div><div className="hpWv">{recentHR ?? 0} HR</div><div className="hpWsub">{fmt3(recent.avg)} / {fmt3(recent.slg)}{recent.ab!=null?` · ${recent.ab} AB`:""}</div></div>
                <div className="hpWs"><div className="hpWt"><span className="k">Platoon</span>{platoon&&<span className="hpBd g">+adv</span>}</div><div className="hpWv">{platoon?"advantage":"neutral"}</div><div className="hpWsub">{bats?`${bats} bat`:""}{pHand?` vs ${pHand}`:""}</div></div>
                {park.factor!=null && <div className="hpWs full"><div className="hpWt"><span className="k">Park{park.venue?` · ${park.venue}`:""}</span>{parkPct!=null&&parkPct>0&&<span className="hpBd gold">+HR</span>}</div><div className="hpWv">{parkPct!=null?(parkPct>=0?"+":"")+parkPct+"%":"—"}</div></div>}
              </div>

              {(barrelV!=null || meas.xwoba!=null || meas.xba!=null || meas.xslg!=null || bb.hardHitPct!=null) && <>
                <div className="hpSl">QUALITY OF CONTACT</div>
                <div className="dblk qcwrap">
                  <QCBar label="Barrel%" val={barrelV} txt={barrelV!=null?barrelV.toFixed(1)+"%":"—"} lo={0} hi={24} lg={8}/>
                  <QCBar label="xwOBA" val={meas.xwoba} txt={fmt3(meas.xwoba)} lo={0.250} hi={0.450} lg={0.315}/>
                  <QCBar label="xBA" val={meas.xba} txt={fmt3(meas.xba)} lo={0.200} hi={0.330} lg={0.245}/>
                  <QCBar label="xSLG" val={meas.xslg} txt={fmt3(meas.xslg)} lo={0.300} hi={0.620} lg={0.410}/>
                  <QCBar label="Hard-Hit%" val={bb.hardHitPct} txt={bb.hardHitPct!=null?bb.hardHitPct.toFixed(1)+"%":"—"} lo={25} hi={60} lg={38}/>
                  <div className="qcnote"><span className="qctk"/> league avg · green = above</div>
                </div>
              </>}

              {haveBB && (
                <>
                  <div className="hpSl">SPRAY CHART</div>
                  <div className="hpSpray">
                    <SprayField bats={bats} pull={pull} straight={straight} oppo={oppo} wind={wx}/>
                    <div className="hpSprayCap">{bats?`${bats}HB`:"bats —"} · pulls to {String(bats).toUpperCase()==="L"?"right":"left"} field{bb.thin?" · thin sample":""}</div>
                    {windSpray && <div className={"hpWind "+windSpray.cls}><span className="ar">{windSpray.arrow}</span> {windSpray.text}</div>}
                  </div>
                  <div className="hpSl">BATTED-BALL PROFILE</div>
                  <div className="hpChart">
                    <div className="bbbar"><i className="pull" style={{width:pull+"%",background:"#3FCB91"}}/><i className="straight" style={{width:straight+"%",background:"#3a4756"}}/><i className="oppo" style={{width:oppo+"%",background:"#5da9e8"}}/></div>
                    <div className="bbleg"><span><i style={{background:"#3FCB91"}}/>Pull {pull}%</span><span><i style={{background:"#3a4756"}}/>Straight {straight}%</span><span><i style={{background:"#5da9e8"}}/>Oppo {oppo}%</span></div>
                    {lean && <div className="bbread"><b>{lean[0]}</b> hitter — {lean[1]}</div>}
                  </div>
                  {haveType && <>
                  <div className="hpSl">BATTED-BALL TYPE</div>
                  <div className="hpChart">
                    <div className="bbbar"><i style={{width:gb+"%",background:"#5a4a3a"}}/><i style={{width:ld+"%",background:"#5da9e8"}}/><i style={{width:fb+"%",background:"#3FCB91"}}/><i style={{width:pu+"%",background:"#2c3640"}}/></div>
                    <div className="bbleg"><span><i style={{background:"#5a4a3a"}}/>GB {gb}%</span><span><i style={{background:"#5da9e8"}}/>LD {ld}%</span><span><i style={{background:"#3FCB91"}}/>FB {fb}%</span><span><i style={{background:"#2c3640"}}/>PU {pu}%</span></div>
                    {typeRead && <div className="bbread"><b>{typeRead[0]}</b> hitter — {typeRead[1]}</div>}
                  </div>
                  </>}
                </>
              )}

              <div className="hpFoot">A <b>Wize</b>Picks read — a lean, not a guarantee.</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Gate({ navigate }) {
  return <div style={{ margin:"18px 14px", border:"1px solid rgba(201,168,106,.3)", borderRadius:13, background:"var(--panel)", padding:26, textAlign:"center" }}>
    <div style={{ fontSize:22, marginBottom:10 }}>{"\uD83D\uDD12"}</div>
    <div style={{ fontWeight:800, color:"#fff", fontSize:15, marginBottom:6 }}>Player props are All-Access</div>
    <div style={{ color:"#7d8a98", fontSize:12, marginBottom:16 }}>HR, Hits & strikeout edges — model vs market, ranked.</div>
    <div onClick={()=>navigate("/pricing")} style={{ display:"inline-block", background:"#f3b94f", color:"#06090b", fontWeight:800, fontSize:13, padding:"10px 18px", borderRadius:10, cursor:"pointer" }}>Unlock All-Access {"\u203a"}</div>
  </div>;
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}
.bbwrap{margin-top:2px}
.bbbar{display:flex;height:13px;border-radius:7px;overflow:hidden;background:#0c1219}
.bbbar i{display:block;height:100%}
.bbleg{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:#7d8a98;margin-top:8px}
.bbleg span{display:flex;align-items:center;gap:5px}
.bbleg i{width:9px;height:9px;border-radius:2px;display:inline-block}
.bbread{font-size:11px;color:#7d8a98;text-align:center;margin-top:10px}.bbread b{color:#e8eef3}
.hrsplit{font-family:var(--mono);font-size:10px;color:#7d8a98;text-align:center;margin-top:9px}.hrsplit b{color:#f3b94f}

:root{--bg:#0A0B0D;--panel:#14171B;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);--gold:#C9A86A;--green:#3FCB91;--neg:#E2655C;--red:#E2655C;--steel:#2A6F97;--blue:#5DA9E8;--mut:#99A2AA;--mut2:#5B646C;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;--serif:Georgia,'Times New Roman',serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--serif);font-weight:600;font-size:22px;letter-spacing:-.2px;color:var(--tx)}.logo .w{color:var(--gold)}
.open{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(63,203,145,.34);background:rgba(63,203,145,.1);border-radius:999px;padding:3px 8px}
.sp{flex:1}.ibtn{width:30px;height:30px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.sports{display:flex;gap:6px;padding:0 0 11px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.sports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sports b.on{color:var(--tx);border-color:rgba(63,203,145,.4);background:rgba(63,203,145,.12)}
.sports b .dot{width:6px;height:6px;border-radius:50%;background:#2a3640}.sports b.on .dot{background:var(--green)}
.chips{display:flex;gap:7px;padding:11px 4px 4px;overflow-x:auto;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chips b{flex:0 0 auto;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:8px;padding:6px 12px;cursor:pointer}
.chips b.on{color:#06090b;background:var(--gold);border-color:var(--gold);font-weight:700}
.bar{display:flex;align-items:center;justify-content:space-between;padding:9px 4px 0;font-family:var(--mono);font-size:10px;color:var(--mut)}
.bar .sort{display:flex;gap:0;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.bar .sort b{padding:5px 10px;color:var(--mut);cursor:pointer;font-weight:600}.bar .sort b.on{background:#141d24;color:#fff}
.prow{position:relative;display:flex;align-items:center;gap:11px;margin:0;border:none;border-radius:0;background:transparent;padding:11px 13px 11px 16px;overflow:hidden;cursor:pointer;transition:background .15s}.prow+.prow{border-top:1px solid var(--line)}.plist{margin:8px 4px 0;background:var(--panel);border-radius:13px;overflow:hidden}
.prow:active{background:rgba(255,255,255,.03)}
.prow .rail{position:absolute;left:0;top:0;bottom:0;width:4px}.rail.high{background:var(--green)}.rail.med{background:var(--gold)}.rail.low{background:#39454f}.rail.lk{background:#2a6f97}
.prow .av{width:42px;height:42px;border-radius:50%;display:flex;align-items:flex-end;justify-content:center;font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;flex:0 0 auto;overflow:hidden}
.prow .pinfo{flex:1;min-width:0}
.prow .pn{font-weight:700;font-size:14px;color:#eef3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .pmu{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:1px}
.prow .pline{font-family:var(--disp);font-weight:800;font-size:13px;color:#cdd7e1;margin-top:4px}.pline .od{font-family:var(--mono);font-size:11px;color:var(--mut);font-weight:600;margin-left:6px}
.prow .pr{text-align:right;flex:0 0 auto}
.prow .ped{font-family:var(--disp);font-weight:800;font-size:22px;color:var(--green);line-height:1}.prow .ped.neg{color:var(--neg)}
.prow .plb{font-family:var(--mono);font-size:8px;color:var(--mut);font-weight:700;margin-top:2px;letter-spacing:.3px}
.prow .ptag{display:inline-block;font-family:var(--mono);font-size:8px;font-weight:700;border-radius:5px;padding:2px 6px;margin-top:5px}
.ptag.HR{color:var(--gold);background:rgba(201,168,106,.14)}.ptag.HITS{color:var(--blue);background:rgba(93,169,232,.12)}.ptag.K{color:#c08bff;background:rgba(155,123,255,.14)}.ptag.TB{color:#7fdcc0;background:rgba(45,160,120,.16)}
.seclbl{font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:1px;color:var(--mut);margin:24px 4px 2px}
/* PROPS-POLISH-2026-06-26 :: 12px inset, 8pt rhythm, de-boxed prop list */
#wrap{padding-bottom:96px}
/* LOADING-SKELETON-2026-06-26 :: shimmer placeholder */
.sk{background:#141a20;background-image:linear-gradient(90deg,rgba(255,255,255,0) 0,rgba(255,255,255,.06) 50%,rgba(255,255,255,0) 100%);background-size:200% 100%;animation:sksh 1.3s ease-in-out infinite;border-radius:6px}
@keyframes sksh{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skrow{display:flex;align-items:center;gap:11px}
.skrow+.skrow{border-top:1px solid var(--line)}
.skb{flex:1;min-width:0}
.skrow{padding:11px 13px 11px 16px}
.skav{width:42px;height:42px;border-radius:50%;flex:0 0 auto}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}.nav a .dbars rect{fill:var(--mut2)}
/* detail sheet */
.sheet{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:460px;z-index:200;background:#20201E;overflow-y:auto;transform:translate(-50%,100%);transition:transform .28s cubic-bezier(.4,0,.2,1);visibility:hidden}
.sheet.show{transform:translate(-50%,0);visibility:visible}
.shead{position:sticky;top:0;background:#000;backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px 14px;display:flex;align-items:center;gap:11px;z-index:2}
.shead .x{width:32px;height:32px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:#cdd7e1;font-size:19px;cursor:pointer;flex:0 0 auto}
.shead .t{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;line-height:1}.shead .ts{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:2px}
.sbody{padding:13px 4px 80px}
.dblk{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:13px;margin-top:11px}
.dblk .bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.7px;color:var(--mut);margin-bottom:11px;display:flex;align-items:center;justify-content:space-between}
.dblk .bl .bx{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:0;font-weight:500}
/* recommendation */
.recline{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.recline .av2{width:50px;height:50px;border-radius:50%;display:flex;align-items:flex-end;justify-content:center;font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;flex:0 0 auto;overflow:hidden}
.recline .rl .bet{font-family:var(--disp);font-weight:800;font-size:20px;color:#fff}.recline .rl .sub{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:2px}
.recline .rl .sub b{color:var(--blue)}
.recline .edg{margin-left:auto;text-align:right}.recline .edg .e{font-family:var(--disp);font-weight:800;font-size:26px;color:var(--green);line-height:1}.recline .edg .e.neg{color:var(--neg)}.recline .edg .c{font-family:var(--mono);font-size:8px;color:var(--mut);font-weight:700}
.mmlab{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--mut);margin-bottom:5px}.mmlab b{color:#fff}
.mmbar{position:relative;height:26px;border-radius:7px;background:#0e1620;border:1px solid var(--line);overflow:hidden}
.mmbar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--green)}
.mmbar .mk{position:absolute;top:-2px;bottom:-2px;width:2px;background:#fff}
.mmbar .mkl{position:absolute;top:50%;transform:translateY(-50%);font-family:var(--mono);font-size:8px;color:#06090b;font-weight:700;padding:0 5px}
.stiles{display:flex;gap:9px}
.stile{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 6px;text-align:center}
.stile .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}.stile .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfe2f5;margin-top:3px}.stile .v.g{color:var(--green)}.stile .v.gold{color:var(--gold)}
.splitrow{display:flex;gap:9px}
.scol{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center}.scol.on{border-color:var(--gold);background:rgba(201,168,106,.06)}
.scol .sh{font-family:var(--mono);font-size:9px;color:var(--mut);font-weight:600}.scol .sh b{color:var(--gold)}
.scol .sv{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;margin-top:5px}.scol .ss{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:2px}
.spark15{display:flex;align-items:flex-end;gap:3px;height:40px;margin-bottom:7px}
.spark15 i{flex:1;background:#26405a;border-radius:2px 2px 0 0;min-height:3px;position:relative}.spark15 i.hit{background:var(--green)}.spark15 i.hr{background:var(--gold)}
.l15cap{font-family:var(--mono);font-size:10px;color:var(--mut)}.l15cap b{color:#cdd7e1}
.orow{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.orow:first-of-type{border-top:none}
.orow .ol{font-family:var(--disp);font-weight:800;font-size:13px;color:#dbe4e2;flex:1}.orow .ov{font-family:var(--mono);font-size:11px;color:#cdd7e1}.orow .ov b{color:#fff}
.ctx{display:flex;flex-wrap:wrap;gap:7px}.ctx .ch{font-family:var(--mono);font-size:10px;color:#aeb9c8;background:#0e1620;border:1px solid var(--line2);border-radius:7px;padding:5px 9px}.ctx .ch b{color:#fff}
.ctx .ch.wout{color:#46E0A9;border-color:rgba(126,224,168,.32)}.ctx .ch.win{color:#ff8f80;border-color:rgba(255,143,128,.32)}
.bbgrid{display:flex;gap:8px}.bbgrid .bb{flex:1;text-align:center;border:1px solid var(--line);border-radius:9px;padding:8px 4px}.bbgrid .bb .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}.bbgrid .bb .v{font-family:var(--disp);font-weight:800;font-size:16px;color:#cfe2f5;margin-top:2px}
.hpSpray{display:flex;flex-direction:column;align-items:center;gap:5px;margin:2px 0 6px}.hpSpray svg{width:100%;max-width:306px;display:block}
.qcwrap{padding:15px 14px}
.qcrow{display:flex;align-items:center;gap:11px;margin:11px 0}.qcrow:first-child{margin-top:1px}
.qclab{font-family:var(--mono);font-size:10px;color:#aeb9c8;width:52px;flex:0 0 auto}
.qctrack{position:relative;flex:1;height:8px;background:#10161d;border-radius:5px}
.qcfill{position:absolute;left:0;top:0;height:100%;border-radius:5px}
.qctick{position:absolute;top:-2px;width:2px;height:12px;background:#e8eef3;opacity:.55;border-radius:1px}
.qcval{font-family:var(--mono);font-size:11px;color:#e8eef3;font-weight:700;width:44px;text-align:right;flex:0 0 auto}
.qcnote{font-family:var(--mono);font-size:8.5px;color:var(--mut2);margin-top:11px;display:flex;align-items:center;gap:6px}
.qcnote .qctk{display:inline-block;width:2px;height:9px;background:#e8eef3;opacity:.55}
.hpSprayCap{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:.3px}
.hpWind{font-family:var(--mono);font-size:9.5px;letter-spacing:.2px;color:#aeb9c8;margin-top:2px;text-align:center}.hpWind .ar{font-weight:800;font-size:11px}.hpWind.wout{color:#46E0A9}.hpWind.win{color:#ff8f80}
.histrow{display:flex;align-items:center;gap:10px}.histrow .hv{font-family:var(--disp);font-weight:800;font-size:22px;color:var(--green)}.histrow .ht{font-family:var(--mono);font-size:11px;color:#cdd7e1}.histrow .ht b{color:#fff}
.why{font-size:12.5px;color:#c4cfd9;line-height:1.55}.why .wl{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--gold);display:block;margin-bottom:4px}
.estate{margin:40px 4px; /* EDGE-4PX-2026-06-26 */border:1px dashed var(--line2);border-radius:14px;padding:36px 18px;text-align:center}.estate .et{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfd7e2}.estate .es{font-size:12px;color:var(--mut);margin-top:6px;font-family:var(--mono)}
/* ── rich HR card ──────────────────────────────────────────── */
.hpHead{display:flex;align-items:center;gap:13px}
.hpAv{width:58px;height:58px;border-radius:50%;flex:0 0 auto;overflow:hidden;display:flex;align-items:flex-end;justify-content:center;font-family:var(--disp);font-weight:800;font-size:20px;color:#fff}
.hpAv img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.hpInfo{flex:1;min-width:0}
.hpName{font-family:var(--disp);font-weight:800;font-size:23px;line-height:1.05;color:#fff}
.hpMu{font-size:13px;color:#7d8a98;margin:2px 0}
.hpLn{font-family:var(--mono);font-size:12px;color:#b9c6cf}.hpLn b{color:#fff}
.hpTo{text-align:right;flex:0 0 auto}
.hpTo .v{font-family:var(--disp);font-weight:800;font-size:34px;color:#3FCB91;line-height:1}
.hpTo .v small{font-size:17px}
.hpTo .l{font-family:var(--mono);font-size:9px;color:#7d8a98;letter-spacing:.08em;margin-top:2px}
.hpTvs{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel);border:1px solid var(--line2);border-radius:13px;padding:12px 15px;margin-bottom:14px}
.hpTvs .l{font-size:14px;color:#7d8a98}.hpTvs .l b{color:#fff;font-weight:700}
.hpBdg{display:flex;gap:8px;flex:0 0 auto}
.hpHand{font-family:var(--mono);font-size:11px;font-weight:700;color:#5da9e8;border:1px solid rgba(93,169,232,.4);border-radius:8px;padding:6px 10px;white-space:nowrap}
.hpPlat{font-size:11px;font-weight:700;color:var(--green);border:1px solid rgba(63,203,145,.4);background:rgba(63,203,145,.08);border-radius:8px;padding:6px 10px;white-space:nowrap}
.hpSl{display:flex;align-items:center;gap:8px;font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:.06em;color:#7d8a98;margin:4px 2px 11px}
.hpSl::before{content:"";width:7px;height:7px;border-radius:50%;background:#3FCB91;flex:0 0 auto}
.hpHvh{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:18px}
.hpHv{position:relative;background:var(--panel);border:1px solid var(--line2);border-radius:13px;padding:15px 14px}
.hpHv.on{border-color:rgba(63,203,145,.5);background:rgba(63,203,145,.06)}
.hpTn{position:absolute;top:-9px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:9px;font-weight:700;color:#1a0907;background:#ff5d4d;padding:3px 9px;border-radius:7px;letter-spacing:.05em}
.hpHl{font-family:var(--disp);font-weight:800;font-size:14px;color:#7d8a98}
.hpHv.on .hpHl{color:#3FCB91}
.hpOps{font-family:var(--disp);font-weight:800;font-size:33px;line-height:1;margin:4px 0 1px;color:#fff}
.hpOpl{font-family:var(--mono);font-size:9px;color:#7d8a98;letter-spacing:.1em}
.hpG4r{display:flex;justify-content:space-between;margin-top:13px}
.hpG4{text-align:center}
.hpG4 .n{font-family:var(--disp);font-weight:800;font-size:16px;color:#e8eef3}
.hpG4 .n.hr{color:#f3b94f}
.hpG4 .k{font-family:var(--mono);font-size:8px;color:#4a5663;margin-top:2px}
.hpChart{background:var(--panel);border:1px solid var(--line2);border-radius:13px;padding:15px;margin-bottom:18px}
.hpChd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;gap:8px}
.hpChd .t{font-size:13px;color:#7d8a98}
.hpChd .r{font-family:var(--disp);font-weight:800;font-size:15px;white-space:nowrap}
.hpChd .r .m{color:#3FCB91}.hpChd .r .x{color:#7d8a98}.hpChd .r .k{color:#5da9e8}
.hpCwrap{display:flex;align-items:flex-end;gap:9px;height:140px;border-bottom:1px solid #1d2a36}
.hpCol{flex:1;position:relative;height:100%;display:flex;align-items:flex-end;justify-content:center}
.hpBar{width:52%;max-width:19px;border-radius:3px 3px 0 0;background:#3FCB91}
.hpBar.under{background:rgba(63,203,145,.2)}
.hpMkt{position:absolute;left:50%;transform:translateX(-50%);width:66%;max-width:25px;height:3px;border-radius:2px;background:#5da9e8}
.hpDots{display:flex;gap:6px;margin-top:9px}
.hpDot{flex:1;display:flex;justify-content:center}
.hpDot i{width:11px;height:11px;border-radius:50%}
.hpDot i.y{background:#3FCB91}
.hpDot i.n{border:1.5px solid #4a5663}
.hpLeg{display:flex;justify-content:center;gap:18px;margin:13px 0 4px;font-size:11px;color:#7d8a98}
.hpLeg span{display:flex;align-items:center;gap:6px}
.hpLeg i{width:11px;height:11px;border-radius:3px;background:#3FCB91}
.hpLeg i.ln{height:4px;border-radius:2px;background:#5da9e8}
.hpLeg i.rnd{border-radius:50%;background:#3FCB91}
.hpCap{text-align:center;font-size:11px;color:#4a5663;margin-top:4px}
.hpWms{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:18px}
.hpWs{background:var(--panel);border:1px solid var(--line2);border-radius:13px;padding:14px}
.hpWs.full{grid-column:1/-1}
.hpWt{display:flex;justify-content:space-between;align-items:center;gap:6px}
.hpWt .k{font-size:13px;color:#7d8a98}
.hpBd{font-family:var(--mono);font-size:9px;font-weight:700;color:#9aa7b2;background:rgba(255,255,255,.06);padding:3px 8px;border-radius:6px;white-space:nowrap}
.hpBd.g{color:#06140d;background:#3FCB91}
.hpBd.gold{color:#1a1407;background:#f3b94f}
.hpWv{font-family:var(--disp);font-weight:800;font-size:25px;margin-top:7px;color:#fff}
.hpWsub{font-family:var(--mono);font-size:11px;color:#7d8a98;margin-top:3px}
.hpPbar{height:6px;border-radius:4px;background:rgba(255,255,255,.06);margin-top:10px;overflow:hidden}
.hpPbar i{display:block;height:100%;border-radius:4px;background:#3FCB91}
.hpFoot{text-align:center;font-size:12px;color:#7d8a98;margin:16px 0 6px}.hpFoot b{color:#3FCB91}
`;
