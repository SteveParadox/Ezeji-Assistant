import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useConfirmation, EmptyState, Skeleton } from "../ui";
import { Plus, Trash2 } from "lucide-react";

export function FAQsPage({ user }) {
  const confirm = useConfirmation();
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ q: "", a: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
        if (error) setError("Could not load FAQs. Retry by returning to this page.");
        setFaqs(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  const add = async () => {
    if (saving || !user?.id) return;
    if (!draft.q.trim() || !draft.a.trim()) {
      setError("Enter both a question and its answer.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const { data, error: saveError } = await supabase.from("faqs")
        .insert({ business_id: user.id, question: draft.q.trim(), answer: draft.a.trim() })
        .select().single();
      if (saveError) throw saveError;
      setFaqs((current) => [...current, data]);
      setDraft({ q: "", a: "" });
    } catch {
      setError("Could not save this FAQ. Your text is still here; retry.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!user?.id || !await confirm({ title: "Delete this FAQ?", description: "The assistant will no longer use this saved answer. Your unfinished FAQ draft will stay here.", action: "Delete FAQ" })) return;
    setError("");
    try {
      const { data: removed, error: removeError } = await supabase.from("faqs").delete()
        .eq("business_id", user.id).eq("id", id).select("id").maybeSingle();
      if (removeError || removed?.id !== id) throw new Error("Deletion was not committed.");
      setFaqs((current) => current.filter((item) => item.id !== id));
    } catch {
      setError("Could not delete this FAQ. Nothing was removed from the list.");
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">FAQs</h1><p className="page-sub">Build a clear answer library from the questions your customers ask most.</p></div></div>
      <div className="panel">
        {error && <p className="auth-error" role="alert">{error}</p>}
        {loading && <Skeleton />}
        {!loading && !error && faqs.length === 0 && <EmptyState title="Build your answer library">Add the questions your customers ask most. Your assistant uses the answers you save.</EmptyState>}
        {faqs.map((f) => (
          <div key={f.id} className="faq-row">
            <div>
              <p className="faq-q">{f.question}</p>
              <p className="faq-a">{f.answer}</p>
            </div>
            <div className="row-actions">
              <button className="icon-btn" aria-label="Delete FAQ" onClick={() => remove(f.id)}><Trash2 className="icon-btn-icon" /></button>
            </div>
          </div>
        ))}
        <div className="faq-add">
          <input className="field-input" aria-label="New FAQ question" placeholder="New question" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} />
          <textarea rows={3} className="field-input field-textarea" aria-label="FAQ answer" placeholder="Answer" value={draft.a} onChange={(e) => setDraft((d) => ({ ...d, a: e.target.value }))} />
          <button className="btn btn--outline" onClick={add} disabled={saving}><Plus className="icon-btn-icon" /> {saving ? "Adding..." : "Add FAQ"}</button>
        </div>
      </div>
    </div>
  );
}

