import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/api";
import LandingPage from "./pages/Landing";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import HomePage from "./pages/Home";
import PropsPage from "./pages/Props";
import GameDetailPage from "./pages/GameDetail";
import GamesPage from "./pages/Games";
import PerformancePage from "./pages/Performance";
import PricingPage from "./pages/Pricing";
import ResetPasswordPage from "./pages/ResetPassword";
import AdminPage from "./pages/Admin";
import SettingsPage from "./pages/Settings";
import MyPicksPage from "./pages/MyPicks";
import ExpertPicksPage from "./pages/ExpertPicks";
import ConsensusPage from "./pages/Consensus";
import OddsPage from "./pages/OddsPage";
import ClvPage from "./pages/Clv";
import NBAPage from "./pages/NBA";
import NBADetailPage from "./pages/NBADetail";
import LiveScoresPage from "./pages/LiveScores";
import GuidePage from "./pages/Guide";
import DailyCardPage from "./pages/DailyCard";
import MarketReadPage from "./pages/MarketRead";
import { TermsPage, PrivacyPage } from "./pages/Legal"; // LEGAL-PAGES-2026-06-24
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
// AGE-GATE-2026-06-24 — self-affirmation 21+ entry gate + responsible-gambling footer.
// Analytics product (not a sportsbook): a good-faith age affirmation, not ID verification.
const WPAG_KEY = "wp_age_verified_v1";
function AgeGate() {
  const [status, setStatus] = useState("checking"); // checking | ask | blocked | ok
  useEffect(() => {
    let ok = false;
    try { ok = localStorage.getItem(WPAG_KEY) === "yes"; } catch (_) {}
    setStatus(ok ? "ok" : "ask");
  }, []);
  if (status === "ok" || status === "checking") return null;
  const affirm = () => { try { localStorage.setItem(WPAG_KEY, "yes"); } catch (_) {} setStatus("ok"); };
  const exit = () => { try { window.location.href = "https://www.google.com"; } catch (_) {} };
  return (
    <div className="wpag-root">
      <style>{WPAG_CSS}</style>
      <div className="wpag-card">
        <div className="wpag-brand">Wize<span>Picks</span></div>
        {status === "ask" ? (
          <>
            <div className="wpag-title">Are you 21 or older?</div>
            <div className="wpag-sub">WizePicks provides sports-betting <b>analytics and information</b> for adults of legal age. You must be 21+ to enter.</div>
            <div className="wpag-btns">
              <button className="wpag-yes" onClick={affirm}>Yes, I am 21+</button>
              <button className="wpag-no" onClick={() => setStatus("blocked")}>No</button>
            </div>
          </>
        ) : (
          <>
            <div className="wpag-title">You must be 21+ to use WizePicks</div>
            <div className="wpag-sub">Access is limited to adults of legal age.</div>
            <div className="wpag-btns">
              <button className="wpag-yes" onClick={exit}>Exit</button>
            </div>
            <div className="wpag-back" onClick={() => setStatus("ask")}>Reached this by mistake? Go back</div>
          </>
        )}
        <div className="wpag-foot"><span>21+</span><i/><span>Gamble Responsibly</span><i/><span>1-800-GAMBLER</span></div>
        <div className="wpag-fine">WizePicks is an analytics and information service, not a sportsbook — we do not accept wagers or hold betting funds. Picks are informational only; past performance does not guarantee future results. If gambling is a problem for you, call <b>1-800-GAMBLER</b> or visit ncpgambling.org.</div>
      </div>
    </div>
  );
}
const WPAG_CSS = `
.wpag-root{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(6,8,11,.975);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.wpag-card{width:100%;max-width:430px;background:#14171B;border:1px solid #2a2f37;border-radius:18px;padding:26px 24px 20px;box-shadow:0 24px 60px rgba(0,0,0,.6);text-align:center;font-family:Inter,system-ui,-apple-system,sans-serif}
.wpag-brand{font-family:Georgia,"Times New Roman",serif;font-size:26px;font-weight:700;color:#fff;letter-spacing:-.5px;margin-bottom:18px}
.wpag-brand span{color:#C9A86A}
.wpag-title{font-size:21px;font-weight:800;color:#fff;line-height:1.25;margin-bottom:10px}
.wpag-sub{font-size:13.5px;color:#9aa3ad;line-height:1.5;margin-bottom:20px}
.wpag-sub b{color:#cfd7e1;font-weight:700}
.wpag-btns{display:flex;flex-direction:column;gap:10px}
.wpag-yes{appearance:none;border:0;cursor:pointer;background:#C9A86A;color:#1a1408;font-family:inherit;font-weight:800;font-size:15px;padding:14px;border-radius:11px}
.wpag-yes:active{opacity:.85}
.wpag-no{appearance:none;cursor:pointer;background:transparent;color:#9aa3ad;border:1px solid #2a2f37;font-family:inherit;font-weight:700;font-size:14px;padding:12px;border-radius:11px}
.wpag-back{margin-top:14px;font-size:12px;color:#6b7480;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.wpag-foot{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:22px;padding-top:16px;border-top:1px solid #22262d;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;font-weight:600;letter-spacing:.4px;color:#C9A86A}
.wpag-foot i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block}
.wpag-fine{margin-top:14px;font-size:10.5px;line-height:1.55;color:#6b7480}
.wpag-fine b{color:#9aa3ad}
`;
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RecoveryRedirect />
        <AgeGate />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/admin" element={
            <PrivateRoute>
              <AdminPage />
            </PrivateRoute>
          } />
          <Route path="/dashboard" element={
            <PrivateRoute>
              <HomePage />
            </PrivateRoute>
          } />
          <Route path="/home" element={
            <PrivateRoute>
              <HomePage />
            </PrivateRoute>
          } />
          <Route path="/games" element={
            <PrivateRoute>
              <GamesPage />
            </PrivateRoute>
          } />
          <Route path="/nba-games" element={
            <PrivateRoute>
              <LiveScoresPage league="nba" />
            </PrivateRoute>
          } />
          <Route path="/nfl-games" element={
            <PrivateRoute>
              <LiveScoresPage league="nfl" />
            </PrivateRoute>
          } />
          <Route path="/cfb-games" element={
            <PrivateRoute>
              <LiveScoresPage league="cfb" />
            </PrivateRoute>
          } />
          <Route path="/nhl-games" element={
            <PrivateRoute>
              <LiveScoresPage league="nhl" />
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
          <Route path="/props" element={
            <PrivateRoute>
              <PropsPage />
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
          <Route path="/expert-picks" element={
            <PrivateRoute>
              <ExpertPicksPage />
            </PrivateRoute>
          } />
          <Route path="/consensus" element={
            <PrivateRoute>
              <ConsensusPage />
            </PrivateRoute>
          } />
          <Route path="/odds" element={
            <PrivateRoute>
              <OddsPage />
            </PrivateRoute>
          } />
          <Route path="/clv" element={
            <PrivateRoute>
              <ClvPage />
            </PrivateRoute>
          } />
          <Route path="/guide" element={
            <PrivateRoute>
              <GuidePage />
            </PrivateRoute>
          } />
          <Route path="/daily-card" element={
            <PrivateRoute>
              <DailyCardPage />
            </PrivateRoute>
          } />
          <Route path="/market-read" element={
            <PrivateRoute>
              <MarketReadPage />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
