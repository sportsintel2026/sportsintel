// WZ-SEO-MONEYLINE-ARTICLE-2026-08-17 :: /how-to-read-moneyline-odds -- public evergreen educational page.
// Original, factual explainer (beginner -> experienced). No picks, predictions, recommendations, or
// guaranteed-profit claims; example odds/numbers are standard illustrative math, not WizePicks results.
// No proprietary model logic. FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function MoneylineOddsPage() {
  useSeo({
    title: "How to Read Moneyline Odds — WizePicks",
    description: "Moneyline odds explained: what +150 and -150 mean, how to calculate profit, payout, break-even and implied probability, plus favorites vs. underdogs, vig, line moves, and beginner mistakes.",
    path: "/how-to-read-moneyline-odds",
  });
  return (
    <PageShell
      title="How to Read Moneyline Odds"
      lead={<>A moneyline is the simplest bet in sports: pick who wins, straight up. The odds attached to it tell you two things at once &mdash; <b>how much a bet pays</b> and <b>how likely the market thinks that side is</b>. This guide starts from the basics and builds to the math serious bettors use every day. Brand new to betting? Start with the <a href="/sports-betting-for-beginners">sports betting for beginners</a> guide first.</>}
    >
      <Section h="What moneyline odds are">
        <P>A moneyline bet is a wager on which team or player wins outright &mdash; no <a href="/how-point-spreads-work">point spread</a>, no <a href="/over-under-betting">over/under total</a>, no margin of victory. The <b>moneyline odds</b> are the price of that bet, written in <a href="/odds-formats-explained">American format</a> as a number with a <b>+</b> or a <b>-</b> sign, such as <b>+150</b> or <b>-150</b>.</P>
        <P>The sign tells you which side is the favorite and which is the underdog, and the number tells you the payout. Everything else in this guide comes back to those two facts.</P>
      </Section>

      <Section h="Positive odds (+150, +200)">
        <P>A <b>plus</b> sign marks the <b>underdog</b> &mdash; the side the market thinks is less likely to win, and therefore the side that pays more. The number is how much profit you make on a <b>$100</b> bet.</P>
        <ul className="pg-ul">
          <LI><b>+150</b>: a $100 bet wins <b>$150</b> profit.</LI>
          <LI><b>+200</b>: a $100 bet wins <b>$200</b> profit.</LI>
        </ul>
        <P>You do not have to bet $100 &mdash; it is just the reference amount. The formula for any stake is: <b>profit = stake &times; (odds &divide; 100)</b>. A $40 bet at +150 wins 40 &times; 1.5 = <b>$60</b>.</P>
      </Section>

      <Section h="Negative odds (-150, -200)">
        <P>A <b>minus</b> sign marks the <b>favorite</b> &mdash; the side more likely to win, and therefore the side that pays less. The number is how much you must <b>risk to win $100</b>.</P>
        <ul className="pg-ul">
          <LI><b>-150</b>: risk $150 to win <b>$100</b> profit.</LI>
          <LI><b>-200</b>: risk $200 to win <b>$100</b> profit.</LI>
        </ul>
        <P>For any stake, the formula flips to: <b>profit = stake &times; (100 &divide; |odds|)</b>. A $50 bet at -200 wins 50 &times; 0.5 = <b>$25</b>.</P>
      </Section>

      <Section h="How to calculate your profit">
        <P>Putting both cases together, profit on a winning moneyline bet is:</P>
        <ul className="pg-ul">
          <LI><b>Positive odds:</b> profit = stake &times; (odds &divide; 100). Example: $100 at +250 &rarr; 100 &times; 2.5 = <b>$250</b> profit.</LI>
          <LI><b>Negative odds:</b> profit = stake &times; (100 &divide; |odds|). Example: $100 at -125 &rarr; 100 &times; 0.8 = <b>$80</b> profit.</LI>
        </ul>
      </Section>

      <Section h="Total payout vs. profit">
        <P><b>Profit</b> is what you win on top of your stake. <b>Total payout</b> (or total return) is your profit <b>plus</b> the stake you get back:</P>
        <ul className="pg-ul">
          <LI><b>Total payout = stake + profit.</b></LI>
          <LI>$100 at +150 &rarr; $150 profit + $100 stake = <b>$250</b> total return.</LI>
          <LI>$150 at -150 &rarr; $100 profit + $150 stake = <b>$250</b> total return.</LI>
        </ul>
        <P>When someone quotes a bet &ldquo;to win X,&rdquo; they mean profit. When they say it &ldquo;returns X,&rdquo; they mean the total. Knowing which is which prevents a lot of confusion. Combine several bets onto one ticket and the payouts multiply &mdash; that is a <a href="/what-is-a-parlay">parlay</a>.</P>
      </Section>

      <Section h="Implied probability: what the odds are really saying">
        <P>Every price carries an <b>implied probability</b> &mdash; the win rate the odds correspond to. You can convert any moneyline to a percentage:</P>
        <ul className="pg-ul">
          <LI><b>Negative odds:</b> implied % = |odds| &divide; (|odds| + 100). Example: -150 &rarr; 150 &divide; 250 = <b>60%</b>.</LI>
          <LI><b>Positive odds:</b> implied % = 100 &divide; (odds + 100). Example: +150 &rarr; 100 &divide; 250 = <b>40%</b>.</LI>
        </ul>
        <P>So -150 is the market pricing that side to win about 60% of the time, and +150 is pricing its opponent at about 40%. Reading odds as probabilities is the single most useful habit a bettor can build.</P>
      </Section>

      <Section h="Break-even: how often you need to win">
        <P>The implied probability is also your <b>break-even</b> win rate: the share of bets you must win, at that price, just to come out even over time. They are the same number viewed two ways &mdash; one describes the price, the other describes the bar you have to clear.</P>
        <P>At <b>-150</b>, you break even by winning <b>60%</b> of the time. At <b>+150</b>, you break even at <b>40%</b>. Win more often than the break-even rate and you profit long-term; win less and you lose &mdash; regardless of how any single bet turns out.</P>
      </Section>

      <Section h="Favorites vs. underdogs">
        <P><b>Favorites</b> have negative odds: they win more often but pay less, and they carry a higher break-even rate. <b>Underdogs</b> have positive odds: they win less often but pay more, with a lower break-even rate.</P>
        <P>Neither is &ldquo;better&rdquo; on its own. A favorite at a fair price and an underdog at a fair price are equally good bets. What matters is whether the price is right for the true chance &mdash; not whether the number is big or small.</P>
      </Section>

      <Section h="Why sportsbook prices include vig (the hold)">
        <P>Add up the implied probabilities on both sides of a real game and they come to <b>more than 100%</b>. That extra slice is the sportsbook&rsquo;s margin &mdash; the <b>vig</b>, also called juice or hold.</P>
        <P>Take a game priced <b>-130</b> / <b>+110</b>. The favorite implies 130 &divide; 230 = <b>56.5%</b>; the underdog implies 100 &divide; 210 = <b>47.6%</b>. Together that is <b>104.1%</b> &mdash; roughly a <b>4.1%</b> hold baked into the price. The vig is how books make money, and it is the reason you need to win more than a coin flip to beat an even-looking bet. A classic <b>-110</b> both ways implies 52.4% on each side, about a 4.8% hold.</P>
      </Section>

      <Section h="Why odds move before a game">
        <P>Odds are not fixed. Between the time a market opens and when the game starts, prices move as books react to <b>new information</b> (injuries, weather, lineups) and to <b>the money coming in</b>. A flood of bets on one side, or a sharp bettor taking a price, can nudge the number.</P>
        <P>The final price before kickoff &mdash; the closing line &mdash; reflects the most information, which is why it is treated as the market&rsquo;s sharpest estimate. Getting a better number than the close is called <a href="/what-is-closing-line-value">closing line value</a>, and it is one of the clearest signs of good betting.</P>
      </Section>

      <Section h="Price vs. actual win probability">
        <P>Implied probability is the market&rsquo;s <b>opinion</b> of a team&rsquo;s chances, inflated a little by the vig. It is not a guarantee, and it is not necessarily correct. The whole point of analytical betting is to find spots where your estimate of the true probability differs from the price.</P>
        <P>If you think a team wins 50% of the time but the market prices it at +150 (40% implied), the price is generous relative to your read. That gap &mdash; between a fair price and the posted price &mdash; is the <b>edge</b>. It is exactly what <a href="/how-it-works">how WizePicks works</a> is built to find, and it is different from simply predicting who wins one game.</P>
      </Section>

      <Section h="Common beginner mistakes">
        <ul className="pg-ul">
          <LI><b>Reading the number as a percentage of your stake.</b> +150 does not mean 150% &mdash; it means $150 profit per $100.</LI>
          <LI><b>Ignoring the vig.</b> An even-looking -110/-110 market still needs about a 52.4% win rate to break even.</LI>
          <LI><b>Assuming favorites are safe bets.</b> Favorites win more often but pay less; over-betting heavy favorites can quietly lose money.</LI>
          <LI><b>Confusing profit with total return.</b> &ldquo;Win $100&rdquo; and &ldquo;return $100&rdquo; are not the same thing.</LI>
          <LI><b>Treating the posted price as the true probability.</b> The price is an opinion plus a margin &mdash; not a fact.</LI>
        </ul>
      </Section>

      <Section h="A few worked examples">
        <H3>Underdog moneyline: $50 at +200</H3>
        <P>Profit = 50 &times; (200 &divide; 100) = <b>$100</b>. Total return = $100 + $50 = <b>$150</b>. Implied probability = 100 &divide; 300 = <b>33.3%</b>.</P>
        <H3>Favorite moneyline: $120 at -120</H3>
        <P>Profit = 120 &times; (100 &divide; 120) = <b>$100</b>. Total return = $100 + $120 = <b>$220</b>. Implied probability = 120 &divide; 220 = <b>54.5%</b>.</P>
        <H3>Comparing a favorite and an underdog</H3>
        <P>A 58% favorite at -150 (break-even 60%) is actually a <b>worse</b> bet than a 44% underdog at +150 (break-even 40%), even though the favorite wins more often &mdash; because the underdog clears its break-even bar and the favorite does not. Price relative to true probability is what matters.</P>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What does +150 mean?</H3>
        <P>+150 is an underdog price: a $100 bet wins $150 profit (total return $250). It implies about a 40% chance of winning.</P>

        <H3>What does -150 mean?</H3>
        <P>-150 is a favorite price: you risk $150 to win $100 profit (total return $250). It implies about a 60% chance of winning.</P>

        <H3>How do I turn moneyline odds into a probability?</H3>
        <P>For negative odds, implied % = |odds| &divide; (|odds| + 100). For positive odds, implied % = 100 &divide; (odds + 100). That percentage is also your break-even win rate at that price.</P>

        <H3>Is a favorite always the better bet?</H3>
        <P>No. Favorites win more often but pay less and have a higher break-even rate. A bet is good or bad based on the price relative to the true chance, not on whether the odds are plus or minus.</P>

        <H3>Why do both sides add up to more than 100%?</H3>
        <P>That extra is the sportsbook&rsquo;s margin &mdash; the vig or hold. It is built into the price and is why you must win more than an even split to profit on an even-looking market.</P>
      </Section>

      <PageNav
        links={[
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
