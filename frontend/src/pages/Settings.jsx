import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";

const OWNER_EMAIL = "r7002g@gmail.com";
const SUPPORT_EMAIL = "support@wizepicks.com";
const initialsOf = (s) => { const p = String(s||"").trim().split(/[\s@.]+/).filter(Boolean); const r = p.map(w=>w[0]).join("").slice(0,2).toUpperCase(); return r || "MG"; };

function usePref(key, def) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s==null ? def : JSON.parse(s); } catch { return def; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}

const TIERS = [
  { name:"Weekly", price:"$7", per:"/wk", foot:"All-Access · billed weekly · cancel anytime", save:null, interval:"week" },
  { name:"Monthly", price:"$25", per:"/mo", foot:"All-Access · ", save:"save 11% vs weekly", interval:"month" },
  { name:"Yearly", price:"$199", per:"/yr", foot:"All-Access · ", save:"save 34% — under $17/mo", interval:"year", best:true },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [plan, setPlan] = useState({ tier:"free", isAdmin:false });
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(()=>{}); }, []);

  const isAdmin = plan.isAdmin === true || user?.email === OWNER_EMAIL;
  const isPro = plan.tier === "pro" || plan.tier === "elite";
  const paid = isAdmin || isPro;
  const interval = plan.interval || plan.billingInterval || null;
  const currentIdx = interval ? TIERS.findIndex(t => t.interval === interval) : -1;

  const name = user?.user_metadata?.full_name || (user?.email ? user.email.split("@")[0] : "Member");
  const email = user?.email || "—";
  const planBadge = isAdmin ? "\u25cf ADMIN (OWNER)" : isPro ? "\u25cf ALL-ACCESS" : "\u25cb FREE";

  // prefs (persisted per-device)
  const [nSharp, setNSharp] = usePref("wp_n_sharp", true);
  const [nPicks, setNPicks] = usePref("wp_n_picks", true);
  const [nEdges, setNEdges] = usePref("wp_n_edges", true);
  const [nLineups, setNLineups] = usePref("wp_n_lineups", false);
  const [oddsFmt, setOddsFmt] = usePref("wp_odds_fmt", "a");
  const [defSport, setDefSport] = usePref("wp_def_sport", "mlb");
  const [favTeams, setFavTeams] = usePref("wp_fav_teams", ["NYY","CHC"]);

  const openPortal = async () => {
    if (!paid) { navigate("/pricing"); return; }
    setPortalLoading(true);
    try { const url = await subscriptionApi.getCustomerPortalUrl(); if (url) window.location.href = (typeof url === "string" ? url : url.url); }
    catch (_) {} finally { setPortalLoading(false); }
  };
  const pickTier = (i) => { if (paid) openPortal(); else navigate("/pricing"); };
  const toggleFav = (ab) => setFavTeams(favTeams.includes(ab) ? favTeams.filter(x=>x!==ab) : [...favTeams, ab]);
  const doSignOut = () => { signOut(); navigate("/"); };
  const doDelete = () => { if (window.confirm("Request account deletion? This emails support to remove your account.")) window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Delete%20account%20request`; };

  const Toggle = ({ on, set }) => <div className={"tg "+(on?"on":"")} onClick={()=>set(!on)}><div className="k"/></div>;

  return (
    <div className="app"><style>{CSS}</style>
      <div className="hd"><div className="hrow"><div className="logo"><span className="w">Wize</span>Picks</div><div className="htitle">Account</div></div></div>

      <div id="wrap">
        <div className="blk"><div className="prof">
          <div className="av">{initialsOf(name || email)}</div>
          <div><div className="pn">{name}</div><div className="pe">{email}</div><div className="pp">{planBadge}</div></div>
        </div></div>

        <div className="blk"><div className="bl">SUBSCRIPTION</div>
          {TIERS.map((t,i)=>(
            <div key={i} className={"plan"+(i===currentIdx?" cur":"")} onClick={()=>pickTier(i)}>
              {i===currentIdx ? <span className="badge cur">CURRENT</span> : (t.best ? <span className="badge best">BEST VALUE</span> : null)}
              <div className="pt"><div className="pname">{t.name}</div><div className="price">{t.price}<span className="per">{t.per}</span></div></div>
              <div className="pf">{t.foot}{t.save ? <span className="save">{t.save}</span> : null}</div>
            </div>
          ))}
          <div className="mng" onClick={openPortal}>{portalLoading ? "Opening…" : paid ? "Manage subscription" : "See all plans"}</div>
          <div className="billnote">Billing handled securely by Stripe · receipts emailed</div>
        </div>

        <div className="blk"><div className="bl">NOTIFICATIONS</div>
          <div className="srow"><div className="sl"><div className="sn">Sharp line moves</div><div className="ss">when a pick’s line moves ≥15¢</div></div><Toggle on={nSharp} set={setNSharp}/></div>
          <div className="srow"><div className="sl"><div className="sn">Your tracked picks</div><div className="ss">result + CLV when a pick settles</div></div><Toggle on={nPicks} set={setNPicks}/></div>
          <div className="srow"><div className="sl"><div className="sn">New edges posted</div><div className="ss">when tonight’s board goes live</div></div><Toggle on={nEdges} set={setNEdges}/></div>
          <div className="srow"><div className="sl"><div className="sn">Lineup / scratch alerts</div><div className="ss">when a starter or lineup changes</div></div><Toggle on={nLineups} set={setNLineups}/></div>
        </div>

        <div className="blk"><div className="bl">PREFERENCES</div>
          <div className="srow"><div className="sl"><div className="sn">Odds format</div><div className="ss">how prices display</div></div><div className="seg"><b className={oddsFmt==="a"?"on":""} onClick={()=>setOddsFmt("a")}>American</b><b className={oddsFmt==="d"?"on":""} onClick={()=>setOddsFmt("d")}>Decimal</b></div></div>
          <div className="srow"><div className="sl"><div className="sn">Default sport</div><div className="ss">what opens first</div></div><div className="seg"><b className={defSport==="mlb"?"on":""} onClick={()=>setDefSport("mlb")}>MLB</b><b className={defSport==="nba"?"on":""} onClick={()=>setDefSport("nba")}>NBA</b><b className={defSport==="auto"?"on":""} onClick={()=>setDefSport("auto")}>Auto</b></div></div>
          <div className="srow" style={{display:"block"}}><div className="sn" style={{marginBottom:6}}>Favorite teams</div><div className="chiprow">{["NYY","LAD","CHC","BOS"].map(ab=><b key={ab} className={favTeams.includes(ab)?"on":""} onClick={()=>toggleFav(ab)}>{ab}</b>)}<b onClick={()=>navigate("/games")}>+ Add</b></div></div>
        </div>

        <div className="blk"><div className="bl">SUPPORT</div>
          <div className="lrow" onClick={()=>navigate("/dashboard")}><div className="li">?</div><div className="lt">How to use WizePicks</div><div className="lc">{"\u203a"}</div></div>
          <div className="lrow" onClick={()=>{window.location.href=`mailto:${SUPPORT_EMAIL}`;}}><div className="li">{"\u2709"}</div><div className="lt">Contact support</div><div className="lc">{"\u203a"}</div></div>
          <div className="lrow" onClick={()=>window.open("https://wizepicks.com","_blank")}><div className="li">{"\u2605"}</div><div className="lt">Rate WizePicks</div><div className="lc">{"\u203a"}</div></div>
        </div>

        <div className="blk"><div className="bl">LEGAL &amp; RESPONSIBLE GAMING</div>
          <div className="rg"><div className="rgt">21+ · BET RESPONSIBLY</div><div className="rgs">WizePicks provides <b>analytics and information only</b> — not betting advice, and not a sportsbook. If gambling stops being fun, call <b>1-800-GAMBLER</b>. You confirmed you are 21+ and in a legal jurisdiction.</div></div>
          <div className="lrow" onClick={()=>window.open("https://wizepicks.com/terms","_blank")}><div className="li">{"\u00a7"}</div><div className="lt">Terms of Service</div><div className="lc">{"\u203a"}</div></div>
          <div className="lrow" onClick={()=>window.open("https://wizepicks.com/privacy","_blank")}><div className="li">{"\u26ff"}</div><div className="lt">Privacy Policy</div><div className="lc">{"\u203a"}</div></div>
          <div className="lrow" onClick={()=>window.open("https://www.ncpgambling.org","_blank")}><div className="li">{"\u26e8"}</div><div className="lt">Responsible gaming resources</div><div className="lc">{"\u203a"}</div></div>
        </div>

        <div className="signout" onClick={doSignOut}>Sign out</div>
        <div className="del" onClick={doDelete}>Delete account</div>
        <div className="ver">WizePicks v1.0.0 · wizepicks.com</div>
      </div>

      <nav className="nav">
        <a onClick={()=>navigate("/dashboard")}><span className="i"><svg className="dbars" viewBox="0 0 24 24" width="18" height="18"><rect x="2" y="13" width="4" height="5" rx="1"/><rect x="7.3" y="9" width="4" height="9" rx="1"/><rect x="12.6" y="11" width="4" height="7" rx="1"/><rect x="18" y="6" width="4" height="12" rx="1"/></svg></span>Dashboard</a>
        <a onClick={()=>navigate("/games")}><span className="i">{"\u25a6"}</span>Games</a>
        <a onClick={()=>navigate("/props")}><span className="i">{"\u25c8"}</span>Props</a>
        <a onClick={()=>navigate("/odds")}><span className="i">{"\u25d0"}</span>Market</a>
        <a onClick={()=>navigate("/performance")}><span className="i">{"\u25b2"}</span>Performance</a>
        <a className="on"><span className="i">{"\u25cd"}</span>Account</a>
      </nav>
    </div>
  );
}

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap');
:root{--mono:'IBM Plex Mono',ui-monospace,monospace}

:root{--bg:#06090b;--panel:#0b1117;--line:#16202a;--line2:#1d2a36;--gold:#f3b94f;--green:#33e991;--neg:#ff5d4d;--red:#ff5d4d;--steel:#2674b0;--blue:#5da9e8;--mut:#7d8a98;--mut2:#4a5663;--disp:'Barlow Condensed',sans-serif;--ui:'Inter',sans-serif;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);font-family:var(--ui);color:#e8eef0;-webkit-font-smoothing:antialiased}
.app{max-width:460px;margin:0 auto;min-height:100vh;position:relative;padding-bottom:96px}
.hd{position:sticky;top:0;z-index:10;background:rgba(6,9,11,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:0 14px}
.hrow{display:flex;align-items:center;gap:9px;padding:12px 0}
.logo{font-family:var(--disp);font-weight:800;font-size:21px;letter-spacing:.4px;color:#fff}.logo .w{color:var(--gold)}
.htitle{font-family:var(--disp);font-weight:800;font-size:18px;color:#fff;margin-left:auto}
.blk{margin:13px 14px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:14px}
.bl{font-family:var(--disp);font-weight:800;font-size:12px;letter-spacing:.7px;color:var(--mut);margin-bottom:12px}
/* profile */
.prof{display:flex;align-items:center;gap:13px}
.prof .av{width:54px;height:54px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#f3b94f,#9a6a18);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:800;font-size:22px;color:#1a1408;flex:0 0 auto}
.prof .pn{font-family:var(--disp);font-weight:800;font-size:20px;color:#fff}
.prof .pe{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:2px}
.prof .pp{display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--gold);border:1px solid rgba(243,185,79,.35);background:rgba(243,185,79,.1);border-radius:999px;padding:3px 9px}
.prof .edit{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--blue);font-weight:600;align-self:flex-start;cursor:pointer}
/* plans */
.plan{position:relative;border:1px solid var(--line2);border-radius:13px;background:#0d141b;padding:13px;margin-top:9px;cursor:pointer;transition:.15s}
.plan:first-of-type{margin-top:0}
.plan.cur{border-color:var(--gold);background:linear-gradient(180deg,rgba(243,185,79,.08),rgba(243,185,79,.01))}
.plan .pt{display:flex;align-items:baseline;gap:7px}
.plan .pname{font-family:var(--disp);font-weight:800;font-size:17px;color:#fff}
.plan .price{margin-left:auto;font-family:var(--disp);font-weight:800;font-size:22px;color:#fff}.plan .price .per{font-family:var(--mono);font-size:10px;color:var(--mut);font-weight:500}
.plan .pf{font-family:var(--mono);font-size:10px;color:var(--mut);margin-top:5px}
.plan .badge{position:absolute;top:-8px;right:12px;font-family:var(--mono);font-size:8px;font-weight:700;border-radius:5px;padding:2px 7px;letter-spacing:.3px}
.badge.best{background:var(--gold);color:#1a1408}.badge.cur{background:var(--green);color:#06120b}
.plan .save{color:var(--green);font-weight:700}
.mng{margin-top:11px;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:#06090b;background:var(--gold);border-radius:11px;padding:11px;cursor:pointer}
.billnote{font-family:var(--mono);font-size:9px;color:var(--mut2);text-align:center;margin-top:8px}
/* setting rows */
.srow{display:flex;align-items:center;gap:11px;padding:11px 0;border-top:1px solid rgba(255,255,255,.05)}.srow:first-of-type{border-top:none}
.srow .sl{flex:1;min-width:0}.srow .sn{font-weight:600;font-size:14px;color:#eaf1ee}.srow .ss{font-family:var(--mono);font-size:9.5px;color:var(--mut2);margin-top:1px}
.tg{width:44px;height:25px;border-radius:999px;background:#1a242e;position:relative;cursor:pointer;transition:.2s;flex:0 0 auto;border:1px solid var(--line2)}
.tg.on{background:var(--green);border-color:var(--green)}
.tg .k{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#fff;transition:.2s}.tg.on .k{left:21px}
.seg{display:flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden;flex:0 0 auto}
.seg b{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--mut);padding:6px 11px;cursor:pointer}.seg b.on{background:#141d24;color:#fff}
.chiprow{display:flex;flex-wrap:wrap;gap:7px;margin-top:4px}
.chiprow b{font-family:var(--disp);font-weight:700;font-size:12px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:5px 12px;cursor:pointer}.chiprow b.on{color:#06090b;background:var(--gold);border-color:var(--gold)}
/* link rows */
.lrow{display:flex;align-items:center;gap:11px;padding:12px 0;border-top:1px solid rgba(255,255,255,.05);cursor:pointer}.lrow:first-of-type{border-top:none}
.lrow .li{width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:#0e1620;display:flex;align-items:center;justify-content:center;color:var(--mut);flex:0 0 auto;font-size:14px}
.lrow .lt{flex:1;font-weight:600;font-size:14px;color:#dbe4e2}.lrow .lc{color:var(--mut2);font-size:16px}
.rg{border:1px solid rgba(255,93,77,.25);background:rgba(255,93,77,.04);border-radius:12px;padding:12px;margin-top:11px}
.rg .rgt{font-family:var(--disp);font-weight:800;font-size:12px;color:#ffb3aa;letter-spacing:.4px}
.rg .rgs{font-family:var(--ui);font-size:11px;color:var(--mut);margin-top:5px;line-height:1.5}.rg .rgs b{color:#dbe4e2}
.signout{margin:14px 14px 0;text-align:center;font-family:var(--disp);font-weight:800;font-size:14px;color:#dbe4e2;border:1px solid var(--line2);border-radius:12px;padding:13px;cursor:pointer}
.del{text-align:center;font-family:var(--mono);font-size:10px;color:var(--neg);margin:13px 0 0;cursor:pointer}
.ver{text-align:center;font-family:var(--mono);font-size:9px;color:var(--mut2);margin:16px 0 0}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:460px;display:flex;justify-content:space-around;padding:7px 4px;background:rgba(0,0,0,.96);backdrop-filter:blur(12px);border-top:1px solid var(--line);z-index:20}
.nav a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-family:var(--disp);font-weight:700;font-size:10px;letter-spacing:.3px;color:var(--mut2);text-decoration:none}
.nav a.on{color:var(--gold)}.nav a .i{font-size:15px;line-height:1}.nav a .dbars rect{fill:var(--mut2)}
`;
