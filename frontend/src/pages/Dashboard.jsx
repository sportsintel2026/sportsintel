import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { gamesApi, newsApi, subscriptionApi, supabase } from "../lib/api";

const LEAGUES = [
  {id:"mlb",label:"MLB",icon:"⚾",color:"#e4002b"},
  {id:"nba",label:"NBA",icon:"🏀",color:"#c9a227"},
  {id:"nfl",label:"NFL",icon:"🏈",color:"#013369"},
  {id:"nhl",label:"NHL",icon:"🏒",color:"#0033a0"},
  {id:"soccer",label:"Soccer",icon:"⚽",color:"#22c55e"},
  {id:"ncaamb",label:"NCAAMB",icon:"🏀",color:"#8b5cf6"},
  {id:"ncaawb",label:"NCAAWB",icon:"🏀",color:"#ec4899"},
  {id:"ncaafb",label:"NCAAFB",icon:"🏈",color:"#f59e0b"},
  {id:"mma",label:"MMA",icon:"🥊",color:"#ef4444"},
  {id:"golf",label:"Golf",icon:"⛳",color:"#22c55e"},
];

const TABS = ["Box Score","Weather","Injuries","News"];

export default function DashboardPage() {
  const {user,signOut} = useAuth();
  const navigate = useNavigate();
  const [league,setLeague] = useState("mlb");
  const [games,setGames] = useState([]);
  const [gamesLoading,setGamesLoading] = useState(true);
  const [selected,setSelected] = useState(null);
  const [tab,setTab] = useState("Box Score");
  const [plan,setPlan] = useState({tier:"free"});
  const [menuOpen,setMenuOpen] = useState(false);
  const [boxScore,setBoxScore] = useState(null);
  const [boxLoading,setBoxLoading] = useState(false);
  const [picks,setPicks] = useState([]);
  const [showPicks,setShowPicks] = useState(false);
  const [injuries,setInjuries] = useState([]);
  const [headlines,setHeadlines] = useState([]);
  const lg = LEAGUES.find(l=>l.id===league);
  const isPro = plan.tier==="pro"||plan.tier==="elite";

  useEffect(()=>{ subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); },[]);

  useEffect(()=>{
    const loadPicks = async () => {
      try {
        const today = new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});
        const {data} = await supabase.from("daily_picks").select("*").eq("date",today).single();
        if(data?.picks) setPicks(JSON.parse(data.picks));
      } catch(e) {}
    };
    loadPicks();
  },[]);

  const loadGames = useCallback(async(id)=>{
    setGamesLoading(true); setGames([]); setSelected(null);
    try {
      const res = await gamesApi.getToday(id);
      setGames(res.games||[]);
    } catch { setGames([]); }
    setGamesLoading(false);
  },[]);

  useEffect(()=>{ loadGames(league); },[league,loadGames]);

  useEffect(()=>{
    const loadNews = async () => {
      try {
        const [newsRes, injuryRes] = await Promise.allSettled([
          newsApi.getHeadlines(league),
          (league==="mlb"||league==="nba") ? newsApi.getInjuries(league) : Promise.resolve({injuries:[]}),
        ]);
        if(newsRes.status==="fulfilled") setHeadlines(newsRes.value.headlines||[]);
        if(injuryRes.status==="fulfilled") setInjuries(injuryRes.value.injuries||[]);
      } catch(e) {}
    };
    loadNews();
  },[league]);

  const pickGame = async(g)=>{
    setSelected(g); setTab("Box Score"); setBoxScore(null);
    if(g.status==="live"||g.status==="final"||g.status==="closed") {
      setBoxLoading(true);
      try {
        const res = await gamesApi.getBoxScore(league, g.id);
        setBoxScore(res.boxScore);
      } catch(e) {}
      setBoxLoading(false);
    }
  };

  const back = ()=>{ setSelected(null); setBoxScore(null); };
  const liveGames = games.filter(g=>/live/i.test(g.status||""));
  const finalGames = games.filter(g=>/final|closed/i.test(g.status||""));
  const upcomingGames = games.filter(g=>g.status==="scheduled");
  const gameInjuries = selected ? injuries.filter(inj =>
    inj.team.toLowerCase().includes(selected.away.split(" ").pop().toLowerCase()) ||
    inj.team.toLowerCase().includes(selected.home.split(" ").pop().toLowerCase())
  ) : [];

  return (
    <div style={{minHeight:"100vh",background:"#060608",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes livePulse{0%,100%{box-shadow:0 0 0 0 #22c55e40}70%{box-shadow:0 0 0 6px transparent}}
        .gc{cursor:pointer;transition:all .15s}
        .gc:hover{background:#0c0c18!important;border-color:#252535!important}
        .gc:active{transform:scale(.99)}
        ::-webkit-scrollbar{width:2px;height:2px}
        ::-webkit-scrollbar-thumb{background:#1e2235;border-radius:2px}
        .tab-btn{flex:1;padding:11px 4px;background:none;border:none;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;border-bottom:2px solid transparent;margin-bottom:-1px}
        .league-btn{flex-shrink:0;padding:9px 13px;background:none;border:none;font-size:11px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:4px;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
      `}</style>

      {/* HEADER */}
      <div style={{background:"#09090f",borderBottom:"1px solid #12121e",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px #00000060"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:"0 14px"}}>
          
          {/* Top bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:50}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{position:"relative"}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"livePulse 2s infinite"}}/>
              </div>
              <span style={{fontSize:17,fontWeight:900,color:"#fff",letterSpacing:"-0.01em"}}>Sports<span style={{color:lg.color}}>Intel</span></span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {picks.length>0&&(
                <button onClick={()=>setShowPicks(p=>!p)}
                  style={{background:showPicks?`${lg.color}20`:"transparent",border:`1px solid ${showPicks?lg.color:"#1e2235"}`,color:showPicks?lg.color:"#64748b",borderRadius:8,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,transition:"all .2s"}}>
                  🎯 <span>Picks</span>
                </button>
              )}
              <div style={{fontSize:10,padding:"3px 9px",borderRadius:20,background:isPro?`${lg.color}20`:"#0f0f1a",color:isPro?lg.color:"#334155",border:`1px solid ${isPro?lg.color+"40":"#1a1a2e"}`,fontWeight:700,letterSpacing:"0.05em"}}>
                {plan.tier.toUpperCase()}
              </div>
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${lg.color}40,${lg.color}20)`,border:`1px solid ${lg.color}40`,cursor:"pointer",color:"#fff",fontSize:12,fontFamily:"inherit",fontWeight:800}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen&&(
                  <div style={{position:"absolute",right:0,top:40,background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:12,padding:8,minWidth:200,zIndex:200,boxShadow:"0 12px 40px #00000080"}}>
                    <div style={{padding:"8px 12px",fontSize:11,color:"#334155",borderBottom:"1px solid #1a1a2e",marginBottom:6}}>{user?.email}</div>
                    {!isPro&&(
                      <button onClick={()=>{navigate("/pricing");setMenuOpen(false);}}
                        style={{width:"100%",textAlign:"left",background:"linear-gradient(135deg,#ef444418,#ef44440a)",border:"1px solid #ef444430",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#ef4444",fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginBottom:6}}>
                        ⚡ Upgrade to All-Access — $7/mo
                      </button>
                    )}
                    <button onClick={()=>{navigate("/admin");setMenuOpen(false);}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"7px 12px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>🎯 Manage Picks</button>
                    <button onClick={()=>{signOut();navigate("/");}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"7px 12px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>↩ Sign Out</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* League tabs */}
          <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none",borderTop:"1px solid #12121e"}}>
            {LEAGUES.map(l=>(
              <button key={l.id} className="league-btn" onClick={()=>{setLeague(l.id);setSelected(null);setMenuOpen(false);setShowPicks(false);}}
                style={{color:league===l.id?l.color:"#475569",fontWeight:league===l.id?700:400,borderBottomColor:league===l.id?l.color:"transparent"}}>
                <span>{l.icon}</span><span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      <div style={{maxWidth:860,margin:"0 auto"}}>

        {/* PICKS PANEL */}
        {showPicks&&picks.length>0&&!selected&&(
          <div style={{padding:"12px 14px 0",animation:"fadeIn .25s ease"}}>
            <div style={{background:"linear-gradient(135deg,#0d1a0d,#090f09)",border:"1px solid #22c55e25",borderRadius:14,overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #22c55e15",display:"flex",alignItems:"center",gap:8,background:"#22c55e08"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"pulse2 2s infinite"}}/>
                <span style={{fontSize:12,fontWeight:700,color:"#22c55e",letterSpacing:"0.05em"}}>TODAY'S PICKS</span>
                <span style={{fontSize:10,color:"#22c55e60",marginLeft:"auto",fontWeight:600}}>MEMBERS ONLY</span>
              </div>
              {picks.map((p,i)=>(
                <div key={i} style={{padding:"14px 16px",borderBottom:i<picks.length-1?"1px solid #22c55e10":"none",position:"relative",overflow:"hidden"}}>
                  {!isPro&&i>0&&(
                    <div style={{position:"absolute",inset:0,backdropFilter:"blur(8px)",background:"#06060880",zIndex:2,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <button onClick={()=>navigate("/pricing")} style={{background:"#22c55e",color:"#000",border:"none",borderRadius:8,padding:"7px 16px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                        🔒 Unlock — $7/mo
                      </button>
                    </div>
                  )}
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,color:"#475569",marginBottom:4,fontWeight:500}}>{p.league} · {p.game}</div>
                      <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:4}}>{p.pick} <span style={{fontSize:12,color:"#64748b",fontWeight:400}}>{p.odds}</span></div>
                      <div style={{fontSize:11,color:"#64748b",lineHeight:1.6}}>{p.analysis}</div>
                    </div>
                    <span style={{flexShrink:0,fontSize:10,padding:"3px 9px",borderRadius:20,fontWeight:700,background:p.confidence==="HIGH"?"#22c55e15":p.confidence==="MEDIUM"?"#f59e0b15":"#ef444415",color:p.confidence==="HIGH"?"#22c55e":p.confidence==="MEDIUM"?"#f59e0b":"#ef4444",border:`1px solid ${p.confidence==="HIGH"?"#22c55e30":p.confidence==="MEDIUM"?"#f59e0b30":"#ef444430"}`}}>
                      {p.confidence}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NEWS TICKER */}
        {!selected&&headlines.length>0&&(
          <div style={{padding:"10px 14px 0"}}>
            <div style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:10,color:lg.color,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                <span>📰</span> {lg.label} Headlines
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {headlines.slice(0,3).map((h,i)=>(
                  <a key={i} href={h.link} target="_blank" rel="noopener noreferrer" style={{display:"flex",justifyContent:"space-between",gap:10,textDecoration:"none",padding:"6px 0",borderBottom:i<2?"1px solid #12121e":"none"}}>
                    <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5,flex:1}}>{h.title}</div>
                    <div style={{fontSize:10,color:"#334155",flexShrink:0,marginTop:2,whiteSpace:"nowrap"}}>{h.timeAgo}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* GAME DETAIL */}
        {selected&&(
          <div style={{animation:"fadeIn .2s ease",paddingBottom:60}}>
            {/* Hero header */}
            <div style={{background:`linear-gradient(180deg,${lg.color}18 0%,#060608 100%)`,padding:"14px 14px 18px",borderBottom:"1px solid #12121e",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,right:0,width:200,height:200,background:`radial-gradient(circle,${lg.color}12 0%,transparent 70%)`,pointerEvents:"none"}}/>
              <button onClick={back} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",color:"#475569",cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"0 0 12px",fontWeight:500}}>
                ← Back to Games
              </button>
              <div style={{fontSize:10,color:"#334155",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:500}}>
                📍 {selected.venue} · {selected.city}
              </div>
              
              {/* Score display */}
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
                {[{team:selected.away,score:selected.awayScore,record:boxScore?.awayRecord,isHome:false},{team:selected.home,score:selected.homeScore,record:boxScore?.homeRecord,isHome:true}].map(({team,score,record,isHome})=>(
                  <div key={team} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:3,height:32,borderRadius:2,background:isHome?lg.color:"#1e2235"}}/>
                      <div>
                        <div style={{fontSize:15,fontWeight:isHome?700:500,color:isHome?"#fff":"#94a3b8"}}>{team}</div>
                        {record&&<div style={{fontSize:10,color:"#334155",marginTop:1}}>{record}</div>}
                      </div>
                    </div>
                    <div style={{fontSize:28,fontWeight:900,color:score!=null?(isHome?lg.color:"#e2e8f0"):"#1e2235",fontVariantNumeric:"tabular-nums",minWidth:44,textAlign:"right"}}>
                      {score!=null?score:"–"}
                    </div>
                  </div>
                ))}
              </div>

              {/* Status bar */}
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {/live/i.test(selected.status||"")&&(
                  <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,padding:"3px 10px",borderRadius:20,background:"#22c55e20",color:"#22c55e",border:"1px solid #22c55e40",fontWeight:700}}>
                    <span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",animation:"livePulse 1.5s infinite",display:"inline-block"}}/>
                    LIVE
                  </span>
                )}
                {/final|closed/i.test(selected.status||"")&&(
                  <span style={{fontSize:10,padding:"3px 10px",borderRadius:20,background:"#1e2235",color:"#6b7280",fontWeight:600}}>FINAL</span>
                )}
                {selected.status==="scheduled"&&(
                  <span style={{fontSize:10,padding:"3px 10px",borderRadius:20,background:"#60a5fa15",color:"#60a5fa",border:"1px solid #60a5fa25",fontWeight:600}}>{selected.time}</span>
                )}
                {(boxScore?.inning||selected.inning)&&(
                  <span style={{fontSize:11,color:lg.color,fontWeight:600}}>{boxScore?.inning||selected.inning}</span>
                )}
                {boxScore?.count&&<span style={{fontSize:10,color:"#334155"}}>{boxScore.count}</span>}
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #12121e",background:"#060608",position:"sticky",top:89,zIndex:99}}>
              {TABS.map(t=>(
                <button key={t} className="tab-btn" onClick={()=>setTab(t)}
                  style={{color:tab===t?lg.color:"#475569",fontWeight:tab===t?700:400,borderBottomColor:tab===t?lg.color:"transparent"}}>
                  {t}
                </button>
              ))}
            </div>

            {/* Pro gate */}
            {!isPro&&(
              <div style={{margin:14,background:"linear-gradient(135deg,#ef444410,#ef44440a)",border:"1px solid #ef444428",borderRadius:14,padding:28,textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:12}}>🔒</div>
                <div style={{fontSize:15,fontWeight:800,color:"#fff",marginBottom:8}}>All-Access Required</div>
                <div style={{fontSize:12,color:"#475569",marginBottom:20,lineHeight:1.7}}>Unlock box scores, linescore, pitcher stats, injuries, weather and live news.</div>
                <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"12px 28px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 16px #ef444440"}}>
                  Upgrade — $7/mo →
                </button>
              </div>
            )}

            {isPro&&(
              <div style={{padding:14,animation:"fadeIn .2s ease"}}>

                {/* BOX SCORE */}
                {tab==="Box Score"&&(
                  <div>
                    {boxLoading&&(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{width:24,height:24,border:`3px solid #1e2235`,borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 12px"}}/>
                        <div style={{fontSize:12,color:"#334155"}}>Loading box score...</div>
                      </div>
                    )}
                    {!boxLoading&&!boxScore&&(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{fontSize:32,marginBottom:12}}>⏱</div>
                        <div style={{fontSize:13,color:"#334155"}}>Box score available once game starts</div>
                      </div>
                    )}
                    {!boxLoading&&boxScore&&(
                      <div>
                        {/* Linescore */}
                        <div style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,marginBottom:12,overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead>
                              <tr style={{borderBottom:"1px solid #12121e"}}>
                                <th style={{textAlign:"left",padding:"8px 12px",color:"#334155",fontWeight:500,minWidth:70}}>Team</th>
                                {boxScore.awayLinescore?.map(inn=>(
                                  <th key={inn.inning} style={{padding:"8px 5px",color:"#334155",textAlign:"center",minWidth:18,fontSize:10}}>{inn.inning}</th>
                                ))}
                                <th style={{padding:"8px 10px",color:"#94a3b8",fontWeight:700,textAlign:"center"}}>R</th>
                                <th style={{padding:"8px 8px",color:"#475569",fontWeight:500,textAlign:"center"}}>H</th>
                                <th style={{padding:"8px 8px",color:"#475569",fontWeight:500,textAlign:"center"}}>E</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                {name:selected.away,ls:boxScore.awayLinescore,r:boxScore.awayScore,h:boxScore.awayHits,e:boxScore.awayErrors,color:"#94a3b8"},
                                {name:selected.home,ls:boxScore.homeLinescore,r:boxScore.homeScore,h:boxScore.homeHits,e:boxScore.homeErrors,color:lg.color},
                              ].map(({name,ls,r,h,e,color},i)=>(
                                <tr key={i} style={{borderBottom:i===0?"1px solid #12121e":"none"}}>
                                  <td style={{padding:"8px 12px",color,fontWeight:600,fontSize:11,whiteSpace:"nowrap",maxWidth:90,overflow:"hidden",textOverflow:"ellipsis"}}>{name}</td>
                                  {ls?.map((inn,j)=>(
                                    <td key={j} style={{padding:"8px 5px",textAlign:"center",color:inn.runs>0?"#e2e8f0":"#1e2235",fontSize:12,fontWeight:inn.runs>0?600:400}}>{inn.runs==="X"?"·":inn.runs}</td>
                                  ))}
                                  <td style={{padding:"8px 10px",textAlign:"center",fontWeight:800,color,fontSize:15}}>{r??"-"}</td>
                                  <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{h??"-"}</td>
                                  <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{e??"-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pitchers */}
                        {(boxScore.awayStarter||boxScore.homeStarter)&&(
                          <div style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,padding:14}}>
                            <div style={{fontSize:10,color:"#334155",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>⚾ Starting Pitchers</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                              {[{label:selected.away,p:boxScore.awayStarter,color:"#94a3b8"},{label:selected.home,p:boxScore.homeStarter,color:lg.color}].map(({label,p,color})=>p?(
                                <div key={label} style={{background:"#060608",borderRadius:10,padding:12,border:"1px solid #12121e"}}>
                                  <div style={{fontSize:10,color:"#334155",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
                                  <div style={{fontSize:13,fontWeight:700,color,marginBottom:4}}>{p.name}</div>
                                  <div style={{fontSize:11,color:"#475569"}}>{p.win}W–{p.loss}L · <span style={{color:"#94a3b8"}}>{p.era} ERA</span></div>
                                </div>
                              ):null)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* WEATHER */}
                {tab==="Weather"&&(
                  <div>
                    {(boxScore?.weather||selected.weather)?(
                      <div>
                        <div style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,padding:16,marginBottom:10}}>
                          <div style={{fontSize:10,color:"#334155",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>🌤 Live Conditions · {selected.venue}</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                            {[["🌡 Temp",(boxScore?.weather||selected.weather)?.temp],["☁️ Sky",(boxScore?.weather||selected.weather)?.condition],["💧 Humidity",(boxScore?.weather||selected.weather)?.humidity],["💨 Wind",(boxScore?.weather||selected.weather)?.wind]].filter(([,v])=>v).map(([label,val])=>(
                              <div key={label} style={{background:"#060608",borderRadius:10,padding:12,border:"1px solid #12121e"}}>
                                <div style={{fontSize:10,color:"#334155",marginBottom:4}}>{label}</div>
                                <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0"}}>{val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{background:"#09090f",border:`1px solid ${lg.color}30`,borderRadius:12,padding:14,borderLeft:`3px solid ${lg.color}`}}>
                          <div style={{fontSize:10,color:lg.color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>⚡ Game Impact Analysis</div>
                          <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.8}}>
                            {(()=>{const w=boxScore?.weather||selected.weather;const wind=parseInt(w?.wind)||0;const temp=parseInt(w?.temp)||70;if(wind>15)return `🌬 Strong ${wind} mph winds today. Expect reduced home run distances and difficulty tracking fly balls. Pitchers with good ground ball rates have an advantage.`;if(temp<50)return `🥶 Cold ${temp}°F conditions. The ball won't carry well — expect a pitcher's duel. Under bets look favorable in cold weather.`;if(temp>88)return `🔥 Hot ${temp}°F — balls jump off the bat in warm air. Good day for hitters and over bets. Power hitters have elevated upside.`;return `✅ Ideal ${temp}°F conditions with ${wind} mph winds. Neutral weather — game outcome determined by matchups, not conditions.`;})()}
                          </div>
                        </div>
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{fontSize:32,marginBottom:12}}>🌤</div>
                        <div style={{fontSize:13,color:"#334155"}}>Weather data available for live and completed outdoor games</div>
                      </div>
                    )}
                  </div>
                )}

                {/* INJURIES */}
                {tab==="Injuries"&&(
                  <div>
                    <div style={{fontSize:10,color:"#334155",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>🏥 Injury Report</div>
                    {gameInjuries.length===0?(
                      <div style={{textAlign:"center",padding:40,background:"#09090f",border:"1px solid #12121e",borderRadius:12}}>
                        <div style={{fontSize:28,marginBottom:10}}>✅</div>
                        <div style={{fontSize:13,fontWeight:600,color:"#22c55e",marginBottom:6}}>No Reported Injuries</div>
                        <div style={{fontSize:12,color:"#334155"}}>Both teams appear healthy for this game</div>
                      </div>
                    ):(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {gameInjuries.map((inj,i)=>(
                          <div key={i} style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,padding:14,borderLeft:`3px solid ${inj.status==="Out"?"#ef4444":inj.status==="Questionable"?"#f59e0b":"#22c55e"}`}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                              <div style={{flex:1}}>
                                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:3}}>{inj.player}</div>
                                <div style={{fontSize:11,color:"#475569",marginBottom:6}}>{inj.team} · {inj.position}</div>
                                {inj.description&&<div style={{fontSize:11,color:"#64748b",lineHeight:1.5}}>{inj.description}</div>}
                              </div>
                              <span style={{flexShrink:0,fontSize:10,padding:"3px 10px",borderRadius:20,fontWeight:700,background:inj.status==="Out"?"#ef444415":inj.status==="Questionable"?"#f59e0b15":"#22c55e15",color:inj.status==="Out"?"#ef4444":inj.status==="Questionable"?"#f59e0b":"#22c55e",border:`1px solid ${inj.status==="Out"?"#ef444430":inj.status==="Questionable"?"#f59e0b30":"#22c55e30"}`}}>
                                {inj.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* NEWS */}
                {tab==="News"&&(
                  <div>
                    <div style={{fontSize:10,color:"#334155",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>📰 Latest {lg.label} Headlines</div>
                    {headlines.length===0?(
                      <div style={{textAlign:"center",padding:40,color:"#334155",fontSize:12}}>No headlines available</div>
                    ):(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {headlines.map((h,i)=>(
                          <a key={i} href={h.link} target="_blank" rel="noopener noreferrer"
                            style={{background:"#09090f",border:"1px solid #12121e",borderRadius:12,padding:14,textDecoration:"none",display:"block",transition:"border-color .15s"}}>
                            <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6,lineHeight:1.5}}>{h.title}</div>
                            <div style={{fontSize:11,color:"#475569",lineHeight:1.6,marginBottom:8}}>{h.description}</div>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:10,color:lg.color,fontWeight:600}}>ESPN</span>
                              <span style={{fontSize:10,color:"#334155"}}>·</span>
                              <span style={{fontSize:10,color:"#334155"}}>{h.timeAgo}</span>
                            </div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* GAMES LIST */}
        {!selected&&(
          <div style={{padding:14,animation:"fadeIn .2s ease"}}>

            {!isPro&&(
              <div onClick={()=>navigate("/pricing")}
                style={{background:"linear-gradient(135deg,#ef444412,#ef44440a)",border:"1px solid #ef444428",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",transition:"all .2s"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#ef4444",marginBottom:3}}>⚡ Unlock Full Stats + Daily Picks</div>
                  <div style={{fontSize:11,color:"#475569"}}>Box scores · Injuries · Weather · Live news — $7/mo</div>
                </div>
                <span style={{color:"#ef4444",fontSize:18}}>›</span>
              </div>
            )}

            {gamesLoading&&(
              <div style={{textAlign:"center",padding:48}}>
                <div style={{width:28,height:28,border:`3px solid #1e2235`,borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 14px"}}/>
                <div style={{fontSize:12,color:"#334155"}}>Loading {lg.label} games...</div>
              </div>
            )}

            {!gamesLoading&&games.length===0&&(
              <div style={{textAlign:"center",padding:"48px 20px"}}>
                <div style={{fontSize:40,marginBottom:14}}>{lg.icon}</div>
                <div style={{fontSize:15,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>No {lg.label} Games Today</div>
                <div style={{fontSize:12,color:"#334155"}}>Check back later or try another league</div>
              </div>
            )}

            {/* LIVE */}
            {liveGames.length>0&&(
              <div style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"livePulse 1.5s infinite"}}/>
                  <span style={{fontSize:10,color:"#22c55e",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>Live Now</span>
                  <span style={{fontSize:10,color:"#22c55e60",fontWeight:600}}>{liveGames.length} game{liveGames.length>1?"s":""}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {liveGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pickGame(g)}/>))}
                </div>
              </div>
            )}

            {/* FINAL */}
            {finalGames.length>0&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:10,color:"#475569",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>
                  Final · {finalGames.length} game{finalGames.length>1?"s":""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {finalGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pickGame(g)}/>))}
                </div>
              </div>
            )}

            {/* UPCOMING */}
            {upcomingGames.length>0&&(
              <div>
                <div style={{fontSize:10,color:"#60a5fa",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>
                  Upcoming · {upcomingGames.length} game{upcomingGames.length>1?"s":""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {upcomingGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pickGame(g)}/>))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GameCard({g, lg, onClick}) {
  const isLive = /live/i.test(g.status||"");
  const isFinal = /final|closed/i.test(g.status||"");
  return (
    <div className="gc" onClick={onClick}
      style={{background:"#09090f",border:`1px solid ${isLive?"#22c55e25":"#12121e"}`,borderRadius:12,padding:"13px 14px",position:"relative",overflow:"hidden",boxShadow:isLive?"0 0 20px #22c55e08":"none"}}>
      {isLive&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:"linear-gradient(180deg,#22c55e,#16a34a)",borderRadius:"3px 0 0 3px"}}/>}
      <div style={{paddingLeft:isLive?10:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
          <span style={{fontSize:13,color:"#94a3b8",fontWeight:500}}>{g.away}</span>
          <span style={{fontSize:17,fontWeight:700,color:g.awayScore!=null?"#e2e8f0":"#1e2235",fontVariantNumeric:"tabular-nums",minWidth:32,textAlign:"right"}}>{g.awayScore!=null?g.awayScore:"–"}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{g.home}</span>
          <span style={{fontSize:17,fontWeight:700,color:g.homeScore!=null?lg.color:"#1e2235",fontVariantNumeric:"tabular-nums",minWidth:32,textAlign:"right"}}>{g.homeScore!=null?g.homeScore:"–"}</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {isLive&&(
            <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:"#22c55e",fontWeight:700}}>
              <span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",animation:"livePulse 1.5s infinite",display:"inline-block"}}/>
              LIVE
            </span>
          )}
          {isFinal&&<span style={{fontSize:10,color:"#475569",fontWeight:500}}>FINAL</span>}
          {!isLive&&!isFinal&&<span style={{fontSize:10,color:"#60a5fa",fontWeight:500}}>{g.time}</span>}
          {g.inning&&<span style={{fontSize:10,color:lg.color,fontWeight:600}}>{g.inning}</span>}
          {g.venue&&<span style={{fontSize:10,color:"#1a1a2e"}}>· {g.venue}</span>}
        </div>
      </div>
      <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#1e2235",fontSize:16,fontWeight:300}}>›</div>
    </div>
  );
}
