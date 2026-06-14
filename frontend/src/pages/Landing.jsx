import { Link } from "react-router-dom";

/* ============================================================
   WizePicks — Landing (Direction B)
   Emerald premium hero + commercial video section + page system.
   All numbers shown are illustrative examples.
   ============================================================ */

export default function LandingPage(){
  return (
    <div className="lpwrap">
      <style>{CSS}</style>

      {/* top bar */}
      <div className="topbar"><div className="wrap">
        <div className="logo">Wize<span>Picks</span></div>
        <div className="tnav">
          <a href="#how">How it works</a>
          <a href="#edge">The Edge</a>
          <a href="#perf">Performance</a>
          <Link to="/pricing">Pricing</Link>
        </div>
        <Link className="tbtn" to="/signup">Start free →</Link>
      </div></div>

      {/* HERO */}
      <section className="hero">
        <div className="wrap">
          <div>
            <div className="eyebrow">Sharp prices, made simple</div>
            <h1 className="hl">Beat the books <em>before the line moves.</em></h1>
            <p className="sub">WizePicks grades every market against a vig-free fair price and hands you only the bets with a real edge. No spreadsheets. No guesswork.</p>
            <div className="cta-row">
              <Link className="btn btn-pri" to="/signup">Start free →</Link>
              <Link className="btn btn-ghost" to="/home">See live edges</Link>
            </div>
            <div className="price-note">$7/mo · all sports · cancel anytime</div>
          </div>
          <div>
            <div className="edgecard">
              <div className="ec-h"><span>Today's top edges</span><span className="ec-live"><span className="ec-dot"/>live</span></div>
              <div className="ec-row"><div><div className="ec-team">NYY @ TOR</div><div className="ec-meta">Over 8.5 · -104</div></div><div className="ec-edge">+4.1%</div></div>
              <div className="ec-row"><div><div className="ec-team">PHI @ MIL</div><div className="ec-meta">Under 7 · -110</div></div><div className="ec-edge">+3.6%</div></div>
              <div className="ec-row"><div><div className="ec-team">SD @ BAL</div><div className="ec-meta">Padres ML · +118</div></div><div className="ec-edge">+2.9%</div></div>
            </div>
          </div>
        </div>
      </section>

      {/* VIDEO SECTION */}
      <div className="wrap">
        <section className="vidsec">
          <div className="vid-eyebrow">▶ WATCH · 30 SECONDS</div>
          <div className="vid-h">This is what betting blind looks like.</div>
          <div className="vidframe">
            {/* ↓↓↓ When the commercial is ready, replace this placeholder with ONE of: ↓↓↓
                <video src="/wizepicks-commercial.mp4" poster="/commercial-poster.jpg" controls playsInline/>
                — or a YouTube embed —
                <iframe src="https://www.youtube.com/embed/YOUR_VIDEO_ID" title="WizePicks" allowFullScreen/>
            */}
            <div className="vid-play"/>
            <div className="vid-cap">Commercial coming soon</div>
          </div>
        </section>
      </div>

      {/* PAGE SYSTEM */}
      <div className="sech" id="how">Everything the sharps do — done for you</div>
      <div className="wrap">

        <div className="feat" id="edge">
          <div className="ftxt">
            <div className="eyebrow">The Edge Board</div>
            <h3>Only the bets worth making</h3>
            <p>Every game, every market, priced against a vig-free fair line. We surface the handful with a real edge and skip the noise.</p>
            <Link className="lk" to="/home">See today's board →</Link>
          </div>
          <div className="panel">
            <div className="pbar"><span>MLB · today</span><span>15 games</span></div>
            <div className="prow"><div><div className="t">NYY @ TOR</div><div className="m">Over 8.5 · -104</div></div><div className="pill">+4.1%</div></div>
            <div className="prow"><div><div className="t">PHI @ MIL</div><div className="m">Under 7 · -110</div></div><div className="pill">+3.6%</div></div>
            <div className="prow"><div><div className="t">SD @ BAL</div><div className="m">Padres ML · +118</div></div><div className="pill">+2.9%</div></div>
          </div>
        </div>

        <div className="feat rev">
          <div className="ftxt">
            <div className="eyebrow">Market Price</div>
            <h3>Same bet. Better number.</h3>
            <p>The same wager pays differently across books. We show you the best price every time — small gaps that compound into real money over a season.</p>
            <Link className="lk" to="/guide">How line shopping works →</Link>
          </div>
          <div className="panel">
            <div className="pbar"><span>Yankees ML</span><span>best price ✓</span></div>
            <div className="prow"><div><div className="t">FanDuel</div><div className="m">pays $191 on $100</div></div><div className="pill">best</div></div>
            <div className="prow"><div><div className="t">DraftKings</div><div className="m">pays $185</div></div><div className="m">−$6</div></div>
            <div className="prow"><div><div className="t">BetMGM</div><div className="m">pays $180</div></div><div className="m">−$11</div></div>
          </div>
        </div>

        <div className="feat" id="perf">
          <div className="ftxt">
            <div className="eyebrow">Performance</div>
            <h3>Every pick, graded in public</h3>
            <p>No cherry-picked screenshots. We publish every pick and grade it against the result — wins and losses — so you judge the model on the full record.</p>
            <Link className="lk" to="/performance">See the full track record →</Link>
          </div>
          <div className="panel">
            <div className="pbar"><span>Totals · last 60 days</span><span>tracked</span></div>
            <div className="barwrap">
              <i className="bar" style={{height:"48%"}}/><i className="bar" style={{height:"62%"}}/>
              <i className="bar" style={{height:"55%"}}/><i className="bar" style={{height:"78%"}}/>
              <i className="bar" style={{height:"70%"}}/><i className="bar" style={{height:"88%"}}/>
            </div>
          </div>
        </div>
      </div>

      {/* PROOF */}
      <div className="proof"><div className="wrap">
        <small>WHY BETTORS TRUST IT</small>
        <div className="big">We don't hide the <span>losses.</span></div>
        <small>Every number tracked live and published — illustrative example shown</small>
        <div className="stats3">
          <div className="stat"><div className="n">60.2%</div><div className="l">totals win rate (tracked)</div></div>
          <div className="stat"><div className="n">+9.8%</div><div className="l">overall ROI (tracked)</div></div>
          <div className="stat"><div className="n">$7</div><div className="l">flat monthly — no upsells</div></div>
        </div>
      </div></div>

      {/* CTA BAND */}
      <div className="ctaband"><div className="wrap">
        <h2>Stop guessing. Start with the edge.</h2>
        <p>Free to start. See today's edges before you pay a cent.</p>
        <Link className="btn btn-pri" to="/signup">Start free →</Link>
      </div></div>

      {/* FOOTER */}
      <footer><div className="wrap">
        <div className="fcols">
          <div>
            <div className="flogo">Wize<span>Picks</span></div>
            <p className="ftag">Sharp betting analytics for everyone. Not a sportsbook — we don't take bets.</p>
          </div>
          <div><h5>Product</h5>
            <a href="#edge">Edge Board</a>
            <Link to="/props">Player Props</Link>
            <Link to="/odds">Market Price</Link>
            <Link to="/performance">Performance</Link>
          </div>
          <div><h5>Learn</h5>
            <a href="#how">How it works</a>
            <Link to="/guide">What is an edge?</Link>
            <Link to="/guide">Line shopping 101</Link>
            <Link to="/guide">The Guide</Link>
          </div>
          <div><h5>Company</h5>
            <Link to="/pricing">Pricing</Link>
            <Link to="/login">Log in</Link>
            <a href="mailto:wizepickshelp@gmail.com">Contact</a>
          </div>
        </div>
        <div className="fdisc">For informational purposes only. WizePicks does not accept wagers. 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER. © 2026 WizePicks.</div>
      </div></footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
.lpwrap{--teal:#1D9E75;--mint:#38E1A0;--red:#ef4444;
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  background:#07140F;color:#E7F1EC;font-family:var(--body);-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden}
.lpwrap *{box-sizing:border-box;margin:0;padding:0}
.lpwrap a{color:inherit;text-decoration:none}
.lpwrap .wrap{max-width:1180px;margin:0 auto;padding:0 28px}

.lpwrap .topbar{position:sticky;top:0;z-index:20;background:rgba(7,20,15,.8);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.06)}
.lpwrap .topbar .wrap{display:flex;align-items:center;justify-content:space-between;height:62px}
.lpwrap .logo{font-family:var(--disp);font-weight:700;font-size:19px}
.lpwrap .logo span{color:var(--teal)}
.lpwrap .tnav{display:flex;gap:24px;font-size:14px;color:#9ab2a8}
.lpwrap .tnav a:hover{color:#E7F1EC}
.lpwrap .tbtn{font-family:var(--disp);font-weight:600;font-size:13px;background:var(--red);color:#fff;padding:9px 16px;border-radius:9px}
.lpwrap .tbtn:hover{background:#dc2626}

.lpwrap .hero{position:relative;overflow:hidden;min-height:600px;display:flex;align-items:center;
  background:linear-gradient(160deg,#07140F 0%,#0B231C 48%,#103027 100%)}
.lpwrap .hero::before{content:"";position:absolute;inset:0;background:radial-gradient(90% 80% at 85% 12%,rgba(56,225,160,.20),transparent 50%)}
.lpwrap .hero .wrap{position:relative;z-index:4;width:100%;display:grid;grid-template-columns:1fr;gap:42px;align-items:center}
@media(min-width:860px){.lpwrap .hero .wrap{grid-template-columns:1.1fr .9fr}}
.lpwrap .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--mint);
  display:inline-flex;align-items:center;gap:9px;margin-bottom:22px}
.lpwrap .eyebrow::before{content:"";width:26px;height:1px;background:var(--mint);opacity:.7}
.lpwrap h1.hl{font-family:var(--disp);font-weight:700;font-size:clamp(38px,5vw,60px);line-height:1.03;letter-spacing:-.02em;
  background:linear-gradient(92deg,#EAF7F0 30%,var(--mint));-webkit-background-clip:text;background-clip:text;color:transparent}
.lpwrap h1.hl em{font-style:normal;background:linear-gradient(92deg,var(--mint),#9CF0C8);-webkit-background-clip:text;background-clip:text;color:transparent}
.lpwrap .sub{font-size:18px;line-height:1.55;color:#A7C3B8;max-width:440px;margin:22px 0 30px}
.lpwrap .cta-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.lpwrap .btn{font-family:var(--disp);font-weight:600;font-size:15px;padding:15px 26px;border-radius:11px;cursor:pointer;border:0;display:inline-block;transition:.18s}
.lpwrap .btn-pri{background:var(--red);color:#fff;box-shadow:0 10px 30px -10px var(--red)}
.lpwrap .btn-pri:hover{background:#dc2626;transform:translateY(-1px)}
.lpwrap .btn-ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:#E7F1EC;padding:14px 22px}
.lpwrap .btn-ghost:hover{border-color:rgba(255,255,255,.34)}
.lpwrap .price-note{font-family:var(--mono);font-size:12.5px;color:#7F9C90;margin-top:18px}

.lpwrap .edgecard{background:rgba(7,22,16,.6);border:1px solid rgba(56,225,160,.3);border-radius:16px;padding:18px;backdrop-filter:blur(8px);box-shadow:0 30px 60px -30px rgba(0,0,0,.8)}
.lpwrap .ec-h{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7F9C90;display:flex;justify-content:space-between;margin-bottom:12px}
.lpwrap .ec-live{color:var(--mint);display:flex;align-items:center;gap:6px}
.lpwrap .ec-dot{width:7px;height:7px;border-radius:50%;background:var(--mint);animation:pulse 2s infinite}
.lpwrap .ec-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid rgba(255,255,255,.06)}
.lpwrap .ec-team{font-family:var(--disp);font-weight:600;font-size:15px}
.lpwrap .ec-meta{font-family:var(--mono);font-size:12px;color:#8AA89D}
.lpwrap .ec-edge{font-family:var(--mono);font-weight:700;font-size:16px;color:var(--mint)}

.lpwrap .vidsec{padding:64px 0 40px;text-align:center}
.lpwrap .vid-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--mint);margin-bottom:12px}
.lpwrap .vid-h{font-family:var(--disp);font-weight:700;font-size:clamp(24px,3.3vw,36px);letter-spacing:-.02em;margin-bottom:22px}
.lpwrap .vidframe{position:relative;max-width:880px;margin:0 auto;aspect-ratio:16/9;border-radius:18px;overflow:hidden;
  border:1px solid rgba(56,225,160,.22);box-shadow:0 40px 90px -50px #000,0 0 60px -30px rgba(56,225,160,.25);
  background:linear-gradient(135deg,#0c241c,#08130e);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px}
.lpwrap .vidframe video,.lpwrap .vidframe iframe{position:absolute;inset:0;width:100%;height:100%;display:block;border:0;object-fit:cover}
.lpwrap .vid-play{width:66px;height:66px;border-radius:50%;background:rgba(255,255,255,.92);position:relative;animation:pulse 2s infinite}
.lpwrap .vid-play::after{content:"";position:absolute;top:50%;left:54%;transform:translate(-50%,-50%);border-left:21px solid #07140f;border-top:13px solid transparent;border-bottom:13px solid transparent}
.lpwrap .vid-cap{font-family:var(--mono);font-size:12px;color:#8AA89D;letter-spacing:.14em;text-transform:uppercase}

.lpwrap .sech{font-family:var(--disp);font-weight:700;font-size:clamp(28px,3.4vw,40px);text-align:center;letter-spacing:-.02em;padding:54px 0 4px}
.lpwrap .feat{display:grid;grid-template-columns:1fr;gap:48px;align-items:center;padding:64px 0;border-bottom:1px solid rgba(255,255,255,.05)}
@media(min-width:860px){.lpwrap .feat{grid-template-columns:1fr 1fr}.lpwrap .feat.rev .ftxt{order:2}}
.lpwrap .feat .eyebrow{margin-bottom:16px}
.lpwrap .feat h3{font-family:var(--disp);font-weight:700;font-size:27px;letter-spacing:-.01em;margin-bottom:14px}
.lpwrap .feat p{color:#9DB8AD;line-height:1.6;font-size:16px;max-width:430px;margin-bottom:18px}
.lpwrap .lk{font-family:var(--mono);font-size:13px;color:var(--mint);letter-spacing:.04em}
.lpwrap .lk:hover{text-decoration:underline}
.lpwrap .panel{background:linear-gradient(160deg,#0E1B16,#0B1714);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;min-height:230px;box-shadow:0 40px 80px -50px #000}
.lpwrap .pbar{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:#7F9C90;letter-spacing:.1em;text-transform:uppercase;margin-bottom:15px}
.lpwrap .prow{display:flex;justify-content:space-between;align-items:center;padding:12px 13px;border-radius:10px;background:rgba(255,255,255,.025);margin-bottom:9px}
.lpwrap .prow .t{font-family:var(--disp);font-weight:600;font-size:14px}
.lpwrap .prow .m{font-family:var(--mono);font-size:12px;color:#8AA89D}
.lpwrap .pill{font-family:var(--mono);font-weight:700;font-size:13px;color:#03130D;background:var(--mint);padding:3px 9px;border-radius:6px}
.lpwrap .barwrap{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:8px}
.lpwrap .bar{flex:1;background:linear-gradient(180deg,var(--mint),rgba(56,225,160,.25));border-radius:5px 5px 0 0}

.lpwrap .proof{padding:60px 0;text-align:center;border-bottom:1px solid rgba(255,255,255,.05)}
.lpwrap .proof small{font-family:var(--mono);font-size:12px;color:#7F9C90;letter-spacing:.04em}
.lpwrap .proof .big{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,44px);letter-spacing:-.02em;margin:6px 0 10px}
.lpwrap .proof .big span{color:var(--mint)}
.lpwrap .stats3{display:grid;grid-template-columns:1fr;gap:18px;margin-top:32px}
@media(min-width:680px){.lpwrap .stats3{grid-template-columns:repeat(3,1fr)}}
.lpwrap .stat{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:24px}
.lpwrap .stat .n{font-family:var(--mono);font-weight:700;font-size:30px;color:var(--mint)}
.lpwrap .stat .l{font-size:13px;color:#9DB8AD;margin-top:6px}

.lpwrap .ctaband{text-align:center;padding:78px 0;background:radial-gradient(80% 120% at 50% 0%,rgba(56,225,160,.14),transparent 60%)}
.lpwrap .ctaband h2{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,46px);letter-spacing:-.02em;margin-bottom:14px}
.lpwrap .ctaband p{color:#9DB8AD;margin-bottom:26px}

.lpwrap footer{border-top:1px solid rgba(255,255,255,.07);padding:52px 0 38px;background:#060F0C}
.lpwrap .fcols{display:grid;grid-template-columns:1fr;gap:30px}
@media(min-width:760px){.lpwrap .fcols{grid-template-columns:1.4fr 1fr 1fr 1fr}}
.lpwrap .fcols h5{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7F9C90;margin-bottom:14px}
.lpwrap .fcols a{display:block;color:#A7C3B8;font-size:14px;padding:5px 0}
.lpwrap .fcols a:hover{color:#E7F1EC}
.lpwrap .flogo{font-family:var(--disp);font-weight:700;font-size:22px}
.lpwrap .flogo span{color:var(--teal)}
.lpwrap .ftag{color:#7F9C90;font-size:13px;margin-top:12px;line-height:1.6;max-width:240px}
.lpwrap .fdisc{font-family:var(--mono);font-size:11px;color:#5f776c;margin-top:28px;line-height:1.6;border-top:1px solid rgba(255,255,255,.06);padding-top:18px}

@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(56,225,160,.5)}70%{box-shadow:0 0 0 9px rgba(56,225,160,0)}100%{box-shadow:0 0 0 0 rgba(56,225,160,0)}}
`;
