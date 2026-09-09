import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { footballPropsApi, subscriptionApi } from "../lib/api";
import { chooseEventDate, createLatestRequestGuard, eventDateGroups, formatEventDate, scopeProps } from "../lib/eventSlate";
import { availableFootballPropFamilies, filterFootballProps, footballPropBoardRows } from "../lib/footballPropMarkets";
import EventDateSelector, { EVENT_DATE_CSS } from "../components/EventDateSelector";
import FootballPropCard, { FOOTBALL_PROP_CARD_COMPACT_CSS, FOOTBALL_PROP_CARD_CSS } from "../components/FootballPropCard";
import TerminalShell from "./TerminalShell";

const tdOdds = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value) > 0 ? `+${value}` : String(value);

function TdSelectionPortrait({ row }) {
  const [failed, setFailed] = useState(false);
  const initials = String(row.player || "Player").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className={`fbprops__tdportrait${!row.headshot || failed ? " is-fallback" : ""}`}>
    <span>{initials}</span>
    {row.headshot && !failed && <img src={row.headshot} alt={`${row.player} headshot`} onError={() => setFailed(true)} />}
  </div>;
}

function tdEventTime(row) {
  const date = new Date(row.commenceTime);
  if (Number.isNaN(date.getTime())) return formatEventDate(row.eventDate, { compact: true });
  return date.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  });
}

function TdSelectionCard({ row }) {
  return <article className="fbprops__tdcard">
    <div className="fbprops__tdidentity"><TdSelectionPortrait row={row} /><div><span>{row.position || "VERIFIED PLAYER"} · {row.team}</span><h3>{row.player}</h3><p>{row.team} · vs {row.opponent}</p></div></div>
    <div className="fbprops__tdmarket"><span>ANYTIME TD</span><b>{tdOdds(row.bestPrice)}</b><small>{row.bestBook}</small></div>
    <ul className="fbprops__tdreasons">{(row.reasons || []).slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <footer><span>WIZEPICKS ANYTIME TD</span><i />{tdEventTime(row)}{row.availabilityStatus && <><i /><b>{row.availabilityStatus}</b></>}</footer>
  </article>;
}

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
  const [board, setBoard] = useState("modeled");
  const [family, setFamily] = useState("all");
  const guard = useRef(createLatestRequestGuard());
  const isNfl = sport === "nfl";
  const hasFull = plan.isAdmin === true || plan.tier === "pro" || plan.tier === "elite" || user?.email === "r7002g@gmail.com";

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}).finally(() => setPlanLoaded(true)); }, []);
  useEffect(() => {
    setPayload(null); setDate(null); setBoard("modeled"); setFamily("all");
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
  const modeledRows = useMemo(() => isNfl ? footballPropBoardRows(dateRows, "modeled") : [], [dateRows, isNfl]);
  const marketRows = useMemo(() => isNfl ? footballPropBoardRows(dateRows, "markets") : [], [dateRows, isNfl]);
  const boardRows = isNfl ? (board === "markets" ? marketRows : modeledRows) : dateRows;
  const families = useMemo(() => availableFootballPropFamilies({ props: boardRows }), [boardRows]);
  const rows = filterFootballProps(boardRows, family);
  const tdSelections = useMemo(() => (isNfl ? (payload?.tdSelections || []) : [])
    .filter((row) => !date || row.eventDate === date), [payload, date, isNfl]);
  const gameCount = useMemo(() => new Set(dateRows.map((prop) => String(prop.eventId || prop.matchup))).size, [dateRows]);
  const modelCount = useMemo(() => dateRows.filter((prop) => [prop.projection, prop.modelOverProb, prop.modelEdge].every((value) => value != null && Number.isFinite(Number(value)))).length, [dateRows]);
  const isTdFocus = isNfl && board === "markets" && family === "touchdowns" && tdSelections.length > 0;
  useEffect(() => {
    if (families.length > 0 && !families.some((item) => item.key === family)) setFamily("all");
  }, [families, family]);
  const selectBoard = (next) => { setBoard(next); setFamily("all"); };

  return (
    <TerminalShell active="/props" plan={plan} navigate={navigate}>
      <main className={`fbprops${isTdFocus ? " is-td-focus" : ""}`}><style>{FOOTBALL_PROPS_CSS + (isNfl ? FOOTBALL_PROPS_OVERRIDE_CSS : "") + EVENT_DATE_CSS + FOOTBALL_PROP_CARD_CSS + (isNfl ? FOOTBALL_PROP_CARD_COMPACT_CSS : "")}</style>
        <header className="fbprops__head">
          <div><span className="fbprops__eyebrow">{sport.toUpperCase()} · VERIFIED MARKETS ONLY</span><h1>Player Props</h1></div>
          <div className="fbprops__status"><i /> {sport === "nfl" ? "VERIFIED" : "IDENTITY GATED"}</div>
        </header>
        <p className="fbprops__intro">{isNfl ? "Modeled Props contain identity-verified core markets with complete projection, probability, market baseline, and edge context. They are model measurements—not threshold-qualified WizePicks picks. Broader sportsbook offers stay separate as verified market data." : "Only player lines with verified identity and sportsbook-aligned market data appear here. WizePicks projections appear only for markets the active model scores; missing data never falls back to another sport."}</p>

        {!planLoaded || loading ? <div className="fbprops__state">Loading verified {sport.toUpperCase()} props…</div>
          : !hasFull ? <div className="fbprops__lock"><span>LOCKED</span><h2>Football props are All-Access</h2><p>Verified model probabilities and posted prices, without cross-sport fallback.</p><button onClick={() => navigate("/pricing")}>Unlock All-Access</button></div>
          : <>
              <EventDateSelector groups={groups} value={date} onChange={setDate} label={`${sport.toUpperCase()} prop date`} />
              <div className="fbprops__slate">
                <h2>{date ? formatEventDate(date) : `${sport.toUpperCase()} PROP SLATE`}</h2>
                <p>{dateRows.length} verified market{dateRows.length === 1 ? "" : "s"} <i /> {gameCount} game{gameCount === 1 ? "" : "s"} <i /> <b>{isNfl ? `${modeledRows.length} modeled prop${modeledRows.length === 1 ? "" : "s"}` : `${modelCount} model edge${modelCount === 1 ? "" : "s"}`}</b></p>
              </div>
              {isNfl && <div className="fbprops__boards" role="tablist" aria-label={`${sport.toUpperCase()} prop view`}>
                <button type="button" role="tab" aria-selected={board === "modeled"} className={board === "modeled" ? "is-active" : ""} onClick={() => selectBoard("modeled")}><span>Modeled Props</span><b>{modeledRows.length}</b></button>
                <button type="button" role="tab" aria-selected={board === "markets"} className={board === "markets" ? "is-active" : ""} onClick={() => selectBoard("markets")}><span>Verified Markets</span><b>{marketRows.length}</b></button>
              </div>}
              {families.length > 0 && <div className="fbprops__markets" role="tablist" aria-label={`${sport.toUpperCase()} prop markets`}>
                {families.map((item) => <button type="button" role="tab" aria-selected={family === item.key} className={family === item.key ? "is-active" : ""} key={item.key} onClick={() => setFamily(item.key)}>{item.label}</button>)}
              </div>}
              {families.length > 0 && !(isNfl && board === "markets" && family === "touchdowns" && tdSelections.length > 0) && <div className="fbprops__rank"><span><i>▥</i> {isNfl ? (board === "modeled" ? "MODEL EDGE · NOT A QUALIFIED PICK" : "MARKET ONLY") : "MODEL %"}</span><small>{isNfl ? (board === "modeled" ? "Direction is a model lean; no validated selection cutoff exists" : "No WizePicks recommendation is implied") : "Sportsbook and price shown as verified support data"}</small></div>}
              {isNfl && board === "markets" && family === "touchdowns" && tdSelections.length > 0 && <section className="fbprops__tdrankings" aria-label="WizePicks Anytime TD selections">
                <header><div><span>SCORER STRENGTH + MARKET VALUE</span><h2>WizePicks Anytime TD</h2></div><p>A short list that stands out on scoring context and verified market price. No calibrated probability, model edge, or EV.</p></header>
                <div>{tdSelections.map((row) => <TdSelectionCard row={row} key={`${row.eventId}-${row.playerId}`} />)}</div>
                <h3 className="fbprops__verifiedlabel">Verified Markets</h3>
              </section>}
              {rows.length === 0 ? (props.length === 0 ? <FootballPropsEmpty sport={sport} /> : isNfl ? <div className="fbprops__state fbprops__state--market"><b>{board === "modeled" ? `No fully modeled ${sport.toUpperCase()} props for this event day.` : `No verified ${families.find((item) => item.key === family)?.label || "market-only"} props for this event day.`}</b><span>{board === "modeled" ? "Verified sportsbook markets remain available without being mislabeled as model recommendations." : "Other verified market families remain available above."}</span>{board === "modeled" && marketRows.length > 0 && <button type="button" onClick={() => selectBoard("markets")}>Browse Verified Markets</button>}</div> : <div className="fbprops__state fbprops__state--market"><b>No verified {families.find((item) => item.key === family)?.label || "selected"} props for this event day.</b><span>Other verified market families remain available above.</span></div>)
                : <section className="fbprops__grid" aria-label={`${sport.toUpperCase()} verified props`}>
                    {rows.map((prop) => <FootballPropCard sport={sport} prop={prop} compact={isNfl} modelContext={isNfl && board === "modeled"} key={`${prop.eventId}-${prop.player}-${prop.market}-${prop.line}`} />)}
                  </section>}
            </>}
      </main>
    </TerminalShell>
  );
}

const FOOTBALL_PROPS_OVERRIDE_CSS = `
.fbprops .event-date{margin:7px 0 9px}
.fbprops .event-date__rail{border-color:#3d403a;background:#0d1011}
.fbprops .event-date__tab{display:flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:5px 8px}
.fbprops .event-date__tab span{font-size:7px}
.fbprops .event-date__tab strong{margin:0;font-size:14px}
.fbprops .event-date__tab.is-active{background:linear-gradient(180deg,rgba(210,173,104,.14),rgba(210,173,104,.035));box-shadow:inset 0 -2px #d2ad68}
.fbprops .event-date__tab.is-active span,.fbprops .event-date__tab.is-active strong{color:#e8c675}
.fbprops__slate{margin-bottom:10px}
.fbprops__boards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:0 0 7px}
.fbprops__boards button{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:9px;min-width:0;border:1px solid #32352f;border-radius:7px;background:#0d1011;padding:8px 10px;color:#858780;font:700 8px/1 "IBM Plex Mono",monospace;letter-spacing:.35px;text-transform:uppercase;cursor:pointer}
.fbprops__boards button b{display:grid;place-items:center;min-width:20px;height:18px;padding:0 5px;border-radius:9px;background:#1b1e1b;color:#a6a79f;font:800 8px Manrope,sans-serif}
.fbprops__boards button.is-active{border-color:#d2ad68;background:linear-gradient(135deg,rgba(210,173,104,.17),#101312);color:#f1eadc}
.fbprops__boards button.is-active b{background:#d2ad68;color:#191307}
.fbprops__markets{margin-bottom:7px}
.fbprops__markets button{padding-top:8px;padding-bottom:8px}
.fbprops__rank{margin-bottom:7px}
.fbprops__rank>span{padding:6px 9px;font-size:7px}
.fbprops__grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.fbprops__state--market{align-items:center;gap:6px}
.fbprops__state--market button{margin-top:5px;border:1px solid #d2ad68;border-radius:6px;background:rgba(210,173,104,.1);color:#e8c675;padding:7px 10px;font:700 8px "IBM Plex Mono",monospace;text-transform:uppercase;cursor:pointer}
.fbprops.is-td-focus .fbprops__rank{display:none}
.fbprops__tdrankings{position:relative;margin:2px 0 12px;padding:10px 10px 9px;border:1px solid rgba(210,173,104,.46);border-radius:9px;background:radial-gradient(circle at 6% 0,rgba(210,173,104,.09),transparent 34%),linear-gradient(145deg,rgba(16,19,19,.96),rgba(8,10,11,.98));box-shadow:0 10px 30px rgba(0,0,0,.22)}
.fbprops__tdrankings:before{content:"";position:absolute;inset:0 0 auto;height:2px;border-radius:9px 9px 0 0;background:linear-gradient(90deg,#d2ad68 0 48%,#43dd88)}
.fbprops__tdrankings>header{display:flex;align-items:end;justify-content:space-between;gap:18px;margin:0 1px 9px}
.fbprops__tdrankings>header span{color:#d2ad68;font:700 6px "IBM Plex Mono",monospace;letter-spacing:.8px}
.fbprops__tdrankings>header h2{margin:3px 0 0;color:#f6f1e7;font:800 21px/1 Manrope,sans-serif;letter-spacing:-.35px}
.fbprops__tdrankings>header p{max-width:410px;margin:0;color:#92948c;font:600 7px/1.4 "IBM Plex Mono",monospace;text-align:right}
.fbprops__tdrankings>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.fbprops__tdcard{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 112px;border:1px solid rgba(210,173,104,.48);border-radius:8px;background:radial-gradient(circle at 88% 18%,rgba(67,221,136,.055),transparent 34%),linear-gradient(135deg,#131718,#090b0c);overflow:hidden}
.fbprops__tdcard:before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,#d2ad68,rgba(210,173,104,.16),#43dd88)}
.fbprops__tdidentity{display:grid;grid-template-columns:46px minmax(0,1fr);align-items:center;gap:8px;min-width:0;padding:8px}
.fbprops__tdportrait{position:relative;width:44px;height:44px;border:1px solid #627066;border-radius:50%;overflow:hidden;background:#15201b;box-shadow:0 0 16px rgba(67,221,136,.08)}
.fbprops__tdportrait span{position:absolute;inset:0;display:grid;place-items:center;color:#d2ad68;font:800 13px Manrope,sans-serif}
.fbprops__tdportrait img{position:relative;z-index:1;width:100%;height:100%;object-fit:cover;object-position:50% 12%}
.fbprops__tdidentity>div{min-width:0}
.fbprops__tdidentity span,.fbprops__tdmarket span{display:block;color:#8a8c84;font:700 5.5px "IBM Plex Mono",monospace;letter-spacing:.45px}
.fbprops__tdidentity h3{margin:3px 0;color:#fffaf0;font:800 15px/1 Manrope,sans-serif;overflow-wrap:anywhere}
.fbprops__tdidentity p{margin:0;color:#85877f;font:600 6px "IBM Plex Mono",monospace;overflow-wrap:anywhere}
.fbprops__tdmarket{grid-column:2;grid-row:1;display:flex;flex-direction:column;justify-content:center;border-left:1px solid #32362f;padding:7px;text-align:center}
.fbprops__tdmarket span{color:#43dd88}
.fbprops__tdmarket b{margin-top:4px;color:#f0ca70;font:800 21px/1 "Barlow Condensed",sans-serif}
.fbprops__tdmarket small{margin-top:4px;color:#aaa99f;font:700 5.5px "IBM Plex Mono",monospace}
.fbprops__tdreasons{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin:0;padding:0;border-top:1px solid #2b2e2a;background:#2b2e2a;list-style:none}
.fbprops__tdreasons li{min-width:0;background:#0b0e0f;padding:7px 8px;color:#a9aaa3;font:600 7px/1.35 "IBM Plex Mono",monospace}
.fbprops__tdreasons li:before{content:"◆";margin-right:5px;color:#43dd88;font-size:5px}
.fbprops__tdcard footer{grid-column:1/-1;display:flex;align-items:center;gap:6px;padding:4px 7px;border-top:1px solid #272a27;color:#7f8179;font:600 5.5px "IBM Plex Mono",monospace;text-transform:uppercase}
.fbprops__tdcard footer span{color:#d2ad68}
.fbprops__tdcard footer b{color:#d8a55e;font-weight:700}
.fbprops__tdcard footer i{width:3px;height:3px;border-radius:50%;background:#4c4f49}
.fbprops__verifiedlabel{display:flex;align-items:center;gap:8px;margin:11px 0 0;color:#777a73;font:700 6.5px "IBM Plex Mono",monospace;letter-spacing:.8px;text-transform:uppercase}
.fbprops__verifiedlabel:after{content:"";height:1px;flex:1;background:#2d302c}
.fbprops__tdrankings+.fbprops__grid{opacity:.72}
@media(max-width:760px){.fbprops__grid,.fbprops__tdrankings>div{grid-template-columns:1fr}}
@media(max-width:430px){.fbprops{padding-top:10px}.fbprops__head{padding-bottom:5px}.fbprops__intro{margin:3px 0 8px;line-height:1.42}.fbprops .event-date{margin:5px 0 7px}.fbprops .event-date__tab{min-height:30px;padding:4px 6px}.fbprops .event-date__tab strong{font-size:13px}.fbprops__slate{margin-bottom:8px}.fbprops__slate h2{font-size:17px}.fbprops__slate p{font-size:7.1px}.fbprops__boards button{padding:7px 8px;font-size:7px}.fbprops__markets button{padding-top:7px;padding-bottom:7px}.fbprops__rank{margin-bottom:6px}.fbprops__tdrankings{padding:9px 7px 7px}.fbprops__tdrankings>header{display:block;margin-bottom:7px}.fbprops__tdrankings>header h2{font-size:20px}.fbprops__tdrankings>header p{margin-top:4px;text-align:left}.fbprops__tdcard{grid-template-columns:minmax(0,1fr) 90px}.fbprops__tdidentity{grid-template-columns:42px minmax(0,1fr);gap:7px;padding:7px}.fbprops__tdportrait{width:40px;height:40px}.fbprops__tdidentity h3{font-size:14px}.fbprops__tdmarket b{font-size:17px}.fbprops__tdreasons{grid-template-columns:1fr}.fbprops__tdreasons li{padding:5px 7px;font-size:6px}.fbprops__tdcard footer{white-space:normal}}
@media(max-width:350px){.fbprops__boards button{font-size:6.5px}}
`;

export const FOOTBALL_PROPS_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@500;600;700&family=Manrope:wght@500;600;700;800&display=swap');
.fbprops{box-sizing:border-box;width:min(100% - 28px,920px);margin:0 auto;padding:16px 0 104px;color:#eeeae2;font-family:Manrope,Inter,system-ui,sans-serif;overflow-x:hidden}.fbprops *{box-sizing:border-box}.fbprops__head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:2px 0 8px}.fbprops__eyebrow{font:700 8px/1.4 "IBM Plex Mono",monospace;letter-spacing:1.35px;color:#d2ad68}.fbprops h1{margin:5px 0 0;font:800 clamp(25px,5vw,34px)/1 Manrope,sans-serif;letter-spacing:-.75px}.fbprops__status{font:700 8px "IBM Plex Mono",monospace;letter-spacing:.8px;color:#777871;white-space:nowrap}.fbprops__status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#45d99d;margin-right:5px;box-shadow:0 0 10px rgba(69,217,157,.45)}.fbprops__intro{max-width:760px;margin:5px 0 13px;color:#85867f;font-size:9px;line-height:1.55}.fbprops .event-date{margin:11px 0 14px}.fbprops .event-date__rail{width:100%;max-width:100%;border-color:#34352f}.fbprops .event-date__tab{flex:1 0 76px;min-width:76px;padding:8px}.fbprops .event-date__tab strong{font-size:17px}.fbprops__slate{margin:0 1px 13px}.fbprops__slate h2{margin:0;font:800 20px/1.1 Manrope,sans-serif;letter-spacing:.1px;text-transform:uppercase}.fbprops__slate p{display:flex;align-items:center;gap:7px;margin:5px 0 0;color:#92938c;font:600 9px/1.35 "IBM Plex Mono",monospace}.fbprops__slate p i{width:3px;height:3px;border-radius:50%;background:#d2ad68}.fbprops__slate p b{color:#d2ad68;font-weight:700}.fbprops__markets{display:flex;max-width:100%;margin:0 0 10px;border:1px solid #3b3d38;border-radius:8px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;scrollbar-width:none;background:#0d0f10}.fbprops__markets::-webkit-scrollbar{display:none}.fbprops__markets button{appearance:none;position:relative;flex:1 0 auto;min-width:84px;scroll-snap-align:start;border:0;border-radius:0;background:linear-gradient(180deg,#15171a,#0e1012);color:#a2a39d;padding:10px 13px;font:700 8px/1 "IBM Plex Mono",monospace;letter-spacing:.45px;text-transform:uppercase;cursor:pointer}.fbprops__markets button+button{border-left:1px solid #30322e}.fbprops__markets button.is-active{background:linear-gradient(135deg,#e8c675,#c99945);color:#181208;box-shadow:inset 0 0 0 1px rgba(255,235,175,.4),0 0 18px rgba(210,173,104,.12)}.fbprops__rank{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.fbprops__rank>span{display:flex;align-items:center;gap:7px;border:1px solid #383b36;border-radius:6px;background:#101315;padding:7px 10px;color:#dcddd6;font:700 8px "IBM Plex Mono",monospace}.fbprops__rank>span i{color:#d2ad68;font-style:normal}.fbprops__rank small{color:#74766f;font:600 7px "IBM Plex Mono",monospace;text-align:right}.fbprops__grid{display:grid;grid-template-columns:1fr;gap:9px}.fbprops__state,.fbprops__lock{border:1px solid #2b2c26;border-radius:8px;background:#101114;padding:24px 16px;text-align:center;color:#83847d}.fbprops__state--market{display:flex;flex-direction:column;gap:5px}.fbprops__state--market b{color:#eeeae2;font-size:13px}.fbprops__state--market span{font-size:9px}.fbprops__lock span{font:700 8px "IBM Plex Mono",monospace;letter-spacing:1.2px;color:#d2ad68}.fbprops__lock h2{margin:8px 0 6px;font:800 19px Manrope,sans-serif;color:#fff}.fbprops__lock p{margin:0 auto 14px;max-width:430px;font-size:10px;line-height:1.55}.fbprops__lock button{border:0;border-radius:7px;background:#d2ad68;color:#171207;padding:9px 13px;font-weight:800;cursor:pointer}.fbprops__empty{max-width:820px;margin:6px auto 0;text-align:center;padding:18px 4px 4px}.fbprops__emptyicon{position:relative;width:74px;height:84px;margin:0 auto 12px;border:2px solid #d2ad68;border-radius:14px;color:#d2ad68;box-shadow:0 0 22px rgba(210,173,104,.07)}.fbprops__emptyicon span{position:absolute;inset:13px 13px auto;height:24px;border:2px solid currentColor;border-radius:50%;font-size:0}.fbprops__emptyicon span:after{content:"";position:absolute;top:21px;left:50%;width:38px;height:23px;border:2px solid currentColor;border-bottom:0;border-radius:22px 22px 0 0;transform:translateX(-50%)}.fbprops__emptyicon i{position:absolute;right:-10px;bottom:8px;width:31px;height:31px;display:grid;place-items:center;border:2px solid #d2ad68;border-radius:50%;background:#090a0c;color:#d2ad68;font-size:13px;font-style:normal}.fbprops__empty h2{margin:0;color:#f4f0e8;font:800 21px/1.18 Manrope,sans-serif}.fbprops__empty>p{max-width:540px;margin:9px auto 17px;color:#95968f;font-size:10px;line-height:1.55}.fbprops__checks{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin:0 auto 17px}.fbprops__checks>div{min-width:0}.fbprops__checks b{display:block;color:#d2ad68;font:800 10px "IBM Plex Mono",monospace}.fbprops__checks i{display:block;width:15px;height:15px;margin:7px auto;border:1px solid #6a6b65;border-radius:50%}.fbprops__checks span{display:block;color:#bebeb7;font:600 6.5px/1.35 "IBM Plex Mono",monospace;overflow-wrap:anywhere}.fbprops__future{border:1px solid rgba(210,173,104,.63);border-radius:9px;background:linear-gradient(135deg,rgba(210,173,104,.045),rgba(15,17,19,.96));padding:12px 15px;text-align:left}.fbprops__future h3{margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #34352f;color:#d2ad68;font:800 10px "IBM Plex Mono",monospace;letter-spacing:.8px}.fbprops__future>div{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px;gap:7px 12px;color:#95968f;font-size:9px}.fbprops__future b{color:#777871;text-align:right}.fbprops__emptyfoot{display:flex;align-items:center;gap:10px;max-width:580px;margin:13px auto 0;text-align:left;color:#92938d;font-size:9px;line-height:1.4}.fbprops__emptyfoot i{color:#d2ad68;font-size:19px;font-style:normal}.fbprops__emptyfoot span{min-width:0}@media(max-width:760px){.fbprops__head{align-items:flex-start}.fbprops__status{margin-top:5px}.fbprops__intro{font-size:9px}.fbprops__rank small{max-width:190px}.fbprops__checks{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:430px){.fbprops{width:calc(100% - 22px);padding-top:12px}.fbprops__head{gap:8px}.fbprops__status{font-size:7px}.fbprops__intro{margin-bottom:10px}.fbprops .event-date{margin-top:8px}.fbprops__slate h2{font-size:18px}.fbprops__slate p{gap:5px;font-size:7.3px;white-space:nowrap}.fbprops__markets button{min-width:74px;padding:9px 10px}.fbprops__rank small{display:none}.fbprops__empty{padding-top:14px}.fbprops__empty h2{font-size:18px}.fbprops__checks{grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 4px}.fbprops__checks>div:last-child{grid-column:2}.fbprops__future{padding:11px}.fbprops__future>div{gap:7px 8px;font-size:8px}.fbprops__state{padding-left:12px;padding-right:12px}}@media(max-width:350px){.fbprops{width:calc(100% - 18px)}.fbprops h1{font-size:23px}.fbprops__status{font-size:6.5px}.fbprops__slate p{font-size:6.7px}.fbprops__markets button{min-width:68px;padding-left:8px;padding-right:8px}.fbprops__empty h2{font-size:17px}}`;
