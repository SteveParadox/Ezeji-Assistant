import React, { useEffect, useState } from "react";
import { STAFF_LIMITS } from "../shared";
import { useConfirmation, Skeleton } from "../ui";
import { Plus, Trash2 } from "lucide-react";
import { hasActivePremiumPlan } from "../planAccess";
import { workspaceApi } from "../workspaceApi";

export function StaffPage({ user }) {
  const confirm = useConfirmation();
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
    workspaceApi("/staff")
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
      const { staffMember, inviteSent, inviteUrl } = await workspaceApi("/staff/invite", {
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
    if (!await confirm({ title: "Remove this staff member?", description: "They will lose access to this business workspace.", action: "Remove staff" })) return;
    setError("");
    try {
      await workspaceApi(`/staff/${encodeURIComponent(id)}`, { method: "DELETE" });
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
          <Skeleton />
        ) : (
          <>
            {!error && <p className="panel-help">{staff.length} of {limit === Infinity ? "unlimited" : limit} seats used</p>}
            {staff.map((s) => (
              <div key={s.id} className="faq-row">
                <p className="faq-q">{s.email}</p>
                <div className="row-actions">
                  <button className="icon-btn" aria-label={`Remove ${s.email}`} onClick={() => remove(s.id)}><Trash2 className="icon-btn-icon" /></button>
                </div>
              </div>
            ))}
            <div className="faq-add" style={{ marginTop: 16 }}>
              <input type="email" aria-label="Staff email address" className="field-input" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn btn--outline" onClick={invite} disabled={saving || atLimit}>
                <Plus className="icon-btn-icon" /> {saving ? "Sending invite..." : "Invite staff"}
              </button>
            </div>
            {notice && <p className="save-status" role="status">{notice}</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
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

