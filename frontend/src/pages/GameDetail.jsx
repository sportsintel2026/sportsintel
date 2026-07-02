// GAMEDETAIL-PREMIUM-DARK-RESKIN-2026-06-23
// GAMEDETAIL-CARDS-POLISH-2026-06-23
// WZ-GD-PREMIUM2-2026-07-02 :: premium pre-game redesign (hero, duel, informal voice)
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
const PERF_API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi, scoresApi, matchupsApi, liveApi } from "../lib/api";

const TEAMCOL = {
  ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#27251F",CHW:"#27251F",
  CIN:"#C6011F",CLE:"#00385D",COL:"#33006F",DET:"#0C2340",HOU:"#EB6E1F",KC:"#004687",LAA:"#BA0021",
  LAD:"#005A9C",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#002B5C",NYM:"#FF5910",NYY:"#0C2340",OAK:"#003831",
  ATH:"#003831",PHI:"#E81828",PIT:"#FDB827",SD:"#2F241D",SF:"#FD5A1E",SEA:"#0C2C56",STL:"#C41E3A",
  TB:"#092C5C",TEX:"#003278",TOR:"#134A8E",WSH:"#AB0003",WAS:"#AB0003"
};
const SLUGM = { CWS:"chw", CHW:"chw", ATH:"oak" };
const colFor = (ab) => TEAMCOL[(ab||"").toUpperCase()] || "#2A6F97";
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
  const [liveGame, setLiveGame] = useState(null);  // direct match from /api/live/mlb (gamePk-keyed)
  const [bvpData, setBvpData] = useState(null);    // matchups: batter-vs-pitcher
  const [lineups, setLineups] = useState(null);    // matchups: projected batting orders
  const [marketRead, setMarketRead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);

  useEffect(() => {
    let cancelled = false; setLoading(true);
    (async () => {
      const [edges, scores, mr, liveFeed] = await Promise.all([
        edgesApi.getMLB().catch(()=>null),
        scoresApi.getScores("mlb").catch(()=>null),
        edgesApi.getMarketRead ? edgesApi.getMarketRead("mlb").catch(()=>null) : Promise.resolve(null),
        liveApi.getMLB().catch(()=>null),
      ]);
      if (cancelled) return;
      setAllEdges(edges); setMarketRead(mr);
      // The dashboard Live Edges cards navigate with the live feed's gameId (= StatsAPI
      // gamePk). Match it directly here so a live game always resolves, even after the
      // edges board has rolled to tomorrow (when nickname/detailId bridges all miss).
      const lg = (liveFeed?.games || []).find(g => String(g.gameId)===String(gameId)) || null;
      setLiveGame(lg);
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
        scoresApi.getGameDetail("mlb", sid).then(d => { if(!cancelled){ setDetail(d); } }).catch(()=>{});
      }
      // BVP + projected lineups come from the matchups endpoint (keyed by gamePk = URL id).
      matchupsApi.getMLB(gameId).then(m => {
        if (cancelled || !m) return;
        const mapRow = (r) => ({
          batter: r.batterName || r.name,
          pos: r.position || "",
          pa: r.plateAppearances ?? r.atBats ?? 0,
          ab: r.atBats ?? 0,
          h: r.hits ?? 0,
          hr: r.homeRuns ?? 0,
          rbi: r.rbi ?? 0,
          bb: r.walks ?? 0,
          k: r.strikeouts ?? 0,
          avg: r.avg,
          ops: r.ops,
          sznAvg: r.season?.avg ?? null,
          sznOps: r.season?.ops ?? null,
          sznHr: r.season?.homeRuns ?? null,
        });
        setBvpData({
          awayBattersVsHomePitcher: (m.awayBattersVsHomePitcher||[]).map(mapRow),
          homeBattersVsAwayPitcher: (m.homeBattersVsAwayPitcher||[]).map(mapRow),
        });
        setLineups(m.lineups || null);
      }).catch(()=>{});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gameId]);

  let game = allEdges?.games?.find(g => String(g.id)===String(gameId));
  if (!game && scoresGame && allEdges?.games) {
    const key = `${nick(scoresGame.away?.name)}|${nick(scoresGame.home?.name)}`;
    game = allEdges.games.find(g => `${nick(g.away)}|${nick(g.home)}` === key);
  }
  // ROLLOVER FALLBACK: once the model rolls to tomorrow's slate, a still-live game
  // is gone from allEdges entirely (not by id, not by nickname). But we still have it
  // from the live SCORES feed — synthesize a minimal game object so the live view
  // (line score + win-probability) renders instead of "Game not found". Edges-only
  // sections simply stay empty for these; the live data is what matters here.
  if (!game && scoresGame) {
    game = {
      id: scoresGame.detailId || scoresGame.id,
      away: scoresGame.away?.name || "",
      home: scoresGame.home?.name || "",
      awayAbbr: shortTeam(scoresGame.away?.name || ""),
      homeAbbr: shortTeam(scoresGame.home?.name || ""),
      status: scoresGame.status || (scoresGame.bucket==="live"?"live":scoresGame.bucket==="final"?"final":"pre"),
      venue: scoresGame.venue || null,
      time: scoresGame.startTime || null,
      _fromScores: true,
    };
  }
  // LAST-RESORT: a live game clicked from the dashboard Live Edges card. The live feed
  // is gamePk-keyed and matched the URL id exactly above, so synthesize from it — this
  // is the path that fixes "Game not found" for in-game edges after the board rolled.
  if (!game && liveGame) {
    game = {
      id: liveGame.gameId,
      away: liveGame.away || "",
      home: liveGame.home || "",
      awayAbbr: liveGame.awayAbbr || shortTeam(liveGame.away || ""),
      homeAbbr: liveGame.homeAbbr || shortTeam(liveGame.home || ""),
      status: "live",
      inning: liveGame.inning, half: liveGame.half, outs: liveGame.outs,
      awayScore: liveGame.awayScore, homeScore: liveGame.homeScore,
      _fromLive: true,
    };
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
  const rlPick = pickByMarket(["run","spread"]); // WZ-GD-PREMIUM2-2026-07-02 :: per-market edge pill
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
        {!loading && game && st==="pre"   && <SheetPre   game={game} aAb={aAb} hAb={hAb} gEdges={gEdges} mlPick={mlPick} totPick={totPick} rlPick={rlPick} bestEdge={bestEdge} mr={mr} detail={detail} bvpData={bvpData} lineups={lineups} hasFull={hasFull} navigate={navigate}/>}
        {!loading && game && st==="live"  && <SheetLive  game={game} gameId={gameId} scoresGame={scoresGame} aAb={aAb} hAb={hAb} gEdges={gEdges} detail={detail}/>}
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
// Collapsible section — tap the header to expand. Collapsed by default to keep the
// detail card clean. Reuses the .cv chevron used elsewhere.
const Collapse = ({ label, bx, sub, open: defOpen = false, children }) => {
  const [open, setOpen] = useState(defOpen);
  return (
    <div className="dblk">
      <div className="exphd" onClick={() => setOpen(o => !o)}>
        <span className="bl" style={{ margin: 0 }}>{label}{bx && <span className="bx">{bx}</span>}</span>
        <span className="expr">{sub && <span className="expsub">{sub}</span>}<span className={"cv" + (open ? " open" : "")}>{"\u25b8"}</span></span>
      </div>
      {open && <div className="expbody">{children}</div>}
    </div>
  );
};
// Home-plate umpire tendencies (from detail.umpire). Shown on every game state, not
// just pre-game. Renders nothing until the crew is posted (a few hours pre-first-pitch).
// WZ-GD-PREMIUM2-2026-07-02 :: friendlier voice — always shows a lean pill.
const UmpBlock = ({ detail }) => {
  const ump = detail?.umpire || null;
  if (!ump) return null;
  return (
    <Block label="BEHIND THE PLATE" bx="the ump's season tendencies">
      <div className="umphd">{ump.name||"TBD"} <span className="umpf">{ump.favor ? `leans ${ump.favor}` : "plays it neutral"}</span></div>
      <div className="umpgrid">
        <div className="ug"><div className="k">RUNS vs AVG</div><div className={"v "+(String(ump.runs||"").startsWith("-")?"dn":"up")}>{ump.runs ?? "—"}</div></div>
        <div className="ug"><div className="k">K / GAME</div><div className="v">{ump.k ?? "—"}</div></div>
        <div className="ug"><div className="k">BB / GAME</div><div className="v">{ump.bb ?? "—"}</div></div>
      </div>
    </Block>
  );
};
// WZ-GD-PREMIUM2-2026-07-02 :: premium pre-game sheet — one-glance hero (matchup +
// win prob + plain-English readout), friendlier section voices, face-to-face pitching
// duel with headline stats + collapsible full sheets, lineups & BvP open by default.
// Data logic untouched; live/final sheets share the refreshed base styles.

// plain-English one-liner under the win bar — the "informal" layer.
function wpReadout(aAb, hAb, wlA, wlH) {
  if (wlA == null || wlH == null) return null;
  const lead = wlA >= wlH ? aAb : hAb;
  const diff = Math.abs(wlA - wlH);
  if (diff <= 4)  return <>Basically a coin flip {"\u2014"} the model leans <b>{lead} by a hair</b></>;
  if (diff <= 12) return <>The model leans <b>{lead}</b></>;
  if (diff <= 24) return <>The model likes <b>{lead}</b> tonight</>;
  return <>The model strongly favors <b>{lead}</b></>;
}

function HeroCard({ game, aAb, hAb, aCol, hCol, wlA, wlH, venue, timeStr }) {
  return <div className="hero">
    <div className="hteams">
      <div className="htm"><LogoB ab={aAb} col={aCol}/><div className="ab">{aAb}</div><div className="rc">{game.awayRecord||""}</div></div>
      <div className="hat">@</div>
      <div className="htm"><LogoB ab={hAb} col={hCol}/><div className="ab">{hAb}</div><div className="rc">{game.homeRecord||""}</div></div>
    </div>
    <div className="hchips">
      {venue && <span className="hch">{venue}</span>}
      {timeStr && <span className="hch">First pitch <b>{timeStr}</b></span>}
    </div>
    {(wlA!=null && wlH!=null) && <div className="hwp">
      <div className="hwpwrap">
        <div className="hwpbar">
          <div className="a" style={{width:wlA+"%"}}>{aAb} {wlA}%</div>
          <div className="h" style={{width:wlH+"%"}}>{wlH}% {hAb}</div>
        </div>
        <div className="hwptick"/>
      </div>
      <div className="hwpread">{wpReadout(aAb, hAb, wlA, wlH)}</div>
    </div>}
  </div>;
}

// good/bad coloring for the duel headline stats — mild thresholds, neutral otherwise.
const statTone = {
  era:  (v)=> v==null?"" : v<3.60?"good" : v>4.80?"bad" : "",
  whip: (v)=> v==null?"" : v<1.20?"good" : v>1.42?"bad" : "",
  k9:   (v)=> v==null?"" : v>9.5?"good"  : v<7.2?"bad"  : "",
  baa:  (v)=> v==null?"" : v<0.230?"good": v>0.275?"bad": "",
};
const f3p = (v)=> v==null ? "\u2014" : Number(v).toFixed(3).replace(/^0(?=\.)/,"");

function DuelPitcher({ ab, col, p }) {
  const [imgErr,setImgErr]=useState(false);
  const pid=p?.id||null; const s=p?.stats||{};
  const head = (pid && !imgErr)
    ? <span className="dface" style={{background:`radial-gradient(circle at 50% 28%, ${col}, #0c1018 82%)`}}><img src={`https://midfield.mlbstatic.com/v1/people/${pid}/spots/120`} alt="" onError={()=>setImgErr(true)}/></span>
    : <span className="dface" style={{background:`radial-gradient(circle at 50% 32%, ${col}99,#0c1018 82%)`}}>{String(ab||"?").slice(0,2)}</span>;
  const wl = (s.wins!=null||s.losses!=null) ? `${s.wins??0}-${s.losses??0}` : null;
  const num=(x,d)=> x!=null ? (d!=null?Number(x).toFixed(d):x) : "\u2014";
  return <div className="dpit">
    {head}
    <div className="dnm">{p?.name || "TBD"}</div>
    <div className="dmeta">{p?.hand?`${p.hand}HP \u00b7 `:""}{ab}{wl?` \u00b7 ${wl}`:""}{s.inningsPitched!=null?` \u00b7 ${Number(s.inningsPitched).toFixed(1)} IP`:""}</div>
    {p?.name && <div className="dbig">
      <div className="db"><div className="k">ERA</div><div className={"v "+statTone.era(s.era!=null?+s.era:null)}>{num(s.era,2)}</div></div>
      <div className="db"><div className="k">WHIP</div><div className={"v "+statTone.whip(s.whip!=null?+s.whip:null)}>{num(s.whip,2)}</div></div>
      <div className="db"><div className="k">K/9</div><div className={"v "+statTone.k9(s.strikeoutsPer9!=null?+s.strikeoutsPer9:null)}>{num(s.strikeoutsPer9,1)}</div></div>
      <div className="db"><div className="k">BAA</div><div className={"v "+statTone.baa(s.battingAvgAgainst!=null?+s.battingAvgAgainst:null)}>{f3p(s.battingAvgAgainst)}</div></div>
    </div>}
  </div>;
}

function FullStatGrid({ ab, p }) {
  const s=p?.stats||{};
  if (!p?.name) return null;
  const num=(x,d)=> x!=null ? (d!=null?Number(x).toFixed(d):x) : "\u2014";
  const tiles=[["BB/9",num(s.walksPer9,1)],["HR/9",num(s.homeRunsPer9,1)],["K/BB",num(s.strikeoutWalkRatio,2)],["SLG-A",f3p(s.sluggingAgainst)],["GS",num(s.gamesStarted)],["K",num(s.strikeouts)],["BB",num(s.walks)],["HR",num(s.homeRuns)]];
  return <div className="fsg">
    <div className="fsgab">{ab} {"\u00b7"} {p.name}</div>
    <div className="pgrid" style={{marginTop:6}}>{tiles.map(([k,v],i)=><div key={i} className="pg"><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
  </div>;
}

function PitchingDuel({ aAb, hAb, aCol, hCol, pa, ph }) {
  const [open,setOpen]=useState(false);
  return <Block label="ON THE MOUND" bx="probable starters">
    <div className="duel">
      <DuelPitcher ab={aAb} col={aCol} p={pa}/>
      <div className="dvs">VS</div>
      <DuelPitcher ab={hAb} col={hCol} p={ph}/>
    </div>
    {(pa?.name||ph?.name) && <>
      <div className="morestats"><span className={"morebtn"+(open?" open":"")} onClick={()=>setOpen(o=>!o)}>Full stat sheets <span className="cv">{"\u25b8"}</span></span></div>
      {open && <div className="fsgwrap"><FullStatGrid ab={aAb} p={pa}/><FullStatGrid ab={hAb} p={ph}/></div>}
    </>}
  </Block>;
}

function SheetPre({ game, aAb, hAb, gEdges, mlPick, totPick, rlPick, bestEdge, mr, detail, bvpData, lineups, hasFull, navigate }) {
  const aCol=colFor(aAb), hCol=colFor(hAb);
  const ml = game.moneyline || {};
  const wlA = pct(ml.awayWinProb), wlH = pct(ml.homeWinProb);
  const t = game.totals || {};
  const projA = t.awayProjected ?? t.projectedAway ?? game.awayProjected ?? null;
  const projH = t.homeProjected ?? t.projectedHome ?? game.homeProjected ?? null;
  const projTot = (projA!=null && projH!=null) ? (parseFloat(projA)+parseFloat(projH)).toFixed(1) : (t.projected ?? null);
  const ou = t.line ?? "\u2014";
  const rl = game.runLine || {};
  const pa = game.pitchers?.away || {}, ph = game.pitchers?.home || {};
  const _lu = (lineups && ((lineups.away && lineups.away.length) || (lineups.home && lineups.home.length))) ? lineups : (game.lineups || {});
  const luA = _lu.away || [], luH = _lu.home || [];
  const luName = (x) => (x && (x.name || x.player)) || "";
  const luOrd = (x) => (x && (x.order ?? x.spot)) ?? "";
  const luPos = (x) => (x && (x.position || x.pos)) || "";
  const series = detail?.series || {};
  const formA = series.away || series.awayForm || null;
  const formH = series.home || series.homeForm || null;
  const bvpA = bvpData?.awayBattersVsHomePitcher || [];
  const bvpH = bvpData?.homeBattersVsAwayPitcher || [];
  const bvpTotal = bvpA.length + bvpH.length;
  const w = game.weather || {};
  const parkTxt = game.parkRunFactor!=null ? ((game.parkRunFactor>1?"+":"")+Math.round((game.parkRunFactor-1)*100)+"% runs") : "\u2014";
  const parkHrTxt = game.parkHRFactor!=null ? ((game.parkHRFactor>1?"+":"")+Math.round((game.parkHRFactor-1)*100)+"% HR") : null;
  const windCls = w.windEffect==="out" ? "wout" : w.windEffect==="in" ? "win" : "";
  const timeStr = fmtTime(game.time);

  // per-market edge pills
  const edgePill = (pick) => pick && pick.edge!=null
    ? <span className={"epill "+(pick.edge>0?"pos":"neu")}>{(pick.edge>=0?"+":"")+(pick.edge*100).toFixed(1)+"%"}</span>
    : <span className="epill neu">{"\u2014"}</span>;

  const reads = [];
  if (mr?.win) { const w2=mr.win; reads.push({ k:"WIN", lean:w2.favTeam, odds:fmtOdds(w2.consensus ?? w2.bestPrice), prob:(w2.favProb ?? w2.model?.prob ?? null), mv:(w2.move?{toward:w2.move.towardFav,cents:w2.move.cents,team:w2.favTeam}:null), agrees:w2.model?.agrees }); }
  if (mr?.cover?.favTeam) { const c=mr.cover; reads.push({ k:"COVER", lean:c.favTeam, odds:fmtOdds(c.bestPrice ?? c.odds), prob:(c.favProb ?? c.model?.prob ?? null), mv:null, agrees:(c.model?.agrees ?? c.agrees) }); }
  if (mr?.total && (mr.total.lean||mr.total.side)) { const tt=mr.total; reads.push({ k:"TOTAL", lean:String(tt.lean||tt.side).toUpperCase()+(tt.line!=null?" "+tt.line:""), odds:fmtOdds(tt.bestOver ?? tt.odds), prob:(tt.favProb ?? tt.model?.prob ?? null), mv:null, agrees:(tt.model?.agrees ?? tt.agrees) }); }

  return (<>
    <HeroCard game={game} aAb={aAb} hAb={hAb} aCol={aCol} hCol={hCol} wlA={wlA} wlH={wlH} venue={game.venue||""} timeStr={timeStr}/>

    <Block label="THE MODEL'S NUMBERS" bx="tonight's projection">
      <div className="projg">
        <div className="pcell"><div className="k">{aAb} RUNS</div><div className="v">{projA ?? "\u2014"}</div></div>
        <div className="pcell"><div className="k">{hAb} RUNS</div><div className="v">{projH ?? "\u2014"}</div></div>
        <div className="pcell"><div className="k">TOTAL</div><div className="v g">{projTot ?? "\u2014"}</div></div>
        <div className="pcell"><div className="k">THE LINE</div><div className="v">{ou}</div></div>
      </div>
    </Block>

    <Block label="THE PRICES" bx="best line across books">
      <div className="pricer">
        <div className="mk">Moneyline</div>
        <div className="ocs"><span className="oc"><span className="who">{aAb}</span><b>{fmtOdds(ml.away)}</b></span><span className="oc"><span className="who">{hAb}</span><b>{fmtOdds(ml.home)}</b></span></div>
        {edgePill(mlPick)}
      </div>
      {(rl.awayOdds!=null||rl.homeOdds!=null) && <div className="pricer">
        <div className="mk">Run Line</div>
        <div className="ocs"><span className="oc"><span className="who">{aAb} {rl.awayLine!=null?(rl.awayLine>0?"+":"")+rl.awayLine:""}</span><b>{fmtOdds(rl.awayOdds)}</b></span><span className="oc"><span className="who">{hAb} {rl.homeLine!=null?(rl.homeLine>0?"+":"")+rl.homeLine:""}</span><b>{fmtOdds(rl.homeOdds)}</b></span></div>
        {edgePill(rlPick)}
      </div>}
      {(t.overOdds!=null||t.underOdds!=null||t.line!=null) && <div className="pricer">
        <div className="mk">Total {t.line!=null?t.line:""}</div>
        <div className="ocs"><span className="oc"><span className="who">Over</span><b>{fmtOdds(t.overOdds)}</b></span><span className="oc"><span className="who">Under</span><b>{fmtOdds(t.underOdds)}</b></span></div>
        {edgePill(totPick)}
      </div>}
    </Block>

    <PitchingDuel aAb={aAb} hAb={hAb} aCol={aCol} hCol={hCol} pa={pa} ph={ph}/>

    <Collapse label="WHO'S BATTING" bx="lineups" open={true} sub={(luA.length||luH.length) ? `${aAb} vs ${hAb}` : "not posted"}>
      {(luA.length>0 || luH.length>0) ? <>
        <div className="lusub">{aAb}{luA.length>0 && (_lu.awayConfirmed ? <span className="luok">{"\u2713 confirmed"}</span> : <span className="luproj">projected</span>)}</div>{luA.map((x,i)=><div key={"a"+i} className="lurowf"><span className="o">{luOrd(x)}</span><span className="nm">{luName(x)}</span><span className="po">{luPos(x)}</span></div>)}
        <div className="lusub">{hAb}{luH.length>0 && (_lu.homeConfirmed ? <span className="luok">{"\u2713 confirmed"}</span> : <span className="luproj">projected</span>)}</div>{luH.map((x,i)=><div key={"h"+i} className="lurowf"><span className="o">{luOrd(x)}</span><span className="nm">{luName(x)}</span><span className="po">{luPos(x)}</span></div>)}
      </> : <div className="estate" style={{padding:"4px 2px",margin:0,border:"none"}}><div className="es">Lineups confirm ~90 min before first pitch.</div></div>}
    </Collapse>

    {bvpTotal>0 && <Collapse label="HISTORY AT THE PLATE" bx="batter vs pitcher, career" open={true} sub={`${bvpTotal} w/ history`}>
      {bvpA.length>0 && <><div className="bvpgrp">{aAb} batters vs {ph?.name || "opp SP"}</div><BvpTable rows={bvpA}/></>}
      {bvpH.length>0 && <><div className="bvpgrp">{hAb} batters vs {pa?.name || "opp SP"}</div><BvpTable rows={bvpH}/></>}
    </Collapse>}

    {(formA||formH) && <Block label="RECENT FORM" bx="last 5 · runs/game"><div className="formgrid">
      <FormCol ab={aAb} f={formA}/><FormCol ab={hAb} f={formH}/>
    </div></Block>}

    <UmpBlock detail={detail}/>

    {reads.length>0 && <Block label="WHAT THE BOOKS THINK" bx="collective lean">
      {reads.map((r,i)=><div key={i} className="mr"><span className={"md "+(r.agrees?"strong":"split")}/><span className="mk">{r.k}</span><div className="mv"><div className="mvtop"><b>{r.lean}</b>{r.odds&&r.odds!=="\u2014"?` \u00b7 ${r.odds}`:""}{r.prob!=null?` \u00b7 ${r.prob}%`:""}</div>{r.mv&&<div className={"mvmoney "+(r.mv.toward?"toward":"off")}>{r.mv.toward?`money coming in on ${r.mv.team}`:`money drifting off ${r.mv.team}`} · {r.mv.cents}{"\u00a2"} since open</div>}</div><Agree ok={r.agrees}/></div>)}
    </Block>}

    <Block label="TONIGHT'S CONDITIONS" bx={!w.indoor && w.forecastAtGameTime ? "at first pitch" : "conditions"}><div className="ctx">
      {venueChip(game.venue||scoresGame_venue(game))}
      <span className="ch">Runs <b>{parkTxt}</b></span>
      {parkHrTxt && <span className="ch">HR <b>{parkHrTxt}</b></span>}
      {w.indoor ? <span className="ch">Dome {"\u00b7"} roof closed</span> : <>
        {w.tempF!=null && <span className="ch">{w.tempF}{"\u00b0"}F{w.tempEffect&&w.tempEffect!=="neutral"?` \u00b7 ${w.tempEffect==="hot"?"warm air carries":w.tempEffect}`:""}</span>}
        {w.windLabel && <span className={"ch "+windCls}>{w.windLabel}</span>}
        {(w.conditions||w.isRaining) && <span className="ch">{w.conditions||""}{w.isRaining?" \u00b7 rain":""}</span>}
      </>}
    </div></Block>

    {bestEdge?.reason && <div className="whycard"><div className="l">WHY THE EDGE</div><div className="t">{bestEdge.reason}</div></div>}
  </>);
}
const scoresGame_venue = (g) => g?.venue || "";
const venueChip = (v) => v ? <span className="ch">{v}</span> : null;

function FormCol({ ab, f }) {
  const l5 = (f?.l5 || f?.last5 || "").toString();
  return <div className="fcol"><div className="fab">{ab}</div>
    <div className="fdots">{l5.split("").map((c,i)=><i key={i} className={c==="W"?"w":"l"}>{c}</i>)}</div>
    <div className="frr">RF <b>{f?.rf ?? "—"}</b> · RA <b>{f?.ra ?? "—"}</b></div>
  </div>;
}

function BvpTable({ rows }) {
  const f3 = (v) => v==null ? "—" : Number(v).toFixed(3).replace(/^0(?=\.)/,"");
  return (
    <div className="bvpwrap">
      <table className="bvptbl">
        <thead><tr>
          <th className="nm">Batter</th><th>PA</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th><th>AVG</th><th>OPS</th>
        </tr></thead>
        <tbody>
          {rows.map((b,i)=>(
            <tr key={i}>
              <td className="nm">{b.batter}{b.pos?<span className="po"> {b.pos}</span>:null}{(b.sznAvg!=null||b.sznHr!=null)?<div className="szn">SZN {f3(b.sznAvg)} / {f3(b.sznOps)} · {b.sznHr ?? 0} HR</div>:null}</td>
              <td>{b.pa}</td><td>{b.h}</td>
              <td className={b.hr>0?"hot":""}>{b.hr}</td>
              <td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td>
              <td>{f3(b.avg)}</td><td>{f3(b.ops)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function LineScore({ ls }) {
  if (!ls || !ls.length) return null;
  // Standard box score: AWAY on top, HOME below. Feed order isn't guaranteed, so sort
  // by homeAway when present (away first); leave as-is if the field is missing.
  const rank = (r) => { const v=String(r.homeAway||"").toLowerCase(); return v==="away"?0 : v==="home"?1 : 0.5; };
  ls = [...ls].sort((a,b) => rank(a) - rank(b));
  const innings = Math.max(...ls.map(r => (r.periods||[]).length), 0);
  return <table className="lsc"><thead><tr><th style={{textAlign:"left"}}>&nbsp;</th>{Array.from({length:innings}).map((_,i)=><th key={i}>{i+1}</th>)}<th>R</th></tr></thead>
    <tbody>{ls.map((r,ri)=><tr key={ri}><td className="tm">{r.abbrev||r.homeAway||""}</td>{Array.from({length:innings}).map((_,i)=><td key={i}>{r.periods?.[i]!=null?r.periods[i]:""}</td>)}<td className="rh">{r.total!=null?r.total:""}</td></tr>)}</tbody></table>;
}
// LIVE-WINPROB-GRAPH-GD-2026-06-23 — crossing win-probability lines for the
// matchup page. Read-only: fetches /api/live-winprob/:gamePk (0 odds credits).
// Wider layout than the dashboard card. Live odds line = parked (P3, after lazy-props).
function WinProbGraphGD({gamePk,homeAb,awayAb,homeCol,awayCol}){
  const [wp,setWp]=useState(null);
  useEffect(()=>{ if(!gamePk)return; let dead=false,t;
    const pull=async()=>{ try{
      const r=await fetch(`${PERF_API_BASE}/api/live-winprob/${gamePk}`);
      const d=await r.json();
      if(!dead && d && d.winProb && d.winProb.available) setWp(d.winProb);
      else if(!dead) setWp(false);
    }catch(_){ if(!dead) setWp(false); }
      t=setTimeout(pull,60000); };
    pull(); return ()=>{ dead=true; clearTimeout(t); };
  },[gamePk]);
  if(wp===null) return <div className="gdwpg-load">loading win probability{"\u2026"}</div>;
  if(wp===false || !wp.series || wp.series.length<2)
    return <div className="gdwpg-load">Win probability posts once the game is underway.</div>;
  const series=wp.series, n=series.length;
  const W=320, H=120, PT=6, PB=6;
  const ix=(i)=> (i/(n-1))*W;
  const iy=(v)=> PT + (1-(v/100))*(H-PT-PB);
  const awayPts=series.map((d,i)=>`${i===0?"M":"L"}${ix(i).toFixed(1)} ${iy(d.awayWP).toFixed(1)}`).join(" ");
  const homePts=series.map((d,i)=>`${i===0?"M":"L"}${ix(i).toFixed(1)} ${iy(d.homeWP).toFixed(1)}`).join(" ");
  const mid=iy(50);
  const cur=wp.current||series[n-1];
  const awayLead=(cur.awayWP||0)>=50;
  const fillPts=series.map((d,i)=>`${ix(i).toFixed(1)} ${iy(d.awayWP).toFixed(1)}`).join(" ");
  const fillPath=`M0 ${mid.toFixed(1)} L${fillPts} L${W} ${mid.toFixed(1)} Z`;
  const swings=(wp.topSwings||[]).slice(0,4);
  // inning boundary ticks (where the inning number changes)
  const ticks=[];
  for(let i=1;i<n;i++){ if(series[i].inning!==series[i-1].inning) ticks.push({x:ix(i),inn:series[i].inning}); }
  return (
    <div className="gdwpg">
      <div className="gdwpghead">
        <span className="wl" style={{color:awayCol}}>{awayAb} {cur.awayWP!=null?Math.round(cur.awayWP)+"%":""}</span>
        <span className="wl wr" style={{color:homeCol}}>{homeAb} {cur.homeWP!=null?Math.round(cur.homeWP)+"%":""}</span>
      </div>
      <svg className="gdwpgsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {ticks.map((t,k)=><line key={"t"+k} x1={t.x} y1="0" x2={t.x} y2={H} className="gdwptick"/>)}
        <line x1="0" y1={mid} x2={W} y2={mid} className="gdwpmid"/>
        <path d={fillPath} className="gdwpfill" style={{fill:awayLead?awayCol:homeCol}}/>
        <path d={homePts} className="gdwpline" style={{stroke:homeCol,opacity:.55}}/>
        <path d={awayPts} className="gdwpline" style={{stroke:awayCol}}/>
        {swings.map((sw,k)=>{const d=series[sw.i];if(!d)return null;return <circle key={k} cx={ix(sw.i)} cy={iy(d.awayWP)} r="3" className="gdwpsw"/>;})}
      </svg>
      <div className="gdwpgticks">{ticks.map((t,k)=><span key={k} style={{left:`${(t.x/W)*100}%`}}>{t.inn}</span>)}</div>
      <div className="gdwpgfoot">
        <span>first {Math.round(series[0].awayWP)}{"\u2013"}{Math.round(series[0].homeWP)}</span>
        <span className="gdsep">{"\u00b7"}</span>
        <span>{n} plays</span>
        {swings[0]&&swings[0].desc&&<><span className="gdsep">{"\u00b7"}</span><span className="gdbig">big swing ({swings[0].wpAdded>0?"+":""}{swings[0].wpAdded}%): {swings[0].desc}</span></>}
      </div>
    </div>
  );
}
function SheetLive({ game, gameId, scoresGame, aAb, hAb, gEdges, detail }) {
  const aCol=colFor(aAb), hCol=colFor(hAb);
  const ml = game.moneyline || {};
  const wlA = pct(ml.awayWinProb), wlH = pct(ml.homeWinProb);
  const aS = game.awayScore ?? scoresGame?.away?.score ?? 0;
  const hS = game.homeScore ?? scoresGame?.home?.score ?? 0;
  // game.inning may already be a formatted half+number ("Top 6") or a bare number.
  // Only add the half when it isn't already present, so we never render "Top Top 6".
  const _inn = String(game.inning ?? "").trim();
  const state = /^(top|bot|bottom|mid|end)/i.test(_inn)
    ? _inn.replace(/^bottom/i,"Bot").replace(/^top/i,"Top")
    : ((game.half==="bottom"?"Bot ":"Top ")+_inn);
  const ls = detail?.lineScore || scoresGame?.lineScore || null;
  return (<>
    <div className="dblk"><div className="mst">
      <div className="tm"><LogoB ab={aAb} col={aCol}/><div className="ab">{aAb}</div></div>
      <div className="bigscore">{aS}</div><div className="at" style={{fontSize:11}}>{state}</div><div className="bigscore">{hS}</div>
      <div className="tm"><LogoB ab={hAb} col={hCol}/><div className="ab">{hAb}</div></div>
    </div></div>
    <Block label="LIVE WIN PROBABILITY" bx="in-game"><WinProbGraphGD gamePk={gameId} homeAb={hAb} awayAb={aAb} homeCol={hCol} awayCol={aCol}/></Block>
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
    {bestEdge?.reason && <div className="dblk" style={{borderColor:"rgba(63,203,145,.3)"}}><div className="bl" style={{color:"var(--green)"}}>MODEL RESULT</div><div className="why">{bestEdge.reason}</div></div>}
    {ls && <Block label="LINE SCORE"><LineScore ls={ls}/></Block>}
    <UmpBlock detail={detail}/>
    {venue && <Block label="CONTEXT"><div className="ctx"><span className="ch">{venue}</span></div></Block>}
  </>);
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#0A0B0D;--panel:#14171B;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);--gold:#C9A86A;--green:#3FCB91;--neg:#E2655C;--red:#E2655C;--steel:#2A6F97;--blue:#5DA9E8;--mut:#99A2AA;--mut2:#5B646C;--tx:#ECEFF2;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;--serif:Georgia,'Times New Roman',serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--serif);font-weight:600;font-size:22px;letter-spacing:-.2px;color:var(--tx)}.logo .w{color:var(--gold)}
.opbadge{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(63,203,145,.32);background:rgba(63,203,145,.08);border-radius:999px;padding:3px 8px}
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
.gc{margin:8px 14px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden;cursor:pointer;transition:border-color .15s}
.gc:active{border-color:var(--steel)}
.gc.live{border-color:rgba(226,101,92,.3)}
.gtop{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid var(--line)}
.gstat{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;font-weight:700}
.gstat.live{color:var(--red)}.gstat.pre{color:var(--gold)}.gstat.final{color:var(--mut)}
.gstat .ld{width:6px;height:6px}
.gtop .ou{font-family:var(--mono);font-size:10px;color:var(--mut)}.gtop .ou b{color:#cdd7e1;font-weight:600}
.team{display:flex;align-items:center;gap:10px;padding:9px 13px}
.team+.team{border-top:1px solid rgba(255,255,255,.04)}
.lg{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1B2025;border:1px solid var(--line2);font-family:var(--disp);font-weight:800;font-size:9px;color:#fff;flex:0 0 auto}.lg img{width:21px;height:21px;object-fit:contain}
.team .nm{font-family:var(--disp);font-weight:800;font-size:18px;color:#eef3f5;line-height:1}
.team .rec{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:2px}
.team .tw{flex:1;min-width:0}
.team .ml{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--mut);flex:0 0 auto}
.team .scr{font-family:var(--disp);font-weight:800;font-size:24px;color:#fff;flex:0 0 auto;font-variant-numeric:tabular-nums;min-width:26px;text-align:right}
.team.win .scr{color:var(--green)}.team.lose .nm,.team.lose .scr{color:var(--mut)}
.probs{padding:8px 13px;border-top:1px solid rgba(255,255,255,.04);display:flex;flex-direction:column;gap:4px}
.prob{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;color:#aeb9c8}
.prob .h{color:var(--mut2);font-size:9px;width:30px;flex:0 0 auto}.prob .nm2{color:#cdd7e1}.prob .era{margin-left:auto;color:var(--mut)}
.gfoot{display:flex;align-items:center;gap:8px;padding:9px 13px;border-top:1px solid var(--line);background:rgba(201,168,106,.03)}
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
.dblk{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:13px;margin-top:11px}
.dblk .bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.7px;color:var(--mut);margin-bottom:11px;display:flex;align-items:center;justify-content:space-between}
.dblk .bl .bx{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:0;font-weight:500}
.mst{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mst .tm{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1}
.mst .tm .lgb{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1B2025;border:1px solid var(--line2)}.mst .tm .lgb img{width:38px;height:38px;object-fit:contain}
.mst .tm .ab{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:2px}.mst .tm .rc{font-family:var(--mono);font-size:9px;color:var(--mut2)}
.mst .at{font-family:var(--disp);font-weight:700;font-size:13px;color:var(--mut2)}
.bigscore{font-family:var(--disp);font-weight:800;font-size:34px;color:#fff;font-variant-numeric:tabular-nums}.bigscore.win{color:var(--green)}
.wpwrap{margin-top:4px}
.wprow{display:flex;height:32px;border-radius:8px;overflow:hidden}
.wprow .s{display:flex;align-items:center;font-family:var(--disp);font-weight:800;font-size:13px;padding:0 10px}
.wprow .aw{background:rgba(45,111,151,.32);color:#cfe2f5}
.wprow .hm{background:rgba(63,203,145,.22);color:#d6ffe8;justify-content:flex-end;margin-left:auto}
.gdwpg-load{font-family:var(--mono);font-size:11px;color:var(--mut2);text-align:center;padding:18px 0}
.gdwpghead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.gdwpghead .wl{font-family:var(--disp);font-weight:800;font-size:15px;font-variant-numeric:tabular-nums}
.gdwpghead .wr{text-align:right}
.gdwpgsvg{display:block;width:100%;height:120px}
.gdwptick{stroke:rgba(255,255,255,.05);stroke-width:1}
.gdwpmid{stroke:rgba(255,255,255,.14);stroke-width:.8;stroke-dasharray:4 4}
.gdwpfill{opacity:.12}
.gdwpline{fill:none;stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.gdwpsw{fill:#fff;stroke:rgba(0,0,0,.55);stroke-width:.6}
.gdwpgticks{position:relative;height:12px;margin-top:1px}
.gdwpgticks span{position:absolute;transform:translateX(-50%);font-family:var(--mono);font-size:8px;color:var(--mut2)}
.gdwpgfoot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;font-family:var(--mono);font-size:10px;color:var(--mut2)}
.gdwpgfoot .gdbig{color:var(--mut)}
.gdsep{opacity:.5}
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
.pgrid .pg{text-align:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:7px;padding:6px 2px}
.pgrid .pg .k{font-family:var(--mono);font-size:7.5px;color:var(--mut2);letter-spacing:.3px}
.pgrid .pg .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5;margin-top:1px}.pcard:first-of-type{border-top:none}
.pcard .pl{width:34px;height:34px;border-radius:50%;background:#1B2025;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}.pcard .pl img{width:27px;height:27px;object-fit:contain}
.pcard .pn{font-weight:700;font-size:13px;color:#eaf1ee}.pcard .ph{font-family:var(--mono);font-size:9px;color:var(--mut)}
.pcard .pstats{display:flex;gap:13px;margin-left:auto;text-align:right}
.pcard .pstats .st .k{font-family:var(--mono);font-size:8px;color:var(--mut2)}.pcard .pstats .st .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5}
.mr{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.mr:first-of-type{border-top:none}
.mr .md{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.md.strong{background:var(--green)}.md.soft{background:var(--gold)}.md.split{background:var(--mut)}
.mr .mk{font-family:var(--disp);font-weight:800;font-size:11px;color:var(--mut);width:42px;flex:0 0 auto}
.mr .mv{flex:1}.mr .mvtop{font-family:var(--mono);font-size:11px;color:#cdd7e1}.mr .mvtop b{color:#fff}.mr .mvmoney{font-family:var(--mono);font-size:9.5px;margin-top:2px;color:var(--mut)}.mr .mvmoney.toward{color:var(--green)}.mr .mvmoney.off{color:var(--gold)}
.mr .ma{font-family:var(--mono);font-size:10px;font-weight:600;flex:0 0 auto}.ma.ag{color:var(--green)}.ma.df{color:var(--gold)}
.ctx{display:flex;flex-wrap:wrap;gap:7px}
.ctx .ch{font-family:var(--mono);font-size:10px;color:#aeb9c8;background:#1B2025;border:1px solid var(--line2);border-radius:7px;padding:5px 9px}.ctx .ch b{color:#fff}
.ctx .ch.wout{color:#7ee0a8;border-color:rgba(126,224,168,.32)}.ctx .ch.win{color:#ff8f80;border-color:rgba(255,143,128,.32)}
.why{font-size:12.5px;color:#c4cfd9;line-height:1.55}.why .wl{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--gold);display:block;margin-bottom:4px}

.lurow{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.lurow:first-of-type{border-top:none}
.lurow .ln{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1}
.lustat{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px}.lustat.c{color:var(--green);background:rgba(63,203,145,.12)}.lustat.p{color:var(--gold);background:rgba(201,168,106,.12)}
.bvpgrp{font-family:var(--mono);font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:var(--mut2);margin:12px 0 4px;padding-top:9px;border-top:1px solid rgba(255,255,255,.06)}
.bvpgrp:first-of-type{border-top:none;padding-top:0;margin-top:2px}
.bvpwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:2px}
.bvptbl{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}
.bvptbl th{font-weight:600;color:var(--mut2);text-transform:uppercase;font-size:8.5px;letter-spacing:.04em;padding:4px 7px;text-align:right;white-space:nowrap}
.bvptbl th.nm,.bvptbl td.nm{text-align:left;position:sticky;left:0;background:var(--panel)}
.bvptbl td{padding:6px 7px;text-align:right;color:#cfe2f5;white-space:nowrap;border-top:1px solid rgba(255,255,255,.05)}
.bvptbl td.nm{font-family:var(--ui);font-weight:700;color:#eaf1ee;min-width:104px}
.bvptbl td.nm .po{font-family:var(--mono);font-weight:400;color:var(--mut2);font-size:9px;margin-left:3px}
.bvptbl td.nm .szn{display:block;font-family:var(--mono);font-weight:400;color:var(--mut2);font-size:8.5px;margin-top:2px;letter-spacing:.2px}
.bvptbl td.hot{color:var(--gold);font-weight:700}
.bvp{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.bvp:first-of-type{border-top:none}
.bvp .bn{font-family:var(--ui);font-weight:700;font-size:12px;color:#eaf1ee}.bvp .bvs{font-family:var(--mono);color:var(--mut2);font-size:9px;margin-top:1px}
.bvp .bl{margin-left:auto;font-family:var(--mono);font-size:11px;color:#cfe2f5;font-weight:600}.bvp .bl b{color:var(--gold)}
.formgrid{display:flex;gap:10px}
.fcol{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 9px;text-align:center}
.fcol .fab{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff}
.fdots{display:flex;gap:3px;justify-content:center;margin:8px 0}
.fdots i{width:14px;height:14px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:8px}
.fdots i.w{background:rgba(63,203,145,.18);color:var(--green)}.fdots i.l{background:rgba(226,101,92,.16);color:var(--neg)}
.fcol .frr{font-family:var(--mono);font-size:9px;color:var(--mut)}.fcol .frr b{color:#cdd7e1}

.exbtn{margin-top:11px;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--blue);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.exbtn .cv{display:inline-block;transition:transform .2s}.exbtn.open .cv{transform:rotate(90deg)}
.exwrap{display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}.exwrap.open{display:block}
.lusub{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.4px;color:var(--gold);margin:11px 0 3px}.lusub:first-child{margin-top:0}
.lusub .luok{color:#3FCB91;font-family:var(--mono);font-size:8.5px;font-weight:700;margin-left:7px;letter-spacing:.3px}
.lusub .luproj{color:var(--mut2);font-family:var(--mono);font-size:8.5px;font-weight:500;margin-left:7px;letter-spacing:.3px}
.lurowf{display:flex;align-items:center;gap:9px;padding:5px 0;border-top:1px solid rgba(255,255,255,.04)}
.lurowf .o{font-family:var(--mono);font-size:10px;color:var(--mut2);width:14px;flex:0 0 auto}
.lurowf .nm{font-family:var(--ui);font-weight:600;font-size:12px;color:#dbe4e2;flex:1}
.lurowf .po{font-family:var(--mono);font-size:9px;color:var(--mut);width:28px;flex:0 0 auto}
.exphd{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.expr{display:flex;align-items:center;gap:9px;flex:0 0 auto}
.expsub{font-family:var(--mono);font-size:9px;color:var(--mut2);white-space:nowrap}
.expbody{margin-top:12px}
.exphd .cv{display:inline-block;color:var(--mut);font-size:12px;transition:transform .2s}.exphd .cv.open{transform:rotate(90deg)}
.exphd .bl{gap:7px;flex:0 1 auto;min-width:0;overflow:hidden}.exphd .bl .bx{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lurowf .hd{font-family:var(--mono);font-size:10px;font-weight:700;color:var(--blue);width:16px;text-align:right;flex:0 0 auto}
.bvtbl{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:10.5px}
.bvtbl th{color:var(--mut2);font-weight:500;font-size:8.5px;padding:4px 4px;text-align:right;white-space:nowrap}.bvtbl th:first-child{text-align:left}
.bvtbl td{padding:6px 4px;text-align:right;border-top:1px solid var(--line);color:#cdd7e1;white-space:nowrap}.bvtbl td:first-child{text-align:left;font-family:var(--ui);font-weight:600;color:#eaf1ee}.bvtbl td.sl{color:var(--mut2);font-size:9.5px}
.umphd{font-family:var(--disp);font-weight:800;font-size:16px;color:#fff;display:flex;align-items:center;gap:8px;margin-bottom:11px}
.umpf{font-family:var(--mono);font-size:9px;font-weight:600;color:var(--gold);background:rgba(201,168,106,.1);border-radius:6px;padding:3px 8px;letter-spacing:0}
.umpgrid{display:flex;gap:10px}
.umpgrid .ug{flex:1;border:1px solid var(--line);border-radius:9px;padding:9px;text-align:center}
.umpgrid .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}
.umpgrid .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfe2f5;margin-top:2px}.umpgrid .v.up{color:var(--green)}.umpgrid .v.dn{color:var(--neg)}
.lsc{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}
.lsc th{color:var(--mut2);font-weight:500;font-size:9px;padding:3px 5px;text-align:center}.lsc td{padding:4px 5px;text-align:center;color:#cdd7e1;border-top:1px solid var(--line)}
.lsc td.tm{text-align:left;font-family:var(--disp);font-weight:800;font-size:13px;color:#fff}.lsc td.rh{color:#fff;font-weight:700}

/* WZ-GD-PREMIUM2-2026-07-02 :: premium pre-game sheet */
.hero{background:linear-gradient(180deg,#171B20 0%,#14171B 100%);border:1px solid var(--line2);border-radius:18px;padding:20px 16px 16px;margin-top:11px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;left:-40px;top:-50px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(120,130,140,.10),transparent 70%);pointer-events:none}
.hero::after{content:"";position:absolute;right:-40px;top:-50px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(201,168,106,.08),transparent 70%);pointer-events:none}
.hteams{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
.htm{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1}
.htm .lgb{width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1B2025;border:1px solid var(--line2)}
.htm .lgb img{width:46px;height:46px;object-fit:contain}
.htm .ab{font-family:var(--disp);font-weight:800;font-size:20px;color:#fff;margin-top:2px}
.htm .rc{font-family:var(--mono);font-size:9px;color:var(--mut2)}
.hat{font-family:var(--disp);font-weight:700;font-size:14px;color:var(--mut2)}
.hchips{display:flex;gap:7px;justify-content:center;margin-top:14px;flex-wrap:wrap;position:relative;z-index:1}
.hch{font-family:var(--mono);font-size:10px;color:var(--mut);background:#1B2025;border:1px solid var(--line2);border-radius:999px;padding:5px 12px}
.hch b{color:#fff;font-weight:600}
.hwp{margin-top:16px;position:relative;z-index:1}
.hwpwrap{position:relative}
.hwpbar{display:flex;height:36px;border-radius:11px;overflow:hidden;border:1px solid var(--line2)}
.hwpbar .a{background:linear-gradient(90deg,#23303B,#2B3B49);display:flex;align-items:center;padding-left:11px;font-family:var(--disp);font-weight:800;font-size:13px;color:#cfe2f5;white-space:nowrap;overflow:hidden}
.hwpbar .h{background:linear-gradient(90deg,#1C3A30,#215043);display:flex;align-items:center;justify-content:flex-end;padding-right:11px;font-family:var(--disp);font-weight:800;font-size:13px;color:#46E0A9;white-space:nowrap;overflow:hidden}
.hwptick{position:absolute;left:50%;top:0;height:36px;width:1px;background:rgba(255,255,255,.18)}
.hwpread{margin-top:9px;font-family:var(--mono);font-size:11px;color:var(--mut);text-align:center}
.hwpread b{color:#fff;font-weight:600}
.projg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.pcell{background:#1B2025;border:1px solid var(--line2);border-radius:11px;padding:10px 4px;text-align:center}
.pcell .k{font-family:var(--mono);font-size:8px;color:var(--mut2);letter-spacing:.06em}
.pcell .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:4px}
.pcell .v.g{color:var(--green)}
.pricer{display:flex;align-items:center;gap:9px;padding:10px 0;border-top:1px solid rgba(255,255,255,.05)}
.pricer:first-of-type{border-top:none;padding-top:2px}
.pricer:last-of-type{padding-bottom:2px}
.pricer .mk{font-family:var(--mono);font-size:11px;color:var(--mut);width:78px;flex:0 0 auto}
.pricer .ocs{display:flex;gap:6px;flex:1;flex-wrap:wrap}
.pricer .oc{font-family:var(--mono);font-size:11px;background:#1B2025;border:1px solid var(--line2);border-radius:9px;padding:5px 9px;white-space:nowrap}
.pricer .oc .who{color:var(--mut);margin-right:5px}
.pricer .oc b{color:#fff;font-weight:700}
.epill{font-family:var(--disp);font-weight:800;font-size:12px;border-radius:999px;padding:4px 10px;flex:0 0 auto}
.epill.pos{color:var(--green);background:rgba(63,203,145,.1);border:1px solid rgba(63,203,145,.25)}
.epill.neu{color:var(--mut2);background:#1B2025;border:1px solid var(--line2)}
.duel{display:grid;grid-template-columns:1fr 30px 1fr;gap:4px;align-items:start}
.dpit{text-align:center}
.dface{width:52px;height:52px;border-radius:50%;border:1px solid var(--line2);margin:0 auto 8px;display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:var(--disp);font-weight:800;font-size:14px;color:#fff}
.dface img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.dnm{font-family:var(--ui);font-weight:700;font-size:13.5px;color:#eaf1ee;line-height:1.25}
.dmeta{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:3px}
.dvs{font-family:var(--disp);font-weight:800;font-size:11px;color:var(--mut2);align-self:center;text-align:center;padding-top:22px}
.dbig{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
.db{background:#1B2025;border:1px solid var(--line2);border-radius:9px;padding:7px 3px}
.db .k{font-family:var(--mono);font-size:7.5px;color:var(--mut2);letter-spacing:.06em}
.db .v{font-family:var(--disp);font-weight:800;font-size:16px;color:#cfe2f5;margin-top:2px}
.db .v.good{color:var(--green)}
.db .v.bad{color:var(--neg)}
.morestats{margin-top:12px;text-align:center}
.morebtn{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--mut);background:#1B2025;border:1px solid var(--line2);border-radius:999px;padding:7px 15px;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}
.morebtn .cv{color:var(--gold);display:inline-block;transition:transform .2s}
.morebtn.open .cv{transform:rotate(90deg)}
.fsgwrap{margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}
.fsg+.fsg{margin-top:11px}
.fsgab{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.4px;color:var(--gold)}
.whycard{margin-top:11px;background:linear-gradient(180deg,rgba(201,168,106,.08),rgba(201,168,106,.03));border:1px solid rgba(201,168,106,.3);border-radius:14px;padding:14px}
.whycard .l{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.7px;color:var(--gold);margin-bottom:6px}
.whycard .t{font-size:12.5px;color:#e2e8ec;line-height:1.55;font-family:var(--ui)}
`;
