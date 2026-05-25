import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

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
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@700;800;900&display=swap');*{box-sizing:border-box}`}</style>
      <Link to="/" style={{textDecoration:"none",marginBottom:40}}>
        <span style={{fontFamily:"'Barlow Condensed'",fontSize:24,fontWeight:900,color:"#fff",letterSpacing:"0.1em"}}>SPORTSINTEL</span>
      </Link>
      <div style={{background:"linear-gradient(135deg,#0f0f1f,#0d0d1a)",border:"1px solid #ef444450",borderRadius:24,padding:"48px 40px",maxWidth:480,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#ef4444",letterSpacing:"0.1em",marginBottom:16}}>ONE PLAN · EVERYTHING INCLUDED</div>
        <h1 style={{fontFamily:"'Barlow Condensed'",fontSize:48,fontWeight:900,color:"#fff",marginBottom:8,lineHeight:1}}>ALL-ACCESS</h1>
        <div style={{fontFamily:"'Barlow Condensed'",fontSize:72,fontWeight:900,color:"#ef4444",lineHeight:1,marginBottom:4}}>$6.99</div>
        <div style={{color:"#475569",fontSize:14,marginBottom:32}}>per month · cancel anytime</div>
        <div style={{textAlign:"left",marginBottom:32}}>
          {["⚾🏀🏈 All leagues — MLB, NBA, NFL","⚡ Live scores every 5 minutes","📊 Full box scores","⚔️ Head-to-head records","🎯 Player vs opponent stats","🌤 Weather & game impact","💰 Betting lines & odds","🔔 Push notifications","🚫 Zero ads ever"].map((f,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,fontSize:14,color:"#94a3b8"}}>
              <span style={{color:"#ef4444",fontWeight:700}}>✓</span>{f}
            </div>
          ))}
        </div>
        <button onClick={handleSubscribe} disabled={loading}
          style={{width:"100%",background:"linear-gradient(135deg,#ef4444,#dc2626)",color:"#fff",border:"none",borderRadius:12,padding:"16px",fontSize:18,fontWeight:800,cursor:loading?"wait":"pointer",fontFamily:"inherit",boxShadow:"0 8px 32px #ef444440",marginBottom:16}}>
          {loading?"Redirecting...":"Get All-Access →"}
        </button>
        <div style={{fontSize:12,color:"#334155"}}>No credit card games · Instant access · Cancel anytime</div>
      </div>
      <div style={{marginTop:24,fontSize:13,color:"#475569"}}>
        Just want scores? <Link to="/signup" style={{color:"#ef4444",textDecoration:"none",fontWeight:600}}>Try free →</Link>
      </div>
    </div>
  );
}
