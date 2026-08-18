// WZ-SEO-TRUSTPAGES-2026-08-17 :: /how-it-works — public methodology / trust page.
// Describes the approach ONLY at the abstraction already published on the landing page
// (win probability -> vig-free fair price -> edge/value; three reads; graded honestly).
// No formulas, weights, feature engineering, private picks/edges, or paid data.
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, PageNav } from "./PageShell";

export default function HowItWorksPage() {
  useSeo({
    title: "How WizePicks Works — Model, Plays & Tools",
    description: "How WizePicks turns data into a vig-free fair price and surfaces only the bets with a real edge — the model's number, handpicked plays, and the tools to check the work yourself.",
    path: "/how-it-works",
  });
  return (
    <PageShell
      title="How WizePicks Works"
      lead={<>WizePicks reads every game like a sharp bettor would &mdash; a model number, a handpicked play, and the tools to check it &mdash; so the final call is always yours.</>}
    >
      <Section h="The model">
        <P>For each game, our model estimates a <b>win probability</b> for both sides from the fundamentals &mdash; matchups, team and player form, park and venue factors, weather, injuries, and line movement. It&rsquo;s not a hunch; it&rsquo;s a number.</P>
      </Section>

      <Section h="A fair price, and the edge">
        <P>Books build a margin &mdash; the &ldquo;vig&rdquo; &mdash; into their prices. WizePicks strips that margin out to estimate a <b>fair price</b> for each side, then compares our number against it. When our probability is higher than the fair price implies, that gap is the <b>edge</b> &mdash; and we flag the bets where the value is real, not the ones that merely look good.</P>
      </Section>

      <Section h="Three reads, one decision">
        <P>Every game gets three reads, side by side: the <b>model&rsquo;s number</b>, our conviction-rated <b>WizePlay</b> when we&rsquo;d back it ourselves, and the raw <b>tools</b> &mdash; splits, matchups, weather, line movement &mdash; to do your own due diligence. When all three line up, that&rsquo;s conviction. When your own read disagrees, trust it.</P>
      </Section>

      <Section h="Graded, not hyped">
        <P>Every pick is <b>recorded and graded</b>, so results can be reviewed instead of cherry-picked. Detailed graded results are available to members inside the app after you <a href="/signup">sign up</a>. No pick is guaranteed, and past performance never guarantees future results.</P>
      </Section>

      <Section h="Not a sportsbook">
        <P>WizePicks is an analytics and information service for adults <b>21+</b>. We don&rsquo;t take bets or hold funds &mdash; you bet where you choose, at your own discretion. Bet responsibly: <b>1-800-GAMBLER</b> &middot; ncpgambling.org.</P>
      </Section>

      <PageNav
        links={[
          { to: "/sports-betting-for-beginners", label: "Sports betting for beginners" },
          { to: "/what-is-closing-line-value", label: "What is closing line value?" },
          { to: "/expected-value-betting", label: "Expected value (EV)" },
          { to: "/bankroll-management", label: "Bankroll management" },
          { to: "/over-under-betting", label: "Over/under betting" },
          { to: "/what-is-a-parlay", label: "What is a parlay?" },
          { to: "/odds-formats-explained", label: "Odds formats explained" },
          { to: "/pricing", label: "See pricing" },
          { to: "/signup", label: "Start free" },
          { to: "/about", label: "About WizePicks" },
        ]}
      />
    </PageShell>
  );
}
