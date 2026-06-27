// News.jsx — WZ-NEWS-PAGE-2026-06-27C :: blended ESPN + RotoWire news, sport-aware (?sport=).
// ESPN = headline/recap/video cards (images + game chips); RotoWire = player/injury wire
// rows (MLB headshots + status ring). Tap any item -> in-app detail sheet that reads the
// summary on-site and links out to the source only on demand. Auto-refreshes every 5 min.
// Injuries pill loads the full league IL report (/api/news/:league/injuries), grouped by
// team with severity badges; tap a player -> injury detail sheet w/ RotoWire note if present.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { newsApi } from "../lib/api";

const LABEL = { mlb: "MLB", nfl: "NFL", cfb: "CFB" };
const TYPE_CHIP = {
  video:    { cls: "video", txt: "\u25B6 Video" },
  recap:    { cls: "recap", txt: "Recap" },
  headline: { cls: "head",  txt: "Headline" },
};
const WIRE = {
  injury: { cls: "red",   txt: "Injury" },
  lineup: { cls: "green", txt: "Lineup" },
  note:   { cls: "amber", txt: "Note" },
};

function fmtDate() {
  try {
    return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch (e) { return ""; }
}

// severity class for the badge — NFL carries an explicit sev; MLB derives from IL length
function badgeClass(it = {}) {
  if (it.sev) return "nf-" + it.sev;          // out / ir / doubtful / questionable / dtd
  const s = it.status || "";
  if (/60/.test(s)) return "il60";
  if (/15/.test(s)) return "il15";
  if (/\b7\b|7-/.test(s)) return "il7";
  return "il10";
}

// "2026-06-01" -> "Jun 1"
function shortDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch (e) { return ""; }
}

export default function News() {
  const [params] = useSearchParams();
  const sport = (params.get("sport") || "mlb").toLowerCase();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState(null);
  // injuries (lazy-loaded the first time the Injuries pill is opened)
  const [injuries, setInjuries] = useState([]);
  const [injLoading, setInjLoading] = useState(false);
  const [injErr, setInjErr] = useState(false);
  const [injLoaded, setInjLoaded] = useState(false);

  const load = useCallback(async (quiet) => {
    if (!quiet) { setLoading(true); setErr(false); }
    try {
      const data = await newsApi.getFeed(sport);
      setItems(Array.isArray(data && data.items) ? data.items : []);
    } catch (e) {
      if (!quiet) setErr(true);
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const loadInjuries = useCallback(async () => {
    setInjLoading(true); setInjErr(false);
    try {
      const data = await newsApi.getInjuries(sport);
      setInjuries(Array.isArray(data && data.items) ? data.items : []);
      setInjLoaded(true);
    } catch (e) {
      setInjErr(true);
    } finally {
      setInjLoading(false);
    }
  }, [sport]);

  // sport change: reset to All feed and clear any loaded injury report
  useEffect(() => {
    setFilter("all");
    setInjuries([]); setInjLoaded(false); setInjErr(false);
    load();
  }, [load]);

  // lazy-load the injury report the first time Injuries is opened (MLB only for now)
  useEffect(() => {
    if (filter === "injuries" && (sport === "mlb" || sport === "nfl") && !injLoaded && !injLoading) loadInjuries();
  }, [filter, sport, injLoaded, injLoading, loadInjuries]);

  // quiet background refresh every 5 min while the tab is open
  useEffect(() => {
    const t = setInterval(() => load(true), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // lock body scroll while the detail sheet is open
  useEffect(() => {
    if (!active) return undefined;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [active]);

  const shown = items.filter((it) => {
    if (filter === "headlines") return it.source === "espn";
    return true;
  });

  // group injuries by team (backend already sorts team -> player)
  const injGroups = useMemo(() => {
    const m = new Map();
    for (const it of injuries) {
      if (!m.has(it.team)) m.set(it.team, { team: it.team, abbr: it.teamAbbr, items: [] });
      m.get(it.team).items.push(it);
    }
    return [...m.values()];
  }, [injuries]);

  const isInj = filter === "injuries";
  const SP = LABEL[sport] || sport.toUpperCase();

  return (
    <div className="wznews">
      <style>{CSS}</style>

      <div className="boardhd">
        <div className="bhrow">
          <svg className="bharw" width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5"/><path d="M22 1 L30 5 L22 9" fill="none"/></svg>
          <span className="bht">{SP} NEWS</span>
          <svg className="bharw" width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"><line x1="6" y1="5" x2="34" y2="5"/><path d="M12 1 L4 5 L12 9" fill="none"/></svg>
        </div>
        <div className="bhsub">
          {isInj
            ? <>{injLoaded ? `${injuries.length} players ${sport === "nfl" ? "on the report" : "on the IL"}` : "Injury report"} <span className="bhd">·</span> {fmtDate()}</>
            : <>Headlines <span className="bhd">·</span> Injuries <span className="bhd">·</span> Player Wire <span className="bhd">·</span> {fmtDate()}</>}
        </div>
      </div>

      <div className="nfilters">
        {[["all", "All"], ["headlines", "Headlines"], ["injuries", "Injuries"]].map(([k, l]) => (
          <button key={k} className={"npill" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {isInj ? (
        (sport !== "mlb" && sport !== "nfl") ? (
          <div className="nmsg">No injury report for {SP} yet.</div>
        ) : injLoading ? (
          <div className="nmsg">Loading {SP} injury report…</div>
        ) : injErr ? (
          <div className="nmsg">Couldn’t load the injury report. <button className="nretry" onClick={() => loadInjuries()}>Retry</button></div>
        ) : injuries.length === 0 ? (
          <div className="nmsg">No injuries reported for {SP} right now.</div>
        ) : (
          <div className="ninj">
            {injGroups.map((g) => (
              <div className="nigrp" key={g.team}>
                <div className="nihead">
                  <span className="niabbr">{g.abbr}</span>
                  <span className="niname">{g.team}</span>
                  <span className="nicount">{g.items.length} out</span>
                </div>
                {g.items.map((it) => <InjuryRow key={it.id} it={it} onOpen={() => setActive(it)} />)}
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="nmsg">Loading {SP} news…</div>
      ) : err ? (
        <div className="nmsg">Couldn’t load news right now. <button className="nretry" onClick={() => load()}>Retry</button></div>
      ) : shown.length === 0 ? (
        <div className="nmsg">No news for {SP} right now.</div>
      ) : (
        <div className="nfeed">
          {shown.map((it) => it.source === "rotowire"
            ? <WireRow key={it.id} it={it} onOpen={() => setActive(it)} />
            : <Card key={it.id} it={it} onOpen={() => setActive(it)} />)}
        </div>
      )}

      <div className="nfoot">Sources: ESPN · RotoWire · MLB — headlines link out to the original.</div>

      {active && (active.type === "injury"
        ? <InjurySheet it={active} onClose={() => setActive(null)} />
        : <Sheet it={active} onClose={() => setActive(null)} />)}
    </div>
  );
}

function Card({ it, onOpen }) {
  const chip = TYPE_CHIP[it.type] || TYPE_CHIP.headline;
  return (
    <button className="ncard" onClick={onOpen}>
      <div className="nthumb" style={it.image ? { backgroundImage: `url("${it.image}")` } : undefined}>
        {it.type === "video" && <span className="nplay" aria-hidden="true" />}
      </div>
      <div className="ncbody">
        <div className="nchips">
          <span className={"nchip " + chip.cls}>{chip.txt}</span>
          {it.game && <span className="nchip game">{it.game}</span>}
        </div>
        <div className="nhl">{it.headline}</div>
        {it.summary && <div className="ndesc">{it.summary}</div>}
        <div className="nmeta"><span className="src">ESPN</span> · {it.timeAgo}</div>
      </div>
    </button>
  );
}

function WireRow({ it, onOpen }) {
  const w = WIRE[it.status] || WIRE.note;
  const action = it.headline.includes(":")
    ? it.headline.split(":").slice(1).join(":").trim()
    : it.headline;
  return (
    <button className="nwire" onClick={onOpen}>
      <Avatar src={it.headshot} ring={w.cls} />
      <span className="nwbody">
        <span className={"nwtag " + w.cls}>{w.txt}</span>
        <span className="nwlead">{it.playerName ? <b>{it.playerName}</b> : null}{it.playerName ? " \u2014 " : ""}{action}</span>
        <span className="nwmeta">ROTOWIRE · {it.timeAgo}</span>
      </span>
    </button>
  );
}

function InjuryRow({ it, onOpen }) {
  return (
    <button className="nirow" onClick={onOpen}>
      <Avatar src={it.headshot} ring="plain" />
      <span className="nibody">
        <span className="niplayer">{it.playerName}</span>
        <span className="nipos">{it.position}{it.note ? " · note" : ""}</span>
      </span>
      <span className={"nibadge " + badgeClass(it)}>{it.status}</span>
    </button>
  );
}

function Avatar({ src, ring, big }) {
  const [bad, setBad] = useState(false);
  return (
    <span className={"nav " + ring + (big ? " big" : "")}>
      {src && !bad
        ? <img className="navimg" src={src} alt="" onError={() => setBad(true)} />
        : <Sil />}
    </span>
  );
}

function Sil() {
  return (
    <svg viewBox="0 0 40 40" className="nsil" aria-hidden="true">
      <circle cx="20" cy="15.5" r="7" />
      <path d="M7 37c0-7.2 5.8-11.5 13-11.5S33 29.8 33 37" fill="none" />
    </svg>
  );
}

function Sheet({ it, onClose }) {
  const isVideo = it.type === "video";
  const isWire = it.source === "rotowire";
  const cta = isVideo
    ? "\u25B6 Watch on ESPN \u2197"
    : isWire ? "Open on RotoWire \u2197" : "Read full story on ESPN \u2197";
  const chip = it.source === "espn"
    ? (TYPE_CHIP[it.type] || TYPE_CHIP.headline)
    : (WIRE[it.status] || WIRE.note);
  return (
    <div className="nsheet-wrap" onClick={onClose}>
      <div className="nsheet" onClick={(e) => e.stopPropagation()}>
        <div className="ngrab" />
        {isWire ? (
          <div className="nheroav"><Avatar src={it.headshot} ring={chip.cls} big /></div>
        ) : it.image ? (
          <div className="nhero" style={{ backgroundImage: `url("${it.image}")` }}>
            {isVideo && <span className="nbplay" aria-hidden="true" />}
          </div>
        ) : null}
        <div className="nschips">
          <span className={"nchip " + chip.cls}>{chip.txt}</span>
          {it.game && <span className="nchip game">{it.game}</span>}
        </div>
        <div className="nshl">{it.headline}</div>
        <div className="nsmeta"><span className="src">{it.source === "espn" ? "ESPN" : "RotoWire"}</span> · {it.timeAgo}</div>
        {it.summary && <div className="nsbody">{it.summary}</div>}
        {it.link && (isWire
          ? <a className="ncta-sec" href={it.link} target="_blank" rel="noopener noreferrer">{cta}</a>
          : <>
              <a className="ncta" href={it.link} target="_blank" rel="noopener noreferrer">{cta}</a>
              <div className="nctasub">Opens in a new tab · WizePicks stays open</div>
            </>)}
        <button className="nclose" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function InjurySheet({ it, onClose }) {
  return (
    <div className="nsheet-wrap" onClick={onClose}>
      <div className="nsheet" onClick={(e) => e.stopPropagation()}>
        <div className="ngrab" />
        <div className="nihero">
          <Avatar src={it.headshot} ring="plain" big />
          <div className="nihinfo">
            <div className="nihname">{it.playerName}</div>
            <div className="nihteam">{(it.team || "").toUpperCase()}{it.position ? ` · ${it.position}` : ""}</div>
          </div>
        </div>
        <div className="nichips">
          <span className={"nichip " + badgeClass(it)}>{it.status}</span>
          {it.bodyPart && <span className="nichip plain">{it.bodyPart}</span>}
          {it.returnDate && <span className="nichip plain">Est. return {shortDate(it.returnDate)}</span>}
        </div>
        <div className="nilbl">Latest update</div>
        {it.note
          ? <div className="nsbody">{it.note}</div>
          : <div className="ninonote">No recent update. Status: {it.status}.</div>}
        {it.link && <a className="ncta-sec" href={it.link} target="_blank" rel="noopener noreferrer">{it.source === "nfl" ? "More on ESPN ↗" : "Open on RotoWire ↗"}</a>}
        <button className="nclose" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const CSS = `
.wznews{--bg:#0A0B0D;--panel:#14171B;--panel2:#1B2025;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.12);
  --gold:#C9A86A;--green:#3FCB91;--neg:#E2655C;--blue:#5DA9E8;--mut:#99A2AA;--mut2:#5B646C;--tx:#ECEFF2;
  --disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;
  max-width:460px;margin:0 auto;min-height:100vh;padding:4px 14px 110px;color:var(--tx);
  font-family:var(--ui);background:var(--bg)}
.wznews button{font-family:inherit}

.wznews .boardhd{text-align:center;margin:18px 4px 2px;padding-top:18px;border-top:1px solid var(--line)}
.wznews .bhrow{display:flex;align-items:center;justify-content:center;gap:11px}
.wznews .bht{font-family:var(--disp);font-weight:700;font-size:27px;letter-spacing:.5px;color:var(--gold);line-height:1}
.wznews .bharw line,.wznews .bharw path{stroke:var(--gold);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.wznews .bhsub{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:10px;letter-spacing:.2px}
.wznews .bhsub .bhd{color:var(--mut2)}

.wznews .nfilters{display:flex;gap:8px;justify-content:center;margin:16px 0 6px;flex-wrap:wrap}
.wznews .npill{font-family:var(--mono);font-size:11px;letter-spacing:.4px;text-transform:uppercase;
  padding:6px 12px;border-radius:20px;border:1px solid var(--line2);color:var(--mut);background:transparent;cursor:pointer}
.wznews .npill.on{color:var(--gold);border-color:var(--gold)}

.wznews .nmsg{font-family:var(--mono);font-size:12px;color:var(--mut);text-align:center;padding:40px 16px;line-height:1.6}
.wznews .nretry{background:transparent;border:1px solid var(--line2);color:var(--gold);border-radius:8px;
  font-size:11px;padding:5px 12px;margin-left:6px;cursor:pointer}

.wznews .nfeed{padding:6px 0 0}

.wznews .ncard{display:flex;gap:11px;width:100%;text-align:left;background:transparent;border:none;
  border-bottom:1px solid var(--line);padding:13px 0;cursor:pointer}
.wznews .nthumb{flex:0 0 104px;height:68px;border-radius:8px;background:var(--panel2) center/cover no-repeat;
  border:1px solid var(--line);position:relative}
.wznews .nplay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;
  background:rgba(10,11,13,.7);border:1px solid rgba(255,255,255,.6)}
.wznews .nplay:after{content:"";position:absolute;left:52%;top:50%;transform:translate(-50%,-50%);
  border-left:8px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent}
.wznews .ncbody{flex:1;min-width:0}
.wznews .nchips{display:flex;align-items:center;gap:7px;margin-bottom:5px;flex-wrap:wrap}
.wznews .nchip{font-family:var(--mono);font-size:9px;letter-spacing:.6px;text-transform:uppercase;
  padding:2px 7px;border-radius:4px;border:1px solid var(--line2);color:var(--mut)}
.wznews .nchip.head{color:var(--blue);border-color:rgba(93,169,232,.35)}
.wznews .nchip.recap{color:var(--green);border-color:rgba(63,203,145,.35)}
.wznews .nchip.video{color:var(--gold);border-color:rgba(201,168,106,.5)}
.wznews .nchip.game{color:var(--gold);border-color:rgba(201,168,106,.35)}
.wznews .nchip.red{color:var(--neg);border-color:rgba(226,101,92,.4)}
.wznews .nchip.green{color:var(--green);border-color:rgba(63,203,145,.35)}
.wznews .nchip.amber{color:var(--gold);border-color:rgba(201,168,106,.4)}
.wznews .nhl{font-size:14px;font-weight:600;line-height:1.28;color:var(--tx);margin:0 0 4px}
.wznews .ndesc{font-size:12px;line-height:1.35;color:var(--mut);margin:0 0 6px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wznews .nmeta{font-family:var(--mono);font-size:10px;color:var(--mut2);letter-spacing:.3px}
.wznews .nmeta .src{color:var(--mut)}

.wznews .nwire{display:flex;gap:11px;width:100%;text-align:left;background:transparent;border:none;
  border-bottom:1px solid var(--line);padding:12px 0;align-items:flex-start;cursor:pointer}
.wznews .nav{flex:0 0 44px;width:44px;height:44px;border-radius:50%;background:var(--panel2);
  border:2px solid var(--mut2);overflow:hidden;display:flex;align-items:center;justify-content:center}
.wznews .nav.red{border-color:var(--neg)}
.wznews .nav.green{border-color:var(--green)}
.wznews .nav.amber{border-color:var(--gold)}
.wznews .navimg{width:100%;height:100%;object-fit:cover;display:block}
.wznews .nsil{width:30px;height:30px}
.wznews .nsil circle,.wznews .nsil path{fill:var(--mut2);stroke:var(--mut2);stroke-width:2}
.wznews .nwbody{flex:1;min-width:0;display:flex;flex-direction:column}
.wznews .nwtag{font-family:var(--mono);font-size:9px;letter-spacing:.6px;text-transform:uppercase;margin-bottom:3px}
.wznews .nwtag.red{color:var(--neg)}.wznews .nwtag.green{color:var(--green)}.wznews .nwtag.amber{color:var(--gold)}
.wznews .nwlead{font-size:13px;line-height:1.35;color:var(--tx)}
.wznews .nwlead b{font-weight:700}
.wznews .nwmeta{font-family:var(--mono);font-size:10px;color:var(--mut2);letter-spacing:.3px;margin-top:4px}

.wznews .nfoot{font-family:var(--mono);font-size:9.5px;color:var(--mut2);text-align:center;
  line-height:1.5;padding:22px 22px 6px;border-top:1px solid var(--line);margin-top:14px}

.nsheet-wrap{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.55);
  display:flex;align-items:flex-end;justify-content:center;font-family:'Inter',sans-serif}
.nsheet{width:100%;max-width:460px;background:#14171B;border-top:1px solid rgba(255,255,255,.12);
  border-radius:18px 18px 0 0;padding:8px 16px 26px;max-height:88vh;overflow-y:auto;color:#ECEFF2}
.nsheet .ngrab{width:38px;height:4px;border-radius:3px;background:#5B646C;margin:6px auto 12px}
.nsheet .nhero{width:100%;height:188px;border-radius:10px;border:1px solid rgba(255,255,255,.06);
  background:#1B2025 center/cover no-repeat;position:relative}
.nsheet .nbplay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;
  background:rgba(10,11,13,.66);border:1.5px solid rgba(255,255,255,.7)}
.nsheet .nbplay:after{content:"";position:absolute;left:53%;top:50%;transform:translate(-50%,-50%);
  border-left:16px solid #fff;border-top:10px solid transparent;border-bottom:10px solid transparent}
.nsheet .nschips{display:flex;gap:7px;margin:14px 0 8px;flex-wrap:wrap}
.nsheet .nchip{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9px;letter-spacing:.6px;text-transform:uppercase;
  padding:2px 7px;border-radius:4px;border:1px solid rgba(255,255,255,.12);color:#99A2AA}
.nsheet .nchip.head{color:#5DA9E8;border-color:rgba(93,169,232,.35)}
.nsheet .nchip.recap{color:#3FCB91;border-color:rgba(63,203,145,.35)}
.nsheet .nchip.video{color:#C9A86A;border-color:rgba(201,168,106,.5)}
.nsheet .nchip.game{color:#C9A86A;border-color:rgba(201,168,106,.35)}
.nsheet .nchip.red{color:#E2655C;border-color:rgba(226,101,92,.4)}
.nsheet .nchip.green{color:#3FCB91;border-color:rgba(63,203,145,.35)}
.nsheet .nchip.amber{color:#C9A86A;border-color:rgba(201,168,106,.4)}
.nsheet .nshl{font-size:19px;font-weight:700;line-height:1.24;margin:2px 0 10px}
.nsheet .nsmeta{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;color:#5B646C;margin-bottom:14px}
.nsheet .nsmeta .src{color:#99A2AA}
.nsheet .nsbody{font-size:13.5px;line-height:1.55;color:#cfd6dd;margin:0 0 18px}
.nsheet .ncta{display:block;text-align:center;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;
  letter-spacing:.5px;text-transform:uppercase;color:#0A0B0D;background:#C9A86A;border-radius:10px;
  padding:13px;font-weight:600;text-decoration:none}
.nsheet .nctasub{text-align:center;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;color:#5B646C;margin-top:9px}
.nsheet .nclose{display:block;width:100%;margin-top:14px;background:transparent;border:1px solid rgba(255,255,255,.12);
  color:#99A2AA;border-radius:10px;padding:11px;font-size:12px;letter-spacing:.4px;cursor:pointer}
.nsheet .nheroav{display:flex;justify-content:center;margin:8px 0 2px}
.wznews .nav.big{flex:0 0 88px;width:88px;height:88px;border-width:3px}
.wznews .nav.big .nsil{width:56px;height:56px}
.nsheet .ncta-sec{display:block;text-align:center;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11.5px;
  letter-spacing:.4px;color:#99A2AA;text-decoration:none;padding:11px;border:1px solid rgba(255,255,255,.12);border-radius:10px}

/* ── injuries view ── */
.wznews .nav.plain{border-color:var(--line2)}
.wznews .ninj{padding:8px 0 0}
.wznews .nigrp{margin-bottom:8px}
.wznews .nihead{display:flex;align-items:center;gap:9px;padding:11px 2px 9px;border-bottom:1px solid var(--line2)}
.wznews .niabbr{font-family:var(--mono);font-weight:600;font-size:11px;letter-spacing:.5px;color:#0A0B0D;
  background:var(--gold);padding:3px 7px;border-radius:5px}
.wznews .niname{font-family:var(--disp);font-weight:600;font-size:17px;letter-spacing:.5px;text-transform:uppercase}
.wznews .nicount{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--mut2);letter-spacing:.3px}
.wznews .nirow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;border:none;
  border-bottom:1px solid var(--line);padding:11px 2px;cursor:pointer}
.wznews .nirow:active{background:var(--panel)}
.wznews .nibody{flex:1;min-width:0;display:flex;flex-direction:column}
.wznews .niplayer{font-size:14.5px;font-weight:600;letter-spacing:.2px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wznews .nipos{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:2px}
.wznews .nibadge{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.4px;padding:4px 9px;
  border-radius:999px;flex:none;border:1px solid}
.wznews .nibadge.il60,.nsheet .nichip.il60{color:#C58178;border-color:rgba(197,129,120,.32);background:transparent}
.wznews .nibadge.il15,.nsheet .nichip.il15{color:#BBA06E;border-color:rgba(187,160,110,.32);background:transparent}
.wznews .nibadge.il10,.nsheet .nichip.il10{color:#8AA3BE;border-color:rgba(138,163,190,.32);background:transparent}
.wznews .nibadge.il7,.nsheet .nichip.il7{color:#7DB29A;border-color:rgba(125,178,154,.32);background:transparent}
.wznews .nibadge.nf-out,.nsheet .nichip.nf-out,.wznews .nibadge.nf-ir,.nsheet .nichip.nf-ir{color:#C58178;border-color:rgba(197,129,120,.32);background:transparent}
.wznews .nibadge.nf-doubtful,.nsheet .nichip.nf-doubtful{color:#CC9A6E;border-color:rgba(204,154,110,.32);background:transparent}
.wznews .nibadge.nf-questionable,.nsheet .nichip.nf-questionable{color:#BBA06E;border-color:rgba(187,160,110,.32);background:transparent}
.wznews .nibadge.nf-dtd,.nsheet .nichip.nf-dtd{color:#8AA3BE;border-color:rgba(138,163,190,.32);background:transparent}

/* ── injury detail sheet ── */
.nsheet .nihero{display:flex;align-items:center;gap:14px;margin:8px 0 4px}
.nsheet .nihinfo{min-width:0}
.nsheet .nihname{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:24px;letter-spacing:.5px;line-height:1.1}
.nsheet .nihteam{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:#99A2AA;margin-top:4px;letter-spacing:.3px}
.nsheet .nichips{display:flex;gap:8px;margin:16px 0 8px;flex-wrap:wrap}
.nsheet .nichip{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;font-weight:600;letter-spacing:.4px;
  padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.12);color:#99A2AA}
.nsheet .nichip.plain{color:#99A2AA;border-color:rgba(255,255,255,.12);background:transparent}
.nsheet .nilbl{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;letter-spacing:1px;color:#5B646C;
  text-transform:uppercase;margin:10px 0 8px}
.nsheet .ninonote{font-size:13px;color:#5B646C;font-style:italic;margin-bottom:16px;line-height:1.5}
`;
