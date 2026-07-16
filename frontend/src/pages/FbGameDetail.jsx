// FbGameDetail — football (NFL/CFB) matchup + preview page. WZ-FB-GAMEDETAIL-2026-07-16
// Parity with the MLB game detail, adapted for football data: teams/records/time/venue from
// scores, model win prob + pick + edge from the football edge board (matched by team names),
// best prices from fbOdds. The football model is uncalibrated, so everything model-derived is
// framed as a PROVISIONAL PREVIEW. Fail-safe: shows whatever it can match; missing model data
// degrades to a "preview posts as the slate nears" note rather than erroring.
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { scoresApi, edgesApi } from "../lib/api";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const nameHit = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return false; return a === b || a.includes(b) || b.includes(a); };
const fmtAm = (o) => { if (o == null || isNaN(+o)) return "—"; const n = Math.round(+o); return n > 0 ? `+${n}` : `${n}`; };
const impl = (o) => { if (o == null || isNaN(+o)) return null; o = +o; return o > 0 ? 100 / (o + 100) : (-o) / (-o + 100); };
const LEAGUE = { nfl: "NFL", cfb: "CFB" };

export default function FbGameDetail({ league = "nfl" }) {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState(null);
  const [odds, setOdds] = useState(null);

  useEffect(() => {
    let dead = false; setLoading(true); setGame(null);
    scoresApi.getScores(league).then((d) => {
      if (dead) return;
      const all = [...(d?.live || []), ...(d?.upcoming || []), ...(d?.final || [])];
      setGame(all.find((x) => String(x.detailId || x.id) === String(gameId)) || null);
      setLoading(false);
    }).catch(() => { if (!dead) { setGame(null); setLoading(false); } });
    (league === "cfb" ? edgesApi.getCFB() : edgesApi.getNFL()).then((d) => { if (!dead) setBoard(d || {}); }).catch(() => { if (!dead) setBoard({}); });
    edgesApi.getFbOdds(league).then((d) => { if (!dead) setOdds(d?.games || []); }).catch(() => { if (!dead) setOdds([]); });
    return () => { dead = true; };
  }, [league, gameId]);

  const a = game?.away, h = game?.home;
  const an = a?.name || a?.abbrev || "", hn = h?.name || h?.abbrev || "";
  const aAb = a?.abbrev || a?.abbreviation || "", hAb = h?.abbrev || h?.abbreviation || "";
  const isLive = game?.bucket === "live", isFinal = game?.bucket === "final";

  const matchEdge = (arr) => (arr || []).filter((e) => { const p = String(e.matchup || "").split(" @ "); return nameHit(p[0], an) && nameHit(p[1], hn); });
  const mlEdges = board ? matchEdge(board.moneylineEdges) : [];
  const totEdges = board ? matchEdge(board.totalsEdges) : [];
  const spEdges = board ? matchEdge(board.spreadEdges) : [];
  const oRow = (odds || []).find((ev) => nameHit(ev.awayTeam, an) && nameHit(ev.homeTeam, hn)) || null;

  const awayMl = mlEdges.find((e) => e.side === "away");
  const homeMl = mlEdges.find((e) => e.side === "home");
  const awayProb = awayMl?.modelProb != null ? Math.round(awayMl.modelProb * 100)
    : homeMl?.modelProb != null ? 100 - Math.round(homeMl.modelProb * 100) : null;
  const homeProb = awayProb != null ? 100 - awayProb : (homeMl?.modelProb != null ? Math.round(homeMl.modelProb * 100) : null);
  const topEdge = [...mlEdges, ...spEdges, ...totEdges].filter((e) => (e.edge ?? 0) > 0).sort((x, y) => (y.edge ?? 0) - (x.edge ?? 0))[0] || null;
  const totLine = totEdges[0]?.line ?? oRow?.totals?.line ?? null;
  const spLine = oRow?.spreads?.awayLine ?? null;
  const hasModel = awayProb != null || topEdge != null;

  const ml = oRow?.h2h || {};
  const leanAb = awayProb != null ? (awayProb >= homeProb ? aAb : hAb) : null;
  const pickLabel = topEdge ? (() => {
    const s = topEdge.side;
    if (s === "over" || s === "under") return `${s === "over" ? "Over" : "Under"} ${topEdge.line ?? totLine ?? ""}`.trim();
    const ab = s === "home" ? hAb : aAb;
    return topEdge.line != null ? `${ab} ${topEdge.line > 0 ? "+" + topEdge.line : topEdge.line}` : `${ab} ML`;
  })() : null;
  const edgePct = topEdge?.edge != null ? Number(topEdge.edge).toFixed(1) : null;

  return (
    <div className="fbapp"><style>{CSS}</style>
      <div className="fbhead">
        <div className="fbx" onClick={() => navigate(-1)}>{"\u2039"}<span className="fbxl">Back to games</span></div>
        <div><div className="fbt">{aAb || "?"} @ {hAb || "?"}</div><div className="fbts">{[LEAGUE[league] || "", game?.venue, game?.statusDetail].filter(Boolean).join(" \u00b7 ")}</div></div>
      </div>
      <div className="fbbody">
        {loading && <div className="fbstate">Loading matchup{"\u2026"}</div>}
        {!loading && !game && <div className="fbstate"><b>Game not found</b><div className="fbss">It may have rolled off the slate.</div></div>}
        {!loading && game && <>
          {/* Matchup + model lean */}
          <div className="fbcard fbmatch">
            <div className="fbteams">
              <div className="fbteam"><span className="fblogo">{a?.logo ? <img src={a.logo} alt="" /> : aAb.slice(0, 3)}</span><div className="fbnm">{aAb}</div>{a?.record && <div className="fbrec">{a.record}</div>}</div>
              <div className="fbat">@</div>
              <div className="fbteam"><span className="fblogo">{h?.logo ? <img src={h.logo} alt="" /> : hAb.slice(0, 3)}</span><div className="fbnm">{hAb}</div>{h?.record && <div className="fbrec">{h.record}</div>}</div>
            </div>
            {(isLive || isFinal) && (a?.score != null || h?.score != null) &&
              <div className="fbscore">{a?.score ?? 0} {"\u2013"} {h?.score ?? 0} <span className="fbst">{"\u00b7"} {isFinal ? "Final" : (game?.statusDetail || "Live")}</span></div>}
            {awayProb != null ? <>
              <div className="fbwp"><i style={{ width: awayProb + "%" }} /><span className="l">{aAb} {awayProb}%</span><span className="r">{homeProb}% {hAb}</span></div>
              <div className="fbwl">Model preview {"\u2014"} leans <b>{leanAb}</b> {Math.abs(awayProb - homeProb) <= 4 ? "by a hair" : ""}</div>
            </> : <div className="fbnomodel">Model preview posts as the slate nears {"\u2014"} book prices below are live.</div>}
          </div>

          {/* The pick (provisional) */}
          {topEdge && <div className="fbcard">
            <div className="fbclbl">MODEL PREVIEW {"\u00b7"} DIRECTIONAL</div>
            <div className="fbpick">{pickLabel}{edgePct != null && <span className={"fbedge " + (topEdge.edge >= 0 ? "up" : "dn")}>{topEdge.edge >= 0 ? "+" : ""}{edgePct}%</span>}</div>
            <div className="fbpn">Uncalibrated 2025-seed model {"\u2014"} treat as a directional lean, not a graded play.</div>
          </div>}

          {/* Prices */}
          <div className="fbcard">
            <div className="fbclbl">THE PRICES <span className="fbclr">best line across books</span></div>
            <div className="fbprow"><span className="fbpk">Moneyline</span><span className="fbpv">{aAb} {fmtAm(ml.away)}</span><span className="fbpv">{hAb} {fmtAm(ml.home)}</span></div>
            <div className="fbprow"><span className="fbpk">Spread</span><span className="fbpv">{spLine != null ? `${aAb} ${spLine > 0 ? "+" + spLine : spLine} ${fmtAm(oRow?.spreads?.away)}` : "\u2014"}</span><span className="fbpv">{spLine != null ? `${hAb} ${-spLine > 0 ? "+" + (-spLine) : (-spLine)} ${fmtAm(oRow?.spreads?.home)}` : ""}</span></div>
            <div className="fbprow"><span className="fbpk">Total</span><span className="fbpv">{totLine != null ? `Over ${totLine} ${fmtAm(oRow?.totals?.over)}` : "\u2014"}</span><span className="fbpv">{totLine != null ? `Under ${totLine} ${fmtAm(oRow?.totals?.under)}` : ""}</span></div>
          </div>

          {!hasModel && !oRow && <div className="fbstate fbmini">Lines and the model preview fill in as books post this game.</div>}
        </>}
      </div>
    </div>
  );
}

const CSS = `
.fbapp{--bg:#0A0B0D;--panel:#14171B;--panel2:#0f1216;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.13);--gold:#C9A86A;--teal:#3FCB91;--up:#3FCB91;--dn:#E2655C;--mut:#99A2AA;--mut2:#5B646C;--tx:#ECEFF2;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;
  background:var(--bg);min-height:100vh;color:var(--tx);font-family:var(--ui);max-width:520px;margin:0 auto}
.fbhead{position:sticky;top:0;z-index:5;background:rgba(8,12,17,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:12px}
.fbx{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line2);border-radius:9px;color:var(--gold);font-size:17px;cursor:pointer;flex:0 0 auto}
.fbxl{font-family:var(--ui);font-size:13px;font-weight:600}
.fbt{font-family:var(--disp);font-weight:800;font-size:19px;letter-spacing:.4px}
.fbts{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.3px;margin-top:1px}
.fbbody{padding:16px}
.fbcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:16px 18px;margin-bottom:14px}
.fbmatch{background:linear-gradient(180deg,rgba(201,168,106,.05),var(--panel))}
.fbteams{display:flex;align-items:center;justify-content:center;gap:26px}
.fbteam{text-align:center}
.fblogo{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1B2025;border:1px solid var(--line2);font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;margin:0 auto}
.fblogo img{width:42px;height:42px;object-fit:contain}
.fbnm{font-family:var(--disp);font-weight:800;font-size:20px;margin-top:8px}
.fbrec{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:2px}
.fbat{font-family:var(--mono);font-size:12px;color:var(--mut2)}
.fbscore{text-align:center;font-family:var(--disp);font-weight:800;font-size:24px;margin-top:12px}.fbscore .fbst{font-family:var(--mono);font-size:11px;color:var(--mut);font-weight:400}
.fbwp{position:relative;height:34px;border-radius:8px;background:#0f1a16;overflow:hidden;margin:16px 0 8px;display:flex;align-items:center}
.fbwp i{position:absolute;left:0;top:0;height:100%;background:linear-gradient(90deg,rgba(63,203,145,.28),rgba(63,203,145,.14));border-right:2px solid var(--teal)}
.fbwp .l,.fbwp .r{position:relative;z-index:1;font-family:var(--mono);font-size:12px;font-weight:700;padding:0 12px}.fbwp .l{color:var(--tx)}.fbwp .r{margin-left:auto;color:var(--teal)}
.fbwl{text-align:center;font-size:12.5px;color:var(--mut)}.fbwl b{color:var(--tx)}
.fbnomodel{text-align:center;font-size:12.5px;color:var(--mut);margin-top:14px;line-height:1.5}
.fbclbl{font-family:var(--mono);font-size:9px;letter-spacing:1px;color:var(--mut2);margin-bottom:11px;display:flex;justify-content:space-between}
.fbclr{color:var(--mut2);letter-spacing:.3px}
.fbpick{font-family:var(--disp);font-weight:800;font-size:24px;display:flex;align-items:center;gap:12px}
.fbedge{font-family:var(--mono);font-size:14px;font-weight:700}.fbedge.up{color:var(--up)}.fbedge.dn{color:var(--dn)}
.fbpn{font-size:11.5px;color:var(--mut);margin-top:8px;line-height:1.5}
.fbprow{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}.fbprow:first-of-type{border-top:none}
.fbpk{font-family:var(--mono);font-size:10px;color:var(--mut);width:78px;flex:0 0 auto}
.fbpv{font-family:var(--mono);font-size:13px;color:var(--tx);flex:1}
.fbstate{text-align:center;padding:34px 16px;color:var(--mut);font-size:14px}.fbstate b{color:var(--tx)}
.fbss{font-size:12px;color:var(--mut2);margin-top:6px}
.fbmini{padding:16px}
@media(min-width:1024px){
  .fbapp{max-width:900px}
  .fbbody{padding:22px 26px 40px;display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;align-items:start}
  .fbmatch{grid-column:1 / -1;margin-bottom:0}
  .fbcard{margin-bottom:0}
  .fbstate,.fbmini{grid-column:1 / -1}
}
`;
