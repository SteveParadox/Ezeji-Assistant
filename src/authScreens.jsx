import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import { getPlanDetails } from "./billingLogic";
import { Mail, Lock, CheckCircle2, Building2 } from "lucide-react";
import { TextField, AuthShell, getStoredPlanSelection, fetchProfile } from "./shared";
import { callbackUrl, ensureBusinessProfile, registerBusiness, getRegistrationDetails, startAuthenticatedCheckout, selectedPaidPlan, RECOVERY_FLAG } from "./authLifecycle";

export function LoginScreen({ go, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setIsSubmitting(false);
        return;
      }

      // The single auth-state listener in NightlineApp resolves the business
      // before routing to the dashboard or checkout.
      if (!data.session) throw new Error("Your email must be verified before signing in.");
    } catch (loginError) {
      console.error("sign-in error:", loginError);
      setError(loginError.message || "Unable to sign in right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      footer={
        <>
          Don't have an account?{" "}
          <button className="link-btn" onClick={() => go("signup")}>Sign up</button>
        </>
      }
    >
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Log in to manage your business assistant.</p>
      <div className="auth-form">
        <TextField label="Email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        <TextField label="Password" type="password" icon={Lock} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" />
        <button className="link-btn link-btn--right" onClick={() => go("forgot")}>Forgot password?</button>
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Logging in..." : "Log in"}
        </button>
        <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </div>
    </AuthShell>
  );
}

export function SignupScreen({ go, onLogin }) {
  const [form, setForm] = useState(() => {
    const selection = getStoredPlanSelection();
    return {
      name: "",
      business: "",
      businessType: "Restaurant",
      customBusinessType: "",
      email: "",
      password: "",
      serviceName: "",
      price: "",
      hours: "",
      description: "",
      selectedPlan: selection.plan || "14-day trial",
      selectedMode: selection.mode || "trial",
      selectedBillingPeriod: selection.billingPeriod || "monthly",
      selectedCurrency: selection.currency || "USD",
    };
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const result = await registerBusiness(form);
      if (!result.session) {
        go("verify", { email: result.email });
        return;
      }
      // With confirmation disabled Supabase signs in immediately.
      // The app's auth-state manager provisions the owner account.
    } catch (err) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      footer={
        <>
          Already have an account?{" "}
          <button className="link-btn" onClick={() => go("login")}>Log in</button>
        </>
      }
    >
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">Start your 14-day free trial. No card required.</p>
      <div className="auth-form">
        <TextField label="Your name" value={form.name} onChange={set("name")} placeholder="Maya Reyes" />
        <TextField label="Business name" icon={Building2} value={form.business} onChange={set("business")} placeholder="Bloom & Co. Salon" />
        <label className="field">
          <span className="field-label">Business type</span>
          <select className="field-input field-select" value={form.businessType} onChange={set("businessType")}>
            {[
              "Restaurant",
              "Salon & Beauty",
              "Hotel",
              "Clinic",
              "Laundry",
              "Gym",
              "Real Estate",
              "Other",
            ].map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        {form.businessType === "Other" && (
          <TextField label="Custom business type" value={form.customBusinessType} onChange={set("customBusinessType")} placeholder="Wedding planner, moving company, tutoring, etc." />
        )}
        <TextField label="Email" type="email" icon={Mail} value={form.email} onChange={set("email")} placeholder="you@business.com" />
        <TextField label="Service name" value={form.serviceName} onChange={set("serviceName")} placeholder="Services your business offers" />
        <TextField label="Price" value={form.price} onChange={set("price")} placeholder="$180" />
        <TextField label="Hours" value={form.hours} onChange={set("hours")} placeholder="Mon-Sat 9:00 AM - 6:00 PM" />
        <label className="field">
          <span className="field-label">Describe your work</span>
          <textarea className="field-input field-textarea" rows={3} value={form.description} onChange={set("description")} placeholder="Tell the assistant about your services, style, or specialties like dreadlocks, loc maintenance, twists, and consultations." />
        </label>
        <TextField label="Password" type="password" icon={Lock} value={form.password} onChange={set("password")} placeholder="********" />
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Sign Up"}
        </button>
        <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </div>
    </AuthShell>
  );
}

export function CheckoutScreen({ go, user }) {
  const selection = selectedPaidPlan(getStoredPlanSelection());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const planDetails = selection ? getPlanDetails(selection.plan, "NGN", selection.billingPeriod) : null;

  const handlePay = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = await startAuthenticatedCheckout(session, selection);
      window.location.assign(url);
    } catch (err) {
      setError(err.message || "Payment setup failed. Please retry.");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("landing")}>Back to landing</button>}>
      <h1 className="auth-title">Secure checkout</h1>
      <p className="auth-sub">Your business must be verified before Paystack checkout.</p>
      <div className="auth-form">
        {selection && <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <p className="stat-label">{selection.plan} plan</p>
          <p className="current-plan-name">{planDetails.displayPrice}/{selection.billingPeriod === "yearly" ? "year" : "month"}</p>
        </div>}
        {!user ? (
          <>
            <p className="panel-help">Create your account or sign in to continue. Your plan will be saved.</p>
            <button className="btn btn--amber btn--full" onClick={() => go("signup")}>Create account</button>
            <button className="link-btn" onClick={() => go("login")}>Already registered? Log in</button>
          </>
        ) : user.isStaff ? (
          <p className="auth-error">Only a business owner can manage subscription checkout.</p>
        ) : user.paymentStatus === "active" && user.plan === selection?.plan ? (
          <>
            <p>You're already subscribed to this plan.</p>
            <button className="btn btn--amber btn--full" onClick={() => go("dashboard")}>Dashboard</button>
          </>
        ) : (
          <button className="btn btn--amber btn--full btn--lg" disabled={submitting || !selection} onClick={handlePay}>
            {submitting ? "Connecting to Paystack..." : "Continue to Paystack"}
          </button>
        )}
        {error && <p className="auth-error">{error}</p>}
      </div>
    </AuthShell>
  );
}

export function ForgotScreen({ go }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(), { redirectTo: callbackUrl("recovery") }
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not request a password reset.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("login")}>Back to log in</button>}>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">
        {sent ? "Check your inbox for a reset link." : "Enter your email and we'll send you a reset link."}
      </p>
      {!sent ? (
        <div className="auth-form">
          <TextField label="Email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
          {error && <p className="auth-error">{error}</p>}
          <button className="btn btn--amber btn--full btn--lg" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
          <button className="link-btn" onClick={() => go("landing")}>Back to landing</button>
        </div>
      ) : (
        <div className="reset-sent">
          <CheckCircle2 className="reset-sent-icon" />
          <p>We sent a link to <strong>{email || "your email"}</strong>.</p>
        </div>
      )}
    </AuthShell>
  );
}

export function VerificationPendingScreen({ go, email }) {
  const [address, setAddress] = useState(email || "");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    if (!address.trim() || busy) return;
    setBusy(true);
    setState("");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: address.trim().toLowerCase(),
        options: { emailRedirectTo: callbackUrl("confirm") },
      });
      if (error) throw error;
      setState("If the account is awaiting verification, another email has been requested.");
    } catch (err) {
      setState(err.message || "Resend failed. Try again later.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("login")}>Back to login</button>}>
      <h1 className="auth-title">Check your email</h1>
      <p className="auth-sub">Confirm your email address, then return to Ezeji Assistant. We will continue your business setup and selected plan.</p>
      <div className="auth-form">
        <TextField label="Registration email" type="email" icon={Mail} value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn btn--amber btn--full" onClick={resend} disabled={busy}>{busy ? "Sending..." : "Resend confirmation"}</button>
        {state && <p role="status">{state}</p>}
        <button className="link-btn" onClick={() => go("login")}>Already verified? Log in</button>
      </div>
    </AuthShell>
  );
}

export function ResetPasswordScreen({ go }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (busy) return;
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Recovery session expired. Request another reset link.");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      sessionStorage.removeItem(RECOVERY_FLAG);
      setDone(true);
      setPassword("");
      setConfirm("");
      await supabase.auth.signOut();
    } catch (err) {
      setError(err.message || "Password update failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("login")}>Back to login</button>}>
      <h1 className="auth-title">Choose a new password</h1>
      {done ? (
        <div className="auth-form">
          <p>Your password has been changed. Sign in with your new password.</p>
          <button className="btn btn--amber btn--full" onClick={() => go("login")}>Log in</button>
        </div>
      ) : (
        <div className="auth-form">
          <TextField label="New password (8+ characters)" type="password" icon={Lock} value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Confirm new password" type="password" icon={Lock} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="btn btn--amber btn--full btn--lg" disabled={busy} onClick={save}>{busy ? "Saving..." : "Update password"}</button>
        </div>
      )}
    </AuthShell>
  );
}

export function BusinessSetupScreen({ go, session, onReady }) {
  const defaults = getRegistrationDetails(session?.user) || {};
  const [form, setForm] = useState({ name: defaults.name || "", business: defaults.business || "", businessType: defaults.businessType || "Other" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    if (!form.business.trim()) { setError("Enter your business name."); return; }
    setBusy(true);
    setError("");
    try {
      await ensureBusinessProfile(session, form);
      const profile = await fetchProfile(session.user.id, session.user.email, session.user.user_metadata);
      if (!profile) throw new Error("Business setup is pending. Please retry.");
      onReady(profile);
    } catch (err) {
      setError(err.message || "Business setup failed. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell footer={<button className="link-btn" onClick={() => supabase.auth.signOut().then(() => go("login"))}>Use another account</button>}>
      <h1 className="auth-title">Complete business setup</h1>
      <p className="auth-sub">Your account is verified. Provide the missing business details to continue to your saved plan.</p>
      <div className="auth-form">
        <TextField label="Your name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Business name" icon={Building2} value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))} />
        <button className="btn btn--amber btn--full" onClick={submit} disabled={busy}>{busy ? "Saving..." : "Continue"}</button>
        {error && <p className="auth-error" role="alert">{error}</p>}
      </div>
    </AuthShell>
  );
}

export function AuthErrorScreen({ go, error, retry }) {
  return (
    <AuthShell footer={<button className="link-btn" onClick={() => go("login")}>Back to login</button>}>
      <h1 className="auth-title">Account needs attention</h1>
      <p className="auth-error" role="alert">{error || "Unable to finish authentication."}</p>
      <button className="btn btn--amber btn--full" onClick={retry}>Try again</button>
      <button className="link-btn" onClick={() => go("forgot")}>Request a new password link</button>
    </AuthShell>
  );
}
