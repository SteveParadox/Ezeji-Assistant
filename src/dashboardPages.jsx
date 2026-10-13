import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getPlanDetails, getTrialEndsAt } from "./billingLogic";
import {
  LayoutDashboard, Building2, HelpCircle, ListChecks, Clock, Bot,
  MessagesSquare, BarChart3, CreditCard, LogOut, Power, Plus, Trash2,
  CheckCircle2, MessageCircle,
} from "lucide-react";
import { Logo, TextField, StatCard, timeAgo, downloadCsv, API_BASE_URL, STAFF_LIMITS, ANALYTICS_TIER, AI_PERSONALITY_PLANS, CONVERSATION_LIMITS, getStoredPlanSelection, upsertProfile } from "./shared";
import { ChatWidgetDemo } from "./chatWidget";
import { fetchAllPages } from "./dataPaging";
import { hasActivePremiumPlan } from "./planAccess";

async function staffApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in to manage staff accounts.");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(result.error || "Staff request failed.");
  return result;
}

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "profile", label: "Business Profile", icon: Building2 },
  { id: "faqs", label: "FAQs", icon: HelpCircle },
  { id: "services", label: "Services & Pricing", icon: ListChecks },
  { id: "hours", label: "Hours & Location", icon: Clock },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "staff", label: "Staff", icon: MessagesSquare },
  { id: "bookings", label: "Bookings", icon: CheckCircle2 },
  { id: "conversations", label: "Conversations", icon: MessagesSquare },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "integrations", label: "Integrations", icon: Bot },
];

export function DashboardShell({ go, active, setActive, children, isStaff = false }) {
  const visibleNavItems = isStaff
    ? NAV_ITEMS.filter(({ id }) => id === "bookings" || id === "conversations")
    : NAV_ITEMS;

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="dash-sidebar-top">
          <Logo size={18} />
        </div>
        <button className="dash-nav-item" onClick={() => go("landing")}>
          <MessageCircle className="dash-nav-icon" />
          Back to landing
        </button>
        <nav className="dash-nav">
          {visibleNavItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`dash-nav-item ${active === id ? "dash-nav-item--active" : ""}`}
              onClick={() => setActive(id)}
            >
              <Icon className="dash-nav-icon" />
              {label}
            </button>
          ))}
        </nav>
        <button className="dash-nav-item dash-logout" onClick={() => go("login")}>
          <LogOut className="dash-nav-icon" />
          Log out
        </button>
      </aside>
      <main className="dash-main">{children}</main>
    </div>
  );
}

export function OverviewPage({ user, onUpdateUser }) {
  const [aiOn, setAiOn] = useState(user?.assistantLive !== false);
  const [recent, setRecent] = useState([]);
  const [stats, setStats] = useState({ today: 0, resolvedPct: 0, escalated: 0, yesterday: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [periodUsage, setPeriodUsage] = useState(0);

  const plan = user?.plan || "14-day trial";
  const conversationLimit = CONVERSATION_LIMITS[plan] ?? CONVERSATION_LIMITS["14-day trial"];
  const usagePct = conversationLimit === Infinity ? 0 : Math.min(100, Math.round((periodUsage / conversationLimit) * 100));
  const limitReached = conversationLimit !== Infinity && periodUsage >= conversationLimit;
  const limitNear = !limitReached && conversationLimit !== Infinity && usagePct >= 80;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    // Matches server.js's checkUsageLimit exactly: trial plans count all-time
    // since signup, paid plans count since the start of the current month -
    // this has to match or the banner would show a different number than
    // what's actually blocking customers.
    const sinceForPlan = plan === "14-day trial"
      ? new Date(0).toISOString()
      : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    Promise.all([
      // Real counts, not capped by how many rows got fetched - accurate
      // no matter how many conversations a busy business has in a day.
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).gte("created_at", startOfToday),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).eq("escalated", true).gte("created_at", startOfToday),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).gte("created_at", startOfYesterday).lt("created_at", startOfToday),
      supabase.from("conversations").select("customer_message, escalated, created_at").eq("business_id", user.id).order("created_at", { ascending: false }).limit(5),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).gte("created_at", sinceForPlan),
    ])
      .then(([todayRes, escalatedRes, yesterdayRes, recentRes, totalRes, periodRes]) => {
        if (cancelled) return;
        if (todayRes.error) console.error("Overview today count error:", todayRes.error);
        if (escalatedRes.error) console.error("Overview escalated count error:", escalatedRes.error);
        if (yesterdayRes.error) console.error("Overview yesterday count error:", yesterdayRes.error);
        if (recentRes.error) console.error("Overview recent load error:", recentRes.error);
        if (totalRes.error) console.error("Overview total count error:", totalRes.error);
        if (periodRes.error) console.error("Overview period usage count error:", periodRes.error);

        const today = todayRes.count || 0;
        const escalated = escalatedRes.count || 0;
        const resolvedPct = today ? Math.round(((today - escalated) / today) * 100) : 0;

        setStats({
          today,
          resolvedPct,
          escalated,
          yesterday: yesterdayRes.count || 0,
          total: totalRes.count || 0,
        });
        setRecent(recentRes.data || []);
        setPeriodUsage(periodRes.count || 0);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.id, plan]);

  const diffFromYesterday = stats.today - stats.yesterday;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">{user?.business || "Your business"}</p>
        </div>
        <button
          className={`ai-toggle-pill ${aiOn ? "ai-toggle-pill--on" : ""}`}
          onClick={() => {
            const next = !aiOn;
            setAiOn(next);
            onUpdateUser?.({ ...(user || {}), assistantLive: next });
          }}
        >
          <Power className="ai-toggle-icon" />
          {aiOn ? "Assistant is live" : "Assistant is paused"}
        </button>
      </div>

      {!loading && limitReached && (
        <div className="panel" style={{ borderLeft: "4px solid var(--red, #e5484d)", marginBottom: 16 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            You've reached your {plan} plan's limit ({conversationLimit} conversations {plan === "14-day trial" ? "total" : "this month"}).
          </p>
          <p className="panel-help" style={{ margin: "4px 0 0" }}>
            New customers are currently getting an automatic "reached their limit" reply instead of help from your AI. Upgrade your plan in Billing to restore service right away.
          </p>
        </div>
      )}
      {!loading && limitNear && (
        <div className="panel" style={{ borderLeft: "4px solid var(--amber)", marginBottom: 16 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            You've used {periodUsage} of {conversationLimit} conversations on your {plan} plan {plan === "14-day trial" ? "" : "this month"} ({usagePct}%).
          </p>
          <p className="panel-help" style={{ margin: "4px 0 0" }}>
            You're approaching your limit. Once you hit it, new customers will get an automatic message instead of a real reply - consider upgrading in Billing before that happens.
          </p>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Conversations today" value={loading ? "..." : String(stats.today)} sub={loading ? "" : `${diffFromYesterday >= 0 ? "+" : ""}${diffFromYesterday} vs yesterday`} />
        <StatCard label="Not escalated" value={loading ? "..." : `${stats.resolvedPct}%`} accent sub={loading ? "" : `${stats.today - stats.escalated} of ${stats.today} handled`} />
        <StatCard label="Escalated to staff" value={loading ? "..." : String(stats.escalated)} sub="today" />
        <StatCard label="Total logged" value={loading ? "..." : String(stats.total)} sub="all time" />
      </div>

      <div className="panel">
        <h2 className="panel-title">Live AI assistant</h2>
        <p className="panel-help">Try a message like "What are your hours?" or "Book Saturday 9am".</p>
        <ChatWidgetDemo user={user} enabled={aiOn} previewOnly />
      </div>

      <div className="panel">
        <h2 className="panel-title">Recent conversations</h2>
        {!loading && recent.length === 0 && <p className="panel-help">No conversations yet - once customers start chatting, they'll show up here.</p>}
        {recent.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Message</th><th>Status</th><th>Time</th></tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td>{(r.customer_message || "").slice(0, 60)}</td>
                  <td>
                    <span className={`badge ${r.escalated ? "badge--amber" : "badge--green"}`}>
                      {r.escalated ? "Escalated" : "Resolved"}
                    </span>
                  </td>
                  <td className="mono table-time">{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function BusinessProfilePage({ user, onUpdateUser }) {
  const [form, setForm] = useState({
    name: user?.business || "",
    category: user?.businessType || "Other",
    customBusinessType: user?.customBusinessType || "",
    description: user?.description || "",
    phone: user?.phone || "",
    email: user?.contactEmail || "",
    website: user?.website || "",
    serviceName: user?.serviceName || "",
    price: user?.price || "",
    hours: user?.hours || "",
  });
  const [saveState, setSaveState] = useState("idle");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!user) return;
    setForm((current) => ({
      ...current,
      name: user?.business || "",
      category: user?.businessType || "Other",
      customBusinessType: user?.customBusinessType || current.customBusinessType,
      email: user?.contactEmail ?? "",
      phone: user?.phone ?? "",
      website: user?.website ?? "",
      serviceName: user?.serviceName || "",
      price: user?.price || current.price,
      hours: user?.hours || current.hours,
      description: user?.description || current.description,
    }));
  }, [user?.business, user?.businessType, user?.email]);

  const handleSave = async () => {
    if (saveState === "saving") return;
    if (form.name.trim().length < 2 ||
        (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    const nextUser = {
      ...(user || {}),
      name: form.name.trim(),
      business: form.name.trim(),
      businessType: form.category || "Other",
      customBusinessType: form.category === "Other" ? form.customBusinessType.trim() : "",
      contactEmail: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      website: form.website.trim(),
      serviceName: form.serviceName.trim(),
      price: form.price.trim(),
      hours: form.hours.trim(),
      description: form.description.trim() || "",
    };

    try {
      if (!onUpdateUser) throw new Error("Profile saving is unavailable");
      await onUpdateUser(nextUser);
      setSaveState("saved");
    } catch (error) {
      console.error("Business profile save failed:",error.message);
      setSaveState("error");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Business Profile</h1><p className="page-sub">This is what your AI assistant knows about you.</p></div></div>
      <div className="panel form-panel">
        <TextField label="Business name" value={form.name} onChange={set("name")} />
        <label className="field">
          <span className="field-label">Category</span>
          <select className="field-input field-select" value={form.category} onChange={set("category")}>
            {["Salon & Beauty", "Restaurant", "Hotel", "Clinic", "Laundry", "Real Estate", "Gym", "Other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {form.category === "Other" && (
          <TextField label="Custom business type" value={form.customBusinessType} onChange={set("customBusinessType")} />
        )}
        <label className="field">
          <span className="field-label">Description</span>
          <textarea className="field-input field-textarea" rows={3} value={form.description} onChange={set("description")} />
        </label>
        <TextField label="Phone" value={form.phone} onChange={set("phone")} />
        <TextField label="Public contact email (not login email)" type="email" value={form.email} onChange={set("email")} />
        <TextField label="Website" value={form.website} onChange={set("website")} />
        <TextField label="Service name" value={form.serviceName} onChange={set("serviceName")} />
        <TextField label="Price" value={form.price} onChange={set("price")} />
        <TextField label="Hours" value={form.hours} onChange={set("hours")} />
        {saveState === "saved" && <p className="save-status">Saved successfully</p>}
        {saveState === "error" && <p className="auth-error">Could not save your business profile. Check your connection and retry.</p>}
        <button className="btn btn--amber" disabled={saveState === "saving"} onClick={handleSave}>{saveState === "saving" ? "Saving..." : "Save changes"}</button>
      </div>
    </div>
  );
}

export function FAQsPage({ user }) {
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ q: "", a: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("faqs")
      .select("id, question, answer")
      .eq("business_id", user.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("FAQs load error:", error);
        setFaqs(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const add = async () => {
    if (!draft.q.trim() || !user?.id) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("faqs")
      .insert({ business_id: user.id, question: draft.q.trim(), answer: draft.a.trim() })
      .select()
      .single();
    setSaving(false);
    if (error) {
      console.error("FAQ add error:", error);
      return;
    }
    setFaqs((f) => [...f, data]);
    setDraft({ q: "", a: "" });
  };

  const remove = async (id) => {
    setFaqs((f) => f.filter((item) => item.id !== id));
    const { error } = await supabase.from("faqs").delete().eq("id", id);
    if (error) console.error("FAQ delete error:", error);
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">FAQs</h1><p className="page-sub">Answers your assistant gives automatically - these are now sent to the AI.</p></div></div>
      <div className="panel">
        {loading && <p className="panel-help">Loading...</p>}
        {!loading && faqs.length === 0 && <p className="panel-help">No FAQs yet - add your first one below.</p>}
        {faqs.map((f) => (
          <div key={f.id} className="faq-row">
            <div>
              <p className="faq-q">{f.question}</p>
              <p className="faq-a">{f.answer}</p>
            </div>
            <div className="row-actions">
              <button className="icon-btn" onClick={() => remove(f.id)}><Trash2 className="icon-btn-icon" /></button>
            </div>
          </div>
        ))}
        <div className="faq-add">
          <input className="field-input" placeholder="New question" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} />
          <input className="field-input" placeholder="Answer" value={draft.a} onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value }))} />
          <button className="btn btn--outline" onClick={add} disabled={saving}><Plus className="icon-btn-icon" /> {saving ? "Adding..." : "Add FAQ"}</button>
        </div>
      </div>
    </div>
  );
}

export function ServicesPage({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: "", price: "", duration: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("services")
      .select("id, name, price, duration")
      .eq("business_id", user.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Services load error:", error);
        setItems(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const add = async () => {
    if (!draft.name.trim() || !user?.id) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("services")
      .insert({ business_id: user.id, name: draft.name.trim(), price: draft.price.trim(), duration: draft.duration.trim() })
      .select()
      .single();
    setSaving(false);
    if (error) {
      console.error("Service add error:", error);
      return;
    }
    setItems((s) => [...s, data]);
    setDraft({ name: "", price: "", duration: "" });
  };

  const remove = async (id) => {
    setItems((s) => s.filter((it) => it.id !== id));
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) console.error("Service delete error:", error);
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Services & Pricing</h1><p className="page-sub">Menu items, services, or room rates - whatever you sell. Sent to the AI.</p></div></div>
      <div className="panel">
        {loading && <p className="panel-help">Loading...</p>}
        {!loading && items.length === 0 && <p className="panel-help">No services yet - add your first one below.</p>}
        {items.length > 0 && (
          <table className="table">
            <thead><tr><th>Item</th><th>Price</th><th>Duration</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="mono">{it.price}</td>
                  <td>{it.duration}</td>
                  <td className="row-actions">
                    <button className="icon-btn" onClick={() => remove(it.id)}><Trash2 className="icon-btn-icon" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="faq-add" style={{ marginTop: 16 }}>
          <input className="field-input" placeholder="Service name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input className="field-input" placeholder="Price ($65)" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
          <input className="field-input" placeholder="Duration (45 min)" value={draft.duration} onChange={(e) => setDraft((d) => ({ ...d, duration: e.target.value }))} />
          <button className="btn btn--outline" onClick={add} disabled={saving}><Plus className="icon-btn-icon" /> {saving ? "Adding..." : "Add item"}</button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => ({
  day: d, open: d === "Sunday" ? "" : "9:00 AM", close: d === "Sunday" ? "" : "6:00 PM", closed: d === "Sunday",
}));

export function HoursLocationPage({ user, onUpdateUser }) {
  const [hours, setHours] = useState(user?.hoursJson || DEFAULT_HOURS);
  const [address, setAddress] = useState(user?.address || "");
  const [cityStateZip, setCityStateZip] = useState(user?.cityStateZip || "");
  const [saveState, setSaveState] = useState("idle");

  const toggle = (i) => setHours((h) => h.map((row, idx) => (idx === i ? { ...row, closed: !row.closed } : row)));

  const save = async () => {
    if (!onUpdateUser) return;
    if (!address.trim() || !cityStateZip.trim()) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      await onUpdateUser({ ...(user || {}), hoursJson: hours, address, cityStateZip });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1800);
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Hours & Location</h1><p className="page-sub">Used to answer "are you open" questions instantly. Sent to the AI.</p></div></div>
      <div className="panel">
        {hours.map((row, i) => (
          <div key={row.day} className="hours-row">
            <span className="hours-day">{row.day}</span>
            {row.closed ? (
              <span className="hours-closed">Closed</span>
            ) : (
              <span className="hours-time mono">{row.open} - {row.close}</span>
            )}
            <button className="link-btn" onClick={() => toggle(i)}>{row.closed ? "Mark open" : "Mark closed"}</button>
          </div>
        ))}
      </div>
      <div className="panel form-panel">
        <TextField label="Street address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <TextField label="City / State / ZIP" value={cityStateZip} onChange={(e) => setCityStateZip(e.target.value)} />
        {saveState === "saved" && <p className="save-status">Saved successfully</p>}
        {saveState === "error" && <p className="auth-error">Enter both your street address and city / state / ZIP before saving.</p>}
        <button className="btn btn--amber" onClick={save} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving..." : "Save changes"}</button>
      </div>
    </div>
  );
}

export function AISettingsPage({ user, onUpdateUser }) {
  const plan = user?.plan || "14-day trial";
  const canCustomize = hasActivePremiumPlan(user);
  const [assistantName, setAssistantName] = useState(user?.assistantName || "Ezeji Assistant");
  const [tone, setTone] = useState(user?.tone || "Friendly & warm");
  const [greeting, setGreeting] = useState(user?.greeting || `Hi! I'm ${user?.business || "your business"}'s assistant - ask me about hours, pricing, or booking.`);
  const [escalationKeywords, setEscalationKeywords] = useState(user?.escalationKeywords || "refund, complaint, emergency");
  const [saveState, setSaveState] = useState("idle");

  const save = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      if (!onUpdateUser) throw new Error("Assistant settings are unavailable");
      await onUpdateUser({ ...(user || {}), assistantName, tone, greeting, escalationKeywords });
      setSaveState("saved");
    } catch (error) {
      console.error("Assistant settings save failed:",error.message);
      setSaveState("error");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">AI Settings</h1><p className="page-sub">Customize how your assistant sounds and behaves. Sent to the AI.</p></div></div>
      {!canCustomize ? (
        <div className="panel">
          <h2 className="panel-title">Custom AI personality is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) uses the default assistant voice. Upgrade to Professional or Business in Billing to customize your assistant's name, tone, greeting, and escalation keywords.
          </p>
        </div>
      ) : (
        <div className="panel form-panel">
          <TextField label="Assistant name" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} />
          <label className="field">
            <span className="field-label">Tone of voice</span>
            <select className="field-input field-select" value={tone} onChange={(e) => setTone(e.target.value)}>
              {["Friendly & warm", "Professional", "Playful", "Concise"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Greeting message</span>
            <textarea className="field-input field-textarea" rows={2} value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </label>
          <TextField label="Escalation keywords (comma separated)" value={escalationKeywords} onChange={(e) => setEscalationKeywords(e.target.value)} />
          {saveState === "saved" && <p className="save-status">Saved successfully</p>}
          {saveState === "error" && <p className="auth-error">Could not save assistant settings. Retry.</p>}
          <button className="btn btn--amber" disabled={saveState === "saving"} onClick={save}>{saveState === "saving" ? "Saving..." : "Save settings"}</button>
        </div>
      )}
    </div>
  );
}

export function StaffPage({ user }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const plan = user?.plan || "14-day trial";
  const limit = STAFF_LIMITS[plan] ?? 1;
  const canManageStaff = !user?.isStaff && hasActivePremiumPlan(user);

  useEffect(() => {
    if (!user?.id || !canManageStaff) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    staffApi("/staff")
      .then(({ staff: data }) => {
        if (cancelled) return;
        setStaff(data || []);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error("Staff load error:", loadError);
        setError(loadError.message || "Could not load staff members.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, canManageStaff]);

  const atLimit = limit !== Infinity && staff.length >= limit;

  const invite = async () => {
    if (!email.trim() || !user?.id) return;
    if (atLimit) {
      setError(`Your ${plan} plan includes ${limit} staff seat${limit === 1 ? "" : "s"}. Upgrade your plan to add more.`);
      return;
    }
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const { staffMember, inviteSent, inviteUrl } = await staffApi("/staff/invite", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setStaff((current) => [...current, staffMember]);
      setEmail("");
      setNotice(inviteSent ? "Invitation email sent." : "Invitation created. Share this secure link privately: " + inviteUrl);
    } catch (inviteError) {
      console.error("Staff invite error:", inviteError);
      setError(inviteError.message || "Couldn't invite that staff member.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setError("");
    try {
      await staffApi(`/staff/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStaff((current) => current.filter((row) => row.id !== id));
    } catch (removeError) {
      console.error("Staff remove error:", removeError);
      setError(removeError.message || "Could not remove that staff member.");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Staff</h1><p className="page-sub">Invite staff to manage bookings and conversations. {plan} includes {limit === Infinity ? "unlimited" : limit} seat{limit === 1 ? "" : "s"}.</p></div></div>
      {!canManageStaff ? (
        <div className="panel"><p className="panel-title">Staff accounts require an active Professional or Business plan.</p><p className="panel-help">Upgrade in Billing to invite staff.</p></div>
      ) : (
      <div className="panel">
        {loading ? (
          <p className="panel-help">Loading...</p>
        ) : (
          <>
            <p className="panel-help">{staff.length} of {limit === Infinity ? "unlimited" : limit} seats used</p>
            {staff.map((s) => (
              <div key={s.id} className="faq-row">
                <p className="faq-q">{s.email}</p>
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => remove(s.id)}><Trash2 className="icon-btn-icon" /></button>
                </div>
              </div>
            ))}
            <div className="faq-add" style={{ marginTop: 16 }}>
              <input className="field-input" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn btn--outline" onClick={invite} disabled={saving || atLimit}>
                <Plus className="icon-btn-icon" /> {saving ? "Sending invite..." : "Invite staff"}
              </button>
            </div>
            {notice && <p className="save-status">{notice}</p>}
            {error && <p className="auth-error">{error}</p>}
            {atLimit && !error && (
              <p className="panel-help" style={{ marginTop: 8 }}>You've used all your available seats - upgrade your plan in Billing to add more.</p>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}

export function BookingsPage({ user }) {
  const canManageBookings = user?.isStaff || hasActivePremiumPlan(user);
  const canExport = canManageBookings;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id || !canManageBookings) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("bookings")
      .select("id, customer_name, customer_contact, service, booking_date, booking_time, notes, status, created_at")
      .eq("business_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Bookings load error:", error);
        setBookings(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, canManageBookings]);

  const updateStatus = async (id, status) => {
    setError("");
    const {data, error} = await supabase.from("bookings")
      .update({status}).eq("id",id).eq("business_id",user.id)
      .select("id,status").maybeSingle();
    if (error || !data) {
      setError("Booking update was not saved. Another booking may already occupy that time.");
      return;
    }
    setBookings((b) => b.map((row) => (row.id === id ? { ...row, status: data.status } : row)));
  };

  const cancelBooking = async (id) => {
    if (!window.confirm("Cancel this appointment? The record will be preserved for auditing.")) return;
    await updateStatus(id,"canceled");
  };

  const exportCsv = () => {
    downloadCsv(`bookings-${new Date().toISOString().slice(0, 10)}.csv`, bookings, [
      { label: "Customer", get: (r) => r.customer_name },
      { label: "Contact", get: (r) => r.customer_contact },
      { label: "Service", get: (r) => r.service },
      { label: "Date", get: (r) => r.booking_date },
      { label: "Time", get: (r) => r.booking_time },
      { label: "Status", get: (r) => r.status },
      { label: "Notes", get: (r) => r.notes },
      { label: "Created", get: (r) => new Date(r.created_at).toLocaleString() },
    ]);
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Bookings</h1><p className="page-sub">Real appointments your AI assistant has created from customer conversations.</p></div>
        {canExport && bookings.length > 0 && (
          <button className="btn btn--outline" onClick={exportCsv}>Export CSV</button>
        )}
      </div>
      {!canManageBookings ? (
        <div className="panel"><p className="panel-title">Booking management requires an active Professional or Business plan.</p><p className="panel-help">Starter includes booking request capture. Upgrade in Billing to view and manage confirmed bookings.</p></div>
      ) : (
      <div className="panel">
        {error && <p className="auth-error">{error}</p>}
        {loading && <p className="panel-help">Loading...</p>}
        {!loading && bookings.length === 0 && <p className="panel-help">No bookings yet - once a customer books through the chat widget, it'll show up here for real.</p>}
        {bookings.length > 0 && (
          <table className="table">
            <thead><tr><th>Customer</th><th>Service</th><th>Date</th><th>Time</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.customer_name || "-"}{b.customer_contact ? ` (${b.customer_contact})` : ""}</td>
                  <td>{b.service}</td>
                  <td>{b.booking_date}</td>
                  <td className="mono">{b.booking_time}</td>
                  <td>
                    <span className={`badge ${b.status === "confirmed" ? "badge--green" : "badge--amber"}`}>{b.status}</span>
                  </td>
                  <td className="row-actions">
                    {b.status === "pending" && (
                      <button className="btn btn--outline" onClick={() => updateStatus(b.id, "confirmed")}>Confirm</button>
                    )}
                    {["pending","confirmed"].includes(b.status) && (
                      <button className="icon-btn" onClick={() => cancelBooking(b.id)} aria-label="Cancel booking" title="Cancel booking"><Trash2 className="icon-btn-icon" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}

export function ConversationsPage({ user }) {
  const canExport = user?.isStaff || hasActivePremiumPlan(user);
  const [convos, setConvos] = useState([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("conversations")
      .select("customer_message, ai_reply, escalated, created_at")
      .eq("business_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Conversations load error:", error);
        setConvos(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const exportCsv = async () => {
    setIsExporting(true);
    setExportError("");
    try {
      const pageSize = 1000;
      const allConversations = await fetchAllPages((offset, limit) =>
        supabase
          .from("conversations")
          .select("id, customer_message, ai_reply, escalated, created_at", { count: offset === 0 ? "exact" : undefined })
          .eq("business_id", user.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1), pageSize);

      downloadCsv(`conversations-${new Date().toISOString().slice(0, 10)}.csv`, allConversations, [
        { label: "Date", get: (r) => new Date(r.created_at).toLocaleString() },
        { label: "Customer message", get: (r) => r.customer_message },
        { label: "AI reply", get: (r) => r.ai_reply },
        { label: "Status", get: (r) => (r.escalated ? "Escalated" : "Resolved") },
      ]);
    } catch (error) {
      console.error("Conversation export error:", error);
      setExportError("Couldn't export conversations. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Conversations</h1><p className="page-sub">Every message, searchable and reviewable.</p></div>
        {canExport && convos.length > 0 && (
          <button className="btn btn--outline" onClick={exportCsv} disabled={isExporting}>{isExporting ? "Preparing CSV..." : "Export CSV"}</button>
        )}
      </div>
      {exportError && <p className="auth-error">{exportError}</p>}
      {loading && <p className="panel-help">Loading...</p>}
      {!loading && convos.length === 0 && <p className="panel-help">No conversations yet - once customers start chatting, they'll show up here.</p>}
      {convos.length > 0 && (
        <div className="convo-layout">
          <div className="convo-list">
            {convos.map((c, i) => (
              <button key={i} className={`convo-item ${selected === i ? "convo-item--active" : ""}`} onClick={() => setSelected(i)}>
                <div>
                  <p className="convo-name">{timeAgo(c.created_at)}</p>
                  <p className="convo-preview">{c.customer_message}</p>
                </div>
                <span className={`badge ${c.escalated ? "badge--amber" : "badge--green"}`}>{c.escalated ? "Escalated" : "Resolved"}</span>
              </button>
            ))}
          </div>
          <div className="convo-thread panel">
            <div className="chat-bubble chat-bubble--customer">{convos[selected]?.customer_message}</div>
            <div className="chat-bubble chat-bubble--ai">{convos[selected]?.ai_reply}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalyticsPage({ user }) {
  const plan = user?.plan || "14-day trial";
  const tier = hasActivePremiumPlan(user) ? ANALYTICS_TIER[plan] ?? "basic" : "basic";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase
      .from("conversations")
      .select("customer_message, escalated, booking_intent, created_at")
      .eq("business_id", user.id)
      .gte("created_at", since)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Analytics load error:", error);
        setRows(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const total = rows.length;
  const escalatedCount = rows.filter((r) => r.escalated).length;
  const resolutionRate = total ? Math.round(((total - escalatedCount) / total) * 100) : 0;
  const bookingsCount = rows.filter((r) => r.booking_intent).length;

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach((r) => { dayCounts[new Date(r.created_at).getDay()] += 1; });
  const maxCount = Math.max(1, ...dayCounts);
  const bars = dayCounts.map((c) => Math.round((c / maxCount) * 100));

  const questionCounts = {};
  rows.forEach((r) => {
    const q = (r.customer_message || "").trim();
    if (!q) return;
    questionCounts[q] = (questionCounts[q] || 0) + 1;
  });
  const topQuestions = Object.entries(questionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Analytics</h1><p className="page-sub">What customers ask, and how well the AI answers. Last 30 days.</p></div></div>
      <div className="stat-grid">
        <StatCard label="Total conversations" value={loading ? "..." : String(total)} sub="last 30 days" />
        <StatCard label="Not escalated" value={loading ? "..." : `${resolutionRate}%`} accent />
        {tier === "advanced" && <StatCard label="Booking intents" value={loading ? "..." : String(bookingsCount)} sub="messages mentioning dates/booking" />}
      </div>
      {tier === "basic" ? (
        <div className="panel">
          <h2 className="panel-title">Advanced analytics is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) shows total conversations and resolution rate only. Upgrade to Professional or Business in Billing to unlock the day-by-day chart, top questions, and booking-intent tracking.
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2 className="panel-title">Conversations this month, by day of week</h2>
            <div className="bar-chart">
              {bars.map((v, i) => (
                <div key={i} className="bar-col">
                  <div className="bar" style={{ height: `${v}%` }} />
                  <span className="bar-label">{dayLabels[i]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2 className="panel-title">Top questions</h2>
            {topQuestions.length === 0 && <p className="panel-help">Not enough data yet.</p>}
            <ul className="top-list">
              {topQuestions.map(([q, count]) => (
                <li key={q}>{q.slice(0, 60)} <span className="mono">{count} ask{count === 1 ? "" : "s"}</span></li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function IntegrationsPage({ user }) {
  const plan = user?.plan || "14-day trial";
  const canConnect = hasActivePremiumPlan(user); // Server independently enforces this entitlement
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [testState, setTestState] = useState("idle");
  const [connectionError, setConnectionError] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled=false;
    staffApi("/integrations/whatsapp")
      .then(({connection})=>{
        if(cancelled)return;
        if(connection){setConnected(true);setPhoneNumberId(connection.phone_number_id||"");}
      })
      .catch(error=>{if(!cancelled)setConnectionError(error.message||"Connection status unavailable");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[user?.id]);

  const save=async()=>{
    if(!phoneNumberId.trim()||!accessToken.trim()){setConnectionError("Enter a phone number ID and a new access token.");return;}
    setConnectionError("");setTestState("testing");
    try {
      const {connection}=await staffApi("/integrations/whatsapp",{
        method:"PUT",body:JSON.stringify({phoneNumberId:phoneNumberId.trim(),accessToken:accessToken.trim()})
      });
      setConnected(true);setBusinessNumber(connection?.displayPhoneNumber||"");
      setAccessToken("");setSaveState("saved");
    }catch(error){setConnectionError(error.message||"Could not connect WhatsApp");}
    finally{setTestState("idle");}
  };
  const disconnect=async()=>{
    setConnectionError("");
    try{
      await staffApi("/integrations/whatsapp",{method:"DELETE"});
      setConnected(false);setPhoneNumberId("");setAccessToken("");setBusinessNumber("");
    }catch(error){setConnectionError(error.message||"Could not disconnect WhatsApp");}
  };

  const webhookUrl = typeof window !== "undefined"
    ? (import.meta.env.VITE_WHATSAPP_WEBHOOK_URL || "http://localhost:5174/webhook/whatsapp")
    : "";

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Integrations</h1><p className="page-sub">Connect WhatsApp so customers can message your real number, not just the web widget.</p></div></div>

      {!canConnect ? (
        <div className="panel">
          <h2 className="panel-title">WhatsApp connection is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) doesn't include WhatsApp. Upgrade to Professional or Business in Billing to connect a real WhatsApp number.
          </p>
        </div>
      ) : (
        <>
      <div className="panel">
        <h2 className="panel-title">WhatsApp {connected && <span className="badge badge--green" style={{ marginLeft: 8 }}>Connected</span>}</h2>
        {connected && businessNumber && <p className="panel-help">Verified number: {businessNumber}</p>}
        <p className="panel-help">
          From your Meta Developer app's WhatsApp -&gt; API Setup page, copy your Phone Number ID and access token below.
        </p>
        {loading ? (
          <p className="panel-help">Loading...</p>
        ) : (
          <div className="form-panel">
            <TextField label="Phone Number ID" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="e.g. 109876543210987" />
            <TextField label="Access token" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Paste your Meta access token" />
            {connectionError && <p className="auth-error">{connectionError}</p>}
            {saveState === "saved" && <p className="save-status">Saved successfully</p>}
            <div className="billing-actions">
              <button className="btn btn--amber" onClick={save} disabled={testState === "testing"}>{testState === "testing" ? "Verifying with Meta..." : connected ? "Update connection" : "Connect WhatsApp"}</button>
              {connected && <button className="btn btn--outline" onClick={disconnect}>Disconnect</button>}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Webhook setup (one-time, in Meta's dashboard)</h2>
        <p className="panel-help">
          In your Meta app's WhatsApp -&gt; Configuration page, set the Callback URL and Verify Token to these values, so Meta knows where to send incoming messages:
        </p>
        <div className="form-panel">
          <TextField label="Callback URL" value={webhookUrl} onChange={() => {}} />
          <p className="panel-help" style={{ marginTop: -8 }}>Meta must be able to reach this URL over HTTPS. Set VITE_WHATSAPP_WEBHOOK_URL to your deployed public webhook URL before connecting a production number.</p>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

export function BillingPage({ user, onUpdateUser }) {
  const [plan, setPlan] = useState(user?.plan || "14-day trial");
  const [billingPeriod, setBillingPeriod] = useState(user?.billingPeriod || "monthly");
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [message, setMessage] = useState(() => {
    if (user?.paymentStatus === "trial") {
      return user?.trialActive === false || new Date(user?.trialEndsAt || 0) <= new Date() ? "Your 14-day trial has expired." : "Your 14-day trial is active.";
    }
    if (user?.paymentStatus === "pending") return "Your payment is being confirmed by Paystack.";
    return "Choose a plan to get started.";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cancelScheduled, setCancelScheduled] = useState(user?.cancelAtPeriodEnd === true);

  const cancelAtPeriodEnd = async () => {
    if (!window.confirm("Keep your current paid access until the end of the purchased term, then stop?")) return;
    setError("");
    setIsSubmitting(true);
    try {
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error("Sign in again.");
      const response=await fetch(`${API_BASE_URL}/subscriptions/cancel-at-period-end`,{
        method:"POST",headers:{Authorization:`Bearer ${session.access_token}`},
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Unable to cancel subscription.");
      setMessage(`Cancellation scheduled. Access continues until ${new Date(result.paidThrough).toLocaleDateString()}.`);
      setCancelScheduled(true);
    }catch(error){setError(error.message||"Unable to save cancellation preference");}
    finally{setIsSubmitting(false);}
  };

  const trialEndsAt = user?.trialEndsAt ? new Date(user.trialEndsAt) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const isTrialExpired = user?.trialActive === false || trialEndsAt <= new Date();
  const daysLeft = Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24)));
  const planDetails = getPlanDetails(plan, "NGN", billingPeriod);

  // Real invoices - only ever created by the Paystack webhook after an
  // actual confirmed payment, never faked locally.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("invoices")
      .select("id, amount, currency, plan, billing_period, status, created_at")
      .eq("business_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) console.error("Invoices load error:", loadError);
        setInvoices(data || []);
        setInvoicesLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleActivate = async () => {
    if (plan === "14-day trial") {
      setError("A trial starts at registration and cannot be restarted. Select a paid plan.");
      return;
    }

    if (!user?.id || !user?.email) {
      setError("Missing account details - try logging in again.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in again.");
      const response = await fetch(`${API_BASE_URL}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          plan,
          billingPeriod,
          email: user.email,
          business: user.business,
          name: user.name,
          businessId: user.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Checkout could not be created.");
      }
      // Real redirect to Paystack's hosted checkout - no more instant
      // fake success. The plan only activates once the webhook confirms
      // a real payment actually went through.
      // Remember the exact plan so the return page cannot confuse an old
      // active subscription with a newly purchased upgrade.
      window.localStorage.setItem("nightline-plan-selection", JSON.stringify({
        plan, billingPeriod, mode: "paid", currency: "NGN",
      }));
      if (payload.reference) window.localStorage.setItem("ezeji-last-checkout-ref", payload.reference);
      window.location.href = payload.url;
    } catch (err) {
      setError(err.message || "Payment setup failed. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Billing</h1><p className="page-sub">Manage your plan and see real payment history.</p></div></div>
      <div className="panel current-plan">
        <div>
          <p className="stat-label">Current plan</p>
          <p className="current-plan-name">{user?.plan || plan} <span className="badge badge--amber">{user?.paymentStatus === "trial" ? (isTrialExpired ? "Trial expired" : `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`) : user?.paymentStatus === "active" ? "Active" : user?.paymentStatus === "pending" ? "Payment pending" : "Not yet activated"}</span></p>
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Change plan</h2>
        <p className="panel-help">Choosing a paid plan takes you to Paystack's real, secure checkout page - your plan only activates once payment is confirmed.</p>
        {user?.subscriptionEndsAt && (
          <p className="panel-help">Paid access through: {new Date(user.subscriptionEndsAt).toLocaleDateString()}.
            One-time purchases do not renew automatically.</p>
        )}
        {user?.paymentStatus === "active" && !cancelScheduled && (
          <button className="btn btn--outline" onClick={cancelAtPeriodEnd} disabled={isSubmitting}>
            Cancel at end of paid term
          </button>
        )}
        {cancelScheduled && <p className="panel-help">Cancellation scheduled for the end of your paid term.</p>}
        <div className="billing-form">
          <label className="field">
            <span className="field-label">Plan</span>
            <select className="field-input field-select" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {["14-day trial", "Starter", "Professional", "Business"].map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          {plan !== "14-day trial" && (
            <label className="field">
              <span className="field-label">Billing period</span>
              <select className="field-input field-select" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          )}
          <div className="panel" style={{ marginBottom: 16 }}>
            <p className="stat-label">Summary</p>
            <p className="current-plan-name">{plan === "14-day trial" ? "Free for 14 days" : `${planDetails.displayPrice}/${billingPeriod === "yearly" ? "year" : "month"}`}</p>
            <p className="panel-help">{plan === "14-day trial" ? "No payment required to start." : "Charged in NGN via Paystack."}</p>
          </div>
          <button className="btn btn--amber" onClick={handleActivate} disabled={isSubmitting}>{isSubmitting ? "Setting up..." : plan === "14-day trial" ? "Trial already used" : "Continue to Paystack"}</button>
          {error && <p className="auth-error">{error}</p>}
          {message && <p className="save-status">{message}</p>}
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Invoices</h2>
        {invoicesLoading && <p className="panel-help">Loading...</p>}
        {!invoicesLoading && !invoices.length && <p className="panel-help">No real payments yet - invoices appear here automatically once Paystack confirms a payment.</p>}
        {invoices.length > 0 && (
        <table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{new Date(invoice.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                <td>{invoice.plan}</td>
                <td className="mono">{invoice.currency} {(invoice.amount / 100).toLocaleString()}</td>
                <td><span className={`badge ${invoice.status === "paid" ? "badge--green" : "badge--amber"}`}>{invoice.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

export const DASHBOARD_PAGES = {
  overview: OverviewPage,
  profile: BusinessProfilePage,
  faqs: FAQsPage,
  services: ServicesPage,
  hours: HoursLocationPage,
  ai: AISettingsPage,
  staff: StaffPage,
  bookings: BookingsPage,
  conversations: ConversationsPage,
  analytics: AnalyticsPage,
  billing: BillingPage,
  integrations: IntegrationsPage,
};