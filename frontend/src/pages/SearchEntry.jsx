import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TeamLogo, { TEAM_LOGO_CSS } from "../components/TeamLogo";
import { edgesApi } from "../lib/api";
import { easternDate, eventDateKey, formatEventDate } from "../lib/eventSlate";
import { SEARCH_ENTRY_LIST, SEARCH_ENTRY_PAGES } from "../lib/searchEntryConfig";
import { seoPhase2ForSport } from "../lib/seoPhase2Config";
import { useSeo } from "../hooks/useSeo";

const LOAD = {
  nfl: () => edgesApi.getNFL(),
  cfb: () => edgesApi.getCFB(),
  mlb: () => edgesApi.getMLB(),
};
const SPORT_NAME = { nfl: "NFL", cfb: "College Football", mlb: "MLB" };
const START_WORD = { nfl: "Kickoff", cfb: "Kickoff", mlb: "First pitch" };
const requestCache = new Map();

function loadSlate(sport) {
  const cached = requestCache.get(sport);
  if (cached && Date.now() - cached.at < 120000) return cached.promise;
  const promise = LOAD[sport]();
  requestCache.set(sport, { at: Date.now(), promise });
  promise.catch(() => requestCache.delete(sport));
  return promise;
}

function useStructuredData(config) {
  useEffect(() => {
    const id = "wize-search-entry-jsonld";
    const previous = document.getElementById(id);
    if (previous) previous.remove();
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          "@id": `https://www.wizepicks.com${config.path}#page`,
          url: `https://www.wizepicks.com${config.path}`,
          name: config.title,
          description: config.description,
          isPartOf: { "@id": "https://www.wizepicks.com/#website" },
          about: { "@type": "Thing", name: config.h1 },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "WizePicks", item: "https://www.wizepicks.com/" },
            { "@type": "ListItem", position: 2, name: config.h1, item: `https://www.wizepicks.com${config.path}` },
          ],
        },
      ],
    });
    document.head.appendChild(script);
    return () => script.remove();
  }, [config]);
}

function splitMatchup(game) {
  const raw = String(game?.matchup || "");
  const parts = raw.split(" @ ");
  return {
    away: game?.awayTeam || game?.away || parts[0] || "Away",
    home: game?.homeTeam || game?.home || parts[1] || "Home",
  };
}

function gameId(game) {
  return String(game?.eventId ?? game?.gameId ?? game?.id ?? "");
}

function gameStart(game, sport) {
  const value = game?.commenceTime || game?.startTimeUTC || null;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: "America/New_York", timeZoneName: "short",
      });
    }
  }
  return game?.time ? `${START_WORD[sport]} ${game.time}` : `${START_WORD[sport]} to be announced`;
}

function slateDate(feed) {
  if (feed?.date) return feed.date;
  if (feed?.weekWindow?.fromISO) return eventDateKey({ commenceTime: feed.weekWindow.fromISO });
  const first = (feed?.games || [])[0];
  return first ? eventDateKey(first) : null;
}

function bookNames(value, into = new Set()) {
  if (!value || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value)) {
    if (/book$/i.test(key) && typeof child === "string" && child.trim()) into.add(child.trim());
    else if (child && typeof child === "object") bookNames(child, into);
  }
  return into;
}

function publicEdges(feed, sport) {
  if (!feed || feed.teaser) return [];
  if (sport === "nfl" || sport === "cfb") return (feed.edges || []).slice(0, 4);
  return [
    ...(feed.moneylineEdges || []).map((row) => ({ ...row, market: "moneyline" })),
    ...(feed.runLineEdges || []).map((row) => ({ ...row, market: "run line" })),
    ...(feed.totalsEdges || []).map((row) => ({ ...row, market: "total" })),
  ].slice(0, 4);
}

function formatEdge(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function Slates({ sport, feed, loading, error }) {
  const games = (feed?.games || []).slice(0, 6);
  const date = slateDate(feed);
  const edges = publicEdges(feed, sport);
  const edgeByMatchup = new Map(edges.map((edge) => [String(edge.matchup || ""), edge]));
  const allBooks = [...bookNames({
    marketByGame: feed?.marketByGame || {},
    gameMarkets: (feed?.games || []).map((game) => game?.marketBooks || null),
    edges,
  })];

  return (
    <section className="se-slate" aria-labelledby={`se-${sport}-heading`}>
      <div className="se-section-head">
        <div>
          <span>{SPORT_NAME[sport]} CURRENT SLATE</span>
          <h2 id={`se-${sport}-heading`}>{date ? formatEventDate(date) : "Upcoming event-day board"}</h2>
        </div>
        <div className="se-count">{loading ? "LOADING" : `${games.length} GAME${games.length === 1 ? "" : "S"}`}</div>
      </div>

      {loading ? <div className="se-state">Loading the current public-safe slate…</div> : error ? (
        <div className="se-state">The live slate is temporarily unavailable. The page remains public; try again shortly.</div>
      ) : games.length === 0 ? (
        <div className="se-state">No active {SPORT_NAME[sport]} event-day slate is published right now. WizePicks advances when the next eligible slate enters the board window.</div>
      ) : (
        <div className="se-games">
          {games.map((game) => {
            const teams = splitMatchup(game);
            const edge = edgeByMatchup.get(String(game.matchup || `${teams.away} @ ${teams.home}`));
            const books = [...bookNames(game.marketBooks || {})].slice(0, 2);
            return (
              <article className="se-game" key={gameId(game) || `${teams.away}-${teams.home}`}>
                <div className="se-time">{gameStart(game, sport)}</div>
                <div className="se-teamrow">
                  <TeamLogo sport={sport} team={teams.away} abbr={game?.awayAbbr} logoId={game?.teamIdentity?.away?.id || game?.awayId} />
                  <div><b>{teams.away}</b><span>at</span><b>{teams.home}</b></div>
                  <TeamLogo sport={sport} team={teams.home} abbr={game?.homeAbbr} logoId={game?.teamIdentity?.home?.id || game?.homeId} />
                </div>
                <div className="se-market">
                  {edge ? <><strong>{edge.pick || edge.teamAbbr || edge.side} · {edge.market}</strong><span>{formatEdge(edge.edge)} model edge{edge.book ? ` · ${edge.book}` : ""}</span></>
                    : <><strong>{feed?.teaser ? "Public slate preview" : "No qualified edge published"}</strong><span>{books.length ? `Tracking ${books.join(" and ")}` : "Model details follow current access rules"}</span></>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="se-summary">
        <div><b>{games.length}</b><span>games on this board</span></div>
        <div><b>{error ? "—" : feed?.teaser ? "LOCKED" : edges.length}</b><span>{error ? "data temporarily unavailable" : feed?.teaser ? "protected pick details" : "qualified edges shown"}</span></div>
        <div><b>{error ? "—" : allBooks.length || "LIVE"}</b><span>{error ? "retry shortly" : allBooks.length ? "sportsbooks represented" : "market context"}</span></div>
      </div>
    </section>
  );
}

export default function SearchEntryPage({ pageKey }) {
  const config = SEARCH_ENTRY_PAGES[pageKey];
  const [state, setState] = useState(() => Object.fromEntries(config.sports.map((sport) => [sport, { loading: true, feed: null, error: null }])));
  useSeo({ title: config.title, description: config.description, path: config.path });
  useStructuredData(config);

  useEffect(() => {
    let alive = true;
    for (const sport of config.sports) {
      loadSlate(sport).then((feed) => {
        if (alive) setState((old) => ({ ...old, [sport]: { loading: false, feed: feed || {}, error: null } }));
      }).catch((error) => {
        if (alive) setState((old) => ({ ...old, [sport]: { loading: false, feed: null, error } }));
      });
    }
    return () => { alive = false; };
  }, [config]);

  const currentLabel = useMemo(() => {
    const dates = config.sports.map((sport) => slateDate(state[sport]?.feed)).filter(Boolean).sort();
    if (pageKey === "best") return dates.length ? `Active boards from ${formatEventDate(dates[0])}` : `Board status for ${formatEventDate(easternDate())}`;
    return dates[0] ? formatEventDate(dates[0]) : `Board status for ${formatEventDate(easternDate())}`;
  }, [config.sports, pageKey, state]);
  const deeperPages = useMemo(() => config.sports.flatMap(seoPhase2ForSport), [config.sports]);

  return (
    <main className="se-root">
      <style>{SEARCH_ENTRY_CSS}</style>
      <header className="se-header">
        <Link className="se-brand" to="/">Wize<span>Picks</span></Link>
        <nav aria-label="Public picks pages">
          <Link to="/best-bets-today">Best bets</Link>
          <Link to="/pricing">Pricing</Link>
          <Link className="se-login" to="/login">Log in</Link>
        </nav>
      </header>

      <div className="se-wrap">
        <section className="se-hero">
          <span className="se-eyebrow">{config.eyebrow}</span>
          <h1>{config.h1}</h1>
          <p>{config.lead}</p>
          <div className="se-live"><i />{currentLabel}</div>
        </section>

        {config.sports.map((sport) => <Slates key={sport} sport={sport} {...state[sport]} />)}

        <section className="se-method">
          <span>HOW TO READ THIS PAGE</span>
          <h2>Live slate context, protected model details</h2>
          <p>{config.explainer}</p>
          <p>Public visitors can review the active matchups and timing without a login. Qualified probabilities, exact picks, and paid model intelligence remain governed by the existing backend access policy.</p>
          <div className="se-actions">
            <Link className="se-primary" to="/signup">See the full board</Link>
            <Link to="/#perf">Performance history</Link>
            <Link to="/how-it-works">How WizePicks works</Link>
          </div>
        </section>

        <section className="se-deeper" aria-labelledby="se-deeper-heading">
          <span>MORE CURRENT COVERAGE</span>
          <h2 id="se-deeper-heading">Matchups, slate pages, and graded performance</h2>
          <div>{deeperPages.map((page) => <Link key={page.path} to={page.path}>{page.h1}<small>{page.kind === "matchup" ? "Matchup analysis" : page.kind === "performance" ? "Authoritative record" : page.sport === "mlb" ? "Daily slate" : "Weekly slate"}</small></Link>)}</div>
        </section>

        <nav className="se-hubs" aria-label="More WizePicks sport hubs">
          {SEARCH_ENTRY_LIST.map((page) => <Link className={page.key === pageKey ? "active" : ""} key={page.path} to={page.path}>{page.h1}</Link>)}
        </nav>
      </div>
    </main>
  );
}

const SEARCH_ENTRY_CSS = `
${TEAM_LOGO_CSS}
.se-root{min-height:100vh;background:#090a0c;color:#e8e4dc;font-family:Inter,system-ui,-apple-system,sans-serif;padding-bottom:52px}.se-root *{box-sizing:border-box}.se-header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 max(18px,calc((100vw - 980px)/2));border-bottom:1px solid #272721;background:rgba(9,10,12,.97);position:sticky;top:0;z-index:20}.se-brand{font:700 24px Georgia,serif;letter-spacing:-.7px;color:#f6f1e7;text-decoration:none}.se-brand span{color:#d3ae6b}.se-header nav{display:flex;align-items:center;gap:20px}.se-header nav a{color:#a5a59d;text-decoration:none;font-size:12px;font-weight:700}.se-header nav a:hover{color:#e2bd77}.se-header .se-login{border:1px solid #4d432f;border-radius:8px;padding:8px 12px;color:#e2bd77}.se-wrap{width:min(100%,980px);margin:0 auto;padding:44px 18px 0}.se-hero{max-width:760px;margin-bottom:28px}.se-eyebrow,.se-section-head span,.se-method>span{display:block;color:#d3ae6b;font:700 9px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:1.35px}.se-hero h1{margin:9px 0 10px;color:#fbf7ee;font:800 clamp(38px,7vw,68px)/.94 'Barlow Condensed',Inter,sans-serif;letter-spacing:-.8px}.se-hero p{max-width:720px;margin:0;color:#aaa9a2;font-size:15px;line-height:1.65}.se-live{display:inline-flex;align-items:center;gap:8px;margin-top:15px;border:1px solid #2b332c;border-radius:999px;padding:7px 11px;color:#8faaa0;background:#0d1311;font:700 9px 'IBM Plex Mono',monospace;letter-spacing:.7px;text-transform:uppercase}.se-live i{width:6px;height:6px;border-radius:50%;background:#42d494;box-shadow:0 0 10px rgba(66,212,148,.7)}.se-slate{margin-top:18px;border:1px solid #2a2924;border-radius:12px;background:#101113;overflow:hidden}.se-section-head{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:18px;border-bottom:1px solid #282823}.se-section-head h2{margin:4px 0 0;color:#f0ece3;font:800 24px/1 'Barlow Condensed',sans-serif}.se-count{flex:0 0 auto;color:#7d8079;font:700 9px 'IBM Plex Mono',monospace;letter-spacing:.7px}.se-games{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#292924}.se-game{min-width:0;padding:16px;background:#101113}.se-time{color:#8d9088;font:700 8px 'IBM Plex Mono',monospace;letter-spacing:.55px;text-transform:uppercase}.se-teamrow{display:grid;grid-template-columns:38px minmax(0,1fr) 38px;align-items:center;gap:10px;margin-top:12px}.se-teamrow>div{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:7px}.se-teamrow b{min-width:0;color:#f1eee6;font:800 16px/1.06 'Barlow Condensed',sans-serif;overflow-wrap:anywhere}.se-teamrow b:first-child{text-align:right}.se-teamrow span{color:#686a64;font:700 8px 'IBM Plex Mono',monospace;text-transform:uppercase}.se-market{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:13px;padding-top:11px;border-top:1px solid #282823}.se-market strong{color:#d6b46f;font:800 12px 'Barlow Condensed',sans-serif}.se-market span{color:#7f837c;font:600 8px/1.35 'IBM Plex Mono',monospace;text-align:right}.se-state{padding:28px 18px;color:#8f918c;font-size:13px;line-height:1.55}.se-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #282823}.se-summary div{min-width:0;padding:14px 16px;border-right:1px solid #282823}.se-summary div:last-child{border-right:0}.se-summary b,.se-summary span{display:block}.se-summary b{color:#ede9e0;font:800 18px 'Barlow Condensed',sans-serif}.se-summary span{margin-top:3px;color:#747771;font:600 8px/1.35 'IBM Plex Mono',monospace;text-transform:uppercase}.se-method{margin-top:24px;padding:22px;border:1px solid #292923;border-radius:12px;background:linear-gradient(135deg,#111315,#0c0d0e)}.se-method h2{margin:7px 0 9px;color:#f1ede4;font:800 26px 'Barlow Condensed',sans-serif}.se-method p{max-width:780px;margin:8px 0;color:#9b9e98;font-size:13px;line-height:1.65}.se-actions{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:18px}.se-actions a{color:#d3ae6b;text-decoration:none;font-size:12px;font-weight:750}.se-actions .se-primary{border-radius:8px;background:#d3ae6b;color:#12100b;padding:10px 14px}.se-hubs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:22px}.se-hubs a{display:flex;align-items:center;min-height:54px;border:1px solid #292923;border-radius:9px;padding:10px;color:#a5a69f;text-decoration:none;font:700 11px/1.25 'IBM Plex Mono',monospace}.se-hubs a:hover,.se-hubs a.active{border-color:#6f5b37;color:#e0bc78;background:#12120f}.se-root .team-logo{width:38px;height:38px}
.se-deeper{margin-top:22px}.se-deeper>span{display:block;color:#d3ae6b;font:700 9px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:1.35px}.se-deeper h2{margin:6px 0 11px;color:#f1ede4;font:800 25px 'Barlow Condensed',sans-serif}.se-deeper>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.se-deeper a{display:flex;flex-direction:column;gap:5px;min-width:0;border:1px solid #292923;border-radius:9px;padding:13px;color:#d4d0c7;text-decoration:none;font:800 14px/1.1 'Barlow Condensed',sans-serif}.se-deeper small{color:#797d76;font:600 8px 'IBM Plex Mono',monospace;text-transform:uppercase}
@media(max-width:680px){.se-header{height:58px;padding:0 14px}.se-header nav{gap:10px}.se-header nav>a:first-child{display:none}.se-header nav a{font-size:11px}.se-wrap{padding:32px 12px 0}.se-hero h1{font-size:43px}.se-hero p{font-size:13.5px}.se-games{grid-template-columns:1fr}.se-teamrow b{font-size:15px}.se-summary div{padding:12px 10px}.se-summary b{font-size:16px}.se-summary span{font-size:7px}.se-hubs{grid-template-columns:repeat(2,minmax(0,1fr))}.se-deeper>div{grid-template-columns:1fr}}
@media(max-width:350px){.se-header nav>a:not(.se-login){display:none}.se-hero h1{font-size:38px}.se-teamrow{grid-template-columns:34px minmax(0,1fr) 34px;gap:7px}.se-root .team-logo{width:34px;height:34px}.se-market{align-items:flex-start;flex-direction:column}.se-market span{text-align:left}.se-method{padding:18px}.se-hubs a{font-size:10px}}
`;
