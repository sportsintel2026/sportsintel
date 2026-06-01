import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/api";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const navigate = useNavigate();

  // When the user arrives from the reset email, the link carries a one-time
  // token. We must actively exchange that token for a session BEFORE allowing
  // a password change — otherwise updateUser fails with "Auth session missing!".
  // Supabase can deliver the token in several formats, so we handle each:
  //   1. an existing session (already signed in / already exchanged)
  //   2. hash tokens:      #access_token=...&refresh_token=...
  //   3. token_hash link:  ?token_hash=...&type=recovery   (works across devices)
  //   4. PKCE code link:   ?code=...   (only valid in the same browser that asked)
  useEffect(() => {
    let active = true;

    async function establishSession() {
      try {
        // 1. Already have a session?
        const { data: existing } = await supabase.auth.getSession();
        if (existing?.session) { if (active) setReady(true); return; }

        const rawHash = window.location.hash?.startsWith("#")
          ? window.location.hash.slice(1) : "";
        const hashParams = new URLSearchParams(rawHash);
        const queryParams = new URLSearchParams(window.location.search);

        // 2. Hash-based recovery link
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          if (active) setReady(true);
          return;
        }

        // 3. token_hash recovery link (survives opening on a different device)
        const token_hash = queryParams.get("token_hash");
        const type = queryParams.get("type");
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type });
          if (error) throw error;
          if (active) setReady(true);
          return;
        }

        // 4. PKCE code link (only works in the browser that requested the reset)
        const code = queryParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (active) setReady(true);
          return;
        }

        // 5. Nothing usable in the URL.
        if (active) { setReady(false); setLinkError(true); }
      } catch (err) {
        if (active) { setReady(false); setLinkError(true); }
      }
    }

    establishSession();

    // Belt-and-suspenders: Supabase may fire this once it parses the link itself.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        if (active) { setReady(true); setLinkError(false); }
      }
    });

    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const handleReset = async () => {
    if (!ready) return setError("Your reset link hasn't finished verifying. Please wait a moment or request a new link.");
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
            <span style={{fontFamily:"'Barlow Condensed'",fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"0.1em"}}>WIZE<span style={{color:"#ef4444"}}>PICKS</span></span>
          </Link>
          <div style={{fontSize:22,fontWeight:800,color:"#fff",marginTop:24,marginBottom:8}}>Set New Password</div>
          <div style={{fontSize:14,color:"#64748b"}}>Enter your new password below</div>
        </div>
        <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:32}}>
          {linkError ? (
            <div style={{background:"#ef444420",border:"1px solid #ef444440",borderRadius:8,padding:"12px 14px",fontSize:13,color:"#fca5a5",marginBottom:16,lineHeight:1.6}}>
              This reset link is invalid or has expired — or it was opened in a different browser than the one you requested it from. Please <Link to="/login" style={{color:"#ef4444",fontWeight:700,textDecoration:"none"}}>request a new link</Link> and open it in the same browser.
            </div>
          ) : !ready && (
            <div style={{background:"#3b82f620",border:"1px solid #3b82f640",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#93c5fd",marginBottom:16}}>
              Verifying your reset link...
            </div>
          )}
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
          <button onClick={handleReset} disabled={loading || !ready}
            style={{width:"100%",background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"13px",fontSize:15,fontWeight:700,cursor:(loading||!ready)?"not-allowed":"pointer",opacity:(loading||!ready)?0.7:1,fontFamily:"inherit"}}>
            {loading?"Updating...":"Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
