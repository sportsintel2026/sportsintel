import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

const PICKS = [
  { league:"⚾ MLB", matchup:"Yankees vs Rays", pick:"Yankees -1.5", confidence:"HIGH" },
  { league:"🏀 NBA", matchup:"Knicks vs Cavaliers", pick:"Knicks ML", confidence:"HIGH" },
  { league:"🏈 NFL", matchup:"Chiefs vs Bills", pick:"Over 54.5", confidence:"MEDIUM" },
];

const COMPETITORS = [
  { name:"Picks Sites", price:"$20–$100+/mo", note:"Sell you picks. No guarantees." },
  { name:"ESPN+", price:"$10.99/mo", note:"Scores only. No deep stats." },
  { name:"SportsIntel", price:"$6.99/mo", highlight:true, note:"Everything you need to make your OWN picks." },
];

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async () => {
    if (!user) return navigate("/signup");
    setLoading(true);
    try {
      const { url } = await subscriptionApi.checkout("pro_monthly");
      window.location.href = url;
    } catch (err) {
      alert("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",padding:"40px 24px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@700;800;900&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>

      <div style={{maxWidth:560,margin:"0 auto"}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <Link to="/" style={{textDecoration:"none"}}>
            <span style={{fontFamily:"'Barlow Condensed'",fontSize:26,fontWeight:900,color:"#fff",letterSpacing:"0.1em"}}>SPORTSINTEL</span>
          </Link>
        </div>

        {/* Hero pitch */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"#ef444420",border:"1px solid #ef444440",borderRadius:20,padding:"6px 16px",marginBottom:20,fontSize:12,color:"#ef4444",fontWeight:700,letterSpacing:"0.06em"}}>
            🔥 THE SMARTER WAY TO BET
          </div>
          <h1 style={{fontFamily:"'Barlow Condensed'",fontSize:"clamp(32px,7vw,52px)",fontWeight:900,color:"#fff",lineHeight:1.1,marginBottom:16}}>
            STOP PAYING FOR PICKS.<br/>
            <span style={{color:"#ef4444"}}>START MAKING YOUR OWN.</span>
          </h1>
          <p style={{fontSize:15,color:"#64748b",lineHeight:1.8,maxWidth:480,margin:"0 auto"}}>
            Other sites charge <strong style={{color:"#e2e8f0"}}>$20 to $100+ a month</strong> to sell you picks that aren't guaranteed. There's no such thing as a guaranteed pick in sports — but there <em style={{color:"#e2e8f0"}}>is</em> such a thing as being better informed than everyone else.
          </p>
          <p style={{fontSize:15,color:"#64748b",lineHeight:1.8,maxWidth:480,margin:"16px auto 0"}}>
            For just <strong style={{color:"#ef4444"}}>$6.99/month</strong>, SportsIntel gives you the <strong style={{color:"#e2e8f0"}}>exact same data the pros use</strong> — live scores, H2H records, player matchup stats, weather conditions, and betting lines — so you can make smarter picks yourself.
          </p>
        </div>

        {/* Competitor comparison */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12,textAlign:"center"}}>Why SportsIntel wins</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {COMPETITORS.map((c,i)=>(
              <div key={i} style={{background:c.highlight?"linear-gradient(135deg,#ef444418,#ef444408)":"#0d0d1a",border:`1px solid ${c.highlight?"#ef444450":"#1e2235"}`,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:c.highlight?"#fff":"#64748b"}}>{c.name}</div>
                  <div style={{fontSize:12,color:c.highlight?"#94a3b8":"#334155",marginTop:2}}>{c.note}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontFamily:"'Barlow Condensed'",fontSize:20,fontWeight:900,color:c.highlight?"#ef4444":"#475569"}}>{c.price}</div>
                  {c.highlight&&<div style={{fontSize:10,color:"#22c55e",fontWeight:700}}>BEST VALUE ✓</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main plan card */}
        <div style={{background:"linear-gradient(135deg,#0f0f1f,#0d0d1a)",border:"1px solid #ef444450",borderRadius:24,padding:"36px 28px",textAlign:"center",marginBottom:20,position:"relative"}}>
          <div style={{position:"absolute",top:-14,left:"50%",transform:"translateX(-50%)",background:"#ef4444",color:"#fff",fontSize:11,fontWeight:800,padding:"4px 20px",borderRadius:20,letterSpacing:"0.08em",whiteSpace:"nowrap"}}>
            ONE PLAN · EVERYTHING INCLUDED
          </div>
          <h2 style={{fontFamily:"'Barlow Condensed'",fontSize:36,fontWeight:900,color:"#fff",marginBottom:4,marginTop:8,lineHeight:1}}>ALL-ACCESS MEMBERSHIP</h2>
          <div style={{fontFamily:"'Barlow Condensed'",fontSize:64,fontWeight:900,color:"#ef4444",lineHeight:1,marginBottom:2}}>$6.99</div>
          <div style={{color:"#475569",fontSize:13,marginBottom:24}}>per month · cancel anytime · no contracts</div>

          <div style={{textAlign:"left",marginBottom:28,background:"#080810",borderRadius:12,padding:"16px"}}>
            <div style={{fontSize:11,color:"#475569",fontWeight:700,letterSpacing:"0.08em",marginBottom:12,textTransform:"uppercase"}}>Everything included:</div>
            {[
              ["🎯","Free Daily Picks","Curated picks to help guide your decisions — every day"],
              ["⚾🏀🏈","All Major Leagues","MLB, NBA, NFL — all in one place"],
              ["⚡","Live Scores","Updated every 5 minutes during games"],
              ["📊","Full Box Scores","Complete player and team stats"],
              ["⚔️","H2H Records","All-time and recent head-to-head history"],
              ["🎯","Player Matchup Stats","Career stats vs today's specific opponent"],
              ["🌤","Weather Analysis","Real conditions + game impact breakdown"],
              ["💰","Betting Lines & Odds","Live lines so you always know the market"],
              ["🔔","Push Notifications","Alerts for your favorite teams"],
              ["🚫","Zero Ads","Clean, distraction-free experience"],
            ].map(([icon,title,desc],i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
                <span style={{fontSize:16,flexShrink:0,marginTop:1}}>{icon}</span>
                <div>
                  <span style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{title} </span>
                  <span style={{fontSize:12,color:"#475569"}}>{desc}</span>
                </div>
              </div>
            ))}
          </div>

          <button onClick={handleSubscribe} disabled={loading}
            style={{width:"100%",background:"linear-gradient(135deg,#ef4444,#dc2626)",color:"#fff",border:"none",borderRadius:12,padding:"18px",fontSize:18,fontWeight:800,cursor:loading?"wait":"pointer",fontFamily:"inherit",boxShadow:"0 8px 32px #ef444440",marginBottom:12}}>
            {loading?"Redirecting...":"Get All-Access for $6.99/mo →"}
          </button>
          <div style={{fontSize:12,color:"#334155"}}>Instant access · Cancel anytime · No hidden fees</div>
        </div>

        {/* Picks preview */}
        <div style={{background:"#0d0d1a",border:"1px solid #22c55e40",borderRadius:20,padding:"24px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <span style={{fontSize:22}}>🎯</span>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:"#fff"}}>Today's Picks Preview</div>
              <div style={{fontSize:12,color:"#475569"}}>Members get full picks + analysis daily</div>
            </div>
            <div style={{marginLeft:"auto",background:"#22c55e20",border:"1px solid #22c55e40",borderRadius:8,padding:"3px 10px",fontSize:10,fontWeight:700,color:"#22c55e",whiteSpace:"nowrap"}}>MEMBERS ONLY</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {PICKS.map((p,i)=>(
              <div key={i} style={{background:"#080810",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",filter:"blur(4px)",userSelect:"none"}}>
                <div>
                  <div style={{fontSize:11,color:"#475569",fontWeight:600,marginBottom:2}}>{p.league} · {p.matchup}</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{p.pick}</div>
                </div>
                <div style={{background:p.confidence==="HIGH"?"#22c55e20":"#f59e0b20",border:`1px solid ${p.confidence==="HIGH"?"#22c55e40":"#f59e0b40"}`,borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,color:p.confidence==="HIGH"?"#22c55e":"#f59e0b"}}>
                  {p.confidence}
                </div>
              </div>
            ))}
          </div>
          <div style={{textAlign:"center",marginTop:14,fontSize:13,color:"#64748b"}}>
            🔒 Subscribe to unlock today's full picks & analysis
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{background:"linear-gradient(135deg,#ef444412,#ef444406)",border:"1px solid #ef444430",borderRadius:16,padding:"24px",textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:16,fontWeight:800,color:"#fff",marginBottom:8}}>Ready to bet smarter?</div>
          <div style={{fontSize:13,color:"#64748b",marginBottom:16,lineHeight:1.6}}>Join thousands of sports bettors who use SportsIntel to make more informed picks every single day.</div>
          <button onClick={handleSubscribe} disabled={loading}
            style={{background:"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"13px 40px",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
            Start Today — $6.99/mo →
          </button>
        </div>

        <div style={{textAlign:"center",fontSize:13,color:"#475569"}}>
          Just want free scores? <Link to="/signup" style={{color:"#ef4444",textDecoration:"none",fontWeight:600}}>Create free account →</Link>
        </div>

      </div>
    </div>
  );
}
