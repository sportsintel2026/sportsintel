// WZ-SEO-POINTSPREAD-ARTICLE-2026-08-17 :: /how-point-spreads-work -- public educational page.
// A distinct bet-type explainer (point spreads), complementing the moneyline / implied-probability /
// CLV articles rather than duplicating them. Factual only; example scores/odds are standard illustrative
// numbers, not WizePicks results; no picks, recommendations, profitability claims, or proprietary logic.
// FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function HowPointSpreadsPage() {
  useSeo({
    title: "How Point Spreads Work in Sports Betting — WizePicks",
    description: "Point spreads explained: what -6.5 and +6.5 mean, covering the spread, pushes and the hook, spread odds and vig, run lines and puck lines, plus worked examples and common mistakes.",
    path: "/how-point-spreads-work",
  });
  return (
    <PageShell
      title="How Point Spreads Work in Sports Betting"
      lead={<>A point spread turns a lopsided game into a roughly even bet by handicapping the favorite. Instead of just picking who wins, you bet on the <b>margin of victory</b> &mdash; whether the favorite wins by enough, or the underdog stays close enough. This guide covers how spreads are read, what it means to cover, pushes, the odds, and how spreads differ by sport.</>}
    >
      <Section h="What a point spread is">
        <P>A point spread is a margin the sportsbook sets to level the playing field between a stronger and weaker team. The <b>favorite</b> must win by more than the spread; the <b>underdog</b> can lose by less than the spread &mdash; or win outright &mdash; and still cash the bet.</P>
        <P>It is a different bet from the moneyline. A moneyline is simply <a href="/how-to-read-moneyline-odds">who wins</a>; a spread is <b>by how much</b>; and an <a href="/over-under-betting">over/under total</a> is about the combined score. Combine several of these picks onto one ticket and you have a <a href="/what-is-a-parlay">parlay</a>. That is why a big favorite can be a losing spread bet even when it wins the game.</P>
      </Section>

      <Section h="Reading the favorite and the underdog">
        <P>Spreads are written with a number and a sign, attached to each side:</P>
        <ul className="pg-ul">
          <LI><b>Favorite: -6.5</b> &mdash; must win by <b>7 or more</b> to cover (6.5 points are subtracted from their score).</LI>
          <LI><b>Underdog: +6.5</b> &mdash; covers if they lose by <b>6 or fewer</b>, or win the game outright (6.5 points are added to their score).</LI>
        </ul>
        <P>The minus sign always marks the favorite (giving points) and the plus sign marks the underdog (getting points) &mdash; the same convention as moneyline odds, applied to points instead of price.</P>
      </Section>

      <Section h="What &ldquo;covering the spread&rdquo; means">
        <P>To <b>cover</b> is to beat the spread. Apply the spread to the final score and see who comes out ahead:</P>
        <ul className="pg-ul">
          <LI>The <b>favorite covers</b> when their winning margin is larger than the spread.</LI>
          <LI>The <b>underdog covers</b> when they lose by less than the spread, or win the game.</LI>
        </ul>
        <P>Winning the game and covering the spread are not the same thing. A team can win but fail to cover (a &ldquo;backdoor&rdquo; situation for the other side), and an underdog can lose the game but still cover.</P>
      </Section>

      <Section h="Pushes and the half-point &ldquo;hook&rdquo;">
        <P>If the spread is a <b>whole number</b> and the favorite wins by exactly that number, the bet is a <b>push</b> &mdash; a tie against the spread, and your stake is refunded. Example: at <b>-3</b>, if the favorite wins by exactly 3, it pushes.</P>
        <P>A <b>half-point</b> &mdash; the <b>hook</b> &mdash; removes the possibility of a push, because a game can&rsquo;t end on a half-point. At <b>-3.5</b>, the favorite must win by 4; there is no tie. That half-point matters most around common margins like 3 and 7 in football.</P>
      </Section>

      <Section h="Point spread odds and the vig">
        <P>Beating the spread is only half the price; the other half is the odds attached to it. Spread bets are most often priced around <b>-110</b> on each side &mdash; you risk $110 to win $100. That built-in margin is the sportsbook&rsquo;s <b>vig</b> (juice).</P>
        <P>Because of the vig, a -110 spread implies about a <b>52.4%</b> break-even rate, not 50%. To see why, read <a href="/implied-probability-sports-betting">implied probability</a> &mdash; the same math that turns odds into a percentage applies to spread prices. Books also shade the odds (say -105 / -115) to balance the money instead of moving the number itself.</P>
      </Section>

      <Section h="A worked example">
        <P>Say an NFL game is <b>Team A -6.5 (-110)</b> vs. <b>Team B +6.5 (-110)</b>.</P>
        <ul className="pg-ul">
          <LI><b>A wins 27&ndash;20 (by 7):</b> 7 &gt; 6.5, so <b>A covers</b>. A -6.5 bet wins.</LI>
          <LI><b>A wins 24&ndash;20 (by 4):</b> 4 &lt; 6.5, so A does not cover &mdash; <b>B covers</b>. A +6.5 bet wins even though B lost the game.</LI>
          <LI><b>Push case:</b> if the line were <b>-6</b> and A won by exactly 6, the bet would push and stakes are refunded.</LI>
        </ul>
      </Section>

      <Section h="Spread vs. moneyline: when each makes sense">
        <P>The <b>moneyline</b> pays you to be right about the winner; the <b>spread</b> pays you to be right about the margin. Betting a big favorite on the moneyline can require laying a steep price, while the spread offers a near-even payout in exchange for demanding a bigger win.</P>
        <P>Neither is inherently better. As always, the question is whether the <b>price is right for the true chance</b> &mdash; the spread version of that is whether the number and the odds fairly reflect the likely margin.</P>
      </Section>

      <Section h="How spreads differ by sport">
        <ul className="pg-ul">
          <LI><b>Football and basketball (NFL, CFB, NBA):</b> full point spreads that can be small or large (e.g., -2.5 or -14.5), since scores span a wide range.</LI>
          <LI><b>Baseball (MLB):</b> the spread is usually a fixed <b>run line</b> of <b>&plusmn;1.5</b> runs, with the odds doing most of the work.</LI>
          <LI><b>Hockey (NHL):</b> a fixed <b>puck line</b> of <b>&plusmn;1.5</b> goals, similar to baseball.</LI>
        </ul>
        <P>The idea is identical across sports &mdash; handicap the favorite by a margin &mdash; but the size and flexibility of that margin depend on how the sport scores.</P>
      </Section>

      <Section h="Why point spreads move">
        <P>A spread is not fixed after it opens. Books adjust the number and the odds in response to <b>new information</b> (injuries, weather, lineups) and to <b>the money coming in</b>. A line might move from -6.5 to -7.5, or hold the number and shift the price.</P>
        <P>The final number before kickoff reflects the most information. Taking a better number than where the market closes is a form of value; the general idea is covered in <a href="/what-is-closing-line-value">closing line value</a>.</P>
      </Section>

      <Section h="Common beginner mistakes">
        <ul className="pg-ul">
          <LI><b>Confusing winning with covering.</b> A favorite can win the game and still lose the spread bet.</LI>
          <LI><b>Ignoring the hook.</b> The half-point between -3 and -3.5 changes real outcomes, especially in football.</LI>
          <LI><b>Forgetting the vig.</b> A -110 spread needs about a 52.4% cover rate to break even, not 50%.</LI>
          <LI><b>Assuming big favorites always cover.</b> Large spreads demand large margins that don&rsquo;t always show up.</LI>
          <LI><b>Judging a spread bet by one result.</b> A well-priced bet can miss on the night; that alone doesn&rsquo;t make it a bad bet.</LI>
        </ul>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What does -6.5 mean in betting?</H3>
        <P>-6.5 marks the favorite. They must win by 7 or more for a -6.5 bet to cover, because 6.5 points are subtracted from their final score.</P>

        <H3>What does it mean to cover the spread?</H3>
        <P>Covering means beating the spread. The favorite covers by winning by more than the number; the underdog covers by losing by less than the number, or by winning outright.</P>

        <H3>What is a push on a point spread?</H3>
        <P>A push is a tie against the spread &mdash; it happens when the margin lands exactly on a whole-number spread (e.g., -3 and a 3-point win). Your stake is refunded. Half-point spreads can&rsquo;t push.</P>

        <H3>Why are point spreads usually -110?</H3>
        <P>The -110 odds are the sportsbook&rsquo;s margin (the vig). Risking $110 to win $100 on each side is how the book profits, and it means you need about a 52.4% cover rate to break even.</P>

        <H3>Is the spread the same in every sport?</H3>
        <P>The concept is, but the format differs. Football and basketball use flexible point spreads; baseball uses a &plusmn;1.5 run line and hockey a &plusmn;1.5 puck line, with the odds carrying more of the weight.</P>
      </Section>

      <PageNav
        links={[
          { to: "/how-to-read-moneyline-odds", label: "How to read moneyline odds" },
          { to: "/implied-probability-sports-betting", label: "Implied probability" },
          { to: "/what-is-closing-line-value", label: "What is closing line value?" },
          { to: "/how-it-works", label: "How WizePicks works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
