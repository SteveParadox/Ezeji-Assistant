import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { API_BASE_URL, STAFF_LIMITS, CONVERSATION_LIMITS } from "../shared";
import { useConfirmation, Skeleton, TableFrame, StatusBadge } from "../ui";
import { getPlanDetails } from "../billingLogic";

export function BillingPage({ user }) {
  const confirm = useConfirmation();
  const [plan, setPlan] = useState(user?.plan || "14-day trial");
  const [billingPeriod, setBillingPeriod] = useState(user?.billingPeriod || "monthly");
  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [message, setMessage] = useState(() => {
    if (user?.paymentStatus === "trial") {
      return user?.trialActive === false || new Date(user?.trialEndsAt || 0) <= new Date() ? "Your 14-day trial has expired." : "Your 14-day trial is active.";
    }
    if (user?.paymentStatus === "pending") return "Your payment is being confirmed by Paystack.";
    if (user?.paymentStatus === "active") return "Your paid subscription is active. Purchases do not renew automatically.";
    if (user?.paymentStatus === "expired") return "Your subscription term has expired. A new verified payment is required for paid access.";
    return "Choose a plan to get started.";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cancelScheduled, setCancelScheduled] = useState(user?.cancelAtPeriodEnd === true);

  const cancelAtPeriodEnd = async () => {
    if (!await confirm({ title: "End access after your paid term?", description: "Your current paid access remains available until the purchased term ends. One-time payments do not renew automatically.", action: "Schedule cancellation" })) return;
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

  const trialEndsAt = user?.trialEndsAt ? new Date(user.trialEndsAt) : null;
  const isTrialExpired = !trialEndsAt || user?.trialActive === false || trialEndsAt <= new Date();
  const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
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
        if (loadError) setError("Could not load invoice history. Return to Billing to retry.");
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
          <p className="current-plan-name">{user?.plan || plan} <span className="badge badge--amber">{user?.paymentStatus === "trial" ? (isTrialExpired ? "Trial expired" : `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`) : user?.paymentStatus === "active" ? "Active" : user?.paymentStatus === "pending" ? "Payment pending" : user?.paymentStatus === "expired" ? "Expired" : "Not yet activated"}</span></p>
        </div>
      </div>
      <div className="billing-layout">
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
          <div className="billing-summary">
            <p className="stat-label">One-time purchase</p>
            <p className="current-plan-name">{plan === "14-day trial" ? "Free for 14 days" : `${planDetails.displayPrice}/${billingPeriod === "yearly" ? "year" : "month"}`}</p>
            <ul className="plan-entitlements"><li>{CONVERSATION_LIMITS[plan] === Infinity ? "Unlimited" : CONVERSATION_LIMITS[plan]?.toLocaleString()} AI requests {plan === "14-day trial" ? "during the trial" : "per UTC month"}</li>
              <li>{STAFF_LIMITS[plan] === Infinity ? "Unlimited staff seats" : STAFF_LIMITS[plan] > 1 ? `${STAFF_LIMITS[plan]} staff seat allowance` : "Business owner workspace"}</li></ul>
            <p className="panel-help">{plan === "14-day trial" ? "Your trial starts once at registration. It cannot be restarted." : "Charged in NGN via Paystack. No automatic renewal."}</p>
          </div>
          <button className="btn btn--amber" onClick={handleActivate} disabled={isSubmitting || plan === "14-day trial"}>{isSubmitting ? "Setting up..." : plan === "14-day trial" ? "Trial already used" : "Continue to Paystack"}</button>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="panel-help billing-notice" role="status">{message}</p>}
        </div>
      </div>
      <div className="panel">
        <h2 className="panel-title">Invoices</h2>
        {invoicesLoading && <Skeleton />}
        {!invoicesLoading && !error && !invoices.length && <p className="panel-help">No real payments yet - invoices appear here automatically once Paystack confirms a payment.</p>}
        {invoices.length > 0 && (
        <TableFrame label="Saved business records"><table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{new Date(invoice.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                <td>{invoice.plan}</td>
                <td className="mono">{invoice.currency} {(invoice.amount / 100).toLocaleString()}</td>
                <td><StatusBadge status={invoice.status} /></td>
              </tr>
            ))}
          </tbody>
        </table></TableFrame>
        )}
      </div>
      </div>
    </div>
  );
}

