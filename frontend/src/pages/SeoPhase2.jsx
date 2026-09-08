import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import TeamLogo, { TEAM_LOGO_CSS } from "../components/TeamLogo";
import { edgesApi, performanceApi } from "../lib/api";
import {
  currentSeoPageForPath,
  seoGameId,
  seoMatchupPath,
  splitSeoMatchup,
  SEO_PHASE2_BY_PATH,
} from "../lib/seoPhase2Config";
import { useSeo } from "../hooks/useSeo";

const ORIGIN = "https://www.wizepicks.com";
const SPORT_NAME = { nfl: "NFL", cfb: "College Football", mlb: "MLB" };
const START_WORD = { nfl: "Kickoff", cfb: "Kickoff", mlb: "First pitch" };
const loads = new Map();

function loadSlate(sport) {
  const key = `${sport}:current`;
  if (loads.has(key)) return loads.get(key);
  const promise = sport === "nfl" ? edgesApi.getNFL()
      : sport === "cfb" ? edgesApi.getCFB()
        : edgesApi.getMLB();
  loads.set(key, promise);
  promise.catch(() => loads.delete(key));
  return promise;
}

function gameStart(game, sport) {
  const value = game?.commenceTime || game?.startTimeUTC || game?.startTime || null;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("en-US", {
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: "America/New_York", timeZoneName: "short",
      });
    }
  }
  return game?.time ? `${START_WORD[sport]} ${game.time}` : `${START_WORD[sport]} to be announced`;
}

function bookNames(value, into = new Set()) {
  if (!value || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value)) {
    if (/book$/i.test(key) && typeof child === "string" && child.trim()) into.add(child.trim());
    else if (child && typeof child === "object") bookNames(child, into);
  }
  return into;
}

function allEdges(feed) {
  if (!feed || feed.teaser) return [];
  const tagged = [];
  for (const [key, label] of [["moneylineEdges", "moneyline"], ["spreadEdges", "spread"], ["totalsEdges", "total"], ["runLineEdges", "run line"]]) {
    for (const row of feed[key] || []) tagged.push({ ...row, market: row.market || label });
  }
  return tagged;
}

function edgeForGame(feed, game) {
  const id = seoGameId(game);
  const matchup = String(game?.matchup || "");
  return allEdges(feed).find((row) => {
    const rowId = String(row?.gameId ?? row?.eventId ?? row?.id ?? "");
    return (id && rowId === id) || (matchup && String(row?.matchup || "") === matchup);
  }) || null;
}

function edgeText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function useRobots(indexable) {
  useEffect(() => {
    let tag = document.head.querySelector('meta[name="robots"]');
    const existed = !!tag;
    const old = tag?.getAttribute("content");
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", indexable ? "index,follow" : "noindex,follow");
    return () => {
      if (!existed) tag.remove();
      else if (old == null) tag.removeAttribute("content");
      else tag.setAttribute("content", old);
    };
  }, [indexable]);
}

function useStructuredData(page, game, indexable = true) {
  useEffect(() => {
    const id = "wize-seo-phase2-jsonld";
    document.getElementById(id)?.remove();
    if (!page || !indexable) return undefined;
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    const primary = page.kind === "matchup" ? {
      "@type": "SportsEvent",
      "@id": `${ORIGIN}${page.path}#event`,
      name: `${page.away} at ${page.home}`,
      startDate: game?.commenceTime || page.startDate,
      eventStatus: "https://schema.org/EventScheduled",
      url: `${ORIGIN}${page.path}`,
      competitor: [{ "@type": "SportsTeam", name: page.away }, { "@type": "SportsTeam", name: page.home }],
    } : {
      "@type": "CollectionPage",
      "@id": `${ORIGIN}${page.path}#page`,
      url: `${ORIGIN}${page.path}`,
      name: page.title,
      description: page.description,
    };
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [primary, {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "WizePicks", item: `${ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: page.hubLabel, item: `${ORIGIN}${page.hub}` },
          { "@type": "ListItem", position: 3, name: page.h1, item: `${ORIGIN}${page.path}` },
        ],
      }],
    });
    document.head.appendChild(script);
    return () => script.remove();
  }, [game, indexable, page]);
}

function PublicHeader() {
  return <header className="p2-header"><Link className="p2-brand" to="/">Wize<span>Picks</span></Link><nav><Link to="/best-bets-today">Best bets</Link><Link to="/pricing">Pricing</Link><Link className="p2-login" to="/login">Log in</Link></nav></header>;
}

function PageFrame({ page, children }) {
  return <main className="p2-root"><style>{PHASE2_CSS}</style><PublicHeader /><div className="p2-wrap">{children}<nav className="p2-footlinks" aria-label="Related WizePicks pages"><Link to={page.hub}>{page.hubLabel}</Link><Link to="/best-bets-today">Best bets today</Link><Link to={`/performance/${page.sport === "cfb" ? "college-football" : page.sport}`}>Performance</Link><Link to="/signup">Unlock the member board</Link><Link to="/how-it-works">How WizePicks works</Link></nav></div></main>;
}

function pageForUnknownMatchup(sport, pathname) {
  const date = pathname.match(/(\d{4}-\d{2}-\d{2})$/)?.[1] || null;
  return {
    kind: "matchup", sport, path: pathname,
    title: `${SPORT_NAME[sport]} Matchup Prediction & Odds | WizePicks`,
    description: `Current ${SPORT_NAME[sport]} matchup, event time, and public-safe WizePicks market context.`,
    h1: `${SPORT_NAME[sport]} Matchup Prediction & Odds`,
    away: "Away team", home: "Home team", date,
    hub: sport === "cfb" ? "/college-football-picks" : `/${sport}-picks`,
    hubLabel: `${SPORT_NAME[sport]} picks`,
  };
}

export function SeoMatchupPage({ sport }) {
  const { pathname } = useLocation();
  const [state, setState] = useState({ loading: true, feed: null, error: null });
  useEffect(() => {
    let alive = true;
    loadSlate(sport).then((feed) => alive && setState({ loading: false, feed: feed || {}, error: null }))
      .catch((error) => alive && setState({ loading: false, feed: null, error }));
    return () => { alive = false; };
  }, [sport]);

  const currentPage = useMemo(() => currentSeoPageForPath(sport, pathname, state.feed), [pathname, sport, state.feed]);
  const matchedGame = useMemo(() => currentPage?.kind === "matchup"
    ? (state.feed?.games || []).find((game) => seoGameId(game) === currentPage.gameId) || null
    : null, [currentPage, state.feed]);
  const page = currentPage?.kind === "matchup" ? currentPage : pageForUnknownMatchup(sport, pathname);
  const teams = matchedGame ? splitSeoMatchup(matchedGame) : { away: page.away, home: page.home };
  const indexable = !state.loading && !state.error && !!matchedGame;
  useSeo({ title: page.title, description: page.description, path: pathname });
  useRobots(indexable);
  useStructuredData(page, matchedGame, indexable);

  const edge = matchedGame ? edgeForGame(state.feed, matchedGame) : null;
  const books = matchedGame ? [...bookNames(matchedGame.marketBooks || {})].slice(0, 4) : [];
  const marketOnly = matchedGame && String(matchedGame.dataQuality || "").toLowerCase().includes("market");
  const related = (state.feed?.games || []).filter((game) => game !== matchedGame && seoMatchupPath(sport, game, state.feed?.date)).slice(0, 4);

  return <PageFrame page={page}>
    <section className="p2-hero"><span>{SPORT_NAME[sport]} MATCHUP</span><h1>{page.h1}</h1><p>Public matchup and market context from the active WizePicks slate. Protected probabilities and paid pick details stay behind the existing access rules.</p></section>
    {state.loading ? <div className="p2-state">Loading the current matchup…</div> : state.error ? <div className="p2-state">The live matchup feed is temporarily unavailable.</div> : !matchedGame ? <div className="p2-state">This matchup is not on the current active WizePicks slate, so this URL is not indexed.</div> : <>
      <article className="p2-match">
        <div className="p2-kick">{gameStart(matchedGame, sport)}</div>
        <div className="p2-versus">
          <div><TeamLogo sport={sport} team={teams.away} abbr={matchedGame.awayAbbr} logoId={matchedGame?.teamIdentity?.away?.id || matchedGame.awayId} /><strong>{teams.away}</strong><span>Away</span></div>
          <b>AT</b>
          <div><TeamLogo sport={sport} team={teams.home} abbr={matchedGame.homeAbbr} logoId={matchedGame?.teamIdentity?.home?.id || matchedGame.homeId} /><strong>{teams.home}</strong><span>Home</span></div>
        </div>
        <div className="p2-context"><div><span>MARKETS</span><b>Moneyline · {sport === "mlb" ? "Run line" : "Spread"} · Total</b></div><div><span>SPORTSBOOK CONTEXT</span><b>{books.length ? books.join(" · ") : "Live market feed"}</b></div></div>
      </article>
      <section className="p2-verdict"><span>WIZEPICKS VERDICT</span>{marketOnly ? <><h2>MARKET ONLY</h2><p>This matchup does not have the independent rated inputs required for a WizePicks model-edge claim.</p></> : edge ? <><h2>{edge.pick || edge.teamAbbr || edge.side} · {edge.market}</h2><p>{edgeText(edge.edge)} edge for an authorized subscriber. The displayed side and market follow the current protected board.</p></> : state.feed?.teaser ? <><h2>MODEL DETAILS PROTECTED</h2><p>The matchup is public; qualified pick and probability details follow the existing subscription policy.</p></> : <><h2>PASS · INSUFFICIENT EDGE</h2><p>No qualifying WizePicks edge is published for this matchup on the current board.</p></>}</section>
      {related.length > 0 && <section className="p2-related"><span>RELATED {SPORT_NAME[sport]} MATCHUPS</span><div>{related.map((game) => { const path = seoMatchupPath(sport, game, state.feed?.date); const t = splitSeoMatchup(game); return path ? <Link key={seoGameId(game) || path} to={path}>{t.away} at {t.home}<small>{gameStart(game, sport)}</small></Link> : null; })}</div></section>}
    </>}
  </PageFrame>;
}

export function SeoSlatePage({ sport }) {
  const { pathname } = useLocation();
  const [state, setState] = useState({ loading: true, feed: null, error: null });
  useEffect(() => {
    let alive = true;
    loadSlate(sport).then((feed) => alive && setState({ loading: false, feed: feed || {}, error: null }))
      .catch((error) => alive && setState({ loading: false, feed: null, error }));
    return () => { alive = false; };
  }, [sport]);
  const page = useMemo(() => currentSeoPageForPath(sport, pathname, state.feed), [pathname, sport, state.feed]);
  const indexable = !state.loading && !state.error && page?.kind === "slate" && page.games.length > 0;
  const safePage = page?.kind === "slate" ? page : {
    kind: "slate", sport, path: pathname, title: `${SPORT_NAME[sport]} Picks | WizePicks`,
    description: `Current public-safe ${SPORT_NAME[sport]} slate.`, h1: `${SPORT_NAME[sport]} Picks`, label: "CURRENT SLATE",
    hub: sport === "cfb" ? "/college-football-picks" : `/${sport}-picks`, hubLabel: `${SPORT_NAME[sport]} picks`,
  };
  useSeo({ title: safePage.title, description: safePage.description, path: pathname });
  useRobots(indexable);
  useStructuredData(safePage, null, indexable);
  const games = indexable ? page.games : [];

  return <PageFrame page={safePage}>
    <section className="p2-hero"><span>{safePage.label}</span><h1>{safePage.h1}</h1><p>A focused event-period page built from the active WizePicks slate. Matchups and timing are public; protected model outputs keep their existing access policy.</p></section>
    <section className="p2-board"><div className="p2-boardhead"><div><span>CURRENT BOARD</span><h2>{games.length} scheduled matchup{games.length === 1 ? "" : "s"}</h2></div><b>{state.feed?.teaser ? "PUBLIC PREVIEW" : "LIVE"}</b></div>
      {state.loading ? <div className="p2-state">Loading the current slate…</div> : state.error ? <div className="p2-state">The live slate is temporarily unavailable.</div> : games.length === 0 ? <div className="p2-state">No useful current slate exists for this route, so it is not suitable for indexing.</div> : <div className="p2-list">{games.map((game) => { const t = splitSeoMatchup(game); const path = seoMatchupPath(sport, game, state.feed?.date); const books = [...bookNames(game.marketBooks || {})].slice(0, 2); return <article key={seoGameId(game) || `${t.away}-${t.home}`}><div className="p2-listteams"><TeamLogo sport={sport} team={t.away} abbr={game.awayAbbr} logoId={game?.teamIdentity?.away?.id || game.awayId} /><div><h3>{t.away} <i>at</i> {t.home}</h3><p>{gameStart(game, sport)}</p></div><TeamLogo sport={sport} team={t.home} abbr={game.homeAbbr} logoId={game?.teamIdentity?.home?.id || game.homeId} /></div><div className="p2-listmeta"><span>{books.length ? books.join(" · ") : "Active market context"}</span>{path && <Link to={path}>Matchup analysis →</Link>}</div></article>; })}</div>}
    </section>
    <section className="p2-copy"><span>ABOUT THIS {sport === "mlb" ? "DAILY" : "WEEKLY"} PAGE</span><h2>Useful slate context without thin archives</h2><p>This page represents a specific active {sport === "mlb" ? "event date" : "football week"}. WizePicks only indexes a period page when its production-shaped slate contains useful real matchups. It does not create empty archive pages or duplicate generic copy.</p></section>
  </PageFrame>;
}

function statValue(value, suffix = "") {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(suffix ? 1 : 0)}${suffix}` : "—";
}

export function SeoPerformancePage({ sport, league }) {
  const { pathname } = useLocation();
  const page = SEO_PHASE2_BY_PATH[pathname];
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    performanceApi.get(league).then((data) => alive && setState({ loading: false, data: data || {}, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, [league]);
  const safePage = page || { kind: "performance", sport, path: pathname, title: `${SPORT_NAME[sport]} Performance | WizePicks`, description: `Authoritative graded ${SPORT_NAME[sport]} performance.`, h1: `${SPORT_NAME[sport]} Prediction Performance`, hub: sport === "cfb" ? "/college-football-picks" : `/${sport}-picks`, hubLabel: `${SPORT_NAME[sport]} picks` };
  useSeo({ title: safePage.title, description: safePage.description, path: pathname });
  useRobots(!!page);
  useStructuredData(safePage, null);
  const season = state.data?.ranges?.Season || null;
  const markets = Object.entries(state.data?.byMarket || {});

  return <PageFrame page={safePage}>
    <section className="p2-hero"><span>AUTHORITATIVE GRADED RESULTS</span><h1>{safePage.h1}</h1><p>Transparent results from the active prediction ledger. Only decisive, graded records in the backend’s current methodology are included; no record is invented or reconstructed on this page.</p></section>
    {state.loading ? <div className="p2-state">Loading graded performance…</div> : state.error ? <div className="p2-state">Authoritative performance data is temporarily unavailable.</div> : !season || !state.data?.totalGraded ? <div className="p2-state">No useful authoritative graded sample is available for this sport, so this page should not be indexed.</div> : <>
      <section className="p2-record"><div className="p2-recordmain"><span>SEASON RECORD</span><h2>{season.w}–{season.l}</h2><p>{season.n} authoritative graded decisions</p></div><div><span>WIN RATE</span><b>{season.n ? `${((season.w / season.n) * 100).toFixed(1)}%` : "—"}</b></div><div><span>UNITS</span><b>{statValue(season.units, "u")}</b></div><div><span>ROI</span><b>{statValue(season.roi, "%")}</b></div></section>
      <section className="p2-markets"><div className="p2-boardhead"><div><span>BY MARKET</span><h2>Graded results</h2></div><b>{state.data.totalGraded} TOTAL</b></div><div>{markets.map(([market, row]) => <article key={market}><span>{String(market).replace(/_/g, " ")}</span><h3>{row.wins}–{row.losses}</h3><p>{row.total} graded · {statValue(row.winPct, "%")} win · {statValue(row.units, "u")} · {statValue(row.roi, "%")} ROI</p></article>)}</div></section>
      <section className="p2-copy"><span>METHODOLOGY</span><h2>Recorded outcomes, honest monetary returns</h2><p>These figures come from the public aggregate performance endpoint backed by graded <code>model_predictions</code>. MLB monetary reporting uses recorded entry prices and excludes unpriced rows from units and ROI while retaining valid win/loss outcomes. Football uses the active sport reset and publication methodology.</p><p>Past performance does not guarantee future results. WizePicks is an analytics service and does not accept wagers.</p></section>
    </>}
  </PageFrame>;
}

const PHASE2_CSS = `
${TEAM_LOGO_CSS}
.p2-root{min-height:100vh;background:#090a0c;color:#e8e4dc;font-family:Inter,system-ui,-apple-system,sans-serif;padding-bottom:48px}.p2-root *{box-sizing:border-box}.p2-header{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 max(18px,calc((100vw - 980px)/2));border-bottom:1px solid #272721;background:rgba(9,10,12,.97);position:sticky;top:0;z-index:20}.p2-brand{font:700 24px Georgia,serif;letter-spacing:-.7px;color:#f6f1e7;text-decoration:none}.p2-brand span{color:#d3ae6b}.p2-header nav{display:flex;align-items:center;gap:20px}.p2-header nav a{color:#a5a59d;text-decoration:none;font-size:12px;font-weight:700}.p2-header .p2-login{border:1px solid #4d432f;border-radius:8px;padding:8px 12px;color:#e2bd77}.p2-wrap{width:min(100%,980px);margin:auto;padding:42px 18px 0}.p2-hero{max-width:820px;margin-bottom:26px}.p2-hero>span,.p2-verdict>span,.p2-related>span,.p2-copy>span,.p2-record span,.p2-context span,.p2-boardhead span{color:#d3ae6b;font:700 9px/1.4 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:1.25px}.p2-hero h1{margin:9px 0 12px;color:#fbf7ee;font:800 clamp(36px,6.3vw,64px)/.96 'Barlow Condensed',Inter,sans-serif;letter-spacing:-.65px}.p2-hero p{max-width:760px;margin:0;color:#aaa9a2;font-size:15px;line-height:1.65}.p2-state{padding:30px 22px;border:1px solid #2a2924;border-radius:12px;background:#101113;color:#92958e;font-size:14px;line-height:1.6}.p2-match,.p2-verdict,.p2-board,.p2-record,.p2-markets,.p2-copy{border:1px solid #2a2924;border-radius:12px;background:#101113;overflow:hidden}.p2-kick{text-align:center;padding:13px;border-bottom:1px solid #282823;color:#959991;font:700 9px 'IBM Plex Mono',monospace;letter-spacing:.75px;text-transform:uppercase}.p2-versus{display:grid;grid-template-columns:minmax(0,1fr) 38px minmax(0,1fr);align-items:center;gap:14px;padding:28px}.p2-versus>div{display:grid;justify-items:center;text-align:center}.p2-versus>div .team-logo{width:58px;height:58px;margin-bottom:12px}.p2-versus strong{font:800 clamp(20px,4vw,30px)/1 'Barlow Condensed',sans-serif;color:#f3efe7}.p2-versus span{margin-top:5px;color:#72766f;font:700 8px 'IBM Plex Mono',monospace;text-transform:uppercase}.p2-versus>b{color:#5f625c;font:800 12px 'IBM Plex Mono',monospace;text-align:center}.p2-context{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #282823}.p2-context>div{padding:15px 18px;min-width:0}.p2-context>div+div{border-left:1px solid #282823}.p2-context span,.p2-context b{display:block}.p2-context b{margin-top:4px;color:#ddd8cf;font-size:12px;overflow-wrap:anywhere}.p2-verdict{margin-top:14px;padding:20px;background:linear-gradient(135deg,#111512,#0f1012)}.p2-verdict h2{margin:7px 0 6px;color:#e1bd76;font:800 25px 'Barlow Condensed',sans-serif}.p2-verdict p,.p2-copy p{margin:0;color:#969a93;font-size:13px;line-height:1.6}.p2-related{margin-top:24px}.p2-related>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}.p2-related a{display:flex;flex-direction:column;gap:5px;min-width:0;padding:13px;border:1px solid #292923;border-radius:9px;color:#d9d5cc;text-decoration:none;font:800 14px 'Barlow Condensed',sans-serif}.p2-related small{color:#777b74;font:600 8px/1.3 'IBM Plex Mono',monospace}.p2-boardhead{display:flex;align-items:end;justify-content:space-between;gap:12px;padding:18px;border-bottom:1px solid #282823}.p2-boardhead span{display:block}.p2-boardhead h2{margin:4px 0 0;font:800 25px 'Barlow Condensed',sans-serif}.p2-boardhead>b{color:#80847d;font:700 9px 'IBM Plex Mono',monospace}.p2-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#292924}.p2-list article{min-width:0;padding:16px;background:#101113}.p2-listteams{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;gap:9px}.p2-listteams .team-logo{width:36px;height:36px}.p2-listteams h3{margin:0;color:#eeeae2;font:800 16px/1.05 'Barlow Condensed',sans-serif;overflow-wrap:anywhere}.p2-listteams h3 i{color:#696c66;font-style:normal;font-size:10px}.p2-listteams p{margin:5px 0 0;color:#7c8079;font:600 8px/1.35 'IBM Plex Mono',monospace}.p2-listmeta{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:12px;padding-top:10px;border-top:1px solid #292923}.p2-listmeta span{color:#7d817a;font:600 8px 'IBM Plex Mono',monospace}.p2-listmeta a{color:#d6b46f;text-decoration:none;font-size:10px;font-weight:750;white-space:nowrap}.p2-copy{margin-top:20px;padding:22px;background:linear-gradient(135deg,#111315,#0c0d0e)}.p2-copy h2{margin:7px 0 8px;font:800 25px 'Barlow Condensed',sans-serif}.p2-copy p+p{margin-top:8px}.p2-copy code{color:#b6bcaf}.p2-record{display:grid;grid-template-columns:1.4fr repeat(3,1fr);align-items:stretch}.p2-record>div{padding:21px;border-left:1px solid #282823}.p2-record>div:first-child{border-left:0}.p2-record span,.p2-record b{display:block}.p2-record h2{margin:5px 0 2px;color:#f0ece3;font:800 42px 'Barlow Condensed',sans-serif}.p2-record p{margin:0;color:#767a73;font-size:11px}.p2-record b{margin-top:8px;color:#e0bc78;font:800 24px 'Barlow Condensed',sans-serif}.p2-markets{margin-top:16px}.p2-markets>div:last-child{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#292924}.p2-markets article{padding:18px;background:#101113}.p2-markets article>span{color:#d3ae6b;font:700 9px 'IBM Plex Mono',monospace;text-transform:uppercase}.p2-markets h3{margin:7px 0 4px;color:#eeeae2;font:800 26px 'Barlow Condensed',sans-serif}.p2-markets p{margin:0;color:#7e827b;font-size:11px;line-height:1.5}.p2-footlinks{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}.p2-footlinks a{border:1px solid #292923;border-radius:8px;padding:10px 12px;color:#c6a969;text-decoration:none;font-size:11px;font-weight:700}
@media(max-width:680px){.p2-header{height:58px;padding:0 14px}.p2-header nav{gap:10px}.p2-header nav>a:first-child{display:none}.p2-wrap{padding:31px 12px 0}.p2-hero h1{font-size:42px}.p2-hero p{font-size:13.5px}.p2-versus{padding:22px 12px;gap:8px}.p2-versus>div .team-logo{width:46px;height:46px}.p2-versus strong{font-size:20px}.p2-context{grid-template-columns:1fr}.p2-context>div+div{border-left:0;border-top:1px solid #282823}.p2-related>div,.p2-list{grid-template-columns:1fr}.p2-record{grid-template-columns:repeat(3,1fr)}.p2-recordmain{grid-column:1/-1;border-bottom:1px solid #282823}.p2-record>div:nth-child(2){border-left:0}.p2-record>div{padding:16px}.p2-record h2{font-size:36px}.p2-record b{font-size:20px}.p2-markets>div:last-child{grid-template-columns:1fr}.p2-listmeta{align-items:flex-start;flex-direction:column}.p2-footlinks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:350px){.p2-header nav>a:not(.p2-login){display:none}.p2-hero h1{font-size:37px}.p2-versus strong{font-size:17px}.p2-versus{grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr)}.p2-record>div{padding:13px 10px}.p2-record b{font-size:18px}.p2-listteams{grid-template-columns:32px minmax(0,1fr) 32px}.p2-listteams .team-logo{width:32px;height:32px}}
`;
