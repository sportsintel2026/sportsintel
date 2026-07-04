// InstallNudge.jsx — WZ-GETAPP-ANDROID-2026-07-05
//
// A self-contained "Get the app" banner. Two flavors, chosen by platform:
//   - Android / Chrome: captures the browser's `beforeinstallprompt` event and shows a
//     one-tap INSTALL button that fires Chrome's native install dialog.
//   - iOS Safari: no programmatic install exists, so it shows the manual
//     "tap Share -> Add to Home Screen" instruction.
//
// It renders nothing unless it should, so it never gets in anyone's way:
//   - on a phone (width < 1024)
//   - NOT already running as the installed app (standalone)
//   - NOT inside an in-app webview (FB / IG / etc.)
//   - NOT recently dismissed (14-day snooze, stored locally on the device)
//   - NOT on an auth/checkout flow (login, signup, pricing, checkout, reset)
//   - Android: only when Chrome says the app is actually installable (event fired)
//   - iOS: when on iOS and not yet installed
//
// Purely additive — touches no existing page, style, or route.

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const HIDE_ON = ["/login", "/signup", "/pricing", "/checkout", "/reset-password"];
const NO_SPORTBAR = ["/", "/login", "/signup", "/pricing", "/terms", "/privacy", "/reset-password"];

const DISMISS_KEY = "wz_getapp_dismissed_at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSUA = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
  return iOSUA || iPadOS;
}
function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
}
function isInAppWebview() {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|Instagram|Line|Twitter|Snapchat|Pinterest|MicroMessenger/i.test(navigator.userAgent || "");
}
function isSnoozed() {
  try {
    const t = parseInt(window.localStorage.getItem(DISMISS_KEY) || "0", 10);
    return !!t && Date.now() - t < SNOOZE_MS;
  } catch { return false; }
}
function snooze() {
  try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode: fine */ }
}

export default function InstallNudge() {
  const { pathname } = useLocation();
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 1024);
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android/Chrome install event
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Android / Chrome: capture the install prompt so we can trigger it from our button.
  useEffect(() => {
    const onBIP = (e) => {
      e.preventDefault(); // stop Chrome's default mini-infobar; we present our own
      if (isSnoozed()) return;
      setDeferredPrompt(e);
    };
    const onInstalled = () => { setDeferredPrompt(null); setShow(false); snooze(); };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!isMobile || isStandalone() || isInAppWebview() || isSnoozed()) { setShow(false); return; }
    const androidReady = !!deferredPrompt && !isIOS();
    setShow(isIOS() || androidReady);
  }, [isMobile, pathname, deferredPrompt]);

  if (!show || HIDE_ON.includes(pathname)) return null;

  const android = !!deferredPrompt && !isIOS();
  const overSportBar = isMobile && !NO_SPORTBAR.includes(pathname);

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    let outcome = "dismissed";
    try { const c = await deferredPrompt.userChoice; outcome = (c && c.outcome) || "dismissed"; } catch { /* ignore */ }
    setDeferredPrompt(null);
    setShow(false);
    if (outcome !== "accepted") snooze(); // said no -> don't nag; yes -> appinstalled handles it
  };
  const dismiss = () => { snooze(); setShow(false); };

  return (
    <>
      <style>{CSS}</style>
      <div className={"wzget" + (overSportBar ? " abovebar" : "")} aria-label="Get the WizePicks app">
        <div className="wzget-ic"><b>W</b></div>
        <div className="wzget-bd">
          <div className="wzget-t">Get the <i>app</i></div>
          <div className="wzget-s">
            {android ? (
              <>One tap to install WizePicks</>
            ) : (
              <>
                Tap
                <span className="wzget-share" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
                </span>
                then <b>Add to Home Screen</b>
              </>
            )}
          </div>
        </div>
        {android && <button className="wzget-install" onClick={install}>Install</button>}
        <button className="wzget-x" onClick={dismiss} aria-label="Dismiss">&times;</button>
      </div>
    </>
  );
}

const CSS = `
.wzget{position:fixed;left:10px;right:10px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:60;
  max-width:440px;margin:0 auto;
  background:linear-gradient(180deg,#171b20,#101317);
  border:1px solid rgba(201,168,106,.38);border-radius:16px;
  padding:12px 12px 12px 13px;display:flex;align-items:center;gap:10px;
  box-shadow:0 14px 40px rgba(0,0,0,.55);
  font-family:-apple-system,'SF Pro Display',system-ui,sans-serif;
  animation:wzgetin .35s cubic-bezier(.2,.7,.2,1)}
.wzget.abovebar{bottom:calc(66px + env(safe-area-inset-bottom))}
@keyframes wzgetin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.wzget-ic{width:44px;height:44px;flex:0 0 auto;border-radius:11px;background:#0A0B0D;
  display:flex;align-items:center;justify-content:center}
.wzget-ic b{font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:28px;color:#C9A86A;line-height:1}
.wzget-bd{flex:1;min-width:0}
.wzget-t{font-family:Georgia,'Times New Roman',serif;font-weight:600;font-size:16px;color:#ECEFF2}
.wzget-t i{font-style:normal;color:#C9A86A}
.wzget-s{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-size:11px;color:#8b95a1;margin-top:3px;
  display:flex;align-items:center;gap:5px;flex-wrap:wrap;line-height:1.5}
.wzget-s b{color:#cfd6de;font-weight:600}
.wzget-share{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;
  border-radius:4px;background:rgba(63,203,145,.14);color:#3FCB91}
.wzget-install{flex:0 0 auto;appearance:none;border:0;cursor:pointer;
  background:#C9A86A;color:#0A0B0D;font-family:-apple-system,system-ui,sans-serif;font-weight:700;font-size:13px;
  padding:9px 15px;border-radius:10px;white-space:nowrap}
.wzget-install:active{opacity:.85}
.wzget-x{flex:0 0 auto;width:26px;height:26px;border-radius:8px;border:1px solid #232830;background:#0e1116;
  color:#5b636e;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1;cursor:pointer;padding:0}
@media (min-width:1024px){.wzget{display:none}}
`;
