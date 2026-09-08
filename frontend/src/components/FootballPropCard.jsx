import { useState } from "react";
import { formatEventDate } from "../lib/eventSlate";
import { footballPropMarket } from "../lib/footballPropMarkets";
import TeamLogo, { TEAM_LOGO_CSS } from "./TeamLogo";

const odds = (value) => value == null ? "—" : Number(value) > 0 ? `+${value}` : String(value);
const pct = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : `${Math.round(Number(value) * 100)}%`;
const edge = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value) >= 0 ? "+" : ""}${(Number(value) * 100).toFixed(1)}%`;
const number = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1);

function eventTime(prop) {
  if (!prop.commenceTime) return formatEventDate(prop.eventDate, { compact: true });
  const date = new Date(prop.commenceTime);
  if (Number.isNaN(date.getTime())) return formatEventDate(prop.eventDate, { compact: true });
  return date.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  });
}

function initials(name) {
  return String(name || "Player").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function PlayerPortrait({ prop }) {
  const [failed, setFailed] = useState(false);
  return <div className={`fbprop__portrait${!prop.headshot || failed ? " is-fallback" : ""}`}>
    <span>{initials(prop.player)}</span>
    {prop.headshot && !failed && <img src={prop.headshot} alt={`${prop.player} headshot`} onError={() => setFailed(true)} />}
  </div>;
}

function PriceCell({ label, line, value, subdued = false }) {
  return <div className={`fbprop__price${subdued ? " is-subdued" : ""}`}>
    <span>{label}{line != null ? ` ${line}` : ""}</span>
    <b>{odds(value)}</b>
  </div>;
}

export default function FootballPropCard({ prop, sport = "nfl" }) {
  const market = footballPropMarket(prop.market);
  const modeled = [prop.projection, prop.modelOverProb, prop.modelEdge].every((value) => value != null && Number.isFinite(Number(value)));
  const overLean = modeled && Number(prop.modelEdge) >= 0;
  const priceMode = prop.priceMode || "over-under";
  const probabilitySide = priceMode === "yes-no" ? "YES" : "OVER";
  const selectedLabel = overLean ? (prop.overLabel || "OVER") : (prop.underLabel || "UNDER");
  const selectedPrice = overLean ? prop.overOdds : prop.underOdds;
  const selectedLine = prop.line == null ? "" : ` ${prop.line}`;
  const callout = modeled
    ? `${selectedLabel}${selectedLine}`
    : prop.market === "anytime_td" ? "ANYTIME TD" : priceMode === "yes-no" ? "YES / NO MARKET" : priceMode === "over-only" ? `${prop.overLabel || "OVER"} MARKET` : `O/U${selectedLine}`;

  return <article className={`fbprop${modeled ? " is-modeled" : " is-market-only"}`}>
    <style>{TEAM_LOGO_CSS}</style>
    <div className="fbprop__scanline" aria-hidden="true" />
    <div className="fbprop__main">
      <div className="fbprop__identity">
        <PlayerPortrait prop={prop} />
        <div className="fbprop__player">
          <span className="fbprop__position">{prop.position || "VERIFIED PLAYER"}</span>
          <h2>{prop.player}</h2>
          <div className="fbprop__teamline">
            <TeamLogo sport={sport} team={prop.team} abbr={prop.team} logoId={prop.teamLogoId} color="#4c6380" className="fbprop__logo" />
            <div><b>{prop.team || "Team verified"}</b><span>{prop.opponent ? `vs ${prop.opponent}` : prop.matchup}</span></div>
          </div>
        </div>
      </div>

      <div className="fbprop__wager">
        <span className="fbprop__marketlabel">{market?.label || prop.market}</span>
        <strong className="fbprop__call">{callout}</strong>
        <div className="fbprop__support">
          <b>{prop.book || "SPORTSBOOK"}</b>
          <span>{modeled ? `${odds(selectedPrice)} selected price` : "Verified posted market"}</span>
        </div>
        <div className={`fbprop__prices is-${priceMode}`} aria-label={`${prop.book || "Sportsbook"} aligned price`}>
          {priceMode === "over-only"
            ? <><PriceCell label={prop.overLabel || "OVER"} line={null} value={prop.overOdds} /><PriceCell label="COUNTERPRICE" line={null} value={null} subdued /></>
            : <><PriceCell label={prop.overLabel || "OVER"} line={prop.line} value={prop.overOdds} /><PriceCell label={prop.underLabel || "UNDER"} line={prop.line} value={prop.underOdds} /></>}
        </div>
      </div>

      <div className={`fbprop__edge${modeled && Number(prop.modelEdge) >= 0 ? " is-positive" : modeled ? " is-negative" : ""}`}>
        <span>{modeled ? "MODEL EDGE" : "MARKET ONLY"}</span>
        <strong>{edge(prop.modelEdge)}</strong>
        <small>{modeled ? "OVER BASIS" : "NO MODEL PICK"}</small>
      </div>
    </div>

    <div className="fbprop__metrics">
      <div><span>MODEL PROJ.</span><b>{number(prop.projection)}</b></div>
      <div><span>MODEL {probabilitySide}</span><b>{pct(prop.modelOverProb)}</b></div>
      <div><span>MARKET FAIR</span><b>{pct(prop.marketFairOverProb)}</b></div>
      <div><span>PROJECTION SAMPLE</span><b>{modeled && prop.gamesUsed != null ? `${prop.gamesUsed} games` : "—"}</b></div>
    </div>
    <footer><span>{modeled ? "WIZEPICKS PICK" : "VERIFIED MARKET"}</span><i />{eventTime(prop)}<i />{modeled ? "identity · market · model verified" : "market data only · no model probability or edge"}</footer>
  </article>;
}

export const FOOTBALL_PROP_CARD_CSS = `
.fbprop{--gold:#d7ad58;--green:#43dd88;position:relative;box-sizing:border-box;min-width:0;border:1px solid #454943;border-radius:8px;background:radial-gradient(circle at 10% 45%,rgba(215,173,88,.045),transparent 31%),linear-gradient(135deg,#111416,#090b0c 76%);overflow:hidden;box-shadow:0 12px 28px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.025)}.fbprop:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:1px;background:linear-gradient(90deg,var(--gold),rgba(215,173,88,.18) 68%,var(--green));opacity:.86}.fbprop *{box-sizing:border-box}.fbprop__scanline{position:absolute;inset:0;pointer-events:none;opacity:.14;background:repeating-linear-gradient(180deg,transparent 0,transparent 5px,rgba(255,255,255,.018) 6px)}.fbprop__main{position:relative;z-index:1;display:grid;grid-template-columns:minmax(245px,1.15fr) minmax(230px,.9fr) 112px;align-items:stretch;min-height:128px}.fbprop__identity{display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:14px;min-width:0;padding:14px 17px;border-right:1px solid #2d302c}.fbprop__portrait{position:relative;width:84px;height:84px;overflow:hidden;border:1px solid #596273;border-radius:50%;background:radial-gradient(circle at 50% 28%,#35433d 0,#18221f 42%,#090c0b 80%);box-shadow:inset 0 0 0 3px #0b0d0e,0 0 22px rgba(67,221,136,.07)}.fbprop__portrait:after{content:"";position:absolute;inset:auto 15px 3px;height:2px;background:var(--green);box-shadow:0 0 12px rgba(67,221,136,.75)}.fbprop__portrait>span{position:absolute;inset:0;display:grid;place-items:center;color:rgba(215,173,88,.88);font:800 25px/1 "Barlow Condensed",sans-serif;letter-spacing:1px}.fbprop__portrait img{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 12%}.fbprop__player{min-width:0}.fbprop__position,.fbprop__marketlabel,.fbprop__support,.fbprop__price span,.fbprop__metrics span,.fbprop__edge span,.fbprop__edge small,.fbprop footer{font:700 7px/1.35 "IBM Plex Mono",monospace;letter-spacing:.72px;text-transform:uppercase}.fbprop__position{color:var(--gold)}.fbprop__player h2{max-width:100%;margin:5px 0 9px;color:#f8f6f0;font:800 22px/.96 "Barlow Condensed",sans-serif;letter-spacing:.1px;overflow-wrap:anywhere}.fbprop__teamline{display:flex;align-items:center;gap:7px;min-width:0}.fbprop__logo{width:24px;height:24px}.fbprop__teamline>div{min-width:0}.fbprop__teamline b{display:block;color:#ddd9cf;font:800 9px/1.1 Manrope,sans-serif;overflow-wrap:anywhere}.fbprop__teamline span{display:block;margin-top:3px;color:#797b74;font:600 7px/1.25 "IBM Plex Mono",monospace;overflow-wrap:anywhere}.fbprop__wager{min-width:0;padding:15px 17px}.fbprop__marketlabel{display:block;color:#c7c7bf}.fbprop__call{display:block;margin-top:7px;color:#fff;font:800 23px/.94 "Barlow Condensed",sans-serif;letter-spacing:.25px;overflow-wrap:anywhere}.fbprop.is-modeled .fbprop__call{color:#f7f3e9}.fbprop__support{display:flex;align-items:center;gap:8px;min-width:0;margin-top:8px;color:#74766f}.fbprop__support b{color:#a7a9a2;font:800 8px/1.2 Manrope,sans-serif;overflow-wrap:anywhere}.fbprop__support span{min-width:0;overflow-wrap:anywhere}.fbprop__prices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:9px;border:1px solid #2d302c;border-radius:5px;overflow:hidden;background:#2d302c}.fbprop__price{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;background:#0c0f10;padding:6px 7px}.fbprop__price span{color:#797b74;font-size:6px;overflow-wrap:anywhere}.fbprop__price b{color:#f2eee4;font:800 12px/1 "Barlow Condensed",sans-serif}.fbprop__price.is-subdued b,.fbprop__price.is-subdued span{color:#585b55}.fbprop__edge{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-left:1px solid #2d302c;padding:12px 9px}.fbprop__edge span{border:1px solid #62655f;border-radius:5px;padding:4px 7px;color:#8b8e87;white-space:nowrap}.fbprop.is-modeled .fbprop__edge span{border-color:#2fa45f;color:var(--green)}.fbprop__edge strong{display:block;margin-top:12px;color:#74766f;font:800 25px/.92 "Barlow Condensed",sans-serif}.fbprop__edge.is-positive strong{color:var(--green);text-shadow:0 0 15px rgba(67,221,136,.18)}.fbprop__edge.is-negative strong{color:#e49a90}.fbprop__edge small{display:block;margin-top:6px;color:#74766f;font-size:6px}.fbprop__metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #30332e;background:rgba(9,11,12,.88)}.fbprop__metrics>div{min-width:0;padding:9px 13px;text-align:center}.fbprop__metrics>div+div{border-left:1px solid #2b2e2a}.fbprop__metrics span{display:block;color:#7d7f78;font-size:6.4px}.fbprop__metrics b{display:block;margin-top:5px;color:#ebe7de;font:800 14px/1 "Barlow Condensed",sans-serif;overflow-wrap:anywhere}.fbprop.is-modeled .fbprop__metrics>div:nth-child(2) b{color:var(--green)}.fbprop footer{position:relative;z-index:1;display:flex;align-items:center;gap:7px;min-width:0;padding:7px 17px;border-top:1px solid #2a2d28;color:#74766f;font-size:6px}.fbprop footer span{color:var(--gold)}.fbprop footer i{flex:0 0 auto;width:3px;height:3px;border-radius:50%;background:#4c4f49}@media(max-width:680px){.fbprop__main{grid-template-columns:minmax(0,1fr) 82px}.fbprop__identity{grid-template-columns:74px minmax(0,1fr);gap:11px;padding:12px;border-right:1px solid #2d302c}.fbprop__portrait{width:70px;height:70px}.fbprop__player h2{font-size:20px}.fbprop__wager{grid-column:1/-1;grid-row:2;padding:11px 12px;border-top:1px solid #2d302c}.fbprop__edge{grid-column:2;grid-row:1;border-left:1px solid #2d302c;padding:9px 6px}.fbprop__edge strong{font-size:21px;margin-top:9px}.fbprop__prices{max-width:290px}.fbprop__metrics>div{padding:8px 5px}.fbprop__metrics span{font-size:5.5px}.fbprop__metrics b{font-size:12px}.fbprop footer{padding:7px 12px;flex-wrap:wrap}.fbprop footer i:last-of-type{display:none}}@media(max-width:350px){.fbprop__main{grid-template-columns:minmax(0,1fr) 72px}.fbprop__identity{grid-template-columns:62px minmax(0,1fr);gap:9px;padding:10px}.fbprop__portrait{width:58px;height:58px}.fbprop__player h2{font-size:18px}.fbprop__call{font-size:20px}.fbprop__metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.fbprop__metrics>div:nth-child(3){border-left:0;border-top:1px solid #2b2e2a}.fbprop__metrics>div:nth-child(4){border-top:1px solid #2b2e2a}.fbprop footer{font-size:5.5px}}`;
