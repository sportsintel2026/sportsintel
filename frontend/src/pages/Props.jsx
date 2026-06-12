// Props.jsx — the full player-props board. Shows EVERY prop the model flags
// (no top-N cut), filterable by HR / Hits / Ks, in the dark Home style with the
// shared bottom nav. Reads the same /api/edges/mlb feed Home uses.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";

const TEAMCOL = { ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#C4CED4",CHW:"#C4CED4",CIN:"#C6011F",CLE:"#E31937",COL:"#5A4F9C",DET:"#FA4616",HOU:"#EB6E1F",KC:"#3E7DC4",KCR:"#3E7DC4",LAA:"#BA0021",LAD:"#3E7DC4",LOS:"#3E7DC4",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#D31145",NYM:"#FF5910",NYY:"#3A4F73",OAK:"#EFB21E",ATH:"#EFB21E",PHI:"#E81828",PIT:"#FDB827",SD:"#FFC425",SDP:"#FFC425",SEA:"#1B9A8E",SF:"#FD5A1E",SFG:"#FD5A1E",STL:"#C41E3A",TB:"#8FBCE6",TBR:"#8FBCE6",TEX:"#3E66B0",TOR:"#1D6FE0",WSH:"#E0263B",WAS:"#E0263B" };
const teamCol = (ab) => TEAMCOL[String(ab || "").toUpperCase()] || "#3a4a57";
const shortTeam = (t) => { const m = String(t).match(/[A-Z]{2,3}/); return m ? m[0] : String(t).slice(0, 3).toUpperCase(); };
const formatOdds = (o) => { if (o == null || o === "") return "—"; const n = Number(o); return n > 0 ? `+${n}` : `${n}`; };

const TABS = [["hr", "HR", "💣"], ["hits", "Hits", "🏏"], ["ks", "Ks", "🔥"]];

export default function PropsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [edges, setEdges] = useState(null);
  const [tab, setTab] = useState("hr");
  const [loading, setLoading] = useState(true);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  useEffect(() => {
    let on = true;
    edgesApi.getMLB()
      .then((d) => { if (on) { setEdges(d || {}); setLoading(false); } })
      .catch(() => { if (on) { setEdges({}); setLoading(false); } });
    return () => { on = false; };
  }, []);

  const e = edges || {};
  const arr = tab === "hr" ? (e.hrPropEdges || []) : tab === "hits" ? (e.hitsPropEdges || []) : (e.kPropEdges || []);
  const sorted = [...arr].sort((a, b) => tab === "hr" ? ((b.hrProb || 0) - (a.hrProb || 0)) : ((b.edge || 0) - (a.edge || 0)));

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#f2f6f4", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{CSS}</style>
      <BottomNav />
      <div className="ppsb"><Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} /></div>
      <div className="ppwrap">
        <div className="pphead">
          <div className="pptitle"><span className="b">Player</span> Props</div>
          <div className="ppsub">Every prop the model flags with an edge — the full board, not just the top picks.</div>
        </div>

        <div className="pptabs">
          {TABS.map(([id, lb, ic]) => (
            <button key={id} className={"pptab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
              <span className="ic">{ic}</span>{lb}
              <span className="ct">{(id === "hr" ? (e.hrPropEdges || []) : id === "hits" ? (e.hitsPropEdges || []) : (e.kPropEdges || [])).length || ""}</span>
            </button>
          ))}
        </div>

        {tab === "hr" && !loading && (
          <div className="ppwarn">⚠️ Longshots — not guaranteed. Even the top names homer only about 1 game in 5. These are ranked by the model's chance to homer (a speculative lottery-ticket bet), <b>not</b> a tracked +EV play. Bet small, if at all.</div>
        )}
        {loading
          ? <div className="ppmuted">Loading the board…</div>
          : sorted.length === 0
            ? <div className="ppmuted">No {tab === "hr" ? "home run" : tab === "hits" ? "hits" : "strikeout"} props on the board yet — fills in closer to first pitch.</div>
            : <div className="pplist">{sorted.map((p, i) => <PropRow key={(p.player || "") + i} p={p} type={tab} rank={i + 1} navigate={navigate} />)}</div>}

        <div className="ppnote">{tab === "hr"
          ? "HR props are ranked by the model's chance to homer. The HR market is efficient — these are options to consider, not tracked +EV plays."
          : "Sorted by model edge — the % is the model's price vs the book's. These clear our positive-EV bar."}</div>
      </div>
    </div>
  );
}

function PropRow({ p, type, rank, navigate }) {
  let pct, lbl, line, edgeBadge = null;
  if (type === "hr") {
    pct = Math.round((p.hrProb || 0) * 100); lbl = "to homer"; line = `O 0.5 HR · ${formatOdds(p.odds)}`;
  } else if (type === "hits") {
    pct = Math.round((p.hitsProb || 0) * 100); lbl = "hit prob";
    const needH = Math.floor(p.line) + 1; // over 0.5 → 1+, over 1.5 → 2+
    line = p.side === "over"
      ? `${needH}+ Hits · ${formatOdds(p.odds)}`
      : (p.line <= 0.5 ? `0 Hits · ${formatOdds(p.odds)}` : `Under ${p.line} Hits · ${formatOdds(p.odds)}`);
    if ((p.edge ?? 0) > 0) edgeBadge = `+${(p.edge * 100).toFixed(1)}%`;
  } else {
    pct = Math.round((p.kProb || 0) * 100); lbl = "K prob";
    line = `${p.side === "over" ? "O" : "U"} ${p.line} Ks · ${formatOdds(p.odds)}`;
    if ((p.edge ?? 0) > 0) edgeBadge = `+${(p.edge * 100).toFixed(1)}%`;
  }
  const ab = shortTeam(p.team || p.game || ""); const col = teamCol(ab);
  return (
    <div className="pprow" onClick={() => p.gameId && navigate(`/game/mlb/${p.gameId}`)}>
      <div className="rkn">{rank}</div>
      <div className="ppav" style={{ background: `linear-gradient(180deg, ${col}, #0c1018 88%)`, boxShadow: `0 0 0 2px ${col}88` }}>
        {p.playerId
          ? <img src={`https://midfield.mlbstatic.com/v1/people/${p.playerId}/spots/120`} alt="" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
          : (type === "ks" ? "⚾" : "🧢")}
      </div>
      <div className="ppinfo">
        <div className="ppname">{p.player || "—"}</div>
        <div className="ppgame">{p.game || p.team || ""}</div>
        <div className="ppline">{line}</div>
      </div>
      <div className="ppright">
        <div className="pppct">{pct}<span className="pc">%</span></div>
        <div className="pplbl">{lbl}</div>
        {edgeBadge && <div className="ppedge">{edgeBadge} EDGE</div>}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.ppwrap{max-width:560px;margin:0 auto;padding:18px 14px 90px}
.pphead{margin-bottom:14px}
.pptitle{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:30px;line-height:1;letter-spacing:-.01em}.pptitle .b{color:#ff5d4d}
.ppsub{font-size:12px;color:#8a99a2;font-weight:500;margin-top:6px;line-height:1.4}
.pptabs{display:flex;gap:8px;margin-bottom:14px}
.pptab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 8px;border-radius:10px;cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:800;white-space:nowrap;border:1px solid #1a212b;background:#0b0f14;color:#9aa7b0}
.pptab.on{border-color:#ff5d4d;background:rgba(255,93,77,.1);color:#fff}
.pptab .ic{font-size:14px}.pptab .ct{font-size:10px;font-weight:700;color:#6b7681}.pptab.on .ct{color:#ffb3aa}
.pplist{display:flex;flex-direction:column;gap:8px}
.pprow{display:flex;align-items:center;gap:11px;border:1px solid #161d24;border-radius:12px;background:linear-gradient(180deg,#0c1117,#080b0f);padding:10px 12px;cursor:pointer;position:relative}
.rkn{position:absolute;top:6px;left:8px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:10px;color:#3f4a55}
.ppav{width:46px;height:46px;border-radius:50%;display:flex;align-items:flex-end;justify-content:center;font-size:20px;flex:0 0 auto;position:relative;overflow:hidden;margin-left:6px}
.ppav img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ppinfo{flex:1;min-width:0}
.ppname{font-weight:800;font-size:14px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppgame{font-size:10.5px;color:#8a99a2;font-weight:600;margin-top:1px}
.ppline{font-size:11px;color:#b6c0c7;font-weight:600;margin-top:4px}
.ppright{text-align:right;flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end}
.pppct{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:26px;color:#33e991;line-height:1}.pppct .pc{font-size:15px;margin-left:1px}
.pplbl{font-size:8.5px;color:#7d8a93;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-top:1px}
.ppedge{margin-top:5px;font-size:9px;font-weight:800;color:#33e991;background:rgba(51,233,145,.12);border-radius:5px;padding:2px 6px;white-space:nowrap}
.ppwarn{border:1px solid rgba(243,185,79,.32);background:rgba(243,185,79,.08);border-radius:10px;padding:10px 12px;font-size:11px;color:#f3c66b;font-weight:600;line-height:1.45;margin-bottom:12px}.ppwarn b{color:#ffd98a}
.ppmuted{color:#6b7681;font-size:13px;font-weight:600;padding:24px 4px;text-align:center}
.ppnote{font-size:10.5px;color:#54616b;font-weight:600;margin-top:14px;line-height:1.4}
.ppsb{display:none}
/* ---- DESKTOP: left sidebar shell (same as the Performance page) ---- */
@media (min-width:769px){
  .ppsb{display:block}
  .ppwrap{margin-left:200px;max-width:1240px;padding:30px 26px 60px}
  .pptitle{font-size:40px}
  .pptabs{max-width:620px}
  .pplist{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
}
`;
