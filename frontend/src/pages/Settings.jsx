// Settings page — account info, subscription management

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [portalLoading, setPortalLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  async function openStripePortal() {
    setPortalLoading(true);
    try {
      const { url } = await subscriptionApi.getCustomerPortalUrl();
      window.location.href = url;
    } catch (e) {
      console.error("Could not open portal:", e);
      alert("Could not open subscription management. Please contact support.");
      setPortalLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
        }
      `}</style>

      {/* Desktop sidebar */}
      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(path) => { setDrawerOpen(false); navigate(path); }} />
          </div>
        </>
      )}

      {/* Mobile top bar */}
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Sports<span style={{ color: "#ef4444" }}>intel</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>Settings</h1>
          <p style={{ margin: "0 0 32px", fontSize: 13, color: "#9ca3af" }}>Manage your account and subscription</p>

          <Section title="Account">
            <Row label="Email" value={user?.email || "—"} />
            <Row label="Account type" value={isAdmin ? "Admin (owner)" : isPro ? "Subscribed" : "Free"} valueColor={isAdmin ? "#a855f7" : isPro ? "#22c55e" : "#9ca3af"} />
            <Row label="Member since" value={user?.created_at ? new Date(user.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"} />
          </Section>

          <Section title="Subscription">
            {isAdmin ? (
              <div style={infoBoxStyle("#a855f7")}>
                <div style={{ fontSize: 13, color: "#e4e7eb", fontWeight: 600, marginBottom: 4 }}>You're the owner</div>
                <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>You have full access to all features. No subscription needed.</div>
              </div>
            ) : isPro ? (
              <>
                <div style={infoBoxStyle("#22c55e")}>
                  <div style={{ fontSize: 13, color: "#e4e7eb", fontWeight: 600, marginBottom: 4 }}>Subscribed — $7/month</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>You have full access to all edges, HR props, and game analysis.</div>
                </div>
                <button onClick={openStripePortal} disabled={portalLoading} style={{ ...primaryBtnStyle, marginTop: 14 }}>
                  {portalLoading ? "Opening..." : "Manage subscription & billing →"}
                </button>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>Update payment method, view invoices, or cancel.</div>
              </>
            ) : (
              <>
                <div style={infoBoxStyle("#ef4444")}>
                  <div style={{ fontSize: 13, color: "#e4e7eb", fontWeight: 600, marginBottom: 4 }}>You're on the Free plan</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.6 }}>Subscribe to unlock all edges, HR props, model reasoning, and full game analysis.</div>
                </div>
                <button onClick={() => navigate("/pricing")} style={{ ...primaryBtnStyle, marginTop: 14, background: "#ef4444" }}>
                  ⚡ Subscribe — $7/month
                </button>
              </>
            )}
          </Section>

          <Section title="Support">
            <Row label="Help" value={<a href="mailto:support@sportsintel.app" style={linkStyle}>support@sportsintel.app</a>} />
            <Row label="Feedback" value="Use the thumbs-down button anywhere" />
          </Section>

          <Section title="Account actions">
            <button onClick={() => { signOut(); navigate("/"); }} style={dangerBtnStyle}>Sign out</button>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 11, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>{title}</h2>
      <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 16 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, valueColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1a1f28", gap: 16 }}>
      <span style={{ fontSize: 12, color: "#9ca3af" }}>{label}</span>
      <span style={{ fontSize: 13, color: valueColor || "#e4e7eb", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function infoBoxStyle(accentColor) {
  return { background: "#0a0e14", border: `1px solid ${accentColor}30`, borderLeft: `3px solid ${accentColor}`, borderRadius: 6, padding: "12px 14px" };
}

const primaryBtnStyle = { background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const dangerBtnStyle = { background: "transparent", color: "#ef4444", border: "1px solid #ef444440", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const linkStyle = { color: "#ef4444", textDecoration: "none", fontWeight: 600 };
