// GAMES-PREMIUM-DARK-RESKIN-2026-06-23
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, scoresApi, subscriptionApi } from "../lib/api";
import TerminalShell from "./TerminalShell";

// ---- helpers ----
const TEAMCOL = {
  ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#27251F",CHW:"#27251F",
  CIN:"#C6011F",CLE:"#00385D",COL:"#33006F",DET:"#0C2340",HOU:"#EB6E1F",KC:"#004687",LAA:"#BA0021",
  LAD:"#005A9C",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#002B5C",NYM:"#FF5910",NYY:"#0C2340",OAK:"#003831",
  ATH:"#003831",PHI:"#E81828",PIT:"#FDB827",SD:"#2F241D",SF:"#FD5A1E",SEA:"#0C2C56",STL:"#C41E3A",
  TB:"#092C5C",TEX:"#003278",TOR:"#134A8E",WSH:"#AB0003",WAS:"#AB0003"
};
const SLUGM = { CWS:"chw", CHW:"chw", WSH:"wsh", WAS:"wsh", SD:"sd", SF:"sf", TB:"tb", KC:"kc", ATH:"oak", OAK:"oak" };
const colFor = (ab) => TEAMCOL[(ab||"").toUpperCase()] || "#2674b0";
const formatOdds = (o) => o==null||o===""||isNaN(+o) ? null : (+o>0 ? "+"+(+o) : ""+(+o));
const shortTeam = (s) => (s||"").trim().split(/\s+/).slice(-1)[0].slice(0,3).toUpperCase();
const fmtTime = (t) => {
  if (!t) return "—";
  if (typeof t === "string") {
    if (/invalid/i.test(t)) return "—";
    if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return t; // backend already sends "7:10 PM ET"
  }
  const d = new Date(t);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}).replace(" ","")+" ET";
};
const edgeLabel = (e) => {
  if (!e) return "";
  const ab = e.teamAbbr || shortTeam(e.side || e.matchup || "");
  const m = String(e.market||"").toLowerCase();
  if (m.includes("total") || e.side==="over" || e.side==="under") {
    const sd = (e.side==="under"?"Under":"Over"); return `${sd} ${e.line ?? ""}`.trim();
  }
  if (e.line != null && m.includes("spread") || e.line != null && (m.includes("run")||m.includes("rl"))) {
    return `${ab} ${e.line>0?"+":""}${e.line}`;
  }
  return `${ab} ML`;
};

// WZ-GAMES-PARK-2026-07-08 :: build a park/weather summary from a feed game (data already present on it).
const parkOf = (g) => {
  const prf = g.parkRunFactor, phf = g.parkHRFactor, w = g.weather || {};
  if (prf == null && phf == null) return null;
  const hf = (phf != null ? phf : prf);
  const hot = hf > 1.05, cold = hf < 0.95;
  const t = w.tempF != null ? Math.round(w.tempF) : null;
  const wind = w.windMph ? (w.windMph + " mph" + (w.windEffect ? " " + w.windEffect : "")) : null;
  return {
    venue: g.venue || g.park || ((g.home || "") + " Park"),
    team: g.home || "",
    tag: hot ? ["HITTER FRIENDLY", "h"] : cold ? ["PITCHER FRIENDLY", "p"] : ["NEUTRAL", "n"],
    hr: (phf != null ? ((phf > 1 ? "+" : "") + Math.round((phf - 1) * 100) + "%") : "0%"),
    run: (prf != null ? ((prf > 1 ? "+" : "") + Math.round((prf - 1) * 100) + "%") : "0%"),
    wx: w.indoor ? "Dome \u00b7 roof closed" : ([t != null ? t + "\u00b0F" : null, wind].filter(Boolean).join(" \u00b7 ") || null),
  };
};

export default function GamesPage() {
  const [winW,setWinW]=useState(typeof window!=="undefined"?window.innerWidth:0); // WZ-GAMES-DESKGATE-2026-07-02
  useEffect(()=>{ const on=()=>setWinW(window.innerWidth); window.addEventListener("resize",on); return ()=>window.removeEventListener("resize",on); },[]);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [edges, setEdges] = useState(null);
  const [scores, setScores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const [filter, setFilter] = useState("All");

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);
  const load = useCallback(async () => {
    try {
      // Edges board = rich upcoming (probables/lines/edges) but it ROLLS to the next
      // slate once today's games are no longer scheduled, dropping today's live/final.
      // The scores feed keeps today's live + final, so we fetch both and merge below.
      const [d, s] = await Promise.all([
        edgesApi.getMLB(),
        scoresApi.getScores("mlb").catch(() => null),
      ]);
      setEdges(d); setScores(s);
    } catch(e){ setEdges(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); const id=setInterval(load,45000); return ()=>clearInterval(id); }, [load]);

  const games = edges?.games || [];
  const edgeList = edges?.edges || [];
  const bestEdgeFor = (id) => {
    const es = edgeList.filter(e => e.gameId === id).sort((a,b)=>(b.edge||0)-(a.edge||0));
    return es[0] || null;
  };
  const toCard = (g) => {
    const st = g.status==="live" ? "live" : g.status==="final" ? "final" : "pre";
    const aAb = g.awayAbbr || shortTeam(g.away||"");
    const hAb = g.homeAbbr || shortTeam(g.home||"");
    const be = bestEdgeFor(g.id);
    const ml = g.moneyline || {};
    const lean = be ? edgeLabel(be)
      : (ml.awayWinProb!=null ? ((ml.awayWinProb>=ml.homeWinProb?aAb:hAb)+" ML") : "");
    const edge = be ? ((be.edge>=0?"+":"")+(be.edge*100).toFixed(1)+"%") : "";
    const pa = g.pitchers?.away, ph = g.pitchers?.home;
    const park = parkOf(g);
    return {
      id: g.id, st,
      a:{ ab:aAb, col:colFor(aAb), rec:"", s:g.awayScore },
      h:{ ab:hAb, col:colFor(hAb), rec:"", s:g.homeScore },
      time: fmtTime(g.time),
      ou: (g.totals && g.totals.projected!=null) ? g.totals.projected : (g.totals?.line ?? "—"),
      aml: formatOdds(ml.away),
      hml: formatOdds(ml.home),
      asp: [ pa?.name || "TBD", "", pa?.stats?.era!=null ? Number(pa.stats.era).toFixed(2) : "—" ],
      hsp: [ ph?.name || "TBD", "", ph?.stats?.era!=null ? Number(ph.stats.era).toFixed(2) : "—" ],
      state: g.status==="live" ? ((g.half==="bottom"?"Bot ":"Top ")+(g.inning||"")).trim() : "",
      lean, edge,
      win: g.status==="final" ? (((g.awayScore||0)>(g.homeScore||0))?"a":"h") : null,
      park
    };
  };
  const cards = games.map(toCard);
  // The edges board rolls to the next slate once today's games are no longer
  // "scheduled", which drops today's LIVE and FINAL games from it (e.g. late at night
  // the board shows tomorrow's upcoming, so Live/Final go empty). The scores feed keeps
  // them, so supplement any live/final games the edges cards are missing — deduped by id
  // (scores games carry detailId = the edges gamePk when the two slates align).
  // Dedup the scores supplement only against edges games that are THEMSELVES live/final
  // — never against upcoming ones. detailId is keyed by matchup (team nicknames), so a
  // game that's live today and the SAME matchup scheduled again tomorrow share a detailId.
  // Past midnight ET the edges board rolls to tomorrow's slate, so deduping against its
  // upcoming games would wrongly drop today's live/final games (the bug this fixes).
  const haveIds = new Set(cards.filter(c => c.st==="live" || c.st==="final").map(c => String(c.id)));
  const scoreCard = (sg) => {
    const st = sg.bucket === "live" ? "live" : "final";
    const aAb = sg.away?.abbrev || "TBD", hAb = sg.home?.abbrev || "TBD";
    const aS = sg.away?.score, hS = sg.home?.score;
    return {
      id: sg.detailId || sg.id, st, fromScores: true,
      a:{ ab:aAb, col:colFor(aAb), rec:"", s:aS },
      h:{ ab:hAb, col:colFor(hAb), rec:"", s:hS },
      time:"", ou:"—", aml:"", hml:"",
      asp:["—","","—"], hsp:["—","","—"],
      state: sg.bucket==="live" ? (sg.statusDetail || "Live") : "",
      lean:"", edge:"",
      win: sg.bucket==="final" ? (((aS||0)>(hS||0))?"a":"h") : null,
    };
  };
  const extra = [...(scores?.live||[]), ...(scores?.final||[])]
    .filter(sg => !haveIds.has(String(sg.detailId || sg.id)))
    .map(scoreCard);
  const live = [...cards.filter(c=>c.st==="live"), ...extra.filter(c=>c.st==="live")];
  const pre = cards.filter(c=>c.st==="pre");
  const fin = [...cards.filter(c=>c.st==="final"), ...extra.filter(c=>c.st==="final")];
  const FILTS = ["All","Live","Upcoming","Final"];
  const showLive = (filter==="All"||filter==="Live") && live.length;
  const showPre  = (filter==="All"||filter==="Upcoming") && pre.length;
  const showFin  = (filter==="All"||filter==="Final") && fin.length;
  const nothing = !loading && !(showLive||showPre||showFin);

  // WZ-GAMES-DESKTOP-2026-07-11 :: >=1024px Games renders its own desktop surface inside the
  // shared Vault shell (supersedes the old dashboard redirect). Mobile layout below untouched.

  return (
    <TerminalShell active="/games" plan={plan} navigate={navigate}>
    <div className="app"><style>{CSS}</style>
      <div className="hd">
        <div className="hrow">
          <div className="logo">Wize<span className="w">Picks</span></div>
          <span className="opbadge">{"\u25cf"} OPEN</span>
          <div className="sp"/>
          <div className="ibtn" onClick={()=>navigate("/settings")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
        </div>
        <div className="sports">
          {[["MLB","mlb"],["NBA","nba"],["NHL","nhl"],["NFL","nfl"],["CFB","cfb"]].map(([lb,key])=>(
            <b key={key} className={key==="mlb"?"on":""} onClick={()=>{ if(key==="nba")navigate("/nba"); else if(key!=="mlb")navigate(`/${key}-games`); }}><span className="dot"/>{lb}</b>
          ))}
        </div>
      </div>

      <div className="maintop">{/* WZ-GAMES-MAINTOP-2026-07-16 :: match football header (title + pills top-right) */}
        <div><h1>MLB Games</h1><div className="msub">{live.length+pre.length+fin.length} games {"\u00b7"} MLB {"\u00b7"} live scores</div></div>
        <div className="sportbar">
          {[["MLB","mlb"],["NBA","nba"],["NFL","nfl"],["NHL","nhl"],["CFB","cfb"]].map(([lb,key])=>(
            <div key={key} className={"sp"+(key==="mlb"?" on":"")} onClick={()=>{ if(key==="nba")navigate("/nba"); else if(key!=="mlb")navigate(`/${key}-games`); }}><span className="d"/>{lb}</div>
          ))}
        </div>
      </div>
      <div className="chips">{FILTS.map(f=><b key={f} className={f===filter?"on":""} onClick={()=>setFilter(f)}>{f}</b>)}</div>

      <div id="wrap">
        {loading && <div className="estate"><div className="et">Loading today's games…</div><div className="es">Pulling the slate.</div></div>}
        {!loading && showLive && <>
          <div className="seclbl"><span className="ld"/>LIVE NOW <span className="c">{live.length} in play</span></div>
          <div className="glist">{live.map(g=><GameCard key={g.id} g={g} navigate={navigate}/>)}</div>
        </>}
        {!loading && showPre && <>
          <div className="seclbl">UPCOMING <span className="c">{pre.length} games · probables &amp; lines</span></div>
          <div className="glist">{pre.map(g=><GameCard key={g.id} g={g} navigate={navigate}/>)}</div>
        </>}
        {!loading && showFin && <>
          <div className="seclbl">FINAL <span className="c">today</span></div>
          <div className="glist">{fin.map(g=><GameCard key={g.id} g={g} navigate={navigate}/>)}</div>
        </>}
        {nothing && <div className="estate"><div className="et">Nothing here yet</div><div className="es">No {filter.toLowerCase()} games right now.</div></div>}
      </div>

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a className="on"><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate(plan?.isAdmin||plan?.tier==="pro"||plan?.tier==="elite"?"/props":"/pricing")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
    </TerminalShell>
  );
}

function Logo({ ab, col }) {
  const [bad, setBad] = useState(false);
  const slug = (SLUGM[(ab||"").toUpperCase()] || ab || "").toLowerCase();
  return <span className="lg" style={{ background:`radial-gradient(circle at 50% 32%, ${col}aa, #0c1018 82%)` }}>
    {(bad||!ab) ? String(ab||"?").slice(0,3) : <img src={`https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`} alt="" onError={()=>setBad(true)}/>}
  </span>;
}
function TeamRow({ t, score, ml, win, lose }) {
  const cls = win ? "win" : lose ? "lose" : "";
  return <div className={"team "+cls}>
    <Logo ab={t.ab} col={t.col}/>
    <div className="tw"><div className="nm">{t.ab}</div><div className="rec">{t.rec||""}</div></div>
    {score!=null ? <div className="scr">{score}</div> : (ml ? <div className="ml">{ml}</div> : null)}
  </div>;
}
function GameCard({ g, navigate }) {
  const open = () => navigate(`/game/mlb/${g.id}`);
  if (g.st === "live") return (
    <div className="gc live" onClick={open}>
      <div className="gtop"><span className="gstat live"><span className="ld"/>LIVE · {g.state}</span><span className="ou">in-game</span></div>
      <TeamRow t={g.a} score={g.a.s}/><TeamRow t={g.h} score={g.h.s}/>
      <div className="gfoot"><span className="lean"><span className="lb">LIVE EDGE</span>{g.lean} {g.edge && <span className="e">{g.edge}</span>}</span><span className="go">Edges {"\u203a"}</span></div>
    </div>
  );
  if (g.st === "pre") return (
    <div className="gc" onClick={open}>
      <div className="gtop"><span className="gstat pre">{g.time}</span><span className="ou">O/U <b>{g.ou}</b></span></div>
      <TeamRow t={g.a} ml={g.aml}/><TeamRow t={g.h} ml={g.hml}/>
      <div className="probs">
        <div className="prob"><span className="h">AWAY</span><span className="nm2">{g.asp[0]}</span><span className="era">{g.asp[2]} ERA</span></div>
        <div className="prob"><span className="h">HOME</span><span className="nm2">{g.hsp[0]}</span><span className="era">{g.hsp[2]} ERA</span></div>
      </div>
      {g.park && <div className={"gpark "+g.park.tag[1]}>
        <div className="gpktop"><div><div className="gpkv">{g.park.venue}</div><div className="gpkg">{g.park.team}</div></div><span className={"gpktag "+g.park.tag[1]}>{g.park.tag[0]}</span></div>
        <div className="gpkbot"><div className="gpkb"><div className="kk">HR BOOST</div><div className={"vv "+(g.park.hr.startsWith("-")?"dn":"")}>{g.park.hr}</div></div><div className="gpkb"><div className="kk">RUN BOOST</div><div className={"vv "+(g.park.run.startsWith("-")?"dn":"")}>{g.park.run}</div></div>{g.park.wx&&<div className="gpkwx">{g.park.wx}</div>}</div>
      </div>}
      <div className="gfoot"><span className="lean"><span className="lb">EDGE</span>{g.lean} {g.edge && <span className="e">{g.edge}</span>}</span><span className="go">Details {"\u203a"}</span></div>
    </div>
  );
  return (
    <div className="gc" onClick={open}>
      <div className="gtop"><span className="gstat final">FINAL</span><span className="ou">{g.lean||""}</span></div>
      <TeamRow t={g.a} score={g.a.s} win={g.win==="a"} lose={g.win!=="a"}/>
      <TeamRow t={g.h} score={g.h.s} win={g.win==="h"} lose={g.win!=="h"}/>
    </div>
  );
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#0A0B0D;--panel:#14171B;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);--gold:#C9A86A;--green:#3FCB91;--neg:#E2655C;--red:#E2655C;--steel:#2A6F97;--blue:#5DA9E8;--mut:#99A2AA;--mut2:#5B646C;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;--serif:Georgia,'Times New Roman',serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--serif);font-weight:600;font-size:22px;letter-spacing:-.2px;color:var(--tx)}.logo .w{color:var(--gold)}
.opbadge{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(63,203,145,.34);background:rgba(63,203,145,.1);border-radius:999px;padding:3px 8px}
.sp{flex:1}
.ibtn{width:30px;height:30px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.sports{display:flex;gap:6px;padding:0 0 11px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.dsports{display:none}
.maintop{display:none}
.sports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sports b.on{color:var(--tx);border-color:rgba(63,203,145,.4);background:rgba(63,203,145,.12)}
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
.gc.live{border-color:rgba(226,101,92,.35)}
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
.gfoot{display:flex;align-items:center;gap:8px;padding:9px 13px;border-top:1px solid var(--line);background:rgba(201,168,106,.04)}
.gpark{margin:0 13px 11px;border:1px solid var(--line);border-radius:12px;background:#0e1216;padding:10px 11px}
.gpark.h{border-color:rgba(226,101,92,.28)}.gpark.p{border-color:rgba(93,169,232,.28)}
.gpktop{display:flex;align-items:center;justify-content:space-between}
.gpkv{font-family:var(--disp);font-weight:800;font-size:14px;color:#e6ebef}
.gpkg{font-family:var(--mono);font-size:8px;color:var(--mut2);margin-top:1px}
.gpktag{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.5px;padding:3px 7px;border-radius:5px}
.gpktag.h{color:var(--neg);border:1px solid rgba(226,101,92,.4)}.gpktag.p{color:var(--blue);border:1px solid rgba(93,169,232,.4)}.gpktag.n{color:var(--mut);border:1px solid var(--line2)}
.gpkbot{display:flex;align-items:center;gap:14px;margin-top:9px}
.gpkb .kk{font-family:var(--mono);font-size:7.5px;color:var(--mut2)}
.gpkb .vv{font-family:var(--disp);font-weight:800;font-size:17px;color:var(--green)}.gpkb .vv.dn{color:var(--neg)}
.gpkwx{margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--mut);text-align:right}
.lean{font-family:var(--mono);font-size:11px;color:#cdd7e1}.lean .lb{color:var(--gold);font-weight:700;font-family:var(--disp);font-size:11px;letter-spacing:.3px;margin-right:5px}.lean .e{color:var(--green);font-weight:600}
.gfoot .go{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--blue);font-weight:600}
.estate{margin:40px 14px;border:1px dashed var(--line2);border-radius:14px;padding:36px 18px;text-align:center}
.estate .et{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfd7e2}.estate .es{font-size:12px;color:var(--mut);margin-top:6px;font-family:var(--mono)}
#wrap{padding-bottom:96px}
/* WZ-DESKTOP-NAVSCOPE-2026-07-11 */
.app .nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.app .nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}
.nav a .dbars rect{fill:var(--mut2)}.app .nav a.on .dbars rect{fill:var(--gold)}
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
.mst .tm .lgb{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0c1018;border:1px solid #000}.mst .tm .lgb img{width:38px;height:38px;object-fit:contain}
.mst .tm .ab{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-top:2px}.mst .tm .rc{font-family:var(--mono);font-size:9px;color:var(--mut2)}
.mst .at{font-family:var(--disp);font-weight:700;font-size:13px;color:var(--mut2)}
.bigscore{font-family:var(--disp);font-weight:800;font-size:34px;color:#fff;font-variant-numeric:tabular-nums}.bigscore.win{color:var(--green)}
.wpwrap{margin-top:4px}
.wprow{display:flex;height:32px;border-radius:8px;overflow:hidden}
.wprow .s{display:flex;align-items:center;font-family:var(--disp);font-weight:800;font-size:13px;padding:0 10px}
.wprow .aw{background:rgba(93,169,232,.18);color:#cfe2f5}
.wprow .hm{background:rgba(63,203,145,.18);color:#d6ffe8;justify-content:flex-end;margin-left:auto}
.wpcap{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:6px}
.proj{display:flex;justify-content:space-around;text-align:center;margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
.proj .p .k{font-family:var(--mono);font-size:8.5px;color:var(--mut2);font-weight:600}.proj .p .v{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;margin-top:2px}.proj .p .v.g{color:var(--green)}
.orow{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}.orow:first-of-type{border-top:none}
.orow .ol{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;width:64px;flex:0 0 auto}
.orow .os{font-family:var(--mono);font-size:11px;color:#aeb9c8;flex:1}.orow .os b{color:#fff}
.orow .oe{font-family:var(--disp);font-weight:800;font-size:15px;flex:0 0 auto}.oe.pos{color:var(--green)}.oe.neg{color:var(--mut)}
.pcard{display:flex;gap:11px;padding:10px 0;border-top:1px solid rgba(255,255,255,.05)}.pcard:first-of-type{border-top:none}
.pcard .pl{width:34px;height:34px;border-radius:50%;background:#0c1018;border:1px solid #000;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}.pcard .pl img{width:27px;height:27px;object-fit:contain}
.pcard .pn{font-weight:700;font-size:13px;color:#eaf1ee}.pcard .ph{font-family:var(--mono);font-size:9px;color:var(--mut)}
.pcard .pstats{display:flex;gap:13px;margin-left:auto;text-align:right}
.pcard .pstats .st .k{font-family:var(--mono);font-size:8px;color:var(--mut2)}.pcard .pstats .st .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5}
.mr{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.mr:first-of-type{border-top:none}
.mr .md{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.md.strong{background:var(--green)}.md.soft{background:var(--gold)}.md.split{background:var(--mut)}
.mr .mk{font-family:var(--disp);font-weight:800;font-size:11px;color:var(--mut);width:42px;flex:0 0 auto}
.mr .mv{font-family:var(--mono);font-size:11px;color:#cdd7e1;flex:1}.mr .mv b{color:#fff}
.mr .ma{font-family:var(--mono);font-size:10px;font-weight:600;flex:0 0 auto}.ma.ag{color:var(--green)}.ma.df{color:var(--gold)}
.ctx{display:flex;flex-wrap:wrap;gap:7px}
.ctx .ch{font-family:var(--mono);font-size:10px;color:#aeb9c8;background:#0e1620;border:1px solid var(--line2);border-radius:7px;padding:5px 9px}.ctx .ch b{color:#fff}
.why{font-size:12.5px;color:#c4cfd9;line-height:1.55}.why .wl{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--gold);display:block;margin-bottom:4px}

.lurow{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.lurow:first-of-type{border-top:none}
.lurow .ln{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1}
.lustat{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px}.lustat.c{color:var(--green);background:rgba(63,203,145,.14)}.lustat.p{color:var(--gold);background:rgba(201,168,106,.14)}
.bvp{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.bvp:first-of-type{border-top:none}
.bvp .bn{font-family:var(--ui);font-weight:700;font-size:12px;color:#eaf1ee}.bvp .bvs{font-family:var(--mono);color:var(--mut2);font-size:9px;margin-top:1px}
.bvp .bl{margin-left:auto;font-family:var(--mono);font-size:11px;color:#cfe2f5;font-weight:600}.bvp .bl b{color:var(--gold)}
.formgrid{display:flex;gap:10px}
.fcol{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 9px;text-align:center}
.fcol .fab{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff}
.fdots{display:flex;gap:3px;justify-content:center;margin:8px 0}
.fdots i{width:14px;height:14px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:8px}
.fdots i.w{background:rgba(63,203,145,.2);color:var(--green)}.fdots i.l{background:rgba(226,101,92,.18);color:var(--neg)}
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
.umpf{font-family:var(--mono);font-size:9px;font-weight:600;color:var(--gold);background:rgba(201,168,106,.12);border-radius:6px;padding:3px 8px;letter-spacing:0}
.umpgrid{display:flex;gap:10px}
.umpgrid .ug{flex:1;border:1px solid var(--line);border-radius:9px;padding:9px;text-align:center}
.umpgrid .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}
.umpgrid .v{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfe2f5;margin-top:2px}.umpgrid .v.up{color:var(--green)}.umpgrid .v.dn{color:var(--neg)}
.lsc{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px}
.lsc th{color:var(--mut2);font-weight:500;font-size:9px;padding:3px 5px;text-align:center}.lsc td{padding:4px 5px;text-align:center;color:#cdd7e1;border-top:1px solid var(--line)}
.lsc td.tm{text-align:left;font-family:var(--disp);font-weight:800;font-size:13px;color:#fff}.lsc td.rh{color:#fff;font-weight:700}

@media (min-width:1024px){
  .app{background:transparent;padding:0;max-width:none;margin:0;width:100%} /* WZ-DESKTOP-SHELLFIT-2026-07-11 :: fill the shell content area, drop the 460px mobile column */
  .app .hd{display:none}
  .dsports{display:flex;gap:6px;padding:14px 15px 2px}
  .dsports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
  .dsports b.on{color:var(--tx);border-color:rgba(63,203,145,.4);background:rgba(63,203,145,.12)}
  .dsports b .dot{width:6px;height:6px;border-radius:50%;background:#2a3640}.dsports b.on .dot{background:var(--green)}
  .maintop{display:flex;align-items:flex-end;justify-content:space-between;padding:16px 26px 4px}
  .maintop h1{font-family:var(--disp);font-weight:800;font-size:clamp(20px,1.7vw,26px);margin:0;color:var(--tx)}
  .maintop .msub{font-size:12px;color:var(--mut);margin-top:1px;font-family:var(--mono)}
  .maintop .sportbar{display:flex;gap:5px}
  .maintop .sportbar .sp{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--mut);padding:7px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer}
  .maintop .sportbar .sp.on{color:#fff;border-color:var(--line2);background:#111726}.maintop .sportbar .sp.on .d{background:var(--green)}
  .maintop .sportbar .sp .d{width:6px;height:6px;border-radius:50%;background:var(--mut2)}
  .app .nav{display:none}
  .app .sports,.app .chips{padding-left:26px;padding-right:26px}
  .app #wrap{max-width:none;padding:16px 26px 40px}
  .app .glist{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px}
  .app .seclbl{margin:16px 4px 8px}
}
/* WZ-GAMES-DESKTOP-2026-07-11 */
`;
