// UFCRecord.jsx :: WZ-UFC-RECORD-2026-07-09
// UFC "Record" tab -- Proof Hero layout (approved mock, option 3). Reads /api/ufc/record and
// shows the model's honest, graded record: a win% ring, Model-overall vs +VALUE-only ROI bars
// (the +VALUE subset is the real test of the edge), and the most recent graded fights. Until the
// first card grades it shows a clean "no graded fights yet" state. Matches the UFC page skin:
// GOLD = model/pick, GREEN/teal = value; Barlow Condensed + IBM Plex Mono on #0A0B0D.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { subscriptionApi } from "../lib/api";
import TerminalShell from "./TerminalShell";
// WZ-UFCRECORD-DESKTOP-2026-07-11 :: UFC record page gains a desktop layout inside the shared Vault shell; mobile untouched.

const API_BASE = import.meta.env.VITE_API_URL || "";
const RC = 364.4; // 2 * pi * 58 -- hero ring circumference
const DOT = "\u00B7";   // middot, kept as an escape so the source stays clean ASCII
const DASH = "\u2014";  // em dash

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
.ufcr-wrap{min-height:100vh;background:#0A0B0D;color:#ECEFF2;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:0 0 96px}
.ufcr-in{max-width:480px;margin:0 auto;padding:18px 14px 0}

/* hero */
.ufcr-hero{text-align:center;padding:8px 0 18px}
.ufcr-hero .eyebrow{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;color:#99A2AA;text-transform:uppercase;margin-bottom:16px}
.ufcr-hero .ring{position:relative;width:132px;height:132px;margin:0 auto}
.ufcr-hero .ring svg{transform:rotate(-90deg)}
.ufcr-hero .ring .ctr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ufcr-hero .ring .pct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:34px;color:#C9A86A;line-height:1}
.ufcr-hero .ring .lab{font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:1px;color:#99A2AA;margin-top:4px;text-transform:uppercase}
.ufcr-hero .rec{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ECEFF2;margin-top:16px;letter-spacing:.5px}
.ufcr-hero .rec .u.pos{color:#C9A86A;font-weight:700}
.ufcr-hero .rec .u.neg{color:#E5605A;font-weight:700}

/* roi bars */
.ufcr-bars{margin:2px 4px 18px}
.ufcr-bars .barrow{margin-bottom:13px}
.ufcr-bars .barlab{display:flex;justify-content:space-between;align-items:baseline;font-family:'IBM Plex Mono',monospace;font-size:10.5px;margin-bottom:6px}
.ufcr-bars .barlab .l{color:#99A2AA}
.ufcr-bars .barlab .v{font-weight:700}
.ufcr-bars .barlab .v.gold{color:#C9A86A}
.ufcr-bars .barlab .v.teal{color:#3FCB91}
.ufcr-bars .barlab .v.red{color:#E5605A}
.ufcr-bars .track{height:8px;background:#1B2025;border-radius:5px;overflow:hidden}
.ufcr-bars .fill{height:100%;border-radius:5px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.ufcr-bars .barnote{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;margin-top:2px}

/* recent list */
.ufcr-recent{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:1px;color:#99A2AA;text-transform:uppercase;margin:6px 4px 10px}
.ufcr-list{margin:0 4px}
.ufcr-list .fr{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.ufcr-list .fr .chip{width:22px;height:22px;border-radius:6px;flex:0 0 22px;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:12px}
.ufcr-list .fr .chip.w{background:rgba(63,203,145,.15);color:#3FCB91}
.ufcr-list .fr .chip.l{background:rgba(229,96,90,.15);color:#E5605A}
.ufcr-list .fr .chip.p{background:rgba(255,255,255,.07);color:#99A2AA}
.ufcr-list .fr .mid{flex:1;min-width:0}
.ufcr-list .fr .mid .nm{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;color:#C9A86A;letter-spacing:.2px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ufcr-list .fr .mid .nm .vt{font-family:'IBM Plex Mono',monospace;font-size:7.5px;font-weight:700;letter-spacing:.4px;color:#3FCB91;border:1px solid rgba(63,203,145,.5);background:rgba(63,203,145,.12);border-radius:4px;padding:1px 4px;margin-left:6px;vertical-align:middle}
.ufcr-list .fr .mid .vs{font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5B646C;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ufcr-list .fr .od{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#99A2AA;flex:0 0 auto}

/* states */
.ufcr-state{margin:56px 12px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#5B646C;line-height:1.9}
.ufcr-state .big{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:22px;color:#99A2AA;letter-spacing:1px;display:block;margin-bottom:6px}
.ufcr-retry{margin-top:14px;display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#C9A86A;border:1px solid rgba(201,168,106,.4);border-radius:8px;padding:8px 16px;cursor:pointer;background:none}

@media (min-width:1024px){
  .ufcr-wrap{background:transparent;padding:0 0 40px}
  .ufcr-in{max-width:none;margin:0;padding:20px 26px 0}
}
`;

function fmtOdds(o) {
  const n = Number(o);
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "+" + n : "" + n;
}
// map an ROI% to a bar width: full bar at +/-25% ROI, floored so a tiny/zero ROI still shows.
function barWidth(roi) {
  if (roi == null) return 4;
  return Math.max(4, Math.min(100, (Math.abs(roi) / 25) * 100));
}

export default function UFCRecord() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await fetch(`${API_BASE}/api/ufc/record`);
      if (!res.ok) throw new Error("status " + res.status);
      setData(await res.json());
    } catch (e) {
      console.error("Failed to load UFC record:", e);
      setError(true); setData(null);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const ov = data && data.overall;
  const val = data && data.value;
  const recent = (data && Array.isArray(data.recent)) ? data.recent : [];
  const hasData = !!(data && data.hasData);

  const ovWin = ov && ov.winPct != null ? ov.winPct : null;
  const ringDash = ovWin != null ? (ovWin / 100) * RC : 0;
  const ovRoi = ov && ov.roiPct != null ? ov.roiPct : null;
  const valRoi = val && val.roiPct != null ? val.roiPct : null;
  const valDecided = !!(val && val.decided);

  return (
    <TerminalShell active="/ufc-record" plan={plan} navigate={navigate}>
    <div className="ufcr-wrap">
      <style>{CSS}</style>
      <div className="ufcr-in">

        {loading && (
          <div className="ufcr-state"><span className="big">Loading Record&hellip;</span></div>
        )}

        {!loading && error && (
          <div className="ufcr-state">
            <span className="big">Couldn&rsquo;t Load</span>
            The record didn&rsquo;t load.
            <br /><button className="ufcr-retry" onClick={load}>Try again</button>
          </div>
        )}

        {!loading && !error && !hasData && (
          <div className="ufcr-state">
            <span className="big">No Graded Fights Yet</span>
            The model is recording every pick now.<br />
            First results post after the next card grades.
          </div>
        )}

        {!loading && !error && hasData && ov && (
          <>
            <div className="ufcr-hero">
              <div className="eyebrow">{`Model Record${data.sinceLabel ? ` ${DOT} since ${data.sinceLabel}` : ""}`}</div>
              <div className="ring">
                <svg width="132" height="132" viewBox="0 0 132 132">
                  <circle cx="66" cy="66" r="58" fill="none" stroke="#1B2025" strokeWidth="10" />
                  <circle cx="66" cy="66" r="58" fill="none" stroke="#C9A86A" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${ringDash} ${RC}`} />
                </svg>
                <div className="ctr">
                  <span className="pct">{ovWin != null ? `${ovWin}%` : DASH}</span>
                  <span className="lab">Win Rate</span>
                </div>
              </div>
              <div className="rec">
                {`${ov.w} W ${DOT} ${ov.l} L${ov.p ? ` ${DOT} ${ov.p} P` : ""}`}
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <span className={"u " + (ov.netUnits >= 0 ? "pos" : "neg")}>{ov.netUnits >= 0 ? "+" : ""}{ov.netUnits}u</span>
              </div>
            </div>

            <div className="ufcr-bars">
              <div className="barrow">
                <div className="barlab">
                  <span className="l">Model overall ROI</span>
                  <span className={"v " + (ovRoi == null ? "gold" : ovRoi >= 0 ? "gold" : "red")}>{ovRoi != null ? `${ovRoi >= 0 ? "+" : ""}${ovRoi}%` : DASH}</span>
                </div>
                <div className="track"><div className="fill" style={{ width: barWidth(ovRoi) + "%", background: (ovRoi == null || ovRoi >= 0) ? "#C9A86A" : "#E5605A" }}></div></div>
              </div>
              <div className="barrow">
                <div className="barlab">
                  <span className="l">{`+VALUE only ROI${valDecided ? ` ${DOT} ${val.w}-${val.l}` : ""}`}</span>
                  <span className={"v " + (valRoi == null ? "teal" : valRoi >= 0 ? "teal" : "red")}>{valRoi != null ? `${valRoi >= 0 ? "+" : ""}${valRoi}%` : DASH}</span>
                </div>
                <div className="track"><div className="fill" style={{ width: barWidth(valRoi) + "%", background: (valRoi == null || valRoi >= 0) ? "#3FCB91" : "#E5605A" }}></div></div>
              </div>
              {!valDecided ? <div className="barnote">No +VALUE picks have graded yet.</div> : null}
            </div>

            <div className="ufcr-recent">Recent Results</div>
            <div className="ufcr-list">
              {recent.map((r, i) => {
                const won = r.result === "win";
                const push = r.result === "push";
                const verb = won ? "def." : push ? "vs" : "lost to";
                return (
                  <div className="fr" key={i}>
                    <div className={"chip " + (won ? "w" : push ? "p" : "l")}>{won ? "W" : push ? "P" : "L"}</div>
                    <div className="mid">
                      <div className="nm">{r.pick || DASH}{r.isValue ? <span className="vt">+VALUE</span> : null}</div>
                      <div className="vs">{`${verb} ${r.opponent || DASH}${r.event ? ` ${DOT} ${r.event}` : ""}`}</div>
                    </div>
                    <div className="od">{r.odds != null ? fmtOdds(r.odds) : ""}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
    </TerminalShell>
  );
}
