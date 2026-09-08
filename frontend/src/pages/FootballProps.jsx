import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { footballPropsApi, subscriptionApi } from "../lib/api";
import { chooseEventDate, createLatestRequestGuard, eventDateGroups, formatEventDate, scopeProps } from "../lib/eventSlate";
import { availableFootballPropFamilies, filterFootballProps } from "../lib/footballPropMarkets";
import EventDateSelector, { EVENT_DATE_CSS } from "../components/EventDateSelector";
import FootballPropCard, { FOOTBALL_PROP_CARD_CSS } from "../components/FootballPropCard";
import TerminalShell from "./TerminalShell";

export function FootballPropsEmpty({ sport }) {
  return <section className="fbprops__empty">
    <div className="fbprops__emptyicon" aria-hidden="true"><span>╱</span><i>◆</i></div>
    <h2>No verified {sport.toUpperCase()} player props<br />available for this slate.</h2>
    <p>We publish only verified player, matchup, market, line, price, and sportsbook data. Model fields appear only when the active WizePicks model scores that market.</p>
    <div className="fbprops__checks" aria-label="Football prop verification requirements">
      {["PLAYER IDENTITY", "TEAM + OPPONENT", "MARKET + LINE", "POSTED ODDS", "SPORTSBOOK", "MODEL STATUS", "PREDICTION TIME"].map((label, index) => <div key={label}><b>{index + 1}</b><i /><span>{label}</span></div>)}
    </div>
    <div className="fbprops__future">
      <h3>WHAT WILL APPEAR HERE</h3>
      <div><span>Player</span><b>—</b><span>Model Projection</span><b>—</b><span>Team / Opponent</span><b>—</b><span>Model %</span><b>—</b><span>Category</span><b>—</b><span>Market Fair %</span><b>—</b><span>Line + Odds</span><b>—</b><span>Edge</span><b>—</b><span>Book</span><b>—</b><span>WizePick</span><b>—</b></div>
    </div>
    <div className="fbprops__emptyfoot"><i>◇</i><span>{sport === "cfb" ? "Unsupported markets stay empty — never substituted from another sport." : "NFL props post only after every identity, market, price, and model check is complete."}</span></div>
  </section>;
}

export default function FootballProps({ sport }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [planLoaded, setPlanLoaded] = useState(false);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(null);
  const [family, setFamily] = useState("all");
  const guard = useRef(createLatestRequestGuard());
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite" || user?.email === "r7002g@gmail.com";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}).finally(() => setPlanLoaded(true)); }, []);
  useEffect(() => {
    setPayload(null); setDate(null); setFamily("all");
    if (!planLoaded || !hasFull) { setLoading(!planLoaded); return undefined; }
    const token = guard.current.begin(sport); let dead = false;
    setLoading(true);
    footballPropsApi.get(sport).then((data) => {
      if (dead || !guard.current.accepts(token, sport) || data?.sport !== sport) return;
      const clean = { ...data, props: scopeProps(data.props, sport) };
      setPayload(clean);
      setDate(chooseEventDate(clean.props));
    }).catch(() => { if (!dead && guard.current.accepts(token, sport)) setPayload({ sport, props: [] }); })
      .finally(() => { if (!dead && guard.current.accepts(token, sport)) setLoading(false); });
    return () => { dead = true; guard.current.invalidate(); };
  }, [sport, planLoaded, hasFull]);

  const props = payload?.props || [];
  const groups = useMemo(() => eventDateGroups(props).map((group) => ({
    ...group,
    games: [...new Map(group.games.map((prop) => [String(prop.eventId || prop.matchup), prop])).values()],
  })), [props]);
  const dateRows = useMemo(() => date ? props.filter((prop) => prop.eventDate === date) : props, [date, props]);
  const families = useMemo(() => availableFootballPropFamilies({ props: dateRows }), [dateRows]);
  const rows = filterFootballProps(dateRows, family);
  const gameCount = useMemo(() => new Set(dateRows.map((prop) => String(prop.eventId || prop.matchup))).size, [dateRows]);
  const modelCount = useMemo(() => dateRows.filter((prop) => [prop.projection, prop.modelOverProb, prop.modelEdge].every((value) => value != null && Number.isFinite(Number(value)))).length, [dateRows]);
  useEffect(() => {
    if (families.length > 0 && !families.some((item) => item.key === family)) setFamily("all");
  }, [families, family]);

  return (
    <TerminalShell active="/props" plan={plan} navigate={navigate}>
      <main className="fbprops"><style>{FOOTBALL_PROPS_CSS + EVENT_DATE_CSS + FOOTBALL_PROP_CARD_CSS}</style>
        <header className="fbprops__head">
          <div><span className="fbprops__eyebrow">{sport.toUpperCase()} · VERIFIED MARKETS ONLY</span><h1>Player Props</h1></div>
          <div className="fbprops__status"><i /> {sport === "nfl" ? "VERIFIED" : "IDENTITY GATED"}</div>
        </header>
        <p className="fbprops__intro">Only player lines with verified identity and sportsbook-aligned market data appear here. WizePicks projections appear only for markets the active model scores; missing data never falls back to another sport.</p>

        {!planLoaded || loading ? <div className="fbprops__state">Loading verified {sport.toUpperCase()} props…</div>
          : !hasFull ? <div className="fbprops__lock"><span>LOCKED</span><h2>Football props are All-Access</h2><p>Verified model probabilities and posted prices, without cross-sport fallback.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>
          : <>
              <EventDateSelector groups={groups} value={date} onChange={setDate} label={`${sport.toUpperCase()} prop date`} />
              <div className="fbprops__slate">
                <h2>{date ? formatEventDate(date) : `${sport.toUpperCase()} PROP SLATE`}</h2>
                <p>{dateRows.length} verified market{dateRows.length === 1 ? "" : "s"} <i /> {gameCount} game{gameCount === 1 ? "" : "s"} <i /> <b>{modelCount} model edge{modelCount === 1 ? "" : "s"}</b></p>
              </div>
              {families.length > 0 && <div className="fbprops__markets" role="tablist" aria-label={`${sport.toUpperCase()} prop markets`}>
                {families.map((item) => <button type="button" role="tab" aria-selected={family === item.key} className={family === item.key ? "is-active" : ""} key={item.key} onClick={() => setFamily(item.key)}>{item.label}</button>)}
              </div>}
              {families.length > 0 && <div className="fbprops__rank"><span><i>▥</i> MODEL %</span><small>Sportsbook and price shown as verified support data</small></div>}
              {rows.length === 0 ? (props.length === 0 ? <FootballPropsEmpty sport={sport} /> : <div className="fbprops__state fbprops__state--market"><b>No verified {families.find((item) => item.key === family)?.label || "selected"} props for this event day.</b><span>Other verified market families remain available above.</span></div>)
                : <section className="fbprops__grid" aria-label={`${sport.toUpperCase()} verified props`}>
                    {rows.map((prop) => <FootballPropCard sport={sport} prop={prop} key={`${prop.eventId}-${prop.player}-${prop.market}-${prop.line}`} />)}
                  </section>}
            </>}
      </main>
    </TerminalShell>
  );
}

export const FOOTBALL_PROPS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Manrope:wght@500;600;700;800&display=swap');
.fbprops{box-sizing:border-box;width:min(100% - 28px,920px);margin:0 auto;padding:16px 0 104px;color:#eeeae2;font-family:Manrope,Inter,system-ui,sans-serif;overflow-x:hidden}.fbprops *{box-sizing:border-box}.fbprops__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:2px 0 8px}.fbprops__eyebrow{font:700 8px/1.4 "IBM Plex Mono",monospace;letter-spacing:1.35px;color:#d2ad68}.fbprops h1{margin:5px 0 0;font:800 clamp(25px,5vw,34px)/1 Manrope,sans-serif;letter-spacing:-.75px}.fbprops__status{font:700 8px "IBM Plex Mono",monospace;letter-spacing:.8px;color:#777871;white-space:nowrap}.fbprops__status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#45d99d;margin-right:5px;box-shadow:0 0 10px rgba(69,217,157,.45)}.fbprops__intro{max-width:760px;margin:5px 0 13px;color:#85867f;font-size:9px;line-height:1.55}.fbprops .event-date{margin:11px 0 14px}.fbprops .event-date__rail{width:100%;max-width:100%;border-color:#34352f}.fbprops .event-date__tab{flex:1 0 76px;min-width:76px;padding:8px}.fbprops .event-date__tab strong{font-size:17px}.fbprops__slate{margin:0 1px 13px}.fbprops__slate h2{margin:0;font:800 20px/1.1 Manrope,sans-serif;letter-spacing:.1px;text-transform:uppercase}.fbprops__slate p{display:flex;align-items:center;gap:7px;margin:5px 0 0;color:#92938c;font:600 9px/1.35 "IBM Plex Mono",monospace}.fbprops__slate p i{width:3px;height:3px;border-radius:50%;background:#d2ad68}.fbprops__slate p b{color:#d2ad68;font-weight:700}.fbprops__markets{display:flex;max-width:100%;margin:0 0 10px;border:1px solid #3b3d38;border-radius:8px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;scrollbar-width:none;background:#0d0f10}.fbprops__markets::-webkit-scrollbar{display:none}.fbprops__markets button{appearance:none;position:relative;flex:1 0 auto;min-width:84px;scroll-snap-align:start;border:0;border-radius:0;background:linear-gradient(180deg,#15171a,#0e1012);color:#a2a39d;padding:10px 13px;font:700 8px/1 "IBM Plex Mono",monospace;letter-spacing:.45px;text-transform:uppercase;cursor:pointer}.fbprops__markets button+button{border-left:1px solid #30322e}.fbprops__markets button.is-active{background:linear-gradient(135deg,#e8c675,#c99945);color:#181208;box-shadow:inset 0 0 0 1px rgba(255,235,175,.4),0 0 18px rgba(210,173,104,.12)}.fbprops__rank{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.fbprops__rank>span{display:flex;align-items:center;gap:7px;border:1px solid #383b36;border-radius:6px;background:#101315;padding:7px 10px;color:#dcddd6;font:700 8px "IBM Plex Mono",monospace}.fbprops__rank>span i{color:#d2ad68;font-style:normal}.fbprops__rank small{color:#74766f;font:600 7px "IBM Plex Mono",monospace;text-align:right}.fbprops__grid{display:grid;grid-template-columns:1fr;gap:9px}.fbprops__state,.fbprops__lock{border:1px solid #2b2c26;border-radius:8px;background:#101114;padding:24px 16px;text-align:center;color:#83847d}.fbprops__state--market{display:flex;flex-direction:column;gap:5px}.fbprops__state--market b{color:#eeeae2;font-size:13px}.fbprops__state--market span{font-size:9px}.fbprops__lock span{font:700 8px "IBM Plex Mono",monospace;letter-spacing:1.2px;color:#d2ad68}.fbprops__lock h2{margin:8px 0 6px;font:800 19px Manrope,sans-serif;color:#fff}.fbprops__lock p{margin:0 auto 14px;max-width:430px;font-size:10px;line-height:1.55}.fbprops__lock button{border:0;border-radius:7px;background:#d2ad68;color:#171207;padding:9px 13px;font-weight:800;cursor:pointer}.fbprops__empty{max-width:820px;margin:6px auto 0;text-align:center;padding:18px 4px 4px}.fbprops__emptyicon{position:relative;width:74px;height:84px;margin:0 auto 12px;border:2px solid #d2ad68;border-radius:14px;color:#d2ad68;box-shadow:0 0 22px rgba(210,173,104,.07)}.fbprops__emptyicon span{position:absolute;inset:13px 13px auto;height:24px;border:2px solid currentColor;border-radius:50%;font-size:0}.fbprops__emptyicon span:after{content:"";position:absolute;top:21px;left:50%;width:38px;height:23px;border:2px solid currentColor;border-bottom:0;border-radius:22px 22px 0 0;transform:translateX(-50%)}.fbprops__emptyicon i{position:absolute;right:-10px;bottom:8px;width:31px;height:31px;display:grid;place-items:center;border:2px solid #d2ad68;border-radius:50%;background:#090a0c;color:#d2ad68;font-size:13px;font-style:normal}.fbprops__empty h2{margin:0;color:#f4f0e8;font:800 21px/1.18 Manrope,sans-serif}.fbprops__empty>p{max-width:540px;margin:9px auto 17px;color:#95968f;font-size:10px;line-height:1.55}.fbprops__checks{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin:0 auto 17px}.fbprops__checks>div{min-width:0}.fbprops__checks b{display:block;color:#d2ad68;font:800 10px "IBM Plex Mono",monospace}.fbprops__checks i{display:block;width:15px;height:15px;margin:7px auto;border:1px solid #6a6b65;border-radius:50%}.fbprops__checks span{display:block;color:#bebeb7;font:600 6.5px/1.35 "IBM Plex Mono",monospace;overflow-wrap:anywhere}.fbprops__future{border:1px solid rgba(210,173,104,.63);border-radius:9px;background:linear-gradient(135deg,rgba(210,173,104,.045),rgba(15,17,19,.96));padding:12px 15px;text-align:left}.fbprops__future h3{margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #34352f;color:#d2ad68;font:800 10px "IBM Plex Mono",monospace;letter-spacing:.8px}.fbprops__future>div{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px;gap:7px 12px;color:#95968f;font-size:9px}.fbprops__future b{color:#777871;text-align:right}.fbprops__emptyfoot{display:flex;align-items:center;gap:10px;max-width:580px;margin:13px auto 0;text-align:left;color:#92938d;font-size:9px;line-height:1.4}.fbprops__emptyfoot i{color:#d2ad68;font-size:19px;font-style:normal}.fbprops__emptyfoot span{min-width:0}@media(max-width:760px){.fbprops__head{align-items:flex-start}.fbprops__status{margin-top:5px}.fbprops__intro{font-size:9px}.fbprops__rank small{max-width:190px}.fbprops__checks{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:430px){.fbprops{width:calc(100% - 22px);padding-top:12px}.fbprops__head{gap:8px}.fbprops__status{font-size:7px}.fbprops__intro{margin-bottom:10px}.fbprops .event-date{margin-top:8px}.fbprops__slate h2{font-size:18px}.fbprops__slate p{gap:5px;font-size:7.3px;white-space:nowrap}.fbprops__markets button{min-width:74px;padding:9px 10px}.fbprops__rank small{display:none}.fbprops__empty{padding-top:14px}.fbprops__empty h2{font-size:18px}.fbprops__checks{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 4px}.fbprops__checks>div:last-child{grid-column:2}.fbprops__future{padding:11px}.fbprops__future>div{gap:7px 8px;font-size:8px}.fbprops__state{padding-left:12px;padding-right:12px}}@media(max-width:350px){.fbprops{width:calc(100% - 18px)}.fbprops h1{font-size:23px}.fbprops__status{font-size:6.5px}.fbprops__slate p{font-size:6.7px}.fbprops__markets button{min-width:68px;padding-left:8px;padding-right:8px}.fbprops__empty h2{font-size:17px}}`;
