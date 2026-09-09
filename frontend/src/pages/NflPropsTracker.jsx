import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { nflPropsTrackerApi, subscriptionApi } from "../lib/api";

const OWNER_EMAIL = "r7002g@gmail.com";
const CATEGORIES = [
  ["", "All categories"],
  ["pass_yds", "Passing Yards"],
  ["pass_tds", "Passing TDs"],
  ["rush_yds", "Rushing Yards"],
  ["rec_yds", "Receiving Yards"],
  ["receptions", "Receptions"],
  ["anytime_td", "Anytime TD"],
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

const odds = (value) => value == null ? "—" : Number(value) > 0 ? `+${value}` : String(value);
const pct = (value) => value == null ? "—" : `${(Number(value) * 100).toFixed(1)}%`;
const units = (value) => `${Number(value) > 0 ? "+" : ""}${Number(value || 0).toFixed(2)}u`;
const date = (value) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function exactPick(row) {
  if (row.category === "anytime_td") return "ANYTIME TOUCHDOWN SCORER";
  return `${row.side} ${row.line} ${String(CATEGORY_LABEL[row.category] || row.category).toUpperCase()}`;
}

export default function NflPropsTrackerPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [filters, setFilters] = useState({ season: "", week: "", category: "", player: "", result: "", date_from: "", date_to: "" });
  const [applied, setApplied] = useState({});
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isAdmin = plan?.isAdmin === true || user?.email === OWNER_EMAIL;
  useEffect(() => {
    subscriptionApi.getMyPlan().then(setPlan).catch(() => setPlan({ isAdmin: false }));
  }, []);
  useEffect(() => {
    if (plan && !isAdmin) navigate("/dashboard", { replace: true });
  }, [plan, isAdmin, navigate]);
  useEffect(() => {
    if (!isAdmin) return;
    let dead = false;
    setLoading(true); setError("");
    nflPropsTrackerApi.get(applied).then((data) => { if (!dead) setPayload(data); })
      .catch(() => { if (!dead) setError("NFL Props tracker could not be loaded."); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [isAdmin, applied]);

  const breakdown = useMemo(() => CATEGORIES.slice(1).map(([key, label]) => ({ key, label, ...(payload?.breakdown?.[key] || {}) })), [payload]);
  if (!plan || !isAdmin) return null;

  const change = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  return <main className="npt"><style>{CSS}</style>
    <header><button onClick={() => navigate("/admin")}>‹ Admin</button><div><span>ADMIN ONLY · AUTOMATIC GRADING</span><h1>NFL Props Tracker</h1></div></header>

    <section className="npt__filters">
      <label>From<input type="date" value={filters.date_from} onChange={change("date_from")} /></label>
      <label>To<input type="date" value={filters.date_to} onChange={change("date_to")} /></label>
      <label>Season<input inputMode="numeric" placeholder="2026" value={filters.season} onChange={change("season")} /></label>
      <label>Week<input inputMode="numeric" placeholder="1" value={filters.week} onChange={change("week")} /></label>
      <label>Category<select value={filters.category} onChange={change("category")}>{CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Grade<select value={filters.result} onChange={change("result")}><option value="">All grades</option>{["WIN","LOSS","PUSH","VOID","PENDING"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="npt__player">Player<input placeholder="Exact or partial name" value={filters.player} onChange={change("player")} /></label>
      <button className="npt__apply" onClick={() => setApplied(filters)}>Apply filters</button>
    </section>

    {loading ? <div className="npt__state">Loading automatic NFL prop results…</div>
      : error ? <div className="npt__state is-error">{error}</div>
      : <>
        <section className="npt__summary">
          <div><span>RECORD</span><b>{payload?.overall?.wins || 0}-{payload?.overall?.losses || 0}-{payload?.overall?.pushes || 0}</b><small>{payload?.overall?.voids || 0} void</small></div>
          <div><span>HIT RATE</span><b>{pct(payload?.overall?.hitRate)}</b><small>decisions only</small></div>
          <div><span>UNITS</span><b className={(payload?.overall?.units || 0) >= 0 ? "is-win" : "is-loss"}>{units(payload?.overall?.units)}</b><small>1 unit risked</small></div>
          <div><span>ROI</span><b className={(payload?.overall?.roi || 0) >= 0 ? "is-win" : "is-loss"}>{payload?.overall?.roi == null ? "—" : `${Number(payload.overall.roi).toFixed(1)}%`}</b><small>{payload?.overall?.pending || 0} pending</small></div>
        </section>

        <section className="npt__breakdown">{breakdown.map((row) => <article key={row.key}><span>{row.label}</span><b>{row.wins || 0}-{row.losses || 0}-{row.pushes || 0}</b><small>{pct(row.hitRate)} · {units(row.units)} · {row.roi == null ? "—" : `${Number(row.roi).toFixed(1)}% ROI`}</small></article>)}</section>

        <section className="npt__table"><div className="npt__scroll"><table><thead><tr><th>Date</th><th>Player / matchup</th><th>Exact pick</th><th>Odds / book</th><th>Final</th><th>Grade</th><th>Unit P&amp;L</th></tr></thead><tbody>
          {(payload?.rows || []).map((row) => <tr key={row.id}><td>{date(row.event_date)}<small>{row.season_week ? `Week ${row.season_week}` : `Season ${row.season}`}</small></td><td><b>{row.player_name}</b><small>{row.matchup}</small></td><td><b>{exactPick(row)}</b><small>{CATEGORY_LABEL[row.category]}</small></td><td><b>{odds(row.odds)}</b><small>{row.sportsbook}</small></td><td>{row.final_stat == null ? "—" : row.final_stat}</td><td><em className={`is-${String(row.result).toLowerCase()}`}>{row.result}</em></td><td className={(row.unit_pnl || 0) >= 0 ? "is-win" : "is-loss"}>{row.unit_pnl == null ? "—" : units(row.unit_pnl)}</td></tr>)}
          {(payload?.rows || []).length === 0 && <tr><td colSpan="7" className="npt__empty">No automatically recorded NFL prop picks match these filters.</td></tr>}
        </tbody></table></div></section>
      </>}
  </main>;
}

const CSS = `
.npt{min-height:100vh;background:#07090b;color:#eef2ed;padding:28px clamp(14px,3vw,36px) 100px;font-family:Inter,system-ui,sans-serif}.npt>header{max-width:1240px;margin:0 auto 18px;display:flex;align-items:center;gap:18px}.npt>header button{border:1px solid #323832;border-radius:8px;background:#111512;color:#d6b568;padding:9px 12px;font-weight:800;cursor:pointer}.npt>header span,.npt label,.npt__summary span,.npt__breakdown span{color:#9a9f98;font:700 9px "IBM Plex Mono",monospace;letter-spacing:.7px;text-transform:uppercase}.npt h1{margin:4px 0 0;font:800 32px "Barlow Condensed",sans-serif}.npt__filters{max-width:1240px;margin:0 auto 14px;display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;padding:12px;border:1px solid #292e29;border-radius:10px;background:#0d110e}.npt label{display:flex;flex-direction:column;gap:5px}.npt input,.npt select{min-width:0;border:1px solid #343a34;border-radius:6px;background:#080b09;color:#eef2ed;padding:8px;font:600 12px Inter}.npt__player{grid-column:span 2}.npt__apply{align-self:end;border:1px solid #d6b568;border-radius:6px;background:#d6b568;color:#171208;padding:9px;font-weight:900;cursor:pointer}.npt__summary,.npt__breakdown,.npt__table,.npt__state{max-width:1240px;margin-left:auto;margin-right:auto}.npt__summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.npt__summary>div,.npt__breakdown article{border:1px solid #2d332d;border-radius:9px;background:linear-gradient(145deg,#111512,#090b0a);padding:13px}.npt__summary b{display:block;margin-top:7px;font:800 26px "Barlow Condensed",sans-serif}.npt__summary small,.npt__breakdown small,td small{display:block;margin-top:4px;color:#747c75;font:600 9px "IBM Plex Mono",monospace}.npt__breakdown{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:8px}.npt__breakdown b{display:block;margin-top:6px;font:800 18px "Barlow Condensed",sans-serif}.npt__table{margin-top:12px;border:1px solid #2d332d;border-radius:10px;background:#0c100d;overflow:hidden}.npt__scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:920px}th,td{padding:10px 12px;border-bottom:1px solid #242924;text-align:left;font-size:11px}th{color:#9a9f98;font:700 8px "IBM Plex Mono",monospace;letter-spacing:.6px;text-transform:uppercase}td b{display:block;font-size:12px}td em{display:inline-block;border-radius:999px;padding:4px 7px;font:800 8px "IBM Plex Mono",monospace;font-style:normal}.is-win,.is-win b{color:#49df8b}.is-loss,.is-loss b{color:#ef7770}em.is-win{background:rgba(73,223,139,.12)}em.is-loss{background:rgba(239,119,112,.12)}em.is-push,em.is-void,em.is-pending{background:#202520;color:#a6ada6}.npt__state{padding:40px;text-align:center;color:#939a93}.npt__state.is-error{color:#ef7770}.npt__empty{text-align:center;color:#7b837b;padding:32px}
@media(max-width:800px){.npt{padding-top:18px}.npt__filters{grid-template-columns:repeat(2,minmax(0,1fr))}.npt__player{grid-column:span 2}.npt__summary{grid-template-columns:repeat(2,1fr)}.npt__breakdown{grid-template-columns:repeat(2,1fr)}.npt h1{font-size:27px}}
`;
