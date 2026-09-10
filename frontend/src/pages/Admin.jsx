import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase, edgesApi, footballPropsApi, wizePicksApi } from "../lib/api";
import {
  WIZEPLAY_PROP_MARKETS,
  entryKey,
  gameOddsQuote,
  normalizeGameRows,
  propOddsQuote,
  propPickText,
  propRowsForSport,
  propSides,
  validAmericanOdds,
} from "../lib/wizePlayEntry";

const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
const ADMIN_EMAIL = "r7002g@gmail.com";
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const fmtOdds = (o) => { const n = Number(o); if(!n||isNaN(n)) return String(o||""); return n>0?"+"+n:""+n; };
const resState = (r) => { const s = String(r==null?"":r).trim().toLowerCase(); if(s===""||s==="pending") return "pending"; if(s==="won"||s==="win") return "won"; if(s==="lost"||s==="loss") return "lost"; if(s==="void") return "void"; return "push"; };

// WZ-ADMIN-ALLSPORTS-2026-07-13 :: WizePlays can be posted for any sport. The KEY here is the tag
// STORED on the pick, so CFB stores "ncaafb" to match the WizePlays display filter (Home.jsx WP_SPORT)
// and the ExpertPicks tags. Board picks pull the live games feed to auto-fill odds + auto-grade by
// gameId; off-season sports (NFL/CFB/NHL in summer) have no games, so Manual entry lets you post +
// hand-grade any sport year-round. NHL has no edges endpoint yet, so it is manual-only for now.
const SPORT_CFG = {
  mlb:    { label: "MLB", feed: () => edgesApi.getMLB(), markets: [["moneyline","Moneyline"],["total","Total"],["run_line","Run Line"]] },
  nba:    { label: "NBA", feed: () => edgesApi.getNBA(), markets: [["moneyline","Moneyline"],["spread","Spread"],["total","Total"]] },
  nfl:    { label: "NFL", feed: () => edgesApi.getNFL(),  markets: [["moneyline","Moneyline"],["spread","Spread"],["total","Total"]] },
  ncaafb: { label: "CFB", feed: () => edgesApi.getCFB(),  markets: [["moneyline","Moneyline"],["spread","Spread"],["total","Total"]] },
  nhl:    { label: "NHL", feed: () => Promise.resolve({ games: [] }), markets: [["moneyline","Moneyline"],["puck_line","Puck Line"],["total","Total"]] },
};
const SPORT_KEYS = ["mlb","nba","nfl","ncaafb","nhl"];

export default function AdminPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const [today] = useState(todayISO());
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState({ w:0, l:0, p:0, u:0 });
  const [propProof, setPropProof] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // new-play form
  const [sport, setSport] = useState("mlb");
  const [games, setGames] = useState([]);
  const [gameIdx, setGameIdx] = useState(-1);
  const [market, setMarket] = useState("moneyline");
  const [selection, setSelection] = useState("");
  const [line, setLine] = useState("");
  const [odds, setOdds] = useState("");
  const [units, setUnits] = useState("");
  const [conv, setConv] = useState("Strong");
  const [write, setWrite] = useState("");
  const [book, setBook] = useState("");
  const [verifiedQuote, setVerifiedQuote] = useState(false);
  const [feedPayload, setFeedPayload] = useState(null);
  const [betKind, setBetKind] = useState("game");
  const [props, setProps] = useState([]);
  const [propCategory, setPropCategory] = useState("");
  const [playerIdx, setPlayerIdx] = useState(-1);
  const [propSide, setPropSide] = useState("");
  // WZ-ADMIN-ALLSPORTS-2026-07-13 :: "board" links a game (auto-grades); "manual" is typed for any sport.
  const [entryMode, setEntryMode] = useState("board");
  const [mMatchup, setMMatchup] = useState(""); // manual matchup, e.g. "KC @ BUF"
  const [mPick, setMPick] = useState("");       // manual pick text, e.g. "KC ML"

  useEffect(() => { if (!isAdmin) navigate("/dashboard"); }, [isAdmin]);

  const loadToday = async () => {
    try {
      const { data } = await supabase.from("expert_picks").select("*").eq("date", today).maybeSingle();
      setPicks(data?.picks ? JSON.parse(data.picks) : []);
    } catch(_) { setPicks([]); }
    setLoading(false);
  };
  const loadRecord = async () => {
    try {
      const data = await wizePicksApi.get();
      const overall = data?.proof?.overall || {};
      setRec({ w:overall.wins||0, l:overall.losses||0, p:overall.pushes||0, u:Number(overall.units)||0 });
      setPropProof(data?.proof?.props || null);
    } catch(_) {}
  };
  useEffect(() => { if(isAdmin){ loadToday(); loadRecord(); } }, [isAdmin]);

  // Games come from the EDGES board so each one carries its live odds (moneyline /
  // total / run-line). Selecting a game + market + selection then auto-fills the price.
  useEffect(() => {
    let cancelled = false;
    const p = (SPORT_CFG[sport] || SPORT_CFG.mlb).feed();
    p.then(d => {
      if (cancelled) return;
      setFeedPayload(d);
      setGames(normalizeGameRows(d)); setGameIdx(-1); setSelection("");
    }).catch(()=>setGames([]));
    return () => { cancelled = true; };
  }, [sport, sheetOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!sheetOpen || betKind !== "prop") { setProps([]); return undefined; }
    const load = sport === "nfl" ? footballPropsApi.getAdmin("nfl") : Promise.resolve(feedPayload);
    load.then((payload) => {
      if (cancelled) return;
      setProps(propRowsForSport(sport, payload));
      setPropCategory(""); setPlayerIdx(-1); setPropSide("");
    }).catch(() => setProps([]));
    return () => { cancelled = true; };
  }, [sport, betKind, sheetOpen, feedPayload]);

  const categoryProps = props.filter((prop) => prop.market === propCategory
    && (!games[gameIdx] || String(prop.eventId) === String(games[gameIdx].gameId)));
  const chosenProp = categoryProps[playerIdx] || null;
  const availablePropMarkets = (WIZEPLAY_PROP_MARKETS[sport] || [])
    .filter(([key]) => props.some((prop) => prop.market === key));

  // Auto-fill exact best verified line/price/book. Missing quotes stay blank and
  // explicitly enter manual fallback mode; no -110 or unnamed-book default exists.
  useEffect(() => {
    const current = betKind === "prop"
      ? propOddsQuote(chosenProp, propSide)
      : gameOddsQuote(games[gameIdx], market, selection);
    if (current) {
      setOdds(String(current.odds)); setBook(current.book); setVerifiedQuote(true);
      setLine(current.line == null ? "" : String(current.line));
    } else {
      setOdds(""); setBook(""); setVerifiedQuote(false);
      if (betKind === "prop" || market !== "moneyline") setLine("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIdx, market, selection, betKind, chosenProp, propSide]);

  const save = async (next) => {
    setSaving(true);
    try {
      const { error } = await supabase.from("expert_picks").upsert({ date: today, picks: JSON.stringify(next) }, { onConflict: "date" });
      if (error) throw error;
      setPicks(next);
    }
    catch(e) { alert("Save failed: " + (e?.message||e)); }
    setSaving(false);
  };

  const selLabel = (g, sel) => sel==="away" ? (g?.awayAbbr||"Away") : sel==="home" ? (g?.homeAbbr||"Home") : sel==="over" ? "Over" : "Under";
  const buildPickText = (g) => {
    if (market==="total") return `${selection==="under"?"Under":"Over"} ${line}`;
    if (market==="moneyline") return `${selLabel(g,selection)} ML`;
    return `${selLabel(g,selection)} ${line!==""?(Number(line)>0?"+":"")+line:""}`.trim();
  };

  const publish = async () => {
    let pick;
    if (entryMode === "manual") {
      // Legacy free-text entry remains available for out-of-season sports, but it
      // never receives an invented default price or an automatic-grade claim.
      if (!mPick.trim()) { alert("Enter the pick text (e.g. \"KC ML\", \"Over 45.5\", \"BUF -3.5\")."); return; }
      if (needsLine && !Number.isFinite(Number(line))) { alert("Enter a valid line."); return; }
      if (!validAmericanOdds(odds) || !book.trim()) { alert("Enter valid American odds and the exact sportsbook."); return; }
      const parts = String(mMatchup).split(/@|vs/i).map(s=>s.trim()).filter(Boolean);
      pick = {
        type: "straight", kind: "game", sport, gameId: "", game: mMatchup.trim(),
        awayAbbr: (parts[0]||"").slice(0,4).toUpperCase(), homeAbbr: (parts[1]||"").slice(0,4).toUpperCase(),
        market, selection: "", line: line===""?null:Number(line),
        pick: mPick.trim(), odds: Number(odds), book: book.trim(), oddsSource: "manual", units: Number(units)||1,
        conviction: conv, write: write.trim(), result: "", autoGrade: false, submittedAt: new Date().toISOString(),
      };
    } else {
      const g = games[gameIdx] || {};
      if (!g.gameId) { alert("Select a game."); return; }
      if (!validAmericanOdds(odds) || !book.trim()) { alert("Odds unavailable. Enter valid American odds and the exact sportsbook before publishing."); return; }
      if (needsLine && !Number.isFinite(Number(line))) { alert("Enter the exact valid line."); return; }
      const common = {
        type: "straight", sport, gameId: g.gameId, gameDate: g.gameDate, commenceTime: g.commenceTime,
        game: `${g.awayAbbr} @ ${g.homeAbbr}`, awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr,
        odds: Number(odds), book: book.trim(), oddsSource: verifiedQuote ? "verified" : "manual",
        units: Number(units)||1, conviction: conv, write: write.trim(), result: "", autoGrade: true,
        submittedAt: new Date().toISOString(),
      };
      if (betKind === "prop") {
        if (!chosenProp || !propSide) { alert("Select a player, prop type, and outcome."); return; }
        pick = {
          ...common, kind: "prop", market: "prop", propCategory: chosenProp.market,
          playerId: String(chosenProp.playerId || ""), playerName: chosenProp.player, team: chosenProp.team || null,
          selection: propSide, line: line===""?null:Number(line),
          pick: propPickText(chosenProp, propSide, line),
          modelProjection: chosenProp.projection ?? null, modelEdge: chosenProp.modelEdge ?? null,
        };
      } else {
        if (!selection) { alert("Pick a selection (side / over-under)."); return; }
        pick = {
          ...common, kind: "game", market, selection, line: line===""?null:Number(line), pick: buildPickText(g),
        };
      }
    }
    pick.entryKey = entryKey(pick);
    let latestToday = picks;
    let allRows = [];
    try {
      const { data, error } = await supabase.from("expert_picks").select("date,picks");
      if (error) throw error;
      allRows = data || [];
      const latest = allRows.find((row) => row.date === today);
      if (latest) latestToday = JSON.parse(latest.picks || "[]");
    } catch (error) {
      alert("Could not verify duplicate safety: " + (error?.message || error)); return;
    }
    const allExisting = allRows.flatMap((row) => {
      try { const parsed = JSON.parse(row.picks || "[]"); return Array.isArray(parsed) ? parsed : []; }
      catch (_) { return []; }
    });
    if (allExisting.some((existing) => (existing.entryKey || entryKey(existing)) === pick.entryKey)) {
      alert("That exact WizePlay is already pending or recorded."); return;
    }
    await save([pick, ...latestToday]);
    setSheetOpen(false);
    setSelection(""); setLine(""); setOdds(""); setBook(""); setUnits(""); setWrite(""); setGameIdx(-1); setMMatchup(""); setMPick("");
    setPropCategory(""); setPlayerIdx(-1); setPropSide(""); setVerifiedQuote(false);
  };

  const gradePick = async (idx, result) => {
    const next = picks.map((p,i) => i===idx ? { ...p, result } : p);
    await save(next);
    loadRecord();
  };

  const active = picks.map((p,i)=>({p,i})).filter(o => resState(o.p.result)==="pending");
  const settled = picks.map((p,i)=>({p,i})).filter(o => resState(o.p.result)!=="pending");
  const winPct = (rec.w+rec.l)>0 ? (rec.w/(rec.w+rec.l)*100).toFixed(1) : "0.0";

  const marketSels = market==="total" ? [["over","Over"],["under","Under"]] : [["away","Away"],["home","Home"]];
  const needsLine = betKind === "prop"
    ? !["anytime_td", "home_run"].includes(chosenProp?.market)
    : market==="total" || market==="run_line" || market==="spread" || market==="puck_line";
  const currentPropSides = propSides(chosenProp);

  const runGrading = async () => {
    try { const j = await wizePicksApi.runGrading(); alert("Grading run.\n" + JSON.stringify(j).slice(0,300)); loadToday(); loadRecord(); }
    catch(e) { alert("Grading failed: " + (e?.message||e)); }
  };
  const clearCache = async () => {
    const tok = window.prompt("Admin token (x-admin-token):"); if(!tok) return;
    try { const r = await fetch(`${API_BASE}/api/cache`, { method:"DELETE", headers:{ "x-admin-token": tok } }); alert(r.ok ? "Cache cleared." : "Failed ("+r.status+")"); }
    catch(e) { alert("Failed: " + (e?.message||e)); }
  };

  if (!isAdmin) return null;

  const Play = ({ p, i, isActive }) => {
    const st = resState(p.result);
    const stCls = st;
    return (
      <div className={"play"+(isActive?" pending":"")}>
        <div className="ph"><div className="ppick">{p.pick}<span className="u">{p.units}u @ {fmtOdds(p.odds)}</span></div><span className={"pst "+stCls}>{(isActive?"PENDING":st).toUpperCase()}</span></div>
        <div className="pmu">{p.game}{p.book?` · ${p.book}`:""}{p.oddsSource==="manual"?" · MANUAL ODDS":""}{p.conviction?` · ${p.conviction} conviction`:""}</div>
        {p.write ? <div className="pwrite">{p.write}</div> : null}
        {isActive && !p.autoGrade && <div className="grade"><b className="w" onClick={()=>gradePick(i,"win")}>Mark Won</b><b className="l" onClick={()=>gradePick(i,"loss")}>Mark Lost</b><b onClick={()=>gradePick(i,"push")}>Void</b></div>}
      </div>
    );
  };

  const PropPerformanceRow = ({ label, value }) => {
    const summary = value || {};
    const net = Number(summary.units) || 0;
    return <span><strong>{label}</strong> {summary.wins||0}-{summary.losses||0}-{summary.pushes||0} · {summary.winRate||0}% hit · {net>=0?"+":""}{net.toFixed(2)}u · {(Number(summary.roi)||0).toFixed(1)}% ROI · {summary.pending||0} pending</span>;
  };

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd"><div className="hrow"><div className="logo"><span className="w">Wize</span>Picks</div><div className="htitle">ADMIN</div></div></div>

      <div className="blk"><div className="prof"><div className="av">MG</div><div><div className="pn">Master G</div><div className="pe">owner · wizepicks.com</div><div className="pp">{"\u25cf"} OWNER · ALL-ACCESS</div></div></div></div>

{/* WZ-ADMIN-PERF-BTN-2026-07-10 :: admin-only Model Performance button (Admin page already bounces non-admins) */}
      <div className="perfbtn" onClick={()=>navigate("/performance")}>
        <div className="pli">{"\u25b2"}</div>
        <div className="plt"><b>MODEL PERFORMANCE</b><span>core record {"\u00b7"} ROI {"\u00b7"} CLV {"\u00b7"} by-market</span></div>
        <div className="plc">{"\u203a"}</div>
      </div>
      <div className="perfbtn" onClick={()=>navigate("/admin/nfl-props")}>
        <div className="pli">{"\u25c8"}</div>
        <div className="plt"><b>NFL PROPS TRACKER</b><span>automatic record {"\u00b7"} units {"\u00b7"} ROI {"\u00b7"} by category</span></div>
        <div className="plc">{"\u203a"}</div>
      </div>

      <div className="blk"><div className="bl">WIZEPLAYS PERFORMANCE <span className="bx">straight bets · automatic grading</span></div>
        <div className="wprec">
          <div className="r"><div className="k">RECORD</div><div className="v">{rec.w}-{rec.l}-{rec.p}</div></div>
          <div className="r"><div className="k">UNITS</div><div className={"v "+(rec.u>=0?"g":"")}>{rec.u>=0?"+":""}{rec.u}u</div></div>
          <div className="r"><div className="k">WIN %</div><div className="v gold">{winPct}%</div></div>
        </div>
        {propProof && <div className="proprec">
          <b>PROP PERFORMANCE</b>
          <PropPerformanceRow label="All Props" value={propProof.overall}/>
          <PropPerformanceRow label="NFL Props" value={propProof.bySport?.nfl}/>
          <PropPerformanceRow label="CFB Props" value={propProof.bySport?.cfb}/>
          <PropPerformanceRow label="MLB Props" value={propProof.bySport?.mlb}/>
          {Object.entries(propProof.byCategory||{}).map(([key,value])=><PropPerformanceRow key={key} label={key.replaceAll("_"," ")} value={value}/>)}
        </div>}
        <div className="newbtn" onClick={()=>setSheetOpen(true)}><span style={{fontSize:18}}>+</span> New WizePlay</div>
        <div className="sub2">ACTIVE PLAYS</div>
        {loading ? <div className="placeholder">Loading…</div> : active.length ? active.map(o=><Play key={o.i} p={o.p} i={o.i} isActive/>) : <div className="placeholder">No active plays today. Add one above.</div>}
        <div className="sub2">RECENTLY SETTLED</div>
        {settled.length ? settled.slice(0,8).map(o=><Play key={o.i} p={o.p} i={o.i}/>) : <div className="placeholder">Nothing settled yet today.</div>}
      </div>

      {/* WZ-SUBSTATS-2026-07-13 :: SUBSCRIBERS moved to the Account page (Settings) and wired to live Stripe counts. */}


      <div className="blk"><div className="bl">SYSTEM <span className="bx">admin only</span></div>
        <div className="lrow" onClick={runGrading}><div className="li">{"\u25f7"}</div><div className="lt">Run grading now<div className="ls">settle pending straight bets</div></div><div className="lc">{"\u203a"}</div></div>
        <div className="lrow" onClick={()=>window.open(`${API_BASE}/api/grade-now?probe=1`,"_blank")}><div className="li">{"\u2261"}</div><div className="lt">Model diagnostics<div className="ls">/api/grade-now · feeds audit</div></div><div className="lc">{"\u203a"}</div></div>
        <div className="lrow" onClick={clearCache}><div className="li">{"\u2327"}</div><div className="lt">Clear cache<div className="ls">DELETE /api/cache · admin token</div></div><div className="lc">{"\u203a"}</div></div>
      </div>

      {sheetOpen && <>
        <div onClick={()=>setSheetOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:60}}/>
        <div className="sheet open" style={{zIndex:61}}>
          <div className="shead"><div className="x" onClick={()=>setSheetOpen(false)}>{"\u2039"}</div><div className="t">New WizePlay</div></div>
          <div className="sbody">
            <div className="fld"><label>SPORT</label><div className="segf">{SPORT_KEYS.map((k)=><b key={k} className={sport===k?"on":""} onClick={()=>{ setSport(k); setMarket(SPORT_CFG[k].markets[0][0]); setBetKind("game"); setEntryMode("board"); setSelection(""); setPropCategory(""); setPlayerIdx(-1); setPropSide(""); setLine(""); setOdds(""); setBook(""); setGameIdx(-1); }}>{SPORT_CFG[k].label}</b>)}</div></div>
            <div className="fld"><label>BET TYPE</label><div className="segf">
              <b className={betKind==="game"?"on":""} onClick={()=>{setBetKind("game"); setPropCategory(""); setPlayerIdx(-1); setPropSide("");}}>Game</b>
              {["nfl","ncaafb","mlb"].includes(sport) && <b className={betKind==="prop"?"on":""} onClick={()=>{setBetKind("prop"); setEntryMode("board"); setSelection("");}}>Player prop</b>}
            </div></div>
            {betKind==="game" && <div className="fld"><label>ENTRY</label><div className="segf">
              <b className={entryMode==="board"?"on":""} onClick={()=>setEntryMode("board")}>From board</b>
              <b className={entryMode==="manual"?"on":""} onClick={()=>setEntryMode("manual")}>Legacy manual</b>
            </div></div>}
            {entryMode==="board"
              ? <div className="fld"><label>GAME (auto-grades when linked)</label>
                  <select value={gameIdx} onChange={e=>{setGameIdx(Number(e.target.value)); setSelection(""); setPlayerIdx(-1); setPropSide("");}}>
                    <option value={-1}>{games.length ? "Select a game…" : "No games loaded — switch to Manual"}</option>
                    {games.map((g,i)=><option key={i} value={i}>{g.label}</option>)}
                  </select>
                </div>
              : <>
                  <div className="fld"><label>MATCHUP</label><input value={mMatchup} onChange={e=>setMMatchup(e.target.value)} placeholder="KC @ BUF"/></div>
                  <div className="fld"><label>PICK (shown to subscribers)</label><input value={mPick} onChange={e=>setMPick(e.target.value)} placeholder="KC ML  /  Over 45.5  /  BUF -3.5"/></div>
                </>}
            {betKind==="game" ? <div className="row2">
              <div className="fld"><label>MARKET</label><select value={market} onChange={e=>{setMarket(e.target.value); setSelection(""); setLine("");}}>
                {(SPORT_CFG[sport]||SPORT_CFG.mlb).markets.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select></div>
              {entryMode==="board"
                ? <div className="fld"><label>SELECTION</label><select value={selection} onChange={e=>setSelection(e.target.value)}>
                    <option value="">—</option>
                    {marketSels.map(([v,lbl])=><option key={v} value={v}>{v==="away"?(games[gameIdx]?.awayAbbr||"Away"):v==="home"?(games[gameIdx]?.homeAbbr||"Home"):lbl}</option>)}
                  </select></div>
                : <div className="fld"><label>SELECTION</label><input value="" placeholder="typed in PICK above" disabled/></div>}
            </div> : <>
              <div className="fld"><label>PROP TYPE</label><select value={propCategory} onChange={e=>{setPropCategory(e.target.value); setPlayerIdx(-1); setPropSide("");}}>
                <option value="">{availablePropMarkets.length ? "Select a prop…" : "No automatically gradeable props available"}</option>
                {availablePropMarkets.map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select></div>
              {sport==="ncaafb" && <div className="oddsnote manual">CFB prop entry is disabled until an exact-identity automatic final-stat grader exists.</div>}
              <div className="fld"><label>PLAYER</label><select value={playerIdx} onChange={e=>{setPlayerIdx(Number(e.target.value)); setPropSide("");}} disabled={!categoryProps.length}>
                <option value={-1}>{categoryProps.length ? "Select a player…" : "No verified players for this game/market"}</option>
                {categoryProps.map((prop,index)=><option key={`${prop.eventId}-${prop.playerId}-${index}`} value={index}>{prop.player}{prop.team?` · ${prop.team}`:""}</option>)}
              </select></div>
              <div className="fld"><label>SIDE / OUTCOME</label><select value={propSide} onChange={e=>setPropSide(e.target.value)} disabled={!currentPropSides.length}>
                <option value="">—</option>
                {currentPropSides.map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select></div>
            </>}
            {entryMode==="board" && (selection || propSide) && <div className={`oddsnote ${verifiedQuote?"verified":"manual"}`}>{verifiedQuote ? `VERIFIED ODDS · ${book}` : "Odds unavailable · explicit manual fallback required"}</div>}
            <div className="row2">
              {needsLine ? <div className="fld"><label>LINE</label><input value={line} onChange={e=>setLine(e.target.value)} placeholder="8.5 / -1.5" inputMode="decimal" disabled={verifiedQuote}/></div>
                : <div className="fld"><label>LINE</label><input value="" placeholder="—" disabled/></div>}
              <div className="fld"><label>ODDS</label><input value={odds} onChange={e=>setOdds(e.target.value)} placeholder="-130" disabled={verifiedQuote}/></div>
            </div>
            <div className="fld"><label>SPORTSBOOK</label><input value={book} onChange={e=>setBook(e.target.value)} placeholder="Required when odds are unavailable" disabled={verifiedQuote}/></div>
            <div className="row2">
              <div className="fld"><label>UNITS</label><input value={units} onChange={e=>setUnits(e.target.value)} placeholder="1.5" inputMode="decimal"/></div>
              <div className="fld"><label>CONVICTION</label><div className="segf">{["Lean","Strong","Max"].map(c=><b key={c} className={conv===c?"on":""} onClick={()=>setConv(c)}>{c}</b>)}</div></div>
            </div>
            <div className="fld"><label>WRITE-UP (optional)</label><textarea value={write} onChange={e=>setWrite(e.target.value)} placeholder="Why this play…" rows={3}/></div>
            <div className="newbtn" onClick={publish} style={{opacity:saving?.6:1}}>{saving?"Publishing…":"Publish WizePlay"}</div>
          </div>
        </div>
      </>}

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate("/props")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
  );
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}
.fld{margin-bottom:12px}.fld label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.5px;color:#7d8a98;margin-bottom:6px}
.fld select,.fld input,.fld textarea{width:100%;box-sizing:border-box;background:#0c1219;border:1px solid #1e2a36;border-radius:9px;color:#e8eef3;font:600 14px Inter;padding:11px 12px;outline:none}
.fld textarea{resize:vertical;font-weight:500}
.row2{display:flex;gap:10px}.row2 .fld{flex:1}
.segf{display:flex;gap:0;border:1px solid #1e2a36;border-radius:9px;overflow:hidden}
.segf b{flex:1;text-align:center;font:800 12px 'Barlow Condensed';letter-spacing:.4px;color:#7d8a98;padding:10px;cursor:pointer}
.segf b.on{background:#141d24;color:#fff}

:root{--bg:#06090b;--panel:#0b1117;--line:#16202a;--line2:#1d2a36;--gold:#f3b94f;--green:#33e991;--neg:#ff5d4d;--red:#ff5d4d;--steel:#2674b0;--blue:#5da9e8;--mut:#7d8a98;--mut2:#4a5663;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative;padding-bottom:96px}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0}
.logo{font-family:var(--disp);font-weight:800;font-size:21px;letter-spacing:.4px;color:#fff}.logo .w{color:var(--gold)}
.htitle{font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:1px;color:var(--gold);margin-left:auto;border:1px solid rgba(243,185,79,.35);background:rgba(243,185,79,.08);border-radius:999px;padding:4px 11px}
.blk{margin:13px 14px 0;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:14px}
.bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.7px;color:var(--mut);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.bl .bx{font-family:var(--mono);font-size:9px;color:var(--mut2);letter-spacing:0;font-weight:500}
.prof{display:flex;align-items:center;gap:13px}
.prof .av{width:50px;height:50px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#f3b94f,#9a6a18);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:20px;color:#1a1408;flex:0 0 auto}
.prof .pn{font-family:var(--disp);font-weight:800;font-size:20px;color:#fff}
.prof .pe{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:2px}
.prof .pp{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(51,233,145,.35);background:rgba(51,233,145,.1);border-radius:999px;padding:3px 9px}
/* wizeplays record */
.wprec{display:flex;gap:9px;margin-bottom:11px}
.wprec .r{flex:1;border:1px solid var(--line);border-radius:11px;background:#0d141b;padding:11px;text-align:center}
.wprec .r .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}.wprec .r .v{font-family:var(--disp);font-weight:800;font-size:22px;color:#fff;margin-top:3px}.wprec .r .v.g{color:var(--green)}.wprec .r .v.gold{color:var(--gold)}
.proprec{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:10px;background:#0d141b;padding:10px;margin:0 0 11px;font-family:var(--mono);font-size:8.5px;color:var(--mut)}
.proprec b{font-family:var(--disp);font-size:11px;letter-spacing:.5px;color:var(--gold)}
.proprec strong{color:#dbe4e2;text-transform:capitalize}
.newbtn{text-align:center;font-family:var(--disp);font-weight:800;font-size:15px;color:#06090b;background:var(--gold);border-radius:11px;padding:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}
.sub2{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.6px;color:var(--mut2);margin:14px 0 0}
.play{border:1px solid var(--line);border-radius:12px;background:#0d141b;padding:11px;margin-top:9px}
.play.pending{border-color:rgba(243,185,79,.22)}
.play .ph{display:flex;align-items:center;gap:8px}
.play .ppick{font-family:var(--disp);font-weight:800;font-size:17px;color:#fff}.play .ppick .u{font-family:var(--mono);font-size:11px;color:var(--gold);font-weight:600;margin-left:6px}
.play .pst{margin-left:auto;font-family:var(--mono);font-size:9px;font-weight:700;border-radius:5px;padding:3px 8px;flex:0 0 auto}
.pst.pending{color:var(--gold);background:rgba(243,185,79,.12)}.pst.won{color:var(--green);background:rgba(51,233,145,.14)}.pst.lost{color:var(--neg);background:rgba(255,93,77,.14)}.pst.push,.pst.void{color:var(--mut);background:#1a242e}
.play .pmu{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:3px}
.play .pwrite{font-size:11.5px;color:#aeb9c8;margin-top:8px;line-height:1.45}
.play .grade{display:flex;gap:7px;margin-top:10px}
.play .grade b{flex:1;text-align:center;font-family:var(--disp);font-weight:700;font-size:12px;border-radius:8px;padding:8px;cursor:pointer;border:1px solid var(--line2);color:var(--mut)}
.play .grade b.w{color:var(--green);border-color:rgba(51,233,145,.3)}.play .grade b.l{color:var(--neg);border-color:rgba(255,93,77,.3)}
.play .ed{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--blue);cursor:pointer}
.lrow{display:flex;align-items:center;gap:11px;padding:12px 0;border-top:1px solid rgba(255,255,255,.05);cursor:pointer}.lrow:first-of-type{border-top:none}
.lrow .li{width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:#0e1620;display:flex;align-items:center;justify-content:center;color:var(--gold);flex:0 0 auto;font-size:14px}
.lrow .lt{flex:1;font-weight:600;font-size:14px;color:#dbe4e2}.lrow .lt .ls{font-family:var(--mono);font-size:9px;color:var(--mut2);font-weight:400;margin-top:1px}.lrow .lc{color:var(--mut2);font-size:16px}.lrow .lv{font-family:var(--mono);font-size:12px;color:#cdd7e1;font-weight:600}
.mini{display:flex;gap:9px;margin-bottom:4px}
.mini .m{flex:1;border:1px solid var(--line);border-radius:11px;background:#0d141b;padding:11px;text-align:center}
.mini .m .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}.mini .m .v{font-family:var(--disp);font-weight:800;font-size:21px;color:#fff;margin-top:3px}.mini .m .v.g{color:var(--green)}
.placeholder{font-family:var(--mono);font-size:9px;color:var(--mut2);text-align:center;margin-top:8px}
.signout{margin:14px 14px 0;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;border:1px solid var(--line2);border-radius:12px;padding:13px;cursor:pointer}
.ver{text-align:center;font-family:var(--mono);font-size:9px;color:var(--mut2);margin:16px 0 0}
/* WZ-ADMIN-PERF-BTN-2026-07-10 */
.perfbtn{margin:13px 14px 0;display:flex;align-items:center;gap:11px;border:1px solid rgba(243,185,79,.35);border-radius:13px;background:linear-gradient(180deg,rgba(243,185,79,.07),rgba(243,185,79,.01));padding:13px 14px;cursor:pointer}
.perfbtn .pli{width:30px;height:30px;border-radius:8px;border:1px solid rgba(243,185,79,.4);background:#0e1620;display:flex;align-items:center;justify-content:center;color:var(--gold);flex:0 0 auto;font-size:14px}
.perfbtn .plt{flex:1}
.perfbtn .plt b{display:block;font-family:var(--disp);font-weight:800;font-size:16px;color:#fff;letter-spacing:.3px}
.perfbtn .plt span{font-family:var(--mono);font-size:9.5px;color:var(--mut)}
.perfbtn .plc{color:var(--mut2);font-size:16px}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}.nav a .dbars rect{fill:var(--mut2)}
/* new-play sheet */
.sheet{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:460px;z-index:200;background:var(--bg);overflow-y:auto;transform:translate(-50%,100%);transition:transform .28s cubic-bezier(.4,0,.2,1);visibility:hidden}
.sheet.open{transform:translate(-50%,0);visibility:visible}
.shead{position:sticky;top:0;background:#080c11;border-bottom:1px solid var(--line);padding:12px 14px;display:flex;align-items:center;gap:11px;z-index:2}
.shead .x{width:32px;height:32px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:#cdd7e1;font-size:19px;cursor:pointer;flex:0 0 auto}
.shead .t{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff}
.sbody{padding:14px 14px 90px}
.fld{margin-top:13px}.fld label{font-family:var(--mono);font-size:10px;color:var(--mut);font-weight:600;display:block;margin-bottom:6px;letter-spacing:.3px}
.fld input,.fld textarea,.fld select{width:100%;background:#0e1620;border:1px solid var(--line2);border-radius:9px;padding:12px;color:#fff;font-family:var(--ui);font-size:14px}
.fld textarea{min-height:74px;resize:vertical;font-size:13px;line-height:1.4}
.fld input::placeholder,.fld textarea::placeholder{color:var(--mut2)}
.fld input:disabled,.fld select:disabled{opacity:.75;color:#bac4cc}
.oddsnote{font-family:var(--mono);font-size:9px;border-radius:8px;padding:8px 10px;margin:3px 0 8px}
.oddsnote.verified{color:var(--green);border:1px solid rgba(51,233,145,.28);background:rgba(51,233,145,.07)}
.oddsnote.manual{color:var(--gold);border:1px solid rgba(243,185,79,.28);background:rgba(243,185,79,.07)}
.row2{display:flex;gap:9px}.row2 .fld{flex:1}
.segf{display:flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}.segf b{flex:1;text-align:center;font-family:var(--disp);font-weight:700;font-size:13px;color:var(--mut);padding:10px;cursor:pointer}.segf b.on{background:#141d24;color:#fff}
.pubbtn{margin-top:16px;text-align:center;font-family:var(--disp);font-weight:800;font-size:15px;color:#06090b;background:var(--gold);border-radius:11px;padding:14px;cursor:pointer}
.draftbtn{margin-top:9px;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;border:1px solid var(--line2);border-radius:11px;padding:12px;cursor:pointer}
`;
