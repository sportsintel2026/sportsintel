import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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

const TABS = ["Overview","H2H","Players","Weather"];
const sc = s=>/live|inprog/i.test(s||"")?"#22c55e":/final|closed/i.test(s||"")?"#6b7280":"#60a5fa";
const sl = s=>/live|inprog/i.test(s||"")?"LIVE":/final|closed/i.test(s||"")?"FINAL":"TODAY";

// Static detail data for featured matchups
const DETAILS = {
  // Add details for live games dynamically
};

export default function DashboardPage() {
  const {user,signOut} = useAuth();
  const navigate = useNavigate();
  const [league,setLeague] = useState("mlb");
  const [games,setGames] = useState([]);
  const [gamesLoading,setGamesLoading] = useState(true);
  const [selected,setSelected] = useState(null);
  const [tab,setTab] = useState("Overview");
  const [plan,setPlan] = useState({tier:"free"});
  const [menuOpen,setMenuOpen] = useState(false);
  const lg = LEAGUES.find(l=>l.id===league);
  const isPro = plan.tier==="pro"||plan.tier==="elite";

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

  const pick = (g)=>{ setSelected(g); setTab("Overview"); };
  const back = ()=>setSelected(null);

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Barlow+Condensed:wght@600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1}50%{opacity:.5}}
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
              <div style={{fontSize:10,fontWeight:800,padding:"3px 10px",borderRadius:10,background:isPro?"#ef444420":"#1e2235",color:isPro?"#ef4444":"#475569",border:`1px solid ${isPro?"#ef444440":"#1e2235"}`}}>
                {plan.tier.toUpperCase()}
              </div>
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:34,height:34,borderRadius:"50%",background:"#1e2235",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:14,fontFamily:"inherit"}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen&&(
                  <div style={{position:"absolute",right:0,top:42,background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:8,minWidth:200,zIndex:200}}>
                    <div style={{padding:"8px 12px",fontSize:12,color:"#475569",borderBottom:"1px solid #1e2235",marginBottom:4}}>{user?.email}</div>
                    {!isPro&&<button onClick={()=>{navigate("/pricing");setMenuOpen(false);}} style={{width:"100%",textAlign:"left",background:"#ef444415",border:"1px solid #ef444430",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#ef4444",fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:4}}>⚡ Upgrade — $6.99/mo</button>}
                    <button onClick={()=>{signOut();navigate("/");}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"8px 12px",fontSize:13,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>Sign Out</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #1e2235",marginTop:12,gap:0}}>
            {LEAGUES.map(l=>(
              <button key={l.id} onClick={()=>{setLeague(l.id);setSelected(null);setMenuOpen(false);}}
                style={{flexShrink:0,padding:"10px 12px 12px",background:"none",border:"none",borderBottom:`2px solid ${league===l.id?l.color:"transparent"}`,color:league===l.id?l.color:"#64748b",fontSize:12,fontWeight:league===l.id?700:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,marginBottom:-1,whiteSpace:"nowrap"}}>
                <span>{l.icon}</span><span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      <div style={{maxWidth:900,margin:"0 auto"}}>

        {/* DETAIL VIEW */}
        {selected&&(
          <div style={{animation:"fadeIn .22s ease",paddingBottom:80}}>
            {/* Game header */}
            <div style={{background:`linear-gradient(160deg,${lg.color}18 0%,#0a0a14 60%)`,borderBottom:"1px solid #1e2235",padding:"14px 16px 20px"}}>
              <button onClick={back} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",color:"#64748b",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"0 0 14px"}}>
                <span style={{fontSize:20}}>‹</span> All Games
              </button>
              <div style={{fontSize:11,color:"#475569",fontWeight:600,letterSpacing:"0.08em",marginBottom:10,textTransform:"uppercase"}}>
                {selected.venue} · {selected.city}
              </div>
              {[{team:selected.away,score:selected.awayScore,away:true},{team:selected.home,score:selected.homeScore,away:false}].map(({team,score,away})=>(
                <div key={team} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:3,height:28,borderRadius:2,background:away?"#334155":lg.color}}/>
                    <span style={{fontSize:18,fontWeight:800,color:away?"#94a3b8":"#fff"}}>{team}</span>
                  </div>
                  <span style={{fontFamily:"'Barlow Condensed'",fontSize:34,fontWeight:900,color:score!=null?away?"#94a3b8":"#fff":"#1e2235"}}>{score!=null?score:"—"}</span>
                </div>
              ))}
              <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:sc(selected.status)+"18",color:sc(selected.status),border:`1px solid ${sc(selected.status)}38`}}>
                  {/live|inprog/i.test(selected.status||"")&&<span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"#22c55e",marginRight:5,animation:"pulse2 1.4s infinite"}}/>}
                  {sl(selected.status)}
                </span>
                <span style={{fontSize:12,color:"#475569"}}>{selected.time}</span>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #1e2235",background:"#080810",position:"sticky",top:61,zIndex:99}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)}
                  style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?lg.color:"transparent"}`,color:tab===t?lg.color:"#475569",fontSize:13,fontWeight:tab===t?700:500,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                  {t}
                </button>
              ))}
            </div>

            {/* Pro gate */}
            {!isPro&&tab!=="Overview"&&(
              <div style={{margin:16,background:"linear-gradient(135deg,#ef444418,#f9731408)",border:"1px solid #ef444430",borderRadius:16,padding:28,textAlign:"center"}}>
                <div style={{fontSize:32,marginBottom:12}}>🔒</div>
                <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:8}}>{tab} requires All-Access</div>
                <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Upgrade to access H2H records, player stats, weather analysis and more.</div>
                <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"12px 32px",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                  Upgrade — $6.99/mo →
                </button>
              </div>
            )}

            {/* Tab content */}
            {(isPro||tab==="Overview")&&(
              <div style={{padding:16,animation:"fadeIn .2s ease"}}>
                {tab==="Overview"&&(
                  <div>
                    {/* Game info */}
                    <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,marginBottom:12}}>
                      <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Game Info</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Venue</div>
                          <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{selected.venue||"TBD"}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Location</div>
                          <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{selected.city||"TBD"}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Time</div>
                          <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{selected.time||"TBD"}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</div>
                          <div style={{fontSize:13,fontWeight:600,color:sc(selected.status)}}>{sl(selected.status)}</div>
                        </div>
                      </div>
                    </div>
                    {!isPro&&(
                      <div onClick={()=>navigate("/pricing")} style={{background:"linear-gradient(135deg,#ef444412,#ef444406)",border:"1px solid #ef444430",borderRadius:14,padding:"16px 20px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div>
                          <div style={{fontSize:14,fontWeight:700,color:"#ef4444",marginBottom:4}}>🔒 Unlock Full Analysis</div>
                          <div style={{fontSize:12,color:"#64748b"}}>H2H records · Player stats · Weather · Betting lines</div>
                        </div>
                        <span style={{color:"#ef4444",fontSize:20}}>›</span>
                      </div>
                    )}
                  </div>
                )}
                {tab==="H2H"&&isPro&&(
                  <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>⚔️</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>{selected.away} vs {selected.home}</div>
                    <div style={{fontSize:13,color:"#475569"}}>H2H data loading from live database...</div>
                  </div>
                )}
                {tab==="Players"&&isPro&&(
                  <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🎯</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>Player Matchups</div>
                    <div style={{fontSize:13,color:"#475569"}}>Player stats loading from live database...</div>
                  </div>
                )}
                {tab==="Weather"&&isPro&&(
                  <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🌤</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>Weather Conditions</div>
                    <div style={{fontSize:13,color:"#475569"}}>Weather data loading for {selected.city}...</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* GAMES LIST */}
        {!selected&&(
          <div style={{padding:16,animation:"fadeIn .2s ease"}}>
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
                <div key={g.id} className="gc" onClick={()=>pick(g)}
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
                  <div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"#2d3748",fontSize:20}}>›</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
