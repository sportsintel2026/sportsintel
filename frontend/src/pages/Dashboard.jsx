import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { gamesApi, subscriptionApi, supabase } from "../lib/api";

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

const TABS = ["Box Score","Weather","H2H","Players"];
const sc = s=>/live/i.test(s||"")?"#22c55e":/final|closed/i.test(s||"")?"#6b7280":"#60a5fa";
const sl = s=>/live/i.test(s||"")?"LIVE":/final|closed/i.test(s||"")?"FINAL":"UPCOMING";

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

  const pick = async(g)=>{
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

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .gc{cursor:pointer;transition:background .15s}
        .gc:hover{background:#0d0d1c!important}
        .gc:active{opacity:.8}
        ::-webkit-scrollbar{width:2px;height:2px}
        ::-webkit-scrollbar-thumb{background:#1e2235;border-radius:2px}
      `}</style>

      {/* TOP NAV */}
      <div style={{background:"#0a0a12",borderBottom:"1px solid #0f0f1a",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"0 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:48}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 6px #22c55e",animation:"pulse2 2s infinite"}}/>
              <span style={{fontSize:15,fontWeight:800,color:"#fff"}}>SportsIntel</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {picks.length>0&&(
                <button onClick={()=>setShowPicks(p=>!p)}
                  style={{background:showPicks?"#ef444420":"#0f0f1a",border:`1px solid ${showPicks?"#ef444440":"#1a1a2e"}`,color:showPicks?"#ef4444":"#64748b",borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                  🎯 Picks {showPicks?"▲":"▼"}
                </button>
              )}
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:isPro?"#ef444415":"#0f0f1a",color:isPro?"#ef4444":"#334155",border:`1px solid ${isPro?"#ef444428":"#1a1a2e"}`}}>
                {plan.tier.toUpperCase()}
              </span>
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:30,height:30,borderRadius:"50%",background:"#1a1a2e",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:12,fontFamily:"inherit",fontWeight:700}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen&&(
                  <div style={{position:"absolute",right:0,top:38,background:"#0d0d1a",border:"1px solid #1a1a2e",borderRadius:10,padding:6,minWidth:190,zIndex:200,boxShadow:"0 8px 32px #00000060"}}>
                    <div style={{padding:"6px 10px",fontSize:11,color:"#334155",borderBottom:"1px solid #1a1a2e",marginBottom:4}}>{user?.email}</div>
                    {!isPro&&<button onClick={()=>{navigate("/pricing");setMenuOpen(false);}} style={{width:"100%",textAlign:"left",background:"#ef444412",border:"1px solid #ef444425",borderRadius:6,padding:"7px 10px",fontSize:12,color:"#ef4444",fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:4}}>⚡ Upgrade — $7/mo</button>}
                    <button onClick={()=>{navigate("/admin");setMenuOpen(false);}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"7px 10px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>🎯 Manage Picks</button>
                    <button onClick={()=>{signOut();navigate("/");}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"7px 10px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>Sign Out</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* League tabs */}
          <div style={{display:"flex",overflowX:"auto",gap:0,scrollbarWidth:"none",borderTop:"1px solid #0f0f1a"}}>
            {LEAGUES.map(l=>(
              <button key={l.id} onClick={()=>{setLeague(l.id);setSelected(null);setMenuOpen(false);setShowPicks(false);}}
                style={{flexShrink:0,padding:"8px 12px",background:"none",border:"none",borderBottom:`2px solid ${league===l.id?l.color:"transparent"}`,color:league===l.id?l.color:"#475569",fontSize:11,fontWeight:league===l.id?600:400,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:3,whiteSpace:"nowrap",transition:"color .15s"}}>
                <span style={{fontSize:12}}>{l.icon}</span><span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      <div style={{maxWidth:900,margin:"0 auto"}}>

        {/* PICKS PANEL */}
        {showPicks&&picks.length>0&&!selected&&(
          <div style={{padding:"12px 14px 0",animation:"fadeIn .2s ease"}}>
            <div style={{background:"#0a0a12",border:"1px solid #1a1a2e",borderRadius:12,overflow:"hidden",marginBottom:4}}>
              <div style={{padding:"10px 14px",borderBottom:"1px solid #0f0f1a",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13}}>🎯</span>
                <span style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>Today's Picks</span>
                <span style={{fontSize:10,color:"#475569",marginLeft:"auto"}}>Members Only</span>
              </div>
              {picks.map((p,i)=>(
                <div key={i} style={{padding:"12px 14px",borderBottom:i<picks.length-1?"1px solid #0f0f1a":"none",position:"relative",overflow:"hidden"}}>
                  {!isPro&&i>0&&(
                    <div style={{position:"absolute",inset:0,backdropFilter:"blur(6px)",background:"#08081080",zIndex:2,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:6,padding:"6px 14px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        🔒 Unlock — $7/mo
                      </button>
                    </div>
                  )}
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:10,color:"#475569",marginBottom:3}}>{p.league} · {p.game}</div>
                      <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:3}}>{p.pick} <span style={{fontSize:12,color:"#64748b",fontWeight:400}}>{p.odds}</span></div>
                      <div style={{fontSize:11,color:"#64748b",lineHeight:1.6}}>{p.analysis}</div>
                    </div>
                    <span style={{flexShrink:0,fontSize:10,padding:"2px 8px",borderRadius:6,background:p.confidence==="HIGH"?"#22c55e15":p.confidence==="MEDIUM"?"#f59e0b15":"#ef444415",color:p.confidence==="HIGH"?"#22c55e":p.confidence==="MEDIUM"?"#f59e0b":"#ef4444",border:`1px solid ${p.confidence==="HIGH"?"#22c55e25":p.confidence==="MEDIUM"?"#f59e0b25":"#ef444425"}`,fontWeight:700}}>
                      {p.confidence}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DETAIL VIEW */}
        {selected&&(
          <div style={{animation:"fadeIn .2s ease",paddingBottom:60}}>
            <div style={{padding:"12px 14px 16px",borderBottom:"1px solid #0f0f1a"}}>
              <button onClick={back} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",color:"#475569",cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"0 0 10px"}}>
                ‹ All Games
              </button>
              <div style={{fontSize:10,color:"#334155",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                {selected.venue} · {selected.city}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <span style={{fontSize:14,color:"#94a3b8",fontWeight:500}}>{selected.away}{boxScore?.awayRecord&&<span style={{fontSize:10,color:"#334155",marginLeft:6}}>{boxScore.awayRecord}</span>}</span>
                <span style={{fontSize:22,fontWeight:700,color:"#fff",minWidth:32,textAlign:"right"}}>{selected.awayScore!=null?selected.awayScore:"–"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:14,fontWeight:600,color:"#fff"}}>{selected.home}{boxScore?.homeRecord&&<span style={{fontSize:10,color:"#334155",marginLeft:6}}>{boxScore.homeRecord}</span>}</span>
                <span style={{fontSize:22,fontWeight:700,color:"#fff",minWidth:32,textAlign:"right"}}>{selected.homeScore!=null?selected.homeScore:"–"}</span>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:6,background:sc(selected.status)+"15",color:sc(selected.status),border:`1px solid ${sc(selected.status)}28`,display:"inline-flex",alignItems:"center",gap:3}}>
                  {/live/i.test(selected.status||"")&&<span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
                  {sl(selected.status)}
                </span>
                <span style={{fontSize:11,color:"#475569"}}>{selected.time}</span>
                {(boxScore?.inning||selected.inning)&&<span style={{fontSize:11,color:lg.color}}>{boxScore?.inning||selected.inning}</span>}
                {boxScore?.count&&<span style={{fontSize:10,color:"#334155"}}>{boxScore.count}</span>}
              </div>
            </div>

            <div style={{display:"flex",borderBottom:"1px solid #0f0f1a",background:"#080810",position:"sticky",top:89,zIndex:99}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)}
                  style={{flex:1,padding:"10px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?lg.color:"transparent"}`,color:tab===t?lg.color:"#475569",fontSize:11,fontWeight:tab===t?600:400,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                  {t}
                </button>
              ))}
            </div>

            {!isPro&&(
              <div style={{margin:14,background:"#0a0a12",border:"1px solid #1a1a2e",borderRadius:12,padding:24,textAlign:"center"}}>
                <div style={{fontSize:22,marginBottom:10}}>🔒</div>
                <div style={{fontSize:14,fontWeight:700,color:"#fff",marginBottom:6}}>All-Access Required</div>
                <div style={{fontSize:12,color:"#475569",marginBottom:16,lineHeight:1.6}}>Unlock box scores, linescore, pitchers, weather and more.</div>
                <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  Upgrade — $7/mo →
                </button>
              </div>
            )}

            {isPro&&(
              <div style={{padding:14}}>
                {tab==="Box Score"&&(
                  <div>
                    {boxLoading&&<div style={{textAlign:"center",padding:32}}><div style={{width:22,height:22,border:"2px solid #1a1a2e",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 10px"}}/><div style={{fontSize:12,color:"#334155"}}>Loading...</div></div>}
                    {!boxLoading&&!boxScore&&<div style={{textAlign:"center",padding:32,color:"#334155",fontSize:12}}>Box score available once game starts</div>}
                    {!boxLoading&&boxScore&&(
                      <div>
                        <div style={{background:"#0a0a12",borderRadius:10,marginBottom:10,overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:260}}>
                            <thead>
                              <tr style={{borderBottom:"1px solid #0f0f1a"}}>
                                <th style={{textAlign:"left",padding:"7px 10px",color:"#334155",fontWeight:500,minWidth:70}}>Team</th>
                                {boxScore.awayLinescore?.map(inn=>(
                                  <th key={inn.inning} style={{padding:"7px 4px",color:"#334155",textAlign:"center",minWidth:16,fontSize:10}}>{inn.inning}</th>
                                ))}
                                <th style={{padding:"7px 8px",color:"#94a3b8",fontWeight:600,textAlign:"center"}}>R</th>
                                <th style={{padding:"7px 8px",color:"#475569",textAlign:"center"}}>H</th>
                                <th style={{padding:"7px 8px",color:"#475569",textAlign:"center"}}>E</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                {name:selected.away,ls:boxScore.awayLinescore,r:boxScore.awayScore,h:boxScore.awayHits,e:boxScore.awayErrors},
                                {name:selected.home,ls:boxScore.homeLinescore,r:boxScore.homeScore,h:boxScore.homeHits,e:boxScore.homeErrors},
                              ].map(({name,ls,r,h,e},i)=>(
                                <tr key={i} style={{borderBottom:i===0?"1px solid #0f0f1a":"none"}}>
                                  <td style={{padding:"7px 10px",color:"#94a3b8",fontWeight:500,fontSize:11,whiteSpace:"nowrap",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}}>{name}</td>
                                  {ls?.map((inn,j)=>(
                                    <td key={j} style={{padding:"7px 4px",textAlign:"center",color:inn.runs>0?"#e2e8f0":"#1e2235",fontSize:11}}>{inn.runs==="X"?"·":inn.runs}</td>
                                  ))}
                                  <td style={{padding:"7px 8px",textAlign:"center",fontWeight:700,color:"#fff",fontSize:13}}>{r??"-"}</td>
                                  <td style={{padding:"7px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{h??"-"}</td>
                                  <td style={{padding:"7px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{e??"-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {(boxScore.awayStarter||boxScore.homeStarter)&&(
                          <div style={{background:"#0a0a12",borderRadius:10,padding:12}}>
                            <div style={{fontSize:10,color:"#334155",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Starting Pitchers</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                              {[{label:selected.away,p:boxScore.awayStarter},{label:selected.home,p:boxScore.homeStarter}].map(({label,p})=>p?(
                                <div key={label}>
                                  <div style={{fontSize:10,color:"#334155",marginBottom:3}}>{label}</div>
                                  <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:2}}>{p.name}</div>
                                  <div style={{fontSize:11,color:"#475569"}}>{p.win}W-{p.loss}L · {p.era} ERA</div>
                                </div>
                              ):null)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {tab==="Weather"&&(
                  <div>
                    {(boxScore?.weather||selected.weather)?(
                      <div>
                        <div style={{background:"#0a0a12",borderRadius:10,padding:14,marginBottom:10}}>
                          <div style={{fontSize:10,color:"#334155",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Live Conditions · {selected.venue}</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                            {[["Temperature",(boxScore?.weather||selected.weather)?.temp],["Condition",(boxScore?.weather||selected.weather)?.condition],["Humidity",(boxScore?.weather||selected.weather)?.humidity],["Wind",(boxScore?.weather||selected.weather)?.wind]].filter(([,v])=>v).map(([label,val])=>(
                              <div key={label}>
                                <div style={{fontSize:10,color:"#334155",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
                                <div style={{fontSize:13,fontWeight:500,color:"#e2e8f0"}}>{val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{background:"#0a0a12",borderRadius:10,padding:14,borderLeft:`2px solid ${lg.color}`}}>
                          <div style={{fontSize:10,color:lg.color,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Game Impact</div>
                          <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.7}}>
                            {(()=>{const w=boxScore?.weather||selected.weather;const wind=parseInt(w?.wind)||0;const temp=parseInt(w?.temp)||70;if(wind>15)return `Strong ${wind} mph wind may affect fly balls. Slight pitching advantage.`;if(temp<55)return `Cold ${temp}°F — ball doesn't carry as well. Pitchers benefit.`;if(temp>85)return `Hot ${temp}°F — ball carries further. Good for hitters.`;return `${temp}°F, ${wind} mph wind. Neutral conditions.`;})()}
                          </div>
                        </div>
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:32,color:"#334155",fontSize:12}}>Weather available for live and completed games</div>
                    )}
                  </div>
                )}
                {tab==="H2H"&&<div style={{textAlign:"center",padding:32}}><div style={{fontSize:22,marginBottom:10}}>⚔️</div><div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>{selected.away} vs {selected.home}</div><div style={{fontSize:12,color:"#475569"}}>H2H history coming soon</div></div>}
                {tab==="Players"&&<div style={{textAlign:"center",padding:32}}><div style={{fontSize:22,marginBottom:10}}>🎯</div><div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>Player Matchups</div><div style={{fontSize:12,color:"#475569"}}>Player vs opponent stats coming soon</div></div>}
              </div>
            )}
          </div>
        )}

        {/* GAMES LIST */}
        {!selected&&(
          <div style={{padding:14,animation:"fadeIn .2s ease"}}>
            {!isPro&&(
              <div onClick={()=>navigate("/pricing")} style={{background:"#0a0a12",border:"1px solid #1a1a2e",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:"#ef4444"}}>⚡ Unlock Full Stats + Daily Picks</div>
                  <div style={{fontSize:11,color:"#334155",marginTop:1}}>Box scores, linescore, pitchers, weather — $7/mo</div>
                </div>
                <span style={{color:"#ef4444",fontSize:16,marginLeft:8}}>›</span>
              </div>
            )}

            {gamesLoading&&<div style={{textAlign:"center",padding:40}}><div style={{width:22,height:22,border:"2px solid #1a1a2e",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 10px"}}/><div style={{fontSize:12,color:"#334155"}}>Loading games...</div></div>}

            {!gamesLoading&&games.length===0&&<div style={{textAlign:"center",padding:"40px 20px"}}><div style={{fontSize:32,marginBottom:10}}>{lg.icon}</div><div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>No games today</div><div style={{fontSize:12,color:"#334155"}}>Check back later</div></div>}

            {/* Live games */}
            {liveGames.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:"#22c55e",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,display:"flex",alignItems:"center",gap:5}}>
                  <span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block",animation:"pulse2 1.4s infinite"}}/>
                  Live Now · {liveGames.length} Game{liveGames.length>1?"s":""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {liveGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pick(g)}/>))}
                </div>
              </div>
            )}

            {/* Final games */}
            {finalGames.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:"#6b7280",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                  Final · {finalGames.length} Game{finalGames.length>1?"s":""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {finalGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pick(g)}/>))}
                </div>
              </div>
            )}

            {/* Upcoming games */}
            {upcomingGames.length>0&&(
              <div>
                <div style={{fontSize:10,color:"#60a5fa",fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>
                  Upcoming · {upcomingGames.length} Game{upcomingGames.length>1?"s":""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {upcomingGames.map(g=>(<GameCard key={g.id} g={g} lg={lg} onClick={()=>pick(g)}/>))}
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
      style={{background:"#0a0a12",border:`1px solid ${isLive?"#22c55e20":"#0f0f1a"}`,borderRadius:10,padding:"11px 14px",position:"relative",overflow:"hidden"}}>
      {isLive&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:2,background:"#22c55e",borderRadius:"2px 0 0 2px"}}/>}
      <div style={{paddingLeft:isLive?8:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
          <span style={{fontSize:13,color:"#94a3b8"}}>{g.away}</span>
          <span style={{fontSize:15,fontWeight:600,color:"#fff",minWidth:28,textAlign:"right"}}>{g.awayScore!=null?g.awayScore:"–"}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{g.home}</span>
          <span style={{fontSize:15,fontWeight:600,color:"#fff",minWidth:28,textAlign:"right"}}>{g.homeScore!=null?g.homeScore:"–"}</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {isLive&&<span style={{fontSize:10,color:"#22c55e",fontWeight:600,display:"flex",alignItems:"center",gap:3}}><span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>LIVE</span>}
          {isFinal&&<span style={{fontSize:10,color:"#6b7280",fontWeight:500}}>FINAL</span>}
          {!isLive&&!isFinal&&<span style={{fontSize:10,color:"#60a5fa",fontWeight:500}}>{g.time}</span>}
          {g.inning&&<span style={{fontSize:10,color:lg.color}}>{g.inning}</span>}
          {g.venue&&<span style={{fontSize:10,color:"#1e2235"}}>· {g.venue}</span>}
        </div>
      </div>
      <div style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",color:"#1a1a2e",fontSize:14}}>›</div>
    </div>
  );
}
