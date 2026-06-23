// LIVESCORES-PREMIUM-DARK-RESKIN-2026-06-23
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
import { subscriptionApi, scoresApi } from "../lib/api";

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
      {open && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 14px" }}>{children}</div>}
    </div>
  );
}

// Tapping a card opens the full matchup page. We navigate by the backend model
// id (detailId) when we have it, otherwise fall back to ESPN's own game id so
// the card is always clickable — the detail page knows how to resolve either.
function GameCard({ g, league, meta }) {
  const navigate = useNavigate();
  const isLive = g.bucket === "live";
  const isFinal = g.bucket === "final";
  const rawId = g.detailId || g.id;
  // Detail pages exist for MLB/NBA; other leagues' detail arrives with the model
  // step, so don't route a card to a page that isn't wired yet.
  const HAS_DETAIL = { mlb: true, nba: true };
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
