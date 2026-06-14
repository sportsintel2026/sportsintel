import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { edgesApi } from "../lib/api";

/* ---------- helpers ---------- */
function fmtOdds(o){ if(o==null||isNaN(o)) return "—"; const n=Math.round(Number(o)); return n>0?`+${n}`:`${n}`; }
function impliedFromAmerican(a){ if(a==null||isNaN(a)) return null; const n=Number(a); return n>0?100/(n+100):-n/(-n+100); }
function pct1(f){ const v=Number(f)||0; return `${v>=0?"+":""}${(v*100).toFixed(1)}%`; }
const TEAMCOL={ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#C4CED4",CHW:"#C4CED4",CIN:"#C6011F",CLE:"#E31937",COL:"#5A4F9C",DET:"#FA4616",HOU:"#EB6E1F",KC:"#3E7DC4",KCR:"#3E7DC4",LAA:"#BA0021",LAD:"#3E7DC4",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#D31145",NYM:"#FF5910",NYY:"#3A4F73",OAK:"#EFB21E",ATH:"#EFB21E",PHI:"#E81828",PIT:"#FDB827",SD:"#FFC425",SDP:"#FFC425",SEA:"#1B9A8E",SF:"#FD5A1E",SFG:"#FD5A1E",STL:"#C41E3A",TB:"#8FBCE6",TBR:"#8FBCE6",TEX:"#3E66B0",TOR:"#1D6FE0",WSH:"#E0263B",WAS:"#E0263B"};
const teamCol=(ab)=>TEAMCOL[String(ab||"").toUpperCase()]||"#3a4a57";
function shortTeam(t){ const m=String(t||"").match(/[A-Z]{2,3}/); return m?m[0]:String(t||"").slice(0,3).toUpperCase(); }
const isTotal=(e)=>e.side==="over"||e.side==="under";
function edgeLabel(e){ if(isTotal(e)) return `${e.side==="over"?"Over":"Under"} ${e.line}`; const ab=e.teamAbbr||shortTeam(e.matchup); return e.line!=null?`${ab} ${e.line>0?"+":""}${e.line}`:`${ab} ML`; }
function oneSidePerGame(arr){ const g=new Map(); for(const e of arr||[]){ const p=g.get(e.gameId); if(!p||(e.edge??-Infinity)>(p.edge??-Infinity)) g.set(e.gameId,e); } return [...g.values()]; }
const MLB_HEAD=(id)=>`https://midfield.mlbstatic.com/v1/people/${id}/spots/120`;
const NBA_HEAD=(id)=>`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;
const NBACOL={ATL:"#E03A3E",BOS:"#007A33",BKN:"#777",CHA:"#1D1160",CHI:"#CE1141",CLE:"#860038",DAL:"#00538C",DEN:"#0E2240",DET:"#C8102E",GSW:"#1D428A",HOU:"#CE1141",IND:"#002D62",LAC:"#C8102E",LAL:"#552583",MEM:"#5D76A9",MIA:"#98002E",MIL:"#00471B",MIN:"#236192",NOP:"#85714D",NYK:"#006BB6",OKC:"#007AC1",ORL:"#0077C0",PHI:"#006BB6",PHX:"#E56020",POR:"#E03A3E",SAC:"#5A2D81",SAS:"#9AA7AE",TOR:"#CE1141",UTA:"#3E2680",WAS:"#002B5C"};
const nbaCol=(ab)=>NBACOL[String(ab||"").toUpperCase()]||"#3a4a57";
const NBA_MK={points:"PTS",rebounds:"REB",assists:"AST",threes:"3PM"};
const NFL_HEAD=(id)=>`https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
const initials=(n)=>String(n||"").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
const MLB_LOGO=(ab)=>`https://a.espncdn.com/i/teamlogos/mlb/500/${String(ab||"").toLowerCase()}.png`;
function TeamLogo({ab,col}){
  return (
    <div className="tl">
      <img src={MLB_LOGO(ab)} alt="" onError={(e)=>{e.currentTarget.style.display="none"; const s=e.currentTarget.nextElementSibling; if(s)s.style.display="flex";}}/>
      <span className="tlf" style={{background:col||"#3a4a57"}}>{String(ab||"").toUpperCase()}</span>
    </div>
  );
}

/* static, clearly-labeled example for the line-shopping explainer (not on the public feed) */
const SHOP=[["BetMGM","−130",false],["Caesars","−128",false],["DraftKings","−125",false],["FanDuel","−120 ✓ best",true]];

/* curated showcase of recognizable players across sports — illustrative sample, NOT live picks.
   real live edges live inside the app; this section just shows the kind of props we cover. */
const SPOT_EX=[
  {sport:"⚾ MLB",img:MLB_HEAD(592450),ring:teamCol("NYY"),nm:"Aaron Judge",mu:"NYY vs BOS",prop:"O 0.5 HR",odds:"+265",sub:"Home Runs",sc:"#f0a93c",sbg:"rgba(240,169,60,.10)",sbd:"rgba(240,169,60,.28)"},
  {sport:"🏀 NBA",img:NBA_HEAD(3112335),ring:nbaCol("DEN"),nm:"Nikola Jokić",mu:"DEN vs MIN",prop:"O 25.5 Pts",odds:"−115",sub:"Points",sc:"#bba6ff",sbg:"rgba(155,123,255,.10)",sbd:"rgba(155,123,255,.28)"},
  {sport:"⚾ MLB",img:MLB_HEAD(660271),ring:teamCol("LAD"),nm:"Shohei Ohtani",mu:"LAD vs SD",prop:"O 1.5 Hits",odds:"+135",sub:"Hits",sc:"#33e991",sbg:"rgba(51,233,145,.10)",sbd:"rgba(51,233,145,.28)"},
  {sport:"🏈 NFL",img:NFL_HEAD(3139477),ring:"#E31837",nm:"Patrick Mahomes",mu:"KC vs BUF",prop:"O 1.5 Pass TD",odds:"+120",sub:"Passing TDs",sc:"#bba6ff",sbg:"rgba(155,123,255,.10)",sbd:"rgba(155,123,255,.28)"},
  {sport:"🏀 NBA",img:NBA_HEAD(3945274),ring:nbaCol("LAL"),nm:"Luka Dončić",mu:"LAL vs GSW",prop:"O 8.5 Ast",odds:"+105",sub:"Assists",sc:"#bba6ff",sbg:"rgba(155,123,255,.10)",sbd:"rgba(155,123,255,.28)"},
  {sport:"⚾ MLB",img:MLB_HEAD(656941),ring:teamCol("PHI"),nm:"Kyle Schwarber",mu:"PHI vs MIL",prop:"O 0.5 HR",odds:"+210",sub:"Home Runs",sc:"#f0a93c",sbg:"rgba(240,169,60,.10)",sbd:"rgba(240,169,60,.28)"},
];

/* simulated live board — shown only when there are no real edges, so the panel never looks dead.
   clearly badged DEMO; the moment real edges exist, the real board replaces this. */
const SIM_HEROES=[["TEX ML","TEX @ HOU",6.8],["Under 8.5","COL @ SD",5.2],["NYK ML","NYK @ BOS",3.4],["Over 220.5","DEN @ MIN",4.6],["LAD ML","LAD @ ARI",4.1]];
function SimBoard(){
  const seed=[
    {ab:"TEX",col:"#3E66B0",t:"TEX ML",mu:"TEX @ HOU",odds:-118,edge:0.068,band:[-150,-102]},
    {ab:"SD", col:"#FFC425",t:"Under 8.5",mu:"COL @ SD",odds:-106,edge:0.052,band:[-130,-101]},
    {ab:"LAD",col:"#3E7DC4",t:"LAD ML",mu:"LAD @ ARI",odds:-138,edge:0.041,band:[-165,-120]},
    {ab:"NYY",col:"#3A4F73",t:"Over 9.5",mu:"BOS @ NYY",odds:104,edge:0.033,band:[101,135]},
  ];
  const [hi,setHi]=useState(0);
  const [disp,setDisp]=useState(SIM_HEROES[0][2]);
  const [rows,setRows]=useState(seed);
  const [flash,setFlash]=useState({});
  const h=SIM_HEROES[hi%SIM_HEROES.length];

  useEffect(()=>{ const id=setInterval(()=>setHi(i=>i+1),3600); return ()=>clearInterval(id); },[]);
  useEffect(()=>{ const target=h[2]; let cur=0; setDisp(0);
    const t=setInterval(()=>{ cur+=target/14; if(cur>=target){cur=target;clearInterval(t);} setDisp(cur); },26);
    return ()=>clearInterval(t);
  },[hi]);  // eslint-disable-line
  useEffect(()=>{ const id=setInterval(()=>{
    setRows(prev=>{ const f={};
      const next=prev.map((r,i)=>{ if(Math.random()<0.7){ const d=Math.round(Math.random()*14-7); let o=r.odds+d; if(o<r.band[0])o=r.band[0]; if(o>r.band[1])o=r.band[1]; if(o!==r.odds)f[i]=o>r.odds?"up":"dn"; let e=r.edge+(Math.random()*0.006-0.003); e=Math.max(0.012,Math.min(0.094,e)); return {...r,odds:o,edge:e}; } return r; });
      setFlash(f); return next;
    });
  },1800); return ()=>clearInterval(id); },[]);

  const barW=Math.min(92,h[2]*11);
  return (<>
    <div className="scan"/>
    <div className="feat featpop" key={hi}>
      <div className="feat-h"><span className="feat-t">🔥 BEST EDGE RIGHT NOW <span className="newp">⚡ NEW</span></span></div>
      <div className="feat-body">
        <div><div className="feat-pick">{h[0]}</div><div className="feat-mu">{h[1]}</div></div>
        <div className="feat-edge">+{disp.toFixed(1)}<span className="e">% EDGE</span></div>
      </div>
      <div className="ebarwrap"><i style={{width:`${barW}%`}}/></div>
    </div>
    <div className="rowlab simrl"><span>Live board</span><span className="liv"><i/>UPDATING</span></div>
    <div>
      {rows.map((r,i)=>(
        <div className={"erow"+(flash[i]==="up"?" gu":flash[i]==="dn"?" gd":"")} key={i}>
          <TeamLogo ab={r.ab} col={r.col}/>
          <div className="ename"><div className="t">{r.t}</div><div className="m">{r.mu}</div></div>
          <div className={"eodds"+(flash[i]==="up"?" flash-up":flash[i]==="dn"?" flash-dn":"")}>{fmtOdds(r.odds)}</div>
          <div className="eedge pos">{pct1(r.edge)}</div>
        </div>
      ))}
    </div>
    <div className="simfoot">Scanning 12 books <span className="scn"><i/><i/><i/><i/></span></div>
  </>);
}

/* ---- live scores mini-scoreboard ---- */
function LiveScores(){
  const init=[["⚾","NYY","#3A4F73",4,"BOS","#BD3039",2,"Top 7th"],["🏀","DEN","#0E2240",88,"MIN","#236192",83,"Q3 4:12"],["⚾","LAD","#3E7DC4",3,"ARI","#A71930",1,"Bot 5th"]];
  const [games,setGames]=useState(init);
  const [hit,setHit]=useState(-1);
  useEffect(()=>{ const id=setInterval(()=>{
    setGames(prev=>{ const i=Math.floor(Math.random()*prev.length); const which=Math.random()<0.5?3:6; const next=prev.map(g=>g.slice()); next[i][which]+=(next[i][0]==="🏀"?(Math.random()<0.5?2:3):1); setHit(i); return next; });
    setTimeout(()=>setHit(-1),700);
  },2600); return ()=>clearInterval(id); },[]);
  return (
    <div className="lscard">
      <div className="lsh"><div className="lstitle"><span style={{fontSize:16}}>📊</span>Live scores, every game</div><span className="lslive"><i/>LIVE</span></div>
      {games.map((g,i)=>(
        <div className="lsrow" key={i}>
          <div className="lssp">{g[0]}</div>
          <div className="lsgm">
            <div className="lstm"><span className="lsdot" style={{background:g[2]}}/><span className="lsab">{g[1]}</span></div>
            <span className={"lsscr"+(hit===i?" hit":"")}>{g[3]}</span><span className="lsvs">–</span><span className="lsscr">{g[6]}</span>
            <div className="lstm r"><span className="lsab">{g[4]}</span><span className="lsdot" style={{background:g[5]}}/></div>
          </div>
          <div className="lsst">{g[7]}</div>
        </div>
      ))}
      <div className="lscap">Every league — MLB · NBA · NFL · CFB · NHL — updating in real time.</div>
    </div>
  );
}

/* ---- quick spin slot machine (single + parlay) ---- */
function QuickSpin(){
  const r0=useRef(),r1=useRef(),r2=useRef(),resRef=useRef(),modeRef=useRef();
  useEffect(()=>{
    const RESULTS=[
      {mode:"SINGLE",reels:["⚾","LAD","ML"],pill:"🎯 LAD ML · +4.1% edge"},
      {mode:"SINGLE",reels:["🏀","DEN","-4.5"],pill:"🎯 DEN -4.5 · +4.4% edge"},
      {mode:"PARLAY",reels:["TEX","DEN","NYY"],pill:"🎯 3-leg parlay · +540"},
      {mode:"SINGLE",reels:["⚾","ATL","O 8.5"],pill:"🎯 ATL Over 8.5 · +5.0% edge"},
      {mode:"SINGLE",reels:["🏀","NYK","ML"],pill:"🎯 NYK ML · +3.1% edge"},
      {mode:"PARLAY",reels:["LAD","BOS","MIL"],pill:"🎯 3-leg parlay · +410"},
      {mode:"SINGLE",reels:["⚾","PHI","ML"],pill:"🎯 PHI ML · +3.9% edge"},
    ];
    const POOL=[["⚾","🏀","🏈"],["TEX","LAD","NYK","BOS","ATL","DEN","PHI","HOU","SF","MIL"],["ML","O 8.5","-3.5","U 220","O 25.5","-4.5"]];
    const reels=[r0,r1,r2];
    let ri=0, cyc=null, timers=[];
    const rnd=a=>a[Math.floor(Math.random()*a.length)];
    const par=el=>el.current&&el.current.parentElement;
    function spin(){
      const r=RESULTS[ri%RESULTS.length];ri++;const isP=r.mode==="PARLAY";
      if(modeRef.current){modeRef.current.textContent=isP?"PARLAY":"SINGLE PLAY";modeRef.current.className="qstag"+(isP?" par":"");}
      if(resRef.current){resRef.current.classList.remove("show");resRef.current.style.opacity="0";resRef.current.className="qspill"+(isP?" par":"");}
      reels.forEach(el=>{const p=par(el); if(p){p.classList.add("spin");p.classList.remove("land");}});
      cyc=setInterval(()=>{reels.forEach((el,k)=>{const p=par(el); if(p&&p.classList.contains("spin")&&el.current){el.current.textContent=isP?rnd(POOL[1]):rnd(POOL[k]); el.current.className="qsrv"+((!isP&&k===0)?" emoji":"");}});},80);
      const stop=(k,val,em)=>{const p=par(reels[k]); if(p)p.classList.remove("spin"); if(reels[k].current){reels[k].current.textContent=val;reels[k].current.className="qsrv"+(em?" emoji":"");} if(p)p.classList.add("land");};
      timers.push(setTimeout(()=>stop(0,r.reels[0],!isP),650));
      timers.push(setTimeout(()=>stop(1,r.reels[1],false),900));
      timers.push(setTimeout(()=>{clearInterval(cyc);stop(2,r.reels[2],false); if(resRef.current){resRef.current.textContent=r.pill;resRef.current.classList.add("show");}},1180));
      timers.push(setTimeout(()=>{reels.forEach(el=>{const p=par(el); if(p)p.classList.remove("land");});},2700));
    }
    spin();
    const loop=setInterval(spin,3800);
    return ()=>{clearInterval(loop);clearInterval(cyc);timers.forEach(clearTimeout);};
  },[]);
  return (
    <div className="qscard">
      <div className="qsh"><div className="qstitle"><span style={{fontSize:16}}>🎰</span>Quick Spin</div><span className="qstag" ref={modeRef}>SINGLE PLAY</span></div>
      <div className="qshook">Can't decide on a play? Hit spin and we'll generate a quick pick for you.</div>
      <div className="qsreels">
        <div className="qsreel"><span className="qsrv emoji" ref={r0}>⚾</span></div>
        <div className="qsreel"><span className="qsrv" ref={r1}>LAD</span></div>
        <div className="qsreel"><span className="qsrv" ref={r2}>ML</span></div>
      </div>
      <div className="qsres"><span className="qspill" ref={resRef}>🎯 LAD ML · +4.1% edge</span></div>
      <Link className="qsbtn" to="/signup">SPIN A PICK<span className="qssh"/></Link>
      <div className="qscap">Single plays or full parlays · pick a sport, or mix them.</div>
      <div className="qsdisc">🎲 <span><b>Just for fun</b> — Quick Spin is a bit of entertainment, not betting advice. If you do play, only bet what you can afford and keep it small.</span></div>
    </div>
  );
}

/* ---- WizePlays: handpicked plays ---- */
function WizePlays(){
  return (
    <div className="wpcard">
      <div className="wph"><div className="wpt"><span style={{fontSize:16}}>⭐</span>WizePlays</div><span className="wpbadge">HANDPICKED<span className="wpsh"/></span></div>
      <div className="wpsub">Our analysts' handpicked plays — the highest-conviction edges we back with real confidence.</div>
      <div className="wpplay"><div className="wpck">✓</div><div className="wppi"><div className="wppn">Yankees ML</div><div className="wppm">NYY vs BOS · model + sharp lean</div></div><span className="wpconv hi">HIGH</span><span className="wpod">−130</span></div>
      <div className="wpplay"><div className="wpck">✓</div><div className="wppi"><div className="wppn">Rockies / Padres Under 8.5</div><div className="wppm">COL @ SD · pitching edge</div></div><span className="wpconv md">MED</span><span className="wpod">−108</span></div>
      <Link className="wptrack" to="/performance"><span className="wpic">🔒</span><span className="wptx">Our system <b>auto-records and tracks every pick</b> — and once it's in, <b>it's locked and can't be changed.</b> Win or lose, the full record's on the board.</span><span className="wpgo">View →</span></Link>
      <div className="wpnote">A fresh hand-curated slate every day · sample shown, today's plays are inside</div>
    </div>
  );
}

export default function LandingPage(){
  const [edges,setEdges]=useState(null);
  const [nba,setNba]=useState({});
  const [nbaProps,setNbaProps]=useState({});
  const [loading,setLoading]=useState(true);
  const [failed,setFailed]=useState(false);
  const prev=useRef({});
  const [flash,setFlash]=useState({});
  const [spotIdx,setSpotIdx]=useState(0);
  const [spotAnim,setSpotAnim]=useState("in");

  const load=useCallback(async()=>{
    const [rMlb,rNbaE,rNbaP]=await Promise.allSettled([edgesApi.getMLB(),edgesApi.getNBA(),edgesApi.getNBAProps()]);
    if(rMlb.status==="fulfilled" && rMlb.value){
      const d=rMlb.value; const f={};
      [...(d.moneylineEdges||[]),...(d.totalsEdges||[])].forEach(e=>{
        const k=e.gameId+e.side;
        if(prev.current[k]!=null && prev.current[k]!==e.odds) f[k]=e.odds>prev.current[k]?"up":"dn";
        prev.current[k]=e.odds;
      });
      setFlash(f); setEdges(d); setFailed(false);
    }else{ setFailed(true); }
    setNba(rNbaE.status==="fulfilled" ? (rNbaE.value||{}) : {});
    setNbaProps(rNbaP.status==="fulfilled" ? (rNbaP.value||{}) : {});
    setLoading(false);
  },[]);
  useEffect(()=>{ load(); const id=setInterval(load,45000); return ()=>clearInterval(id); },[load]);

  /* ---- derive live board ---- */
  const e=edges||{};
  const games=e.games||[];
  const gameById={}; games.forEach(g=>{ gameById[g.id]=g; });
  const muFor=(ed)=>{ if(ed.matchup) return ed.matchup; const g=gameById[ed.gameId]; return g?`${g.awayAbbr||shortTeam(g.away)} @ ${g.homeAbbr||shortTeam(g.home)}`:""; };

  const boardAll=[...(e.moneylineEdges||[]),...(e.totalsEdges||[])];
  const posBoard=oneSidePerGame(boardAll).filter(x=>(x.edge??0)>0)
    .sort((a,b)=>((b.convictionScore||0)-(a.convictionScore||0))||((b.edge||0)-(a.edge||0)));
  const heroPool=boardAll.filter(x=>(x.edge??0)>0 && (x.conviction==="HIGH"||x.conviction==="MEDIUM"))
    .sort((a,b)=>((b.convictionScore||0)-(a.convictionScore||0))||((b.edge||0)-(a.edge||0)));
  const hero=heroPool[0]||posBoard[0]||null;
  const tickerRows=posBoard.slice(0,4);

  const hr=(e.hrPropEdges||[]);
  const hits=(e.hitsPropEdges||[]);
  const ks=(e.kPropEdges||[]);

  /* NBA: ML edges are tracked model output (edge is already a %); props are experimental projections */
  const nbaMl=oneSidePerGame((nba.moneylineEdges||[]).filter(x=>(x.edge??0)>0)).sort((a,b)=>(b.edge||0)-(a.edge||0));
  const nbaPropCount=(nbaProps.pointsProps||[]).length+(nbaProps.assistsProps||[]).length+(nbaProps.threesProps||[]).length+(nbaProps.reboundsProps||[]).length;

  /* spotlight: curated example stars (a sample of coverage — real live edges are inside the app) */
  const spotItems=SPOT_EX;
  const spotLen=spotItems.length;

  /* rotate spotlight */
  useEffect(()=>{ if(spotLen<2) return; const id=setInterval(()=>{
    setSpotAnim("out");
    setTimeout(()=>{ setSpotIdx(i=>(i+1)%spotLen); setSpotAnim("in"); },300);
  },2400); return ()=>clearInterval(id); },[spotLen]);
  const spot=spotLen?spotItems[spotIdx%spotLen]:null;

  const lockedCount=Math.max(0,(posBoard.length-tickerRows.length))+hits.length+ks.length+hr.length+nbaPropCount+nbaMl.length;

  /* marquee items from live board + a couple props */
  const mq=[];
  posBoard.slice(0,6).forEach(x=>mq.push({i:"⚾",t:edgeLabel(x),v:pct1(x.edge),up:(x.edge??0)>=0}));
  nbaMl.slice(0,4).forEach(x=>mq.push({i:"🏀",t:`${x.teamAbbr||shortTeam(x.matchup)} ML`,v:`+${Number(x.edge).toFixed(1)}%`,up:true}));
  hr.slice(0,2).forEach(p=>mq.push({i:"💥",t:`${p.player} HR`,v:fmtOdds(p.odds),up:true}));
  const mqLoop=mq.length?[...mq,...mq]:[];

  const boardEmpty=!loading && (failed || posBoard.length===0);

  return (
    <div className="lpwrap">
      <style>{CSS}</style>

      <nav>
        <div className="wrap nav">
          <div className="logo"><span className="dot"/>Wize<span className="p">Picks</span></div>
          <div className="nlinks">
            <Link className="nlink" to="/pricing">Pricing</Link>
            <Link className="nlink" to="/login">Sign In</Link>
            <Link className="btn btn-red" to="/signup">Sign Up Free</Link>
          </div>
        </div>
      </nav>

      <div className="sport-tabs">
        <span className="st on">⚾ MLB</span>
        <span className="st">🏀 NBA</span>
        <span className="st">🏈 NFL</span>
        <span className="st">🏈 CFB</span>
        <span className="st">🏀 NCAAB</span>
      </div>

      {mqLoop.length>0 &&
      <div className="marquee" aria-hidden="true"><div className="mq-track">
        {mqLoop.map((m,i)=>(
          <span className="mq-item" key={i}>{m.i} <span className="tm">{m.t}</span> <span className={m.up?"up":"dn"}>{m.v}</span></span>
        ))}
      </div></div>}

      <div className="wrap">
        <section className="hero">
          <div className="lights" aria-hidden="true"><span/><span/><span/><span/><span/></div>
          {/* LEFT: pitch */}
          <div className="fade">
            <div className="ebadge">
              <span className="ebar"/>
              <span>
                <span className="eb-k">MORE THAN PICKS</span>
                <span className="eb-s">The model, the edge, and a guide to bet smarter.</span>
              </span>
            </div>
            <h1>Bet smarter,<br/>not <span className="hl-r">harder.</span></h1>
            <p className="lede">A real model versus the live market — every game, every book, one screen.</p>
            <p className="sub">We find where our projections disagree with the price the books are offering, and show you the reasoning. No locks, no hype — just the edge.</p>
            <div className="cta-row">
              <Link className="btn btn-hero" to="/signup">Start free →</Link>
              <Link className="btn btn-ghost" to="/pricing">See what's included</Link>
            </div>
            <div className="nocc">No credit card required · Free account gets you started</div>
            <div className="trust">
              <div className="rec"><span className="num barlow" style={{color:"var(--plight)"}}>12</span><span className="lab">Books shopped</span></div>
              <div className="rec"><span className="num barlow" style={{color:"var(--green)"}}>5</span><span className="lab">Sports</span></div>
              <div className="rec"><span className="num barlow" style={{color:"#f0a93c"}}>100s</span><span className="lab">Edges daily</span></div>
            </div>
          </div>
          {/* RIGHT: featured player prop (example) */}
          <div className="herofig">
            {spot &&
            <div className="spot">
              <div className="spot-tag">🎯 PROP SPOTLIGHT <span className="ex-chip">EXAMPLE</span></div>
              <div className={"spot-card "+(spotAnim==="out"?"sc-out":"sc-in")}>
                <div className="spot-av" style={{boxShadow:`0 0 0 2.5px ${spot.ring||"#3a4a57"}`}}>
                  {initials(spot.nm)}
                  {spot.img && <img src={spot.img} alt="" onError={(ev)=>{ev.target.style.display="none";}}/>}
                </div>
                <div className="spot-info">
                  <div className="spot-sport">{spot.sport}</div>
                  <div className="spot-nm">{spot.nm}</div>
                  <div className="spot-mu">{spot.mu}</div>
                  <div className="spot-sub" style={{color:spot.sc,background:spot.sbg,border:`1px solid ${spot.sbd}`}}>{spot.sub}</div>
                </div>
                <div className="spot-bet">
                  <div className="spot-prop">{spot.prop}</div>
                  <div className="spot-odds">{spot.odds}</div>
                </div>
              </div>
              <div className="spot-dots">
                {spotItems.map((_,i)=><i key={i} className={i===(spotIdx%spotLen)?"on":""}/>)}
              </div>
              <div className="spot-note">Illustrative example — not a live pick</div>
            </div>}
            <div className="hero-scan">
              <div className="hs-pulse"><i/><i/><i/><i/><i/></div>
              <div className="hs-txt"><b>Scanning 12 books</b> across every game — finding edges as the lines move.</div>
              <span className="hs-live"><span className="hs-dot"/>LIVE</span>
            </div>
          </div>
        </section>
      </div>

      {/* MARKET PRICE — repositioned just above the live board */}
      <div className="wrap">
        <section className="sec">
          <div className="kick teal">💹 Market Price · every book, one screen</div>
          <h2>Shop every book. Take the best price. Every time.</h2>
          <p>The same bet pays differently at different books. We put <strong>every major US book side by side</strong>, best price highlighted — so you always grab the better number. That edge has nothing to do with luck.</p>
          <div className="shop">
            <div className="h">Example · same bet, four books</div>
            {SHOP.map(([bk,pr,best],i)=>(
              <div className="b" key={i}><span className={"bk"+(best?" best":"")}>{bk}</span><span className={"pr"+(best?" best":"")}>{pr}</span></div>
            ))}
          </div>
        </section>
      </div>

      {/* MARKETS PREVIEW — its own full-width block */}
      <div className="wrap">
        <div className="live fade2">
            <div className="live-top">
              <span className={"live-badge"+(boardEmpty?" prev":"")}><span className="dot"/>MARKETS {boardEmpty?"PREVIEW":"LIVE"}</span>
              {boardEmpty ? <span className="feat-demo">DEMO</span> : (
              <span className="live-tick">UPDATES 45s
                <svg className="ekg" viewBox="0 0 34 12"><polyline points="0,6 6,6 9,2 13,10 17,4 21,7 26,6 34,6" fill="none" stroke="#33e991" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>)}
            </div>

            {loading && !edges ? (
              <div className="lp-load">Loading today's board…</div>
            ) : boardEmpty ? (
              <SimBoard/>
            ) : (<>
              {hero &&
              <div className="feat">
                <div className="feat-h">
                  <span className="feat-t">🔥 BEST EDGE RIGHT NOW</span>
                  {hero.conviction==="HIGH" && <span className="feat-hot">HOT</span>}
                </div>
                <div className="feat-body">
                  <div>
                    <div className="feat-pick">{edgeLabel(hero)}</div>
                    <div className="feat-mu">{muFor(hero)}</div>
                  </div>
                  <div className="feat-edge">{pct1(hero.edge)}<span className="e">EDGE</span></div>
                </div>
                <svg className="spark" viewBox="0 0 300 34" preserveAspectRatio="none">
                  <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#33e991" stopOpacity=".25"/><stop offset="100%" stopColor="#33e991" stopOpacity="0"/></linearGradient></defs>
                  <path d="M0 22 L25 19 L50 21 L75 14 L100 17 L125 11 L150 14 L175 9 L200 12 L225 8 L250 10 L275 6 L300 8 L300 34 L0 34 Z" fill="url(#sg)"/>
                  <path d="M0 22 L25 19 L50 21 L75 14 L100 17 L125 11 L150 14 L175 9 L200 12 L225 8 L250 10 L275 6 L300 8" fill="none" stroke="#33e991" strokeWidth="2" strokeLinejoin="round"/>
                  <circle cx="300" cy="8" r="3" fill="#33e991"><animate attributeName="opacity" values="1;.35;1" dur="1.3s" repeatCount="indefinite"/></circle>
                </svg>
              </div>}

              <div className="rowlab">Today's edge board · live</div>
              <div className={"eb-scroll"+(tickerRows.length>=4?" on":"")}>
                <div className="eb-track">
                {[...tickerRows,...tickerRows].map((r,idx)=>{ const k=r.gameId+r.side; const fl=flash[k];
                  return (
                  <div className="erow" key={k+"-"+idx}>
                    <TeamLogo ab={r.teamAbbr||shortTeam(r.matchup)} col={teamCol(r.teamAbbr||shortTeam(r.matchup))}/>
                    <div className="ename"><div className="t">{edgeLabel(r)}</div><div className="m">{muFor(r)}</div></div>
                    <div className={"eodds"+(fl==="up"?" flash-up":fl==="dn"?" flash-dn":"")}>{fmtOdds(r.odds)}</div>
                    <div className={"eedge "+((r.edge??0)>=0?"pos":"neg")}>{pct1(r.edge)}</div>
                  </div>);
                })}
                </div>
              </div>

              {lockedCount>0 &&
              <div className="gate">
                <div className="h">🔒 {lockedCount} more edges &amp; props on the board</div>
                <div className="s">Free gives you a daily taste · All-Access opens the full board, line shopping &amp; every prop</div>
                <div className="blur">
                  <div className="r"><span>•••• ML · ••• @ •••</span><span style={{color:"var(--green)"}}>+•.•%</span></div>
                  <div className="r"><span>Over •.• · ••• @ •••</span><span style={{color:"var(--green)"}}>+•.•%</span></div>
                </div>
              </div>}
            </>)}
          </div>
      </div>

      {/* PROP SPOTLIGHT (rotates through real props) */}
      {spot &&
      <div className="wrap spotwrap" style={{display:"none"}}>
        <div className="spot">
          <div className="spot-tag">🎯 PLAYER PROP SPOTLIGHT</div>
          <div className={"spot-card "+(spotAnim==="out"?"sc-out":"sc-in")}>
            <div className="spot-av" style={{boxShadow:`0 0 0 2.5px ${spot.ring||"#3a4a57"}`}}>
              {initials(spot.nm)}
              {spot.img && <img src={spot.img} alt="" onError={(ev)=>{ev.target.style.display="none";}}/>}
            </div>
            <div className="spot-info">
              <div className="spot-sport">{spot.sport}</div>
              <div className="spot-nm">{spot.nm}</div>
              <div className="spot-mu">{spot.mu}</div>
              <div className="spot-sub" style={{color:spot.sc,background:spot.sbg,border:`1px solid ${spot.sbd}`}}>{spot.sub}</div>
            </div>
            <div className="spot-bet">
              <div className="spot-prop">{spot.prop}</div>
              <div className="spot-odds">{spot.odds}</div>
            </div>
          </div>
          <div className="spot-dots">
            {spotItems.map((_,i)=><i key={i} className={i===(spotIdx%spotLen)?"on":""}/>)}
          </div>
          <div className="spot-note">Sample of the players &amp; props we cover · your live edges are inside</div>
        </div>
      </div>}

      <div className="wrap">
        <section className="sec">
          <div className="kick" style={{color:"var(--t3)"}}>Live in every account</div>
          <h2 style={{fontSize:22,marginBottom:6}}>Every game, every league — live.</h2>
          <p className="feat-note">Follow <b>real-time scores</b> across MLB, NBA, NFL, CFB and NHL right next to the model — the moment a game turns, you see it. No tab-hopping, no stale numbers.</p>
          <div style={{marginTop:8}}><LiveScores/></div>
        </section>
      </div>

      <div className="wrap">
        {/* pitch */}
        <section className="sec">
          <div className="kick purple">Why WizePicks</div>
          <h2>Don't bet blind.</h2>
          <p>Everyone wants winners. Smart bettors want winners <strong>at the best price</strong> — because price matters too. We break down the full market, show the reasoning behind every number, and put every book side by side so you take the best one.</p>
          <p>What you're getting isn't a "🔥 LOCK OF THE DAY" with no explanation. It's the data, the matchup, and the market — so you decide with information instead of hope.</p>
        </section>

        <section className="finalcta">
          <div className="lights" aria-hidden="true"><span/><span/><span/></div>
          <div className="fin-in">
            <h2 className="fin-h">Your edge <span style={{color:"var(--green)"}}>never</span><br/>goes off season.</h2>
            <div className="fin-leagues"><span>⚾ MLB</span><span>🏀 NBA</span><span>🏈 NFL</span><span>🏈 CFB</span><span>🏀 NHL</span></div>
            <Link className="btn fin-go" to="/signup">Start free →</Link>
            <div className="fin-checks"><span>✓ Free to start</span><span>✓ No card</span><span>✓ Cancel anytime</span></div>
            <div className="sm">Bet smarter. Bet Wize.</div>
          </div>
        </section>
      </div>

      <div className="ldisc">All players, props, edges and prices shown on this page are simulated examples for illustration only — not live picks, odds, or performance claims. Your real, live edges are inside the app.</div>

      <footer>WizePicks · Live model edges from real sportsbook lines · Bet responsibly</footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@600;700;800&display=swap');
.lpwrap{--bg:#07070e;--bg2:#0b0b16;--card:#0d0d1a;--line:#191929;--line2:rgba(155,123,255,.20);
  --teal:#1D9E75;--green:#33e991;--purple:#9b7bff;--plight:#bba6ff;--red:#ef4444;--rsoft:#ff5d4d;
  --white:#fff;--t1:#e7ebf0;--t2:#9aa6b2;--t3:#5f6b7a;
  background:radial-gradient(1200px 600px at 70% -8%, #15122b 0%, var(--bg) 55%);color:var(--t1);
  font-family:'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden}
.lpwrap *{box-sizing:border-box;margin:0;padding:0}
.lpwrap a{text-decoration:none;color:inherit}
.barlow{font-family:'Barlow Condensed',sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
nav{position:sticky;top:0;z-index:50;background:rgba(7,7,14,.72);backdrop-filter:blur(10px);border-bottom:1px solid #11111e}
.nav{display:flex;align-items:center;justify-content:space-between;height:60px}
.logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:.01em}
.logo .p{color:var(--teal)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 1.8s infinite;flex:0 0 auto}
.nlinks{display:flex;align-items:center;gap:8px}
.nlink{font-size:13px;color:var(--t2);padding:7px 12px;border-radius:8px}
.nlink:hover{color:var(--t1)}
.btn{border:none;border-radius:9px;font-weight:700;font-family:inherit;cursor:pointer;transition:.18s;display:inline-flex;align-items:center;gap:6px}
.btn-red{background:var(--red);color:#fff;padding:9px 18px;font-size:13px}
.btn-red:hover{background:#dc2626;transform:translateY(-1px);box-shadow:0 8px 22px #ef444440}
.btn-ghost{background:transparent;color:var(--t2);border:1px solid #23233a;padding:8px 16px;font-size:13px}
.btn-ghost:hover{color:var(--t1);border-color:#33334d}
.hero{display:grid;grid-template-columns:1fr;gap:34px;padding:34px 0 26px}
@media(min-width:860px){.hero{padding:60px 0 30px}}
.ebadge{display:flex;align-items:flex-start;gap:11px;max-width:360px;margin-bottom:20px}
.ebar{width:3px;align-self:stretch;border-radius:2px;background:linear-gradient(#9b7bff,#f0a93c);flex:0 0 auto;min-height:38px}
.eb-k{display:block;font-size:10.5px;font-weight:800;letter-spacing:.14em;color:#fff;margin-bottom:4px}
.eb-s{display:block;font-size:13px;font-weight:600;color:#f0a93c;line-height:1.5}
h1{font-size:clamp(34px,7vw,56px);font-weight:900;line-height:1.04;letter-spacing:-.02em;margin-bottom:18px;color:#fff}
.lede{font-size:16px;color:var(--t1);font-weight:600;line-height:1.6;margin-bottom:10px;max-width:480px}
.sub{font-size:14.5px;color:var(--t2);line-height:1.7;margin-bottom:26px;max-width:470px}
.cta-row{display:flex;gap:11px;flex-wrap:wrap;align-items:center}
.btn-hero{background:var(--red);color:#fff;padding:14px 28px;font-size:15px}
.btn-hero:hover{background:#dc2626;transform:translateY(-1px);box-shadow:0 10px 26px #ef444445}
.nocc{font-size:11.5px;color:var(--t3);margin-top:14px}
.trust{display:flex;align-items:center;gap:20px;margin-top:26px;flex-wrap:wrap}
.trust .rec{display:flex;align-items:baseline;gap:7px}
.trust .num{font-family:'Barlow Condensed';font-weight:800;font-size:24px}
.trust .lab{font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.hero{position:relative}
@media(min-width:880px){.hero{grid-template-columns:1.02fr .98fr;align-items:center}}
.lights{position:absolute;inset:-40px -10px auto -10px;height:380px;pointer-events:none;z-index:0}
.lights span{position:absolute;border-radius:50%;filter:blur(2px);opacity:.12;background:radial-gradient(circle,rgba(255,255,255,.95),rgba(120,180,255,.4) 30%,transparent 70%);animation:flare 5.5s ease-in-out infinite}
.lights span:nth-child(1){width:80px;height:80px;top:-6px;left:6%}
.lights span:nth-child(2){width:46px;height:46px;top:38px;left:28%;animation-delay:1s}
.lights span:nth-child(3){width:110px;height:110px;top:-26px;right:7%;animation-delay:.5s;background:radial-gradient(circle,rgba(180,255,220,.9),rgba(51,233,145,.36) 32%,transparent 70%)}
.lights span:nth-child(4){width:34px;height:34px;top:70px;right:30%;animation-delay:2s}
.lights span:nth-child(5){width:58px;height:58px;top:6px;left:50%;animation-delay:1.6s}
@keyframes flare{0%,100%{opacity:.10;transform:scale(.9)}50%{opacity:.5;transform:scale(1.12)}}
.fade,.herofig{position:relative;z-index:1}
.herofig{animation:figIn .9s cubic-bezier(.2,.7,.3,1) .12s both}
@keyframes figIn{0%{opacity:0;transform:translateY(22px) scale(.99)}100%{opacity:1;transform:none}}
.ex-chip{font-size:8px;font-weight:900;letter-spacing:.1em;color:#0b0b14;background:#8a93a0;border-radius:5px;padding:2px 6px;margin-left:7px;vertical-align:middle}
.hero-rail{display:flex;align-items:center;gap:11px;margin-top:14px;padding:11px 12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.015)}
.hero-stack{display:flex;flex:0 0 auto}
.hero-stack span{width:33px;height:33px;border-radius:50%;margin-left:-9px;border:2px solid var(--bg);display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:800;font-size:12px;color:#fff}
.hero-stack span:first-child{margin-left:0}
.hero-railt{font-size:11.5px;color:var(--t2);font-weight:600;line-height:1.4}
.hero-railt b{color:#fff;font-weight:800}.hero-railt .ex{color:var(--t3)}
.hero-scan{display:flex;align-items:center;gap:11px;margin-top:14px;padding:12px 13px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(90deg,rgba(51,233,145,.05),rgba(255,255,255,.012));position:relative;overflow:hidden}
.hero-scan::after{content:"";position:absolute;top:0;left:-45%;width:45%;height:100%;background:linear-gradient(90deg,transparent,rgba(51,233,145,.07),transparent);animation:scan 3s linear infinite}
.hs-pulse{display:flex;align-items:flex-end;gap:3px;height:24px;flex:0 0 auto;position:relative;z-index:1}
.hs-pulse i{width:4px;border-radius:2px;background:linear-gradient(var(--green),var(--teal));transform-origin:bottom;animation:eq 1.1s ease-in-out infinite}
.hs-pulse i:nth-child(1){height:40%}
.hs-pulse i:nth-child(2){height:80%;animation-delay:.15s}
.hs-pulse i:nth-child(3){height:55%;animation-delay:.3s}
.hs-pulse i:nth-child(4){height:95%;animation-delay:.45s}
.hs-pulse i:nth-child(5){height:65%;animation-delay:.6s}
@keyframes eq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}
.hs-txt{flex:1;font-size:11.5px;color:var(--t2);font-weight:600;line-height:1.4;position:relative;z-index:1}
.hs-txt b{color:#fff;font-weight:800}
.hs-live{flex:0 0 auto;font-size:9px;font-weight:900;letter-spacing:.1em;color:var(--green);display:inline-flex;align-items:center;gap:5px;position:relative;z-index:1}
.hs-dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green);animation:pulse 1.5s infinite}
.hl-r{color:#ef4444;position:relative;display:inline-block}
.hl-r::after{content:"";position:absolute;left:0;right:0;bottom:1px;height:3px;border-radius:2px;background:linear-gradient(90deg,#ef4444,#ff7a6c);transform:scaleX(0);transform-origin:left;animation:undsweep 3.4s ease infinite}
@keyframes undsweep{0%,18%{transform:scaleX(0)}48%,68%{transform:scaleX(1)}100%{transform:scaleX(0)}}
.btn-hero{animation:rpulse 2.8s ease-in-out infinite}
@keyframes rpulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.4)}50%{box-shadow:0 0 22px 2px rgba(239,68,68,.32)}}
.finalcta{position:relative;overflow:hidden}
.fin-in{position:relative;z-index:1}
.fin-h{font-size:clamp(26px,6vw,40px);font-weight:900;line-height:1.06;letter-spacing:-.02em;color:#fff;margin-bottom:14px}
.fin-leagues{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:12px;color:var(--t2);font-weight:700;margin-bottom:18px}
.fin-go{background:var(--green);color:#04130d;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;box-shadow:0 0 24px rgba(51,233,145,.4);animation:gpulse 2.6s ease-in-out infinite}
.fin-go:hover{background:#2bd47f;transform:translateY(-1px)}
@keyframes gpulse{0%,100%{box-shadow:0 0 18px rgba(51,233,145,.35)}50%{box-shadow:0 0 32px 4px rgba(51,233,145,.5)}}
.fin-checks{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:11px;color:var(--t2);font-weight:600;margin-top:16px}
.sport-tabs{display:flex;gap:6px;max-width:1120px;margin:0 auto;padding:8px 20px 10px;overflow-x:auto;border-bottom:1px solid #11111e}
.sport-tabs .st{flex:0 0 auto;font-size:12px;font-weight:700;color:var(--t2);padding:6px 12px;border-radius:9px;border:1px solid transparent;white-space:nowrap}
.sport-tabs .st.on{color:#fff;background:rgba(51,233,145,.08);border-color:rgba(51,233,145,.3)}
.ldisc{max-width:1120px;margin:0 auto;padding:6px 20px 18px;font-size:9.5px;color:var(--t3);text-align:center;line-height:1.6}
.feat-note{font-size:13px;color:var(--t2);line-height:1.6;margin:6px 0 10px;max-width:600px}
.feat-note b{color:var(--t1);font-weight:800}
.live{background:linear-gradient(180deg,#0e0e1c,#0a0a14);border-radius:18px;
  padding:16px;box-shadow:0 30px 80px -40px rgba(123,90,255,.5);position:relative;overflow:hidden}
.live::before{content:"";position:absolute;inset:0;background:radial-gradient(400px 120px at 80% 0%,rgba(51,233,145,.07),transparent 70%);pointer-events:none}
.live-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
.live-badge{display:inline-flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--green)}
.live-tick{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--t3);font-weight:700;letter-spacing:.06em}
.live-tick .ekg{width:34px;height:12px}
.lp-load{padding:34px 14px;text-align:center;color:var(--t2);font-size:13px;line-height:1.7}
.feat{background:linear-gradient(180deg,rgba(51,233,145,.06),rgba(10,10,20,.4));border:1px solid rgba(51,233,145,.30);
  border-radius:13px;padding:13px 14px;margin-bottom:11px}
.feat-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.feat-t{font-size:9.5px;letter-spacing:.1em;font-weight:800;color:#f0a93c;display:flex;align-items:center;gap:5px}
.feat-hot{font-size:9px;font-weight:800;color:#f0a93c;background:rgba(240,169,60,.12);border:1px solid rgba(240,169,60,.4);border-radius:7px;padding:2px 7px}
.feat-demo{font-size:9px;font-weight:800;letter-spacing:.1em;color:#f0a93c;background:rgba(240,169,60,.12);border:1px solid rgba(240,169,60,.4);border-radius:7px;padding:2px 8px}
.live-badge.prev{color:#f0a93c}
.live-badge.prev .dot{background:#f0a93c;box-shadow:0 0 8px #f0a93c}
.sim-note{font-size:10px;color:var(--t3);text-align:center;margin-top:11px;font-weight:600}
.scan{position:absolute;top:0;left:-40%;width:40%;height:2px;background:linear-gradient(90deg,transparent,rgba(51,233,145,.8),transparent);animation:scan 3.2s linear infinite;pointer-events:none}
.featpop{animation:fpop .5s ease}
.newp{font-size:8.5px;font-weight:900;letter-spacing:.1em;color:#04130d;background:var(--green);border-radius:6px;padding:2px 6px;margin-left:6px;display:inline-block;opacity:0;animation:newpop 1.7s ease}
.ebarwrap{height:5px;border-radius:4px;background:rgba(255,255,255,.06);margin-top:11px;overflow:hidden}
.ebarwrap i{display:block;height:100%;background:linear-gradient(90deg,var(--teal),var(--green));border-radius:4px;transition:width .7s cubic-bezier(.3,1.2,.5,1);box-shadow:0 0 10px rgba(51,233,145,.5)}
.simrl{display:flex;align-items:center;justify-content:space-between}
.simrl .liv{color:var(--green);display:inline-flex;align-items:center;gap:5px;letter-spacing:.1em}
.simrl .liv i{width:5px;height:5px;border-radius:50%;background:var(--green);animation:pulse 1.4s infinite}
.erow.gu{border-left-color:var(--green);background:rgba(51,233,145,.06)}
.erow.gd{border-left-color:var(--rsoft);background:rgba(255,90,90,.06)}
.simfoot{display:flex;align-items:center;justify-content:center;gap:7px;font-size:10px;color:var(--t3);font-weight:600;margin-top:11px}
.scn{display:inline-flex;gap:3px}
.scn i{width:4px;height:4px;border-radius:50%;background:#2a6b52;animation:blink 1.1s infinite}
.scn i:nth-child(2){animation-delay:.18s}.scn i:nth-child(3){animation-delay:.36s}.scn i:nth-child(4){animation-delay:.54s}
@keyframes scan{0%{left:-40%}100%{left:110%}}
@keyframes fpop{0%{transform:scale(.985);box-shadow:0 0 0 0 rgba(51,233,145,.4)}40%{box-shadow:0 0 0 6px rgba(51,233,145,0)}100%{transform:scale(1)}}
@keyframes newpop{0%{opacity:0;transform:translateY(-3px) scale(.9)}15%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0}}
@keyframes blink{0%,100%{background:#2a6b52}50%{background:var(--green)}}
.feat-body{display:flex;align-items:flex-end;justify-content:space-between;gap:10px}
.feat-pick{font-family:'Barlow Condensed';font-weight:800;font-size:30px;line-height:.9;color:#fff}
.feat-mu{font-size:11px;color:var(--t2);font-weight:600;margin-top:3px}
.feat-edge{font-family:'Barlow Condensed';font-weight:800;font-size:30px;color:var(--green);line-height:.9;text-align:right}
.feat-edge .e{font-size:9px;font-style:normal;color:#8fd9c2;font-weight:800;display:block;letter-spacing:.08em}
.spark{width:100%;height:34px;margin-top:9px;display:block}
.rowlab{font-size:9.5px;letter-spacing:.1em;font-weight:800;color:var(--t3);margin:4px 2px 8px;text-transform:uppercase}
.eb-scroll{position:relative}
.eb-scroll.on{max-height:228px;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,transparent,#000 11%,#000 89%,transparent);mask-image:linear-gradient(180deg,transparent,#000 11%,#000 89%,transparent)}
.eb-scroll.on .eb-track{animation:ebscroll 15s linear infinite}
.eb-scroll.on:hover .eb-track{animation-play-state:paused}
@keyframes ebscroll{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}
.erow{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:11px;background:rgba(255,255,255,.012);margin-bottom:7px;border-left:2px solid transparent;transition:border-color .5s,background .5s}
.erow:hover{background:rgba(155,123,255,.05)}
.tcol{width:30px;height:30px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  font-family:'Barlow Condensed';font-weight:800;font-size:11px;color:#fff}
.tl{width:34px;height:34px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);position:relative;overflow:hidden}
.tl img{width:26px;height:26px;object-fit:contain}
.tlf{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:800;font-size:11px;color:#fff}
.ename{flex:1;min-width:0}
.ename .t{font-weight:800;font-size:13px;color:var(--t1)}
.ename .m{font-size:10px;color:var(--t3);font-weight:600;margin-top:1px}
.eodds{font-family:'Barlow Condensed';font-weight:700;font-size:14px;color:var(--t2);min-width:42px;text-align:right;border-radius:6px;padding:2px 6px;transition:background .5s}
.eedge{font-family:'Barlow Condensed';font-weight:800;font-size:18px;min-width:54px;text-align:right}
.eedge.pos{color:var(--green)} .eedge.neg{color:var(--rsoft)}
.flash-up{background:rgba(51,233,145,.16)!important;color:var(--green)!important}
.flash-dn{background:rgba(255,90,90,.16)!important;color:var(--rsoft)!important}
.gate{margin-top:11px;border:1px dashed var(--line2);border-radius:12px;padding:13px;text-align:center;background:rgba(155,123,255,.04)}
.gate .h{font-size:12.5px;font-weight:800;color:var(--plight)}
.gate .s{font-size:10.5px;color:var(--t3);margin-top:3px}
.gate .blur{filter:blur(5px);opacity:.6;pointer-events:none;margin-top:9px;display:flex;flex-direction:column;gap:6px}
.gate .blur .r{display:flex;justify-content:space-between;font-size:12px}
.sec{padding:30px 0}
.kick{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px;display:flex;gap:6px}
.kick.teal{color:var(--teal)} .kick.purple{color:var(--plight)} .kick.red{color:var(--rsoft)}
h2{font-size:clamp(22px,4.4vw,32px);font-weight:800;letter-spacing:-.01em;margin-bottom:10px;color:#fff}
.sec p{font-size:14px;color:var(--t2);line-height:1.75;max-width:600px;margin-bottom:14px}
.sec p strong{color:var(--t1)}
.shop{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;max-width:430px}
.shop .h{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:10px}
.shop .b{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid #14141f}
.shop .b:first-of-type{border-top:none}
.shop .bk{font-size:13px;color:var(--t2)} .shop .bk.best{color:#fff;font-weight:700}
.shop .pr{font-family:'Barlow Condensed';font-weight:700;font-size:15px;color:var(--t2)}
.shop .pr.best{color:var(--green);background:rgba(29,158,117,.12);border-radius:5px;padding:1px 9px}
.finalcta{text-align:center;padding:56px 0 26px}
.finalcta h2{margin-bottom:10px}
.finalcta .sm{font-family:'Barlow Condensed';font-weight:800;font-size:20px;color:var(--teal);margin-top:16px;letter-spacing:-.01em}
footer{padding:24px 0;text-align:center;color:var(--t3);font-size:12px}
.marquee{position:sticky;top:60px;z-index:40;overflow:hidden;background:#090912;border-bottom:1px solid #12121e;white-space:nowrap}
.mq-track{display:inline-flex;animation:mqscroll 38s linear infinite;will-change:transform}
.marquee:hover .mq-track{animation-play-state:paused}
.mq-item{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;font-size:12px;font-weight:700;color:#9aa6b2;border-right:1px solid #14141f;flex:0 0 auto}
.mq-item .tm{color:#fff} .mq-item .up{color:#33e991} .mq-item .dn{color:#ff5a5a}
@keyframes mqscroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.spotwrap{padding:22px 0 6px}
.spot{background:linear-gradient(110deg,rgba(155,123,255,.09),rgba(51,233,145,.05));border-radius:16px;padding:16px;overflow:hidden}
.spot-tag{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--plight);margin-bottom:13px;display:flex;align-items:center;gap:7px}
.spot-card{display:flex;align-items:center;gap:14px;transition:opacity .34s ease,transform .34s ease}
.sc-in{opacity:1;transform:translateX(0)} .sc-out{opacity:0;transform:translateX(16px)}
.spot-av{width:80px;height:80px;border-radius:50%;flex:0 0 auto;overflow:hidden;position:relative;display:flex;align-items:flex-end;justify-content:center;font-family:'Barlow Condensed';font-weight:800;font-size:24px;color:#fff;background:radial-gradient(circle at 50% 30%,#222c3a,#0c1018 80%)}
.spot-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;transform:scale(1.15)}
.spot-info{flex:1;min-width:0}
.spot-sport{font-size:9px;font-weight:800;letter-spacing:.08em;color:#5f6b7a;margin-bottom:3px}
.spot-nm{font-size:19px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spot-mu{font-size:11px;color:var(--t3);font-weight:600;margin-top:2px}
.spot-sub{font-size:10px;font-weight:700;margin-top:7px;border-radius:7px;padding:3px 9px;display:inline-block}
.spot-bet{text-align:right;flex:0 0 auto}
.spot-prop{font-size:11px;color:var(--t2);font-weight:700;white-space:nowrap}
.spot-odds{font-family:'Barlow Condensed';font-weight:800;font-size:30px;color:var(--green);line-height:.95}
.spot-dots{display:flex;gap:5px;justify-content:center;margin-top:14px}
.spot-dots i{width:5px;height:5px;border-radius:50%;background:#2a2a3d;transition:.25s}
.spot-dots i.on{width:16px;border-radius:3px;background:var(--plight)}
.spot-note{font-size:10px;color:var(--t3);text-align:center;margin-top:9px;font-weight:600}
.feat2grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:860px){.feat2grid{grid-template-columns:1fr 1fr;align-items:start}}
.lscard{position:relative;background:linear-gradient(165deg,rgba(51,233,145,.10),rgba(8,10,16,.6));border-radius:18px;padding:16px;overflow:hidden;box-shadow:0 20px 50px -30px rgba(51,233,145,.4)}
.lscard::before{content:"";position:absolute;top:-40px;right:-40px;width:140px;height:140px;background:radial-gradient(circle,rgba(51,233,145,.16),transparent 70%);pointer-events:none}
.lsh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.lstitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#fff}
.lslive{display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--green);background:rgba(51,233,145,.1);border:1px solid rgba(51,233,145,.3);border-radius:20px;padding:3px 9px}
.lslive i{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 1.4s infinite}
.lsrow{display:flex;align-items:center;gap:10px;padding:10px 8px;border-radius:11px;background:rgba(255,255,255,.02);margin-bottom:7px}
.lsrow:last-of-type{margin-bottom:0}
.lssp{font-size:15px;flex:0 0 auto;width:20px;text-align:center}
.lsgm{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
.lstm{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
.lstm.r{justify-content:flex-end}
.lsab{font-weight:800;font-size:12px;color:#cdd6df}
.lsdot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.lsscr{font-family:'Barlow Condensed';font-weight:800;font-size:21px;color:#fff;min-width:20px;text-align:center;border-radius:5px;padding:0 4px;transition:background .5s,color .5s}
.lsscr.hit{background:rgba(51,233,145,.22);color:var(--green)}
.lsvs{color:#3a4452;font-size:10px;font-weight:700}
.lsst{flex:0 0 auto;font-size:9.5px;font-weight:800;color:var(--green);text-align:right;width:46px}
.lscap{font-size:11px;color:#7d8b96;margin-top:10px;font-weight:600}
.qscard{position:relative;background:linear-gradient(165deg,rgba(155,123,255,.12),rgba(240,169,60,.05),rgba(8,10,16,.6));border-radius:18px;padding:16px;overflow:hidden;box-shadow:0 20px 50px -30px rgba(155,123,255,.5)}
.qsh{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
.qstitle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#fff}
.qstag{font-size:9px;font-weight:800;letter-spacing:.1em;color:var(--plight);background:rgba(155,123,255,.12);border:1px solid rgba(155,123,255,.3);border-radius:20px;padding:3px 9px;transition:.3s}
.qstag.par{color:#f0a93c;background:rgba(240,169,60,.13);border-color:rgba(240,169,60,.35)}
.qsreels{display:flex;gap:8px;background:linear-gradient(180deg,#0a0a14,#06060c);border:1px solid rgba(240,169,60,.22);border-radius:13px;padding:11px;box-shadow:inset 0 2px 14px rgba(0,0,0,.6)}
.qsreel{flex:1;height:54px;border-radius:9px;background:linear-gradient(180deg,#13131f,#0c0c16);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;border:1px solid #1d1d2c}
.qsreel::before,.qsreel::after{content:"";position:absolute;left:0;right:0;height:14px;z-index:2;pointer-events:none}
.qsreel::before{top:0;background:linear-gradient(#0c0c16,transparent)}
.qsreel::after{bottom:0;background:linear-gradient(transparent,#0c0c16)}
.qsrv{font-family:'Barlow Condensed';font-weight:800;font-size:21px;color:#fff;line-height:1}
.qsrv.emoji{font-family:'Inter';font-size:22px}
.qsreel.spin .qsrv{filter:blur(1.2px);opacity:.85;animation:rspin .09s linear infinite}
.qsreel.land{box-shadow:0 0 0 1.5px rgba(51,233,145,.5),0 0 16px rgba(51,233,145,.25);border-color:rgba(51,233,145,.5)}
.qsres{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;min-height:30px}
.qspill{font-size:13px;font-weight:800;color:#04130d;background:linear-gradient(90deg,#33e991,#1fd6a0);border-radius:9px;padding:6px 14px;opacity:0;transform:scale(.9);white-space:nowrap}
.qspill.show{animation:respop .5s ease forwards}
.qspill.par{background:linear-gradient(90deg,#f0a93c,#ffce6b);color:#1a1206}
.qsbtn{display:block;width:100%;margin-top:12px;text-align:center;background:linear-gradient(90deg,#9b7bff,#7d5cff);color:#fff;font-weight:800;font-size:14px;padding:12px;border-radius:11px;box-shadow:0 8px 22px -8px rgba(155,123,255,.7);position:relative;overflow:hidden}
.qssh{position:absolute;top:0;left:-60%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);animation:shine 2.6s linear infinite}
.qscap{font-size:11px;color:var(--t3);text-align:center;margin-top:11px;font-weight:600}
.qscap b{color:var(--t2)}
.qsh{margin-bottom:6px!important}
.qshook{font-size:13px;color:#cdd6df;font-weight:600;line-height:1.5;margin-bottom:13px}
.qsdisc{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:9px 11px;background:rgba(255,255,255,.025);border-radius:10px;font-size:10.5px;color:#8a98a4;line-height:1.5;font-weight:500}
.qsdisc b{color:#cdd6df;font-weight:700}
.wpcard{position:relative;background:linear-gradient(165deg,rgba(29,158,117,.16),rgba(51,233,145,.05),rgba(8,10,16,.6));border-radius:18px;padding:16px;overflow:hidden;box-shadow:0 20px 50px -30px rgba(29,158,117,.5)}
.wpcard::before{content:"";position:absolute;top:-40px;left:-30px;width:150px;height:150px;background:radial-gradient(circle,rgba(51,233,145,.14),transparent 70%);pointer-events:none}
.wph{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.wpt{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#fff}
.wpbadge{position:relative;font-size:9px;font-weight:800;letter-spacing:.1em;color:#04130d;background:linear-gradient(90deg,#33e991,#1fd6a0);border-radius:20px;padding:3px 10px;overflow:hidden}
.wpsh{position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);animation:shine 2.8s linear infinite}
.wpsub{font-size:13px;color:#cdd6df;font-weight:600;line-height:1.5;margin-bottom:14px}
.wpplay{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.025);margin-bottom:8px;border:1px solid rgba(51,233,145,.12)}
.wpplay:last-of-type{margin-bottom:0}
.wpck{width:24px;height:24px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:rgba(51,233,145,.15);border:1px solid rgba(51,233,145,.4);color:var(--green);font-size:13px;font-weight:900}
.wppi{flex:1;min-width:0}
.wppn{font-weight:800;font-size:14px;color:#fff}
.wppm{font-size:10.5px;color:#7d8b96;font-weight:600;margin-top:1px}
.wpconv{font-size:9px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:7px;flex:0 0 auto}
.wpconv.hi{color:var(--green);background:rgba(51,233,145,.12);border:1px solid rgba(51,233,145,.3)}
.wpconv.md{color:#f0a93c;background:rgba(240,169,60,.12);border:1px solid rgba(240,169,60,.3)}
.wpod{font-family:'Barlow Condensed';font-weight:800;font-size:17px;color:#cdd6df;flex:0 0 auto;min-width:42px;text-align:right}
.wptrack{display:flex;align-items:flex-start;gap:10px;margin-top:13px;padding:12px;border-radius:12px;background:rgba(51,233,145,.06);border:1px solid rgba(51,233,145,.18)}
.wptrack:hover{background:rgba(51,233,145,.1)}
.wpic{font-size:16px;margin-top:1px}
.wptx{flex:1;font-size:12px;color:#cdd6df;font-weight:600;line-height:1.55}
.wptx b{color:#fff;font-weight:800}
.wpgo{font-size:11px;color:var(--green);font-weight:800;white-space:nowrap;margin-top:1px}
.wpnote{font-size:10px;color:var(--t3);text-align:center;margin-top:11px;font-weight:600}
@keyframes rspin{0%{transform:translateY(-2px)}50%{transform:translateY(2px)}100%{transform:translateY(-2px)}}
@keyframes respop{0%{opacity:0;transform:scale(.9)}60%{opacity:1;transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
@keyframes shine{0%{left:-60%}100%{left:160%}}
.yard{display:grid;grid-template-columns:1fr;gap:11px}
@media(min-width:680px){.yard{grid-template-columns:repeat(3,1fr)}}
.yc{position:relative;background:linear-gradient(180deg,rgba(240,169,60,.06),rgba(10,10,20,.4));border:1px solid rgba(240,169,60,.28);border-radius:15px;padding:15px 13px;text-align:center;overflow:hidden}
.yc::before{content:"";position:absolute;top:-30px;right:-30px;width:90px;height:90px;background:radial-gradient(circle,rgba(240,169,60,.18),transparent 70%);pointer-events:none}
.yc .rank{position:absolute;top:10px;left:12px;font-family:'Barlow Condensed';font-weight:800;font-size:14px;color:#f0a93c}
.yc .fire{position:absolute;top:9px;right:11px;font-size:14px;animation:flick 1.4s infinite}
.yav{width:74px;height:74px;border-radius:50%;margin:6px auto 0;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed';font-weight:800;font-size:25px;color:#fff;background:radial-gradient(circle at 50% 28%,#3a2f12,#0c1018 80%);box-shadow:0 0 0 2.5px #f0a93c}
.yav img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;transform:scale(1.18);transform-origin:center 10%}
.yc .ynm{font-weight:800;font-size:14.5px;color:#fff;margin-top:9px}
.yc .ymu{font-size:10.5px;color:var(--t3);font-weight:600;margin-top:2px}
.yc .yodds{font-family:'Barlow Condensed';font-weight:800;font-size:27px;color:#f0a93c;margin-top:8px;line-height:.9}
.yc .yodds .l{display:block;font-size:9px;color:var(--t3);letter-spacing:.08em;font-weight:800;margin-top:2px}
.ybar{height:6px;border-radius:4px;background:rgba(255,255,255,.07);margin-top:11px;overflow:hidden}
.ybar i{display:block;height:100%;background:linear-gradient(90deg,#f0a93c,#ff7a3c);border-radius:4px}
.yc .ypct{font-size:9.5px;color:var(--t2);font-weight:700;margin-top:6px}
.fade{animation:fadeUp .6s ease both} .fade2{animation:fadeUp .6s .12s ease both}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(51,233,145,.55)}70%{box-shadow:0 0 0 7px rgba(51,233,145,0)}100%{box-shadow:0 0 0 0 rgba(51,233,145,0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes flick{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.88)}}
`;
