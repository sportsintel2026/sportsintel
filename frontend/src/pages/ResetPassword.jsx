import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/api";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleReset = async () => {
    if (!password || !confirm) return setError("Please fill in all fields");
    if (password !== confirm) return setError("Passwords don't match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true); setError("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => navigate("/dashboard"), 2000);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div style={{minHeight:"100vh",background:"#080810",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:16}}>✅</div>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:8}}>Password Updated!</div>
          <div style={{fontSize:14,color:"#64748b"}}>Redirecting to dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:"#080810",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Barlow+Condensed:wght@800&display=swap');*{box-sizing:border-box}`}</style>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <Link to="/" style={{textDecoration:"none"}}>
            <span style={{fontFamily:"'Barlow Condensed'",fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"0.1em"}}>SPORTSINTEL</span>
          </Link>
          <div style={{fontSize:22,fontWeight:800,color:"#fff",marginTop:24,marginBottom:8}}>Set New Password</div>
          <div style={{fontSize:14,color:"#64748b"}}>Enter your new password below</div>
        </div>
        <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:32}}>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:12,fontWeight:600,color:"#64748b",marginBottom:6,textTransform:"uppercase"}}>New Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Min. 8 characters"
              style={{width:"100%",background:"#080810",border:"1px solid #1e2235",borderRadius:8,padding:"12px 14px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:12,fontWeight:600,color:"#64748b",marginBottom:6,textTransform:"uppercase"}}>Confirm Password</label>
            <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Re-enter password"
              style={{width:"100%",background:"#080810",border:"1px solid #1e2235",borderRadius:8,padding:"12px 14px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          </div>
          {error && <div style={{background:"#ef444420",border:"1px solid #ef444440",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#ef4444",marginBottom:16}}>{error}</div>}
          <button onClick={handleReset} disabled={loading}
            style={{width:"100%",background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"13px",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1,fontFamily:"inherit"}}>
            {loading?"Updating...":"Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
