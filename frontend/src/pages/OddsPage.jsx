import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { oddsApi, edgesApi, subscriptionApi } from "../lib/api";

const TEAMCOL = {
  ARI:"#A71930",ATL:"#CE1141",BAL:"#DF4601",BOS:"#BD3039",CHC:"#0E3386",CWS:"#27251F",CHW:"#27251F",
  CIN:"#C6011F",CLE:"#00385D",COL:"#33006F",DET:"#0C2340",HOU:"#EB6E1F",KC:"#004687",LAA:"#BA0021",
  LAD:"#005A9C",MIA:"#00A3E0",MIL:"#FFC52F",MIN:"#002B5C",NYM:"#FF5910",NYY:"#0C2340",OAK:"#003831",
  ATH:"#003831",PHI:"#E81828",PIT:"#FDB827",SD:"#2F241D",SF:"#FD5A1E",SEA:"#0C2C56",STL:"#C41E3A",
  TB:"#092C5C",TEX:"#003278",TOR:"#134A8E",WSH:"#AB0003",WAS:"#AB0003"
};
const NAME2ABBR = {
  arizonadiamondbacks:"ARI",atlantabraves:"ATL",baltimoreorioles:"BAL",bostonredsox:"BOS",chicagocubs:"CHC",
  chicagowhitesox:"CWS",cincinnatireds:"CIN",clevelandguardians:"CLE",coloradorockies:"COL",detroittigers:"DET",
  houstonastros:"HOU",kansascityroyals:"KC",losangelesangels:"LAA",losangelesdodgers:"LAD",miamimarlins:"MIA",
  milwaukeebrewers:"MIL",minnesotatwins:"MIN",newyorkmets:"NYM",newyorkyankees:"NYY",oaklandathletics:"OAK",
  athletics:"ATH",philadelphiaphillies:"PHI",pittsburghpirates:"PIT",sandiegopadres:"SD",sanfranciscogiants:"SF",
  seattlemariners:"SEA",stlouiscardinals:"STL",tampabayrays:"TB",texasrangers:"TEX",torontobluejays:"TOR",washingtonnationals:"WSH"
};
// NFL team → abbr + on-dark-visible color (football board reuses the MLB grid UI
// but needs its own name map; MLB's slice-3 fallback collides — "New England" and
// "New York" both → "NEW"). Keys are normName(full name).
const NFL_ABBR = {
  arizonacardinals:"ARI",atlantafalcons:"ATL",baltimoreravens:"BAL",buffalobills:"BUF",
  carolinapanthers:"CAR",chicagobears:"CHI",cincinnatibengals:"CIN",clevelandbrowns:"CLE",
  dallascowboys:"DAL",denverbroncos:"DEN",detroitlions:"DET",greenbaypackers:"GB",
  houstontexans:"HOU",indianapoliscolts:"IND",jacksonvillejaguars:"JAX",kansascitychiefs:"KC",
  lasvegasraiders:"LV",losangeleschargers:"LAC",losangelesrams:"LAR",miamidolphins:"MIA",
  minnesotavikings:"MIN",newenglandpatriots:"NE",neworleanssaints:"NO",newyorkgiants:"NYG",
  newyorkjets:"NYJ",philadelphiaeagles:"PHI",pittsburghsteelers:"PIT",sanfrancisco49ers:"SF",
  seattleseahawks:"SEA",tampabaybuccaneers:"TB",tennesseetitans:"TEN",washingtoncommanders:"WAS"
};
const NFL_COL = {
  ARI:"#E64A6B",ATL:"#E0203D",BAL:"#7B5FE0",BUF:"#1D8FE0",CAR:"#0FA0DC",CHI:"#E8642A",CIN:"#FB4F14",
  CLE:"#FF5A1F",DAL:"#4F8FE0",DEN:"#FB6A2A",DET:"#2AA3E0",GB:"#3FA86A",HOU:"#D43B52",IND:"#3A6FD0",
  JAX:"#1FA0B0",KC:"#F23847",LV:"#B9C0C4",LAC:"#22A6E0",LAR:"#4F7DE0",MIA:"#19C4CC",MIN:"#7B4FD0",
  NE:"#E0344F",NO:"#D3BC8D",NYG:"#3A5BD0",NYJ:"#2E9A6A",PHI:"#1F8A7A",PIT:"#FFB612",SF:"#E0342A",
  SEA:"#69BE28",TB:"#F23A2A",TEN:"#4B92DB",WAS:"#FFB612"
};
const normName = (s) => String(s||"").toLowerCase().replace(/[^a-z]/g,"");
const shortTeam = (t) => { const m = String(t||"").match(/[A-Z]{2,3}/); return m ? m[0] : String(t||"").slice(0,3).toUpperCase(); };
const abbrOf = (name) => NAME2ABBR[normName(name)] || shortTeam(name) || String(name||"").slice(0,3).toUpperCase();
const abbrNFL = (name) => NFL_ABBR[normName(name)] || shortTeam(name) || String(name||"").slice(0,3).toUpperCase();
const teamCol = (ab) => TEAMCOL[String(ab||"").toUpperCase()] || "#3a4a57";
const nflCol = (ab) => NFL_COL[String(ab||"").toUpperCase()] || "#3a4a57";
const fmtOdds = (a) => (a==null || isNaN(a)) ? "—" : (Math.round(Number(a))>0 ? "+"+Math.round(Number(a)) : ""+Math.round(Number(a)));
const amCents = (o) => { if(o==null||isNaN(o)) return null; const n=Number(o); return n>=100?n-100:n<=-100?n+100:0; };
const isTotalEdge = (e) => e.side==="over" || e.side==="under";

function Logo({ ab, col }) {
  const c = col || teamCol(ab);
  return <span className="lg" style={{ background:`radial-gradient(circle at 50% 30%, ${c}, #0c1018 85%)`, boxShadow:`inset 0 0 0 1.5px ${c}` }}>{ab}</span>;
}

export default function MarketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const [sport, setSport] = useState("mlb");
  const [odds, setOdds] = useState(null);
  const [edges, setEdges] = useState(null);
  const [oddsHist, setOddsHist] = useState(null);
  const [marketRead, setMarketRead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("odds");
  const [sel, setSel] = useState(null);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);
  useEffect(() => {
    let c = false;
    const load = async () => {
      try {
        if (sport === "nfl") {
          // NFL market data rides inside the edges feed (odds, edges, marketByGame,
          // marketMovers all in one). No separate odds/history/market-read calls.
          const nfl = await edgesApi.getNFL().catch(()=>null);
          if (c) return;
          setOdds(null); setEdges(nfl);
          // Build the Movers + Consensus view shapes from the NFL feed.
          setOddsHist([]);
          // Consensus rows from marketByGame.
          const cons = [];
          if (nfl && nfl.marketByGame) {
            for (const id in nfl.marketByGame) {
              const mb = nfl.marketByGame[id]; const mr = mb && mb.marketRead; if (!mr) continue;
              cons.push({
                gameId: id, matchup: mb.matchup,
                win: mr.win ? { tier: mr.win.tier, favTeam: mr.win.favTeam, consensus: mr.win.consensus, model: null } : null,
                cover: mr.cover ? { tier: "", favTeam: mr.cover.favTeam, line: mr.cover.favLine, agrees: false } : null,
                total: mr.total ? { tier: mr.total.tier, side: mr.total.favSide, line: mr.total.line, odds: mr.total.consensus, agrees: false } : null,
              });
            }
          }
          setMarketRead(cons);
        } else {
          const [o, e, h, m] = await Promise.all([
            oddsApi.getMLB().catch(()=>null),
            edgesApi.getMLB().catch(()=>null),
            edgesApi.getOddsHistory().catch(()=>null),
            edgesApi.getMarketRead().catch(()=>null),
          ]);
          if (c) return;
          setOdds(o); setEdges(e); setOddsHist(h?.games||h||[]); setMarketRead(m?.games||m||[]);
        }
      } catch(_){}
      if (!c) setLoading(false);
    };
    load(); const id = setInterval(load, 90000);
    return () => { c = true; clearInterval(id); };
  }, [sport]);

  const oddsGames = Array.isArray(odds) ? odds : (odds?.games || []);
  const e = edges || {};
  const games = e.games || [];
  const histByKey = {}; (oddsHist||[]).forEach(g=>{ histByKey[normName(g.away_team)+"|"+normName(g.home_team)] = g; });
  const findHist = (gm) => gm ? (histByKey[normName(gm.away)+"|"+normName(gm.home)] || null) : null;
  const seriesFor = (edge) => { const gm = games.find(x=>x.id===edge.gameId); const h = findHist(gm); if(!h) return null; return (isTotalEdge(edge) ? h.total?.[edge.side] : h.ml?.[edge.side]) || null; };
  const moverPool = [...(e.moneylineEdges||[]),...(e.totalsEdges||[]),...(e.spreadEdges||[])].map(x=>{
    const ser = seriesFor(x); const open = (ser&&ser.length)?ser[0].o:null; const now = (ser&&ser.length)?ser[ser.length-1].o:null;
    const delta = (open!=null&&now!=null) ? (amCents(now)-amCents(open)) : null;
    return { ...x, _open:open, _now:now, _delta:delta };
  });
  const movers = (sport === "nfl")
    ? ((e.marketMovers || []).map(m => ({
        matchup: m.matchup, side: m.side, line: m.line,
        teamAbbr: shortTeam((m.matchup||"").split(" @ ")[m.side==="home"?1:0] || ""),
        _open: m.open, _now: m.now, _delta: m.delta,
        isTotal: m.market === "total",
      })))
    : moverPool.filter(m=>m._delta!=null && m._delta!==0).sort((a,b)=>Math.abs(b._delta)-Math.abs(a._delta));
  const moverPick = (x) => (x.isTotal || isTotalEdge(x)) ? `${x.side==="over"?"Over":"Under"} ${x.line??""}`.trim() : `${x.teamAbbr||shortTeam(x.matchup||"")} ML`;
  const moverMatch = (x) => { if(x.matchup) return x.matchup; const g=games.find(gm=>gm.id===x.gameId); return g ? `${g.awayAbbr||shortTeam(g.away)} @ ${g.homeAbbr||shortTeam(g.home)}` : ""; };

  const consensus = marketRead || [];

  // NFL line-shopping grid rides inside the edges feed: each game now carries an
  // oddsGrid (book-by-book ML / total / spread) built server-side. Reshape it into
  // the same card/sheet contract the MLB odds view uses, with football colors + abbrs
  // and a spread block (isFball flag turns on the ATS columns in the grid sheet).
  const nflOddsGames = (sport === "nfl")
    ? (games || [])
        .filter(g => g.oddsGrid && Array.isArray(g.oddsGrid.books) && g.oddsGrid.books.length)
        .map(g => {
          const aAb = abbrNFL(g.awayTeam), hAb = abbrNFL(g.homeTeam);
          return {
            away: g.awayTeam, home: g.homeTeam,
            awayAbbr: aAb, homeAbbr: hAb,
            awayCol: nflCol(aAb), homeCol: nflCol(hAb),
            best: g.oddsGrid.best || {},
            consensusTotalLine: g.oddsGrid.consensusTotalLine,
            consensusSpreadMag: g.oddsGrid.consensusSpreadMag,
            books: g.oddsGrid.books,
            isFball: true,
          };
        })
    : [];
  const oddsList = (sport === "nfl") ? nflOddsGames : oddsGames;

  const VIEWS = [["odds","Odds"],["movers","Movers"],["consensus","Consensus"]];

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd">
        <div className="hrow">
          <div className="logo"><span className="w">Wize</span>Picks</div>
          <span className="opbadge">{"\u25cf"} OPEN</span>
          <div className="sp"/>
          <div className="ibtn" onClick={()=>navigate("/settings")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
        </div>
        <div className="sports">
          {[["MLB","mlb"],["NBA","nba"],["NHL","nhl"],["NFL","nfl"],["CFB","cfb"]].map(([lb,key])=>(
            <b key={key} className={key===sport?"on":""} onClick={()=>{ if(key==="mlb"||key==="nfl"){ if(key!==sport){setSport(key);setLoading(true);setView("movers");} } else if(key==="nba")navigate("/nba"); else navigate(`/${key}-games`); }}><span className="dot"/>{lb}</b>
          ))}
        </div>
        <div className="subnav">{VIEWS.map(v=><b key={v[0]} className={v[0]===view?"on":""} onClick={()=>setView(v[0])}>{v[1]}</b>)}</div>
      </div>

      <div id="wrap">
        {loading ? <div className="estate"><div className="et">Loading market…</div><div className="es">Pulling every book’s lines.</div></div> : <>
          {sport==="nfl" && (
            <div style={{margin:"0 0 10px",padding:"9px 12px",border:"1px solid #6b4a16",background:"linear-gradient(180deg,#1a1305,#0d0a02)",borderRadius:10,fontFamily:"var(--mono)",fontSize:11,lineHeight:1.45,color:"#f3b94f"}}>
              ⚠ NFL preview — market data is live, but the model behind it is uncalibrated (2025 seed). Movement history fills in as books adjust toward the season.
            </div>
          )}

          {view==="odds" && (oddsList.length ? <>
            <div className="cap">Best available price across all books for each game. Tap any game for the full book-by-book grid{sport==="nfl"?" — moneyline, spread and total":""}.</div>
            {oddsList.map((g,i)=><OddsCard key={i} g={g} onOpen={()=>setSel(g)}/>)}
          </> : <div className="estate"><div className="et">{sport==="nfl"?"No NFL lines posted yet":"No games posted"}</div><div className="es">Lines appear as books open.</div></div>)}

          {view==="movers" && (movers.length ? <>
            <div className="cap">Every line move today, ranked by cents. Open to now · updates as books adjust.</div>
            {movers.map((m,r)=><MoverRow key={r} rank={r+1} pick={moverPick(m)} match={moverMatch(m)} open={m._open} now={m._now} cents={m._delta}/>)}
          </> : <div className="estate"><div className="et">No moves yet</div><div className="es">Line moves populate through the day as books adjust.</div></div>)}

          {view==="consensus" && (consensus.length ? <>
            <div className="cap">What the books collectively lean — a read, not a guarantee. The dot shows whether our model agrees with the market.</div>
            {consensus.map((g,i)=><ConsensusCard key={i} g={g} games={games}/>)}
          </> : <div className="estate"><div className="et">No consensus yet</div><div className="es">Cross-book reads appear once lines are live.</div></div>)}
        </>}
      </div>

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate("/props")}><span className="i">{"\u25c8"}</span>Props</a>
        <a className="on"><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a onClick={()=>navigate("/settings")}><span className="i">{"\u25cd"}</span>Account</a>
      </nav>

      {sel && <GridSheet g={sel} onClose={()=>setSel(null)}/>}
    </div>
  );
}

function OddsCard({ g, onOpen }) {
  const aAb = g.awayAbbr || abbrOf(g.away), hAb = g.homeAbbr || abbrOf(g.home);
  const best = g.best || {}; const cl = g.consensusTotalLine;
  const nBooks = (g.books||[]).length;
  return (
    <div className="oc" onClick={onOpen}>
      <div className="och"><div className="lgs"><Logo ab={aAb} col={g.awayCol}/><Logo ab={hAb} col={g.homeCol}/></div><div className="mt">{aAb} @ {hAb}</div><div className="tm2">{nBooks} books</div></div>
      <div className="bestrow">
        <div className="bp"><div className="k">BEST {aAb} ML</div><div className="v"><span className="pr">{fmtOdds(best.awayML?.price)}</span></div><div className="bk">{best.awayML?.book || "—"}</div></div>
        <div className="bp"><div className="k">BEST {hAb} ML</div><div className="v"><span className="pr">{fmtOdds(best.homeML?.price)}</span></div><div className="bk">{best.homeML?.book || "—"}</div></div>
        <div className="bp"><div className="k">BEST O {cl ?? ""}</div><div className="v"><span className="pr">{fmtOdds(best.over?.price)}</span></div><div className="bk">{best.over?.book || "—"}</div></div>
      </div>
    </div>
  );
}

function GridSheet({ g, onClose }) {
  const aAb = g.awayAbbr || abbrOf(g.away), hAb = g.homeAbbr || abbrOf(g.home);
  const best = g.best || {}; const cl = g.consensusTotalLine; const books = g.books || [];
  // Football carries a spread block (best.awaySpread/homeSpread) → show ATS columns.
  const fball = !!(g.isFball || best.awaySpread || best.homeSpread);
  const sMag = g.consensusSpreadMag;
  const cell = (val, isBest) => <td className={isBest ? "best" : ""}>{fmtOdds(val)}</td>;
  // Spread cell: book's own line + price (lines vary by book — that's the shop). Best
  // is highlighted only at the consensus magnitude so it's an apples-to-apples compare.
  const spCell = (line, price, isBest) => (
    <td className={isBest ? "best" : ""}>
      {line==null ? "\u2014" : <>{(line>0?"+":"")+line}<span style={{color:"var(--mut2)",marginLeft:3}}>{fmtOdds(price)}</span></>}
    </td>
  );
  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:60}}/>
      <div className="sheet open" style={{zIndex:61}}>
        <div className="shead"><div className="x" onClick={onClose}>{"\u2039"}</div><div><div className="t">{aAb} @ {hAb}</div><div className="ts">Line shopping · {books.length} books</div></div></div>
        <div className="sbody">
          <div className="gridblk">
            <div className="bl">FULL ODDS — {aAb} @ {hAb}</div>
            <table className="otbl" style={fball ? {minWidth:430} : undefined}>
              <thead><tr>
                <th>Book</th><th>{aAb} ML</th><th>{hAb} ML</th>
                {fball && <th>{aAb} ATS</th>}{fball && <th>{hAb} ATS</th>}
                <th>O {cl ?? ""}</th><th>U {cl ?? ""}</th>
              </tr></thead>
              <tbody>
                {books.map((b,i)=>(
                  <tr key={i} className={/pinnacle/i.test(b.book||"") ? "pinrow" : ""}>
                    <td className="bk">{b.book}</td>
                    {cell(b.awayML, b.awayML!=null && best.awayML && b.awayML===best.awayML.price)}
                    {cell(b.homeML, b.homeML!=null && best.homeML && b.homeML===best.homeML.price)}
                    {fball && spCell(b.awaySpread, b.awaySpreadPrice, b.awaySpread!=null && best.awaySpread && sMag!=null && Math.abs(b.awaySpread)===sMag && b.awaySpreadPrice===best.awaySpread.price)}
                    {fball && spCell(b.homeSpread, b.homeSpreadPrice, b.homeSpread!=null && best.homeSpread && sMag!=null && Math.abs(b.homeSpread)===sMag && b.homeSpreadPrice===best.homeSpread.price)}
                    {cell(b.over, b.over!=null && best.over && b.over===best.over.price)}
                    {cell(b.under, b.under!=null && best.under && b.under===best.under.price)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="legend"><span className="bx">green</span> = best available price{fball ? " (spreads compared at the consensus line)" : " · Pinnacle (gold) = sharp reference"} · {"\u2014"} = book hasn’t posted this market</div>
          </div>
        </div>
      </div>
    </>
  );
}

function MoverRow({ rank, pick, match, open, now, cents }) {
  const dir = cents>=0 ? "up" : "dn";
  return (
    <div className="mvrow">
      <div className="rk">{rank}</div>
      <div className="mp"><div className="mpk">{pick}</div><div className="mmu">{match}</div></div>
      <div><div className={"mo "+dir}>{fmtOdds(open)} <span className="a">{"\u2192"}</span> {fmtOdds(now)}</div><div className={"mc "+dir}>{cents>=0?"+":"\u2212"}{Math.abs(cents)} cents</div></div>
    </div>
  );
}

function ConsensusCard({ g, games }) {
  const aAb = g.awayAbbr || abbrOf(g.away || g.awayTeam || ""), hAb = g.homeAbbr || abbrOf(g.home || g.homeTeam || "");
  const legs = [];
  if (g.win) { const w=g.win; const agrees = w.model ? !!w.model.agrees : !!w.agrees;
    legs.push(["Win", w.favTeam||w.team||w.side||"—", `${fmtOdds(w.consensus??w.odds)}${w.tier?" · "+w.tier:""}`, agrees]); }
  if (g.cover && (g.cover.favTeam||g.cover.side)) { const c=g.cover; const agrees=!!c.agrees;
    legs.push(["Cover", `${c.favTeam||c.side}${c.line!=null?" "+(c.line>0?"+":"")+c.line:""}`, `${fmtOdds(c.odds??c.consensus)}${c.tier?" · "+c.tier:""}`, agrees]); }
  if (g.total && (g.total.lean||g.total.side||g.total.favTeam)) { const t=g.total; const agrees=!!t.agrees;
    const side=String(t.lean||t.side||t.favTeam).toUpperCase();
    legs.push(["Total", `${side}${t.line!=null?" "+t.line:""}`, `${fmtOdds(t.odds??t.consensus)}${t.tier?" · "+t.tier:""}`, agrees]); }
  if (!legs.length) return null;
  return (
    <div className="cc">
      <div className="och"><div className="lgs"><Logo ab={aAb}/><Logo ab={hAb}/></div><div className="mt">{aAb} @ {hAb}</div></div>
      {legs.map((r,i)=>(
        <div className="crow" key={i}>
          <span className={"cd "+(r[3]?"ag":"df")}/>
          <span className="ck">{r[0]}</span>
          <span className="cv"><b>{r[1]}</b> · {r[2]}</span>
          {r[3] ? <span className="ca ag">{"\u2713"} agrees</span> : <span className="ca df">{"\u2260"} differs</span>}
        </div>
      ))}
    </div>
  );
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#06090b;--panel:#0b1117;--line:#16202a;--line2:#1d2a36;--gold:#f3b94f;--green:#33e991;--neg:#ff5d4d;--red:#ff5d4d;--steel:#2674b0;--blue:#5da9e8;--mut:#7d8a98;--mut2:#4a5663;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative;padding-bottom:96px}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0 9px}
.logo{font-family:var(--disp);font-weight:800;font-size:21px;letter-spacing:.4px;color:#fff}.logo .w{color:var(--gold)}
.opbadge{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--green);border:1px solid rgba(51,233,145,.32);background:rgba(51,233,145,.08);border-radius:999px;padding:3px 8px}
.sp{flex:1}.ibtn{width:30px;height:30px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mut)}
.sports{display:flex;gap:6px;padding:0 0 9px;overflow-x:auto;scrollbar-width:none}.sports::-webkit-scrollbar{display:none}
.sports b{flex:0 0 auto;font-family:var(--disp);font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:6px 13px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.sports b.on{color:#fff;border-color:var(--steel);background:#0e1822}
.sports b .dot{width:6px;height:6px;border-radius:50%;background:#2a3640}.sports b.on .dot{background:var(--green)}
.subnav{display:flex;gap:0;border:1px solid var(--line2);border-radius:10px;overflow:hidden;margin:11px 14px 0}
.subnav b{flex:1;text-align:center;font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:.4px;color:var(--mut);padding:9px;cursor:pointer}
.subnav b.on{background:#141d24;color:#fff}
.cap{font-family:var(--mono);font-size:10px;color:var(--mut2);margin:10px 14px 0;line-height:1.4}
/* odds (line shop) card */
.oc{margin:9px 14px 0;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:12px;cursor:pointer;transition:border-color .15s}.oc:active{border-color:var(--steel)}
.oc .och{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.lg{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#0c1018;border:1px solid #000;font-family:var(--disp);font-weight:800;font-size:8px;color:#fff;flex:0 0 auto}.lg img{width:19px;height:19px;object-fit:contain}
.lgs{display:flex}.lgs .lg{margin-left:-5px}.lgs .lg:first-child{margin-left:0}
.oc .mt{font-family:var(--disp);font-weight:800;font-size:16px;color:#fff}.oc .tm2{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-left:auto}
.bestrow{display:flex;gap:7px}
.bp{flex:1;border:1px solid var(--line2);border-radius:9px;background:#0e1620;padding:8px;text-align:center}
.bp .k{font-family:var(--mono);font-size:8px;color:var(--mut2);font-weight:600}
.bp .v{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff;margin-top:3px}.bp .v .pr{color:var(--green)}
.bp .bk{font-family:var(--mono);font-size:8px;color:var(--gold);font-weight:700;margin-top:2px}
/* movers */
.mvrow{display:flex;align-items:center;gap:11px;margin:8px 14px 0;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:11px 13px}
.mvrow .rk{font-family:var(--disp);font-weight:800;font-size:13px;color:var(--mut2);width:18px;flex:0 0 auto}
.mvrow .mp{flex:1;min-width:0}.mvrow .mpk{font-family:var(--disp);font-weight:800;font-size:15px;color:#fff}.mvrow .mmu{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:1px}
.mvrow .mo{font-family:var(--mono);font-size:13px;font-weight:600;text-align:right;flex:0 0 auto}.mo.up{color:var(--green)}.mo.dn{color:var(--neg)}.mo .a{color:var(--mut2)}
.mvrow .mc{font-family:var(--mono);font-size:10px;font-weight:600;margin-top:2px}.mc.up{color:var(--green)}.mc.dn{color:var(--neg)}
/* consensus */
.cc{margin:9px 14px 0;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:12px}
.cc .och{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.crow{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid rgba(255,255,255,.05)}.crow:first-of-type{border-top:none}
.crow .cd{width:8px;height:8px;border-radius:50%;flex:0 0 auto}.cd.strong{background:var(--green)}.cd.soft{background:var(--gold)}.cd.split{background:var(--mut)}
.crow .ck{font-family:var(--disp);font-weight:800;font-size:12px;color:var(--mut);width:50px;flex:0 0 auto}
.crow .cv{font-family:var(--mono);font-size:11px;color:#cdd7e1;flex:1}.crow .cv b{color:#fff}
.crow .ca{font-family:var(--mono);font-size:10px;font-weight:600;flex:0 0 auto}.ca.ag{color:var(--green)}.ca.df{color:var(--gold)}
.seclbl{font-family:var(--disp);font-weight:800;font-size:13px;letter-spacing:1px;color:var(--mut);margin:16px 14px 2px}
.estate{margin:40px 14px;border:1px dashed var(--line2);border-radius:14px;padding:36px 18px;text-align:center}.estate .et{font-family:var(--disp);font-weight:800;font-size:18px;color:#cfd7e2}.estate .es{font-size:12px;color:var(--mut);margin-top:6px;font-family:var(--mono)}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}.nav a .dbars rect{fill:var(--mut2)}
/* sheet: full odds grid */
.sheet{position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:460px;z-index:200;background:var(--bg);overflow-y:auto;transform:translate(-50%,100%);transition:transform .28s cubic-bezier(.4,0,.2,1);visibility:hidden}
.sheet.open{transform:translate(-50%,0);visibility:visible}
.shead{position:sticky;top:0;background:#080c11;border-bottom:1px solid var(--line);padding:12px 14px;display:flex;align-items:center;gap:11px;z-index:2}
.shead .x{width:32px;height:32px;border-radius:9px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:#cdd7e1;font-size:19px;cursor:pointer;flex:0 0 auto}
.shead .t{font-family:var(--disp);font-weight:800;font-size:19px;color:#fff;line-height:1}.shead .ts{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:2px}
.sbody{padding:13px 14px 80px}
.gridblk{border:1px solid var(--line);border-radius:13px;background:linear-gradient(180deg,#0c0c0e,#020203);padding:11px;margin-top:11px;overflow-x:auto}
.gridblk .bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.6px;color:var(--mut);margin-bottom:9px}
.otbl{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:11px;min-width:330px}
.otbl th{color:var(--mut2);font-weight:500;font-size:8.5px;padding:5px 4px;text-align:center;border-bottom:1px solid var(--line)}.otbl th:first-child{text-align:left}
.otbl td{padding:7px 4px;text-align:center;color:#cdd7e1;border-bottom:1px solid rgba(255,255,255,.04)}
.otbl td.bk{text-align:left;font-family:var(--ui);font-weight:600;color:#eaf1ee;font-size:11px}
.otbl td.best{color:var(--green);font-weight:700;background:rgba(51,233,145,.08);border-radius:5px}
.otbl tr.pinrow td{color:var(--gold)}
.legend{font-family:var(--mono);font-size:9px;color:var(--mut2);margin-top:9px}.legend .bx{color:var(--green)}
`;
