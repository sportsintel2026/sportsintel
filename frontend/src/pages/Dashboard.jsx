import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { gamesApi, subscriptionApi } from "../lib/api";

const LEAGUES = [
  {id:"mlb",label:"MLB",icon:"⚾",color:"#ef4444"},
  {id:"nba",label:"NBA",icon:"🏀",color:"#f97316"},
  {id:"nfl",label:"NFL",icon:"🏈",color:"#3b82f6"},
  {id:"nhl",label:"NHL",icon:"🏒",color:"#06b6d4"},
  {id:"soccer",label:"Soccer",icon:"⚽",color:"#22c55e"},
  {id:"ncaamb",label:"NCAAMB",icon:"🏀",color:"#8b5cf6"},
  {id:"ncaawb",label:"NCAAWB",icon:"🏀",color:"#ec4899"},
  {id:"ncaafb",label:"NCAAFB",icon:"🏈",color:"#f59e0b"},
  {id:"mma",label:"MMA",icon:"🥊",color:"#ef4444"},
  {id:"golf",label:"Golf",icon:"⛳",color:"#22c55e"},
];

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
  const [plan, setPlan] = useState({tier:"free",status:"active"});
  const [menuOpen, setMenuOpen] = useState(false);
  const lg = LEAGUES.find(l=>l.id===league);

  useEffect(()=>{ subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); },[]);

  const loadGames = useCallback(async(id)=>{
    setGamesLoading(true); setGames([]); setSelected(null);
    try {
      const res = await gamesApi.getToday(id);
      setGames(res.games||[]);
    } catch { setGames([]); }
    setGamesLoading(false);
  },[]);

  useEffect(()=>{ loadGames(league); },[league,loadGames]);

  const isPro = plan.tier==="pro"||plan.tier==="elite";

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Barlow+Condensed:wght@600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .gc{transition:all .18s ease;cursor:pointer}
        .gc:active{transform:scale(.97)}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
      `}</style>

      {/* Header */}
      <div style={{background:"#0d0d16",borderBottom:"1px solid #1e2235",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"0 16px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0 0"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 10px #22c55e",animation:"pulse2 2s infinite"}}/>
              <span style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:900,letterSpacing:"0.08em",color:"#fff"}}>SPORTSINTEL</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:10,background:isPro?"#ef444420":"#1e2235",color:isPro?"#ef4444":"#475569",border:`1px solid ${isPro?"#ef444440":"#1e2235"}`,letterSpacing:"0.08em"}}>
                {plan.tier.toUpperCase()}
              </div>
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:34,height:34,borderRadius:"50%",background:"#1e2235",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#94a3b8"}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen&&(
                  <div style={{position:"absolute",right:0,top:42,background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:8,minWidth:200,zIndex:200,animation:"fadeIn .15s ease"}}>
                    <div style={{padding:"8px 12px",fontSize:12,color:"#475569",borderBottom:"1px solid #1e2235",marginBottom:4}}>{user?.email}</div>
                    {!isPro&&(
                      <button onClick={()=>{navigate("/pricing");setMenuOpen(false);}}
                        style={{width:"100%",textAlign:"left",background:"#ef444415",border:"1px solid #ef444430",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#ef4444",fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:4}}>
                        ⚡ Upgrade to All-Access
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

          {/* League tabs - scrollable */}
          <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #1e2235",marginTop:12,paddingBottom:0,gap:0}}>
            {LEAGUES.map(l=>(
              <button key={l.id} onClick={()=>{setLeague(l.id);setMenuOpen(false);}}
                style={{flexShrink:0,padding:"10px 12px 12px",background:"none",border:"none",borderBottom:`2px solid ${league===l.id?l.color:"transparent"}`,color:league===l.id?l.color:"#64748b",fontSize:12,fontWeight:league===l.id?700:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,marginBottom:-1,transition:"all .15s",whiteSpace:"nowrap"}}>
                <span style={{fontSize:14}}>{l.icon}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      {/* Main content */}
      <div style={{maxWidth:900,margin:"0 auto",padding:16}}>
        {!isPro&&(
          <div onClick={()=>navigate("/pricing")}
            style={{background:"linear-gradient(135deg,#ef444412,#f9731408)",border:"1px solid #ef444425",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#ef4444"}}>⚡ Unlock Full Stats + Daily Picks</div>
              <div style={{fontSize:11,color:"#475569",marginTop:2}}>H2H, player matchups, weather, betting lines — $6.99/mo</div>
            </div>
            <span style={{color:"#ef4444",fontSize:18}}>›</span>
          </div>
        )}

        <div style={{fontSize:11,color:"#475569",fontWeight:600,letterSpacing:"0.1em",marginBottom:14,textTransform:"uppercase"}}>
          Today · {lg.label} · {gamesLoading?"...":games.length+" Games"}
        </div>

        {gamesLoading&&(
          <div style={{textAlign:"center",padding:48}}>
            <div style={{width:28,height:28,border:"3px solid #1e2235",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 14px"}}/>
            <div style={{fontSize:13,color:"#475569"}}>Loading games...</div>
          </div>
        )}

        {!gamesLoading&&games.length===0&&(
          <div style={{textAlign:"center",padding:"48px 20px"}}>
            <div style={{fontSize:40,marginBottom:12}}>{lg.icon}</div>
            <div style={{fontSize:16,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>No games today</div>
            <div style={{fontSize:13,color:"#475569"}}>Check back later or try another league</div>
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {games.map(g=>(
            <div key={g.id} className="gc"
              onClick={()=>setSelected(g)}
              style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:16,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:/live|inprog/i.test(g.status||"")?"#22c55e":"#1a1a2e",borderRadius:"3px 0 0 3px"}}/>
              <div style={{paddingLeft:10}}>
                {[{team:g.away,score:g.awayScore},{team:g.home,score:g.homeScore}].map(({team,score},i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:i===0?5:0}}>
                    <span style={{fontSize:15,fontWeight:600,color:"#e2e8f0"}}>{team}</span>
                    <span style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:900,color:score!=null?"#fff":"#1e2235"}}>{score!=null?score:"–"}</span>
                  </div>
                ))}
                <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:sc(g.status)+"18",color:sc(g.status),border:`1px solid ${sc(g.status)}38`,display:"inline-flex",alignItems:"center",gap:4}}>
                    {/live|inprog/i.test(g.status||"")&&<span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
                    {sl(g.status)}
                  </span>
                  <span style={{fontSize:11,color:"#475569"}}>{g.time}</span>
                  {g.venue&&<span style={{fontSize:11,color:"#2d3748"}}>· {g.venue}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
