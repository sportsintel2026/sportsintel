import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

/* headshot sources (graceful fallback to initials on error) */
const MLB_HEAD=(id)=>`https://midfield.mlbstatic.com/v1/people/${id}/spots/120`;
const ESPN_HEAD=(sport,id)=>`https://a.espncdn.com/i/headshots/${sport}/players/full/${id}.png`;

/* illustrative prop examples for the auto-scrolling banner — NOT live picks.
   NFL entries are marked soon:true until football props are wired in. */
const PROPS_EX = [
  {sp:"⚾ MLB", ini:"AJ", img:MLB_HEAD(592450),  ring:"#3A4F73", nm:"Aaron Judge",    mu:"NYY vs BOS", tag:"HOME RUNS",  tc:"#F5A524", tb:"rgba(245,165,36,.1)",  td:"rgba(245,165,36,.28)",  prop:"O 0.5 HR",   odds:"+265", edge:"+6.2%"},
  {sp:"⚾ MLB", ini:"SO", img:MLB_HEAD(660271),  ring:"#3E7DC4", nm:"Shohei Ohtani",  mu:"LAD vs SD",  tag:"HITS",       tc:"#38E1A0", tb:"rgba(56,225,160,.1)",  td:"rgba(56,225,160,.28)",  prop:"O 1.5 Hits", odds:"+135", edge:"+5.5%"},
  {sp:"⚾ MLB", ini:"TS", img:MLB_HEAD(669373),  ring:"#FA4616", nm:"Tarik Skubal",   mu:"DET vs CLE", tag:"STRIKEOUTS", tc:"#7fd0ff", tb:"rgba(120,200,255,.1)", td:"rgba(120,200,255,.28)", prop:"O 7.5 K",    odds:"-120", edge:"+4.4%"},
  {sp:"🏀 NBA", ini:"NJ", img:ESPN_HEAD("nba",3112335), ring:"#0E2240", nm:"Nikola Jokić",   mu:"DEN vs MIN", tag:"POINTS",     tc:"#9b7bff", tb:"rgba(155,123,255,.1)", td:"rgba(155,123,255,.28)", prop:"O 25.5 Pts", odds:"-115", edge:"+4.8%"},
  {sp:"🏀 NBA", ini:"LD", img:ESPN_HEAD("nba",3945274), ring:"#00538C", nm:"Luka Dončić",    mu:"DAL vs PHX", tag:"ASSISTS",    tc:"#9b7bff", tb:"rgba(155,123,255,.1)", td:"rgba(155,123,255,.28)", prop:"O 8.5 Ast",  odds:"-110", edge:"+3.9%"},
  {sp:"🏀 NBA", ini:"SC", img:ESPN_HEAD("nba",3975),    ring:"#1D428A", nm:"Stephen Curry",  mu:"GSW vs LAL", tag:"THREES",     tc:"#38E1A0", tb:"rgba(56,225,160,.1)",  td:"rgba(56,225,160,.28)",  prop:"O 4.5 3PM",  odds:"+105", edge:"+5.1%"},
  {sp:"🏈 NFL", ini:"PM", img:ESPN_HEAD("nfl",3139477), ring:"#E31837", nm:"Patrick Mahomes",mu:"KC vs BUF",  tag:"PASS YDS",   tc:"#F5A524", tb:"rgba(245,165,36,.1)",  td:"rgba(245,165,36,.28)",  prop:"O 274.5",    odds:"-112", edge:"+4.2%", soon:true},
  {sp:"🏈 NFL", ini:"CM", img:ESPN_HEAD("nfl",3117251), ring:"#AA0000", nm:"C. McCaffrey",   mu:"SF vs SEA",  tag:"RUSH YDS",   tc:"#ff9e6b", tb:"rgba(255,140,80,.1)",  td:"rgba(255,140,80,.28)",  prop:"O 89.5",     odds:"-115", edge:"+3.7%", soon:true},
  {sp:"🏈 NFL", ini:"TH", img:ESPN_HEAD("nfl",3116406), ring:"#008E97", nm:"Tyreek Hill",    mu:"MIA vs NYJ", tag:"ANYTIME TD", tc:"#38E1A0", tb:"rgba(56,225,160,.1)",  td:"rgba(56,225,160,.28)",  prop:"Anytime TD", odds:"+135", edge:"+4.6%", soon:true},
];


/* ============================================================
   Commercial video — autoplays MUTED when scrolled into view
   (browsers block unmuted autoplay), loops, with a tap-for-sound
   button that unmutes. Uses the YouTube IFrame API.
   ============================================================ */
const YT_ID = "OOehknqPWNE";

function CommercialVideo(){
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const [started, setStarted] = useState(false);

  // load the YouTube IFrame API once
  useEffect(()=>{
    function init(){
      if(!holderRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(holderRef.current, {
        videoId: YT_ID,
        playerVars: {
          autoplay:1, controls:0, rel:0, modestbranding:1,
          playsinline:1, mute:1, loop:1, playlist:YT_ID,
          fs:0, iv_load_policy:3, disablekb:1,
        },
        events:{ onReady:()=>setReady(true) },
      });
    }
    if(window.YT && window.YT.Player){ init(); }
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = ()=>{ prev && prev(); init(); };
      if(!document.getElementById("yt-iframe-api")){
        const s=document.createElement("script");
        s.id="yt-iframe-api"; s.src="https://www.youtube.com/iframe_api";
        document.body.appendChild(s);
      }
    }
  },[]);

  // play (muted) when scrolled into view, pause when out of view
  useEffect(()=>{
    if(!ready) return;
    const el = holderRef.current;
    const io = new IntersectionObserver((entries)=>{
      entries.forEach((e)=>{
        const p = playerRef.current; if(!p) return;
        if(e.isIntersecting){ p.mute(); p.playVideo(); setStarted(true); }
        else { p.pauseVideo(); }
      });
    }, { threshold:0.5 });
    if(el) io.observe(el);
    return ()=>io.disconnect();
  },[ready]);

  const toggleSound = ()=>{
    const p = playerRef.current; if(!p) return;
    if(muted){ p.unMute(); p.setVolume(100); p.playVideo(); setMuted(false); }
    else { p.mute(); setMuted(true); }
  };

  return (
    <div className="vidframe">
      <div ref={holderRef} className="vidyt" />
      <button className={"vid-sound"+(muted?"":" on")} onClick={toggleSound} aria-label={muted?"Tap for sound":"Mute"}>
        {muted ? "🔊 Tap for sound" : "🔈 Mute"}
      </button>
    </div>
  );
}

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

      {/* VIDEO SECTION (now on top) */}
      <section className="vidsec">
        <div className="wrap">
          <div className="vid-eyebrow">▶ WATCH · 30 SECONDS</div>
          <div className="vid-h">Betting blind is a losing game.</div>
        </div>
        <CommercialVideo />
      </section>

      {/* CUT: navy video -> white hero (clean diagonal) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L1200,0 L1200,18 L0,46 Z" fill="#0E2230"/><path d="M0,46 L1200,18 L1200,46 Z" fill="#FFFFFF"/></svg></span>

      {/* HERO (now below video) */}
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

      {/* CUT: white hero -> emerald features (clean diagonal + mint seam) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L1200,28 L1200,46 L0,46 Z" fill="#07140F"/><path d="M0,0 L1200,28" stroke="#38E1A0" stroke-opacity="0.35" stroke-width="1.5" fill="none"/></svg></span>

      {/* PAGE SYSTEM (emerald) */}
      <div className="feat-zone">
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

        <div className="feat rev" id="marketread">
          <div className="ftxt">
            <div className="eyebrow">Market Read · new</div>
            <h3>What every book is saying</h3>
            <p>We read the whole market — where the books agree, where they split, and which way they're moving — then tell you who they're leaning on. A read on the room, not a guarantee.</p>
            <Link className="lk" to="/market-read">See the market read →</Link>
          </div>
          <div className="panel">
            <div className="pbar"><span>Market Read · today</span><span>consensus</span></div>
            <div className="mrcard">
              <div className="mrtop"><span className="mrmu">SD @ STL</span><span className="mrtier" style={{color:"#5DCAA5"}}><span className="mrd" style={{background:"#1D9E75"}}/>Strong</span></div>
              <div className="mrread">Market is confident in the <b>Cardinals</b>.</div>
              <div className="mrsub">7 books agree · 61% to win</div>
            </div>
            <div className="mrcard">
              <div className="mrtop"><span className="mrmu">TB @ LAD</span><span className="mrtier" style={{color:"#EF9F27"}}><span className="mrd" style={{background:"#EF9F27"}}/>Soft</span></div>
              <div className="mrread">Books split on the <b>Dodgers</b>.</div>
              <div className="mrsub">Slim favorite · prices range</div>
            </div>
          </div>
        </div>

        {/* PLAYER PROFILE (new) — phone-left / copy-right */}
        <div className="feat rev" id="playerprofile">
          <div className="ftxt">
            <div className="eyebrow">Player Profiles</div>
            <h3>Every hitter, fully scouted.</h3>
            <p>No more blind longshots. Tap any home-run pick and the player's full batting card opens — the same scouting the model runs, in plain sight.</p>
            <Link className="lk" to="/props">Open the board →</Link>
          </div>
          <div className="panel pppanel">
            <div className="ppprow">
              <div className="pppic">KS<img src="https://midfield.mlbstatic.com/v1/people/656941/spots/120" alt="" loading="lazy" onError={(e)=>{e.currentTarget.style.display="none";}}/></div>
              <div className="pppnm">
                <div className="pppn">Kyle Schwarber</div>
                <div className="pppg">MIA @ PHI · bats L</div>
                <div className="pppl">O 0.5 HR · +240</div>
              </div>
              <div className="pppr"><div className="pppv">21<small>%</small></div><div className="pppvl">to homer</div></div>
            </div>
            <div className="pppbody">
              <div className="pppmh"><span>Tonight vs <b>RHP starter</b></span><span><i className="ppppill">RHP</i><i className="pppadv">▲ platoon</i></span></div>

              <div className="pppsec">Hand vs Hand · 2026</div>
              <div className="pppsp2">
                <div className="pppsp"><div className="pppvh">vs LHP</div><div className="pppops">.700</div><div className="pppopsl">OPS</div><div className="pppsr"><div><div className="pppsv">.210</div><div className="pppsl">AVG</div></div><div><div className="pppsv">.400</div><div className="pppsl">SLG</div></div><div><div className="pppsv ppphr">7</div><div className="pppsl">HR</div></div></div></div>
                <div className="pppsp act"><span className="ppptg">TONIGHT</span><div className="pppvh">vs RHP</div><div className="pppops">.960</div><div className="pppopsl">OPS</div><div className="pppsr"><div><div className="pppsv">.265</div><div className="pppsl">AVG</div></div><div><div className="pppsv">.580</div><div className="pppsl">SLG</div></div><div><div className="pppsv ppphr">28</div><div className="pppsl">HR</div></div></div></div>
              </div>

              <div className="pppsec">Model % vs Market %</div>
              <div className="pppmvm">
                <div className="pppmtop"><div className="pppmt">Model HR% vs implied · last 8</div><div className="pppmr"><span className="g">21%</span><span className="x">vs</span><span className="b">29%</span></div></div>
                <div className="pppplot">
                  <div className="pppcol"><span className="ppptick" style={{bottom:"46px"}}/><span className="pppbar" style={{height:"64px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"49px"}}/><span className="pppbar" style={{height:"52px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"52px"}}/><span className="pppbar" style={{height:"90px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"81px"}}/><span className="pppbar dim" style={{height:"44px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"70px"}}/><span className="pppbar dim" style={{height:"49px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"78px"}}/><span className="pppbar dim" style={{height:"41px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"52px"}}/><span className="pppbar" style={{height:"70px"}}/></div>
                  <div className="pppcol"><span className="ppptick" style={{bottom:"61px"}}/><span className="pppbar dim" style={{height:"55px"}}/></div>
                </div>
                <div className="pppdots">
                  <div className="pppdc"><span className="pppdot hit"/></div><div className="pppdc"><span className="pppdot"/></div>
                  <div className="pppdc"><span className="pppdot hit"/></div><div className="pppdc"><span className="pppdot"/></div>
                  <div className="pppdc"><span className="pppdot"/></div><div className="pppdc"><span className="pppdot"/></div>
                  <div className="pppdc"><span className="pppdot hit"/></div><div className="pppdc"><span className="pppdot"/></div>
                </div>
                <div className="pppleg"><span><i className="lg"/>model %</span><span><i className="lb"/>market %</span><span><i className="ld"/>homered</span></div>
                <div className="pppcap">Bars above the blue line = model sees more value than the price.</div>
              </div>

              <div className="pppsec">What the model sees</div>
              <div className="pppchips">
                <div className="pppchip"><div className="pppcl">Barrel % <span className="pppcrk">elite</span></div><div className="pppcv">21%</div><div className="pppcbar"><span style={{width:"90%"}}/></div></div>
                <div className="pppchip"><div className="pppcl">xwOBA <span className="pppcrk">elite</span></div><div className="pppcv">.405</div><div className="pppcbar"><span style={{width:"88%"}}/></div></div>
              </div>

              <div className="pppsec">Batted-ball profile</div>
              <div className="pppbb">
                <div className="pppbbar"><span style={{width:"56%",background:"#33e991"}}/><span style={{width:"26%",background:"#42504a"}}/><span style={{width:"18%",background:"#5da9e8"}}/></div>
                <div className="pppbbl"><span><i style={{background:"#33e991"}}/>Pull 56%</span><span><i style={{background:"#42504a"}}/>Straight 26%</span><span><i style={{background:"#5da9e8"}}/>Oppo 18%</span></div>
              </div>
            </div>
          </div>
        </div>

      </div>
      </div>

      {/* CUT: emerald features -> black props (clean diagonal + mint seam) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L1200,28 L1200,46 L0,46 Z" fill="#05080A"/><path d="M0,0 L1200,28" stroke="#38E1A0" stroke-opacity="0.4" stroke-width="1.5" fill="none"/></svg></span>

      {/* PLAYER PROPS BANNER (black) */}
      <div className="propszone"><div className="wrap">
        <section className="propsband">
          <div className="pb-eyebrow">Player Props</div>
          <div className="pb-h">The props the books <span>misprice.</span></div>
          <div className="pb-sub">Every player, every market, graded against our projection — so you see the edge before you bet.</div>
          <div className="cov">
            <div className="cov-row"><span className="cov-lab">⚾ MLB</span><span className="chip">Home Runs</span><span className="chip">Hits</span><span className="chip">Strikeouts</span><span className="chip">Total Bases</span><span className="chip">Doubles</span><span className="chip">Triples</span></div>
            <div className="cov-row"><span className="cov-lab">🏀 NBA</span><span className="chip">Points</span><span className="chip">Rebounds</span><span className="chip">Assists</span><span className="chip">Threes</span></div>
            <div className="cov-row"><span className="cov-lab">🏈 NFL</span><span className="chip">Passing Yds</span><span className="chip">Rushing Yds</span><span className="chip">Receiving Yds</span><span className="chip">Receptions</span><span className="chip">Pass TDs</span><span className="chip">Rushing TD</span><span className="chip">Anytime TD</span><span className="soon">coming soon</span></div>
          </div>
          <div className="marquee">
            <div className="track">
              {[...PROPS_EX, ...PROPS_EX].map((p,i)=>(
                <div className="pcard" key={i}>
                  {p.soon && <span className="pc-soon">soon</span>}
                  <div className="pc-top">
                    <div className="pc-av" style={{boxShadow:`0 0 0 2px ${p.ring}`}}>
                      {p.ini}
                      {p.img && <img src={p.img} alt="" loading="lazy" onError={(e)=>{e.currentTarget.style.display="none";}}/>}
                    </div>
                    <div><div className="pc-sport">{p.sp}</div><div className="pc-nm">{p.nm}</div><div className="pc-mu">{p.mu}</div></div>
                  </div>
                  <span className="pc-tag" style={{color:p.tc,background:p.tb,border:`1px solid ${p.td}`}}>{p.tag}</span>
                  <div className="pc-bet"><div><div className="pc-prop">{p.prop}</div><div className="pc-odds">{p.odds}</div></div><div className="pc-edge">{p.edge}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div className="pb-foot">
            <Link className="pb-btn" to="/props">See all props →</Link>
            <span className="pb-ex">Illustrative examples — not live picks</span>
          </div>
        </section>
      </div></div>

      {/* CUT: black props -> white tools (clean diagonal into white) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,46 L1200,18 L1200,46 Z" fill="#05080A"/><path d="M0,0 L1200,0 L1200,18 L0,46 Z" fill="#FFFFFF"/></svg></span>

      {/* TOOLS TO WIN (white two-tone) — the turn */}
      <div className="band-white">
        <section className="tools"><div className="wrap">
          <div className="lab">The tools to win</div>
          <h2>Trust your gut — with the data on your side.</h2>
          <p>We don't sell guaranteed picks. We hand you every edge, every prop, and what the whole market is saying — then you make the call. That's the smartest way to beat the books.</p>
          <Link className="btn btn-pri" to="/signup">Get started →</Link>
        </div></section>
      </div>

      {/* CUT: white tools -> emerald proof (clean diagonal out of white) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L1200,28 L1200,46 L0,46 Z" fill="#07140F"/><path d="M0,0 L1200,28 L1200,0 Z" fill="#CFE2F4"/></svg></span>

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

      {/* CUT: emerald proof -> blue CTA (peaks) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L400,36 L800,8 L1200,32 L1200,46 L0,46 Z" fill="#123A5C"/></svg></span>

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
.lpwrap{--teal:#1D9E75;--mint:#38E1A0;--red:#ef4444;--blue:#123A5C;--bluelt:#5DA9E8;
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  background:#07140F;color:#E7F1EC;font-family:var(--body);-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden}
.lpwrap *{box-sizing:border-box;margin:0;padding:0}
.lpwrap a{color:inherit;text-decoration:none}
.lpwrap .wrap{max-width:1180px;margin:0 auto;padding:0 28px}

/* ---- alternating section backgrounds + creative diagonal cuts ---- */
.lpwrap .band{position:relative}
.lpwrap .band-navy{background:#0E2230}
.lpwrap .band-emerald{background:#07140F}
.lpwrap .band-blue{background:var(--blue)}
.lpwrap .band-black{background:#05080A}
.lpwrap .band-white{background:linear-gradient(165deg,#FFFFFF 0%,#EAF2FA 55%,#CFE2F4 100%);color:#0A1410}
.lpwrap .cut{display:block;height:0;line-height:0}
.lpwrap .cut svg{display:block;width:100%;height:46px}
@media(max-width:859px){.lpwrap .cut svg{height:32px}}

.lpwrap .topbar{position:sticky;top:0;z-index:20;background:rgba(14,34,48,.85);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.06)}
.lpwrap .topbar .wrap{display:flex;align-items:center;justify-content:space-between;height:62px}
.lpwrap .logo{font-family:var(--disp);font-weight:700;font-size:19px}
.lpwrap .logo span{color:var(--teal)}
.lpwrap .tnav{display:flex;gap:24px;font-size:14px;color:#9ab2a8}
.lpwrap .tnav a:hover{color:#E7F1EC}
.lpwrap .tbtn{font-family:var(--disp);font-weight:600;font-size:13px;background:var(--red);color:#fff;padding:9px 16px;border-radius:9px}
.lpwrap .tbtn:hover{background:#dc2626}

.lpwrap .hero{position:relative;overflow:hidden;min-height:600px;display:flex;align-items:center;padding:48px 0 56px;
  background:linear-gradient(165deg,#FFFFFF 0%,#EAF2FA 55%,#CFE2F4 100%)}
.lpwrap .hero::before{content:"";position:absolute;inset:0;background:radial-gradient(90% 80% at 85% 12%,rgba(29,158,117,.10),transparent 50%)}
.lpwrap .hero .wrap{position:relative;z-index:4;width:100%;display:grid;grid-template-columns:1fr;gap:42px;align-items:center}
@media(min-width:860px){.lpwrap .hero .wrap{grid-template-columns:1.1fr .9fr}}
.lpwrap .hero .eyebrow{color:var(--teal)}
.lpwrap .hero .eyebrow::before{background:var(--teal)}
.lpwrap .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--mint);
  display:inline-flex;align-items:center;gap:9px;margin-bottom:22px}
.lpwrap .eyebrow::before{content:"";width:26px;height:1px;background:var(--mint);opacity:.7}
.lpwrap h1.hl{font-family:var(--disp);font-weight:700;font-size:clamp(38px,5vw,60px);line-height:1.03;letter-spacing:-.02em;
  color:#0A1410}
.lpwrap h1.hl em{font-style:normal;color:var(--teal)}
.lpwrap .hero .sub{color:#46554E}
.lpwrap .hero .btn-ghost{color:#0A1410;border:1px solid #C9D6D0}
.lpwrap .hero .btn-ghost:hover{border-color:#9fb3aa}
.lpwrap .hero .price-note{color:#6B7A73}
.lpwrap .sub{font-size:18px;line-height:1.55;color:#A7C3B8;max-width:440px;margin:22px 0 30px}
.lpwrap .cta-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.lpwrap .btn{font-family:var(--disp);font-weight:600;font-size:15px;padding:15px 26px;border-radius:11px;cursor:pointer;border:0;display:inline-block;transition:.18s}
.lpwrap .btn-pri{background:var(--red);color:#fff;box-shadow:0 10px 30px -10px var(--red)}
.lpwrap .btn-pri:hover{background:#dc2626;transform:translateY(-1px)}
.lpwrap .btn-ghost{background:transparent;border:1px solid rgba(255,255,255,.18);color:#E7F1EC;padding:14px 22px}
.lpwrap .btn-ghost:hover{border-color:rgba(255,255,255,.34)}
.lpwrap .price-note{font-family:var(--mono);font-size:12.5px;color:#7F9C90;margin-top:18px}

.lpwrap .edgecard{background:#0A1712;border:1px solid rgba(56,225,160,.22);border-radius:16px;padding:18px;box-shadow:0 24px 50px -20px rgba(7,20,15,.45)}
.lpwrap .ec-h{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8FB0A4;display:flex;justify-content:space-between;margin-bottom:12px}
.lpwrap .ec-live{color:var(--mint);display:flex;align-items:center;gap:6px}
.lpwrap .ec-dot{width:7px;height:7px;border-radius:50%;background:var(--mint);animation:pulse 2s infinite}
.lpwrap .ec-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid rgba(255,255,255,.08)}
.lpwrap .ec-team{font-family:var(--disp);font-weight:600;font-size:15px;color:#F2F8F5}
.lpwrap .ec-meta{font-family:var(--mono);font-size:12px;color:#9DBAAF}
.lpwrap .ec-edge{font-family:var(--mono);font-weight:700;font-size:16px;color:var(--mint)}

.lpwrap .vidsec{padding:30px 0 36px;text-align:center}
.lpwrap .vid-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--mint);margin-bottom:12px}
.lpwrap .vid-h{font-family:var(--disp);font-weight:700;font-size:clamp(24px,3.3vw,36px);letter-spacing:-.02em;margin-bottom:22px}
.lpwrap .vidframe{position:relative;width:100vw;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;max-width:100vw;aspect-ratio:16/9;border-radius:0;overflow:hidden;
  border:0;border-top:1px solid rgba(56,225,160,.18);border-bottom:1px solid rgba(56,225,160,.18);box-shadow:0 40px 90px -50px #000;
  background:linear-gradient(135deg,#0c241c,#08130e);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px}
.lpwrap .vidframe video,.lpwrap .vidframe iframe{position:absolute;inset:0;width:100%;height:100%;display:block;border:0;object-fit:cover}
.lpwrap .vidyt{position:absolute;inset:0;width:100%;height:100%}
.lpwrap .vidyt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.lpwrap .vid-sound{position:absolute;right:14px;bottom:14px;z-index:5;cursor:pointer;
  font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:#07140f;
  background:#38E1A0;border:0;border-radius:999px;padding:9px 15px;font-weight:700;
  box-shadow:0 8px 24px -8px rgba(0,0,0,.6);transition:transform .15s,background .15s}
.lpwrap .vid-sound:hover{transform:translateY(-1px)}
.lpwrap .vid-sound.on{background:rgba(7,20,15,.78);color:#cfe9df;border:1px solid rgba(56,225,160,.4)}
.lpwrap .vid-play{width:66px;height:66px;border-radius:50%;background:rgba(255,255,255,.92);position:relative;animation:pulse 2s infinite}
.lpwrap .vid-play::after{content:"";position:absolute;top:50%;left:54%;transform:translate(-50%,-50%);border-left:21px solid #07140f;border-top:13px solid transparent;border-bottom:13px solid transparent}
.lpwrap .vid-cap{font-family:var(--mono);font-size:12px;color:#8AA89D;letter-spacing:.14em;text-transform:uppercase}

.lpwrap .sech{font-family:var(--disp);font-weight:700;font-size:clamp(28px,3.4vw,40px);text-align:center;letter-spacing:-.02em;padding:54px 0 4px}
.lpwrap .feat{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;padding:64px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.lpwrap .feat.rev .ftxt{order:2}
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
/* Player Profile feature panel — solid near-black to match the mock */
.lpwrap .panel.pppanel{padding:0;overflow:hidden;background:#0b0f14;border:1px solid rgba(51,233,145,.3);min-height:0}
.lpwrap .ppprow{position:relative;display:flex;align-items:center;gap:11px;padding:13px 14px;background:#141619;border-bottom:1px dashed #20303a}
.lpwrap .pppic{position:relative;width:44px;height:44px;border-radius:50%;flex:0 0 44px;background:linear-gradient(180deg,#E81828,#0c1018 88%);box-shadow:0 0 0 2px #E8182866;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;color:#fff;font-size:14px}
.lpwrap .pppic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lpwrap .pppnm{flex:1;min-width:0}
.lpwrap .pppn{font-family:var(--disp);font-weight:700;font-size:17px;color:#f2f6f4;line-height:1.05}
.lpwrap .pppg{font-family:var(--mono);font-size:10px;color:#8a99a2;margin-top:2px}
.lpwrap .pppl{font-size:11px;color:#b6c0c7;margin-top:3px}
.lpwrap .pppr{text-align:right;flex:0 0 auto}
.lpwrap .pppv{font-family:var(--disp);font-weight:700;font-size:26px;color:#33e991;line-height:.9}
.lpwrap .pppv small{font-size:14px}
.lpwrap .pppvl{font-family:var(--mono);font-size:8px;color:#8a99a2;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
.lpwrap .pppbody{padding:12px 14px 15px}
.lpwrap .pppmh{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0d1218;border:1px solid #23262b;border-radius:10px;padding:9px 11px}
.lpwrap .pppmh>span:first-child{font-size:11px;color:#8a99a2}.lpwrap .pppmh b{font-family:var(--disp);font-weight:700;color:#eef3f1;font-size:12.5px}
.lpwrap .ppppill{font-family:var(--mono);font-weight:700;font-size:10px;font-style:normal;padding:2px 7px;border-radius:6px;background:rgba(93,169,232,.14);color:#5DA9E8;border:1px solid rgba(93,169,232,.3)}
.lpwrap .pppadv{font-family:var(--mono);font-weight:700;font-size:10px;font-style:normal;color:#7CF0A8;background:rgba(51,233,145,.12);border:1px solid rgba(51,233,145,.3);padding:2px 7px;border-radius:6px;margin-left:5px;white-space:nowrap}
.lpwrap .pppsec{font-family:var(--mono);font-weight:700;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8a99a2;margin:14px 0 9px;display:flex;align-items:center;gap:7px}
.lpwrap .pppsec::before{content:"";width:5px;height:5px;border-radius:50%;background:#33e991;flex:0 0 auto}
.lpwrap .pppsp2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.lpwrap .pppsp{position:relative;background:#0d1218;border:1px solid #23262b;border-radius:11px;padding:10px 11px;min-width:0}
.lpwrap .pppsp.act{border-color:rgba(255,122,108,.5);background:linear-gradient(180deg,rgba(51,233,145,.06),#0d1218)}
.lpwrap .ppptg{position:absolute;top:-8px;right:9px;font-family:var(--mono);font-weight:700;font-size:8px;background:#FF7A6C;color:#1a0c08;padding:1px 7px;border-radius:5px}
.lpwrap .pppvh{font-family:var(--mono);font-weight:700;font-size:11px;color:#8a99a2}.lpwrap .pppsp.act .pppvh{color:#7CF0A8}
.lpwrap .pppops{font-family:var(--disp);font-weight:700;font-size:23px;line-height:1;margin-top:5px;color:#f2f6f4}
.lpwrap .pppopsl{font-family:var(--mono);font-size:8px;color:#6a7882;letter-spacing:.1em;text-transform:uppercase}
.lpwrap .pppsr{display:flex;justify-content:space-between;margin-top:8px;gap:3px}.lpwrap .pppsr div{flex:1;text-align:center;min-width:0}
.lpwrap .pppsv{font-family:var(--disp);font-weight:700;font-size:12px;color:#f2f6f4}.lpwrap .pppsl{font-family:var(--mono);font-size:7px;color:#6a7882;text-transform:uppercase;margin-top:2px}
.lpwrap .ppphr{color:#E8C07A}
.lpwrap .pppmvm{background:#0c1015;border:1px solid #1a2129;border-radius:12px;padding:12px 13px 10px}
.lpwrap .pppmtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lpwrap .pppmt{font-size:10px;color:#8a99a2}
.lpwrap .pppmr{font-family:var(--disp);font-weight:700;font-size:14px;color:#f2f6f4;white-space:nowrap}.lpwrap .pppmr .g{color:#33e991}.lpwrap .pppmr .b{color:#5DA9E8}.lpwrap .pppmr .x{color:#5a6b63;font-size:11px;margin:0 4px}
.lpwrap .pppplot{position:relative;height:96px;display:flex;align-items:flex-end;gap:7px;margin:12px 2px 0;border-bottom:1px solid #1c242c}
.lpwrap .pppcol{position:relative;flex:1;height:100%;display:flex;align-items:flex-end}
.lpwrap .pppbar{width:100%;border-radius:5px 5px 0 0;background:linear-gradient(180deg,#3df2a0,#1f9d62)}
.lpwrap .pppbar.dim{background:linear-gradient(180deg,#2c6b4f,#1d4a37)}
.lpwrap .ppptick{position:absolute;left:-1px;right:-1px;height:3px;border-radius:2px;background:#5DA9E8;box-shadow:0 0 7px rgba(93,169,232,.55)}
.lpwrap .pppdots{display:flex;gap:7px;margin:8px 2px 0}.lpwrap .pppdc{flex:1;display:flex;justify-content:center}
.lpwrap .pppdot{width:8px;height:8px;border-radius:50%;border:1.5px solid #2f6a4d}.lpwrap .pppdot.hit{background:#33e991;border-color:#33e991;box-shadow:0 0 7px rgba(51,233,145,.6)}
.lpwrap .pppleg{display:flex;justify-content:center;gap:14px;margin-top:11px;font-family:var(--mono);font-size:9px;color:#8a99a2;flex-wrap:wrap}
.lpwrap .pppleg span{display:flex;align-items:center;gap:5px}
.lpwrap .pppleg i{display:inline-block}.lpwrap .pppleg .lg{width:9px;height:9px;border-radius:2px;background:#33e991}.lpwrap .pppleg .lb{width:12px;height:3px;border-radius:2px;background:#5DA9E8}.lpwrap .pppleg .ld{width:9px;height:9px;border-radius:50%;background:#33e991}
.lpwrap .pppcap{font-size:9px;color:#5f6d76;text-align:center;margin-top:9px;line-height:1.4}
.lpwrap .pppchips{display:flex;gap:9px}
.lpwrap .pppchip{flex:1;background:#0d1218;border:1px solid #23262b;border-radius:11px;padding:9px 10px;min-width:0}
.lpwrap .pppcl{font-size:10px;color:#8a99a2;display:flex;justify-content:space-between;align-items:center;gap:5px}
.lpwrap .pppcrk{font-family:var(--mono);font-weight:700;font-size:8px;color:#03130D;background:#33e991;padding:1px 6px;border-radius:5px;white-space:nowrap}
.lpwrap .pppcv{font-family:var(--disp);font-weight:700;font-size:18px;margin-top:3px;color:#f2f6f4}
.lpwrap .pppcbar{height:3px;border-radius:2px;background:rgba(51,233,145,.12);margin-top:6px;overflow:hidden}.lpwrap .pppcbar>span{display:block;height:100%;background:linear-gradient(90deg,#1f9d62,#33e991)}
.lpwrap .pppbb{background:#0d1218;border:1px solid #23262b;border-radius:11px;padding:11px}
.lpwrap .pppbbar{display:flex;height:13px;border-radius:7px;overflow:hidden;gap:2px;background:#0a0e12}.lpwrap .pppbbar>span{display:block;height:100%}
.lpwrap .pppbbl{display:flex;justify-content:space-between;margin-top:8px;font-family:var(--mono);font-size:10px;color:#b6c0c7;gap:6px}.lpwrap .pppbbl i{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:-1px}
.lpwrap #playerprofile .ftxt{min-width:0}
@media(max-width:859px){.lpwrap #playerprofile{grid-template-columns:1fr;gap:22px}.lpwrap #playerprofile .ftxt{order:2}}
.lpwrap .barwrap{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:8px}
.lpwrap .bar{flex:1;background:linear-gradient(180deg,var(--mint),rgba(56,225,160,.25));border-radius:5px 5px 0 0}

.lpwrap .proof{padding:60px 0;text-align:center;border-bottom:1px solid rgba(255,255,255,.05)}
.lpwrap .proof small{font-family:var(--mono);font-size:12px;color:#7F9C90;letter-spacing:.04em}
.lpwrap .proof .big{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,44px);letter-spacing:-.02em;margin:6px 0 10px}
.lpwrap .proof .big span{color:var(--mint)}
.lpwrap .stats3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:32px}
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

@media(max-width:859px){
  .lpwrap .wrap{padding:0 16px}
  .lpwrap .tnav{display:none}
  .lpwrap .feat{gap:16px;padding:42px 0}
  .lpwrap .feat .eyebrow{margin-bottom:9px;font-size:10.5px;letter-spacing:.12em}
  .lpwrap .feat .eyebrow::before{width:16px}
  .lpwrap .feat h3{font-size:20px;line-height:1.16;margin-bottom:10px}
  .lpwrap .feat p{font-size:14px;line-height:1.5;margin-bottom:14px}
  .lpwrap .lk{font-size:13px}
  .lpwrap .panel{padding:15px;border-radius:15px;min-height:0}
  .lpwrap .pbar{font-size:9.5px;letter-spacing:.05em;margin-bottom:12px}
  .lpwrap .prow{padding:11px 12px;margin-bottom:8px;border-radius:10px}
  .lpwrap .prow .t{font-size:13.5px}
  .lpwrap .prow .m{font-size:10px}
  .lpwrap .pill{font-size:11px;padding:3px 8px;border-radius:6px}
  .lpwrap .barwrap{height:104px;gap:6px}
  .lpwrap .sech{font-size:25px;padding:44px 0 4px}
  .lpwrap .stats3{gap:11px;margin-top:28px}
  .lpwrap .stat{padding:18px 12px}
  .lpwrap .stat .n{font-size:25px}
  .lpwrap .stat .l{font-size:11px}
}
/* ---- player props banner (narrow + airy, auto-scrolling cards) ---- */
.lpwrap .propsband{position:relative;overflow:hidden;max-width:860px;margin:6px auto 0;padding:30px 0 26px;
  border-radius:20px;border:1px solid rgba(56,225,160,.12);
  background:radial-gradient(120% 130% at 50% -20%,rgba(56,225,160,.07),transparent 55%);text-align:center}
.lpwrap .pb-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--mint);display:inline-flex;align-items:center;gap:9px;margin-bottom:12px}
.lpwrap .pb-eyebrow::before,.lpwrap .pb-eyebrow::after{content:"";width:20px;height:1px;background:var(--mint);opacity:.6}
.lpwrap .pb-h{font-family:var(--disp);font-weight:700;font-size:clamp(22px,3.2vw,32px);letter-spacing:-.02em;margin-bottom:11px;padding:0 18px}
.lpwrap .pb-h span{color:var(--mint)}
.lpwrap .pb-sub{font-size:14.5px;line-height:1.55;color:#A7C3B8;max-width:460px;margin:0 auto 20px;padding:0 18px}
.lpwrap .cov{max-width:680px;margin:0 auto 22px;display:flex;flex-direction:column;gap:8px;padding:0 18px}
.lpwrap .cov-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:center}
.lpwrap .cov-lab{font-family:var(--mono);font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#E7F1EC}
.lpwrap .chip{font-family:var(--mono);font-size:11px;color:#A7C3B8;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:4px 9px}
.lpwrap .soon{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#F5A524;background:rgba(245,165,36,.1);border:1px solid rgba(245,165,36,.3);border-radius:6px;padding:4px 7px}
.lpwrap .marquee{position:relative;overflow:hidden;padding:4px 0 2px;
  -webkit-mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.lpwrap .track{display:flex;gap:12px;width:max-content;animation:marq 38s linear infinite}
.lpwrap .marquee:hover .track{animation-play-state:paused}
@keyframes marq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.lpwrap .track{animation:none}}
.lpwrap .pcard{flex:0 0 220px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:14px;text-align:left}
.lpwrap .pc-top{display:flex;align-items:center;gap:10px;margin-bottom:11px}
.lpwrap .pc-av{position:relative;overflow:hidden;width:38px;height:38px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:12px;color:#fff;background:#1a2b24}
.lpwrap .pc-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}
.lpwrap .pc-sport{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;color:#7F9C90}
.lpwrap .pc-nm{font-family:var(--disp);font-weight:600;font-size:14px;line-height:1.15}
.lpwrap .pc-mu{font-family:var(--mono);font-size:9.5px;color:#7F9C90;margin-top:1px}
.lpwrap .pc-tag{display:inline-block;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:6px;margin-bottom:10px}
.lpwrap .pc-bet{display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,.07);padding-top:10px}
.lpwrap .pc-prop{font-family:var(--disp);font-weight:600;font-size:14px}
.lpwrap .pc-odds{font-family:var(--mono);font-size:11px;color:#8AA89D}
.lpwrap .pc-edge{font-family:var(--mono);font-weight:700;font-size:14px;color:var(--mint)}
.lpwrap .pc-soon{float:right;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.1em;color:#F5A524;background:rgba(245,165,36,.12);border:1px solid rgba(245,165,36,.3);border-radius:5px;padding:2px 6px}
.lpwrap .pb-foot{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:22px;padding:0 18px}
.lpwrap .pb-btn{font-family:var(--disp);font-weight:600;font-size:14px;background:var(--red);color:#fff;padding:12px 22px;border-radius:11px}
.lpwrap .pb-btn:hover{background:#dc2626}
.lpwrap .pb-ex{font-family:var(--mono);font-size:10.5px;color:#5f7a70}

/* ---- Market Read card (inside feature panel) ---- */
.lpwrap .mrcard{background:rgba(93,169,232,.06);border:1px solid rgba(93,169,232,.22);border-radius:12px;padding:12px 13px;margin-bottom:9px}
.lpwrap .mrcard:last-child{margin-bottom:0}
.lpwrap .mrtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.lpwrap .mrmu{font-family:var(--disp);font-weight:600;color:#E7F1EC;font-size:14px}
.lpwrap .mrtier{font-family:var(--mono);font-size:10.5px;font-weight:700;display:flex;align-items:center;gap:5px}
.lpwrap .mrd{width:7px;height:7px;border-radius:50%;display:inline-block}
.lpwrap .mrread{font-size:13.5px;color:#E7F1EC;font-weight:600;line-height:1.4}
.lpwrap .mrread b{color:#9FD0F5;font-weight:700}
.lpwrap .mrsub{font-family:var(--mono);font-size:10.5px;color:#8FB0C4;margin-top:4px}

/* ---- Tools to win (white two-tone band) ---- */
.lpwrap .tools{padding:54px 0}
.lpwrap .tools .lab{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);background:#E6F1FB;border:1px solid #B5D4F4;padding:6px 14px;border-radius:20px;margin-bottom:16px}
.lpwrap .tools h2{font-family:var(--disp);font-weight:700;font-size:clamp(26px,3.6vw,38px);line-height:1.12;letter-spacing:-.02em;color:#0A1410;margin-bottom:13px;max-width:600px}
.lpwrap .tools p{font-size:16px;color:#46554E;line-height:1.6;max-width:520px;margin-bottom:22px}
.lpwrap .tools .btn-pri{background:var(--teal);box-shadow:0 10px 30px -12px var(--teal)}
.lpwrap .tools .btn-pri:hover{background:#17835f}

/* ---- band-aware overrides ---- */
.lpwrap .vidsec{background:#0E2230}
.lpwrap .vid-eyebrow{color:var(--bluelt)}
.lpwrap .feat-zone{background:#07140F}
.lpwrap .propszone{background:#05080A;padding-top:34px;padding-bottom:8px}
.lpwrap .propsband{border-color:rgba(56,225,160,.14)}
.lpwrap .proof{background:#07140F}
.lpwrap .ctaband{background:var(--blue) !important}
.lpwrap .ctaband p{color:#C5DCEF}

@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(56,225,160,.5)}70%{box-shadow:0 0 0 9px rgba(56,225,160,0)}100%{box-shadow:0 0 0 0 rgba(56,225,160,0)}}
`;
