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

      {mqLoop.length>0 &&
      <div className="marquee" aria-hidden="true"><div className="mq-track">
        {mqLoop.map((m,i)=>(
          <span className="mq-item" key={i}>{m.i} <span className="tm">{m.t}</span> <span className={m.up?"up":"dn"}>{m.v}</span></span>
        ))}
      </div></div>}

      <div className="wrap">
        <section className="hero">
          {/* LEFT: pitch */}
          <div className="fade">
            <div className="ebadge">
              <span className="ebar"/>
              <span>
                <span className="eb-k">MORE THAN PICKS</span>
                <span className="eb-s">The model, the edge, and a guide to bet smarter.</span>
              </span>
            </div>
            <h1>Bet smarter,<br/>not <span style={{color:"#ef4444"}}>harder.</span></h1>
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

          {/* RIGHT: live signature panel */}
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
              <div>
                {tickerRows.map((r,i)=>{ const k=r.gameId+r.side; const fl=flash[k];
                  return (
                  <div className="erow" key={k}>
                    <TeamLogo ab={r.teamAbbr||shortTeam(r.matchup)} col={teamCol(r.teamAbbr||shortTeam(r.matchup))}/>
                    <div className="ename"><div className="t">{edgeLabel(r)}</div><div className="m">{muFor(r)}</div></div>
                    <div className={"eodds"+(fl==="up"?" flash-up":fl==="dn"?" flash-dn":"")}>{fmtOdds(r.odds)}</div>
                    <div className={"eedge "+((r.edge??0)>=0?"pos":"neg")}>{pct1(r.edge)}</div>
                  </div>);
                })}
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
        </section>
      </div>

      {/* PROP SPOTLIGHT (rotates through real props) */}
      {spot &&
      <div className="wrap spotwrap">
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
        {/* line shopping */}
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

        {/* pitch */}
        <section className="sec">
          <div className="kick purple">Why WizePicks</div>
          <h2>Don't bet blind.</h2>
          <p>Everyone wants winners. Smart bettors want winners <strong>at the best price</strong> — because price matters too. We break down the full market, show the reasoning behind every number, and put every book side by side so you take the best one.</p>
          <p>What you're getting isn't a "🔥 LOCK OF THE DAY" with no explanation. It's the data, the matchup, and the market — so you decide with information instead of hope.</p>
        </section>

        <section className="finalcta">
          <div className="kick red" style={{justifyContent:"center"}}>Ready when you are</div>
          <h2>Your edge on every game.</h2>
          <p style={{margin:"0 auto"}}>Free to start. No card. Cancel anytime.</p>
          <div className="cta-row" style={{justifyContent:"center",marginTop:20}}>
            <Link className="btn btn-hero" to="/signup">Start free →</Link>
          </div>
          <div className="sm">Bet smarter. Bet Wize.</div>
        </section>
      </div>

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
@media(min-width:860px){.hero{grid-template-columns:1.02fr .98fr;gap:40px;padding:64px 0 50px;align-items:center}}
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
