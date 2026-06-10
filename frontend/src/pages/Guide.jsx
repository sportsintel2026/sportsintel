// Guide.jsx — "How WizePicks Works": explains the model, how to read every
// number on the site, and how to use it responsibly. Linked from the sidebar.
// Matches the app's inline-style house design (no Tailwind).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { subscriptionApi } from "../lib/api";
import Sidebar from "./Sidebar";

export default function GuidePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState({ tier: "free", isAdmin: false });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { subscriptionApi.getMyPlan().then(setPlan).catch(() => {}); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e14", color: "#e4e7eb", fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{box-sizing:border-box}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{transform:translateX(-100%)}to{transform:translateX(0)}}
        .mobile-only{display:none}
        .desktop-sidebar{display:block}
        @media (max-width: 768px) {
          .desktop-sidebar{display:none!important}
          .main-content{margin-left:0!important}
          .mobile-only{display:flex!important}
        }
      `}</style>

      {/* Desktop sidebar */}
      <div className="desktop-sidebar">
        <Sidebar user={user} plan={plan} signOut={signOut} navigate={navigate} />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, animation: "slideIn .2s ease-out", zIndex: 51 }}>
            <Sidebar user={user} plan={plan} signOut={signOut} navigate={(path) => { setDrawerOpen(false); navigate(path); }} />
          </div>
        </>
      )}

      {/* Mobile top bar */}
      <div className="mobile-only" style={{ display: "none", position: "sticky", top: 0, zIndex: 40, background: "#0a0e14", borderBottom: "1px solid #1a1f28", padding: "10px 14px", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: "none", border: "none", color: "#e4e7eb", fontSize: 22, padding: 4, cursor: "pointer" }}>☰</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>Wize<span style={{ color: "#1D9E75" }}>Picks</span></span>
        </div>
        <div style={{ width: 30 }} />
      </div>

      <div className="main-content" style={{ marginLeft: 200 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px", animation: "fadeIn .3s ease" }}>

          <button onClick={() => navigate("/dashboard")} style={{ background: "transparent", border: "1px solid #1f2937", color: "#9ca3af", fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 8, cursor: "pointer", marginBottom: 20, fontFamily: "inherit" }}>← Back to Edges</button>

          {/* Header */}
          <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em" }}>How WizePicks Works</h1>
          <p style={{ margin: "0 0 28px", fontSize: 14, color: "#9ca3af", lineHeight: 1.6 }}>
            Read this once. It makes every number on the site more useful — and keeps you out of the
            traps that cost bettors money.
          </p>

          {/* What this is */}
          <Card>
            <Eyebrow>What this is — and isn't</Eyebrow>
            <P>
              WizePicks is an <B>analytics tool, not a sportsbook and not a tip service.</B> We run a
              statistical model on every game, compare our projection to the sportsbook's line, and
              flag where the two disagree. That gap is what we call an <B>edge.</B>
            </P>
            <P style={{ marginBottom: 0 }}>
              We don't take bets, and we don't tell you what to wager. We hand you a sharper second
              opinion. What you do with it is yours.
            </P>
          </Card>

          {/* Glossary */}
          <Card>
            <Eyebrow>The numbers you'll see</Eyebrow>
            <Term term="Edge" tint="#22c55e">
              How far our projection sits from the book — shown in points for spreads and totals, or in
              percent for the moneyline. Bigger means bigger disagreement. It is <B>not</B> your chance
              of winning the bet.
            </Term>
            <Term term="Model win probability" tint="#1D9E75">
              Our estimate of each team's chance to win. We deliberately <B>blend it toward the
              sportsbook's price</B> (roughly 55% our model, 45% the market) so a young model can't talk
              itself into fake confidence against a sharp line.
            </Term>
            <Term term="Projected margin / total" tint="#1D9E75">
              The model's raw prediction for the final scoring margin and the combined points. This is
              what the spread and total edges are measured against.
            </Term>
            <Term term="Inflation flag — ⚠ Market High" tint="#fbbf24">
              The market is pricing a side <B>higher</B> than our fundamentals justify — often public
              money piling on a favorite or a hot streak. A heads-up to look closer, not a verdict.
            </Term>
            <Term term="Suspect dot" tint="#f59700" last>
              A small orange dot means a projection was extreme enough that we don't fully trust it.
              Treat anything flagged this way with extra caution.
            </Term>
          </Card>

          {/* Worked example */}
          <Card accent="#1D9E75">
            <Eyebrow>How to read an edge (worked example)</Eyebrow>
            <P>Say the dashboard shows this:</P>
            <div style={{ background: "#0a0e14", border: "1px solid #1f2937", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#22c55e", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>🎯 Biggest model edge</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Knicks +4.5 &nbsp;·&nbsp; <span style={{ color: "#22c55e" }}>+1.9 pts</span></div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>model: Spurs by 2.6 · line 4.5</div>
            </div>
            <P>
              Read it like this: the model thinks <B>San Antonio wins by about 2.6</B>, but the book is
              making them give <B>4.5</B>. That <B>1.9-point gap is the edge</B> — and it points to taking
              the Knicks at +4.5.
            </P>
            <P style={{ marginBottom: 0 }}>
              Notice the model still likes the Spurs to <i>win the game</i> — it just thinks the price is
              too steep. <B>A team can be the right side to win and the wrong side to lay points.</B> That's
              the whole game: not who wins, but whether the number is fair.
            </P>
          </Card>

          {/* Study → compare → decide workflow */}
          <Card accent="#1D9E75">
            <Eyebrow>Put the page to work: study, compare, decide</Eyebrow>
            <P>
              Every game page hands you the raw material to make your own call — don't stop at the edge
              number. Use it like this:
            </P>
            <Step n="1" title="Study the data we give you">
              Dig into the player stat lines and prop projections, the team comparison and season
              averages, the injury report, line movement, and our win probability stacked against ESPN
              and the sportsbook. It's all on the page for a reason — read it.
            </Step>
            <Step n="2" title="Compare it to our projection">
              Hold what you found up against the model's number. Does the data back up the projection, or
              does something stick out — a key player out, a brutal back-to-back, a matchup the model may
              be underrating?
            </Step>
            <Step n="3" title="Decide: ride with it, or fade it" last>
              If your findings line up with the model, that's a confident spot to <B>go with the
              projection.</B> If your read genuinely conflicts with it, trust your homework and <B>go
              against it</B> — or pass. Either way you're placing a <B>smart bet</B> you understand, not
              blindly following a number.
            </Step>
          </Card>

          {/* The most important rule */}
          <Card accent="#fbbf24">
            <Eyebrow tint="#fbbf24">The most important rule: don't bet the number, bet the read</Eyebrow>
            <P>
              <B>A high model probability is not a green light.</B> A 65% favorite still loses about one
              time in three. Edges pay off over hundreds of bets, not on any single night — so no one
              number should ever carry a whole wager on its own.
            </P>
            <P>
              <B>The model is your starting point, not your finish line.</B> It can't see everything: a
              late scratch, locker-room news, a rest decision, a team that's mentally checked out, a
              revenge spot, a brutal travel schedule. You can.
            </P>
            <P>
              So put your own homework next to it. Check injuries and lineups right up to tip-off or
              first pitch, watch how the line has moved since it opened, and ask what's changed since the
              model ran.
            </P>
            <P style={{ marginBottom: 0 }}>
              <B>Your strongest spots are where the model and your own read agree.</B> When they disagree,
              treat it as a flag to dig in — sometimes you'll pass, sometimes you'll catch something the
              model missed, and sometimes the model will catch something you did.
            </P>
          </Card>

          {/* Why we show losing days */}
          <Card>
            <Eyebrow>Why we show our losing days</Eyebrow>
            <P>
              We grade every pick automatically and we <B>never hide a bad stretch.</B> We lead with
              <B> closing-line value</B> — did we beat the number the market closed at? — because that's
              the cleanest sign an edge was real, and we treat short-run win/loss and ROI as the small
              samples they are.
            </P>
            <P style={{ marginBottom: 0 }}>
              If a service only ever shows you green, be suspicious. Honesty about the misses is the point —
              it's how you can trust the wins.
            </P>
          </Card>

          {/* Shop the best line + reading odds + CLV */}
          <Card accent="#1D9E75">
            <Eyebrow>Shop the best line (the simplest edge there is)</Eyebrow>
            <P>
              The same bet doesn't pay the same everywhere. One book might price a side at <B>−130</B>
              while another has the <i>identical</i> bet at <B>−120</B>. Taking −120 means you risk less to
              win the same amount — a better price, guaranteed, with zero extra risk. Do that on every bet
              and it compounds into real money over a season.
            </P>
            <P>
              That's what the <B>💹 Market Price</B> page is for: every major US book's price for each game, side by
              side, with the <span style={{ color: "#1D9E75", fontWeight: 700 }}>best available price highlighted</span>.
              You don't have to hunt — we surface it. And when one book hangs a number out of step with the
              rest, you'll spot it sitting there.
            </P>
            <Term term="How to read American odds" tint="#1D9E75">
              A <B>minus</B> number (−120) is how much you risk to win $100 — −120 risks $120 to win $100.
              A <B>plus</B> number (+110) is how much you win on a $100 risk. So for the side you want:
              the <B>higher (more positive / less negative) number is always the better price.</B> That's
              the whole rule.
            </Term>
            <Term term="What is CLV (closing-line value)?" tint="#1D9E75" last>
              The <B>closing line</B> is the final price right before a game starts — the market's sharpest,
              most-informed number. If you consistently bet a better price than the close, you have
              <B> closing-line value</B>, and over time that's the single cleanest sign your bets were
              actually good — more reliable than any week of wins or losses. Line-shopping is the most
              direct way to get it: a better price now <i>is</i> beating the number a slower bettor takes later.
            </Term>
          </Card>

          {/* Responsible play */}
          <Card accent="#ef4444">
            <Eyebrow tint="#ef4444">Play responsibly</Eyebrow>
            <P>
              This is entertainment and information, for adults of legal age where you live. Only stake
              what you can comfortably afford to lose, never chase losses, and step away the moment it
              stops being fun.
            </P>
            <P style={{ marginBottom: 0 }}>
              If gambling is becoming a problem, call or text <B>1-800-GAMBLER</B> (US) — free,
              confidential, and available 24/7.
            </P>
          </Card>

          <p style={{ fontSize: 12, color: "#6b7280", textAlign: "center", marginTop: 24, lineHeight: 1.6 }}>
            Still unsure how to read something on the site? Good — skepticism is the right instinct.
            Take it slow, and let the model earn your trust one graded pick at a time.
          </p>

        </div>
      </div>
    </div>
  );
}

/* ---- small presentational helpers (house style) ---- */
function Card({ children, accent }) {
  return (
    <div style={{
      background: "#0f1419",
      border: "1px solid #1f2937",
      borderLeft: accent ? `3px solid ${accent}` : "1px solid #1f2937",
      borderRadius: 10,
      padding: 20,
      marginBottom: 18,
    }}>
      {children}
    </div>
  );
}
function Eyebrow({ children, tint }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: "0.1em", color: tint || "#1D9E75", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
      {children}
    </div>
  );
}
function P({ children, style }) {
  return <p style={{ margin: "0 0 14px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.65, ...style }}>{children}</p>;
}
function B({ children }) {
  return <span style={{ color: "#f3f4f6", fontWeight: 700 }}>{children}</span>;
}
function Term({ term, children, tint, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tint || "#e4e7eb", marginBottom: 3 }}>{term}</div>
      <div style={{ fontSize: 13.5, color: "#9ca3af", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}
function Step({ n, title, children, last }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: last ? 0 : 14 }}>
      <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: "#1D9E7522", border: "1px solid #1D9E7555", color: "#1D9E75", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{n}</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e4e7eb", marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "#9ca3af", lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}
