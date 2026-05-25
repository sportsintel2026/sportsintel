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

const TABS = ["Box Score","Weather","H2H","Players"];
const sc = s=>/live/i.test(s||"")?"#22c55e":/final|closed/i.test(s||"")?"#6b7280":"#60a5fa";
const sl = s=>/live/i.test(s||"")?"LIVE":/final|closed/i.test(s||"")?"FINAL":"TODAY";

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

  const pick = async(g)=>{
    setSelected(g); setTab("Box Score"); setBoxScore(null);
    if(g.status==="live"||g.status==="final"||g.status==="closed") {
      setBoxLoading(true);
      try {
        const res = await gamesApi.getBoxScore(league, g.id);
        setBoxScore(res.boxScore);
      } catch(e) { console.error(e); }
      setBoxLoading(false);
    }
  };

  const back = ()=>{ setSelected(null); setBoxScore(null); };

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
            <div style={{background:`linear-gradient(160deg,${lg.color}18 0%,#0a0a14 60%)`,borderBottom:"1px solid #1e2235",padding:"14px 16px 20px"}}>
              <button onClick={back} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",color:"#64748b",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"0 0 14px"}}>
                <span style={{fontSize:20}}>‹</span> All Games
              </button>
              <div style={{fontSize:11,color:"#475569",fontWeight:600,letterSpacing:"0.08em",marginBottom:10,textTransform:"uppercase"}}>
                {selected.venue} · {selected.city}
              </div>
              {[{team:selected.away,score:selected.awayScore,record:boxScore?.awayRecord,away:true},{team:selected.home,score:selected.homeScore,record:boxScore?.homeRecord,away:false}].map(({team,score,record,away})=>(
                <div key={team} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:3,height:28,borderRadius:2,background:away?"#334155":lg.color}}/>
                    <div>
                      <span style={{fontSize:18,fontWeight:800,color:away?"#94a3b8":"#fff"}}>{team}</span>
                      {record&&<span style={{fontSize:11,color:"#475569",marginLeft:8}}>{record}</span>}
                    </div>
                  </div>
                  <span style={{fontFamily:"'Barlow Condensed'",fontSize:34,fontWeight:900,color:score!=null?away?"#94a3b8":"#fff":"#1e2235"}}>{score!=null?score:"—"}</span>
                </div>
              ))}
              <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:sc(selected.status)+"18",color:sc(selected.status),border:`1px solid ${sc(selected.status)}38`,display:"inline-flex",alignItems:"center",gap:4}}>
                  {/live/i.test(selected.status||"")&&<span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"#22c55e",marginRight:5,animation:"pulse2 1.4s infinite"}}/>}
                  {sl(selected.status)}
                </span>
                <span style={{fontSize:12,color:"#475569"}}>{selected.time}</span>
                {(boxScore?.inning||selected.inning)&&<span style={{fontSize:12,color:lg.color,fontWeight:700}}>{boxScore?.inning||selected.inning}</span>}
                {boxScore?.count&&<span style={{fontSize:11,color:"#475569"}}>{boxScore.count}</span>}
                {selected.quarter&&<span style={{fontSize:12,color:lg.color,fontWeight:700}}>Q{selected.quarter}</span>}
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #1e2235",background:"#080810",position:"sticky",top:61,zIndex:99}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)}
                  style={{flex:1,padding:"12px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?lg.color:"transparent"}`,color:tab===t?lg.color:"#475569",fontSize:12,fontWeight:tab===t?700:500,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                  {t}
                </button>
              ))}
            </div>

            {!isPro&&(
              <div style={{margin:16,background:"linear-gradient(135deg,#ef444418,#f9731408)",border:"1px solid #ef444430",borderRadius:16,padding:28,textAlign:"center"}}>
                <div style={{fontSize:32,marginBottom:12}}>🔒</div>
                <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:8}}>Unlock Full Stats</div>
                <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Get box scores, linescore, pitcher stats, weather analysis and more.</div>
                <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"12px 32px",fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                  Upgrade — $6.99/mo →
                </button>
              </div>
            )}

            {isPro&&(
              <div style={{padding:16,animation:"fadeIn .2s ease"}}>

                {/* BOX SCORE TAB */}
                {tab==="Box Score"&&(
                  <div>
                    {boxLoading&&(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{width:28,height:28,border:"3px solid #1e2235",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 14px"}}/>
                        <div style={{fontSize:13,color:"#475569"}}>Loading box score...</div>
                      </div>
                    )}
                    {!boxLoading&&!boxScore&&(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{fontSize:36,marginBottom:12}}>⏱</div>
                        <div style={{fontSize:14,color:"#475569"}}>Box score available once the game starts</div>
                      </div>
                    )}
                    {!boxLoading&&boxScore&&(
                      <div>
                        {/* R H E Summary */}
                        <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:14,padding:16,marginBottom:12,overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:280}}>
                            <thead>
                              <tr style={{borderBottom:"1px solid #1e2235"}}>
                                <th style={{textAlign:"left",padding:"6px 10px",color:"#475569",fontWeight:600}}>Team</th>
                                {boxScore.awayLinescore?.length>0&&boxScore.awayLinescore.map(inn=>(
                                  <th key={inn.inning} style={{padding:"6px 6px",color:"#475569",fontWeight:600,textAlign:"center",fontSize:11}}>{inn.inning}</th>
                                ))}
                                <th style={{padding:"6px 8px",color:"#ef4444",fontWeight:700,textAlign:"center"}}>R</th>
                                <th style={{padding:"6px 8px",color:"#475569",fontWeight:600,textAlign:"center"}}>H</th>
                                <th style={{padding:"6px 8px",color:"#475569",fontWeight:600,textAlign:"center"}}>E</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr style={{borderBottom:"1px solid #0d1120"}}>
                                <td style={{padding:"8px 10px",fontWeight:700,color:"#94a3b8",whiteSpace:"nowrap"}}>{selected.away}</td>
                                {boxScore.awayLinescore?.map((inn,i)=>(
                                  <td key={i} style={{padding:"8px 6px",textAlign:"center",color:"#64748b",fontSize:12}}>{inn.runs}</td>
                                ))}
                                <td style={{padding:"8px 8px",textAlign:"center",fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:900,color:"#e2e8f0"}}>{boxScore.awayScore??"-"}</td>
                                <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b"}}>{boxScore.awayHits??"-"}</td>
                                <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b"}}>{boxScore.awayErrors??"-"}</td>
                              </tr>
                              <tr>
                                <td style={{padding:"8px 10px",fontWeight:700,color:"#fff",whiteSpace:"nowrap"}}>{selected.home}</td>
                                {boxScore.homeLinescore?.map((inn,i)=>(
                                  <td key={i} style={{padding:"8px 6px",textAlign:"center",color:"#64748b",fontSize:12}}>{inn.runs==="X"?"·":inn.runs}</td>
                                ))}
                                <td style={{padding:"8px 8px",textAlign:"center",fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:900,color:lg.color}}>{boxScore.homeScore??"-"}</td>
                                <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b"}}>{boxScore.homeHits??"-"}</td>
                                <td style={{padding:"8px 8px",textAlign:"center",color:"#64748b"}}>{boxScore.homeErrors??"-"}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Pitchers */}
                        {(boxScore.awayStarter||boxScore.homeStarter)&&(
                          <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:14,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Pitchers</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                              {[{label:`${selected.away} SP`,p:boxScore.awayStarter},{label:`${selected.home} SP`,p:boxScore.homeStarter}].map(({label,p})=>p?(
                                <div key={label} style={{background:"#080810",borderRadius:10,padding:12}}>
                                  <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
                                  <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>{p.name}</div>
                                  <div style={{fontSize:12,color:"#64748b"}}>{p.win}W-{p.loss}L · ERA {p.era}</div>
                                </div>
                              ):null)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* WEATHER TAB */}
                {tab==="Weather"&&(
                  <div>
                    {(boxScore?.weather||selected.weather)?(
                      <div>
                        <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:20,marginBottom:12}}>
                          <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14}}>
                            Live Conditions · {selected.venue}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                            {[
                              ["🌡 Temperature",(boxScore?.weather||selected.weather)?.temp],
                              ["☁️ Condition",(boxScore?.weather||selected.weather)?.condition],
                              ["💧 Humidity",(boxScore?.weather||selected.weather)?.humidity],
                              ["💨 Wind",(boxScore?.weather||selected.weather)?.wind],
                              ["☁ Cloud Cover",(boxScore?.weather||selected.weather)?.cloudCover],
                            ].filter(([,v])=>v).map(([label,val])=>(
                              <div key={label} style={{background:"#080810",borderRadius:10,padding:12}}>
                                <div style={{fontSize:10,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
                                <div style={{fontSize:15,fontWeight:700,color:"#e2e8f0"}}>{val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{background:`${lg.color}10`,border:`1px solid ${lg.color}30`,borderRadius:14,padding:16}}>
                          <div style={{fontSize:11,color:lg.color,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>⚡ Game Impact</div>
                          <div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.7}}>
                            {(()=>{
                              const w = boxScore?.weather||selected.weather;
                              const wind = parseInt(w?.wind)||0;
                              const temp = parseInt(w?.temp)||70;
                              if(wind>15) return `Strong ${wind} mph wind — expect reduced home run distances and potential affect on fly balls. Pitchers may have an advantage today.`;
                              if(temp<55) return `Cold ${temp}°F conditions — ball doesn't carry as well in cold air. Pitchers typically benefit in cold weather games.`;
                              if(temp>85) return `Hot ${temp}°F conditions — ball carries further in warm air. Good conditions for hitters and home runs.`;
                              return `Comfortable ${temp}°F with ${wind} mph winds. Neutral conditions — expect normal ball flight and standard game conditions.`;
                            })()}
                          </div>
                        </div>
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:40}}>
                        <div style={{fontSize:36,marginBottom:12}}>🌤</div>
                        <div style={{fontSize:14,color:"#475569"}}>Weather data available for live and completed games</div>
                      </div>
                    )}
                  </div>
                )}

                {/* H2H TAB */}
                {tab==="H2H"&&(
                  <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:24,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>⚔️</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>{selected.away} vs {selected.home}</div>
                    <div style={{fontSize:13,color:"#475569"}}>Full H2H history coming soon in next update</div>
                  </div>
                )}

                {/* PLAYERS TAB */}
                {tab==="Players"&&(
                  <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:24,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>🎯</div>
                    <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>Player Matchups</div>
                    <div style={{fontSize:13,color:"#475569"}}>Career stats vs opponent coming soon in next update</div>
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
                  <div style={{fontSize:11,color:"#475569",marginTop:2}}>Box scores, linescore, pitchers, weather — $6.99/mo</div>
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
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:/live/i.test(g.status||"")?"#22c55e":"#1a1a2e",borderRadius:"3px 0 0 3px"}}/>
                  <div style={{paddingLeft:10}}>
                    {[{team:g.away,score:g.awayScore},{team:g.home,score:g.homeScore}].map(({team,score},i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:i===0?5:0}}>
                        <span style={{fontSize:15,fontWeight:600,color:"#e2e8f0"}}>{team}</span>
                        <span style={{fontFamily:"'Barlow Condensed'",fontSize:22,fontWeight:900,color:score!=null?"#fff":"#1e2235"}}>{score!=null?score:"–"}</span>
                      </div>
                    ))}
                    <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10,background:sc(g.status)+"18",color:sc(g.status),border:`1px solid ${sc(g.status)}38`,display:"inline-flex",alignItems:"center",gap:4}}>
                        {/live/i.test(g.status||"")&&<span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
                        {sl(g.status)}
                      </span>
                      <span style={{fontSize:11,color:"#475569"}}>{g.time}</span>
                      {g.inning&&<span style={{fontSize:11,color:lg.color,fontWeight:700}}>{g.inning}</span>}
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
