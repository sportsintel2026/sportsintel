// WZ-SEO-ODDSFORMATS-ARTICLE-2026-08-17 :: /odds-formats-explained -- public educational page.
// Owns the odds-formats topic (American / decimal / fractional) and their conversions; links out to the
// moneyline article for American depth and to implied-probability for the probability math, rather than
// duplicating them. Factual only; example odds are standard illustrative math, not WizePicks results.
// No proprietary logic. No fabricated claims. FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function OddsFormatsPage() {
  useSeo({
    title: "American vs. Decimal vs. Fractional Odds Explained — WizePicks",
    description: "Betting odds formats explained: American, decimal, and fractional odds, how to convert between them with worked examples, how each shows implied probability, and which format is used where.",
    path: "/odds-formats-explained",
  });
  return (
    <PageShell
      title="American vs. Decimal vs. Fractional Odds Explained"
      lead={<>American, decimal, and fractional are just three ways of writing the <b>same price</b>. A bet doesn&rsquo;t change when the notation does &mdash; +150, 2.50, and 3/2 all mean exactly the same thing. This guide shows what each format means, how to convert between them, and how each one reveals the implied probability underneath.</>}
    >
      <Section h="The three main odds formats">
        <P>Sportsbooks quote the same bet in different notations depending on where you are:</P>
        <ul className="pg-ul">
          <LI><b>American</b> (moneyline) &mdash; a + or - number, common in the United States.</LI>
          <LI><b>Decimal</b> &mdash; a single number like 2.50, common in Europe, Australia, and Canada.</LI>
          <LI><b>Fractional</b> &mdash; a fraction like 3/2, traditional in the UK and Ireland.</LI>
        </ul>
        <P>None is more &ldquo;accurate&rdquo; than another. They are three languages for one number, and most sportsbooks let you switch the display between them.</P>
      </Section>

      <Section h="American (moneyline) odds">
        <P><b>American</b> odds use a + for underdogs and a - for favorites. A positive number is the profit on a $100 bet (+150 wins $150); a negative number is what you risk to win $100 (-150 risks $150 to win $100). For a full walkthrough, see <a href="/how-to-read-moneyline-odds">how to read moneyline odds</a>.</P>
      </Section>

      <Section h="Decimal odds">
        <P><b>Decimal</b> odds show your <b>total return per unit staked</b>, including your stake. At 2.50, a $100 bet returns $250 total ($150 profit + $100 stake). The formula is simple: <b>total return = stake &times; decimal odds</b>. Decimal is the easiest format for quick payout math, which is why calculators and models tend to use it.</P>
      </Section>

      <Section h="Fractional odds">
        <P><b>Fractional</b> odds show <b>profit relative to stake</b>. 3/2 means you win $3 for every $2 staked; 1/2 (&ldquo;two-to-one on&rdquo;) means $1 profit for every $2 staked. &ldquo;Evens&rdquo; or 1/1 is an even-money bet. Fractional is common in horse racing and traditional UK betting.</P>
      </Section>

      <Section h="How to convert between the formats">
        <H3>American to decimal</H3>
        <ul className="pg-ul">
          <LI><b>Positive:</b> decimal = (odds &divide; 100) + 1. +150 &rarr; 2.50.</LI>
          <LI><b>Negative:</b> decimal = (100 &divide; |odds|) + 1. -150 &rarr; about 1.67.</LI>
        </ul>
        <H3>Decimal to American</H3>
        <ul className="pg-ul">
          <LI><b>Decimal 2.00 or higher:</b> American = (decimal &minus; 1) &times; 100. 2.50 &rarr; +150.</LI>
          <LI><b>Decimal below 2.00:</b> American = &minus;100 &divide; (decimal &minus; 1). 1.67 &rarr; about -150.</LI>
        </ul>
        <H3>Fractional and decimal</H3>
        <ul className="pg-ul">
          <LI><b>Fractional to decimal:</b> decimal = (numerator &divide; denominator) + 1. 3/2 &rarr; 2.50.</LI>
          <LI><b>Decimal to fractional:</b> the fraction is (decimal &minus; 1). 2.50 &rarr; 1.5 = 3/2.</LI>
        </ul>
      </Section>

      <Section h="Worked conversion examples">
        <ul className="pg-ul">
          <LI><b>+150</b> = <b>2.50</b> decimal = <b>3/2</b> fractional.</LI>
          <LI><b>-150</b> = about <b>1.67</b> decimal = <b>2/3</b> fractional.</LI>
          <LI><b>+100</b> (even money) = <b>2.00</b> decimal = <b>1/1</b> fractional.</LI>
          <LI><b>-110</b> = about <b>1.91</b> decimal = roughly <b>10/11</b> fractional.</LI>
        </ul>
        <P>Every row is the same bet three ways. If you can move between them, no sportsbook&rsquo;s display can confuse you.</P>
      </Section>

      <Section h="How each format shows implied probability">
        <P>Every price implies a break-even win rate. Decimal makes it the easiest to see: <b>implied probability = 1 &divide; decimal odds</b>. So 2.50 implies 1 &divide; 2.50 = <b>40%</b>, and 1.67 implies about <b>60%</b>. The American and fractional versions of those prices imply the exact same percentages &mdash; they have to, because they are the same odds. For the full math, see <a href="/implied-probability-sports-betting">implied probability</a>.</P>
      </Section>

      <Section h="Which format is used where">
        <ul className="pg-ul">
          <LI><b>United States:</b> American (moneyline) odds.</LI>
          <LI><b>Europe, Australia, Canada:</b> decimal odds.</LI>
          <LI><b>UK and Ireland:</b> fractional odds, especially in horse racing.</LI>
        </ul>
        <P>Many books let you pick the display, so the format you see is a setting, not a different bet.</P>
      </Section>

      <Section h="Which format is &ldquo;best&rdquo;?">
        <P>None &mdash; they price a bet identically. That said, <b>decimal</b> is usually the most convenient for math: payouts (stake &times; decimal) and implied probability (1 &divide; decimal) both fall out in one step. Use whichever format you read most fluently; just know how to convert so a different notation never trips you up.</P>
      </Section>

      <Section h="Common mistakes and confusions">
        <ul className="pg-ul">
          <LI><b>Thinking decimal excludes your stake.</b> It includes it &mdash; 2.50 is a $250 return on $100, not $250 profit.</LI>
          <LI><b>Reading a + number as a percentage.</b> +150 is $150 profit per $100, not 150%.</LI>
          <LI><b>Assuming a &ldquo;bigger&rdquo; number is better across formats.</b> Compare like-for-like &mdash; convert first.</LI>
          <LI><b>Forgetting the vig.</b> Whatever the format, an even-looking price still carries the book&rsquo;s margin.</LI>
        </ul>
      </Section>

      <Section h="Frequently asked questions">
        <H3>What is the difference between American, decimal, and fractional odds?</H3>
        <P>They are three notations for the same price. American uses + / - numbers, decimal shows total return per unit, and fractional shows profit relative to stake. +150, 2.50, and 3/2 are identical.</P>

        <H3>How do I convert American odds to decimal?</H3>
        <P>For positive odds, decimal = (odds &divide; 100) + 1 (so +150 &rarr; 2.50). For negative odds, decimal = (100 &divide; |odds|) + 1 (so -150 &rarr; about 1.67).</P>

        <H3>Does decimal odds include my stake?</H3>
        <P>Yes. Decimal odds show your total return including the stake. At 2.50, a $100 bet returns $250 total, which is $150 profit plus your $100 back.</P>

        <H3>How do I get implied probability from odds?</H3>
        <P>The quickest way is from decimal: implied probability = 1 &divide; decimal odds. So 2.00 is 50%, 2.50 is 40%, and 1.67 is about 60%.</P>

        <H3>Which odds format is best?</H3>
        <P>None is more accurate &mdash; they price a bet the same. Decimal is usually the most convenient for calculating payouts and implied probability. Use whichever you read most easily.</P>
      </Section>

      <PageNav
        links={[
          { to: "/how-to-read-moneyline-odds", label: "How to read moneyline odds" },
          { to: "/implied-probability-sports-betting", label: "Implied probability" },
          { to: "/expected-value-betting", label: "Expected value (EV)" },
          { to: "/what-is-a-parlay", label: "What is a parlay?" },
          { to: "/how-it-works", label: "How WizePicks works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
