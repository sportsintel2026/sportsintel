import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { gamesApi, subscriptionApi } from "../lib/api";

// ── Static detail data (same as the artifact, now served to logged-in users) ──
const DETAILS = {
  // MLB
  m1: {
    h2h:{hW:1121,aW:1098,avg:"4.2–4.0",games:[{d:"Aug 19 '25",w:"Cubs",s:"5–3"},{d:"Aug 18 '25",w:"Astros",s:"7–4"},{d:"Jun 10 '25",w:"Cubs",s:"3–2"},{d:"Jun 9 '25",w:"Astros",s:"6–1"},{d:"May 14 '24",w:"Cubs",s:"4–3"}]},
    away:[{n:"Yordan Alvarez",avg:".301 / 18 HR / 58 RBI",vs:"Career .312 vs CHC · 6 HR"},{n:"José Altuve",avg:".288 / 8 HR / 31 RBI",vs:"Career .297 vs CHC"},{n:"Kyle Tucker",avg:".274 / 14 HR / 49 RBI",vs:"Career .268 vs CHC"},{n:"Alex Bregman",avg:".261 / 11 HR / 42 RBI",vs:"Career .254 vs CHC"},{n:"Jeremy Peña",avg:".251 / 9 HR / 34 RBI",vs:"Career .243 vs CHC"}],
    home:[{n:"Seiya Suzuki",avg:".291 / 13 HR / 44 RBI",vs:"Career .278 vs HOU"},{n:"Ian Happ",avg:".264 / 10 HR / 38 RBI",vs:"Career .272 vs HOU"},{n:"Dansby Swanson",avg:".248 / 8 HR / 29 RBI",vs:"Career .251 vs HOU"},{n:"Nico Hoerner",avg:".279 / 4 HR / 26 RBI",vs:"Career .284 vs HOU"},{n:"Cody Bellinger",avg:".238 / 11 HR / 37 RBI",vs:"Career .261 vs HOU · 4 HR"}],
    weather:{temp:"68°F",feels:"65°F",cond:"Partly Cloudy",wind:"12 mph NE",precip:"10%",humidity:"54%",impact:"12 mph NE wind blowing IN off Lake Michigan — suppresses HR by ~8 ft. Slight pitcher's park lean tonight."},
  },
  m4:{
    h2h:{hW:1302,aW:1098,avg:"4.8–4.1",games:[{d:"Sep 2 '25",w:"Yankees",s:"6–4"},{d:"Sep 1 '25",w:"Rays",s:"3–2"},{d:"Aug 15 '25",w:"Yankees",s:"5–3"},{d:"Jul 22 '25",w:"Rays",s:"4–2"},{d:"Jul 21 '25",w:"Yankees",s:"7–1"}]},
    away:[{n:"Yandy Díaz",avg:".284 / 7 HR / 28 RBI",vs:"Career .276 vs NYY"},{n:"Randy Arozarena",avg:".271 / 14 HR / 46 RBI",vs:"Career .258 vs NYY · 5 HR"},{n:"Brandon Lowe",avg:".248 / 12 HR / 39 RBI",vs:"Career .241 vs NYY"},{n:"Isaac Paredes",avg:".256 / 16 HR / 51 RBI",vs:"Career .249 vs NYY"},{n:"José Siri",avg:".242 / 9 HR / 29 RBI",vs:"Career .231 vs NYY"}],
    home:[{n:"Aaron Judge",avg:".318 / 21 HR / 63 RBI",vs:"Career .309 vs TB · 8 HR"},{n:"Juan Soto",avg:".302 / 16 HR / 54 RBI",vs:"Career .291 vs TB"},{n:"Giancarlo Stanton",avg:".241 / 14 HR / 44 RBI",vs:"Career .255 vs TB · 7 HR"},{n:"Gleyber Torres",avg:".259 / 10 HR / 33 RBI",vs:"Career .268 vs TB"},{n:"Anthony Volpe",avg:".243 / 8 HR / 28 RBI",vs:"Career .238 vs TB"}],
    weather:{temp:"70°F",feels:"68°F",cond:"Mostly Clear",wind:"8 mph SW",precip:"5%",humidity:"50%",impact:"Light SW wind blowing out to left — may add 5-8 ft to pulled fly balls. Excellent conditions overall."},
  },
  m6:{
    h2h:{hW:1198,aW:1041,avg:"4.6–4.0",games:[{d:"Apr 8 '26",w:"Red Sox",s:"5–3"},{d:"Apr 7 '26",w:"Twins",s:"4–2"},{d:"Sep 5 '25",w:"Red Sox",s:"7–4"},{d:"Sep 4 '25",w:"Red Sox",s:"3–1"},{d:"Aug 22 '25",w:"Twins",s:"6–5"}]},
    away:[{n:"Carlos Correa",avg:".271 / 12 HR / 42 RBI",vs:"Career .264 vs BOS"},{n:"Byron Buxton",avg:".258 / 16 HR / 48 RBI",vs:"Career .247 vs BOS · 5 HR"},{n:"Royce Lewis",avg:".284 / 14 HR / 51 RBI",vs:"Career .277 vs BOS"},{n:"Jorge Polanco",avg:".251 / 9 HR / 31 RBI",vs:"Career .261 vs BOS"},{n:"Max Kepler",avg:".248 / 8 HR / 28 RBI",vs:"Career .252 vs BOS"}],
    home:[{n:"Rafael Devers",avg:".281 / 17 HR / 58 RBI",vs:"Career .288 vs MIN · 6 HR"},{n:"Triston Casas",avg:".254 / 13 HR / 44 RBI",vs:"Career .248 vs MIN"},{n:"Jarren Duran",avg:".292 / 9 HR / 36 RBI",vs:"Career .301 vs MIN"},{n:"Masataka Yoshida",avg:".274 / 10 HR / 39 RBI",vs:"Career .268 vs MIN"},{n:"Ceddanne Rafaela",avg:".254 / 6 HR / 24 RBI",vs:"Career .248 vs MIN"}],
    weather:{temp:"66°F",feels:"63°F",cond:"Overcast",wind:"9 mph W",precip:"20%",humidity:"61%",impact:"Overcast & cool at Fenway. Green Monster plays bigger — balls die on the wall. Slight pitching advantage."},
  },
  m10:{
    h2h:{hW:1089,aW:1144,avg:"4.1–4.3",games:[{d:"May 10 '26",w:"Dodgers",s:"4–0"},{d:"May 9 '26",w:"Dodgers",s:"5–1"},{d:"Sep 18 '25",w:"Brewers",s:"3–2"},{d:"Sep 17 '25",w:"Dodgers",s:"6–2"},{d:"Aug 3 '25",w:"Brewers",s:"4–3"}]},
    away:[{n:"Freddie Freeman",avg:".308 / 14 HR / 52 RBI",vs:"Career .321 vs MIL · 8 HR"},{n:"Mookie Betts",avg:".294 / 15 HR / 47 RBI",vs:"Career .306 vs MIL"},{n:"Shohei Ohtani",avg:".311 / 22 HR / 69 RBI",vs:"Career .298 vs MIL · 5 HR"},{n:"Will Smith",avg:".278 / 11 HR / 40 RBI",vs:"Career .272 vs MIL"},{n:"Tommy Edman",avg:".258 / 5 HR / 22 RBI",vs:"Career .264 vs MIL"}],
    home:[{n:"William Contreras",avg:".281 / 12 HR / 41 RBI",vs:"Career .274 vs LAD"},{n:"Rhys Hoskins",avg:".252 / 16 HR / 48 RBI",vs:"Career .244 vs LAD · 4 HR"},{n:"Christian Yelich",avg:".267 / 9 HR / 34 RBI",vs:"Career .279 vs LAD"},{n:"Willy Adames",avg:".248 / 13 HR / 44 RBI",vs:"Career .241 vs LAD"},{n:"Joey Wiemer",avg:".239 / 7 HR / 26 RBI",vs:"Career .231 vs LAD"}],
    weather:{temp:"63°F",feels:"60°F",cond:"Clear",wind:"7 mph SE",precip:"0%",humidity:"48%",impact:"Perfect conditions at American Family Field. Minimal wind — neutral ball flight all night."},
  },
  n1:{
    h2h:{hW:58,aW:62,avg:"112.4–110.8",games:[{d:"May 21 '26",w:"Thunder",s:"122–113"},{d:"May 19 '26",w:"Spurs",s:"122–115"},{d:"Mar 14 '26",w:"Thunder",s:"118–109"},{d:"Jan 28 '26",w:"Spurs",s:"114–108"},{d:"Nov 18 '25",w:"Thunder",s:"121–116"}]},
    away:[{n:"Shai Gilgeous-Alexander",avg:"32.7 pts · 5.5 ast · 5.1 reb",vs:"34.1 pts/g in this series"},{n:"Chet Holmgren",avg:"18.4 pts · 9.8 reb · 2.4 blk",vs:"19.6 pts / 10.4 reb vs SAS"},{n:"Jalen Williams",avg:"22.1 pts · 5.9 reb",vs:"21.8 pts vs SAS in series"},{n:"Luguentz Dort",avg:"14.8 pts · 3.8 reb",vs:"Defensive anchor on Wembanyama"},{n:"Isaiah Joe",avg:"9.1 pts · 2.9 reb",vs:"12.4 pts · key 3PT role"}],
    home:[{n:"Victor Wembanyama",avg:"26.4 pts · 10.6 reb · 3.6 blk",vs:"28.2 pts / 11.1 reb vs OKC"},{n:"Devin Vassell",avg:"19.8 pts · 4.2 ast",vs:"18.9 pts vs OKC"},{n:"Stephon Castle",avg:"15.4 pts · 5.1 ast",vs:"16.8 pts vs OKC — breakout"},{n:"Julian Champagnie",avg:"12.1 pts · 4.4 reb",vs:"13.2 pts / 4.8 reb vs OKC"},{n:"Zach Collins",avg:"9.4 pts · 6.8 reb",vs:"7.8 pts / 8.1 reb vs OKC"}],
    weather:{temp:"Indoor",feels:"72°F inside",cond:"Climate Controlled",wind:"N/A",precip:"N/A",humidity:"43%",impact:"Frost Bank Center fully enclosed. SA outdoor temp: 84°F. First WCF home game — crowd will be electric."},
    winProb:{away:46.7,home:53.3},
  },
  n2:{
    h2h:{hW:89,aW:71,avg:"107.2–103.8",games:[{d:"May 22 '26",w:"Knicks",s:"109–93"},{d:"May 20 '26",w:"Knicks",s:"115–104"},{d:"Feb 12 '26",w:"Knicks",s:"112–108"},{d:"Dec 9 '25",w:"Cavaliers",s:"118–112"},{d:"Nov 4 '25",w:"Knicks",s:"104–99"}]},
    away:[{n:"Donovan Mitchell",avg:"29.1 pts · 5.8 ast",vs:"22.4 pts — Knicks D limiting him"},{n:"Evan Mobley",avg:"18.6 pts · 9.4 reb",vs:"16.8 pts / 10.1 reb vs NYK"},{n:"Darius Garland",avg:"21.4 pts · 8.8 ast",vs:"18.2 pts / 7.4 ast vs NYK"},{n:"Jarrett Allen",avg:"13.8 pts · 11.2 reb",vs:"11.4 pts / 10.8 reb vs NYK"},{n:"Georges Niang",avg:"9.2 pts · 3.4 reb",vs:"7.8 pts vs NYK"}],
    home:[{n:"Jalen Brunson",avg:"28.7 pts · 7.4 ast",vs:"31.2 pts / 8.1 ast — series MVP"},{n:"Karl-Anthony Towns",avg:"24.0 pts · 13.7 reb",vs:"26.1 pts / 14.4 reb vs CLE"},{n:"Mikal Bridges",avg:"19.6 pts · 5.7 reb",vs:"21.3 pts vs CLE"},{n:"OG Anunoby",avg:"15.4 pts · 5.5 reb",vs:"Lockdown defender on Mitchell"},{n:"Josh Hart",avg:"11.2 pts · 9.6 reb",vs:"10.4 pts / 11.2 reb — hustle"}],
    weather:{temp:"Indoor",feels:"70°F inside",cond:"Climate Controlled",wind:"N/A",precip:"N/A",humidity:"45%",impact:"Madison Square Garden. Knicks up 2-0 in the ECF — MSG atmosphere at full volume."},
    boxScore:{
      away:[{n:"D. Mitchell",pos:"SG",min:38,pts:24,reb:5,ast:6,stl:1,blk:0},{n:"E. Mobley",pos:"PF",min:35,pts:18,reb:10,ast:2,stl:1,blk:3},{n:"D. Garland",pos:"PG",min:36,pts:17,reb:3,ast:8,stl:2,blk:0},{n:"J. Allen",pos:"C",min:30,pts:10,reb:11,ast:1,stl:0,blk:2},{n:"G. Niang",pos:"SF",min:24,pts:8,reb:3,ast:1,stl:1,blk:0}],
      home:[{n:"J. Brunson",pos:"PG",min:40,pts:34,reb:4,ast:9,stl:2,blk:0},{n:"K. Towns",pos:"C",min:36,pts:26,reb:14,ast:2,stl:0,blk:2},{n:"M. Bridges",pos:"SF",min:37,pts:21,reb:7,ast:3,stl:3,blk:1},{n:"O. Anunoby",pos:"PF",min:35,pts:14,reb:6,ast:2,stl:4,blk:1},{n:"J. Hart",pos:"PF",min:26,pts:8,reb:12,ast:4,stl:2,blk:0}],
    },
  },
};

const LEAGUES = [
  {id:"mlb",label:"MLB",icon:"⚾",color:"#ef4444"},
  {id:"nba",label:"NBA",icon:"🏀",color:"#f97316"},
  {id:"nfl",label:"NFL",icon:"🏈",color:"#3b82f6"},
];
const TABS = ["Overview","H2H","Players","Weather"];

const sc = s => /live|inprog/i.test(s||"") ? "#22c55e" : /final|closed/i.test(s||"") ? "#6b7280" : "#60a5fa";
const sl = s => /live|inprog/i.test(s||"") ? "LIVE" : /final|closed/i.test(s||"") ? "FINAL" : "TODAY";

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [league, setLeague] = useState("mlb");
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [plan, setPlan] = useState({ tier: "free", status: "active" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgraded, setUpgraded] = useState(searchParams.get("upgraded") === "true");

  const lg = LEAGUES.find(l => l.id === league);

  // Load subscription info
  useEffect(() => {
    subscriptionApi.getMyPlan().then(setPlan).catch(() => {});
  }, []);

  // Show upgrade banner
  useEffect(() => {
    if (upgraded) setTimeout(() => setUpgraded(false), 5000);
  }, [upgraded]);

  // Load games
  const loadGames = useCallback(async (lg) => {
    setGamesLoading(true);
    setGames([]);
    setSelected(null);
    try {
      const res = await gamesApi.getToday(lg);
      setGames(res.games || []);
    } catch {
      setGames([]);
    }
    setGamesLoading(false);
  }, []);

  useEffect(() => { loadGames(league); }, [league, loadGames]);

  const pick = (g) => { setSelected(g); setTab("Overview"); };
  const back = () => setSelected(null);

  const handleManageBilling = async () => {
    try {
      const { url } = await subscriptionApi.openPortal();
      window.location.href = url;
    } catch { alert("Could not open billing portal."); }
  };

  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const det = selected ? DETAILS[selected.id] : null;

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Barlow+Condensed:wght@600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .gc{transition:all .18s ease;cursor:pointer}
        .gc:active{transform:scale(.97)}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
      `}</style>

      {/* Upgrade success banner */}
      {upgraded && (
        <div style={{background:"#22c55e",color:"#fff",textAlign:"center",padding:"12px",fontSize:14,fontWeight:700,animation:"fadeIn .3s ease"}}>
          🎉 Welcome to {plan.tier.charAt(0).toUpperCase()+plan.tier.slice(1)}! Your subscription is now active.
        </div>
      )}

      {/* Header */}
      <div style={{background:"#0d0d16",borderBottom:"1px solid #1e2235",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px"}}>
          {/* Top bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0 0"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 10px #22c55e",animation:"pulse2 2s infinite"}}/>
              <span style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:900,letterSpacing:"0.08em",color:"#fff"}}>SPORTSINTEL</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {/* Plan badge */}
              <div style={{fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:10,background:isPro?"#ef444420":"#1e2235",color:isPro?"#ef4444":"#475569",border:`1px solid ${isPro?"#ef444440":"#1e2235"}`,letterSpacing:"0.08em"}}>
                {plan.tier.toUpperCase()}
              </div>
              {/* User menu */}
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:34,height:34,borderRadius:"50%",background:"#1e2235",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#94a3b8"}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen && (
                  <div style={{position:"absolute",right:0,top:42,background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:8,minWidth:200,zIndex:200,animation:"fadeIn .15s ease"}}>
                    <div style={{padding:"8px 12px",fontSize:12,color:"#475569",borderBottom:"1px solid #1e2235",marginBottom:4}}>{user?.email}</div>
                    {!isPro && (
                      <button onClick={()=>{navigate("/pricing");setMenuOpen(false);}}
                        style={{width:"100%",textAlign:"left",background:"#ef444415",border:"1px solid #ef444430",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#ef4444",fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:4}}>
                        ⚡ Upgrade to Pro
                      </button>
                    )}
                    {isPro && (
                      <button onClick={()=>{handleManageBilling();setMenuOpen(false);}}
                        style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"8px 12px",fontSize:13,color:"#94a3b8",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>
                        💳 Manage Billing
                      </button>
                    )}
                    <button onClick={()=>{signOut();navigate("/");}}
                      style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"8px 12px",fontSize:13,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* League tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #1e2235",marginTop:12}}>
            {LEAGUES.map(l=>(
              <button key={l.id} onClick={()=>{setLeague(l.id);setMenuOpen(false);}}
                style={{flex:1,padding:"10px 4px 12px",background:"none",border:"none",borderBottom:`2px solid ${league===l.id?l.color:"transparent"}`,color:league===l.id?l.color:"#64748b",fontSize:14,fontWeight:league===l.id?700:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:-1,transition:"all .15s"}}>
                <span>{l.icon}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Click away to close menu */}
      {menuOpen && <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      {/* NFL off-season */}
      {league==="nfl" && (
        <div style={{maxWidth:900,margin:"0 auto",padding:"60px 16px",textAlign:"center",animation:"fadeIn .3s ease"}}>
          <div style={{fontSize:56,marginBottom:16}}>🏈</div>
          <div style={{fontFamily:"'Barlow Condensed'",fontSize:32,fontWeight:900,color:"#fff",marginBottom:8}}>NFL OFF-SEASON</div>
          <div style={{color:"#64748b",fontSize:15,lineHeight:1.7}}>Regular season begins <span style={{color:"#e2e8f0",fontWeight:600}}>September 2026.</span><br/>Check back then for live games, stats, and analysis.</div>
          <div style={{marginTop:32,display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            {[["🗓","Draft","Apr 2026"],["🏋️","OTAs","May–Jun"],["🏟","Preseason","Aug 2026"],["🎯","Week 1","Sep 2026"]].map(([icon,label,date])=>(
              <div key={label} style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:"16px 20px",textAlign:"center"}}>
                <div style={{fontSize:26,marginBottom:6}}>{icon}</div>
                <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{label}</div>
                <div style={{fontSize:11,color:"#475569",marginTop:2}}>{date}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      {league !== "nfl" && (
        <div style={{maxWidth:900,margin:"0 auto"}}>

          {/* ── DETAIL VIEW ── */}
          {selected && (
            <div style={{animation:"slideUp .22s ease",paddingBottom:80}}>
              {/* Game header */}
              <div style={{background:`linear-gradient(160deg,${lg.color}18 0%,#0a0a14 60%)`,borderBottom:"1px solid #1e2235",padding:"14px 16px 20px"}}>
                <button onClick={back} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",color:"#64748b",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"0 0 14px",letterSpacing:"0.02em"}}>
                  <span style={{fontSize:20,lineHeight:1}}>‹</span> All Games
                </button>
                <div style={{fontSize:11,color:"#475569",fontWeight:600,letterSpacing:"0.08em",marginBottom:10,textTransform:"uppercase"}}>
                  {selected.venue} · {selected.city}
                </div>
                {[{team:selected.away,score:selected.aS??selected.awayScore,isAway:true},{team:selected.home,score:selected.hS??selected.homeScore,isAway:false}].map(({team,score,isAway})=>(
                  <div key={team} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:3,height:28,borderRadius:2,background:isAway?"#334155":lg.color}}/>
                      <span style={{fontSize:18,fontWeight:800,color:isAway?"#94a3b8":"#fff"}}>{team}</span>
                    </div>
                    <span style={{fontFamily:"'Barlow Condensed'",fontSize:34,fontWeight:900,color:score!=null?isAway?"#94a3b8":"#fff":"#1e2235",letterSpacing:"-0.02em"}}>
                      {score!=null?score:"—"}
                    </span>
                  </div>
                ))}
                <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
                  <StatusPill status={selected.status||selected.gameStatus} color={lg.color}/>
                  <span style={{fontSize:12,color:"#475569"}}>{selected.time||selected.scheduledTime}</span>
                  {selected.note&&<span style={{fontSize:11,color:lg.color,fontWeight:700}}>{selected.note}</span>}
                </div>
                {/* Win probability bar */}
                {det?.winProb&&(
                  <div style={{marginTop:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#475569",marginBottom:5}}>
                      <span>{selected.away?.split(" ").pop()} {det.winProb.away}%</span>
                      <span style={{fontSize:10,fontWeight:700,color:"#334155",letterSpacing:"0.06em"}}>WIN PROBABILITY</span>
                      <span>{selected.home?.split(" ").pop()} {det.winProb.home}%</span>
                    </div>
                    <div style={{height:6,borderRadius:3,background:"#1e2235",overflow:"hidden",display:"flex"}}>
                      <div style={{width:`${det.winProb.away}%`,background:"#3b82f6",borderRadius:"3px 0 0 3px"}}/>
                      <div style={{flex:1,background:lg.color,borderRadius:"0 3px 3px 0"}}/>
                    </div>
                  </div>
                )}
              </div>

              {/* Tab bar */}
              <div style={{display:"flex",borderBottom:"1px solid #1e2235",background:"#080810",position:"sticky",top:61,zIndex:99}}>
                {TABS.map(t=>(
                  <button key={t} onClick={()=>setTab(t)}
                    style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?lg.color:"transparent"}`,color:tab===t?lg.color:"#475569",fontSize:13,fontWeight:tab===t?700:500,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",marginBottom:-1}}>
                    {t}
                  </button>
                ))}
              </div>

              {/* Pro gate */}
              {!isPro && tab !== "Overview" && (
                <div style={{margin:16,background:"linear-gradient(135deg,#ef444418,#f9731408)",border:"1px solid #ef444430",borderRadius:16,padding:28,textAlign:"center"}}>
                  <div style={{fontSize:32,marginBottom:12}}>🔒</div>
                  <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:8}}>{tab} requires Pro</div>
                  <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Upgrade to access H2H records, player matchup stats, weather analysis, and more.</div>
                  <button onClick={()=>navigate("/pricing")}
                    style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"12px 32px",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                    Upgrade to Pro — $4.99/mo →
                  </button>
                </div>
              )}

              {/* Tab content */}
              {(isPro || tab === "Overview") && (
                <div style={{padding:16,animation:"fadeIn .2s ease"}}>
                  {tab==="Overview" && <OverviewTab game={selected} det={det} lg={lg} isPro={isPro} onUpgrade={()=>navigate("/pricing")}/>}
                  {tab==="H2H"      && <H2HTab game={selected} det={det} lg={lg}/>}
                  {tab==="Players"  && <PlayersTab game={selected} det={det} lg={lg}/>}
                  {tab==="Weather"  && <WeatherTab game={selected} det={det} lg={lg}/>}
                </div>
              )}
            </div>
          )}

          {/* ── GAMES LIST ── */}
          {!selected && (
            <div style={{padding:16,animation:"fadeIn .2s ease"}}>
              {/* Upgrade nudge for free users */}
              {!isPro && (
                <div onClick={()=>navigate("/pricing")}
                  style={{background:"linear-gradient(135deg,#ef444412,#f9731408)",border:"1px solid #ef444425",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#ef4444"}}>⚡ Unlock Full Stats</div>
                    <div style={{fontSize:11,color:"#475569",marginTop:2}}>H2H, player matchups, weather — from $4.99/mo</div>
                  </div>
                  <span style={{color:"#ef4444",fontSize:18}}>›</span>
                </div>
              )}

              <div style={{fontSize:11,color:"#475569",fontWeight:600,letterSpacing:"0.1em",marginBottom:14,textTransform:"uppercase"}}>
                Today · {lg.label} · {gamesLoading ? "..." : `${games.length} Games`}
              </div>

              {gamesLoading && (
                <div style={{textAlign:"center",padding:48}}>
                  <div style={{width:28,height:28,border:"3px solid #1e2235",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 14px"}}/>
                  <div style={{fontSize:13,color:"#475569"}}>Loading games...</div>
                </div>
              )}

              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {games.map(g=><GameCard key={g.id} g={g} lg={lg} onSelect={()=>pick(g)} hasDetail={!!DETAILS[g.id]}/>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Game Card ──────────────────────────────────────────────────────────────── */
function GameCard({g,lg,onSelect,hasDetail}) {
  const status = g.status||g.gameStatus||"";
  const isLive = /live|inprog/i.test(status);
  const accentClr = sc(status);
  return (
    <div onClick={onSelect} className="gc"
      style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:"16px",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:isLive?`linear-gradient(180deg,${lg.color},${lg.color}66)`:"#1a1a2e",borderRadius:"3px 0 0 3px"}}/>
      <div style={{paddingLeft:10}}>
        {[{team:g.away,score:g.awayScore??g.aS},{team:g.home,score:g.homeScore??g.hS}].map(({team,score},i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:i===0?5:0}}>
            <span style={{fontSize:15,fontWeight:600,color:"#e2e8f0"}}>{team}</span>
            <span style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:900,color:score!=null?"#fff":"#1e2235"}}>{score!=null?score:"–"}</span>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center",flexWrap:"wrap"}}>
          <StatusPill status={status} color={lg.color}/>
          <span style={{fontSize:11,color:"#475569"}}>{g.time||g.scheduledTime}</span>
          {g.venue&&<span style={{fontSize:11,color:"#2d3748"}}>· {g.venue}</span>}
        </div>
        {g.note&&<div style={{fontSize:11,color:lg.color,fontWeight:700,marginTop:6}}>{g.note}</div>}
      </div>
      {hasDetail&&<div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"#2d3748",fontSize:20}}>›</div>}
    </div>
  );
}

/* ─── Overview Tab ───────────────────────────────────────────────────────────── */
function OverviewTab({game,det,lg,isPro,onUpgrade}) {
  if (!det) return (
    <div style={{textAlign:"center",padding:"40px 0"}}>
      <div style={{fontSize:40,marginBottom:12}}>📋</div>
      <div style={{fontSize:14,color:"#475569"}}>Detailed stats not available for this game yet.</div>
    </div>
  );
  return (
    <div>
      {det.h2h&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
          <StatBox label="H2H" value={`${det.h2h.aW}–${det.h2h.hW}`} sub="all-time" color={lg.color} locked={!isPro} onUpgrade={onUpgrade}/>
          <StatBox label="Avg" value={det.h2h.avg} sub="score" color={lg.color} locked={!isPro} onUpgrade={onUpgrade}/>
          <StatBox label="Last" value={det.h2h.games[0].w} sub={det.h2h.games[0].s} color={lg.color} locked={!isPro} onUpgrade={onUpgrade}/>
        </div>
      )}
      {det.boxScore?(
        <Section label="Box Score" icon="📊">
          <BSTable data={det.boxScore} game={game} lg={lg}/>
        </Section>
      ):(
        <Section label="Box Score" icon="📊">
          <div style={{background:"#0a0a16",borderRadius:10,padding:24,textAlign:"center"}}>
            <div style={{fontSize:28,marginBottom:8}}>⏱</div>
            <div style={{fontSize:13,color:"#475569"}}>Available once the game starts</div>
          </div>
        </Section>
      )}
      {det.weather&&(
        <Section label="Conditions" icon="🌤">
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
            {[det.weather.temp,det.weather.cond,det.weather.wind,`Precip ${det.weather.precip}`].map((v,i)=>(
              <div key={i} style={{background:"#0d1120",border:"1px solid #1e2235",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#94a3b8",flex:"1 1 auto",textAlign:"center"}}>{v}</div>
            ))}
          </div>
          <div style={{background:`${lg.color}10`,border:`1px solid ${lg.color}28`,borderRadius:10,padding:"12px 14px",fontSize:13,color:"#cbd5e1",lineHeight:1.65}}>
            <span style={{color:lg.color,fontWeight:700}}>⚡ </span>{det.weather.impact}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ─── H2H Tab ────────────────────────────────────────────────────────────────── */
function H2HTab({game,det,lg}) {
  if (!det?.h2h) return <NoData/>;
  const {h2h} = det;
  const total = h2h.hW+h2h.aW;
  const awayPct = Math.round((h2h.aW/total)*100);
  return (
    <div>
      <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,marginBottom:12}}>
        <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"center",marginBottom:18}}>All-Time Head-to-Head</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",marginBottom:18}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Barlow Condensed'",fontSize:54,fontWeight:900,color:lg.color,lineHeight:1}}>{h2h.aW}</div>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,marginTop:4,letterSpacing:"0.06em"}}>{game.away?.split(" ").pop()?.toUpperCase()}</div>
          </div>
          <div style={{color:"#1e2235",fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:700,textAlign:"center"}}>VS</div>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Barlow Condensed'",fontSize:54,fontWeight:900,color:"#e2e8f0",lineHeight:1}}>{h2h.hW}</div>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,marginTop:4,letterSpacing:"0.06em"}}>{game.home?.split(" ").pop()?.toUpperCase()}</div>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#475569",marginBottom:5}}>
          <span>{awayPct}%</span><span style={{letterSpacing:"0.06em",fontWeight:600}}>WIN %</span><span>{100-awayPct}%</span>
        </div>
        <div style={{height:7,borderRadius:4,background:"#1e2235",overflow:"hidden",display:"flex"}}>
          <div style={{width:`${awayPct}%`,background:lg.color,borderRadius:"4px 0 0 4px"}}/>
          <div style={{flex:1,background:"#e2e8f0",borderRadius:"0 4px 4px 0"}}/>
        </div>
        <div style={{textAlign:"center",marginTop:12,fontSize:12,color:"#475569"}}>Historical avg: <span style={{color:"#94a3b8",fontWeight:700}}>{h2h.avg}</span></div>
      </div>
      <Section label="Last 5 Meetings" icon="📅">
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {h2h.games.map((g,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d1120",borderRadius:10,padding:"10px 14px"}}>
              <span style={{fontSize:12,color:"#475569",minWidth:78}}>{g.d}</span>
              <span style={{fontSize:13,fontWeight:700,color:"#e2e8f0",flex:1,textAlign:"center"}}>{g.w}</span>
              <span style={{fontFamily:"'Barlow Condensed'",fontSize:16,fontWeight:800,color:lg.color,minWidth:56,textAlign:"right"}}>{g.s}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ─── Players Tab ────────────────────────────────────────────────────────────── */
function PlayersTab({game,det,lg}) {
  if (!det?.away?.length) return <NoData/>;
  return (
    <div>
      <Section label={`${game.away} — Key Performers`} icon="⚡" color={lg.color}>
        <PlayerList players={det.away} lg={lg}/>
      </Section>
      <Section label={`${game.home} — Key Performers`} icon="⚡" color={lg.color}>
        <PlayerList players={det.home} lg={lg}/>
      </Section>
    </div>
  );
}

function PlayerList({players,lg}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {players.map((p,i)=>(
        <div key={i} style={{background:"#0d1120",borderRadius:12,padding:"12px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
          <div style={{width:28,height:28,borderRadius:"50%",background:`${lg.color}18`,border:`1px solid ${lg.color}38`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:"'Barlow Condensed'",fontSize:14,fontWeight:800,color:lg.color}}>{i+1}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",marginBottom:3}}>{p.n}</div>
            <div style={{fontSize:12,color:"#475569",marginBottom:5}}>{p.avg}</div>
            <div style={{fontSize:11,color:lg.color,fontWeight:600,background:`${lg.color}10`,borderRadius:6,padding:"3px 8px",display:"inline-block"}}>{p.vs}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Weather Tab ────────────────────────────────────────────────────────────── */
function WeatherTab({game,det,lg}) {
  if (!det?.weather) return <NoData/>;
  const w = det.weather;
  const rows=[["🌡","Temp",w.temp],["🤔","Feels Like",w.feels],["☁️","Condition",w.cond],["💨","Wind",w.wind],["🌧","Precip",w.precip],["💧","Humidity",w.humidity]].filter(([,,v])=>v&&v!=="N/A");
  return (
    <div>
      <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:16,marginBottom:12}}>
        <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>{game.city}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {rows.map(([icon,label,val])=>(
            <div key={label} style={{background:"#0a0a16",borderRadius:10,padding:12}}>
              <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
              <div style={{fontSize:10,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{label}</div>
              <div style={{fontSize:15,fontWeight:700,color:"#e2e8f0"}}>{val}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{background:`linear-gradient(135deg,${lg.color}14,${lg.color}08)`,border:`1px solid ${lg.color}28`,borderRadius:16,padding:16}}>
        <div style={{fontSize:11,color:lg.color,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>⚡ Game Impact</div>
        <div style={{fontSize:14,color:"#cbd5e1",lineHeight:1.7}}>{w.impact}</div>
      </div>
    </div>
  );
}

/* ─── Box Score Table ────────────────────────────────────────────────────────── */
function BSTable({data,game,lg}) {
  const cols=["MIN","PTS","REB","AST","STL","BLK"];
  const renderTeam=(players,label,accent)=>(
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:accent,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,paddingLeft:4}}>{label}</div>
      <div style={{overflowX:"auto",borderRadius:10,background:"#0a0a16"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:300}}>
          <thead><tr style={{borderBottom:"1px solid #1e2235"}}><th style={{textAlign:"left",padding:"8px 10px",color:"#475569",fontWeight:600,fontSize:11}}>Player</th>{cols.map(c=><th key={c} style={{padding:"8px 6px",color:"#475569",fontWeight:600,fontSize:11,textAlign:"center"}}>{c}</th>)}</tr></thead>
          <tbody>{players.map((p,i)=>(
            <tr key={i} style={{borderBottom:"1px solid #0d1120"}}>
              <td style={{padding:"8px 10px",fontWeight:600,color:"#e2e8f0",whiteSpace:"nowrap"}}>
                <span style={{fontSize:10,color:"#334155",marginRight:6}}>{p.pos}</span>{p.n}
              </td>
              {cols.map(c=><td key={c} style={{padding:"8px 6px",textAlign:"center",color:c==="PTS"&&p.pts>=20?accent:"#64748b",fontWeight:c==="PTS"&&p.pts>=20?700:400}}>{p[c.toLowerCase()]??"-"}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
  return <div>{renderTeam(data.home,game.home,lg.color)}{renderTeam(data.away,game.away,"#64748b")}</div>;
}

/* ─── Shared UI ──────────────────────────────────────────────────────────────── */
function Section({label,icon,color,children}) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
        <span style={{fontSize:14}}>{icon}</span>
        <span style={{fontSize:12,fontWeight:700,color:color||"#475569",letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function StatBox({label,value,sub,color,locked,onUpgrade}) {
  return (
    <div onClick={locked?onUpgrade:undefined} style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:"12px 10px",textAlign:"center",cursor:locked?"pointer":"default",position:"relative",overflow:"hidden"}}>
      {locked&&<div style={{position:"absolute",inset:0,background:"#080810cc",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12}}><span style={{fontSize:16}}>🔒</span></div>}
      <div style={{fontSize:10,color:"#475569",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{label}</div>
      <div style={{fontFamily:"'Barlow Condensed'",fontSize:18,fontWeight:900,color,lineHeight:1,marginBottom:3}}>{value}</div>
      <div style={{fontSize:10,color:"#334155"}}>{sub}</div>
    </div>
  );
}

function StatusPill({status,color}) {
  const live=/live|inprog/i.test(status||"");
  const clr=sc(status);
  return (
    <span style={{fontSize:10,letterSpacing:"0.08em",padding:"2px 8px",borderRadius:10,background:clr+"18",color:clr,border:`1px solid ${clr}38`,display:"inline-flex",alignItems:"center",gap:4,fontWeight:700}}>
      {live&&<span style={{width:5,height:5,borderRadius:"50%",background:clr,animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
      {sl(status)}
    </span>
  );
}

function NoData() {
  return <div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:36,marginBottom:12}}>📋</div><div style={{fontSize:13,color:"#475569"}}>Data not available for this matchup.</div></div>;
}
