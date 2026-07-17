// FbGameDetail - football (NFL/CFB) matchup + preview page. WZ-FB-DETAIL-RICH-2026-07-16
// Full-rich build: matchup + win prob, model read across all three markets, injury report,
// game news, an AI matchup read, best prices, and (live/final) a box score. All data is real
// (edge board, best-line odds, ESPN+RotoWire injuries/news, per-game detail, /api/ai-read).
// The football model is uncalibrated, so everything model-derived is framed as a PROVISIONAL,
// directional preview. Every section fails safe: it renders what it can match and degrades to a
// quiet note rather than erroring. Responsive: single column on mobile, two columns on desktop.
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { scoresApi, edgesApi, newsApi } from "../lib/api";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const nameHit = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return false; return a === b || a.includes(b) || b.includes(a); };
const fmtAm = (o) => { if (o == null || isNaN(+o)) return "\u2014"; const n = Math.round(+o); return n > 0 ? `+${n}` : `${n}`; };
const impl = (o) => { if (o == null || isNaN(+o)) return null; o = +o; return o > 0 ? 100 / (o + 100) : (-o) / (-o + 100); };
const LEAGUE = { nfl: "NFL", cfb: "CFB" };
const nick = (full, ab) => { const w = String(full || "").trim().split(/\s+/); return (w[w.length - 1] || ab || "").toLowerCase(); };

export default function FbGameDetail({ league = "nfl" }) {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState(null);
  const [odds, setOdds] = useState(null);
  const [inj, setInj] = useState([]);
  const [news, setNews] = useState([]);
  const [detail, setDetail] = useState(null);   // live/final per-game box detail
  const [aiRead, setAiRead] = useState(null);
  const [aiState, setAiState] = useState("idle"); // idle | loading | done | fail

  // core game + market data
  useEffect(() => {
    let dead = false; setLoading(true); setGame(null); setDetail(null);
    scoresApi.getScores(league).then((d) => {
      if (dead) return;
      const all = [...(d?.live || []), ...(d?.upcoming || []), ...(d?.final || [])];
      setGame(all.find((x) => String(x.detailId || x.id) === String(gameId)) || null);
      setLoading(false);
    }).catch(() => { if (!dead) { setGame(null); setLoading(false); } });
    (league === "cfb" ? edgesApi.getCFB() : edgesApi.getNFL()).then((d) => { if (!dead) setBoard(d || {}); }).catch(() => { if (!dead) setBoard({}); });
    edgesApi.getFbOdds(league).then((d) => { if (!dead) setOdds(d?.games || []); }).catch(() => { if (!dead) setOdds([]); });
    newsApi.getInjuries(league).then((d) => { if (!dead) setInj(Array.isArray(d?.items) ? d.items : []); }).catch(() => { if (!dead) setInj([]); });
    newsApi.getFeed(league).then((d) => { if (!dead) setNews(Array.isArray(d?.items) ? d.items : []); }).catch(() => { if (!dead) setNews([]); });
    return () => { dead = true; };
  }, [league, gameId]);

  // box detail only once we know the game is live or final
  const bucket = game?.bucket;
  useEffect(() => {
    if (bucket !== "live" && bucket !== "final") { setDetail(null); return; }
    let dead = false;
    scoresApi.getGameDetail(league, gameId).then((d) => { if (!dead) setDetail(d || null); }).catch(() => { if (!dead) setDetail(null); });
    return () => { dead = true; };
  }, [bucket, league, gameId]);

  const a = game?.away, h = game?.home;
  const an = a?.name || a?.abbrev || "", hn = h?.name || h?.abbrev || "";
  const aAb = a?.abbrev || a?.abbreviation || "", hAb = h?.abbrev || h?.abbreviation || "";
  const isLive = bucket === "live", isFinal = bucket === "final";

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
  const totLine = totEdges[0]?.line ?? oRow?.totals?.line ?? null;
  const spLine = oRow?.spreads?.awayLine ?? null;
  const ml = oRow?.h2h || {};

  // best positive edge on a market -> a display row
  const best = (arr) => (arr || []).filter((e) => (e.edge ?? -1) >= 0).sort((x, y) => (y.edge ?? 0) - (x.edge ?? 0))[0]
    || (arr || [])[0] || null;
  const bTot = best(totEdges), bSp = best(spEdges), bMl = best(mlEdges);
  const rowText = (e) => {
    if (!e) return null;
    const s = e.side;
    if (s === "over" || s === "under") return `${s === "over" ? "Over" : "Under"} ${e.line ?? totLine ?? ""}`.trim();
    const ab = s === "home" ? hAb : aAb;
    return e.line != null ? `${ab} ${e.line > 0 ? "+" + e.line : e.line}` : `${ab} ML`;
  };
  const markets = [
    { k: "TOTAL", e: bTot },
    { k: "SPREAD", e: bSp },
    { k: "MONEYLINE", e: bMl },
  ].filter((m) => m.e);
  const topEdge = [...markets].map((m) => m.e).filter((e) => (e.edge ?? 0) > 0).sort((x, y) => (y.edge ?? 0) - (x.edge ?? 0))[0] || null;
  const topKey = topEdge ? (markets.find((m) => m.e === topEdge) || {}).k : null;
  const hasModel = awayProb != null || markets.length > 0;
  const leanAb = awayProb != null ? (awayProb >= homeProb ? aAb : hAb) : null;

  // injuries filtered to this game's two teams
  const forTeam = (ab, full) => (inj || []).filter((it) =>
    norm(it.teamAbbr) === norm(ab) || nameHit(it.team, full) || nameHit(it.team, ab));
  const injA = forTeam(aAb, an), injH = forTeam(hAb, hn);
  const hasInj = injA.length + injH.length > 0;

  // game news best-effort matched to either team
  const toks = [aAb, hAb, nick(an, aAb), nick(hn, hAb)].map(norm).filter((t) => t.length >= 2);
  const gameNews = (news || []).filter((it) => {
    if (it.type === "video") return false;
    const hay = norm(`${it.team || ""} ${it.teamAbbr || ""} ${it.headline || ""} ${it.summary || ""} ${it.playerName || ""}`);
    return toks.some((t) => hay.includes(t));
  }).slice(0, 4);

  // AI matchup read (football-voiced) - fires once we have a directional lean
  useEffect(() => {
    if (!topEdge) { setAiRead(null); setAiState("idle"); return; }
    let dead = false; setAiState("loading");
    const pick = rowText(topEdge);
    const sig = `${league}:${gameId}:${topEdge.side}:${topEdge.line ?? ""}`;
    edgesApi.aiRead({
      sig, sport: league, pick, market: topKey, matchup: `${an} @ ${hn}`,
      odds: null, model: awayProb, market_pct: null, edge: topEdge.edge, baseRead: null,
    }).then((r) => { if (dead) return; const t = r?.read || r?.text || r?.readB || null; setAiRead(t); setAiState(t ? "done" : "fail"); })
      .catch(() => { if (!dead) setAiState("fail"); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, gameId, topEdge && topEdge.side, topEdge && topEdge.line]);

  // live/final box: linescore + leaders, read defensively (shape confirmed later)
  const lines = detail?.linescore || detail?.periods || game?.linescore || null;
  const scoreLine = (side) => {
    if (Array.isArray(lines)) return lines.map((p) => (side === "away" ? (p.away ?? p.a) : (p.home ?? p.h)) ?? "\u2013");
    if (lines && Array.isArray(lines[side])) return lines[side];
    return null;
  };
  const qA = scoreLine("away"), qH = scoreLine("home");
  const leaders = (detail?.leaders || detail?.boxscore?.leaders || []);
  const leaderRows = (Array.isArray(leaders) ? leaders : []).slice(0, 3).map((L) => ({
    cat: (L.category || L.name || "").toUpperCase(),
    who: L.team || L.teamAbbr || "",
    line: L.displayValue || L.stat || L.value || "",
    player: L.player || L.athlete || L.playerName || "",
  })).filter((r) => r.cat || r.player);

  const wpLabel = () => awayProb == null ? null
    : (Math.abs(awayProb - homeProb) <= 4 ? "by a hair" : "");

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

          {/* Matchup + model lean / live-final score */}
          <div className="fbcard fbmatch">
            <div className="fbteams">
              <div className="fbteam"><span className={"fblogo " + norm(aAb)}>{a?.logo ? <img src={a.logo} alt="" /> : aAb.slice(0, 3)}</span><div className="fbnm">{aAb}</div>{isLive || isFinal ? <div className="fbrec">{a?.score ?? 0}</div> : a?.record && <div className="fbrec">{a.record}</div>}</div>
              <div className="fbat">@</div>
              <div className="fbteam"><span className={"fblogo " + norm(hAb)}>{h?.logo ? <img src={h.logo} alt="" /> : hAb.slice(0, 3)}</span><div className="fbnm">{hAb}</div>{isLive || isFinal ? <div className="fbrec">{h?.score ?? 0}</div> : h?.record && <div className="fbrec">{h.record}</div>}</div>
            </div>

            {(isLive || isFinal) ? <>
              <div className="fbfin">{a?.score ?? 0} {"\u2013"} {h?.score ?? 0}</div>
              <div className="fbfst">{isFinal ? "FINAL" : (game?.statusDetail || "LIVE")}{leanAb && isFinal ? "" : ""}</div>
            </> : awayProb != null ? <>
              <div className="fbwp"><i style={{ width: awayProb + "%" }} /><span className="l">{aAb} {awayProb}%</span><span className="r">{homeProb}% {hAb}</span></div>
              <div className="fbwl">Model preview {"\u2014"} leans <b>{leanAb}</b> {wpLabel()} <span className="fbprov">PROVISIONAL</span></div>
            </> : <div className="fbnomodel">Model preview posts as the slate nears {"\u2014"} book prices below are live.</div>}
          </div>

          {/* Model read - all three markets */}
          {hasModel && <div className="fbcard">
            <div className="fbeb"><span className="d">{"\u25C6"}</span>MODEL READ<span className="rgt">DIRECTIONAL</span></div>
            {markets.length === 0 && <div className="fbmini2">Preview fills in as books post this game.</div>}
            {markets.map((m) => {
              const e = m.e, ed = e.edge, isTop = m.k === topKey && (ed ?? 0) > 0;
              return (
                <div className={"fbmrow" + (isTop ? " top" : "")} key={m.k}>
                  <span className="mk">{m.k}</span>
                  <span className="mp">{rowText(e)}{isTop && <small>the lean</small>}{!isTop && (ed ?? 0) > 0 && <small>model edge</small>}{!isTop && !((ed ?? 0) > 0) && <small>market aligned</small>}</span>
                  {(ed ?? 0) > 0
                    ? <span className="fbchip up">+{Number(ed).toFixed(1)}%</span>
                    : <span className="fbchip flat">{isTop ? "" : "no edge"}</span>}
                </div>
              );
            })}
            <div className="fbfoot">Uncalibrated 2025-seed model {"\u2014"} directional lean, not a graded play.</div>
          </div>}

          {/* Injuries */}
          {hasInj && <div className="fbcard">
            <div className="fbeb"><span className="d">{"\u25C6"}</span>INJURY REPORT<span className="rgt">ESPN + RotoWire</span></div>
            <div className="fbinjg">
              <div>
                <div className="fbinjt">{aAb}</div>
                {injA.length ? injA.slice(0, 4).map((it, i) => <InjRow key={"a" + i} it={it} />) : <div className="fbinjnone">No reported injuries</div>}
              </div>
              <div>
                <div className="fbinjt">{hAb}</div>
                {injH.length ? injH.slice(0, 4).map((it, i) => <InjRow key={"h" + i} it={it} />) : <div className="fbinjnone">No reported injuries</div>}
              </div>
            </div>
          </div>}

          {/* Game news */}
          {gameNews.length > 0 && <div className="fbcard">
            <div className="fbeb"><span className="d">{"\u25C6"}</span>GAME NEWS<span className="rgt">this matchup</span></div>
            {gameNews.map((it, i) => {
              const isInj = it.type === "injury" || it.status === "injury";
              const blurb = String(it.summary || "").trim();
              return (
                <div className="fbnews" key={i}>
                  <span className={"fbntag " + (isInj ? "i" : "n")}>{isInj ? "INJ" : "NEWS"}</span>
                  <div><div className="fbnh">{it.playerName ? <b>{it.playerName} {"\u2014"} </b> : null}{it.headline}</div>{blurb && <div className="fbnb">{blurb.slice(0, 120)}</div>}</div>
                </div>
              );
            })}
          </div>}

          {/* AI matchup read */}
          {topEdge && (aiState === "loading" || aiRead) && <div className="fbai">
            <div className="fbaihd"><span className="g">W</span>WIZE READ {"\u00b7"} AI</div>
            {aiRead ? <div className="fbaip">{aiRead}</div> : <div className="fbaip fbaimut">Reading the matchup{"\u2026"}</div>}
          </div>}

          {/* Prices */}
          <div className="fbcard">
            <div className="fbeb"><span className="d">{"\u25C6"}</span>THE PRICES<span className="rgt">best line across books</span></div>
            <div className="fbprow"><span className="fbpk">Moneyline</span><span className="fbpv">{aAb} {fmtAm(ml.away)}</span><span className="fbpv">{hAb} {fmtAm(ml.home)}</span></div>
            <div className="fbprow"><span className="fbpk">Spread</span><span className="fbpv">{spLine != null ? `${aAb} ${spLine > 0 ? "+" + spLine : spLine} ${fmtAm(oRow?.spreads?.away)}` : "\u2014"}</span><span className="fbpv">{spLine != null ? `${hAb} ${-spLine > 0 ? "+" + (-spLine) : (-spLine)} ${fmtAm(oRow?.spreads?.home)}` : ""}</span></div>
            <div className="fbprow"><span className="fbpk">Total</span><span className="fbpv">{totLine != null ? `Over ${totLine} ${fmtAm(oRow?.totals?.over)}` : "\u2014"}</span><span className="fbpv">{totLine != null ? `Under ${totLine} ${fmtAm(oRow?.totals?.under)}` : ""}</span></div>
          </div>

          {/* Box score (live / final) */}
          {(isLive || isFinal) && <div className="fbcard fbwide">
            <div className="fbeb"><span className="d">{"\u25C6"}</span>BOX SCORE<span className="rgt">{isFinal ? "final" : "live"}</span></div>
            {(qA && qH) ? <table className="fbq">
              <thead><tr><th>{"\u00a0"}</th>{qA.map((_, i) => <th key={i}>{i < 4 ? i + 1 : (i === qA.length - 1 ? "OT" : i + 1)}</th>)}<th className="t">T</th></tr></thead>
              <tbody>
                <tr><td>{aAb}</td>{qA.map((v, i) => <td key={i}>{v}</td>)}<td className="t">{a?.score ?? 0}</td></tr>
                <tr><td>{hAb}</td>{qH.map((v, i) => <td key={i}>{v}</td>)}<td className="t">{h?.score ?? 0}</td></tr>
              </tbody>
            </table> : <div className="fbmini2">Quarter scoring fills in as the game plays.</div>}
            {leaderRows.length > 0 && <div className="fblead">
              {leaderRows.map((r, i) => <div className="fbleadr" key={i}><span className="lk">{r.cat}</span><span className="lv"><b>{[r.who, r.player].filter(Boolean).join(" ")}</b> {r.line}</span></div>)}
            </div>}
          </div>}

          {!hasModel && !oRow && !hasInj && gameNews.length === 0 && <div className="fbstate fbmini">Lines, injuries, and the model preview fill in as books post this game.</div>}
        </>}
      </div>
    </div>
  );
}

function InjRow({ it }) {
  const st = String(it.status || "").toUpperCase();
  const cls = /OUT|IR|DOUBT|SUSP/.test(st) ? "out" : /QUES|GTD|LIMIT/.test(st) ? "q" : "ok";
  const short = st.replace(/QUESTIONABLE/, "QUES").replace(/PROBABLE/, "PROB").replace(/DOUBTFUL/, "DOUBT").slice(0, 6);
  return (
    <div className="fbinji">
      <span className="fbinjn">{it.playerName}{it.position ? <small> {it.position}</small> : null}</span>
      <span className={"fbistat " + cls}>{short || "\u2014"}</span>
    </div>
  );
}

const CSS = `
.fbapp{--bg:#0A0B0D;--panel:#14171B;--panel2:#0f1216;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.13);--gold:#C9A86A;--goldln:rgba(201,168,106,.34);--goldbg:rgba(201,168,106,.07);--teal:#3FCB91;--up:#3FCB91;--dn:#E2655C;--amber:#E6B450;--mut:#99A2AA;--mut2:#5B646C;--tx:#ECEFF2;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;
  background:var(--bg);min-height:100vh;color:var(--tx);font-family:var(--ui);max-width:520px;margin:0 auto}
.fbhead{position:sticky;top:0;z-index:5;background:rgba(8,12,17,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:12px}
.fbx{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line2);border-radius:9px;color:var(--gold);font-size:17px;cursor:pointer;flex:0 0 auto}
.fbxl{font-family:var(--ui);font-size:13px;font-weight:600}
.fbt{font-family:var(--disp);font-weight:800;font-size:19px;letter-spacing:.4px}
.fbts{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.3px;margin-top:1px}
.fbbody{padding:16px}
.fbcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:15px 16px;margin-bottom:12px}
.fbmatch{background:linear-gradient(180deg,var(--goldbg),var(--panel))}
.fbteams{display:flex;align-items:center;justify-content:center;gap:26px}
.fbteam{text-align:center}
.fblogo{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#1B2025;border:1px solid var(--line2);font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;margin:0 auto}
.fblogo img{width:42px;height:42px;object-fit:contain}
.fbnm{font-family:var(--disp);font-weight:800;font-size:20px;margin-top:8px}
.fbrec{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:3px}
.fbat{font-family:var(--mono);font-size:12px;color:var(--mut2)}
.fbfin{text-align:center;font-family:var(--disp);font-weight:800;font-size:30px;margin-top:12px}
.fbfst{text-align:center;font-family:var(--mono);font-size:10px;color:var(--dn);letter-spacing:1.4px;margin-top:2px}
.fbwp{position:relative;height:34px;border-radius:8px;background:#0f1a16;overflow:hidden;margin:16px 0 8px;display:flex;align-items:center}
.fbwp i{position:absolute;left:0;top:0;height:100%;background:linear-gradient(90deg,rgba(63,203,145,.10),rgba(63,203,145,.24));border-right:2px solid var(--teal)}
.fbwp .l,.fbwp .r{position:relative;z-index:1;font-family:var(--mono);font-size:12px;font-weight:700;padding:0 12px}.fbwp .l{color:var(--tx)}.fbwp .r{margin-left:auto;color:var(--teal)}
.fbwl{text-align:center;font-size:12.5px;color:var(--mut)}.fbwl b{color:var(--tx)}
.fbprov{display:inline-block;font-family:var(--mono);font-size:8.5px;font-weight:600;letter-spacing:1px;color:var(--amber);border:1px solid rgba(230,180,80,.4);border-radius:5px;padding:2px 6px;margin-left:4px;vertical-align:middle}
.fbnomodel{text-align:center;font-size:12.5px;color:var(--mut);margin-top:14px;line-height:1.5}
.fbeb{font-family:var(--mono);font-size:9px;letter-spacing:2px;color:var(--gold);display:flex;align-items:center;gap:7px;padding-bottom:9px;border-bottom:1px solid var(--goldln);margin-bottom:12px}
.fbeb .d{color:var(--gold);font-size:8px}
.fbeb .rgt{margin-left:auto;color:var(--mut2);letter-spacing:.6px}
.fbmrow{display:grid;grid-template-columns:64px 1fr auto;gap:10px;align-items:center;padding:9px 0 9px 11px;border-left:2px solid var(--goldln);margin-bottom:7px;background:linear-gradient(90deg,var(--goldbg),transparent 62%);border-radius:0 8px 8px 0}
.fbmrow.top{border-left-color:var(--gold);background:linear-gradient(90deg,rgba(201,168,106,.13),transparent 66%)}
.fbmrow .mk{font-family:var(--mono);font-size:9px;color:var(--mut);letter-spacing:.5px}
.fbmrow .mp{font-family:var(--disp);font-weight:700;font-size:17px;line-height:1.05}
.fbmrow .mp small{font-family:var(--mono);font-weight:400;font-size:9.5px;color:var(--mut);letter-spacing:.3px;display:block;margin-top:2px}
.fbchip{font-family:var(--mono);font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;white-space:nowrap}
.fbchip.up{color:var(--up);background:rgba(63,203,145,.12)}
.fbchip.flat{color:var(--mut);background:rgba(255,255,255,.05)}
.fbfoot{font-size:10.5px;color:var(--mut2);margin-top:10px;line-height:1.5}
.fbmini2{font-size:11.5px;color:var(--mut);padding:4px 0}
.fbinjg{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.fbinjt{font-family:var(--disp);font-weight:800;font-size:15px;margin-bottom:8px;letter-spacing:.4px}
.fbinji{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line)}
.fbinji:first-of-type{border-top:none}
.fbinjn{font-size:12px}.fbinjn small{color:var(--mut2);font-family:var(--mono);font-size:9.5px}
.fbinjnone{font-size:11px;color:var(--mut2);padding:6px 0}
.fbistat{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.5px;padding:1px 6px;border-radius:5px;flex:0 0 auto}
.fbistat.out{color:var(--dn);border:1px solid rgba(226,101,92,.45)}
.fbistat.q{color:var(--amber);border:1px solid rgba(230,180,80,.45)}
.fbistat.ok{color:var(--teal);border:1px solid rgba(63,203,145,.4)}
.fbnews{display:flex;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.fbnews:first-of-type{border-top:none;padding-top:2px}
.fbntag{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.5px;padding:3px 5px;border-radius:5px;height:fit-content;flex:0 0 auto}
.fbntag.n{color:#8fb4e8;border:1px solid rgba(143,180,232,.4)}
.fbntag.i{color:var(--dn);border:1px solid rgba(226,101,92,.4)}
.fbnh{font-size:12.5px;font-weight:600;line-height:1.4}.fbnh b{font-weight:700}
.fbnb{font-size:11px;color:var(--mut);margin-top:2px;line-height:1.45}
.fbai{border:1px solid var(--goldln);border-radius:14px;background:linear-gradient(180deg,var(--goldbg),rgba(20,23,27,.6));padding:15px 16px;margin-bottom:12px}
.fbaihd{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:9px;letter-spacing:1.6px;color:var(--gold);margin-bottom:9px}
.fbaihd .g{width:15px;height:15px;border-radius:4px;background:var(--gold);color:#0A0B0D;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800}
.fbaip{font-size:12.5px;line-height:1.6;color:#D5DBE0}.fbaip.fbaimut{color:var(--mut2)}
.fbprow{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}.fbprow:first-of-type{border-top:none}
.fbpk{font-family:var(--mono);font-size:10px;color:var(--mut);width:78px;flex:0 0 auto}
.fbpv{font-family:var(--mono);font-size:13px;color:var(--tx);flex:1}
.fbq{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
.fbq th,.fbq td{padding:7px 0;text-align:center;border-bottom:1px solid var(--line)}
.fbq th{font-size:9px;color:var(--mut2);letter-spacing:1px;font-weight:600}
.fbq td:first-child,.fbq th:first-child{text-align:left;font-family:var(--disp);font-weight:800;font-size:15px}
.fbq .t{color:var(--gold);font-weight:700}
.fblead{margin-top:12px}
.fbleadr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--line);font-size:12px}
.fbleadr:first-of-type{border-top:none}
.fbleadr .lk{font-family:var(--mono);font-size:9px;color:var(--mut);letter-spacing:.6px;width:78px;flex:0 0 auto}
.fbleadr .lv b{font-weight:700}
.fbstate{text-align:center;padding:34px 16px;color:var(--mut);font-size:14px}.fbstate b{color:var(--tx)}
.fbss{font-size:12px;color:var(--mut2);margin-top:6px}
.fbmini{padding:16px}
@media(min-width:1024px){
  /* WZ-FB-DESKTOP-HERO-2026-07-16 :: fill the matchup hero on wide screens (teams to the edges, bigger logos, centered win-prob) so the top no longer floats sparse */
  .fbapp{max-width:1040px}
  .fbbody{padding:24px 30px 44px;display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;align-items:start}
  .fbmatch{grid-column:1 / -1;margin-bottom:0;padding:30px 44px 24px}
  .fbmatch .fbteams{justify-content:space-between;gap:0;padding:0 24px}
  .fbmatch .fblogo{width:78px;height:78px;font-size:22px}
  .fbmatch .fblogo img{width:62px;height:62px}
  .fbmatch .fbnm{font-size:30px;margin-top:12px}
  .fbmatch .fbrec{font-size:13px;margin-top:4px}
  .fbmatch .fbat{font-size:18px;color:var(--mut)}
  .fbmatch .fbwp{max-width:640px;margin-left:auto;margin-right:auto;height:40px;margin-top:20px}
  .fbmatch .fbwl{font-size:14px;margin-top:12px}
  .fbmatch .fbfin{font-size:44px}
  .fbai{grid-column:1 / -1;margin-bottom:0;order:3}   /* WZ-FB-DESKTOP-FILL-2026-07-16 :: reflow so THE PRICES fills the empty right cell, no dead column */
  .fbwide{grid-column:1 / -1;order:4}
  .fbcard{margin-bottom:0}
  .fbstate,.fbmini{grid-column:1 / -1}
}
`;
