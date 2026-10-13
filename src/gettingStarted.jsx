import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// A read-only checklist derived from the database. Never store a deceptive
// "onboarding complete" flag just because a user clicked Next.
export function GettingStartedPage({ user, onNavigate }) {
  const [counts, setCounts] = useState({ loading: true, services: 0, faqs: 0, error: "" });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setCounts({ loading: true, services: 0, faqs: 0, error: "" });
    Promise.all([
      supabase.from("services").select("id", { count: "exact", head: true }).eq("business_id", user.id),
      supabase.from("faqs").select("id", { count: "exact", head: true }).eq("business_id", user.id),
    ]).then(([services, faqs]) => {
      if (cancelled) return;
      if (services.error || faqs.error) {
        setCounts({ loading: false, services: 0, faqs: 0, error: "Could not check your saved services or FAQs. Retry by reopening this page." });
      } else {
        setCounts({ loading: false, services: services.count || 0, faqs: faqs.count || 0, error: "" });
      }
    }).catch(() => {
      if (!cancelled) setCounts({ loading: false, services: 0, faqs: 0, error: "Setup status is temporarily unavailable." });
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const profileReady = Boolean(user?.business?.trim() && user?.businessType && user?.description?.trim());
  const hoursReady = Boolean(Array.isArray(user?.hoursJson) && user.hoursJson.length && user?.address?.trim() && user?.cityStateZip?.trim());
  const steps = [
    { title: "Tell us about your business", details: "Add your category, description and contact information.", done: profileReady, tab: "profile", required: true },
    { title: "Add services and prices", details: "Give customers accurate information on what you offer.", done: !counts.loading && !counts.error && counts.services > 0, tab: "services", required: true },
    { title: "Set business hours and location", details: "Save your real operating schedule and address.", done: hoursReady, tab: "hours", required: true },
    { title: "Add frequently asked questions", details: "Recommended. Help customers get more useful answers.", done: !counts.loading && !counts.error && counts.faqs > 0, tab: "faqs", required: false },
    { title: "Configure your assistant", details: "Review the assistant settings available on your plan.", done: false, tab: "ai", required: false },
    { title: "Test the customer experience", details: "The overview includes an assistant preview, not a confirmed live connection.", done: false, tab: "overview", required: false },
    { title: "Connect a customer channel", details: "Share your web chat link, or connect WhatsApp when eligible.", done: false, tab: "integrations", required: false },
  ];
  const required = steps.filter((step) => step.required);
  const complete = required.filter((step) => step.done).length;
  const chatUrl = typeof window === "undefined" ? "" : new URL(`/?view=chat&biz=${encodeURIComponent(user?.id || "")}`, window.location.origin).href;
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Get started with {user?.business || "your business"}</h1>
          <p className="page-sub">Finish the essentials before sharing your assistant with customers. You can return to this checklist at any time.</p>
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Essential setup: {complete} of {required.length}</h2>
        <progress className="setup-progress" value={complete} max={required.length} aria-label="Essential business setup progress" />
        <p className="panel-help">Only saved business information counts toward completion. Optional steps are available whenever you need them.</p>
        {counts.loading && <p role="status">Checking saved setup...</p>}
        {counts.error && <p role="alert" className="auth-error">{counts.error}</p>}
      </div>
      <div className="setup-checklist">
        {steps.map((step) => (
          <section key={step.tab} className="panel setup-step">
            <div>
              <h2 className="panel-title">{step.title}</h2>
              <p className="panel-help">{step.details}</p>
              <span className={step.done ? "badge badge--green" : "badge badge--amber"}>
                {step.done ? "Saved" : step.required ? "Needs attention" : "Optional"}
              </span>
            </div>
            <button type="button" className="btn btn--outline" onClick={() => onNavigate?.(step.tab)}>
              {step.done ? "Review" : "Open"}
            </button>
          </section>
        ))}
      </div>
      <div className="panel">
        <h2 className="panel-title">Customer web chat</h2>
        <p className="panel-help">Your customer link is available below. Test answers and booking requests before publishing it. This link alone does not prove your assistant or integration is operational.</p>
        {user?.id && <a className="link-btn" href={chatUrl} target="_blank" rel="noopener noreferrer">Open customer chat link</a>}
      </div>
    </div>
  );
}
