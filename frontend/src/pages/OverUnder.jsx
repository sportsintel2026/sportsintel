// WZ-SEO-TOTALS-ARTICLE-2026-08-17 :: /over-under-betting -- public educational page.
// A distinct bet-type explainer (totals / over-under), completing the core bet-type set alongside
// the moneyline and point-spread articles. Factual only; example lines/scores are standard illustrative
// numbers, not WizePicks results; no picks, recommendations, profitability claims, or proprietary logic.
// FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function OverUnderPage() {
  useSeo({
    title: "What Is Over/Under (Totals) Betting? — WizePicks",
    description: "Over/under (totals) betting explained: what the total means, betting the Over vs the Under, pushes, odds and vig, worked examples in the NFL, NBA and MLB, line moves, and common mistakes.",
    path: "/over-under-betting",
  });
  return (
    <PageShell
      title="What Is Over/Under (Totals) Betting?"
      lead={<>An over/under bet &mdash; also called a <b>total</b> &mdash; ignores who wins entirely. You are betting on the <b>combined score</b> of both teams: whether it lands above or below a number the sportsbook sets. It is one of the three main bet types, alongside the <a href="/how-to-read-moneyline-odds">moneyline</a> and the <a href="/how-point-spreads-work">point spread</a>.</>}
    >
      <Section h="What over/under (totals) betting means">
        <P>The sportsbook posts a <b>total</b> &mdash; a single number for the combined points, runs, or goals both teams are expected to score. You then bet one of two ways:</P>
        <ul className="pg-ul">
          <LI><b>Over:</b> the two teams combine for <b>more</b> than the total.</LI>
          <LI><b>Under:</b> the two teams combine for <b>less</b> than the total.</LI>
        </ul>
        <P>Who wins the game does not matter. A total can cash whether the favorite blows out the underdog or the game ends in a nail-biter &mdash; all that counts is the final combined score against the number.</P>
      </Section>

      <Section h="How the total is set">
        <P>Sportsbooks set the total using their models and market information: team pace and scoring rates, matchups, and the conditions of the specific game. The number is meant to split betting roughly in half, so that money comes in fairly evenly on the Over and the Under.</P>
        <P>Totals are usually posted with a <b>half-point</b> (like 45.5) to avoid ties, though whole-number totals (like 45) do appear &mdash; and those can end in a push (more below).</P>
      </Section>

      <Section h="Betting the Over vs. the Under">
        <P>Say a football game has a total of <b>45.5</b>:</P>
        <ul className="pg-ul">
          <LI>Bet the <b>Over</b> and you win if the teams combine for <b>46 or more</b>.</LI>
          <LI>Bet the <b>Under</b> and you win if they combine for <b>45 or fewer</b>.</LI>
        </ul>
        <P>Over bettors want scoring and pace; Under bettors want defense, slow tempo, and anything that suppresses points. It is a cleaner question than picking a winner &mdash; you only have to be right about the flow of the game, not the result.</P>
      </Section>

      <Section h="Pushes: what happens when the total lands exactly">
        <P>If the total is a <b>whole number</b> and the combined score lands on it exactly, the bet is a <b>push</b> &mdash; a tie, and your stake is refunded. Example: a total of <b>45</b>, and the game ends 24&ndash;21 for a combined <b>45</b>. Over and Under both push.</P>
        <P>A <b>half-point</b> total (like 45.5) removes that possibility, because a combined score can&rsquo;t land on a half-point. That is why most totals carry the extra half-point.</P>
      </Section>

      <Section h="The odds and the vig">
        <P>Beating the number is only half of it; the price is the other half. Totals are most often priced around <b>-110</b> on each side &mdash; risk $110 to win $100. That built-in margin is the sportsbook&rsquo;s <b>vig</b> (juice).</P>
        <P>Books can also shade the odds instead of moving the number &mdash; for example, an Over at <b>-115</b> and the Under at <b>-105</b> &mdash; to balance the money on a total they don&rsquo;t want to move off the number.</P>
      </Section>

      <Section h="Implied probability on a total">
        <P>Because a total has a price, it also has an <b>implied probability</b> &mdash; and therefore a break-even rate. A -110 side implies about a <b>52.4%</b> break-even, not 50%, thanks to the vig. The same conversion that turns any odds into a percentage applies here; see <a href="/implied-probability-sports-betting">implied probability</a> for the math.</P>
      </Section>

      <Section h="Worked examples in common sports">
        <H3>NFL: total 45.5</H3>
        <P>Final score 27&ndash;20 = <b>47</b> combined. 47 &gt; 45.5, so the <b>Over</b> wins. If it had finished 20&ndash;17 = 37, the <b>Under</b> would win.</P>
        <H3>NBA: total 224.5</H3>
        <P>Final score 118&ndash;112 = <b>230</b> combined. 230 &gt; 224.5, so the <b>Over</b> wins. A 105&ndash;99 = 204 game cashes the <b>Under</b>.</P>
        <H3>MLB: total 8.5 runs</H3>
        <P>Final score 6&ndash;5 = <b>11</b> runs, the <b>Over</b> wins. A 3&ndash;2 = 5-run game cashes the <b>Under</b>. (If the total were a whole number like 8 and the game finished with exactly 8 runs, it would push.)</P>
      </Section>

      <Section h="How totals lines move">
        <P>A total is not fixed after it opens. Books adjust the number and the odds as <b>new information</b> arrives (weather, a scratched starter, a key injury) and as <b>money comes in</b>. A total might climb from 45.5 to 47, or hold the number while the price shifts.</P>
        <P>The number just before kickoff reflects the most information, which is why the closing total is treated as the market&rsquo;s sharpest estimate. Getting a better number than where the market closes is the idea behind <a href="/what-is-closing-line-value">closing line value</a>.</P>
      </Section>

      <Section h="Factors that can affect a total">
        <ul className="pg-ul">
          <LI><b>Pace and style:</b> fast, high-possession teams push totals up; slow, defensive teams push them down.</LI>
          <LI><b>Weather:</b> wind, rain, and cold can suppress scoring outdoors &mdash; a major factor in football and baseball.</LI>
          <LI><b>Pitching (MLB):</b> the starting pitchers and bullpen strength heavily shape a run total.</LI>
          <LI><b>Injuries:</b> a missing scorer or a weakened defense can move a total in either direction.</LI>
          <LI><b>Park and venue:</b> ballpark dimensions and altitude affect run environments.</LI>
          <LI><b>Rest and schedule:</b> tired teams on the back end of a schedule can score less efficiently.</LI>
        </ul>
      </Section>

      <Section h="Totals vs. the moneyline and the spread">
        <P>The <a href="/how-to-read-moneyline-odds">moneyline</a> asks who wins; the <a href="/how-point-spreads-work">point spread</a> asks by how much; the total asks <b>how much scoring happens</b> &mdash; independent of the winner. Many bettors like totals precisely because they can be handicapped from tempo, matchups, and conditions without needing to pick a side.</P>
        <P>As with every market, the real question is whether the number and the price fairly reflect the likely outcome &mdash; not whether the Over or the Under &ldquo;feels&rdquo; right.</P>
      </Section>

      <Section h="Common beginner mistakes">
        <ul className="pg-ul">
          <LI><b>Chasing the Over by default.</b> Overs feel more fun, but a total is only a good bet at the right number and price.</LI>
          <LI><b>Ignoring weather and pitching.</b> These move real totals, especially in football and baseball.</LI>
          <LI><b>Forgetting the vig.</b> A -110 total needs about a 52.4% win rate to break even, not 50%.</LI>
          <LI><b>Overlooking pushes.</b> Whole-number totals can tie and refund; half-points can&rsquo;t.</LI>
          <LI><b>Judging a total by one game.</b> A well-priced bet can miss on the night; that alone doesn&rsquo;t make it wrong.</LI>
        </ul>
      </Section>

      <Section h="How WizePicks may display totals plays">
        <P>WizePicks surfaces totals the same way it treats any market: an <b>Over or Under at a specific line and price</b>, recorded before the game and graded against the actual combined score. Results are tracked so a totals play can be reviewed honestly &mdash; separate from whether that one game happened to land your way.</P>
        <P>No pick is guaranteed, and past performance does not guarantee future results. For how the plays are built, see <a href="/how-it-works">how WizePicks works</a>.</P>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What does over/under mean in betting?</H3>
        <P>It is a bet on the combined score of both teams versus a number the sportsbook sets. Bet the Over if you think the total will be higher, the Under if you think it will be lower. The winner of the game does not matter.</P>

        <H3>What happens if the total lands exactly on the number?</H3>
        <P>On a whole-number total, an exact landing is a push &mdash; a tie, and your stake is refunded. Half-point totals (like 45.5) can&rsquo;t push because a score can&rsquo;t land on a half-point.</P>

        <H3>Why are totals usually -110?</H3>
        <P>The -110 odds are the sportsbook&rsquo;s margin (the vig). Risking $110 to win $100 on each side is how the book profits, and it means you need about a 52.4% win rate to break even.</P>

        <H3>What affects whether a game goes Over or Under?</H3>
        <P>Pace and scoring style, weather, injuries, and &mdash; in baseball &mdash; the starting pitching and ballpark. These shape how much scoring a game is likely to produce.</P>

        <H3>Is betting the Over or the Under better?</H3>
        <P>Neither by default. A total is a good bet only when the number and price are favorable relative to the likely combined score &mdash; the side is secondary to the price.</P>
      </Section>

      <PageNav
        links={[
          { to: "/how-to-read-moneyline-odds", label: "How to read moneyline odds" },
          { to: "/how-point-spreads-work", label: "How point spreads work" },
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
