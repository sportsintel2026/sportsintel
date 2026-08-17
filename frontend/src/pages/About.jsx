// WZ-SEO-TRUSTPAGES-2026-08-17 :: /about — public trust / E-E-A-T page.
// Copy is truthful and owner-approved: brand-level (no personal name), 20+ years of
// personal sports-betting experience only (no professional credentials), graded results
// available to members after signup (not to anonymous visitors), support email as published.
import { useSeo } from "../hooks/useSeo";
import PageShell, { Section, P, PageNav } from "./PageShell";

export default function AboutPage() {
  useSeo({
    title: "About WizePicks — Sharp Sports-Betting Analytics",
    description: "WizePicks is a sports-betting analytics and information service (not a sportsbook) for adults 21+, with model-driven edges and tools across MLB, NFL, CFB, NBA, NHL, and UFC.",
    path: "/about",
  });
  return (
    <PageShell
      title="About WizePicks"
      lead={<>WizePicks is a sports-betting analytics and information service &mdash; not a sportsbook. We turn the kind of data the books use into a clear, honest read on every game, so you can make sharper decisions for yourself.</>}
    >
      <Section h="What WizePicks is">
        <P>WizePicks is an <b>analytics and information service</b> for adults 21 and older. We publish model-driven win probabilities, edges, handpicked plays, and research tools across <b>MLB, NFL, College Football, NBA, NHL, and UFC</b>.</P>
        <P>We are <b>not a sportsbook</b>. We do not take bets, hold or move funds, or pay out winnings. Any wager you place is your own decision, made through third parties at your own discretion and risk.</P>
      </Section>

      <Section h="Built by bettors, for bettors">
        <P>WizePicks was built by someone with <b>more than 20 years of personal sports-betting experience</b>. That experience taught us the one thing the touts will never admit: <b>no pick is ever guaranteed.</b> So instead of selling certainty that doesn&rsquo;t exist, WizePicks gives you the model&rsquo;s number, our handpicked plays, and the raw tools to check the work yourself.</P>
      </Section>

      <Section h="Honest by design">
        <P>We don&rsquo;t hide behind hype. Every pick is <b>recorded and graded</b> so performance can be reviewed rather than cherry-picked. Detailed graded results are available to members inside the app after you <a href="/signup">sign up</a>. Past performance does not guarantee future results, and we say so plainly.</P>
      </Section>

      <Section h="Play responsibly">
        <P>WizePicks is for adults <b>21+</b>. Betting carries real financial risk &mdash; only wager what you can afford to lose. If gambling is a problem for you or someone you know, call <b>1-800-GAMBLER</b> or visit ncpgambling.org.</P>
      </Section>

      <Section h="Contact">
        <P>Questions or support? Email us at <a href="mailto:wizepickshelp@gmail.com">wizepickshelp@gmail.com</a>.</P>
      </Section>

      <PageNav
        links={[
          { to: "/how-it-works", label: "How it works" },
          { to: "/pricing", label: "Pricing" },
          { to: "/signup", label: "Start free" },
        ]}
      />
    </PageShell>
  );
}
