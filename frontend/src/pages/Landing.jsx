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
/* ---- WZ-FOOTER-REDESIGN-2026-07-13 :: trading-card wall data + component ---- */
const TC_A = [
  {sp:"\u26be MLB",img:MLB_HEAD(592450),acc:"#1a3a6b",glow:"rgba(93,169,232,.30)",nm:"Aaron Judge",mu:"NYY vs BOS",tag:"HOME RUNS",tc:"#F5A524",tb:"rgba(245,165,36,.1)",td:"rgba(245,165,36,.32)",prop:"O 0.5 HR",odds:"+265",edge:"+6.2%"},
  {sp:"\ud83c\udfc0 NBA",img:ESPN_HEAD("nba",3112335),acc:"#0E2240",glow:"rgba(93,130,232,.30)",nm:"Nikola Joki\u0107",mu:"DEN vs MIN",tag:"POINTS",tc:"#9b7bff",tb:"rgba(155,123,255,.1)",td:"rgba(155,123,255,.32)",prop:"O 25.5",odds:"-115",edge:"+4.8%"},
  {sp:"\ud83c\udfc8 NFL",img:ESPN_HEAD("nfl",3139477),acc:"#8a0f22",glow:"rgba(232,93,93,.30)",nm:"P. Mahomes",mu:"KC vs BUF",tag:"PASS YDS",tc:"#F5A524",tb:"rgba(245,165,36,.1)",td:"rgba(245,165,36,.32)",prop:"O 274.5",odds:"-112",edge:"+4.2%",soon:true},
  {sp:"\u26be MLB",img:MLB_HEAD(660271),acc:"#0e3b6b",glow:"rgba(93,169,232,.30)",nm:"Shohei Ohtani",mu:"LAD vs SD",tag:"HITS",tc:"#38E1A0",tb:"rgba(56,225,160,.1)",td:"rgba(56,225,160,.32)",prop:"O 1.5 Hits",odds:"+135",edge:"+5.5%"},
  {sp:"\ud83c\udfc0 NBA",img:ESPN_HEAD("nba",3975),acc:"#123a6b",glow:"rgba(93,169,232,.30)",nm:"Stephen Curry",mu:"GSW vs LAL",tag:"THREES",tc:"#38E1A0",tb:"rgba(56,225,160,.1)",td:"rgba(56,225,160,.32)",prop:"O 4.5 3PM",odds:"+105",edge:"+5.1%"},
];
const TC_B = [
  {sp:"\ud83c\udfc8 NFL",img:ESPN_HEAD("nfl",3117251),acc:"#7a0d10",glow:"rgba(232,93,93,.30)",nm:"C. McCaffrey",mu:"SF vs SEA",tag:"RUSH YDS",tc:"#ff9e6b",tb:"rgba(255,140,80,.1)",td:"rgba(255,140,80,.32)",prop:"O 89.5",odds:"-115",edge:"+3.7%",soon:true},
  {sp:"\u26be MLB",img:MLB_HEAD(669373),acc:"#8a2410",glow:"rgba(250,120,70,.30)",nm:"Tarik Skubal",mu:"DET vs CLE",tag:"STRIKEOUTS",tc:"#7fd0ff",tb:"rgba(120,200,255,.1)",td:"rgba(120,200,255,.32)",prop:"O 7.5 K",odds:"-120",edge:"+4.4%"},
  {sp:"\ud83c\udfc0 NBA",img:ESPN_HEAD("nba",3945274),acc:"#00366b",glow:"rgba(93,169,232,.30)",nm:"Luka Don\u010di\u0107",mu:"DAL vs PHX",tag:"ASSISTS",tc:"#9b7bff",tb:"rgba(155,123,255,.1)",td:"rgba(155,123,255,.32)",prop:"O 8.5 Ast",odds:"-110",edge:"+3.9%"},
  {sp:"\ud83c\udfc8 NFL",img:ESPN_HEAD("nfl",3116406),acc:"#00565b",glow:"rgba(56,225,160,.30)",nm:"Tyreek Hill",mu:"MIA vs NYJ",tag:"ANYTIME TD",tc:"#38E1A0",tb:"rgba(56,225,160,.1)",td:"rgba(56,225,160,.32)",prop:"Anytime TD",odds:"+135",edge:"+4.6%",soon:true},
  {sp:"\u26be MLB",img:MLB_HEAD(592450),acc:"#1a3a6b",glow:"rgba(93,169,232,.30)",nm:"Aaron Judge",mu:"NYY vs BOS",tag:"HOME RUNS",tc:"#F5A524",tb:"rgba(245,165,36,.1)",td:"rgba(245,165,36,.32)",prop:"O 0.5 HR",odds:"+265",edge:"+6.2%"},
];
function TradingCard({p}){
  return (
    <div className="tc" style={{"--acc":p.acc,"--accglow":p.glow,"--tc2":p.tc,"--tcb":p.tb,"--tcd":p.td}}>
      <div className="tbanner">
        <span className="tsport">{p.sp}</span>
        {p.soon && <span className="tsoon">soon</span>}
        <div className="tav">{p.img && <img src={p.img} alt="" loading="lazy" onError={(e)=>{e.currentTarget.style.display="none";}}/>}</div>
      </div>
      <div className="tinfo"><div className="tnm">{p.nm}</div><div className="tmu">{p.mu}</div><span className="ttag">{p.tag}</span></div>
      <div className="tbet"><div><div className="tprop">{p.prop}</div><div className="todds">{p.odds}</div></div><div className="tedge">{p.edge}</div></div>
    </div>
  );
}

const YT_ID = "Ifw4gKoUgsI";

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
      <div className="vidcover" aria-hidden="true" />
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
        <div className="tcta">
          <Link className="tlogin" to="/login">Log in</Link>
          <Link className="tbtn" to="/signup">Start free →</Link>
        </div>
      </div></div>


      {/* ===== INTRO — What is WizePicks (WZ-FOOTER-REDESIGN-2026-07-13) ===== */}
      <div className="wpintro"><div className="wrap">
        <span className="eyebrow">What is WizePicks</span>
        <h1 className="wpih1">Anybody can sell you a pick.<br/>We make you the <span className="g">sharp one.</span></h1>
        <p className="lead">Over <b>20 years</b> in the sports-betting business taught us the one thing the touts will never admit: <b>no pick is ever guaranteed.</b> Not the hundred-dollar-a-month "locks," not ours, not anyone's. So instead of selling you certainty that doesn't exist, WizePicks gives you something that does — <span className="g">the model, the plays, and the tools</span> to know exactly why you're betting what you're betting.</p>
        <span className="cred"><span className="d"/>20+ years in the game · built by bettors, for bettors</span>

        <div className="sechd">
          <span className="eyebrow">What you get</span>
          <div className="sub">Three reads on every game. One confident decision.</div>
          <div className="subm">The model's number, our handpicked play, and the raw tools to check us — side by side, so the call is always yours.</div>
        </div>

        <div className="reads">
          <div className="card"><div className="no">01</div><div className="ttl">The <span className="a">Model</span></div><div className="bd">Our algorithm reads every game like a quant would — <b>win probability, edge, and value</b>, built from the same Statcast-grade data the books use. Not a hunch. A number.</div></div>
          <div className="card"><div className="no">02</div><div className="ttl">Wize<span className="a">Plays</span></div><div className="bd">The games we've done the homework on and would put <b>our own money</b> behind. Hand-picked, conviction-rated, no filler to pad a card.</div></div>
          <div className="card"><div className="no">03</div><div className="ttl">Your <span className="a">Edge</span></div><div className="bd">Matchups, splits, park factors, weather, line movement, injuries — the <b>full pro toolkit</b> in your hands. Do your own due diligence and compare.</div></div>
        </div>

        <div className="sechd">
          <span className="eyebrow">Why it works</span>
          <div className="sub">Confidence, not blind faith.</div>
          <div className="subm">When the model, the WizePlay, and your own research all point the same way — that's not a guess, that's conviction. And when your read disagrees? Trust it. You'll be the most informed person betting that game.</div>
        </div>

        <div className="vs">
          <div className="col old"><h4>The old way</h4><ul><li>$100+ a month for "expert" picks</li><li>Buy a pick, trust it blindly</li><li>Never learn why you won or lost</li><li>Still no guarantee — still losing</li></ul></div>
          <div className="col wize"><h4>The Wize way</h4><ul><li>One membership — model, plays, and tools</li><li>Three reads on every game, side by side</li><li>Always know exactly why you're betting</li><li>Decide for yourself, with real conviction</li></ul></div>
        </div>

        <div className="iclose">
          <div className="big">We were never here to sell you a miracle.<br/>We're here to make you the <span className="g">sharpest bettor in the room.</span></div>
          <div className="goal">That's the whole goal: better information, honest odds, and the confidence to make the call yourself — every single night.</div>
        </div>
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
            <div className="price-note">From $7/week · all sports · cancel anytime</div>
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
              <div className="mrtop"><span className="mrmu">SD @ STL</span><span className="mrtier" style={{color:"#3FCB91"}}><span className="mrd" style={{background:"#3FCB91"}}/>Strong</span></div>
              <div className="mrread">Market is confident in the <b>Cardinals</b>.</div>
              <div className="mrsub">7 books agree · 61% to win</div>
            </div>
            <div className="mrcard">
              <div className="mrtop"><span className="mrmu">TB @ LAD</span><span className="mrtier" style={{color:"#C9A86A"}}><span className="mrd" style={{background:"#C9A86A"}}/>Soft</span></div>
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
                <div className="pppbbar"><span style={{width:"56%",background:"#3FCB91"}}/><span style={{width:"26%",background:"#3a434c"}}/><span style={{width:"18%",background:"#C9A86A"}}/></div>
                <div className="pppbbl"><span><i style={{background:"#3FCB91"}}/>Pull 56%</span><span><i style={{background:"#3a434c"}}/>Straight 26%</span><span><i style={{background:"#C9A86A"}}/>Oppo 18%</span></div>
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
          <div className="pwall">
            <div className="pmarq"><div className="ptrack left">{[...TC_A, ...TC_A].map((p,i)=>(<TradingCard p={p} key={"a"+i}/>))}</div></div>
            <div className="pmarq"><div className="ptrack right">{[...TC_B, ...TC_B].map((p,i)=>(<TradingCard p={p} key={"b"+i}/>))}</div></div>
          </div>

          <div className="pcov">
            <div className="pcov-lead">— What we cover —</div>
            <div className="pcov-grid">
              <div className="pcov-col"><div className="pic">⚾</div><div className="psp">MLB</div><div className="pn">6 markets</div><div className="pmk">HR · Hits · K<br/>TB · 2B · 3B</div></div>
              <div className="pcov-col"><div className="pic">🏀</div><div className="psp">NBA</div><div className="pn">4 markets</div><div className="pmk">Pts · Reb<br/>Ast · 3PM</div></div>
              <div className="pcov-col"><span className="psoon">soon</span><div className="pic">🏈</div><div className="psp">NFL</div><div className="pn">7 markets</div><div className="pmk">Pass · Rush · Rec<br/>TDs · more</div></div>
            </div>
            <div className="pcov-note">17 market types across three sports · NFL <b>coming soon</b></div>
          </div>

          <div className="pb-foot">
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
          <p>We hand you every edge, every prop, and what the whole market is saying — then you make the call. That's the smartest way to beat the books.</p>
          <Link className="btn btn-pri" to="/signup">Get started →</Link>
        </div></section>
      </div>

      {/* CUT: white tools -> emerald proof (clean diagonal out of white) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L1200,28 L1200,46 L0,46 Z" fill="#07140F"/><path d="M0,0 L1200,28 L1200,0 Z" fill="#CFE2F4"/></svg></span>

      {/* PROOF */}
      <div className="proof"><div className="wrap">
        <div className="wpcloser">
          <div className="wpc-eye">Why bettors trust it</div>
          <h2 className="wpc-h">We don't hide the <span>losses.</span></h2>
          <p className="wpc-sub wpc-sub-wide">Every pick, graded against the result and left up for good — the wins and the losses, side by side. Nothing buried, nothing cherry-picked. A record that only shows its winners isn't a record at all.</p>
        </div>
      </div></div>

      {/* CUT: emerald proof -> blue CTA (peaks) */}
      <span className="cut"><svg viewBox="0 0 1200 46" preserveAspectRatio="none"><path d="M0,0 L400,36 L800,8 L1200,32 L1200,46 L0,46 Z" fill="#123A5C"/></svg></span>

      {/* CTA BAND */}
      <div className="ctaband"><div className="wrap">
        <div className="wpfin">
          <div className="wpfin-eye">Your edge starts tonight</div>
          <h2 className="wpfin-h">Stop renting picks.<br/>Start making <span>wise ones.</span></h2>
          <p className="wpfin-sub">One membership unlocks the model, the WizePlays, and every tool. No upsells. Cancel anytime.</p>
          <div className="wpfin-btns">
            <Link className="wpfin-btn wpfin-pri" to="/signup">Start free →</Link>
            <Link className="wpfin-btn wpfin-ghost" to="/home">See live edges</Link>
          </div>
          <div className="wpfin-fine">21+ · Bet responsibly · No guarantees — just the sharpest information in the game</div>
        </div>
      </div></div>

      {/* FOOTER — brand sign-off (WZ-FOOTER-REDESIGN-2026-07-13) */}
      <footer><div className="wrap">
        <div className="fghost">WizePicks</div>
        <div className="fwm">Wize<span>Picks</span></div>
        <p className="ftag2"><b>Sharp betting analytics for everyone.</b><br/>Not a sportsbook — we don't take bets.</p>
        <div className="ftrust">
          <span className="tpill"><i/>Every pick graded</span>
          <span className="tpill g"><i/>Not a sportsbook</span>
          <span className="tpill g"><i/>21+ only</span>
        </div>
        <div className="flinks">
          <Link to="/pricing">Pricing</Link><span className="fdot">·</span>
          <Link to="/login">Log in</Link><span className="fdot">·</span>
          <a href="mailto:wizepickshelp@gmail.com">Contact</a>
        </div>
        <div className="fdiv2"></div>
        <div className="frg">Play responsibly · 1-800-GAMBLER</div>
        <div className="fdisc">For informational purposes only. WizePicks does not accept wagers. 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER. © 2026 WizePicks.</div>
      </div></footer>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
.lpwrap{--teal:#3FCB91;--mint:#46E0A9;--red:#C9A86A;--blue:#1B2025;--bluelt:#9AA4AD;--gold:#C9A86A;--panel:#14171B;--panel2:#1B2025;--line:#21262C;--line2:#2A3138;
  --disp:'Space Grotesk',sans-serif;--body:'Inter',sans-serif;--mono:'JetBrains Mono',monospace;
  background:#0A0B0D;color:#E8ECEF;font-family:var(--body);-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:hidden}
.lpwrap *{box-sizing:border-box;margin:0;padding:0}
.lpwrap a{color:inherit;text-decoration:none}
.lpwrap .wrap{max-width:1180px;margin:0 auto;padding:0 28px}

/* ---- alternating section backgrounds + creative diagonal cuts ---- */
.lpwrap .band{position:relative}
.lpwrap .band-navy{background:#0A0B0D}
.lpwrap .band-emerald{background:#0A0B0D}
.lpwrap .band-blue{background:#101216}
.lpwrap .band-black{background:#0A0B0D}
.lpwrap .band-white{background:#101216;color:#E8ECEF}
.lpwrap .cut{display:none}
.lpwrap .cut svg{display:block;width:100%;height:46px}
@media(max-width:859px){.lpwrap .cut svg{height:32px}}

.lpwrap .topbar{position:sticky;top:0;z-index:20;background:rgba(10,11,13,.88);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.lpwrap .topbar .wrap{display:flex;align-items:center;justify-content:space-between;height:62px}
.lpwrap .logo{font-family:var(--disp);font-weight:700;font-size:19px}
.lpwrap .logo span{color:var(--gold)}
.lpwrap .tnav{display:flex;gap:24px;font-size:14px;color:#9AA4AD}
.lpwrap .tnav a:hover{color:#E8ECEF}
.lpwrap .tbtn{font-family:var(--disp);font-weight:700;font-size:13px;background:var(--gold);color:#1a1408;padding:9px 16px;border-radius:999px}
.lpwrap .tbtn:hover{background:#d8b87a}
.lpwrap .tcta{display:flex;align-items:center;gap:18px}
.lpwrap .tlogin{font-family:var(--disp);font-weight:600;font-size:13px;color:#cfd6dc}
.lpwrap .tlogin:hover{color:#fff}

.lpwrap .hero{position:relative;overflow:hidden;min-height:600px;display:flex;align-items:center;padding:48px 0 56px;
  background:#101216;border-bottom:1px solid var(--line)}
.lpwrap .hero::before{content:"";position:absolute;inset:0;background:radial-gradient(90% 80% at 85% 12%,rgba(201,168,106,.07),transparent 50%)}
.lpwrap .hero .wrap{position:relative;z-index:4;width:100%;display:grid;grid-template-columns:1fr;gap:42px;align-items:center}
@media(min-width:860px){.lpwrap .hero .wrap{grid-template-columns:1.1fr .9fr}}
.lpwrap .hero .eyebrow{color:var(--gold)}
.lpwrap .hero .eyebrow::before{background:var(--gold)}
.lpwrap .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);
  display:inline-flex;align-items:center;gap:9px;margin-bottom:22px}
.lpwrap .eyebrow::before{content:"";width:26px;height:1px;background:var(--gold);opacity:.7}
.lpwrap h1.hl{font-family:var(--disp);font-weight:700;font-size:clamp(38px,5vw,60px);line-height:1.03;letter-spacing:-.02em;
  color:#fff}
.lpwrap h1.hl em{font-style:normal;color:var(--gold)}
.lpwrap .hero .sub{color:#9AA4AD}
.lpwrap .hero .btn-ghost{color:#E8ECEF;border:1px solid var(--line2)}
.lpwrap .hero .btn-ghost:hover{border-color:#3a434c}
.lpwrap .hero .price-note{color:#5C6770}
.lpwrap .sub{font-size:18px;line-height:1.55;color:#9AA4AD;max-width:440px;margin:22px 0 30px}
.lpwrap .cta-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.lpwrap .btn{font-family:var(--disp);font-weight:600;font-size:15px;padding:15px 26px;border-radius:11px;cursor:pointer;border:0;display:inline-block;transition:.18s}
.lpwrap .btn-pri{background:var(--gold);color:#1a1408;box-shadow:0 10px 30px -12px rgba(201,168,106,.5)}
.lpwrap .btn-pri:hover{background:#d8b87a;transform:translateY(-1px)}
.lpwrap .btn-ghost{background:transparent;border:1px solid var(--line2);color:#E8ECEF;padding:14px 22px}
.lpwrap .btn-ghost:hover{border-color:#3a434c}
.lpwrap .price-note{font-family:var(--mono);font-size:12.5px;color:#5C6770;margin-top:18px}

.lpwrap .edgecard{background:#14171B;border:1px solid var(--line2);border-radius:16px;padding:18px;box-shadow:0 24px 50px -22px rgba(0,0,0,.7)}
.lpwrap .ec-h{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9AA4AD;display:flex;justify-content:space-between;margin-bottom:12px}
.lpwrap .ec-live{color:var(--green);display:flex;align-items:center;gap:6px}
.lpwrap .ec-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 7px var(--green);animation:pulse 2s infinite}
.lpwrap .ec-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid var(--line)}
.lpwrap .ec-team{font-family:var(--disp);font-weight:600;font-size:15px;color:#fff}
.lpwrap .ec-meta{font-family:var(--mono);font-size:12px;color:#5C6770}
.lpwrap .ec-edge{font-family:var(--mono);font-weight:700;font-size:16px;color:var(--green)}

.lpwrap .vidsec{padding:30px 0 36px;text-align:center}
.lpwrap .vid-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:12px}
.lpwrap .vid-h{font-family:var(--disp);font-weight:700;font-size:clamp(24px,3.3vw,36px);letter-spacing:-.02em;margin-bottom:22px}
.lpwrap .vidframe{position:relative;width:100vw;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;max-width:100vw;aspect-ratio:16/10;border-radius:0;overflow:hidden;
  border:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);box-shadow:0 40px 90px -50px #000;
  background:#0d0f12;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px}
.lpwrap .vidframe video,.lpwrap .vidframe iframe{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:111.2vw;height:62.5vw;display:block;border:0}
.lpwrap .vidyt{position:absolute;inset:0;width:100%;height:100%}
.lpwrap .vidcover{position:absolute;inset:0;z-index:2}
.lpwrap .vidcover::before{content:"";position:absolute;top:0;left:0;right:0;height:66px;background:linear-gradient(180deg,#0A0B0D 0%,#0A0B0D 68%,transparent 100%);pointer-events:none}
.lpwrap .vidcover::after{content:"";position:absolute;bottom:0;left:0;right:0;height:54px;background:linear-gradient(0deg,#0A0B0D 0%,transparent 100%);pointer-events:none}
.lpwrap .vid-sound{position:absolute;right:14px;bottom:14px;z-index:5;cursor:pointer;
  font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:#1a1408;
  background:var(--gold);border:0;border-radius:999px;padding:9px 15px;font-weight:700;
  box-shadow:0 8px 24px -8px rgba(0,0,0,.6);transition:transform .15s,background .15s}
.lpwrap .vid-sound:hover{transform:translateY(-1px)}
.lpwrap .vid-sound.on{background:rgba(10,11,13,.82);color:#cfe9df;border:1px solid rgba(63,203,145,.45)}
.lpwrap .vid-play{width:66px;height:66px;border-radius:50%;background:var(--gold);position:relative;animation:pulse 2s infinite}
.lpwrap .vid-play::after{content:"";position:absolute;top:50%;left:54%;transform:translate(-50%,-50%);border-left:21px solid #1a1408;border-top:13px solid transparent;border-bottom:13px solid transparent}
.lpwrap .vid-cap{font-family:var(--mono);font-size:12px;color:#5C6770;letter-spacing:.14em;text-transform:uppercase}

.lpwrap .sech{font-family:var(--disp);font-weight:700;font-size:clamp(28px,3.4vw,40px);text-align:center;letter-spacing:-.02em;padding:54px 0 4px}
.lpwrap .feat{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;padding:64px 0;border-bottom:1px solid var(--line)}
.lpwrap .feat.rev .ftxt{order:2}
.lpwrap .feat .eyebrow{margin-bottom:16px}
.lpwrap .feat h3{font-family:var(--disp);font-weight:700;font-size:27px;letter-spacing:-.01em;margin-bottom:14px}
.lpwrap .feat p{color:#9AA4AD;line-height:1.6;font-size:16px;max-width:430px;margin-bottom:18px}
.lpwrap .lk{font-family:var(--mono);font-size:13px;color:var(--gold);letter-spacing:.04em}
.lpwrap .lk:hover{text-decoration:underline}
.lpwrap .panel{background:#14171B;border:1px solid var(--line2);border-radius:18px;padding:20px;min-height:230px;box-shadow:0 40px 80px -50px #000}
.lpwrap .pbar{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:#5C6770;letter-spacing:.1em;text-transform:uppercase;margin-bottom:15px}
.lpwrap .prow{display:flex;justify-content:space-between;align-items:center;padding:12px 13px;border-radius:10px;background:#1B2025;margin-bottom:9px}
.lpwrap .prow .t{font-family:var(--disp);font-weight:600;font-size:14px}
.lpwrap .prow .m{font-family:var(--mono);font-size:12px;color:#9AA4AD}
.lpwrap .pill{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--green);background:rgba(63,203,145,.14);border:1px solid rgba(63,203,145,.32);padding:3px 9px;border-radius:6px}
/* Player Profile feature panel — solid near-black to match the mock */
.lpwrap .panel.pppanel{padding:0;overflow:hidden;background:#14171B;border:1px solid var(--line2);min-height:0}
.lpwrap .ppprow{position:relative;display:flex;align-items:center;gap:11px;padding:13px 14px;background:#1B2025;border-bottom:1px solid var(--line)}
.lpwrap .pppic{position:relative;width:44px;height:44px;border-radius:50%;flex:0 0 44px;background:#1B2025;box-shadow:0 0 0 2px var(--line2);overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;color:#fff;font-size:14px}
.lpwrap .pppic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lpwrap .pppnm{flex:1;min-width:0}
.lpwrap .pppn{font-family:var(--disp);font-weight:700;font-size:17px;color:#f2f6f4;line-height:1.05}
.lpwrap .pppg{font-family:var(--mono);font-size:10px;color:#5C6770;margin-top:2px}
.lpwrap .pppl{font-size:11px;color:#9AA4AD;margin-top:3px}
.lpwrap .pppr{text-align:right;flex:0 0 auto}
.lpwrap .pppv{font-family:var(--disp);font-weight:700;font-size:26px;color:var(--green);line-height:.9}
.lpwrap .pppv small{font-size:14px}
.lpwrap .pppvl{font-family:var(--mono);font-size:8px;color:#5C6770;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
.lpwrap .pppbody{padding:12px 14px 15px}
.lpwrap .pppmh{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1B2025;border:1px solid var(--line2);border-radius:10px;padding:9px 11px}
.lpwrap .pppmh>span:first-child{font-size:11px;color:#9AA4AD}.lpwrap .pppmh b{font-family:var(--disp);font-weight:700;color:#fff;font-size:12.5px}
.lpwrap .ppppill{font-family:var(--mono);font-weight:700;font-size:10px;font-style:normal;padding:2px 7px;border-radius:6px;background:rgba(201,168,106,.12);color:var(--gold);border:1px solid rgba(201,168,106,.32)}
.lpwrap .pppadv{font-family:var(--mono);font-weight:700;font-size:10px;font-style:normal;color:var(--up);background:rgba(63,203,145,.12);border:1px solid rgba(63,203,145,.3);padding:2px 7px;border-radius:6px;margin-left:5px;white-space:nowrap}
.lpwrap .pppsec{font-family:var(--mono);font-weight:700;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#5C6770;margin:14px 0 9px;display:flex;align-items:center;gap:7px}
.lpwrap .pppsec::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--gold);flex:0 0 auto}
.lpwrap .pppsp2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.lpwrap .pppsp{position:relative;background:#1B2025;border:1px solid var(--line2);border-radius:11px;padding:10px 11px;min-width:0}
.lpwrap .pppsp.act{border-color:rgba(63,203,145,.45);background:rgba(63,203,145,.06)}
.lpwrap .ppptg{position:absolute;top:-8px;right:9px;font-family:var(--mono);font-weight:700;font-size:8px;background:var(--gold);color:#1a1408;padding:1px 7px;border-radius:5px}
.lpwrap .pppvh{font-family:var(--mono);font-weight:700;font-size:11px;color:#5C6770}.lpwrap .pppsp.act .pppvh{color:var(--up)}
.lpwrap .pppops{font-family:var(--disp);font-weight:700;font-size:23px;line-height:1;margin-top:5px;color:#fff}
.lpwrap .pppopsl{font-family:var(--mono);font-size:8px;color:#5C6770;letter-spacing:.1em;text-transform:uppercase}
.lpwrap .pppsr{display:flex;justify-content:space-between;margin-top:8px;gap:3px}.lpwrap .pppsr div{flex:1;text-align:center;min-width:0}
.lpwrap .pppsv{font-family:var(--disp);font-weight:700;font-size:12px;color:#fff}.lpwrap .pppsl{font-family:var(--mono);font-size:7px;color:#5C6770;text-transform:uppercase;margin-top:2px}
.lpwrap .ppphr{color:var(--gold)}
.lpwrap .pppmvm{background:#1B2025;border:1px solid var(--line);border-radius:12px;padding:12px 13px 10px}
.lpwrap .pppmtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lpwrap .pppmt{font-size:10px;color:#5C6770}
.lpwrap .pppmr{font-family:var(--disp);font-weight:700;font-size:14px;color:#fff;white-space:nowrap}.lpwrap .pppmr .g{color:var(--green)}.lpwrap .pppmr .b{color:var(--gold)}.lpwrap .pppmr .x{color:#5C6770;font-size:11px;margin:0 4px}
.lpwrap .pppplot{position:relative;height:96px;display:flex;align-items:flex-end;gap:7px;margin:12px 2px 0;border-bottom:1px solid var(--line)}
.lpwrap .pppcol{position:relative;flex:1;height:100%;display:flex;align-items:flex-end}
.lpwrap .pppbar{width:100%;border-radius:5px 5px 0 0;background:var(--green)}
.lpwrap .pppbar.dim{background:#2a3f37}
.lpwrap .ppptick{position:absolute;left:-1px;right:-1px;height:3px;border-radius:2px;background:var(--gold);box-shadow:0 0 7px rgba(201,168,106,.55)}
.lpwrap .pppdots{display:flex;gap:7px;margin:8px 2px 0}.lpwrap .pppdc{flex:1;display:flex;justify-content:center}
.lpwrap .pppdot{width:8px;height:8px;border-radius:50%;border:1.5px solid #2a3f37}.lpwrap .pppdot.hit{background:var(--green);border-color:var(--green);box-shadow:0 0 7px rgba(63,203,145,.6)}
.lpwrap .pppleg{display:flex;justify-content:center;gap:14px;margin-top:11px;font-family:var(--mono);font-size:9px;color:#5C6770;flex-wrap:wrap}
.lpwrap .pppleg span{display:flex;align-items:center;gap:5px}
.lpwrap .pppleg i{display:inline-block}.lpwrap .pppleg .lg{width:9px;height:9px;border-radius:2px;background:var(--green)}.lpwrap .pppleg .lb{width:12px;height:3px;border-radius:2px;background:var(--gold)}.lpwrap .pppleg .ld{width:9px;height:9px;border-radius:50%;background:var(--green)}
.lpwrap .pppcap{font-size:9px;color:#5C6770;text-align:center;margin-top:9px;line-height:1.4}
.lpwrap .pppchips{display:flex;gap:9px}
.lpwrap .pppchip{flex:1;background:#1B2025;border:1px solid var(--line2);border-radius:11px;padding:9px 10px;min-width:0}
.lpwrap .pppcl{font-size:10px;color:#5C6770;display:flex;justify-content:space-between;align-items:center;gap:5px}
.lpwrap .pppcrk{font-family:var(--mono);font-weight:700;font-size:8px;color:#04140d;background:var(--green);padding:1px 6px;border-radius:5px;white-space:nowrap}
.lpwrap .pppcv{font-family:var(--disp);font-weight:700;font-size:18px;margin-top:3px;color:#fff}
.lpwrap .pppcbar{height:3px;border-radius:2px;background:rgba(63,203,145,.12);margin-top:6px;overflow:hidden}.lpwrap .pppcbar>span{display:block;height:100%;background:var(--green)}
.lpwrap .pppbb{background:#1B2025;border:1px solid var(--line2);border-radius:11px;padding:11px}
.lpwrap .pppbbar{display:flex;height:13px;border-radius:7px;overflow:hidden;gap:2px;background:#0A0B0D}.lpwrap .pppbbar>span{display:block;height:100%}
.lpwrap .pppbbl{display:flex;justify-content:space-between;margin-top:8px;font-family:var(--mono);font-size:10px;color:#9AA4AD;gap:6px}.lpwrap .pppbbl i{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:-1px}
.lpwrap #playerprofile .ftxt{min-width:0}
@media(max-width:859px){.lpwrap #playerprofile{grid-template-columns:1fr;gap:22px}.lpwrap #playerprofile .ftxt{order:2}}
.lpwrap .barwrap{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:8px}
.lpwrap .bar{flex:1;background:linear-gradient(180deg,var(--mint),rgba(56,225,160,.25));border-radius:5px 5px 0 0}

.lpwrap .proof{padding:60px 0;text-align:center;border-bottom:1px solid var(--line)}
.lpwrap .proof small{font-family:var(--mono);font-size:12px;color:#5C6770;letter-spacing:.04em}
.lpwrap .proof .big{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,44px);letter-spacing:-.02em;margin:6px 0 10px}
.lpwrap .proof .big span{color:var(--gold)}
.lpwrap .stats3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:32px}
.lpwrap .stat{background:#14171B;border:1px solid var(--line);border-radius:14px;padding:24px}
.lpwrap .stat .n{font-family:var(--mono);font-weight:700;font-size:30px;color:var(--green)}
.lpwrap .stat .u{font-family:var(--mono);font-weight:700;font-size:17px;color:var(--green);opacity:.85;margin-top:5px}
.lpwrap .stat .l{font-size:13px;color:#9AA4AD;margin-top:6px}

.lpwrap .ctaband{text-align:center;padding:78px 0;background:radial-gradient(80% 120% at 50% 0%,rgba(201,168,106,.10),transparent 60%)}
.lpwrap .ctaband h2{font-family:var(--disp);font-weight:700;font-size:clamp(30px,4vw,46px);letter-spacing:-.02em;margin-bottom:14px}
.lpwrap .ctaband p{color:#9AA4AD;margin-bottom:26px}

.lpwrap footer{border-top:1px solid var(--line);padding:52px 0 38px;background:#08090B}
.lpwrap .fcols{display:grid;grid-template-columns:1fr;gap:30px}
@media(min-width:760px){.lpwrap .fcols{grid-template-columns:1.4fr 1fr 1fr 1fr}}
.lpwrap .fcols h5{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5C6770;margin-bottom:14px}
.lpwrap .fcols a{display:block;color:#9AA4AD;font-size:14px;padding:5px 0}
.lpwrap .fcols a:hover{color:#E8ECEF}
.lpwrap .flogo{font-family:var(--disp);font-weight:700;font-size:22px}
.lpwrap .flogo span{color:var(--gold)}
.lpwrap .ftag{color:#5C6770;font-size:13px;margin-top:12px;line-height:1.6;max-width:240px}
.lpwrap .fdisc{font-family:var(--mono);font-size:11px;color:#5C6770;margin-top:28px;line-height:1.6;border-top:1px solid var(--line);padding-top:18px}

@media(max-width:859px){
  .lpwrap .wrap{padding:0 16px}
  .lpwrap .tnav{display:none}
  .lpwrap .tcta{gap:13px}
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
  .lpwrap .stat .u{font-size:14px}
  .lpwrap .stat .l{font-size:11px}
}
/* ---- player props banner (narrow + airy, auto-scrolling cards) ---- */
.lpwrap .propsband{position:relative;overflow:hidden;max-width:860px;margin:6px auto 0;padding:30px 0 26px;
  border-radius:20px;border:1px solid rgba(56,225,160,.12);
  background:radial-gradient(120% 130% at 50% -20%,rgba(56,225,160,.07),transparent 55%);text-align:center}
.lpwrap .pb-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);display:inline-flex;align-items:center;gap:9px;margin-bottom:12px}
.lpwrap .pb-eyebrow::before,.lpwrap .pb-eyebrow::after{content:"";width:20px;height:1px;background:var(--gold);opacity:.6}
.lpwrap .pb-h{font-family:var(--disp);font-weight:700;font-size:clamp(22px,3.2vw,32px);letter-spacing:-.02em;margin-bottom:11px;padding:0 18px}
.lpwrap .pb-h span{color:var(--gold)}
.lpwrap .pb-sub{font-size:14.5px;line-height:1.55;color:#9AA4AD;max-width:460px;margin:0 auto 20px;padding:0 18px}
.lpwrap .cov{max-width:680px;margin:0 auto 22px;display:flex;flex-direction:column;gap:8px;padding:0 18px}
.lpwrap .cov-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:center}
.lpwrap .cov-lab{font-family:var(--mono);font-size:11.5px;font-weight:700;letter-spacing:.06em;color:#E8ECEF}
.lpwrap .chip{font-family:var(--mono);font-size:11px;color:#9AA4AD;background:#14171B;border:1px solid var(--line2);border-radius:7px;padding:4px 9px}
.lpwrap .soon{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#F5A524;background:rgba(245,165,36,.1);border:1px solid rgba(245,165,36,.3);border-radius:6px;padding:4px 7px}
.lpwrap .marquee{position:relative;overflow:hidden;padding:4px 0 2px;
  -webkit-mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
.lpwrap .track{display:flex;gap:12px;width:max-content;animation:marq 38s linear infinite}
.lpwrap .marquee:hover .track{animation-play-state:paused}
@keyframes marq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.lpwrap .track{animation:none}}
.lpwrap .pcard{flex:0 0 220px;background:#14171B;border:1px solid var(--line);border-radius:15px;padding:14px;text-align:left}
.lpwrap .pc-top{display:flex;align-items:center;gap:10px;margin-bottom:11px}
.lpwrap .pc-av{position:relative;overflow:hidden;width:38px;height:38px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:700;font-size:12px;color:#fff;background:#1B2025}
.lpwrap .pc-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}
.lpwrap .pc-sport{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;color:#5C6770}
.lpwrap .pc-nm{font-family:var(--disp);font-weight:600;font-size:14px;line-height:1.15}
.lpwrap .pc-mu{font-family:var(--mono);font-size:9.5px;color:#5C6770;margin-top:1px}
.lpwrap .pc-tag{display:inline-block;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;padding:3px 7px;border-radius:6px;margin-bottom:10px}
.lpwrap .pc-bet{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:10px}
.lpwrap .pc-prop{font-family:var(--disp);font-weight:600;font-size:14px}
.lpwrap .pc-odds{font-family:var(--mono);font-size:11px;color:#5C6770}
.lpwrap .pc-edge{font-family:var(--mono);font-weight:700;font-size:14px;color:var(--green)}
.lpwrap .pc-soon{float:right;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.1em;color:#F5A524;background:rgba(245,165,36,.12);border:1px solid rgba(245,165,36,.3);border-radius:5px;padding:2px 6px}
.lpwrap .pb-foot{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:22px;padding:0 18px}
.lpwrap .pb-btn{font-family:var(--disp);font-weight:700;font-size:14px;background:var(--gold);color:#1a1408;padding:12px 22px;border-radius:11px}
.lpwrap .pb-btn:hover{background:#d8b87a}
.lpwrap .pb-ex{font-family:var(--mono);font-size:10.5px;color:#5C6770}

/* ---- Market Read card (inside feature panel) ---- */
.lpwrap .mrcard{background:#1B2025;border:1px solid var(--line2);border-radius:12px;padding:12px 13px;margin-bottom:9px}
.lpwrap .mrcard:last-child{margin-bottom:0}
.lpwrap .mrtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.lpwrap .mrmu{font-family:var(--disp);font-weight:600;color:#E8ECEF;font-size:14px}
.lpwrap .mrtier{font-family:var(--mono);font-size:10.5px;font-weight:700;display:flex;align-items:center;gap:5px}
.lpwrap .mrd{width:7px;height:7px;border-radius:50%;display:inline-block}
.lpwrap .mrread{font-size:13.5px;color:#E8ECEF;font-weight:600;line-height:1.4}
.lpwrap .mrread b{color:var(--gold);font-weight:700}
.lpwrap .mrsub{font-family:var(--mono);font-size:10.5px;color:#5C6770;margin-top:4px}

/* ---- Tools to win (white two-tone band) ---- */
.lpwrap .tools{padding:54px 0}
.lpwrap .tools .lab{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);background:rgba(201,168,106,.12);border:1px solid rgba(201,168,106,.35);padding:6px 14px;border-radius:20px;margin-bottom:16px}
.lpwrap .tools h2{font-family:var(--disp);font-weight:700;font-size:clamp(26px,3.6vw,38px);line-height:1.12;letter-spacing:-.02em;color:#fff;margin-bottom:13px;max-width:600px}
.lpwrap .tools p{font-size:16px;color:#9AA4AD;line-height:1.6;max-width:520px;margin-bottom:22px}
.lpwrap .tools .btn-pri{background:var(--gold);box-shadow:0 10px 30px -12px rgba(201,168,106,.5)}
.lpwrap .tools .btn-pri:hover{background:#d8b87a}

/* ---- band-aware overrides (premium-dark) ---- */
.lpwrap .vidsec{background:#0A0B0D}
.lpwrap .vid-eyebrow{color:var(--gold)}
.lpwrap .feat-zone{background:#101216}
.lpwrap .propszone{background:#0A0B0D;padding-top:34px;padding-bottom:8px}
.lpwrap .propsband{border-color:var(--line)}
.lpwrap .proof{background:#101216}
.lpwrap .ctaband{background:#0A0B0D !important}
.lpwrap .ctaband p{color:#9AA4AD}

@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(63,203,145,.5)}70%{box-shadow:0 0 0 9px rgba(63,203,145,0)}100%{box-shadow:0 0 0 0 rgba(63,203,145,0)}}
/* WZ-DESK-VIDFRAME-2026-07-02 :: desktop — the commercial was full-bleed 100vw (huge on
   monitors). >=1024px it becomes a centered, framed 1080px player; the 111.2% width keeps
   the same horizontal overscan that crops YT chrome. Mobile keeps the full-bleed look. */
@media(min-width:1024px){
.lpwrap .vidframe{width:min(1080px,92vw);max-width:1080px;left:auto;right:auto;margin-left:auto;margin-right:auto;border-radius:18px;border:1px solid rgba(255,255,255,.09);box-shadow:0 24px 70px rgba(0,0,0,.45)}
.lpwrap .vidframe video,.lpwrap .vidframe iframe{width:111.2%;height:100%}
}

/* ============================================================
   WZ-FOOTER-REDESIGN-2026-07-13 :: intro + losses statement + finale
   Mobile = approved mock (3-across intro, framed finale).
   Desktop = same design, fills the screen (wrap widens to 92vw).
   ============================================================ */

/* ---- desktop: fill the screen (no skinny centered column) ---- */
@media(min-width:1024px){ .lpwrap .wrap{max-width:min(1360px,92vw)} }

/* ---- INTRO (What is WizePicks) ---- */
.lpwrap .wpintro{position:relative;overflow:hidden;padding:40px 0 30px;
  background:radial-gradient(1100px 560px at 50% -6%, rgba(201,168,106,.06), transparent 60%),radial-gradient(900px 700px at 50% 30%, #0e1013, #0A0B0D 78%)}
.lpwrap .wpintro::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.03;z-index:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.lpwrap .wpintro .wrap{position:relative;z-index:1}
.lpwrap .wpintro .eyebrow{display:inline-flex;align-items:center;gap:10px;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);margin-bottom:0}
.lpwrap .wpintro .eyebrow::before{content:"";width:26px;height:1px;background:linear-gradient(90deg,var(--gold),transparent)}
.lpwrap .wpintro .wpih1{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:clamp(38px,10vw,60px);line-height:1.02;letter-spacing:.4px;margin:20px 0 0;color:#ECEFF2}
.lpwrap .wpintro .wpih1 .g{background:linear-gradient(180deg,#E8CE93,#C9A86A 55%,#9A7B3E);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lpwrap .wpintro .lead{font-size:15px;line-height:1.7;color:#99A2AA;max-width:620px;margin:20px 0 0}
.lpwrap .wpintro .lead b{color:#cdd5da;font-weight:600}
.lpwrap .wpintro .lead .g{color:#3FCB91;font-weight:600}
.lpwrap .wpintro .cred{display:inline-flex;align-items:center;gap:9px;margin-top:22px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.06em;color:#E8CE93;border:1px solid rgba(201,168,106,.28);border-radius:999px;padding:7px 13px;background:linear-gradient(180deg,rgba(201,168,106,.1),rgba(201,168,106,.02))}
.lpwrap .wpintro .cred .d{width:5px;height:5px;border-radius:50%;background:#C9A86A;flex:0 0 auto}
.lpwrap .wpintro .sechd{margin-top:48px}
.lpwrap .wpintro .sechd .sub{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:clamp(22px,6vw,30px);letter-spacing:.4px;color:#ECEFF2;margin-top:12px}
.lpwrap .wpintro .sechd .subm{font-size:14px;color:#99A2AA;margin-top:8px;max-width:560px;line-height:1.6}
.lpwrap .wpintro .reads{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:22px}
.lpwrap .wpintro .card{position:relative;border-radius:13px;padding:14px 11px;background:linear-gradient(180deg,#181C21,#111418);border:1px solid rgba(255,255,255,.06);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 16px 40px -28px rgba(0,0,0,.9);overflow:hidden}
.lpwrap .wpintro .card::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:linear-gradient(90deg,#C9A86A,transparent 70%)}
.lpwrap .wpintro .card .no{font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.2em;color:#5B646C}
.lpwrap .wpintro .card .ttl{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:16px;letter-spacing:.3px;margin-top:8px;color:#ECEFF2;line-height:1.05}
.lpwrap .wpintro .card .ttl .a{color:#C9A86A}
.lpwrap .wpintro .card .bd{font-size:10.5px;line-height:1.5;color:#99A2AA;margin-top:8px}
.lpwrap .wpintro .card .bd b{color:#cdd5da;font-weight:600}
.lpwrap .wpintro .vs{display:grid;grid-template-columns:1fr;gap:12px;margin-top:26px}
.lpwrap .wpintro .col{border-radius:14px;padding:20px;border:1px solid rgba(255,255,255,.06)}
.lpwrap .wpintro .col.old{background:rgba(226,101,92,.04);border-color:rgba(226,101,92,.16)}
.lpwrap .wpintro .col.wize{background:rgba(63,203,145,.05);border-color:rgba(63,203,145,.22)}
.lpwrap .wpintro .col h4{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.lpwrap .wpintro .col.old h4{color:#E2655C}
.lpwrap .wpintro .col.wize h4{color:#3FCB91}
.lpwrap .wpintro .col ul{list-style:none;margin:14px 0 0;padding:0}
.lpwrap .wpintro .col li{font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.5;color:#99A2AA;padding:7px 0 7px 22px;position:relative}
.lpwrap .wpintro .col li + li{border-top:1px solid rgba(255,255,255,.06)}
.lpwrap .wpintro .col.old li::before{content:"✕";position:absolute;left:0;color:#E2655C;font-size:11px;top:8px}
.lpwrap .wpintro .col.wize li::before{content:"✓";position:absolute;left:0;color:#3FCB91;font-size:11px;top:8px}
.lpwrap .wpintro .col.wize li{color:#cdd5da}
.lpwrap .wpintro .iclose{margin-top:52px;text-align:center;padding:0 6px}
.lpwrap .wpintro .iclose .big{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:clamp(26px,7vw,38px);line-height:1.1;letter-spacing:.4px;color:#ECEFF2}
.lpwrap .wpintro .iclose .big .g{background:linear-gradient(180deg,#E8CE93,#C9A86A 60%,#9A7B3E);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lpwrap .wpintro .iclose .goal{font-size:15px;color:#99A2AA;margin-top:18px;max-width:560px;margin-left:auto;margin-right:auto;line-height:1.7}
.lpwrap .wpintro .iclose .fine{margin-top:20px;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;color:#5B646C;text-transform:uppercase}
@media(min-width:860px){
  .lpwrap .wpintro{padding:64px 0 44px}
  .lpwrap .wpintro .wpih1{font-size:clamp(46px,6vw,72px)}
  .lpwrap .wpintro .lead{font-size:17px;max-width:680px;margin-top:24px}
  .lpwrap .wpintro .sechd{margin-top:60px}
  .lpwrap .wpintro .sechd .sub{font-size:clamp(26px,3.2vw,34px)}
  .lpwrap .wpintro .sechd .subm{font-size:15px;max-width:660px}
  .lpwrap .wpintro .reads{gap:16px;margin-top:28px}
  .lpwrap .wpintro .card{padding:26px 24px;border-radius:16px}
  .lpwrap .wpintro .card .no{font-size:11px}
  .lpwrap .wpintro .card .ttl{font-size:26px;margin-top:12px}
  .lpwrap .wpintro .card .bd{font-size:14.5px;line-height:1.6;margin-top:11px}
  .lpwrap .wpintro .vs{grid-template-columns:1fr 1fr;gap:18px;margin-top:30px}
  .lpwrap .wpintro .col{padding:26px}
  .lpwrap .wpintro .col li{font-size:13px}
  .lpwrap .wpintro .iclose{margin-top:64px}
  .lpwrap .wpintro .iclose .big{font-size:clamp(34px,4vw,50px)}
  .lpwrap .wpintro .iclose .goal{font-size:16px;max-width:640px}
}

/* ---- Losses statement (sibling of the finale) ---- */
.lpwrap .wpcloser{text-align:center;max-width:640px;margin:0 auto}
.lpwrap .wpc-eye{display:inline-flex;align-items:center;gap:11px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#C9A86A;margin-bottom:20px}
.lpwrap .wpc-eye::before{content:"◆";font-size:9px;color:#C9A86A}
.lpwrap .wpc-h{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:clamp(34px,9vw,54px);line-height:1.0;letter-spacing:.4px;color:#fff}
.lpwrap .wpc-h span{background:linear-gradient(180deg,#E8CE93,#C9A86A 60%,#9A7B3E);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lpwrap .wpc-sub{font-family:'Inter',sans-serif;font-size:16px;line-height:1.6;color:#9AA4AD;max-width:460px;margin:18px auto 0}
.lpwrap .wpc-sub-wide{max-width:560px}

/* ---- FINALE closer — framed, glowing, dominant ---- */
.lpwrap .ctaband{background:radial-gradient(75% 110% at 50% 100%, rgba(201,168,106,.08), #0A0B0D 62%) !important;padding:44px 0 76px !important}
.lpwrap .wpfin{position:relative;max-width:720px;margin:0 auto;text-align:center;overflow:hidden;padding:54px 30px 48px;border-radius:24px;border:1px solid rgba(201,168,106,.30);
  background:radial-gradient(90% 130% at 50% -10%, rgba(201,168,106,.16), transparent 58%),linear-gradient(180deg,#16171B,#0B0C0F);
  box-shadow:0 60px 130px -55px rgba(201,168,106,.42), 0 30px 80px -50px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.07)}
.lpwrap .wpfin::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.04;z-index:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.lpwrap .wpfin::after{content:"";position:absolute;top:0;left:18%;right:18%;height:1px;background:linear-gradient(90deg,transparent,#C9A86A,transparent);opacity:.75}
.lpwrap .wpfin>*{position:relative;z-index:1}
.lpwrap .wpfin-eye{display:inline-flex;align-items:center;gap:11px;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#C9A86A;margin-bottom:22px}
.lpwrap .wpfin-eye::before,.lpwrap .wpfin-eye::after{content:"";width:24px;height:1px;background:#C9A86A;opacity:.55}
.lpwrap .wpfin-h{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:clamp(44px,13vw,74px);line-height:.96;letter-spacing:.4px;color:#fff}
.lpwrap .wpfin-h span{background:linear-gradient(180deg,#E8CE93,#C9A86A 55%,#9A7B3E);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lpwrap .wpfin-sub{font-family:'Inter',sans-serif;font-size:16.5px;line-height:1.6;color:#AEB6BD;max-width:450px;margin:20px auto 0}
.lpwrap .wpfin-btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:32px}
.lpwrap .wpfin-btn{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;letter-spacing:.03em;padding:16px 42px;border-radius:12px;display:inline-block;transition:.16s}
.lpwrap .wpfin-pri{background:linear-gradient(180deg,#F0DAA2,#C9A86A);color:#1a1408;box-shadow:0 18px 44px -12px rgba(201,168,106,.75)}
.lpwrap .wpfin-pri:hover{transform:translateY(-2px);box-shadow:0 24px 56px -12px rgba(201,168,106,.9)}
.lpwrap .wpfin-ghost{background:rgba(255,255,255,.03);border:1px solid #333b43;color:#EDF1F4}
.lpwrap .wpfin-ghost:hover{border-color:#4a545d}
.lpwrap .wpfin-fine{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5C6770;margin-top:28px}
@media(max-width:560px){
  .lpwrap .wpfin{padding:40px 20px 36px;border-radius:20px}
  .lpwrap .wpfin-btns{flex-direction:column;gap:11px}
  .lpwrap .wpfin-btn{width:100%;padding:15px 0}
}


/* ---- WZ-FOOTER-REDESIGN-2026-07-13 :: trading-card wall + slim coverage ---- */
.lpwrap .propsband .pwall{display:flex;flex-direction:column;gap:12px;margin:6px 0 4px}
.lpwrap .propsband .pmarq{position:relative;overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.lpwrap .propsband .ptrack{display:flex;gap:12px;width:max-content;padding:0 6px}
.lpwrap .propsband .ptrack.left{animation:pmL 46s linear infinite}
.lpwrap .propsband .ptrack.right{animation:pmR 46s linear infinite}
.lpwrap .propsband .pmarq:hover .ptrack{animation-play-state:paused}
@keyframes pmL{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes pmR{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.lpwrap .propsband .ptrack{animation:none}}
.lpwrap .propsband .tc{position:relative;flex:0 0 202px;background:#0F1216;border:1px solid var(--line2);border-radius:16px;overflow:hidden;text-align:left}
.lpwrap .propsband .tbanner{position:relative;height:82px;background:linear-gradient(160deg,var(--acc),#0F1216 80%);display:flex;align-items:flex-end;padding:0 14px}
.lpwrap .propsband .tbanner::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 82% 0%,var(--accglow),transparent 60%)}
.lpwrap .propsband .tsport{position:absolute;top:11px;left:14px;font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#0a0b0d;background:rgba(255,255,255,.85);padding:3px 7px;border-radius:6px;text-transform:uppercase}
.lpwrap .propsband .tsoon{position:absolute;top:11px;right:12px;z-index:2;font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#F5A524;background:rgba(245,165,36,.16);border:1px solid rgba(245,165,36,.35);border-radius:5px;padding:2px 6px}
.lpwrap .propsband .tav{position:relative;z-index:1;width:58px;height:58px;border-radius:50%;overflow:hidden;background:var(--panel2);border:3px solid #0F1216;box-shadow:0 8px 18px -6px #000;transform:translateY(20px)}
.lpwrap .propsband .tav img{width:100%;height:100%;object-fit:cover}
.lpwrap .propsband .tinfo{padding:26px 14px 0}
.lpwrap .propsband .tnm{font-family:var(--disp);font-weight:700;font-size:15px;line-height:1.05;color:#fff}
.lpwrap .propsband .tmu{font-family:var(--mono);font-size:9px;color:#5C6770;margin-top:3px}
.lpwrap .propsband .ttag{display:inline-block;margin-top:10px;font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:5px;color:var(--tc2);background:var(--tcb);border:1px solid var(--tcd)}
.lpwrap .propsband .tbet{display:flex;align-items:center;justify-content:space-between;margin:11px 14px 0;padding:11px 0 14px;border-top:1px solid var(--line)}
.lpwrap .propsband .tprop{font-family:var(--disp);font-weight:700;font-size:15px;color:#fff}
.lpwrap .propsband .todds{font-family:var(--mono);font-size:10px;color:#5C6770;margin-top:1px}
.lpwrap .propsband .tedge{font-family:var(--disp);font-weight:700;font-size:15px;color:var(--green);display:flex;align-items:center;gap:4px}
.lpwrap .propsband .tedge::before{content:"\u25b2";font-size:8px}
.lpwrap .propsband .pcov{max-width:640px;margin:20px auto 0;padding:16px 18px 4px}
.lpwrap .propsband .pcov-lead{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#5C6770;margin-bottom:14px}
.lpwrap .propsband .pcov-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.lpwrap .propsband .pcov-col{position:relative;background:#111418;border:1px solid var(--line);border-radius:12px;padding:13px 11px;text-align:center}
.lpwrap .propsband .pic{font-size:18px}
.lpwrap .propsband .psp{font-family:var(--disp);font-weight:700;font-size:13px;margin-top:5px;color:#fff}
.lpwrap .propsband .pn{font-family:var(--mono);font-size:9.5px;color:var(--gold);margin-top:3px;letter-spacing:.04em}
.lpwrap .propsband .pmk{font-family:var(--mono);font-size:9px;color:#5C6770;margin-top:6px;line-height:1.5}
.lpwrap .propsband .psoon{position:absolute;top:8px;right:8px;font-family:var(--mono);font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#F5A524;background:rgba(245,165,36,.14);border:1px solid rgba(245,165,36,.32);border-radius:4px;padding:1px 5px}
.lpwrap .propsband .pcov-note{font-family:var(--mono);font-size:9.5px;color:#5C6770;margin-top:14px;letter-spacing:.02em}
.lpwrap .propsband .pcov-note b{color:#F5A524}
@media(min-width:860px){
  .lpwrap .propsband .tc{flex:0 0 224px}
  .lpwrap .propsband .pcov{max-width:680px}
}


/* ---- WZ-FOOTER-REDESIGN-2026-07-13 :: brand sign-off footer ---- */
.lpwrap footer{position:relative;overflow:hidden;text-align:center}
.lpwrap footer::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.03;z-index:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.lpwrap footer .wrap{position:relative;z-index:1}
.lpwrap .fghost{position:absolute;left:50%;top:16px;transform:translateX(-50%);font-family:var(--disp);font-weight:700;font-size:clamp(80px,22vw,150px);letter-spacing:-.03em;color:#fff;opacity:.02;white-space:nowrap;pointer-events:none;z-index:0}
.lpwrap .fwm{position:relative;z-index:1;font-family:var(--disp);font-weight:700;font-size:clamp(38px,12vw,58px);letter-spacing:-.02em;line-height:1}
.lpwrap .fwm span{background:linear-gradient(180deg,#E8CE93,#C9A86A 58%,#9A7B3E);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lpwrap .ftag2{position:relative;z-index:1;font-size:14.5px;line-height:1.6;color:#9AA4AD;max-width:340px;margin:16px auto 0}
.lpwrap .ftag2 b{color:#cdd5da;font-weight:600}
.lpwrap .ftrust{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:20px}
.lpwrap .tpill{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:#9AA4AD;border:1px solid var(--line);border-radius:999px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px}
.lpwrap .tpill i{width:5px;height:5px;border-radius:50%;background:var(--green);display:inline-block}
.lpwrap .tpill.g i{background:var(--gold)}
.lpwrap .flinks{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:24px;font-family:var(--mono);font-size:12px;letter-spacing:.04em}
.lpwrap .flinks a{color:#9AA4AD;padding:4px 2px}
.lpwrap .flinks a:hover{color:var(--gold)}
.lpwrap .fdot{color:#33393f}
.lpwrap .fdiv2{height:1px;max-width:520px;margin:30px auto 0;background:linear-gradient(90deg,transparent,rgba(201,168,106,.4),transparent)}
.lpwrap .frg{margin-top:22px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
.lpwrap footer .fdisc{font-family:var(--mono);font-size:11px;color:#5C6770;margin-top:12px;line-height:1.7;max-width:560px;margin-left:auto;margin-right:auto;border-top:0;padding-top:0}

`;
