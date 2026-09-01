import { useMemo, useState } from "react";
import EventDateSelector, { EVENT_DATE_CSS } from "./EventDateSelector";
import FootballIntel, { FOOTBALL_INTEL_CSS } from "./FootballIntel";
import TeamLogo, { displayTeamName, TEAM_LOGO_CSS } from "./TeamLogo";
import { sportStartLabel } from "../lib/eventSlate";

const fmtPct = (value) => value == null ? "—" : `${Number(value).toFixed(1)}%`;
const fmtEdge = (value) => value == null ? "—" : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;

function matchupParts(item) {
  const parts = String(item?.g || "").split(/\s+@\s+|\s+vs\.?\s+/i);
  return [parts[0] || item?.a?.[0] || "Away", parts[1] || item?.h?.[0] || "Home"];
}

function TeamMark({ team, tuple, sport }) {
  const abbr = tuple?.[0] || String(team || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 3);
  return <TeamLogo sport={sport} team={team} abbr={abbr} color={tuple?.[1] || "#55606b"} className="aeb-teammark" />;
}

function Matchup({ item, sport, compact = false }) {
  const [rawAway, rawHome] = matchupParts(item);
  const away = displayTeamName({ sport, team: rawAway, abbr: item.a?.[0] });
  const home = displayTeamName({ sport, team: rawHome, abbr: item.h?.[0] });
  return <div className={`aeb-matchup${compact ? " aeb-matchup--compact" : ""}`}>
    <div><TeamMark team={away} tuple={item.a} sport={sport} /><b>{away}</b></div>
    <span>AT</span>
    <div><TeamMark team={home} tuple={item.h} sport={sport} /><b>{home}</b></div>
  </div>;
}

function pickText(item, sport) {
  const raw = String(item?.p || "Qualified edge");
  const [rawAway, rawHome] = matchupParts(item);
  for (const [team, tuple] of [[rawAway, item?.a], [rawHome, item?.h]]) {
    const abbr = String(tuple?.[0] || "");
    if (abbr && raw.toUpperCase().startsWith(`${abbr.toUpperCase()} `)) {
      return `${displayTeamName({ sport, team, abbr })}${raw.slice(abbr.length)}`;
    }
  }
  return raw;
}

function LockCard({ title, navigate }) {
  return <div className="aeb-lock"><span>ALL-ACCESS</span><h2>{title}</h2><p>Unlock the complete model board, verified market context, and every qualified edge.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>;
}

function PickRow({ item, rank, navigate, sport }) {
  const canOpen = ["mlb", "nfl", "cfb", "nba"].includes(sport) && item.gameId;
  return (
    <article className="aeb-row" onClick={() => canOpen && navigate(`/game/${sport}/${item.gameId}`)}>
      <div className="aeb-rank">{String(rank).padStart(2, "0")}</div>
      <div className="aeb-rowteams">
        <Matchup item={item} sport={sport} compact />
        <small>{item.starts || "Start pending"} · {sportStartLabel(sport)}</small>
      </div>
      <div className="aeb-rowpick">
        <span>{item.mk || "EDGE"}</span>
        <h3>{pickText(item, sport)}</h3>
        <b>{item.odds || "—"}{item.book ? ` · ${item.book}` : ""}</b>
      </div>
      <div className="aeb-rownums"><span>MODEL</span><b>{fmtPct(item.model)}</b><i /><span>MARKET</span><b>{fmtPct(item.mkt)}</b><strong>›</strong></div>
    </article>
  );
}

function WizePlays({ rows, record, hasFull, planLoaded, navigate, sport }) {
  const settled = (record?.wins || 0) + (record?.losses || 0);
  const hitRate = settled ? Math.round(((record?.wins || 0) / settled) * 100) : null;
  return (
    <section className="aeb-wize">
      <header><div><span>CURATED · HAND REVIEWED</span><h2>WizePlays</h2></div><button onClick={() => navigate("/expert-picks")}>VIEW ALL ›</button></header>
      {!planLoaded ? <p className="aeb-quiet">Checking access…</p>
        : !hasFull ? <div className="aeb-wizelock"><p>Hand-reviewed plays are included with All-Access.</p><button onClick={() => navigate("/pricing")}>Unlock</button></div>
        : <><div className="aeb-wizemetrics"><div><b>{rows?.length || 0}</b><span>ACTIVE TODAY</span></div><div><b>{hitRate == null ? "—" : `${hitRate}%`}</b><span>HISTORICAL HIT RATE</span></div><div><b>{record?.units == null ? "—" : `${record.units >= 0 ? "+" : ""}${record.units.toFixed(1)}u`}</b><span>TRACKED UNITS</span></div></div>{rows?.length ? rows.map((pick, index) => <button className="aeb-wizerow" key={`${pick.pick}-${index}`} onClick={() => navigate("/expert-picks")}><span>{pick.pick}</span><small>{pick.game || sport.toUpperCase()}</small><b>{pick.result ? String(pick.result).toUpperCase() : pick.odds || "VIEW"}</b></button>) : <p className="aeb-quiet">No active WizePlays right now. Curated plays post before {sportStartLabel(sport)}.</p>}</>}
    </section>
  );
}

export default function ApprovedEdgeBoard({
  sport, dateGroups, eventDate, setEventDate, eventDateLabel, games = [], ratedGameCount = 0,
  items = [], previewItems = [], itemsByMarket = {}, previewItemsByMarket = {}, hasFull, planLoaded, markets = [], wpToday = [], wpRecord,
  footballIntel = [], movers = [], navigate,
}) {
  const [market, setMarket] = useState("ALL");
  const mainItems = useMemo(() => {
    const current = market === "ALL" ? items : (itemsByMarket[market] || []);
    const upcoming = market === "ALL" ? previewItems : (previewItemsByMarket[market] || []);
    return current.length ? current : upcoming;
  }, [items, itemsByMarket, market, previewItems, previewItemsByMarket]);
  const hero = mainItems[0] || null;
  const rest = mainItems.slice(1);
  const isFootball = sport === "nfl" || sport === "cfb";
  const sportName = sport.toUpperCase();

  return (
    <main className="aeb-page">
      <style>{CSS + EVENT_DATE_CSS + FOOTBALL_INTEL_CSS + TEAM_LOGO_CSS}</style>
      <div className="aeb-wrap">
        <EventDateSelector groups={dateGroups} value={eventDate} onChange={setEventDate} label="EVENT DATE" />

        <section className="aeb-slate">
          <span>{sportName} · {isFootball ? "GAME DAY" : "MODEL BOARD"}</span>
          <h1>{eventDateLabel || "Upcoming slate"}</h1>
          <p>{games.length} {games.length === 1 ? "game" : "games"}{isFootball ? ` · ${ratedGameCount} rated` : ""} · {mainItems.length} model {mainItems.length === 1 ? "edge" : "edges"}</p>
        </section>

        {!planLoaded ? <div className="aeb-loading">Loading the verified slate…</div>
          : !hasFull ? <LockCard title={`${eventDateLabel || sportName} edges are locked`} navigate={navigate} />
          : hero ? <article className="aeb-feature" onClick={() => hero.gameId && navigate(`/game/${sport}/${hero.gameId}`)}>
              <div className="aeb-featuretop"><span>FEATURED EDGE · {eventDateLabel || eventDate || sportName}</span><small>MODEL EDGE</small></div>
              <div className="aeb-featuregrid">
                <div className="aeb-featurematch"><span className="aeb-badge">MODEL EDGE</span><Matchup item={hero} sport={sport} /><small>{hero.starts || "Start pending"} · {sportStartLabel(sport)}</small></div>
                <div className="aeb-featurepick"><span>PICK</span><h2>{pickText(hero, sport)}</h2><div className="aeb-featureprob"><div><small>MODEL</small><b>{fmtPct(hero.model)}</b></div><div><small>MARKET</small><b>{fmtPct(hero.mkt)}</b></div><div><small>EDGE</small><b>{fmtEdge(hero.edge)}</b></div></div><div className="aeb-price"><span>BOOK ODDS</span><b>{hero.odds || "—"}{hero.book ? ` · ${hero.book}` : ""}</b></div></div>
              </div>
              <div className="aeb-featurewhy"><span>WHY THIS PICK</span><p>{hero.why || "The published model probability and available market price create the strongest verified opportunity on this slate."}</p>{hero.flags?.length ? <div>{hero.flags.slice(0, 3).map((flag, index) => <b key={index}>{flag[1]}</b>)}</div> : null}</div>
            </article>
          : <div className="aeb-empty"><h2>Edges post soon</h2><p>Qualified model plays appear as the event-day market comes online.</p></div>}

        <nav className="aeb-filters" aria-label="Edge market filters">
          {[{ key: "ALL", label: "ALL" }, ...markets.map(([key, label]) => ({ key, label: String(label).toUpperCase() }))].map((entry) => <button key={entry.key} className={market === entry.key ? "on" : ""} onClick={() => setMarket(entry.key)}>{entry.label}</button>)}
        </nav>

        {hasFull && <section className="aeb-list">
          {rest.length ? rest.map((item, index) => <PickRow item={item} rank={index + 2} navigate={navigate} sport={sport} key={`${item.gameId}-${item.mk}-${index}`} />)
            : hero ? <p className="aeb-quiet">No other qualifying {market === "ALL" ? "edges" : market.toLowerCase() + " edges"} on this slate.</p>
              : null}
        </section>}

        <WizePlays rows={wpToday} record={wpRecord} hasFull={hasFull} planLoaded={planLoaded} navigate={navigate} sport={sport} />

        <section className="aeb-intel-preview">
          <header><span>MARKET &amp; INTEL</span><button onClick={() => navigate(`/market-read${sport === "mlb" ? "" : `?sport=${sport}`}`)}>OPEN FULL VIEW →</button></header>
          {isFootball ? <FootballIntel sport={sport} rows={footballIntel} compact />
            : movers.length ? <div className="aeb-movers">{movers.slice(0, 3).map((mover, index) => <div key={index}><span>{mover.p || "Market move"}</span><small>{mover.g || ""}</small><b>{mover.mv ? `${mover.mv[0]} → ${mover.mv[1]}` : mover.odds || "—"}</b></div>)}</div>
              : <p className="aeb-quiet">Market movement and verified game context appear here as lines update.</p>}
        </section>
      </div>
    </main>
  );
}

export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Manrope:wght@500;600;700;800&display=swap');
.aeb-page{--gold:#d2ad68;--green:#45d99d;--ink:#090a0c;--panel:#101114;--panel2:#141518;--line:#292923;--muted:#85857d;min-height:100vh;background:radial-gradient(90% 34% at 50% 0,rgba(210,173,104,.045),transparent 66%),var(--ink);color:#f2efe7;font-family:'Manrope',system-ui,sans-serif;padding:0 0 94px;overflow-x:hidden}.aeb-page *{box-sizing:border-box}.aeb-wrap{width:min(100% - 28px,920px);margin:0 auto;padding:18px 0 30px}.aeb-slate{padding:2px 1px 15px;border-bottom:1px solid #21221e}.aeb-slate>span,.aeb-featuretop>span,.aeb-why>span,.aeb-intel-preview>header>span{font:700 8px/1.25 'IBM Plex Mono',monospace;letter-spacing:1.25px;color:var(--gold)}.aeb-slate h1{margin:7px 0 3px;font:600 clamp(25px,5vw,38px)/1.05 Georgia,serif;letter-spacing:-.6px}.aeb-slate p{margin:0;font:600 9px/1.5 'IBM Plex Mono',monospace;color:#797a73}.aeb-feature{margin:14px 0;border:1px solid rgba(210,173,104,.62);border-radius:12px;background:linear-gradient(145deg,rgba(210,173,104,.08),rgba(16,17,20,.98) 55%);padding:15px;cursor:pointer}.aeb-featuretop,.aeb-intel-preview>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.aeb-featuretop>span{min-width:0;overflow-wrap:anywhere}.aeb-featuretop small{flex:0 0 auto;font:600 8px 'IBM Plex Mono',monospace;color:#77776f;text-align:right}.aeb-featurebody{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:18px;margin-top:15px}.aeb-featurebody p{margin:0 0 4px;font:600 10px 'IBM Plex Mono',monospace;color:#85857d;overflow-wrap:anywhere}.aeb-featurebody h2{margin:0;font:800 clamp(24px,6vw,37px)/1 'Manrope',sans-serif;letter-spacing:-1px;overflow-wrap:anywhere}.aeb-price{display:flex;align-items:center;gap:7px;margin-top:9px}.aeb-price b{font:700 10px 'IBM Plex Mono',monospace;color:#a8a69e;overflow-wrap:anywhere}.aeb-edge{text-align:right}.aeb-edge span{display:block;font:700 7px 'IBM Plex Mono',monospace;color:#77776f;letter-spacing:1px}.aeb-edge b{display:block;margin-top:5px;font:800 clamp(27px,7vw,43px)/1 'Manrope',sans-serif;color:var(--green);letter-spacing:-1.5px}.aeb-bars{margin-top:14px;padding-top:12px;border-top:1px solid #282820}.aeb-bars>div:first-child{display:flex;justify-content:space-between;align-items:center;font:700 8px 'IBM Plex Mono',monospace;color:#77776f}.aeb-bars>div:first-child b{font-size:10px;color:#e2ddd3}.aeb-track{position:relative;height:4px!important;margin-top:7px!important;border-radius:99px;background:#292a27}.aeb-track i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:var(--green)}.aeb-track em{position:absolute;top:-3px;width:1px;height:10px;background:#f2efe7}.aeb-bars small{display:block;margin-top:6px;font:600 7px 'IBM Plex Mono',monospace;color:#65665f}.aeb-featuremetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:11px;border-top:1px solid #282820}.aeb-featuremetrics>div{min-width:0;padding:10px 8px 0}.aeb-featuremetrics>div+div{border-left:1px solid #292a24}.aeb-featuremetrics span{display:block;font:700 7px 'IBM Plex Mono',monospace;color:#676860;letter-spacing:.8px}.aeb-featuremetrics b{display:block;margin-top:4px;font:700 9px/1.3 'IBM Plex Mono',monospace;color:#d8d4ca;overflow-wrap:anywhere}.aeb-filters{display:flex;gap:6px;overflow-x:auto;padding:1px 0 13px;scrollbar-width:none}.aeb-filters::-webkit-scrollbar{display:none}.aeb-filters button{appearance:none;flex:0 0 auto;border:1px solid #2a2b26;background:#101114;color:#777871;border-radius:999px;padding:7px 11px;font:700 8px 'IBM Plex Mono',monospace;letter-spacing:.55px;cursor:pointer}.aeb-filters button.on{border-color:var(--gold);background:var(--gold);color:#18150f}.aeb-list{border-top:1px solid #23241f}.aeb-row{display:grid;grid-template-columns:31px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 2px;border-bottom:1px solid #22231f;cursor:pointer}.aeb-rank{font:600 12px Georgia,serif;color:#575851}.aeb-rowmeta{display:flex;align-items:center;gap:8px;min-width:0}.aeb-rowmeta span{flex:0 0 auto;font:700 7px 'IBM Plex Mono',monospace;color:var(--gold);letter-spacing:1px}.aeb-rowmeta small{min-width:0;font:600 7px 'IBM Plex Mono',monospace;color:#666760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aeb-row h3{margin:4px 0 2px;font:800 15px/1.15 'Manrope',sans-serif;overflow-wrap:anywhere}.aeb-row p{margin:0;font:600 8px/1.4 'IBM Plex Mono',monospace;color:#73746d;overflow-wrap:anywhere}.aeb-rowwhy{display:block;margin-top:6px;font:700 6.5px 'IBM Plex Mono',monospace;letter-spacing:.7px;color:#55564f}.aeb-rownums{text-align:right}.aeb-rownums>b{display:block;font:700 13px 'IBM Plex Mono',monospace}.aeb-rownums span{display:block;margin-top:2px;font:600 8px 'IBM Plex Mono',monospace;color:#777871}.aeb-rownums strong{display:block;margin-top:4px;font:700 10px 'IBM Plex Mono',monospace;color:var(--green)}.aeb-why,.aeb-wize,.aeb-intel-preview{margin-top:17px;border:1px solid #282923;border-radius:11px;background:#101114;padding:14px}.aeb-why h2{margin:7px 0 5px;font:800 16px 'Manrope',sans-serif}.aeb-why p{margin:0;font-size:11px;line-height:1.55;color:#92928a}.aeb-why div{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.aeb-why b{border:1px solid #32332d;border-radius:999px;padding:5px 8px;font:700 7px 'IBM Plex Mono',monospace;color:#a5a49c}.aeb-wize{padding:0;overflow:hidden}.aeb-wize header{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #252620}.aeb-wize header span{font:700 7px 'IBM Plex Mono',monospace;color:var(--gold);letter-spacing:1px}.aeb-wize header h2{margin:2px 0 0;font:600 20px Georgia,serif}.aeb-wize header>b{font:700 13px 'IBM Plex Mono',monospace;color:var(--green)}.aeb-wizerow{appearance:none;width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;text-align:left;border:0;border-bottom:1px solid #22231f;background:transparent;color:#ece8df;padding:11px 14px;cursor:pointer}.aeb-wizerow span{font-weight:800;overflow-wrap:anywhere}.aeb-wizerow small{grid-row:2;font:600 8px 'IBM Plex Mono',monospace;color:#72736c}.aeb-wizerow b{grid-column:2;grid-row:1/3;align-self:center;font:700 10px 'IBM Plex Mono',monospace;color:var(--gold)}.aeb-wizelock{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px}.aeb-wizelock p{margin:0;color:#8a8a82;font-size:11px}.aeb-wizelock button,.aeb-lock button{appearance:none;border:0;border-radius:8px;background:var(--gold);color:#18140d;padding:9px 12px;font-weight:800;cursor:pointer}.aeb-intel-preview>header{padding-bottom:11px;border-bottom:1px solid #24251f}.aeb-intel-preview>header button{border:0;background:none;color:#88877f;font:700 7px 'IBM Plex Mono',monospace;cursor:pointer}.aeb-intel-preview .fbintel{margin:12px 0 0;border:0}.aeb-movers>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:10px 0;border-bottom:1px solid #23241f}.aeb-movers span{font-weight:800;font-size:12px}.aeb-movers small{grid-row:2;font:600 8px 'IBM Plex Mono',monospace;color:#6f7069}.aeb-movers b{grid-column:2;grid-row:1/3;align-self:center;font:700 10px 'IBM Plex Mono',monospace;color:var(--green)}.aeb-lock,.aeb-empty,.aeb-loading{margin:14px 0;border:1px solid #2b2c27;border-radius:12px;background:#101114;padding:28px 18px;text-align:center}.aeb-lock>span{font:700 8px 'IBM Plex Mono',monospace;color:var(--gold);letter-spacing:1px}.aeb-lock h2,.aeb-empty h2{margin:7px 0;font:700 22px Georgia,serif}.aeb-lock p,.aeb-empty p{max-width:470px;margin:0 auto 14px;color:#87877f;font-size:11px;line-height:1.55}.aeb-loading,.aeb-quiet{padding:18px;text-align:center;color:#74756e;font:600 9px/1.5 'IBM Plex Mono',monospace}.aeb-wize .aeb-quiet{margin:0}.aeb-intel-preview>.aeb-quiet{padding-bottom:2px}
@media(min-width:768px){.aeb-wrap{padding-top:24px}.aeb-feature{padding:20px}.aeb-list{display:grid;grid-template-columns:1fr 1fr;column-gap:24px}.aeb-row:nth-child(-n+2){border-top:0}.aeb-why,.aeb-wize,.aeb-intel-preview{padding:18px}.aeb-intel-preview{margin-bottom:20px}}
@media(max-width:374px){.aeb-wrap{width:calc(100% - 20px)}.aeb-feature{padding:12px}.aeb-featurebody{gap:9px}.aeb-featurebody h2{font-size:21px}.aeb-edge b{font-size:25px}.aeb-row{grid-template-columns:25px minmax(0,1fr) auto;gap:7px}.aeb-row h3{font-size:13px}.aeb-rownums>b{font-size:11px}.aeb-wizelock{align-items:flex-start;flex-direction:column}}
/* Approved mock parity layer. */
.aeb-wrap{width:min(calc(100% - 28px),860px);padding-top:6px}.aeb-slate{display:block;padding:8px 0 15px}.aeb-slate>span{font-size:9px;letter-spacing:1.55px}.aeb-slate h1{margin:8px 0 3px;font-family:Manrope,system-ui,sans-serif;font-size:22px;font-weight:800;line-height:1.03;letter-spacing:-.45px;text-transform:uppercase}.aeb-slate p{font-size:10px;font-weight:500;letter-spacing:.15px}.aeb-feature{margin:14px 0 18px;padding:0;border-radius:8px;border-color:#b88b31;background:linear-gradient(135deg,#0d1111,#0b0e0f 60%,#11130f);overflow:hidden}.aeb-featuretop{padding:11px 13px 0}.aeb-featuretop>span{font-size:8px;letter-spacing:1.35px}.aeb-featuretop small{font-size:8px}.aeb-featuregrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:0;padding:10px 13px 12px}.aeb-featurematch{min-width:0;padding-right:15px;border-right:1px solid #55564f}.aeb-badge{display:inline-block;margin-bottom:10px;border:1px solid #1f9e55;border-radius:5px;background:rgba(31,158,85,.12);color:#37dc78;padding:5px 8px;font:700 9px 'IBM Plex Mono',monospace;letter-spacing:.55px}.aeb-featurematch>small{display:block;margin-top:12px;color:#9a9b94;font:600 9px 'IBM Plex Mono',monospace}.aeb-matchup{min-width:0}.aeb-matchup>div{display:flex;align-items:center;gap:9px;min-width:0}.aeb-matchup>div b{min-width:0;font:800 15px/1.18 Manrope,sans-serif;overflow-wrap:anywhere}.aeb-matchup>span{display:block;margin:3px 0 3px 39px;color:#6f706a;font:700 7px 'IBM Plex Mono',monospace}.aeb-teammark{--team:#55606b;flex:0 0 auto;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;border:1px solid color-mix(in srgb,var(--team) 72%,white 8%);background:radial-gradient(circle at 35% 28%,color-mix(in srgb,var(--team) 65%,white 8%),#0b0c0e 78%);color:#fff;font:800 7px 'IBM Plex Mono',monospace;box-shadow:inset 0 0 0 2px #0a0c0d}.aeb-featurepick{min-width:0;padding-left:15px}.aeb-featurepick>span,.aeb-price span{display:block;color:#8b8c85;font:600 9px 'IBM Plex Mono',monospace}.aeb-featurepick h2{margin:5px 0 13px;color:#40d87a;font:800 clamp(18px,5vw,27px)/1.08 Manrope,sans-serif;letter-spacing:-.5px;overflow-wrap:anywhere}.aeb-featureprob{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:12px}.aeb-featureprob>div{min-width:0;padding:0 8px}.aeb-featureprob>div:first-child{padding-left:0}.aeb-featureprob>div+div{border-left:1px solid #42433e}.aeb-featureprob small{display:block;color:#7a7b74;font:600 8px 'IBM Plex Mono',monospace}.aeb-featureprob b{display:block;margin-top:4px;font:800 17px Manrope,sans-serif;overflow-wrap:anywhere}.aeb-featureprob>div:last-child b{color:#40d87a}.aeb-price{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:9px;border-top:1px solid #373832}.aeb-price b{margin:0;color:#d8af5d;font-size:12px;text-align:right}.aeb-featurewhy{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 14px;padding:12px 13px;border-top:1px solid rgba(184,139,49,.65);background:rgba(255,255,255,.012)}.aeb-featurewhy>span{color:#d8af5d;font:800 10px 'IBM Plex Mono',monospace;letter-spacing:.6px}.aeb-featurewhy p{margin:0;color:#b1b1aa;font-size:10px;line-height:1.5}.aeb-featurewhy>div{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px}.aeb-featurewhy b{border-left:2px solid #36cf76;padding-left:7px;color:#d2d3cc;font:700 8px 'IBM Plex Mono',monospace}.aeb-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin-bottom:10px;padding:0;border:1px solid #9f7628;border-radius:8px;overflow:hidden}.aeb-filters button{min-width:0;border:0;border-radius:0;background:#0c0f10;padding:10px 4px;color:#a4a5a0;font-size:9px}.aeb-filters button+button{border-left:1px solid #3c3d38}.aeb-filters button.on{background:linear-gradient(180deg,#ebca7d,#d6ab56);color:#17130b}.aeb-list{border:0}.aeb-row{grid-template-columns:23px minmax(0,1.25fr) minmax(92px,.9fr) 66px;gap:9px;min-height:82px;padding:10px 8px;margin-bottom:7px;border:1px solid #2e302e;border-radius:7px;background:linear-gradient(135deg,#101315,#0d1011);cursor:pointer}.aeb-rank{font:700 10px 'IBM Plex Mono',monospace;color:#666862}.aeb-rowteams{min-width:0}.aeb-rowteams .aeb-matchup>div{gap:6px}.aeb-rowteams .aeb-teammark{width:21px;height:21px;font-size:5.5px}.aeb-rowteams .aeb-matchup>div b{font-size:10px}.aeb-rowteams .aeb-matchup>span{margin:1px 0 1px 27px;font-size:6px}.aeb-rowteams>small{display:block;margin-top:5px;color:#777872;font:600 7px 'IBM Plex Mono',monospace}.aeb-rowpick{min-width:0;padding-left:9px;border-left:1px solid #373934}.aeb-rowpick>span{color:#d6ad5e;font:700 7px 'IBM Plex Mono',monospace}.aeb-rowpick h3{margin:4px 0 3px;color:#39d776;font:800 12px/1.15 Manrope,sans-serif;overflow-wrap:anywhere}.aeb-rowpick>b{color:#d6ad5e;font:700 8px 'IBM Plex Mono',monospace;overflow-wrap:anywhere}.aeb-rownums{position:relative;display:grid;grid-template-columns:1fr;align-content:center;text-align:center}.aeb-rownums span{margin:0;color:#777872;font:600 6.5px 'IBM Plex Mono',monospace}.aeb-rownums>b{font:800 12px Manrope,sans-serif}.aeb-rownums i{height:1px;background:#494b47;margin:3px 4px}.aeb-rownums strong{position:absolute;right:-1px;top:50%;transform:translateY(-50%);font:400 24px Manrope,sans-serif;color:#d9dbd6}.aeb-wize,.aeb-intel-preview{margin-top:13px;border-radius:8px}.aeb-wize{border-color:#7542af;background:linear-gradient(135deg,rgba(117,66,175,.08),#0e1012)}.aeb-wize header{padding:12px 14px;border-color:#34303b}.aeb-wize header span{color:#9f63ed;font-size:8px}.aeb-wize header h2{color:#a56af0;font:800 19px Manrope,sans-serif}.aeb-wize header button{border:0;background:none;color:#a56af0;font:800 8px 'IBM Plex Mono',monospace}.aeb-wizemetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:13px 8px}.aeb-wizemetrics>div{text-align:center;min-width:0;padding:0 7px}.aeb-wizemetrics>div+div{border-left:1px solid #39333f}.aeb-wizemetrics b{display:block;color:#a56af0;font:800 19px Manrope,sans-serif}.aeb-wizemetrics span{display:block;margin-top:3px;color:#90918b;font:600 7px/1.35 'IBM Plex Mono',monospace}.aeb-intel-preview{border-color:#3a3b37}.aeb-intel-preview>header>span{font-size:9px}.aeb-intel-preview>header button{color:#d2ad68;font-size:8px}.aeb-empty,.aeb-loading{padding:18px}.aeb-empty h2{font-size:19px}.aeb-empty p{margin-bottom:0}.aeb-quiet{font-size:9px}
@media(min-width:768px){.aeb-page{padding-bottom:110px}.aeb-wrap{padding-top:12px}.aeb-feature{margin-top:17px}.aeb-list{display:block}.aeb-row{grid-template-columns:28px minmax(0,1.35fr) minmax(180px,.9fr) 90px;min-height:98px;padding:12px 15px}.aeb-rowteams .aeb-teammark{width:27px;height:27px;font-size:7px}.aeb-rowteams .aeb-matchup>div b{font-size:14px}.aeb-rowteams .aeb-matchup>span{margin-left:34px}.aeb-rowpick h3{font-size:16px}.aeb-rownums>b{font-size:15px}.aeb-why,.aeb-wize,.aeb-intel-preview{padding:0}.aeb-intel-preview{padding:17px}.aeb-wize{padding:0}}
@media(max-width:374px){.aeb-wrap{width:calc(100% - 20px)}.aeb-featuretop{padding:9px 10px 0}.aeb-featuregrid{grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);padding:9px 10px 10px}.aeb-featurematch{padding-right:8px}.aeb-badge{margin-bottom:7px;padding:4px 5px;font-size:7px}.aeb-featurematch .aeb-teammark{width:23px;height:23px;font-size:5.5px}.aeb-featurematch .aeb-matchup>div{gap:6px}.aeb-featurematch .aeb-matchup>div b{font-size:11px}.aeb-featurematch .aeb-matchup>span{margin-left:29px;font-size:6px}.aeb-featurematch>small{margin-top:8px;font-size:7px}.aeb-featurepick{padding-left:8px}.aeb-featurepick>span,.aeb-price span{font-size:7px}.aeb-featurepick h2{margin-bottom:9px;font-size:15px}.aeb-featureprob>div{padding:0 5px}.aeb-featureprob small{font-size:6px}.aeb-featureprob b{font-size:12px}.aeb-price{padding-top:7px}.aeb-price b{font-size:9px}.aeb-featurewhy{grid-template-columns:auto minmax(0,1fr);gap:6px 8px;padding:9px 10px}.aeb-featurewhy>span{font-size:8px}.aeb-featurewhy p{font-size:8px}.aeb-row{grid-template-columns:20px minmax(0,1.05fr) minmax(82px,.85fr) 54px;gap:6px;padding-left:5px;padding-right:5px}.aeb-rowteams .aeb-matchup>div b{font-size:9px}.aeb-rowpick{padding-left:6px}.aeb-rowpick h3{font-size:10.5px}.aeb-rownums>b{font-size:10px}.aeb-wizemetrics span{font-size:6px}}
/* Final approved team-identity detail layer. */
.aeb-matchup>div{gap:10px}.aeb-matchup>div b{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;line-height:1.02;letter-spacing:.12px;word-break:normal;overflow-wrap:break-word}.aeb-matchup>span{margin:3px 0 3px 46px;color:#797a73;letter-spacing:.55px}.aeb-teammark{width:37px;height:37px}.aeb-featurepick h2{font-family:'Barlow Condensed',sans-serif;font-size:clamp(22px,5.6vw,30px);line-height:1;letter-spacing:.12px}.aeb-featureprob{align-items:start}.aeb-featureprob b{font-family:'Barlow Condensed',sans-serif;font-size:18px;line-height:1;letter-spacing:.15px;white-space:nowrap}.aeb-row{grid-template-columns:23px minmax(0,1.32fr) minmax(92px,.9fr) 66px;min-height:88px}.aeb-rowteams .aeb-matchup>div{gap:7px}.aeb-rowteams .aeb-teammark{width:26px;height:26px}.aeb-rowteams .aeb-matchup>div b{font-size:13px;line-height:1}.aeb-rowteams .aeb-matchup>span{margin:2px 0 2px 33px}.aeb-rowteams>small{margin-top:6px}.aeb-rowpick>span{display:inline-block;border:1px solid rgba(210,173,104,.52);border-radius:4px;padding:2px 4px;font-size:6.5px}.aeb-rowpick h3{margin-top:5px;font-family:'Barlow Condensed',sans-serif;font-size:15px;line-height:1;letter-spacing:.12px}.aeb-rownums>b{font-family:'Barlow Condensed',sans-serif;font-size:15px;line-height:1}.aeb-rownums i{margin-top:4px;margin-bottom:4px}
@media(max-width:374px){.aeb-featuregrid{grid-template-columns:minmax(0,.94fr) minmax(0,1.06fr)}.aeb-featurematch .aeb-teammark{width:29px;height:29px}.aeb-featurematch .aeb-matchup>div b{font-size:14px}.aeb-featurematch .aeb-matchup>span{margin-left:35px}.aeb-featurepick h2{font-size:18px}.aeb-featureprob b{font-size:15px}.aeb-row{grid-template-columns:18px minmax(0,1.13fr) minmax(82px,.84fr) 52px;gap:5px;padding-left:5px;padding-right:5px}.aeb-rowteams .aeb-teammark{width:22px;height:22px}.aeb-rowteams .aeb-matchup>div b{font-size:11.5px}.aeb-rowteams .aeb-matchup>span{margin-left:28px}.aeb-rowpick{padding-left:5px}.aeb-rowpick h3{font-size:12.5px}.aeb-rownums>b{font-size:12.5px}}
`;
