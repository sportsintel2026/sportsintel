import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

const PLANS = [
  {
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    color: "#475569",
    features: [
      { text: "Live scores — all leagues", included: true },
      { text: "Today's schedule", included: true },
      { text: "Basic standings", included: true },
      { text: "H2H records", included: false },
      { text: "Player vs. opponent stats", included: false },
      { text: "Weather analysis", included: false },
      { text: "Box scores", included: false },
      { text: "Betting lines", included: false },
    ],
  },
  {
    name: "Pro",
    priceMonthly: 4.99,
    priceYearly: 3.99,
    color: "#ef4444",
    popular: true,
    priceKey: { monthly: "pro_monthly", yearly: "pro_yearly" },
    features: [
      { text: "Live scores — all leagues", included: true },
      { text: "Today's schedule", included: true },
      { text: "Basic standings", included: true },
      { text: "H2H records", included: true },
      { text: "Player vs. opponent stats", included: true },
      { text: "Weather analysis", included: true },
      { text: "Box scores", included: true },
      { text: "Betting lines", included: false },
    ],
  },
  {
    name: "Elite",
    priceMonthly: 9.99,
    priceYearly: 7.99,
    color: "#f59e0b",
    priceKey: { monthly: "elite_monthly", yearly: "elite_yearly" },
    features: [
      { text: "Live scores — all leagues", included: true },
      { text: "Today's schedule", included: true },
      { text: "Basic standings", included: true },
      { text: "H2H records", included: true },
      { text: "Player vs. opponent stats", included: true },
      { text: "Weather analysis", included: true },
      { text: "Box scores", included: true },
      { text: "Betting lines", included: true },
    ],
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState("monthly");
  const [loadingPlan, setLoadingPlan] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async (plan) => {
    if (!user) return navigate("/signup");
    if (!plan.priceKey) return navigate("/dashboard"); // Free plan

    setLoadingPlan(plan.name);
    try {
      const { url } = await subscriptionApi.checkout(plan.priceKey[billing]);
      window.location.href = url; // Redirect to Stripe Checkout
    } catch (err) {
      alert("Something went wrong. Please try again.");
    }
    setLoadingPlan(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Barlow+Condensed:wght@800;900&display=swap');*{box-sizing:border-box}`}</style>

      {/* Nav */}
      <nav style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto" }}>
        <Link to="/" style={{ textDecoration: "none", fontFamily: "'Barlow Condensed'", fontSize: 22, fontWeight: 900, color: "#fff", letterSpacing: "0.08em" }}>SPORTSINTEL</Link>
        <div style={{ display: "flex", gap: 12 }}>
          {user ? (
            <Link to="/dashboard" style={{ background: "#ef4444", color: "#fff", textDecoration: "none", padding: "8px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700 }}>Dashboard</Link>
          ) : (
            <>
              <Link to="/login" style={{ color: "#94a3b8", textDecoration: "none", fontSize: 14, fontWeight: 500, padding: "8px 16px" }}>Sign In</Link>
              <Link to="/signup" style={{ background: "#ef4444", color: "#fff", textDecoration: "none", padding: "8px 20px", borderRadius: 8, fontSize: 14, fontWeight: 700 }}>Get Started</Link>
            </>
          )}
        </div>
      </nav>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "60px 24px 80px" }}>
        <h1 style={{ textAlign: "center", fontFamily: "'Barlow Condensed'", fontSize: "clamp(36px,6vw,64px)", fontWeight: 900, color: "#fff", marginBottom: 12, letterSpacing: "0.02em" }}>
          CHOOSE YOUR PLAN
        </h1>
        <p style={{ textAlign: "center", color: "#64748b", fontSize: 16, marginBottom: 40 }}>
          Start free. Upgrade for the full edge.
        </p>

        {/* Billing toggle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 48 }}>
          <div style={{ background: "#0d0d1a", border: "1px solid #1e2235", borderRadius: 10, padding: 4, display: "flex", gap: 4 }}>
            {["monthly", "yearly"].map(b => (
              <button key={b} onClick={() => setBilling(b)}
                style={{ padding: "8px 24px", borderRadius: 7, border: "none", background: billing === b ? "#ef4444" : "transparent", color: billing === b ? "#fff" : "#64748b", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {b === "monthly" ? "Monthly" : "Yearly"}{b === "yearly" ? " (Save 20%)" : ""}
              </button>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20, alignItems: "stretch" }}>
          {PLANS.map(plan => {
            const price = billing === "monthly" ? plan.priceMonthly : plan.priceYearly;
            const isLoading = loadingPlan === plan.name;

            return (
              <div key={plan.name} style={{ background: plan.popular ? "#0f0f1f" : "#0d0d1a", border: `1px solid ${plan.popular ? plan.color + "50" : "#1e2235"}`, borderRadius: 20, padding: 32, display: "flex", flexDirection: "column", position: "relative" }}>
                {plan.popular && (
                  <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", background: plan.color, color: "#fff", fontSize: 11, fontWeight: 800, padding: "4px 16px", borderRadius: 20, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                    MOST POPULAR
                  </div>
                )}

                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: plan.color, letterSpacing: "0.1em", marginBottom: 10 }}>{plan.name.toUpperCase()}</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 4 }}>
                    <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 52, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                      {price === 0 ? "Free" : `$${price}`}
                    </span>
                    {price > 0 && <span style={{ color: "#475569", fontSize: 14, marginBottom: 8 }}>/{billing === "monthly" ? "mo" : "mo, billed yearly"}</span>}
                  </div>
                  {billing === "yearly" && price > 0 && (
                    <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>
                      Save ${((plan.priceMonthly - price) * 12).toFixed(0)}/year
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, marginBottom: 28 }}>
                  {plan.features.map(f => (
                    <div key={f.text} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 14, color: f.included ? plan.color : "#1e2235", flexShrink: 0 }}>{f.included ? "✓" : "✗"}</span>
                      <span style={{ fontSize: 13, color: f.included ? "#94a3b8" : "#334155" }}>{f.text}</span>
                    </div>
                  ))}
                </div>

                <button onClick={() => handleSubscribe(plan)} disabled={isLoading}
                  style={{ width: "100%", background: plan.popular ? plan.color : "transparent", color: plan.popular ? "#fff" : "#94a3b8", border: `1px solid ${plan.popular ? plan.color : "#1e2235"}`, borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 700, cursor: isLoading ? "wait" : "pointer", fontFamily: "inherit", opacity: isLoading ? 0.7 : 1 }}>
                  {isLoading ? "Redirecting..." : plan.priceKey ? `Get ${plan.name}` : "Start Free"}
                </button>
              </div>
            );
          })}
        </div>

        {/* FAQ */}
        <div style={{ marginTop: 80 }}>
          <h2 style={{ textAlign: "center", fontFamily: "'Barlow Condensed'", fontSize: 36, fontWeight: 900, color: "#fff", marginBottom: 40 }}>COMMON QUESTIONS</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
            {[
              ["Can I cancel anytime?", "Yes — cancel from your account dashboard at any time. You keep access until the end of your billing period."],
              ["How often is data updated?", "Scores refresh every 5 minutes during live games. Schedules update daily at 8am ET."],
              ["What sports are covered?", "MLB, NBA, and NFL. NHL and international soccer coming later in 2026."],
              ["Is there a free trial?", "The Free plan is free forever — no trial needed. Upgrade when you want more."],
            ].map(([q, a]) => (
              <div key={q} style={{ background: "#0d0d1a", border: "1px solid #1e2235", borderRadius: 14, padding: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>{q}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>{a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
