import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/api";

function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="wzau">
      <style>{CSS}</style>
      <div className="card-wrap">
        <div className="head">
          <Link to="/" className="logo"><span className="dot" />Wize<b>Picks</b></Link>
          <h1>{title}</h1>
          <p className="sub">{subtitle}</p>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}

function Input({ label, type = "text", value, onChange, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!email || !password) return setError("Please fill in all fields");
    setLoading(true); setError("");
    try {
      await signIn(email, password);
      navigate("/home");
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
        <div className="sent">
          <div className="ic">📬</div>
          <p>We sent a password reset link to <b>{email}</b></p>
          <button className="ghost" onClick={() => setResetSent(false)}>← Back to sign in</button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your account">
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
      {error && <div className="err">{error}</div>}
      <button className="btn" onClick={handleSubmit} disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      <button className="ghost" onClick={handleReset} disabled={loading}>Forgot your password?</button>
      <div className="foot">Don't have an account? <Link to="/signup" className="lk">Sign up free</Link></div>
      <div className="seeplans"><Link to="/pricing">See plans →</Link></div>
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
      navigate("/home");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <AuthLayout title="Create your account" subtitle="Start free, no credit card needed">
      <Input label="Full Name" value={name} onChange={setName} placeholder="John Smith" />
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 8 characters" />
      {error && <div className="err">{error}</div>}
      <button className="btn" onClick={handleSubmit} disabled={loading}>
        {loading ? "Creating account…" : "Create free account"}
      </button>
      <div className="foot t1">Already have an account? <Link to="/login" className="lk">Sign in</Link></div>
      <div className="seeplans"><Link to="/pricing">See plans →</Link></div>
    </AuthLayout>
  );
}

export default LoginPage;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
.wzau{--bg:#07140F;--card:#0C1D16;--inset:#081711;--ink:#E7F1EC;--mut:#7E9A8E;--dim:#48584F;
  --teal:#1D9E75;--mint:#38E1A0;--red:#ef4444;--line:rgba(56,225,160,.14);
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--body);
  display:flex;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.wzau *{box-sizing:border-box;margin:0;padding:0}
.wzau .card-wrap{width:100%;max-width:400px;animation:wzau-in .45s ease both}
@keyframes wzau-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wzau .head{text-align:center;margin-bottom:30px}
.wzau .logo{font-family:var(--disp);font-weight:700;font-size:20px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink)}
.wzau .logo .dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px rgba(56,225,160,.6)}
.wzau .logo b{color:var(--teal)}
.wzau h1{font-family:var(--disp);font-weight:700;font-size:26px;letter-spacing:-.02em;margin-top:24px;margin-bottom:7px}
.wzau .sub{font-size:14px;color:var(--mut)}
.wzau .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:30px 26px}
.wzau .field{margin-bottom:16px}
.wzau .field label{display:block;font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--dim);margin-bottom:7px;letter-spacing:.14em;text-transform:uppercase}
.wzau .field input{width:100%;background:var(--inset);border:1.5px solid var(--line);border-radius:10px;padding:13px 14px;color:var(--ink);font-size:14.5px;font-family:var(--body);outline:none;transition:border-color .15s}
.wzau .field input::placeholder{color:#3C4A43}
.wzau .field input:focus{border-color:var(--teal)}
.wzau .btn{width:100%;background:var(--red);color:#fff;border:none;border-radius:11px;padding:14px;font-family:var(--disp);font-weight:700;font-size:15.5px;letter-spacing:-.01em;cursor:pointer;transition:background .15s,transform .1s}
.wzau .btn:hover{background:#dc2626}
.wzau .btn:active{transform:translateY(1px)}
.wzau .btn:disabled{opacity:.55;cursor:not-allowed}
.wzau .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);border-radius:9px;padding:10px 14px;font-size:13px;color:#f8a3a3;margin-bottom:16px}
.wzau .ghost{display:block;width:100%;text-align:center;background:none;border:none;color:var(--mut);cursor:pointer;font-family:var(--body);font-size:13px;margin-top:14px}
.wzau .ghost:hover{color:var(--ink)}
.wzau .ghost:disabled{opacity:.55;cursor:not-allowed}
.wzau .foot{text-align:center;font-size:13px;color:var(--mut);margin-top:18px}
.wzau .lk{color:var(--teal);font-weight:600;text-decoration:none}
.wzau .lk:hover{color:var(--mint)}
.wzau .seeplans{text-align:center;margin-top:12px}
.wzau .seeplans a{font-family:var(--mono);font-size:11.5px;color:var(--mut);text-decoration:none;letter-spacing:.03em}
.wzau .seeplans a:hover{color:var(--ink)}
.wzau .sent{text-align:center;padding:14px 0}
.wzau .sent .ic{font-size:42px;margin-bottom:14px}
.wzau .sent p{font-size:14px;color:var(--mut);line-height:1.7}
.wzau .sent b{color:var(--ink)}
@media (prefers-reduced-motion:reduce){.wzau *{animation:none!important;transition:none!important}}
`;
