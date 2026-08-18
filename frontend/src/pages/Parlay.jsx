// WZ-SEO-PARLAY-ARTICLE-2026-08-17 :: /what-is-a-parlay -- public educational page.
// Owns the parlay / parlay-odds topic; links out to the odds, implied-probability, EV, and bankroll
// articles for depth rather than duplicating them. Factual only; example odds/payouts are standard
// illustrative math, not WizePicks results. Explicit that a bigger payout is NOT an edge and that
// parlays carry more house advantage. Settlement rules noted as varying by sportsbook -- no invented
// book-specific rules. No proprietary logic. FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function ParlayPage() {
  useSeo({
    title: "What Is a Parlay? Parlay Betting & Odds Explained — WizePicks",
    description: "Parlay betting explained: what a parlay and a leg are, why every leg must win, how parlay odds and payouts are created, worked American-odds examples, pushes and voids, and why parlays carry more risk and house edge.",
    path: "/what-is-a-parlay",
  });
  return (
    <PageShell
      title="What Is a Parlay?"
      lead={<>A parlay is a single bet that combines two or more wagers into one ticket. The payout is bigger because <b>every pick has to win</b> &mdash; miss one and the whole bet loses. That larger payout is tempting, but it comes with more risk and, usually, a bigger house edge. This guide covers how parlay odds and payouts work, with the honest trade-offs.</>}
    >
      <Section h="What a parlay is">
        <P>A <b>parlay</b> (also called an accumulator or combo) bundles multiple separate bets into one. Instead of placing three bets, you place one bet that only cashes if all three of your picks win. The reward for that added difficulty is a combined payout much larger than any single bet would return.</P>
        <P>The picks can span bet types and games &mdash; a <a href="/how-to-read-moneyline-odds">moneyline</a>, a <a href="/how-point-spreads-work">point spread</a>, and an <a href="/over-under-betting">over/under total</a> can all sit on the same parlay.</P>
      </Section>

      <Section h="What a &ldquo;leg&rdquo; is">
        <P>Each individual pick inside a parlay is a <b>leg</b>. A two-leg parlay has two picks; a five-leg parlay has five. Every leg is its own bet with its own odds, and the parlay combines them into a single wager with a single stake.</P>
      </Section>

      <Section h="Why every leg must win">
        <P>A standard parlay only pays if <b>all</b> of its legs win. One losing leg and the entire parlay loses &mdash; the other correct picks don&rsquo;t matter. That all-or-nothing structure is exactly why parlays pay more: you are being rewarded for stacking several independent hurdles into one.</P>
      </Section>

      <Section h="How parlay odds are created">
        <P>Parlay odds come from <b>multiplying the odds of each leg together</b>. The cleanest way to see this is with <a href="/odds-formats-explained">decimal odds</a> (the total return per unit, including your stake). To convert American odds to decimal:</P>
        <ul className="pg-ul">
          <LI><b>Positive:</b> decimal = (odds &divide; 100) + 1. So +150 &rarr; 2.5.</LI>
          <LI><b>Negative:</b> decimal = (100 &divide; |odds|) + 1. So -110 &rarr; about 1.91.</LI>
        </ul>
        <P>Multiply the decimals of every leg, and the result is the parlay&rsquo;s decimal payout. Because you are multiplying, each added leg scales the payout up quickly &mdash; and scales the chance of winning down just as quickly.</P>
      </Section>

      <Section h="How payouts work">
        <P>Total return = stake &times; (combined decimal odds). Profit is that total minus your stake. The more legs, the bigger the multiplier &mdash; and the longer the odds of hitting all of them.</P>
      </Section>

      <Section h="Worked examples with American odds">
        <H3>Two-leg parlay, both -110</H3>
        <P>Each -110 leg is 1.91 in decimal. Combined: 1.91 &times; 1.91 &asymp; <b>3.64</b>. A $100 bet returns about <b>$364</b> total (roughly <b>$264 profit</b>) &mdash; about <b>+264</b> in American odds, versus the ~$91 profit each -110 bet would pay on its own.</P>
        <H3>Three-leg parlay, all -110</H3>
        <P>1.91 &times; 1.91 &times; 1.91 &asymp; <b>6.96</b>. A $100 bet returns about <b>$696</b> (roughly <b>$596 profit</b>) &mdash; about <b>+596</b>. Notice the payout jumps a lot for one extra leg, because the odds of hitting all three are much lower.</P>
        <H3>Mixed odds: +150 and -120</H3>
        <P>+150 &rarr; 2.5; -120 &rarr; about 1.83. Combined: 2.5 &times; 1.83 &asymp; <b>4.58</b>. A $50 bet returns about <b>$229</b> (roughly <b>$179 profit</b>).</P>
      </Section>

      <Section h="What happens when one leg loses">
        <P>If any leg loses, the whole parlay loses and your entire stake is gone &mdash; even if every other leg won. There is no partial payout on a standard parlay. This is the core reason parlays are harder than they look: a 4-leg parlay of coin-flip picks wins only about one time in sixteen.</P>
      </Section>

      <Section h="Pushes and voids">
        <P>Sometimes a leg neither wins nor loses. A <b>push</b> (a tie against the number, like a spread landing exactly on it) or a <b>void</b> (a game postponed or cancelled) is usually <b>removed from the parlay</b>, and the bet <b>reduces to the remaining legs</b> &mdash; a three-leg parlay with one push typically pays as a two-leg parlay.</P>
        <P><b>Exact settlement rules vary by sportsbook</b>, so always check your book&rsquo;s specific parlay rules for how pushes and voids are handled. Do not assume &mdash; the details differ.</P>
      </Section>

      <Section h="Parlays vs. straight bets">
        <P>A <b>straight bet</b> is a single wager on one outcome; a parlay chains several together. Straight bets are lower-variance and easier to win; parlays are higher-variance with much larger payouts and much lower hit rates. Neither is &ldquo;better&rdquo; on its own &mdash; but they are very different risk profiles, and the bigger parlay number is not free.</P>
      </Section>

      <Section h="Why more legs means bigger payout AND more risk">
        <P>Every leg you add multiplies the payout, which feels like getting more for your money. But every leg also has to win, so the probability of cashing drops fast. Adding legs trades a higher payout for a lower chance &mdash; it does not improve the bet. A large potential payout is a sign of long odds, not of value.</P>
      </Section>

      <Section h="Why sportsbooks generally hold more on parlays">
        <P>Every straight bet already carries the book&rsquo;s margin, the <a href="/implied-probability-sports-betting">vig</a>. When you parlay several bets, those margins <b>compound</b>: the true fair odds of hitting all the legs are longer than the payout the book offers, and the gap (the hold) is typically larger than on the individual bets. That is why parlays are a profit center for sportsbooks and usually a <a href="/expected-value-betting">negative-EV</a> proposition &mdash; a bigger payout does not mean a better bet.</P>
      </Section>

      <Section h="Common beginner mistakes">
        <ul className="pg-ul">
          <LI><b>Chasing the big payout.</b> A huge number reflects long odds, not value; the hold is usually worse than on straight bets.</LI>
          <LI><b>Adding legs to boost the return.</b> Each leg lowers your win probability faster than it helps.</LI>
          <LI><b>Assuming a big win proves the strategy.</b> Hitting one parlay is variance, not an edge.</LI>
          <LI><b>Ignoring push/void rules.</b> How a tie or cancellation settles varies by book &mdash; check first.</LI>
          <LI><b>Over-staking.</b> Parlays are high-variance; a normal-sized stake on one is a large real risk.</LI>
        </ul>
      </Section>

      <Section h="Responsible bankroll considerations">
        <P>Because parlays are high-variance and usually carry a bigger house edge, most disciplined bettors treat them as small-stake, lottery-style bets &mdash; if they play them at all &mdash; never as a core strategy. Keep any parlay stake to a fraction of a normal bet, and never increase size to chase a loss. Sound <a href="/bankroll-management">bankroll management</a> matters even more here than on straight bets.</P>
        <P>Parlays do not create an edge, guarantee a payout, or reduce risk &mdash; the larger number simply reflects longer odds. Bet only what you can afford to lose; if gambling stops being fun or becomes a problem, call <b>1-800-GAMBLER</b> or visit ncpgambling.org. For how WizePicks approaches finding value, see <a href="/how-it-works">how WizePicks works</a>.</P>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What is a parlay in betting?</H3>
        <P>A parlay is a single bet that combines two or more picks (legs). It pays more than the individual bets, but every leg must win &mdash; one loss and the whole bet loses.</P>

        <H3>How are parlay odds calculated?</H3>
        <P>Convert each leg to decimal odds and multiply them together. For example, two -110 legs (about 1.91 each) combine to roughly 3.64, or about +264 in American odds.</P>

        <H3>What happens if one leg of a parlay pushes?</H3>
        <P>A push or void is usually removed and the parlay reduces to the remaining legs (a three-leg with one push pays as a two-leg). Exact rules vary by sportsbook, so check your book.</P>

        <H3>Are parlays a good bet?</H3>
        <P>They are higher-variance and usually carry a larger house edge than straight bets, so they are generally negative-EV. The bigger payout reflects longer odds, not better value.</P>

        <H3>Does a big parlay payout mean it&rsquo;s a good value?</H3>
        <P>No. A large payout means long odds and a low chance of winning. Parlays do not create an edge; the size of the number is not a sign of value.</P>
      </Section>

      <PageNav
        links={[
          { to: "/how-to-read-moneyline-odds", label: "How to read moneyline odds" },
          { to: "/how-point-spreads-work", label: "How point spreads work" },
          { to: "/over-under-betting", label: "Over/under betting" },
          { to: "/implied-probability-sports-betting", label: "Implied probability" },
          { to: "/expected-value-betting", label: "Expected value (EV)" },
          { to: "/bankroll-management", label: "Bankroll management" },
          { to: "/how-it-works", label: "How WizePicks works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
