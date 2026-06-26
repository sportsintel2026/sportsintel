import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link, useLocation, useSearchParams } from "react-router-dom";
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
import MobileShell from "./pages/MobileShell"; // MOBILESHELL-ROUTE-2026-06-24
import SportBar, { SportTabsHeader } from "./pages/SportNav"; // WIZEPICKS-SPORTNAV-2026-06-25
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
// LEGAL-FOOTER-2026-06-24 — site-wide compliance footer: Terms/Privacy links +
// responsible-gambling line, on every page except the landing (which has its own).
// Mobile gets extra bottom padding so links clear the fixed bottom tab bar.
function LegalFooter() {
  const { pathname } = useLocation();
  if (pathname === "/") return null; // landing has its own footer
  return (
    <footer className="wpf-root">
      <style>{WPF_CSS}</style>
      <div className="wpf-inner">
        <div className="wpf-links">
          <Link to="/terms">Terms</Link><i/>
          <Link to="/privacy">Privacy</Link>
        </div>
        <div className="wpf-rg"><span>21+</span><i/><span>Gamble Responsibly</span><i/><span>1-800-GAMBLER</span><i/><span>ncpgambling.org</span></div>
        <div className="wpf-fine">WizePicks provides informational sports analytics only — not betting advice, and not a sportsbook. Past performance does not guarantee future results.</div>
        <div className="wpf-copy">© {new Date().getFullYear()} WizePicks</div>
      </div>
    </footer>
  );
}
const WPF_CSS = `
.wpf-root{background:#0A0B0D;border-top:1px solid #1B2025;padding:26px 20px 30px;font-family:Inter,system-ui,-apple-system,sans-serif}
.wpf-inner{max-width:980px;margin:0 auto;text-align:center}
.wpf-links{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px}
.wpf-links a{color:#C9A86A;font-size:13px;font-weight:600;text-decoration:none}
.wpf-links a:hover{text-decoration:underline;text-underline-offset:2px}
.wpf-links i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block}
.wpf-rg{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:9px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;font-weight:600;letter-spacing:.4px;color:#C9A86A;margin-bottom:12px}
.wpf-rg i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block}
.wpf-fine{font-size:10.5px;line-height:1.55;color:#6b7480;max-width:620px;margin:0 auto 10px}
.wpf-copy{font-size:10.5px;color:#4b535c}
@media (max-width:1023px){.wpf-root{padding-bottom:96px}}
`;
// COMING-SOON-2026-06-25 — shared placeholder for sections/sports not wired yet.
function ComingSoon({ title, note }) {
  return (
    <div className="app" style={{ maxWidth: 460, margin: "0 auto", minHeight: "100vh" }}>
      <div style={{ padding: "78px 22px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 26, color: "#dfe7ea", letterSpacing: ".3px" }}>{title}</div>
        <div style={{ fontFamily: "'IBM Plex Mono',ui-monospace,monospace", fontSize: 12, color: "#8B98A3", marginTop: 10, lineHeight: 1.6 }}>{note}</div>
      </div>
    </div>
  );
}
// SPORTGATE-2026-06-25 — renders the real page for sports it supports; otherwise a
// "coming soon" for that sport+section. Keeps every sport's tabs identical to MLB.
function SportGate({ section, allow, children }) {
  const [params] = useSearchParams();
  const sport = (params.get("sport") || "mlb").toLowerCase();
  if (allow.includes(sport)) return children;
  const SP = sport.toUpperCase();
  return <ComingSoon title={`${SP} · ${section}`} note={`${section} for ${SP} is coming soon — we'll wire it in as the data lands.`} />;
}
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RecoveryRedirect />
        <AgeGate />
        <SportTabsHeader />
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
              <SportGate section="Edges" allow={["mlb","nba","nfl","cfb"]}><HomePage /></SportGate>
            </PrivateRoute>
          } />
          <Route path="/home" element={
            <PrivateRoute>
              <SportGate section="Edges" allow={["mlb","nba","nfl","cfb"]}><HomePage /></SportGate>
            </PrivateRoute>
          } />
          <Route path="/games" element={
            <PrivateRoute>
              <SportGate section="Games" allow={["mlb"]}><GamesPage /></SportGate>
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
              <SportGate section="Performance" allow={["mlb"]}><PerformancePage /></SportGate>
            </PrivateRoute>
          } />
          <Route path="/props" element={
            <PrivateRoute>
              <SportGate section="Props" allow={["mlb"]}><PropsPage /></SportGate>
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
              <SportGate section="Market" allow={["mlb","nfl","cfb"]}><OddsPage /></SportGate>
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
          <Route path="/news" element={
            <PrivateRoute>
              <ComingSoon title="News" note="Feed wiring in soon — injuries, lineups, and line-move alerts will land here." />
            </PrivateRoute>
          } />
          <Route path="/m" element={
            <PrivateRoute>
              <MobileShell />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <SportBar />
        <LegalFooter />
      </BrowserRouter>
    </AuthProvider>
  );
}
