import { formatEventDate } from "../lib/eventSlate";
import TeamLogo, { TEAM_LOGO_CSS } from "./TeamLogo";

const MARKET = { pass_yds: "Passing yards", rush_yds: "Rushing yards", receptions: "Receptions", rec_yds: "Receiving yards" };
const odds = (value) => value == null ? "—" : Number(value) > 0 ? `+${value}` : String(value);
const pct = (value) => value == null ? "—" : `${Math.round(Number(value) * 100)}%`;
const edge = (value) => value == null ? "—" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;

export default function FootballPropCard({ prop }) {
  return <article className="fbprop">
    <style>{TEAM_LOGO_CSS}</style>
    <div className="fbprop__top"><div className="fbprop__identity"><TeamLogo sport="nfl" team={prop.team} abbr={prop.team} color="#4c6380" className="fbprop__logo" /><div className="fbprop__who"><span>{prop.team || "TEAM"} · {prop.position || "VERIFIED PLAYER"}</span><b>{prop.player}</b></div></div><span className="fbprop__book">{prop.book || "BOOK"}</span></div>
    <div className="fbprop__match">{prop.matchup} · {formatEventDate(prop.eventDate, { compact: true })}</div>
    <div className="fbprop__pick"><div><span>{MARKET[prop.market] || prop.market}</span><b>O {prop.line}</b><small>{odds(prop.overOdds)}</small></div><strong>{edge(prop.modelEdge)}</strong></div>
    <div className="fbprop__metrics"><div><span>PROJECTION</span><b>{Number(prop.projection).toFixed(1)}</b></div><div><span>MODEL OVER</span><b>{pct(prop.modelOverProb)}</b></div><div><span>MARKET FAIR</span><b>{pct(prop.marketFairOverProb)}</b></div></div>
    <footer>Verified identity · two-sided line · {prop.gamesUsed ?? "—"} game projection sample</footer>
  </article>;
}

export const FOOTBALL_PROP_CARD_CSS = `
.fbprop{box-sizing:border-box;min-width:0;border:1px solid #2b2c26;border-radius:10px;background:#101114;padding:14px;overflow:hidden}.fbprop *{box-sizing:border-box}.fbprop__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.fbprop__identity{display:flex;align-items:center;gap:10px;min-width:0}.fbprop__logo{width:38px;height:38px}.fbprop__who{min-width:0}.fbprop__who span,.fbprop__match,.fbprop footer{font:600 7.5px/1.5 "IBM Plex Mono",monospace;color:#74756e;letter-spacing:.35px}.fbprop__who b{display:block;margin-top:3px;font:800 20px/1.02 "Barlow Condensed",sans-serif;letter-spacing:.15px;overflow-wrap:anywhere}.fbprop__book{flex:0 1 auto;max-width:42%;font:700 8px/1.3 "IBM Plex Mono",monospace;color:#d2ad68;text-align:right;overflow-wrap:anywhere}.fbprop__match{margin-top:9px;overflow-wrap:anywhere}.fbprop__pick{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;margin-top:11px;padding:11px;border:1px solid rgba(210,173,104,.28);border-radius:8px;background:rgba(210,173,104,.045)}.fbprop__pick span,.fbprop__metrics span{display:block;font:700 7px "IBM Plex Mono",monospace;letter-spacing:.7px;color:#777871}.fbprop__pick b{display:inline-block;margin-top:4px;font:800 23px/1 "Barlow Condensed",sans-serif;letter-spacing:.2px}.fbprop__pick small{margin-left:7px;font:700 9px "IBM Plex Mono",monospace;color:#8a8b83}.fbprop__pick strong{font:800 28px/1 "Barlow Condensed",sans-serif;color:#45d99d;letter-spacing:.15px}.fbprop__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:9px;background:#252620}.fbprop__metrics>div{min-width:0;background:#0d0e10;padding:9px}.fbprop__metrics b{display:block;margin-top:5px;font:800 14px/1 "Barlow Condensed",sans-serif;letter-spacing:.1px;overflow-wrap:anywhere}.fbprop footer{margin-top:10px}@media(max-width:360px){.fbprop{padding:11px}.fbprop__top{gap:7px}.fbprop__identity{gap:8px}.fbprop__logo{width:32px;height:32px}.fbprop__who b{font-size:18px}.fbprop__pick strong{font-size:23px}.fbprop__metrics>div{padding:7px 5px}.fbprop__metrics b{font-size:12px}}`;
