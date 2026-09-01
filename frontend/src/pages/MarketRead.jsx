// MarketRead.jsx — "what the books are collectively saying" per game, as a
// CFB-MARKETREAD-PAGE-WIRED-2026-06-23
// MARKETREAD-PREMIUM-DARK-RESKIN-2026-06-23
// confidence call. Reads cross-book consensus + agreement (Strong/Soft/Split),
// shows the model as a second opinion, the best price to back the lean, and an
// honest market-move read. Guidance, not a guarantee. Desktop wraps in
// TerminalShell; mobile shows the same cards in a simple stacked column. The
// swipeable mobile carousel under Market Movers lives in Home.jsx.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { edgesApi, subscriptionApi } from "../lib/api";
import { useSport } from "../hooks/useSport";
import { buildFootballIntel } from "../lib/footballIntel";
import { chooseEventDate, eventDateGroups, scopeEdgeFeed } from "../lib/eventSlate";
import EventDateSelector, { EVENT_DATE_CSS } from "../components/EventDateSelector";
import FootballIntel, { FOOTBALL_INTEL_CSS } from "../components/FootballIntel";
import TerminalShell from "./TerminalShell";

function fmtOdds(a) { if (a == null || isNaN(a)) return "—"; const n = Math.round(Number(a)); return n > 0 ? `+${n}` : `${n}`; }

const TIER = {
  Strong: { dot: "#3FCB91", label: "Strong", word: "confident in" },
  Soft: { dot: "#C9A86A", label: "Soft", word: "leaning" },
  Split: { dot: "#E2655C", label: "Split", word: "split on" },
};

// Build the headline sentence for each market from the read.
function winHeadline(w) {
  if (!w) return null;
  if (w.tier === "Split") return <>Books can’t agree on the <b>{w.favTeam}</b>.</>;
  const verb = w.favProb >= 70 ? "heavily on" : w.tier === "Strong" ? "confident in" : "leaning";
  return <>Market is {verb} the <b>{w.favTeam}</b>.</>;
}
function coverHeadline(c) {
  if (!c) return null;
  const line = c.favLine > 0 ? `+${c.favLine}` : `${c.favLine}`;
  if (c.tier === "Split") return <>Books split on the <b>{c.favTeam} {line}</b> run line.</>;
  return <>Market leans <b>{c.favTeam} {line}</b> to cover.</>;
}
function totalHeadline(t) {
  if (!t) return null;
  if (t.tier === "Split") return <>Market split on the <b>total</b>{t.lineSplit ? " — books disagree on the number" : ""}.</>;
  const side = t.favSide === "over" ? "Over" : "Under";
  return <>Market leans <b>{side} {t.line}</b>.</>;
}

function MoveLine({ move, favTeam }) {
  if (!move) {
    return (
      <div className="mrmove flat">
        <span className="mi">—</span>Line’s been steady — no convincing move yet.
      </div>
    );
  }
  if (move.towardFav) {
    return (
      <div className="mrmove up">
        <span className="mi">↗</span><b>Money’s coming in.</b> Market moved toward {favTeam} on this slate (+{move.cents}¢).
      </div>
    );
  }
  return (
    <div className="mrmove dn">
      <span className="mi">↘</span><b>{favTeam} drifting.</b> Market moved off them on this slate (−{move.cents}¢) — support fading.
    </div>
  );
}

function ModelLine({ model, leanTeam, bestPrice, bestBook, bestLabel, marketNoun = "winner" }) {
  if (!model) {
    return <div className="mrmodel"><span className="mm muted">Model: no read</span>{bestPrice != null && <span className="mbest">{bestLabel} <b>{fmtOdds(bestPrice)}{bestBook ? ` ${bestBook}` : ""}</b></span>}</div>;
  }
  const agree = model.agrees;
  return (
    <div className="mrmodel">
      <span className={"mm " + (agree ? "ok" : "warn")}>
        <span className="ic">{agree ? "✓" : "⚠"}</span>
        {agree ? `Your model agrees on the ${marketNoun}` : `Model leans ${model.favTeam || (model.favSide === "over" ? "the over" : model.favSide === "under" ? "the under" : "the other side")}`}
      </span>
      {bestPrice != null && <span className="mbest">{bestLabel} <b>{fmtOdds(bestPrice)}{bestBook ? ` ${bestBook}` : ""}</b></span>}
    </div>
  );
}

// CFB market read rides inside /api/edges/cfb as marketByGame (keyed by eventId) +
// a games[] array (carrying the model's projected winner). Reshape both into the exact
// MLB getMarketRead() game shape so Card/CSS render unchanged. CFB win + total reads are
// solid (real favProb/tier/nBooks); cover is omitted because CFB's cover favProb is a
// flat 50 (no real cover-probability) — better empty than fake. Best prices come from
// bestPrices; book names aren't in the feed, so bestBook stays null. Move is null until
// cfb_odds_ticks accumulates. Works for any football feed with this shape (e.g. NFL).
function marketReadFromFootball(resp) {
  const mbg = (resp && resp.marketByGame) || {};
  const modelById = {};
  for (const gm of (resp && resp.games) || []) {
    const ml = gm.moneyline || {};
    modelById[gm.eventId] = {
      projWinnerSide: ml.modelMargin != null ? (ml.modelMargin > 0 ? "home" : "away") : null,
      homeTeam: gm.homeTeam, awayTeam: gm.awayTeam,
    };
  }
  const games = [];
  for (const [id, entry] of Object.entries(mbg)) {
    const mr = entry.marketRead || {};
    const bp = entry.bestPrices || {};
    const parts = String(entry.matchup || "").split(" @ ");
    const md = modelById[id] || {};
    const out = { gameId: id, awayAbbr: parts[0] || "", homeAbbr: parts[1] || "" };
    if (mr.win) {
      const w = mr.win;
      let model = null;
      if (md.projWinnerSide) {
        model = { agrees: md.projWinnerSide === w.favSide, favTeam: md.projWinnerSide === "home" ? md.homeTeam : md.awayTeam, favSide: md.projWinnerSide };
      }
      out.win = {
        tier: w.tier, favTeam: w.favTeam, favProb: w.favProb, centSpread: w.centSpread, nBooks: w.nBooks,
        bestPrice: w.favSide === "home" ? (bp.ml && bp.ml.home) : (bp.ml && bp.ml.away),
        bestBook: null, move: null, model,
      };
    }
    if (mr.total) {
      const t = mr.total;
      out.total = {
        tier: t.tier, favSide: t.favSide, line: t.line, favProb: t.favProb, centSpread: t.centSpread, lineSplit: t.lineSplit,
        bestOver: bp.total && bp.total.over, bestUnder: bp.total && bp.total.under,
        bestOverBook: null, bestUnderBook: null, model: null,
      };
    }
    if (out.win || out.total) games.push(out);
  }
  return { games };
}

function Card({ g, market }) {
  let read, headline, modelLeanTeam, bestPrice, bestBook, bestLabel, subline, move = null, favTeamForMove;
  if (market === "win") {
    read = g.win; if (!read) return null;
    headline = winHeadline(read);
    bestPrice = read.bestPrice; bestBook = read.bestBook; bestLabel = "Best";
    subline = <>All {read.nBooks} books price them at <b>{read.favProb}% to win</b>, agreement within {read.centSpread}¢.</>;
    if (read.tier === "Split") subline = <>Slight favorite at <b>{read.favProb}%</b>, but prices range {read.centSpread}¢ — the market isn’t sure.</>;
    move = read.move; favTeamForMove = read.favTeam;
  } else if (market === "cover") {
    read = g.cover; if (!read) return null;
    headline = coverHeadline(read);
    bestPrice = read.bestPrice; bestBook = read.bestBook; bestLabel = "Best";
    subline = <>Books give them a <b>{read.favProb}% cover</b> on the run line — agreement within {read.centSpread} pts.</>;
    favTeamForMove = read.favTeam;
  } else {
    read = g.total; if (!read) return null;
    headline = totalHeadline(read);
    const overFav = read.favSide === "over";
    bestPrice = overFav ? read.bestOver : read.bestUnder;
    bestBook = overFav ? read.bestOverBook : read.bestUnderBook;
    bestLabel = `${overFav ? "O" : "U"}${read.line}`;
    subline = <>Books hold the total at {read.line} and price the {overFav ? "over" : "under"} at <b>{read.favProb}%</b>, within {read.centSpread}¢.</>;
    if (read.tier === "Split") subline = <>Books disagree{read.lineSplit ? " on the number itself" : " on price"} — no clear read.</>;
  }
  const ti = TIER[read.tier] || TIER.Soft;

  return (
    <div className="mrcard">
      <div className="mrtop">
        <div className="mrmatch">{g.awayAbbr} <span className="at">@</span> {g.homeAbbr}{market === "total" && read.line != null ? <span className="ln"> · O/U {read.line}</span> : market === "cover" && read.favLine != null ? <span className="ln"> · {read.favLine > 0 ? `+${read.favLine}` : read.favLine}</span> : ""}</div>
        <div className="mrtier"><span className="td" style={{ background: ti.dot }} />{ti.label}</div>
      </div>
      <div className="mrhead">{headline}</div>
      <div className="mrsub">{subline}</div>
      {market === "win" && <MoveLine move={move} favTeam={favTeamForMove} />}
      <ModelLine model={read.model} bestPrice={bestPrice} bestBook={bestBook} bestLabel={bestLabel} marketNoun={market === "win" ? "winner" : market === "cover" ? "spread" : "total"} />
    </div>
  );
}

export default function MarketReadPage() {
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState("win");
  const [sport] = useSport();
  const [footballFeed, setFootballFeed] = useState(null);
  const [eventDate, setEventDate] = useState(null);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  useEffect(() => {
    let on = true;
    const load = async () => {
      if (on) setLoading(true);
      try {
        const feed = sport === "cfb" ? await edgesApi.getCFB() : sport === "nfl" ? await edgesApi.getNFL() : null;
        const d = feed ? marketReadFromFootball(feed) : sport === "mlb" ? await edgesApi.getMarketRead() : { games: [] };
        if (on) setFootballFeed(feed);
        if (on) setData(d);
      }
      catch (_) { if (on) setData({ games: [] }); }
      if (on) setLoading(false);
    };
    load();
    const id = setInterval(load, 60000);
    return () => { on = false; clearInterval(id); };
  }, [sport]);

  const dateGroups = eventDateGroups(footballFeed?.games || [], footballFeed?.date || null);
  useEffect(() => {
    if (!dateGroups.length) { setEventDate(footballFeed?.date || null); return; }
    const auto = chooseEventDate(footballFeed.games, { fallbackDate: footballFeed.date || null });
    setEventDate((current) => dateGroups.some((group) => group.date === current && !group.complete) ? current : auto);
  }, [sport, footballFeed]);
  const scopedFootballFeed = footballFeed ? scopeEdgeFeed(footballFeed, eventDate || footballFeed.date || null) : null;
  const currentData = scopedFootballFeed ? marketReadFromFootball(scopedFootballFeed) : data;
  const games = currentData?.games || [];
  const has = (g) => market === "win" ? g.win : market === "cover" ? g.cover : g.total;
  const shown = games.filter(has);
  const footballIntel = buildFootballIntel(scopedFootballFeed, sport);

  return (
    <TerminalShell active="/market-read" plan={plan} navigate={navigate}>
      <main className="approved-intel"><style>{CSS + APPROVED_CSS + EVENT_DATE_CSS + FOOTBALL_INTEL_CSS}</style>
        <div className="approved-intel__wrap">
          {(sport === "nfl" || sport === "cfb") && <EventDateSelector groups={dateGroups} value={eventDate} onChange={setEventDate} label="EVENT DATE" />}
          <header className="approved-intel__head"><span>{sport.toUpperCase()} · VERIFIED MARKET CONTEXT</span><h1>Market &amp; Intel</h1><p>What changed, why it matters, and where the model differs from the available market.</p></header>
          {!hasFull ? <div className="approved-intel__lock"><span>ALL-ACCESS</span><h2>Market &amp; Intel is locked</h2><p>Full model-versus-market context is included with All-Access.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>
            : loading ? <div className="approved-intel__empty">Reading the verified market…</div>
            : (sport === "nfl" || sport === "cfb") ? <>
                <FootballIntel sport={sport} rows={footballIntel} />
                <section className="approved-pulse"><header><span>MARKET PULSE · WHAT CHANGED &amp; WHY</span></header>{(scopedFootballFeed?.marketMovers || []).length ? scopedFootballFeed.marketMovers.slice(0, 6).map((row, index) => <article key={index}><div><b>{row.matchup}</b><small>{String(row.market || "market").toUpperCase()} · {String(row.side || "").toUpperCase()}</small></div><strong>{row.open ?? "—"} → {row.now ?? "—"}</strong></article>) : <p>No verified line movement is available for this slate yet.</p>}</section>
              </>
            : shown.length ? <><section className="approved-gamegrid">{shown.map((g) => <Card key={g.gameId} g={g} market={market} />)}</section><div className="approved-tabs">{[["win","MONEYLINE"],["cover","RUN LINE"],["total","TOTAL"]].map(([key,label]) => <button key={key} className={market === key ? "on" : ""} onClick={() => setMarket(key)}>{label}</button>)}</div></>
              : <div className="approved-intel__empty">No verified market read is available for this slate yet.</div>}
        </div>
      </main>
    </TerminalShell>
  );
}

const APPROVED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Manrope:wght@500;600;700;800&display=swap');
.approved-intel{min-height:100vh;background:#090a0c;color:#eeeae2;font-family:Manrope,Inter,sans-serif;padding:0 0 100px;overflow-x:hidden}.approved-intel *{box-sizing:border-box}.approved-intel__wrap{width:min(100% - 28px,920px);margin:0 auto;padding:20px 0}.approved-intel__head{padding-bottom:15px;border-bottom:1px solid #252620}.approved-intel__head>span,.approved-pulse header span{font:700 8px "IBM Plex Mono",monospace;letter-spacing:1.35px;color:#d2ad68}.approved-intel__head h1{margin:7px 0 4px;font:600 clamp(28px,5vw,40px)/1 Georgia,serif;letter-spacing:-.7px}.approved-intel__head p{max-width:620px;margin:0;color:#80817a;font-size:10.5px;line-height:1.55}.approved-gamegrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.approved-gamegrid .mrcard{border-color:#2a2b25;border-radius:10px;background:#101114}.approved-tabs{display:flex;gap:6px;margin-top:13px}.approved-tabs button{appearance:none;border:1px solid #2b2c26;border-radius:999px;background:#101114;color:#7d7e77;padding:7px 10px;font:700 8px "IBM Plex Mono",monospace;cursor:pointer}.approved-tabs button.on{border-color:#d2ad68;background:#d2ad68;color:#17140d}.approved-pulse{margin-top:14px;border:1px solid #2b2c26;border-radius:10px;background:#101114;padding:14px}.approved-pulse header{padding-bottom:10px;border-bottom:1px solid #252620}.approved-pulse article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #22231f}.approved-pulse article b{display:block;font-size:11px;overflow-wrap:anywhere}.approved-pulse article small{display:block;margin-top:3px;font:600 7px "IBM Plex Mono",monospace;color:#6f7069}.approved-pulse article strong{flex:0 0 auto;font:700 10px "IBM Plex Mono",monospace;color:#45d99d}.approved-pulse>p,.approved-intel__empty{padding:28px 12px;text-align:center;color:#74756e;font:600 9px/1.5 "IBM Plex Mono",monospace}.approved-intel__lock{margin-top:14px;border:1px solid rgba(210,173,104,.35);border-radius:10px;background:#101114;padding:28px 18px;text-align:center}.approved-intel__lock>span{font:700 8px "IBM Plex Mono",monospace;color:#d2ad68}.approved-intel__lock h2{margin:7px 0;font:600 23px Georgia,serif}.approved-intel__lock p{color:#7f8079;font-size:10.5px}.approved-intel__lock button{border:0;border-radius:8px;background:#d2ad68;color:#17140d;padding:10px 14px;font-weight:800;cursor:pointer}
.approved-pulse>p,.approved-intel__empty{padding:17px 10px;font-size:8.5px}.approved-intel__lock{padding:24px 18px}.approved-intel__lock h2{font-size:22px}
@media(max-width:680px){.approved-gamegrid{grid-template-columns:1fr}}
@media(max-width:360px){.approved-intel__wrap{width:calc(100% - 20px)}.approved-intel__head h1{font-size:26px}}
`;

const CSS = `
.mrwrap{max-width:560px;margin:0 auto;padding:18px 14px 90px}
.mrback{color:#6b7280;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;user-select:none}
.mrhdr{margin-bottom:16px}
.mrtitle{font-size:30px;font-weight:800;font-family:'Barlow Condensed',sans-serif;letter-spacing:.3px}
.mrtitle .b{color:#C9A86A}
.mrtag{font-size:12.5px;color:#6b7681;font-weight:500;margin-top:4px;line-height:1.5}
.mrsports{display:flex;gap:6px;margin-bottom:10px}
.mrsports button{flex:0 0 auto;font-family:inherit;font-size:12px;font-weight:700;color:#99A2AA;background:#14171B;border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:6px 14px;cursor:pointer}
.mrsports button.on{color:#ECEFF2;background:rgba(63,203,145,.12);border-color:rgba(63,203,145,.4)}
.mrtabs{display:flex;gap:6px;margin-bottom:16px}
.mrtabs button{flex:0 0 auto;font-family:inherit;font-size:13px;font-weight:700;color:#99A2AA;background:#14171B;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:8px 16px;cursor:pointer}
.mrtabs button.on{color:#ECEFF2;background:rgba(63,203,145,.12);border-color:rgba(63,203,145,.34)}
.mrgrid{display:flex;flex-direction:column;gap:12px}
.mrcard{border:1px solid rgba(255,255,255,.06);border-radius:14px;background:#14171B;padding:14px 16px}
.mrtop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.mrmatch{font-size:14px;font-weight:700;color:#e9eff2}.mrmatch .at{color:#54616b}.mrmatch .ln{color:#54616b;font-weight:500}
.mrtier{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#aeb9c8}
.mrtier .td{width:9px;height:9px;border-radius:50%}
.mrhead{font-size:16px;font-weight:600;color:#f2f6f4;line-height:1.4;margin-bottom:4px}
.mrhead b{font-weight:700;color:#46E0A9}
.mrsub{font-size:13px;color:#8a99a2;line-height:1.5;margin-bottom:10px}.mrsub b{color:#e9eff2;font-weight:600}
.mrmove{display:flex;align-items:center;gap:7px;font-size:12.5px;line-height:1.4;border-radius:9px;padding:8px 11px;margin-bottom:10px}
.mrmove .mi{font-size:14px}
.mrmove.up{background:rgba(63,203,145,.12);color:#7FDCC0}
.mrmove.dn{background:rgba(226,101,92,.12);color:#ff9a8f}
.mrmove.flat{background:rgba(255,255,255,.03);color:#6b7681}
.mrmove b{font-weight:700}
.mrmodel{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid rgba(255,255,255,.07);padding-top:10px}
.mrmodel .mm{font-size:12.5px;font-weight:500;display:inline-flex;align-items:center;gap:5px}
.mrmodel .mm .ic{font-weight:800}
.mrmodel .mm.ok{color:#9aa7b2}.mrmodel .mm.ok .ic{color:#3FCB91}
.mrmodel .mm.warn{color:#C9A86A}
.mrmodel .mm.muted{color:#6b7681}
.mrmodel .mbest{font-size:12.5px;color:#8a99a2}.mrmodel .mbest b{color:#e9eff2;font-weight:600}
.mrlock{border:1px solid rgba(192,139,255,.3);border-radius:14px;background:rgba(192,139,255,.05);padding:22px 18px;text-align:center}
.mrlock .lh{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:20px;color:#cdbcff}
.mrlock .ls{font-size:12.5px;color:#9aa7b2;margin:6px 0 14px;line-height:1.5}
.mrlock button{font-family:inherit;border:0;border-radius:9px;background:#3FCB91;color:#04130d;font-weight:800;font-size:13px;padding:10px 18px;cursor:pointer}
.mrempty{padding:36px 12px;text-align:center;color:#6b7681;font-size:13px;font-weight:600}
.mrnote{font-size:10.5px;color:#54616b;font-weight:600;margin-top:16px;line-height:1.4;text-align:center}
.mrsb{display:none}
@media (min-width:769px) and (max-width:1023px){
  .mrsb{display:block}
  .mrwrap{margin-left:200px;max-width:none;padding:30px 30px 60px}
  .mrtitle{font-size:40px}
  .mrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
}
@media (min-width:1024px){
  .mrsb{display:none}
  .mrwrap{margin-left:0;max-width:none;padding:30px 34px 60px}
  .mrtitle{font-size:40px}
  .mrgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
}
`;
