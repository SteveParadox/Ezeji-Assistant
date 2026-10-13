import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCsv, timeAgo } from "../shared";
import { EmptyState, Skeleton, StatusBadge } from "../ui";
import { Search, MessageCircle } from "lucide-react";
import { hasActivePremiumPlan } from "../planAccess";
import { fetchAllPages } from "../dataPaging";
import { filterConversations } from "../workspaceFilters";

export function ConversationsPage({ user }) {
  const canExport = user?.isStaff || hasActivePremiumPlan(user);
  const [convos, setConvos] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("conversations")
      .select("id, customer_message, ai_reply, escalated, created_at")
      .eq("business_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setLoadError("Could not load customer conversations. Return to this page to retry.");
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
        { label: "Status", get: (r) => (r.escalated ? "Escalated" : "Not escalated") },
      ]);
    } catch (error) {
      console.error("Conversation export error:", error);
      setExportError("Couldn't export conversations. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };


  const visible = filterConversations(convos, query, status);
  const current = visible.find(row => row.id === selectedId) || visible[0];
  return <div>
    <div className="page-header"><div><h1 className="page-title">Conversations</h1>
      <p className="page-sub">Review the latest 50 saved message exchanges. Escalation flags identify messages that need attention.</p></div>
      {canExport && convos.length > 0 && <button className="btn btn--outline" onClick={exportCsv} disabled={isExporting}>{isExporting ? "Preparing CSV..." : "Export all conversations"}</button>}
    </div>
    {(loadError || exportError) && <p className="auth-error" role="alert">{loadError || exportError}</p>}
    <div className="filter-toolbar"><label className="search-field"><span className="sr-only">Search conversations</span><Search size={16} aria-hidden="true" />
      <input className="field-input" placeholder="Search messages and replies" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select className="field-input" aria-label="Conversation status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">All conversations</option><option value="escalated">Escalated</option><option value="not-escalated">Not escalated</option>
      </select><p className="filter-count" role="status">{loading ? "Loading..." : loadError ? "Unavailable" : `${visible.length} exchanges`}</p>
    </div>
    {loading ? <Skeleton lines={4} /> : !loadError && !visible.length ? <div className="panel"><EmptyState title={convos.length ? "No matching messages" : "Your customer inbox is ready"} icon={MessageCircle}>
      {convos.length ? "Try another search or filter." : "Saved customer conversations will appear here. You can review exchanges without sending new messages."}</EmptyState></div> : null}
    {!!visible.length && <div className="convo-layout"><div className="convo-list" role="region" aria-label="Saved conversations">
      {visible.map(row => <button type="button" key={row.id} className={`convo-item ${current?.id === row.id ? "convo-item--active" : ""}`}
        aria-pressed={current?.id === row.id} onClick={() => setSelectedId(row.id)}>
        <div><p className="convo-name"><time dateTime={row.created_at}>{timeAgo(row.created_at)}</time></p><p className="convo-preview">{row.customer_message}</p></div>
        <StatusBadge status={row.escalated ? "escalated" : "not escalated"} /></button>)}
    </div><section className="convo-thread panel" aria-label="Selected message exchange">
      <div className="thread-header"><time dateTime={current.created_at}>{new Date(current.created_at).toLocaleString()}</time><StatusBadge status={current.escalated ? "escalated" : "not escalated"} /></div>
      <div className="thread-message"><p className="thread-label">Customer</p><div className="chat-bubble chat-bubble--customer">{current.customer_message}</div></div>
      <div className="thread-message thread-message--ai"><p className="thread-label">Assistant</p><div className="chat-bubble chat-bubble--ai">{current.ai_reply || "No assistant reply was saved."}</div></div>
      <p className="panel-help">Saved exchange · This view is read-only.</p>
    </section></div>}
  </div>;
}

