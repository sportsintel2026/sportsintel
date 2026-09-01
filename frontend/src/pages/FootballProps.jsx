import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { footballPropsApi, subscriptionApi } from "../lib/api";
import { chooseEventDate, createLatestRequestGuard, eventDateGroups, scopeProps } from "../lib/eventSlate";
import EventDateSelector, { EVENT_DATE_CSS } from "../components/EventDateSelector";
import FootballPropCard, { FOOTBALL_PROP_CARD_CSS } from "../components/FootballPropCard";
import TerminalShell from "./TerminalShell";

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
      <main className="fbprops"><style>{CSS + EVENT_DATE_CSS + FOOTBALL_PROP_CARD_CSS}</style>
        <header className="fbprops__head">
          <div><span className="fbprops__eyebrow">{sport.toUpperCase()} · verified markets</span><h1>Player Props</h1></div>
          <div className="fbprops__status"><i /> {sport === "nfl" ? "SHADOW MODEL" : "IDENTITY GATED"}</div>
        </header>
        <p className="fbprops__intro">Only player lines with a verified player match, two-sided market price, and model projection appear here. Missing data never falls back to another sport.</p>

        {!planLoaded || loading ? <div className="fbprops__state">Loading verified {sport.toUpperCase()} props…</div>
          : !hasFull ? <div className="fbprops__lock"><span>LOCKED</span><h2>Football props are All-Access</h2><p>Verified model probabilities and posted prices, without cross-sport fallback.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>
          : <>
              <EventDateSelector groups={groups} value={date} onChange={setDate} label={`${sport.toUpperCase()} prop date`} />
              {rows.length === 0 ? <div className="fbprops__state fbprops__state--honest"><b>No verified {sport.toUpperCase()} player props available for this slate.</b><span>{sport === "cfb" ? "CFB props stay empty until player identity, a two-sided line, and a trustworthy projection can all be verified." : "NFL props appear after the existing daily shadow run finds posted two-sided lines and exact player matches."}</span></div>
                : <section className="fbprops__grid" aria-label={`${sport.toUpperCase()} verified props`}>
                    {rows.map((prop) => <FootballPropCard prop={prop} key={`${prop.eventId}-${prop.player}-${prop.market}-${prop.line}`} />)}
                  </section>}
            </>}
      </main>
    </TerminalShell>
  );
}

const CSS = `
.fbprops{box-sizing:border-box;width:100%;max-width:1180px;margin:0 auto;padding:28px clamp(14px,3vw,34px) 110px;color:#e8ecef;font-family:Inter,system-ui,sans-serif;overflow-x:hidden}.fbprops *{box-sizing:border-box}.fbprops__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;border-bottom:1px solid #202930;padding-bottom:16px}.fbprops__eyebrow{font:700 9px/1.4 "IBM Plex Mono",monospace;letter-spacing:1.4px;color:#C9A86A}.fbprops h1{margin:5px 0 0;font:800 clamp(30px,5vw,48px)/.95 "Barlow Condensed",sans-serif}.fbprops__status{font:700 9px "IBM Plex Mono",monospace;letter-spacing:.8px;color:#81909b;white-space:nowrap}.fbprops__status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#29c68c;margin-right:5px}.fbprops__intro{max-width:720px;margin:14px 0 18px;color:#8d9aa4;font-size:12.5px;line-height:1.6}.fbprops__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fbprops__state,.fbprops__lock{border:1px solid #222c33;border-radius:14px;background:#101519;padding:38px 18px;text-align:center;color:#86939d}.fbprops__state--honest{display:flex;flex-direction:column;gap:8px}.fbprops__state--honest b{color:#e8ecef;font:800 20px "Barlow Condensed",sans-serif}.fbprops__state--honest span{max-width:540px;margin:auto;font-size:12px;line-height:1.6}.fbprops__lock span{font:700 9px "IBM Plex Mono",monospace;letter-spacing:1.2px;color:#C9A86A}.fbprops__lock h2{margin:8px 0 6px;font:800 24px "Barlow Condensed",sans-serif;color:#fff}.fbprops__lock p{margin:0 auto 16px;max-width:430px;font-size:12px;line-height:1.6}.fbprops__lock button{border:0;border-radius:9px;background:#C9A86A;color:#171207;padding:11px 16px;font-weight:800;cursor:pointer}@media(max-width:640px){.fbprops{padding-top:18px}.fbprops__head{align-items:flex-start}.fbprops__status{margin-top:5px}.fbprops__grid{grid-template-columns:1fr}.fbprops__intro{font-size:12px}}@media(max-width:360px){.fbprops{padding-left:10px;padding-right:10px}.fbprops__head{gap:8px}.fbprops__status{font-size:8px}}`;
