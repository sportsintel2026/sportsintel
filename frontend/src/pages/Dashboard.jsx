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
      } catch(e) {}
      setBoxLoading(false);
    }
  };

  const back = ()=>{ setSelected(null); setBoxScore(null); };

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        @keyframes pulse2{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .gc{transition:background .15s;cursor:pointer}
        .gc:hover{background:#0f0f1e!important}
        .gc:active{opacity:.8}
        ::-webkit-scrollbar{width:2px;height:2px}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
        table{border-spacing:0}
        th,td{font-weight:400}
      `}</style>

      {/* Header */}
      <div style={{background:"#0a0a12",borderBottom:"1px solid #1a1a2e",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:"0 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0 0"}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 6px #22c55e",animation:"pulse2 2s infinite"}}/>
              <span style={{fontSize:16,fontWeight:700,letterSpacing:"0.04em",color:"#fff"}}>SportsIntel</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:8,background:isPro?"#ef444418":"#1a1a2e",color:isPro?"#ef4444":"#475569",border:`1px solid ${isPro?"#ef444430":"#1a1a2e"}`}}>
                {plan.tier.toUpperCase()}
              </span>
              <div style={{position:"relative"}}>
                <button onClick={()=>setMenuOpen(o=>!o)}
                  style={{width:30,height:30,borderRadius:"50%",background:"#1a1a2e",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:12,fontFamily:"inherit"}}>
                  {user?.email?.[0]?.toUpperCase()||"U"}
                </button>
                {menuOpen&&(
                  <div style={{position:"absolute",right:0,top:38,background:"#0d0d1a",border:"1px solid #1a1a2e",borderRadius:10,padding:6,minWidth:180,zIndex:200}}>
                    <div style={{padding:"6px 10px",fontSize:11,color:"#475569",borderBottom:"1px solid #1a1a2e",marginBottom:4}}>{user?.email}</div>
                    {!isPro&&<button onClick={()=>{navigate("/pricing");setMenuOpen(false);}} style={{width:"100%",textAlign:"left",background:"#ef444412",border:"1px solid #ef444428",borderRadius:6,padding:"6px 10px",fontSize:12,color:"#ef4444",fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:4}}>⚡ Upgrade $6.99/mo</button>}
                    <button onClick={()=>{signOut();navigate("/");}} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"6px 10px",fontSize:12,color:"#64748b",cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>Sign Out</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #1a1a2e",marginTop:10,gap:0,scrollbarWidth:"none"}}>
            {LEAGUES.map(l=>(
              <button key={l.id} onClick={()=>{setLeague(l.id);setSelected(null);setMenuOpen(false);}}
                style={{flexShrink:0,padding:"8px 10px 10px",background:"none",border:"none",borderBottom:`2px solid ${league===l.id?l.color:"transparent"}`,color:league===l.id?l.color:"#64748b",fontSize:11,fontWeight:league===l.id?600:400,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:3,marginBottom:-1,whiteSpace:"nowrap"}}>
                <span style={{fontSize:12}}>{l.icon}</span><span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>}

      <div style={{maxWidth:860,margin:"0 auto"}}>

        {/* DETAIL VIEW */}
        {selected&&(
          <div style={{animation:"fadeIn .2s ease",paddingBottom:60}}>

            {/* Game header */}
            <div style={{padding:"12px 14px 16px",borderBottom:"1px solid #1a1a2e"}}>
              <button onClick={back} style={{display:"flex",alignItems:"center",gap:4,background:"none",border:"none",color:"#475569",cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"0 0 10px"}}>
                ‹ All Games
              </button>
              <div style={{fontSize:10,color:"#334155",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>
                {selected.venue} · {selected.city}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <span style={{fontSize:14,color:"#94a3b8",fontWeight:500}}>{selected.away}{boxScore?.awayRecord&&<span style={{fontSize:10,color:"#334155",marginLeft:6}}>{boxScore.awayRecord}</span>}</span>
                <span style={{fontSize:20,fontWeight:700,color:selected.awayScore!=null?"#e2e8f0":"#1a1a2e"}}>{selected.awayScore!=null?selected.awayScore:"–"}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:14,color:"#fff",fontWeight:600}}>{selected.home}{boxScore?.homeRecord&&<span style={{fontSize:10,color:"#334155",marginLeft:6}}>{boxScore.homeRecord}</span>}</span>
                <span style={{fontSize:20,fontWeight:700,color:selected.homeScore!=null?lg.color:"#1a1a2e"}}>{selected.homeScore!=null?selected.homeScore:"–"}</span>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,padding:"2px 7px",borderRadius:8,background:sc(selected.status)+"15",color:sc(selected.status),border:`1px solid ${sc(selected.status)}30`,display:"inline-flex",alignItems:"center",gap:3}}>
                  {/live/i.test(selected.status||"")&&<span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
                  {sl(selected.status)}
                </span>
                <span style={{fontSize:11,color:"#475569"}}>{selected.time}</span>
                {(boxScore?.inning||selected.inning)&&<span style={{fontSize:11,color:lg.color}}>{boxScore?.inning||selected.inning}</span>}
                {boxScore?.count&&<span style={{fontSize:10,color:"#334155"}}>{boxScore.count}</span>}
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #1a1a2e",background:"#080810",position:"sticky",top:57,zIndex:99}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)}
                  style={{flex:1,padding:"10px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?lg.color:"transparent"}`,color:tab===t?lg.color:"#475569",fontSize:11,fontWeight:tab===t?600:400,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                  {t}
                </button>
              ))}
            </div>

            {/* Pro gate */}
            {!isPro&&(
              <div style={{margin:14,background:"#0d0d1a",border:"1px solid #1a1a2e",borderRadius:12,padding:24,textAlign:"center"}}>
                <div style={{fontSize:24,marginBottom:10}}>🔒</div>
                <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:6}}>All-Access Required</div>
                <div style={{fontSize:12,color:"#475569",marginBottom:16,lineHeight:1.6}}>Get box scores, linescore, pitchers, weather and more.</div>
                <button onClick={()=>navigate("/pricing")} style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  Upgrade — $6.99/mo →
                </button>
              </div>
            )}

            {isPro&&(
              <div style={{padding:14}}>

                {/* BOX SCORE */}
                {tab==="Box Score"&&(
                  <div>
                    {boxLoading&&(
                      <div style={{textAlign:"center",padding:32}}>
                        <div style={{width:22,height:22,border:"2px solid #1a1a2e",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 10px"}}/>
                        <div style={{fontSize:12,color:"#475569"}}>Loading...</div>
                      </div>
                    )}
                    {!boxLoading&&!boxScore&&(
                      <div style={{textAlign:"center",padding:32,color:"#475569",fontSize:13}}>
                        Box score available once game starts
                      </div>
                    )}
                    {!boxLoading&&boxScore&&(
                      <div>
                        {/* Linescore table */}
                        <div style={{background:"#0a0a12",borderRadius:10,marginBottom:10,overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                            <thead>
                              <tr style={{borderBottom:"1px solid #1a1a2e"}}>
                                <th style={{textAlign:"left",padding:"7px 10px",color:"#334155",fontWeight:500,minWidth:80}}>Team</th>
                                {boxScore.awayLinescore?.map(inn=>(
                                  <th key={inn.inning} style={{padding:"7px 5px",color:"#334155",textAlign:"center",minWidth:18}}>{inn.inning}</th>
                                ))}
                                <th style={{padding:"7px 8px",color:"#94a3b8",fontWeight:600,textAlign:"center"}}>R</th>
                                <th style={{padding:"7px 8px",color:"#475569",textAlign:"center"}}>H</th>
                                <th style={{padding:"7px 8px",color:"#475569",textAlign:"center"}}>E</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                {name:selected.away,ls:boxScore.awayLinescore,r:boxScore.awayScore,h:boxScore.awayHits,e:boxScore.awayErrors,color:"#94a3b8"},
                                {name:selected.home,ls:boxScore.homeLinescore,r:boxScore.homeScore,h:boxScore.homeHits,e:boxScore.homeErrors,color:lg.color},
                              ].map(({name,ls,r,h,e,color},i)=>(
                                <tr key={i} style={{borderBottom:i===0?"1px solid #1a1a2e":"none"}}>
                                  <td style={{padding:"7px 10px",color,fontWeight:500,fontSize:11,whiteSpace:"nowrap",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}}>{name}</td>
                                  {ls?.map((inn,j)=>(
                                    <td key={j} style={{padding:"7px 5px",textAlign:"center",color:inn.runs>0?"#e2e8f0":"#334155",fontSize:11}}>
                                      {inn.runs==="X"?"·":inn.runs}
                                    </td>
                                  ))}
                                  <td style={{padding:"7px 8px",textAlign:"center",fontWeight:700,color,fontSize:13}}>{r??"-"}</td>
                                  <td style={{padding:"7px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{h??"-"}</td>
                                  <td style={{padding:"7px 8px",textAlign:"center",color:"#64748b",fontSize:11}}>{e??"-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Pitchers */}
                        {(boxScore.awayStarter||boxScore.homeStarter)&&(
                          <div style={{background:"#0a0a12",borderRadius:10,padding:12,marginBottom:10}}>
                            <div style={{fontSize:10,color:"#334155",fontWeight:500,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10}}>Starting Pitchers</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                              {[
                                {label:selected.away,p:boxScore.awayStarter,color:"#94a3b8"},
                                {label:selected.home,p:boxScore.homeStarter,color:lg.color},
                              ].map(({label,p,color})=>p?(
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

                {/* WEATHER */}
                {tab==="Weather"&&(
                  <div>
                    {(boxScore?.weather||selected.weather)?(
                      <div>
                        <div style={{background:"#0a0a12",borderRadius:10,padding:14,marginBottom:10}}>
                          <div style={{fontSize:10,color:"#334155",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>
                            Live Conditions · {selected.venue}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                            {[
                              ["Temperature",(boxScore?.weather||selected.weather)?.temp],
                              ["Condition",(boxScore?.weather||selected.weather)?.condition],
                              ["Humidity",(boxScore?.weather||selected.weather)?.humidity],
                              ["Wind",(boxScore?.weather||selected.weather)?.wind],
                              ["Cloud Cover",(boxScore?.weather||selected.weather)?.cloudCover],
                            ].filter(([,v])=>v).map(([label,val])=>(
                              <div key={label}>
                                <div style={{fontSize:10,color:"#334155",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
                                <div style={{fontSize:13,fontWeight:500,color:"#e2e8f0"}}>{val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{background:"#0a0a12",borderRadius:10,padding:14,borderLeft:`3px solid ${lg.color}`}}>
                          <div style={{fontSize:10,color:lg.color,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Game Impact</div>
                          <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.7}}>
                            {(()=>{
                              const w = boxScore?.weather||selected.weather;
                              const wind = parseInt(w?.wind)||0;
                              const temp = parseInt(w?.temp)||70;
                              if(wind>15) return `Strong ${wind} mph wind may affect fly balls and reduce home run distances. Slight pitching advantage.`;
                              if(temp<55) return `Cold ${temp}°F — ball doesn't carry as well. Pitchers tend to benefit in cold conditions.`;
                              if(temp>85) return `Hot ${temp}°F — ball carries further in warm air. Good conditions for hitters.`;
                              return `${temp}°F with ${wind} mph winds. Comfortable neutral conditions for both teams.`;
                            })()}
                          </div>
                        </div>
                      </div>
                    ):(
                      <div style={{textAlign:"center",padding:32,color:"#475569",fontSize:12}}>
                        Weather available for live and completed games
                      </div>
                    )}
                  </div>
                )}

                {/* H2H */}
                {tab==="H2H"&&(
                  <div style={{textAlign:"center",padding:32}}>
                    <div style={{fontSize:24,marginBottom:10}}>⚔️</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>{selected.away} vs {selected.home}</div>
                    <div style={{fontSize:12,color:"#475569"}}>H2H history coming in next update</div>
                  </div>
                )}

                {/* Players */}
                {tab==="Players"&&(
                  <div style={{textAlign:"center",padding:32}}>
                    <div style={{fontSize:24,marginBottom:10}}>🎯</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>Player Matchups</div>
                    <div style={{fontSize:12,color:"#475569"}}>Player vs opponent stats coming in next update</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* GAMES LIST */}
        {!selected&&(
          <div style={{padding:14}}>
            {!isPro&&(
              <div onClick={()=>navigate("/pricing")}
                style={{background:"#0a0a12",border:"1px solid #1a1a2e",borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:"#ef4444"}}>⚡ Unlock Full Stats + Daily Picks</div>
                  <div style={{fontSize:11,color:"#334155",marginTop:2}}>Box scores, linescore, pitchers, weather — $6.99/mo</div>
                </div>
                <span style={{color:"#ef4444",fontSize:16}}>›</span>
              </div>
            )}
            <div style={{fontSize:10,color:"#334155",fontWeight:500,letterSpacing:"0.08em",marginBottom:12,textTransform:"uppercase"}}>
              Today · {lg.label} · {gamesLoading?"…":games.length+" games"}
            </div>
            {gamesLoading&&(
              <div style={{textAlign:"center",padding:40}}>
                <div style={{width:22,height:22,border:"2px solid #1a1a2e",borderTopColor:lg.color,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 10px"}}/>
                <div style={{fontSize:12,color:"#334155"}}>Loading...</div>
              </div>
            )}
            {!gamesLoading&&games.length===0&&(
              <div style={{textAlign:"center",padding:"40px 20px"}}>
                <div style={{fontSize:32,marginBottom:10}}>{lg.icon}</div>
                <div style={{fontSize:14,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>No games today</div>
                <div style={{fontSize:12,color:"#334155"}}>Check back later or try another league</div>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {games.map(g=>(
                <div key={g.id} className="gc" onClick={()=>pick(g)}
                  style={{background:"#0a0a12",border:"1px solid #1a1a2e",borderRadius:12,padding:"12px 14px",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",left:0,top:0,bottom:0,width:2,background:/live/i.test(g.status||"")?"#22c55e":"transparent",borderRadius:"2px 0 0 2px"}}/>
                  <div style={{paddingLeft:/live/i.test(g.status||"")?8:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,color:"#94a3b8"}}>{g.away}</span>
                      <span style={{fontSize:16,fontWeight:700,color:g.awayScore!=null?"#e2e8f0":"#1a1a2e"}}>{g.awayScore!=null?g.awayScore:""}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                      <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{g.home}</span>
                      <span style={{fontSize:16,fontWeight:700,color:g.homeScore!=null?lg.color:"#1a1a2e"}}>{g.homeScore!=null?g.homeScore:""}</span>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:10,padding:"1px 6px",borderRadius:6,background:sc(g.status)+"12",color:sc(g.status),border:`1px solid ${sc(g.status)}25`,display:"inline-flex",alignItems:"center",gap:3}}>
                        {/live/i.test(g.status||"")&&<span style={{width:4,height:4,borderRadius:"50%",background:"#22c55e",animation:"pulse2 1.4s infinite",display:"inline-block"}}/>}
                        {sl(g.status)}
                      </span>
                      <span style={{fontSize:11,color:"#334155"}}>{g.time}</span>
                      {g.inning&&<span style={{fontSize:10,color:lg.color}}>{g.inning}</span>}
                    </div>
                  </div>
                  <div style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#1a1a2e",fontSize:16}}>›</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
