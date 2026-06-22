// WizePicks Home — live dashboard hub. Reads the existing /api/edges/mlb feed (no extra Odds cost).
// Blueprint structure (vertical scroll + swipe carousels) translated to inline styles, wired to real data.
// Honest live: LIVE pulse reflects real game state; odds flash on real change; HR shows chance-to-homer,
// not a fake +EV badge; the line-movement chart fills into a full curve once tick storage lands.
import { useState, useEffect, useRef, useCallback, Children } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, liveApi, supabase } from "../lib/api";
import Sidebar from "./Sidebar";
import HomeDesktop from "./HomeDesktop";

function formatOdds(a){ if(a==null||isNaN(a))return "—"; const n=Math.round(Number(a)); return n>0?`+${n}`:`${n}`; }
// Fair American odds implied by the model's win/cover/hit probability (e.g. 49% -> +105).
function fairAmerican(pct){ if(pct==null||isNaN(pct))return null; const p=Number(pct)/100; if(p<=0||p>=1)return null; const dec=1/p; return dec>=2?Math.round((dec-1)*100):Math.round(-100/(dec-1)); }
// Team nicknames so the pick reads in plain English ("Take the Angels to win") instead
// of jargon ("LAA ML"). MLB-complete; other leagues fall back to the abbreviation.
const NICK={ARI:"Diamondbacks",AZ:"Diamondbacks",ATL:"Braves",BAL:"Orioles",BOS:"Red Sox",CHC:"Cubs",CWS:"White Sox",CHW:"White Sox",CIN:"Reds",CLE:"Guardians",COL:"Rockies",DET:"Tigers",HOU:"Astros",KC:"Royals",LAA:"Angels",LAD:"Dodgers",MIA:"Marlins",MIL:"Brewers",MIN:"Twins",NYM:"Mets",NYY:"Yankees",OAK:"Athletics",ATH:"Athletics",PHI:"Phillies",PIT:"Pirates",SD:"Padres",SF:"Giants",SEA:"Mariners",STL:"Cardinals",TB:"Rays",TEX:"Rangers",TOR:"Blue Jays",WSH:"Nationals",WAS:"Nationals"};
// American odds are discontinuous at the +100/-100 line (-101 and +101 are
// adjacent in reality but 202 apart numerically). Map to a continuous "cents from
// even" scale so a move like -110 -> +105 reads as ~15 cents, not 215.
function amCents(o){ if(o==null||isNaN(o))return null; const n=Number(o); return n>=100?n-100:n<=-100?n+100:0; }
function fmtTime(t,withDay){ if(!t)return "—"; const d=new Date(t); if(isNaN(d.getTime()))return t; const o={hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}; if(withDay)o.weekday="short"; return d.toLocaleString("en-US",o)+" ET"; }
function impliedFromAmerican(a){ if(a==null||isNaN(a))return null; const n=Number(a); return n>0?100/(n+100):-n/(-n+100); }
const ESPN_ALIAS={az:"ari"};
const ESPN=(ab,lg="mlb")=>{const a=String(ab||"").toLowerCase();const slug=(lg==="mlb"?(ESPN_ALIAS[a]||a):a);return `https://a.espncdn.com/i/teamlogos/${lg}/500/${slug}.png`;};
const TEAMCOL={ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#C4CED4",CHW:"#C4CED4",CIN:"#C6011F",CLE:"#E31937",COL:"#5A4F9C",DET:"#FA4616",HOU:"#EB6E1F",KC:"#3E7DC4",KCR:"#3E7DC4",LAA:"#BA0021",LAD:"#3E7DC4",LOS:"#3E7DC4",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#D31145",NYM:"#FF5910",NYY:"#3A4F73",OAK:"#EFB21E",ATH:"#EFB21E",PHI:"#E81828",PIT:"#FDB827",SD:"#FFC425",SDP:"#FFC425",SEA:"#1B9A8E",SF:"#FD5A1E",SFG:"#FD5A1E",STL:"#C41E3A",TB:"#8FBCE6",TBR:"#8FBCE6",TEX:"#3E66B0",TOR:"#1D6FE0",WSH:"#E0263B",WAS:"#E0263B"};
const NBACOL={ATL:"#E03A3E",BOS:"#007A33",BKN:"#777",CHA:"#1D1160",CHI:"#CE1141",CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",MIA:"#98002E",MIL:"#00471B",MIN:"#236192",NOP:"#85714D",NYK:"#006BB6",OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#E56020",POR:"#E03A3E",SAC:"#5A2D81",SAS:"#9AA7AE",TOR:"#CE1141",UTA:"#3E2680",WAS:"#002B5C"};
const teamCol=(ab)=>TEAMCOL[String(ab||"").toUpperCase()]||"#3a4a57";
const colFor=(ab,sport)=> sport==="nba" ? (NBACOL[String(ab||"").toUpperCase()]||"#3a4a57") : teamCol(ab);

// Per-sport config. MLB is the original behavior; NBA reads the /api/edges/nba feed.
// markets sets the board toggle; spread is NBA-only (MLB run line was cut for ROI).
// hasLive/hasHist/hasParks gate MLB-only sections. hasProps gates the props CTA
// (NBA props page lands in Phase 2, so its CTA is hidden until then).
const SPORTS={
  mlb:{ feed:()=>edgesApi.getMLB(), lg:"mlb", markets:[["ml","ML"],["totals","Totals"]], propsCopy:"Every prop with an edge — HR, hits & strikeouts", hasLive:true, hasHist:true, hasParks:true, hasProps:true },
  nba:{ feed:()=>edgesApi.getNBA(), lg:"nba", markets:[["ml","ML"],["spread","Spread"],["totals","Totals"]], propsCopy:"", hasLive:false, hasHist:false, hasParks:false, hasProps:false },
  nfl:{ feed:(phase)=>edgesApi.getNFL(phase), lg:"nfl", markets:[["ml","ML"],["spread","Spread"],["totals","Totals"]], propsCopy:"", hasLive:false, hasHist:false, hasParks:false, hasProps:false, provisional:true },
};
// Edge display differs by sport: MLB edge is a fraction (×100 → %); NBA ML edge is
// already a % figure, and NBA spread/totals edges are POINT projections.
function fmtEdgeFor(e,sport){ const v=e.edge??0; const s=v>=0?"+":""; if(sport!=="nba") return pct1(v); if(isTotal(e)||e.line!=null) return `${s}${v.toFixed(1)}`; return `${s}${v.toFixed(1)}%`; }
function teams(m){ if(!m)return ["",""]; const p=String(m).split(/@|vs|·/i).map(s=>s.trim()).filter(Boolean); return [p[0]||"",p[1]||""]; }
function shortTeam(t){ const m=String(t).match(/[A-Z]{2,3}/); return m?m[0]:String(t).slice(0,3).toUpperCase(); }
// Resolve a full/partial MLB team name to its ESPN logo abbr. shortTeam() slices the
// first 3 letters, which breaks on multi-word cities ("New York Mets" -> "NEW", no logo).
const MLB_ABBR={diamondbacks:"ARI",braves:"ATL",orioles:"BAL","red sox":"BOS",cubs:"CHC","white sox":"CHW",reds:"CIN",guardians:"CLE",rockies:"COL",tigers:"DET",astros:"HOU",royals:"KC",angels:"LAA",dodgers:"LAD",marlins:"MIA",brewers:"MIL",twins:"MIN",mets:"NYM",yankees:"NYY",athletics:"OAK","a's":"OAK",phillies:"PHI",pirates:"PIT",padres:"SD",mariners:"SEA",giants:"SF",cardinals:"STL",rays:"TB",rangers:"TEX","blue jays":"TOR",nationals:"WSH"};
function mlbAbbr(name){ const s=String(name||"").toLowerCase(); for(const k in MLB_ABBR){ if(s.includes(k)) return MLB_ABBR[k]; } return shortTeam(name); }
function oneSidePerGame(arr){ const g=new Map(); for(const e of arr||[]){ const p=g.get(e.gameId); if(!p||(e.edge??-Infinity)>(p.edge??-Infinity))g.set(e.gameId,e);} return [...g.values()]; }
// Movement guardrail: how many "cents from even" a price must move to count.
const MOVE_GUARD_CENTS=15;
const CONV_TIERS=["NEUTRAL","LOW","MEDIUM","HIGH"];
const tierRank=(c)=>{ const i=CONV_TIERS.indexOf(String(c||"").toUpperCase()); return i<0?-1:i; };
// Nudge a conviction tier by one step (dir +1 up / -1 down), bounded — movement
// adjusts at the margin, it never overrides the model (HIGH can't fall past MED, etc.).
const tierBump=(c,dir)=>{ const i=tierRank(c); if(i<0)return c; return CONV_TIERS[Math.max(0,Math.min(CONV_TIERS.length-1,i+dir))]; };
const isTotal=(e)=>e.side==="over"||e.side==="under";
const edgeLabel=(e)=>isTotal(e)?`${e.side==="over"?"Over":"Under"} ${e.line}`:(e.line!=null?`${e.teamAbbr||shortTeam(e.matchup)} ${e.line>0?"+":""}${e.line}`:`${e.teamAbbr||shortTeam(e.matchup)} ML`);
const edgeTeam=(e)=>isTotal(e)?null:(e.teamAbbr||"");
const pct1=(f)=>`${(f??0)>0?"+":""}${((f??0)*100).toFixed(1)}%`;
const normName=(s)=>String(s||"").toLowerCase().replace(/[^a-z]/g,"");

function americanToDecimal(odds){const n=Number(odds);if(!n||Number.isNaN(n))return null;return n>0?n/100+1:100/Math.abs(n)+1;}
function parlayDecimal(legs){if(!legs||legs.length===0)return null;let d=1;for(const leg of legs){const dec=americanToDecimal(leg.odds);if(dec==null)return null;d*=dec;}return d;}
function computeRecord(rows){const nr=(v)=>{const s=String(v==null?"":v).trim().toLowerCase();return s==="won"?"win":s==="lost"?"loss":s;};let wins=0,losses=0,pushes=0,units=0;for(const r of rows){for(const p of r.picks||[]){const res=nr(p.result);if(res==="win"){wins+=1;let dec;if(p.type==="parlay"){const cd=parlayDecimal(p.legs);dec=(p.combinedOdds!=null?americanToDecimal(p.combinedOdds):null)||cd;}else{dec=americanToDecimal(p.odds);}units+=dec?dec-1:0;}else if(res==="loss"){losses+=1;units-=1;}else if(res==="push"){pushes+=1;}}}return{wins,losses,pushes,units};}

function Logo({ab,size=22,lg="mlb",col}){ const [bad,setBad]=useState(false);
  if(bad||!ab) return <span style={{width:size,height:size,borderRadius:"50%",background:"#1c2730",display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:size*0.36,color:"#fff",fontFamily:"'Barlow Condensed',sans-serif"}}>{String(ab||"?").slice(0,3)}</span>;
  const c=col||teamCol(ab);
  return <span style={{width:size,height:size,borderRadius:"50%",background:`radial-gradient(circle at 50% 32%, ${c}40, #090d11 80%)`,boxShadow:`inset 0 0 0 1px ${c}70`,display:"inline-flex",alignItems:"center",justifyContent:"center",flex:"0 0 auto"}}><img src={ESPN(ab,lg)} alt="" onError={()=>setBad(true)} style={{width:size*0.84,height:size*0.84,objectFit:"contain"}}/></span>;
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
  const { user, signOut }=useAuth();
  const [edges,setEdges]=useState(null);
  const [nflPhase,setNflPhase]=useState(null); // null=auto; "preseason"|"regular" when user picks
  const [phaseAvail,setPhaseAvail]=useState([]); // which phase sub-tabs to show
  const [loading,setLoading]=useState(true);
  const [plan,setPlan]=useState({tier:"free",isAdmin:false});
  const [planLoaded,setPlanLoaded]=useState(false);
  const [sport,setSport]=useState("mlb");
  const [board,setBoard]=useState("ml");
  const [propTab,setPropTab]=useState("hr");
  const [wpRecord,setWpRecord]=useState(null);
  const [live,setLive]=useState(null);
  const [oddsHist,setOddsHist]=useState(null);
  const [marketRead,setMarketRead]=useState(null);
  const prev=useRef({}); const [flash,setFlash]=useState({});
  const hasFull=plan.isAdmin===true||plan.tier==="pro"||plan.tier==="elite"||user?.email==="r7002g@gmail.com";
  const sp=SPORTS[sport]||SPORTS.mlb;
  const [isDesktop,setIsDesktop]=useState(typeof window!=="undefined"&&window.innerWidth>=1024);
  const [heroIdx,setHeroIdx]=useState(0);
  const [openId,setOpenId]=useState(null);
  useEffect(()=>{ const on=()=>setIsDesktop(window.innerWidth>=1024); window.addEventListener("resize",on); return ()=>window.removeEventListener("resize",on); },[]);
  useEffect(()=>{ setBoard("all"); },[]);

  useEffect(()=>{ subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}).finally(()=>setPlanLoaded(true)); },[]);
  // Auto-resume checkout after signup: if a logged-out visitor picked a plan on
  // /pricing, we stashed it and sent them to /signup. They land here logged in —
  // pick the stash back up and send them straight to Stripe. Clear the key first
  // so it fires exactly once (no loop, no double-charge attempt on refresh).
  const resumed=useRef(false);
  useEffect(()=>{ if(resumed.current||!user)return;
    let key; try{ key=sessionStorage.getItem("wzp_resume_plan"); }catch(_){ key=null; }
    if(!key)return;
    resumed.current=true;
    try{ sessionStorage.removeItem("wzp_resume_plan"); }catch(_){}
    subscriptionApi.checkout(key)
      .then(({url})=>{ if(url) window.location.href=url; })
      .catch(()=>{ /* stay on /home; the paywall + subscribe button remain available */ });
  },[user]);
  useEffect(()=>{(async()=>{ try{
    const { data }=await supabase.from("expert_picks").select("*").order("date",{ascending:false});
    const rows=(data||[]).map(r=>{ let picks=[]; try{picks=r.picks?JSON.parse(r.picks):[];}catch(_){picks=[];} return {date:r.date,picks}; });
    setWpRecord(computeRecord(rows));
  }catch(_){ setWpRecord(null); } })();},[]);
  const load=useCallback(async()=>{ try{ const d=await (sport==="nfl"?SPORTS.nfl.feed(nflPhase):SPORTS[sport].feed());
    if(sport==="nfl"&&d&&d.phase){ setPhaseAvail(d.phase.available||[]); if(nflPhase==null&&d.phase.selected) setNflPhase(d.phase.selected); }
    const f={}; [...(d.moneylineEdges||[]),...(d.totalsEdges||[]),...(d.spreadEdges||[])].forEach(e=>{ const k=e.gameId+e.side; if(prev.current[k]!=null&&prev.current[k]!==e.odds)f[k]=e.odds>prev.current[k]?"up":"dn"; prev.current[k]=e.odds; });
    setFlash(f); setEdges(d);
  }catch(e){} setLoading(false); },[sport,nflPhase]);
  useEffect(()=>{ setEdges(null); setLoading(true); prev.current={}; load(); const id=setInterval(load,45000); return ()=>clearInterval(id); },[load]);
  useEffect(()=>{ if(!SPORTS[sport].hasLive){ setLive([]); return; } let t; const pull=async()=>{ try{ const d=await liveApi.getMLB(); setLive(d?.games||[]); }catch(_){ setLive([]); } t=setTimeout(pull,60000); }; pull(); return ()=>clearTimeout(t); },[sport]);
  useEffect(()=>{ if(!SPORTS[sport].hasHist){ setOddsHist([]); return; } let t; const pull=async()=>{ try{ const d=await edgesApi.getOddsHistory(); setOddsHist(d?.games||[]); }catch(_){ setOddsHist([]); } t=setTimeout(pull,300000); }; pull(); return ()=>clearTimeout(t); },[sport]);
  useEffect(()=>{ if(sport!=="mlb"){ setMarketRead([]); return; } let t; const pull=async()=>{ try{ const d=await edgesApi.getMarketRead(); setMarketRead(d?.games||[]); }catch(_){ setMarketRead([]); } t=setTimeout(pull,120000); }; pull(); return ()=>clearTimeout(t); },[sport]);

  if(loading&&!edges) return <div style={S.shell}><style>{CSS}</style><div style={{padding:40,textAlign:"center",color:"#8a99a2"}}>Loading the board…</div></div>;
  const e=edges||{}; const games=e.games||[];
  // When the board has rolled forward (today's slate all started), label it
  // "Tomorrow's" so it's clear these are next-day plays; flips back automatically.
  const slateUpper=e.rolledToNextDay?"TOMORROW'S":"TODAY'S";
  const slateLower=e.rolledToNextDay?"Tomorrow's":"Today's";
  const histByKey={}; (oddsHist||[]).forEach(g=>{ histByKey[normName(g.away_team)+"|"+normName(g.home_team)]=g; });
  const findHist=(gm)=> gm?(histByKey[normName(gm.away)+"|"+normName(gm.home)]||null):null;
  const seriesFor=(edge)=>{ const gm=games.find(x=>x.id===edge.gameId); const h=findHist(gm); if(!h)return null; return (isTotal(edge)?h.total[edge.side]:h.ml[edge.side])||null; };
  // Movement guardrail: per pick, compute open→now cent move on its OWN side and
  // nudge conviction one tier. _delta>0 = drifted longer (money OFF our side →
  // market fading the pick → downgrade ⚠). _delta<0 = shortened (money IN on our
  // side → market confirming → upgrade ↘). Bounded one tier; flag explains it.
  const moveAdjust=(x)=>{ const ser=seriesFor(x); let delta=null; if(ser&&ser.length>1){ const d=amCents(ser[ser.length-1].o)-amCents(ser[0].o); if(d!=null&&!isNaN(d))delta=d; } let dir=0,flag=null; if(delta!=null){ if(delta>=MOVE_GUARD_CENTS){dir=-1;flag="against";} else if(delta<=-MOVE_GUARD_CENTS){dir=1;flag="toward";} } return {...x,_delta:delta,_moveDir:dir,_moveFlag:flag,_convAdj:dir!==0?tierBump(x.conviction,dir):x.conviction}; };
  const mlAdj=(e.moneylineEdges||[]).map(moveAdjust);
  const totAdj=(e.totalsEdges||[]).map(moveAdjust);
  const spAdj=(e.spreadEdges||[]).map(moveAdjust);
  // Movement keyed by pick for the desktop board (single source of truth — the math
  // stays here where amCents/seriesFor live; HomeDesktop just looks up dir/flag).
  const moveByPick={}; [...mlAdj,...totAdj,...spAdj].forEach(x=>{ if(x._moveDir) moveByPick[x.gameId+x.side]={dir:x._moveDir,flag:x._moveFlag}; });
  const anyLive=games.some(g=>g.status==="live");
  const allDone=games.length>0&&games.every(g=>g.status==="final");
  const marketsLive=!allDone;

  const pool=[...mlAdj,...totAdj,...spAdj].filter(x=>x.convictionScore!=null&&(x._convAdj==="HIGH"||x._convAdj==="MEDIUM")&&(x.edge??0)>0);
  pool.sort((a,b)=>(tierRank(b._convAdj)-tierRank(a._convAdj))||(b.convictionScore-a.convictionScore)||((b.edge??0)-(a.edge??0)));
  const hero=pool[0]||null;
  const topHeroes=pool.slice(0,5);
  const boardArr=board==="ml"?mlAdj:board==="spread"?spAdj:totAdj;
  const boardEdges=oneSidePerGame(boardArr||[]).filter(x=>sport==="mlb"?(x.edge??0)>0:(x.edge??0)>=1).sort((a,b)=>((tierRank(b._convAdj)-tierRank(a._convAdj))||((b.convictionScore||0)-(a.convictionScore||0))||((b.edge||0)-(a.edge||0))));
  const moverPool=[...(e.moneylineEdges||[]),...(e.totalsEdges||[]),...(e.spreadEdges||[])].map(x=>{ const ser=seriesFor(x); const open=(ser&&ser.length)?ser[0].o:null; const now=(ser&&ser.length)?ser[ser.length-1].o:x.odds; const delta=(open!=null&&ser&&ser.length>1)?(amCents(now)-amCents(open)):null; return {...x,_open:open,_now:now,_delta:delta}; });
  const movers=moverPool.filter(m=>m._delta!=null).sort((a,b)=>{ const ad=Math.abs(a._delta); const bd=Math.abs(b._delta); return (bd-ad)||((b.edge??0)-(a.edge??0)); }).slice(0,12);
  const hasMoves=movers.some(m=>m._delta!=null);
  const hrP=(e.hrPropEdges||[]).slice(0,6);
  const hitsP=(e.hitsPropEdges||[]).slice(0,6);
  const ksP=(e.kPropEdges||[]).slice(0,6);
  const propArr=propTab==="hr"?hrP:propTab==="hits"?hitsP:propTab==="ks"?ksP:[];
  const mkProp=(p,kind)=>{
    const b={k:kind+(p.playerId||p.player),id:p.playerId,name:p.player,team:p.team,game:p.game,edge:p.edge??0,odds:p.odds};
    if(kind==="hr") return {...b,market:"HR",betSide:"Anytime HR"};
    if(kind==="hits") return {...b,market:"HITS",betSide:(p.line===0.5?"1+ Hits":`${p.side==="under"?"U":"O"} ${p.line} Hits`)};
    return {...b,market:"K",betSide:`K ${p.side==="under"?"U":"O"}${p.line}`};
  };
  const topProps=[...hitsP.map(x=>mkProp(x,"hits")),...ksP.map(x=>mkProp(x,"ks")),...hrP.map(x=>mkProp(x,"hr"))].sort((a,b)=>(b.edge-a.edge)).slice(0,7);
  const propList=[...hitsP.map(x=>mkProp(x,"hits")),...ksP.map(x=>mkProp(x,"ks")),...hrP.map(x=>mkProp(x,"hr"))].sort((a,b)=>(b.edge-a.edge)).slice(0,12);
  const mkPropFull=(p,kind)=>{ const prob=kind==="hr"?p.hrProb:kind==="hits"?p.hitsProb:p.kProb; return {...mkProp(p,kind),prob,line:p.line,side:p.side}; };
  const propsByType={
    hr:(e.hrPropEdges||[]).slice(0,14).map(x=>mkPropFull(x,"hr")),
    hits:(e.hitsPropEdges||[]).slice(0,14).map(x=>mkPropFull(x,"hits")),
    ks:(e.kPropEdges||[]).slice(0,14).map(x=>mkPropFull(x,"ks")),
  };
  const parks=games.filter(g=>g.parkRunFactor!=null).slice(0,8);
  const upcoming=games.filter(g=>g.status!=="final").slice(0,6);
  const abbrById={}; games.forEach(g=>{ abbrById[g.id]={a:g.awayAbbr||shortTeam(g.away||""),h:g.homeAbbr||shortTeam(g.home||"")}; });
  const liveGames=(live||[]).filter(g=>[g.awayEdge,g.homeEdge,g.overEdge,g.underEdge].some(x=>x!=null));

  const lineSeries={};
  [...(e.moneylineEdges||[]),...(e.totalsEdges||[]),...(e.spreadEdges||[])].forEach(x=>{ const s=seriesFor(x); if(s&&s.length>1) lineSeries[x.gameId+x.side]=s.map(p=>p.o).filter(o=>o!=null); });

  // ---- Redesign derived data (presentation only; reads existing engine vars) ----
  const mrByGame={}; (marketRead||[]).forEach(g=>{ if(g&&g.gameId!=null) mrByGame[g.gameId]=g; });
  // NFL market read rides inside the edges feed (edges.marketByGame), not the
  // separate MLB market-read call. Map it into the same shape the board renderer
  // expects (win/cover/total with tier+favTeam+consensus) so NFL shows the same
  // "BOOKS LEAN" box. Keyed by eventId (= gameId on NFL board rows).
  if(sport==="nfl"&&edges&&edges.marketByGame){
    for(const id in edges.marketByGame){
      const mr=edges.marketByGame[id]&&edges.marketByGame[id].marketRead; if(!mr) continue;
      mrByGame[id]={
        win: mr.win?{tier:mr.win.tier,favTeam:mr.win.favTeam,consensus:mr.win.consensus,model:null}:null,
        cover: mr.cover?{tier:"",favTeam:mr.cover.favTeam,odds:null,agrees:false,line:mr.cover.favLine}:null,
        total: mr.total?{tier:mr.total.tier,side:mr.total.favSide,line:mr.total.line,odds:mr.total.consensus,agrees:false}:null,
      };
    }
  }
  const gameById={}; games.forEach(g=>{ if(g&&g.id!=null) gameById[g.id]=g; });
  const kpiList=boardEdges||[];
  const kpiCount=kpiList.length;
  const kpiAvg=kpiCount?kpiList.reduce((s,x)=>s+(x.edge||0),0)/kpiCount:0;
  const kpiBest=kpiCount?Math.max(...kpiList.map(x=>x.edge||0)):0;
  const kpiLive=(liveGames||[]).length;
  // Market Pulse — interpretive "updated 2m ago", built from movers + marketRead
  const pulseAlerts=(()=>{ const out=[]; const byAbs=[...(movers||[])].sort((a,b)=>Math.abs(b._delta||0)-Math.abs(a._delta||0));
    const sharp=byAbs.find(m=>(m._delta||0)<=-MOVE_GUARD_CENTS);
    if(sharp) out.push({dot:"#33e991",label:"SHARP MONEY",head:`${edgeLabel(sharp)}  ${formatOdds(sharp._open)} ${String.fromCharCode(8594)} ${formatOdds(sharp._now)}`,sub:"Money coming in on this side since open — market confirming the lean."});
    const totMove=byAbs.find(m=>isTotal(m)&&m._delta!=null);
    if(totMove){ const mg=abbrById[totMove.gameId]; out.push({dot:"#5da9e8",label:"BIGGEST TOTAL MOVE",head:`${edgeLabel(totMove)}  ${formatOdds(totMove._open)} ${String.fromCharCode(8594)} ${formatOdds(totMove._now)}`,sub:`${mg?mg.a+" @ "+mg.h+" · ":""}${Math.abs(totMove._delta)}¢ shift since the open.`}); }
    if((boardEdges||[]).length){ const be=boardEdges[0]; out.push({dot:"#f3b94f",label:"LARGEST EDGE",head:`${edgeLabel(be)} · ${fmtEdgeFor(be,sport)} edge`,sub:`${be.matchup||""}${be.modelProb!=null?" · model "+Math.round(be.modelProb*100)+"%":""}`}); }
    const split=(marketRead||[]).find(g=>g.win&&g.win.tier==="Split");
    if(split) out.push({dot:"#ff5d4d",label:"CONSENSUS SPLIT",head:`Books can't agree on the ${split.win.favTeam}`,sub:`${split.awayAbbr} @ ${split.homeAbbr} · only ${split.win.favProb}% consensus to win.`});
    return out; })();
  // Live scores tape — real game state always; scores only if the feed carries them
  const scoreOf=(g,side)=>{ const c=side==="a"?[g.awayScore,g.awayRuns,g.away_runs,g.aScore,g.runsAway]:[g.homeScore,g.homeRuns,g.home_runs,g.hScore,g.runsHome]; const v=c.find(x=>x!=null); return v!=null?v:null; };
  const tapeLive=(live||[]).map(g=>({ id:g.gameId, a:g.awayAbbr||shortTeam(g.away||""), h:g.homeAbbr||shortTeam(g.home||""), as:scoreOf(g,"a"), hs:scoreOf(g,"h"), state:`${g.half==="bottom"?"Bot":"Top"} ${g.inning||""}`.trim(), live:true }));
  const tapeFinal=games.filter(g=>g.status==="final").slice(0,8).map(g=>({ id:g.id, a:g.awayAbbr||shortTeam(g.away||""), h:g.homeAbbr||shortTeam(g.home||""), as:scoreOf(g,"a"), hs:scoreOf(g,"h"), state:"Final", live:false }));
  const tapeUpcoming=games.filter(g=>g.status!=="final"&&g.time).slice(0,10).map(g=>({ id:g.id, a:g.awayAbbr||shortTeam(g.away||""), h:g.homeAbbr||shortTeam(g.home||""), as:null, hs:null, state:fmtTime(g.time), live:false }));
  const scoreTape=(tapeLive.length||tapeFinal.length)?[...tapeLive,...tapeFinal]:tapeUpcoming;

  if(isDesktop) return <HomeDesktop edges={edges} games={games} movers={movers} live={live||[]} abbrById={abbrById} topProps={topProps} propList={propList} propsByType={propsByType} hero={hero} hasFull={hasFull} planLoaded={planLoaded} lineSeries={lineSeries} moveByPick={moveByPick} wpRecord={wpRecord} navigate={navigate} plan={plan} sport={sport} setSport={(k)=>{setSport(k);setBoard("ml");}} marketsLive={marketsLive} anyLive={anyLive} marketRead={marketRead} />;

  // ============ ADAPTERS: real data -> v11 mock shapes ============
  const edgeNum=(x)=> sport==="mlb" ? (x.edge??0)*100 : (x.edge??0);
  const convOf=(x)=>{const c=String(x._convAdj||x.conviction||"").toLowerCase();return c.indexOf("high")===0?"high":c.indexOf("med")===0?"med":"low";};
  const mkOf=(x)=> isTotal(x)?"TOT":(x.line!=null?(sport==="mlb"?"RL":"SPR"):"ML");
  const catOf=(x)=> isTotal(x)?"tot":(x.line!=null?"spr":"ml");
  const mvOf=(x)=>{const s=seriesFor(x);if(s&&s.length>1){const o=s[0].o,n=s[s.length-1].o;const dd=amCents(n)-amCents(o);const dir=dd>0?"up":dd<0?"dn":"";if(dir)return [formatOdds(o),formatOdds(n),dir];}return null;};
  const pairOf=(x)=>{const ab=abbrById[x.gameId];const t=teams(x.matchup);const a=ab?ab.a:shortTeam(t[0]||"");const h=ab?ab.h:shortTeam(t[1]||"");return [[a,colFor(a,sport)],[h,colFor(h,sport)]];};
  const toBoard=(x,i)=>{const [a,h]=pairOf(x);const gm=gameById[x.gameId];const mr=mrByGame[x.gameId];
    const model=x.modelProb!=null?+(x.modelProb*100).toFixed(1):null;
    const mkt=+(((impliedFromAmerican(x.odds)||0)*100)).toFixed(1);
    const flags=[];
    // Top flag describes THE PICK, not the books' who-wins lean — surfacing the win
    // read here made value-dog edges (e.g. NYM ML at +160 while books favor PHI) read
    // as "model agrees" and contradict themselves. The Market Read box below still shows
    // the separate who-wins lens. ML only: model<50 = value on the underdog (that's the
    // whole point of the edge), model>=50 = model favors the side it's backing.
    if(mkOf(x)==="ML"&&model!=null)flags.push(model>=50?["ok","\u2713 model favors this side"]:["info","value on the underdog"]);
    if(x._moveFlag==="toward")flags.push(["ok","\u2198 money coming in"]);
    if(x._moveFlag==="against")flags.push(["warn","market moving against"]);
    if(x.inflation&&x.inflation.inflated)flags.push(["warn","market inflated"]);
    let read=null;
    if(mr&&mr.win){const w=mr.win;read={win:[w.tier,w.favTeam,formatOdds(w.consensus),w.model?w.model.agrees:false]};
      if(mr.cover&&mr.cover.favTeam)read.cover=[mr.cover.tier,mr.cover.favTeam,formatOdds(mr.cover.odds),!!mr.cover.agrees];
      if(mr.total&&(mr.total.lean||mr.total.side||mr.total.favTeam))read.total=[mr.total.tier,String(mr.total.lean||mr.total.side||mr.total.favTeam).toUpperCase()+(mr.total.line!=null?" "+mr.total.line:""),formatOdds(mr.total.odds),!!mr.total.agrees];}
    const park=[];if(gm&&gm.parkRunFactor!=null)park.push((gm.parkRunFactor>1?"+":"")+Math.round((gm.parkRunFactor-1)*100)+"%");
    const wx=gm&&gm.weather&&gm.weather.tempF!=null?(Math.round(gm.weather.tempF)+"\u00b0F"+(gm.weather.windMph?" \u00b7 "+gm.weather.windMph+" mph":"")):null;
    return {p:edgeLabel(x),mk:mkOf(x),cat:catOf(x),conv:convOf(x),edge:edgeNum(x),odds:formatOdds(x.odds),mv:mvOf(x),delta:x._delta,clv:null,a,h,g:x.matchup,starts:gm&&gm.time?fmtTime(gm.time):null,model,mkt,flags:flags.length?flags:null,read,why:x.reason,park:park.length?park:null,wx,gameId:x.gameId,seed:i};
  };
  const allAdj=[...mlAdj,...totAdj,...spAdj];
  const sortBoard=(a,b)=>((tierRank(b._convAdj)-tierRank(a._convAdj))||((b.convictionScore||0)-(a.convictionScore||0))||((b.edge||0)-(a.edge||0)));
  const boardSrc = board==="all" ? oneSidePerGame(allAdj).filter(x=>sport==="mlb"?(x.edge??0)>0:(x.edge??0)>=1).sort(sortBoard) : boardEdges;
  const boardItems = boardSrc.map(toBoard);
  const heroItems = oneSidePerGame(allAdj).filter(x=>(x.edge??0)>0).sort((a,b)=>(b.edge||0)-(a.edge||0)).slice(0,3).map(toBoard);
  const moverItems = movers.map((m)=>{return {p:edgeLabel(m),g:m.matchup,mv:(m._open!=null&&m._now!=null&&m._delta!=null)?[formatOdds(m._open),formatOdds(m._now),(m._delta>0?"up":m._delta<0?"dn":"")]:null,odds:formatOdds(m.odds),model:m.modelProb!=null?Math.round(m.modelProb*100):null,delta:m._delta};});
  const propItems = topProps.map(p=>{const col=teamCol(shortTeam(p.team||p.game||""));const initials=((p.name||"").split(" ").map(s=>s[0]).join("").slice(0,2))||(p.name||"").slice(0,2);return {player:[p.name,initials,col],g:p.game||p.team||"",edge:(p.edge||0)*100,mk:p.market,p:p.betSide,odds:formatOdds(p.odds),id:p.id};});
  const parkItems = parks.map(g=>{const f=g.parkRunFactor,hf=g.parkHRFactor,w=g.weather||{};const hot=(hf??f)>1.05,cold=(hf??f)<0.95;const tag=hot?["HITTER FRIENDLY","h"]:cold?["PITCHER FRIENDLY","p"]:["NEUTRAL","n"];const ab=mlbAbbr(g.home||"");const t=w.tempF!=null?Math.round(w.tempF):null;const wind=w.windMph?(w.windMph+" mph"+(w.windEffect?" "+w.windEffect:"")):null;const wx=w.indoor?"Dome \u00b7 roof closed":([t!=null?t+"\u00b0F":null,wind].filter(Boolean).join(" \u00b7 ")||"Forecast pending");return {venue:g.venue||g.park||((g.home||"")+" Park"),g:g.home||"",a:[ab,teamCol(ab)],tag,hr:(hf!=null?((hf>1?"+":"")+Math.round((hf-1)*100)+"%"):"0%"),run:((f>1?"+":"")+Math.round((f-1)*100)+"%"),wx};});
  const liveItems = liveGames.map(g=>{const a=g.awayAbbr||(abbrById[g.gameId]?abbrById[g.gameId].a:shortTeam(g.away||""));const h=g.homeAbbr||(abbrById[g.gameId]?abbrById[g.gameId].h:shortTeam(g.home||""));const rows=[];const ml=(g.awayEdge??-9)>=(g.homeEdge??-9)?[a+" ML",g.awayWinProb,g.awayEdge,g.awayOdds]:[h+" ML",g.homeWinProb,g.homeEdge,g.homeOdds];if(ml[2]!=null)rows.push([ml[0],(ml[1]!=null?Math.round(ml[1]*100)+"%":"\u2014"),formatOdds(ml[3]),ml[2]*100]);if(g.totalLine!=null){const tt=(g.overEdge??-9)>=(g.underEdge??-9)?["Over "+g.totalLine,g.overProb,g.overEdge,g.overOdds]:["Under "+g.totalLine,g.underProb,g.underEdge,g.underOdds];if(tt[2]!=null)rows.push([tt[0],(tt[1]!=null?Math.round(tt[1]*100)+"%":"\u2014"),formatOdds(tt[3]),tt[2]*100]);}return {a,h,ac:colFor(a,sport),hc:colFor(h,sport),state:(g.half==="bottom"?"Bot":"Top")+" "+(g.inning||"")+(g.outs!=null?" \u00b7 "+g.outs+" out":""),rows,gameId:g.gameId};});
  const kpiHas=boardItems.length>0;
  const kAvg=kpiHas?(boardItems.reduce((a,x)=>a+x.edge,0)/boardItems.length).toFixed(1):null;
  const kBest=kpiHas?Math.max(...boardItems.map(x=>x.edge)).toFixed(1):null;
  const BF=[["All","all"],["ML","ml"],["Spread","spread"],["Totals","totals"]];

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd">
        <div className="hrow">
          <div className="brand"><b>Wize</b><i>Picks</i></div>
          <span className="pill"><span className="d"/>{anyLive?"LIVE":marketsLive?"OPEN":"CLOSED"}</span>
          <div className="sp"/>
          <div className="ibtn" onClick={()=>navigate("/settings")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
        </div>
        <div className="sports">
          {[["MLB","mlb",true],["NBA","nba",true],["NHL","nhl",false],["NFL","nfl",true],["CFB","cfb",false]].map(([lb,key,ins])=>(
            <b key={key} className={(ins?"l2 ":"")+(sport===key?"on":"")} onClick={()=>{ if(key==="mlb"||key==="nba"||key==="nfl"){ if(key!==sport){setSport(key);setBoard("all");} } else navigate(`/${key}-games`); }}><span className="o"/>{lb}</b>
          ))}
        </div>
      </div>

      {sport==="nfl" && (
        <div style={{margin:"0 14px 10px",padding:"9px 12px",border:"1px solid #6b4a16",background:"linear-gradient(180deg,#1a1305,#0d0a02)",borderRadius:10,fontFamily:"var(--mono)",fontSize:11,lineHeight:1.45,color:"#f3b94f"}}>
          ⚠ NFL MODEL IN TRAINING — preseason preview. Ratings are seeded from 2025 results and are <b>not yet calibrated</b> against 2026 games. Edges shown are provisional, for preview only — not betting advice until validated in-season.
        </div>
      )}
      {sport==="nfl" && phaseAvail.length>1 && (
        <div style={{display:"flex",gap:8,margin:"0 14px 10px"}}>
          {[["preseason","Preseason"],["regular","Regular Season"]].filter(([k])=>phaseAvail.includes(k)).map(([k,lb])=>(
            <span key={k} onClick={()=>{ if(k!==nflPhase){ setNflPhase(k); setEdges(null); setLoading(true); } }}
              style={{cursor:"pointer",fontFamily:"var(--mono)",fontSize:11.5,padding:"6px 13px",borderRadius:999,border:"1px solid "+(nflPhase===k?"#1d9e75":"#22303a"),color:nflPhase===k?"#38e1a0":"#7d8a98",background:nflPhase===k?"rgba(29,158,117,0.12)":"transparent"}}>{lb}</span>
          ))}
        </div>
      )}

      {scoreTape.length>0 && (
        <div className="scoretape"><span className="lvpill"><span className="d"/>{scoreTape.some(t=>t.live)?"LIVE":scoreTape.some(t=>t.as!=null)?"SCORES":"TODAY"}</span>
          <div className="stwrap"><div className="sttrack">{[...scoreTape,...scoreTape].map((s,i)=>(
            <span key={i}><span className="g">{s.a}</span> {s.as!=null?<span className="sc">{s.as}</span>:null} <span className="g">{s.h}</span> {s.hs!=null?<span className="sc">{s.hs}</span>:null} <span className="st">{s.state}</span></span>
          ))}</div></div>
        </div>
      )}

      {hasFull && pulseAlerts.length>0 && <MarketPulse alerts={pulseAlerts}/>}

      <div id="content">
        {hasFull
          ? (heroItems.length>0
              ? <Swiper cls="herocar" dotcls="hdots">{heroItems.map((h,i)=><HeroSlide key={i} h={h} i={i} navigate={navigate} sport={sport}/>)}</Swiper>
              : <div className="herocar"><div className="hslide"><div className="hero" style={{textAlign:"center"}}><div className="eb">BEST EDGE RIGHT NOW</div><div className="heh">Edges post soon</div><div className="hes">Top edges appear ~2 hrs before first pitch.</div></div></div></div>)
          : <Gate title="Today's top edge is locked" navigate={navigate}/>}

        <div className="wpbar" onClick={()=>navigate("/expert-picks")}>
          <div className="ic">W</div>
          <div className="tx"><div className="h">WIZEPLAYS <span className="new">CURATED</span></div><div className="s">{hasFull?"Hand-picked after extra review":"See every pick"}</div></div>
          {wpRecord&&(wpRecord.wins+wpRecord.losses+wpRecord.pushes)>0
            ? <div className="rec"><div className="r">{wpRecord.wins}-{wpRecord.losses}{wpRecord.pushes?"-"+wpRecord.pushes:""}</div><div className="u">{wpRecord.units>=0?"+":""}{wpRecord.units.toFixed(1)}u</div></div>
            : <div className="rec"><div className="r" style={{fontSize:13,color:"#f3b94f"}}>View {"\u203a"}</div></div>}
        </div>

        {hasFull && <div className="kpis">
          <div className="kpi"><div className="k">EDGES</div><div className="v">{boardItems.length}</div></div>
          <div className="kpi"><div className="k">AVG EDGE</div><div className={"v "+(kpiHas?"g":"")}>{kpiHas?"+"+kAvg+"%":"\u2014"}</div></div>
          <div className="kpi"><div className="k">BEST</div><div className={"v "+(kpiHas?"gold":"")}>{kpiHas?"+"+kBest+"%":"\u2014"}</div></div>
          <div className="kpi"><div className="k">LIVE</div><div className={"v "+(liveItems.length?"red":"")}>{liveItems.length}</div></div>
        </div>}

        {liveItems.length>0 && <div id="livesec">
          <div className="seclbl">LIVE EDGES <span className="ct">in-game {"\u00b7"} updates 60s</span><span className="lk">swipe {"\u203a"}</span></div>
          <Swiper cls="car" dotcls="dots">{liveItems.map((g,i)=><LiveEdgeCard key={i} g={g} navigate={navigate} locked={!hasFull}/>)}</Swiper>
        </div>}

        <div className="seclbl">FULL BOARD <span className="ct">{boardItems.length} edges</span></div>
        {hasFull
          ? <>
              <div className="chips">{BF.map(([lb,key])=><span key={key} className={"chipf "+(board===key?"on":"")} onClick={()=>setBoard(key)}>{lb}</span>)}</div>
              {boardItems.length>0
                ? <>
                    <div className="grid">{boardItems.map((d,i)=>{const id=d.gameId+d.cat+i;return <BoardRow key={id} d={d} i={i} open={openId===id} onToggle={()=>setOpenId(openId===id?null:id)} navigate={navigate} sport={sport}/>;})}</div>
                    <div className="sum"><span className="l">{boardItems.length} game edges</span><span className="sp"/><span>avg <span className="p">+{kpiHas?kAvg:"0.0"}%</span></span></div>
                  </>
                : <div className="estate"><div className="et">No edges on the board yet</div><div className="es">Edges appear as books post tonight's lines.</div></div>}
            </>
          : <Gate title="Edges are an All-Access feature" navigate={navigate}/>}

        {hasFull && moverItems.length>0 && <>
          <div className="seclbl">MARKET MOVERS <span className="ct">all {moverItems.length} moves {"\u00b7"} ranked by {"\u00a2"}</span><span className="lk">swipe {"\u203a"}</span></div>
          <Swiper cls="car" dotcls="dots">{moverItems.map((d,i)=><MoverCard key={i} d={d}/>)}</Swiper>
        </>}

        {sp.hasProps && hasFull && propItems.length>0 && <>
          <div className="seclbl">PLAYER PROPS <span className="lk">swipe {"\u203a"}</span></div>
          <Swiper cls="car" dotcls="dots">{propItems.map((d,i)=><PropCardM key={i} d={d} rank={i+1} navigate={navigate}/>)}</Swiper>
          <div className="seeall" onClick={()=>navigate("/props")}>See all props {"\u203a"}</div>
        </>}

        {parkItems.length>0 && <>
          <div className="seclbl">PARK FACTORS <span className="ct">run &amp; HR environment</span><span className="lk">swipe {"\u203a"}</span></div>
          <Swiper cls="car" dotcls="dots">{parkItems.map((d,i)=><ParkCardM key={i} d={d}/>)}</Swiper>
        </>}

        <div className="spincard" onClick={()=>navigate("/daily-card")}>
          <div className="h">WIZE SPIN <span className="new">NEW</span></div><div className="wheel"/>
          <div className="d">Need a play fast? Spin for a model-qualified pick.</div><div className="cta">Spin the wheel {"\u203a"}</div>
        </div>

        <div className="seclbl">HOW TO USE WIZEPICKS</div>
        <div className="guide" onClick={()=>navigate("/guide")}><div className="gi"/><div className="gt"><div className="gh">New here? Start with the basics</div><div className="gs">Edges, props, line shopping &amp; the full board {"\u2014"} a quick walkthrough.</div></div><div className="ga">{"\u203a"}</div></div>

        <div className="seclbl">UPCOMING GAMES <span className="lk" onClick={()=>navigate("/games")}>view all {"\u203a"}</span></div>
        <Swiper cls="car" dotcls="dots">{(upcoming||[]).map((g,i)=>{const a=g.awayAbbr||shortTeam(g.away||"");const h=g.homeAbbr||shortTeam(g.home||"");const gid=g.id||g.gameId;return <div key={i} className="gm" onClick={()=>gid&&navigate(`/game/${sport}/${gid}`)}><div className="mt">{a} <span className="x">v</span> {h}</div><div className="tm">{fmtTime(g.time)}{g.totals&&g.totals.projected!=null?" \u00b7 O/U "+g.totals.projected:""}</div></div>;})}</Swiper>
      </div>

      <nav className="nav">
        <a className="on"><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect className="db1" x="2" y="13" width="4" height="5" rx="1"/><rect className="db2" x="7.3" y="13" width="4" height="5" rx="1"/><rect className="db3" x="12.6" y="13" width="4" height="5" rx="1"/><rect className="db4" x="18" y="13" width="4" height="5" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate(hasFull?"/props":"/pricing")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
  );
}

// ============ PORTED COMPONENTS (v11 mock markup) ============
const SLUGM={CWS:"chw",CHW:"chw"};
function LogoM({ab,col,lg="mlb"}){ const [bad,setBad]=useState(false); const slug=(SLUGM[ab]||ab||"").toLowerCase();
  return <span className="lg" style={{background:`radial-gradient(circle at 50% 32%, ${col}aa, #0c1018 82%)`}}>{(bad||!ab)?String(ab||"?").slice(0,3):<img src={`https://a.espncdn.com/i/teamlogos/${lg}/500/${slug}.png`} alt="" onError={()=>setBad(true)}/>}</span>;
}
function SparkM({dir,seed=0}){ const n=7,w=40,h=15,z=[1.4,-1,.8,-1.6,.6,0,-1.2];const pts=[];
  for(let i=0;i<n;i++){const t=dir==="up"?-(i/(n-1))*8:dir==="dn"?(i/(n-1))*8:0;const y=Math.max(2,Math.min(h-2,h/2+t*.55+z[(i+seed)%7]));pts.push([(i/(n-1))*w,y]);}
  const col=dir==="up"?"#33e991":dir==="dn"?"#ff6a5a":"#46505c";const path=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  return <svg className="spk" width={w} height={h} viewBox={`0 0 ${w} ${h}`}><path d={path} fill="none" stroke={col} strokeWidth="1.4" strokeLinejoin="round"/></svg>;
}
function HeroChartM({dir,seed=0}){ const n=9,W=150,H=42;const base=[];
  for(let i=0;i<n;i++){const trend=dir==="dn"?(n-1-i):i;base.push(trend+((seed*7+i*11)%5)*0.45);}
  const mn=Math.min(...base),mx=Math.max(...base),rng=(mx-mn)||1;const X=i=>i/(n-1)*W,Y=v=>H-4-((v-mn)/rng)*(H-9);
  const ln=base.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");const ar=ln+`L${W} ${H} L0 ${H} Z`;
  const col=dir==="dn"?"#ff6a5a":"#33e991";const ex=X(n-1),ey=Y(base[n-1]);const gid="hg"+seed;
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="40" preserveAspectRatio="none" style={{overflow:"visible",marginTop:3}}>
    <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.3"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
    <path d={ar} fill={`url(#${gid})`}/><path d={ln} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    <circle cx={ex} cy={ey} r="2.6" fill={col}><animate attributeName="opacity" values="1;.3;1" dur="1.3s" repeatCount="indefinite"/></circle></svg>;
}
function HeroSlide({h,i,navigate,sport}){ const lg=(SPORTS[sport]||SPORTS.mlb).lg;
  const mv=h.mv?<>{h.mv[0]} <span className="up">{"\u2192"} {h.mv[1]}</span></>:h.odds;
  return (<div className="hslide"><div className="hero" onClick={()=>h.gameId&&navigate(`/game/${sport}/${h.gameId}`)}>
    <div className="htop"><div className="eb">BEST EDGE RIGHT NOW</div><div className="hbadges"><span className="hedge">+{h.edge.toFixed(1)}% EDGE</span><span className="hot">HOT</span></div></div>
    <div className="hpick">{h.p}<span className="mk">{h.mk}</span></div>
    <div className="hpg"><span className="lgs" style={{display:"inline-flex",verticalAlign:"-6px",marginRight:6}}><LogoM ab={h.a[0]} col={h.a[1]} lg={lg}/><LogoM ab={h.h[0]} col={h.h[1]} lg={lg}/></span>{h.g}</div>
    <div className="hmid">
      <div className="hcell"><div className="k">ODDS / MOVE</div><div className="v">{mv}</div></div>
      <div className="hcell"><div className="k">STARTS</div><div className="v">{h.starts||"\u2014"}</div></div>
      <div className="hchart"><div className="k">LINE MOVE</div><HeroChartM dir={h.mv?h.mv[2]:"up"} seed={i}/></div>
    </div>
    <div className="hmm">model <b>{h.model}%</b> vs market {h.mkt}% {"\u00b7"} {String(h.conv).toUpperCase()} conviction</div>
    <div className="hf"><span>Tap for the full matchup breakdown</span><span>{"\u203a"}</span></div>
  </div></div>);
}
function BoardRow({d,i,open,onToggle,navigate,sport}){ const lg=(SPORTS[sport]||SPORTS.mlb).lg;
  const av=<div className="av"><LogoM ab={d.h?d.h[0]:d.a[0]} col={d.h?d.h[1]:d.a[1]} lg={lg}/></div>;
  const leg=(name,L)=> L?(<div className="rdrow"><span className="leg">{name}</span><span className={"tier "+String(L[0]).toLowerCase()}>{L[0]}</span><span className="pk">{L[1]} {"\u00b7"} {L[2]}</span><span className={"ag "+(L[3]?"y":"n")}>{L[3]?"\u2713 agrees":"differs"}</span></div>):null;
  const conv=d.conv||"";
  const tok=String(d.p||"").trim().split(/\s+/);
  const isTot=tok[0]==="Over"||tok[0]==="Under";
  const teamNm=NICK[tok[0]]||tok[0];
  const rest=tok.slice(1).join(" ");
  const fairStr=formatOdds(fairAmerican(d.model));
  const mktW=Math.min(100,Math.max(0,d.mkt||0));
  const ohW=Math.min(Math.max(0,100-mktW),(d.model!=null&&d.mkt!=null)?Math.max(0,d.model-d.mkt):0);
  const convN=conv==="high"?3:conv==="med"?2:1;
  const money=d.delta>0?["up","money \u25b2 toward us"]:d.delta<0?["dn","money \u25bc off us"]:["","money holding"];
  const hitWord=isTot?"to hit":(tok[1]==="ML"?"to win":"to cover");
  const tail=<>{"\u2014"} at <em>{d.odds}</em> {"\u00b7"} {d.g}{d.starts?" "+d.starts:""}</>;
  const psub = isTot
    ? <>Take the <b>{tok[0].toLowerCase()} {rest}</b> {tail}</>
    : (tok[1]==="ML"
        ? <>Take the <b>{teamNm}</b> to win {tail}</>
        : <>Take <b>{teamNm}</b> {rest} {tail}</>);
  return (
    <div className={"gr "+conv+(open?" sel":"")} onClick={onToggle}>
      <div className="pband">
        <div className="pbtop">
          <div className="pbL">
            <div className="lgs"><LogoM ab={d.a[0]} col={d.a[1]} lg={lg}/><LogoM ab={d.h[0]} col={d.h[1]} lg={lg}/></div>
            <div>
              <div className="ptag"><span className="pchk">{"\u2713"}</span><span className="plbl">THE PLAY</span></div>
              <div className="ppick">{d.p}</div>
            </div>
          </div>
          <div className="pedge"><div className={"pev "+(d.edge<0?"neg":"pos")}>{d.edge>=0?"+":""}{d.edge.toFixed(1)}<span>%</span></div><div className="pee">EDGE</div></div>
        </div>
        <div className="psub">{psub}</div>
      </div>
      <div className="pbody">
        <div className="pval">
          <div className="pvrow">
            <div className="pvc"><div className="pvl">YOU GET</div><div className="pvn">{d.odds}</div></div>
            <span className="pvar">{"\u2192"}</span>
            <div className="pvc r"><div className="pvl g">FAIR PRICE</div><div className="pvn g">{fairStr}</div></div>
          </div>
          <div className="pbar"><i className="bf" style={{width:mktW+"%"}}/><i className="of" style={{left:mktW+"%",width:ohW+"%"}}/></div>
          <div className="pble"><span>MARKET {d.mkt!=null?d.mkt+"%":"\u2014"}</span><span className="g">MODEL {d.model!=null?d.model+"%":"\u2014"} {hitWord}</span></div>
        </div>
        <div className="pfoot">
          <div className="pconv"><span className="pmeter"><i className={convN>=1?"on":""}/><i className={convN>=2?"on":""}/><i className={convN>=3?"on":""}/></span><span className="pcl">{conv?conv.toUpperCase():""} CONVICTION</span></div>
          <div className="pmoney">{d.mv&&<SparkM dir={d.mv[2]} seed={i}/>}<span className={"pmt "+money[0]}>{money[1]}</span></div>
        </div>
      </div>
      <div className="det"><div className="dwrap">
        <div className="dhead">{av}<div><div className="nm">{d.g}</div><div className="mu">{d.p}</div></div>{d.starts&&<div className="st">{d.starts}</div>}</div>
        {d.model!=null&&<div className="mvm"><div className="lbls"><span className="ml">model {d.model}%</span><span className="mk2">market {d.mkt}%</span></div><div className="bar"><i style={{width:d.model+"%"}}/></div></div>}
        <div className="dchips">
          {d.odds&&<span className="dchip"><b>Odds</b>{d.odds}</span>}
          {d.mv&&<span className="dchip"><b>Move</b>{d.mv[0]}{"\u2192"}{d.mv[1]}</span>}
          {d.conv&&<span className={"dchip "+(d.conv==="high"?"g":d.conv==="med"?"gold":"")}><b>Conv</b>{d.conv.toUpperCase()}</span>}
          {d.park&&d.park.map((p,k)=><span key={k} className="dchip"><b>Park</b>{p}</span>)}
          {d.wx&&<span className="dchip">{d.wx}</span>}
        </div>
        {d.flags&&<div className="flags">{d.flags.map((x,k)=><span key={k} className={x[0]}>{x[1]}</span>)}</div>}
        {d.read&&<div className="rdbox"><div className="rl">MARKET READ {"\u2014"} BOOKS LEAN</div>{leg("Win",d.read.win)}{leg("Cover",d.read.cover)}{leg("Total",d.read.total)}</div>}
        {d.why&&<div className="why"><b>Why&nbsp;&nbsp;</b>{d.why}</div>}
        <span className="dlink" onClick={(ev)=>{ev.stopPropagation();d.gameId&&navigate(`/game/${sport}/${d.gameId}`);}}>Full matchup breakdown {"\u203a"}</span>
      </div></div>
    </div>
  );
}
function MoverCard({d}){ const c=d.delta||0;const dir=c>=0?"up":"dn";
  return (<div className="mvc"><div className="pk">{d.p}</div><div className="mu">{d.g}</div>
    {d.mv?<><div className={"od "+dir}>{d.mv[0]} <span className="a">{"\u2192"}</span> {d.mv[1]} {c>=0?"\u25b2":"\u25bc"}{Math.abs(c)}</div><div className={"ct2 "+dir}>{c>=0?"+":"\u2212"}{Math.abs(c)} cents</div></>
      :<><div className="od">{d.odds}</div><div className="ct2">{d.model!=null?d.model+"% model":""}</div></>}
  </div>);
}
function PropCardM({d,rank,navigate}){ const col=d.player[2];
  return (<div className="prc" onClick={()=>navigate("/props")}><div className="rk">{rank}</div>
    <div className="av2" style={{background:`radial-gradient(circle at 50% 30%, ${col}, #0c1018 80%)`,boxShadow:`0 0 0 2.5px ${col}`}}>{d.id?<img src={`https://midfield.mlbstatic.com/v1/people/${d.id}/spots/120`} alt="" onError={(e)=>{e.currentTarget.style.display="none";e.currentTarget.parentNode.textContent=d.player[1];}}/>:d.player[1]}</div>
    <div className="nm">{d.player[0]}</div><div className="mu">{d.g}</div>
    <div className="ed">+{d.edge.toFixed(1)}%</div><div className="lb">{d.mk} EDGE</div>
    <div className="bet"><span>{d.p}</span><span className="o">{d.odds}</span></div></div>);
}
function ParkCardM({d}){ return (
  <div className={"pkc "+d.tag[1]}><div className="r1"><div><div className="vn">{d.venue}</div><div className="tm">{d.g}</div></div><LogoM ab={d.a[0]} col={d.a[1]}/></div>
    <div className={"tg "+d.tag[1]}>{d.tag[0]}</div>
    <div className="bs"><div className="b"><div className="kk">HR BOOST</div><div className={"vv "+(d.hr.startsWith("-")?"dn":"")}>{d.hr}</div></div><div className="b"><div className="kk">RUN BOOST</div><div className={"vv "+(d.run.startsWith("-")?"dn":"")}>{d.run}</div></div></div>
    <div className="wx">{d.wx}</div></div>);
}
function LiveEdgeCard({g,navigate,locked}){ const rows=g.rows||[];
  return (<div className="lec" onClick={()=>g.gameId&&navigate(locked?"/pricing":`/game/mlb/${g.gameId}`)}>
    <div className="lh"><div className="lm"><div className="lgs"><LogoM ab={g.a} col={g.ac}/><LogoM ab={g.h} col={g.hc}/></div>{g.a} @ {g.h}</div><div className="lst"><span className="d"/>{g.state}</div></div>
    {rows.map((r,i)=><div key={i} className="lerow"><span className="ll">{r[0]}</span><span className="lmeta">{r[1]} {"\u00b7"} {r[2]}</span><span className={"le "+(r[3]>=0?"pos":"neg")}>{r[3]>=0?"+":""}{r[3].toFixed(1)}%</span></div>)}
  </div>);
}
function Swiper({cls,dotcls,children}){ const ref=useRef(null);const [act,setAct]=useState(0);const items=Children.toArray(children);
  const onScroll=()=>{const el=ref.current;if(!el)return;const f=el.firstElementChild;const w=f?f.offsetWidth+9:200;setAct(Math.max(0,Math.round(el.scrollLeft/w)));};
  return (<><div className={cls} ref={ref} onScroll={onScroll}>{children}</div>{items.length>1&&<div className={dotcls}>{items.map((_,i)=><i key={i} className={i===act?"on":""}/>)}</div>}</>);
}
function MarketPulse({alerts}){ const [idx,setIdx]=useState(0);const [paused,setPaused]=useState(false);
  useEffect(()=>{if(paused||!alerts||alerts.length<2)return;const id=setInterval(()=>setIdx(i=>(i+1)%alerts.length),3600);return ()=>clearInterval(id);},[paused,alerts]);
  if(!alerts||!alerts.length)return null;const cur=idx%alerts.length;const a=alerts[cur];
  return (<div className="alerts" onClick={()=>setPaused(p=>!p)}>
    <div className="ahead">MARKET PULSE {"\u00b7"} WHAT CHANGED &amp; WHY <span className="ago">{paused?"paused \u00b7 tap to resume":"updated 2m ago"}</span></div>
    <div className="arow"><div className="aline"><span className="adot" style={{background:a.dot,boxShadow:`0 0 6px ${a.dot}`}}/><span className="alab">{a.label}</span><span className="aval">{a.head}</span></div><div className="awhy">{a.sub}</div></div>
    {alerts.length>1&&<div className="dd">{alerts.map((_,i)=><i key={i} className={i===cur?"on":""} onClick={(ev)=>{ev.stopPropagation();setIdx(i);setPaused(true);}}/>)}</div>}
  </div>);
}
function Gate({title,navigate}){
  return <div style={{margin:"13px 14px 0",border:"1px solid rgba(243,185,79,.3)",borderRadius:13,background:"linear-gradient(180deg,#14110a,#06090b)",padding:22,textAlign:"center"}}>
    <div style={{fontSize:22,marginBottom:8}}>{"\uD83D\uDD12"}</div>
    <div style={{fontWeight:800,color:"#fff",fontSize:15,marginBottom:10}}>{title}</div>
    <div onClick={()=>navigate("/pricing")} style={{display:"inline-block",background:"#1D9E75",color:"#04130d",fontWeight:800,fontSize:13,padding:"10px 18px",borderRadius:10,cursor:"pointer"}}>Unlock All-Access {"\u203a"}</div>
  </div>;
}

const S={ shell:{minHeight:"100vh",background:"#000",color:"#f2f6f4",fontFamily:"'Inter',system-ui,sans-serif"} };

const CSS=`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');

:root{--bg:#000;--panel:#0a0e13;--panel2:#0c1219;--line:#141b22;--line2:#1f2832;
--gold:#f3b94f;--red:#ff5d4d;--blue:#5da9e8;--steel:#2674B0;--green:#33e991;--neg:#ff6a5a;--tx:#eef2f7;--mut:#7d8a98;--mut2:#46505c;
--disp:'Barlow Condensed',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;--ui:'Inter',system-ui,sans-serif;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0}
body{background:var(--bg);color:var(--tx);font-family:var(--ui);font-size:13px;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;padding-bottom:64px}
.hd{position:sticky;top:0;z-index:20;background:#000;padding:11px 14px 0}
.hrow{display:flex;align-items:center;gap:8px}
.brand{font-family:var(--disp);font-weight:800;font-size:21px}.brand b{color:#fff}.brand i{color:var(--red);font-style:normal}
.pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);border-radius:999px;padding:3px 8px;font-size:9px;font-weight:800;letter-spacing:.4px;color:#d2ebe2}
.pill .d{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pl 1.7s infinite}
@keyframes pl{0%{box-shadow:0 0 0 0 rgba(51,233,145,.5)}70%{box-shadow:0 0 0 5px rgba(51,233,145,0)}100%{box-shadow:0 0 0 0 rgba(51,233,145,0)}}
.sp{flex:1}
.ibtn{width:30px;height:30px;border:1px solid var(--line2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--panel);color:var(--mut)}
.sports{display:flex;gap:6px;padding:11px 0 11px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.sports b{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:4px 11px;white-space:nowrap;cursor:pointer}
.sports b.on{color:#fff;background:rgba(38,116,176,.18);border-color:var(--steel)}
.sports b .o{width:5px;height:5px;border-radius:50%;background:var(--mut2)}.sports b.l2 .o{background:var(--green)}
.ticker{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#070a0e}
.ticker .tk{display:inline-flex;gap:20px;white-space:nowrap;font-family:var(--mono);font-size:11px;color:var(--mut);padding:7px 0;animation:tick 28s linear infinite}
.ticker .tk b{color:#cfd7e2;font-weight:600}.ticker .up{color:var(--green)}.ticker .dn{color:var(--neg)}.ticker .lv{color:var(--red);font-weight:700}
@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
/* live scores tape */
.scoretape{display:flex;align-items:stretch;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#06090d}
.lvpill{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:0 11px;font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--red);border-right:1px solid var(--line)}
.lvpill .d{width:6px;height:6px;border-radius:50%;background:var(--red);animation:plr 1.3s infinite}
.stwrap{flex:1;overflow:hidden;display:flex;align-items:center}
.sttrack{display:inline-flex;gap:24px;white-space:nowrap;font-family:var(--mono);font-size:11.5px;color:var(--mut);padding:7px 0;animation:tick 24s linear infinite}
.sttrack .g{color:#cfd7e2;font-weight:600}.sttrack .sc{color:#fff;font-weight:700}.sttrack .st{color:var(--mut2)}
/* Market Pulse alert strip */
.alerts{margin:11px 14px 0;border:1px solid var(--line2);border-radius:12px;background:var(--panel);overflow:hidden}
.ahead{display:flex;align-items:center;justify-content:space-between;padding:9px 13px 0;font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.6px;color:var(--mut)}
.ahead .ago{font-family:var(--mono);font-size:9px;color:var(--mut2);font-weight:500;letter-spacing:0}
.arow{padding:9px 13px 11px;cursor:pointer}
.arow.fade{animation:afade .42s ease}
.aline{display:flex;align-items:center;gap:10px}
.aline .adot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}.adot.g{background:var(--green);box-shadow:0 0 8px rgba(51,233,145,.55)}.adot.r{background:var(--red);box-shadow:0 0 8px rgba(255,93,77,.55)}
.aline .alab{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.4px;color:var(--gold);flex:0 0 auto}
.aline .aval{font-family:var(--mono);font-size:13px;color:#fff;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aline .aval .a{color:var(--mut2)}.aline .aval .up{color:var(--green)}.aline .aval .dn{color:var(--neg)}
.awhy{font-family:var(--ui);font-size:10.5px;color:var(--mut);margin-top:5px;padding-left:19px;line-height:1.35}
@keyframes afade{from{opacity:.15;transform:translateY(3px)}to{opacity:1;transform:none}}
.alerts .dd{display:flex;gap:5px;justify-content:center;padding:0 0 9px}.alerts .dd i{width:5px;height:5px;border-radius:50%;background:#222c33;transition:.2s;cursor:pointer}.alerts .dd i.on{background:var(--gold);width:13px;border-radius:3px}

/* section label */
.seclbl{display:flex;align-items:center;gap:10px;margin:20px 14px 0;color:var(--mut);font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:.6px}
.seclbl .ct{font-family:var(--mono);font-size:10px;color:var(--mut2);font-weight:500}
.seclbl .lk{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--mut)}
.seclbl::before{content:"";width:3px;height:13px;border-radius:2px;background:var(--red)}

/* hero */
.herocar{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin-top:11px}.herocar::-webkit-scrollbar{display:none}
.hslide{flex:0 0 100%;scroll-snap-align:start;padding:0 14px}
.hero{border:1px solid rgba(243,185,79,.34);border-radius:15px;background:linear-gradient(180deg,#14110a,#06090b);position:relative;overflow:hidden;animation:glow 3.6s ease-in-out infinite}
@keyframes glow{0%,100%{box-shadow:inset 0 0 22px rgba(243,185,79,.07);border-color:rgba(243,185,79,.3)}50%{box-shadow:inset 0 0 40px rgba(243,185,79,.2);border-color:rgba(243,185,79,.55)}}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(150% 120% at 50% -12%,rgba(243,185,79,.18),transparent 55%);pointer-events:none}.hero>*{position:relative}
.htop{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 0}.eb{font-size:11px;font-weight:800;color:var(--gold)}
.hbadges{display:flex;gap:7px}.hedge{font-family:var(--disp);font-weight:800;font-size:15px;color:var(--green);background:rgba(51,233,145,.1);border:1px solid rgba(51,233,145,.38);border-radius:8px;padding:3px 9px}
.hot{font-size:9px;font-weight:800;color:var(--red);border:1px solid rgba(255,93,77,.4);background:rgba(255,93,77,.12);border-radius:999px;padding:2px 7px}
.hpick{font-family:var(--disp);font-weight:800;font-size:34px;color:#fff;line-height:.9;padding:8px 14px 0}.hpick .mk{font-family:var(--mono);font-size:9px;color:var(--gold);border:1px solid rgba(243,185,79,.4);border-radius:4px;padding:1px 5px;margin-left:7px;vertical-align:middle}
.hpg{font-size:12px;color:var(--mut);font-weight:600;padding:3px 14px 0}
.hmid{display:flex;gap:8px;padding:10px 14px 0;align-items:stretch}
.hcell{border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:6px 9px;flex:1}.hcell .k{font-size:8px;color:var(--mut);font-weight:800}.hcell .v{font-family:var(--mono);font-size:12.5px;color:#fff;margin-top:2px}.hcell .v .up{color:var(--green)}
.hchart{flex:1.1;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:6px 8px;display:flex;flex-direction:column;justify-content:center}.hchart .k{font-size:8px;color:var(--mut);font-weight:800}
.hmm{padding:9px 14px 0;font-family:var(--mono);font-size:10.5px;color:#b9c2cc}.hmm b{color:#fff}
.hf{display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(243,185,79,.16);margin-top:10px;padding:9px 14px;color:var(--gold);font-size:11px;font-weight:600}
.hdots{display:flex;gap:6px;justify-content:center;margin-top:9px}.hdots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2)}.hdots i.on{background:var(--gold);width:16px;border-radius:3px}

/* WizePlays (alone) */
.wpbar{display:flex;align-items:center;gap:11px;margin:13px 14px 0;border:1px solid rgba(243,185,79,.42);border-radius:13px;background:linear-gradient(180deg,#1a1408,#06090b);padding:13px;cursor:pointer}
.wpbar .ic{width:36px;height:36px;border-radius:10px;background:rgba(243,185,79,.16);border:1px solid rgba(243,185,79,.42);display:flex;align-items:center;justify-content:center;color:var(--gold);font-family:var(--disp);font-weight:800;font-size:18px}
.wpbar .tx{flex:1;min-width:0}.wpbar .h{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;letter-spacing:.3px}.wpbar .h .new{font-size:8px;font-weight:800;background:var(--gold);color:#1a1408;border-radius:4px;padding:1px 4px;margin-left:6px;vertical-align:middle;font-family:var(--ui)}
.wpbar .s{font-size:11px;color:var(--mut);margin-top:2px}.wpbar .rec{text-align:right}.wpbar .rec .r{font-family:var(--disp);font-weight:800;font-size:20px;color:#fff;line-height:1}.wpbar .rec .u{font-family:var(--mono);font-size:11px;color:var(--green);margin-top:1px}

/* WizeSpin (alone) */
.spincard{position:relative;margin:13px 14px 0;border:1px solid rgba(243,185,79,.4);border-radius:13px;background:linear-gradient(180deg,#1a1408,#06090b);padding:14px;min-height:84px;cursor:pointer;overflow:hidden}
.spincard .h{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;letter-spacing:.3px}.spincard .h .new{font-size:8px;font-weight:800;background:var(--gold);color:#1a1408;border-radius:4px;padding:1px 4px;margin-left:6px;vertical-align:middle;font-family:var(--ui)}
.spincard .d{font-size:11px;color:var(--mut);margin-top:7px;max-width:64%;line-height:1.4}.spincard .cta{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--gold);margin-top:9px}
.wheel{width:52px;height:52px;border-radius:50%;position:absolute;top:24px;right:16px;background:radial-gradient(circle,#3a2c0a,#14110a 72%);border:2px solid var(--gold);animation:spin 7s linear infinite}.wheel::before{content:"";position:absolute;inset:6px;border-radius:50%;border:1px dashed rgba(243,185,79,.6)}
@keyframes spin{to{transform:rotate(360deg)}}

.kpis{display:flex;gap:8px;margin:13px 14px 0}.kpi{flex:1;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:8px 9px;text-align:center}
.kpi .k{font-family:var(--mono);font-size:8px;color:var(--mut);letter-spacing:.3px}.kpi .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:2px;line-height:1}.kpi .v.g{color:var(--green)}.kpi .v.gold{color:var(--gold)}.kpi .v.red{color:var(--red)}

.chips{display:flex;align-items:center;gap:7px;padding:8px 14px 0;overflow-x:auto;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chipf{font-family:var(--mono);font-size:10px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:4px 10px;white-space:nowrap;cursor:pointer}.chipf.on{color:#06202a;background:var(--blue);border-color:var(--blue);font-weight:600}

.grid{margin:6px 14px 0}
.gr{position:relative;margin-bottom:12px;background:#11171f;border:1px solid #222d39;border-radius:16px;overflow:hidden;cursor:pointer;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
.gr::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--mut2);z-index:2}
.gr.high::before{background:linear-gradient(90deg,#1D9E75,#33e991)}.gr.med::before{background:linear-gradient(90deg,#b08a30,#e0b050)}.gr.low::before{background:var(--mut2)}
.gr.sel{border-color:#2f3d4c}
.pband{padding:13px 15px;background:linear-gradient(180deg,#ffffff,#f1f7f4);border-bottom:1px solid #11171f}
.gr.med .pband{background:linear-gradient(180deg,#ffffff,#fbf6ec)}
.pbtop{display:flex;align-items:center;justify-content:space-between}
.pbL{display:flex;align-items:center;gap:11px}
.pband .lgs .lg{border-color:#fff}
.ptag{display:flex;align-items:center;gap:6px;margin-bottom:2px}
.pchk{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#15875f;color:#fff;font-size:9px;font-weight:900;line-height:1}
.gr.med .pchk{background:#a07818}
.plbl{font-family:var(--mono);font-size:8.5px;color:#15875f;letter-spacing:1.5px;font-weight:700}
.gr.med .plbl{color:#a07818}
.ppick{font-family:var(--disp);font-size:22px;font-weight:800;color:#0c1116;letter-spacing:-.5px;line-height:1}
.pedge{text-align:right;flex:0 0 auto}
.pev{font-family:var(--disp);font-size:22px;font-weight:800;color:#15875f;letter-spacing:-.6px;line-height:.9;font-variant-numeric:tabular-nums}
.gr.med .pev{color:#a07818}.pev.neg{color:#d8795a}.pev span{font-size:13px}
.pee{font-family:var(--mono);font-size:8px;color:#9aa7b3;letter-spacing:1.5px;font-weight:700;margin-top:2px}
.psub{font-size:11.5px;color:#5a6672;margin-top:9px;line-height:1.45}
.psub b{color:#0c1116;font-weight:700}.psub em{color:#15875f;font-style:normal;font-weight:700}
.gr.med .psub em{color:#a07818}
.pbody{padding:13px 15px 15px}
.pval{background:#0b1015;border:1px solid #1c2734;border-radius:11px;padding:11px 12px;margin-bottom:13px}
.pvrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.pvc{flex:1}.pvc.r{text-align:right}
.pvl{font-family:var(--mono);font-size:8px;color:#6b7886;letter-spacing:1px;font-weight:700}
.pvl.g{color:#2c7d5c}.gr.med .pvl.g{color:#9a7d3c}
.pvn{font-family:var(--disp);font-size:18px;font-weight:800;color:#fff;letter-spacing:-.5px}
.pvn.g{color:#33e991}.gr.med .pvn.g{color:#e0b050}
.pvar{color:#33e991;font-size:13px;padding:0 8px}.gr.med .pvar{color:#e0b050}
.pbar{position:relative;height:8px;background:#10171e;border-radius:4px;overflow:hidden}
.pbar .bf{position:absolute;left:0;top:0;height:100%;background:#2a3744}
.pbar .of{position:absolute;top:0;height:100%;background:#33e991}
.gr.med .pbar .of{background:#e0b050}
.pble{display:flex;justify-content:space-between;margin-top:5px;font-family:var(--mono);font-size:8.5px;color:#76838f}
.pble .g{color:#33e991;font-weight:700}.gr.med .pble .g{color:#cdb878}
.pfoot{display:flex;align-items:center;justify-content:space-between}
.pconv{display:flex;align-items:center;gap:7px}
.pmeter{display:flex;gap:2px}.pmeter i{width:6px;height:12px;background:#222c36;border-radius:1.5px;display:block}
.pmeter i.on{background:#33e991}.gr.med .pmeter i.on{background:#e0b050}
.pcl{font-size:10.5px;font-weight:800;color:#33e991;letter-spacing:.3px}.gr.med .pcl{color:#e0b050}
.pmoney{display:flex;align-items:center;gap:6px}
.pmt{font-family:var(--mono);font-size:9px;color:#7d8a98}.pmt.up{color:#33e991}.pmt.dn{color:#d8795a}
.gr .dwrap{margin:0 15px;padding-bottom:14px}
.r1{display:flex;align-items:baseline;gap:7px}
.lgs{display:flex;flex:0 0 auto}.lg{width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:7px;color:#fff;margin-left:-5px;border:1.5px solid #000;overflow:hidden;background:#0c1018}.lg:first-child{margin-left:0}.lg img{width:14px;height:14px;object-fit:contain}
.pick{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;line-height:1}
.mk{font-family:var(--mono);font-size:8.5px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:4px;padding:1px 5px}
.spk{margin-left:auto;flex:0 0 auto}
.edge{font-family:var(--disp);font-weight:800;font-size:21px;line-height:1;font-variant-numeric:tabular-nums}.edge.pos{color:var(--green)}.edge.neg{color:var(--neg)}
.tagr{font-family:var(--ui);font-size:9px;font-weight:800;border-radius:5px;padding:2px 7px;margin-left:auto}.tagr.h{color:var(--gold);background:rgba(243,185,79,.12)}.tagr.p{color:var(--blue);background:rgba(93,169,232,.12)}.tagr.n{color:var(--mut);background:rgba(130,145,154,.1)}
.r2{display:flex;align-items:center;margin-top:7px;font-family:var(--mono);font-size:11.5px;color:var(--mut);font-variant-numeric:tabular-nums}
.r2 .game{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aeb9c8}
.r2 .cw{font-weight:600}.cw.high{color:var(--green)}.cw.med{color:var(--gold)}.cw.low{color:var(--mut)}
.r2 .cell{flex:0 0 auto;text-align:right;padding-left:11px}.r2 .odds{min-width:44px;color:#cfd7e2}.r2 .move .up{color:var(--green)}.r2 .move .dn{color:var(--neg)}.r2 .move .a{color:var(--mut2)}.r2 .clv .p{color:var(--green)}.r2 .clv .n{color:var(--neg)}.r2 .lean{color:var(--blue)}
.lvtag{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:800;color:#ff8a8a;margin-left:auto}.lvtag .d{width:6px;height:6px;border-radius:50%;background:#ff5a5a;animation:plr 1.3s infinite}
@keyframes plr{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
.det{max-height:0;overflow:hidden;transition:max-height .28s ease}.gr.sel .det{max-height:440px;margin-top:11px}
.dwrap{border-top:1px dashed var(--line2);padding-top:11px}
.dhead{display:flex;align-items:center;gap:9px;margin-bottom:9px}.dhead .av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:10px;color:#fff;flex:0 0 auto;overflow:hidden}.dhead .av img{width:23px;height:23px;object-fit:contain}.dhead .nm{font-weight:700;font-size:13px;color:#fff}.dhead .mu{font-size:10.5px;color:var(--mut);font-family:var(--mono);margin-top:1px}.dhead .st{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--mut)}
.mvm{margin:4px 0 9px}.mvm .lbls{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;margin-bottom:4px}.mvm .lbls .ml{color:var(--green)}.mvm .lbls .mk2{color:var(--mut)}.bar{height:7px;border-radius:4px;background:#161e28;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--steel))}
.dchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}.dchip{font-family:var(--mono);font-size:10px;color:#cfd7e2;border:1px solid var(--line2);border-radius:6px;padding:3px 7px;background:var(--panel2)}.dchip b{color:var(--mut);font-weight:500;margin-right:4px}.dchip.g{color:var(--green)}.dchip.gold{color:var(--gold)}
.flags{display:flex;flex-wrap:wrap;gap:8px;font-family:var(--mono);font-size:10.5px;margin-bottom:9px}.flags .ok{color:var(--green)}.flags .warn{color:var(--red)}.flags .info{color:var(--blue)}.flags .mu{color:var(--mut)}
.why{font-size:11.5px;color:#b9c2cc;line-height:1.5;margin-bottom:10px}.why b{color:var(--mut);font-weight:700}
.rdbox{margin-bottom:10px;border:1px solid var(--line2);border-radius:9px;background:var(--panel2);overflow:hidden}
.rdbox .rl{font-family:var(--mono);font-size:8.5px;color:var(--mut);letter-spacing:.5px;padding:7px 10px 5px;background:#0a0f15}
.rdrow{display:flex;align-items:center;gap:9px;font-family:var(--mono);font-size:10.5px;padding:6px 10px;border-top:1px solid #11161c}
.rdrow .leg{flex:0 0 40px;color:var(--mut2)}
.rdrow .tier{flex:0 0 46px;font-weight:600}.tier.strong{color:var(--green)}.tier.soft{color:var(--gold)}.tier.split{color:var(--red)}
.rdrow .pk{flex:1;color:#cfd7e2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rdrow .ag{flex:0 0 auto}.ag.y{color:var(--green)}.ag.n{color:var(--mut)}
.dlink{font-family:var(--disp);font-weight:800;font-size:13px;color:var(--gold)}
.sum{display:flex;align-items:center;gap:12px;margin:0 14px;padding:11px 14px;font-family:var(--mono);font-size:11px;color:var(--mut);border-top:1px solid var(--line2)}.sum .l{color:#cfd7e2;font-weight:600}.sum .p{color:var(--green)}.sum .sp{flex:1}

/* live edge cards */
.lec{width:230px;border:1px solid rgba(255,90,90,.28);border-radius:13px;background:linear-gradient(180deg,#160d0e,#090d12);padding:11px 12px}
.lec .lh{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;gap:8px}
.lec .lm{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;display:flex;align-items:center;gap:7px}
.lec .lst{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9px;font-weight:700;color:#ff8a8a;flex:0 0 auto}
.lec .lst .d{width:6px;height:6px;border-radius:50%;background:#ff5a5a;animation:plr 1.3s infinite}
.lerow{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}
.lerow .ll{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1;min-width:0}
.lerow .lmeta{font-family:var(--mono);font-size:10px;color:var(--mut)}
.lerow .le{font-family:var(--disp);font-weight:800;font-size:16px;flex:0 0 auto;font-variant-numeric:tabular-nums}.le.pos{color:var(--green)}.le.neg{color:var(--neg)}

/* swiping carousels */
.car{display:flex;gap:9px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:8px 14px 0}.car::-webkit-scrollbar{display:none}.car>*{scroll-snap-align:start;flex:0 0 auto}
.dots{display:flex;gap:5px;justify-content:center;margin-top:9px}.dots i{width:5px;height:5px;border-radius:50%;background:#222c33;transition:.2s}.dots i.on{width:14px;border-radius:3px;background:var(--red)}
.caption{font-family:var(--mono);font-size:10px;color:var(--mut2);margin:9px 14px 0;line-height:1.4}
.seeall{margin:11px 14px 0;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:var(--blue);border:1px solid rgba(93,169,232,.3);border-radius:11px;padding:11px;background:rgba(93,169,232,.06);cursor:pointer}
/* mover card */
.mvc{width:188px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:12px}
.mvc .pk{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;line-height:1}.mvc .mu{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:3px}
.mvc .od{font-family:var(--mono);font-size:14px;font-weight:600;margin-top:10px}.mvc .od .a{color:var(--mut2)}.mvc .od.up{color:var(--green)}.mvc .od.dn{color:var(--neg)}
.mvc .ct2{font-family:var(--mono);font-size:11px;font-weight:600;margin-top:4px}.mvc .ct2.up{color:var(--green)}.mvc .ct2.dn{color:var(--neg)}
/* prop card */
.prc{width:138px;border:1px solid rgba(93,169,232,.22);border-radius:14px;background:linear-gradient(180deg,rgba(93,169,232,.06),rgba(93,169,232,.01));padding:12px 9px 11px;position:relative;display:flex;flex-direction:column;align-items:center;text-align:center}
.prc .rk{position:absolute;top:7px;left:7px;width:19px;height:19px;border-radius:6px;background:var(--steel);color:#fff;font-family:var(--disp);font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center}
.prc .av{width:58px;height:58px;border-radius:50%;display:flex;align-items:flex-end;justify-content:center;font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:4px}
.prc .nm{font-weight:800;font-size:13px;color:#eaf1ee;margin-top:8px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prc .mu{font-family:var(--mono);font-size:9px;color:var(--mut);margin-top:2px}
.prc .ed{font-family:var(--disp);font-weight:800;font-size:24px;color:var(--green);margin-top:7px;line-height:1}
.prc .lb{font-size:7.5px;letter-spacing:.3px;color:var(--mut);font-weight:800;margin-top:1px}
.prc .bet{margin-top:9px;width:100%;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(93,169,232,.3);border-radius:8px;background:rgba(93,169,232,.07);padding:6px 8px}
.prc .bet span{font-family:var(--mono);font-weight:600;font-size:10px;color:#dbe4e2}.prc .bet .o{color:var(--blue)}
/* park card */
.pkc{width:200px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:12px}
.pkc.h{border-color:rgba(243,185,79,.26)}.pkc.p{border-color:rgba(93,169,232,.2)}
.pkc .r1{display:flex;align-items:center;justify-content:space-between}.pkc .vn{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff}.pkc .tm{font-family:var(--mono);font-size:9px;color:var(--mut);margin-top:1px}
.pkc .lg{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:8px;color:#fff;flex:0 0 auto;overflow:hidden;background:#0c1018}.pkc .lg img{width:20px;height:20px;object-fit:contain}
.pkc .tg{display:inline-block;font-size:9px;font-weight:800;border-radius:6px;padding:2px 7px;margin-top:9px}.pkc .tg.h{color:var(--gold);background:rgba(243,185,79,.12)}.pkc .tg.p{color:var(--blue);background:rgba(93,169,232,.12)}
.pkc .bs{display:flex;gap:10px;margin-top:9px}.pkc .b .kk{font-family:var(--mono);font-size:8px;color:var(--mut);font-weight:600}.pkc .b .vv{font-family:var(--disp);font-weight:800;font-size:20px;color:var(--green)}.pkc .b .vv.dn{color:var(--neg)}
.pkc .wx{font-family:var(--mono);font-size:10px;color:#aeb9c8;margin-top:9px;padding-top:8px;border-top:1px solid var(--line)}

.guide{display:flex;align-items:center;gap:12px;margin:6px 14px 0;padding:14px 15px;border-radius:14px;border:1px solid rgba(51,233,145,.28);background:linear-gradient(180deg,rgba(51,233,145,.08),rgba(51,233,145,.02));cursor:pointer}
.guide .gi{width:40px;height:40px;border-radius:11px;background:rgba(51,233,145,.12);border:1px solid rgba(51,233,145,.25);flex:0 0 auto}
.guide .gt{flex:1}.guide .gh{font-weight:800;font-size:13.5px;color:#fff}.guide .gs{font-size:11px;color:#9aa6b2;margin-top:3px;line-height:1.4}.guide .ga{color:var(--green);font-weight:800;font-size:17px}
.upcrow{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:6px 14px 0}.upcrow::-webkit-scrollbar{display:none}
.gm{flex:0 0 auto;width:128px;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:9px 11px}.gm .mt{display:flex;align-items:center;gap:5px;font-family:var(--disp);font-weight:800;font-size:14px}.gm .x{color:var(--mut)}.gm .tm{font-family:var(--mono);font-size:9px;color:var(--mut);margin-top:6px}

.offblock{margin:34px 22px;text-align:center}.offblock .big{font-family:var(--disp);font-weight:800;font-size:22px;color:#cfd7e2}.offblock .sm{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:8px;line-height:1.5}

/* tier toggle + free-tier gates */
.tier{display:flex;gap:2px;background:#0a0f13;border:1px solid var(--line2);border-radius:8px;padding:2px;margin-right:2px}
.tier b{font-family:var(--mono);font-size:9px;font-weight:600;color:var(--mut);padding:4px 7px;border-radius:6px;cursor:pointer}.tier b.on{background:#141d24;color:#fff;box-shadow:inset 0 0 0 1px var(--steel)}
.gatecard{position:relative;border:1px solid var(--line2);border-radius:15px;background:radial-gradient(circle at 50% 25%, #11192a, #06090b 75%);padding:24px 18px;text-align:center;overflow:hidden}
.gatecard .lk{width:42px;height:42px;border-radius:12px;background:rgba(243,185,79,.14);border:1px solid rgba(243,185,79,.4);display:inline-flex;align-items:center;justify-content:center;margin-bottom:11px;color:var(--gold)}
.gatecard .gt{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;letter-spacing:.3px}
.gatecard .gs{font-size:11.5px;color:var(--mut);margin-top:6px;line-height:1.55}.gatecard .gs b{color:var(--gold)}
.gatebtn{display:inline-block;margin-top:14px;background:var(--gold);color:#1a1408;font-family:var(--disp);font-weight:800;font-size:14px;letter-spacing:.3px;padding:11px 24px;border-radius:11px;cursor:pointer}
.lockstrip{display:flex;align-items:center;gap:11px;margin:8px 14px 0;padding:12px 13px;border:1px dashed var(--line2);border-radius:11px}
.lockstrip .lkic{width:30px;height:30px;border-radius:8px;background:rgba(243,185,79,.1);border:1px solid rgba(243,185,79,.3);display:flex;align-items:center;justify-content:center;color:var(--gold);flex:0 0 auto}
.lockstrip .lt{font-family:var(--disp);font-weight:800;font-size:14px;color:#cfd7e2}.lockstrip .ls{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:1px}
.lockstrip .u{margin-left:auto;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--gold)}
/* empty states + demo switcher */
.estate{margin:8px 14px 0;border:1px dashed var(--line2);border-radius:12px;padding:20px 16px;text-align:center}
.estate .et{font-family:var(--disp);font-weight:800;font-size:14px;color:#cfd7e2}
.estate .es{font-size:11px;color:var(--mut);margin-top:5px;font-family:var(--mono);line-height:1.45}
.hero .heh{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;margin-top:14px}
.hero .hes{font-size:11.5px;color:var(--mut);margin-top:7px;font-family:var(--mono);line-height:1.55;margin-bottom:4px}
#content,#freecontent,.offblock{padding-bottom:150px}
.demobar{position:fixed;bottom:56px;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;align-items:center;gap:6px;padding:6px 11px;background:rgba(8,12,16,.96);backdrop-filter:blur(8px);border-top:1px dashed var(--line2);font-family:var(--mono);font-size:9px;z-index:5}
.demobar>span{color:var(--gold);font-weight:700;letter-spacing:.6px}
.demobar b{color:var(--mut);padding:4px 9px;border-radius:6px;border:1px solid var(--line2);cursor:pointer}.demobar b.on{background:#141d24;color:#fff;border-color:var(--steel)}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line)}
.nav a{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:8.5px;font-weight:600;color:var(--mut)}.nav a.on{color:var(--gold)}.nav .i{font-size:15px;height:18px;display:flex;align-items:center}
.dbars rect{animation:eq 1.1s ease-in-out infinite}.db1{fill:var(--green)}.db2{fill:var(--red);animation-delay:.18s}.db3{fill:var(--green);animation-delay:.36s}.db4{fill:var(--red);animation-delay:.54s}
@keyframes eq{0%,100%{height:5px;y:13px}50%{height:13px;y:5px}}
`;
