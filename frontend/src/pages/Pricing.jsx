import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

const PLANS = [
  { key: "weekly",  name: "Weekly",  price: "$7",   per: "/wk", sub: "Billed weekly" },
  { key: "monthly", name: "Monthly", price: "$25",  per: "/mo", sub: "Billed monthly", pop: true },
  { key: "yearly",  name: "Yearly",  price: "$199", per: "/yr", sub: "$16.58/mo · save 34%", best: true },
];

const INCLUDED = [
  "Full edge board",
  "Player props & profiles",
  "Live scores & box scores",
  "Market prices & line moves",
  "Performance, tracked honestly",
  "Zero ads",
];

const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const sel = PLANS.find((p) => p.key === selected) || PLANS[1];

  const subscribe = async () => {
    if (!user) return navigate("/signup");
    setLoading(true);
    try {
      const { url } = await subscriptionApi.checkout(selected);
      window.location.href = url;
    } catch (e) {
      setLoading(false);
      alert("Couldn't start checkout. Please try again.");
    }
  };

  return (
    <div className="wzpr">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="top">
          <Link to="/" className="logo"><span className="dot" />Wize<b>Picks</b></Link>
          <Link to="/" className="close">← back</Link>
        </header>

        <div className="eyebrow">Membership</div>
        <h1>One membership.<br /><em>Pick how you pay.</em></h1>
        <p className="lede">
          Every plan unlocks the full board — edges, player props, live scores and
          market prices. The only thing that changes is how often you're billed.
        </p>

        <div className="plans" role="radiogroup" aria-label="Billing plan">
          {PLANS.map((p) => {
            const on = selected === p.key;
            return (
              <div
                key={p.key}
                className={"plan" + (on ? " on" : "")}
                role="radio"
                aria-checked={on}
                tabIndex={0}
                onClick={() => setSelected(p.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(p.key); } }}
              >
                <span className="radio"><i /></span>
                <div className="pinfo">
                  <div className="pname">
                    {p.name}
                    {p.pop && <span className="tag pop">Popular</span>}
                    {p.best && <span className="tag best">Best value</span>}
                  </div>
                  <div className="psub">{p.sub}</div>
                </div>
                <div className="price"><span className="amt">{p.price}</span><span className="per">{p.per}</span></div>
              </div>
            );
          })}
        </div>

        <div className="incl">
          <div className="lbl">Included on every plan</div>
          <ul>
            {INCLUDED.map((t, i) => (<li key={i}><Check />{t}</li>))}
          </ul>
        </div>

        <button className="cta" onClick={subscribe} disabled={loading}>
          {loading ? "Starting checkout…" : `Get all-access — ${sel.price}${sel.per}`}
        </button>
        <div className="trust">Cancel anytime · Secure checkout by Stripe · No hidden fees</div>

        <div className="free">Just want free scores? <Link to="/signup">Create a free account →</Link></div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
.wzpr{--bg:#07140F;--panel:#0C1D16;--ink:#E7F1EC;--mut:#7E9A8E;--dim:#48584F;
  --teal:#1D9E75;--mint:#38E1A0;--red:#ef4444;--line:rgba(56,225,160,.14);
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  background:var(--bg);color:var(--ink);font-family:var(--body);min-height:100vh;
  -webkit-font-smoothing:antialiased;padding:32px 20px 56px}
.wzpr *{box-sizing:border-box;margin:0;padding:0}
.wzpr .wrap{max-width:500px;margin:0 auto;animation:wzfade .5s ease both}
@keyframes wzfade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wzpr a{text-decoration:none}
.wzpr .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:44px}
.wzpr .logo{font-family:var(--disp);font-weight:700;font-size:18px;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;color:var(--ink)}
.wzpr .logo .dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px rgba(56,225,160,.6)}
.wzpr .logo b{color:var(--teal);font-weight:700}
.wzpr .close{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.03em}
.wzpr .close:hover{color:var(--ink)}
.wzpr .eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--mint);display:flex;align-items:center;gap:11px;margin-bottom:18px}
.wzpr .eyebrow::before{content:"";width:24px;height:1px;background:var(--mint);opacity:.6}
.wzpr h1{font-family:var(--disp);font-weight:700;font-size:clamp(30px,8.5vw,42px);line-height:1.04;letter-spacing:-.022em;margin-bottom:16px}
.wzpr h1 em{font-style:normal;color:var(--teal)}
.wzpr .lede{font-size:14.5px;line-height:1.62;color:var(--mut);max-width:31em;margin-bottom:34px}
.wzpr .plans{display:flex;flex-direction:column;gap:10px;margin-bottom:26px}
.wzpr .plan{position:relative;display:flex;align-items:center;gap:14px;background:var(--panel);border:1.5px solid var(--line);border-radius:15px;padding:16px 18px;cursor:pointer;transition:border-color .15s,background .15s}
.wzpr .plan:hover{border-color:rgba(56,225,160,.32)}
.wzpr .plan:focus-visible{outline:2px solid var(--mint);outline-offset:2px}
.wzpr .plan.on{border-color:var(--teal);background:linear-gradient(180deg,rgba(29,158,117,.13),rgba(29,158,117,.03))}
.wzpr .radio{width:20px;height:20px;border-radius:50%;border:2px solid var(--dim);flex:0 0 auto;display:flex;align-items:center;justify-content:center;transition:border-color .15s}
.wzpr .plan.on .radio{border-color:var(--mint)}
.wzpr .radio i{width:9px;height:9px;border-radius:50%;background:var(--mint);transform:scale(0);transition:transform .15s}
.wzpr .plan.on .radio i{transform:scale(1)}
.wzpr .pinfo{flex:1 1 auto;min-width:0}
.wzpr .pname{font-family:var(--mono);font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink);font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wzpr .psub{font-size:12px;color:var(--mut);margin-top:4px}
.wzpr .tag{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:5px;line-height:1.5}
.wzpr .tag.pop{color:var(--mint);background:rgba(56,225,160,.12);border:1px solid rgba(56,225,160,.3)}
.wzpr .tag.best{color:#06140E;background:var(--mint)}
.wzpr .price{font-family:var(--disp);font-weight:700;flex:0 0 auto;text-align:right;white-space:nowrap;color:var(--ink)}
.wzpr .price .amt{font-size:27px;letter-spacing:-.01em}
.wzpr .price .per{font-family:var(--mono);font-size:12px;color:var(--mut);font-weight:500;margin-left:1px}
.wzpr .plan.on .price .amt{color:var(--mint)}
.wzpr .incl{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:20px 2px;margin-bottom:26px}
.wzpr .incl .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin-bottom:15px}
.wzpr .incl ul{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
.wzpr .incl li{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:#C5D7CD;line-height:1.35}
.wzpr .incl li svg{flex:0 0 auto;margin-top:2px;color:var(--mint)}
.wzpr .cta{width:100%;background:var(--red);color:#fff;border:none;border-radius:13px;padding:17px;font-family:var(--disp);font-weight:700;font-size:16.5px;letter-spacing:-.01em;cursor:pointer;transition:transform .1s,background .15s;box-shadow:0 12px 30px -10px rgba(239,68,68,.55)}
.wzpr .cta:hover{background:#dc2626}
.wzpr .cta:active{transform:translateY(1px)}
.wzpr .cta:disabled{opacity:.6;cursor:wait}
.wzpr .trust{text-align:center;font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:.03em;margin-top:14px}
.wzpr .free{text-align:center;margin-top:30px;font-size:13px;color:var(--mut)}
.wzpr .free a{color:var(--teal);font-weight:600}
.wzpr .free a:hover{color:var(--mint)}
@media (max-width:380px){.wzpr .incl ul{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.wzpr *,.wzpr .wrap{animation:none!important;transition:none!important}}
`;
