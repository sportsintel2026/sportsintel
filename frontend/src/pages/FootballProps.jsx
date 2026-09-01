import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { footballPropsApi, subscriptionApi } from "../lib/api";
import { chooseEventDate, createLatestRequestGuard, eventDateGroups, scopeProps } from "../lib/eventSlate";
import EventDateSelector, { EVENT_DATE_CSS } from "../components/EventDateSelector";
import FootballPropCard, { FOOTBALL_PROP_CARD_CSS } from "../components/FootballPropCard";
import TerminalShell from "./TerminalShell";

export function FootballPropsEmpty({ sport }) {
  return <div className="fbprops__state fbprops__state--honest"><div className="fbprops__emptyicon">◇</div><b>No verified {sport.toUpperCase()} player props for this slate.</b><span>{sport === "cfb" ? "WizePicks never substitutes NFL or MLB props just to fill this board." : "NFL props post only after every required identity and market check is complete."}</span><div className="fbprops__checkgrid"><div className="fbprops__verify"><i>01</i><p><strong>PLAYER</strong><small>Identity, team and position.</small></p></div><div className="fbprops__verify"><i>02</i><p><strong>MARKET</strong><small>Real two-sided line and price.</small></p></div><div className="fbprops__verify"><i>03</i><p><strong>MODEL</strong><small>Trustworthy projection and edge.</small></p></div></div><div className="fbprops__future"><span>VERIFIED PROPS WILL INCLUDE</span><p>Player · market · posted price · projection · model edge</p></div></div>;
}

export default function FootballProps({ sport }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [planLoaded, setPlanLoaded] = useState(false);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(null);
  const guard = useRef(createLatestRequestGuard());
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite" || user?.email === "r7002g@gmail.com";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}).finally(() => setPlanLoaded(true)); }, []);
  useEffect(() => {
    setPayload(null); setDate(null);
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
  const groups = useMemo(() => eventDateGroups(props), [props]);
  const rows = date ? props.filter((prop) => prop.eventDate === date) : props;

  return (
    <TerminalShell active="/props" plan={plan} navigate={navigate}>
      <main className="fbprops"><style>{FOOTBALL_PROPS_CSS + EVENT_DATE_CSS + FOOTBALL_PROP_CARD_CSS}</style>
        <header className="fbprops__head">
          <div><span className="fbprops__eyebrow">{sport.toUpperCase()} · VERIFIED MARKETS ONLY</span><h1>Player Props</h1></div>
          <div className="fbprops__status"><i /> {sport === "nfl" ? "VERIFIED" : "IDENTITY GATED"}</div>
        </header>
        <p className="fbprops__intro">Only player lines with a verified player match, two-sided market price, and model projection appear here. Missing data never falls back to another sport.</p>

        {!planLoaded || loading ? <div className="fbprops__state">Loading verified {sport.toUpperCase()} props…</div>
          : !hasFull ? <div className="fbprops__lock"><span>LOCKED</span><h2>Football props are All-Access</h2><p>Verified model probabilities and posted prices, without cross-sport fallback.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>
          : <>
              <EventDateSelector groups={groups} value={date} onChange={setDate} label={`${sport.toUpperCase()} prop date`} />
              {rows.length === 0 ? <FootballPropsEmpty sport={sport} />
                : <section className="fbprops__grid" aria-label={`${sport.toUpperCase()} verified props`}>
                    {rows.map((prop) => <FootballPropCard prop={prop} key={`${prop.eventId}-${prop.player}-${prop.market}-${prop.line}`} />)}
                  </section>}
            </>}
      </main>
    </TerminalShell>
  );
}

export const FOOTBALL_PROPS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Manrope:wght@500;600;700;800&display=swap');
.fbprops{box-sizing:border-box;width:min(100% - 28px,920px);margin:0 auto;padding:18px 0 100px;color:#eeeae2;font-family:Manrope,Inter,system-ui,sans-serif;overflow-x:hidden}.fbprops *{box-sizing:border-box}.fbprops__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;border-bottom:1px solid #252620;padding-bottom:12px}.fbprops__eyebrow{font:700 8px/1.4 "IBM Plex Mono",monospace;letter-spacing:1.35px;color:#d2ad68}.fbprops h1{margin:6px 0 0;font:800 clamp(26px,6vw,35px)/1 Manrope,sans-serif;letter-spacing:-.75px}.fbprops__status{font:700 8px "IBM Plex Mono",monospace;letter-spacing:.8px;color:#777871;white-space:nowrap}.fbprops__status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#45d99d;margin-right:5px}.fbprops__intro{max-width:700px;margin:10px 0 15px;color:#85867f;font-size:10px;line-height:1.55}.fbprops__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fbprops__state,.fbprops__lock{border:1px solid #2b2c26;border-radius:8px;background:#101114;padding:20px 15px;text-align:center;color:#83847d}.fbprops__state--honest{display:flex;flex-direction:column;gap:7px;max-width:680px;margin:0 auto}.fbprops__emptyicon{width:35px;height:35px;border:1px solid rgba(210,173,104,.35);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 2px;color:#d2ad68;font-size:18px}.fbprops__state--honest>b{color:#eeeae2;font:800 18px/1.18 Manrope,sans-serif}.fbprops__state--honest>span{max-width:520px;margin:auto;font-size:9.5px;line-height:1.5}.fbprops__checkgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:7px;background:#292a24;border:1px solid #292a24}.fbprops__verify{display:grid;grid-template-columns:24px minmax(0,1fr);gap:6px;text-align:left;background:#0d0e10;padding:9px}.fbprops__verify i{font:700 8px "IBM Plex Mono",monospace;color:#d2ad68;font-style:normal}.fbprops__verify p{margin:0}.fbprops__verify strong,.fbprops__future span{display:block;font:700 7px "IBM Plex Mono",monospace;letter-spacing:.75px;color:#a4a49c}.fbprops__verify small{display:block;margin-top:3px;font-size:8px;line-height:1.35;color:#73746d}.fbprops__future{margin-top:2px;border:1px solid rgba(210,173,104,.25);border-radius:7px;background:rgba(210,173,104,.045);padding:9px 10px;text-align:left}.fbprops__future p{margin:4px 0 0;font-size:8.5px;line-height:1.45;color:#85867f}.fbprops__lock span{font:700 8px "IBM Plex Mono",monospace;letter-spacing:1.2px;color:#d2ad68}.fbprops__lock h2{margin:8px 0 6px;font:800 19px Manrope,sans-serif;color:#fff}.fbprops__lock p{margin:0 auto 14px;max-width:430px;font-size:10px;line-height:1.55}.fbprops__lock button{border:0;border-radius:7px;background:#d2ad68;color:#171207;padding:9px 13px;font-weight:800;cursor:pointer}@media(max-width:680px){.fbprops__head{align-items:flex-start}.fbprops__status{margin-top:5px}.fbprops__grid{grid-template-columns:1fr}.fbprops__intro{font-size:9.5px}}@media(max-width:390px){.fbprops__checkgrid{grid-template-columns:1fr}.fbprops__state{padding-left:12px;padding-right:12px}.fbprops__verify{grid-template-columns:24px minmax(0,1fr)}}@media(max-width:360px){.fbprops{width:calc(100% - 20px)}.fbprops__head{gap:8px}.fbprops__status{font-size:7px}.fbprops__state--honest>b{font-size:16px}}`;
