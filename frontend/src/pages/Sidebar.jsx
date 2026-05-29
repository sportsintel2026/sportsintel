// Sidebar.jsx — main navigation sidebar for the app
//
// Used on Dashboard, GameDetail, Settings, MyPicks, NBA pages.
import { Link, useLocation } from "react-router-dom";
export default function Sidebar({ user, plan, signOut, navigate }) {
  const location = useLocation();
  const isAdmin = plan.isAdmin === true;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const hasFullAccess = isAdmin || isPro;
  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + "/");
  return (
    <div style={sidebarStyle}>
      {/* Logo — clickable, goes to dashboard and closes drawer */}
      <div
        onClick={() => navigate("/dashboard")}
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, padding: "4px 8px", cursor: "pointer" }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: "#e4e7eb" }}>
          Sports<span style={{ color: "#ef4444" }}>intel</span>
        </span>
      </div>
      {/* General — applies across all sports */}
      <NavLink
        to="/dashboard"
        active={isActive("/dashboard")}
        icon="📊"
        label="Edges"
      />
      <NavLink
        to="/performance"
        active={isActive("/performance")}
        icon="📈"
        label="Performance"
      />
      <NavLink
        to="/my-picks"
        active={isActive("/my-picks")}
        icon="🎯"
        label="Free picks"
      />
      {/* MLB section */}
      <div style={{ ...sectionLabelStyle, marginTop: 18 }}>MLB</div>
      <NavLink
        to="/games"
        active={isActive("/games") || isActive("/game/mlb")}
        icon="⚾"
        label="MLB Games"
      />
      {/* NBA section */}
      <div style={{ ...sectionLabelStyle, marginTop: 18 }}>NBA</div>
      <NavLink
        to="/nba-games"
        active={isActive("/nba-games") || isActive("/game/nba")}
        icon="🏀"
        label="NBA Games"
      />
      <NavLink
        to="/nba"
        active={isActive("/nba")}
        icon="📊"
        label="NBA Playoffs"
      />
      {/* Account section */}
      <div style={{ ...sectionLabelStyle, marginTop: 18 }}>ACCOUNT</div>
      <NavLink
        to="/settings"
        active={isActive("/settings")}
        icon="⚙️"
        label="Settings"
      />
      {isAdmin && (
        <NavLink
          to="/admin"
          active={isActive("/admin")}
          icon="🛡️"
          label="Admin"
        />
      )}
      <button
        onClick={() => { signOut(); navigate("/"); }}
        style={navBtnStyle(false)}
      >
        <span style={{ fontSize: 14, opacity: 0.85 }}>↩</span>
        <span>Sign out</span>
      </button>
      {/* Subscriber status footer */}
      <div style={{ marginTop: "auto" }}>
        {!hasFullAccess ? (
          <div style={{ padding: 10, background: "#ef444412", border: "1px solid #ef444430", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6 }}>FREE PLAN</div>
            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 8, lineHeight: 1.4 }}>
              Subscribe to unlock all edges
            </div>
            <button
              onClick={() => navigate("/pricing")}
              style={{ width: "100%", background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "6px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              Subscribe — $7/mo
            </button>
          </div>
        ) : (
          <div style={{ padding: 10, background: isAdmin ? "#a855f712" : "#22c55e12", border: `1px solid ${isAdmin ? "#a855f730" : "#22c55e30"}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: isAdmin ? "#a855f7" : "#22c55e", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4 }}>
              {isAdmin ? "ADMIN" : "SUBSCRIBED"}
            </div>
            <div style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.email}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function NavLink({ to, active, icon, label, soon }) {
  return (
    <Link
      to={soon ? "#" : to}
      onClick={(e) => { if (soon) e.preventDefault(); }}
      style={{ textDecoration: "none" }}
    >
      <div style={navBtnStyle(active, soon)}>
        <span style={{ fontSize: 14, opacity: soon ? 0.4 : 0.9 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {soon && <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.05em" }}>SOON</span>}
      </div>
    </Link>
  );
}
const sidebarStyle = {
  background: "#07090e",
  borderRight: "1px solid #1a1f28",
  width: 200,
  padding: "16px 12px",
  flexShrink: 0,
  position: "fixed",
  left: 0,
  top: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  zIndex: 50,
};
const sectionLabelStyle = {
  fontSize: 9,
  color: "#6b7280",
  letterSpacing: "0.1em",
  marginBottom: 6,
  padding: "0 8px",
  fontWeight: 700,
};
function navBtnStyle(active, soon) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: active ? "#1a1f28" : "none",
    border: "none",
    padding: "8px 10px",
    borderRadius: 6,
    color: active ? "#fff" : soon ? "#4b5563" : "#9ca3af",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: soon ? "default" : "pointer",
    textAlign: "left",
    marginBottom: 2,
    fontFamily: "inherit",
    transition: "background .15s",
  };
}
