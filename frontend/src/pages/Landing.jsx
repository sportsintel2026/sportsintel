import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "../lib/api";

export default function LandingPage() {
  const [picks, setPicks] = useState([]);

  useEffect(() => {
    const loadPicks = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data } = await supabase
          .from("daily_picks")
          .select("*")
          .eq("date", today)
          .single();
        if (data?.picks) setPicks(JSON.parse(data.picks));
      } catch(e) {}
    };
    loadPicks();
  }, []);

  const FEATURES = [
    { icon:"⚡", title:"Live Scores", desc:"Real-time updates every 5 minutes across all major leagues" },
    { icon:"📊", title:"Box Scores", desc:"Full game stats, linescore, and pitcher matchups" },
    { icon:"⚔️", title:"H2H Records", desc:"All-time head-to-head history between teams" },
    { icon:"🎯", title:"Player Matchups", desc:"Career stats for every player vs today's opponent" },
    { icon:"🌤", title:"Weather Analysis", desc:"Live conditions with game impact breakdown" },
    { icon:"💰", title:"Betting Lines", desc:"Live odds so you always know the market" },
  ];

  const COMPETITORS = [
    { name:"Picks Sites", price:"$20–$100+/mo", desc:"Sell you picks. No guarantees.", highlight:false },
    { name:"ESPN+", price:"$10.99/mo", desc:"Scores only. No deep stats.", highlight:false },
    { name:"SportsIntel", price:"$7/mo", desc:"Everything the pros use. Make your own picks.", highlight:true },
  ];

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .btn-red{background:#ef4444;color:#fff;border:none;border-radius:8px;padding:13px 28px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s;text-decoration:none;display:inline-block}
        .btn-red:hover{background:#dc2626;transform:translateY(-1px);box-shadow:0 6px 20px #ef444435}
        .btn-outline{background:transparent;color:#94a3b8;border:1px solid #1e2235;border-radius:8px;padding:11px 22px;font-size:13px;cursor:pointer;font-family:inherit;transition:all .2s;text-decoration:none;display:inline-block}
        .btn-outline:hover{border-color:#334155;color:#e2e8f0}
        .card{background:#0a0a14;border:1px solid #1a1a2e;border-radius:12px;transition:all .2s}
        .card:hover{border-color:#252535;transform:translateY(-2px)}
        a{text-decoration:none}
      `}</style>

      {/* NAV */}
      <nav style={{padding:"0 20px",background:"#080810",borderBottom:"1px solid #0f0f1a",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 6px #22c55e",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:16,fontWeight:800,color:"#fff",letterSpacing:"0.01em"}}>SportsIntel</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Link to="/pricing" style={{fontSize:13,color:"#64748b",padding:"6px 12px"}}>Pricing</Link>
            <Link to="/login" className="btn-outline" style={{padding:"7px 16px",fontSize:13}}>Sign In</Link>
            <Link to="/signup" className="btn-red" style={{padding:"7px 16px",fontSize:13}}>Get Started</Link>
          </div>
        </div>
      </nav>

      <div style={{maxWidth:960,margin:"0 auto",padding:"0 20px"}}>

        {/* HERO */}
        <div style={{padding:"64px 0 56px",animation:"fadeIn .6s ease"}}>
          <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
            {["⚾ MLB","🏀 NBA","🏈 NFL","🏒 NHL","⚽ Soccer","🥊 MMA","⛳ Golf"].map(l=>(
              <span key={l} style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:"#0f0f1a",border:"1px solid #1a1a2e",color:"#64748b"}}>{l}</span>
            ))}
          </div>
          <h1 style={{fontSize:"clamp(32px,6vw,58px)",fontWeight:900,color:"#fff",lineHeight:1.1,marginBottom:18,letterSpacing:"-0.02em"}}>
            The Smarter Way<br/>
            <span style={{color:"#ef4444"}}>to Bet on Sports.</span>
          </h1>
          <p style={{fontSize:16,color:"#64748b",maxWidth:500,marginBottom:14,lineHeight:1.8}}>
            Other sites charge <strong style={{color:"#e2e8f0"}}>$20–$100+/month</strong> selling picks with no guarantees. There's no such thing as a guaranteed pick in sports — but there <em style={{color:"#94a3b8"}}>is</em> such a thing as being better informed than everyone else.
          </p>
          <p style={{fontSize:15,color:"#64748b",maxWidth:480,marginBottom:32,lineHeight:1.8}}>
            For <strong style={{color:"#ef4444"}}>$7/month</strong>, SportsIntel gives you the exact same data the pros use. Make smarter picks yourself.
          </p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <Link to="/signup" className="btn-red" style={{fontSize:15,padding:"14px 32px"}}>Get All-Access — $7/mo</Link>
            <Link to="/signup" className="btn-outline">Try Free First →</Link>
          </div>
          <div style={{fontSize:11,color:"#1e2235",marginTop:14}}>No credit card required · Cancel anytime</div>
        </div>

        {/* DIVIDER */}
        <div style={{borderTop:"1px solid #0f0f1a",marginBottom:56}}/>

        {/* PICKS SECTION */}
        <div style={{marginBottom:64}}>
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:24,flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:11,color:"#ef4444",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>🎯 Free Daily Picks</div>
              <h2 style={{fontSize:"clamp(20px,4vw,30px)",fontWeight:800,color:"#fff"}}>Today's Top Picks</h2>
            </div>
            <Link to="/signup" style={{fontSize:12,color:"#475569",border:"1px solid #1a1a2e",borderRadius:8,padding:"6px 14px"}}>Subscribe for full analysis →</Link>
          </div>

          {picks.length === 0 ? (
            <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:12,padding:32,textAlign:"center"}}>
              <div style={{fontSize:24,marginBottom:10}}>🎯</div>
              <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:6}}>Today's picks coming soon</div>
              <div style={{fontSize:12,color:"#475569"}}>Check back later — picks are updated daily</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {picks.map((p, i) => (
                <div key={i} style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:12,padding:18,position:"relative",overflow:"hidden"}}>
                  {i > 0 && (
                    <div style={{position:"absolute",inset:0,backdropFilter:"blur(8px)",background:"#08081085",zIndex:2,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:18,marginBottom:6}}>🔒</div>
                        <Link to="/signup" style={{fontSize:12,color:"#ef4444",fontWeight:700}}>Subscribe to unlock →</Link>
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,color:"#475569",marginBottom:5,fontWeight:500}}>
                        {p.league==="MLB"?"⚾":p.league==="NBA"?"🏀":p.league==="NFL"?"🏈":p.league==="NHL"?"🏒":p.league==="Soccer"?"⚽":p.league==="MMA"?"🥊":"⛳"} {p.league} · {p.game}
                      </div>
                      <div style={{fontSize:17,fontWeight:700,color:"#fff",marginBottom:5}}>
                        {p.pick} <span style={{fontSize:13,color:"#64748b",fontWeight:400}}>{p.odds}</span>
                      </div>
                      <div style={{fontSize:12,color:"#64748b",lineHeight:1.7}}>{p.analysis}</div>
                    </div>
                    <div style={{flexShrink:0}}>
                      <span style={{background:p.confidence==="HIGH"?"#22c55e15":p.confidence==="MEDIUM"?"#f59e0b15":"#ef444415",border:`1px solid ${p.confidence==="HIGH"?"#22c55e30":p.confidence==="MEDIUM"?"#f59e0b30":"#ef444430"}`,borderRadius:6,padding:"3px 10px",fontSize:10,fontWeight:700,color:p.confidence==="HIGH"?"#22c55e":p.confidence==="MEDIUM"?"#f59e0b":"#ef4444"}}>
                        {p.confidence}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{textAlign:"center",marginTop:20}}>
            <Link to="/signup" className="btn-red">Unlock All Picks — $7/mo</Link>
          </div>
        </div>

        {/* DIVIDER */}
        <div style={{borderTop:"1px solid #0f0f1a",marginBottom:56}}/>

        {/* FEATURES */}
        <div style={{marginBottom:64}}>
          <div style={{marginBottom:28}}>
            <div style={{fontSize:11,color:"#ef4444",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>What You Get</div>
            <h2 style={{fontSize:"clamp(20px,4vw,30px)",fontWeight:800,color:"#fff"}}>Everything the Pros Use</h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
            {FEATURES.map((f,i)=>(
              <div key={i} className="card" style={{padding:18}}>
                <div style={{fontSize:24,marginBottom:10}}>{f.icon}</div>
                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:5}}>{f.title}</div>
                <div style={{fontSize:12,color:"#475569",lineHeight:1.7}}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* DIVIDER */}
        <div style={{borderTop:"1px solid #0f0f1a",marginBottom:56}}/>

        {/* COMPARISON */}
        <div style={{marginBottom:64}}>
          <div style={{marginBottom:28}}>
            <div style={{fontSize:11,color:"#ef4444",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>Compare</div>
            <h2 style={{fontSize:"clamp(20px,4vw,30px)",fontWeight:800,color:"#fff"}}>Why SportsIntel Wins</h2>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {COMPETITORS.map((c,i)=>(
              <div key={i} style={{background:c.highlight?"#ef44440a":"#0a0a14",border:`1px solid ${c.highlight?"#ef444430":"#1a1a2e"}`,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:c.highlight?"#fff":"#64748b",marginBottom:3}}>{c.name}</div>
                  <div style={{fontSize:12,color:c.highlight?"#94a3b8":"#334155"}}>{c.desc}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:800,color:c.highlight?"#ef4444":"#334155"}}>{c.price}</div>
                  {c.highlight&&<div style={{fontSize:10,color:"#22c55e",fontWeight:700,marginTop:2}}>BEST VALUE ✓</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:16,padding:"48px 32px",textAlign:"center",marginBottom:64}}>
          <h2 style={{fontSize:"clamp(22px,4vw,36px)",fontWeight:800,color:"#fff",marginBottom:12}}>
            Ready to Bet Smarter?
          </h2>
          <p style={{fontSize:14,color:"#64748b",maxWidth:400,margin:"0 auto 28px",lineHeight:1.8}}>
            Join thousands of sports bettors who use SportsIntel every day to make more informed picks.
          </p>
          <Link to="/signup" className="btn-red" style={{fontSize:15,padding:"14px 36px"}}>
            Get All-Access — $7/mo →
          </Link>
          <div style={{fontSize:11,color:"#334155",marginTop:12}}>Cancel anytime · No contracts · Instant access</div>
        </div>

      </div>

      {/* FOOTER */}
      <div style={{borderTop:"1px solid #0f0f1a",padding:"20px 24px",textAlign:"center"}}>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <span style={{fontSize:13,fontWeight:700,color:"#1e2235"}}>SportsIntel</span>
          <div style={{display:"flex",gap:16}}>
            <Link to="/pricing" style={{fontSize:12,color:"#334155"}}>Pricing</Link>
            <Link to="/login" style={{fontSize:12,color:"#334155"}}>Sign In</Link>
            <Link to="/signup" style={{fontSize:12,color:"#334155"}}>Sign Up</Link>
          </div>
          <span style={{fontSize:11,color:"#1e2235"}}>© 2026 SportsIntel</span>
        </div>
      </div>
    </div>
  );
}
