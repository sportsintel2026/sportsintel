import { formatEventDate } from "../lib/eventSlate";

const MARKET = { pass_yds: "Passing yards", rush_yds: "Rushing yards", receptions: "Receptions", rec_yds: "Receiving yards" };
const odds = (value) => value == null ? "—" : Number(value) > 0 ? `+${value}` : String(value);
const pct = (value) => value == null ? "—" : `${Math.round(Number(value) * 100)}%`;
const edge = (value) => value == null ? "—" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;

export default function FootballPropCard({ prop }) {
  return <article className="fbprop">
    <div className="fbprop__top"><div className="fbprop__who"><b>{prop.player}</b><span>{prop.team || "Team pending"} · {prop.position || "Position verified"}</span></div><span className="fbprop__book">{prop.book}</span></div>
    <div className="fbprop__match">{prop.matchup} · {formatEventDate(prop.eventDate, { compact: true })}</div>
    <div className="fbprop__market"><div><span>{MARKET[prop.market] || prop.market}</span><b>{prop.line}</b></div><div className="fbprop__projection"><span>Projection</span><b>{Number(prop.projection).toFixed(1)}</b></div></div>
    <div className="fbprop__prices"><div><span>Over</span><b>{odds(prop.overOdds)}</b><small>model {pct(prop.modelOverProb)}</small></div><div><span>Under</span><b>{odds(prop.underOdds)}</b><small>model {pct(prop.modelOverProb == null ? null : 1 - prop.modelOverProb)}</small></div></div>
    <footer>Market fair Over {pct(prop.marketFairOverProb)} · model gap {edge(prop.modelEdge)} · projection seed {prop.gamesUsed ?? "—"} games</footer>
  </article>;
}

export const FOOTBALL_PROP_CARD_CSS = `
.fbprop{box-sizing:border-box;min-width:0;border:1px solid #222c33;border-radius:14px;background:linear-gradient(180deg,#12181d,#0c1115);padding:15px;overflow:hidden}.fbprop *{box-sizing:border-box}.fbprop__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.fbprop__who{min-width:0}.fbprop__who b{display:block;font:800 18px/1.05 "Barlow Condensed",sans-serif;overflow-wrap:anywhere}.fbprop__who span,.fbprop__match,.fbprop footer{font:500 9px/1.5 "IBM Plex Mono",monospace;color:#73808a}.fbprop__book{flex:0 1 auto;max-width:42%;font:700 9px/1.3 "IBM Plex Mono",monospace;color:#d6bd88;text-align:right;overflow-wrap:anywhere}.fbprop__match{margin-top:9px;overflow-wrap:anywhere}.fbprop__market{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:12px;margin-top:15px;padding:12px;border:1px solid #243039;border-radius:10px;background:#0a0e11}.fbprop__market span,.fbprop__prices span{display:block;font:700 8px "IBM Plex Mono",monospace;letter-spacing:.7px;text-transform:uppercase;color:#72808a}.fbprop__market b{display:block;margin-top:3px;font:800 24px "Barlow Condensed",sans-serif;color:#fff}.fbprop__projection{text-align:right}.fbprop__projection b{color:#3ad39d}.fbprop__prices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.fbprop__prices>div{min-width:0;padding:9px 10px;border-radius:9px;background:#10161a}.fbprop__prices b{font:700 16px "IBM Plex Mono",monospace;color:#e9eef1}.fbprop__prices small{display:block;margin-top:3px;font:600 8px "IBM Plex Mono",monospace;color:#82909b}.fbprop footer{margin-top:10px}@media(max-width:640px){.fbprop{padding:13px}.fbprop__market b{font-size:22px}}@media(max-width:360px){.fbprop__top{gap:7px}.fbprop__book{max-width:38%}}`;
