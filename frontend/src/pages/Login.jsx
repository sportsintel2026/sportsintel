import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase, subscriptionApi } from "../lib/api";

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

const SIGNUP_PLANS = [
  { key: "free",    name: "Free",    price: "$0",   per: "",    sub: "Start free — see today\u2019s edges" },
  { key: "weekly",  name: "Weekly",  price: "$7",   per: "/wk", sub: "Billed weekly" },
  { key: "monthly", name: "Monthly", price: "$25",  per: "/mo", sub: "Billed monthly", pop: true },
  { key: "yearly",  name: "Yearly",  price: "$199", per: "/yr", sub: "$16.58/mo \u00b7 save 34%", best: true },
];

export function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState(() => {
    try { return sessionStorage.getItem("wzp_resume_plan") || "free"; } catch (_) { return "free"; }
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [age21, setAge21] = useState(false); // AGE-CHECKBOX-2026-06-24
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!name || !email || !password) return setError("Please fill in all fields");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (!age21) return setError("Please confirm you are 21 or older to continue");
    setLoading(true); setError("");
    try {
      await signUp(email, password, name);
      try { sessionStorage.removeItem("wzp_resume_plan"); } catch (_) {}
      // Paid plan picked -> straight to Stripe checkout. Free -> dashboard.
      if (plan && plan !== "free") {
        try {
          const { url } = await subscriptionApi.checkout(plan);
          window.location.href = url;
          return;
        } catch (_) {
          // If checkout fails, don\u2019t block the new account — land them on the dashboard.
          navigate("/home");
          return;
        }
      }
      navigate("/home");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const selPlan = SIGNUP_PLANS.find((p) => p.key === plan) || SIGNUP_PLANS[0];
  const ctaLabel = loading
    ? "Creating account…"
    : plan === "free"
      ? "Create free account"
      : `Create account \u00b7 ${selPlan.price}${selPlan.per}`;

  return (
    <AuthLayout title="Create your account" subtitle="Pick a plan and start in one step">
      <Input label="Full Name" value={name} onChange={setName} placeholder="John Smith" />
      <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 8 characters" />

      <div className="planlbl">CHOOSE YOUR PLAN</div>
      <div className="plans">
        {SIGNUP_PLANS.map((p) => (
          <button
            type="button"
            key={p.key}
            className={"plan" + (plan === p.key ? " on" : "")}
            onClick={() => setPlan(p.key)}
          >
            <span className="pradio" />
            <span className="pinfo">
              <span className="pname">{p.name}
                {p.pop && <span className="ptag pop">POPULAR</span>}
                {p.best && <span className="ptag best">BEST VALUE</span>}
              </span>
              <span className="psub">{p.sub}</span>
            </span>
            <span className="pprice">{p.price}<span className="pper">{p.per}</span></span>
          </button>
        ))}
      </div>

      <div onClick={() => setAge21((v) => !v)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", margin: "6px 0 14px", userSelect: "none" }}>
        <span style={{ flex: "0 0 20px", width: 20, height: 20, marginTop: 1, borderRadius: 6, border: "1px solid " + (age21 ? "#C9A86A" : "#3a414a"), background: age21 ? "#C9A86A" : "transparent", color: "#1a1408", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{age21 ? "✓" : ""}</span>
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "#9aa3ad" }}>I confirm I am <b style={{ color: "#cfd7e1" }}>21 or older</b>, agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#C9A86A", textDecoration: "underline", textUnderlineOffset: 2 }}>Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#C9A86A", textDecoration: "underline", textUnderlineOffset: 2 }}>Privacy Policy</a>, and understand WizePicks provides <b style={{ color: "#cfd7e1" }}>informational analytics only</b> — not betting advice or guaranteed outcomes.</span>
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn" onClick={handleSubmit} disabled={loading || !age21} style={!age21 ? { opacity: 0.55 } : undefined}>{ctaLabel}</button>
      {plan !== "free" && <div className="ptrust">Cancel anytime \u00b7 Secure checkout by Stripe \u00b7 No hidden fees</div>}
      <div className="foot t1">Already have an account? <Link to="/login" className="lk">Sign in</Link></div>
    </AuthLayout>
  );
}

export default LoginPage;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
.wzau{--bg:#0A0B0D;--card:#14171B;--inset:#1B2025;--ink:#E8ECEF;--mut:#9AA4AD;--dim:#5C6770;
  --teal:#3FCB91;--mint:#46E0A9;--gold:#C9A86A;--green:#3FCB91;--red:#C9A86A;--line:#21262C;--line2:#2A3138;
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--body);
  display:flex;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.wzau *{box-sizing:border-box;margin:0;padding:0}
.wzau .card-wrap{width:100%;max-width:400px;animation:wzau-in .45s ease both}
@keyframes wzau-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wzau .head{text-align:center;margin-bottom:30px}
.wzau .logo{font-family:var(--disp);font-weight:700;font-size:20px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink)}
.wzau .logo .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 10px rgba(63,203,145,.6)}
.wzau .logo b{color:var(--gold)}
.wzau h1{font-family:var(--disp);font-weight:700;font-size:26px;letter-spacing:-.02em;margin-top:24px;margin-bottom:7px}
.wzau .sub{font-size:14px;color:var(--mut)}
.wzau .card{background:var(--card);border:1px solid var(--line2);border-radius:18px;padding:30px 26px}
.wzau .field{margin-bottom:16px}
.wzau .field label{display:block;font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--dim);margin-bottom:7px;letter-spacing:.14em;text-transform:uppercase}
.wzau .field input{width:100%;background:var(--inset);border:1.5px solid var(--line2);border-radius:10px;padding:13px 14px;color:var(--ink);font-size:14.5px;font-family:var(--body);outline:none;transition:border-color .15s}
.wzau .field input::placeholder{color:#5C6770}
.wzau .field input:focus{border-color:var(--gold)}
.wzau .btn{width:100%;background:var(--gold);color:#1a1408;border:none;border-radius:11px;padding:14px;font-family:var(--disp);font-weight:700;font-size:15.5px;letter-spacing:-.01em;cursor:pointer;transition:background .15s,transform .1s}
.wzau .btn:hover{background:#d8b87a}
.wzau .btn:active{transform:translateY(1px)}
.wzau .btn:disabled{opacity:.55;cursor:not-allowed}
.wzau .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);border-radius:9px;padding:10px 14px;font-size:13px;color:#f8a3a3;margin-bottom:16px}
.wzau .ghost{display:block;width:100%;text-align:center;background:none;border:none;color:var(--mut);cursor:pointer;font-family:var(--body);font-size:13px;margin-top:14px}
.wzau .ghost:hover{color:var(--ink)}
.wzau .ghost:disabled{opacity:.55;cursor:not-allowed}
.wzau .foot{text-align:center;font-size:13px;color:var(--mut);margin-top:18px}
.wzau .lk{color:var(--gold);font-weight:600;text-decoration:none}
.wzau .lk:hover{color:var(--up,#46E0A9)}
.wzau .seeplans{text-align:center;margin-top:12px}
.wzau .seeplans a{font-family:var(--mono);font-size:11.5px;color:var(--mut);text-decoration:none;letter-spacing:.03em}
.wzau .seeplans a:hover{color:var(--ink)}
.wzau .sent{text-align:center;padding:14px 0}
.wzau .sent .ic{font-size:42px;margin-bottom:14px}
.wzau .sent p{font-size:14px;color:var(--mut);line-height:1.7}
.wzau .sent b{color:var(--ink)}
.wzau .planlbl{font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--dim);margin:22px 0 10px;letter-spacing:.14em;text-transform:uppercase}
.wzau .plans{display:flex;flex-direction:column;gap:9px;margin-bottom:18px}
.wzau .plan{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;background:var(--inset);border:1.5px solid var(--line2);border-radius:12px;padding:13px 14px;transition:border-color .15s,background .15s}
.wzau .plan:hover{border-color:#3a434c}
.wzau .plan.on{border-color:var(--gold);background:rgba(201,168,106,.07)}
.wzau .pradio{width:18px;height:18px;border-radius:50%;border:2px solid var(--dim);flex:0 0 auto;position:relative;transition:border-color .15s}
.wzau .plan.on .pradio{border-color:var(--gold)}
.wzau .plan.on .pradio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--gold)}
.wzau .pinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.wzau .pname{font-family:var(--disp);font-weight:700;font-size:15px;color:var(--ink);display:flex;align-items:center;gap:8px;letter-spacing:.01em}
.wzau .psub{font-family:var(--mono);font-size:11px;color:var(--mut)}
.wzau .ptag{font-family:var(--mono);font-weight:700;font-size:8px;letter-spacing:.08em;padding:2px 6px;border-radius:5px}
.wzau .ptag.pop{color:var(--gold);background:rgba(201,168,106,.12);border:1px solid rgba(201,168,106,.32)}
.wzau .ptag.best{color:#04140d;background:var(--green)}
.wzau .pprice{font-family:var(--disp);font-weight:800;font-size:20px;color:var(--ink);flex:0 0 auto;white-space:nowrap}
.wzau .pper{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--mut);margin-left:1px}
.wzau .ptrust{text-align:center;font-family:var(--mono);font-size:10.5px;color:var(--dim);margin-top:12px;letter-spacing:.02em}
@media (prefers-reduced-motion:reduce){.wzau *{animation:none!important;transition:none!important}}
`;
