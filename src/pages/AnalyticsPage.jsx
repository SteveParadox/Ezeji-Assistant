import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { StatCard, ANALYTICS_TIER } from "../shared";
import { EmptyState, Skeleton } from "../ui";
import { hasActivePremiumPlan } from "../planAccess";
import { fetchAllPages } from "../dataPaging";

export function AnalyticsPage({ user }) {
  const plan = user?.plan || "14-day trial";
  const tier = hasActivePremiumPlan(user) ? ANALYTICS_TIER[plan] ?? "basic" : "basic";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true); setError(""); setRows([]);
    const since = new Date(Date.now() - period * 86400000).toISOString();
    fetchAllPages((offset, limit) => supabase.from("conversations")
      .select("id,customer_message,escalated,booking_intent,created_at", { count: offset === 0 ? "exact" : undefined })
      .eq("business_id", user.id).gte("created_at", since)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit - 1))
      .then(data => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) { setRows([]); setError("Could not load analytics. Choose a period to retry."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, period]);

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
      <div className="page-header"><div><h1 className="page-title">Analytics</h1><p className="page-sub">What customers ask, and how well the AI answers. Last {period} days.</p></div></div>
      <div className="filter-toolbar"><label className="field-label" htmlFor="analytics-period">Reporting period</label>
        <select id="analytics-period" className="field-input" value={period} onChange={event => setPeriod(Number(event.target.value))}>
          {[7,30,90].map(days => <option key={days} value={days}>Last {days} days</option>)}
        </select></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="stat-grid">
        <StatCard label="Total conversations" value={error ? "—" : String(total)} loading={loading} sub={`last ${period} days`} />
        <StatCard label="Not escalated" value={error ? "—" : `${resolutionRate}%`} loading={loading} accent />
        {tier === "advanced" && <StatCard label="Booking intents" value={error ? "—" : String(bookingsCount)} loading={loading} sub="messages mentioning dates/booking" />}
      </div>
      {tier === "basic" ? (
        <div className="panel">
          <h2 className="panel-title">Advanced analytics is a Professional feature</h2>
          <p className="panel-help">
            Your current plan ({plan}) shows total conversations and non-escalation rate only. Upgrade to Professional or Business in Billing to unlock the day-by-day chart, top questions, and booking-intent tracking.
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2 className="panel-title">Conversation volume by weekday · last {period} days</h2>
            {loading ? <Skeleton /> : error ? <p className="panel-help">Chart unavailable.</p> : !total ? <EmptyState title="No activity in this period">Choose a longer period, or return after customer conversations have been saved.</EmptyState> : <div className="bar-chart" role="img" aria-label={dayCounts.map((count,i) => `${dayLabels[i]}: ${count}`).join(", ")}>
              {bars.map((v, i) => (
                <div key={i} className="bar-col">
                  <span className="bar-count">{dayCounts[i]}</span><div className="bar" style={{ height: `${v * 1.4}px` }} />
                  <span className="bar-label">{dayLabels[i]}</span>
                </div>
              ))}
            </div>}
          </div>
          <div className="panel">
            <h2 className="panel-title">Top questions</h2>
            {!loading && !error && topQuestions.length === 0 && <p className="panel-help">Not enough data yet.</p>}
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

