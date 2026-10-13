import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useConfirmation, EmptyState, Skeleton, TableFrame } from "../ui";
import { Plus, Trash2 } from "lucide-react";

export function ServicesPage({ user }) {
  const confirm = useConfirmation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: "", price: "", duration: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
        if (error) setError("Could not load services. Retry by returning to this page.");
        setItems(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const add = async () => {
    if (saving || !user?.id) return;
    if (!draft.name.trim()) {
      setError("Enter a service name before adding it.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const { data, error: saveError } = await supabase.from("services")
        .insert({ business_id: user.id, name: draft.name.trim(), price: draft.price.trim(), duration: draft.duration.trim() })
        .select().single();
      if (saveError) throw saveError;
      setItems((current) => [...current, data]);
      setDraft({ name: "", price: "", duration: "" });
    } catch {
      setError("Could not save this service. Your entry has been retained.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!user?.id || !await confirm({ title: "Delete this service?", description: "Remove this item from the services your assistant can offer. Existing booking records are kept.", action: "Delete service" })) return;
    setError("");
    try {
      const { data: removed, error: removeError } = await supabase.from("services").delete()
        .eq("business_id", user.id).eq("id", id).select("id").maybeSingle();
      if (removeError || removed?.id !== id) throw new Error("Deletion was not committed.");
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      setError("Could not delete this service. Nothing was removed from the list.");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Services & Pricing</h1><p className="page-sub">Keep your catalog current with real services, prices, and durations.</p></div></div>
      <div className="panel">
        {error && <p className="auth-error" role="alert">{error}</p>}
        {loading && <Skeleton />}
        {!loading && !error && items.length === 0 && <EmptyState title="Add your first service">List real prices and durations so customers know what you offer.</EmptyState>}
        {items.length > 0 && (
          <TableFrame label="Saved business records"><table className="table">
            <thead><tr><th>Item</th><th>Price</th><th>Duration</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="mono">{it.price}</td>
                  <td>{it.duration}</td>
                  <td className="row-actions">
                    <button className="icon-btn" aria-label="Delete service" onClick={() => remove(it.id)}><Trash2 className="icon-btn-icon" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></TableFrame>
        )}
        <div className="faq-add" style={{ marginTop: 16 }}>
          <input className="field-input" aria-label="Service name" placeholder="Service name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          <input className="field-input" aria-label="Service price" placeholder="Price (NGN 15000)" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
          <input className="field-input" aria-label="Service duration" placeholder="Duration (45 min)" value={draft.duration} onChange={(e) => setDraft((d) => ({ ...d, duration: e.target.value }))} />
          <button className="btn btn--outline" onClick={add} disabled={saving}><Plus className="icon-btn-icon" /> {saving ? "Adding..." : "Add item"}</button>
        </div>
      </div>
    </div>
  );
}

