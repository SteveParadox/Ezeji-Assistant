import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { StatCard, timeAgo, CONVERSATION_LIMITS } from "../shared";
import { EmptyState, Skeleton, StatusBadge } from "../ui";
import { Bot, ArrowRight, CalendarDays, MessageCircle } from "lucide-react";
import { workspaceApi } from "../workspaceApi";
import { hasActivePremiumPlan } from "../planAccess";

export function OverviewPage({ user, onNavigate }) {
  const [recent, setRecent] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ today: 0, escalated: 0, yesterday: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState("");
  const [revision, setRevision] = useState(0);
  const plan = user?.plan || "14-day trial";
  const conversationLimit = CONVERSATION_LIMITS[plan] ?? CONVERSATION_LIMITS["14-day trial"];
  const usageCount = usage ? usage.consumed + usage.reserved : null;
  const usagePct = usageCount === null || conversationLimit === Infinity ? 0 : Math.min(100, (usageCount / conversationLimit) * 100);
  const canViewBookings = hasActivePremiumPlan(user);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true); setError(""); setUsageError(""); setUsage(null);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).gte("created_at", today),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).eq("escalated", true).gte("created_at", today),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id).gte("created_at", yesterday).lt("created_at", today),
      supabase.from("conversations").select("id,customer_message,escalated,created_at").eq("business_id", user.id).order("created_at", { ascending: false }).limit(5),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", user.id),
      canViewBookings ? supabase.from("bookings").select("id,customer_name,service,booking_date,status").eq("business_id", user.id).order("created_at", { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
    ]).then(([todayRes, escalatedRes, yesterdayRes, recentRes, totalRes, bookingsRes]) => {
      if (cancelled) return;
      if ([todayRes, escalatedRes, yesterdayRes, recentRes, totalRes, bookingsRes].some(result => result.error)) {
        throw new Error("Business activity could not be loaded. Refresh to try again.");
      }
      setStats({ today: todayRes.count ?? 0, escalated: escalatedRes.count ?? 0, yesterday: yesterdayRes.count ?? 0, total: totalRes.count ?? 0 });
      setRecent(recentRes.data || []); setBookings(bookingsRes.data || []);
    }).catch(loadError => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    workspaceApi("/owner/ai-usage").then(data => { if (!cancelled) setUsage(data); })
      .catch(() => { if (!cancelled) setUsageError("Current AI usage is unavailable. Refresh to try again."); });
    return () => { cancelled = true; };
  }, [user?.id, plan, canViewBookings, revision]);

  const metric = value => error ? "—" : String(value);
  return <div>
    <div className="page-header"><div><h1 className="page-title">Your business at a glance</h1>
      <p className="page-sub">Review customer activity, keep an eye on usage, and decide what needs your attention.</p></div>
      <button type="button" className="btn btn--outline" onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh activity</button></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="stat-grid">
      <StatCard label="Conversations today" value={metric(stats.today)} loading={loading} sub={error ? "Unavailable" : `${stats.today - stats.yesterday >= 0 ? "+" : ""}${stats.today - stats.yesterday} vs yesterday`} />
      <StatCard label="Conversation volume" value={metric(stats.total)} loading={loading} sub="All logged messages" />
      <StatCard label="Escalated messages" value={metric(stats.escalated)} loading={loading} sub="Flagged today for review" accent />
      <StatCard label="AI usage" value={usageCount === null ? "—" : String(usageCount)} sub={plan === "14-day trial" ? "Trial allowance used or reserved" : "This month (UTC), used or reserved"} />
    </div>
    <div className="overview-columns"><div>
      <section className="panel"><div className="panel-heading"><h2 className="panel-title">Recent conversations</h2>
        <button className="link-btn" onClick={() => onNavigate?.("conversations")}>View inbox <ArrowRight size={14} /></button></div>
        {loading ? <Skeleton /> : error ? <p className="panel-help">Activity is unavailable until it can be loaded.</p> : recent.length === 0 ?
          <EmptyState title="Your inbox starts here" icon={MessageCircle}>Customer messages will appear here when conversations are saved.</EmptyState> :
          recent.map(row => <div key={row.id} className="activity-row"><span className="activity-icon"><MessageCircle size={16} /></span><div className="activity-copy">
            <p>{row.customer_message}</p><div className="activity-meta"><StatusBadge status={row.escalated ? "escalated" : "not escalated"} />
            <time dateTime={row.created_at}>{timeAgo(row.created_at)}</time></div></div></div>)}
      </section>
      <section className="panel"><div className="panel-heading"><h2 className="panel-title">Booking activity</h2>
        <button className="link-btn" onClick={() => onNavigate?.("bookings")}>View bookings <ArrowRight size={14} /></button></div>
        {!canViewBookings ? <p className="panel-help">Booking management is available with an active Professional or Business plan.</p> : loading ? <Skeleton lines={2} /> : error ?
          <p className="panel-help">Bookings could not be loaded.</p> : bookings.length === 0 ? <EmptyState title="No booking requests yet" icon={CalendarDays}>New appointment requests remain pending until staff confirm them.</EmptyState> :
          bookings.map(row => <div className="activity-row" key={row.id}><span className="activity-icon"><CalendarDays size={16} /></span><div className="activity-copy">
            <p>{row.customer_name || "Customer"} · {row.service}</p><div className="activity-meta"><StatusBadge status={row.status} /><span>{row.booking_date}</span></div></div></div>)}
      </section></div><div>
      <section className="panel"><p className="panel-eyebrow">Your allowance</p><h2 className="panel-title">{plan}</h2>
        <p className="usage-value">{usageCount === null ? "—" : usageCount.toLocaleString()} <span className="stat-sub">/ {conversationLimit === Infinity ? "unlimited" : conversationLimit.toLocaleString()}</span></p>
        {usage && conversationLimit !== Infinity && <progress value={usagePct} max={100} aria-label="AI allowance used or reserved" />}
        <p className="panel-help">Successful requests and in-flight reservations are counted, including private previews.</p>
        {usageError && <p className="auth-error" role="alert">{usageError}</p>}
        {usage && usagePct >= 80 && <p className="auth-error" role="status">{usagePct >= 100 ? "Your AI allowance has been reached." : "Your AI allowance is nearly used."} Review Billing before continuing.</p>}
        <button className="btn btn--outline" onClick={() => onNavigate?.("billing")}>Manage plan</button></section>
      <section className="panel quick-action-card"><span className="empty-state-icon"><Bot size={22} /></span><h2 className="panel-title" style={{ marginTop: 16 }}>Fine-tune your assistant</h2>
        <p className="panel-help">Review saved settings and try a private conversation before sharing your customer link.</p>
        <button className="btn btn--amber" onClick={() => onNavigate?.("ai")}>Open assistant preview <ArrowRight size={15} /></button>
        <button className="link-btn" style={{ marginTop: 16 }} onClick={() => onNavigate?.("gettingStarted")}>Review setup checklist <ArrowRight size={14} /></button></section>

    </div></div>
  </div>;
}

