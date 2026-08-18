// WZ-SEO-BANKROLL-ARTICLE-2026-08-17 :: /bankroll-management -- public educational page.
// The money-management pillar, distinct from the odds/probability/edge articles. Factual only;
// example bankrolls/units are illustrative math, not WizePicks results. Explicit, repeated framing that
// bankroll management does NOT create an edge, guarantee winnings, make anyone profitable, or remove risk.
// No proprietary logic. FAQ is plain on-page content (no FAQPage schema).
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, LI, H3, PageNav } from "./PageShell";

export default function BankrollPage() {
  useSeo({
    title: "Sports Betting Bankroll Management & Unit Sizing — WizePicks",
    description: "Sports betting bankroll management and unit sizing explained: what a bankroll and a unit are, percentage-based sizing, flat vs variable staking, variance and drawdowns, and why bankroll management protects you but never creates an edge.",
    path: "/bankroll-management",
  });
  return (
    <PageShell
      title="Sports Betting Bankroll Management & Unit Sizing"
      lead={<>Bankroll management is how you decide <b>how much to bet</b> &mdash; and, just as importantly, how much <b>not</b> to bet. It won&rsquo;t make you a winner or create an edge; a losing approach stays a losing approach. What good bankroll management does is control risk, survive the swings, and keep you in the game long enough for any real edge to show. It is discipline, not a profit engine.</>}
    >
      <Section h="What a betting bankroll is">
        <P>A <b>bankroll</b> is money you have set aside specifically for betting &mdash; separate from rent, bills, and savings, and strictly an amount you can afford to lose. Treating it as a fixed, walled-off pool is the whole point: it caps your risk and lets you size bets sensibly against it.</P>
        <P>If losing your entire bankroll would affect your daily life, the bankroll is too big. Bet responsibly; this is entertainment and analysis, not income.</P>
      </Section>

      <Section h="What a betting unit is">
        <P>A <b>unit</b> is a standard bet size &mdash; a single, consistent amount you use as your baseline wager. Bettors talk in units (&ldquo;I&rsquo;m up 12 units&rdquo;) rather than dollars so that results and sizing make sense regardless of bankroll.</P>
        <P>A unit is usually a small <b>percentage of the bankroll</b>, most commonly <b>1&ndash;2%</b>. Keeping the unit small is what lets you absorb inevitable losing runs without going broke.</P>
      </Section>

      <Section h="How unit sizing works">
        <P>Instead of betting a random dollar amount each time, you bet in units. The simplest and most common approach is to make every bet the same size &mdash; one unit &mdash; so no single game can do outsized damage.</P>
        <P>Because a unit is defined as a share of the bankroll, your bet size naturally scales: as the bankroll grows or shrinks, one unit grows or shrinks with it (if you recalculate periodically), keeping your risk proportional.</P>
      </Section>

      <Section h="Percentage-based unit sizing">
        <P>The cleanest way to set a unit is as a fixed percentage of the bankroll:</P>
        <ul className="pg-ul">
          <LI><b>Conservative:</b> 1 unit = <b>1%</b> of bankroll.</LI>
          <LI><b>Moderate:</b> 1 unit = <b>2%</b> of bankroll.</LI>
          <LI><b>Aggressive (higher risk):</b> 1 unit = <b>3%+</b> &mdash; larger swings, deeper drawdowns.</LI>
        </ul>
        <P>Smaller percentages mean slower growth but far more resilience to losing streaks. Most disciplined bettors stay at or below 1&ndash;2% precisely because variance is brutal at higher sizes.</P>
      </Section>

      <Section h="Worked examples with realistic bankrolls">
        <H3>$1,000 bankroll at 1% per unit</H3>
        <P>One unit = <b>$10</b>. A rough 5-bet losing streak at one unit each costs <b>$50</b> &mdash; a <b>5%</b> drawdown. Uncomfortable, but easily survivable, and you can keep betting your normal size.</P>
        <H3>$500 bankroll at 2% per unit</H3>
        <P>One unit = <b>$10</b>. The same dollar bet, but now each loss is a bigger share of a smaller bankroll. A 10-bet losing streak costs <b>$100</b> &mdash; a <b>20%</b> drawdown. That is the trade-off of a larger unit percentage: more punch per bet, but the swings hurt more.</P>
      </Section>

      <Section h="Flat betting vs. variable sizing">
        <P><b>Flat betting</b> means the same one unit on every play. It is the simplest approach, has the lowest variance, and removes emotion from sizing &mdash; a strong default for most bettors.</P>
        <P><b>Variable sizing</b> means staking more on higher-confidence plays (say 1&ndash;3 units). It can grow a bankroll faster <b>if your probability estimates are genuinely better</b>, but it raises variance and punishes overconfidence: sizing up on a bet you have mis-estimated amplifies the mistake. Variable sizing only helps when your reads are truly sharper &mdash; it is not a shortcut to profit.</P>
      </Section>

      <Section h="Variance and losing streaks">
        <P>Even a genuinely good bettor loses often. Winning bets land somewhere near a coin flip after the vig, so long losing runs are normal, not a sign something is broken. A bettor who wins 55% of the time will still hit stretches of five, six, or more losses in a row.</P>
        <P>Small units exist for exactly this reason: they let you ride out variance without a single bad week ending your bankroll. Bankroll management doesn&rsquo;t reduce variance in outcomes &mdash; it limits the <b>damage</b> variance can do to your money.</P>
      </Section>

      <Section h="Bankroll drawdowns">
        <P>A <b>drawdown</b> is a peak-to-trough drop in your bankroll during a losing stretch. Drawdowns are unavoidable &mdash; every bettor has them. What you control is how deep they get, and unit size is the main lever: at 1% per unit, a painful streak dents you; at 5% per unit, the same streak can be catastrophic.</P>
        <P>Planning for drawdowns before they happen &mdash; by keeping units small &mdash; is what separates disciplined bettors from the ones who blow up.</P>
      </Section>

      <Section h="Why chasing losses by raising bet size is dangerous">
        <P>The most damaging habit in betting is <b>chasing</b> &mdash; increasing your bet size to &ldquo;win it all back&rdquo; after losses. Doubling up after each loss (a Martingale) feels logical but is how bankrolls die: a long enough losing streak, which will happen, wipes you out or hits the table limit before you recover.</P>
        <P>Chasing changes nothing about whether your bets are good; it only concentrates risk at the worst possible time. Stick to your unit size, especially when losing.</P>
      </Section>

      <Section h="Bankroll management and expected value">
        <P>This is the key point: bankroll management does <b>not</b> create an edge. It cannot turn a bad bet into a good one, and a bettor making <a href="/expected-value-betting">negative-EV</a> bets with flawless bankroll management still loses over time &mdash; just more slowly. Sizing controls <b>risk</b>; only finding value at the right price controls <b>edge</b>.</P>
        <P>Where bankroll management earns its keep is alongside a genuine edge: it keeps a <b>+EV</b> bettor solvent through the variance so the long-run edge has time to play out. The edge comes from the bets; bankroll management just keeps you at the table.</P>
      </Section>

      <Section h="Bankroll management and closing line value">
        <P>Bankroll management and <a href="/what-is-closing-line-value">closing line value</a> answer different questions. CLV is a signal about whether you are finding good <b>prices</b>; bankroll management is about how much to <b>risk</b> on them. One tells you if your process is sharp; the other keeps a run of bad luck from ending that process early. You want both &mdash; and neither, on its own, guarantees a profit.</P>
      </Section>

      <Section h="Common bankroll-management mistakes">
        <ul className="pg-ul">
          <LI><b>Units too large.</b> Betting 5&ndash;10% per play turns a normal losing streak into a wipeout.</LI>
          <LI><b>Chasing losses.</b> Raising bet size to get even is the fastest way to bust.</LI>
          <LI><b>No separate bankroll.</b> Betting with money you need for bills removes every safety margin.</LI>
          <LI><b>Emotional sizing.</b> Betting big when confident or tilted, small when scared, instead of a consistent plan.</LI>
          <LI><b>Assuming discipline equals profit.</b> Perfect sizing on losing bets still loses.</LI>
        </ul>
      </Section>

      <Section h="The honest limit: protection, not profit">
        <P>Bankroll management is <b>risk management</b> &mdash; nothing more. It does not create an edge, guarantee winnings, make anyone profitable, or eliminate risk. There is no bet sizing that turns a losing approach into a winning one, and no such thing as risk-free betting.</P>
        <P>Used well, it keeps you disciplined and solvent while you pursue value; used to chase losses, it accelerates the damage. Bet only what you can afford to lose, and if gambling stops being fun or becomes a problem, call <b>1-800-GAMBLER</b> or visit ncpgambling.org. For how WizePicks approaches finding value, see <a href="/how-it-works">how WizePicks works</a>.</P>
      </Section>

      <Section h="Frequently asked questions">
        <H3>How much should I bet per game?</H3>
        <P>A common, conservative guideline is 1&ndash;2% of your bankroll per bet (one unit). Smaller units survive losing streaks better; there is no size that guarantees profit.</P>

        <H3>What is a unit in sports betting?</H3>
        <P>A unit is your standard bet size, usually 1&ndash;2% of your bankroll. Bettors track results in units so sizing and records make sense regardless of bankroll size.</P>

        <H3>Does bankroll management make you profitable?</H3>
        <P>No. It manages risk and variance; it does not create an edge or guarantee winnings. A negative-EV bettor with perfect bankroll management still loses over time.</P>

        <H3>Is flat betting or variable sizing better?</H3>
        <P>Flat betting (one unit every play) is simplest and lowest-variance, and it&rsquo;s a strong default. Variable sizing can help only if your probability estimates are genuinely sharper; otherwise it just increases swings.</P>

        <H3>Why is chasing losses so dangerous?</H3>
        <P>Increasing your bet size after losses concentrates risk at the worst time. A long enough losing streak &mdash; which will happen &mdash; can wipe out the bankroll before you recover.</P>
      </Section>

      <PageNav
        links={[
          { to: "/expected-value-betting", label: "Expected value (EV)" },
          { to: "/what-is-closing-line-value", label: "What is closing line value?" },
          { to: "/implied-probability-sports-betting", label: "Implied probability" },
          { to: "/how-it-works", label: "How WizePicks works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
