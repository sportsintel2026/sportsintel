import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/api";
import LandingPage from "./pages/Landing";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import GameDetailPage from "./pages/GameDetail";
import GamesPage from "./pages/Games";
import PerformancePage from "./pages/Performance";
import PricingPage from "./pages/Pricing";
import ResetPasswordPage from "./pages/ResetPassword";
import AdminPage from "./pages/Admin";
import SettingsPage from "./pages/Settings";
import MyPicksPage from "./pages/MyPicks";
import NBAPage from "./pages/NBA";
import NBADetailPage from "./pages/NBADetail";
import LiveScoresPage from "./pages/LiveScores";

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return user ? children : <Navigate to="/login" replace />;
}

function LoadingScreen() {
  return (
    <div style={{minHeight:"100vh",background:"#080810",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"3px solid #1e2235",borderTopColor:"#ef4444",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:"#475569",fontSize:14}}>Loading WizePicks...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// Listens for Supabase's password-recovery event (fired when a user clicks the
// reset link in their email) and sends them to the /reset-password page so they
// can set a new password. Without this, the recovery token lands on the homepage
// and is ignored. Also handles the case where the token arrives in the URL hash
// before the auth event fires.
function RecoveryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    // Case 1: the recovery token is already in the URL hash on first load.
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      navigate("/reset-password", { replace: true });
    }
    // Case 2: Supabase fires the PASSWORD_RECOVERY event after processing the link.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
      }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RecoveryRedirect />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/admin" element={
            <PrivateRoute>
              <AdminPage />
            </PrivateRoute>
          } />
          <Route path="/dashboard" element={
            <PrivateRoute>
              <DashboardPage />
            </PrivateRoute>
          } />
          <Route path="/games" element={
            <PrivateRoute>
              <LiveScoresPage league="mlb" />
            </PrivateRoute>
          } />
          <Route path="/nba-games" element={
            <PrivateRoute>
              <LiveScoresPage league="nba" />
            </PrivateRoute>
          } />
          <Route path="/nba" element={
            <PrivateRoute>
              <NBAPage />
            </PrivateRoute>
          } />
          <Route path="/game/nba/:gameId" element={
            <PrivateRoute>
              <NBADetailPage />
            </PrivateRoute>
          } />
          <Route path="/performance" element={
            <PrivateRoute>
              <PerformancePage />
            </PrivateRoute>
          } />
          <Route path="/game/mlb/:gameId" element={
            <PrivateRoute>
              <GameDetailPage />
            </PrivateRoute>
          } />
          <Route path="/settings" element={
            <PrivateRoute>
              <SettingsPage />
            </PrivateRoute>
          } />
          <Route path="/my-picks" element={
            <PrivateRoute>
              <MyPicksPage />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
