import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCsv } from "../shared";
import { useConfirmation, EmptyState, Skeleton, TableFrame, StatusBadge } from "../ui";
import { Trash2, Search, CalendarDays } from "lucide-react";
import { hasActivePremiumPlan } from "../planAccess";
import { filterBookings } from "../workspaceFilters";
import { fetchAllPages } from "../dataPaging";

export function BookingsPage({ user }) {
  const confirm = useConfirmation();
  const canManageBookings = user?.isStaff || hasActivePremiumPlan(user);
  const canExport = canManageBookings;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [updating, setUpdating] = useState(null);

  useEffect(() => {
    if (!user?.id || !canManageBookings) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAllPages((offset, limit) => supabase
      .from("bookings")
      .select("id, customer_name, customer_contact, service, booking_date, booking_time, notes, status, created_at", { count: offset === 0 ? "exact" : undefined })
      .eq("business_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1)
    ).then((data) => {
      if (cancelled) return;
      setBookings(data);
    }).catch(() => {
      if (!cancelled) setError("Could not load all bookings. Retry by reopening this page.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, canManageBookings]);

  const updateStatus = async (id, status) => {
    if (updating) return;
    setUpdating(id);
    setError("");
    try {
      const { data, error } = await supabase.from("bookings")
        .update({ status }).eq("id", id).eq("business_id", user.id)
        .select("id,status").maybeSingle();
      if (error || !data) throw new Error("Booking update was not saved.");
      setBookings(rows => rows.map(row => row.id === id ? { ...row, status: data.status } : row));
    } catch {
      setError("Booking update was not saved. Another booking may already occupy that time.");
    } finally {
      setUpdating(null);
    }
  };

  const cancelBooking = async (id) => {
    if (!await confirm({ title: "Cancel this appointment?", description: "The appointment record will be preserved. Its status changes only after the update is saved.", action: "Cancel appointment" })) return;
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

  const visibleBookings = filterBookings(bookings, query, status);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Bookings</h1><p className="page-sub">Review customer appointment requests and save staff confirmations.</p></div>
        {canExport && bookings.length > 0 && (
          <button className="btn btn--outline" onClick={exportCsv}>Export CSV</button>
        )}
      </div>
      {!canManageBookings ? (
        <div className="panel"><p className="panel-title">Booking management requires an active Professional or Business plan.</p><p className="panel-help">Starter includes booking request capture. Upgrade in Billing to view and manage confirmed bookings.</p></div>
      ) : (
      <div className="panel">
        <div className="filter-toolbar"><label className="search-field"><span className="sr-only">Search bookings</span><Search size={16} />
          <input className="field-input" placeholder="Search customer, service or date" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <select className="field-input" aria-label="Booking status" value={status} onChange={event => setStatus(event.target.value)}>
            {["all", "pending", "confirmed", "canceled"].map(value => <option key={value} value={value}>{value === "all" ? "All statuses" : value}</option>)}
          </select></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {loading && <Skeleton />}
        {!loading && !error && bookings.length === 0 && <EmptyState title="No appointment requests yet" icon={CalendarDays}>Requests appear here for staff review. They are not confirmed until you save a confirmation.</EmptyState>}
        {!loading && bookings.length > 0 && visibleBookings.length === 0 && <EmptyState title="No matching requests">Try another search or status filter.</EmptyState>}
        {visibleBookings.length > 0 && (
          <TableFrame label="Saved business records"><table className="table">
            <thead><tr><th>Customer</th><th>Service</th><th>Date</th><th>Time</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {visibleBookings.map((b) => (
                <tr key={b.id}>
                  <td>{b.customer_name || "-"}{b.customer_contact ? ` (${b.customer_contact})` : ""}</td>
                  <td>{b.service}</td>
                  <td>{b.booking_date}</td>
                  <td className="mono">{b.booking_time}</td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="row-actions">
                    {b.status === "pending" && (
                      <button className="btn btn--outline" disabled={updating !== null} onClick={async () => { if (await confirm({ title: "Confirm this request?", tone: "primary", description: "Confirm only after your team has reviewed availability. The saved status remains authoritative.", action: "Confirm booking" })) await updateStatus(b.id, "confirmed"); }}>Confirm</button>
                    )}
                    {["pending","confirmed"].includes(b.status) && (
                      <button className="icon-btn" disabled={updating !== null} onClick={() => cancelBooking(b.id)} aria-label="Cancel booking" title="Cancel booking"><Trash2 className="icon-btn-icon" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></TableFrame>
        )}
      </div>
      )}
    </div>
  );
}

