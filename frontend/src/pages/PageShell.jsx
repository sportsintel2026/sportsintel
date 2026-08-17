// WZ-SEO-TRUSTPAGES-2026-08-17 :: shared presentational shell for the public trust pages
// (/about, /how-it-works). Purely layout + styling in the existing WizePicks dark aesthetic
// (mirrors the legal-page look). No data, no auth, no model logic. Each page owns its useSeo().
import { Link, useNavigate } from "react-router-dom";

export function Section({ h, children }) {
  return (
    <section className="pg-sec">
      <h2 className="pg-h2">{h}</h2>
      {children}
    </section>
  );
}
export const P = ({ children }) => <p className="pg-p">{children}</p>;
export const LI = ({ children }) => <li className="pg-li">{children}</li>;
export const H3 = ({ children }) => <h3 className="pg-h3">{children}</h3>;

// A crawlable in-page link row (rendered as real <a href> by react-router).
export function PageNav({ links }) {
  return (
    <nav className="pg-nav">
      {links.map((l, i) => (
        <span key={l.to}>
          <Link to={l.to}>{l.label}</Link>
          {i < links.length - 1 && <i />}
        </span>
      ))}
    </nav>
  );
}

export default function PageShell({ title, lead, children }) {
  const navigate = useNavigate();
  return (
    <div className="pg-root">
      <style>{PG_CSS}</style>
      <div className="pg-wrap">
        <div className="pg-top">
          <div className="pg-brand" onClick={() => navigate("/")}>Wize<span>Picks</span></div>
          <button className="pg-back" onClick={() => navigate(-1)}>&larr; Back</button>
        </div>
        <h1 className="pg-h1">{title}</h1>
        {lead && <p className="pg-lead">{lead}</p>}
        {children}
        <div className="pg-foot">
          <span>21+</span><i /><span>Gamble Responsibly</span><i /><span>1-800-GAMBLER</span><i /><span>ncpgambling.org</span>
        </div>
      </div>
    </div>
  );
}

const PG_CSS = `
.pg-root{min-height:100vh;background:#0A0B0D;color:#cfd7e1;font-family:Inter,system-ui,-apple-system,sans-serif;padding:0 0 80px}
.pg-wrap{max-width:760px;margin:0 auto;padding:22px 20px 40px}
.pg-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
.pg-brand{font-family:Georgia,"Times New Roman",serif;font-size:23px;font-weight:700;color:#fff;letter-spacing:-.5px;cursor:pointer}
.pg-brand span{color:#C9A86A}
.pg-back{appearance:none;background:transparent;border:1px solid #2a2f37;color:#9aa3ad;font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:9px;cursor:pointer}
.pg-back:active{opacity:.7}
.pg-h1{font-family:"Barlow Condensed",Inter,sans-serif;font-size:34px;font-weight:800;color:#fff;letter-spacing:.3px;margin:0 0 10px}
.pg-lead{font-size:15px;line-height:1.6;color:#c3ccd6;margin:0 0 6px}
.pg-sec{margin-top:24px}
.pg-h2{font-size:17px;font-weight:800;color:#fff;margin:0 0 8px}
.pg-h3{font-size:14.5px;font-weight:800;color:#e8ecef;margin:16px 0 6px}
.pg-p{font-size:13.5px;line-height:1.62;color:#aeb8c2;margin:0 0 10px}
.pg-p b{color:#e3e9ef;font-weight:700}
.pg-p a{color:#C9A86A;text-decoration:none;font-weight:600}
.pg-p a:hover{text-decoration:underline;text-underline-offset:2px}
.pg-ul{margin:0 0 10px;padding-left:20px}
.pg-li{font-size:13.5px;line-height:1.6;color:#aeb8c2;margin-bottom:5px}
.pg-li b{color:#e3e9ef;font-weight:700}
.pg-nav{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:26px;font-size:13px}
.pg-nav a{color:#C9A86A;text-decoration:none;font-weight:600}
.pg-nav a:hover{text-decoration:underline;text-underline-offset:2px}
.pg-nav i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block;margin-left:10px}
.pg-foot{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:9px;margin-top:36px;padding-top:18px;border-top:1px solid #1b1f25;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;font-weight:600;letter-spacing:.4px;color:#C9A86A}
.pg-foot i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block}
`;
