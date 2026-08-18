// WZ-SEO-EV-ARTICLE-2026-08-17 :: /expected-value-betting -- public educational page.
// The DEEPER companion to the implied-probability article: implied probability converts odds to a
// percentage; this page uses a probability estimate + the price to compute expected value over repeated
// bets. Factual only; example odds/probabilities are standard illustrative math, not WizePicks results;
// no picks, recommendations, or guaranteed-profit/risk-free claims; no proprietary logic. FAQ is plain
// on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function ExpectedValuePage() {
  useSeo({
    title: "Expected Value (EV) in Sports Betting — WizePicks",
    description: "Expected value (EV) betting explained: what +EV and -EV mean, the EV formula, worked examples with real odds, why a +EV bet can still lose, EV vs implied probability and closing line value, and why EV matters over a large sample.",
    path: "/expected-value-betting",
  });
  return (
    <PageShell
      title="Expected Value (EV) in Sports Betting"
      lead={<>Expected value, or EV, is the number that separates a good bet from a bad one. It combines two things you already know how to find &mdash; a <b>probability</b> and a <b>price</b> &mdash; into a single estimate of what a bet is worth if you could make it over and over. This is the deeper companion to <a href="/implied-probability-sports-betting">implied probability</a>: that page turns odds into a percentage; this one uses a percentage and a price to judge the bet.</>}
    >
      <Section h="What expected value means">
        <P><b>Expected value</b> is the average result of a bet if you could repeat it many times over. A bet with positive EV would, on average, make money across a large sample; a bet with negative EV would lose. It says nothing about any single game &mdash; only about the long-run average of decisions like it.</P>
        <P>EV needs two inputs: your estimate of the <b>true probability</b> of the outcome, and the <b>price</b> (the odds) you can bet it at. Neither alone is enough &mdash; a great probability at a terrible price is a bad bet, and vice versa.</P>
      </Section>

      <Section h="+EV vs. -EV">
        <ul className="pg-ul">
          <LI><b>+EV (positive expected value):</b> your estimated chance of winning is <b>higher</b> than the price&rsquo;s break-even rate. The bet is priced generously relative to your read.</LI>
          <LI><b>-EV (negative expected value):</b> your estimated chance is <b>lower</b> than the break-even rate. You are being charged more than the outcome is worth.</LI>
        </ul>
        <P>&ldquo;+EV betting&rdquo; simply means consistently taking bets where your probability beats the price. It is the goal of analytical betting &mdash; but, as below, it is a long-run target, never a guarantee on any one bet.</P>
      </Section>

      <Section h="How probability and odds combine into EV">
        <P>Every price has a <b>break-even probability</b> &mdash; the win rate you&rsquo;d need just to come out even at that price. That break-even number is the same as the price&rsquo;s <a href="/implied-probability-sports-betting">implied probability</a>. EV compares <b>your</b> estimated probability to that break-even:</P>
        <ul className="pg-ul">
          <LI>If your estimate is <b>above</b> break-even &rarr; <b>+EV</b>.</LI>
          <LI>If your estimate is <b>below</b> break-even &rarr; <b>-EV</b>.</LI>
        </ul>
        <P>So EV is really one question: is the price paying you more than the outcome&rsquo;s true odds deserve?</P>
      </Section>

      <Section h="The expected-value formula">
        <P>For a flat one-unit bet, with <b>p</b> = your estimated win probability (as a decimal) and <b>b</b> = the net profit per unit if you win:</P>
        <ul className="pg-ul">
          <LI><b>EV = (p &times; b) &minus; (1 &minus; p)</b></LI>
        </ul>
        <P>To get <b>b</b> from American odds: positive odds &rarr; b = odds &divide; 100 (so +150 &rarr; b = 1.5); negative odds &rarr; b = 100 &divide; |odds| (so -150 &rarr; b = 0.667). A positive result is your expected profit per unit staked; a negative result is your expected loss.</P>
      </Section>

      <Section h="Worked examples with real odds">
        <H3>A +EV underdog</H3>
        <P>Odds <b>+150</b> (b = 1.5). You estimate the true win chance at <b>45%</b> (p = 0.45). Break-even at +150 is 40%, so 45% clears it. EV = (0.45 &times; 1.5) &minus; 0.55 = 0.675 &minus; 0.55 = <b>+0.125</b>, or <b>+12.5% per unit</b>. Positive EV.</P>
        <H3>A -EV favorite</H3>
        <P>Odds <b>-150</b> (b = 0.667). You estimate <b>55%</b> (p = 0.55), but break-even at -150 is 60%. EV = (0.55 &times; 0.667) &minus; 0.45 = 0.367 &minus; 0.45 = <b>&minus;0.083</b>, or <b>&minus;8.3% per unit</b>. Negative EV &mdash; a likely winner at a bad price.</P>
        <H3>A near-even bet</H3>
        <P>Odds <b>+100</b> (b = 1). You estimate <b>52%</b> (p = 0.52). EV = (0.52 &times; 1) &minus; 0.48 = <b>+0.04</b>, or <b>+4% per unit</b>. A small but positive edge.</P>
      </Section>

      <Section h="Why a +EV bet can still lose">
        <P>EV is an average, not a promise. In the +150 example, you still expect to <b>lose 55% of the time</b> &mdash; the edge comes from being paid 1.5 units on the wins. Any individual +EV bet can, and often will, lose. That is completely normal and does not mean the bet was wrong.</P>
      </Section>

      <Section h="Why a -EV bet can still win">
        <P>Just as often, a bad bet wins. The -150 favorite above is a likely winner &mdash; it should win about 55% of the time by your own estimate &mdash; it is simply priced too high to be profitable long-term. Winning a -EV bet feels good and proves nothing; the price was still wrong.</P>
        <P>This is why results over a handful of bets say little about skill. A -EV bettor can win for a while, and a +EV bettor can lose for a while.</P>
      </Section>

      <Section h="Expected value vs. implied probability">
        <P>They are related but not the same. <b>Implied probability</b> is a property of the <b>price</b> alone &mdash; the break-even rate baked into the odds. <b>Expected value</b> brings in <b>your</b> probability estimate and asks whether it beats that break-even. Implied probability tells you the bar; EV tells you whether you clear it. For the conversion itself, see <a href="/implied-probability-sports-betting">implied probability</a>.</P>
      </Section>

      <Section h="Expected value vs. closing line value (CLV)">
        <P>Both point at good process, but they measure it differently. <b>EV</b> depends on <b>your</b> estimate of the true probability &mdash; useful, but only as reliable as that estimate. <a href="/what-is-closing-line-value">Closing line value</a> sidesteps the estimate entirely: it compares the price you got to where the market closed, so it can be tracked over a smaller sample without needing to know the true probability. In practice, EV is the theory of why a bet is good; CLV is a measurable, market-based check that you are finding good prices.</P>
      </Section>

      <Section h="Why EV matters over a large sample, not one bet">
        <P>Expected value is a long-run concept. Over a handful of bets, luck dominates and a +EV strategy can be underwater. Over hundreds or thousands, results converge toward the underlying EV. That is why disciplined bettors judge themselves on process across a big sample &mdash; not on last night&rsquo;s ticket.</P>
      </Section>

      <Section h="Common mistakes when evaluating EV">
        <ul className="pg-ul">
          <LI><b>Treating a likely winner as +EV.</b> A heavy favorite can be a bad bet if the price is worse than its true chance.</LI>
          <LI><b>Ignoring the price.</b> Being right about who wins is worthless if you overpay for it.</LI>
          <LI><b>Judging EV by one result.</b> A +EV bet can lose and a -EV bet can win; neither changes whether the bet was good.</LI>
          <LI><b>Forgetting the vig.</b> The break-even rate is above 50% on even-looking prices (about 52.4% at -110).</LI>
          <LI><b>Confusing +EV with a guarantee.</b> Positive EV improves your long-run average; it never makes a single bet safe.</LI>
        </ul>
      </Section>

      <Section h="The catch: EV is only as good as your probability estimate">
        <P>Here is the honest limit. The formula is exact, but it runs on <b>your</b> estimate of the true probability &mdash; and nobody knows the true probability for certain. If your estimate is too high, a bet the math calls &ldquo;+EV&rdquo; can be <b>negative</b> in reality. The math doesn&rsquo;t protect you from a wrong input.</P>
        <P>That is why serious bettors pair EV thinking with humility and with measurable checks like <a href="/what-is-closing-line-value">closing line value</a>, and why WizePicks frames its numbers as estimates with no guarantees. There is no risk-free bet and no guaranteed profit &mdash; only better and worse decisions over a long sample. For how WizePicks estimates probabilities and prices them against the market, see <a href="/how-it-works">how WizePicks works</a>.</P>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What is +EV betting?</H3>
        <P>+EV (positive expected value) betting means taking bets where your estimated win probability is higher than the price&rsquo;s break-even rate. Over a large sample, +EV bets are expected to profit &mdash; though any single one can lose.</P>

        <H3>How do you calculate expected value on a bet?</H3>
        <P>Use EV = (p &times; b) &minus; (1 &minus; p), where p is your estimated win probability and b is the net profit per unit at the odds. For +150, b = 1.5; for -150, b = 0.667.</P>

        <H3>Can a +EV bet lose?</H3>
        <P>Yes, often. EV is a long-run average, not a guarantee. A +150 bet you rate at 45% is +EV but still loses most of the time; the edge comes from the payout on the wins.</P>

        <H3>Is expected value the same as implied probability?</H3>
        <P>No. Implied probability is the break-even rate built into the price. Expected value compares your own probability estimate to that break-even to decide whether the bet is worth it.</P>

        <H3>Does +EV guarantee I&rsquo;ll make money?</H3>
        <P>No. Positive EV improves your long-run average, but it depends on your probability estimate being right, and it never removes risk on any single bet. There is no guaranteed or risk-free betting.</P>
      </Section>

      <PageNav
        links={[
          { to: "/implied-probability-sports-betting", label: "Implied probability" },
          { to: "/what-is-closing-line-value", label: "What is closing line value?" },
          { to: "/how-to-read-moneyline-odds", label: "How to read moneyline odds" },
          { to: "/how-point-spreads-work", label: "How point spreads work" },
          { to: "/over-under-betting", label: "Over/under betting" },
          { to: "/how-it-works", label: "How WizePicks works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
