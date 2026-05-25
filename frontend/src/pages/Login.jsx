import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/api";

function AuthLayout({ title, subtitle, children }) {
  return (
    <div style={{minHeight:"100vh",background:"#080810",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Barlow+Condensed:wght@800&display=swap');*{box-sizing:border-box}`}</style>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <Link to="/" style={{textDecoration:"none"}}>
            <span style={{fontFamily:"'Barlow Condensed'",fontSize:26,fontWeight:800,color:"#fff",letterSpacing:"0.1em"}}>SPORTSINTEL</span>
          </Link>
          <div style={{fontSize:22,fontWeight:800,color:"#fff",marginTop:24,marginBottom:8}}>{title}</div>
          <div style={{fontSize:14,color:"#64748b"}}>{subtitle}</div>
        </div>
        <div style={{background:"#0d0d1a",border:"1px solid #1e2235",borderRadius:16,padding:32}}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Input({ label, type="text", value, onChange, placeholder }) {
  return (
    <div style={{marginBottom:16}}>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:"#64748b",marginBottom:6,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",background:"#080810",border:"1px solid #1e2235",borderRadius:8,padding:"12px 14px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!email || !password) return setError("Please fill in all fields");
    setLoading(true); setError("");
    try {
      await signIn(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleReset = async () => {
    if (!email) return setError("Enter your email above first");
    setLoading(true); setError("");
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setResetSent(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (resetSent) {
    return (
      <AuthLayout title="Check your email" subtitle="Password reset link sent">
        <div style={{textAlign:"center",padding:"20px 0"}}>
          <div style={{fontSize:48,marginBottom:16}}>📬</div>
          <div style={{fontSize:14,color:"#64748b",lineHeight:1.7}}>We sent a password reset link to <strong style={{color:"#e2e8f0"}}>{email}</strong></div>
          <button onClick={()=>setResetSent(false)} style={{marginTop:24,background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:600}}>Back to Sign In</button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your account">
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com"/>
      <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••"/>
      {error && <div style={{background:"#ef444420",border:"1px solid #ef444440",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#ef4444",marginBottom:16}}>{error}</div>}
      <button onClick={handleSubmit} disabled={loading}
        style={{width:"100%",background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"13px",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1,fontFamily:"inherit",marginBottom:12}}>
        {loading?"Signing in...":"Sign In"}
      </button>
      <div style={{textAlign:"center",marginBottom:16}}>
        <button onClick={handleReset} disabled={loading}
          style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
          Forgot your password?
        </button>
      </div>
      <div style={{textAlign:"center",fontSize:13,color:"#475569"}}>
        Don't have an account? <Link to="/signup" style={{color:"#ef4444",fontWeight:600,textDecoration:"none"}}>Sign up free</Link>
      </div>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!name || !email || !password) return setError("Please fill in all fields");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true); setError("");
    try {
      await signUp(email, password, name);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start free, no credit card needed">
      <Input label="Full Name" value={name} onChange={setName} placeholder="John Smith"/>
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com"/>
      <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 8 characters"/>
      {error && <div style={{background:"#ef444420",border:"1px solid #ef444440",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#ef4444",marginBottom:16}}>{error}</div>}
      <button onClick={handleSubmit} disabled={loading}
        style={{width:"100%",background:"#ef4444",color:"#fff",border:"none",borderRadius:8,padding:"13px",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1,fontFamily:"inherit"}}>
        {loading?"Creating account...":"Create Free Account"}
      </button>
      <div style={{textAlign:"center",marginTop:20,fontSize:13,color:"#475569"}}>
        Already have an account? <Link to="/login" style={{color:"#ef4444",fontWeight:600,textDecoration:"none"}}>Sign in</Link>
      </div>
    </AuthLayout>
  );
}

export default LoginPage;
