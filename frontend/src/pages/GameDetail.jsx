import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, scoresApi } from "../lib/api";

const TEAMCOL = {
  ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#27251F",CHW:"#27251F",
  CIN:"#C6011F",CLE:"#00385D",COL:"#33006F",DET:"#0C2340",HOU:"#EB6E1F",KC:"#004687",LAA:"#BA0021",
  LAD:"#005A9C",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#002B5C",NYM:"#FF5910",NYY:"#0C2340",OAK:"#003831",
  ATH:"#003831",PHI:"#E81828",PIT:"#FDB827",SD:"#2F241D",SF:"#FD5A1E",SEA:"#0C2C56",STL:"#C41E3A",
  TB:"#092C5C",TEX:"#003278",TOR:"#134A8E",WSH:"#AB0003",WAS:"#AB0003"
};
const SLUGM = { CWS:"chw", CHW:"chw", ATH:"oak" };
const colFor = (ab) => TEAMCOL[(ab||"").toUpperCase()] || "#2674b0";
const nick = (s) => String(s||"").trim().split(/\s+/).pop().toLowerCase();
const fmtOdds = (o) => o==null||o===""||isNaN(+o) ? "—" : (+o>0 ? "+"+(+o) : ""+(+o));
const shortTeam = (s) => (s||"").trim().split(/\s+/).slice(-1)[0].slice(0,3).toUpperCase();
const fmtTime = (t) => { if(!t) return ""; if(typeof t==="string"){ if(/invalid/i.test(t)) return ""; if(!/^\d{4}-\d{2}-\d{2}T/.test(t)) return t; }
  const d=new Date(t); if(isNaN(d.getTime())) return ""; return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}).replace(" ","")+" ET"; };
const implied = (o) => { if(o==null||isNaN(+o)) return null; o=+o; return o>0 ? 100/(o+100) : (-o)/(-o+100); };
const pct = (x) => x==null ? null : Math.round(x*100);

export default function GameDetailPage() {
  const { gameId } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [allEdges, setAllEdges] = useState(null);
  const [scoresGame, setScoresGame] = useState(null);
  const [detail, setDetail] = useState(null);     // getGameDetail: series / umpire / line score
  const [bvpData, setBvpData] = useState(null);    // getGameDetail: batter-vs-pitcher
  const [marketRead, setMarketRead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);

  useEffect(() => {
    let cancelled = false; setLoading(true);
    (async () => {
      const [edges, scores, mr] = await Promise.all([
        edgesApi.getMLB().catch(()=>null),
        scoresApi.getScores("mlb").catch(()=>null),
        edgesApi.getMarketRead ? edgesApi.getMarketRead("mlb").catch(()=>null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setAllEdges(edges); setMarketRead(mr);
      const all = scores ? [...(scores.live||[]),...(scores.upcoming||[]),...(scores.final||[])] : [];
      // The URL gameId is the EDGES id (Odds-API-derived); the scores feed carries ESPN ids,
      // so a direct id match never lands. Resolve the edges game first, then bridge to the
      // scores game by team-nickname matchup (ids differ across feeds, the matchup is stable).
      const eg = edges?.games?.find(g => String(g.id)===String(gameId)) || null;
      const egKey = eg ? `${nick(eg.away)}|${nick(eg.home)}` : null;
      const sg = all.find(g =>
        String(g.detailId)===String(gameId) ||
        String(g.id)===String(gameId) ||
        (egKey && `${nick(g.away?.name)}|${nick(g.home?.name)}` === egKey)
      ) || null;
      setScoresGame(sg);
      const sid = sg?.id || sg?.detailId;
      if (sid && scoresApi.getGameDetail) {
        scoresApi.getGameDetail("mlb", sid).then(d => { if(!cancelled){ setDetail(d); setBvpData(d); } }).catch(()=>{});
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  let game = allEdges?.games?.find(g => String(g.id)===String(gameId));
  if (!game && scoresGame && allEdges?.games) {
    const key = `${nick(scoresGame.away?.name)}|${nick(scoresGame.home?.name)}`;
    game = allEdges.games.find(g => `${nick(g.away)}|${nick(g.home)}` === key);
  }

  const aAb = game?.awayAbbr || shortTeam(scoresGame?.away?.name || game?.away || "");
  const hAb = game?.homeAbbr || shortTeam(scoresGame?.home?.name || game?.home || "");
  const st = (game?.status==="live"||scoresGame?.status==="live") ? "live"
           : (game?.status==="final"||scoresGame?.status==="final") ? "final" : "pre";

  // edges for this game
  const gEdges = (allEdges?.edges || []).filter(e => e.gameId === game?.id);
  const pickByMarket = (kinds) => gEdges.find(e => kinds.some(k => String(e.market||"").toLowerCase().includes(k)));
  const mlPick = pickByMarket(["moneyline","ml"]);
  const totPick = pickByMarket(["total"]);
  const bestEdge = [...gEdges].sort((a,b)=>(b.edge||0)-(a.edge||0))[0] || null;

  const mr = (Array.isArray(marketRead) ? marketRead : marketRead?.games || [])
    .find(x => x.gameId === game?.id);

  const title = (aAb && hAb) ? `${aAb} @ ${hAb}` : "Matchup";
  const venue = game?.venue || scoresGame?.venue || "";
  const sub = st==="pre" ? [fmtTime(game?.time||scoresGame?.time), venue].filter(Boolean).join(" · ")
            : st==="live" ? ["Live", venue].filter(Boolean).join(" · ")
            : ["Final", venue].filter(Boolean).join(" · ");

  return (
    <div className="app"><style>{CSS}</style>
      <div className="shead">
        <div className="x" onClick={()=>navigate(-1)}>{"\u2039"}</div>
        <div><div className="t">{title}</div><div className="ts">{sub}</div></div>
      </div>
      <div className="sbody">
        {loading && <div className="estate"><div className="et">Loading matchup…</div></div>}
        {!loading && !game && <div className="estate"><div className="et">Game not found</div><div className="es">It may have rolled off today's slate.</div></div>}
        {!loading && game && st==="pre"   && <SheetPre   game={game} aAb={aAb} hAb={hAb} gEdges={gEdges} mlPick={mlPick} totPick={totPick} bestEdge={bestEdge} mr={mr} detail={detail} bvpData={bvpData} hasFull={hasFull} navigate={navigate}/>}
        {!loading && game && st==="live"  && <SheetLive  game={game} scoresGame={scoresGame} aAb={aAb} hAb={hAb} gEdges={gEdges} detail={detail}/>}
        {!loading && game && st==="final" && <SheetFinal game={game} scoresGame={scoresGame} aAb={aAb} hAb={hAb} bestEdge={bestEdge} detail={detail} venue={venue}/>}
      </div>
      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a className="on" onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate(hasFull?"/props":"/pricing")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
  );
}

function LogoB({ ab, col }) { const [bad,setBad]=useState(false); const slug=(SLUGM[(ab||"").toUpperCase()]||ab||"").toLowerCase();
  return <span className="lgb" style={{background:`radial-gradient(circle at 50% 32%, ${col}aa,#0c1018 82%)`}}>{(bad||!ab)?String(ab||"?").slice(0,3):<img src={`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`} alt="" onError={()=>setBad(true)}/>}</span>; }
function LogoP({ ab, col }) { const [bad,setBad]=useState(false); const slug=(SLUGM[(ab||"").toUpperCase()]||ab||"").toLowerCase();
  return <span className="pl" style={{background:`radial-gradient(circle at 50% 32%, ${col}99,#0c1018 82%)`}}>{(bad||!ab)?String(ab||"?").slice(0,2):<img src={`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`} alt="" onError={()=>setBad(true)}/>}</span>; }

const Agree = ({ ok }) => ok==null ? null : <span className={"ma "+(ok?"ag":"df")}>{ok?"\u2713 agrees":"\u2260 differs"}</span>;
const Block = ({ label, bx, children, style }) => (
  <div className="dblk" style={style}><div className="bl">{label}{bx && <span className="bx">{bx}</span>}</div>{children}</div>
);
// Home-plate umpire tendencies (from detail.umpire). Shown on every game state, not
// just pre-game. Renders nothing until the crew is posted (a few hours pre-first-pitch).
const UmpBlock = ({ detail }) => {
  const ump = detail?.umpire || null;
  if (!ump) return null;
  return (
    <Block label="HOME PLATE UMPIRE" bx="season tendencies">
      <div className="umphd">{ump.name||"TBD"} {ump.favor && <span className="umpf">leans {ump.favor}</span>}</div>
      <div className="umpgrid">
        <div className="ug"><div className="k">RUNS vs AVG</div><div className={"v "+(String(ump.runs||"").startsWith("-")?"dn":"up")}>{ump.runs ?? "—"}</div></div>
        <div className="ug"><div className="k">K RATE</div><div className="v">{ump.k ?? "—"}</div></div>
        <div className="ug"><div className="k">BB RATE</div><div className="v">{ump.bb ?? "—"}</div></div>
      </div>
    </Block>
  );
};
function TeamHead({ aAb, hAb, aCol, hCol, aRec, hRec }) {
  return <div className="dblk"><div className="mst">
    <div className="tm"><LogoB ab={aAb} col={aCol}/><div className="ab">{aAb}</div><div className="rc">{aRec||""}</div></div>
    <div className="at">@</div>
    <div className="tm"><LogoB ab={hAb} col={hCol}/><div className="ab">{hAb}</div><div className="rc">{hRec||""}</div></div>
  </div></div>;
}

function SheetPre({ game, aAb, hAb, gEdges, mlPick, totPick, bestEdge, mr, detail, bvpData, hasFull, navigate }) {
  const aCol=colFor(aAb), hCol=colFor(hAb);
  const ml = game.moneyline || {};
  const wlA = pct(ml.awayWinProb), wlH = pct(ml.homeWinProb);
  const t = game.totals || {};
  const projA = t.awayProjected ?? t.projectedAway ?? game.awayProjected ?? null;
  const projH = t.homeProjected ?? t.projectedHome ?? game.homeProjected ?? null;
  const projTot = (projA!=null && projH!=null) ? (parseFloat(projA)+parseFloat(projH)).toFixed(1) : (t.projected ?? null);
  const ou = t.line ?? t.projected ?? "—";
  const rl = game.runLine || {};
  const edgeStr = bestEdge ? ((bestEdge.edge>=0?"+":"")+(bestEdge.edge*100).toFixed(1)+"%") : "—";
  const pa = game.pitchers?.away || {}, ph = game.pitchers?.home || {};
  const lineups = game.lineups || {};
  const luA = lineups.away || [], luH = lineups.home || [];
  const series = detail?.series || {};
  const formA = series.away || series.awayForm || null;
  const formH = series.home || series.homeForm || null;
  const ump = detail?.umpire || null;
  const bvpA = bvpData?.awayBattersVsHomePitcher || [];
  const bvpH = bvpData?.homeBattersVsAwayPitcher || [];
  const bvp = [...(bvpA||[]), ...(bvpH||[])].slice(0,4);
  const wx = game.weather ? (game.weather.indoor ? "Dome · roof closed"
      : [game.weather.tempF!=null?Math.round(game.weather.tempF)+"°F":null, game.weather.windMph?game.weather.windMph+" mph":null].filter(Boolean).join(" · ")) : "";
  const parkTxt = game.parkRunFactor!=null ? ((game.parkRunFactor>1?"+":"")+Math.round((game.parkRunFactor-1)*100)+"% runs") : "—";

  const reads = [];
  if (mr?.win) { const w=mr.win; reads.push({ k:"WIN", lean:w.favTeam, odds:fmtOdds(w.consensus ?? w.bestPrice), prob:(w.favProb ?? w.model?.prob ?? null), mv:(w.move?{toward:w.move.towardFav,cents:w.move.cents,team:w.favTeam}:null), agrees:w.model?.agrees }); }
  if (mr?.cover?.favTeam) { const c=mr.cover; reads.push({ k:"COVER", lean:c.favTeam, odds:fmtOdds(c.bestPrice ?? c.odds), prob:(c.favProb ?? c.model?.prob ?? null), mv:null, agrees:(c.model?.agrees ?? c.agrees) }); }
  if (mr?.total && (mr.total.lean||mr.total.side)) { const tt=mr.total; reads.push({ k:"TOTAL", lean:String(tt.lean||tt.side).toUpperCase()+(tt.line!=null?" "+tt.line:""), odds:fmtOdds(tt.bestOver ?? tt.odds), prob:(tt.favProb ?? tt.model?.prob ?? null), mv:null, agrees:(tt.model?.agrees ?? tt.agrees) }); }

  return (<>
    <TeamHead aAb={aAb} hAb={hAb} aCol={aCol} hCol={hCol} aRec={game.awayRecord} hRec={game.homeRecord}/>

    <Block label="MODEL PROJECTION" bx="win prob">
      {(wlA!=null && wlH!=null) ? <div className="wpwrap"><div className="wprow"><div className="s aw" style={{width:wlA+"%"}}>{aAb} {wlA}%</div><div className="s hm" style={{width:wlH+"%"}}>{hAb} {wlH}%</div></div></div>
        : <div className="estate" style={{padding:14}}><div className="es">Win probability posts with the model line.</div></div>}
      <div className="proj">
        <div className="p"><div className="k">PROJ {aAb}</div><div className="v">{projA ?? "—"}</div></div>
        <div className="p"><div className="k">PROJ {hAb}</div><div className="v">{projH ?? "—"}</div></div>
        <div className="p"><div className="k">PROJ TOTAL</div><div className="v g">{projTot ?? "—"}</div></div>
        <div className="p"><div className="k">O/U</div><div className="v">{ou}</div></div>
      </div>
    </Block>

    <Block label="ODDS & EDGES" bx="best line">
      <div className="orow"><div className="ol">Moneyline</div><div className="os">{aAb} <b>{fmtOdds(ml.away)}</b> · {hAb} <b>{fmtOdds(ml.home)}</b></div><div className="oe pos">{edgeStr}</div></div>
      {(rl.awayOdds!=null||rl.homeOdds!=null) && <div className="orow"><div className="ol">Run Line</div><div className="os">{aAb} <b>{fmtOdds(rl.awayOdds)}</b> · {hAb} <b>{fmtOdds(rl.homeOdds)}</b></div><div className="oe pos">{rl.line!=null?(rl.line>0?"+":"")+rl.line:""}</div></div>}
      {(t.overOdds!=null||t.underOdds!=null||t.line!=null) && <div className="orow"><div className="ol">Total</div><div className="os">O <b>{fmtOdds(t.overOdds)}</b> · U <b>{fmtOdds(t.underOdds)}</b></div><div className="oe pos">{totPick?((totPick.edge>=0?"+":"")+(totPick.edge*100).toFixed(1)+"%"):""}</div></div>}
    </Block>

    <Block label="PROBABLE STARTERS">
      <PitcherCard ab={aAb} col={aCol} p={pa}/>
      <PitcherCard ab={hAb} col={hCol} p={ph}/>
    </Block>

    {(luA.length>0 || luH.length>0) ? <Lineups aAb={aAb} hAb={hAb} aCol={aCol} hCol={hCol} luA={luA} luH={luH}/> :
      <Block label="LINEUPS" bx="confirms ~90 min before first pitch"><div className="estate" style={{padding:14}}><div className="es">Lineups not posted yet.</div></div></Block>}

    {bvp.length>0 && <Block label="BATTER vs PITCHER" bx="career">
      {bvp.map((b,i)=><div key={i} className="bvp"><div><div className="bn">{b.batter||b.name||b[0]}</div><div className="bvs">{b.vs||b.line||b[2]||""}</div></div><div className="bl"><b>{b.stat||b.slash||b[1]||""}</b></div></div>)}
    </Block>}

    {(formA||formH) && <Block label="TEAM FORM" bx="last 5 · runs/game"><div className="formgrid">
      <FormCol ab={aAb} f={formA}/><FormCol ab={hAb} f={formH}/>
    </div></Block>}

    {ump && <Block label="HOME PLATE UMPIRE" bx="season tendencies">
      <div className="umphd">{ump.name||"TBD"} {ump.favor && <span className="umpf">leans {ump.favor}</span>}</div>
      <div className="umpgrid">
        <div className="ug"><div className="k">RUNS vs AVG</div><div className={"v "+(String(ump.runs||"").startsWith("-")?"dn":"up")}>{ump.runs ?? "—"}</div></div>
        <div className="ug"><div className="k">K RATE</div><div className="v">{ump.k ?? "—"}</div></div>
        <div className="ug"><div className="k">BB RATE</div><div className="v">{ump.bb ?? "—"}</div></div>
      </div>
    </Block>}

    {reads.length>0 && <Block label="MARKET READ" bx="books' collective lean">
      {reads.map((r,i)=><div key={i} className="mr"><span className={"md "+(r.agrees?"strong":"split")}/><span className="mk">{r.k}</span><div className="mv"><div className="mvtop"><b>{r.lean}</b>{r.odds&&r.odds!=="—"?` · ${r.odds}`:""}{r.prob!=null?` · ${r.prob}%`:""}</div>{r.mv&&<div className={"mvmoney "+(r.mv.toward?"toward":"off")}>{r.mv.toward?`money coming in on ${r.mv.team}`:`money drifting off ${r.mv.team}`} · {r.mv.cents}{"\u00a2"} since open</div>}</div><Agree ok={r.agrees}/></div>)}
    </Block>}

    <Block label="CONTEXT"><div className="ctx">
      {venueChip(game.venue||scoresGame_venue(game))}{wx && <span className="ch">{wx}</span>}<span className="ch">Park: <b>{parkTxt}</b></span>
    </div></Block>

    {bestEdge?.reason && <div className="dblk"><div className="why"><span className="wl">WHY THE EDGE</span>{bestEdge.reason}</div></div>}
  </>);
}
const scoresGame_venue = (g) => g?.venue || "";
const venueChip = (v) => v ? <span className="ch">{v}</span> : null;

function PitcherCard({ ab, col, p }) {
  const [imgErr,setImgErr]=useState(false);
  const pid=p?.id||null;
  const s=p?.stats||{};
  const head = (pid && !imgErr)
    ? <span className="pl" style={{background:`radial-gradient(circle at 50% 28%, ${col}, #0c1018 82%)`}}><img src={`https://midfield.mlbstatic.com/v1/people/${pid}/spots/120`} alt="" onError={()=>setImgErr(true)} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"50%"}}/></span>
    : <LogoP ab={ab} col={col}/>;
  const wl = (s.wins!=null||s.losses!=null) ? `${s.wins??0}-${s.losses??0}` : null;
  const num=(x,d)=> x!=null ? (d!=null?Number(x).toFixed(d):x) : "—";
  const tiles=[["ERA",num(s.era,2)],["WHIP",num(s.whip,2)],["K/9",num(s.strikeoutsPer9,1)],["K",num(s.strikeouts)],["H",num(s.hits)],["HR",num(s.homeRuns)]];
  return <div className="pcard">
    <div className="prow">{head}<div className="pmeta"><div className="pn">{p?.name || "TBD"}</div><div className="ph">{p?.hand?`${p.hand}HP · `:""}{ab}{wl?` · ${wl}`:""}{s.inningsPitched!=null?` · ${Number(s.inningsPitched).toFixed(1)} IP`:""}</div></div></div>
    {(p?.name)&&<div className="pgrid">{tiles.map(([k,v],i)=><div key={i} className="pg"><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>}
  </div>;
}
function Lineups({ aAb, hAb, aCol, hCol, luA, luH }) {
  const [open, setOpen] = useState(false);
  const top = [...luA.slice(0,3).map(x=>[aAb,x]), ...luH.slice(0,3).map(x=>[hAb,x])];
  const name = (x) => Array.isArray(x) ? x[1] : (x?.name || x?.player || "");
  const ordOf = (x) => Array.isArray(x) ? x[0] : (x?.order ?? x?.spot ?? "");
  const posOf = (x) => Array.isArray(x) ? x[2] : (x?.pos || x?.position || "");
  const handOf = (x) => Array.isArray(x) ? x[3] : (x?.bats || x?.hand || "");
  return <div className="dblk"><div className="bl">LINEUPS <span className="bx">confirms ~90 min before first pitch</span></div>
    {top.map(([ab,x],i)=><div key={i} className="lurow"><LogoP ab={ab} col={ab===aAb?aCol:hCol}/><span className="ln">{ordOf(x)}. {name(x)}</span><span className="lustat">{posOf(x)}</span></div>)}
    <div className="exbtn" onClick={()=>setOpen(o=>!o)}><span className={"cv"+(open?" open":"")}>{"\u25b8"}</span> View full lineups (1–9)</div>
    {open && <div className="exwrap open">
      <div className="lusub">{aAb}</div>{luA.map((x,i)=><div key={"a"+i} className="lurowf"><span className="o">{ordOf(x)}</span><span className="nm">{name(x)}</span><span className="po">{posOf(x)}</span><span className="hd">{handOf(x)}</span></div>)}
      <div className="lusub">{hAb}</div>{luH.map((x,i)=><div key={"h"+i} className="lurowf"><span className="o">{ordOf(x)}</span><span className="nm">{name(x)}</span><span className="po">{posOf(x)}</span><span className="hd">{handOf(x)}</span></div>)}
    </div>}
  </div>;
}
function FormCol({ ab, f }) {
  const l5 = (f?.l5 || f?.last5 || "").toString();
  return <div className="fcol"><div className="fab">{ab}</div>
    <div className="fdots">{l5.split("").map((c,i)=><i key={i} className={c==="W"?"w":"l"}>{c}</i>)}</div>
    <div className="frr">RF <b>{f?.rf ?? "—"}</b> · RA <b>{f?.ra ?? "—"}</b></div>
  </div>;
}

function LineScore({ ls }) {
  if (!ls || !ls.length) return null;
  const innings = Math.max(...ls.map(r => (r[1]||[]).length), 0);
  return <table className="lsc"><thead><tr><th style={{textAlign:"left"}}>&nbsp;</th>{Array.from({length:innings}).map((_,i)=><th key={i}>{i+1}</th>)}<th>R</th></tr></thead>
    <tbody>{ls.map((r,ri)=><tr key={ri}><td className="tm">{r[0]}</td>{Array.from({length:innings}).map((_,i)=><td key={i}>{r[1]?.[i]!=null?r[1][i]:""}</td>)}<td className="rh">{r[2]}</td></tr>)}</tbody></table>;
}
function SheetLive({ game, scoresGame, aAb, hAb, gEdges, detail }) {
  const aCol=colFor(aAb), hCol=colFor(hAb);
  const ml = game.moneyline || {};
  const wlA = pct(ml.awayWinProb), wlH = pct(ml.homeWinProb);
  const aS = game.awayScore ?? scoresGame?.away?.score ?? 0;
  const hS = game.homeScore ?? scoresGame?.home?.score ?? 0;
  const state = (game.half==="bottom"?"Bot ":"Top ")+(game.inning||"");
  const ls = detail?.lineScore || scoresGame?.lineScore || null;
  return (<>
    <div className="dblk"><div className="mst">
      <div className="tm"><LogoB ab={aAb} col={aCol}/><div className="ab">{aAb}</div></div>
      <div className="bigscore">{aS}</div><div className="at" style={{fontSize:11}}>{state}</div><div className="bigscore">{hS}</div>
      <div className="tm"><LogoB ab={hAb} col={hCol}/><div className="ab">{hAb}</div></div>
    </div></div>
    {(wlA!=null&&wlH!=null) && <Block label="LIVE WIN PROBABILITY"><div className="wprow"><div className="s aw" style={{width:wlA+"%"}}>{aAb} {wlA}%</div><div className="s hm" style={{width:wlH+"%"}}>{hAb} {wlH}%</div></div></Block>}
    {gEdges.length>0 && <Block label="LIVE EDGES" bx="in-game">{gEdges.map((e,i)=><div key={i} className="orow"><div className="ol">{e.teamAbbr||""} {String(e.market||"").toUpperCase()}</div><div className="os">{e.modelProb!=null?Math.round(e.modelProb*100)+"%":""} · <b>{fmtOdds(e.odds)}</b></div><div className="oe pos">{(e.edge>=0?"+":"")+(e.edge*100).toFixed(1)}%</div></div>)}</Block>}
    {ls && <Block label="LINE SCORE"><LineScore ls={ls}/></Block>}
    <UmpBlock detail={detail}/>
  </>);
}
function SheetFinal({ game, scoresGame, aAb, hAb, bestEdge, detail, venue }) {
  const aCol=colFor(aAb), hCol=colFor(hAb);
  const aS = game.awayScore ?? scoresGame?.away?.score ?? 0;
  const hS = game.homeScore ?? scoresGame?.home?.score ?? 0;
  const win = aS>hS ? "a" : "h";
  const ls = detail?.lineScore || scoresGame?.lineScore || null;
  return (<>
    <div className="dblk"><div className="mst">
      <div className="tm"><LogoB ab={aAb} col={aCol}/><div className="ab">{aAb}</div></div>
      <div className={"bigscore "+(win==="a"?"win":"")}>{aS}</div><div className="at">FINAL</div><div className={"bigscore "+(win==="h"?"win":"")}>{hS}</div>
      <div className="tm"><LogoB ab={hAb} col={hCol}/><div className="ab">{hAb}</div></div>
    </div></div>
    {bestEdge?.reason && <div className="dblk" style={{borderColor:"rgba(51,233,145,.3)"}}><div className="bl" style={{color:"var(--green)"}}>MODEL RESULT</div><div className="why">{bestEdge.reason}</div></div>}
    {ls && <Block label="LINE SCORE"><LineScore ls={ls}/></Block>}
    <UmpBlock detail={detail}/>
    {venue && <Block label="CONTEXT"><div className="ctx"><span className="ch">{venue}</span></div></Block>}
  </>);
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#06090b;--panel:#0b1117;--line:#16202a;--line2:#1d2a36;--gold:#f3b94f;--green:#33e991;--neg:#ff5d4d;--red:#ff5d4d;--steel:#2674b0;--blue:#5da9e8;--mut:#7d8a98;--mut2:#4a5663;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--disp);font-weight:800;font-size:21px;letter-spacing:.4px;color:#fff}.logo .w{color:var(--gold)}
.opbadge{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(51,233,145,.32);background:rgba(51,233,145,.08);border-radius:999px;padding:3px 8px}
.sp{flex:1}
.ibtn{width:30px;height:30px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.sports{display:flex;gap:6px;padding:0 0 11px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.sports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sports b.on{color:#fff;border-color:var(--steel);background:#0e1822}
.sports b .dot{width:6px;height:6px;border-radius:50%;background:#2a3640}.sports b.on .dot{background:var(--green)}
.chips{display:flex;gap:7px;padding:11px 14px 4px;overflow-x:auto;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chips b{flex:0 0 auto;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:8px;padding:6px 12px;cursor:pointer}
.chips b.on{color:#06090b;background:var(--gold);border-color:var(--gold);font-weight:700}
.seclbl{font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:1px;color:var(--mut);margin:18px 14px 2px;display:flex;align-items:center;gap:8px}
.seclbl .c{font-family:var(--mono);font-size:10px;font-weight:600;color:var(--mut2);letter-spacing:0}
.seclbl .ld,.gstat .ld{width:7px;height:7px;border-radius:50%;background:var(--red);animation:plr 1.3s infinite}
@keyframes plr{0%,100%{opacity:1}50%{opacity:.35}}
.gc{margin:8px 14px 0;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#0c0c0e,#020203);overflow:hidden;cursor:pointer;transition:border-color .15s}
.gc:active{border-color:var(--steel)}
.gc.live{border-color:rgba(255,93,77,.3)}
.gtop{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid var(--line)}
.gstat{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;font-weight:700}
.gstat.live{color:var(--red)}.gstat.pre{color:var(--gold)}.gstat.final{color:var(--mut)}
.gstat .ld{width:6px;height:6px}
.gtop .ou{font-family:var(--mono);font-size:10px;color:var(--mut)}.gtop .ou b{color:#cdd7e1;font-weight:600}
.team{display:flex;align-items:center;gap:10px;padding:9px 13px}
.team+.team{border-top:1px solid rgba(255,255,255,.04)}
.lg{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0c1018;border:1px solid #000;font-family:var(--disp);font-weight:800;font-size:9px;color:#fff;flex:0 0 auto}.lg img{width:21px;height:21px;object-fit:contain}
.team .nm{font-family:var(--disp);font-weight:800;font-size:18px;color:#eef3f5;line-height:1}
.team .rec{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:2px}
.team .tw{flex:1;min-width:0}
.team .ml{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--mut);flex:0 0 auto}
.team .scr{font-family:var(--disp);font-weight:800;font-size:24px;color:#fff;flex:0 0 auto;font-variant-numeric:tabular-nums;min-width:26px;text-align:right}
.team.win .scr{color:var(--green)}.team.lose .nm,.team.lose .scr{color:var(--mut)}
.probs{padding:8px 13px;border-top:1px solid rgba(255,255,255,.04);display:flex;flex-direction:column;gap:4px}
.prob{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:#aeb9c8}
.prob .h{color:var(--mut2);font-size:9px;width:30px;flex:0 0 auto}.prob .nm2{color:#cdd7e1}.prob .era{margin-left:auto;color:var(--mut)}
.gfoot{display:flex;align-items:center;gap:8px;padding:9px 13px;border-top:1px solid var(--line);background:rgba(243,185,79,.03)}
.lean{font-family:var(--mono);font-size:11px;color:#cdd7e1}.lean .lb{color:var(--gold);font-weight:700;font-family:var(--disp);font-size:11px;letter-spacing:.3px;margin-right:5px}.lean .e{color:var(--green);font-weight:600}
.gfoot .go{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--blue);font-weight:600}
.estate{margin:40px 14px;border:1px dashed var(--line2);border-radius:14px;padding:36px 18px;text-align:center}
.estate .et{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfd7e2}.estate .es{font-size:12px;color:var(--mut);margin-top:6px;font-family:var(--mono)}
#wrap{padding-bottom:96px}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}
.nav a .dbars rect{fill:var(--mut2)}.nav a.on .dbars rect{fill:var(--gold)}
/* detail sheet */
.sheet{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:460px;z-index:200;background:var(--bg);overflow-y:auto;transform:translate(-50%,100%);transition:transform .28s cubic-bezier(.4,0,.2,1);visibility:hidden}
.sheet.open{transform:translate(-50%,0);visibility:visible}
.shead{position:sticky;top:0;background:#080c11;backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px 14px;display:flex;align-items:center;gap:11px;z-index:2}
.shead .x{width:32px;height:32px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:#cdd7e1;font-size:19px;cursor:pointer;flex:0 0 auto}
.shead .t{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;line-height:1}.shead .ts{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:2px}
.sbody{padding:13px 14px 80px}
.dblk{border:1px solid var(--line);border-radius:13px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:13px;margin-top:11px}
.dblk .bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.7px;color:var(--mut);margin-bottom:11px;display:flex;align-items:center;justify-content:space-between}
.dblk .bl .bx{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:0;font-weight:500}
.mst{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mst .tm{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1}
.mst .tm .lgb{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0c1018;border:1px solid #000}.mst .tm .lgb img{width:38px;height:38px;object-fit:contain}
.mst .tm .ab{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:2px}.mst .tm .rc{font-family:var(--mono);font-size:9px;color:var(--mut2)}
.mst .at{font-family:var(--disp);font-weight:700;font-size:13px;color:var(--mut2)}
.bigscore{font-family:var(--disp);font-weight:800;font-size:34px;color:#fff;font-variant-numeric:tabular-nums}.bigscore.win{color:var(--green)}
.wpwrap{margin-top:4px}
.wprow{display:flex;height:32px;border-radius:8px;overflow:hidden}
.wprow .s{display:flex;align-items:center;font-family:var(--disp);font-weight:800;font-size:13px;padding:0 10px}
.wprow .aw{background:linear-gradient(90deg,#13283c,#1a3f5c);color:#cfe2f5}
.wprow .hm{background:linear-gradient(90deg,#1f6b3f,#123a23);color:#d6ffe8;justify-content:flex-end;margin-left:auto}
.wpcap{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:6px}
.proj{display:flex;justify-content:space-around;text-align:center;margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
.proj .p .k{font-family:var(--mono);font-size:8.5px;color:var(--mut2);font-weight:600}.proj .p .v{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;margin-top:2px}.proj .p .v.g{color:var(--green)}
.orow{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}.orow:first-of-type{border-top:none}
.orow .ol{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;width:64px;flex:0 0 auto}
.orow .os{font-family:var(--mono);font-size:11px;color:#aeb9c8;flex:1}.orow .os b{color:#fff}
.orow .oe{font-family:var(--disp);font-weight:800;font-size:15px;flex:0 0 auto}.oe.pos{color:var(--green)}.oe.neg{color:var(--mut)}
.pcard{padding:11px 0;border-top:1px solid rgba(255,255,255,.05)}
.pcard .prow{display:flex;gap:11px;align-items:center}
.pcard .pmeta{flex:1}
.pgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-top:10px}
.pgrid .pg{text-align:center;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:7px;padding:6px 2px}
.pgrid .pg .k{font-family:var(--mono);font-size:7.5px;color:var(--mut2);letter-spacing:.3px}
.pgrid .pg .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5;margin-top:1px}.pcard:first-of-type{border-top:none}
.pcard .pl{width:34px;height:34px;border-radius:50%;background:#0c1018;border:1px solid #000;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}.pcard .pl img{width:27px;height:27px;object-fit:contain}
.pcard .pn{font-weight:700;font-size:13px;color:#eaf1ee}.pcard .ph{font-family:var(--mono);font-size:9px;color:var(--mut)}
.pcard .pstats{display:flex;gap:13px;margin-left:auto;text-align:right}
.pcard .pstats .st .k{font-family:var(--mono);font-size:8px;color:var(--mut2)}.pcard .pstats .st .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5}
.mr{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.mr:first-of-type{border-top:none}
.mr .md{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.md.strong{background:var(--green)}.md.soft{background:var(--gold)}.md.split{background:var(--mut)}
.mr .mk{font-family:var(--disp);font-weight:800;font-size:11px;color:var(--mut);width:42px;flex:0 0 auto}
.mr .mv{flex:1}.mr .mvtop{font-family:var(--mono);font-size:11px;color:#cdd7e1}.mr .mvtop b{color:#fff}.mr .mvmoney{font-family:var(--mono);font-size:9.5px;margin-top:2px;color:var(--mut)}.mr .mvmoney.toward{color:var(--green)}.mr .mvmoney.off{color:var(--gold)}
.mr .ma{font-family:var(--mono);font-size:10px;font-weight:600;flex:0 0 auto}.ma.ag{color:var(--green)}.ma.df{color:var(--gold)}
.ctx{display:flex;flex-wrap:wrap;gap:7px}
.ctx .ch{font-family:var(--mono);font-size:10px;color:#aeb9c8;background:#0e1620;border:1px solid var(--line2);border-radius:7px;padding:5px 9px}.ctx .ch b{color:#fff}
.why{font-size:12.5px;color:#c4cfd9;line-height:1.55}.why .wl{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--gold);display:block;margin-bottom:4px}

.lurow{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.lurow:first-of-type{border-top:none}
.lurow .ln{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1}
.lustat{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px}.lustat.c{color:var(--green);background:rgba(51,233,145,.12)}.lustat.p{color:var(--gold);background:rgba(243,185,79,.12)}
.bvp{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.bvp:first-of-type{border-top:none}
.bvp .bn{font-family:var(--ui);font-weight:700;font-size:12px;color:#eaf1ee}.bvp .bvs{font-family:var(--mono);color:var(--mut2);font-size:9px;margin-top:1px}
.bvp .bl{margin-left:auto;font-family:var(--mono);font-size:11px;color:#cfe2f5;font-weight:600}.bvp .bl b{color:var(--gold)}
.formgrid{display:flex;gap:10px}
.fcol{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 9px;text-align:center}
.fcol .fab{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff}
.fdots{display:flex;gap:3px;justify-content:center;margin:8px 0}
.fdots i{width:14px;height:14px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:8px}
.fdots i.w{background:rgba(51,233,145,.18);color:var(--green)}.fdots i.l{background:rgba(255,93,77,.16);color:var(--neg)}
.fcol .frr{font-family:var(--mono);font-size:9px;color:var(--mut)}.fcol .frr b{color:#cdd7e1}

.exbtn{margin-top:11px;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--blue);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.exbtn .cv{display:inline-block;transition:transform .2s}.exbtn.open .cv{transform:rotate(90deg)}
.exwrap{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}.exwrap.open{display:block}
.lusub{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.4px;color:var(--gold);margin:11px 0 3px}.lusub:first-child{margin-top:0}
.lurowf{display:flex;align-items:center;gap:9px;padding:5px 0;border-top:1px solid rgba(255,255,255,.04)}
.lurowf .o{font-family:var(--mono);font-size:10px;color:var(--mut2);width:14px;flex:0 0 auto}
.lurowf .nm{font-family:var(--ui);font-weight:600;font-size:12px;color:#dbe4e2;flex:1}
.lurowf .po{font-family:var(--mono);font-size:9px;color:var(--mut);width:28px;flex:0 0 auto}
.lurowf .hd{font-family:var(--mono);font-size:10px;font-weight:700;color:var(--blue);width:16px;text-align:right;flex:0 0 auto}
.bvtbl{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:10.5px}
.bvtbl th{color:var(--mut2);font-weight:500;font-size:8.5px;padding:4px 4px;text-align:right;white-space:nowrap}.bvtbl th:first-child{text-align:left}
.bvtbl td{padding:6px 4px;text-align:right;border-top:1px solid var(--line);color:#cdd7e1;white-space:nowrap}.bvtbl td:first-child{text-align:left;font-family:var(--ui);font-weight:600;color:#eaf1ee}.bvtbl td.sl{color:var(--mut2);font-size:9.5px}
.umphd{font-family:var(--disp);font-weight:800;font-size:16px;color:#fff;display:flex;align-items:center;gap:8px;margin-bottom:11px}
.umpf{font-family:var(--mono);font-size:9px;font-weight:600;color:var(--gold);background:rgba(243,185,79,.1);border-radius:6px;padding:3px 8px;letter-spacing:0}
.umpgrid{display:flex;gap:10px}
.umpgrid .ug{flex:1;border:1px solid var(--line);border-radius:9px;padding:9px;text-align:center}
.umpgrid .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}
.umpgrid .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfe2f5;margin-top:2px}.umpgrid .v.up{color:var(--green)}.umpgrid .v.dn{color:var(--neg)}
.lsc{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}
.lsc th{color:var(--mut2);font-weight:500;font-size:9px;padding:3px 5px;text-align:center}.lsc td{padding:4px 5px;text-align:center;color:#cdd7e1;border-top:1px solid var(--line)}
.lsc td.tm{text-align:left;font-family:var(--disp);font-weight:800;font-size:13px;color:#fff}.lsc td.rh{color:#fff;font-weight:700}
`;
