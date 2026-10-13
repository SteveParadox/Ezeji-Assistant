import React, { useEffect, useRef, useState } from "react";
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

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, []);
  return reduced;
}

const HERO_SCRIPT = [
  { from: "customer", text: "hii do you have any openings sat morning for a cut n color" },
  { from: "ai", text: "A cut and color is listed at $145 in this example. Would you like me to send a Saturday 9:00 AM booking request?" },
  { from: "customer", text: "yes please! also are you open sundays" },
  { from: "ai", text: "Your request is in. The business will confirm whether Saturday 9:00 AM is available. They are closed Sundays." },
];

function HeroChat() {
  const reduced = useReducedMotion();
  const [visibleCount, setVisibleCount] = useState(reduced ? HERO_SCRIPT.length : 0);
  const [typing, setTyping] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (reduced) {
      setVisibleCount(HERO_SCRIPT.length);
      setTyping(false);
      return;
    }
    let cancelled = false;
    const timers = [];
    const queue = (fn, delay) => {
      const id = setTimeout(() => { if (!cancelled) fn(); }, delay);
      timers.push(id);
      return id;
    };
    const start = () => {
      if (cancelled || started.current) return;
      started.current = true;
      let i = 0;
      const step = () => {
        if (cancelled || i >= HERO_SCRIPT.length) return;
        const next = HERO_SCRIPT[i];
        const preDelay = next.from === "ai" ? 900 : 500;
        setTyping(next.from === "ai");
        queue(() => {
          if (cancelled) return;
          setTyping(false);
          setVisibleCount((c) => c + 1);
          i += 1;
          queue(step, 550);
        }, preDelay);
      };
      step();
    };
    queue(start, 600);
    return () => {
      cancelled = true;
      timers.forEach((id) => clearTimeout(id));
      started.current = false;
    };
  }, [reduced]);

  return (
    <div className="hero-chat-card">
      <div className="hero-chat-header">
        <div className="hero-chat-header-left">
          <div className="hero-chat-avatar">B</div>
          <div>
            <p className="hero-chat-name">Bloom & Co. Salon</p>
            <p className="hero-chat-time mono">11:47 PM</p>
          </div>
        </div>
        <div className="hero-chat-status">
          <span className="pulse-dot" />
          <span className="hero-chat-status-label mono">AI online</span>
        </div>
      </div>
      <div className="hero-chat-body">
        {HERO_SCRIPT.slice(0, visibleCount).map((m, idx) => (
          <div key={idx} className={`chat-bubble ${m.from === "customer" ? "chat-bubble--customer" : "chat-bubble--ai"}`}>
            {m.text}
          </div>
        ))}
        {typing && (
          <div className="chat-bubble chat-bubble--ai chat-bubble--typing">
            <span className="typing-dot" style={{ animationDelay: "0s" }} />
            <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
            <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function MissedLog() {
  const rows = [
    { time: "11:52 PM", label: "Missed call", sub: "rang out after hours" },
    { time: "9:14 AM", label: "Missed call", sub: "line was busy" },
    { time: "2:03 AM", label: "Web inquiry", sub: "no reply for 14 hours" },
  ];
  return (
    <div className="missed-log">
      {rows.map((r, i) => (
        <div key={i} className={`missed-row ${i < rows.length - 1 ? "missed-row--divider" : ""}`}>
          <div>
            <p className="missed-label">{r.label}</p>
            <p className="missed-sub">{r.sub}</p>
          </div>
          <span className="missed-time mono">{r.time}</span>
        </div>
      ))}
    </div>
  );
}

function Nav({ onSignIn, onStartTrial }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav">
      <div className="nav-inner container">
        <div className="brand">
          <span className="pulse-dot pulse-dot--small" />
          <span className="brand-name">Ezeji Assistant</span>
        </div>
        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="nav-actions">
          <button className="btn btn--ghost btn--nav-signin" onClick={onSignIn}>Sign in</button>
          <button className="btn btn--amber" onClick={() => onStartTrial?.({ plan: "14-day trial", mode: "trial" })}>Start free trial</button>
          <button className="nav-hamburger" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={open}>
            <span /><span /><span />
          </button>
        </div>
      </div>
      {open && (
        <div className="nav-mobile-menu">
          <a href="#product" onClick={() => setOpen(false)}>Product</a>
          <a href="#how" onClick={() => setOpen(false)}>How it works</a>
          <a href="#pricing" onClick={() => setOpen(false)}>Pricing</a>
          <button className="btn btn--ghost" onClick={() => { setOpen(false); onSignIn?.(); }}>Sign in</button>
          <button className="btn btn--amber" onClick={() => { setOpen(false); onStartTrial?.({ plan: "14-day trial", mode: "trial" }); }}>Start free trial</button>
        </div>
      )}
    </header>
  );
}

function Hero({ onSignIn, onStartTrial }) {
  return (
    <section className="hero container">
      <div className="hero-copy">
        <p className="eyebrow mono">For restaurants, hotels, salons, clinics & more</p>
        <h1 className="display hero-title">Someone always answers.</h1>
        <p className="body-lg hero-sub">
          Ezeji Assistant learns your hours, prices, and services, then answers
          customers the second they reach out - open or closed, day or
          night - and brings in a person whenever it should.
        </p>
        <div className="hero-actions">
          <button className="btn btn--amber btn--lg" onClick={() => onStartTrial?.({ plan: "14-day trial", mode: "trial" })}>Start your free trial</button>
        </div>
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
  return (
    <section id="product" className="container problem-section">
      <div className="problem-visual"><MissedLog /></div>
      <div className="problem-copy">
        <h2 className="display section-title">Every unanswered message is a customer deciding whether to wait.</h2>
        <p className="body-md">
          They call once. If no one picks up, they try the next name on the
          list - or the next tab in their browser. Ezeji Assistant sits on your
          phone number, your website, and your booking page, so there's
          never a moment when a question goes unanswered.
        </p>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: MessageCircle, title: "Answers instantly", body: "Every question gets a reply in seconds, any hour of the day." },
    { icon: BookOpenText, title: "Knows your business", body: "Menus, prices, hours, services, room rates - trained only on what you give it." },
    { icon: CalendarCheck2, title: "Books the appointment", body: "Customers request a table, a slot, or a room without waiting on a callback." },
    { icon: UserRoundCheck, title: "Hands off cleanly", body: "When a question needs a person, Ezeji Assistant flags it and brings your team in." },
    { icon: Store, title: "One account, every location", body: "Each business keeps its own private data. Nothing crosses over." },
    { icon: BarChart3, title: "See what customers ask", body: "Conversation history and analytics show what's working, and what your FAQs are missing." },
  ];
  return (
    <section className="container features-section">
      <div className="section-heading">
        <h2 className="display section-title">Everything the front desk does, without the front desk hours.</h2>
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
    { n: "01", title: "Tell it about your business", body: "Add your hours, services, prices, and the questions you get asked most." },
    { n: "02", title: "It learns your voice", body: "Ezeji Assistant turns that into answers that sound like you - not a script." },
    { n: "03", title: "Customers get answered", body: "Day or night, every message gets a reply, and a person whenever it matters." },
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
              {p.highlighted && <span className="plan-badge">Most popular</span>}
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

function Testimonial() {
  return (
    <section className="testimonial-section">
      <div className="testimonial-inner">
        <p className="display testimonial-quote">
          "Customers can request appointments through the assistant. Your team reviews availability and confirms the booking."
        </p>
        <p className="testimonial-author">Illustrative booking workflow</p>
      </div>
    </section>
  );
}

function ShareLinkCard({ user }) {
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (user?.id) {
      setShareUrl(`${window.location.origin}${window.location.pathname}?view=chat&biz=${user.id}`);
    } else {
      setShareUrl(`${window.location.origin}/?view=chat`);
    }
  }, [user?.id]);

  const copyLink = async () => {
    if (!shareUrl || typeof navigator === "undefined") return;
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
      // ignore
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
            <p className="share-subtitle">A simple link that turns questions into confident bookings.</p>
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
            <span>When a client taps it, the assistant opens with your business information and answers instantly, day or night</span>
          </li>
        </ol>

        <div className="share-actions">
          <div className="share-url-display" title={shareUrl}>
            <span className="share-url-label">Customer link</span>
            <span className="share-url-value">{shareUrl || "Sign in to generate your link"}</span>
          </div>
          <button className="share-copy-button" onClick={copyLink} aria-label={copied ? "Link copied" : "Copy customer link"} title={copied ? "Link copied" : "Copy customer link"}>
            {copied ? "OK" : <Copy className="share-copy-icon" />}
          </button>
        </div>
      </div>
    </section>
  );
}

function FinalCTA({ onStartTrial }) {
  return (
    <section className="container final-cta-section">
      <h2 className="display final-cta-title">Leave the light on.</h2>
      <p className="final-cta-sub">Set up your business profile in minutes. Your first conversation could happen tonight.</p>
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
        <p className="footer-copy">(c)  Ezeji Assistant. Every business, always answered.</p>
      </div>
    </footer>
  );
}

export default function NightlineLanding({ user, onSignIn, onStartTrial }) {
  return (
    <div className="nl-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .nl-root { --ink:#12131F; --ink-soft:#191B29; --ink-card:#1D1F30; --ink-border:#2B2D40; --paper:#F5F4F8; --paper-muted:#A6A5BA; --paper-faint:#6E6D85; --amber:#FFA53C; --amber-bg:rgba(255,165,60,0.10); --amber-text-on:#241505; background: var(--ink); min-height:100vh; width: 100%; font-family:'Inter',sans-serif; color: var(--paper); animation: pageEnter 420ms ease-out both; }
        .nl-root * { box-sizing: border-box; max-width: 100%; }
        .display { font-family: 'Instrument Serif', serif; font-weight: 400; }
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .container { max-width: 1152px; margin: 0 auto; padding: 0 24px; }
        .btn { font-size: 14px; font-weight: 500; padding: 10px 20px; border-radius: 999px; border: none; cursor: pointer; transition: transform 0.15s ease; font-family: 'Inter', sans-serif; }
        .btn:hover { transform: scale(1.03); }
        .btn--amber { background: var(--amber); color: var(--amber-text-on); }
        .btn--ghost { background: transparent; color: var(--paper-muted); }
        .btn--outline { background: transparent; color: var(--paper); border: 1px solid var(--ink-border); }
        .btn--lg { padding: 14px 26px; }
        .btn--full { width: 100%; padding: 12px 20px; }
        .btn--nav-signin { display: none; }
        @media (min-width: 640px) { .btn--nav-signin { display: inline-block; } }
        .nav { position: fixed; top: 0; left: 0; right: 0; z-index: 40; background: rgba(18,19,31,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--ink-border); }
        .nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; }
        .nav-spacer { height: 65px; }
        .brand { display: flex; align-items: center; gap: 8px; }
        .brand-name { font-size: 18px; letter-spacing: -0.01em; }
        .nav-links { display: none; align-items: center; gap: 24px; font-size: 14px; color: var(--paper-muted); }
        .nav-links a { color: inherit; text-decoration: none; }
        .nav-links a:hover { color: var(--paper); }
        @media (min-width: 768px) { .nav-links { display: flex; } }
        .nav-actions { display: flex; align-items: center; gap: 12px; }
        .nav-hamburger { display: inline-flex; flex-direction: column; justify-content: center; gap: 4px; width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--ink-border); background: transparent; padding: 0; }
        .nav-hamburger span { display: block; width: 18px; height: 2px; margin: 0 auto; background: var(--paper); border-radius: 999px; }
        .nav-mobile-menu { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 14px 24px 20px; border-top: 1px solid var(--ink-border); background: rgba(18,19,31,0.96); }
        .nav-mobile-menu a, .nav-mobile-menu button { color: var(--paper); text-align: left; font-size: 14px; width: 100%; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid transparent; }
        .nav-mobile-menu a:hover, .nav-mobile-menu button:hover { background: rgba(255,165,60,0.12); border-color: var(--ink-border); }
        @media (min-width: 768px) { .nav-hamburger { display: none; } }
        .pulse-dot { position: relative; display: inline-block; width: 10px; height: 10px; border-radius: 999px; background: var(--amber); animation: pulseDot 2s ease-in-out infinite; }
        .pulse-dot--small { width: 10px; height: 10px; }
        .dot-static { width: 8px; height: 8px; border-radius: 999px; background: var(--amber); display: inline-block; }
        .hero { display: grid; grid-template-columns: 1fr; gap: 56px; align-items: center; padding: 64px 24px 80px; }
        @media (min-width: 1024px) { .hero { grid-template-columns: 1fr 1fr; padding: 96px 24px 112px; } }
        .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--amber); margin-bottom: 20px; }
        .hero-title { font-size: 56px; line-height: 1.05; margin: 0 0 24px; }
        @media (min-width: 640px) { .hero-title { font-size: 64px; } }
        .body-lg { font-size: 18px; line-height: 1.6; color: var(--paper-muted); }
        .hero-sub { max-width: 420px; margin-bottom: 36px; }
        .hero-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .hero-note { font-size: 14px; color: var(--paper-faint); }
        .hero-chat-card { border-radius: 20px; width: 100%; max-width: 420px; margin: 0 auto; overflow: hidden; background: var(--ink-card); border: 1px solid var(--ink-border); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        @media (min-width: 1024px) { .hero-chat-card { margin: 0; } }
        .hero-chat-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--ink-border); }
        .hero-chat-header-left { display: flex; align-items: center; gap: 12px; }
        .hero-chat-avatar { width: 36px; height: 36px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; background: var(--amber-bg); color: var(--amber); }
        .hero-chat-name { font-size: 14px; font-weight: 500; margin: 0; }
        .hero-chat-time { font-size: 12px; color: var(--paper-faint); margin: 2px 0 0; }
        .hero-chat-status { display: flex; align-items: center; gap: 8px; }
        .hero-chat-status-label { font-size: 12px; color: var(--amber); }
        .hero-chat-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; min-height: 280px; }
        .chat-bubble { max-width: 85%; border-radius: 18px; padding: 10px 16px; font-size: 14px; line-height: 1.5; }
        .chat-bubble--customer { align-self: flex-start; border-bottom-left-radius: 4px; background: var(--ink-soft); border: 1px solid var(--ink-border); color: var(--paper); }
        .chat-bubble--ai { align-self: flex-end; border-bottom-right-radius: 4px; background: var(--amber); color: var(--amber-text-on); }
        .chat-bubble--typing { display: flex; gap: 4px; padding: 12px 16px; }
        .typing-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--amber-text-on); animation: typingBounce 1s ease-in-out infinite; }
        .industry-strip { border-top: 1px solid var(--ink-border); border-bottom: 1px solid var(--ink-border); }
        .industry-strip-label { text-align: center; font-size: 14px; color: var(--paper-faint); margin-bottom: 32px; padding-top: 40px; }
        .industry-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 24px 40px; padding-bottom: 40px; }
        .industry-item { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--paper-muted); }
        .industry-icon { width: 16px; height: 16px; color: var(--paper-muted); }
        .problem-section { display: grid; grid-template-columns: 1fr; gap: 56px; align-items: center; padding: 96px 24px; }
        @media (min-width: 1024px) { .problem-section { grid-template-columns: 1fr 1fr; } }
        .problem-visual { display: flex; justify-content: center; }
        @media (min-width: 1024px) { .problem-visual { justify-content: flex-start; } }
        .section-title { font-size: 32px; margin: 0 0 20px; }
        @media (min-width: 640px) { .section-title { font-size: 38px; } }
        .body-md { font-size: 16px; line-height: 1.65; color: var(--paper-muted); }
        .missed-log { border-radius: 20px; overflow: hidden; max-width: 420px; width: 100%; background: var(--ink-card); border: 1px solid var(--ink-border); }
        .missed-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; }
        .missed-row--divider { border-bottom: 1px solid var(--ink-border); }
        .missed-label { font-size: 14px; font-weight: 500; margin: 0; }
        .missed-sub { font-size: 12px; color: var(--paper-faint); margin: 2px 0 0; }
        .missed-time { font-size: 12px; color: var(--paper-muted); }
        .features-section { padding: 96px 24px; }
        .section-heading { max-width: 560px; margin-bottom: 56px; }
        .features-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
        @media (min-width: 640px) { .features-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1024px) { .features-grid { grid-template-columns: 1fr 1fr 1fr; } }
        .feature-card { border-radius: 20px; padding: 24px; background: var(--ink-card); border: 1px solid var(--ink-border); }
        .feature-icon-wrap { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: var(--amber-bg); margin-bottom: 20px; }
        .feature-icon { width: 20px; height: 20px; color: var(--amber); }
        .feature-title { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
        .feature-body { font-size: 14px; line-height: 1.6; color: var(--paper-muted); margin: 0; }
        .how-section { padding: 96px 24px; background: var(--ink-soft); }
        .how-title { max-width: 560px; margin-bottom: 56px; }
        .steps-grid { display: grid; grid-template-columns: 1fr; gap: 40px; }
        @media (min-width: 768px) { .steps-grid { grid-template-columns: 1fr 1fr 1fr; } }
        .step-number { font-size: 14px; color: var(--amber); margin: 0 0 16px; }
        .step-title { font-size: 18px; font-weight: 500; margin: 0 0 8px; }
        .step-body { font-size: 14px; line-height: 1.6; color: var(--paper-muted); margin: 0; }
        .pricing-section { padding: 96px 24px; }
        .pricing-subtitle { font-size: 14px; color: var(--paper-muted); margin-top: 8px; }
        .pricing-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 40px; }
        .billing-toggle { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .billing-toggle-label { font-size: 14px; color: var(--paper-faint); transition: color 0.15s ease; }
        .billing-toggle-label--active { color: var(--paper); font-weight: 500; }
        .toggle-switch { position: relative; width: 44px; height: 24px; border-radius: 999px; border: 1px solid var(--ink-border); background: var(--ink-card); cursor: pointer; padding: 0; transition: background 0.15s ease; }
        .toggle-switch--on { background: var(--amber); border-color: var(--amber); }
        .toggle-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: var(--paper); transition: transform 0.15s ease; }
        .toggle-switch--on .toggle-knob { transform: translateX(20px); background: var(--amber-text-on); }
        .currency-select-wrap { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: var(--amber-bg); border: 1px solid rgba(255,165,60,0.28); }
        .currency-label { font-size: 12px; color: var(--amber); }
        .currency-select { appearance: none; background: transparent; color: var(--paper); border: none; font-size: 13px; outline: none; font-weight: 500; cursor: pointer; padding: 2px 4px; }
        .currency-select-wrap:hover { border-color: var(--amber); }
        .currency-select:hover { color: var(--amber); }
        .currency-select option:hover, .currency-select option:checked { background: var(--amber-bg); color: var(--amber); }
        .currency-select option { background: var(--ink-card); color: var(--paper); }
        .plan-yearly-note { font-size: 12px; color: var(--paper-faint); margin: -12px 0 20px; }
        .pricing-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
        @media (min-width: 768px) { .pricing-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1024px) { .pricing-grid { grid-template-columns: 1fr 1fr 1fr 1fr; } }
        .plan-card { border-radius: 20px; padding: 24px; display: flex; flex-direction: column; background: var(--ink-card); border: 1px solid var(--ink-border); }
        .plan-card--highlighted { background: var(--amber-bg); border-color: var(--amber); }
        .plan-badge { font-size: 12px; margin-bottom: 12px; align-self: flex-start; padding: 4px 10px; border-radius: 999px; background: var(--amber); color: var(--amber-text-on); }
        .plan-name { font-size: 18px; font-weight: 500; margin: 0 0 4px; }
        .plan-price-row { margin-bottom: 20px; }
        .plan-price { font-size: 32px; }
        .plan-period { font-size: 14px; color: var(--paper-faint); margin-left: 4px; }
        .plan-features { list-style: none; padding: 0; margin: 0 0 32px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1; }
        .plan-feature-item { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; color: var(--paper-muted); }
        .plan-check { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; color: var(--amber); }
        .testimonial-section { padding: 96px 24px; background: var(--ink-soft); }
        .testimonial-inner { max-width: 640px; margin: 0 auto; text-align: center; }
        .testimonial-quote { font-size: 24px; line-height: 1.4; margin: 0 0 32px; }
        @media (min-width: 640px) { .testimonial-quote { font-size: 30px; } }
        .testimonial-author { font-size: 14px; color: var(--paper-muted); }
        .share-link-section { padding: 0 24px 64px; }
        .share-box { border: 1px solid rgba(255,165,60,0.32); background: linear-gradient(135deg, rgba(255,165,60,0.16), rgba(255,255,255,0.03) 62%); border-radius: 16px; padding: clamp(24px, 4vw, 40px); display: flex; flex-direction: column; gap: 20px; box-shadow: 0 22px 60px rgba(0,0,0,0.18); }
        .share-title { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
        .share-subtitle { color: var(--paper); font-size: 14px; margin: 0; }
        .share-box-header { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 4px; }
        .share-icon-wrap { width: 42px; height: 42px; border-radius: 12px; background: var(--amber-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .share-icon { width: 20px; height: 20px; color: var(--amber); }
        .share-steps { list-style: none; margin: 4px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
        .share-steps li { display: flex; align-items: center; gap: 12px; font-size: 13.5px; color: var(--paper-muted); }
        .share-step-num { width: 22px; height: 22px; border-radius: 999px; background: var(--amber-bg); color: var(--amber); font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .share-body { font-size: 14px; color: var(--paper-muted); margin: 0; line-height: 1.6; }
        .share-actions { display: flex; align-items: center; gap: 14px; padding-top: 8px; }
        .share-url-display { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; padding: 0 0 10px; border-bottom: 1px solid rgba(245,244,248,0.24); }
        .share-url-label { color: var(--amber); font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
        .share-url-value { overflow: hidden; color: var(--paper); font-family: 'IBM Plex Mono', monospace; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .share-copy-button { width: 44px; height: 44px; flex: 0 0 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--amber); color: var(--amber-text-on); border: none; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .share-copy-button:hover { transform: translateY(-2px); box-shadow: 0 8px 18px rgba(255,165,60,0.24); }
        .share-copy-icon { width: 17px; height: 17px; }
        @media (max-width: 560px) { .share-actions { align-items: flex-end; } .share-url-value { max-width: calc(100vw - 150px); } }
        .final-cta-section { padding: 112px 24px; text-align: center; }
        .final-cta-title { font-size: 40px; margin: 0 0 24px; }
        @media (min-width: 640px) { .final-cta-title { font-size: 48px; } }
        .final-cta-sub { font-size: 16px; color: var(--paper-muted); max-width: 420px; margin: 0 auto 40px; }
        .footer { border-top: 1px solid var(--ink-border); }
        .footer-inner { display: flex; flex-direction: column; justify-content: space-between; gap: 24px; padding: 48px 24px; }
        @media (min-width: 640px) { .footer-inner { flex-direction: row; align-items: center; } }
        .footer-copy { font-size: 12px; color: var(--paper-faint); margin: 0; }
        @keyframes pageEnter { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulseDot { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255,165,60,0.5); } 50% { opacity: 0.6; box-shadow: 0 0 0 6px rgba(255,165,60,0); } }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-3px); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .nl-root * { animation: none !important; transition: none !important; } }
      `}</style>
      <Nav onSignIn={onSignIn} onStartTrial={onStartTrial} />
      <div className="nav-spacer" />
      <Hero onSignIn={onSignIn} onStartTrial={onStartTrial} />
      <IndustryStrip />
      <ProblemSolution />
      <Features />
      <HowItWorks />
      <Pricing onStartTrial={onStartTrial} />
      <Testimonial />
      <ShareLinkCard user={user} />
      <FinalCTA onStartTrial={onStartTrial} />
      <Footer />
    </div>
  );
}