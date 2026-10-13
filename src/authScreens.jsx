import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { getPlanDetails } from "./billingLogic";
import { Mail, Lock, CheckCircle2, Building2 } from "lucide-react";
import { TextField, AuthShell, getStoredPlanSelection, fetchProfile } from "./shared";
import { callbackUrl, ensureBusinessProfile, registerBusiness, getRegistrationDetails, startAuthenticatedCheckout, selectedPaidPlan, RECOVERY_FLAG } from "./authLifecycle";

export function LoginScreen({ go }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
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
          <button type="button" className="link-btn" onClick={() => go("signup")}>Sign up</button>
        </>
      }
    >
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-sub">Log in to manage your business assistant.</p>
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
        <TextField label="Email" type="email" autoComplete="username" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        <TextField label="Password" type="password" autoComplete="current-password" icon={Lock} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" />
        <button type="button" className="link-btn link-btn--right" onClick={() => go("forgot")}>Forgot password?</button>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="btn btn--amber btn--full btn--lg" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in..." : "Log in"}
        </button>
        <button type="button" className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </form>
    </AuthShell>
  );
}

export function SignupScreen({ go }) {
  const [form, setForm] = useState(() => ({
    name: "",
    business: "",
    businessType: "Other",
    email: "",
    password: "",
  }));
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selection = getStoredPlanSelection();
  const paidPlan = selectedPaidPlan(selection);
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const result = await registerBusiness(form);
      if (!result.session) go("verify", { email: result.email });
      // Session-based routing and provisioning remain in NightlineApp.
    } catch (submitError) {
      setError(submitError.message || "Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell footer={<>Already have an account?{" "}
      <button type="button" className="link-btn" onClick={() => go("login")}>Log in</button>
    </>}>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">
        {paidPlan
          ? `Create your account to continue with ${paidPlan.plan} (${paidPlan.billingPeriod}). Payment happens securely after verification.`
          : "Start your 14-day trial. No card required."}
        {" "}You'll add services, hours and assistant details after registration.
      </p>
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
        <TextField label="Full name" autoComplete="name" value={form.name} onChange={set("name")} placeholder="Your name" />
        <TextField label="Business name" icon={Building2} value={form.business} onChange={set("business")} placeholder="Your business" />
        <TextField label="Email address" autoComplete="email" type="email" icon={Mail} value={form.email} onChange={set("email")} placeholder="you@business.com" />
        <TextField label="Password (at least 8 characters)" type="password" autoComplete="new-password" icon={Lock} value={form.password} onChange={set("password")} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--amber btn--full btn--lg" disabled={isSubmitting}>
          {isSubmitting ? "Creating account..." : "Create account"}
        </button>
        <button type="button" className="link-btn" onClick={() => go("landing")}>Back to landing</button>
      </form>
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
      <p className="auth-sub">Complete a one-time purchase in NGN through Paystack. Access activates after server-verified payment settlement. Payments do not renew automatically.</p>
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
          <p className="auth-error" role="alert">Only a business owner can manage subscription checkout.</p>
        ) : user.paymentStatus === "active" && user.plan === selection?.plan && user.billingPeriod === selection?.billingPeriod ? (
          <>
            <p>You're already subscribed to this plan.</p>
            <button className="btn btn--amber btn--full" onClick={() => go("dashboard")}>Dashboard</button>
          </>
        ) : (
          <button className="btn btn--amber btn--full btn--lg" disabled={submitting || !selection} onClick={handlePay}>
            {submitting ? "Connecting to Paystack..." : "Continue to Paystack"}
          </button>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
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
    if (isSubmitting) return;
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
    <AuthShell footer={<button type="button" className="link-btn" onClick={() => go("login")}>Back to log in</button>}>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">
        {sent ? "Check your inbox for a reset link." : "Enter your email and we'll send you a reset link."}
      </p>
      {!sent ? (
        <form className="auth-form" onSubmit={event => { event.preventDefault(); void handleSubmit(); }}>
          <TextField label="Email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="btn btn--amber btn--full btn--lg" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
          <button type="button" className="link-btn" onClick={() => go("landing")}>Back to landing</button>
        </form>
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
    <AuthShell footer={<button type="button" className="link-btn" onClick={() => go("login")}>Back to login</button>}>
      <h1 className="auth-title">Check your email</h1>
      <p className="auth-sub">Confirm your email address, then return to Ezeji Assistant. We will continue your business setup and selected plan.</p>
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void resend(); }}>
        <TextField label="Registration email" type="email" icon={Mail} value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn btn--amber btn--full" type="submit" disabled={busy}>{busy ? "Sending..." : "Resend confirmation"}</button>
        {state && <p role="status">{state}</p>}
        <button type="button" className="link-btn" onClick={() => go("login")}>Already verified? Log in</button>
      </form>
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
      localStorage.removeItem(RECOVERY_FLAG);
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
    <AuthShell footer={<button type="button" className="link-btn" onClick={() => go("login")}>Back to login</button>}>
      <h1 className="auth-title">Choose a new password</h1>
      {done ? (
        <div className="auth-form">
          <p>Your password has been changed. Sign in with your new password.</p>
          <button className="btn btn--amber btn--full" onClick={() => go("login")}>Log in</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <TextField label="New password (8+ characters)" type="password" autoComplete="new-password" icon={Lock} value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" icon={Lock} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="btn btn--amber btn--full btn--lg" disabled={busy} type="submit">{busy ? "Saving..." : "Update password"}</button>
        </form>
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
    <AuthShell footer={<button type="button" className="link-btn" onClick={() => supabase.auth.signOut().then(() => go("login"))}>Use another account</button>}>
      <h1 className="auth-title">Complete business setup</h1>
      <p className="auth-sub">Your account is verified. Provide the missing business details to continue to your saved plan.</p>
      <form className="auth-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <TextField label="Your name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <TextField label="Business name" icon={Building2} value={form.business} onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))} />
        <button className="btn btn--amber btn--full" type="submit" disabled={busy}>{busy ? "Saving..." : "Continue"}</button>
        {error && <p className="auth-error" role="alert">{error}</p>}
      </form>
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


export function PaymentPendingScreen({ onCheck, onDashboard }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("Verifying this checkout with Paystack. Your plan activates only after settlement.");
  const checkRef = useRef(onCheck);
  const inFlight = useRef(false);
  checkRef.current = onCheck;

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const active = await checkRef.current();
      if (!active) setMessage("This payment is still pending. Please verify again before starting another checkout.");
    } catch (error) {
      setMessage(error.message || "Unable to check payment status. Please retry.");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  // A Paystack callback should immediately reconcile the exact reference.
  // Ref gating prevents overlapping manual/automatic requests.
  useEffect(() => { void refresh(); }, []);
  return (
    <AuthShell footer={<button className="link-btn" onClick={onDashboard}>Open billing without dismissing payment verification</button>}>
      <h1 className="auth-title">Checking your payment</h1>
      <p className="auth-sub" role="status" aria-live="polite">{message}</p>
      <button className="btn btn--amber btn--full" onClick={refresh} disabled={checking}>
        {checking ? "Checking..." : "Refresh payment status"}
      </button>
    </AuthShell>
  );
}
