import { containDialogFocus } from "./dialogFocus";
import React, { useEffect, useRef, useState } from "react";
import "./marketing.css";
import "./marketingPolish.css";
import { getPlanDetails } from "./billingLogic";
import {
  MessageCircle,
  BookOpenText,
  CalendarCheck2,
  UserRoundCheck,
  Store,
  BarChart3,
  Check,
  Utensils,
  BedDouble,
  Scissors,
  Stethoscope,
  Shirt,
  Home,
  Dumbbell,
  Copy,
} from "lucide-react";

const HERO_SCRIPT = [
  { from: "customer", text: "Hi! What does a cut and colour cost?" },
  { from: "ai", text: "In this example, a cut and colour is NGN 15,000. Would you like to request an appointment?" },
  { from: "customer", text: "Saturday morning, please." },
  { from: "ai", text: "You can send a request for your preferred time. The salon team will review availability and confirm it." },
];
function HeroChat() {
  return <div className="hero-product-preview"><div className="preview-window-bar"><span className="preview-window-dots" aria-hidden="true">•••</span><span>Customer experience</span><span className="badge badge--neutral">Illustration</span></div>
    <div className="hero-chat-card"><div className="hero-chat-header"><div className="hero-chat-header-left"><div className="hero-chat-avatar">B</div>
      <div><p className="hero-chat-name">Bloom & Co. Salon</p><p className="hero-chat-time">Example business · web chat</p></div></div></div>
      <div className="hero-chat-body">{HERO_SCRIPT.map((message, i) => <div key={i} className={`chat-bubble chat-bubble--${message.from}`}>{message.text}</div>)}</div>
      <div className="hero-preview-footer"><CalendarCheck2 size={16} /><span>Booking requests need staff confirmation</span></div>
    </div><p className="preview-caption">Illustrative conversation and prices. Your assistant uses your saved business information.</p>
  </div>;
}

function Nav({ onSignIn, onStartTrial }) {
  const [open, setOpen] = useState(false);
  const drawer = useRef(null);
  useEffect(() => {
    const node = drawer.current;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    const media = window.matchMedia("(min-width: 768px)");
    const resize = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", resize);
    const overflow = document.body.style.overflow;
    if (open) document.body.style.overflow = "hidden";
    return () => { media.removeEventListener("change", resize); document.body.style.overflow = overflow; };
  }, [open]);
  return <header className="nav"><div className="nav-inner container"><a className="brand" href="#top" aria-label="Ezeji Assistant home"><span className="dot-static" /><span className="brand-name">Ezeji Assistant</span></a>
    <nav className="nav-links" aria-label="Primary navigation"><a href="#product">Product</a><a href="#how">How it works</a><a href="#pricing">Pricing</a></nav>
    <div className="nav-actions"><button type="button" className="btn btn--ghost btn--nav-signin" onClick={onSignIn}>Sign in</button>
      <button type="button" className="btn btn--amber nav-trial" onClick={() => onStartTrial?.({ plan: "14-day trial", mode: "trial" })}>Start free trial</button>
      <button type="button" className="nav-hamburger" aria-label="Open navigation" aria-controls="marketing-navigation" aria-expanded={open} onClick={() => setOpen(true)}><span /><span /><span /></button></div></div>
    <dialog className="marketing-drawer navigation-drawer" ref={drawer} id="marketing-navigation" aria-label="Website navigation" aria-modal="true" onKeyDown={containDialogFocus} onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <div className="drawer-header"><span className="brand-name">Ezeji Assistant</span><button type="button" className="icon-btn" aria-label="Close navigation" onClick={() => setOpen(false)}>×</button></div>
      <nav className="nav-mobile-menu" aria-label="Mobile navigation">{[["product","Product"],["how","How it works"],["pricing","Pricing"]].map(([id,label]) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}</a>)}
        <button type="button" className="btn btn--outline" onClick={() => { setOpen(false); onSignIn?.(); }}>Sign in</button>
        <button type="button" className="btn btn--amber" onClick={() => { setOpen(false); onStartTrial?.({ plan: "14-day trial", mode: "trial" }); }}>Start free trial</button></nav>
    </dialog></header>;
}

function Hero({ onStartTrial }) {
  return (
    <section className="hero container">
      <div className="hero-copy">
        <p className="eyebrow">A little more room to run your business</p>
        <h1 className="display hero-title">Your customers have questions.<br /><em>You have a business to run.</em></h1>
        <p className="body-lg hero-sub">
          Configure your services, prices and opening hours so your assistant
          can answer common customer questions through supported channels.
          Appointment requests remain pending until your team confirms them.
        </p>
        <div className="hero-actions">
          <button className="btn btn--amber btn--lg" onClick={() => onStartTrial?.({ plan: "14-day trial", mode: "trial" })}>Start your free trial</button>
          <a className="btn btn--outline" href="#how">See how it works</a>
        </div>
        <p className="hero-note">14-day trial · No card required</p>
      </div>
      <HeroChat />
    </section>
  );
}

function IndustryStrip() {
  const industries = [
    { icon: Utensils, label: "Restaurants" },
    { icon: BedDouble, label: "Hotels" },
    { icon: Scissors, label: "Salons" },
    { icon: Stethoscope, label: "Clinics" },
    { icon: Shirt, label: "Laundries" },
    { icon: Home, label: "Real estate" },
    { icon: Dumbbell, label: "Gyms" },
  ];
  return (
    <section className="industry-strip">
      <div className="container">
        <p className="industry-strip-label">Built for the businesses people message after hours</p>
        <div className="industry-row">
          {industries.map(({ icon: Icon, label }) => (
            <div key={label} className="industry-item">
              <Icon className="industry-icon" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemSolution() {
  return <section id="product" className="container product-intro"><p className="eyebrow">One workspace. A clearer customer experience.</p>
    <div><h2 className="display section-title">Keep the answers close.<br />Keep your team in control.</h2>
      <p className="body-md">Ezeji brings your business information, customer conversations, and booking requests together. Configure what the assistant knows, review what customers ask, and let your staff confirm appointments.</p></div></section>;
}

function Features() {
  const items = [
    { icon: MessageCircle, title: "A helpful first conversation", body: "Answer common questions from saved business facts through your customer web chat, with WhatsApp available on eligible plans." },
    { icon: BookOpenText, title: "Your information, in one place", body: "Keep services, prices, FAQs, and opening hours up to date. The assistant reads your saved information." },
    { icon: CalendarCheck2, title: "Requests your team can review", body: "Customers request appointments. Staff review availability and save a confirmation before a booking is confirmed." },
    { icon: UserRoundCheck, title: "Know what needs attention", body: "Review escalated messages in your conversation inbox. Automated staff notification is not implied." },
    { icon: Store, title: "A workspace for your business", body: "Manage your business profile and eligible staff access from the same dashboard." },
    { icon: BarChart3, title: "Learn from customer activity", body: "Review logged conversations and plan-appropriate analytics to see which questions come up most." },
  ];
  return (
    <section className="container features-section">
      <div className="section-heading">
        <h2 className="display section-title">Built around the work you already do.</h2>
      </div>
      <div className="features-grid">
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="feature-card">
            <div className="feature-icon-wrap"><Icon className="feature-icon" /></div>
            <h3 className="feature-title">{title}</h3>
            <p className="feature-body">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Create your account", body: "Register your business and confirm your email address." },
    { n: "02", title: "Add the essentials", body: "Save your business details, services, prices, and actual opening hours." },
    { n: "03", title: "Try your assistant", body: "Review your plan's settings and test answers in the private preview." },
    { n: "04", title: "Share a channel", body: "Share your customer web chat link, or configure WhatsApp on an eligible plan." },
    { n: "05", title: "Stay in the loop", body: "Review saved conversations and confirm appointment requests with your team." },
  ];
  return (
    <section id="how" className="how-section">
      <div className="container">
        <h2 className="display section-title how-title">Set up once, in the order it actually happens.</h2>
        <div className="steps-grid">
          {steps.map((s) => (
            <div key={s.n}>
              <p className="step-number mono">{s.n}</p>
              <h3 className="step-title">{s.title}</h3>
              <p className="step-body">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing({ onStartTrial }) {
  const [yearly, setYearly] = useState(false);
  // NGN only, priced directly in Naira (no USD conversion) - this matches
  // reality: the connected Paystack account can only actually charge Naira,
  // and keeping the numbers fair and round (in the spirit of ChatGPT Plus's
  // pricing) matters more than deriving them from a dollar figure.
  // Yearly = 10x monthly, i.e. 2 months free.
  // Pricing amounts are sourced from the same shared catalog as checkout.
  const plans = [
    { name: "Free trial", free: true, features: ["100 conversations", "1 business profile", "FAQs, services & hours", "Customer chat link"], cta: "Start 14-day trial", highlighted: false },
    { name: "Starter", free: false, features: ["500 conversations/mo", "1 business profile", "Booking request capture", "Basic conversation analytics"], cta: "Choose Starter", highlighted: false },
    { name: "Professional", free: false, features: ["2,500 conversations/mo", "3 staff accounts", "Advanced analytics", "Custom AI personality", "Booking management & status tracking", "Export conversations & bookings (CSV)"], cta: "Choose Professional", highlighted: true },
    { name: "Business", free: false, features: ["Unlimited conversations", "Unlimited staff accounts", "Advanced analytics", "Custom AI personality", "Booking management & status tracking", "Export conversations & bookings (CSV)"], cta: "Choose Business", highlighted: false },
  ];
  const formatNgn = (amount) => `NGN ${amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
  return (
    <section id="pricing" className="container pricing-section">
      <div className="section-heading">
        <h2 className="display section-title">Plans that grow with your front desk.</h2>
        <p className="pricing-subtitle">Start with a 14-day free trial or choose a paid plan. Prices are in Nigerian Naira. Paystack purchases are one-time payments and do not renew automatically.</p>
      </div>
      <div className="pricing-toolbar">
        <div className="billing-toggle">
          <span className={`billing-toggle-label ${!yearly ? "billing-toggle-label--active" : ""}`}>Monthly</span>
          <button className={`toggle-switch ${yearly ? "toggle-switch--on" : ""}`} onClick={() => setYearly((y) => !y)} aria-pressed={yearly} aria-label="Toggle yearly billing">
            <span className="toggle-knob" />
          </button>
          <span className={`billing-toggle-label ${yearly ? "billing-toggle-label--active" : ""}`}>Yearly</span>
        </div>
      </div>
      <div className="pricing-grid">
        {plans.map((p) => {
          const details = getPlanDetails(p.name, "NGN", yearly ? "yearly" : "monthly");
          const displayPrice = details.displayPrice;
          const period = p.free ? "for 14 days" : yearly ? "/year" : "/month";
          return (
            <div key={p.name} className={`plan-card ${p.highlighted ? "plan-card--highlighted" : ""}`}>
              {p.highlighted && <span className="plan-badge">Recommended</span>}
              <h3 className="plan-name">{p.name}</h3>
              <p className="plan-price-row">
                <span className="plan-price display">{displayPrice}</span>
                <span className="plan-period">{period}</span>
              </p>
              {yearly && !p.free && <p className="plan-yearly-note">{formatNgn(details.amountDue / 12)} per month equivalent, paid yearly</p>}
              <ul className="plan-features">
                {p.features.map((f) => (
                  <li key={f} className="plan-feature-item"><Check className="plan-check" />{f}</li>
                ))}
              </ul>
              <button
                className={`btn ${p.highlighted ? "btn--amber" : "btn--outline"} btn--full`}
                onClick={() => onStartTrial?.({ plan: p.name === "Free trial" ? "14-day trial" : p.name, mode: p.free ? "trial" : "paid", billingPeriod: yearly ? "yearly" : "monthly", currency: "NGN" })}
              >
                {p.cta}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkflowNote() {
  return <section className="workflow-note container"><CalendarCheck2 size={24} aria-hidden="true" /><div><h2>Helpful automation. Human confirmation.</h2>
    <p>Appointment requests stay pending until your team confirms them. Your staff keeps the final say.</p></div></section>;
}

function ShareLinkCard({ user }) {
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user?.id) {
      setShareUrl(`${window.location.origin}${window.location.pathname}?view=chat&biz=${user.id}`);
    } else {
      setShareUrl("");
    }
  }, [user?.id]);

  const copyLink = async () => {
    if (!shareUrl || typeof navigator === "undefined") return;
    setCopyError("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const fallbackInput = document.createElement("textarea");
        fallbackInput.value = shareUrl;
        fallbackInput.setAttribute("readonly", "");
        fallbackInput.style.position = "fixed";
        fallbackInput.style.opacity = "0";
        document.body.appendChild(fallbackInput);
        fallbackInput.select();
        fallbackInput.setSelectionRange(0, fallbackInput.value.length);
        const copiedWithFallback = document.execCommand("copy");
        document.body.removeChild(fallbackInput);
        if (!copiedWithFallback) throw new Error("Copy command was rejected");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Could not copy the link. Select and copy the displayed address.");
    }
  };

  return (
    <section className="container share-link-section">
      <div className="share-box">
        <div className="share-box-header">
          <span className="share-icon-wrap"><MessageCircle className="share-icon" /></span>
          <div>
            <p className="eyebrow mono">Customer access</p>
            <h3 className="share-title">Give every customer a direct line to your business.</h3>
            <p className="share-subtitle">A direct link to your saved business information.</p>
          </div>
        </div>

        <p className="share-body">
          {user?.id
            ? "This is your customer chat link. Verify your business details and test the assistant before sharing it. The link does not guarantee that the backend or subscription is operational."
            : "Sign in to generate a link for your business. Share it anywhere clients already look for you, and they can get answers without creating an account or downloading an app."}
        </p>

        <ol className="share-steps">
          <li>
            <span className="share-step-num">1</span>
            <span>Copy the link below</span>
          </li>
          <li>
            <span className="share-step-num">2</span>
            <span>Paste it in your Instagram bio, WhatsApp Business profile, website, Google profile, or Facebook page</span>
          </li>
          <li>
            <span className="share-step-num">3</span>
            <span>When a client opens the link, they can ask questions and submit appointment requests through your configured assistant</span>
          </li>
        </ol>

        <div className="share-actions">
          <div className="share-url-display" title={shareUrl}>
            <span className="share-url-label">Customer link</span>
            <span className="share-url-value">{shareUrl || "Sign in to generate your link"}</span>
          </div>
          <button className="share-copy-button" disabled={!shareUrl} onClick={copyLink} aria-label={copied ? "Link copied" : "Copy customer link"} title={copied ? "Link copied" : "Copy customer link"}>
            {copied ? "OK" : <Copy className="share-copy-icon" />}
          </button>
        </div>
        <p role="status" className="copy-status">{copied ? "Customer link copied." : copyError}</p>
      </div>
    </section>
  );
}

function FinalCTA({ onStartTrial }) {
  return (
    <section className="container final-cta-section">
      <h2 className="display final-cta-title">Leave the light on.</h2>
      <p className="final-cta-sub">Give customers a clearer way to reach your business. Start with your information, then test the experience.</p>
      <button className="btn btn--amber btn--lg" onClick={() => onStartTrial?.({ plan: "14-day trial", mode: "trial" })}>Start your free trial</button>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="brand">
          <span className="dot-static" />
          <span className="brand-name">Ezeji Assistant</span>
        </div>
        <p className="footer-copy">© Ezeji Assistant. Built for the work behind every business.</p>
      </div>
    </footer>
  );
}

export default function NightlineLanding({ user, onSignIn, onStartTrial }) {
  return (
    <div className="marketing" id="top">
      <a className="skip-link" href="#marketing-content">Skip to content</a>

      <Nav onSignIn={onSignIn} onStartTrial={onStartTrial} />

      <main id="marketing-content">
      <Hero onSignIn={onSignIn} onStartTrial={onStartTrial} />
      <IndustryStrip />
      <ProblemSolution />
      <Features />
      <HowItWorks />
      <Pricing onStartTrial={onStartTrial} />
      <WorkflowNote />
      <ShareLinkCard user={user} />
      <FinalCTA onStartTrial={onStartTrial} />
      </main>
      <Footer />
    </div>
  );
}