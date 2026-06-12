// WizePicks Home — live dashboard hub. Reads the existing /api/edges/mlb feed (no extra Odds cost).
// Blueprint structure (vertical scroll + swipe carousels) translated to inline styles, wired to real data.
// Honest live: LIVE pulse reflects real game state; odds flash on real change; HR shows chance-to-homer,
// not a fake +EV badge; the line-movement chart fills into a full curve once tick storage lands.
import { useState, useEffect, useRef, useCallback, Children } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, liveApi, supabase } from "../lib/api";

function formatOdds(a){ if(a==null||isNaN(a))return "—"; const n=Math.round(Number(a)); return n>0?`+${n}`:`${n}`; }
function impliedFromAmerican(a){ if(a==null||isNaN(a))return null; const n=Number(a); return n>0?100/(n+100):-n/(-n+100); }
const ESPN=(ab)=>`https://a.espncdn.com/i/teamlogos/mlb/500/${String(ab||"").toLowerCase()}.png`;
const TEAMCOL={ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#C4CED4",CHW:"#C4CED4",CIN:"#C6011F",CLE:"#E31937",COL:"#5A4F9C",DET:"#FA4616",HOU:"#EB6E1F",KC:"#3E7DC4",KCR:"#3E7DC4",LAA:"#BA0021",LAD:"#3E7DC4",LOS:"#3E7DC4",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#D31145",NYM:"#FF5910",NYY:"#3A4F73",OAK:"#EFB21E",ATH:"#EFB21E",PHI:"#E81828",PIT:"#FDB827",SD:"#FFC425",SDP:"#FFC425",SEA:"#1B9A8E",SF:"#FD5A1E",SFG:"#FD5A1E",STL:"#C41E3A",TB:"#8FBCE6",TBR:"#8FBCE6",TEX:"#3E66B0",TOR:"#1D6FE0",WSH:"#E0263B",WAS:"#E0263B"};
const teamCol=(ab)=>TEAMCOL[String(ab||"").toUpperCase()]||"#3a4a57";
function teams(m){ if(!m)return ["",""]; const p=String(m).split(/@|vs|·/i).map(s=>s.trim()).filter(Boolean); return [p[0]||"",p[1]||""]; }
function shortTeam(t){ const m=String(t).match(/[A-Z]{2,3}/); return m?m[0]:String(t).slice(0,3).toUpperCase(); }
function oneSidePerGame(arr){ const g=new Map(); for(const e of arr||[]){ const p=g.get(e.gameId); if(!p||(e.edge??-Infinity)>(p.edge??-Infinity))g.set(e.gameId,e);} return [...g.values()]; }
const isTotal=(e)=>e.side==="over"||e.side==="under";
const edgeLabel=(e)=>isTotal(e)?`${e.side==="over"?"Over":"Under"} ${e.line}`:`${e.teamAbbr||shortTeam(e.matchup)} ML`;
const edgeTeam=(e)=>isTotal(e)?null:(e.teamAbbr||"");
const pct1=(f)=>`${(f??0)>0?"+":""}${((f??0)*100).toFixed(1)}%`;
const normName=(s)=>String(s||"").toLowerCase().replace(/[^a-z]/g,"");

function americanToDecimal(odds){const n=Number(odds);if(!n||Number.isNaN(n))return null;return n>0?n/100+1:100/Math.abs(n)+1;}
function parlayDecimal(legs){if(!legs||legs.length===0)return null;let d=1;for(const leg of legs){const dec=americanToDecimal(leg.odds);if(dec==null)return null;d*=dec;}return d;}
function computeRecord(rows){let wins=0,losses=0,pushes=0,units=0;for(const r of rows){for(const p of r.picks||[]){if(p.result==="win"){wins+=1;let dec;if(p.type==="parlay"){const cd=parlayDecimal(p.legs);dec=(p.combinedOdds!=null?americanToDecimal(p.combinedOdds):null)||cd;}else{dec=americanToDecimal(p.odds);}units+=dec?dec-1:0;}else if(p.result==="loss"){losses+=1;units-=1;}else if(p.result==="push"){pushes+=1;}}}return{wins,losses,pushes,units};}

function Logo({ab,size=22}){ const [bad,setBad]=useState(false);
  if(bad||!ab) return <span style={{width:size,height:size,borderRadius:"50%",background:"#1c2730",display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:size*0.36,color:"#fff",fontFamily:"'Barlow Condensed',sans-serif"}}>{String(ab||"?").slice(0,3)}</span>;
  const col=teamCol(ab);
  return <span style={{width:size,height:size,borderRadius:"50%",background:`radial-gradient(circle at 50% 32%, ${col}40, #090d11 80%)`,boxShadow:`inset 0 0 0 1px ${col}70`,display:"inline-flex",alignItems:"center",justifyContent:"center",flex:"0 0 auto"}}><img src={ESPN(ab)} alt="" onError={()=>setBad(true)} style={{width:size*0.84,height:size*0.84,objectFit:"contain"}}/></span>;
}

function Carousel({children}){
  const ref=useRef(null); const [active,setActive]=useState(0);
  const items=Children.toArray(children);
  const onScroll=()=>{const el=ref.current;if(!el)return;const f=el.firstChild;const w=f?f.offsetWidth+8:200;setActive(Math.max(0,Math.round(el.scrollLeft/w)));};
  return (<><div className="rw" ref={ref} onScroll={onScroll}>{children}</div>
    {items.length>1&&<div className="dots">{items.map((_,i)=><i key={i} className={i===active?"on":""}/>)}</div>}</>);
}

export default function HomePage(){
  const navigate=useNavigate();
  const { user }=useAuth();
  const [edges,setEdges]=useState(null);
  const [loading,setLoading]=useState(true);
  const [plan,setPlan]=useState({tier:"free",isAdmin:false});
  const [board,setBoard]=useState("ml");
  const [propTab,setPropTab]=useState("hr");
  const [wpRecord,setWpRecord]=useState(null);
  const [live,setLive]=useState(null);
  const [oddsHist,setOddsHist]=useState(null);
  const prev=useRef({}); const [flash,setFlash]=useState({});
  const hasFull=plan.isAdmin===true||plan.tier==="pro"||plan.tier==="elite";

  useEffect(()=>{ subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); },[]);
  useEffect(()=>{(async()=>{ try{
    const { data }=await supabase.from("expert_picks").select("*").order("date",{ascending:false});
    const rows=(data||[]).map(r=>{ let picks=[]; try{picks=r.picks?JSON.parse(r.picks):[];}catch(_){picks=[];} return {date:r.date,picks}; });
    setWpRecord(computeRecord(rows));
  }catch(_){ setWpRecord(null); } })();},[]);
  const load=useCallback(async()=>{ try{ const d=await edgesApi.getMLB();
    const f={}; [...(d.moneylineEdges||[]),...(d.totalsEdges||[])].forEach(e=>{ const k=e.gameId+e.side; if(prev.current[k]!=null&&prev.current[k]!==e.odds)f[k]=e.odds>prev.current[k]?"up":"dn"; prev.current[k]=e.odds; });
    setFlash(f); setEdges(d);
  }catch(e){} setLoading(false); },[]);
  useEffect(()=>{ load(); const id=setInterval(load,45000); return ()=>clearInterval(id); },[load]);
  useEffect(()=>{ let t; const pull=async()=>{ try{ const d=await liveApi.getMLB(); setLive(d?.games||[]); }catch(_){ setLive([]); } t=setTimeout(pull,60000); }; pull(); return ()=>clearTimeout(t); },[]);
  useEffect(()=>{ let t; const pull=async()=>{ try{ const d=await edgesApi.getOddsHistory(); setOddsHist(d?.games||[]); }catch(_){ setOddsHist([]); } t=setTimeout(pull,300000); }; pull(); return ()=>clearTimeout(t); },[]);

  if(loading&&!edges) return <div style={S.shell}><style>{CSS}</style><div style={{padding:40,textAlign:"center",color:"#8a99a2"}}>Loading the board…</div></div>;
  const e=edges||{}; const games=e.games||[];
  const histByKey={}; (oddsHist||[]).forEach(g=>{ histByKey[normName(g.away_team)+"|"+normName(g.home_team)]=g; });
  const findHist=(gm)=> gm?(histByKey[normName(gm.away)+"|"+normName(gm.home)]||null):null;
  const seriesFor=(edge)=>{ const gm=games.find(x=>x.id===edge.gameId); const h=findHist(gm); if(!h)return null; return (isTotal(edge)?h.total[edge.side]:h.ml[edge.side])||null; };
  const anyLive=games.some(g=>g.status==="live");
  const allDone=games.length>0&&games.every(g=>g.status==="final");
  const marketsLive=!allDone;

  const pool=[...(e.moneylineEdges||[]),...(e.totalsEdges||[])].filter(x=>x.convictionScore!=null&&(x.conviction==="HIGH"||x.conviction==="MEDIUM")&&(x.edge??0)>0);
  pool.sort((a,b)=>(b.convictionScore-a.convictionScore)||((b.edge??0)-(a.edge??0)));
  const hero=pool[0]||null;
  const boardEdges=oneSidePerGame((board==="ml"?e.moneylineEdges:e.totalsEdges)||[]).filter(x=>(x.edge??0)>0).sort((a,b)=>((b.convictionScore||0)-(a.convictionScore||0))||((b.edge||0)-(a.edge||0)));
  const moverPool=[...(e.moneylineEdges||[]),...(e.totalsEdges||[])].map(x=>{ const ser=seriesFor(x); const open=(ser&&ser.length)?ser[0].o:null; const now=(ser&&ser.length)?ser[ser.length-1].o:x.odds; const delta=(open!=null&&ser&&ser.length>1)?now-open:null; return {...x,_open:open,_now:now,_delta:delta}; });
  const movers=moverPool.sort((a,b)=>{ const ad=a._delta==null?-1:Math.abs(a._delta); const bd=b._delta==null?-1:Math.abs(b._delta); return (bd-ad)||((b.edge??0)-(a.edge??0)); }).slice(0,6);
  const hasMoves=movers.some(m=>m._delta!=null);
  const hrP=(e.hrPropEdges||[]).slice(0,6);
  const hitsP=(e.hitsPropEdges||[]).slice(0,6);
  const ksP=(e.kPropEdges||[]).slice(0,6);
  const propArr=propTab==="hr"?hrP:propTab==="hits"?hitsP:propTab==="ks"?ksP:[];
  const parks=games.filter(g=>g.parkRunFactor!=null).slice(0,8);
  const upcoming=games.filter(g=>g.status!=="final").slice(0,6);
  const abbrById={}; games.forEach(g=>{ abbrById[g.id]={a:g.awayAbbr||shortTeam(g.away||""),h:g.homeAbbr||shortTeam(g.home||"")}; });
  const liveGames=(live||[]).filter(g=>[g.awayEdge,g.homeEdge,g.overEdge,g.underEdge].some(x=>x!=null));

  return (
    <div style={S.shell}><style>{CSS}</style>
    <div className="wp">
      {/* HEADER */}
      <div className="top">
        <div className="logo"><span className="a">Wize</span><span className="b">Picks</span></div>
        <span className={"pill"+(marketsLive?"":" off")}><span className={"dot"+(marketsLive?"":" grey")}/> {anyLive?"LIVE":marketsLive?"OPEN":"CLOSED"}</span>
        <div className="mk"><span className={"dot"+(marketsLive?"":" grey")}/><span className="l">MARKETS {marketsLive?"LIVE":"CLOSED"}</span>
          <svg className="sp" viewBox="0 0 46 14" id="hs"><polyline fill="none" stroke="#33e991" strokeWidth="1.5" points="0,10 6,8 12,9 18,5 24,7 30,3 36,5 46,2"/></svg></div>
        <div className="bell" onClick={()=>navigate("/settings")}>🔔</div>
      </div>
      <div className="tabs">
        {[["⚾","MLB",1],["🏀","NBA",0],["🏒","NHL",0],["🏈","NFL",0],["🏉","CFB",0]].map(([ic,lb,on])=>(
          <div key={lb} className={"tab"+(on?" on":"")} onClick={()=>lb!=="MLB"&&navigate("/dashboard")}><span className="i">{ic}</span>{lb}</div>))}
      </div>

      {/* HERO */}
      {hero?<Hero hero={hero} navigate={navigate} live={anyLive} series={seriesFor(hero)}/>:<div className="hero empty">No qualifying edge on the board yet — check back closer to first pitch.</div>}
      <div className="cols">

      {/* LIVE EDGES — in-game model edges, pulled from /api/live/mlb (moved off the game page) */}
      {liveGames.length>0&&(<section className="panel">
        <div className="sh"><div className="l"><span className="rdot"/>LIVE EDGES <span className="s">in-game · updates 60s</span></div></div>
        <Carousel>{liveGames.map(g=><LiveGameCard key={g.gameId} g={g} info={abbrById[g.gameId]} navigate={navigate}/>)}</Carousel>
      </section>)}

      {/* EDGE BOARD — unified reasoned edges with a market toggle */}
      <section className="panel">
        <div className="sh"><div className="l"><span className="i">📊</span>TODAY'S EDGE BOARD <span className="s">ranked by conviction</span></div>
          <div className="seg"><b className={board==="ml"?"on":""} onClick={()=>setBoard("ml")}>ML</b><b className={board==="totals"?"on":""} onClick={()=>setBoard("totals")}>Totals</b></div></div>
        <div className="note" style={{marginTop:0,marginBottom:9}}>Today's top team plays — ML &amp; totals for every game, ranked by conviction. Player props live in the <span onClick={(ev)=>{ev.stopPropagation();navigate("/props");}} style={{color:"#ff7a6c",fontWeight:700,cursor:"pointer"}}>Props tab →</span></div>
        {boardEdges.length===0
          ?<div className="muted" style={{padding:"12px 2px"}}>No positive {board==="ml"?"moneyline":"totals"} edges on the board yet.</div>
          :<div className="elist">{boardEdges.map((x,i)=><EdgeRow key={x.gameId+x.side+i} e={x} navigate={navigate}/>)}</div>}
      </section>

      {/* MARKET MOVERS */}
      <section className="panel">
        <div className="sh"><div className="l"><span className="i">⚡</span>MARKET MOVERS <span className="s">biggest moves today</span></div><span className="s2">swipe →</span></div>
        <Carousel>
          {movers.map(x=>{ const k=x.gameId+x.side; const d=x._delta;
            return (<div key={k} className={"mv"+(flash[k]?" fl-"+flash[k]:"")}><div className="mvk">{edgeLabel(x)}</div>
              {d!=null
                ?<><div className={"mvv "+(d>0?"up":d<0?"dn":"")}>{formatOdds(x._open)} <span className="ar">{String.fromCharCode(8594)}</span> {formatOdds(x._now)} <span className="amt">{d>0?String.fromCharCode(9650):d<0?String.fromCharCode(9660):"•"}{Math.abs(d)}</span></div><div className={"mvc "+(d>0?"up":d<0?"dn":"")}>{d>0?"+":d<0?String.fromCharCode(8722):""}{Math.abs(d)} cents</div></>
                :<><div className="mvv">{formatOdds(x.odds)}</div><div className="mvm">{Math.round((x.modelProb||0)*100)}% model</div></>}
            </div>);})}
        </Carousel>
        <div className="note">{hasMoves?"Open to now, today’s line moves. Updates every 15 min.":"Live prices now. Moves fill in as ticks accumulate today."}</div>
      </section>

      {/* PLAYER PROPS — full board lives in the Props tab */}
      <section className="panel">
        <div className="sh"><div className="l"><span className="i">🎯</span>PLAYER PROPS</div></div>
        <div className="propscta" onClick={()=>navigate("/props")}>
          <div><div className="pctah">Every prop with an edge — HR, hits &amp; strikeouts</div><div className="pctas">The full board lives in the Props tab — more options than before.</div></div>
          <span className="pctaarrow">→</span>
        </div>
      </section>

      {/* PARK FACTORS */}
      {parks.length>0&&(<section className="panel">
        <div className="sh"><div className="l"><span className="i">🏟️</span>PARK FACTORS TODAY</div><span className="s2">swipe →</span></div>
        <Carousel>{parks.map((g,i)=><ParkCard key={i} g={g}/>)}</Carousel>
      </section>)}

      {/* PROMOS */}
      <section>
        <div className="tw">
          <div className="pr g" onClick={()=>navigate("/expert-picks")}>
            <div className="prh"><div className="h">⭐ WIZEPLAYS <span className="new">NEW</span></div>
              {wpRecord&&(wpRecord.wins+wpRecord.losses+wpRecord.pushes)>0&&(
                <div className="wkbox"><div className="t">THIS WEEK</div><div className="r">{wpRecord.wins}-{wpRecord.losses}{wpRecord.pushes?`-${wpRecord.pushes}`:""}</div><div className={"u "+(wpRecord.units>=0?"pos":"neg")}>{wpRecord.units>=0?"+":""}{wpRecord.units.toFixed(2)}u</div></div>)}
            </div>
            <div className="d">Handpicked by our analysts after extra review.</div><div className="cta">View WizePlays →</div></div>
          <div className="pr pp" onClick={()=>navigate("/daily-card")}><div className="h">✳️ WIZE SPIN <span className="new">NEW</span></div><div className="wh"/><div className="d">Need a play fast? Spin for model-qualified plays.</div><div className="cta">Spin the wheel →</div></div>
        </div>
      </section>

      {/* UPCOMING */}
      {upcoming.length>0&&(<section className="panel">
        <div className="sh"><div className="l"><span className="i">🗓️</span>UPCOMING GAMES</div><span className="s2" onClick={()=>navigate("/games")}>View all →</span></div>
        <div className="rw">
          {upcoming.map((g,i)=>{ const aw=g.away||g.awayAbbr||""; const hm=g.home||g.homeAbbr||"";
            return (<div key={i} className="gm" onClick={()=>g.gameId&&navigate(`/game/mlb/${g.gameId}`)}>
              <div className="gmm"><Logo ab={shortTeam(aw)} size={20}/> {shortTeam(aw)} <span className="x">v</span> <Logo ab={shortTeam(hm)} size={20}/> {shortTeam(hm)}</div>
              <div className="gme">{g.time||"—"}{g.totals?.projected!=null?` · O/U ${g.totals.projected}`:""}</div>
            </div>);})}
        </div>
      </section>)}
      </div>
    </div>

    <nav className="nav">
      <a className="on"><span className="i">🏠</span>Home</a>
      <a onClick={()=>navigate("/games")}><span className="i">🗓️</span>Games</a>
      <a onClick={()=>navigate("/props")}><span className="i">⚾</span>Props</a>
      <a onClick={()=>navigate("/odds")}><span className="i">💹</span>Market</a>
      <a onClick={()=>navigate("/performance")}><span className="i">📈</span>Performance</a>
      <a onClick={()=>navigate("/settings")}><span className="i">👤</span>Account</a>
    </nav>
    </div>
  );
}

function HeroChart({pts}){
  const n=pts.length; const min=Math.min(...pts), max=Math.max(...pts);
  const pad=(max-min)*0.18||5; const lo=min-pad, hi=max+pad;
  const W=170,H=48; const X=i=>(i/(n-1))*W; const Y=v=>H-((v-lo)/(hi-lo))*H;
  const line=pts.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area=line+`L${W} ${H} L0 ${H} Z`;
  const up=pts[n-1]>=pts[0]; const col=up?"#33e991":"#ff5a5a";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="48" preserveAspectRatio="none" style={{overflow:"visible"}}>
      <defs><linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.3"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
      <path d={area} fill="url(#hgrad)"/>
      <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={X(n-1)} cy={Y(pts[n-1])} r="3" fill={col}/>
    </svg>
  );
}

function Hero({hero,navigate,live,series}){
  const modelPct=Math.round((hero.modelProb||0)*100);
  const mktPct=Math.round((impliedFromAmerican(hero.odds)||0)*100);
  const pts=(series||[]).map(p=>p.o);
  const hasChart=pts.length>=2;
  const moved=hasChart&&pts[0]!==pts[pts.length-1];
  return (
    <div className="hero" onClick={()=>hero.gameId&&navigate(`/game/mlb/${hero.gameId}`)}>
      <div className="hh"><div className="eb">🔥 BEST EDGE RIGHT NOW</div><span className="hot">🔥 HOT</span></div>
      <div className="htop">
        <div className="hL"><div className="pk">{edgeLabel(hero)}</div><div className="pg">{hero.matchup}</div>
          <div className="ch">
            <div className="cc"><div className="k">{moved?"LINE MOVED":"ODDS"}</div><div className="v">{moved?<>{formatOdds(pts[0])}<span className="ar">{String.fromCharCode(8594)}</span><b className="gd">{formatOdds(pts[pts.length-1])}</b></>:formatOdds(hero.odds)}</div></div>
            <div className="cc"><div className="k">STARTS</div><div className="v">{hero.time||"—"}</div></div>
          </div></div>
        <div className="ebx"><div className="b">{pct1(hero.edge)}</div><div className="k">EDGE</div></div>
        <div className="hR"><div className="ct">LINE MOVEMENT</div>
          <div className="cwrap">{hasChart?<HeroChart pts={pts}/>:<div className="livenum">{formatOdds(hero.odds)}<span className="livedot r"/></div>}
            <div className="cap">{hasChart?<>{formatOdds(pts[0])} {String.fromCharCode(8594)} {formatOdds(pts[pts.length-1])} · since open</>:<>model {modelPct}% vs mkt {mktPct}%</>}</div></div></div>
      </div>
      {moved
        ?<div className="hstrip"><span>⚡ Line moved {formatOdds(pts[0])} {String.fromCharCode(8594)} {formatOdds(pts[pts.length-1])} since open</span><span>›</span></div>
        :<div className="hf"><span>⚡ Tap for the full matchup breakdown</span><span>›</span></div>}
    </div>
  );
}

function LiveGameCard({g,info,navigate}){
  const a=info?.a||"AWY", h=info?.h||"HOM";
  const half=g.half==="bottom"?"Bot":"Top";
  const ml=(g.awayEdge??-9)>=(g.homeEdge??-9)
    ?{lbl:`${a} ML`,prob:g.awayWinProb,edge:g.awayEdge,odds:g.awayOdds}
    :{lbl:`${h} ML`,prob:g.homeWinProb,edge:g.homeEdge,odds:g.homeOdds};
  const tot=g.totalLine!=null
    ?((g.overEdge??-9)>=(g.underEdge??-9)
      ?{lbl:`Over ${g.totalLine}`,prob:g.overProb,edge:g.overEdge,odds:g.overOdds}
      :{lbl:`Under ${g.totalLine}`,prob:g.underProb,edge:g.underEdge,odds:g.underOdds})
    :null;
  const Row=({r})=> r&&r.edge!=null?(
    <div className="lgrow"><span className="lglbl">{r.lbl}</span>
      <span className="lgmeta">{r.prob!=null?Math.round(r.prob*100)+"%":"—"}{r.odds!=null?` · ${formatOdds(r.odds)}`:""}</span>
      <span className={"lgedge "+(r.edge>=0?"pos":"neg")}>{r.edge>=0?"+":""}{(r.edge*100).toFixed(1)}%</span></div>):null;
  return (
    <div className="lgc" onClick={()=>g.gameId&&navigate(`/game/mlb/${g.gameId}`)}>
      <div className="lgh"><span className="lgmatch">{a} @ {h}</span><span className="lglive"><span className="livedot r"/>{half} {g.inning}{g.outs!=null?` · ${g.outs} out`:""}</span></div>
      <Row r={ml}/><Row r={tot}/>
    </div>
  );
}

function EdgeRow({e,navigate}){
  const model=Math.round((e.modelProb||0)*100);
  const conv=(e.conviction||"").toLowerCase();
  const ab=edgeTeam(e);
  return (
    <div className="erow" onClick={()=>e.gameId&&navigate(`/game/mlb/${e.gameId}`)}>
      <div className="etop">
        <div className="eleft">{ab?<Logo ab={ab} size={30}/>:<span className="totg">O/U</span>}
          <div className="elabel">{edgeLabel(e)} <span className="emu">{e.matchup}</span></div></div>
        <div className={"epct "+((e.edge??0)>=0?"pos":"neg")}>{pct1(e.edge)}</div>
      </div>
      <div className="emid">
        <span className={"econv "+conv}>{e.conviction||"—"}</span>
        <span className="emeta">{model}% model · {formatOdds(e.odds)}</span>
        {e.inflation?.inflated&&<span className="einf">⚠ market inflated</span>}
      </div>
      {e.reason&&<div className="ereason">{e.reason}</div>}
    </div>
  );
}

function PropCard({p,type,rank,navigate}){
  let big,lbl,line,edgeBadge=null,sig=[];
  if(type==="hr"){
    big=Math.round((p.hrProb||0)*100)+"%"; lbl="CHANCE TO HOMER"; line=`O 0.5 HR · ${formatOdds(p.odds)}`;
    if(p.parkHRFactor!=null) sig.push(["🏟️ Park",`${p.parkHRFactor>1?"+":""}${Math.round((p.parkHRFactor-1)*100)}%`]);
    if(p.opposingPitcherHR9!=null) sig.push(["⚾ HR/9",Number(p.opposingPitcherHR9).toFixed(1)]);
  } else if(type==="hits"){
    big=Math.round((p.hitsProb||0)*100)+"%"; lbl="HIT PROBABILITY";
    line=`${p.side==="over"?"O":"U"} ${p.line} Hits · ${formatOdds(p.odds)}`;
    if((p.edge??0)>0) edgeBadge=`+${(p.edge*100).toFixed(1)}% EDGE`;
    if(p.battingAvg!=null) sig.push(["📊 AVG",Number(p.battingAvg).toFixed(3).replace(/^0/,"")]);
  } else {
    big=Math.round((p.kProb||0)*100)+"%"; lbl="STRIKEOUT PROB";
    line=`${p.side==="over"?"O":"U"} ${p.line} Ks · ${formatOdds(p.odds)}`;
    if((p.edge??0)>0) edgeBadge=`+${(p.edge*100).toFixed(1)}% EDGE`;
    if(p.expectedKs!=null) sig.push(["🎯 Proj Ks",Number(p.expectedKs).toFixed(1)]);
    if(p.pitcherK9!=null) sig.push(["⚾ K/9",Number(p.pitcherK9).toFixed(1)]);
  }
  return (
    <div className="pc2" onClick={()=>p.gameId&&navigate(`/game/mlb/${p.gameId}`)}>
      <div className="rk">{rank}</div>
      <div className="hd"><div className="av" style={(()=>{const c=teamCol(shortTeam(p.team||p.game||""));return {background:`linear-gradient(180deg, ${c}, #0c1018 88%)`,boxShadow:`0 0 0 2px ${c}88`};})()}>{p.playerId?<img src={`https://midfield.mlbstatic.com/v1/people/${p.playerId}/spots/120`} alt="" onError={(e)=>{e.currentTarget.style.display="none";}}/>:(type==="ks"?"⚾":"🧢")}</div><div><div className="nm">{p.player||"—"}</div><div className="mu">{p.game||p.team||""}</div></div></div>
      <div className="cn2"><div className="n">{big}</div><div className="l">{lbl}</div></div>
      {sig.length>0&&<div className="sg">{sig.slice(0,2).map((s,i)=><div key={i} className="x"><div className="kk">{s[0]}</div><div className="vv">{s[1]}</div></div>)}</div>}
      <div className="pline">{line}{edgeBadge&&<span className="ebadge">{edgeBadge}</span>}</div>
    </div>
  );
}

function ParkCard({g}){
  const f=g.parkRunFactor; const hf=g.parkHRFactor; const w=g.weather||{};
  const hot=(hf??f)>1.05,cold=(hf??f)<0.95;
  const tag=hot?["🔥 HITTER FRIENDLY","h"]:cold?["🧤 PITCHER FRIENDLY","p"]:["⚖️ NEUTRAL","n"];
  const pct=Math.round((f-1)*100); const hpct=hf!=null?Math.round((hf-1)*100):null;
  const indoor=w.indoor; const t=w.tempF!=null?Math.round(w.tempF):null;
  const wind=w.windMph?`${w.windMph} mph${w.windEffect?" "+w.windEffect:""}`:null;
  const wxIcon=indoor?"🏟️":(t!=null&&t>=82?"☀️":t!=null&&t<=55?"🌥️":"⛅");
  const wxText=indoor?"Indoor · roof closed":([t!=null?t+"°F":null,wind].filter(Boolean).join(" · ")||"Forecast pending");
  return (
    <div className={"pkc"+(hot?" hot":cold?" cold":"")}>
      <div className="r1"><div><div className="n">{g.venue||g.park||(g.home||"")+" Park"}</div><div className="c">{g.home||""}</div></div><Logo ab={shortTeam(g.home||"")} size={30}/></div>
      <span className={"tg "+tag[1]}>{tag[0]}</span>
      <div className="bs">
        {hpct!=null&&<div className="b"><div className="kk">HR BOOST</div><div className={"vv "+(hpct>0?"u":hpct<0?"dn2":"")}>{hpct>0?"+":""}{hpct}%</div></div>}
        <div className="b"><div className="kk">RUN BOOST</div><div className={"vv "+(pct>0?"u":pct<0?"dn2":"")}>{pct>0?"+":""}{pct}%</div></div>
      </div>
      <div className="wxrow"><span className="wi">{wxIcon}</span><span className="wt">{wxText}</span></div>
    </div>
  );
}

const S={ shell:{minHeight:"100vh",background:"#000",color:"#f2f6f4",fontFamily:"'Inter',system-ui,sans-serif"} };

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.wp{max-width:480px;margin:0 auto;padding-bottom:70px}
.logo,.pk,.nm,.pc,.b,.n,.mvk,.gmm,.rk,.cn2 .n{font-family:'Barlow Condensed',sans-serif}
.top{display:flex;align-items:center;gap:8px;padding:11px 13px 8px}
.bgr{width:19px;display:flex;flex-direction:column;gap:4px}.bgr span{height:2px;background:#c0c9cd;border-radius:2px}
.logo{font-weight:800;font-size:23px}.logo .a{color:#fff}.logo .b{color:#ff5d4d}
.pill{display:inline-flex;align-items:center;gap:5px;border:1px solid #1d2731;border-radius:999px;padding:3px 9px;font-size:10px;font-weight:800;letter-spacing:.4px;color:#d2ebe2}.pill.off{color:#8a99a2}
.dot{width:6px;height:6px;border-radius:50%;background:#33e991;animation:pl 1.8s infinite}.dot.grey{background:#3a4650;animation:none}
@keyframes pl{0%{box-shadow:0 0 0 0 rgba(51,233,145,.55)}70%{box-shadow:0 0 0 6px rgba(51,233,145,0)}100%{box-shadow:0 0 0 0 rgba(51,233,145,0)}}
.mk{flex:1;display:flex;align-items:center;gap:6px;justify-content:center;border:1px solid #1d2731;border-radius:999px;padding:3px 10px}.mk .l{font-size:10px;font-weight:800;color:#d2ebe2}.sp{width:46px;height:14px}
.bell{font-size:16px;color:#c0c9cd}
.tabs{display:flex;justify-content:space-between;padding:0 14px;border-bottom:1px solid #0e151a}
.tab{display:flex;align-items:center;gap:5px;padding:8px 3px;font-weight:700;font-size:13px;color:#8a99a2;border-bottom:2px solid transparent;margin-bottom:-1px}.tab.on{color:#fff;border-bottom-color:#ff5d4d}.tab .i{font-size:14px}
section{padding:13px 12px 2px;margin:0;border-top:1px solid #161d24}
.panel{margin:0;padding:13px 12px 2px;border:0;border-radius:0;background:none;border-top:1px solid #161d24}
.panel>.sh{margin-bottom:9px}
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.sh .l{display:flex;align-items:center;gap:7px;font-family:'Barlow Condensed';font-weight:800;font-size:14px;letter-spacing:.4px;color:#dbe4e2}.sh .l .i{font-size:14px}.sh .l .s{font-family:'Inter';font-size:10px;color:#8a99a2;font-weight:600;margin-left:3px}
.sh .s2{font-size:11px;color:#8a99a2;font-weight:600}
.seg{display:flex;gap:2px;background:#0a0f13;border:1px solid #161e26;border-radius:8px;padding:2px}.seg b{color:#8a99a2;font-weight:800;font-size:11px;padding:4px 10px;border-radius:6px}.seg b.on{background:#141d24;color:#fff;box-shadow:inset 0 0 0 1px #ff5d4d}
.muted,.note,.pn{color:#54616b;font-size:11px;font-weight:600}.note,.pn{margin-top:7px;line-height:1.35}
.hero{border:1px solid rgba(243,185,79,.32);border-radius:14px;background:linear-gradient(180deg,#14110a,#06090b);overflow:hidden;margin:11px 12px 0}
.hero.empty{padding:18px;color:#8a99a2;font-size:13px;font-weight:600}
.hh{display:flex;align-items:center;justify-content:space-between;padding:11px 13px 2px}
.eb{font-size:11px;font-weight:800;color:#f3b94f}.hot{border:1px solid rgba(243,185,79,.35);border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;color:#f3b94f;background:rgba(243,185,79,.08)}
.htop{display:flex;gap:9px;padding:6px 13px 2px;align-items:stretch}
.hL{flex:1.05;min-width:0}.pk{font-weight:800;font-size:36px;line-height:.86;color:#fff}.pg{font-size:12px;color:#8a99a2;font-weight:600;margin-top:3px}
.ch{display:flex;gap:6px;margin-top:9px}.cc{border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:6px 9px;flex:1}.cc .k{font-size:8px;color:#8a99a2;font-weight:800}.cc .v{font-size:13px;font-weight:700;white-space:nowrap;margin-top:2px;display:flex;align-items:center;gap:3px}.cc .ar{color:#8a99a2;font-weight:700}.cc .gd{color:#33e991;font-weight:800}
.ebx{flex:0 0 80px;border:1px solid rgba(51,233,145,.42);border-radius:13px;background:rgba(51,233,145,.07);padding:10px 4px;text-align:center;box-shadow:0 0 20px rgba(51,233,145,.1);display:flex;flex-direction:column;justify-content:center}
.ebx .b{font-weight:800;font-size:29px;color:#33e991;line-height:1}.ebx .k{font-size:8px;color:#8fd9c2;font-weight:800;margin-top:2px}
.hR{flex:1.05;min-width:0;display:flex;flex-direction:column}.ct{font-size:8px;letter-spacing:.4px;color:#8a99a2;font-weight:800;margin-bottom:3px}
.cwrap{flex:1;display:flex;flex-direction:column;justify-content:center;border:1px solid rgba(255,255,255,.07);border-radius:9px;background:rgba(255,255,255,.015);padding:6px 8px}
.livenum{font-family:'Barlow Condensed';font-weight:800;font-size:22px;color:#fff;display:flex;align-items:center;gap:7px}
.livedot{width:7px;height:7px;border-radius:50%;background:#33e991;animation:pl 1.6s infinite}
.livedot.r{background:#ff5a5a;animation:plr 1.3s infinite}
.rdot{width:8px;height:8px;border-radius:50%;background:#ff3b3b;display:inline-block;animation:plr 1.1s infinite}
@keyframes plr{0%{opacity:1;box-shadow:0 0 0 0 rgba(255,59,59,.7)}50%{opacity:.32}70%{box-shadow:0 0 0 7px rgba(255,59,59,0)}100%{opacity:1;box-shadow:0 0 0 0 rgba(255,59,59,0)}}
.cap{font-size:9px;color:#8a99a2;font-weight:600;margin-top:2px}
.cn{font-size:9px;color:#54616b;font-weight:600;margin:6px 13px 0;line-height:1.35}
.hf{display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(243,185,79,.16);margin-top:7px;padding:9px 13px;color:#f3b94f;font-size:11px;font-weight:600}
.hstrip{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid rgba(243,185,79,.2);margin-top:9px;padding:10px 13px;color:#f3b94f;font-size:11.5px;font-weight:700;background:rgba(243,185,79,.06)}
.eg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.ec{border:1px solid rgba(255,255,255,.06);border-radius:13px;background:linear-gradient(180deg,#0d1218,#090d12);padding:10px 9px}
.ec .r1{display:flex;align-items:center;gap:7px}.ec .tot{font-size:18px}
.ec .nm{font-family:'Barlow Condensed';font-weight:800;font-size:17px;line-height:.9}.ec .vs{font-size:9.5px;color:#8a99a2;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ec .conv{display:inline-block;margin:6px 0 4px;font-size:8px;font-weight:800;border-radius:5px;padding:2px 5px;color:#33e991;background:rgba(51,233,145,.12)}
.ec .conv.medium{color:#f3b94f;background:rgba(243,185,79,.12)}
.ec .pc{font-family:'Barlow Condensed';font-weight:800;font-size:26px;color:#33e991;line-height:1;transition:color .3s}.ec .pc.fl-up{color:#33e991}.ec .pc.fl-dn{color:#ff5a5a}
.ec .md{font-size:10px;color:#9aa7b0;font-weight:600;margin-top:2px}
.lgc{width:228px;border:1px solid rgba(255,90,90,.28);border-radius:13px;background:linear-gradient(180deg,#160d0e,#090d12);padding:10px 12px}
.lgh{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.lgmatch{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;color:#fff}
.lglive{display:flex;align-items:center;gap:5px;font-size:9px;font-weight:800;color:#ff8a8a;letter-spacing:.3px}
.lgrow{display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #161e26}
.lglbl{font-weight:800;font-size:12px;color:#dbe4e2;flex:1;min-width:0}
.lgmeta{font-size:10px;color:#9aa7b0;font-weight:600}
.lgedge{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;flex:0 0 auto}.lgedge.pos{color:#33e991}.lgedge.neg{color:#ff5a5a}
.elist{display:flex;flex-direction:column;gap:7px}
.erow{border:1px solid #1a232c;border-radius:12px;background:linear-gradient(180deg,#0d1218,#090d12);padding:10px 12px}
.etop{display:flex;align-items:center;justify-content:space-between;gap:8px}
.eleft{display:flex;align-items:center;gap:9px;min-width:0;flex:1}
.totg{width:30px;height:30px;border-radius:50%;background:rgba(155,123,255,.14);border:1px solid rgba(155,123,255,.32);display:inline-flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:11px;color:#bba6ff;flex:0 0 auto}
.elabel{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:17px;color:#fff;min-width:0}
.elabel .emu{font-family:'Inter',sans-serif;font-weight:600;font-size:10px;color:#8a99a2;margin-left:6px}
.epct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:20px;line-height:1;flex:0 0 auto}.epct.pos{color:#33e991}.epct.neg{color:#ff5a5a}
.emid{display:flex;align-items:center;gap:8px;margin-top:4px}
.econv{font-size:8.5px;font-weight:800;border-radius:5px;padding:2px 6px;color:#33e991;background:rgba(51,233,145,.12)}.econv.medium{color:#f3b94f;background:rgba(243,185,79,.12)}.econv.low{color:#8a99a2;background:rgba(130,145,154,.1)}
.emeta{font-size:10px;color:#9aa7b0;font-weight:600}
.einf{font-size:9px;font-weight:700;color:#f3b94f;background:rgba(243,185,79,.1);border-radius:5px;padding:2px 5px}
.ereason{font-size:11px;color:#a8b4bd;font-weight:500;margin-top:5px;line-height:1.4}
.rw{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:2px}.rw::-webkit-scrollbar{display:none}.rw>*{scroll-snap-align:start;flex:0 0 auto}
.mv{width:152px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:#0b0f14;padding:9px 12px}
.mvk{font-weight:800;font-size:15px;color:#eaf1ee}
.mvv{font-size:14px;font-weight:800;margin-top:6px;color:#eaf1ee;transition:color .3s;white-space:nowrap}.mvv.up{color:#33e991}.mvv.dn{color:#ff5a5a}.mvv .ar{color:#8a99a2;font-weight:700}.mvv .amt{font-weight:800}.mvc{font-size:12px;font-weight:800;margin-top:4px}.mvc.up{color:#33e991}.mvc.dn{color:#ff5a5a}.mvm{font-size:10px;color:#8a99a2;font-weight:600;margin-top:3px}.mv.fl-up .mvv{color:#33e991}.mv.fl-dn .mvv{color:#ff5a5a}
.pc2{width:186px;border:1px solid #1a212b;border-radius:12px;background:linear-gradient(180deg,#100d1a,#070a0d);padding:9px 10px;position:relative}
.pc2 .rk{position:absolute;top:0;left:0;width:22px;height:22px;border-radius:12px 0 10px 0;background:rgba(155,123,255,.2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#b9a6ff}
.pc2 .hd{display:flex;align-items:center;gap:8px;margin-left:18px}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(180deg,#26344f,#1a2335);display:flex;align-items:flex-end;justify-content:center;font-size:19px;flex:0 0 auto;position:relative;overflow:hidden;box-shadow:0 0 0 2px rgba(155,123,255,.28)}.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pc2 .nm{font-family:'Inter',sans-serif;font-weight:800;font-size:12.5px;line-height:1.1}.pc2 .mu{font-family:'Inter',sans-serif;font-size:9.5px;color:#8a99a2;margin-top:2px}
.cn2{text-align:center;margin:7px 0 1px}.cn2 .n{font-family:'Inter',sans-serif;font-weight:800;font-size:23px;color:#33e991;line-height:1;letter-spacing:-.5px}.cn2 .l{font-size:7.5px;color:#8fd9c2;font-weight:800;letter-spacing:.3px}
.sg{display:flex;gap:6px;margin-top:6px}.sg .x{flex:1;border:1px solid #1a212b;border-radius:7px;background:rgba(255,255,255,.015);padding:4px 6px}.sg .kk{font-size:8px;color:#8a99a2;font-weight:700;white-space:nowrap}.sg .vv{font-family:'Inter',sans-serif;font-size:11px;font-weight:800;margin-top:1px}
.vbk{margin-top:8px;border:1px solid rgba(155,123,255,.3);border-radius:8px;background:rgba(155,123,255,.07);text-align:center;padding:6px;font-size:11px;font-weight:800;color:#bba6ff}
.pline{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px;border:1px solid rgba(155,123,255,.26);border-radius:7px;background:rgba(155,123,255,.07);padding:6px 8px;font-size:10.5px;font-weight:800;color:#cdbcff}
.ebadge{font-size:9px;font-weight:800;color:#33e991;background:rgba(51,233,145,.12);border-radius:5px;padding:2px 5px;white-space:nowrap}
.pkc{width:186px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:#0b0f14;padding:10px 12px}.pkc.hot{border-color:rgba(243,185,79,.26);background:#0c1109}.pkc.cold{border-color:rgba(95,184,255,.16);background:#0b0f14}
.pkc .r1{display:flex;align-items:center;justify-content:space-between}.pkc .n{font-weight:700;font-size:14px}.pkc .c{font-size:10px;color:#8a99a2;font-weight:600}
.pkc .tg{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:800;margin:7px 0;padding:2px 7px;border-radius:6px}.tg.h{color:#f3b94f;background:rgba(243,185,79,.1)}.tg.p{color:#5fb8ff;background:rgba(95,184,255,.1)}.tg.n{color:#8a99a2;background:rgba(130,145,154,.08)}
.bs{display:flex;gap:10px}.bs .b{flex:1}.bs .kk{font-size:8.5px;color:#8a99a2;font-weight:800}.bs .vv{font-family:'Barlow Condensed';font-weight:800;font-size:21px}.vv.u{color:#33e991}.vv.dn2{color:#5fb8ff}
.wx{display:flex;gap:10px;margin-top:7px;font-size:10px;color:#c0c9cd;font-weight:600}
.wxrow{display:flex;align-items:center;gap:7px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07);font-size:11.5px;color:#dbe4e2;font-weight:600}.wxrow .wi{font-size:14px}
.propscta{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(155,123,255,.28);border-radius:12px;background:rgba(155,123,255,.06);padding:12px 14px;cursor:pointer}
.pctah{font-weight:800;font-size:13px;color:#eaf1ee}.pctas{font-size:10.5px;color:#8a99a2;font-weight:500;margin-top:3px;line-height:1.35}.pctaarrow{font-size:18px;color:#bba6ff;font-weight:800;flex:0 0 auto}
.dots{display:flex;justify-content:center;gap:5px;margin-top:8px}.dots i{width:5px;height:5px;border-radius:50%;background:#222c33;transition:.25s}.dots i.on{width:14px;border-radius:3px;background:#ff5d4d}
.prh{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.wkbox{position:absolute;top:10px;right:10px;border:1px solid rgba(243,185,79,.3);border-radius:9px;background:rgba(243,185,79,.06);padding:4px 8px;text-align:center}.wkbox .t{font-size:7px;letter-spacing:.4px;color:#f3b94f;font-weight:800}.wkbox .r{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:18px;color:#fff;line-height:1.05}.wkbox .u{font-size:9px;font-weight:700;margin-top:1px}.wkbox .u.pos{color:#33e991}.wkbox .u.neg{color:#ff5a5a}
.tw{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.pr{border-radius:14px;padding:11px;border:1px solid #161e26;position:relative;min-height:104px}.pr.g{border-color:rgba(243,185,79,.3);background:linear-gradient(180deg,#14110a,#06090b)}.pr.pp{border-color:rgba(155,123,255,.3);background:linear-gradient(180deg,#110d20,#06090b)}
.pr .h{font-weight:800;font-size:12px}.new{font-size:8px;font-weight:800;border-radius:4px;padding:1px 4px}.pr.g .new{background:#f3b94f;color:#1a1405}.pr.pp .new{background:#9b7bff;color:#0d0820}
.pr .d{font-size:10px;color:#8a99a2;margin:7px 0 0;line-height:1.4}.pr .cta{font-size:12px;font-weight:800;color:#f3b94f;margin-top:9px}.pr.pp .cta{color:#bba6ff}.pr.pp .d{max-width:60%}.pr.g .d{padding-right:84px}
.wh{width:54px;height:54px;border-radius:50%;position:absolute;top:30px;right:10px;background:radial-gradient(circle,#2f2363,#110d20 72%);border:2px solid #4a3d86;animation:spin 7s linear infinite}.wh::before{content:"";position:absolute;inset:6px;border-radius:50%;border:1px dashed #6a58c0}
@keyframes spin{to{transform:rotate(360deg)}}
.gm{width:122px;border:1px solid #161e26;border-radius:11px;background:#0b0f14;padding:8px 10px}.gmm{display:flex;align-items:center;gap:4px;font-weight:800;font-size:14px}.gmm .x{color:#8a99a2}.gme{font-size:9px;color:#8a99a2;font-weight:600;margin-top:6px}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:flex;justify-content:space-around;padding:6px 4px calc(6px + env(safe-area-inset-bottom));background:rgba(0,0,0,.96);backdrop-filter:blur(14px);border-top:1px solid #161e26}
.nav a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:8.5px;font-weight:600;color:#8a99a2;flex:1;min-width:0}.nav a.on{color:#ff5d4d}.nav .i{font-size:17px}

/* ---- DESKTOP: full-width sections, items stretched across to fill the page ---- */
@media (min-width:769px){
  .wp{max-width:1340px;padding-bottom:88px}
  .top{padding:14px 26px 10px}
  .tabs{padding:0 26px}
  .hero{margin:12px 22px 0}
  .cols{padding:0 22px;margin-top:2px}
  .panel{padding-left:0;padding-right:0}
  /* edge board rows spread into a grid that fills the width */
  .elist{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:9px}
  /* carousels become full-width grids so cards stretch across the page */
  .rw{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:9px;overflow:visible}
  .rw>*{flex:none;scroll-snap-align:none}
  .lgc,.mv,.gm,.pkc{width:auto}
  .dots{display:none}
  /* full-width bottom nav */
  .nav{max-width:none;left:0;right:0;transform:none;justify-content:center;gap:46px;padding:9px 4px}
  .nav a{flex:0 0 auto;font-size:11px}
  .nav a:hover{color:#cdd6da}
  .nav .i{font-size:20px}
}
`;
