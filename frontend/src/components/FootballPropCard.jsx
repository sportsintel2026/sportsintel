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
    : priceMode === "yes-no" ? "YES / NO MARKET" : priceMode === "over-only" ? `${prop.overLabel || "OVER"} MARKET` : `O/U${selectedLine}`;

  return <article className={`fbprop${modeled ? " is-modeled" : " is-market-only"}`}>
    <style>{TEAM_LOGO_CSS}</style>
    <div className="fbprop__scanline" aria-hidden="true" />
    <div className="fbprop__topline">
      <span className={`fbprop__mode${modeled ? " is-model" : ""}`}><i />{modeled ? "WIZEPICKS MODEL" : "VERIFIED MARKET"}</span>
      <span className="fbprop__book">{prop.book || "SPORTSBOOK"}</span>
    </div>

    <div className="fbprop__hero">
      <div className="fbprop__player">
        <span className="fbprop__position">{prop.position || "VERIFIED PLAYER"}</span>
        <h2>{prop.player}</h2>
        <div className="fbprop__teamline">
          <TeamLogo sport={sport} team={prop.team} abbr={prop.team} logoId={prop.teamLogoId} color="#4c6380" className="fbprop__logo" />
          <div><b>{prop.team || "Team verified"}</b><span>{prop.opponent ? `vs ${prop.opponent}` : prop.matchup}</span></div>
        </div>
        <time>{eventTime(prop)}</time>
      </div>
      <PlayerPortrait prop={prop} />
    </div>

    <div className="fbprop__marketlabel"><span>{market?.label || prop.market}</span><i>LIVE LINE</i></div>
    <div className="fbprop__read">
      <div>
        <span>{modeled ? "MODEL READ" : "MARKET STATUS"}</span>
        <strong>{callout}</strong>
        <small>{modeled ? `${odds(selectedPrice)} · ${prop.book}` : "No WizePicks model edge published"}</small>
      </div>
      <div className={`fbprop__edge${modeled && Number(prop.modelEdge) >= 0 ? " is-positive" : modeled ? " is-negative" : ""}`}>
        <strong>{edge(prop.modelEdge)}</strong>
        <span>{modeled ? "SIGNED OVER EDGE" : "MODEL EDGE"}</span>
      </div>
    </div>

    <div className={`fbprop__prices is-${priceMode}`} aria-label={`${prop.book || "Sportsbook"} aligned price`}>
      {priceMode === "over-only"
        ? <><PriceCell label={prop.overLabel || "OVER"} line={null} value={prop.overOdds} /><PriceCell label="COUNTERPRICE" line={null} value={null} subdued /></>
        : <><PriceCell label={prop.overLabel || "OVER"} line={prop.line} value={prop.overOdds} /><PriceCell label={prop.underLabel || "UNDER"} line={prop.line} value={prop.underOdds} /></>}
    </div>

    <div className="fbprop__metrics">
      <div><span>PROJECTION</span><b>{number(prop.projection)}</b></div>
      <div><span>MODEL {probabilitySide}</span><b>{pct(prop.modelOverProb)}</b></div>
      <div><span>MARKET {probabilitySide}</span><b>{pct(prop.marketFairOverProb)}</b></div>
    </div>
    <footer><span>IDENTITY VERIFIED</span><i />{modeled ? `${prop.gamesUsed ?? "—"} game projection sample` : "Market data only · no model pick"}</footer>
  </article>;
}

export const FOOTBALL_PROP_CARD_CSS = `
.fbprop{--gold:#d6ad5c;--green:#55e6a5;position:relative;box-sizing:border-box;min-width:0;border:1px solid #343126;border-radius:15px;background:radial-gradient(circle at 92% 8%,rgba(85,230,165,.09),transparent 32%),linear-gradient(145deg,#141619 0%,#0b0d0f 76%);padding:14px;overflow:hidden;box-shadow:0 18px 42px rgba(0,0,0,.3),inset 0 1px rgba(255,255,255,.025)}.fbprop:before{content:"";position:absolute;inset:0 auto auto 0;width:100%;height:2px;background:linear-gradient(90deg,var(--gold),rgba(214,173,92,.08) 68%,var(--green));opacity:.92}.fbprop *{box-sizing:border-box}.fbprop__scanline{position:absolute;inset:0;pointer-events:none;opacity:.16;background:repeating-linear-gradient(180deg,transparent 0,transparent 5px,rgba(255,255,255,.018) 6px)}.fbprop__topline,.fbprop__marketlabel{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:10px}.fbprop__mode,.fbprop__book,.fbprop__position,.fbprop__player time,.fbprop__marketlabel,.fbprop__read span,.fbprop__read small,.fbprop__price span,.fbprop__metrics span,.fbprop footer{font:700 7px/1.35 "IBM Plex Mono",monospace;letter-spacing:.72px;text-transform:uppercase}.fbprop__mode{display:inline-flex;align-items:center;color:#96978e}.fbprop__mode i{width:6px;height:6px;margin-right:6px;border-radius:50%;background:#85867f;box-shadow:0 0 0 3px rgba(133,134,127,.1)}.fbprop__mode.is-model{color:var(--green)}.fbprop__mode.is-model i{background:var(--green);box-shadow:0 0 9px rgba(85,230,165,.65)}.fbprop__book{max-width:48%;color:var(--gold);text-align:right;overflow-wrap:anywhere}.fbprop__hero{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) 106px;align-items:end;min-height:126px;margin-top:8px;border-bottom:1px solid #292a25}.fbprop__player{min-width:0;padding:12px 0 12px}.fbprop__position{color:#797b75}.fbprop__player h2{max-width:100%;margin:5px 0 9px;color:#f8f6f0;font:800 27px/.9 "Barlow Condensed",sans-serif;letter-spacing:.15px;text-transform:uppercase;overflow-wrap:anywhere}.fbprop__teamline{display:flex;align-items:center;gap:8px;min-width:0}.fbprop__logo{width:31px;height:31px}.fbprop__teamline>div{min-width:0}.fbprop__teamline b{display:block;color:#dedcd5;font:800 11px/1.08 Manrope,sans-serif;overflow-wrap:anywhere}.fbprop__teamline span{display:block;margin-top:3px;color:#767871;font:600 8px/1.25 "IBM Plex Mono",monospace;overflow-wrap:anywhere}.fbprop__player time{display:block;margin-top:8px;color:#6d6f69}.fbprop__portrait{position:relative;align-self:end;justify-self:end;width:102px;height:119px;overflow:hidden;border-radius:52px 52px 10px 10px;background:radial-gradient(circle at 50% 27%,#344239 0,#17221e 40%,#0a0d0c 80%);box-shadow:inset 0 0 0 1px rgba(85,230,165,.24),0 0 28px rgba(85,230,165,.09)}.fbprop__portrait:after{content:"";position:absolute;inset:auto 8px 0;height:2px;background:var(--green);box-shadow:0 0 14px rgba(85,230,165,.8)}.fbprop__portrait>span{position:absolute;inset:0;display:grid;place-items:center;color:rgba(214,173,92,.85);font:800 30px/1 "Barlow Condensed",sans-serif;letter-spacing:1px}.fbprop__portrait img{position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 12%}.fbprop__marketlabel{margin-top:11px;color:#aaa99f}.fbprop__marketlabel i{color:#656760;font-style:normal;font-size:6px}.fbprop__read{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;margin-top:6px;padding:11px 12px;border:1px solid rgba(214,173,92,.33);border-left:3px solid var(--gold);border-radius:8px;background:linear-gradient(90deg,rgba(214,173,92,.105),rgba(214,173,92,.02))}.fbprop.is-modeled .fbprop__read{border-left-color:var(--green);background:linear-gradient(90deg,rgba(85,230,165,.09),rgba(85,230,165,.015))}.fbprop__read span{display:block;color:#797a73}.fbprop__read>div:first-child strong{display:block;margin-top:3px;color:#fff;font:800 24px/.95 "Barlow Condensed",sans-serif;letter-spacing:.25px}.fbprop__read small{display:block;margin-top:5px;color:#a7a69d;font-size:6.5px}.fbprop__edge{text-align:right}.fbprop__edge strong{display:block;color:#74766f;font:800 27px/.92 "Barlow Condensed",sans-serif}.fbprop__edge.is-positive strong{color:var(--green);text-shadow:0 0 16px rgba(85,230,165,.18)}.fbprop__edge.is-negative strong{color:#e09b92}.fbprop__edge span{margin-top:4px;font-size:5.8px}.fbprop__prices{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin-top:8px;border:1px solid #292a25;border-radius:7px;overflow:hidden;background:#292a25}.fbprop__price{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;background:rgba(15,17,19,.94);padding:8px 9px}.fbprop__price span{color:#74766f;overflow-wrap:anywhere}.fbprop__price b{color:#f4f1e9;font:800 15px/1 "Barlow Condensed",sans-serif}.fbprop__price.is-subdued b,.fbprop__price.is-subdued span{color:#585a55}.fbprop__metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:1px;background:#292a25}.fbprop__metrics>div{min-width:0;background:rgba(10,12,14,.96);padding:9px}.fbprop__metrics span{display:block;color:#6c6e68;font-size:6.2px}.fbprop__metrics b{display:block;margin-top:5px;color:#e5e3dc;font:800 15px/1 "Barlow Condensed",sans-serif;overflow-wrap:anywhere}.fbprop footer{position:relative;z-index:1;display:flex;align-items:center;gap:6px;margin-top:9px;color:#6a6c66;font-size:6.3px}.fbprop footer span{color:#9f8350}.fbprop footer i{width:3px;height:3px;border-radius:50%;background:#4c4e49}@media(max-width:420px){.fbprop{padding:12px}.fbprop__hero{grid-template-columns:minmax(0,1fr) 96px;min-height:116px}.fbprop__portrait{width:92px;height:108px}.fbprop__player h2{font-size:25px}.fbprop__read{padding:10px}.fbprop__read>div:first-child strong{font-size:22px}.fbprop__edge strong{font-size:24px}}@media(max-width:350px){.fbprop{padding:10px}.fbprop__hero{grid-template-columns:minmax(0,1fr) 82px}.fbprop__portrait{width:78px;height:98px}.fbprop__player h2{font-size:22px}.fbprop__read{grid-template-columns:1fr}.fbprop__edge{text-align:left}.fbprop__prices{grid-template-columns:1fr}.fbprop__metrics>div{padding:8px 5px}.fbprop footer{flex-wrap:wrap}}`;
