// LEGAL-PAGES-2026-06-24 — Terms of Service + Privacy Policy.
// TEMPLATE ONLY — not legal advice. Have a licensed attorney review before relying on these.
// Bracketed [PLACEHOLDERS] must be filled in by WizePicks.
// LEGAL-FILL-COMPLETE-2026-06-24
import { useNavigate } from "react-router-dom";

const UPDATED = "June 24, 2026";

function LegalShell({ title, intro, children }) {
  const navigate = useNavigate();
  return (
    <div className="lg-root">
      <style>{LG_CSS}</style>
      <div className="lg-wrap">
        <div className="lg-top">
          <div className="lg-brand" onClick={() => navigate("/")}>Wize<span>Picks</span></div>
          <button className="lg-back" onClick={() => navigate(-1)}>← Back</button>
        </div>
        <h1 className="lg-h1">{title}</h1>
        <div className="lg-upd">Last updated: {UPDATED}</div>
        {intro && <p className="lg-p lg-intro">{intro}</p>}
        {children}
        <div className="lg-foot"><span>21+</span><i/><span>Gamble Responsibly</span><i/><span>1-800-GAMBLER</span><i/><span>ncpgambling.org</span></div>
      </div>
    </div>
  );
}

function Sec({ n, h, children }) {
  return (
    <section className="lg-sec">
      <h2 className="lg-h2"><span className="lg-n">{n}.</span>{h}</h2>
      {children}
    </section>
  );
}
const P = ({ children }) => <p className="lg-p">{children}</p>;
const LI = ({ children }) => <li className="lg-li">{children}</li>;

export function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={<>These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of WizePicks (&ldquo;WizePicks,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), including the website at wizepicks.com and any related services (the &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to these Terms. If you do not agree, do not use the Service.</>}
    >
      <Sec n={1} h="Eligibility">
        <P>You must be at least <b>21 years of age</b> (or the minimum legal age in your jurisdiction, whichever is higher) and located in a jurisdiction where use of the Service is lawful. By using the Service, you represent and warrant that you meet these requirements. We may restrict or terminate access where use is prohibited.</P>
      </Sec>

      <Sec n={2} h="What WizePicks Is — and Is Not">
        <P>WizePicks is an <b>analytics and information service</b>. We provide statistical models, projections, edges, and related data about sporting events for informational and entertainment purposes only.</P>
        <P>WizePicks is <b>not a sportsbook, betting operator, broker, or gambling service</b>. We do not accept, place, broker, or facilitate wagers; we do not hold, transmit, or manage betting funds; and we do not pay out winnings. Any betting decisions you make are your own and are conducted entirely through third parties at your own discretion and risk.</P>
      </Sec>

      <Sec n={3} h="No Guarantees; Assumption of Risk">
        <P>The Service does not guarantee any outcome, profit, or result. Sports outcomes are inherently uncertain. <b>Past performance does not guarantee future results.</b> All projections, edges, and picks are probabilistic estimates that may be wrong.</P>
        <P>You acknowledge that any betting or wagering carries a substantial risk of financial loss, that you alone are responsible for your decisions, and that you should only risk what you can afford to lose. If you or someone you know has a gambling problem, call <b>1-800-GAMBLER</b> or visit ncpgambling.org.</P>
      </Sec>

      <Sec n={4} h="Not Professional Advice">
        <P>Nothing on the Service constitutes financial, investment, legal, tax, or other professional advice. The Service is not a recommendation to place any specific wager. You should make your own independent judgment.</P>
      </Sec>

      <Sec n={5} h="Accounts">
        <P>You are responsible for the information you provide, for maintaining the confidentiality of your account credentials, and for all activity under your account. You agree to provide accurate information and to keep it current. Notify us promptly of any unauthorized use.</P>
      </Sec>

      <Sec n={6} h="Subscriptions, Billing &amp; Cancellation">
        <P>Certain features require a paid subscription. Subscription prices and billing intervals are shown at the point of purchase (currently $7/week, $25/month, or $199/year). Payments are processed by our third-party processor, Stripe; we do not store full payment-card details.</P>
        <P>Unless otherwise stated, subscriptions <b>renew automatically</b> at the end of each billing period until cancelled. You may cancel at any time through your account settings or by contacting us; cancellation takes effect at the end of the current billing period. <b>All sales are final.</b> Cancelling stops future billing, but amounts already charged are non-refundable except where a refund is required by applicable law.</P>
      </Sec>

      <Sec n={7} h="Acceptable Use">
        <P>You agree not to:</P>
        <ul className="lg-ul">
          <LI>scrape, crawl, harvest, or systematically extract data from the Service;</LI>
          <LI>resell, redistribute, sublicense, or publicly republish picks, data, or content from the Service;</LI>
          <LI>reverse engineer, copy, or create derivative works of the Service or its models;</LI>
          <LI>share account access with others or circumvent access or payment controls;</LI>
          <LI>use the Service for any unlawful purpose or in any jurisdiction where it is prohibited; or</LI>
          <LI>interfere with, overload, or disrupt the Service or its infrastructure.</LI>
        </ul>
      </Sec>

      <Sec n={8} h="Intellectual Property">
        <P>The Service, including its models, content, design, and trademarks, is owned by WizePicks or its licensors and is protected by law. We grant you a limited, personal, non-transferable, revocable license to access the Service for your own personal, non-commercial use, subject to these Terms.</P>
      </Sec>

      <Sec n={9} h="Third-Party Services &amp; Data">
        <P>The Service relies on third-party providers (including payment, hosting, authentication, and sports-data providers) and may link to third-party sites. We do not control and are not responsible for third-party services, their accuracy, or their availability. Sports data may contain errors or delays.</P>
      </Sec>

      <Sec n={10} h="Disclaimer of Warranties">
        <P>THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR ACCURATE.</P>
      </Sec>

      <Sec n={11} h="Limitation of Liability">
        <P>TO THE MAXIMUM EXTENT PERMITTED BY LAW, WIZEPICKS AND ITS OPERATORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY GAMBLING OR BETTING LOSSES, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</P>
      </Sec>

      <Sec n={12} h="Indemnification">
        <P>You agree to indemnify and hold harmless WizePicks and its operators from any claims, losses, or expenses arising out of your use of the Service, your betting activity, or your violation of these Terms or applicable law.</P>
      </Sec>

      <Sec n={13} h="Termination">
        <P>We may suspend or terminate your access at any time, with or without notice, for any reason, including violation of these Terms. You may stop using the Service at any time. Sections that by their nature should survive termination will survive.</P>
      </Sec>

      <Sec n={14} h="Changes to These Terms">
        <P>We may update these Terms from time to time. Material changes will be indicated by updating the &ldquo;Last updated&rdquo; date. Your continued use after changes take effect constitutes acceptance.</P>
      </Sec>

      <Sec n={15} h="Governing Law">
        <P>These Terms are governed by the laws of the State of Nevada, without regard to conflict-of-laws rules.</P>
      </Sec>

      <Sec n={16} h="Contact">
        <P>Questions about these Terms: wizepickshelp@gmail.com.</P>
      </Sec>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={<>This Privacy Policy explains how WizePicks collects, uses, and shares information when you use wizepicks.com and related services (the &ldquo;Service&rdquo;).</>}
    >
      <Sec n={1} h="Information We Collect">
        <P>We collect:</P>
        <ul className="lg-ul">
          <LI><b>Account information</b> you provide — your name, email address, and password (passwords are stored in hashed form by our authentication provider).</LI>
          <LI><b>Age &amp; agreement records</b> — confirmation that you affirmed you are 21+ and accepted these terms, with a timestamp.</LI>
          <LI><b>Payment information</b> — handled by our payment processor, Stripe. We receive limited billing details and subscription status; <b>we do not store full payment-card numbers.</b></LI>
          <LI><b>Usage data</b> — basic technical and usage information (e.g., pages viewed, device/browser type, approximate region) used to operate and improve the Service.</LI>
          <LI><b>Local storage / cookies</b> — small data stored in your browser (e.g., your age-gate confirmation and login session).</LI>
        </ul>
      </Sec>

      <Sec n={2} h="How We Use Information">
        <P>We use information to provide and operate the Service; create and manage your account; process subscriptions and payments; verify eligibility (age and location); maintain security and prevent abuse; communicate with you about your account or the Service; and analyze and improve our models and product.</P>
      </Sec>

      <Sec n={3} h="How We Share Information">
        <P>We share information only as needed to run the Service:</P>
        <ul className="lg-ul">
          <LI><b>Service providers</b> — including our authentication/database provider (Supabase), payment processor (Stripe), and hosting/infrastructure providers, who process data on our behalf.</LI>
          <LI><b>Legal &amp; safety</b> — where required by law, to enforce our Terms, or to protect rights and safety.</LI>
          <LI><b>Business transfers</b> — in connection with a merger, acquisition, or sale of assets.</LI>
        </ul>
        <P>We <b>do not sell your personal information.</b></P>
      </Sec>

      <Sec n={4} h="Cookies &amp; Local Storage">
        <P>We use cookies and browser local storage for essential functions such as keeping you logged in and remembering your age-gate confirmation. You can clear these through your browser, but some features may not work without them.</P>
      </Sec>

      <Sec n={5} h="Data Retention">
        <P>We retain account and transaction information for as long as your account is active and as needed to comply with legal, tax, and accounting obligations. You may request deletion of your account as described below.</P>
      </Sec>

      <Sec n={6} h="Security">
        <P>We use reasonable technical and organizational measures to protect information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.</P>
      </Sec>

      <Sec n={7} h="Your Rights">
        <P>Depending on where you live, you may have rights to access, correct, delete, or restrict use of your personal information, and to opt out of certain processing. To exercise these rights, contact us at wizepickshelp@gmail.com.</P>
      </Sec>

      <Sec n={8} h="Children &amp; Minors">
        <P>The Service is intended only for adults 21 and older. We do not knowingly collect personal information from minors. If we learn that we have collected information from someone under the required age, we will delete it.</P>
      </Sec>

      <Sec n={9} h="Third-Party Links">
        <P>The Service may link to third-party websites we do not control. Their privacy practices are governed by their own policies, not this one.</P>
      </Sec>

      <Sec n={10} h="Changes to This Policy">
        <P>We may update this Privacy Policy from time to time. Changes are indicated by updating the &ldquo;Last updated&rdquo; date above. Your continued use after changes take effect constitutes acceptance.</P>
      </Sec>

      <Sec n={11} h="Contact">
        <P>Questions about privacy or your data: wizepickshelp@gmail.com.</P>
      </Sec>
    </LegalShell>
  );
}

const LG_CSS = `
.lg-root{min-height:100vh;background:#0A0B0D;color:#cfd7e1;font-family:Inter,system-ui,-apple-system,sans-serif;padding:0 0 80px}
.lg-wrap{max-width:760px;margin:0 auto;padding:22px 20px 40px}
.lg-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
.lg-brand{font-family:Georgia,"Times New Roman",serif;font-size:23px;font-weight:700;color:#fff;letter-spacing:-.5px;cursor:pointer}
.lg-brand span{color:#C9A86A}
.lg-back{appearance:none;background:transparent;border:1px solid #2a2f37;color:#9aa3ad;font-family:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:9px;cursor:pointer}
.lg-back:active{opacity:.7}
.lg-h1{font-family:"Barlow Condensed",Inter,sans-serif;font-size:34px;font-weight:800;color:#fff;letter-spacing:.3px;margin:0 0 4px}
.lg-upd{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;color:#6b7480;margin-bottom:18px}
.lg-tmpl{background:rgba(201,168,106,.08);border:1px solid rgba(201,168,106,.28);border-radius:11px;padding:12px 14px;font-size:12.5px;line-height:1.5;color:#c9b894;margin-bottom:22px}
.lg-tmpl b{color:#C9A86A}
.lg-intro{color:#aeb8c2;margin-bottom:10px}
.lg-sec{margin-top:24px}
.lg-h2{font-size:16px;font-weight:800;color:#fff;margin:0 0 8px;display:flex;gap:8px;align-items:baseline}
.lg-n{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;color:#C9A86A;font-weight:600;flex:0 0 auto}
.lg-p{font-size:13.5px;line-height:1.62;color:#aeb8c2;margin:0 0 10px}
.lg-p b{color:#e3e9ef;font-weight:700}
.lg-ul{margin:0 0 10px;padding-left:20px}
.lg-li{font-size:13.5px;line-height:1.6;color:#aeb8c2;margin-bottom:5px}
.lg-li b{color:#e3e9ef;font-weight:700}
.lg-foot{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:9px;margin-top:36px;padding-top:18px;border-top:1px solid #1b1f25;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;font-weight:600;letter-spacing:.4px;color:#C9A86A}
.lg-foot i{width:3px;height:3px;border-radius:50%;background:#3a414a;display:inline-block}
`;
