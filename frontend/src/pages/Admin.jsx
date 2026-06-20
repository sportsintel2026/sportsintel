import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase, edgesApi } from "../lib/api";

const API_BASE = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
const ADMIN_EMAIL = "r7002g@gmail.com";
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const fmtOdds = (o) => { const n = Number(o); if(!n||isNaN(n)) return String(o||""); return n>0?"+"+n:""+n; };
const unitProfit = (o) => { const n = Number(o); if(!n||isNaN(n)) return 1; return n>0 ? n/100 : 100/Math.abs(n); };
const resState = (r) => { const s = String(r==null?"":r).trim().toLowerCase(); if(s===""||s==="pending") return "pending"; if(s==="won"||s==="win") return "won"; if(s==="lost"||s==="loss") return "lost"; return "push"; };

export default function AdminPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const [today] = useState(todayISO());
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState({ w:0, l:0, p:0, u:0 });
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
      const { data } = await supabase.from("expert_picks").select("picks");
      let w=0,l=0,p=0,u=0;
      for (const row of (data||[])) {
        let arr=[]; try { arr = JSON.parse(row.picks||"[]"); } catch(_) {}
        for (const pk of arr) {
          const st = resState(pk.result); if (st==="pending") continue;
          if (st==="won") { w++; u += (Number(pk.units)||1)*unitProfit(pk.odds); }
          else if (st==="lost") { l++; u -= (Number(pk.units)||1); }
          else p++;
        }
      }
      setRec({ w, l, p, u: Math.round(u*10)/10 });
    } catch(_) {}
  };
  useEffect(() => { if(isAdmin){ loadToday(); loadRecord(); } }, [isAdmin]);

  // Games come from the EDGES board so each one carries its live odds (moneyline /
  // total / run-line). Selecting a game + market + selection then auto-fills the price.
  useEffect(() => {
    let cancelled = false;
    const p = sport==="nba" ? edgesApi.getNBA() : edgesApi.getMLB();
    p.then(d => {
      if (cancelled) return;
      const arr = Array.isArray(d) ? d : (d?.games || []);
      const list = arr.map(g => ({
        gameId: g.id || g.gameId || g.gamePk,
        awayAbbr: g.awayAbbr || g.away || "?",
        homeAbbr: g.homeAbbr || g.home || "?",
        label: `${g.awayAbbr||g.away||"?"} @ ${g.homeAbbr||g.home||"?"}${g.time?" · "+g.time:""}`,
        moneyline: g.moneyline || null,
        totals: g.totals || null,
        runLine: g.runLine || null,
        spread: g.spread || null,
      }));
      setGames(list); setGameIdx(-1); setSelection("");
    }).catch(()=>setGames([]));
    return () => { cancelled = true; };
  }, [sport, sheetOpen]);

  // Auto-fill ODDS (and LINE) from the selected game's live edges data.
  const numOr = (v) => (v==null||v===""||isNaN(Number(v))) ? null : Number(v);
  const autoOdds = (g, mkt, sel) => {
    if (!g) return { odds: null, line: null };
    if (mkt==="moneyline") { const ml=g.moneyline||{}; return { odds: sel==="home"?ml.home:ml.away, line: null }; }
    if (mkt==="total")     { const t=g.totals||{};     return { odds: sel==="under"?t.underOdds:t.overOdds, line: t.line ?? null }; }
    if (mkt==="run_line")  {
      const rl=g.runLine||{}, ml=g.moneyline||{};
      const hm=numOr(ml.home), aw=numOr(ml.away);
      const homeFav = (hm!=null && aw!=null) ? hm < aw : null;          // more-negative ML = favorite
      const sideFav = sel==="home" ? homeFav : (homeFav===null ? null : !homeFav);
      const mag = (rl.line!=null && !isNaN(Number(rl.line))) ? Math.abs(Number(rl.line)) : 1.5;
      const ln = sideFav===null ? (sel==="home"?-mag:mag) : (sideFav ? -mag : mag);
      return { odds: sel==="home"?rl.homeOdds:rl.awayOdds, line: ln };
    }
    if (mkt==="spread")    {
      const sp=g.spread||{};
      const mag = (sp.line!=null && !isNaN(Number(sp.line))) ? Math.abs(Number(sp.line)) : null;
      return { odds: sel==="home"?sp.homeOdds:sp.awayOdds, line: mag==null?null:(sel==="home"?-mag:mag) };
    }
    return { odds: null, line: null };
  };
  useEffect(() => {
    const g = games[gameIdx];
    if (!g || !selection) return;
    const { odds: od, line: ln } = autoOdds(g, market, selection);
    if (od!=null && od!=="") setOdds(String(od));
    if (ln!=null) setLine(String(ln));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIdx, market, selection]);

  const save = async (next) => {
    setSaving(true);
    try { await supabase.from("expert_picks").upsert({ date: today, picks: JSON.stringify(next) }, { onConflict: "date" }); setPicks(next); }
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
    const g = games[gameIdx] || {};
    if (!selection) { alert("Pick a selection (side / over-under)."); return; }
    if ((market==="total"||market==="run_line"||market==="spread") && line==="") { alert("Enter the line."); return; }
    const pick = {
      type: "straight", sport, gameId: g.gameId || "", game: g.label || "", awayAbbr: g.awayAbbr || "", homeAbbr: g.homeAbbr || "",
      market, selection, line: line===""?null:Number(line),
      pick: buildPickText(g), odds: odds || "-110", units: Number(units)||1,
      conviction: conv, write: write.trim(), result: "",
    };
    await save([pick, ...picks]);
    setSheetOpen(false);
    setSelection(""); setLine(""); setOdds(""); setUnits(""); setWrite(""); setGameIdx(-1);
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
  const needsLine = market==="total" || market==="run_line" || market==="spread";

  const runGrading = async () => {
    try { const r = await fetch(`${API_BASE}/api/expert-grade?write=1`); const j = await r.json(); alert("Grading run.\n" + JSON.stringify(j).slice(0,300)); loadToday(); loadRecord(); }
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
        <div className="pmu">{p.game}{p.conviction?` · ${p.conviction} conviction`:""}</div>
        {p.write ? <div className="pwrite">{p.write}</div> : null}
        {isActive && <div className="grade"><b className="w" onClick={()=>gradePick(i,"won")}>Mark Won</b><b className="l" onClick={()=>gradePick(i,"lost")}>Mark Lost</b><b onClick={()=>gradePick(i,"push")}>Void</b></div>}
      </div>
    );
  };

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd"><div className="hrow"><div className="logo"><span className="w">Wize</span>Picks</div><div className="htitle">ADMIN</div></div></div>

      <div className="blk"><div className="prof"><div className="av">MG</div><div><div className="pn">Master G</div><div className="pe">owner · wizepicks.com</div><div className="pp">{"\u25cf"} OWNER · ALL-ACCESS</div></div></div></div>

      <div className="blk"><div className="bl">WIZEPLAYS STUDIO <span className="bx">straight bets · auto-graded hourly</span></div>
        <div className="wprec">
          <div className="r"><div className="k">RECORD</div><div className="v">{rec.w}-{rec.l}-{rec.p}</div></div>
          <div className="r"><div className="k">UNITS</div><div className={"v "+(rec.u>=0?"g":"")}>{rec.u>=0?"+":""}{rec.u}u</div></div>
          <div className="r"><div className="k">WIN %</div><div className="v gold">{winPct}%</div></div>
        </div>
        <div className="newbtn" onClick={()=>setSheetOpen(true)}><span style={{fontSize:18}}>+</span> New WizePlay</div>
        <div className="sub2">ACTIVE PLAYS</div>
        {loading ? <div className="placeholder">Loading…</div> : active.length ? active.map(o=><Play key={o.i} p={o.p} i={o.i} isActive/>) : <div className="placeholder">No active plays today. Add one above.</div>}
        <div className="sub2">RECENTLY SETTLED</div>
        {settled.length ? settled.slice(0,8).map(o=><Play key={o.i} p={o.p} i={o.i}/>) : <div className="placeholder">Nothing settled yet today.</div>}
      </div>

      <div className="blk"><div className="bl">SUBSCRIBERS <span className="bx">Stripe stats not wired yet</span></div>
        <div className="mini"><div className="m"><div className="k">ACTIVE</div><div className="v">—</div></div><div className="m"><div className="k">MRR</div><div className="v">—</div></div><div className="m"><div className="k">NEW / WK</div><div className="v">—</div></div></div>
        <div className="placeholder">Subscriber &amp; revenue figures need a Stripe admin-stats endpoint — not wired yet. Manage subscribers directly in the Stripe dashboard for now.</div>
      </div>

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
            <div className="fld"><label>SPORT</label><div className="segf">{[["mlb","MLB"],["nba","NBA"]].map(([k,l])=><b key={k} className={sport===k?"on":""} onClick={()=>setSport(k)}>{l}</b>)}</div></div>
            <div className="fld"><label>GAME (auto-grades when linked)</label>
              <select value={gameIdx} onChange={e=>{setGameIdx(Number(e.target.value)); setSelection("");}}>
                <option value={-1}>{games.length ? "Select a game…" : "No games loaded"}</option>
                {games.map((g,i)=><option key={i} value={i}>{g.label}</option>)}
              </select>
            </div>
            <div className="row2">
              <div className="fld"><label>MARKET</label><select value={market} onChange={e=>{setMarket(e.target.value); setSelection(""); setLine("");}}>
                <option value="moneyline">Moneyline</option><option value="total">Total</option><option value="run_line">Run Line</option><option value="spread">Spread</option>
              </select></div>
              <div className="fld"><label>SELECTION</label><select value={selection} onChange={e=>setSelection(e.target.value)}>
                <option value="">—</option>
                {marketSels.map(([v,lbl])=><option key={v} value={v}>{v==="away"?(games[gameIdx]?.awayAbbr||"Away"):v==="home"?(games[gameIdx]?.homeAbbr||"Home"):lbl}</option>)}
              </select></div>
            </div>
            <div className="row2">
              {needsLine ? <div className="fld"><label>LINE</label><input value={line} onChange={e=>setLine(e.target.value)} placeholder="8.5 / -1.5" inputMode="decimal"/></div>
                : <div className="fld"><label>LINE</label><input value="" placeholder="—" disabled/></div>}
              <div className="fld"><label>ODDS</label><input value={odds} onChange={e=>setOdds(e.target.value)} placeholder="-130"/></div>
            </div>
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
.newbtn{text-align:center;font-family:var(--disp);font-weight:800;font-size:15px;color:#06090b;background:var(--gold);border-radius:11px;padding:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}
.sub2{font-family:var(--disp);font-weight:800;font-size:11px;letter-spacing:.6px;color:var(--mut2);margin:14px 0 0}
.play{border:1px solid var(--line);border-radius:12px;background:#0d141b;padding:11px;margin-top:9px}
.play.pending{border-color:rgba(243,185,79,.22)}
.play .ph{display:flex;align-items:center;gap:8px}
.play .ppick{font-family:var(--disp);font-weight:800;font-size:17px;color:#fff}.play .ppick .u{font-family:var(--mono);font-size:11px;color:var(--gold);font-weight:600;margin-left:6px}
.play .pst{margin-left:auto;font-family:var(--mono);font-size:9px;font-weight:700;border-radius:5px;padding:3px 8px;flex:0 0 auto}
.pst.pending{color:var(--gold);background:rgba(243,185,79,.12)}.pst.won{color:var(--green);background:rgba(51,233,145,.14)}.pst.lost{color:var(--neg);background:rgba(255,93,77,.14)}.pst.push{color:var(--mut);background:#1a242e}
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
.row2{display:flex;gap:9px}.row2 .fld{flex:1}
.segf{display:flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden}.segf b{flex:1;text-align:center;font-family:var(--disp);font-weight:700;font-size:13px;color:var(--mut);padding:10px;cursor:pointer}.segf b.on{background:#141d24;color:#fff}
.pubbtn{margin-top:16px;text-align:center;font-family:var(--disp);font-weight:800;font-size:15px;color:#06090b;background:var(--gold);border-radius:11px;padding:14px;cursor:pointer}
.draftbtn{margin-top:9px;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;border:1px solid var(--line2);border-radius:11px;padding:12px;cursor:pointer}
`;
