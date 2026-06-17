// MarketRead.jsx — "what the books are collectively saying" per game, as a
// confidence call. Reads cross-book consensus + agreement (Strong/Soft/Split),
// shows the model as a second opinion, the best price to back the lean, and an
// honest market-move read. Guidance, not a guarantee. Desktop wraps in
// TerminalShell; mobile shows the same cards in a simple stacked column. The
// swipeable mobile carousel under Market Movers lives in Home.jsx.

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { edgesApi, subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import TerminalShell from "./TerminalShell";

function fmtOdds(a) { if (a == null || isNaN(a)) return "—"; const n = Math.round(Number(a)); return n > 0 ? `+${n}` : `${n}`; }

const TIER = {
  Strong: { dot: "#1D9E75", label: "Strong", word: "confident in" },
  Soft: { dot: "#EF9F27", label: "Soft", word: "leaning" },
  Split: { dot: "#E24B4A", label: "Split", word: "split on" },
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
        <span className="mi">↗</span><b>Money’s coming in.</b> Market moved toward {favTeam} today (+{move.cents}¢).
      </div>
    );
  }
  return (
    <div className="mrmove dn">
      <span className="mi">↘</span><b>{favTeam} drifting.</b> Market moved off them today (−{move.cents}¢) — support fading.
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
  const { user, signOut } = useAuth();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite";
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState("win");

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try { const d = await edgesApi.getMarketRead(); if (on) setData(d); }
      catch (_) { if (on) setData({ games: [] }); }
      if (on) setLoading(false);
    };
    load();
    const id = setInterval(load, 60000);
    return () => { on = false; clearInterval(id); };
  }, []);

  const games = data?.games || [];
  const has = (g) => market === "win" ? g.win : market === "cover" ? g.cover : g.total;
  const shown = games.filter(has);

  return (
    <TerminalShell active="/market-read" plan={plan} navigate={navigate}>
    <div style={{ minHeight: "100vh", background: "#000", color: "#f2f6f4", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{CSS}</style>
      <BottomNav />
      <div className="mrsb"><Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} /></div>
      <div className="mrwrap">
        <div onClick={() => navigate(-1)} className="mrback">← Back</div>
        <div className="mrhdr">
          <div className="mrtitle"><span className="b">Market</span> Read</div>
          <div className="mrtag">What every book’s price is saying, how confident the market is, and where it’s moving. A read, not a guarantee.</div>
        </div>

        <div className="mrtabs">
          {[["win", "Win"], ["cover", "Cover"], ["total", "Total"]].map(([k, lb]) => (
            <button key={k} className={market === k ? "on" : ""} onClick={() => setMarket(k)}>{lb}</button>
          ))}
        </div>

        {!hasFull ? (
          <div className="mrlock">
            <div className="lh">Market Read is an All-Access feature</div>
            <div className="ls">See what every book is really saying on every game — <b>$7/mo</b>.</div>
            <button onClick={() => navigate("/pricing")}>Unlock All-Access →</button>
          </div>
        ) : loading ? (
          <div className="mrempty">Reading the market…</div>
        ) : shown.length === 0 ? (
          <div className="mrempty">No market read available yet — books come online closer to game time.</div>
        ) : (
          <div className="mrgrid">
            {shown.map((g) => <Card key={g.gameId} g={g} market={market} />)}
          </div>
        )}

        <div className="mrnote">Reads cross-book consensus and price agreement. A lean to consider — never a guarantee.</div>
      </div>
    </div>
    </TerminalShell>
  );
}

const CSS = `
.mrwrap{max-width:560px;margin:0 auto;padding:18px 14px 90px}
.mrback{color:#6b7280;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-bottom:14px;user-select:none}
.mrhdr{margin-bottom:16px}
.mrtitle{font-size:30px;font-weight:800;font-family:'Barlow Condensed',sans-serif;letter-spacing:.3px}
.mrtitle .b{color:#ff5247}
.mrtag{font-size:12.5px;color:#6b7681;font-weight:500;margin-top:4px;line-height:1.5}
.mrtabs{display:flex;gap:6px;margin-bottom:16px}
.mrtabs button{flex:0 0 auto;font-family:inherit;font-size:13px;font-weight:700;color:#8a99a2;background:#0b0f14;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:8px 16px;cursor:pointer}
.mrtabs button.on{color:#fff;background:linear-gradient(90deg,rgba(29,158,117,.18),rgba(29,158,117,.05));border-color:rgba(29,158,117,.32)}
.mrgrid{display:flex;flex-direction:column;gap:12px}
.mrcard{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#0b0f14;padding:14px 16px}
.mrtop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.mrmatch{font-size:14px;font-weight:700;color:#e9eff2}.mrmatch .at{color:#54616b}.mrmatch .ln{color:#54616b;font-weight:500}
.mrtier{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#aeb9c8}
.mrtier .td{width:9px;height:9px;border-radius:50%}
.mrhead{font-size:16px;font-weight:600;color:#f2f6f4;line-height:1.4;margin-bottom:4px}
.mrhead b{font-weight:700;color:#5fd6a0}
.mrsub{font-size:13px;color:#8a99a2;line-height:1.5;margin-bottom:10px}.mrsub b{color:#e9eff2;font-weight:600}
.mrmove{display:flex;align-items:center;gap:7px;font-size:12.5px;line-height:1.4;border-radius:9px;padding:8px 11px;margin-bottom:10px}
.mrmove .mi{font-size:14px}
.mrmove.up{background:rgba(29,158,117,.1);color:#7af0c4}
.mrmove.dn{background:rgba(255,82,71,.1);color:#ff9a8f}
.mrmove.flat{background:rgba(255,255,255,.03);color:#6b7681}
.mrmove b{font-weight:700}
.mrmodel{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid rgba(255,255,255,.07);padding-top:10px}
.mrmodel .mm{font-size:12.5px;font-weight:500;display:inline-flex;align-items:center;gap:5px}
.mrmodel .mm .ic{font-weight:800}
.mrmodel .mm.ok{color:#9aa7b2}.mrmodel .mm.ok .ic{color:#1D9E75}
.mrmodel .mm.warn{color:#f3b94f}
.mrmodel .mm.muted{color:#6b7681}
.mrmodel .mbest{font-size:12.5px;color:#8a99a2}.mrmodel .mbest b{color:#e9eff2;font-weight:600}
.mrlock{border:1px solid rgba(155,123,255,.3);border-radius:14px;background:linear-gradient(180deg,rgba(155,123,255,.08),rgba(155,123,255,.02));padding:22px 18px;text-align:center}
.mrlock .lh{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:20px;color:#cdbcff}
.mrlock .ls{font-size:12.5px;color:#9aa7b2;margin:6px 0 14px;line-height:1.5}
.mrlock button{font-family:inherit;border:0;border-radius:9px;background:#1D9E75;color:#04130d;font-weight:800;font-size:13px;padding:10px 18px;cursor:pointer}
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
