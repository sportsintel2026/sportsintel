// LIVESCORES-PREMIUM-DARK-RESKIN-2026-06-23
// WZ-SCORES-TERMINAL-2026-07-02 :: >=1024px renders the full desktop TERMINAL (topbar +
// tape + sidebar + games grid + league news wire), matching HomeDesktop exactly. The
// mobile experience below 1024px is untouched.
// LIVESCORES-CARDS-POLISH-2026-06-23
// LiveScores.jsx — shared live scores view for MLB / NBA / NFL / CFB / NHL.
// Splits games into Live / Upcoming / Final with a blinking LIVE dot, refreshes
// every 30s. Tapping a game opens its full matchup page (scoreboard + box score
// + analysis all in one). Driven by a `league` prop ("mlb" | "nba" | "nfl" | ...).
//
// Shell matches Games.jsx EXACTLY (same emerald app frame, header sport pills,
// and glyph bottom nav) so the score pages are visually identical to the MLB
// Games page no matter which entry point you arrive from (dashboard sport tab
// or bottom-nav → Games → sport tab). The old Sidebar/BottomNav/TerminalShell
// chrome was replaced here for that consistency.

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi, scoresApi, newsApi, edgesApi } from "../lib/api";

const LEAGUE_META = {
  mlb: { icon: "", title: "MLB Games", periodLabel: "Inn" },
  nba: { icon: "", title: "NBA Games", periodLabel: "Qtr" },
  nfl: { icon: "", title: "NFL Games", periodLabel: "Qtr" },
  cfb: { icon: "", title: "College Football", periodLabel: "Qtr" },
  nhl: { icon: "", title: "NHL Games", periodLabel: "Per" },
};

export default function LiveScoresPage({ league = "mlb" }) {
  const activeLeague = (LEAGUE_META[league] ? league : "mlb");
  const meta = LEAGUE_META[activeLeague];
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [filter, setFilter] = useState("All");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const timer = useRef(null);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  // WZ-SCORES-TERMINAL-2026-07-02 :: desktop detection (same pattern as Home.jsx)
  const [isDesktop,setIsDesktop]=useState(typeof window!=="undefined"&&window.innerWidth>=1024);
  useEffect(()=>{ const on=()=>setIsDesktop(window.innerWidth>=1024); window.addEventListener("resize",on); return ()=>window.removeEventListener("resize",on); },[]);
  // league news wire (server-cached; feeds the terminal tape + right-rail panel)
  const [news,setNews]=useState(null);
  useEffect(()=>{ let dead=false; setNews(null);
    newsApi.getFeed(activeLeague).then(d=>{ if(!dead) setNews(d?.items||[]); }).catch(()=>{ if(!dead) setNews([]); });
    return ()=>{ dead=true; };
  },[activeLeague]);
  // WZ-SCORES-EDGEBOARD-2026-07-02 :: NFL/CFB model board for the terminal (training
  // mode). Same endpoints the Market page reads; desktop-only fetch.
  const [fbBoard,setFbBoard]=useState(null);
  useEffect(()=>{ let dead=false; setFbBoard(null);
    if(!isDesktop || (activeLeague!=="nfl" && activeLeague!=="cfb")) return;
    (activeLeague==="cfb"?edgesApi.getCFB():edgesApi.getNFL()).then(d=>{ if(!dead) setFbBoard(d||{}); }).catch(()=>{ if(!dead) setFbBoard({}); });
    return ()=>{ dead=true; };
  },[activeLeague,isDesktop]);

  // WZ-SCORES-ODDS-2026-07-02 :: live odds for the terminal cards (NFL/CFB only —
  // MLB/NBA have their own boards; desktop-only fetch, mobile never requests this)
  const [fbOdds,setFbOdds]=useState(null);
  useEffect(()=>{ let dead=false; setFbOdds(null);
    if(!isDesktop || (activeLeague!=="nfl" && activeLeague!=="cfb")) return;
    edgesApi.getFbOdds(activeLeague).then(d=>{ if(!dead) setFbOdds(d?.games||[]); }).catch(()=>{ if(!dead) setFbOdds([]); });
    const t=setInterval(()=>{ edgesApi.getFbOdds(activeLeague).then(d=>{ if(!dead) setFbOdds(d?.games||[]); }).catch(()=>{}); },5*60000);
    return ()=>{ dead=true; clearInterval(t); };
  },[activeLeague,isDesktop]);

  const load = useCallback(async (showSpinner) => {
    if (showSpinner) setLoading(true);
    setError(false);
    try {
      const d = await scoresApi.getScores(activeLeague);
      setData(d);
      setRefreshedAt(new Date());
    } catch (e) {
      console.error("Failed to load scores:", e);
      if (showSpinner) setError(true);
    }
    if (showSpinner) setLoading(false);
  }, [activeLeague]);

  // initial load + 30s auto-refresh (silent)
  useEffect(() => {
    load(true);
    timer.current = setInterval(() => load(false), 30000);
    return () => clearInterval(timer.current);
  }, [load]);

  const live = data?.live || [];
  const upcoming = data?.upcoming || [];
  const final = data?.final || [];
  const total = live.length + upcoming.length + final.length;
  const off = getOffSeason(activeLeague);
  // Filter chips mirror the MLB Games page (All / Live / Upcoming / Final).
  const FILTS = ["All", "Live", "Upcoming", "Final"];
  const showLive = (filter === "All" || filter === "Live") && live.length > 0;
  const showPre  = (filter === "All" || filter === "Upcoming") && upcoming.length > 0;
  const showFin  = (filter === "All" || filter === "Final") && final.length > 0;
  const nothing  = !loading && !error && total > 0 && !(showLive || showPre || showFin);

  // Sport pills route the same way the MLB Games page does: MLB → /games (that
  // page), NBA → /nba (its own edges page), everything else → /{key}-games (this
  // same component, different league). The active league pill is highlighted.
  const goSport = (key) => {
    if (key === activeLeague) return;
    if (key === "mlb") navigate("/games");
    else if (key === "nba") navigate("/nba");
    else navigate(`/${key}-games`);
  };

  if (isDesktop) return (
    <ScoresTerminal activeLeague={activeLeague} meta={meta} goSport={goSport} navigate={navigate}
      filter={filter} setFilter={setFilter} FILTS={FILTS}
      live={live} upcoming={upcoming} final={final} total={total} off={off}
      showLive={showLive} showPre={showPre} showFin={showFin} nothing={nothing}
      loading={loading} error={error} retry={()=>load(true)} refreshedAt={refreshedAt}
      plan={plan} news={news} fbOdds={fbOdds} fbBoard={fbBoard}/>
  );

  return (
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
            <b key={key} className={key===activeLeague?"on":""} onClick={()=>goSport(key)}><span className="dot"/>{lb}</b>
          ))}
        </div>
      </div>


      {/* WZ-MTICKER-2026-07-03 :: mobile live ticker tape (this league's scores backbone,
          news/injury alerts woven in). Explicitly requested for nfl/cfb/nhl (+nba on its
          own page); mirrors the MLB Home ticker's classes and rhythm. */}
      {/* WZ-MTICKER-MOVED-2026-07-05 :: NFL/CFB ticker moved to the Edges board; suppressed here so it isn't duplicated on the Games tab. NHL keeps it. */}
      {(()=>{
        if(activeLeague==="nfl"||activeLeague==="cfb") return null;
        const sc=(g)=>({kind:"score",a:g.away?.abbrev||"",h:g.home?.abbrev||"",as:g.away?.score??null,hs:g.home?.score??null,state:g.statusDetail||""});
        const backbone=(live.length||final.length)?[...live.map(sc),...final.slice(0,6).map(g=>({...sc(g),state:"Final"}))]:upcoming.slice(0,10).map(g=>({kind:"score",a:g.away?.abbrev||"",h:g.home?.abbrev||"",as:null,hs:null,state:g.statusDetail||""}));
        const alerts=(news||[]).filter(n=>n.scratch||n.status==="injury"||n.type==="headline").slice(0,6)
          .map(n=>({kind:n.scratch?"scr":n.status==="injury"?"inj":"news",name:n.playerName||"",text:String(n.headline||"").slice(0,80)}));
        const items=(()=>{ const out=[]; let si=0,ai=0;
          while(si<backbone.length||ai<alerts.length){ if(si<backbone.length)out.push(backbone[si++]); if(si<backbone.length)out.push(backbone[si++]); if(ai<alerts.length)out.push(alerts[ai++]); }
          return out; })();
        if(!items.length) return null;
        let loop=[...items]; while(loop.length<10) loop=loop.concat(items);
        return <div className="stbar"><div className="stwrap"><div className="sttrack">{[...loop,...loop].map((s,i)=>(
          s.kind==="score"
            ? <span key={i}><span className="g">{s.a}</span> {s.as!=null?<span className="sc">{s.as}</span>:null} <span className="g">{s.h}</span> {s.hs!=null?<span className="sc">{s.hs}</span>:null} <span className="st">{s.state}</span></span>
            : <span key={i} className="it"><span className={"tg "+s.kind}>{s.kind==="scr"?"SCR":s.kind==="inj"?"INJ":"NEWS"}</span><span className="tx">{s.name?<b>{s.name}</b>:null}{s.name?" ":""}{s.text}</span></span>
        ))}</div></div></div>; })()}

      <div className="chips">{FILTS.map(f => <b key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>{f}</b>)}</div>

      <div id="wrap">
        <div className="seclbl" style={{marginTop:14}}>{meta.title.toUpperCase()}
          {refreshedAt && <span className="c" style={{marginLeft:"auto"}}>updated {refreshedAt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} · auto-refreshes</span>}
        </div>
        <div className="subln">Live scores · <span className="hot">tap a game</span> for the box score &amp; full analysis</div>

        {loading && <div className="estate"><div className="et">Loading today's games…</div><div className="es">Pulling the slate.</div></div>}
        {!loading && error && <div className="estate"><div className="et">Couldn't load scores</div><div className="es" onClick={()=>load(true)} style={{cursor:"pointer",color:"var(--blue)"}}>Tap to retry</div></div>}
        {!loading && !error && total === 0 && (
          <div className="estate"><div className="et">No games right now</div><div className="es">{off || `No ${activeLeague.toUpperCase()} games on the slate today.`}</div></div>
        )}
        {!loading && !error && total > 0 && (
          <>
            {showLive && (
              <Section title="LIVE NOW" color="var(--red)" count={live.length} defaultOpen liveDot>
                {live.map((g) => <GameCard key={g.id} g={g} league={activeLeague} meta={meta} />)}
              </Section>
            )}
            {showPre && (
              <Section title="UPCOMING" color="var(--mut)" count={upcoming.length} defaultOpen>
                {upcoming.map((g) => <GameCard key={g.id} g={g} league={activeLeague} meta={meta} />)}
              </Section>
            )}
            {showFin && (
              <Section title="FINAL" color="var(--green)" count={final.length} defaultOpen={live.length === 0}>
                {final.map((g) => <GameCard key={g.id} g={g} league={activeLeague} meta={meta} />)}
              </Section>
            )}
            {nothing && <div className="estate"><div className="et">Nothing here yet</div><div className="es">No {filter.toLowerCase()} games right now.</div></div>}
          </>
        )}
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
  );
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
.wpcap{display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:6px}
.proj{display:flex;justify-content:space-around;text-align:center;margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
.proj .p .k{font-family:var(--mono);font-size:8.5px;color:var(--mut2);font-weight:600}.proj .p .v{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;margin-top:2px}.proj .p .v.g{color:var(--green)}
.orow{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}.orow:first-of-type{border-top:none}
.orow .ol{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;width:64px;flex:0 0 auto}
.orow .os{font-family:var(--mono);font-size:11px;color:#aeb9c8;flex:1}.orow .os b{color:#fff}
.orow .oe{font-family:var(--disp);font-weight:800;font-size:15px;flex:0 0 auto}.oe.pos{color:var(--green)}.oe.neg{color:var(--mut)}
.pcard{display:flex;gap:11px;padding:10px 0;border-top:1px solid rgba(255,255,255,.05)}.pcard:first-of-type{border-top:none}
.pcard .pl{width:34px;height:34px;border-radius:50%;background:#1B2025;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}.pcard .pl img{width:27px;height:27px;object-fit:contain}
.pcard .pn{font-weight:700;font-size:13px;color:#eaf1ee}.pcard .ph{font-family:var(--mono);font-size:9px;color:var(--mut)}
.pcard .pstats{display:flex;gap:13px;margin-left:auto;text-align:right}
.pcard .pstats .st .k{font-family:var(--mono);font-size:8px;color:var(--mut2)}.pcard .pstats .st .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#cfe2f5}
.mr{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.mr:first-of-type{border-top:none}
.mr .md{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.md.strong{background:var(--green)}.md.soft{background:var(--gold)}.md.split{background:var(--mut)}
.mr .mk{font-family:var(--disp);font-weight:800;font-size:11px;color:var(--mut);width:42px;flex:0 0 auto}
.mr .mv{font-family:var(--mono);font-size:11px;color:#cdd7e1;flex:1}.mr .mv b{color:#fff}
.mr .ma{font-family:var(--mono);font-size:10px;font-weight:600;flex:0 0 auto}.ma.ag{color:var(--green)}.ma.df{color:var(--gold)}
.ctx{display:flex;flex-wrap:wrap;gap:7px}
.ctx .ch{font-family:var(--mono);font-size:10px;color:#aeb9c8;background:#1B2025;border:1px solid var(--line2);border-radius:7px;padding:5px 9px}.ctx .ch b{color:#fff}
.why{font-size:12.5px;color:#c4cfd9;line-height:1.55}.why .wl{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.5px;color:var(--gold);display:block;margin-bottom:4px}

.lurow{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.lurow:first-of-type{border-top:none}
.lurow .ln{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1}
.lustat{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:6px;padding:3px 9px}.lustat.c{color:var(--green);background:rgba(63,203,145,.12)}.lustat.p{color:var(--gold);background:rgba(201,168,106,.12)}
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
.lurowf{display:flex;align-items:center;gap:9px;padding:5px 0;border-top:1px solid rgba(255,255,255,.04)}
.lurowf .o{font-family:var(--mono);font-size:10px;color:var(--mut2);width:14px;flex:0 0 auto}
.lurowf .nm{font-family:var(--ui);font-weight:600;font-size:12px;color:#dbe4e2;flex:1}
.lurowf .po{font-family:var(--mono);font-size:9px;color:var(--mut);width:28px;flex:0 0 auto}
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

.sp{flex:1}
.subln{font-size:12px;color:var(--mut);margin:2px 14px 4px;font-family:var(--ui)}
.subln .hot{color:var(--red);font-weight:600}
.secbody{display:flex;flex-direction:column;gap:8px;padding:0 14px}
}
.stbar{margin:2px 14px 4px;border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:0 10px;overflow:hidden}/* WZ-MTICKER-2026-07-03 */
.stwrap{overflow:hidden;display:flex;align-items:center}
.sttrack{display:inline-flex;gap:24px;white-space:nowrap;font-family:var(--mono);font-size:11.5px;color:var(--mut);padding:8px 0;animation:wztick 26s linear infinite}
.sttrack .g{color:#cfd7e2;font-weight:600}.sttrack .sc{color:#fff;font-weight:700}.sttrack .st{color:var(--mut2)}
.sttrack .it{display:inline-flex;align-items:center;gap:7px}
.sttrack .tg{font-family:var(--mono);font-weight:700;font-size:8.5px;letter-spacing:.6px;padding:2px 5px;border-radius:4px;border:1px solid}
.sttrack .tg.scr{color:#ff9d92;border-color:rgba(226,101,92,.5);background:rgba(226,101,92,.1)}
.sttrack .tg.inj{color:#ff9d92;border-color:rgba(226,101,92,.4);background:rgba(226,101,92,.08)}
.sttrack .tg.news{color:#7db8e8;border-color:rgba(93,169,232,.35);background:rgba(93,169,232,.07)}
.sttrack .tx b{color:#e8eef0;font-weight:700}
@keyframes wztick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
`;

// ── WZ-SCORES-TERMINAL-2026-07-02 :: desktop terminal for the scores pages ──────
function timeAgo(iso){ if(!iso) return ""; const m=Math.max(1,Math.round((Date.now()-new Date(iso).getTime())/60000));
  if(m<60) return `${m}m ago`; const h=Math.round(m/60); if(h<24) return `${h}h ago`; return `${Math.round(h/24)}d ago`; }
const NEWS_CHIP = (it) => it.scratch ? ["SCR","c-red"] : it.status==="injury" ? ["INJ","c-amber"]
  : it.status==="lineup" ? ["LINEUP","c-teal"] : it.type==="video" ? ["VIDEO","c-mut"]
  : it.type==="recap" ? ["RECAP","c-mut"] : it.type==="wire" ? ["WIRE","c-mut"] : ["NEWS","c-mut"];

function ScoresTerminal({ activeLeague, meta, goSport, navigate, filter, setFilter, FILTS,
  live, upcoming, final: fin, total, off, showLive, showPre, showFin, nothing,
  loading, error, retry, refreshedAt, plan, news, fbOdds, fbBoard }) {

  // WZ-SPORT-TERMINAL-2026-07-02 :: sport-first sections, mirroring the mobile nav.
  const [tab,setTab]=useState("edges");
  useEffect(()=>{ setTab("edges"); },[activeLeague]); // WZ-DASH-PARITY-2026-07-02
  const [ebMkt,setEbMkt]=useState("ml"); // WZ-WINNERS-V2-2026-07-04 :: Edge Board leads
  useEffect(()=>{ setEbMkt("ml"); },[activeLeague]);
  // WZ-ODDS-BOARD-2026-07-02 :: football odds are grouped into betting weeks
  // (Thu–Mon window; a 36h shift maps every game to its week's Monday anchor).
  const [weekIdx,setWeekIdx]=useState(0);
  useEffect(()=>{ setWeekIdx(0); },[activeLeague]);
  const [clock,setClock]=useState("");
  useEffect(()=>{ const f=()=>setClock(new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET"); f(); const t=setInterval(f,30000); return ()=>clearInterval(t); },[]);
  const marketsLive = live.length>0;
  const hasFull = plan?.isAdmin===true || plan?.tier==="pro" || plan?.tier==="elite";

  // tape: live scores first, then upcoming, then headlines — terminal ticker feel
  const esc=(x)=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const bits=[];
  live.slice(0,6).forEach(g=>bits.push(`<span class="tk"><span class="s">${esc(g.away?.abbrev||"")} ${esc(g.away?.score??"")} \u00b7 ${esc(g.home?.abbrev||"")} ${esc(g.home?.score??"")}</span><span class="v dn">${esc(g.statusDetail||"LIVE")}</span></span><span class="tdot"></span>`));
  upcoming.slice(0,6).forEach(g=>bits.push(`<span class="tk"><span class="s">${esc(g.away?.abbrev||"")} @ ${esc(g.home?.abbrev||"")}</span><span class="v up">${esc(g.statusDetail||"")}</span></span><span class="tdot"></span>`));
  (news||[]).slice(0,8).forEach(n=>{ const [lb]=NEWS_CHIP(n); bits.push(`<span class="tk"><span class="v ${n.scratch?"dn":"up"}">${lb}</span><span class="s">${esc(n.headline).slice(0,80)}</span></span><span class="tdot"></span>`); });
  const tapeHtml=bits.join("");

  const NAV = [
    ["BOARD", null],
    ["", "Dashboard", "/home"],
    ["", "Market Price", "/odds"],
    ["", "Market Read", "/market-read"],
    ["", "Props", "/props"],
    ["TRACK", null],
    ["", "Performance", "/performance"],
    ["", "WizePlays", "/expert-picks"],
    ["", "Wize Spin", "/daily-card"],
    ["SCORES", null],
    ["", "Games & Scores", "/games", true],
  ];

  // WZ-SCORES-ODDS-2026-07-02 :: match parsed odds events to scoreboard games by the
  // TEAM PAIR (both names must resolve to the same event — nickname collisions like
  // Tigers/Bulldogs can't false-match when away AND home must agree).
  const norm=(x)=>String(x||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
  const nameHit=(a,b)=>{ a=norm(a); b=norm(b); if(!a||!b) return false; return a===b||a.includes(b)||b.includes(a); };
  const oddsFor=(g)=>{ if(!Array.isArray(fbOdds)||!fbOdds.length) return null;
    const an=g.away?.name||g.away?.abbrev, hn=g.home?.name||g.home?.abbrev;
    return fbOdds.find(ev=>nameHit(ev.awayTeam,an)&&nameHit(ev.homeTeam,hn))||null; };

  const Sec = ({title, color, dot, items}) => items.length>0 && (
    <div className="tsec">
      <div className="sechd" style={{color}}>{dot && <span className="rd"/>}{title} <span className="c">· {items.length}</span></div>
      <div className="tgrid">{items.map(g=><GameCard key={g.id} g={g} league={activeLeague} meta={meta} odds={oddsFor(g)}/>)}</div>
    </div>
  );

  return (
    <div className="wpterm2"><style>{CSS}</style><style>{TCSS2}</style>
    <div className="wpterm">
      <div className="status">
        <div className="brand"><div className="logo">Wize<span className="b">Picks</span></div><div className="tag">TERMINAL</div></div>
        <div className="tape"><div className="tape-track" dangerouslySetInnerHTML={{ __html: tapeHtml + tapeHtml }}/></div>
        <div className="sright">
          <span className={"mkt"+(marketsLive?"":" off")}><span className="ldot"/> {marketsLive?"GAMES LIVE":"NO GAMES LIVE"}</span>
          <span className="clock">{clock||"\u2014"}</span>
          <div className="avatar" onClick={()=>navigate("/settings")}>{String(plan?.email||"W").slice(0,1).toUpperCase()}</div>
        </div>
      </div>
      <div className="body">
        <nav className="nav">
          {NAV.map((it,i)=> it[1]===null
            ? <div key={i} className="grp">{it[0]}</div>
            : <a key={i} className={it[3]?"on":""} onClick={()=>navigate(it[2])}><span className="i">{it[0]}</span>{it[1]}</a>)}
          <div className="spacer"/>
          <div className="upsell">
            <div className="h">{hasFull?"All-Access":"Go All-Access"}</div>
            <div className="d">{hasFull?"Your plan is active \u2014 every edge unlocked.":"Every edge, prop & live play \u2014 from $7/wk."}</div>
            <button onClick={()=>navigate(hasFull?"/settings":"/pricing")}>{hasFull?"Manage plan":"Unlock \u2014 from $7/wk"}</button>
          </div>
        </nav>

        <div className="content">
          <div className="maintop">
            <div><h1>{meta.title}</h1><div className="sub">{total} games · {activeLeague.toUpperCase()} · live scores {refreshedAt?`\u00b7 updated ${refreshedAt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`:""}</div></div>
            <div className="sportbar">
              {[["MLB","mlb"],["NBA","nba"],["NFL","nfl"],["NHL","nhl"],["CFB","cfb"]].map(([lb,k])=>(
                <div key={k} className={"sp"+(activeLeague===k?" on":"")} onClick={()=>(k==="mlb"||k==="nba")?navigate(`/home?sport=${k}`):goSport(k)}><span className="d"/>{lb}</div>
              ))}
            </div>
          </div>

          <div className="sectabs">{/* WZ-SPORT-TERMINAL-2026-07-02 */}
            {[["edges","EDGES"],["games","GAMES"],["odds","ODDS"],["news","NEWS"],["performance","PERFORMANCE"]].map(([k,lb])=>(
              <b key={k} className={tab===k?"on":""} onClick={()=>setTab(k)}>{lb}</b>
            ))}
          </div>

          {tab==="edges" && (()=>{ /* WZ-DASH-PARITY-2026-07-02 :: dashboard-style board */
            const isFb=(activeLeague==="nfl"||activeLeague==="cfb");
            if(!isFb) return (
              <div className="panel"><div className="phead"><div className="t">Edge Board</div></div>
                <div className="empty">The NHL model arrives with the season — edges will post here from day one.</div></div>
            );
            const B=fbBoard||{};
            const rows=(ebMkt==="ml"?B.moneylineEdges:ebMkt==="spread"?B.spreadEdges:B.totalsEdges)||[];
            const priced=(()=>{ const o=Array.isArray(fbOdds)?fbOdds:[]; return {
              ml:o.filter(e=>e.h2h?.away!=null).length, spr:o.filter(e=>e.spreads?.awayLine!=null).length, tot:o.filter(e=>e.totals?.line!=null).length, n:o.length }; })();
            const maxE=Math.max(1,...rows.map(r=>Math.abs(r.edge??0)));
            return (<>
            <div className="indices">
              <div className="idx teal"><div className="k">Games Priced</div><div className="v num">{priced.n||"—"}</div><div className="chg">{activeLeague.toUpperCase()} lookahead slate</div></div>
              <div className="idx green"><div className="k">Markets Live</div><div className="v num">{priced.ml+priced.spr+priced.tot}</div><div className="chg">ML {priced.ml} · SPR {priced.spr} · O/U {priced.tot}</div></div>
              <div className="idx purple"><div className="k">Model Edges</div><div className="v num">{Array.isArray(B.edges)?B.edges.length:"—"}</div><div className="chg">across all markets</div></div>
              <div className="idx amber"><div className="k">Status</div><div className="v lockv">IN TRAINING</div><div className="chg">{activeLeague==="nfl"?"calibrates in preseason":"calibrates when games start"}</div></div>
            </div>
            <div className="panel">
              <div className="phead"><div className="t">Edge Board</div>
                <div className="seg">{[["ml","Moneyline"],["spread","Spread"],["totals","Totals"]].map(([m,lb])=>(<b key={m} className={ebMkt===m?"on":""} onClick={()=>setEbMkt(m)}>{lb}</b>))}</div>
                <div className="right">provisional — 2025-seeded ratings, ungraded</div>
              </div>
              {fbBoard===null && <div className="empty">Running the model…</div>}
              {/* WZ-WINNERS-REMOVED-2026-07-05 :: Winners tab + render removed; Edge Board only */}
              {ebMkt!=="winners" && <>
              {fbBoard!==null && rows.length===0 && <div className="empty">No {ebMkt==="ml"?"moneyline":ebMkt} edges on this slate — the model agrees with the market here.</div>}
              {rows.length>0 && (()=>{ /* WZ-EB-PARITY-2026-07-02 :: dashboard column parity */
                // team abbr + logo lookup from the scoreboard feed (no hardcoded maps)
                const pool=[...live,...upcoming,...fin].flatMap(g=>[g.away,g.home]).filter(Boolean);
                const nrm=(x)=>String(x||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
                const metaFor=(full)=>{ const f=nrm(full); if(!f) return null;
                  return pool.find(t=>{ const n=nrm(t.name), a=nrm(t.abbrev); return (n&&(f.includes(n)||n.includes(f)))||(a&&f.split(" ").includes(a)); })||null; };
                const abbrOf=(full,m)=> m?.abbrev || String(full||"").split(" ").pop().slice(0,12);
                const mkKey=ebMkt==="totals"?"total":ebMkt;
                const bpKey=ebMkt==="ml"?"ml":ebMkt==="spread"?"spread":"total";
                const bookFor=(e)=>{ const bp=(fbBoard.marketByGame||{})[e.gameId]?.bestPrices?.[bpKey]; if(!bp) return null;
                  return e.side==="over"?bp.overBook : e.side==="under"?bp.underBook : e.side==="home"?bp.homeBook : bp.awayBook; };
                const moveFor=(e)=>{ const mv=(fbBoard.marketMovers||[]).find(m=>m.matchup===e.matchup&&m.market===mkKey&&m.side===e.side); return mv||null; };
                const pickLabel=(e)=>{ const t=teamsFor(e); const ab=e.side==="over"||e.side==="under"?String(e.side).toUpperCase():abbrOf(e.side==="home"?t.home:t.away, e.side==="home"?t.hm:t.am);
                  if(ebMkt==="ml") return ab+" ML";
                  if(ebMkt==="spread") return ab+(e.line!=null?` ${e.line>0?"+"+e.line:e.line}`:"");
                  return ab+(e.line!=null?` ${e.line}`:""); };
                const teamsFor=(e)=>{ const p=String(e.matchup||"").split(" @ "); const away=p[0]||"", home=p[1]||"";
                  return { away, home, am:metaFor(away), hm:metaFor(home) }; };
                const Spark=({mv})=>{ if(!mv) return <span className="xdash">—</span>;
                  const up=mv.dir==="up";
                  return <svg className="xspark" viewBox="0 0 64 18" preserveAspectRatio="none"><polyline points={up?"2,14 30,14 34,4 62,4":"2,4 30,4 34,14 62,14"} fill="none" stroke={up?"var(--up)":"var(--dn)"} strokeWidth="1.6"/></svg>; };
                return (<>
                <div className="xhead"><span>MATCHUP</span><span>MODEL PICK</span><span>MODEL %</span><span>BEST BOOK</span><span>LINE MOVE</span><span>EDGE</span><span className="xr">CONVICTION</span></div>
                {rows.slice(0,14).map((e,i)=>{ const t=teamsFor(e); const bk=bookFor(e); const mv=moveFor(e);
                  return (
                  <div key={i} className="xrow">
                    <span className="xm">
                      <span className="xlg">{t.am?.logo?<img src={t.am.logo} alt=""/>:<i>{abbrOf(t.away,t.am).slice(0,3)}</i>}{t.hm?.logo?<img src={t.hm.logo} alt=""/>:<i>{abbrOf(t.home,t.hm).slice(0,3)}</i>}</span>
                      <b>{abbrOf(t.away,t.am)}</b><em>@</em><b>{abbrOf(t.home,t.hm)}</b>
                    </span>
                    <span className="xpick"><i className="pk">PICK</i>{pickLabel(e)}</span>
                    <span className="xnum teal">{e.modelProb!=null?Math.round(e.modelProb*100)+"%":"—"}</span>
                    <span className="xbook"><b>{fmtAm(e.odds)}</b>{bk&&<span>{bk}</span>}</span>
                    <span className="xmove"><Spark mv={mv}/></span>
                    <span className="xedge"><b className={(e.edge??0)>=0?"up":"dn"}>{(e.edge>=0?"+":"")+(e.edge??0).toFixed(1)}%</b><span className="bar"><span style={{width:Math.min(100,Math.abs(e.edge??0)/maxE*100)+"%"}}/></span></span>
                    <span className="xst xr"><i className="prov">PROVISIONAL</i></span>
                  </div>
                );})}
                </>); })()}
              </>}
            </div>
            </>); })()}

          {tab==="odds" && (()=>{ /* WZ-ODDS-BOARD-2026-07-02 :: real odds board */
            const fmtDay=(iso)=>{ const d=new Date(iso); return d.toLocaleDateString("en-US",{weekday:"short",month:"numeric",day:"numeric",timeZone:"America/New_York"}); };
            const fmtKick=(iso)=>{ const d=new Date(iso); return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"America/New_York"})+" · "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})+" ET"; };
            const TUE=Date.UTC(2020,0,7); const weekKey=(iso)=>Math.floor((new Date(iso).getTime()-36*3600e3-TUE)/(7*864e5));
            const isFb=(activeLeague==="nfl"||activeLeague==="cfb");
            let weeks=[];
            if(isFb && Array.isArray(fbOdds) && fbOdds.length){
              const withT=fbOdds.filter(e=>e.commenceTime).sort((a,b)=>new Date(a.commenceTime)-new Date(b.commenceTime));
              const map=new Map();
              for(const ev of withT){ const k=weekKey(ev.commenceTime); if(!map.has(k)) map.set(k,[]); map.get(k).push(ev); }
              weeks=[...map.values()];
              const noT=fbOdds.filter(e=>!e.commenceTime);
              if(noT.length){ if(weeks.length) weeks[weeks.length-1]=[...weeks[weeks.length-1],...noT]; else weeks=[noT]; }
            }
            const cur=weeks[Math.min(weekIdx,Math.max(0,weeks.length-1))]||[];
            const wkLabel=(w)=>{ const ts=w.filter(e=>e.commenceTime); if(!ts.length) return "TBD"; return fmtDay(ts[0].commenceTime)+" – "+fmtDay(ts[ts.length-1].commenceTime); };
            const Cell=({top,bot})=>(<span className="obcell"><span>{top}</span><span>{bot}</span></span>);
            const bk=(b)=>b?<i className="obbk">{b}</i>:null;
            const Row=(ev,i)=>(
              <div key={i} className="obrow">
                <span className="obm"><b>{ev.awayTeam}</b><b className="h">@ {ev.homeTeam}</b></span>
                <span className="obk">{ev.commenceTime?fmtKick(ev.commenceTime):"—"}</span>
                <Cell top={<>{fmtAm(ev.h2h?.away)} {bk(ev.h2h?.awayBook)}</>} bot={<>{fmtAm(ev.h2h?.home)} {bk(ev.h2h?.homeBook)}</>}/>
                <Cell top={<>{fmtLine(ev.spreads?.awayLine)} <em>{fmtAm(ev.spreads?.away)}</em></>} bot={<>{fmtLine(ev.spreads?.homeLine)} <em>{fmtAm(ev.spreads?.home)}</em></>}/>
                <Cell top={<>O {ev.totals?.line??"—"} <em>{fmtAm(ev.totals?.over)}</em></>} bot={<>U {ev.totals?.line??"—"} <em>{fmtAm(ev.totals?.under)}</em></>}/>
              </div>
            );
            return (
            <div className="panel">
              <div className="phead"><div className="t">Odds Board</div>
                {isFb && weeks.length>1 && <div className="seg">{weeks.slice(0,5).map((w,i)=>(<b key={i} className={i===Math.min(weekIdx,weeks.length-1)?"on":""} onClick={()=>setWeekIdx(i)}>{wkLabel(w)}</b>))}</div>}
                <div className="right">best line across books · refreshes with the board</div>
              </div>
              {isFb && <>
                {fbOdds===null && <div className="empty">Loading odds…</div>}
                {Array.isArray(fbOdds) && fbOdds.length===0 && <div className="empty">No priced games yet — books post lines closer to the season.</div>}
                {cur.length>0 && <>
                  <div className="obhead"><span className="obm">MATCHUP</span><span className="obk">KICKOFF</span><span className="obcell">MONEYLINE</span><span className="obcell">SPREAD</span><span className="obcell">TOTAL</span></div>
                  <div className="oblist">{cur.map(Row)}</div>
                </>}
              </>}
              {activeLeague==="nhl" && <div className="empty">NHL odds arrive with the NHL model.</div>}
              {activeLeague==="nba" && <div className="empty">NBA odds live on the NBA board.</div>}
            </div>
            ); })()}

          {tab==="news" && (
            <div className="panel">
              <div className="phead"><div className="t">{activeLeague.toUpperCase()} News</div><div className="right">injuries · lineups · headlines</div></div>
              {news===null && <div className="empty">Loading the wire…</div>}
              {Array.isArray(news) && news.length===0 && <div className="empty">Quiet wire right now.</div>}
              {Array.isArray(news) && news.length>0 && <div className="nlist">
                {news.map((it,i)=>{ const [lb,cls]=NEWS_CHIP(it); return (
                  <a key={it.id||i} className="nit big" href={it.link} target="_blank" rel="noopener noreferrer">
                    <span className={"nchip "+cls}>{lb}</span>
                    <span className="nbody"><span className="nhl">{it.headline}</span>
                      {it.summary && <span className="nsum">{it.summary}</span>}
                      <span className="nmeta">{(it.source||"").toUpperCase()} {it.published?`· ${timeAgo(it.published)}`:""}</span></span>
                  </a>
                );})}
              </div>}
            </div>
          )}

          {tab==="performance" && (
            <div className="panel">
              <div className="phead"><div className="t">Performance</div><div className="right">graded picks · honest record</div></div>
              {activeLeague==="mlb"
                ? <div className="empty">The full MLB performance dashboard — ROI, win rate, CLV, market splits — lives on its own page. <span className="dashlink" onClick={()=>navigate("/performance")}>Open Performance ›</span></div>
                : <div className="empty">{activeLeague.toUpperCase()} grading begins when real games are played {activeLeague==="nfl"?"(preseason, early August)":activeLeague==="cfb"?"(late August)":"(with the season)"} — every pick will be tracked and graded here from day one.</div>}
            </div>
          )}
        </div>

        <div className="rail">{/* WZ-DASH-PARITY-2026-07-02 :: dashboard-style rail */}
          <div className="panel">
            <div className="phead"><div className="t">Live</div><div className="right">{live.length>0?<><span className="ldot"/>{live.length} now</>:"today"}</div></div>
            {live.length===0 && upcoming.length===0 && <div className="empty">No {activeLeague.toUpperCase()} games today.</div>}
            {[...live.slice(0,4),...upcoming.slice(0,Math.max(0,6-live.length))].map((g,i)=>(
              <div key={i} className="lvrow">
                <span className="lvtm">{g.away?.abbrev} @ {g.home?.abbrev}</span>
                {g.bucket==="live"
                  ? <span className="lvsc dn">{g.away?.score}–{g.home?.score} · {g.statusDetail||"LIVE"}</span>
                  : <span className="lvsc">{g.statusDetail||""}</span>}
              </div>
            ))}
          </div>
          {(activeLeague==="nfl"||activeLeague==="cfb") && <>
          <div className="panel" style={{marginTop:12}}>
            <div className="phead"><div className="t">Market Movers</div><div className="right">open → now</div></div>
            {(!fbBoard||!Array.isArray(fbBoard.marketMovers)||fbBoard.marketMovers.length===0)
              ? <div className="empty">Lines barely move this far out — movers fill in as the season nears.</div>
              : fbBoard.marketMovers.slice(0,8).map((m,i)=>(
                <div key={i} className="mvrow">
                  <span className={"mvd "+(m.dir==="up"?"up":"dn")}>{m.dir==="up"?"▲":"▼"}</span>
                  <span className="mvb"><b>{String(m.side||"").toUpperCase()} {String(m.market||"").toUpperCase()}{m.line!=null?` ${m.line>0?"+"+m.line:m.line}`:""}</b><span className="mvm">{m.matchup}</span></span>
                  <span className="mvo">{fmtAm(m.open)} → {fmtAm(m.now)}</span>
                </div>
              ))}
          </div>
          <div className="panel" style={{marginTop:12}}>
            <div className="phead"><div className="t">Market Price</div><div className="right">best ML</div></div>
            {!Array.isArray(fbOdds)||fbOdds.length===0
              ? <div className="empty">Prices post closer to the season.</div>
              : fbOdds.filter(e=>e.h2h?.away!=null).slice(0,6).map((ev,i)=>(
                <div key={i} className="lvrow">
                  <span className="lvtm">{ev.awayTeam.split(" ").pop()} @ {ev.homeTeam.split(" ").pop()}</span>
                  <span className="lvsc">{fmtAm(ev.h2h.away)} / {fmtAm(ev.h2h.home)}</span>
                </div>
              ))}
          </div>
          </>}
        </div>
      </div>
    </div>
    </div>
  );
}

const TCSS2 = `
/* WZ-SCORES-TERMINAL-2026-07-02 :: terminal chrome (mirrors HomeDesktop) + scores grid + news wire */
.wpterm{--panel:#14171B;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);--teal:#3FCB91;--up:#46E0A9;--dn:#E2655C;--amber:#C9A86A;--tx:#ECEFF2;--mut:#99A2AA;--mut2:#5B646C;--mono:'IBM Plex Mono',ui-monospace,monospace;--disp:'Barlow Condensed',sans-serif;--serif:Georgia,'Times New Roman',serif;background:#0A0B0D;min-height:100vh;color:#e8eef0;font-family:'Inter',sans-serif;display:flex;flex-direction:column}
.wpterm .status{position:sticky;top:0;z-index:30;flex:0 0 52px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px;height:52px;padding:0 18px;border-bottom:1px solid var(--line);background:#0E1013}
.wpterm .brand{display:flex;align-items:center;gap:9px}
.wpterm .logo{font-family:var(--serif);font-weight:600;font-size:23px;letter-spacing:-.3px}.wpterm .logo .b{color:var(--amber)}
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
.wpterm .avatar{width:30px;height:30px;border-radius:8px;background:#1B2025;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:var(--mut);cursor:pointer}
.wpterm .body{flex:1 0 auto;display:grid;grid-template-columns:clamp(176px,11vw,210px) minmax(0,1fr) clamp(270px,20vw,340px);align-items:start}
.wpterm .nav{position:sticky;top:52px;align-self:start;height:calc(100vh - 52px);border-right:1px solid var(--line);background:#080a11;display:flex;flex-direction:column;padding:12px 10px;gap:3px;overflow:auto}
.wpterm .nav .grp{font-size:9.5px;font-weight:800;letter-spacing:1.4px;color:var(--mut2);padding:12px 10px 5px}
.wpterm .nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:#aeb9c8;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;position:relative}
.wpterm .nav a .i{width:17px;text-align:center;font-size:14px}
.wpterm .nav a:hover{background:#0e1320;color:#fff}
.wpterm .nav a.on{background:rgba(201,168,106,.1);color:var(--tx);border-color:rgba(201,168,106,.32)}
.wpterm .nav a.on::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--teal)}
.wpterm .nav .spacer{flex:1}
.wpterm .nav .upsell{margin:8px 4px 4px;border:1px solid rgba(201,168,106,.28);border-radius:11px;background:rgba(201,168,106,.05);padding:12px}
.wpterm .nav .upsell .h{font-family:var(--disp);font-weight:800;font-size:16px;color:#cdbcff}
.wpterm .nav .upsell .d{font-size:10.5px;color:var(--mut);margin:4px 0 9px;line-height:1.4}
.wpterm .nav .upsell button{width:100%;border:0;border-radius:8px;background:var(--teal);color:#04130d;font-weight:800;font-size:12px;padding:8px;cursor:pointer;font-family:inherit}
.wpterm .content{padding:clamp(11px,0.95vw,15px) clamp(12px,1.2vw,18px) 40px;display:flex;flex-direction:column;gap:clamp(10px,0.9vw,13px);min-width:0}
.wpterm .maintop{display:flex;align-items:flex-end;justify-content:space-between}
.wpterm .maintop h1{font-family:var(--disp);font-weight:800;font-size:clamp(20px,1.7vw,26px);margin:0}
.wpterm .maintop .sub{font-size:12px;color:var(--mut);margin-top:1px;font-family:var(--mono)}
.wpterm .sportbar{display:flex;gap:5px}
.wpterm .sportbar .sp{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--mut);padding:7px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);cursor:pointer}
.wpterm .sportbar .sp.on{color:#fff;border-color:var(--line2);background:#111726}.wpterm .sportbar .sp.on .d{background:var(--up)}
.wpterm .sportbar .sp .d{width:6px;height:6px;border-radius:50%;background:var(--mut2)}
.wpterm .panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.wpterm .phead{display:flex;align-items:center;gap:12px;padding:11px 15px;border-bottom:1px solid var(--line)}
.wpterm .phead .t{font-family:var(--disp);font-weight:800;font-size:clamp(13px,1vw,15.5px);letter-spacing:.4px;display:flex;align-items:center;gap:8px}
.wpterm .phead .seg{display:flex;gap:2px;background:#080b12;border:1px solid var(--line);border-radius:9px;padding:3px;margin-left:6px}
.wpterm .phead .seg b{font-size:11.5px;font-weight:700;color:var(--mut);padding:5px 12px;border-radius:6px;cursor:pointer}
.wpterm .phead .seg b.on{background:#16203a;color:#fff;box-shadow:inset 0 0 0 1px rgba(38,116,176,.35)}
.wpterm .phead .right{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mut)}
.wpterm .phead .right .ldot{width:6px;height:6px}
.wpterm .empty{padding:22px 16px;color:var(--mut);font-size:12.5px}
.wpterm .rd{width:6px;height:6px;border-radius:50%;background:var(--dn);animation:wppulse 1.4s infinite}
.wpterm .tsec{padding:4px 0 8px}
.wpterm .sechd{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;letter-spacing:1.1px;padding:11px 15px 2px;font-family:var(--disp)}
.wpterm .sechd .c{font-family:var(--mono);font-size:10px;color:var(--mut2);font-weight:600;letter-spacing:0}
.wpterm .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:11px;padding:10px 15px 8px}
.wpterm .tgrid .gc{margin:0;background:#171c22}
.wpterm .nlist{display:flex;flex-direction:column}
.wpterm .nit{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-top:1px solid rgba(255,255,255,.05);text-decoration:none;color:inherit}
.wpterm .nit:first-child{border-top:none}
.wpterm .nit:hover{background:rgba(255,255,255,.025)}
.wpterm .nchip{flex:0 0 auto;font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.06em;border-radius:5px;padding:3px 7px;margin-top:1px}
.wpterm .nchip.c-red{color:#ff9d92;background:rgba(226,101,92,.13);border:1px solid rgba(226,101,92,.3)}
.wpterm .nchip.c-amber{color:var(--amber);background:rgba(201,168,106,.1);border:1px solid rgba(201,168,106,.3)}
.wpterm .nchip.c-teal{color:var(--up);background:rgba(63,203,145,.1);border:1px solid rgba(63,203,145,.28)}
.wpterm .nchip.c-mut{color:var(--mut);background:#1B2025;border:1px solid var(--line2)}
.wpterm .nbody{min-width:0}
.wpterm .nhl{display:block;font-size:12px;font-weight:600;color:#dbe4e2;line-height:1.4}
.wpterm .nmeta{display:block;font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:3px}
.wpterm .nav{position:sticky;left:auto;right:auto;bottom:auto;transform:none;width:auto;max-width:none;border-top:none;justify-content:flex-start;z-index:1}
.wpterm .nav a{flex-direction:row;font-family:'Inter',sans-serif;font-size:13px;letter-spacing:0}
.wpterm .sportbar .sp{flex:0 0 auto}
.wpterm .godds{display:flex;flex-wrap:wrap;gap:6px;padding:8px 13px;border-top:1px solid rgba(255,255,255,.05)}
.wpterm .gob{font-family:var(--mono);font-size:10.5px;color:#cdd7e1;background:#10141a;border:1px solid var(--line2);border-radius:7px;padding:4px 8px;white-space:nowrap}
.wpterm .gob i{font-style:normal;color:var(--mut2);margin-right:6px;font-size:9px;letter-spacing:.05em}
.wpterm .trainpill{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.08em;color:var(--amber);background:rgba(201,168,106,.1);border:1px solid rgba(201,168,106,.32);border-radius:999px;padding:4px 10px}
.wpterm .eblist{display:flex;flex-direction:column}
.wpterm .ebrow{display:flex;align-items:center;gap:12px;padding:9px 15px;border-top:1px solid rgba(255,255,255,.05)}
.wpterm .ebrow:first-child{border-top:none}
.wpterm .ebm{font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .ebmk{font-family:var(--mono);font-size:9.5px;color:var(--mut2);width:74px;flex:0 0 auto}
.wpterm .ebp{font-family:var(--mono);font-size:11.5px;color:#cdd7e1;flex:0 0 auto;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .ebe{font-family:var(--disp);font-weight:800;font-size:14px;flex:0 0 auto;width:58px;text-align:right}
.wpterm .ebq{font-family:var(--mono);font-size:8.5px;color:var(--mut2);border:1px solid var(--line2);border-radius:5px;padding:2px 6px;flex:0 0 auto}
.wpterm .sectabs{display:flex;gap:6px}
.wpterm .sectabs b{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--mut);border:1px solid var(--line2);border-radius:8px;padding:7px 14px;cursor:pointer;background:var(--panel)}
.wpterm .sectabs b.on{color:#06090b;background:var(--amber);border-color:var(--amber)}
.wpterm .dashlink{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--up);cursor:pointer;white-space:nowrap;margin-left:10px}
.wpterm .nit.big .nhl{font-size:13px}
.wpterm .nsum{display:block;font-size:11px;color:var(--mut);margin-top:3px;line-height:1.45}
.wpterm .obhead,.wpterm .obrow{display:grid;grid-template-columns:minmax(220px,1.4fr) 150px 1fr 1fr 1fr;gap:14px;align-items:center;padding:10px 15px}
.wpterm .obhead{font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--mut2);border-bottom:1px solid var(--line);padding-bottom:8px}
.wpterm .obrow{border-top:1px solid rgba(255,255,255,.05)}
.wpterm .obrow:hover{background:rgba(255,255,255,.02)}
.wpterm .obm{display:flex;flex-direction:column;gap:2px;min-width:0}
.wpterm .obm b{font-family:var(--disp);font-weight:800;font-size:14.5px;color:#eef3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .obm b.h{color:#aeb9c8}
.wpterm .obk{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.wpterm .obcell{display:flex;flex-direction:column;gap:3px;font-family:var(--mono);font-size:12px;color:#e6ecef;font-variant-numeric:tabular-nums}
.wpterm .obcell em{font-style:normal;color:var(--mut)}
.wpterm .obbk{font-style:normal;font-size:8.5px;color:var(--mut2);margin-left:5px}
.wpterm .phead .seg b{white-space:nowrap}
.wpterm .rail{position:sticky;top:52px;align-self:start;max-height:calc(100vh - 52px);overflow:auto;padding:clamp(11px,0.95vw,15px) clamp(12px,1.2vw,18px) 40px clamp(2px,0.4vw,6px)}
.wpterm .indices{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}
.wpterm .idx{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:12px 14px}
.wpterm .idx .k{font-size:10px;font-weight:800;letter-spacing:.8px;color:var(--mut);text-transform:uppercase}
.wpterm .idx .v{font-family:var(--mono);font-weight:600;font-size:clamp(20px,1.8vw,27px);line-height:1.05;margin-top:5px}
.wpterm .idx .v.lockv{font-size:19px;letter-spacing:.02em}
.wpterm .idx .chg{font-family:var(--mono);font-size:11px;font-weight:600;margin-top:3px;color:var(--mut)}
.wpterm .idx.teal .v{color:var(--up)}.wpterm .idx.green .v{color:var(--tx)}.wpterm .idx.amber .v{color:var(--amber)}.wpterm .idx.purple .v{color:var(--tx)}
.wpterm .xhead,.wpterm .xrow{display:grid;grid-template-columns:minmax(170px,1.25fr) minmax(120px,.9fr) 76px 100px 92px minmax(130px,1fr) 108px;gap:14px;align-items:center;padding:13px 16px}
.wpterm .xhead{font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--mut2);border-bottom:1px solid var(--line);padding-bottom:8px}
.wpterm .xrow{border-top:1px solid rgba(255,255,255,.05)}
.wpterm .xrow:hover{background:rgba(255,255,255,.02)}
.wpterm .xm{font-family:var(--disp);font-weight:800;font-size:14px;color:#eef3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .xpick{font-family:var(--mono);font-size:11.5px;color:#e6ecef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .xpick .pk{font-style:normal;font-size:8px;font-weight:700;color:#0a1310;background:var(--up);border-radius:4px;padding:2px 5px;margin-right:8px;letter-spacing:.05em}
.wpterm .xnum{font-family:var(--mono);font-size:12px;color:#e6ecef;font-variant-numeric:tabular-nums}
.wpterm .xedge b{font-family:var(--disp);font-weight:800;font-size:14px}
.wpterm .xedge .bar{display:block;height:3px;border-radius:2px;background:#10151b;margin-top:5px;overflow:hidden}
.wpterm .xedge .bar span{display:block;height:100%;background:var(--up);border-radius:2px}
.wpterm .xst .prov{font-style:normal;font-family:var(--mono);font-size:8.5px;font-weight:700;color:var(--amber);background:rgba(201,168,106,.1);border:1px solid rgba(201,168,106,.3);border-radius:999px;padding:3px 8px;letter-spacing:.05em}
.wpterm .lvrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;border-top:1px solid rgba(255,255,255,.05)}
.wpterm .lvrow:first-of-type{border-top:none}
.wpterm .lvtm{font-family:var(--disp);font-weight:800;font-size:13px;color:#dbe4e2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .lvsc{font-family:var(--mono);font-size:10.5px;color:var(--mut);white-space:nowrap}
.wpterm .mvrow{display:flex;align-items:flex-start;gap:9px;padding:9px 14px;border-top:1px solid rgba(255,255,255,.05)}
.wpterm .mvd{font-size:10px;margin-top:2px}
.wpterm .mvb{flex:1;min-width:0}
.wpterm .mvb b{display:block;font-family:var(--mono);font-size:11px;color:#e6ecef}
.wpterm .mvm{display:block;font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wpterm .mvo{font-family:var(--mono);font-size:10.5px;color:var(--mut);white-space:nowrap}
.wpterm .xhead .xr,.wpterm .xrow .xr{text-align:right;justify-self:end}
.wpterm .xm{display:flex;align-items:center;gap:8px;font-family:var(--disp);font-weight:800;font-size:15px;color:#eef3f5;white-space:nowrap;overflow:hidden}
.wpterm .xm em{font-style:normal;color:var(--mut2);font-size:12px;font-weight:600}
.wpterm .xlg{display:flex;align-items:center;flex:0 0 auto}
.wpterm .xlg img,.wpterm .xlg i{width:21px;height:21px;border-radius:50%;object-fit:contain;background:#1B2025;border:1px solid var(--line2)}
.wpterm .xlg i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:6.5px;color:var(--mut)}
.wpterm .xlg img+img,.wpterm .xlg img+i,.wpterm .xlg i+img,.wpterm .xlg i+i{margin-left:-6px}
.wpterm .xnum.teal{color:var(--up)}
.wpterm .xbook{display:flex;flex-direction:column;gap:2px;font-family:var(--mono)}
.wpterm .xbook b{font-size:12.5px;color:#e6ecef;font-weight:600}
.wpterm .xbook span{font-size:8.5px;color:var(--mut2)}
.wpterm .xmove{display:flex;align-items:center}
.wpterm .xspark{width:64px;height:18px}
.wpterm .xdash{color:var(--mut2);font-family:var(--mono);font-size:11px}
`;

function Section({ title, color, count, defaultOpen, liveDot, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 18 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10, padding: "0 14px" }}>
        {liveDot && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", animation: "pulse 1.2s infinite" }} />}
        <span style={{ fontSize: 12, letterSpacing: 1.2, color, fontWeight: 800 }}>{title}</span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>· {count}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && <div className="secbody">{children}</div>}
    </div>
  );
}

// Tapping a card opens the full matchup page. We navigate by the backend model
// id (detailId) when we have it, otherwise fall back to ESPN's own game id so
// the card is always clickable — the detail page knows how to resolve either.
const fmtAm=(o)=>o==null||isNaN(+o)?"\u2014":(+o>0?"+"+(+o):""+(+o));
const fmtLine=(l)=>l==null?"":(l>0?"+"+l:""+l);
function GameCard({ g, league, meta, odds }) {
  const navigate = useNavigate();
  const isLive = g.bucket === "live";
  const isFinal = g.bucket === "final";
  const rawId = g.detailId || g.id;
  // Detail pages exist for MLB/NBA; other leagues' detail arrives with the model
  // step, so don't route a card to a page that isn't wired yet.
  const HAS_DETAIL = { mlb: true, nba: true, nfl: true, cfb: true }; // WZ-FB-GAMEDETAIL-2026-07-16
  const target = rawId && HAS_DETAIL[league] ? `/game/${league}/${rawId}` : null;

  // Top strip mirrors the MLB Games card: live state, kickoff/first-pitch time,
  // or FINAL on the left; a short context note (series / venue) on the right.
  const statusCls = isLive ? "live" : isFinal ? "final" : "pre";
  const leftLabel = isLive
    ? <span className="gstat live"><span className="ld"/>LIVE {g.statusDetail ? `\u00b7 ${g.statusDetail}` : ""}</span>
    : isFinal
      ? <span className="gstat final">FINAL</span>
      : <span className="gstat pre">{g.statusDetail || "—"}</span>;
  const rightNote = g.seriesSummary || (!isLive && !isFinal ? g.venue : "") || "";

  return (
    <div className={"gc" + (isLive ? " live" : "")} onClick={() => { if (target) navigate(target); }} style={{ cursor: target ? "pointer" : "default" }}>
      <div className="gtop">{leftLabel}<span className="ou">{rightNote}</span></div>
      <TeamRow t={g.away} showScore={isLive || isFinal} />
      <TeamRow t={g.home} showScore={isLive || isFinal} />
      {odds && (odds.h2h?.away!=null || odds.spreads?.awayLine!=null || odds.totals?.line!=null) && (
        <div className="godds">{/* WZ-SCORES-ODDS-2026-07-02 :: desktop-only best-line strip */}
          {odds.h2h?.away!=null && odds.h2h?.home!=null && <span className="gob"><i>ML</i>{fmtAm(odds.h2h.away)} / {fmtAm(odds.h2h.home)}</span>}
          {odds.spreads?.awayLine!=null && <span className="gob"><i>SPR</i>{fmtLine(odds.spreads.awayLine)} {fmtAm(odds.spreads.away)}</span>}
          {odds.totals?.line!=null && <span className="gob"><i>O/U</i>{odds.totals.line} · {fmtAm(odds.totals.over)}/{fmtAm(odds.totals.under)}</span>}
        </div>
      )}
      {target && <div className="gfoot"><span className="lean"><span className="lb">{meta.title.replace(" Games","").toUpperCase()}</span></span><span className="go">View game {"\u203a"}</span></div>}
    </div>
  );
}

function TeamRow({ t, showScore }) {
  if (!t) return null;
  const ab = t.abbrev || t.abbreviation || "";
  return (
    <div className="team">
      <span className="lg">{t.logo ? <img src={t.logo} alt="" /> : ab.slice(0, 3)}</span>
      <div className="tw">
        <div className="nm">{ab}</div>
        {(t.name || t.record) && <div className="rec">{[t.name, t.record ? `(${t.record})` : ""].filter(Boolean).join(" \u00b7 ")}</div>}
      </div>
      {showScore && <div className="scr">{t.score != null ? t.score : "\u2014"}</div>}
    </div>
  );
}

// Box score (innings/quarters line score + player stat lines). Exported so the
// full matchup page (GameDetail) can render the exact same component.
export function BoxScore({ detail, logos }) {
  const ls = detail.lineScore || [];
  const players = detail.players || [];
  const maxPeriods = Math.max(0, ...ls.map((r) => r.periods.length));

  // Convention: away team on TOP, home on BOTTOM. The feed sometimes delivers
  // these home-first, so we order them ourselves using the away team's abbrev
  // when we can resolve it from the detail payload. If we CAN'T identify the
  // away team (unknown data shape), we leave the original order untouched —
  // worst case is "no change", never a wrong sort.
  // Convention: away team on TOP, home on BOTTOM. Every line-score row carries
  // the feed's own homeAway flag, so order by that directly — reliable no matter
  // what shape the detail payload is. (Fallbacks: if a feed omits homeAway, match
  // the away abbrev; if even that's unknown, leave the order untouched — worst
  // case is "no change", never a wrong sort.)
  const awayAbbrev = (
    detail.away?.abbrev ||
    detail.away?.abbreviation ||
    detail.awayAbbrev ||
    detail.awayTeam?.abbrev ||
    null
  );
  const hasHomeAway = ls.some((r) => r.homeAway === "away" || r.homeAway === "home");
  const orderedLs = hasHomeAway
    ? [...ls].sort((a, b) => (a.homeAway === "away" ? 0 : 1) - (b.homeAway === "away" ? 0 : 1))
    : awayAbbrev
      ? [...ls].sort((a, b) => (a.abbrev === awayAbbrev ? 0 : 1) - (b.abbrev === awayAbbrev ? 0 : 1))
      : ls;

  const teams = {};
  for (const p of players) {
    if (p.didNotPlay) continue;
    (teams[p.team] ||= []).push(p);
  }
  // Team logos for the box score (abbrev -> logo URL), gathered from whatever
  // the detail payload provides; falls back to no logo if absent.
  const logoByAbbrev = {};
  for (const t of [detail.away, detail.home, detail.awayTeam, detail.homeTeam]) {
    const ab = t && (t.abbrev || t.abbreviation);
    if (ab && t.logo) logoByAbbrev[ab] = t.logo;
  }
  for (const r of ls) { if (r && r.abbrev && r.logo) logoByAbbrev[r.abbrev] = r.logo; }
  if (logos) for (const k in logos) { if (logos[k]) logoByAbbrev[k] = logos[k]; } // known-good logos passed from the score card
  const teamLogo = (ab) => logoByAbbrev[ab] || null;
  const COLS = {
    nba: ["MIN", "PTS", "REB", "AST"],
    mlb: ["AB", "R", "H", "RBI"],
  };
  const wanted = COLS[detail.league] || [];

  const cellNum = { textAlign: "center", padding: "5px 8px", color: "#cbd5e1", fontSize: 12.5, fontWeight: 400, fontVariantNumeric: "tabular-nums" };
  const headCell = { textAlign: "center", padding: "5px 8px", fontSize: 11, fontWeight: 600, color: "#ffffff", letterSpacing: "0.06em", textTransform: "uppercase" };

  return (
    <div>
      {/* line score (innings / quarters) */}
      {ls.length > 0 && maxPeriods > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
            {detail.league === "nba" ? "Quarters" : "Innings"}
          </div>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 320 }}>
            <thead>
              <tr style={{ background: "#0a0e14" }}>
                <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 11, fontWeight: 600, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase" }}>Team</th>
                {Array.from({ length: maxPeriods }).map((_, i) => (
                  <th key={i} style={{ textAlign: "center", padding: "5px 8px", fontSize: 12, fontWeight: 600, color: "#9ca3af" }}>{i + 1}</th>
                ))}
                <th style={{ textAlign: "center", padding: "5px 8px", fontSize: 12, fontWeight: 600, color: "#9ca3af", borderLeft: "1px solid #3a4757" }}>T</th>
              </tr>
            </thead>
            <tbody>
              {orderedLs.map((r, idx) => (
                <tr key={idx} style={{ borderTop: "1px solid #4b5563" }}>
                  <td style={{ padding: "5px 8px", fontWeight: 800, color: "#fff", fontSize: 13 }}>
                    {teamLogo(r.abbrev) && <img src={teamLogo(r.abbrev)} alt="" width="18" height="18" style={{ objectFit: "contain", verticalAlign: "middle", marginRight: 7 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                    <span style={{ verticalAlign: "middle" }}>{r.abbrev}</span>
                  </td>
                  {Array.from({ length: maxPeriods }).map((_, i) => (
                    <td key={i} style={{ textAlign: "center", padding: "5px 8px", color: "#cbd5e1", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{r.periods[i] != null ? r.periods[i] : "·"}</td>
                  ))}
                  <td style={{ textAlign: "center", padding: "5px 8px", color: "#fff", fontWeight: 700, fontSize: 14, borderLeft: "1px solid #3a4757", fontVariantNumeric: "tabular-nums" }}>{r.total != null ? r.total : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* player stats per team */}
      {Object.keys(teams).map((teamAbbrev) => {
        const roster = teams[teamAbbrev];

        // split batters vs pitchers by position (SP/RP/P = pitcher)
        const isPitcher = (p) => {
          const pos = String(p.position || "").toUpperCase();
          return pos === "SP" || pos === "RP" || pos === "P";
        };
        const batters = roster.filter((p) => !isPitcher(p));
        const pitchers = roster.filter(isPitcher);

        // batter columns: prefer our compact set, fall back to whatever exists
        const BAT = wanted.filter((c) => batters[0] && batters[0].stats[c] !== undefined);
        const batCols = BAT.length ? BAT : (batters[0]?.columns || []).slice(0, 4);

        // pitcher columns: standard pitching line, only those present
        const PIT_WANT = detail.league === "mlb" ? ["IP", "H", "R", "ER", "BB", "K", "ERA"] : [];
        const pitCols = PIT_WANT.filter((c) => pitchers[0] && pitchers[0].stats[c] !== undefined);

        // green highlight for productive batting lines (2+ H or 1+ RBI)
        const bigLine = (p) => {
          const h = parseInt(p.stats.H, 10);
          const rbi = parseInt(p.stats.RBI, 10);
          return (Number.isFinite(h) && h >= 2) || (Number.isFinite(rbi) && rbi >= 1);
        };

        const batterRows = batters.map((p, i) => {
          const hot = bigLine(p);
          return (
            <tr key={`b${i}`} style={{ borderTop: "1px solid #4b5563" }}>
              <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#e4e7eb", fontWeight: 600 }}>
                {p.shortName} {p.starter && <span style={{ color: "#22c55e", fontSize: 10 }}>•</span>} <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 500 }}>{p.position}</span>
              </td>
              {batCols.map((c) => {
                const greenCol = hot && (c === "H" || c === "RBI") && p.stats[c] && parseInt(p.stats[c], 10) > 0;
                return <td key={c} style={{ ...cellNum, color: greenCol ? "#22c55e" : "#cbd5e1", fontWeight: greenCol ? 700 : 400 }}>{p.stats[c] ?? ""}</td>;
              })}
            </tr>
          );
        });

        const pitcherRows = pitchers.map((p, i) => (
          <tr key={`p${i}`} style={{ borderTop: "1px solid #4b5563" }}>
            <td style={{ padding: "5px 8px", whiteSpace: "nowrap", color: "#e4e7eb", fontWeight: 600 }}>
              {p.shortName} <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 500 }}>{p.position}</span>
            </td>
            {pitCols.map((c) => <td key={c} style={cellNum}>{p.stats[c] ?? ""}</td>)}
          </tr>
        ));

        return (
          <div key={teamAbbrev} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #2a3340" }}>
              {teamLogo(teamAbbrev) && <img src={teamLogo(teamAbbrev)} alt="" width="22" height="22" style={{ objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>{teamAbbrev}</span>
            </div>

            {/* Batters */}
            <div style={{ overflowX: "auto", marginBottom: pitchers.length ? 12 : 0 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 320 }}>
                <thead>
                  <tr style={{ background: "#0a0e14" }}>
                    <th style={{ ...headCell, textAlign: "left" }}>Batters</th>
                    {batCols.map((c) => <th key={c} style={headCell}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>{batterRows}</tbody>
              </table>
            </div>

            {/* Pitchers — their own columns (IP H R ER BB K ERA) */}
            {pitchers.length > 0 && pitCols.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 320 }}>
                  <thead>
                    <tr style={{ background: "#0a0e14" }}>
                      <th style={{ ...headCell, textAlign: "left", color: "#9ca3af" }}>Pitchers</th>
                      {pitCols.map((c) => <th key={c} style={headCell}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>{pitcherRows}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {ls.length === 0 && players.length === 0 && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>No box score data available for this game yet.</div>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #1f2937", borderTopColor: "#ef4444", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 14px" }} />
      <div style={{ fontSize: 13, color: "#6b7280" }}>Loading scores…</div>
    </div>
  );
}
function ErrorState({ onRetry }) {
  return (
    <div style={{ textAlign: "center", padding: 64, background: "var(--panel)", border: "1px solid #16202a", borderRadius: 14 }}>
      
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Could not load scores</div>
      <button onClick={onRetry} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 8 }}>Retry</button>
    </div>
  );
}
function EmptyState({ icon, league }) {
  const offSeason = getOffSeason(league);
  if (offSeason) {
    return (
      <div style={{ background: "var(--panel)", border: "1px solid #16202a", borderRadius: 14, padding: 48, textAlign: "center" }}>
        
        <div style={{ fontSize: 16, fontWeight: 700 }}>Off season</div>
        <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>{offSeason}</div>
      </div>
    );
  }
  return (
    <div style={{ background: "var(--panel)", border: "1px solid #16202a", borderRadius: 14, padding: 48, textAlign: "center" }}>
      
      <div style={{ fontSize: 16, fontWeight: 700 }}>No games scheduled today</div>
      <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 6 }}>Check back when the next slate is posted.</div>
    </div>
  );
}

// Returns an off-season message if `league` is out of season right now, else null.
// Season windows are approximate (regular season + postseason):
//   MLB: late March → end of October   → off-season Nov 1 – ~Mar 20
//   NBA: mid-October → mid/late June    → off-season ~Jun 25 – mid-Oct
function getOffSeason(league) {
  const now = new Date();
  const m = now.getMonth(); // 0=Jan … 11=Dec
  const d = now.getDate();
  const lg = (league || "").toLowerCase();
  if (lg === "mlb") {
    // Off-season: Nov, Dec, Jan, Feb, and March before ~the 20th
    const off = m === 10 || m === 11 || m === 0 || m === 1 || (m === 2 && d < 20);
    return off ? "MLB returns in late March for Opening Day." : null;
  }
  if (lg === "nba") {
    // Off-season: late June (after ~the 25th) through mid-October (before ~the 18th)
    const off = (m === 5 && d > 25) || m === 6 || m === 7 || m === 8 || (m === 9 && d < 18);
    return off ? "The NBA returns in October for the new season." : null;
  }
  if (lg === "nfl") {
    // Season: early Sept → early Feb (Super Bowl). Off-season ~mid-Feb through August.
    const off = (m === 1 && d > 12) || (m >= 2 && m <= 7) || (m === 8 && d < 4);
    return off ? "The NFL returns in September for the new season." : null;
  }
  if (lg === "cfb") {
    // Season: late Aug → mid-Jan (CFP championship). Off-season ~late Jan through late Aug.
    const off = (m === 0 && d > 22) || (m >= 1 && m <= 6) || (m === 7 && d < 23);
    return off ? "College football returns in late August." : null;
  }
  if (lg === "nhl") {
    // Season: Oct → mid-June (Stanley Cup Final). Off-season ~late June through early Oct.
    const off = (m === 5 && d > 26) || m === 6 || m === 7 || (m === 8 && d < 4);
    return off ? "The NHL returns in October for the new season." : null;
  }
  return null;
}
