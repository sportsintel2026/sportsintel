// MyPicks page — user's saved picks
// Phase 1: Placeholder until we add "Save pick" buttons in Chunk 3

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function MyPicksPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @media (max-width: 768px) {
          .sidebar-container { display: none !important; }
          .main-content { margin-left: 0 !important; }
        }
      `}</style>

      <div className="sidebar-container">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>My picks</h1>
          <p style={{ margin: "0 0 32px", fontSize: 13, color: "#9ca3af" }}>Picks you've saved · track your results over time</p>

          <div style={{ background: "#0f1419", border: "1px solid #1f2937", borderRadius: 8, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎯</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#e4e7eb" }}>You haven't saved any picks yet</h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af", maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
              From the dashboard or any game page, click the <span style={{ color: "#22c55e", fontWeight: 600 }}>save</span> button next to any edge to track it here. We'll record your picks and show how you do over time.
            </p>
            <button onClick={() => navigate("/dashboard")} style={primaryBtnStyle}>
              ← Back to edges
            </button>
            <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #1a1f28", fontSize: 11, color: "#6b7280" }}>
              📅 Pick tracking coming soon — we're still building the "save" buttons
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const primaryBtnStyle = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
