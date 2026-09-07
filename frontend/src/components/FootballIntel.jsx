import { formatEventDate } from "../lib/eventSlate";
import TeamLogo, { TEAM_LOGO_CSS } from "./TeamLogo";

const pct = (value) => value == null ? "—" : `${Math.abs(Number(value)) >= 1 ? Number(value).toFixed(1) : (Number(value) * 100).toFixed(1)}%`;

function factorRows(row) {
  return [
    ["MATCHUP", row.matchupEdge], ["WEATHER", row.weather], ["AVAILABILITY", row.availability],
    ["RECENT FORM", row.recentForm], ["MARKET PULSE", row.marketLean], ["LINE MOVE", row.lineMovement],
  ].filter(([, value]) => Boolean(value));
}

function IntelMatchup({ row, sport }) {
  return <div className="fbintel__identity"><div className="fbintel__logos"><TeamLogo sport={sport} team={row.awayTeam} logoId={row.teamIdentity?.away?.id} abbr={row.teamIdentity?.away?.abbr} /><TeamLogo sport={sport} team={row.homeTeam} logoId={row.teamIdentity?.home?.id} abbr={row.teamIdentity?.home?.abbr} /></div><span>{row.matchup}</span></div>;
}

export default function FootballIntel({ sport, rows = [], compact = false }) {
  if (sport !== "nfl" && sport !== "cfb") return null;
  const shown = rows.slice(0, compact ? 2 : 6);
  const lead = shown.find((row) => row.modelSignal) || shown[0] || null;
  if (compact) {
    return <section className="fbintel fbintel--compact" aria-label={`${sport.toUpperCase()} game intel`}>
      {shown.length === 0 ? <div className="fbintel__empty">Verified game intel appears with the selected event-day slate.</div>
        : <><style>{TEAM_LOGO_CSS}</style><div className="fbintel__grid">{shown.map((row) => <IntelCard row={row} sport={sport} key={row.gameId} includeSignal />)}</div></>}
    </section>;
  }
  return <section className={`fbintel${compact ? " fbintel--compact" : ""}`} aria-label={`${sport.toUpperCase()} game intel`}>
    {shown.length === 0 ? <div className="fbintel__empty">Verified game intel appears with the selected event-day slate.</div> : <>
      <article className={`fbintel__sharp${lead?.marketOnly ? " fbintel__sharp--market" : ""}`}>
        <header><span>SHARP EDGE · MODEL VS MARKET</span><em>{lead?.dataQuality === "rated" ? "RATED" : "MARKET"}</em></header>
        <div className="fbintel__sharpbody">
          <div><style>{TEAM_LOGO_CSS}</style><IntelMatchup row={lead} sport={sport} /><h2>{lead?.modelSignal?.pick || "Market information only"}</h2><p>{lead?.modelSignal ? `${lead.modelSignal.market} · verified selected side` : "No independent WizePicks model edge is claimed for this matchup."}</p></div>
          {lead?.modelSignal && <strong>{Number(lead.modelSignal.edge) >= 0 ? "+" : ""}{pct(lead.modelSignal.edge)}<small>MODEL EDGE</small></strong>}
        </div>
        {lead?.modelSignal && <div className="fbintel__sharpmetrics"><div><span>MODEL WIN</span><b>{pct(lead.modelSignal.probability)}</b></div><div><span>MARKET</span><b>{lead.marketLean || "Verified"}</b></div><div><span>LINE MOVE</span><b>{lead.lineMovement || "No verified move"}</b></div></div>}
      </article>
      <div className="fbintel__head"><div><span>GAME INTEL · WHAT CHANGES THE BET</span><h2>Verified factors</h2></div><small>Verified inputs only</small></div>
      <div className="fbintel__grid">{shown.map((row) => <IntelCard row={row} sport={sport} key={row.gameId} />)}</div>
    </>}
  </section>;
}

function IntelCard({ row, sport, includeSignal = false }) {
  const factors = factorRows(row);
  return <article className="fbintel__card">
    <div className="fbintel__match"><div><span>{formatEventDate(row.commenceTime ? new Date(row.commenceTime).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null, { compact: true })}</span><b><IntelMatchup row={row} sport={sport} /></b></div><em>{row.dataQuality === "rated" ? "RATED" : "MARKET"}</em></div>
    {includeSignal && (row.marketOnly ? <div className="fbintel__marketonly"><b>MARKET VIEW ONLY</b><span>No independent WizePicks model edge is claimed for this matchup.</span></div>
      : row.modelSignal ? <div className="fbintel__signal"><span>SHARP EDGE · MODEL VS MARKET</span><div><b>{row.modelSignal.pick}</b><strong>{Number(row.modelSignal.edge) >= 0 ? "+" : ""}{pct(row.modelSignal.edge)}</strong></div><small>{row.modelSignal.market} · model {pct(row.modelSignal.probability)}</small></div>
      : <div className="fbintel__marketonly"><b>NO QUALIFYING MODEL SIGNAL</b><span>Market information remains available without inventing an edge.</span></div>)}
    {factors.length ? <div className={`fbintel__factors${factors.length === 1 ? " fbintel__factors--single" : ""}`}>{factors.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      : <p className="fbintel__note">No additional verified matchup factors are available yet.</p>}
  </article>;
}

export const FOOTBALL_INTEL_CSS = `
.fbintel{box-sizing:border-box;min-width:0;margin:14px 0;color:#eeeae2}.fbintel *{box-sizing:border-box}.fbintel__head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:17px 0 11px}.fbintel__head span,.fbintel__sharp header>span{display:block;font:700 8px "IBM Plex Mono",monospace;letter-spacing:1.2px;color:#d2ad68}.fbintel__head h2{margin:4px 0 0;font:600 23px Georgia,serif}.fbintel__head small{font:600 8px "IBM Plex Mono",monospace;color:#6f706a}.fbintel__sharp{border:1px solid rgba(210,173,104,.58);border-radius:11px;background:linear-gradient(145deg,rgba(210,173,104,.075),rgba(14,15,18,.98));padding:14px}.fbintel__sharp header{display:flex;align-items:center;justify-content:space-between;gap:10px}.fbintel__sharp header em{border:1px solid #3a3a32;border-radius:999px;padding:4px 7px;font:700 7px "IBM Plex Mono",monospace;color:#99988f;font-style:normal}.fbintel__sharpbody{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:15px;margin-top:13px}.fbintel__sharpbody>div{min-width:0}.fbintel__sharpbody small{display:block;font:600 8px/1.4 "IBM Plex Mono",monospace;color:#777870;overflow-wrap:anywhere}.fbintel__sharpbody h2{margin:5px 0 3px;font:800 clamp(21px,5vw,31px)/1.05 Manrope,sans-serif;overflow-wrap:anywhere}.fbintel__sharpbody p{margin:0;color:#878880;font-size:9px}.fbintel__sharpbody>strong{color:#45d99d;font:800 clamp(23px,6vw,34px)/1 Manrope,sans-serif;text-align:right;white-space:nowrap}.fbintel__sharpbody>strong small{margin-top:5px;color:#777870;font-size:7px;letter-spacing:.8px}.fbintel__sharpmetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:13px;border-top:1px solid #2b2b25}.fbintel__sharpmetrics>div{min-width:0;padding:10px 8px 0}.fbintel__sharpmetrics>div+div{border-left:1px solid #292a24}.fbintel__sharpmetrics span{display:block;font:700 7px "IBM Plex Mono",monospace;color:#6f7069;letter-spacing:.8px}.fbintel__sharpmetrics b{display:block;margin-top:4px;font:700 9px/1.35 Manrope,sans-serif;overflow-wrap:anywhere}.fbintel__sharp--market{border-color:#34352f}.fbintel__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fbintel__card{min-width:0;border:1px solid #2a2b25;border-radius:10px;background:#0e0f12;padding:13px}.fbintel__match{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.fbintel__match>div{min-width:0}.fbintel__match span{display:block;font:700 7px "IBM Plex Mono",monospace;color:#6f706a;letter-spacing:.8px}.fbintel__match b{display:block;margin-top:4px;font:800 15px/1.2 Manrope,sans-serif;overflow-wrap:anywhere}.fbintel__match em{flex:0 0 auto;border:1px solid #34352e;border-radius:999px;padding:4px 6px;font:700 7px "IBM Plex Mono",monospace;color:#8a8b83;font-style:normal}.fbintel__signal,.fbintel__marketonly{margin-top:11px;border:1px solid rgba(210,173,104,.35);border-radius:8px;background:rgba(210,173,104,.055);padding:9px 10px}.fbintel__signal>span,.fbintel__marketonly b{display:block;font:700 7px "IBM Plex Mono",monospace;letter-spacing:.8px;color:#d2ad68}.fbintel__signal>div{display:flex;justify-content:space-between;gap:10px;align-items:end;margin-top:5px}.fbintel__signal b{font:800 15px Manrope,sans-serif;overflow-wrap:anywhere}.fbintel__signal strong{font:800 14px "IBM Plex Mono",monospace;color:#45d99d}.fbintel__signal small,.fbintel__marketonly span{display:block;margin-top:4px;font:500 8px/1.45 "IBM Plex Mono",monospace;color:#888981}.fbintel__factors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:10px;background:#24251f}.fbintel__factors>div{min-width:0;background:#101114;padding:9px}.fbintel__factors span{display:block;font:700 7px "IBM Plex Mono",monospace;color:#62635d;letter-spacing:.65px}.fbintel__factors b{display:block;margin-top:4px;font:700 9px/1.35 Manrope,sans-serif;color:#b9b7af;overflow-wrap:anywhere}.fbintel__note,.fbintel__empty{margin:10px 0 0;padding:12px;text-align:center;color:#6f7069;font:600 8px/1.5 "IBM Plex Mono",monospace}.fbintel--compact .fbintel__grid{grid-template-columns:1fr}.fbintel--compact .fbintel__card{border:0;padding:0 0 12px}.fbintel--compact .fbintel__card+.fbintel__card{border-top:1px solid #24251f;padding-top:12px}.fbintel__empty{border:1px solid #282923;border-radius:9px;background:#0e0f12}
.fbintel__sharpbody h2{font-family:'Barlow Condensed',sans-serif;font-size:clamp(24px,5.5vw,34px);line-height:1;letter-spacing:.15px}.fbintel__sharpbody>strong{font-family:'Barlow Condensed',sans-serif;font-size:clamp(26px,6vw,36px);letter-spacing:.15px}.fbintel__sharpmetrics b{font:800 11px/1.15 'Barlow Condensed',sans-serif;letter-spacing:.1px}.fbintel__match b{font-family:'Barlow Condensed',sans-serif;font-size:18px;line-height:1.04;letter-spacing:.12px}.fbintel__signal b{font-family:'Barlow Condensed',sans-serif;font-size:18px;line-height:1.04;letter-spacing:.12px}.fbintel__signal strong{font:800 17px/1 'Barlow Condensed',sans-serif}.fbintel__factors b{font-family:'Barlow Condensed',sans-serif;font-size:11px;line-height:1.15;letter-spacing:.08px}.fbintel__identity{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;min-width:0}.fbintel__identity>span{min-width:0;overflow-wrap:anywhere}.fbintel__logos{display:flex;align-items:center}.fbintel__logos .team-logo{width:25px;height:25px}.fbintel__logos .team-logo+.team-logo{margin-left:-4px}.fbintel__match b .fbintel__identity{font:inherit}.fbintel__match b .fbintel__identity>span{color:inherit}
.fbintel__factors--single{grid-template-columns:1fr}
@media(max-width:680px){.fbintel__grid{grid-template-columns:1fr}.fbintel__head{align-items:flex-start}.fbintel__head h2{font-size:22px}}
@media(max-width:360px){.fbintel__factors{grid-template-columns:1fr}.fbintel__card{padding:11px}}
`;
